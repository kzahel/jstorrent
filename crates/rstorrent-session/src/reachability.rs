//! Task-free reachability generation and status transitions.
//!
//! Network ownership lives in the coordinator added by the mapping runtime.
//! This module keeps eligibility and stale-result fencing deterministic.

use std::net::{Ipv4Addr, SocketAddrV4, SocketAddrV6};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use rstorrent_engine::eligible_global_ipv6;
#[cfg(test)]
use rstorrent_engine::port_mapping::upnp::discover_igd_v2;
use rstorrent_engine::port_mapping::upnp::{
    UpnpDiscoveredService, UpnpDiscoveryConfig, UpnpError, UpnpGateway, UpnpIpv6Firewall,
    UpnpMapping, UpnpPinhole, UpnpPinholeCreateError, UpnpStage, UpnpTransport,
    discover_igd_v2_services,
};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::advertised_endpoint::AdvertisedPeerEndpointSelector;
use crate::diagnostics::{DiagnosticSeverity, category};
use crate::settings::{
    ClientSettings, Ipv6PinholeFailureStage, Ipv6PinholeStatus, ListenerPolicy, ListenerStatus,
    PortMappingFailureStage, PortMappingMechanism, PortMappingPolicy, PortMappingStatus,
    SettingsDomainGeneration,
};
use crate::shutdown::CleanupCutoff;
use crate::views::ViewHub;

const DELETE_TIMEOUT: Duration = Duration::from_secs(5);
const CLEANUP_CUT_SHORT: &str = "removal cut short by the application shutdown cleanup budget";
const RENEWAL_RETRY_DELAY: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Ipv4MappingKind {
    Tcp,
    Udp,
}

