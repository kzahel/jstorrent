//! Mutable view coordination and owned delivery registries.
//!
//! ViewHub owns current projection state behind one mutex, the weak legacy
//! subscriber registry, the leased-view-set registry, speed-interest wakeups,
//! and the sole cancellable lease-reaper task. It supplies immutable snapshots
//! and patches to lower delivery accumulators and never awaits with the hub
//! mutex held.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tokio::sync::Notify;
use tokio::task::{JoinError, JoinHandle};
use tokio_util::sync::CancellationToken;

use rstorrent_engine::peer::PeerRegistrySnapshot;
use rstorrent_engine::{
    CheckerProgress, DiskPieceRuntimeSnapshot, DiskRuntimeSnapshot, IntegrityPreparationProgress,
    MetadataAcquisitionProgress, PeerConnectionObservation, TrackerRuntimeSnapshot,
};

use crate::control::{ServiceSnapshot, StorageState, TorrentState};
use crate::diagnostics::{
    DiagnosticCategory, DiagnosticDraft, DiagnosticEvent, DiagnosticField, DiagnosticFilter,
    DiagnosticSeverity, DiagnosticStore, diagnostic_matches, interest_matches,
};
use crate::file_views::{FileCatalogState, FileProgressModel, FileViewChange};
use crate::media_catalog_views::{MediaCatalogState, MediaItemView};
use crate::settings::{
    ActiveDownloadsClampReason, ActiveSeedLimit, AdvertisedPeerEndpointStatus,
    ClientSettingsApplicationState, ClientSettingsDegradedReason, ClientSettingsRuntimeView,
    Ipv6PinholeStatus, MAX_RUNTIME_DETAIL_BYTES, PortMappingStatus, SettingsDomainGeneration,
    StorageSettingsSnapshot, bounded_utf8,
};
use crate::speed::SessionRateHistory;
use crate::tracker_views::{TrackerCatalogState, TrackerViewModel};

use super::contract::{
    MAX_VIEW_SET_WAIT_MILLIS, MAX_VIEW_SETS, MAX_VIEW_SETS_PER_OWNER,
    MIN_VIEW_SET_EVICTION_IDLE_MILLIS,
};
use super::diff::{
    disk_patch, patch_for, projection_requires_snapshot, targeted_activity_patch,
    targeted_peer_patch, targeted_swarm_patch, targeted_torrent_view_patch, targeted_tracker_patch,
};
use super::model::{operational_state, swarm_model};
use super::ranges::{insert_range, range_cardinality};
use super::subscription::{QueueState, SubscriberInner, parse_revision};
use super::view_set::{
    PollState, ViewSetInitialState, ViewSetInner, generate_view_set_id, parse_decimal,
    validated_open, validated_update,
};
use super::*;

mod library;

use library::{LibraryChange, LibraryState, library_progress_changed};

static NEXT_EPOCH: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug)]
pub struct ViewHub {
    pub(crate) inner: Arc<Mutex<HubState>>,
    pub(crate) speed_interest: Arc<Notify>,
}

#[derive(Debug)]
pub(crate) struct HubState {
    pub(crate) clock_origin: Instant,
    pub(crate) epoch: u64,
    pub(crate) revision: u64,
    pub(super) torrents: BTreeMap<String, TorrentModel>,
    storage: StorageSettingsSnapshot,
    client_settings: ClientSettingsRuntimeView,
    client_settings_attempt_generation: Option<u64>,
    client_settings_mapping_generation: Option<SettingsDomainGeneration>,
    disk: DiskSessionModel,
    dht: DhtInspectionView,
    speed: Arc<Mutex<SessionRateHistory>>,
    diagnostics: DiagnosticStore,
    subscribers: BTreeMap<u64, Weak<SubscriberInner>>,
    next_stream_id: u64,
    pub(crate) view_sets: BTreeMap<String, Arc<ViewSetInner>>,
    pub(crate) view_set_lease: Duration,
    library: LibraryState,
}

#[derive(Clone, Debug)]
pub struct ViewSubscription {
    inner: Arc<SubscriberInner>,
    hub: Weak<Mutex<HubState>>,
}

impl ViewHub {
    #[cfg(test)]
    pub(crate) fn client_settings_for_testing(&self) -> ClientSettingsRuntimeView {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .client_settings
            .clone()
    }

    pub fn new(snapshot: &ServiceSnapshot) -> Result<Self, SubscriptionError> {
        Self::new_with_view_set_lease(snapshot, Duration::from_millis(VIEW_SET_LEASE_MILLIS))
    }

    pub(crate) fn new_with_view_set_lease(
        snapshot: &ServiceSnapshot,
        view_set_lease: Duration,
    ) -> Result<Self, SubscriptionError> {
        Self::new_with_speed_history(
            snapshot,
            view_set_lease,
            Arc::new(Mutex::new(SessionRateHistory::new())),
        )
    }

    pub(crate) fn new_with_speed_history(
        snapshot: &ServiceSnapshot,
        view_set_lease: Duration,
        speed: Arc<Mutex<SessionRateHistory>>,
    ) -> Result<Self, SubscriptionError> {
        Self::new_with_runtime_views(
            snapshot,
            view_set_lease,
            speed,
            DhtInspectionView::inactive(),
            ClientSettingsRuntimeView::from_configured(snapshot.client_settings.clone()),
        )
    }

    pub(crate) fn new_with_runtime_views(
        snapshot: &ServiceSnapshot,
        view_set_lease: Duration,
        speed: Arc<Mutex<SessionRateHistory>>,
        dht: DhtInspectionView,
        client_settings: ClientSettingsRuntimeView,
    ) -> Result<Self, SubscriptionError> {
        let revision = parse_revision(&snapshot.revision)?;
        Ok(Self {
            inner: Arc::new(Mutex::new(HubState {
                clock_origin: Instant::now(),
                epoch: NEXT_EPOCH.fetch_add(1, Ordering::Relaxed),
                revision,
                torrents: snapshot
                    .torrents
                    .iter()
                    .map(|torrent| {
                        (
                            torrent.torrent_id.clone(),
                            TorrentModel::from_snapshot(torrent),
                        )
                    })
                    .collect(),
                storage: snapshot.storage.clone(),
                client_settings,
                client_settings_attempt_generation: None,
                client_settings_mapping_generation: None,
                disk: DiskSessionModel::default(),
                dht,
                speed,
                diagnostics: DiagnosticStore::default(),
                subscribers: BTreeMap::new(),
                next_stream_id: 1,
                view_sets: BTreeMap::new(),
                view_set_lease,
                library: LibraryState::default(),
            })),
            speed_interest: Arc::new(Notify::new()),
        })
    }

    pub(crate) fn view_set_lease(&self) -> Duration {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .view_set_lease
    }

    pub fn subscribe(&self, spec: SubscriptionSpec) -> Result<ViewSubscription, SubscriptionError> {
        validate_spec(&spec)?;
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let stream_id = hub.next_stream_id;
        hub.next_stream_id = hub
            .next_stream_id
            .checked_add(1)
            .ok_or_else(|| SubscriptionError::Internal("stream ID overflow".to_owned()))?;
        let snapshot = hub.snapshot_for(&spec);
        hub.remember_library_snapshot(&spec, &snapshot);
        let inner = Arc::new(SubscriberInner {
            stream_id,
            epoch: hub.epoch,
            spec,
            queue: Mutex::new(QueueState {
                entries: VecDeque::new(),
                queued_bytes: 0,
                queue_high_water: 0,
                reset_count: 0,
                next_sequence: 1,
                tail_revision: hub.revision,
                next_delivery: tokio::time::Instant::now(),
                needs_resync: false,
                speed_history: None,
                closed: false,
            }),
            notify: Notify::new(),
        });
        inner.enqueue_snapshot(hub.revision, snapshot)?;
        hub.subscribers.insert(stream_id, Arc::downgrade(&inner));
        self.speed_interest.notify_one();
        Ok(ViewSubscription {
            inner,
            hub: Arc::downgrade(&self.inner),
        })
    }

    pub(crate) fn speed_tick_interval(&self) -> Option<Duration> {
        let Ok(mut hub) = self.inner.lock() else {
            return None;
        };
        hub.subscribers.retain(|_, weak| weak.strong_count() != 0);
        let direct = hub
            .subscribers
            .values()
            .filter_map(Weak::upgrade)
            .filter_map(|subscriber| match &subscriber.spec.selector {
                ViewSelector::SessionCurrentRates { .. } => {
                    Some(u64::from(subscriber.spec.delivery.min_interval_millis).max(100))
                }
                ViewSelector::SessionSpeedHistory { range, .. } => range.tick_millis(),
                _ => None,
            })
            .min();
        hub.retain_live_view_sets();
        let leased = hub
            .view_sets
            .values()
            .filter_map(|view_set| {
                view_set.view_specs().ok().and_then(|specs| {
                    specs
                        .iter()
                        .filter_map(|spec| match spec {
                            crate::ViewSpec::SessionCurrentRates { delivery, .. } => {
                                Some(u64::from(delivery.min_interval_millis).max(100))
                            }
                            crate::ViewSpec::SessionSpeedHistory { range, .. } => {
                                range.tick_millis()
                            }
                            _ => None,
                        })
                        .min()
                })
            })
            .min();
        direct
            .into_iter()
            .chain(leased)
            .min()
            .map(Duration::from_millis)
    }

    pub(crate) fn speed_interest_notify(&self) -> Arc<Notify> {
        self.speed_interest.clone()
    }

