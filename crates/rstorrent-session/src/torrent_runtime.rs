//! Application-generation lifetime for one torrent's peer state and children.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rstorrent_engine::peer::PeerRegistrySnapshot;
use rstorrent_engine::{
    CompletedStorageEvidence, DownloadControl, PeerConnectionDirection, PeerConnectionObservation,
    SeedRegistrationToken, StorageFilePool, TorrentBandwidth, TorrentIdentityContext,
    TorrentPeerActivitySink, TorrentPeerError, TorrentPeerHandle, TrackerCounters,
};
use tokio::task::JoinHandle;

use crate::accounting::TorrentAccountingOwner;
use crate::advertised_endpoint::AdvertisedPeerEndpointSelector;
use crate::incoming_seeding::{
    IncomingSeeding, IncomingSeedingError, SeedReconcileInput, SeedReconcileOutcome,
    SeedReconcileResult,
};
use crate::store::{ResumeRecord, StorageRootLocation};
use crate::views::ViewHub;

#[derive(Debug)]
struct TorrentPeerViewSink {
    torrent_id: String,
    accepting: Arc<AtomicBool>,
    views: ViewHub,
    advertised_endpoint: AdvertisedPeerEndpointSelector,
    tracker_counters: TrackerCounters,
    traffic: Mutex<std::collections::BTreeMap<u64, (u64, u64)>>,
}

impl TorrentPeerActivitySink for TorrentPeerViewSink {
    fn record_peer_connections(
        &self,
        captured_at: Duration,
        peers: Vec<PeerConnectionObservation>,
    ) {
        if self.accepting.load(Ordering::Acquire) {
            let incoming_observed = peers
                .iter()
                .any(|peer| peer.direction == PeerConnectionDirection::Incoming);
            if incoming_observed {
                let now = Instant::now();
                for peer in peers
                    .iter()
                    .filter(|peer| peer.direction == PeerConnectionDirection::Incoming)
                {
                    self.advertised_endpoint.observe_incoming_peer(
                        peer.transport,
                        peer.endpoint,
                        peer.local_endpoint,
                        now,
                    );
                }
            }
            let mut traffic = self
                .traffic
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let mut active = std::collections::BTreeSet::new();
            for peer in &peers {
                let connection_id = peer.connection_id.get();
                active.insert(connection_id);
                let downloaded = peer.content.map_or(0, |content| {
                    content.useful_payload_bytes.try_into().unwrap_or(u64::MAX)
                });
                let uploaded = peer.upload.map_or(0, |upload| upload.payload_bytes);
                let previous = traffic.entry(connection_id).or_default();
                let peer_downloaded_delta = downloaded.saturating_sub(previous.0);
                let peer_uploaded_delta = uploaded.saturating_sub(previous.1);
                self.tracker_counters.add_downloaded(peer_downloaded_delta);
                self.tracker_counters.add_uploaded(peer_uploaded_delta);
                previous.0 = previous.0.max(downloaded);
                previous.1 = previous.1.max(uploaded);
            }
            traffic.retain(|connection_id, _| active.contains(connection_id));
            drop(traffic);
            let _ =
                self.views
                    .record_peer_connections(&self.torrent_id, captured_at, peers.as_slice());
            if incoming_observed && self.advertised_endpoint.observe_incoming() {
                let _ = self
                    .views
                    .set_advertised_peer_endpoint(self.advertised_endpoint.status(Instant::now()));
            }
        }
    }

    fn record_peer_registry(&self, active: bool, snapshot: PeerRegistrySnapshot) {
        if self.accepting.load(Ordering::Acquire) {
            let _ = self
                .views
                .record_peer_registry_state(&self.torrent_id, active, &snapshot);
        }
    }
}

#[derive(Debug)]
pub(crate) struct ActiveDownload {
    pub(crate) control: DownloadControl,
    pub(crate) task: JoinHandle<Result<(), String>>,
    pub(crate) eta_generation: u64,
}

#[derive(Debug, Default)]
struct SeedRegistrationState {
    transition_generation: u64,
    tokens: Vec<SeedRegistrationToken>,
    completed_storage: Option<CompletedStorageEvidence>,
}

#[derive(Clone, Debug)]
pub(crate) struct TorrentRuntimeHandle {
    generation: u64,
    identity: TorrentIdentityContext,
    peers: TorrentPeerHandle,
    seed_registration: Arc<Mutex<SeedRegistrationState>>,
    tracker_counters: TrackerCounters,
    accounting: TorrentAccountingOwner,
}

