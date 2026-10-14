//! Task-free selection of the TCP tracker and UDP/uTP DHT endpoints.

use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, SocketAddrV6};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tokio::sync::watch;

use rstorrent_engine::{
    PeerAdvertisementEndpoint, PeerAdvertisementEndpointScope, PeerAdvertisementFamilyEndpoint,
    PeerTransport, eligible_global_ipv6,
};

use crate::settings::{
    AdvertisedPeerEndpointScope, AdvertisedPeerEndpointStatus,
    AdvertisedPeerEndpointUnavailableReason, ListenerStatus,
};
use crate::share_peer_hints::{ShareEndpointFacts, internet_ipv4};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum EndpointScope {
    Loopback,
    LocalNetwork,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RenewalHealth {
    Healthy,
    Unhealthy { detail: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum AdvertisedPeerEndpointState {
    OutboundOnly {
        generation: u64,
        reason: AdvertisedPeerEndpointUnavailableReason,
    },
    Local {
        generation: u64,
        local_endpoint: SocketAddrV4,
        scope: EndpointScope,
    },
    Mapped {
        generation: u64,
        local_endpoint: SocketAddrV4,
        external_endpoint: SocketAddrV4,
        mapping_generation: u64,
        valid_until: Instant,
        renewal_health: RenewalHealth,
    },
    Stopping {
        generation: u64,
        last_endpoint: Option<SocketAddrV4>,
    },
}

impl AdvertisedPeerEndpointState {
    pub(crate) fn generation(&self) -> u64 {
        match self {
            Self::OutboundOnly { generation, .. }
            | Self::Local { generation, .. }
            | Self::Mapped { generation, .. }
            | Self::Stopping { generation, .. } => *generation,
        }
    }

    pub(crate) fn wire_endpoint(&self, now: Instant) -> Option<SocketAddrV4> {
        match self {
            Self::Local { local_endpoint, .. } => Some(*local_endpoint),
            Self::Mapped {
                external_endpoint,
                valid_until,
                ..
            } if now < *valid_until => Some(*external_endpoint),
            Self::Mapped { local_endpoint, .. } => Some(*local_endpoint),
            Self::OutboundOnly { .. } | Self::Stopping { .. } => None,
        }
    }
}

#[derive(Debug)]
struct SelectorState {
    endpoint: AdvertisedPeerEndpointState,
    local_endpoint: Option<(SocketAddrV4, EndpointScope)>,
    udp_endpoint: AdvertisedPeerEndpointState,
    udp_local_endpoint: Option<(SocketAddrV4, EndpointScope)>,
    ipv6_local_endpoint: Option<SocketAddrV6>,
    ipv6_scope: Option<PeerAdvertisementEndpointScope>,
    incoming_observed: bool,
    /// The public IPv4 wire endpoint current when a peer from a public IPv4
    /// address arrived. It confirms reachability only while it still equals
    /// the current wire endpoint.
    ipv4_internet_confirmed: Option<SocketAddrV4>,
    /// The IPv6 listener endpoint a peer from a public IPv6 address reached.
    ipv6_internet_confirmed: Option<SocketAddrV6>,
    latest_mapping_generation: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct AdvertisedPeerEndpointSelector {
    state: Arc<Mutex<SelectorState>>,
    sender: watch::Sender<AdvertisedPeerEndpointState>,
    wire_sender: watch::Sender<PeerAdvertisementEndpoint>,
}

impl AdvertisedPeerEndpointSelector {
    pub(crate) fn new(listener_status: &ListenerStatus) -> Self {
        let (local_endpoint, endpoint) = initial_endpoint(listener_status);
        let state = SelectorState {
            endpoint,
            local_endpoint,
            udp_endpoint: AdvertisedPeerEndpointState::OutboundOnly {
                generation: 1,
                reason: AdvertisedPeerEndpointUnavailableReason::ListenerDisabled,
            },
            udp_local_endpoint: None,
            ipv6_local_endpoint: None,
            ipv6_scope: None,
            incoming_observed: false,
            ipv4_internet_confirmed: None,
            ipv6_internet_confirmed: None,
            latest_mapping_generation: 0,
        };
        let (sender, _) = watch::channel(state.endpoint.clone());
        let (wire_sender, _) = watch::channel(project_wire_endpoint(&state));
        Self {
            state: Arc::new(Mutex::new(state)),
            sender,
            wire_sender,
        }
    }

    #[allow(dead_code)]
    pub(crate) fn subscribe(&self) -> watch::Receiver<AdvertisedPeerEndpointState> {
        self.sender.subscribe()
    }

    pub(crate) fn subscribe_wire(&self) -> watch::Receiver<PeerAdvertisementEndpoint> {
        self.wire_sender.subscribe()
    }

    #[cfg(test)]
    pub(crate) fn current(&self) -> AdvertisedPeerEndpointState {
        self.selector_state().endpoint.clone()
    }

    pub(crate) fn status(&self, now: Instant) -> AdvertisedPeerEndpointStatus {
        let state = self.selector_state();
        project_status(&state.endpoint, state.incoming_observed, now)
    }

    pub(crate) fn mapping_verified(
        &self,
        mapping_generation: u64,
        external_endpoint: SocketAddrV4,
        lease: Duration,
        now: Instant,
    ) -> bool {
        let Some(valid_until) = now.checked_add(lease) else {
            return false;
        };
        let mut state = self.selector_state();
        let Some((local_endpoint, _)) = state.local_endpoint else {
            return false;
        };
        if matches!(state.endpoint, AdvertisedPeerEndpointState::Stopping { .. }) {
            return false;
        }
        if mapping_generation < state.latest_mapping_generation {
            return false;
        }
        state.latest_mapping_generation = mapping_generation;
        let endpoint_changed = !matches!(
            &state.endpoint,
            AdvertisedPeerEndpointState::Mapped {
                external_endpoint: current,
                ..
            } if *current == external_endpoint
        );
        let generation = if endpoint_changed {
            next_generation(state.endpoint.generation())
        } else {
            state.endpoint.generation()
        };
        state.endpoint = AdvertisedPeerEndpointState::Mapped {
            generation,
            local_endpoint,
            external_endpoint,
            mapping_generation,
            valid_until,
            renewal_health: RenewalHealth::Healthy,
        };
        self.publish(&state);
        endpoint_changed
    }

    pub(crate) fn udp_mapping_verified(
        &self,
        mapping_generation: u64,
        external_endpoint: SocketAddrV4,
        lease: Duration,
        now: Instant,
    ) -> bool {
        let Some(valid_until) = now.checked_add(lease) else {
            return false;
        };
        let mut state = self.selector_state();
        let Some((local_endpoint, _)) = state.udp_local_endpoint else {
            return false;
        };
        if matches!(
            state.udp_endpoint,
            AdvertisedPeerEndpointState::Stopping { .. }
        ) || mapping_generation < state.latest_mapping_generation
        {
            return false;
        }
        state.latest_mapping_generation = mapping_generation;
        let endpoint_changed = !matches!(
            &state.udp_endpoint,
            AdvertisedPeerEndpointState::Mapped {
                external_endpoint: current,
                ..
            } if *current == external_endpoint
        );
        let generation = if endpoint_changed {
            next_generation(state.endpoint.generation())
        } else {
            state.endpoint.generation()
        };
        if endpoint_changed {
            state.endpoint = replace_generation(state.endpoint.clone(), generation);
        }
        state.udp_endpoint = AdvertisedPeerEndpointState::Mapped {
            generation,
            local_endpoint,
            external_endpoint,
            mapping_generation,
            valid_until,
            renewal_health: RenewalHealth::Healthy,
        };
        self.publish(&state);
        endpoint_changed
    }

    pub(crate) fn begin_mapping_generation(&self) -> u64 {
        let mut state = self.selector_state();
        state.latest_mapping_generation = next_generation(state.latest_mapping_generation);
        if matches!(
            state.ipv6_scope,
            Some(
                PeerAdvertisementEndpointScope::Unfiltered
                    | PeerAdvertisementEndpointScope::Pinholed
            )
        ) {
            state.ipv6_scope = Some(PeerAdvertisementEndpointScope::GlobalUnicast);
            let generation = next_generation(state.endpoint.generation());
            state.endpoint = replace_generation(state.endpoint.clone(), generation);
            self.publish(&state);
        }
        state.latest_mapping_generation
    }

    pub(crate) fn ipv6_unfiltered(&self, reachability_generation: u64) -> bool {
        self.replace_ipv6_scope(
            reachability_generation,
            PeerAdvertisementEndpointScope::Unfiltered,
        )
    }

    pub(crate) fn ipv6_pinhole_verified(&self, reachability_generation: u64) -> bool {
        self.replace_ipv6_scope(
            reachability_generation,
            PeerAdvertisementEndpointScope::Pinholed,
        )
    }

    pub(crate) fn ipv6_pinhole_lost(&self, reachability_generation: u64) -> bool {
        self.replace_ipv6_scope(
            reachability_generation,
            PeerAdvertisementEndpointScope::GlobalUnicast,
        )
    }

    pub(crate) fn renewal_failed(
        &self,
        mapping_generation: u64,
        detail: String,
        now: Instant,
    ) -> bool {
        let mut state = self.selector_state();
        let AdvertisedPeerEndpointState::Mapped {
            generation,
            local_endpoint,
            external_endpoint,
            mapping_generation: current_generation,
            valid_until,
            ..
        } = &state.endpoint
        else {
            return false;
        };
        if *current_generation != mapping_generation || now >= *valid_until {
            drop(state);
            return self.expire(now);
        }
        let next = AdvertisedPeerEndpointState::Mapped {
            generation: *generation,
            local_endpoint: *local_endpoint,
            external_endpoint: *external_endpoint,
            mapping_generation: *current_generation,
            valid_until: *valid_until,
            renewal_health: RenewalHealth::Unhealthy { detail },
        };
        if state.endpoint == next {
            return false;
        }
        state.endpoint = next;
        self.publish(&state);
        true
    }

    pub(crate) fn udp_renewal_failed(
        &self,
        mapping_generation: u64,
        detail: String,
        now: Instant,
    ) -> bool {
        let mut state = self.selector_state();
        let AdvertisedPeerEndpointState::Mapped {
            generation,
            local_endpoint,
            external_endpoint,
            mapping_generation: current_generation,
            valid_until,
            ..
        } = &state.udp_endpoint
        else {
            return false;
        };
        if *current_generation != mapping_generation || now >= *valid_until {
            drop(state);
            return self.expire_udp_mapping(now);
        }
        let next = AdvertisedPeerEndpointState::Mapped {
            generation: *generation,
            local_endpoint: *local_endpoint,
            external_endpoint: *external_endpoint,
            mapping_generation: *current_generation,
            valid_until: *valid_until,
            renewal_health: RenewalHealth::Unhealthy { detail },
        };
        if state.udp_endpoint == next {
            return false;
        }
        state.udp_endpoint = next;
        self.publish(&state);
        true
    }

    pub(crate) fn expire(&self, now: Instant) -> bool {
        let mut state = self.selector_state();
        let AdvertisedPeerEndpointState::Mapped { valid_until, .. } = &state.endpoint else {
            return false;
        };
        if now < *valid_until {
            return false;
        }
        let Some((local_endpoint, scope)) = state.local_endpoint else {
            return false;
        };
        state.endpoint = AdvertisedPeerEndpointState::Local {
            generation: next_generation(state.endpoint.generation()),
            local_endpoint,
            scope,
        };
        self.publish(&state);
        true
    }

    pub(crate) fn expire_udp_mapping(&self, now: Instant) -> bool {
        let mut state = self.selector_state();
        let AdvertisedPeerEndpointState::Mapped { valid_until, .. } = &state.udp_endpoint else {
            return false;
        };
        if now < *valid_until {
            return false;
        }
        let Some((local_endpoint, scope)) = state.udp_local_endpoint else {
            return false;
        };
        let generation = next_generation(state.endpoint.generation());
        state.endpoint = replace_generation(state.endpoint.clone(), generation);
        state.udp_endpoint = AdvertisedPeerEndpointState::Local {
            generation,
            local_endpoint,
            scope,
        };
        self.publish(&state);
        true
    }

    /// Record an accepted peer as reachability evidence. Only a peer from a
    /// public address counts, and only for the endpoint it could have used:
    /// the public IPv4 wire endpoint (a uTP peer only when the UDP endpoint
    /// is the same address and port) or the global IPv6 listener.
    pub(crate) fn observe_incoming_peer(
        &self,
        transport: PeerTransport,
        remote: SocketAddr,
        local: Option<SocketAddr>,
        now: Instant,
    ) {
        match remote {
            SocketAddr::V4(remote) if internet_ipv4(*remote.ip()) => {
                let mut state = self.selector_state();
                let Some(wire) = state.endpoint.wire_endpoint(now) else {
                    return;
                };
                let local_port = match transport {
                    PeerTransport::Tcp => state.local_endpoint.map(|(endpoint, _)| endpoint.port()),
                    PeerTransport::Utp => {
                        if state.udp_endpoint.wire_endpoint(now) != Some(wire) {
                            return;
                        }
                        state
                            .udp_local_endpoint
                            .map(|(endpoint, _)| endpoint.port())
                    }
                };
                if internet_ipv4(*wire.ip())
                    && local
                        .is_some_and(|local| local.is_ipv4() && Some(local.port()) == local_port)
                {
                    state.ipv4_internet_confirmed = Some(wire);
                }
            }
            SocketAddr::V6(remote) if eligible_global_ipv6(*remote.ip()) => {
                let mut state = self.selector_state();
                let Some(listener) = state.ipv6_local_endpoint else {
                    return;
                };
                if matches!(state.endpoint, AdvertisedPeerEndpointState::Stopping { .. })
                    || !eligible_global_ipv6(*listener.ip())
                {
                    return;
                }
                if local.is_some_and(|local| {
                    local.ip() == std::net::IpAddr::V6(*listener.ip())
                        && local.port() == listener.port()
                }) {
                    state.ipv6_internet_confirmed = Some(listener);
                }
            }
            SocketAddr::V4(_) | SocketAddr::V6(_) => {}
        }
    }

    /// Snapshot the reachability facts a share link's peer hint may use.
    pub(crate) fn share_endpoint_facts(&self, now: Instant) -> ShareEndpointFacts {
        let state = self.selector_state();
        if matches!(state.endpoint, AdvertisedPeerEndpointState::Stopping { .. }) {
            return ShareEndpointFacts::default();
        }
        let ipv4_mapped = match &state.endpoint {
            AdvertisedPeerEndpointState::Mapped {
                external_endpoint,
                valid_until,
                renewal_health: RenewalHealth::Healthy,
                ..
            } if now < *valid_until => Some(*external_endpoint),
            _ => None,
        };
        let ipv4_listener = match &state.endpoint {
            AdvertisedPeerEndpointState::Local { local_endpoint, .. }
            | AdvertisedPeerEndpointState::Mapped { local_endpoint, .. } => Some(*local_endpoint),
            AdvertisedPeerEndpointState::OutboundOnly { .. }
            | AdvertisedPeerEndpointState::Stopping { .. } => None,
        };
        // An unhealthy or expired mapping is not current evidence; a public
        // listener without a mapping is confirmed on its own endpoint.
        let current_public = ipv4_mapped.or_else(|| match &state.endpoint {
            AdvertisedPeerEndpointState::Local { local_endpoint, .. } => Some(*local_endpoint),
            _ => None,
        });
        ShareEndpointFacts {
            ipv4_listener,
            ipv4_mapped,
            ipv4_confirmed: state
                .ipv4_internet_confirmed
                .filter(|confirmed| Some(*confirmed) == current_public),
            ipv6_listener: state.ipv6_local_endpoint,
            ipv6_confirmed: state.ipv6_local_endpoint.is_some()
                && state.ipv6_internet_confirmed == state.ipv6_local_endpoint,
        }
    }

    pub(crate) fn observe_incoming(&self) -> bool {
        let mut state = self.selector_state();
        if state.incoming_observed {
            return false;
        }
        state.incoming_observed = true;
        true
    }

    pub(crate) fn replace_listener(&self, listener_status: &ListenerStatus) -> bool {
        let mut state = self.selector_state();
        let (local_endpoint, endpoint) = initial_endpoint(listener_status);
        let generation = next_generation(state.endpoint.generation());
        state.local_endpoint = local_endpoint;
        state.incoming_observed = false;
        state.ipv4_internet_confirmed = None;
        state.latest_mapping_generation = next_generation(state.latest_mapping_generation);
        if state.ipv6_local_endpoint.is_some() {
            state.ipv6_scope = Some(PeerAdvertisementEndpointScope::GlobalUnicast);
        }
        state.endpoint = with_generation(endpoint, generation);
        self.publish(&state);
        true
    }

    pub(crate) fn replace_udp_listener(&self, endpoint: Option<SocketAddrV4>) -> bool {
        let mut state = self.selector_state();
        if matches!(
            state.udp_endpoint,
            AdvertisedPeerEndpointState::Stopping { .. }
        ) {
            return false;
        }
        let local_endpoint = endpoint.map(|endpoint| {
            let scope = if endpoint.ip().is_loopback() {
                EndpointScope::Loopback
            } else {
                EndpointScope::LocalNetwork
            };
            (endpoint, scope)
        });
        let next = match local_endpoint {
            Some((local_endpoint, scope)) => AdvertisedPeerEndpointState::Local {
                generation: state.udp_endpoint.generation(),
                local_endpoint,
                scope,
            },
            None => AdvertisedPeerEndpointState::OutboundOnly {
                generation: state.udp_endpoint.generation(),
                reason: AdvertisedPeerEndpointUnavailableReason::ListenerDisabled,
            },
        };
        if state.udp_local_endpoint == local_endpoint && state.udp_endpoint == next {
            return false;
        }
        let generation = next_generation(state.endpoint.generation());
        state.endpoint = replace_generation(state.endpoint.clone(), generation);
        state.udp_endpoint = replace_generation(next, generation);
        state.udp_local_endpoint = local_endpoint;
        state.latest_mapping_generation = next_generation(state.latest_mapping_generation);
        self.publish(&state);
        true
    }

    pub(crate) fn replace_ipv6_listener(&self, endpoint: Option<SocketAddrV6>) -> bool {
        let mut state = self.selector_state();
        if matches!(state.endpoint, AdvertisedPeerEndpointState::Stopping { .. })
            || state.ipv6_local_endpoint == endpoint
        {
            return false;
        }
        state.ipv6_local_endpoint = endpoint;
        state.ipv6_internet_confirmed = None;
        state.ipv6_scope = endpoint.map(|endpoint| {
            if endpoint.ip().is_loopback() {
                PeerAdvertisementEndpointScope::Loopback
            } else {
                PeerAdvertisementEndpointScope::GlobalUnicast
            }
        });
        state.latest_mapping_generation = next_generation(state.latest_mapping_generation);
        let generation = next_generation(state.endpoint.generation());
        state.endpoint = replace_generation(state.endpoint.clone(), generation);
        self.publish(&state);
        true
    }

    pub(crate) fn stop(&self) -> bool {
        let mut state = self.selector_state();
        if matches!(state.endpoint, AdvertisedPeerEndpointState::Stopping { .. }) {
            return false;
        }
        let now = Instant::now();
        let last_endpoint = state.endpoint.wire_endpoint(now);
        state.endpoint = AdvertisedPeerEndpointState::Stopping {
            generation: next_generation(state.endpoint.generation()),
            last_endpoint,
        };
        let last_udp_endpoint = state.udp_endpoint.wire_endpoint(now);
        state.udp_endpoint = AdvertisedPeerEndpointState::Stopping {
            generation: state.endpoint.generation(),
            last_endpoint: last_udp_endpoint,
        };
        self.publish(&state);
        true
    }

    fn publish(&self, state: &SelectorState) {
        self.sender.send_replace(state.endpoint.clone());
        self.wire_sender.send_replace(project_wire_endpoint(state));
    }

    fn selector_state(&self) -> MutexGuard<'_, SelectorState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn replace_ipv6_scope(
        &self,
        reachability_generation: u64,
        scope: PeerAdvertisementEndpointScope,
    ) -> bool {
        let mut state = self.selector_state();
        if reachability_generation != state.latest_mapping_generation
            || matches!(state.endpoint, AdvertisedPeerEndpointState::Stopping { .. })
            || state.ipv6_local_endpoint.is_none()
            || state.ipv6_scope == Some(PeerAdvertisementEndpointScope::Loopback)
            || state.ipv6_scope == Some(scope)
        {
            return false;
        }
        state.ipv6_scope = Some(scope);
        let generation = next_generation(state.endpoint.generation());
        state.endpoint = replace_generation(state.endpoint.clone(), generation);
        self.publish(&state);
        true
    }
}

fn project_wire_endpoint(state: &SelectorState) -> PeerAdvertisementEndpoint {
    let ipv6 = state.ipv6_local_endpoint.map_or_else(
        PeerAdvertisementFamilyEndpoint::outbound_only,
        |endpoint| PeerAdvertisementFamilyEndpoint {
            endpoint: Some(SocketAddr::V6(endpoint)),
            source_address: Some((*endpoint.ip()).into()),
            scope: state.ipv6_scope,
        },
    );
    let dht_ipv4 = project_family_endpoint(&state.udp_endpoint);
    match &state.endpoint {
        AdvertisedPeerEndpointState::OutboundOnly { generation, .. } => PeerAdvertisementEndpoint {
            generation: *generation,
            ipv4: PeerAdvertisementFamilyEndpoint::outbound_only(),
            ipv6,
            dht_ipv4,
            dht_ipv6: ipv6,
            stopping: false,
        },
        AdvertisedPeerEndpointState::Local {
            generation,
            local_endpoint,
            scope,
        } => PeerAdvertisementEndpoint {
            generation: *generation,
            ipv4: PeerAdvertisementFamilyEndpoint {
                endpoint: Some(SocketAddr::V4(*local_endpoint)),
                source_address: Some((*local_endpoint.ip()).into()),
                scope: Some(match scope {
                    EndpointScope::Loopback => PeerAdvertisementEndpointScope::Loopback,
                    EndpointScope::LocalNetwork => PeerAdvertisementEndpointScope::LocalNetwork,
                }),
            },
            ipv6,
            dht_ipv4,
            dht_ipv6: ipv6,
            stopping: false,
        },
        AdvertisedPeerEndpointState::Mapped {
            generation,
            local_endpoint,
            external_endpoint,
            ..
        } => PeerAdvertisementEndpoint {
            generation: *generation,
            ipv4: PeerAdvertisementFamilyEndpoint {
                endpoint: Some(SocketAddr::V4(*external_endpoint)),
                source_address: Some((*local_endpoint.ip()).into()),
                scope: Some(PeerAdvertisementEndpointScope::Mapped),
            },
            ipv6,
            dht_ipv4,
            dht_ipv6: ipv6,
            stopping: false,
        },
        AdvertisedPeerEndpointState::Stopping { generation, .. } => {
            PeerAdvertisementEndpoint::stopping(*generation)
        }
    }
}

fn project_family_endpoint(
    endpoint: &AdvertisedPeerEndpointState,
) -> PeerAdvertisementFamilyEndpoint {
    match endpoint {
        AdvertisedPeerEndpointState::Local {
            local_endpoint,
            scope,
            ..
        } => PeerAdvertisementFamilyEndpoint {
            endpoint: Some(SocketAddr::V4(*local_endpoint)),
            source_address: Some((*local_endpoint.ip()).into()),
            scope: Some(match scope {
                EndpointScope::Loopback => PeerAdvertisementEndpointScope::Loopback,
                EndpointScope::LocalNetwork => PeerAdvertisementEndpointScope::LocalNetwork,
            }),
        },
        AdvertisedPeerEndpointState::Mapped {
            local_endpoint,
            external_endpoint,
            ..
        } => PeerAdvertisementFamilyEndpoint {
            endpoint: Some(SocketAddr::V4(*external_endpoint)),
            source_address: Some((*local_endpoint.ip()).into()),
            scope: Some(PeerAdvertisementEndpointScope::Mapped),
        },
        AdvertisedPeerEndpointState::OutboundOnly { .. }
        | AdvertisedPeerEndpointState::Stopping { .. } => {
            PeerAdvertisementFamilyEndpoint::outbound_only()
        }
    }
}

fn initial_endpoint(
    listener_status: &ListenerStatus,
) -> (
    Option<(SocketAddrV4, EndpointScope)>,
    AdvertisedPeerEndpointState,
) {
    let ListenerStatus::Listening { address, port } = listener_status else {
        let reason = if matches!(listener_status, ListenerStatus::BindFailed { .. }) {
            AdvertisedPeerEndpointUnavailableReason::ListenerBindFailed
        } else {
            AdvertisedPeerEndpointUnavailableReason::ListenerDisabled
        };
        return (
            None,
            AdvertisedPeerEndpointState::OutboundOnly {
                generation: 1,
                reason,
            },
        );
    };
    let Ok(address) = address.parse::<Ipv4Addr>() else {
        return (
            None,
            AdvertisedPeerEndpointState::OutboundOnly {
                generation: 1,
                reason: AdvertisedPeerEndpointUnavailableReason::ListenerBindFailed,
            },
        );
    };
    let endpoint = SocketAddrV4::new(address, *port);
    let scope = if address.is_loopback() {
        EndpointScope::Loopback
    } else {
        EndpointScope::LocalNetwork
    };
    (
        Some((endpoint, scope)),
        AdvertisedPeerEndpointState::Local {
            generation: 1,
            local_endpoint: endpoint,
            scope,
        },
    )
}

fn next_generation(generation: u64) -> u64 {
    generation.saturating_add(1)
}

fn with_generation(
    endpoint: AdvertisedPeerEndpointState,
    generation: u64,
) -> AdvertisedPeerEndpointState {
    match endpoint {
        AdvertisedPeerEndpointState::OutboundOnly { reason, .. } => {
            AdvertisedPeerEndpointState::OutboundOnly { generation, reason }
        }
        AdvertisedPeerEndpointState::Local {
            local_endpoint,
            scope,
            ..
        } => AdvertisedPeerEndpointState::Local {
            generation,
            local_endpoint,
            scope,
        },
        AdvertisedPeerEndpointState::Mapped { .. }
        | AdvertisedPeerEndpointState::Stopping { .. } => {
            unreachable!("initial listener projection cannot be mapped or stopping")
        }
    }
}

fn replace_generation(
    endpoint: AdvertisedPeerEndpointState,
    generation: u64,
) -> AdvertisedPeerEndpointState {
    match endpoint {
        AdvertisedPeerEndpointState::OutboundOnly { reason, .. } => {
            AdvertisedPeerEndpointState::OutboundOnly { generation, reason }
        }
        AdvertisedPeerEndpointState::Local {
            local_endpoint,
            scope,
            ..
        } => AdvertisedPeerEndpointState::Local {
            generation,
            local_endpoint,
            scope,
        },
        AdvertisedPeerEndpointState::Mapped {
            local_endpoint,
            external_endpoint,
            mapping_generation,
            valid_until,
            renewal_health,
            ..
        } => AdvertisedPeerEndpointState::Mapped {
            generation,
            local_endpoint,
            external_endpoint,
            mapping_generation,
            valid_until,
            renewal_health,
        },
        AdvertisedPeerEndpointState::Stopping { last_endpoint, .. } => {
            AdvertisedPeerEndpointState::Stopping {
                generation,
                last_endpoint,
            }
        }
    }
}

fn project_status(
    endpoint: &AdvertisedPeerEndpointState,
    incoming_observed: bool,
    now: Instant,
) -> AdvertisedPeerEndpointStatus {
    match endpoint {
        AdvertisedPeerEndpointState::OutboundOnly { generation, reason } => {
            AdvertisedPeerEndpointStatus::OutboundOnly {
                generation: generation.to_string(),
                reason: *reason,
            }
        }
        AdvertisedPeerEndpointState::Local {
            generation,
            local_endpoint,
            scope,
        } => AdvertisedPeerEndpointStatus::Local {
            generation: generation.to_string(),
            address: local_endpoint.ip().to_string(),
            port: local_endpoint.port(),
            scope: match scope {
                EndpointScope::Loopback => AdvertisedPeerEndpointScope::Loopback,
                EndpointScope::LocalNetwork => AdvertisedPeerEndpointScope::LocalNetwork,
            },
            incoming_observed,
        },
        AdvertisedPeerEndpointState::Mapped {
            generation,
            local_endpoint,
            external_endpoint,
            valid_until,
            renewal_health,
            ..
        } => {
            let remaining = valid_until.saturating_duration_since(now).as_secs();
            let lease_seconds_remaining = remaining.try_into().unwrap_or(u32::MAX);
            match renewal_health {
                RenewalHealth::Healthy => AdvertisedPeerEndpointStatus::Mapped {
                    generation: generation.to_string(),
                    local_address: local_endpoint.ip().to_string(),
                    local_port: local_endpoint.port(),
                    external_address: external_endpoint.ip().to_string(),
                    external_port: external_endpoint.port(),
                    lease_seconds_remaining,
                    incoming_observed,
                },
                RenewalHealth::Unhealthy { detail } => {
                    AdvertisedPeerEndpointStatus::RenewalUnhealthy {
                        generation: generation.to_string(),
                        local_address: local_endpoint.ip().to_string(),
                        local_port: local_endpoint.port(),
                        external_address: external_endpoint.ip().to_string(),
                        external_port: external_endpoint.port(),
                        lease_seconds_remaining,
                        detail: detail.clone(),
                        incoming_observed,
                    }
                }
            }
        }
        AdvertisedPeerEndpointState::Stopping {
            generation,
            last_endpoint,
        } => AdvertisedPeerEndpointStatus::Stopping {
            generation: generation.to_string(),
            last_port: last_endpoint.map(|endpoint| endpoint.port()),
            incoming_observed,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_selector() -> AdvertisedPeerEndpointSelector {
        AdvertisedPeerEndpointSelector::new(&ListenerStatus::Listening {
            address: "192.168.50.12".to_owned(),
            port: 41_234,
        })
    }

    #[test]
    fn listener_scope_and_outbound_only_are_truthful() {
        let disabled = AdvertisedPeerEndpointSelector::new(&ListenerStatus::Disabled);
        assert!(matches!(
            disabled.current(),
            AdvertisedPeerEndpointState::OutboundOnly {
                reason: AdvertisedPeerEndpointUnavailableReason::ListenerDisabled,
                ..
            }
        ));
        let loopback = AdvertisedPeerEndpointSelector::new(&ListenerStatus::Listening {
            address: "127.0.0.1".to_owned(),
            port: 41_234,
        });
        assert!(matches!(
            loopback.current(),
            AdvertisedPeerEndpointState::Local {
                scope: EndpointScope::Loopback,
                ..
            }
        ));
    }

    #[test]
    fn ipv6_listener_is_projected_without_overwriting_ipv4() {
        let selector = local_selector();
        let before = selector.subscribe_wire().borrow().generation;
        let ipv6 = "[2001:4860:4860::8888]:42006".parse().unwrap();
        assert!(selector.replace_ipv6_listener(Some(ipv6)));
        let wire = *selector.subscribe_wire().borrow();
        assert!(wire.generation > before);
        assert_eq!(
            wire.ipv4.endpoint,
            Some("192.168.50.12:41234".parse().unwrap())
        );
        assert_eq!(wire.ipv6.endpoint, Some(SocketAddr::V6(ipv6)));
        assert_eq!(
            wire.ipv6.scope,
            Some(PeerAdvertisementEndpointScope::GlobalUnicast)
        );
        assert!(selector.replace_ipv6_listener(None));
        assert_eq!(
            selector.subscribe_wire().borrow().ipv6,
            PeerAdvertisementFamilyEndpoint::outbound_only()
        );
    }

    #[test]
    fn udp_listener_and_mapping_are_independent_from_tcp() {
        let selector = local_selector();
        let udp_local = SocketAddrV4::new(Ipv4Addr::new(192, 168, 50, 12), 41_235);
        assert!(selector.replace_udp_listener(Some(udp_local)));
        let local_wire = *selector.subscribe_wire().borrow();
        assert_eq!(
            local_wire.ipv4.endpoint,
            Some("192.168.50.12:41234".parse().unwrap())
        );
        assert_eq!(
            local_wire.dht_ipv4.endpoint,
            Some(SocketAddr::V4(udp_local))
        );

        let now = Instant::now();
        let mapping_generation = selector.begin_mapping_generation();
        let udp_external = SocketAddrV4::new(Ipv4Addr::new(203, 0, 113, 20), 48_002);
        assert!(selector.udp_mapping_verified(
            mapping_generation,
            udp_external,
            Duration::from_secs(60),
            now,
        ));
        let mapped_wire = *selector.subscribe_wire().borrow();
        assert_eq!(mapped_wire.ipv4, local_wire.ipv4);
        assert_eq!(
            mapped_wire.dht_ipv4.endpoint,
            Some(SocketAddr::V4(udp_external))
        );
        assert_eq!(
            mapped_wire.dht_ipv4.scope,
            Some(PeerAdvertisementEndpointScope::Mapped)
        );

        let tcp_external = SocketAddrV4::new(Ipv4Addr::new(203, 0, 113, 20), 48_001);
        assert!(selector.mapping_verified(
            mapping_generation,
            tcp_external,
            Duration::from_secs(60),
            now,
        ));
        let both_mapped = *selector.subscribe_wire().borrow();
        assert_eq!(
            both_mapped.ipv4.endpoint,
            Some(SocketAddr::V4(tcp_external))
        );
        assert_eq!(
            both_mapped.dht_ipv4.endpoint,
            Some(SocketAddr::V4(udp_external))
        );

        assert!(selector.udp_renewal_failed(mapping_generation, "timeout".to_owned(), now,));
        assert!(selector.expire_udp_mapping(now + Duration::from_secs(60)));
        let expired_wire = *selector.subscribe_wire().borrow();
        assert_eq!(expired_wire.ipv4.endpoint, both_mapped.ipv4.endpoint);
        assert_eq!(
            expired_wire.dht_ipv4.endpoint,
            Some(SocketAddr::V4(udp_local))
        );
    }

    #[test]
    fn ipv6_gateway_evidence_is_generation_fenced_and_wire_visible() {
        let selector = local_selector();
        let ipv6 = "[2001:4860:4860::8888]:42006".parse().unwrap();
        assert!(selector.replace_ipv6_listener(Some(ipv6)));
        let generation = selector.begin_mapping_generation();
        assert!(selector.ipv6_unfiltered(generation));
        assert_eq!(
            selector.subscribe_wire().borrow().ipv6.scope,
            Some(PeerAdvertisementEndpointScope::Unfiltered)
        );
        assert!(selector.ipv6_pinhole_verified(generation));
        assert_eq!(
            selector.subscribe_wire().borrow().ipv6.scope,
            Some(PeerAdvertisementEndpointScope::Pinholed)
        );
        assert!(!selector.ipv6_pinhole_lost(generation.saturating_sub(1)));
        assert_eq!(
            selector.subscribe_wire().borrow().ipv6.scope,
            Some(PeerAdvertisementEndpointScope::Pinholed)
        );
        assert!(selector.ipv6_pinhole_lost(generation));
        assert_eq!(
            selector.subscribe_wire().borrow().ipv6.scope,
            Some(PeerAdvertisementEndpointScope::GlobalUnicast)
        );
    }

    #[test]
    fn listener_replacement_invalidates_ipv6_gateway_evidence() {
        let selector = local_selector();
        let first = "[2001:4860:4860::8888]:42006".parse().unwrap();
        assert!(selector.replace_ipv6_listener(Some(first)));
        let generation = selector.begin_mapping_generation();
        assert!(selector.ipv6_pinhole_verified(generation));
        let replacement = "[2606:4700:4700::1111]:42007".parse().unwrap();
        assert!(selector.replace_ipv6_listener(Some(replacement)));
        let wire = *selector.subscribe_wire().borrow();
        assert_eq!(wire.ipv6.endpoint, Some(SocketAddr::V6(replacement)));
        assert_eq!(
            wire.ipv6.scope,
            Some(PeerAdvertisementEndpointScope::GlobalUnicast)
        );
        assert!(!selector.ipv6_pinhole_verified(generation));
    }

    #[test]
    fn mapping_lease_failure_retains_then_expires_external_port() {
        let selector = local_selector();
        let now = Instant::now();
        let external = SocketAddrV4::new(Ipv4Addr::new(203, 0, 113, 20), 48_001);
        assert!(selector.mapping_verified(7, external, Duration::from_secs(60), now));
        assert_eq!(selector.current().wire_endpoint(now), Some(external));
        let mapped_generation = selector.current().generation();

        assert!(selector.renewal_failed(7, "timeout".to_owned(), now));
        assert_eq!(selector.current().generation(), mapped_generation);
        assert_eq!(
            selector
                .current()
                .wire_endpoint(now + Duration::from_secs(59)),
            Some(external)
        );
        assert!(!selector.expire(now + Duration::from_secs(59)));
        assert!(selector.expire(now + Duration::from_secs(60)));
        assert_eq!(
            selector
                .current()
                .wire_endpoint(now + Duration::from_secs(60)),
            Some(SocketAddrV4::new(Ipv4Addr::new(192, 168, 50, 12), 41_234))
        );
        assert_eq!(selector.current().generation(), mapped_generation + 1);
    }

    #[test]
    fn explicit_mapping_generations_fence_retired_listener_work() {
        let selector = local_selector();
        let now = Instant::now();
        let first = selector.begin_mapping_generation();
        let old_external = SocketAddrV4::new(Ipv4Addr::new(203, 0, 113, 20), 48_001);
        assert!(selector.mapping_verified(first, old_external, Duration::from_secs(60), now));

        selector.replace_listener(&ListenerStatus::Listening {
            address: "192.168.50.12".to_owned(),
            port: 41_235,
        });
        let replacement = selector.begin_mapping_generation();
        assert!(replacement > first);
        assert!(!selector.mapping_verified(first, old_external, Duration::from_secs(60), now,));
        let new_external = SocketAddrV4::new(Ipv4Addr::new(203, 0, 113, 21), 48_002);
        assert!(
            selector.mapping_verified(replacement, new_external, Duration::from_secs(60), now,)
        );
        assert_eq!(selector.current().wire_endpoint(now), Some(new_external));
    }

    #[test]
    fn same_mapping_renewal_extends_deadline_without_wire_generation_change() {
        let selector = local_selector();
        let now = Instant::now();
        let external = SocketAddrV4::new(Ipv4Addr::new(203, 0, 113, 20), 48_001);
        assert!(selector.mapping_verified(9, external, Duration::from_secs(60), now));
        let generation = selector.current().generation();
        assert!(!selector.mapping_verified(
            9,
            external,
            Duration::from_secs(120),
            now + Duration::from_secs(30)
        ));
        assert_eq!(selector.current().generation(), generation);
        assert_eq!(
            selector
                .current()
                .wire_endpoint(now + Duration::from_secs(100)),
            Some(external)
        );
    }

    #[test]
    fn stale_mapping_generation_and_stopping_are_fenced() {
        let selector = local_selector();
        let now = Instant::now();
        let first = SocketAddrV4::new(Ipv4Addr::new(203, 0, 113, 20), 48_001);
        let stale = SocketAddrV4::new(Ipv4Addr::new(203, 0, 113, 21), 48_002);
        assert!(selector.mapping_verified(12, first, Duration::from_secs(60), now));
        assert!(!selector.mapping_verified(11, stale, Duration::from_secs(60), now));
        assert_eq!(selector.current().wire_endpoint(now), Some(first));
        assert!(selector.stop());
        assert!(!selector.mapping_verified(12, first, Duration::from_secs(60), now));
        assert!(matches!(
            selector.current(),
            AdvertisedPeerEndpointState::Stopping { .. }
        ));
    }

    #[test]
    fn listener_replacement_clears_mapping_and_incoming_evidence() {
        let selector = local_selector();
        let now = Instant::now();
        assert!(selector.observe_incoming());
        assert!(selector.mapping_verified(
            12,
            SocketAddrV4::new(Ipv4Addr::new(203, 0, 113, 20), 48_001),
            Duration::from_secs(60),
            now,
        ));
        let previous_generation = selector.current().generation();
        assert!(selector.replace_listener(&ListenerStatus::Listening {
            address: "192.168.50.13".to_owned(),
            port: 41_235,
        }));
        assert!(matches!(
            selector.current(),
            AdvertisedPeerEndpointState::Local {
                generation,
                local_endpoint,
                ..
            } if generation == previous_generation + 1
                && local_endpoint == SocketAddrV4::new(Ipv4Addr::new(192, 168, 50, 13), 41_235)
        ));
        assert!(matches!(
            selector.status(now),
            AdvertisedPeerEndpointStatus::Local {
                incoming_observed: false,
                ..
            }
        ));
        assert!(!selector.mapping_verified(
            12,
            SocketAddrV4::new(Ipv4Addr::new(203, 0, 113, 21), 48_002),
            Duration::from_secs(60),
            now,
        ));
    }

    #[test]
    fn watch_is_current_value_and_incoming_evidence_is_separate() {
        let selector = local_selector();
        let receiver = selector.subscribe();
        assert_eq!(*receiver.borrow(), selector.current());
        let now = Instant::now();
        assert!(selector.observe_incoming());
        assert!(!selector.observe_incoming());
        assert!(matches!(
            selector.status(now),
            AdvertisedPeerEndpointStatus::Local {
                incoming_observed: true,
                ..
            }
        ));
    }

    #[test]
    fn share_facts_confirm_internet_reachability_only_from_public_peers() {
        let selector = local_selector();
        let now = Instant::now();
        let lan = SocketAddrV4::new(Ipv4Addr::new(192, 168, 50, 12), 41_234);
        let external = SocketAddrV4::new(Ipv4Addr::new(93, 184, 216, 34), 48_001);
        let public_peer: SocketAddr = "1.1.1.1:50000".parse().unwrap();
        let lan_peer: SocketAddr = "192.168.50.99:50000".parse().unwrap();
        let local = Some(SocketAddr::V4(lan));

        let facts = selector.share_endpoint_facts(now);
        assert_eq!(facts.ipv4_listener, Some(lan));
        assert_eq!(facts.ipv4_mapped, None);
        assert_eq!(facts.ipv4_confirmed, None);

        assert!(selector.mapping_verified(1, external, Duration::from_secs(60), now));
        selector.observe_incoming_peer(PeerTransport::Tcp, lan_peer, local, now);
        let facts = selector.share_endpoint_facts(now);
        assert_eq!(facts.ipv4_mapped, Some(external));
        assert_eq!(facts.ipv4_confirmed, None, "a LAN peer proves nothing");

        // A uTP peer only counts when UDP shares the mapped endpoint.
        selector.observe_incoming_peer(PeerTransport::Utp, public_peer, local, now);
        assert_eq!(selector.share_endpoint_facts(now).ipv4_confirmed, None);

        selector.observe_incoming_peer(
            PeerTransport::Tcp,
            public_peer,
            Some("192.168.50.12:1".parse().unwrap()),
            now,
        );
        assert_eq!(selector.share_endpoint_facts(now).ipv4_confirmed, None);

        selector.observe_incoming_peer(PeerTransport::Tcp, public_peer, local, now);
        assert_eq!(
            selector.share_endpoint_facts(now).ipv4_confirmed,
            Some(external)
        );

        // Unhealthy renewal, expiry and a new mapping all withdraw it.
        assert!(selector.renewal_failed(1, "renewal".to_owned(), now));
        let facts = selector.share_endpoint_facts(now);
        assert_eq!(facts.ipv4_mapped, None);
        assert_eq!(facts.ipv4_confirmed, None);
        let moved = SocketAddrV4::new(Ipv4Addr::new(93, 184, 216, 35), 48_001);
        assert!(selector.mapping_verified(2, moved, Duration::from_secs(60), now));
        assert_eq!(selector.share_endpoint_facts(now).ipv4_confirmed, None);
        selector.observe_incoming_peer(PeerTransport::Tcp, public_peer, local, now);
        assert_eq!(
            selector.share_endpoint_facts(now).ipv4_confirmed,
            Some(moved)
        );
        let later = now + Duration::from_secs(61);
        assert!(selector.expire(later));
        assert_eq!(selector.share_endpoint_facts(later).ipv4_confirmed, None);

        assert!(selector.replace_listener(&ListenerStatus::Listening {
            address: "192.168.50.12".to_owned(),
            port: 41_234,
        }));
        assert!(selector.mapping_verified(3, moved, Duration::from_secs(60), later));
        assert_eq!(
            selector.share_endpoint_facts(later).ipv4_confirmed,
            None,
            "listener replacement clears evidence"
        );
        assert!(selector.stop());
        assert_eq!(
            selector.share_endpoint_facts(later),
            crate::share_peer_hints::ShareEndpointFacts::default()
        );
    }

    #[test]
    fn share_facts_confirm_ipv6_listener_from_a_global_peer() {
        let selector = local_selector();
        let now = Instant::now();
        let listener: SocketAddrV6 = "[2a00:1450::20]:42006".parse().unwrap();
        assert!(selector.replace_ipv6_listener(Some(listener)));
        let local = Some(SocketAddr::V6(listener));
        selector.observe_incoming_peer(
            PeerTransport::Utp,
            "[fd00::5]:50000".parse().unwrap(),
            local,
            now,
        );
        let facts = selector.share_endpoint_facts(now);
        assert_eq!(facts.ipv6_listener, Some(listener));
        assert!(!facts.ipv6_confirmed, "a ULA peer proves nothing");
        selector.observe_incoming_peer(
            PeerTransport::Utp,
            "[2a03:2880::1]:50000".parse().unwrap(),
            local,
            now,
        );
        assert!(selector.share_endpoint_facts(now).ipv6_confirmed);
        let replacement: SocketAddrV6 = "[2a00:1450::21]:42006".parse().unwrap();
        assert!(selector.replace_ipv6_listener(Some(replacement)));
        assert!(!selector.share_endpoint_facts(now).ipv6_confirmed);
    }
}