    pub(crate) fn publish_speed_tick(&self) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let now_millis = {
            let mut speed = hub
                .speed
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let now_millis = speed.now_millis();
            speed.advance_to(now_millis);
            now_millis
        };
        let revision = hub.revision;
        hub.subscribers.retain(|_, weak| weak.strong_count() != 0);
        let subscribers = hub
            .subscribers
            .values()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>();
        for subscriber in subscribers {
            match &subscriber.spec.selector {
                ViewSelector::SessionCurrentRates { metrics } => {
                    let rates = hub
                        .speed
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .current_rates(metrics, now_millis);
                    subscriber.enqueue_patch(revision, ViewPatch::SessionCurrentRates { rates })?;
                }
                ViewSelector::SessionSpeedHistory { range, metrics } => {
                    let history = hub
                        .speed
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .view(*range, metrics, now_millis);
                    subscriber.enqueue_speed_history(revision, history)?;
                }
                _ => {}
            }
        }
        hub.retain_live_view_sets();
        let view_sets = hub.view_sets.values().cloned().collect::<Vec<_>>();
        for view_set in view_sets {
            for spec in view_set.view_specs()? {
                match &spec {
                    crate::ViewSpec::SessionCurrentRates { metrics, .. } => {
                        let rates = hub
                            .speed
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .current_rates(metrics, now_millis);
                        view_set.enqueue_patch(
                            spec.view_id(),
                            ViewPatch::SessionCurrentRates { rates },
                            revision,
                        )?;
                    }
                    crate::ViewSpec::SessionSpeedHistory { range, metrics, .. } => {
                        let history = hub
                            .speed
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .view(*range, metrics, now_millis);
                        view_set.enqueue_speed_history(spec.view_id(), history, revision)?;
                    }
                    _ => {}
                }
            }
        }
        Ok(())
    }

    pub(crate) fn publish_dht(
        &self,
        inspection: DhtInspectionView,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        if hub.dht == inspection {
            return Ok(());
        }
        hub.dht = inspection.clone();
        let revision = hub.revision;
        hub.subscribers.retain(|_, weak| weak.strong_count() != 0);
        let subscribers = hub
            .subscribers
            .values()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>();
        for subscriber in subscribers {
            if matches!(subscriber.spec.selector, ViewSelector::SessionDht) {
                subscriber.enqueue_patch(
                    revision,
                    ViewPatch::SessionDht {
                        inspection: inspection.clone(),
                    },
                )?;
            }
        }
        hub.retain_live_view_sets();
        let view_sets = hub.view_sets.values().cloned().collect::<Vec<_>>();
        for view_set in view_sets {
            for spec in view_set.view_specs()? {
                if matches!(spec, crate::ViewSpec::SessionDht { .. }) {
                    view_set.enqueue_patch(
                        spec.view_id(),
                        ViewPatch::SessionDht {
                            inspection: inspection.clone(),
                        },
                        revision,
                    )?;
                }
            }
        }
        Ok(())
    }

    pub(crate) fn replace_durable(
        &self,
        snapshot: &ServiceSnapshot,
        durable: &BTreeMap<String, DurableTorrentViewState>,
    ) -> Result<(), SubscriptionError> {
        let revision = parse_revision(&snapshot.revision)?;
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let previous = hub.torrents.clone();
        let previous_storage = hub.storage.clone();
        let previous_client_settings = hub.client_settings.clone();
        let previous_disk = hub.disk.view(&hub.torrents);
        let mut next = BTreeMap::new();
        let now = Instant::now();
        for torrent in &snapshot.torrents {
            let mut model = TorrentModel::from_snapshot(torrent);
            let durable_state = durable.get(&torrent.torrent_id);
            if let Some(state) = durable.get(&torrent.torrent_id) {
                model.view.display_name = state.display_name.clone();
                model.view.source_display_name = state.source_display_name.clone();
                model.view.source_size_bytes =
                    state.source_size_bytes.map(|bytes| bytes.to_string());
                model.view.private_torrent = state.private_torrent;
                model.view.lifetime = state.lifetime.clone();
                model.view.seeding = state.seeding.clone();
                model.progress_inputs.seed_admission = state.seeding.admission;
                model.verified = state.verified.clone();
                model.files = state.files.clone();
                model.trackers = state.trackers.clone();
            } else if let Some(old) = previous.get(&torrent.torrent_id) {
                model.view.display_name = old.view.display_name.clone();
                model.view.source_display_name = old.view.source_display_name.clone();
                model.view.source_size_bytes = old.view.source_size_bytes.clone();
                model.view.private_torrent = old.view.private_torrent;
                model.view.lifetime = old.view.lifetime.clone();
                model.view.seeding = old.view.seeding.clone();
                model.progress_inputs.seed_admission = old.view.seeding.admission;
                model.verified = old.verified.clone();
                model.files = old.files.clone();
                model.trackers = old.trackers.clone();
            }
            if let Some(old) = previous.get(&torrent.torrent_id) {
                let eta_selection_unchanged = match (&old.files, &model.files) {
                    (None, _) => true,
                    (Some(old), Some(current)) => old.eta_selection_matches(current),
                    (Some(_), None) => false,
                };
                model.eta = old.eta.clone();
                model.view.requested_bytes = old.view.requested_bytes.clone();
                model.view.received_bytes = old.view.received_bytes.clone();
                model.view.stored_bytes = old.view.stored_bytes.clone();
                model.view.active_peer_connections = old.view.active_peer_connections;
                model.view.payload_download_rate_bytes =
                    old.view.payload_download_rate_bytes.clone();
                model.view.checking = old.view.checking.clone();
                model.preparation = old.preparation.clone();
                model.progress_inputs = old.progress_inputs;
                model.progress_inputs.seed_admission = model.view.seeding.admission;
                model.view.progress = assess_progress(torrent, model.progress_inputs);
                model.view.operational_state = operational_state(torrent, model.progress_inputs);
                model.active = old.active.clone();
                model.peers = old.peers.clone();
                model.swarm = old.swarm.clone();
                if let (Some(old_files), Some(durable_files)) = (&old.files, model.files.as_ref())
                    && old_files.catalog_matches(durable_files)
                {
                    let mut reconciled = old_files.clone();
                    reconciled
                        .reconcile_verified(&durable_files.verified_piece_indices())
                        .map_err(|error| SubscriptionError::Internal(error.to_string()))?;
                    model.files = Some(reconciled);
                }
                if old.trackers.catalog_matches(&model.trackers) {
                    model.trackers = old.trackers.clone();
                }
                if let Some(state) = durable_state {
                    model.eta.reconcile_geometry(
                        state.eta_geometry,
                        eta_selection_unchanged,
                        torrent.state == TorrentState::Downloading
                            && model.progress_inputs.task_active,
                        now,
                    );
                }
            } else if let Some(state) = durable_state {
                model
                    .eta
                    .reconcile_geometry(state.eta_geometry, true, false, now);
            }
            if torrent.state == TorrentState::Checking
                && let Some(generation) = durable_state.and_then(|state| state.checking_generation)
                && model
                    .view
                    .checking
                    .as_ref()
                    .is_none_or(|checking| checking.generation != generation.to_string())
            {
                model.queue_checker(generation);
            }
            model.eta.apply_to_view(&mut model.view);
            model.view.total_size_bytes = model
                .files
                .as_ref()
                .map(|files| files.total_length().to_string());
            model.view.configured_tracker_count = Some(model.trackers.count());
            next.insert(torrent.torrent_id.clone(), model);
        }
        hub.revision = revision;
        hub.torrents = next;
        hub.storage = snapshot.storage.clone();
        hub.client_settings
            .set_configured(snapshot.client_settings.clone());
        let current_torrent_ids = hub.torrents.keys().cloned().collect::<BTreeSet<_>>();
        hub.disk.retain(&current_torrent_ids);
        let current_disk = hub.disk.view(&hub.torrents);
        hub.publish_changes(
            &previous,
            Some(&previous_storage),
            Some(&previous_client_settings),
        )?;
        if previous_disk != current_disk {
            hub.publish_disk_changes(&previous_disk, &current_disk)?;
        }
        Ok(())
    }

    pub(crate) fn set_client_settings_mapping_generation(
        &self,
        generation: SettingsDomainGeneration,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        hub.client_settings_attempt_generation = Some(generation.attempt());
        hub.client_settings_mapping_generation = Some(generation);
        Ok(())
    }

    pub(crate) fn replace_network_runtime_views(
        &self,
        dht: DhtInspectionView,
        mut client_settings: ClientSettingsRuntimeView,
    ) -> Result<(), SubscriptionError> {
        {
            let mut hub = self
                .inner
                .lock()
                .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
            let previous_torrents = hub.torrents.clone();
            let previous_client_settings = hub.client_settings.clone();
            client_settings.application_network =
                previous_client_settings.application_network.clone();
            hub.client_settings = client_settings;
            hub.client_settings_attempt_generation = None;
            hub.client_settings_mapping_generation = None;
            hub.publish_changes(&previous_torrents, None, Some(&previous_client_settings))?;
        }
        self.publish_dht(dht)
    }

    pub(crate) fn set_application_network_runtime(
        &self,
        runtime: crate::ApplicationNetworkRuntimeView,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let previous_torrents = hub.torrents.clone();
        let previous_client_settings = hub.client_settings.clone();
        hub.client_settings.application_network = runtime;
        hub.publish_changes(&previous_torrents, None, Some(&previous_client_settings))
    }

    pub(crate) fn set_waiting_for_unmetered_network(
        &self,
        waiting: bool,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let previous = hub.torrents.clone();
        for model in hub.torrents.values_mut() {
            model.progress_inputs.waiting_for_unmetered_network = waiting;
            model.view.progress = assess_progress(&model.snapshot, model.progress_inputs);
            model.view.operational_state =
                operational_state(&model.snapshot, model.progress_inputs);
        }
        hub.publish_changes(&previous, None, None)
    }

    pub(crate) fn begin_client_settings_attempt(
        &self,
        generation: SettingsDomainGeneration,
        configured: crate::ClientSettings,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let previous_torrents = hub.torrents.clone();
        let previous_client_settings = hub.client_settings.clone();
        hub.client_settings_attempt_generation = Some(generation.attempt());
        hub.client_settings_mapping_generation = Some(generation);
        hub.client_settings.configured = configured;
        hub.client_settings.transport_application = ClientSettingsApplicationState::Applying;
        hub.client_settings.port_mapping_application = ClientSettingsApplicationState::Applying;
        hub.client_settings.peer_connections_application = ClientSettingsApplicationState::Applying;
        hub.client_settings.upload_slots_application = ClientSettingsApplicationState::Applying;
        hub.client_settings.bandwidth_application = ClientSettingsApplicationState::Applying;
        hub.publish_changes(&previous_torrents, None, Some(&previous_client_settings))
    }

    pub(crate) fn set_port_mapping_status_for(
        &self,
        generation: SettingsDomainGeneration,
        status: PortMappingStatus,
    ) -> Result<bool, SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        if hub.client_settings_mapping_generation != Some(generation) {
            return Ok(false);
        }
        if hub.client_settings.port_mapping_status == status {
            return Ok(true);
        }
        let previous_torrents = hub.torrents.clone();
        let previous_client_settings = hub.client_settings.clone();
        let degraded = match &status {
            PortMappingStatus::Failed { detail, .. }
            | PortMappingStatus::RenewalFailed { detail, .. }
            | PortMappingStatus::CleanupFailed { detail, .. } => {
                Some(ClientSettingsApplicationState::Degraded {
                    reason: ClientSettingsDegradedReason::PortMappingFailed,
                    detail: bounded_utf8(detail, MAX_RUNTIME_DETAIL_BYTES),
                })
            }
            _ => None,
        };
        hub.client_settings.set_port_mapping_status(status);
        if let Some(degraded) = degraded {
            hub.client_settings.port_mapping_application = degraded;
        }
        hub.publish_changes(&previous_torrents, None, Some(&previous_client_settings))?;
        Ok(true)
    }

    pub(crate) fn set_udp_port_mapping_status_for(
        &self,
        generation: SettingsDomainGeneration,
        status: PortMappingStatus,
    ) -> Result<bool, SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        if hub.client_settings_mapping_generation != Some(generation) {
            return Ok(false);
        }
        if hub.client_settings.udp_port_mapping_status == status {
            return Ok(true);
        }
        let previous_torrents = hub.torrents.clone();
        let previous_client_settings = hub.client_settings.clone();
        let degraded = match &status {
            PortMappingStatus::Failed { detail, .. }
            | PortMappingStatus::RenewalFailed { detail, .. }
            | PortMappingStatus::CleanupFailed { detail, .. } => {
                Some(ClientSettingsApplicationState::Degraded {
                    reason: ClientSettingsDegradedReason::PortMappingFailed,
                    detail: bounded_utf8(detail, MAX_RUNTIME_DETAIL_BYTES),
                })
            }
            _ => None,
        };
        hub.client_settings.set_udp_port_mapping_status(status);
        if let Some(degraded) = degraded {
            hub.client_settings.port_mapping_application = degraded;
        }
        hub.publish_changes(&previous_torrents, None, Some(&previous_client_settings))?;
        Ok(true)
    }

    pub(crate) fn set_ipv6_pinhole_status_for(
        &self,
        generation: SettingsDomainGeneration,
        status: Ipv6PinholeStatus,
    ) -> Result<bool, SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        if hub.client_settings_mapping_generation != Some(generation) {
            return Ok(false);
        }
        if hub.client_settings.ipv6_pinhole_status == status {
            return Ok(true);
        }
        let previous_torrents = hub.torrents.clone();
        let previous_client_settings = hub.client_settings.clone();
        hub.client_settings.set_ipv6_pinhole_status(status);
        hub.publish_changes(&previous_torrents, None, Some(&previous_client_settings))?;
        Ok(true)
    }

    pub(crate) fn update_client_settings_runtime_for(
        &self,
        generation: SettingsDomainGeneration,
        update: impl FnOnce(&mut ClientSettingsRuntimeView),
    ) -> Result<bool, SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        if hub.client_settings_attempt_generation != Some(generation.attempt()) {
            return Ok(false);
        }
        let previous_client_settings = hub.client_settings.clone();
        update(&mut hub.client_settings);
        if hub.client_settings == previous_client_settings {
            return Ok(true);
        }
        let previous_torrents = hub.torrents.clone();
        hub.publish_changes(&previous_torrents, None, Some(&previous_client_settings))?;
        Ok(true)
    }

    pub(crate) fn set_bandwidth_runtime(
        &self,
        bandwidth: crate::BandwidthRuntimeView,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        if hub.client_settings.bandwidth == bandwidth {
            return Ok(());
        }
        let previous_client_settings = hub.client_settings.clone();
        hub.client_settings.bandwidth = bandwidth;
        let previous_torrents = hub.torrents.clone();
        hub.publish_changes(&previous_torrents, None, Some(&previous_client_settings))
    }

    pub(crate) fn set_download_admission_state(
        &self,
        effective_active_downloads: u16,
        clamp_reason: Option<ActiveDownloadsClampReason>,
        active_download_count: u16,
        checking_count: u16,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let previous_client_settings = hub.client_settings.clone();
        hub.client_settings.effective_active_downloads = effective_active_downloads;
        hub.client_settings.active_downloads_clamp_reason = clamp_reason;
        hub.client_settings.active_download_count = active_download_count;
        hub.client_settings.checking_count = checking_count;
        if hub.client_settings == previous_client_settings {
            return Ok(());
        }
        let previous_torrents = hub.torrents.clone();
        hub.publish_changes(&previous_torrents, None, Some(&previous_client_settings))
    }

    pub(crate) fn set_seed_admission_state(
        &self,
        effective_active_seeds: ActiveSeedLimit,
        active_seed_count: u16,
        inactive_seed_count: u16,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let previous_client_settings = hub.client_settings.clone();
        hub.client_settings.effective_active_seeds = effective_active_seeds;
        hub.client_settings.active_seed_count = active_seed_count;
        hub.client_settings.inactive_seed_count = inactive_seed_count;
        if hub.client_settings == previous_client_settings {
            return Ok(());
        }
        let previous_torrents = hub.torrents.clone();
        hub.publish_changes(&previous_torrents, None, Some(&previous_client_settings))
    }

    pub(crate) fn set_advertised_peer_endpoint(
        &self,
        status: AdvertisedPeerEndpointStatus,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        if hub.client_settings.advertised_peer_endpoint == status {
            return Ok(());
        }
        let previous_torrents = hub.torrents.clone();
        let previous_client_settings = hub.client_settings.clone();
        hub.client_settings.set_advertised_peer_endpoint(status);
        hub.publish_changes(&previous_torrents, None, Some(&previous_client_settings))
    }

    #[cfg(test)]
    pub(crate) fn record_activity(
        &self,
        torrent_id: &str,
        activity: TorrentActivity,
    ) -> Result<(), SubscriptionError> {
        self.record_generation_activity(torrent_id, None, Instant::now(), activity)
    }

    pub(crate) fn record_generation_activity(
        &self,
        torrent_id: &str,
        eta_generation: Option<u64>,
        now: Instant,
        activity: TorrentActivity,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        let previous_view = model.view.clone();
        let previous_verified = model.verified.clone();
        let previous_active = model.active.clone();
        let eta_result = match (eta_generation, &activity) {
            (Some(generation), TorrentActivity::BlockReceived { length, .. }) => {
                model.eta.block_received(generation, *length, now)
            }
            (Some(generation), TorrentActivity::PieceHashFailed { failed_bytes, .. }) => {
                model.eta.piece_hash_failed(generation, *failed_bytes, now)
            }
            _ => Ok(false),
        };
        if eta_result.is_err() {
            model.eta.fail_closed();
        }
        let file_changes = model
            .apply_activity(activity)
            .map_err(|error| SubscriptionError::Internal(error.to_string()))?;
        model.eta.apply_to_view(&mut model.view);
        let next_view = model.view.clone();
        let next_verified = model.verified.clone();
        let next_active = model.active.clone();
        let media_upsert = model.files.as_ref().map_or_else(Vec::new, |files| {
            file_changes
                .iter()
                .filter_map(|change| {
                    usize::try_from(change.current.file_index)
                        .ok()
                        .and_then(|index| files.media_row(index))
                })
                .collect()
        });
        let publish_result = hub.publish_activity_changes(
            torrent_id,
            &previous_view,
            &next_view,
            &previous_verified,
            &next_verified,
            &previous_active,
            &next_active,
            &file_changes,
            &media_upsert,
        );
        publish_result?;
        eta_result
            .map(|_| ())
            .map_err(|error| SubscriptionError::Internal(error.to_string()))
    }

    pub(crate) fn record_metadata_preparation(
        &self,
        torrent_id: &str,
        generation: Option<u64>,
        progress: &MetadataAcquisitionProgress,
    ) -> Result<(), SubscriptionError> {
        let Some(generation) = generation else {
            return Ok(());
        };
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let previous = hub.torrents.clone();
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        if !model.apply_metadata_preparation(generation, progress) {
            return Ok(());
        }
        hub.publish_changes(&previous, None, None)
    }

    pub(crate) fn finish_metadata_preparation(
        &self,
        torrent_id: &str,
        generation: Option<u64>,
    ) -> Result<(), SubscriptionError> {
        let Some(generation) = generation else {
            return Ok(());
        };
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let previous = hub.torrents.clone();
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        if !model.finish_metadata_preparation(generation) {
            return Ok(());
        }
        hub.publish_changes(&previous, None, None)
    }

    pub(crate) fn record_integrity_preparation(
        &self,
        torrent_id: &str,
        generation: Option<u64>,
        progress: IntegrityPreparationProgress,
    ) -> Result<(), SubscriptionError> {
        let Some(generation) = generation else {
            return Ok(());
        };
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let previous = hub.torrents.clone();
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        if !model.apply_integrity_preparation(generation, progress) {
            return Ok(());
        }
        hub.publish_changes(&previous, None, None)
    }

    pub(crate) fn reserve_eta_generation(
        &self,
        torrent_id: &str,
    ) -> Result<u64, SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let model = hub.torrents.get_mut(torrent_id).ok_or_else(|| {
            SubscriptionError::Internal(format!("torrent {torrent_id} has no view model"))
        })?;
        model
            .eta
            .reserve_generation()
            .map_err(|error| SubscriptionError::Internal(error.to_string()))
    }

    pub(crate) fn activate_eta_generation(
        &self,
        torrent_id: &str,
        generation: u64,
        now: Instant,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let previous = hub.torrents.clone();
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        if !model.eta.activate_generation(generation, now) {
            return Err(SubscriptionError::Internal(format!(
                "torrent {torrent_id} ETA generation {generation} is stale"
            )));
        }
        model.reset_preparation();
        model.eta.apply_to_view(&mut model.view);
        hub.publish_changes(&previous, None, None)
    }

    pub(crate) fn deactivate_eta_generation(
        &self,
        torrent_id: &str,
        generation: u64,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let previous = hub.torrents.clone();
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        if !model.eta.deactivate_generation(generation) {
            return Ok(());
        }
        model.clear_preparation(generation);
        model.eta.apply_to_view(&mut model.view);
        hub.publish_changes(&previous, None, None)
    }

    pub(crate) fn record_eta_tick(&self, now: Instant) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let mut changes = Vec::new();
        let mut first_error = None;
        for (torrent_id, model) in &mut hub.torrents {
            let previous = model.view.clone();
            if let Err(error) = model.eta.tick(now) {
                model.eta.fail_closed();
                first_error.get_or_insert_with(|| error.to_string());
            }
            model.eta.apply_to_view(&mut model.view);
            if previous != model.view {
                changes.push((torrent_id.clone(), previous, model.view.clone()));
            }
        }
        hub.publish_torrent_view_changes(&changes)?;
        if let Some(error) = first_error {
            return Err(SubscriptionError::Internal(error));
        }
        Ok(())
    }

    pub(crate) fn record_disk_runtime(
        &self,
        torrent_id: &str,
        snapshot: &DiskRuntimeSnapshot,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        if !hub.torrents.contains_key(torrent_id) {
            return Ok(());
        }
        let previous = hub.disk.view(&hub.torrents);
        hub.disk.update(torrent_id, snapshot);
        let current = hub.disk.view(&hub.torrents);
        if previous != current {
            hub.publish_disk_changes(&previous, &current)?;
        }
        Ok(())
    }

    pub(crate) fn record_piece_runtime(
        &self,
        torrent_id: &str,
        pieces: &[DiskPieceRuntimeSnapshot],
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        let previous_view = model.view.clone();
        let previous_verified = model.verified.clone();
        let previous_active = model.active.clone();
        model.reconcile_piece_runtime(pieces);
        let next_view = model.view.clone();
        let next_verified = model.verified.clone();
        let next_active = model.active.clone();
        if previous_active != next_active {
            hub.publish_activity_changes(
                torrent_id,
                &previous_view,
                &next_view,
                &previous_verified,
                &next_verified,
                &previous_active,
                &next_active,
                &[],
                &[],
            )?;
        }
        Ok(())
    }

    pub(crate) fn clear_disk_runtime(&self, torrent_id: &str) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let previous = hub.disk.view(&hub.torrents);
        hub.disk.torrents.remove(torrent_id);
        let current = hub.disk.view(&hub.torrents);
        if previous != current {
            hub.publish_disk_changes(&previous, &current)?;
        }
        Ok(())
    }

    pub(crate) fn clear_piece_runtime(&self, torrent_id: &str) -> Result<(), SubscriptionError> {
        self.record_piece_runtime(torrent_id, &[])
    }

    pub(crate) fn record_pieces_durable(
        &self,
        torrent_id: &str,
        piece_indices: &[u32],
        revision: u64,
    ) -> Result<(), SubscriptionError> {
        if piece_indices.is_empty() {
            return Ok(());
        }
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        let previous_view = model.view.clone();
        let previous_verified = model.verified.clone();
        let previous_active = model.active.clone();
        let mut next = model.clone();
        let mut file_changes = BTreeMap::new();
        for &piece_index in piece_indices {
            if piece_index >= next.view.piece_count {
                return Err(SubscriptionError::Internal(format!(
                    "durable piece {piece_index} is outside {} pieces",
                    next.view.piece_count
                )));
            }
            insert_range(&mut next.verified, piece_index, 1);
            if let Some(files) = next.files.as_mut() {
                for change in files
                    .piece_verified(piece_index)
                    .map_err(|error| SubscriptionError::Internal(error.to_string()))?
                {
                    file_changes
                        .entry(change.current.file_id.clone())
                        .and_modify(|existing: &mut FileViewChange| {
                            existing.current = change.current.clone();
                        })
                        .or_insert(change);
                }
            }
        }
        next.view.verified_piece_count =
            range_cardinality(&next.verified).min(u64::from(u32::MAX)) as u32;
        next.snapshot.verified_piece_count = next.view.verified_piece_count;
        next.view.storage_state = StorageState::Available;
        next.snapshot.storage_state = StorageState::Available;
        let next_view = next.view.clone();
        let next_verified = next.verified.clone();
        let next_active = next.active.clone();
        let file_changes = file_changes.into_values().collect::<Vec<_>>();
        let media_upsert = next.files.as_ref().map_or_else(Vec::new, |files| {
            file_changes
                .iter()
                .filter_map(|change| {
                    usize::try_from(change.current.file_index)
                        .ok()
                        .and_then(|index| files.media_row(index))
                })
                .collect()
        });
        *model = next;
        hub.revision = revision;
        hub.publish_activity_changes(
            torrent_id,
            &previous_view,
            &next_view,
            &previous_verified,
            &next_verified,
            &previous_active,
            &next_active,
            &file_changes,
            &media_upsert,
        )
    }

    pub(crate) fn record_checker_progress(
        &self,
        torrent_id: &str,
        progress: &CheckerProgress,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        let previous = model.view.clone();
        if model
            .view
            .checking
            .as_ref()
            .and_then(|checking| checking.generation.parse::<u64>().ok())
            .is_some_and(|generation| generation > progress.generation)
        {
            return Ok(());
        }
        model.apply_checker_progress(progress);
        let current = model.view.clone();
        hub.publish_torrent_view_changes(&[(torrent_id.to_owned(), previous, current)])
    }

    pub(crate) fn finish_checker(
        &self,
        torrent_id: &str,
        generation: u64,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        let previous = model.view.clone();
        model.finish_checker(generation);
        let current = model.view.clone();
        hub.publish_torrent_view_changes(&[(torrent_id.to_owned(), previous, current)])
    }

    pub(crate) fn set_progress_inputs(
        &self,
        torrent_id: &str,
        inputs: ProgressInputs,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        let previous = model.view.clone();
        // The application admission owner supplies this fact through durable
        // replacement. Content-task cleanup must not reset it to Ineligible.
        let inputs = ProgressInputs {
            seed_admission: model.view.seeding.admission,
            ..inputs
        };
        model.progress_inputs = inputs;
        model.view.progress = assess_progress(&model.snapshot, inputs);
        model.view.operational_state = operational_state(&model.snapshot, inputs);
        model.eta.set_transfer_applicable(
            model.snapshot.state == TorrentState::Downloading && inputs.task_active,
            Instant::now(),
        );
        model.eta.apply_to_view(&mut model.view);
        let current = model.view.clone();
        hub.publish_torrent_view_changes(&[(torrent_id.to_owned(), previous, current)])
    }

    pub(crate) fn set_discovery_activity(
        &self,
        torrent_id: &str,
        active: bool,
        retry_scheduled: bool,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let previous = hub.torrents.clone();
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        if model.snapshot.state != TorrentState::AwaitingMetadata {
            return Ok(());
        }
        model.progress_inputs.task_active = active;
        model.progress_inputs.discovery_active = active;
        model.progress_inputs.discovery_retry_scheduled = retry_scheduled;
        model.progress_inputs.discovery_exhausted = false;
        model.view.progress = assess_progress(&model.snapshot, model.progress_inputs);
        model.view.operational_state = operational_state(&model.snapshot, model.progress_inputs);
        hub.publish_changes(&previous, None, None)
    }

    pub(crate) fn set_stopping(
        &self,
        torrent_id: &str,
        stopping: bool,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        let previous = model.view.clone();
        model.progress_inputs.stopping = stopping;
        model.view.operational_state = operational_state(&model.snapshot, model.progress_inputs);
        let current = model.view.clone();
        hub.publish_torrent_view_changes(&[(torrent_id.to_owned(), previous, current)])
    }

    pub(crate) fn record_peer_connections(
        &self,
        torrent_id: &str,
        captured_at: Duration,
        peers: &[PeerConnectionObservation],
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        let previous_view = model.view.clone();
        let previous_peers = std::mem::take(&mut model.peers);
        model.peers = peers
            .iter()
            .map(|peer| {
                let view = PeerView::from_observation(torrent_id, captured_at, peer);
                (view.connection_id.clone(), view)
            })
            .collect();
        model.view.active_peer_connections = model.peers.len().try_into().unwrap_or(u32::MAX);
        model.view.payload_download_rate_bytes = peers
            .iter()
            .filter_map(|peer| peer.content.as_ref())
            .fold(0_u64, |total, content| {
                total.saturating_add(content.observed_payload_rate.try_into().unwrap_or(u64::MAX))
            })
            .to_string();
        let next_view = model.view.clone();
        let next_peers = model.peers.clone();
        hub.publish_peer_changes(
            torrent_id,
            &previous_view,
            &next_view,
            &previous_peers,
            &next_peers,
        )
    }

    pub(crate) fn record_peer_registry_state(
        &self,
        torrent_id: &str,
        active: bool,
        snapshot: &PeerRegistrySnapshot,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        let previous = model.swarm.clone();
        model.swarm = swarm_model(torrent_id, active, snapshot)?;
        let current = model.swarm.clone();
        hub.publish_swarm_changes(torrent_id, &previous, &current)
    }

    #[cfg(test)]
    pub(crate) fn record_tracker_state(
        &self,
        torrent_id: &str,
        snapshot: &TrackerRuntimeSnapshot,
    ) -> Result<(), SubscriptionError> {
        self.record_tracker_state_at(torrent_id, snapshot, Instant::now())
    }

    pub(crate) fn record_tracker_state_at(
        &self,
        torrent_id: &str,
        snapshot: &TrackerRuntimeSnapshot,
        now: Instant,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        let captured_at = now.saturating_duration_since(hub.clock_origin);
        let Some(model) = hub.torrents.get_mut(torrent_id) else {
            return Ok(());
        };
        let previous_view = model.view.clone();
        let previous = model.trackers.replace_snapshot(snapshot, captured_at);
        model.view.configured_tracker_count = Some(model.trackers.count());
        let next_view = model.view.clone();
        let current = model.trackers.clone();
        hub.publish_tracker_changes(torrent_id, &previous_view, &next_view, &previous, &current)
    }

    pub fn record_diagnostic(
        &self,
        severity: DiagnosticSeverity,
        category: &str,
        code: &str,
        torrent_id: Option<&str>,
        message: &str,
        context: &[(&str, &str)],
    ) -> Result<(), SubscriptionError> {
        let category = DiagnosticCategory::new(category)
            .ok_or_else(|| SubscriptionError::Internal("invalid diagnostic category".to_owned()))?;
        self.record_structured_diagnostic(DiagnosticDraft {
            severity,
            category,
            code: code.to_owned(),
            torrent_id: torrent_id.map(ToOwned::to_owned),
            message: message.to_owned(),
            subjects: Vec::new(),
            fields: context
                .iter()
                .map(|(key, value)| DiagnosticField::text(*key, *value))
                .collect(),
        })
    }

    pub(crate) fn record_structured_diagnostic(
        &self,
        draft: DiagnosticDraft,
    ) -> Result<(), SubscriptionError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        if !hub.diagnostic_enabled(draft.severity, &draft.category, draft.torrent_id.as_deref())? {
            return Ok(());
        }
        let timestamp_millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let event = hub.diagnostics.record(draft, timestamp_millis);
        hub.publish_diagnostic(event)
    }

    pub(crate) fn record_diagnostic_lazy<F>(
        &self,
        severity: DiagnosticSeverity,
        category: &'static str,
        torrent_id: Option<&str>,
        build: F,
    ) -> Result<(), SubscriptionError>
    where
        F: FnOnce() -> DiagnosticDraft,
    {
        let category = DiagnosticCategory::from_static(category);
        let enabled = {
            let mut hub = self
                .inner
                .lock()
                .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
            hub.diagnostic_enabled(severity, &category, torrent_id)?
        };
        if !enabled {
            return Ok(());
        }
        self.record_structured_diagnostic(build())
    }
}