impl TorrentRuntimeHandle {
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn identity(&self) -> TorrentIdentityContext {
        self.identity
    }

    pub(crate) fn peers(&self) -> TorrentPeerHandle {
        self.peers.clone()
    }

    pub(crate) async fn reconcile_seed(
        &self,
        incoming: &IncomingSeeding,
        resume: &ResumeRecord,
        catalog_eligible: bool,
        root: Option<&StorageRootLocation>,
        active_download: bool,
        storage_file_pool: &StorageFilePool,
    ) -> Result<Option<SeedReconcileOutcome>, TorrentRuntimeError> {
        let (generation, current) = self.begin_seed_transition()?;
        let completed_storage = if !active_download && catalog_eligible {
            self.seed_state().completed_storage.take()
        } else {
            None
        };
        let result = incoming
            .reconcile(SeedReconcileInput {
                resume,
                catalog_eligible,
                root,
                active_download,
                current: current.clone(),
                torrent_peers: self.peers.clone(),
                byte_metric_sink: self.accounting_metric_sink(None),
                storage_file_pool,
                completed_storage,
            })
            .await;
        match result {
            Ok(result) => {
                self.finish_seed_transition(incoming, generation, result, active_download)
                    .await
            }
            Err(error) => {
                self.restore_failed_seed_transition(incoming, generation, current)
                    .await?;
                Err(error.into())
            }
        }
    }

    pub(crate) fn set_completed_storage_evidence(
        &self,
        evidence: Option<CompletedStorageEvidence>,
    ) {
        self.seed_state().completed_storage = evidence;
    }

    pub(crate) async fn unregister_seed(
        &self,
        incoming: &IncomingSeeding,
    ) -> Result<(), TorrentRuntimeError> {
        let tokens = {
            let mut state = self.seed_state();
            state.transition_generation = state
                .transition_generation
                .checked_add(1)
                .ok_or(TorrentRuntimeError::RegistrationGenerationExhausted)?;
            state.completed_storage = None;
            std::mem::take(&mut state.tokens)
        };
        incoming.unregister_all(tokens).await?;
        Ok(())
    }

    pub(crate) fn has_seed_registration(&self) -> bool {
        !self.seed_state().tokens.is_empty()
    }

    pub(crate) fn has_current_seed_registration(&self, incoming: &IncomingSeeding) -> bool {
        incoming.registrations_are_current(&self.seed_state().tokens)
    }

    pub(crate) fn tracker_counters(&self) -> TrackerCounters {
        self.tracker_counters.clone()
    }

    pub(crate) fn accounting(&self) -> TorrentAccountingOwner {
        self.accounting.clone()
    }

    pub(crate) fn accounting_metric_sink(
        &self,
        upstream: Option<Arc<dyn rstorrent_engine::ByteMetricSink>>,
    ) -> Arc<dyn rstorrent_engine::ByteMetricSink> {
        self.accounting
            .metric_sink(self.identity.torrent_id(), self.generation, upstream)
    }

    pub(crate) fn forget_seed_registration(&self) -> Result<(), TorrentRuntimeError> {
        let mut state = self.seed_state();
        state.transition_generation = state
            .transition_generation
            .checked_add(1)
            .ok_or(TorrentRuntimeError::RegistrationGenerationExhausted)?;
        state.tokens.clear();
        state.completed_storage = None;
        Ok(())
    }

    pub(crate) fn publish_inactive(&self) -> Result<(), TorrentRuntimeError> {
        self.peers.publish_inactive()?;
        Ok(())
    }

    fn begin_seed_transition(
        &self,
    ) -> Result<(u64, Vec<SeedRegistrationToken>), TorrentRuntimeError> {
        let mut state = self.seed_state();
        state.transition_generation = state
            .transition_generation
            .checked_add(1)
            .ok_or(TorrentRuntimeError::RegistrationGenerationExhausted)?;
        let generation = state.transition_generation;
        Ok((generation, std::mem::take(&mut state.tokens)))
    }

    async fn finish_seed_transition(
        &self,
        incoming: &IncomingSeeding,
        generation: u64,
        result: SeedReconcileResult,
        active_download: bool,
    ) -> Result<Option<SeedReconcileOutcome>, TorrentRuntimeError> {
        let (committed, stale_tokens, active) = {
            let mut state = self.seed_state();
            if state.transition_generation == generation {
                state.tokens = result.tokens;
                (
                    true,
                    Vec::new(),
                    active_download || !state.tokens.is_empty(),
                )
            } else {
                (false, result.tokens, !state.tokens.is_empty())
            }
        };
        incoming.unregister_all(stale_tokens).await?;
        if committed {
            if active {
                self.peers.publish_active(true)?;
            } else {
                self.peers.publish_inactive()?;
            }
            Ok(Some(result.outcome))
        } else {
            Ok(None)
        }
    }