impl Ipv4MappingKind {
    const fn transport(self) -> UpnpTransport {
        match self {
            Self::Tcp => UpnpTransport::Tcp,
            Self::Udp => UpnpTransport::Udp,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ReachabilityEvent {
    Discovering,
    Mapping,
    Mapped {
        external_address: Ipv4Addr,
        external_port: u16,
        lease_seconds: u32,
    },
    Failed {
        stage: PortMappingFailureStage,
        detail: String,
    },
    RenewalFailed {
        external_address: Ipv4Addr,
        external_port: u16,
        detail: String,
    },
    Stopping,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct ReachabilityOwnerCounts {
    pub tasks: usize,
    pub mappings: usize,
    pub pinholes: usize,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct ReachabilityBlocks {
    pub tcp_mapping: bool,
    pub udp_mapping: bool,
    pub pinhole: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Ipv6PinholeDiagnosticResult {
    Packets(u32),
    Fault { code: Option<u16>, detail: String },
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ReachabilityEvidenceProbe {
    state: Arc<Mutex<ReachabilityEvidenceState>>,
}

#[derive(Clone, Debug, Default)]
struct ReachabilityEvidenceState {
    active: Option<(UpnpIpv6Firewall, UpnpPinhole)>,
    deleted: Option<(UpnpIpv6Firewall, UpnpPinhole)>,
}

impl ReachabilityEvidenceProbe {
    fn record_active(&self, firewall: &UpnpIpv6Firewall, pinhole: &UpnpPinhole) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.active = Some((firewall.clone(), pinhole.clone()));
        state.deleted = None;
    }

    fn record_deleted(&self, firewall: &UpnpIpv6Firewall, pinhole: &UpnpPinhole) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.active = None;
        state.deleted = Some((firewall.clone(), pinhole.clone()));
    }

    pub(crate) async fn pinhole_packets(
        &self,
        deleted: bool,
    ) -> Option<Ipv6PinholeDiagnosticResult> {
        let target = {
            let state = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if deleted {
                state.deleted.clone()
            } else {
                state.active.clone()
            }
        }?;
        let cancellation = CancellationToken::new();
        Some(
            match target.0.pinhole_packets(&target.1, &cancellation).await {
                Ok(packets) => Ipv6PinholeDiagnosticResult::Packets(packets),
                Err(error) => Ipv6PinholeDiagnosticResult::Fault {
                    code: error.fault_code(),
                    detail: error.detail().to_owned(),
                },
            },
        )
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ReachabilityStartInputs {
    pub ipv4_udp_listener: Option<SocketAddrV4>,
    pub ipv6_listener: Option<SocketAddrV6>,
    pub blocks: ReachabilityBlocks,
    pub evidence: ReachabilityEvidenceProbe,
    pub cancellation: CancellationToken,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UncertainMappingLease {
    pub transport: UpnpTransport,
    pub external_address: Ipv4Addr,
    pub external_port: u16,
    pub expires_at: Instant,
    pub detail: String,
}

impl UncertainMappingLease {
    pub(crate) fn remaining_lease_seconds(&self, now: Instant) -> u32 {
        let remaining = self.expires_at.saturating_duration_since(now);
        if remaining.is_zero() {
            return 0;
        }
        u32::try_from(remaining.as_secs().saturating_add(1)).unwrap_or(u32::MAX)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UncertainPinholeLease {
    pub internal_endpoint: SocketAddrV6,
    pub expires_at: Instant,
    pub detail: String,
}

impl UncertainPinholeLease {
    pub(crate) fn remaining_lease_seconds(&self, now: Instant) -> u32 {
        let remaining = self.expires_at.saturating_duration_since(now);
        if remaining.is_zero() {
            return 0;
        }
        u32::try_from(remaining.as_secs().saturating_add(1)).unwrap_or(u32::MAX)
    }
}

#[derive(Debug, Default, Eq, PartialEq)]
struct ReachabilityRunOutcome {
    uncertain_tcp_mapping: Option<UncertainMappingLease>,
    uncertain_udp_mapping: Option<UncertainMappingLease>,
    uncertain_pinhole: Option<UncertainPinholeLease>,
    error: Option<String>,
}

#[derive(Debug)]
pub(crate) struct ReachabilityFinalShutdown {
    pub terminal: ReachabilityOwnerCounts,
    /// Leases whose removal the cleanup cutoff ended, one message each.
    pub left_behind: Vec<String>,
}

#[derive(Debug)]
pub(crate) struct ReachabilityGenerationShutdown {
    pub terminal: ReachabilityOwnerCounts,
    pub uncertain_tcp_mapping: Option<UncertainMappingLease>,
    pub uncertain_udp_mapping: Option<UncertainMappingLease>,
    pub uncertain_pinhole: Option<UncertainPinholeLease>,
    pub error: Option<String>,
}

#[derive(Debug, Default)]
struct ReachabilityCounters {
    tasks: AtomicUsize,
    mappings: AtomicUsize,
    pinholes: AtomicUsize,
}

#[cfg(test)]
#[derive(Debug)]
struct MappingTaskContext {
    views: ViewHub,
    endpoint_selector: AdvertisedPeerEndpointSelector,
    cancellation: CancellationToken,
    counters: Arc<ReachabilityCounters>,
    settings_generation: SettingsDomainGeneration,
    discovery_config: Option<UpnpDiscoveryConfig>,
    cleanup_cancellation: CancellationToken,
}

#[derive(Clone, Debug)]
struct ReachabilityTaskContext {
    views: ViewHub,
    endpoint_selector: AdvertisedPeerEndpointSelector,
    cancellation: CancellationToken,
    counters: Arc<ReachabilityCounters>,
    settings_generation: SettingsDomainGeneration,
    discovery_config: Option<UpnpDiscoveryConfig>,
    evidence: ReachabilityEvidenceProbe,
    cleanup_permitted: Arc<AtomicBool>,
    network_cancellation: Option<CancellationToken>,
    /// Ends in-flight mapping and pinhole deletes when application shutdown
    /// runs out of network cleanup time.
    cleanup_cancellation: CancellationToken,
}

#[derive(Debug)]
pub(crate) struct ReachabilityCoordinator {
    cancellation: CancellationToken,
    task: Option<JoinHandle<ReachabilityRunOutcome>>,
    counters: Arc<ReachabilityCounters>,
    endpoint_selector: AdvertisedPeerEndpointSelector,
    cleanup_permitted: Arc<AtomicBool>,
    cleanup_cancellation: CancellationToken,
}

impl ReachabilityCoordinator {
    pub(crate) fn start(
        settings: &ClientSettings,
        listener_status: &ListenerStatus,
        inputs: ReachabilityStartInputs,
        views: ViewHub,
        endpoint_selector: AdvertisedPeerEndpointSelector,
        settings_generation: SettingsDomainGeneration,
    ) -> Self {
        let ReachabilityStartInputs {
            ipv4_udp_listener,
            ipv6_listener,
            blocks,
            evidence,
            cancellation,
        } = inputs;
        let network_cancellation = cancellation;
        let generation = endpoint_selector.begin_mapping_generation();
        let mut tcp_mapping_state = ReachabilityState::new(generation, settings, listener_status);
        let mut udp_mapping_state =
            ReachabilityState::new_udp(generation, settings, ipv4_udp_listener);
        let mut pinhole_state = Ipv6PinholeState::new(generation, settings, ipv6_listener);
        let discovery_endpoint = tcp_mapping_state
            .local_endpoint()
            .or_else(|| udp_mapping_state.local_endpoint());
        if blocks.tcp_mapping {
            tcp_mapping_state.block();
        }
        if blocks.udp_mapping {
            udp_mapping_state.block();
        }
        if blocks.pinhole {
            pinhole_state.block();
        }
        let _ = views
            .set_port_mapping_status_for(settings_generation, tcp_mapping_state.status().clone());
        let _ = views.set_udp_port_mapping_status_for(
            settings_generation,
            udp_mapping_state.status().clone(),
        );
        let _ =
            views.set_ipv6_pinhole_status_for(settings_generation, pinhole_state.status().clone());
        let cancellation = network_cancellation.child_token();
        let counters = Arc::new(ReachabilityCounters::default());
        let cleanup_permitted = Arc::new(AtomicBool::new(true));
        let has_work = tcp_mapping_state.local_endpoint().is_some()
            || udp_mapping_state.local_endpoint().is_some()
            || pinhole_state.internal_endpoint().is_some();
        let task_cleanup_permitted = cleanup_permitted.clone();
        let cleanup_cancellation = CancellationToken::new();
        let task_cleanup_cancellation = cleanup_cancellation.clone();
        let task = has_work.then(|| {
            counters.tasks.store(1, Ordering::Release);
            let task_cancellation = cancellation.clone();
            let task_counters = counters.clone();
            let task_endpoint_selector = endpoint_selector.clone();
            let task_views = views.clone();
            tokio::spawn(async move {
                let result = run_reachability(
                    tcp_mapping_state,
                    udp_mapping_state,
                    pinhole_state,
                    discovery_endpoint,
                    ReachabilityTaskContext {
                        views: task_views,
                        endpoint_selector: task_endpoint_selector,
                        cancellation: task_cancellation,
                        counters: task_counters.clone(),
                        settings_generation,
                        discovery_config: None,
                        evidence,
                        cleanup_permitted: task_cleanup_permitted,
                        network_cancellation: Some(network_cancellation),
                        cleanup_cancellation: task_cleanup_cancellation,
                    },
                )
                .await;
                task_counters.tasks.store(0, Ordering::Release);
                result
            })
        });
        Self {
            cancellation,
            task,
            counters,
            endpoint_selector,
            cleanup_permitted,
            cleanup_cancellation,
        }
    }

    pub(crate) fn owner_counts(&self) -> ReachabilityOwnerCounts {
        ReachabilityOwnerCounts {
            tasks: self.counters.tasks.load(Ordering::Acquire),
            mappings: self.counters.mappings.load(Ordering::Acquire),
            pinholes: self.counters.pinholes.load(Ordering::Acquire),
        }
    }

    pub(crate) fn is_finished(&self) -> bool {
        self.task.as_ref().is_some_and(JoinHandle::is_finished)
    }

    /// Final application shutdown. Deletes still running when `cutoff` is
    /// reached are cancelled; their leases are returned as `left_behind`
    /// rather than as errors.
    pub(crate) async fn shutdown(
        mut self,
        cutoff: &CleanupCutoff,
    ) -> Result<ReachabilityFinalShutdown, String> {
        let shutdown = self.shutdown_inner(true, Some(cutoff)).await?;
        let mut errors = shutdown.error.into_iter().collect::<Vec<_>>();
        let mut left_behind = Vec::new();
        for uncertain in [
            shutdown.uncertain_tcp_mapping,
            shutdown.uncertain_udp_mapping,
        ]
        .into_iter()
        .flatten()
        {
            let message = format!(
                "{}; external {:?} endpoint {}:{} may remain for {} seconds",
                uncertain.detail,
                uncertain.transport,
                uncertain.external_address,
                uncertain.external_port,
                uncertain.remaining_lease_seconds(Instant::now()),
            );
            if uncertain.detail == CLEANUP_CUT_SHORT {
                left_behind.push(message);
            } else {
                errors.push(message);
            }
        }
        if let Some(uncertain) = shutdown.uncertain_pinhole {
            let message = format!(
                "{}; IPv6 endpoint {} may remain pinholed for {} seconds",
                uncertain.detail,
                uncertain.internal_endpoint,
                uncertain.remaining_lease_seconds(Instant::now()),
            );
            if uncertain.detail == CLEANUP_CUT_SHORT {
                left_behind.push(message);
            } else {
                errors.push(message);
            }
        }
        if errors.is_empty() {
            Ok(ReachabilityFinalShutdown {
                terminal: shutdown.terminal,
                left_behind,
            })
        } else {
            errors.extend(left_behind);
            Err(errors.join("; "))
        }
    }

    pub(crate) async fn shutdown_generation(
        mut self,
    ) -> Result<ReachabilityGenerationShutdown, String> {
        self.shutdown_inner(false, None).await
    }

    pub(crate) async fn shutdown_without_network_cleanup(
        mut self,
    ) -> Result<ReachabilityGenerationShutdown, String> {
        self.cleanup_permitted.store(false, Ordering::Release);
        self.shutdown_inner(true, None).await
    }

    async fn shutdown_inner(
        &mut self,
        final_application_shutdown: bool,
        cutoff: Option<&CleanupCutoff>,
    ) -> Result<ReachabilityGenerationShutdown, String> {
        if final_application_shutdown {
            self.endpoint_selector.stop();
        }
        self.cancellation.cancel();
        let outcome = if let Some(mut task) = self.task.take() {
            let joined = match cutoff {
                Some(cutoff) => tokio::select! {
                    joined = &mut task => joined,
                    () = cutoff.reached() => {
                        self.cleanup_cancellation.cancel();
                        task.await
                    }
                },
                None => task.await,
            };
            match joined {
                Ok(outcome) => outcome,
                Err(error) if error.is_cancelled() => ReachabilityRunOutcome::default(),
                Err(error) => return Err(format!("reachability task join: {error}")),
            }
        } else {
            ReachabilityRunOutcome::default()
        };
        let terminal = self.owner_counts();
        if terminal != ReachabilityOwnerCounts::default() {
            return Err(format!(
                "reachability owners remain: tasks={},mappings={},pinholes={}",
                terminal.tasks, terminal.mappings, terminal.pinholes
            ));
        }
        Ok(ReachabilityGenerationShutdown {
            terminal,
            uncertain_tcp_mapping: outcome.uncertain_tcp_mapping,
            uncertain_udp_mapping: outcome.uncertain_udp_mapping,
            uncertain_pinhole: outcome.uncertain_pinhole,
            error: outcome.error,
        })
    }
}

impl Drop for ReachabilityCoordinator {
    fn drop(&mut self) {
        self.cancellation.cancel();
    }
}

#[cfg(test)]
async fn run_mapping(
    mut state: ReachabilityState,
    local_endpoint: SocketAddrV4,
    context: MappingTaskContext,
) -> ReachabilityRunOutcome {
    let MappingTaskContext {
        views,
        endpoint_selector,
        cancellation,
        counters,
        settings_generation,
        discovery_config,
        cleanup_cancellation,
    } = context;
    if let Err(error) = publish_mapping_status(
        Ipv4MappingKind::Tcp,
        &mut state,
        &views,
        settings_generation,
        ReachabilityEvent::Discovering,
    ) {
        return ReachabilityRunOutcome {
            error: Some(error),
            ..ReachabilityRunOutcome::default()
        };
    }
    let config = match discovery_config
        .map(Ok)
        .unwrap_or_else(|| UpnpDiscoveryConfig::new(*local_endpoint.ip()))
    {
        Ok(config) => config,
        Err(error) => {
            return ReachabilityRunOutcome {
                error: publish_failure(
                    Ipv4MappingKind::Tcp,
                    &mut state,
                    &views,
                    settings_generation,
                    error,
                )
                .err(),
                ..ReachabilityRunOutcome::default()
            };
        }
    };
    let gateway = match discover_igd_v2(config, &cancellation).await {
        Ok(gateway) => gateway,
        Err(error) => {
            return ReachabilityRunOutcome {
                error: publish_failure(
                    Ipv4MappingKind::Tcp,
                    &mut state,
                    &views,
                    settings_generation,
                    error,
                )
                .err(),
                ..ReachabilityRunOutcome::default()
            };
        }
    };
    run_ipv4_mapping(
        Ipv4MappingKind::Tcp,
        state,
        local_endpoint,
        gateway,
        ReachabilityTaskContext {
            cleanup_cancellation,
            ..context_without_discovery(
                views,
                endpoint_selector,
                cancellation,
                counters,
                settings_generation,
            )
        },
    )
    .await
}

#[cfg(test)]
fn context_without_discovery(
    views: ViewHub,
    endpoint_selector: AdvertisedPeerEndpointSelector,
    cancellation: CancellationToken,
    counters: Arc<ReachabilityCounters>,
    settings_generation: SettingsDomainGeneration,
) -> ReachabilityTaskContext {
    ReachabilityTaskContext {
        views,
        endpoint_selector,
        cancellation,
        counters,
        settings_generation,
        discovery_config: None,
        evidence: ReachabilityEvidenceProbe::default(),
        cleanup_permitted: Arc::new(AtomicBool::new(true)),
        network_cancellation: None,
        cleanup_cancellation: CancellationToken::new(),
    }
}

async fn run_reachability(
    mut tcp_mapping_state: ReachabilityState,
    mut udp_mapping_state: ReachabilityState,
    mut pinhole_state: Ipv6PinholeState,
    discovery_endpoint: Option<SocketAddrV4>,
    context: ReachabilityTaskContext,
) -> ReachabilityRunOutcome {
    let tcp_mapping_active = tcp_mapping_state.local_endpoint().is_some();
    let udp_mapping_active = udp_mapping_state.local_endpoint().is_some();
    let pinhole_active = pinhole_state.internal_endpoint().is_some();
    if tcp_mapping_active
        && let Err(error) = publish_mapping_status(
            Ipv4MappingKind::Tcp,
            &mut tcp_mapping_state,
            &context.views,
            context.settings_generation,
            ReachabilityEvent::Discovering,
        )
    {
        return ReachabilityRunOutcome {
            error: Some(error),
            ..ReachabilityRunOutcome::default()
        };
    }
    if udp_mapping_active
        && let Err(error) = publish_mapping_status(
            Ipv4MappingKind::Udp,
            &mut udp_mapping_state,
            &context.views,
            context.settings_generation,
            ReachabilityEvent::Discovering,
        )
    {
        return ReachabilityRunOutcome {
            error: Some(error),
            ..ReachabilityRunOutcome::default()
        };
    }
    if pinhole_active
        && let Err(error) = publish_pinhole(
            &mut pinhole_state,
            &context.views,
            context.settings_generation,
            Ipv6PinholeEvent::Discovering,
        )
    {
        return ReachabilityRunOutcome {
            error: Some(error),
            ..ReachabilityRunOutcome::default()
        };
    }
    let Some(discovery_endpoint) = discovery_endpoint else {
        let detail = "UPnP discovery requires the current IPv4 listener address".to_owned();
        let mut errors = Vec::new();
        if tcp_mapping_active
            && let Err(error) = publish_mapping_status(
                Ipv4MappingKind::Tcp,
                &mut tcp_mapping_state,
                &context.views,
                context.settings_generation,
                ReachabilityEvent::Failed {
                    stage: PortMappingFailureStage::Discovery,
                    detail: detail.clone(),
                },
            )
        {
            errors.push(error);
        }
        if udp_mapping_active
            && let Err(error) = publish_mapping_status(
                Ipv4MappingKind::Udp,
                &mut udp_mapping_state,
                &context.views,
                context.settings_generation,
                ReachabilityEvent::Failed {
                    stage: PortMappingFailureStage::Discovery,
                    detail: detail.clone(),
                },
            )
        {
            errors.push(error);
        }
        if pinhole_active
            && let Err(error) = publish_pinhole(
                &mut pinhole_state,
                &context.views,
                context.settings_generation,
                Ipv6PinholeEvent::Failed {
                    stage: Ipv6PinholeFailureStage::Discovery,
                    detail,
                },
            )
        {
            errors.push(error);
        }
        return ReachabilityRunOutcome {
            error: (!errors.is_empty()).then(|| errors.join("; ")),
            ..ReachabilityRunOutcome::default()
        };
    };
    let config = match context
        .discovery_config
        .clone()
        .map(Ok)
        .unwrap_or_else(|| UpnpDiscoveryConfig::new(*discovery_endpoint.ip()))
    {
        Ok(config) => config,
        Err(error) => {
            return publish_shared_discovery_failure(
                tcp_mapping_state,
                udp_mapping_state,
                pinhole_state,
                &context,
                error,
            );
        }
    };
    let services = match discover_igd_v2_services(config, &context.cancellation).await {
        Ok(services) => services,
        Err(error) => {
            if context.cancellation.is_cancelled() {
                return ReachabilityRunOutcome::default();
            }
            return publish_shared_discovery_failure(
                tcp_mapping_state,
                udp_mapping_state,
                pinhole_state,
                &context,
                error,
            );
        }
    };

    let any_mapping_active = tcp_mapping_active || udp_mapping_active;
    let mapping = match (any_mapping_active, services.ipv4_mapping) {
        (true, UpnpDiscoveredService::Available(gateway)) => Some(gateway),
        (true, UpnpDiscoveredService::Absent) => {
            let detail = "gateway did not advertise WANIPConnection:2".to_owned();
            if tcp_mapping_active {
                let _ = publish_mapping_status(
                    Ipv4MappingKind::Tcp,
                    &mut tcp_mapping_state,
                    &context.views,
                    context.settings_generation,
                    ReachabilityEvent::Failed {
                        stage: PortMappingFailureStage::Description,
                        detail: detail.clone(),
                    },
                );
            }
            if udp_mapping_active {
                let _ = publish_mapping_status(
                    Ipv4MappingKind::Udp,
                    &mut udp_mapping_state,
                    &context.views,
                    context.settings_generation,
                    ReachabilityEvent::Failed {
                        stage: PortMappingFailureStage::Description,
                        detail,
                    },
                );
            }
            None
        }
        (true, UpnpDiscoveredService::Unavailable(error)) => {
            if tcp_mapping_active {
                let _ = publish_failure(
                    Ipv4MappingKind::Tcp,
                    &mut tcp_mapping_state,
                    &context.views,
                    context.settings_generation,
                    error.clone(),
                );
            }
            if udp_mapping_active {
                let _ = publish_failure(
                    Ipv4MappingKind::Udp,
                    &mut udp_mapping_state,
                    &context.views,
                    context.settings_generation,
                    error,
                );
            }
            None
        }
        (false, _) => None,
    };
    let firewall = match (pinhole_active, services.ipv6_firewall) {
        (true, UpnpDiscoveredService::Available(firewall)) => Some(firewall),
        (true, UpnpDiscoveredService::Absent) => {
            let _ = publish_pinhole(
                &mut pinhole_state,
                &context.views,
                context.settings_generation,
                Ipv6PinholeEvent::ServiceUnavailable,
            );
            None
        }
        (true, UpnpDiscoveredService::Unavailable(error)) => {
            record_pinhole_failure_diagnostic(&context.views, &error);
            let _ = publish_pinhole(
                &mut pinhole_state,
                &context.views,
                context.settings_generation,
                Ipv6PinholeEvent::ActionUnavailable {
                    detail: error.detail().to_owned(),
                },
            );
            None
        }
        (false, _) => None,
    };

    let tcp_gateway = mapping.clone();
    let udp_gateway = mapping;
    let tcp_context = context.clone();
    let udp_context = context.clone();
    let pinhole_context = context;
    let tcp_mapping_future = async move {
        match (tcp_mapping_state.local_endpoint(), tcp_gateway) {
            (Some(local_endpoint), Some(gateway)) => {
                run_ipv4_mapping(
                    Ipv4MappingKind::Tcp,
                    tcp_mapping_state,
                    local_endpoint,
                    gateway,
                    tcp_context,
                )
                .await
            }
            _ => ReachabilityRunOutcome::default(),
        }
    };
    let udp_mapping_future = async move {
        match (udp_mapping_state.local_endpoint(), udp_gateway) {
            (Some(local_endpoint), Some(gateway)) => {
                run_ipv4_mapping(
                    Ipv4MappingKind::Udp,
                    udp_mapping_state,
                    local_endpoint,
                    gateway,
                    udp_context,
                )
                .await
            }
            _ => ReachabilityRunOutcome::default(),
        }
    };
    let pinhole_future = async move {
        match (pinhole_state.internal_endpoint(), firewall) {
            (Some(internal_endpoint), Some(firewall)) => {
                run_ipv6_pinhole(pinhole_state, internal_endpoint, firewall, pinhole_context).await
            }
            _ => ReachabilityRunOutcome::default(),
        }
    };
    let (tcp_mapping_outcome, udp_mapping_outcome, pinhole_outcome) =
        tokio::join!(tcp_mapping_future, udp_mapping_future, pinhole_future);
    combine_outcomes(tcp_mapping_outcome, udp_mapping_outcome, pinhole_outcome)
}

fn publish_shared_discovery_failure(
    mut tcp_mapping_state: ReachabilityState,
    mut udp_mapping_state: ReachabilityState,
    mut pinhole_state: Ipv6PinholeState,
    context: &ReachabilityTaskContext,
    error: UpnpError,
) -> ReachabilityRunOutcome {
    let tcp_mapping_active = tcp_mapping_state.local_endpoint().is_some();
    let udp_mapping_active = udp_mapping_state.local_endpoint().is_some();
    let pinhole_active = pinhole_state.internal_endpoint().is_some();
    if tcp_mapping_active {
        record_failure_diagnostic(Ipv4MappingKind::Tcp, &context.views, &error);
    }
    if udp_mapping_active {
        record_failure_diagnostic(Ipv4MappingKind::Udp, &context.views, &error);
    }
    let mut errors = Vec::new();
    if tcp_mapping_active
        && let Err(publish_error) = publish_mapping_status(
            Ipv4MappingKind::Tcp,
            &mut tcp_mapping_state,
            &context.views,
            context.settings_generation,
            ReachabilityEvent::Failed {
                stage: failure_stage(error.stage()),
                detail: error.detail().to_owned(),
            },
        )
    {
        errors.push(publish_error);
    }
    if udp_mapping_active
        && let Err(publish_error) = publish_mapping_status(
            Ipv4MappingKind::Udp,
            &mut udp_mapping_state,
            &context.views,
            context.settings_generation,
            ReachabilityEvent::Failed {
                stage: failure_stage(error.stage()),
                detail: error.detail().to_owned(),
            },
        )
    {
        errors.push(publish_error);
    }
    if pinhole_active
        && let Err(publish_error) = publish_pinhole(
            &mut pinhole_state,
            &context.views,
            context.settings_generation,
            Ipv6PinholeEvent::Failed {
                stage: pinhole_failure_stage(error.stage()),
                detail: error.detail().to_owned(),
            },
        )
    {
        errors.push(publish_error);
    }
    ReachabilityRunOutcome {
        error: (!errors.is_empty()).then(|| errors.join("; ")),
        ..ReachabilityRunOutcome::default()
    }
}

fn combine_outcomes(
    tcp_mapping: ReachabilityRunOutcome,
    udp_mapping: ReachabilityRunOutcome,
    pinhole: ReachabilityRunOutcome,
) -> ReachabilityRunOutcome {
    let errors = [tcp_mapping.error, udp_mapping.error, pinhole.error]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    ReachabilityRunOutcome {
        uncertain_tcp_mapping: tcp_mapping.uncertain_tcp_mapping,
        uncertain_udp_mapping: udp_mapping.uncertain_udp_mapping,
        uncertain_pinhole: pinhole.uncertain_pinhole,
        error: (!errors.is_empty()).then(|| errors.join("; ")),
    }
}

async fn run_ipv4_mapping(
    kind: Ipv4MappingKind,
    mut state: ReachabilityState,
    local_endpoint: SocketAddrV4,
    gateway: UpnpGateway,
    context: ReachabilityTaskContext,
) -> ReachabilityRunOutcome {
    let ReachabilityTaskContext {
        views,
        endpoint_selector,
        cancellation,
        counters,
        settings_generation,
        discovery_config: _,
        evidence: _,
        cleanup_permitted,
        network_cancellation,
        cleanup_cancellation,
    } = context;
    if let Err(error) = publish_mapping_status(
        kind,
        &mut state,
        &views,
        settings_generation,
        ReachabilityEvent::Mapping,
    ) {
        return ReachabilityRunOutcome {
            error: Some(error),
            ..ReachabilityRunOutcome::default()
        };
    }
    let mut mapping = match gateway
        .create_mapping(kind.transport(), local_endpoint.port(), &cancellation)
        .await
    {
        Ok(mapping) => mapping,
        Err(error) => {
            return ReachabilityRunOutcome {
                error: publish_failure(kind, &mut state, &views, settings_generation, error).err(),
                ..ReachabilityRunOutcome::default()
            };
        }
    };
    counters.mappings.fetch_add(1, Ordering::AcqRel);
    let mut run_error = publish_mapped(
        kind,
        &mut state,
        &views,
        &endpoint_selector,
        &mapping,
        settings_generation,
    )
    .err();
    let mut lease_deadline = Instant::now()
        .checked_add(Duration::from_secs(u64::from(mapping.lease_seconds)))
        .unwrap_or_else(|| {
            run_error = Some("UPnP mapping lease deadline overflow".to_owned());
            Instant::now()
        });
    let mut renewal_delay = mapping.renewal_delay();
    while run_error.is_none() {
        tokio::select! {
            _ = cancellation.cancelled() => break,
            _ = tokio::time::sleep(renewal_delay) => {
                let endpoint_expired = match kind {
                    Ipv4MappingKind::Tcp => endpoint_selector.expire(Instant::now()),
                    Ipv4MappingKind::Udp => endpoint_selector.expire_udp_mapping(Instant::now()),
                };
                if endpoint_expired
                    && let Err(error) = publish_selected_endpoint(&endpoint_selector, &views)
                {
                    run_error = Some(error);
                    continue;
                }
                match gateway.renew_mapping(&mut mapping, &cancellation).await {
                    Ok(()) => {
                        if let Err(error) = publish_mapped(
                            kind,
                            &mut state,
                            &views,
                            &endpoint_selector,
                            &mapping,
                            settings_generation,
                        ) {
                            run_error = Some(error);
                            continue;
                        }
                        let Some(deadline) = Instant::now()
                            .checked_add(Duration::from_secs(u64::from(mapping.lease_seconds)))
                        else {
                            run_error = Some("UPnP mapping lease deadline overflow".to_owned());
                            continue;
                        };
                        lease_deadline = deadline;
                        renewal_delay = mapping.renewal_delay();
                    }
                    Err(error) => {
                        if let Err(publish_error) = publish_mapping_status(
                            kind,
                            &mut state,
                            &views,
                            settings_generation,
                            ReachabilityEvent::RenewalFailed {
                                external_address: mapping.external_address,
                                external_port: mapping.external_port,
                                detail: error.detail().to_owned(),
                            },
                        ) {
                            run_error = Some(publish_error);
                            continue;
                        }
                        let endpoint_changed = match kind {
                            Ipv4MappingKind::Tcp => endpoint_selector.renewal_failed(
                                state.generation(),
                                error.detail().to_owned(),
                                Instant::now(),
                            ),
                            Ipv4MappingKind::Udp => endpoint_selector.udp_renewal_failed(
                                state.generation(),
                                error.detail().to_owned(),
                                Instant::now(),
                            ),
                        };
                        if endpoint_changed && let Err(publish_error) =
                            publish_selected_endpoint(&endpoint_selector, &views)
                        {
                            run_error = Some(publish_error);
                            continue;
                        }
                        record_failure_diagnostic(kind, &views, &error);
                        let remaining =
                            lease_deadline.saturating_duration_since(Instant::now());
                        renewal_delay = if remaining.is_zero() {
                            RENEWAL_RETRY_DELAY
                        } else {
                            RENEWAL_RETRY_DELAY.min(remaining)
                        };
                    }
                }
            }
        }
    }
    if !cleanup_permitted.load(Ordering::Acquire)
        || network_cancellation.is_some_and(|cancellation| cancellation.is_cancelled())
    {
        counters.mappings.fetch_sub(1, Ordering::AcqRel);
        let uncertain_mapping = Some(UncertainMappingLease {
            transport: kind.transport(),
            external_address: mapping.external_address,
            external_port: mapping.external_port,
            expires_at: lease_deadline,
            detail: "UPnP mapping cleanup suppressed by application network prerequisite"
                .to_owned(),
        });
        return match kind {
            Ipv4MappingKind::Tcp => ReachabilityRunOutcome {
                uncertain_tcp_mapping: uncertain_mapping,
                error: run_error,
                ..ReachabilityRunOutcome::default()
            },
            Ipv4MappingKind::Udp => ReachabilityRunOutcome {
                uncertain_udp_mapping: uncertain_mapping,
                error: run_error,
                ..ReachabilityRunOutcome::default()
            },
        };
    }
    if let Err(error) = publish_mapping_status(
        kind,
        &mut state,
        &views,
        settings_generation,
        ReachabilityEvent::Stopping,
    ) && run_error.is_none()
    {
        run_error = Some(error);
    }
    let delete = tokio::time::timeout(
        DELETE_TIMEOUT,
        gateway.delete_mapping(&mapping, &cleanup_cancellation),
    )
    .await;
    counters.mappings.fetch_sub(1, Ordering::AcqRel);
    let uncertain_mapping = match delete {
        Ok(Ok(())) => None,
        Ok(Err(_)) | Err(_) if cleanup_cancellation.is_cancelled() => Some(UncertainMappingLease {
            transport: kind.transport(),
            external_address: mapping.external_address,
            external_port: mapping.external_port,
            expires_at: lease_deadline,
            detail: CLEANUP_CUT_SHORT.to_owned(),
        }),
        Ok(Err(error)) => {
            record_failure_diagnostic(kind, &views, &error);
            Some(UncertainMappingLease {
                transport: kind.transport(),
                external_address: mapping.external_address,
                external_port: mapping.external_port,
                expires_at: lease_deadline,
                detail: format!("delete UPnP mapping: {}", error.detail()),
            })
        }
        Err(_) => Some(UncertainMappingLease {
            transport: kind.transport(),
            external_address: mapping.external_address,
            external_port: mapping.external_port,
            expires_at: lease_deadline,
            detail: "delete UPnP mapping: cleanup deadline elapsed".to_owned(),
        }),
    };
    match kind {
        Ipv4MappingKind::Tcp => ReachabilityRunOutcome {
            uncertain_tcp_mapping: uncertain_mapping,
            error: run_error,
            ..ReachabilityRunOutcome::default()
        },
        Ipv4MappingKind::Udp => ReachabilityRunOutcome {
            uncertain_udp_mapping: uncertain_mapping,
            error: run_error,
            ..ReachabilityRunOutcome::default()
        },
    }
}

async fn run_ipv6_pinhole(
    mut state: Ipv6PinholeState,
    internal_endpoint: SocketAddrV6,
    firewall: UpnpIpv6Firewall,
    context: ReachabilityTaskContext,
) -> ReachabilityRunOutcome {
    let ReachabilityTaskContext {
        views,
        endpoint_selector,
        cancellation,
        counters,
        settings_generation,
        discovery_config: _,
        evidence,
        cleanup_permitted,
        network_cancellation,
        cleanup_cancellation,
    } = context;
    let status = match firewall.firewall_status(&cancellation).await {
        Ok(status) => status,
        Err(_error) if cancellation.is_cancelled() => return ReachabilityRunOutcome::default(),
        Err(error) => {
            return ReachabilityRunOutcome {
                error: publish_pinhole_failure(&mut state, &views, settings_generation, error)
                    .err(),
                ..ReachabilityRunOutcome::default()
            };
        }
    };
    if !status.firewall_enabled {
        let run_error = publish_pinhole(
            &mut state,
            &views,
            settings_generation,
            Ipv6PinholeEvent::Unfiltered,
        )
        .and_then(|current| {
            if current && endpoint_selector.ipv6_unfiltered(state.generation()) {
                publish_selected_endpoint(&endpoint_selector, &views)?;
            }
            Ok(current)
        })
        .err();
        cancellation.cancelled().await;
        let _ = publish_pinhole(
            &mut state,
            &views,
            settings_generation,
            Ipv6PinholeEvent::Stopping,
        );
        if endpoint_selector.ipv6_pinhole_lost(state.generation()) {
            let _ = publish_selected_endpoint(&endpoint_selector, &views);
        }
        return ReachabilityRunOutcome {
            error: run_error,
            ..ReachabilityRunOutcome::default()
        };
    }
    if !status.inbound_pinhole_allowed {
        let error = publish_pinhole(
            &mut state,
            &views,
            settings_generation,
            Ipv6PinholeEvent::InboundPinholeDisallowed,
        )
        .err();
        return ReachabilityRunOutcome {
            error,
            ..ReachabilityRunOutcome::default()
        };
    }

    'create: loop {
        if cancellation.is_cancelled() {
            return ReachabilityRunOutcome::default();
        }
        if let Err(error) = publish_pinhole(
            &mut state,
            &views,
            settings_generation,
            Ipv6PinholeEvent::Creating,
        ) {
            return ReachabilityRunOutcome {
                error: Some(error),
                ..ReachabilityRunOutcome::default()
            };
        }
        let mut pinhole = match firewall
            .create_pinhole(internal_endpoint, &cancellation)
            .await
        {
            Ok(pinhole) => pinhole,
            Err(_) if cancellation.is_cancelled() => return ReachabilityRunOutcome::default(),
            Err(UpnpPinholeCreateError::Failed(error)) => {
                return ReachabilityRunOutcome {
                    error: publish_pinhole_failure(&mut state, &views, settings_generation, error)
                        .err(),
                    ..ReachabilityRunOutcome::default()
                };
            }
            Err(UpnpPinholeCreateError::Uncertain(uncertain)) => {
                let expires_at = Instant::now()
                    .checked_add(Duration::from_secs(u64::from(uncertain.lease_seconds)))
                    .expect("bounded UPnP pinhole lease fits Instant");
                let lease = UncertainPinholeLease {
                    internal_endpoint: uncertain.internal_endpoint,
                    expires_at,
                    detail: uncertain.detail,
                };
                let error = publish_pinhole(
                    &mut state,
                    &views,
                    settings_generation,
                    Ipv6PinholeEvent::CleanupFailed {
                        remaining_lease_seconds: lease.remaining_lease_seconds(Instant::now()),
                        detail: lease.detail.clone(),
                    },
                )
                .err();
                if error.is_some() {
                    return ReachabilityRunOutcome {
                        uncertain_pinhole: Some(lease),
                        error,
                        ..ReachabilityRunOutcome::default()
                    };
                }
                tokio::select! {
                    _ = cancellation.cancelled() => {
                        return ReachabilityRunOutcome {
                            uncertain_pinhole: Some(lease),
                            ..ReachabilityRunOutcome::default()
                        };
                    }
                    _ = tokio::time::sleep_until(lease.expires_at.into()) => continue 'create,
                }
            }
        };
        counters.pinholes.store(1, Ordering::Release);
        evidence.record_active(&firewall, &pinhole);
        let now = Instant::now();
        let mut confirmed_deadline = now
            .checked_add(Duration::from_secs(u64::from(pinhole.lease_seconds)))
            .expect("bounded UPnP pinhole lease fits Instant");
        let mut latest_possible_deadline = confirmed_deadline;
        let mut renewal_delay = pinhole.renewal_delay();
        let mut run_error = publish_pinholed(
            &mut state,
            &views,
            &endpoint_selector,
            &pinhole,
            settings_generation,
        )
        .err();
        let mut recreate = false;
        while run_error.is_none() && !recreate {
            tokio::select! {
                _ = cancellation.cancelled() => break,
                _ = tokio::time::sleep(renewal_delay) => {
                    let now = Instant::now();
                    if now >= confirmed_deadline
                        && endpoint_selector.ipv6_pinhole_lost(state.generation())
                        && let Err(error) = publish_selected_endpoint(&endpoint_selector, &views)
                    {
                        run_error = Some(error);
                        continue;
                    }
                    match firewall.renew_pinhole(&mut pinhole, &cancellation).await {
                        Ok(()) => {
                            evidence.record_active(&firewall, &pinhole);
                            let now = Instant::now();
                            confirmed_deadline = now
                                .checked_add(Duration::from_secs(u64::from(pinhole.lease_seconds)))
                                .expect("bounded UPnP pinhole lease fits Instant");
                            latest_possible_deadline = confirmed_deadline;
                            renewal_delay = pinhole.renewal_delay();
                            if let Err(error) = publish_pinholed(
                                &mut state,
                                &views,
                                &endpoint_selector,
                                &pinhole,
                                settings_generation,
                            ) {
                                run_error = Some(error);
                            }
                        }
                        Err(error) => {
                            record_pinhole_failure_diagnostic(&views, &error);
                            if let Err(publish_error) = publish_pinhole(
                                &mut state,
                                &views,
                                settings_generation,
                                Ipv6PinholeEvent::RenewalFailed {
                                    detail: error.detail().to_owned(),
                                },
                            ) {
                                run_error = Some(publish_error);
                                continue;
                            }
                            let now = Instant::now();
                            if error.fault_code() == Some(704) {
                                evidence.record_deleted(&firewall, &pinhole);
                                counters.pinholes.store(0, Ordering::Release);
                                if endpoint_selector.ipv6_pinhole_lost(state.generation())
                                    && let Err(publish_error) =
                                        publish_selected_endpoint(&endpoint_selector, &views)
                                {
                                    run_error = Some(publish_error);
                                    continue;
                                }
                                recreate = true;
                                continue;
                            }
                            if error.is_transport() {
                                latest_possible_deadline = now
                                    .checked_add(Duration::from_secs(u64::from(pinhole.lease_seconds)))
                                    .expect("bounded UPnP pinhole lease fits Instant");
                            }
                            if now >= latest_possible_deadline {
                                counters.pinholes.store(0, Ordering::Release);
                                recreate = true;
                            } else {
                                renewal_delay = RENEWAL_RETRY_DELAY.min(
                                    latest_possible_deadline.saturating_duration_since(now),
                                );
                            }
                        }
                    }
                }
            }
        }
        if recreate && run_error.is_none() && !cancellation.is_cancelled() {
            tokio::select! {
                _ = cancellation.cancelled() => return ReachabilityRunOutcome::default(),
                _ = tokio::time::sleep(RENEWAL_RETRY_DELAY) => continue 'create,
            }
        }

        if !cleanup_permitted.load(Ordering::Acquire)
            || network_cancellation
                .as_ref()
                .is_some_and(CancellationToken::is_cancelled)
        {
            counters.pinholes.store(0, Ordering::Release);
            return ReachabilityRunOutcome {
                uncertain_pinhole: (latest_possible_deadline > Instant::now()).then(|| {
                    UncertainPinholeLease {
                        internal_endpoint,
                        expires_at: latest_possible_deadline,
                        detail: "IPv6 UPnP pinhole cleanup suppressed by application network prerequisite"
                            .to_owned(),
                    }
                }),
                error: run_error,
                ..ReachabilityRunOutcome::default()
            };
        }

        let _ = publish_pinhole(
            &mut state,
            &views,
            settings_generation,
            Ipv6PinholeEvent::Stopping,
        );
        if endpoint_selector.ipv6_pinhole_lost(state.generation()) {
            let _ = publish_selected_endpoint(&endpoint_selector, &views);
        }
        let delete = tokio::time::timeout(
            DELETE_TIMEOUT,
            firewall.delete_pinhole(&pinhole, &cleanup_cancellation),
        )
        .await;
        counters.pinholes.store(0, Ordering::Release);
        let uncertain_pinhole = match delete {
            Ok(Ok(())) => {
                evidence.record_deleted(&firewall, &pinhole);
                None
            }
            Ok(Err(error)) if error.fault_code() == Some(704) => {
                evidence.record_deleted(&firewall, &pinhole);
                None
            }
            Ok(Err(_)) | Err(_) if cleanup_cancellation.is_cancelled() => {
                (latest_possible_deadline > Instant::now()).then(|| UncertainPinholeLease {
                    internal_endpoint,
                    expires_at: latest_possible_deadline,
                    detail: CLEANUP_CUT_SHORT.to_owned(),
                })
            }
            Ok(Err(error)) => {
                record_pinhole_failure_diagnostic(&views, &error);
                (latest_possible_deadline > Instant::now()).then(|| UncertainPinholeLease {
                    internal_endpoint,
                    expires_at: latest_possible_deadline,
                    detail: format!("delete IPv6 UPnP pinhole: {}", error.detail()),
                })
            }
            Err(_) => (latest_possible_deadline > Instant::now()).then(|| UncertainPinholeLease {
                internal_endpoint,
                expires_at: latest_possible_deadline,
                detail: "delete IPv6 UPnP pinhole: cleanup deadline elapsed".to_owned(),
            }),
        };
        return ReachabilityRunOutcome {
            uncertain_pinhole,
            error: run_error,
            ..ReachabilityRunOutcome::default()
        };
    }
}

fn publish_mapped(
    kind: Ipv4MappingKind,
    state: &mut ReachabilityState,
    views: &ViewHub,
    endpoint_selector: &AdvertisedPeerEndpointSelector,
    mapping: &UpnpMapping,
    settings_generation: SettingsDomainGeneration,
) -> Result<(), String> {
    let current = publish_mapping_status(
        kind,
        state,
        views,
        settings_generation,
        ReachabilityEvent::Mapped {
            external_address: mapping.external_address,
            external_port: mapping.external_port,
            lease_seconds: mapping.lease_seconds,
        },
    )?;
    if !current {
        return Ok(());
    }
    let external_endpoint = SocketAddrV4::new(mapping.external_address, mapping.external_port);
    let lease = Duration::from_secs(u64::from(mapping.lease_seconds));
    match kind {
        Ipv4MappingKind::Tcp => endpoint_selector.mapping_verified(
            state.generation(),
            external_endpoint,
            lease,
            Instant::now(),
        ),
        Ipv4MappingKind::Udp => endpoint_selector.udp_mapping_verified(
            state.generation(),
            external_endpoint,
            lease,
            Instant::now(),
        ),
    };
    publish_selected_endpoint(endpoint_selector, views)
}

fn publish_failure(
    kind: Ipv4MappingKind,
    state: &mut ReachabilityState,
    views: &ViewHub,
    settings_generation: SettingsDomainGeneration,
    error: UpnpError,
) -> Result<(), String> {
    record_failure_diagnostic(kind, views, &error);
    publish_mapping_status(
        kind,
        state,
        views,
        settings_generation,
        ReachabilityEvent::Failed {
            stage: failure_stage(error.stage()),
            detail: error.detail().to_owned(),
        },
    )
    .map(|_| ())
}

fn publish_pinholed(
    state: &mut Ipv6PinholeState,
    views: &ViewHub,
    endpoint_selector: &AdvertisedPeerEndpointSelector,
    pinhole: &UpnpPinhole,
    settings_generation: SettingsDomainGeneration,
) -> Result<(), String> {
    let current = publish_pinhole(
        state,
        views,
        settings_generation,
        Ipv6PinholeEvent::Pinholed {
            lease_seconds: pinhole.lease_seconds,
        },
    )?;
    if current && endpoint_selector.ipv6_pinhole_verified(state.generation()) {
        publish_selected_endpoint(endpoint_selector, views)?;
    }
    Ok(())
}

fn publish_pinhole_failure(
    state: &mut Ipv6PinholeState,
    views: &ViewHub,
    settings_generation: SettingsDomainGeneration,
    error: UpnpError,
) -> Result<(), String> {
    record_pinhole_failure_diagnostic(views, &error);
    publish_pinhole(
        state,
        views,
        settings_generation,
        Ipv6PinholeEvent::Failed {
            stage: pinhole_failure_stage(error.stage()),
            detail: error.detail().to_owned(),
        },
    )
    .map(|_| ())
}

fn publish_pinhole(
    state: &mut Ipv6PinholeState,
    views: &ViewHub,
    settings_generation: SettingsDomainGeneration,
    event: Ipv6PinholeEvent,
) -> Result<bool, String> {
    if state.apply(state.generation(), event) {
        return views
            .set_ipv6_pinhole_status_for(settings_generation, state.status().clone())
            .map_err(|error| error.to_string());
    }
    Ok(true)
}

fn publish_mapping_status(
    kind: Ipv4MappingKind,
    state: &mut ReachabilityState,
    views: &ViewHub,
    settings_generation: SettingsDomainGeneration,
    event: ReachabilityEvent,
) -> Result<bool, String> {
    if state.apply(state.generation(), event) {
        return match kind {
            Ipv4MappingKind::Tcp => {
                views.set_port_mapping_status_for(settings_generation, state.status().clone())
            }
            Ipv4MappingKind::Udp => {
                views.set_udp_port_mapping_status_for(settings_generation, state.status().clone())
            }
        }
        .map_err(|error| error.to_string());
    }
    Ok(true)
}

fn publish_selected_endpoint(
    endpoint_selector: &AdvertisedPeerEndpointSelector,
    views: &ViewHub,
) -> Result<(), String> {
    views
        .set_advertised_peer_endpoint(endpoint_selector.status(Instant::now()))
        .map_err(|error| error.to_string())
}

fn record_failure_diagnostic(kind: Ipv4MappingKind, views: &ViewHub, error: &UpnpError) {
    let stage = failure_stage_name(error.stage());
    let transport = kind.transport().as_str();
    let _ = views.record_diagnostic(
        DiagnosticSeverity::Warning,
        category::DISCOVERY_REACHABILITY,
        "upnp_mapping_failed",
        None,
        "Automatic incoming port mapping failed; the local listener remains available",
        &[
            ("transport", transport),
            ("stage", stage),
            ("detail", error.detail()),
        ],
    );
}

fn record_pinhole_failure_diagnostic(views: &ViewHub, error: &UpnpError) {
    let stage = failure_stage_name(error.stage());
    let _ = views.record_diagnostic(
        DiagnosticSeverity::Warning,
        category::DISCOVERY_REACHABILITY,
        "upnp_ipv6_pinhole_failed",
        None,
        "Automatic IPv6 firewall pinhole control failed; the IPv6 listener remains available",
        &[("stage", stage), ("detail", error.detail())],
    );
}

fn failure_stage(stage: UpnpStage) -> PortMappingFailureStage {
    match stage {
        UpnpStage::Discovery => PortMappingFailureStage::Discovery,
        UpnpStage::Description => PortMappingFailureStage::Description,
        UpnpStage::ExternalAddress => PortMappingFailureStage::ExternalAddress,
        UpnpStage::Add => PortMappingFailureStage::Add,
        UpnpStage::Verify => PortMappingFailureStage::Verify,
        UpnpStage::Renewal => PortMappingFailureStage::Renewal,
        UpnpStage::Delete => PortMappingFailureStage::Delete,
        UpnpStage::FirewallStatus => PortMappingFailureStage::Description,
        UpnpStage::PinholeAdd | UpnpStage::PinholeVerify => PortMappingFailureStage::Add,
        UpnpStage::PinholeRenewal => PortMappingFailureStage::Renewal,
        UpnpStage::PinholeDelete | UpnpStage::PinholePackets => PortMappingFailureStage::Delete,
    }
}

fn pinhole_failure_stage(stage: UpnpStage) -> Ipv6PinholeFailureStage {
    match stage {
        UpnpStage::Discovery => Ipv6PinholeFailureStage::Discovery,
        UpnpStage::Description => Ipv6PinholeFailureStage::Description,
        UpnpStage::FirewallStatus => Ipv6PinholeFailureStage::FirewallStatus,
        UpnpStage::PinholeRenewal | UpnpStage::Renewal => Ipv6PinholeFailureStage::Renewal,
        UpnpStage::PinholeDelete | UpnpStage::Delete | UpnpStage::PinholePackets => {
            Ipv6PinholeFailureStage::Delete
        }
        UpnpStage::PinholeAdd
        | UpnpStage::PinholeVerify
        | UpnpStage::ExternalAddress
        | UpnpStage::Add
        | UpnpStage::Verify => Ipv6PinholeFailureStage::Add,
    }
}

fn failure_stage_name(stage: UpnpStage) -> &'static str {
    match stage {
        UpnpStage::Discovery => "discovery",
        UpnpStage::Description => "description",
        UpnpStage::ExternalAddress => "external_address",
        UpnpStage::Add => "add",
        UpnpStage::Verify => "verify",
        UpnpStage::Renewal => "renewal",
        UpnpStage::Delete => "delete",
        UpnpStage::FirewallStatus => "firewall_status",
        UpnpStage::PinholeAdd => "pinhole_add",
        UpnpStage::PinholeVerify => "pinhole_verify",
        UpnpStage::PinholeRenewal => "pinhole_renewal",
        UpnpStage::PinholeDelete => "pinhole_delete",
        UpnpStage::PinholePackets => "pinhole_packets",
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum Ipv6PinholeEvent {
    Discovering,
    ServiceUnavailable,
    ActionUnavailable {
        detail: String,
    },
    InboundPinholeDisallowed,
    Unfiltered,
    Creating,
    Pinholed {
        lease_seconds: u32,
    },
    Failed {
        stage: Ipv6PinholeFailureStage,
        detail: String,
    },
    RenewalFailed {
        detail: String,
    },
    CleanupFailed {
        remaining_lease_seconds: u32,
        detail: String,
    },
    Stopping,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Ipv6PinholeState {
    generation: u64,
    internal_endpoint: Option<SocketAddrV6>,
    status: Ipv6PinholeStatus,
    stopping: bool,
}

impl Ipv6PinholeState {
    pub(crate) fn new(
        generation: u64,
        settings: &ClientSettings,
        ipv6_listener: Option<SocketAddrV6>,
    ) -> Self {
        let internal_endpoint = eligible_pinhole_endpoint(settings, ipv6_listener);
        let status = if settings.port_mapping == PortMappingPolicy::Disabled {
            Ipv6PinholeStatus::Disabled
        } else if !settings.ipv6_enabled || internal_endpoint.is_none() {
            Ipv6PinholeStatus::Ineligible
        } else {
            Ipv6PinholeStatus::Discovering
        };
        Self {
            generation,
            internal_endpoint,
            status,
            stopping: false,
        }
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn internal_endpoint(&self) -> Option<SocketAddrV6> {
        self.internal_endpoint
    }

    pub(crate) fn status(&self) -> &Ipv6PinholeStatus {
        &self.status
    }

    fn block(&mut self) {
        self.internal_endpoint = None;
        self.status = Ipv6PinholeStatus::Ineligible;
    }

    pub(crate) fn apply(&mut self, generation: u64, event: Ipv6PinholeEvent) -> bool {
        if generation != self.generation || self.stopping {
            return false;
        }
        let Some(internal_endpoint) = self.internal_endpoint else {
            return false;
        };
        let address = internal_endpoint.ip().to_string();
        let port = internal_endpoint.port();
        let next = match event {
            Ipv6PinholeEvent::Discovering => Ipv6PinholeStatus::Discovering,
            Ipv6PinholeEvent::ServiceUnavailable
                if matches!(self.status, Ipv6PinholeStatus::Discovering) =>
            {
                Ipv6PinholeStatus::ServiceUnavailable
            }
            Ipv6PinholeEvent::ActionUnavailable { detail }
                if matches!(self.status, Ipv6PinholeStatus::Discovering) =>
            {
                Ipv6PinholeStatus::ActionUnavailable { detail }
            }
            Ipv6PinholeEvent::InboundPinholeDisallowed
                if matches!(self.status, Ipv6PinholeStatus::Discovering) =>
            {
                Ipv6PinholeStatus::InboundPinholeDisallowed
            }
            Ipv6PinholeEvent::Unfiltered
                if matches!(self.status, Ipv6PinholeStatus::Discovering) =>
            {
                Ipv6PinholeStatus::Unfiltered {
                    internal_address: address,
                    internal_port: port,
                }
            }
            Ipv6PinholeEvent::Creating
                if matches!(
                    self.status,
                    Ipv6PinholeStatus::Discovering
                        | Ipv6PinholeStatus::RenewalFailed { .. }
                        | Ipv6PinholeStatus::CleanupFailed { .. }
                        | Ipv6PinholeStatus::Failed { .. }
                ) =>
            {
                Ipv6PinholeStatus::Creating {
                    internal_address: address,
                    internal_port: port,
                }
            }
            Ipv6PinholeEvent::Pinholed { lease_seconds }
                if matches!(
                    self.status,
                    Ipv6PinholeStatus::Creating { .. }
                        | Ipv6PinholeStatus::Pinholed { .. }
                        | Ipv6PinholeStatus::RenewalFailed { .. }
                ) =>
            {
                Ipv6PinholeStatus::Pinholed {
                    internal_address: address,
                    internal_port: port,
                    lease_seconds,
                }
            }
            Ipv6PinholeEvent::Failed { stage, detail } => {
                Ipv6PinholeStatus::Failed { stage, detail }
            }
            Ipv6PinholeEvent::RenewalFailed { detail }
                if matches!(
                    self.status,
                    Ipv6PinholeStatus::Pinholed { .. } | Ipv6PinholeStatus::RenewalFailed { .. }
                ) =>
            {
                Ipv6PinholeStatus::RenewalFailed {
                    internal_address: address,
                    internal_port: port,
                    detail,
                }
            }
            Ipv6PinholeEvent::CleanupFailed {
                remaining_lease_seconds,
                detail,
            } => Ipv6PinholeStatus::CleanupFailed {
                internal_address: address,
                internal_port: port,
                remaining_lease_seconds,
                detail,
            },
            Ipv6PinholeEvent::Stopping => {
                self.stopping = true;
                Ipv6PinholeStatus::Stopping
            }
            _ => return false,
        };
        if self.status == next {
            return false;
        }
        self.status = next;
        true
    }
}

fn eligible_pinhole_endpoint(
    settings: &ClientSettings,
    ipv6_listener: Option<SocketAddrV6>,
) -> Option<SocketAddrV6> {
    if settings.port_mapping != PortMappingPolicy::Upnp || !settings.ipv6_enabled {
        return None;
    }
    let endpoint = ipv6_listener?;
    (endpoint.port() >= 1_024 && eligible_global_ipv6(*endpoint.ip())).then_some(endpoint)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReachabilityState {
    generation: u64,
    local_endpoint: Option<SocketAddrV4>,
    status: PortMappingStatus,
    stopping: bool,
}

impl ReachabilityState {
    pub(crate) fn new(
        generation: u64,
        settings: &ClientSettings,
        listener_status: &ListenerStatus,
    ) -> Self {
        let local_endpoint = eligible_local_endpoint(settings, listener_status);
        let status = if settings.port_mapping == PortMappingPolicy::Disabled {
            PortMappingStatus::Disabled
        } else if local_endpoint.is_some() {
            PortMappingStatus::Discovering
        } else {
            PortMappingStatus::Ineligible
        };
        Self {
            generation,
            local_endpoint,
            status,
            stopping: false,
        }
    }

    pub(crate) fn new_udp(
        generation: u64,
        settings: &ClientSettings,
        listener: Option<SocketAddrV4>,
    ) -> Self {
        let local_endpoint = eligible_udp_endpoint(settings, listener);
        let status = if settings.port_mapping == PortMappingPolicy::Disabled {
            PortMappingStatus::Disabled
        } else if local_endpoint.is_some() {
            PortMappingStatus::Discovering
        } else {
            PortMappingStatus::Ineligible
        };
        Self {
            generation,
            local_endpoint,
            status,
            stopping: false,
        }
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn local_endpoint(&self) -> Option<SocketAddrV4> {
        self.local_endpoint
    }

    pub(crate) fn status(&self) -> &PortMappingStatus {
        &self.status
    }

    fn block(&mut self) {
        self.local_endpoint = None;
        self.status = PortMappingStatus::Ineligible;
    }

    pub(crate) fn apply(&mut self, generation: u64, event: ReachabilityEvent) -> bool {
        if generation != self.generation || self.stopping {
            return false;
        }
        let Some(local_endpoint) = self.local_endpoint else {
            return false;
        };
        let next = match event {
            ReachabilityEvent::Discovering => PortMappingStatus::Discovering,
            ReachabilityEvent::Mapping if matches!(self.status, PortMappingStatus::Discovering) => {
                PortMappingStatus::Mapping
            }
            ReachabilityEvent::Mapped {
                external_address,
                external_port,
                lease_seconds,
            } if matches!(
                self.status,
                PortMappingStatus::Mapping
                    | PortMappingStatus::Mapped { .. }
                    | PortMappingStatus::RenewalFailed { .. }
            ) =>
            {
                PortMappingStatus::Mapped {
                    mechanism: PortMappingMechanism::UpnpIgdV2,
                    local_address: local_endpoint.ip().to_string(),
                    local_port: local_endpoint.port(),
                    external_address: external_address.to_string(),
                    external_port,
                    lease_seconds,
                }
            }
            ReachabilityEvent::Failed { stage, detail } => {
                PortMappingStatus::Failed { stage, detail }
            }
            ReachabilityEvent::RenewalFailed {
                external_address,
                external_port,
                detail,
            } if matches!(self.status, PortMappingStatus::Mapped { .. }) => {
                PortMappingStatus::RenewalFailed {
                    external_address: external_address.to_string(),
                    external_port,
                    detail,
                }
            }
            ReachabilityEvent::Stopping => {
                self.stopping = true;
                PortMappingStatus::Stopping
            }
            _ => return false,
        };
        if self.status == next {
            return false;
        }
        self.status = next;
        true
    }
}

fn eligible_local_endpoint(
    settings: &ClientSettings,
    listener_status: &ListenerStatus,
) -> Option<SocketAddrV4> {
    if settings.port_mapping != PortMappingPolicy::Upnp
        || !matches!(
            settings.listener,
            ListenerPolicy::AutomaticLocalNetwork | ListenerPolicy::FixedLocalNetwork { .. }
        )
    {
        return None;
    }
    let ListenerStatus::Listening { address, port } = listener_status else {
        return None;
    };
    let address = address.parse::<Ipv4Addr>().ok()?;
    if *port == 0
        || address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        || address == Ipv4Addr::BROADCAST
    {
        return None;
    }
    Some(SocketAddrV4::new(address, *port))
}

fn eligible_udp_endpoint(
    settings: &ClientSettings,
    endpoint: Option<SocketAddrV4>,
) -> Option<SocketAddrV4> {
    if settings.port_mapping != PortMappingPolicy::Upnp
        || !matches!(
            settings.listener,
            ListenerPolicy::AutomaticLocalNetwork | ListenerPolicy::FixedLocalNetwork { .. }
        )
    {
        return None;
    }
    let endpoint = endpoint?;
    let address = *endpoint.ip();
    if endpoint.port() < 1_024
        || address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        || address == Ipv4Addr::BROADCAST
    {
        return None;
    }
    Some(endpoint)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{SocketAddr, SocketAddrV4};
    use std::sync::{Arc, Mutex};

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream, UdpSocket};

    use crate::advertised_endpoint::AdvertisedPeerEndpointState;
    use crate::control::ServiceSnapshot;
    use crate::settings::{SettingsConvergenceModel, SettingsDomain};

    fn eligible_settings() -> ClientSettings {
        ClientSettings {
            listener: ListenerPolicy::AutomaticLocalNetwork,
            port_mapping: PortMappingPolicy::Upnp,
            ..ClientSettings::default()
        }
    }

    fn listening() -> ListenerStatus {
        ListenerStatus::Listening {
            address: "192.168.50.12".to_owned(),
            port: 41_234,
        }
    }

    fn eligible_ipv6_settings() -> ClientSettings {
        ClientSettings {
            ipv6_enabled: true,
            ..eligible_settings()
        }
    }

    fn ipv6_listener() -> SocketAddrV6 {
        "[2001:4860:4860::8888]:42006".parse().unwrap()
    }

    #[test]
    fn policy_and_observed_listener_jointly_determine_eligibility() {
        let disabled = ReachabilityState::new(1, &ClientSettings::default(), &listening());
        assert_eq!(disabled.status(), &PortMappingStatus::Disabled);

        let loopback = ClientSettings {
            listener: ListenerPolicy::AutomaticLoopback,
            port_mapping: PortMappingPolicy::Upnp,
            ..ClientSettings::default()
        };
        assert_eq!(
            ReachabilityState::new(2, &loopback, &listening()).status(),
            &PortMappingStatus::Ineligible
        );
        assert_eq!(
            ReachabilityState::new(
                3,
                &eligible_settings(),
                &ListenerStatus::Listening {
                    address: "127.0.0.1".to_owned(),
                    port: 41_234,
                },
            )
            .status(),
            &PortMappingStatus::Ineligible
        );
        let udp = SocketAddrV4::new(Ipv4Addr::new(192, 168, 50, 12), 41_235);
        assert_eq!(
            ReachabilityState::new_udp(4, &eligible_settings(), Some(udp)).local_endpoint(),
            Some(udp),
        );
        assert_eq!(
            ReachabilityState::new_udp(
                5,
                &eligible_settings(),
                Some(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 41_235)),
            )
            .status(),
            &PortMappingStatus::Ineligible,
        );
        assert_eq!(
            ReachabilityState::new_udp(
                6,
                &eligible_settings(),
                Some(SocketAddrV4::new(Ipv4Addr::new(192, 168, 50, 12), 1_023)),
            )
            .status(),
            &PortMappingStatus::Ineligible,
        );

        let eligible = ReachabilityState::new(4, &eligible_settings(), &listening());
        assert_eq!(eligible.status(), &PortMappingStatus::Discovering);
        assert_eq!(
            eligible.local_endpoint(),
            Some(SocketAddrV4::new(Ipv4Addr::new(192, 168, 50, 12), 41_234))
        );
    }

    #[test]
    fn transitions_are_ordered_and_stale_generations_are_fenced() {
        let mut state = ReachabilityState::new(7, &eligible_settings(), &listening());
        assert!(!state.apply(6, ReachabilityEvent::Mapping));
        assert!(!state.apply(
            7,
            ReachabilityEvent::Mapped {
                external_address: Ipv4Addr::new(203, 0, 113, 10),
                external_port: 48_001,
                lease_seconds: 3_600,
            },
        ));
        assert!(state.apply(7, ReachabilityEvent::Mapping));
        assert!(state.apply(
            7,
            ReachabilityEvent::Mapped {
                external_address: Ipv4Addr::new(203, 0, 113, 10),
                external_port: 48_001,
                lease_seconds: 3_600,
            },
        ));
        assert!(state.apply(
            7,
            ReachabilityEvent::RenewalFailed {
                external_address: Ipv4Addr::new(203, 0, 113, 10),
                external_port: 48_001,
                detail: "gateway did not answer".to_owned(),
            },
        ));
        assert!(state.apply(
            7,
            ReachabilityEvent::Mapped {
                external_address: Ipv4Addr::new(203, 0, 113, 10),
                external_port: 48_001,
                lease_seconds: 3_600,
            },
        ));
        assert!(state.apply(7, ReachabilityEvent::Stopping));
        assert!(!state.apply(7, ReachabilityEvent::Discovering));
        assert_eq!(state.status(), &PortMappingStatus::Stopping);
        assert_eq!(state.generation(), 7);
    }

    #[test]
    fn ipv6_pinhole_eligibility_and_preconditions_are_distinct() {
        let disabled = Ipv6PinholeState::new(1, &ClientSettings::default(), Some(ipv6_listener()));
        assert_eq!(disabled.status(), &Ipv6PinholeStatus::Disabled);
        let ipv6_disabled_settings = ClientSettings {
            ipv6_enabled: false,
            ..eligible_settings()
        };
        let ipv6_disabled =
            Ipv6PinholeState::new(2, &ipv6_disabled_settings, Some(ipv6_listener()));
        assert_eq!(ipv6_disabled.status(), &Ipv6PinholeStatus::Ineligible);
        let documentation = "[2001:db8::1]:42006".parse().unwrap();
        let ineligible = Ipv6PinholeState::new(3, &eligible_ipv6_settings(), Some(documentation));
        assert_eq!(ineligible.status(), &Ipv6PinholeStatus::Ineligible);

        let mut unfiltered =
            Ipv6PinholeState::new(4, &eligible_ipv6_settings(), Some(ipv6_listener()));
        assert!(unfiltered.apply(4, Ipv6PinholeEvent::Unfiltered));
        assert!(matches!(
            unfiltered.status(),
            Ipv6PinholeStatus::Unfiltered {
                internal_port: 42_006,
                ..
            }
        ));

        let mut disallowed =
            Ipv6PinholeState::new(5, &eligible_ipv6_settings(), Some(ipv6_listener()));
        assert!(disallowed.apply(5, Ipv6PinholeEvent::InboundPinholeDisallowed));
        assert_eq!(
            disallowed.status(),
            &Ipv6PinholeStatus::InboundPinholeDisallowed
        );
    }

    #[test]
    fn ipv6_pinhole_transitions_are_ordered_and_stale_results_are_fenced() {
        let endpoint = ipv6_listener();
        let mut state = Ipv6PinholeState::new(7, &eligible_ipv6_settings(), Some(endpoint));
        assert!(!state.apply(6, Ipv6PinholeEvent::Creating));
        assert!(!state.apply(
            7,
            Ipv6PinholeEvent::Pinholed {
                lease_seconds: 3_600,
            },
        ));
        assert!(state.apply(7, Ipv6PinholeEvent::Creating));
        assert!(state.apply(
            7,
            Ipv6PinholeEvent::Pinholed {
                lease_seconds: 3_600,
            },
        ));
        assert!(state.apply(
            7,
            Ipv6PinholeEvent::RenewalFailed {
                detail: "gateway did not answer".to_owned(),
            },
        ));
        assert!(state.apply(
            7,
            Ipv6PinholeEvent::Pinholed {
                lease_seconds: 3_600,
            },
        ));
        assert!(state.apply(7, Ipv6PinholeEvent::Stopping));
        assert!(!state.apply(7, Ipv6PinholeEvent::Creating));
        assert_eq!(state.status(), &Ipv6PinholeStatus::Stopping);
    }

    #[test]
    fn uncertain_pinhole_blocks_until_its_finite_lease_expires() {
        let now = Instant::now();
        let pinhole = UncertainPinholeLease {
            internal_endpoint: ipv6_listener(),
            expires_at: now + Duration::from_millis(1_500),
            detail: "both create responses were ambiguous".to_owned(),
        };
        assert_eq!(pinhole.remaining_lease_seconds(now), 2);
        assert_eq!(
            pinhole.remaining_lease_seconds(now + Duration::from_millis(1_499)),
            1,
        );
        assert_eq!(
            pinhole.remaining_lease_seconds(now + Duration::from_millis(1_500)),
            0,
        );
    }

    #[test]
    fn uncertain_mapping_blocks_until_its_finite_lease_expires() {
        let now = Instant::now();
        let mapping = UncertainMappingLease {
            transport: UpnpTransport::Tcp,
            external_address: Ipv4Addr::new(203, 0, 113, 10),
            external_port: 48_001,
            expires_at: now + Duration::from_millis(1_500),
            detail: "delete verification failed".to_owned(),
        };
        assert_eq!(mapping.remaining_lease_seconds(now), 2);
        assert_eq!(
            mapping.remaining_lease_seconds(now + Duration::from_millis(1_499)),
            1,
        );
        assert_eq!(
            mapping.remaining_lease_seconds(now + Duration::from_millis(1_500)),
            0,
        );
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum ScriptedDualBehavior {
        BothAvailable,
        PinholeDisallowed,
        MappingUnavailable,
        UdpMappingUnavailable,
    }

    async fn exercise_scripted_dual_generation(
        behavior: ScriptedDualBehavior,
    ) -> (
        usize,
        usize,
        PortMappingStatus,
        PortMappingStatus,
        Ipv6PinholeStatus,
        Vec<String>,
    ) {
        let (config, transcript, udp_task, http_task) = scripted_dual_gateway(behavior).await;
        let listener = ListenerStatus::Listening {
            address: Ipv4Addr::LOCALHOST.to_string(),
            port: 42_000,
        };
        let selector = AdvertisedPeerEndpointSelector::new(&listener);
        let udp_endpoint = SocketAddrV4::new(Ipv4Addr::LOCALHOST, 42_001);
        selector.replace_udp_listener(Some(udp_endpoint));
        let ipv6 = ipv6_listener();
        selector.replace_ipv6_listener(Some(ipv6));
        let reachability_generation = selector.begin_mapping_generation();
        let mapping_state = ReachabilityState {
            generation: reachability_generation,
            local_endpoint: Some(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 42_000)),
            status: PortMappingStatus::Discovering,
            stopping: false,
        };
        let udp_mapping_state = ReachabilityState {
            generation: reachability_generation,
            local_endpoint: Some(udp_endpoint),
            status: PortMappingStatus::Discovering,
            stopping: false,
        };
        let pinhole_state = Ipv6PinholeState {
            generation: reachability_generation,
            internal_endpoint: Some(ipv6),
            status: Ipv6PinholeStatus::Discovering,
            stopping: false,
        };
        let mut convergence = SettingsConvergenceModel::default();
        let attempt = convergence
            .begin(eligible_ipv6_settings())
            .expect("settings attempt");
        let settings_generation = attempt.domain(SettingsDomain::PortMapping);
        let views = ViewHub::new(&ServiceSnapshot {
            profile_id: "scripted-dual-reachability".to_owned(),
            revision: "0".to_owned(),
            storage: Default::default(),
            client_settings: eligible_ipv6_settings(),
            torrents: Vec::new(),
        })
        .expect("scripted reachability views");
        views
            .set_client_settings_mapping_generation(settings_generation)
            .expect("install mapping generation");
        let cancellation = CancellationToken::new();
        let counters = Arc::new(ReachabilityCounters::default());
        let evidence = ReachabilityEvidenceProbe::default();
        let task = tokio::spawn(run_reachability(
            mapping_state,
            udp_mapping_state,
            pinhole_state,
            Some(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 42_000)),
            ReachabilityTaskContext {
                views: views.clone(),
                endpoint_selector: selector.clone(),
                cancellation: cancellation.clone(),
                counters: counters.clone(),
                settings_generation,
                discovery_config: Some(config),
                evidence: evidence.clone(),
                cleanup_permitted: Arc::new(AtomicBool::new(true)),
                network_cancellation: None,
                cleanup_cancellation: CancellationToken::new(),
            },
        ));
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let wire = *selector.subscribe_wire().borrow();
                let mapping_active = matches!(
                    selector.current(),
                    AdvertisedPeerEndpointState::Mapped { .. }
                );
                let udp_mapping_active = wire.dht_ipv4.scope
                    == Some(rstorrent_engine::PeerAdvertisementEndpointScope::Mapped);
                let pinhole_active = wire.ipv6.scope
                    == Some(rstorrent_engine::PeerAdvertisementEndpointScope::Pinholed);
                let runtime = views.client_settings_for_testing();
                let ready = match behavior {
                    ScriptedDualBehavior::BothAvailable => {
                        mapping_active && udp_mapping_active && pinhole_active
                    }
                    ScriptedDualBehavior::PinholeDisallowed => {
                        mapping_active
                            && udp_mapping_active
                            && runtime.ipv6_pinhole_status
                                == Ipv6PinholeStatus::InboundPinholeDisallowed
                    }
                    ScriptedDualBehavior::MappingUnavailable => {
                        pinhole_active
                            && matches!(
                                runtime.port_mapping_status,
                                PortMappingStatus::Failed { .. }
                            )
                            && matches!(
                                runtime.udp_port_mapping_status,
                                PortMappingStatus::Failed { .. }
                            )
                    }
                    ScriptedDualBehavior::UdpMappingUnavailable => {
                        mapping_active
                            && pinhole_active
                            && matches!(
                                runtime.udp_port_mapping_status,
                                PortMappingStatus::Failed { .. }
                            )
                    }
                };
                if ready {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("independent reachability slots reach their scripted states");
        let active_mappings = counters.mappings.load(Ordering::Acquire);
        let active_pinholes = counters.pinholes.load(Ordering::Acquire);
        let runtime = views.client_settings_for_testing();
        if active_pinholes == 1 {
            assert_eq!(
                evidence.pinhole_packets(false).await,
                Some(Ipv6PinholeDiagnosticResult::Packets(5)),
            );
        }

        cancellation.cancel();
        let outcome = task.await.expect("join combined reachability");
        assert_eq!(
            outcome,
            ReachabilityRunOutcome::default(),
            "scripted transcript: {:?}",
            transcript.lock().unwrap(),
        );
        assert_eq!(counters.mappings.load(Ordering::Acquire), 0);
        assert_eq!(counters.pinholes.load(Ordering::Acquire), 0);
        if active_pinholes == 1 {
            assert!(matches!(
                evidence.pinhole_packets(true).await,
                Some(Ipv6PinholeDiagnosticResult::Fault {
                    code: Some(704),
                    ..
                })
            ));
        }
        udp_task.await.expect("join scripted SSDP");
        http_task.await.expect("join scripted HTTP");
        let transcript = transcript.lock().unwrap().clone();
        assert_eq!(
            transcript
                .iter()
                .filter(|entry| entry.as_str() == "M-SEARCH")
                .count(),
            1,
        );
        (
            active_mappings,
            active_pinholes,
            runtime.port_mapping_status,
            runtime.udp_port_mapping_status,
            runtime.ipv6_pinhole_status,
            transcript,
        )
    }

    #[tokio::test]
    async fn one_generation_owns_mapping_and_pinhole_with_joined_cleanup() {
        let (mappings, pinholes, mapping_status, udp_mapping_status, pinhole_status, transcript) =
            exercise_scripted_dual_generation(ScriptedDualBehavior::BothAvailable).await;
        assert_eq!((mappings, pinholes), (2, 1));
        assert!(matches!(mapping_status, PortMappingStatus::Mapped { .. }));
        assert!(matches!(
            udp_mapping_status,
            PortMappingStatus::Mapped { .. }
        ));
        assert!(matches!(pinhole_status, Ipv6PinholeStatus::Pinholed { .. }));
        for expected in [
            "AddPortMapping",
            "AddPinhole",
            "DeletePortMapping",
            "DeletePinhole",
        ] {
            assert_eq!(
                transcript
                    .iter()
                    .filter(|entry| entry.as_str() == expected)
                    .count(),
                if expected == "AddPortMapping" || expected == "DeletePortMapping" {
                    2
                } else {
                    1
                },
                "unexpected {expected} count in {transcript:?}",
            );
        }
    }

    #[tokio::test]
    async fn mapping_and_pinhole_fail_independently() {
        let (mappings, pinholes, mapping_status, udp_mapping_status, pinhole_status, transcript) =
            exercise_scripted_dual_generation(ScriptedDualBehavior::PinholeDisallowed).await;
        assert_eq!((mappings, pinholes), (2, 0));
        assert!(matches!(mapping_status, PortMappingStatus::Mapped { .. }));
        assert!(matches!(
            udp_mapping_status,
            PortMappingStatus::Mapped { .. }
        ));
        assert_eq!(pinhole_status, Ipv6PinholeStatus::InboundPinholeDisallowed);
        assert!(transcript.iter().any(|entry| entry == "AddPortMapping"));
        assert!(!transcript.iter().any(|entry| entry == "AddPinhole"));

        let (mappings, pinholes, mapping_status, udp_mapping_status, pinhole_status, transcript) =
            exercise_scripted_dual_generation(ScriptedDualBehavior::MappingUnavailable).await;
        assert_eq!((mappings, pinholes), (0, 1));
        assert!(matches!(mapping_status, PortMappingStatus::Failed { .. }));
        assert!(matches!(
            udp_mapping_status,
            PortMappingStatus::Failed { .. }
        ));
        assert!(matches!(pinhole_status, Ipv6PinholeStatus::Pinholed { .. }));
        assert!(!transcript.iter().any(|entry| entry == "AddPortMapping"));
        assert!(transcript.iter().any(|entry| entry == "AddPinhole"));

        let (mappings, pinholes, mapping_status, udp_mapping_status, pinhole_status, transcript) =
            exercise_scripted_dual_generation(ScriptedDualBehavior::UdpMappingUnavailable).await;
        assert_eq!((mappings, pinholes), (1, 1));
        assert!(matches!(mapping_status, PortMappingStatus::Mapped { .. }));
        assert!(matches!(
            udp_mapping_status,
            PortMappingStatus::Failed { .. }
        ));
        assert!(matches!(pinhole_status, Ipv6PinholeStatus::Pinholed { .. }));
        assert_eq!(
            transcript
                .iter()
                .filter(|entry| entry.as_str() == "AddPortMapping")
                .count(),
            2,
        );
        assert_eq!(
            transcript
                .iter()
                .filter(|entry| entry.as_str() == "DeletePortMapping")
                .count(),
            1,
        );
    }

    #[tokio::test]
    async fn scripted_delete_failure_reports_one_finite_uncertain_lease() {
        let (outcome, transcript) =
            map_then_stop_against_scripted_gateway(ScriptedDelete::Fail, None).await;
        let uncertain = outcome
            .uncertain_tcp_mapping
            .expect("failed delete retains uncertain lease");
        assert_eq!(uncertain.transport, UpnpTransport::Tcp);
        assert_eq!(uncertain.external_address, Ipv4Addr::new(203, 0, 113, 10));
        assert_eq!(uncertain.external_port, 42_000);
        assert!(uncertain.remaining_lease_seconds(Instant::now()) <= 1);
        assert!(uncertain.detail.contains("delete UPnP mapping"));
        assert_eq!(
            transcript,
            [
                "GET /root.xml",
                "GET /wan.xml",
                "GetExternalIPAddress",
                "GetSpecificPortMappingEntry",
                "AddPortMapping",
                "GetSpecificPortMappingEntry",
                "DeletePortMapping",
            ]
        );
    }

    #[tokio::test]
    async fn cleanup_cancellation_cuts_a_stalled_delete_short() {
        let started = Instant::now();
        let (outcome, transcript) = map_then_stop_against_scripted_gateway(
            ScriptedDelete::Stall,
            Some(Duration::from_millis(200)),
        )
        .await;
        let uncertain = outcome
            .uncertain_tcp_mapping
            .expect("cut-short delete retains uncertain lease");
        assert_eq!(uncertain.detail, CLEANUP_CUT_SHORT);
        assert_eq!(uncertain.external_port, 42_000);
        assert!(outcome.error.is_none(), "{:?}", outcome.error);
        assert_eq!(
            transcript.last().map(String::as_str),
            Some("DeletePortMapping")
        );
        assert!(
            started.elapsed() < DELETE_TIMEOUT,
            "cleanup cancellation must end the delete before its own timeout"
        );
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum ScriptedDelete {
        Fail,
        Stall,
    }

    /// Maps one TCP port through a scripted gateway, stops the generation,
    /// and cancels the cleanup token `cut_short_after` the stop when given.
    /// Returns the run outcome and the gateway transcript.
    async fn map_then_stop_against_scripted_gateway(
        delete: ScriptedDelete,
        cut_short_after: Option<Duration>,
    ) -> (ReachabilityRunOutcome, Vec<String>) {
        let (config, transcript, udp_task, http_task) =
            scripted_delete_failure_gateway(delete).await;
        let listener = ListenerStatus::Listening {
            address: Ipv4Addr::LOCALHOST.to_string(),
            port: 42_000,
        };
        let selector = AdvertisedPeerEndpointSelector::new(&listener);
        let mapping_generation = selector.begin_mapping_generation();
        let state = ReachabilityState {
            generation: mapping_generation,
            local_endpoint: Some(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 42_000)),
            status: PortMappingStatus::Discovering,
            stopping: false,
        };
        let mut convergence = SettingsConvergenceModel::default();
        let attempt = convergence
            .begin(eligible_settings())
            .expect("settings attempt");
        let settings_generation = attempt.domain(SettingsDomain::PortMapping);
        let views = ViewHub::new(&ServiceSnapshot {
            profile_id: "scripted-reachability".to_owned(),
            revision: "0".to_owned(),
            storage: Default::default(),
            client_settings: eligible_settings(),
            torrents: Vec::new(),
        })
        .expect("scripted reachability views");
        views
            .set_client_settings_mapping_generation(settings_generation)
            .expect("install mapping generation");
        let cancellation = CancellationToken::new();
        let cleanup_cancellation = CancellationToken::new();
        let counters = Arc::new(ReachabilityCounters::default());
        let mapping_task = tokio::spawn(run_mapping(
            state,
            SocketAddrV4::new(Ipv4Addr::LOCALHOST, 42_000),
            MappingTaskContext {
                views,
                endpoint_selector: selector.clone(),
                cancellation: cancellation.clone(),
                counters: counters.clone(),
                settings_generation,
                discovery_config: Some(config),
                cleanup_cancellation: cleanup_cancellation.clone(),
            },
        ));
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if matches!(
                    selector.current(),
                    AdvertisedPeerEndpointState::Mapped { .. }
                ) {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("scripted mapping reaches verified state");
        assert_eq!(counters.mappings.load(Ordering::Acquire), 1);

        cancellation.cancel();
        if let Some(delay) = cut_short_after {
            tokio::time::sleep(delay).await;
            cleanup_cancellation.cancel();
        }
        let outcome = mapping_task.await.expect("join scripted mapping");
        assert_eq!(counters.mappings.load(Ordering::Acquire), 0);
        udp_task.await.expect("join scripted SSDP");
        match delete {
            ScriptedDelete::Fail => http_task.await.expect("join scripted HTTP"),
            ScriptedDelete::Stall => http_task.abort(),
        }
        let transcript = transcript.lock().unwrap().clone();
        (outcome, transcript)
    }

    async fn scripted_dual_gateway(
        behavior: ScriptedDualBehavior,
    ) -> (
        UpnpDiscoveryConfig,
        Arc<Mutex<Vec<String>>>,
        tokio::task::JoinHandle<()>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let http_port = listener.local_addr().unwrap().port();
        let ssdp = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let SocketAddr::V4(ssdp_endpoint) = ssdp.local_addr().unwrap() else {
            unreachable!();
        };
        let transcript = Arc::new(Mutex::new(Vec::new()));
        let udp_transcript = transcript.clone();
        let http_transcript = transcript.clone();
        let response_count = match behavior {
            ScriptedDualBehavior::BothAvailable => 20,
            ScriptedDualBehavior::PinholeDisallowed => 16,
            ScriptedDualBehavior::MappingUnavailable => 8,
            ScriptedDualBehavior::UdpMappingUnavailable => 17,
        };
        let http_task = tokio::spawn(async move {
            let mut tcp_mapped = false;
            let mut udp_mapped = false;
            let mut pinhole_present = false;
            for _ in 0..response_count {
                let (mut stream, _) = listener.accept().await.unwrap();
                let request = read_http_request(&mut stream).await;
                let first_line = request.lines().next().unwrap_or_default();
                let (status, content_type, body, event) = if first_line
                    .starts_with("GET /root.xml ")
                {
                    (
                        "200 OK",
                        "text/xml",
                        dual_device_description(http_port),
                        "GET /root.xml",
                    )
                } else if first_line.starts_with("GET /wan.xml ") {
                    (
                        "200 OK",
                        "application/xml",
                        if behavior == ScriptedDualBehavior::MappingUnavailable {
                            mapping_unavailable_scpd_description()
                        } else {
                            scpd_description()
                        },
                        "GET /wan.xml",
                    )
                } else if first_line.starts_with("GET /firewall.xml ") {
                    (
                        "200 OK",
                        "application/xml",
                        firewall_scpd_description(),
                        "GET /firewall.xml",
                    )
                } else {
                    let action = soap_action(&request);
                    let (status, body) = match action {
                        "GetExternalIPAddress" => (
                            "200 OK",
                            soap_response(
                                action,
                                "<NewExternalIPAddress>203.0.113.10</NewExternalIPAddress>",
                            ),
                        ),
                        "GetSpecificPortMappingEntry"
                            if (request.contains("<NewProtocol>TCP</NewProtocol>")
                                && tcp_mapped)
                                || (request.contains("<NewProtocol>UDP</NewProtocol>")
                                    && udp_mapped) =>
                        {
                            let internal_port =
                                if request.contains("<NewProtocol>UDP</NewProtocol>") {
                                    42_001
                                } else {
                                    42_000
                                };
                            (
                                "200 OK",
                                soap_response(
                                    action,
                                    &format!(
                                        "<NewInternalPort>{internal_port}</NewInternalPort><NewInternalClient>127.0.0.1</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>JSTorrent</NewPortMappingDescription><NewLeaseDuration>3600</NewLeaseDuration>"
                                    ),
                                ),
                            )
                        }
                        "GetSpecificPortMappingEntry" => (
                            "500 Internal Server Error",
                            soap_fault(714, "NoSuchEntryInArray"),
                        ),
                        "AddPortMapping" => {
                            if request.contains("<NewProtocol>UDP</NewProtocol>") {
                                if behavior == ScriptedDualBehavior::UdpMappingUnavailable {
                                    ("500 Internal Server Error", soap_fault(501, "UdpDenied"))
                                } else {
                                    udp_mapped = true;
                                    ("200 OK", soap_response(action, ""))
                                }
                            } else {
                                assert!(request.contains("<NewProtocol>TCP</NewProtocol>"));
                                tcp_mapped = true;
                                ("200 OK", soap_response(action, ""))
                            }
                        }
                        "DeletePortMapping" => {
                            if request.contains("<NewProtocol>UDP</NewProtocol>") {
                                udp_mapped = false;
                            } else {
                                assert!(request.contains("<NewProtocol>TCP</NewProtocol>"));
                                tcp_mapped = false;
                            }
                            ("200 OK", soap_response(action, ""))
                        }
                        "GetFirewallStatus" => (
                            "200 OK",
                            firewall_soap_response(
                                action,
                                if behavior == ScriptedDualBehavior::PinholeDisallowed {
                                    "<FirewallEnabled>1</FirewallEnabled><InboundPinholeAllowed>0</InboundPinholeAllowed>"
                                } else {
                                    "<FirewallEnabled>1</FirewallEnabled><InboundPinholeAllowed>1</InboundPinholeAllowed>"
                                },
                            ),
                        ),
                        "AddPinhole" => {
                            assert!(request.contains("<RemoteHost></RemoteHost>"));
                            assert!(request.contains("<RemotePort>0</RemotePort>"));
                            assert!(request.contains("<Protocol>6</Protocol>"));
                            assert!(request.contains("<InternalPort>42006</InternalPort>"));
                            pinhole_present = true;
                            (
                                "200 OK",
                                firewall_soap_response(action, "<UniqueID>41</UniqueID>"),
                            )
                        }
                        "GetPinholePackets" if pinhole_present => (
                            "200 OK",
                            firewall_soap_response(action, "<PinholePackets>5</PinholePackets>"),
                        ),
                        "GetPinholePackets" => {
                            ("500 Internal Server Error", soap_fault(704, "NoSuchEntry"))
                        }
                        "DeletePinhole" => {
                            pinhole_present = false;
                            ("200 OK", firewall_soap_response(action, ""))
                        }
                        other => panic!("unexpected scripted dual action {other}"),
                    };
                    (status, "text/xml; charset=utf-8", body, action)
                };
                http_transcript.lock().unwrap().push(event.to_owned());
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
        });
        let udp_task = tokio::spawn(async move {
            let mut request = [0_u8; 1_024];
            let (length, peer) = ssdp.recv_from(&mut request).await.unwrap();
            let request = std::str::from_utf8(&request[..length]).unwrap();
            assert!(request.contains("ST: upnp:rootdevice\r\n"));
            udp_transcript.lock().unwrap().push("M-SEARCH".to_owned());
            let response = format!(
                "HTTP/1.1 200 OK\r\nLOCATION: http://127.0.0.1:{http_port}/root.xml\r\nUSN: uuid:scripted::upnp:rootdevice\r\n\r\n"
            );
            ssdp.send_to(response.as_bytes(), peer).await.unwrap();
        });
        (
            UpnpDiscoveryConfig::scripted_for_testing(Ipv4Addr::LOCALHOST, ssdp_endpoint),
            transcript,
            udp_task,
            http_task,
        )
    }

    async fn scripted_delete_failure_gateway(
        delete: ScriptedDelete,
    ) -> (
        UpnpDiscoveryConfig,
        Arc<Mutex<Vec<String>>>,
        tokio::task::JoinHandle<()>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let http_port = listener.local_addr().unwrap().port();
        let ssdp = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let SocketAddr::V4(ssdp_endpoint) = ssdp.local_addr().unwrap() else {
            unreachable!();
        };
        let transcript = Arc::new(Mutex::new(Vec::new()));
        let http_transcript = transcript.clone();
        let http_task = tokio::spawn(async move {
            let mut mapped = false;
            for _ in 0..7 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let request = read_http_request(&mut stream).await;
                let first_line = request.lines().next().unwrap_or_default();
                let (status, content_type, body, event) = if first_line
                    .starts_with("GET /root.xml ")
                {
                    (
                        "200 OK",
                        "text/xml",
                        device_description(http_port),
                        "GET /root.xml",
                    )
                } else if first_line.starts_with("GET /wan.xml ") {
                    (
                        "200 OK",
                        "application/xml",
                        scpd_description(),
                        "GET /wan.xml",
                    )
                } else {
                    let action = soap_action(&request);
                    let (status, body) = match action {
                        "GetExternalIPAddress" => (
                            "200 OK",
                            soap_response(
                                action,
                                "<NewExternalIPAddress>203.0.113.10</NewExternalIPAddress>",
                            ),
                        ),
                        "GetSpecificPortMappingEntry" if mapped => (
                            "200 OK",
                            soap_response(
                                action,
                                "<NewInternalPort>42000</NewInternalPort><NewInternalClient>127.0.0.1</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>JSTorrent</NewPortMappingDescription><NewLeaseDuration>1</NewLeaseDuration>",
                            ),
                        ),
                        "GetSpecificPortMappingEntry" => (
                            "500 Internal Server Error",
                            soap_fault(714, "NoSuchEntryInArray"),
                        ),
                        "AddPortMapping" => {
                            mapped = true;
                            ("200 OK", soap_response(action, ""))
                        }
                        "DeletePortMapping" if delete == ScriptedDelete::Stall => {
                            http_transcript.lock().unwrap().push(action.to_owned());
                            // Never answer; the caller aborts this task.
                            std::future::pending::<()>().await;
                            unreachable!();
                        }
                        "DeletePortMapping" => {
                            ("500 Internal Server Error", soap_fault(501, "DeleteFailed"))
                        }
                        other => panic!("unexpected scripted action {other}"),
                    };
                    (status, "text/xml; charset=utf-8", body, action)
                };
                http_transcript.lock().unwrap().push(event.to_owned());
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
        });
        let udp_task = tokio::spawn(async move {
            let mut request = [0_u8; 1_024];
            let (length, peer) = ssdp.recv_from(&mut request).await.unwrap();
            let request = std::str::from_utf8(&request[..length]).unwrap();
            assert!(request.contains("ST: upnp:rootdevice\r\n"));
            let response = format!(
                "HTTP/1.1 200 OK\r\nLOCATION: http://127.0.0.1:{http_port}/root.xml\r\nUSN: uuid:scripted::upnp:rootdevice\r\n\r\n"
            );
            ssdp.send_to(response.as_bytes(), peer).await.unwrap();
        });
        (
            UpnpDiscoveryConfig::scripted_for_testing(Ipv4Addr::LOCALHOST, ssdp_endpoint),
            transcript,
            udp_task,
            http_task,
        )
    }

    async fn read_http_request(stream: &mut TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 4_096];
        let header_end = loop {
            let length = stream.read(&mut buffer).await.unwrap();
            assert_ne!(length, 0, "request ended before headers");
            bytes.extend_from_slice(&buffer[..length]);
            if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                break position + 4;
            }
        };
        let headers = std::str::from_utf8(&bytes[..header_end]).unwrap();
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().unwrap())
            })
            .unwrap_or(0);
        while bytes.len() < header_end + content_length {
            let length = stream.read(&mut buffer).await.unwrap();
            assert_ne!(length, 0, "request ended before body");
            bytes.extend_from_slice(&buffer[..length]);
        }
        String::from_utf8(bytes).unwrap()
    }

    fn soap_action(request: &str) -> &str {
        request
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("soapaction")
                    .then(|| value.trim().trim_matches('"').rsplit('#').next().unwrap())
            })
            .expect("SOAPAction header")
    }

    fn device_description(port: u16) -> String {
        format!(
            "<?xml version=\"1.0\"?><root><URLBase>http://127.0.0.1:{port}/</URLBase><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:2</serviceType><controlURL>/control</controlURL><SCPDURL>/wan.xml</SCPDURL></service></serviceList></device></root>"
        )
    }

    fn dual_device_description(port: u16) -> String {
        format!(
            "<?xml version=\"1.0\"?><root><URLBase>http://127.0.0.1:{port}/</URLBase><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:2</serviceType><controlURL>/wan-control</controlURL><SCPDURL>/wan.xml</SCPDURL></service><service><serviceType>urn:schemas-upnp-org:service:WANIPv6FirewallControl:1</serviceType><controlURL>/firewall-control</controlURL><SCPDURL>/firewall.xml</SCPDURL></service></serviceList></device></root>"
        )
    }

    fn scpd_description() -> String {
        "<scpd><actionList><action><name>GetExternalIPAddress</name></action><action><name>GetSpecificPortMappingEntry</name></action><action><name>AddPortMapping</name></action><action><name>DeletePortMapping</name></action></actionList></scpd>".to_owned()
    }

    fn mapping_unavailable_scpd_description() -> String {
        "<scpd><actionList><action><name>GetExternalIPAddress</name></action></actionList></scpd>"
            .to_owned()
    }

    fn firewall_scpd_description() -> String {
        "<scpd><actionList><action><name>GetFirewallStatus</name></action><action><name>AddPinhole</name></action><action><name>UpdatePinhole</name></action><action><name>DeletePinhole</name></action><action><name>GetPinholePackets</name></action></actionList></scpd>".to_owned()
    }

    fn soap_response(action: &str, arguments: &str) -> String {
        format!(
            "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><u:{action}Response xmlns:u=\"urn:schemas-upnp-org:service:WANIPConnection:2\">{arguments}</u:{action}Response></s:Body></s:Envelope>"
        )
    }

    fn firewall_soap_response(action: &str, arguments: &str) -> String {
        format!(
            "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><u:{action}Response xmlns:u=\"urn:schemas-upnp-org:service:WANIPv6FirewallControl:1\">{arguments}</u:{action}Response></s:Body></s:Envelope>"
        )
    }

    fn soap_fault(code: u16, description: &str) -> String {
        format!(
            "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><s:Fault><detail><UPnPError><errorCode>{code}</errorCode><errorDescription>{description}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>"
        )
    }
}