impl HubState {
    fn diagnostic_enabled(
        &mut self,
        severity: DiagnosticSeverity,
        category: &DiagnosticCategory,
        torrent_id: Option<&str>,
    ) -> Result<bool, SubscriptionError> {
        if interest_matches(
            &DiagnosticFilter::default(),
            None,
            severity,
            category,
            torrent_id,
        ) {
            return Ok(true);
        }
        self.subscribers.retain(|_, weak| weak.strong_count() != 0);
        if self
            .subscribers
            .values()
            .filter_map(Weak::upgrade)
            .any(|subscriber| {
                let filter = subscriber.spec.diagnostics.clone().unwrap_or_default();
                subscriber.spec.projection == ViewProjection::Diagnostics
                    && interest_matches(
                        &filter,
                        selector_torrent_id(&subscriber.spec.selector),
                        severity,
                        category,
                        torrent_id,
                    )
            })
        {
            return Ok(true);
        }
        self.retain_live_view_sets();
        for view_set in self.view_sets.values() {
            for spec in view_set.view_specs()? {
                let subscription = spec.subscription_spec(DEFAULT_VIEW_SET_QUEUE_BYTES);
                if subscription.projection == ViewProjection::Diagnostics {
                    let filter = subscription.diagnostics.clone().unwrap_or_default();
                    if interest_matches(
                        &filter,
                        selector_torrent_id(&subscription.selector),
                        severity,
                        category,
                        torrent_id,
                    ) {
                        return Ok(true);
                    }
                }
            }
        }
        Ok(false)
    }