    async fn restore_failed_seed_transition(
        &self,
        incoming: &IncomingSeeding,
        generation: u64,
        current: Vec<SeedRegistrationToken>,
    ) -> Result<(), TorrentRuntimeError> {
        let stale_tokens = {
            let mut state = self.seed_state();
            if state.transition_generation == generation {
                state.tokens = current;
                Vec::new()
            } else {
                current
            }
        };
        incoming.unregister_all(stale_tokens).await?;
        Ok(())
    }

    fn seed_state(&self) -> std::sync::MutexGuard<'_, SeedRegistrationState> {
        self.seed_registration
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(Debug)]
pub(crate) enum TorrentRuntimeError {
    Incoming(IncomingSeedingError),
    Peer(TorrentPeerError),
    RegistrationGenerationExhausted,
}

impl std::fmt::Display for TorrentRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Incoming(error) => write!(formatter, "{error}"),
            Self::Peer(error) => write!(formatter, "{error}"),
            Self::RegistrationGenerationExhausted => {
                formatter.write_str("seed registration transition generation exhausted")
            }
        }
    }
}

impl std::error::Error for TorrentRuntimeError {}

impl From<IncomingSeedingError> for TorrentRuntimeError {
    fn from(error: IncomingSeedingError) -> Self {
        Self::Incoming(error)
    }
}

impl From<TorrentPeerError> for TorrentRuntimeError {
    fn from(error: TorrentPeerError) -> Self {
        Self::Peer(error)
    }
}

#[derive(Debug)]
pub(crate) struct TorrentRuntime {
    generation: u64,
    accepting_peer_events: Arc<AtomicBool>,
    peers: TorrentPeerHandle,
    handle: TorrentRuntimeHandle,
    active_download: Option<ActiveDownload>,
}

impl TorrentRuntime {
    pub(crate) fn new(
        identity: TorrentIdentityContext,
        generation: u64,
        views: ViewHub,
        advertised_endpoint: AdvertisedPeerEndpointSelector,
        bandwidth: TorrentBandwidth,
        accounting: TorrentAccountingOwner,
    ) -> Result<Self, TorrentPeerError> {
        let accepting_peer_events = Arc::new(AtomicBool::new(true));
        let torrent_id = identity.torrent_id().to_string();
        let tracker_counters = TrackerCounters::unknown_metadata();
        let sink = Arc::new(TorrentPeerViewSink {
            torrent_id: torrent_id.clone(),
            accepting: accepting_peer_events.clone(),
            views,
            advertised_endpoint,
            tracker_counters: tracker_counters.clone(),
            traffic: Mutex::new(std::collections::BTreeMap::new()),
        });
        let peers = TorrentPeerHandle::new(sink)?;
        peers.install_bandwidth(bandwidth);
        let handle = TorrentRuntimeHandle {
            generation,
            identity,
            peers: peers.clone(),
            seed_registration: Arc::new(Mutex::new(SeedRegistrationState::default())),
            tracker_counters,
            accounting,
        };
        Ok(Self {
            generation,
            accepting_peer_events,
            peers,
            handle,
            active_download: None,
        })
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn peers(&self) -> TorrentPeerHandle {
        debug_assert_ne!(self.generation, 0);
        self.peers.clone()
    }

    pub(crate) fn handle(&self) -> TorrentRuntimeHandle {
        self.handle.clone()
    }

    pub(crate) fn active_download(&self) -> Option<&ActiveDownload> {
        self.active_download.as_ref()
    }

    pub(crate) fn set_active_download(&mut self, active: ActiveDownload) {
        debug_assert!(self.active_download.is_none());
        self.active_download = Some(active);
    }

    pub(crate) fn take_active_download(&mut self) -> Option<ActiveDownload> {
        self.active_download.take()
    }

    pub(crate) fn publish_inactive(&self) -> Result<(), TorrentPeerError> {
        self.peers.publish_inactive()
    }

    pub(crate) fn deactivate_peer_events(&self) {
        self.accepting_peer_events.store(false, Ordering::Release);
    }
}

impl Drop for TorrentRuntime {
    fn drop(&mut self) {
        if let Some(active) = &self.active_download {
            active.control.cancel();
        }
        self.accepting_peer_events.store(false, Ordering::Release);
    }
}