    pub(crate) fn snapshot_for(&self, spec: &SubscriptionSpec) -> ViewSnapshot {
        match (&spec.selector, spec.projection) {
            (ViewSelector::TorrentList, ViewProjection::Summary) => ViewSnapshot::TorrentList {
                torrents: self
                    .torrents
                    .values()
                    .map(|torrent| torrent.view.clone())
                    .collect(),
                storage: self.storage.clone(),
                client_settings: self.client_settings.clone(),
            },
            (ViewSelector::Torrent { torrent_id }, ViewProjection::Summary) => {
                ViewSnapshot::Torrent {
                    torrent: self
                        .torrents
                        .get(torrent_id)
                        .map(|torrent| torrent.view.clone()),
                }
            }
            (ViewSelector::Torrent { torrent_id }, ViewProjection::Preparation) => {
                ViewSnapshot::TorrentPreparation {
                    torrent_id: torrent_id.clone(),
                    preparation: self
                        .torrents
                        .get(torrent_id)
                        .and_then(|torrent| torrent.preparation.clone()),
                }
            }
            (ViewSelector::Torrent { torrent_id }, ViewProjection::PieceActivity) => {
                let torrent = self.torrents.get(torrent_id);
                ViewSnapshot::PieceActivity {
                    torrent_id: torrent_id.clone(),
                    piece_count: torrent.map_or(0, |torrent| torrent.view.piece_count),
                    verified: torrent.map_or_else(Vec::new, |torrent| torrent.verified.clone()),
                    active: torrent.map_or_else(Vec::new, |torrent| {
                        torrent.active.values().cloned().collect()
                    }),
                }
            }
            (ViewSelector::TorrentList, ViewProjection::Disk) => {
                let disk = self.disk.view(&self.torrents);
                ViewSnapshot::SessionDisk {
                    pipeline: disk.pipeline,
                    pieces: disk.pieces.into_values().collect(),
                }
            }
            (ViewSelector::SessionDht, ViewProjection::Dht) => ViewSnapshot::SessionDht {
                inspection: self.dht.clone(),
            },
            (ViewSelector::SessionCurrentRates { metrics }, ViewProjection::CurrentRates) => {
                let mut history = self
                    .speed
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                let now_millis = history.now_millis();
                history.advance_to(now_millis);
                ViewSnapshot::SessionCurrentRates {
                    rates: history.current_rates(metrics, now_millis),
                }
            }
            (
                ViewSelector::SessionSpeedHistory { range, metrics },
                ViewProjection::SpeedHistory,
            ) => {
                let mut history = self
                    .speed
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                let now_millis = history.now_millis();
                ViewSnapshot::SessionSpeedHistory {
                    history: history.view(*range, metrics, now_millis),
                }
            }
            (ViewSelector::Torrent { torrent_id }, ViewProjection::Peers) => ViewSnapshot::Peers {
                torrent_id: torrent_id.clone(),
                peers: self
                    .torrents
                    .get(torrent_id)
                    .map_or_else(Vec::new, |torrent| {
                        torrent.peers.values().cloned().collect()
                    }),
            },
            (ViewSelector::Torrent { torrent_id }, ViewProjection::Swarm) => {
                let swarm = self.torrents.get(torrent_id).map(|torrent| &torrent.swarm);
                ViewSnapshot::Swarm {
                    torrent_id: torrent_id.clone(),
                    state: swarm.map_or(SwarmCatalogState::TorrentMissing, |swarm| swarm.state),
                    captured_millis: swarm
                        .map_or_else(|| "0".to_owned(), |swarm| swarm.captured_millis.clone()),
                    maximum_records: swarm.map_or(1_000, |swarm| swarm.maximum_records),
                    counts: swarm
                        .map_or_else(SwarmCountsView::default, |swarm| swarm.counts.clone()),
                    peers: swarm
                        .map_or_else(Vec::new, |swarm| swarm.peers.values().cloned().collect()),
                }
            }
            (ViewSelector::Torrent { torrent_id }, ViewProjection::Files) => {
                let page = spec
                    .catalog_page
                    .expect("validated file projection has a catalog page");
                match self.torrents.get(torrent_id) {
                    Some(torrent) => ViewSnapshot::Files {
                        torrent_id: torrent_id.clone(),
                        state: if torrent.files.is_some() {
                            FileCatalogState::Available
                        } else {
                            FileCatalogState::MetadataPending
                        },
                        filesystem_content_base: torrent
                            .files
                            .as_ref()
                            .and_then(FileProgressModel::filesystem_content_base)
                            .map(str::to_owned),
                        page: page.view(torrent.files.as_ref().map_or(0, FileProgressModel::count)),
                        files: torrent.files.as_ref().map_or_else(Vec::new, |files| {
                            files.rows_page(page.bounds(files.count()))
                        }),
                    },
                    None => ViewSnapshot::Files {
                        torrent_id: torrent_id.clone(),
                        state: FileCatalogState::TorrentMissing,
                        filesystem_content_base: None,
                        page: page.view(0),
                        files: Vec::new(),
                    },
                }
            }
            (ViewSelector::Torrent { torrent_id }, ViewProjection::Media) => {
                match self.torrents.get(torrent_id) {
                    Some(torrent) => ViewSnapshot::Media {
                        torrent_id: torrent_id.clone(),
                        state: if torrent.files.is_some() {
                            MediaCatalogState::Available
                        } else {
                            MediaCatalogState::MetadataPending
                        },
                        total_non_padding_files: torrent.files.as_ref().map_or(0, |files| {
                            u32::try_from(files.non_padding_count())
                                .expect("file count was validated at construction")
                        }),
                        items: torrent
                            .files
                            .as_ref()
                            .map_or_else(Vec::new, FileProgressModel::media_rows),
                    },
                    None => ViewSnapshot::Media {
                        torrent_id: torrent_id.clone(),
                        state: MediaCatalogState::TorrentMissing,
                        total_non_padding_files: 0,
                        items: Vec::new(),
                    },
                }
            }
            (ViewSelector::Torrent { torrent_id }, ViewProjection::Trackers) => {
                let page = spec
                    .catalog_page
                    .expect("validated tracker projection has a catalog page");
                match self.torrents.get(torrent_id) {
                    Some(torrent) => ViewSnapshot::Trackers {
                        torrent_id: torrent_id.clone(),
                        state: TrackerCatalogState::Available,
                        page: page.view(torrent.trackers.count_usize()),
                        trackers: torrent
                            .trackers
                            .rows_page(page.bounds(torrent.trackers.count_usize())),
                    },
                    None => ViewSnapshot::Trackers {
                        torrent_id: torrent_id.clone(),
                        state: TrackerCatalogState::TorrentMissing,
                        page: page.view(0),
                        trackers: Vec::new(),
                    },
                }
            }
            (ViewSelector::Library { query }, ViewProjection::LibraryMedia) => {
                self.library.snapshot(
                    query,
                    spec.catalog_page
                        .expect("validated library projection has a catalog page"),
                    &self.torrents,
                )
            }
            (ViewSelector::Library { .. }, _) | (_, ViewProjection::LibraryMedia) => {
                unreachable!("invalid projection is rejected before snapshot construction")
            }
            (selector, ViewProjection::Diagnostics) => {
                let filter = spec.diagnostics.clone().unwrap_or_default();
                let torrent_id = selector_torrent_id(selector);
                ViewSnapshot::Diagnostics {
                    events: self.diagnostics.matching(&filter, torrent_id),
                    retention: self.diagnostics.retention(),
                }
            }
            (
                ViewSelector::TorrentList,
                ViewProjection::PieceActivity
                | ViewProjection::Preparation
                | ViewProjection::Dht
                | ViewProjection::CurrentRates
                | ViewProjection::SpeedHistory
                | ViewProjection::Peers
                | ViewProjection::Swarm
                | ViewProjection::Files
                | ViewProjection::Media
                | ViewProjection::Trackers,
            ) => {
                unreachable!("invalid projection is rejected before snapshot construction")
            }
            (ViewSelector::Torrent { .. }, ViewProjection::Disk | ViewProjection::Dht) => {
                unreachable!("invalid projection is rejected before snapshot construction")
            }
            (
                ViewSelector::Torrent { .. },
                ViewProjection::CurrentRates | ViewProjection::SpeedHistory,
            ) => {
                unreachable!("invalid projection is rejected before snapshot construction")
            }
            (ViewSelector::SessionCurrentRates { .. }, _)
            | (ViewSelector::SessionSpeedHistory { .. }, _) => {
                unreachable!("invalid projection is rejected before snapshot construction")
            }
            (ViewSelector::SessionDht, _) => {
                unreachable!("invalid projection is rejected before snapshot construction")
            }
        }
    }

    fn publish_changes(
        &mut self,
        previous: &BTreeMap<String, TorrentModel>,
        previous_storage: Option<&StorageSettingsSnapshot>,
        previous_client_settings: Option<&ClientSettingsRuntimeView>,
    ) -> Result<(), SubscriptionError> {
        let revision = self.revision;
        self.retain_live_view_sets();
        let current = &self.torrents;
        self.subscribers.retain(|_, weak| weak.strong_count() != 0);
        let subscribers = self
            .subscribers
            .values()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>();
        for subscriber in subscribers {
            if projection_requires_snapshot(&subscriber.spec, previous, current) {
                subscriber.enqueue_snapshot(revision, self.snapshot_for(&subscriber.spec))?;
                continue;
            }
            let patch = patch_for(
                &subscriber.spec,
                previous,
                current,
                previous_storage.filter(|storage| *storage != &self.storage),
                &self.storage,
                previous_client_settings.filter(|settings| *settings != &self.client_settings),
                &self.client_settings,
            );
            if let Some(patch) = patch {
                subscriber.enqueue_patch(revision, patch)?;
            }
        }
        let view_sets = self.view_sets.values().cloned().collect::<Vec<_>>();
        for view_set in view_sets {
            for spec in view_set.view_specs()? {
                let subscription = spec.subscription_spec(DEFAULT_VIEW_SET_QUEUE_BYTES);
                if projection_requires_snapshot(&subscription, previous, current) {
                    view_set.enqueue_snapshot(
                        spec.view_id(),
                        self.snapshot_for(&subscription),
                        revision,
                    )?;
                    continue;
                }
                if let Some(patch) = patch_for(
                    &subscription,
                    previous,
                    current,
                    previous_storage.filter(|storage| *storage != &self.storage),
                    &self.storage,
                    previous_client_settings.filter(|settings| *settings != &self.client_settings),
                    &self.client_settings,
                ) {
                    view_set.enqueue_patch(spec.view_id(), patch, revision)?;
                }
            }
        }
        let index_changed = self.sync_library_index();
        if index_changed || library_progress_changed(previous, &self.torrents) {
            self.publish_library(LibraryChange::Durable)?;
        }
        Ok(())
    }

    fn publish_disk_changes(
        &mut self,
        previous: &DiskSessionView,
        current: &DiskSessionView,
    ) -> Result<(), SubscriptionError> {
        let Some(patch) = disk_patch(previous, current) else {
            return Ok(());
        };
        let revision = self.revision;
        self.subscribers.retain(|_, weak| weak.strong_count() != 0);
        let subscribers = self
            .subscribers
            .values()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>();
        for subscriber in subscribers {
            if subscriber.spec.projection == ViewProjection::Disk {
                subscriber.enqueue_patch(revision, patch.clone())?;
            }
        }
        self.retain_live_view_sets();
        let view_sets = self.view_sets.values().cloned().collect::<Vec<_>>();
        for view_set in view_sets {
            for spec in view_set.view_specs()? {
                if matches!(spec, crate::ViewSpec::SessionDisk { .. }) {
                    view_set.enqueue_patch(spec.view_id(), patch.clone(), revision)?;
                }
            }
        }
        Ok(())
    }

    fn publish_torrent_view_changes(
        &mut self,
        changes: &[(String, TorrentView, TorrentView)],
    ) -> Result<(), SubscriptionError> {
        if changes.is_empty() {
            return Ok(());
        }
        let revision = self.revision;
        self.subscribers.retain(|_, weak| weak.strong_count() != 0);
        let subscribers = self
            .subscribers
            .values()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>();
        for subscriber in subscribers {
            for (torrent_id, previous, current) in changes {
                if let Some(patch) =
                    targeted_torrent_view_patch(&subscriber.spec, torrent_id, previous, current)
                {
                    subscriber.enqueue_patch(revision, patch)?;
                }
            }
        }
        self.retain_live_view_sets();
        let view_sets = self.view_sets.values().cloned().collect::<Vec<_>>();
        for view_set in view_sets {
            for spec in view_set.view_specs()? {
                let subscription = spec.subscription_spec(DEFAULT_VIEW_SET_QUEUE_BYTES);
                for (torrent_id, previous, current) in changes {
                    if let Some(patch) =
                        targeted_torrent_view_patch(&subscription, torrent_id, previous, current)
                    {
                        view_set.enqueue_patch(spec.view_id(), patch, revision)?;
                    }
                }
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn publish_activity_changes(
        &mut self,
        torrent_id: &str,
        previous_view: &TorrentView,
        next_view: &TorrentView,
        previous_verified: &[IndexRange],
        next_verified: &[IndexRange],
        previous_active: &BTreeMap<u32, ActivePiece>,
        next_active: &BTreeMap<u32, ActivePiece>,
        file_changes: &[FileViewChange],
        media_upsert: &[MediaItemView],
    ) -> Result<(), SubscriptionError> {
        let revision = self.revision;
        self.subscribers.retain(|_, weak| weak.strong_count() != 0);
        let subscribers = self
            .subscribers
            .values()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>();
        for subscriber in subscribers {
            if let Some(patch) = targeted_activity_patch(
                &subscriber.spec,
                torrent_id,
                previous_view,
                next_view,
                previous_verified,
                next_verified,
                previous_active,
                next_active,
                file_changes,
                media_upsert,
            ) {
                subscriber.enqueue_patch(revision, patch)?;
            }
        }
        self.retain_live_view_sets();
        let view_sets = self.view_sets.values().cloned().collect::<Vec<_>>();
        for view_set in view_sets {
            for spec in view_set.view_specs()? {
                let subscription = spec.subscription_spec(DEFAULT_VIEW_SET_QUEUE_BYTES);
                if let Some(patch) = targeted_activity_patch(
                    &subscription,
                    torrent_id,
                    previous_view,
                    next_view,
                    previous_verified,
                    next_verified,
                    previous_active,
                    next_active,
                    file_changes,
                    media_upsert,
                ) {
                    view_set.enqueue_patch(spec.view_id(), patch, revision)?;
                }
            }
        }
        if !file_changes.is_empty() {
            self.publish_library(LibraryChange::Progress {
                torrent_id,
                changes: file_changes,
            })?;
        }
        Ok(())
    }

    fn publish_diagnostic(&mut self, event: DiagnosticEvent) -> Result<(), SubscriptionError> {
        let revision = self.revision;
        let retention = self.diagnostics.retention();
        self.subscribers.retain(|_, weak| weak.strong_count() != 0);
        let subscribers = self
            .subscribers
            .values()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>();
        for subscriber in subscribers {
            if subscriber.spec.projection != ViewProjection::Diagnostics {
                continue;
            }
            let filter = subscriber.spec.diagnostics.clone().unwrap_or_default();
            if diagnostic_matches(
                &filter,
                selector_torrent_id(&subscriber.spec.selector),
                &event,
            ) {
                subscriber.enqueue_diagnostic_patch(
                    revision,
                    ViewPatch::Diagnostics {
                        events: vec![event.clone()],
                        retention: retention.clone(),
                    },
                )?;
            }
        }
        self.retain_live_view_sets();
        let view_sets = self.view_sets.values().cloned().collect::<Vec<_>>();
        for view_set in view_sets {
            for spec in view_set.view_specs()? {
                let subscription = spec.subscription_spec(DEFAULT_VIEW_SET_QUEUE_BYTES);
                if subscription.projection != ViewProjection::Diagnostics {
                    continue;
                }
                let filter = subscription.diagnostics.clone().unwrap_or_default();
                if diagnostic_matches(&filter, selector_torrent_id(&subscription.selector), &event)
                {
                    view_set.enqueue_patch(
                        spec.view_id(),
                        ViewPatch::Diagnostics {
                            events: vec![event.clone()],
                            retention: retention.clone(),
                        },
                        revision,
                    )?;
                }
            }
        }
        Ok(())
    }

    fn publish_peer_changes(
        &mut self,
        torrent_id: &str,
        previous_view: &TorrentView,
        next_view: &TorrentView,
        previous_peers: &BTreeMap<String, PeerView>,
        next_peers: &BTreeMap<String, PeerView>,
    ) -> Result<(), SubscriptionError> {
        let revision = self.revision;
        self.subscribers.retain(|_, weak| weak.strong_count() != 0);
        let subscribers = self
            .subscribers
            .values()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>();
        for subscriber in subscribers {
            if let Some(patch) = targeted_peer_patch(
                &subscriber.spec,
                torrent_id,
                previous_view,
                next_view,
                previous_peers,
                next_peers,
            ) {
                subscriber.enqueue_patch(revision, patch)?;
            }
        }
        self.retain_live_view_sets();
        let view_sets = self.view_sets.values().cloned().collect::<Vec<_>>();
        for view_set in view_sets {
            for spec in view_set.view_specs()? {
                if let Some(patch) = targeted_peer_patch(
                    &spec.subscription_spec(DEFAULT_VIEW_SET_QUEUE_BYTES),
                    torrent_id,
                    previous_view,
                    next_view,
                    previous_peers,
                    next_peers,
                ) {
                    view_set.enqueue_patch(spec.view_id(), patch, revision)?;
                }
            }
        }
        Ok(())
    }

    fn publish_swarm_changes(
        &mut self,
        torrent_id: &str,
        previous: &SwarmModel,
        current: &SwarmModel,
    ) -> Result<(), SubscriptionError> {
        if previous == current {
            return Ok(());
        }
        let revision = self.revision;
        self.subscribers.retain(|_, weak| weak.strong_count() != 0);
        let subscribers = self
            .subscribers
            .values()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>();
        for subscriber in subscribers {
            if let Some(patch) =
                targeted_swarm_patch(&subscriber.spec, torrent_id, previous, current)
            {
                subscriber.enqueue_patch(revision, patch)?;
            }
        }
        self.retain_live_view_sets();
        let view_sets = self.view_sets.values().cloned().collect::<Vec<_>>();
        for view_set in view_sets {
            for spec in view_set.view_specs()? {
                if let Some(patch) = targeted_swarm_patch(
                    &spec.subscription_spec(DEFAULT_VIEW_SET_QUEUE_BYTES),
                    torrent_id,
                    previous,
                    current,
                ) {
                    view_set.enqueue_patch(spec.view_id(), patch, revision)?;
                }
            }
        }
        Ok(())
    }

    fn publish_tracker_changes(
        &mut self,
        torrent_id: &str,
        previous_view: &TorrentView,
        next_view: &TorrentView,
        previous: &TrackerViewModel,
        current: &TrackerViewModel,
    ) -> Result<(), SubscriptionError> {
        let revision = self.revision;
        self.subscribers.retain(|_, weak| weak.strong_count() != 0);
        let subscribers = self
            .subscribers
            .values()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>();
        for subscriber in subscribers {
            if let Some(patch) = targeted_tracker_patch(
                &subscriber.spec,
                torrent_id,
                previous_view,
                next_view,
                previous,
                current,
            ) {
                subscriber.enqueue_patch(revision, patch)?;
            }
        }
        self.retain_live_view_sets();
        let view_sets = self.view_sets.values().cloned().collect::<Vec<_>>();
        for view_set in view_sets {
            for spec in view_set.view_specs()? {
                let subscription = spec.subscription_spec(DEFAULT_VIEW_SET_QUEUE_BYTES);
                if let Some(patch) = targeted_tracker_patch(
                    &subscription,
                    torrent_id,
                    previous_view,
                    next_view,
                    previous,
                    current,
                ) {
                    view_set.enqueue_patch(spec.view_id(), patch, revision)?;
                }
            }
        }
        Ok(())
    }

    fn retain_live_view_sets(&mut self) {
        let now = std::time::Instant::now();
        self.view_sets.retain(|_, view_set| {
            let retain = !view_set.is_expired(now);
            if !retain {
                view_set.close();
            }
            retain
        });
    }

    pub(crate) fn snapshots_for_view_set(
        &self,
        view_set: &ViewSetInner,
    ) -> Result<(u64, Vec<ViewSetUpdate>), crate::ViewSetError> {
        let snapshots = view_set
            .view_specs()?
            .into_iter()
            .map(|spec| ViewSetUpdate::Snapshot {
                view_id: spec.view_id().to_owned(),
                snapshot: self.snapshot_for(&spec.subscription_spec(DEFAULT_VIEW_SET_QUEUE_BYTES)),
            })
            .collect();
        Ok((self.revision, snapshots))
    }
}

impl ViewSubscription {
    #[cfg(test)]
    pub(crate) fn enqueue_speed_history_for_testing(
        &self,
        revision: u64,
        history: crate::SpeedHistoryView,
    ) -> Result<(), SubscriptionError> {
        self.inner.enqueue_speed_history(revision, history)
    }

    pub fn stream_id(&self) -> String {
        self.inner.stream_id.to_string()
    }

    pub async fn next_update(&self) -> Option<ViewUpdate> {
        loop {
            let notified = self.inner.notify.notified();
            let wait = {
                let mut queue = self.inner.queue.lock().ok()?;
                if !queue.entries.is_empty() {
                    let now = tokio::time::Instant::now();
                    if now >= queue.next_delivery {
                        let queued = queue.entries.pop_front().expect("front was present");
                        queue.queued_bytes -= queued.encoded_bytes;
                        queue.next_delivery = now
                            + Duration::from_millis(u64::from(
                                self.inner.spec.delivery.min_interval_millis,
                            ));
                        return Some(queued.update);
                    }
                    Some(queue.next_delivery - now)
                } else if queue.closed {
                    return None;
                } else {
                    None
                }
            };
            if let Some(wait) = wait {
                tokio::select! {
                    () = tokio::time::sleep(wait) => {}
                    () = notified => {}
                }
            } else {
                notified.await;
            }
        }
    }

    pub fn resync(&self) -> Result<(), SubscriptionError> {
        let hub = self.hub.upgrade().ok_or(SubscriptionError::Closed)?;
        let hub = hub
            .lock()
            .map_err(|_| SubscriptionError::Internal("view hub lock is poisoned".to_owned()))?;
        self.inner
            .replace_with_snapshot(hub.revision, hub.snapshot_for(&self.inner.spec))
    }

    pub fn stats(&self) -> Result<SubscriptionStats, SubscriptionError> {
        let queue = self
            .inner
            .queue
            .lock()
            .map_err(|_| SubscriptionError::Internal("queue lock is poisoned".to_owned()))?;
        Ok(SubscriptionStats {
            queued_bytes: queue.queued_bytes,
            queue_high_water: queue.queue_high_water,
            reset_count: queue.reset_count,
        })
    }

    pub fn close(&self) {
        if let Ok(mut queue) = self.inner.queue.lock() {
            queue.closed = true;
            queue.entries.clear();
            queue.queued_bytes = 0;
        }
        self.inner.notify.notify_one();
    }
}

impl Drop for ViewSubscription {
    fn drop(&mut self) {
        if Arc::strong_count(&self.inner) == 1 {
            self.close();
        }
    }
}

fn selector_torrent_id(selector: &ViewSelector) -> Option<&str> {
    match selector {
        ViewSelector::TorrentList
        | ViewSelector::SessionDht
        | ViewSelector::SessionCurrentRates { .. }
        | ViewSelector::SessionSpeedHistory { .. }
        | ViewSelector::Library { .. } => None,
        ViewSelector::Torrent { torrent_id } => Some(torrent_id),
    }
}

#[derive(Clone, Debug)]
pub struct ViewSet {
    pub(crate) inner: Arc<ViewSetInner>,
    pub(crate) hub: Weak<Mutex<HubState>>,
}

#[derive(Debug)]
pub(crate) struct ViewSetLeaseReaper {
    cancellation: CancellationToken,
    task: Option<JoinHandle<()>>,
}

impl ViewSetLeaseReaper {
    pub(crate) fn start(hub: ViewHub, interval: Duration) -> Self {
        let cancellation = CancellationToken::new();
        let task_cancellation = cancellation.clone();
        let task = tokio::spawn(async move {
            let mut timer = tokio::time::interval(interval);
            timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    biased;
                    _ = task_cancellation.cancelled() => break,
                    _ = timer.tick() => {
                        hub.reap_expired_view_sets();
                    }
                }
            }
        });
        Self {
            cancellation,
            task: Some(task),
        }
    }

    pub(crate) async fn shutdown(&mut self) -> Result<(), JoinError> {
        self.cancellation.cancel();
        if let Some(task) = self.task.take() {
            task.await?;
        }
        Ok(())
    }
}

impl Drop for ViewSetLeaseReaper {
    fn drop(&mut self) {
        self.cancellation.cancel();
    }
}

impl ViewSet {
    pub fn id(&self) -> &str {
        &self.inner.id
    }

    pub async fn next_updates(
        &self,
        after: &str,
        max_wait_millis: u32,
    ) -> Result<UpdateBatch, ViewSetError> {
        if max_wait_millis > MAX_VIEW_SET_WAIT_MILLIS {
            return Err(ViewSetError::InvalidDeliveryInterval {
                maximum: MAX_VIEW_SET_WAIT_MILLIS,
            });
        }
        let after = parse_decimal(after)?;
        let _poll = self.inner.start_poll()?;
        self.inner.touch(Instant::now())?;
        let deadline =
            tokio::time::Instant::now() + Duration::from_millis(u64::from(max_wait_millis));
        loop {
            let notified = self.inner.notify.notified();
            match self.inner.poll_state(after, Instant::now())? {
                PollState::Ready(batch) => return Ok(batch),
                PollState::Reset(reason) => return self.reset_from_hub(reason),
                PollState::Closed => return Err(ViewSetError::Closed),
                PollState::Wait(_) if max_wait_millis == 0 => {
                    return self.inner.empty_batch(after, Instant::now());
                }
                PollState::Wait(ready_at) => {
                    if tokio::time::Instant::now() >= deadline {
                        return self.inner.empty_batch(after, Instant::now());
                    }
                    let wake_at = ready_at.map_or(deadline, |ready_at| {
                        tokio::time::Instant::from_std(ready_at).min(deadline)
                    });
                    tokio::select! {
                        () = notified => {}
                        () = tokio::time::sleep_until(wake_at) => {
                            if wake_at == deadline {
                                return self.inner.empty_batch(after, Instant::now());
                            }
                        }
                    }
                }
            }
        }
    }

    pub fn stats(&self) -> Result<ViewSetStats, ViewSetError> {
        self.inner.stats()
    }

    fn reset_from_hub(&self, reason: ResetReason) -> Result<UpdateBatch, ViewSetError> {
        let hub = self.hub.upgrade().ok_or(ViewSetError::Closed)?;
        let hub = hub
            .lock()
            .map_err(|_| ViewSetError::Internal("view hub lock is poisoned".to_owned()))?;
        let (revision, snapshots) = hub.snapshots_for_view_set(&self.inner)?;
        self.inner
            .reset_with_snapshots(reason, revision, snapshots, Instant::now())
    }
}

impl ViewHub {
    pub fn open_view_set(
        &self,
        owner: ViewSetOwner,
        request: OpenViewSetRequest,
    ) -> Result<OpenViewSetResponse, ViewSetError> {
        self.open_view_set_at(owner, request, Instant::now())
    }

    pub(crate) fn open_view_set_at(
        &self,
        owner: ViewSetOwner,
        request: OpenViewSetRequest,
        now: Instant,
    ) -> Result<OpenViewSetResponse, ViewSetError> {
        let (views, queue_bytes) = validated_open(&request)?;
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| ViewSetError::Internal("view hub lock is poisoned".to_owned()))?;
        prune_expired(&mut hub, now);
        if !reserve_capacity(&mut hub, &owner, now) {
            return Err(ViewSetError::ResourceLimit);
        }
        let snapshots = snapshots_for_specs(&hub, &views, queue_bytes);
        for (spec, update) in views.values().zip(&snapshots) {
            if let ViewSetUpdate::Snapshot { snapshot, .. } = update {
                hub.remember_library_snapshot(&spec.subscription_spec(queue_bytes), snapshot);
            }
        }
        let id = loop {
            let candidate = generate_view_set_id()?;
            if !hub.view_sets.contains_key(&candidate) {
                break candidate;
            }
        };
        let inner = ViewSetInner::new(
            id.clone(),
            owner,
            ViewSetInitialState {
                clock_origin: hub.clock_origin,
                revision: hub.revision,
                views,
                queue_bytes_limit: queue_bytes,
                snapshots,
                now,
                lease: hub.view_set_lease,
            },
        )?;
        let response = inner.open_response()?;
        hub.view_sets.insert(id, inner);
        self.speed_interest.notify_one();
        Ok(response)
    }

    pub fn update_view_set(
        &self,
        owner: &ViewSetOwner,
        id: &str,
        request: UpdateViewSetRequest,
    ) -> Result<(), ViewSetError> {
        let views = validated_update(&request)?;
        let now = Instant::now();
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| ViewSetError::Internal("view hub lock is poisoned".to_owned()))?;
        prune_expired(&mut hub, now);
        let view_set = owned_view_set(&hub, owner, id)?;
        let previous = view_set
            .view_specs()?
            .into_iter()
            .map(|spec| (spec.view_id().to_owned(), spec))
            .collect::<BTreeMap<_, _>>();
        let queue_bytes = view_set.queue_bytes_limit()?;
        let mut updates = previous
            .keys()
            .filter(|view_id| !views.contains_key(*view_id))
            .map(|view_id| ViewSetUpdate::ViewRemoved {
                view_id: view_id.clone(),
            })
            .collect::<Vec<_>>();
        for (view_id, spec) in &views {
            if previous.get(view_id) != Some(spec) {
                let subscription = spec.subscription_spec(queue_bytes);
                let snapshot = hub.snapshot_for(&subscription);
                hub.remember_library_snapshot(&subscription, &snapshot);
                updates.push(ViewSetUpdate::Snapshot {
                    view_id: view_id.clone(),
                    snapshot,
                });
            }
        }
        view_set.replace_views(views, updates, hub.revision, now)?;
        self.speed_interest.notify_one();
        Ok(())
    }

    pub fn view_set(&self, owner: &ViewSetOwner, id: &str) -> Result<ViewSet, ViewSetError> {
        let now = Instant::now();
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| ViewSetError::Internal("view hub lock is poisoned".to_owned()))?;
        prune_expired(&mut hub, now);
        let inner = owned_view_set(&hub, owner, id)?;
        Ok(ViewSet {
            inner,
            hub: Arc::downgrade(&self.inner),
        })
    }

    pub fn close_view_set(&self, owner: &ViewSetOwner, id: &str) -> Result<(), ViewSetError> {
        let mut hub = self
            .inner
            .lock()
            .map_err(|_| ViewSetError::Internal("view hub lock is poisoned".to_owned()))?;
        let view_set = owned_view_set(&hub, owner, id)?;
        hub.view_sets.remove(id);
        view_set.close();
        self.speed_interest.notify_one();
        Ok(())
    }

    pub fn close_all_view_sets(&self) {
        if let Ok(mut hub) = self.inner.lock() {
            for (_, view_set) in std::mem::take(&mut hub.view_sets) {
                view_set.close();
            }
        }
        self.speed_interest.notify_one();
    }

    /// Retire a non-resumable presentation owner after its callers have joined.
    pub fn close_owner_view_sets(&self, owner: &ViewSetOwner) {
        if let Ok(mut hub) = self.inner.lock() {
            hub.view_sets.retain(|_, view_set| {
                if view_set.owner_matches(owner) {
                    view_set.close();
                    false
                } else {
                    true
                }
            });
        }
        self.speed_interest.notify_one();
    }

    pub(crate) fn reap_expired_view_sets(&self) -> usize {
        let Ok(mut hub) = self.inner.lock() else {
            return 0;
        };
        let before = hub.view_sets.len();
        prune_expired(&mut hub, Instant::now());
        before.saturating_sub(hub.view_sets.len())
    }

    #[cfg(test)]
    pub(crate) fn expire_view_sets_at(&self, now: Instant) {
        if let Ok(mut hub) = self.inner.lock() {
            prune_expired(&mut hub, now);
        }
    }
}

fn owned_view_set(
    hub: &HubState,
    owner: &ViewSetOwner,
    id: &str,
) -> Result<Arc<ViewSetInner>, ViewSetError> {
    hub.view_sets
        .get(id)
        .filter(|view_set| view_set.owner_matches(owner))
        .cloned()
        .ok_or(ViewSetError::UnknownViewSet)
}

/// Makes room for one more set of `owner`. A reloaded page cannot resume its
/// previous sets, which otherwise hold capacity until their lease expires. At
/// a limit, the least recently active set that is not being polled and has
/// been silent past the eviction floor is closed early; if none qualifies,
/// the open is refused.
fn reserve_capacity(hub: &mut HubState, owner: &ViewSetOwner, now: Instant) -> bool {
    let minimum_idle = Duration::from_millis(MIN_VIEW_SET_EVICTION_IDLE_MILLIS);
    loop {
        let owner_full = hub
            .view_sets
            .values()
            .filter(|view_set| view_set.owner_matches(owner))
            .count()
            >= MAX_VIEW_SETS_PER_OWNER;
        if !owner_full && hub.view_sets.len() < MAX_VIEW_SETS {
            return true;
        }
        let Some((_, id)) = hub
            .view_sets
            .iter()
            .filter(|(_, view_set)| !owner_full || view_set.owner_matches(owner))
            .filter_map(|(id, view_set)| {
                view_set
                    .abandoned_since(now, minimum_idle)
                    .map(|since| (since, id.clone()))
            })
            .min()
        else {
            return false;
        };
        if let Some(view_set) = hub.view_sets.remove(&id) {
            view_set.close();
        }
    }
}

fn prune_expired(hub: &mut HubState, now: Instant) {
    hub.view_sets.retain(|_, view_set| {
        let retain = !view_set.is_expired(now);
        if !retain {
            view_set.close();
        }
        retain
    });
}

fn snapshots_for_specs(
    hub: &HubState,
    views: &BTreeMap<String, ViewSpec>,
    queue_bytes: u32,
) -> Vec<ViewSetUpdate> {
    views
        .iter()
        .map(|(view_id, spec)| ViewSetUpdate::Snapshot {
            view_id: view_id.clone(),
            snapshot: hub.snapshot_for(&spec.subscription_spec(queue_bytes)),
        })
        .collect()
}
