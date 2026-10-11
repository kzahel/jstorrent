//! Portable leased-view-set contract values and resource limits.
//!
//! These DTOs retain their crate-root facade and generated serialization
//! shape. They own no mutex, notification, channel, task, or application state.

use std::error::Error;
use std::fmt;
use std::sync::Arc;

use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::control::{RemovalState, StorageState, TorrentProtocolIdentities, TorrentState};
use crate::diagnostics::{DiagnosticEvent, DiagnosticFilter, DiagnosticRetention};
use crate::file_views::{FileCatalogState, FileView};
use crate::media_catalog_views::{MediaCatalogState, MediaItemView};
use crate::settings::{ClientSettingsRuntimeView, StorageSettingsSnapshot, TorrentTransferLimits};
use crate::speed::{
    SessionCurrentRatesView, SpeedHistoryAppend, SpeedHistoryView, SpeedMetric, SpeedRange,
};
use crate::tracker_views::{TrackerCatalogState, TrackerView};

use super::row_updates::{
    ActivePieceUpdate, FileRowUpdate, PeerRowUpdate, TorrentRowUpdate, TorrentViewChange,
};

pub const API_VERSION: u16 = 1;
pub const MAX_VIEW_SETS: usize = 32;
pub const MAX_VIEW_SETS_PER_OWNER: usize = 8;
pub const MAX_VIEWS_PER_SET: usize = 16;
pub const MAX_VIEW_ID_BYTES: usize = 64;
pub const MIN_VIEW_SET_QUEUE_BYTES: u32 = 16 * 1024;
pub const DEFAULT_VIEW_SET_QUEUE_BYTES: u32 = 256 * 1024;
pub const MAX_VIEW_SET_QUEUE_BYTES: u32 = 512 * 1024;
pub const MAX_VIEW_SET_SNAPSHOT_BYTES: u32 = 16 * 1024 * 1024;
pub const MAX_VIEW_SET_WAIT_MILLIS: u32 = 20_000;
pub const VIEW_SET_LEASE_MILLIS: u64 = 5 * 60 * 1_000;
pub const VIEW_SET_REAPER_INTERVAL_MILLIS: u64 = 5_000;
pub const MAX_VIEW_DELIVERY_INTERVAL_MILLIS: u32 = 60_000;
pub const MAX_CATALOG_PAGE_ROWS: u32 = 1_024;

fn required_nullable_string_schema(generator: &mut SchemaGenerator) -> Schema {
    <Option<String>>::json_schema(generator)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct CatalogPageRequest {
    pub offset: u32,
    pub limit: u32,
}

impl Default for CatalogPageRequest {
    fn default() -> Self {
        Self {
            offset: 0,
            limit: MAX_CATALOG_PAGE_ROWS,
        }
    }
}

impl CatalogPageRequest {
    pub(crate) fn bounds(self, total: usize) -> std::ops::Range<usize> {
        let start = usize::try_from(self.offset)
            .unwrap_or(usize::MAX)
            .min(total);
        let limit = usize::try_from(self.limit).unwrap_or(usize::MAX);
        start..start.saturating_add(limit).min(total)
    }

    pub(crate) fn contains(self, index: u32) -> bool {
        index >= self.offset && index < self.offset.saturating_add(self.limit)
    }

    pub(crate) fn view(self, total: usize) -> CatalogPageView {
        let total = u32::try_from(total).unwrap_or(u32::MAX);
        let end = self.offset.saturating_add(self.limit).min(total);
        CatalogPageView {
            offset: self.offset,
            limit: self.limit,
            total,
            next_offset: (end < total).then_some(end),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct CatalogPageView {
    pub offset: u32,
    pub limit: u32,
    pub total: u32,
    pub next_offset: Option<u32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
pub enum ApiEncoding {
    Json,
    Cbor,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryMode {
    Poll,
    LongPoll,
    Stream,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct ApiVersion {
    pub current: u16,
    pub minimum: u16,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct ApiLimits {
    pub max_view_sets_per_owner: u16,
    pub max_views_per_set: u16,
    pub max_view_id_bytes: u16,
    pub min_queue_bytes: u32,
    pub default_queue_bytes: u32,
    pub max_queue_bytes: u32,
    pub max_snapshot_bytes: u32,
    pub max_wait_millis: u32,
    pub lease_millis: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct ApiHello {
    pub api: ApiVersion,
    pub encodings: Vec<ApiEncoding>,
    pub deliveries: Vec<DeliveryMode>,
    pub capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend: Option<ApiBackendIdentity>,
    pub limits: ApiLimits,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct ApiBackendIdentity {
    pub kind: String,
    pub instance_id: String,
    pub profile_id: String,
    pub product_version: String,
    pub capability_profile: Vec<String>,
}

impl Default for ApiHello {
    fn default() -> Self {
        Self {
            api: ApiVersion {
                current: API_VERSION,
                minimum: API_VERSION,
            },
            encodings: vec![ApiEncoding::Json],
            deliveries: vec![DeliveryMode::Poll, DeliveryMode::LongPoll],
            capabilities: vec![
                "torrent_list".to_owned(),
                "torrent_summary".to_owned(),
                "torrent_preparation".to_owned(),
                "torrent_peers".to_owned(),
                "torrent_swarm".to_owned(),
                "torrent_files".to_owned(),
                "torrent_media".to_owned(),
                "torrent_trackers".to_owned(),
                "session_disk".to_owned(),
                "session_dht".to_owned(),
                "session_current_rates".to_owned(),
                "session_speed_history".to_owned(),
                "piece_activity".to_owned(),
                "diagnostics".to_owned(),
            ],
            backend: None,
            limits: ApiLimits {
                max_view_sets_per_owner: MAX_VIEW_SETS_PER_OWNER as u16,
                max_views_per_set: MAX_VIEWS_PER_SET as u16,
                max_view_id_bytes: MAX_VIEW_ID_BYTES as u16,
                min_queue_bytes: MIN_VIEW_SET_QUEUE_BYTES,
                default_queue_bytes: DEFAULT_VIEW_SET_QUEUE_BYTES,
                max_queue_bytes: MAX_VIEW_SET_QUEUE_BYTES,
                max_snapshot_bytes: MAX_VIEW_SET_SNAPSHOT_BYTES,
                max_wait_millis: MAX_VIEW_SET_WAIT_MILLIS,
                lease_millis: VIEW_SET_LEASE_MILLIS.to_string(),
            },
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct ViewDeliveryPolicy {
    #[serde(default)]
    pub min_interval_millis: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ViewSpec {
    TorrentList {
        view_id: String,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
    TorrentSummary {
        view_id: String,
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
    TorrentPreparation {
        view_id: String,
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
    PieceActivity {
        view_id: String,
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
    SessionDisk {
        view_id: String,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
    SessionDht {
        view_id: String,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
    SessionCurrentRates {
        view_id: String,
        metrics: Vec<SpeedMetric>,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
    SessionSpeedHistory {
        view_id: String,
        range: SpeedRange,
        metrics: Vec<SpeedMetric>,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
    TorrentPeers {
        view_id: String,
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
    TorrentSwarm {
        view_id: String,
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
    TorrentFiles {
        view_id: String,
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        page: Option<CatalogPageRequest>,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
    TorrentMedia {
        view_id: String,
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
    TorrentTrackers {
        view_id: String,
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        page: Option<CatalogPageRequest>,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
    Diagnostics {
        view_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: Option<String>,
        #[serde(default)]
        filter: DiagnosticFilter,
        #[serde(default)]
        delivery: ViewDeliveryPolicy,
    },
}

impl ViewSpec {
    pub fn view_id(&self) -> &str {
        match self {
            Self::TorrentList { view_id, .. }
            | Self::TorrentSummary { view_id, .. }
            | Self::TorrentPreparation { view_id, .. }
            | Self::PieceActivity { view_id, .. }
            | Self::SessionDisk { view_id, .. }
            | Self::SessionDht { view_id, .. }
            | Self::SessionCurrentRates { view_id, .. }
            | Self::SessionSpeedHistory { view_id, .. }
            | Self::TorrentPeers { view_id, .. }
            | Self::TorrentSwarm { view_id, .. }
            | Self::TorrentFiles { view_id, .. }
            | Self::TorrentMedia { view_id, .. }
            | Self::TorrentTrackers { view_id, .. }
            | Self::Diagnostics { view_id, .. } => view_id,
        }
    }

    pub(super) fn delivery(&self) -> ViewDeliveryPolicy {
        match self {
            Self::TorrentList { delivery, .. }
            | Self::TorrentSummary { delivery, .. }
            | Self::TorrentPreparation { delivery, .. }
            | Self::PieceActivity { delivery, .. }
            | Self::SessionDisk { delivery, .. }
            | Self::SessionDht { delivery, .. }
            | Self::SessionCurrentRates { delivery, .. }
            | Self::SessionSpeedHistory { delivery, .. }
            | Self::TorrentPeers { delivery, .. }
            | Self::TorrentSwarm { delivery, .. }
            | Self::TorrentFiles { delivery, .. }
            | Self::TorrentMedia { delivery, .. }
            | Self::TorrentTrackers { delivery, .. }
            | Self::Diagnostics { delivery, .. } => *delivery,
        }
    }

    pub(crate) fn subscription_spec(&self, queue_bytes: u32) -> SubscriptionSpec {
        let (selector, projection, diagnostics, catalog_page) = match self {
            Self::TorrentList { .. } => (
                ViewSelector::TorrentList,
                ViewProjection::Summary,
                None,
                None,
            ),
            Self::TorrentSummary { torrent_id, .. } => (
                ViewSelector::Torrent {
                    torrent_id: torrent_id.clone(),
                },
                ViewProjection::Summary,
                None,
                None,
            ),
            Self::TorrentPreparation { torrent_id, .. } => (
                ViewSelector::Torrent {
                    torrent_id: torrent_id.clone(),
                },
                ViewProjection::Preparation,
                None,
                None,
            ),
            Self::PieceActivity { torrent_id, .. } => (
                ViewSelector::Torrent {
                    torrent_id: torrent_id.clone(),
                },
                ViewProjection::PieceActivity,
                None,
                None,
            ),
            Self::SessionDisk { .. } => {
                (ViewSelector::TorrentList, ViewProjection::Disk, None, None)
            }
            Self::SessionDht { .. } => (ViewSelector::SessionDht, ViewProjection::Dht, None, None),
            Self::SessionCurrentRates { metrics, .. } => (
                ViewSelector::SessionCurrentRates {
                    metrics: metrics.clone(),
                },
                ViewProjection::CurrentRates,
                None,
                None,
            ),
            Self::SessionSpeedHistory { range, metrics, .. } => (
                ViewSelector::SessionSpeedHistory {
                    range: *range,
                    metrics: metrics.clone(),
                },
                ViewProjection::SpeedHistory,
                None,
                None,
            ),
            Self::TorrentPeers { torrent_id, .. } => (
                ViewSelector::Torrent {
                    torrent_id: torrent_id.clone(),
                },
                ViewProjection::Peers,
                None,
                None,
            ),
            Self::TorrentSwarm { torrent_id, .. } => (
                ViewSelector::Torrent {
                    torrent_id: torrent_id.clone(),
                },
                ViewProjection::Swarm,
                None,
                None,
            ),
            Self::TorrentFiles {
                torrent_id, page, ..
            } => (
                ViewSelector::Torrent {
                    torrent_id: torrent_id.clone(),
                },
                ViewProjection::Files,
                None,
                Some(page.unwrap_or_default()),
            ),
            Self::TorrentMedia { torrent_id, .. } => (
                ViewSelector::Torrent {
                    torrent_id: torrent_id.clone(),
                },
                ViewProjection::Media,
                None,
                None,
            ),
            Self::TorrentTrackers {
                torrent_id, page, ..
            } => (
                ViewSelector::Torrent {
                    torrent_id: torrent_id.clone(),
                },
                ViewProjection::Trackers,
                None,
                Some(page.unwrap_or_default()),
            ),
            Self::Diagnostics {
                torrent_id, filter, ..
            } => (
                torrent_id
                    .as_ref()
                    .map_or(ViewSelector::TorrentList, |id| ViewSelector::Torrent {
                        torrent_id: id.clone(),
                    }),
                ViewProjection::Diagnostics,
                Some(filter.clone()),
                None,
            ),
        };
        SubscriptionSpec {
            selector,
            projection,
            delivery: DeliveryPolicy {
                min_interval_millis: self.delivery().min_interval_millis,
                max_queue_bytes: queue_bytes,
            },
            diagnostics,
            catalog_page,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct OpenViewSetOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_queue_bytes: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct OpenViewSetRequest {
    pub views: Vec<ViewSpec>,
    #[serde(default)]
    pub options: OpenViewSetOptions,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct UpdateViewSetRequest {
    pub views: Vec<ViewSpec>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ViewSetUpdate {
    Snapshot {
        view_id: String,
        snapshot: ViewSnapshot,
    },
    Patch {
        view_id: String,
        patch: ViewPatch,
    },
    ViewRemoved {
        view_id: String,
    },
    ResetRequired {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        view_id: Option<String>,
        reason: ResetReason,
    },
}

impl ViewSetUpdate {
    pub(super) fn view_id(&self) -> Option<&str> {
        match self {
            Self::Snapshot { view_id, .. }
            | Self::Patch { view_id, .. }
            | Self::ViewRemoved { view_id } => Some(view_id),
            Self::ResetRequired { view_id, .. } => view_id.as_deref(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct UpdateBatch {
    /// Milliseconds on the current application instance's monotonic clock.
    /// Refreshed at delivery; tracker *_at_millis fields use this same origin.
    pub server_now_millis: String,
    pub api_version: u16,
    pub view_set_id: String,
    pub epoch: String,
    pub base_cursor: String,
    pub cursor: String,
    pub durable_revision: String,
    pub updates: Vec<ViewSetUpdate>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct OpenViewSetResponse {
    pub view_set_id: String,
    pub lease_millis: String,
    pub effective_queue_bytes: u32,
    pub effective_views: Vec<ViewSpec>,
    pub initial: UpdateBatch,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ViewSetOwner(Arc<str>);

impl ViewSetOwner {
    pub fn trusted(value: impl Into<Arc<str>>) -> Self {
        Self(value.into())
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ViewSetStats {
    pub queued_bytes: usize,
    pub queue_high_water: usize,
    pub reset_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ViewSetError {
    InvalidViewCount { maximum: usize },
    InvalidViewId,
    DuplicateViewId(String),
    InvalidDeliveryInterval { maximum: u32 },
    InvalidQueueBound { minimum: u32, maximum: u32 },
    InvalidView(String),
    ResourceLimit,
    UnknownViewSet,
    SnapshotExceedsQueue { snapshot: usize, maximum: u32 },
    ConsumerBusy,
    Closed,
    Internal(String),
}

impl fmt::Display for ViewSetError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidViewCount { maximum } => {
                write!(formatter, "view set must contain 1..={maximum} views")
            }
            Self::InvalidViewId => write!(formatter, "view ID is invalid"),
            Self::DuplicateViewId(id) => write!(formatter, "view ID {id} is duplicated"),
            Self::InvalidDeliveryInterval { maximum } => {
                write!(
                    formatter,
                    "view delivery interval exceeds {maximum} milliseconds"
                )
            }
            Self::InvalidQueueBound { minimum, maximum } => {
                write!(
                    formatter,
                    "view-set queue must be within {minimum}..={maximum} bytes"
                )
            }
            Self::InvalidView(message) => write!(formatter, "invalid view: {message}"),
            Self::ResourceLimit => write!(formatter, "view-set resource limit reached"),
            Self::UnknownViewSet => write!(formatter, "view set is unavailable"),
            Self::SnapshotExceedsQueue { snapshot, maximum } => write!(
                formatter,
                "view-set snapshot is {snapshot} bytes and exceeds {maximum} bytes"
            ),
            Self::ConsumerBusy => write!(formatter, "view set already has an active consumer"),
            Self::Closed => write!(formatter, "view set is closed"),
            Self::Internal(message) => write!(formatter, "view set internal error: {message}"),
        }
    }
}

impl Error for ViewSetError {}

pub const VIEW_CONTRACT_VERSION: u16 = 2;
pub const MIN_SUBSCRIPTION_QUEUE_BYTES: u32 = 4 * 1024;
pub const MAX_SUBSCRIPTION_QUEUE_BYTES: u32 = 4 * 1024 * 1024;
pub const MAX_SUBSCRIPTION_INTERVAL_MILLIS: u32 = 60_000;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ViewSelector {
    TorrentList,
    SessionDht,
    Torrent {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
    },
    SessionCurrentRates {
        metrics: Vec<SpeedMetric>,
    },
    SessionSpeedHistory {
        range: SpeedRange,
        metrics: Vec<SpeedMetric>,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum ViewProjection {
    Summary,
    Preparation,
    PieceActivity,
    Disk,
    Dht,
    CurrentRates,
    SpeedHistory,
    Peers,
    Swarm,
    Files,
    Media,
    Trackers,
    Diagnostics,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum DhtLifecycleView {
    Disabled,
    Offline,
    BootstrapEmpty,
    Participating,
    Inactive,
    Suspended,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum DhtNetworkPolicyView {
    Offline,
    LoopbackOnly,
    Online,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum DhtAddressFamilyView {
    Ipv4,
    Ipv6,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DhtBucketView {
    pub bucket_index: u16,
    pub good_nodes: u8,
    pub questionable_nodes: u8,
    pub replacement_candidates: u8,
    pub oldest_live_response_age_millis: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DhtLookupView {
    pub family: DhtAddressFamilyView,
    pub lookup_id: String,
    pub target_id: String,
    pub age_millis: String,
    pub deadline_in_millis: String,
    pub unqueried_candidates: u16,
    pub in_flight_candidates: u16,
    pub responded_candidates: u16,
    pub failed_candidates: u16,
    pub discovered_peers: u16,
    pub closest_responded_prefix_bits: Option<u16>,
    pub last_convergence_improvement_age_millis: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DhtFamilyInspectionView {
    pub family: DhtAddressFamilyView,
    pub lifecycle: DhtLifecycleView,
    pub local_node_id: String,
    pub local_address: String,
    pub observed_external_address: Option<String>,
    pub routing_nodes: u16,
    pub occupied_buckets: u16,
    pub deepest_shared_prefix_bits: Option<u16>,
    pub active_transactions: u32,
    pub active_lookups: u32,
    pub queries_sent: String,
    pub responses_received: String,
    pub queries_received: String,
    pub malformed_received: String,
    pub family_mismatched: String,
    pub rate_limited: String,
    pub discovered_peers: String,
    pub bootstrap_attempts: String,
    pub routing_refreshes: String,
    pub datagram_bytes_sent: String,
    pub datagram_bytes_received: String,
    pub announces_sent: String,
    pub announces_succeeded: String,
    pub announces_failed: String,
    pub buckets: Vec<DhtBucketView>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DhtInspectionView {
    pub lifecycle: DhtLifecycleView,
    pub network_policy: DhtNetworkPolicyView,
    pub captured_millis: String,
    pub active_transactions: u32,
    pub active_lookups: u32,
    pub queries_sent: String,
    pub responses_received: String,
    pub queries_received: String,
    pub malformed_received: String,
    pub family_mismatched: String,
    pub rate_limited: String,
    pub discovered_peers: String,
    pub bootstrap_attempts: String,
    pub routing_refreshes: String,
    pub datagram_bytes_sent: String,
    pub datagram_bytes_received: String,
    pub announces_sent: String,
    pub announces_succeeded: String,
    pub announces_failed: String,
    pub families: Vec<DhtFamilyInspectionView>,
    pub lookups: Vec<DhtLookupView>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum ProgressDisposition {
    Active,
    Waiting,
    Blocked,
    Inactive,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum ProgressPhase {
    Discovery,
    Metadata,
    Storage,
    Transfer,
    Verification,
    Complete,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum ProgressReason {
    NetworkDisabled,
    WaitingForUnmeteredNetwork,
    DiscoveringPeers,
    WaitingForDiscovery,
    NoEnabledDiscoverySource,
    AcquiringMetadata,
    PreparingStorage,
    WaitingForStorage,
    PreparingIntegrity,
    TransferringPieces,
    VerifyingPieces,
    Paused,
    Complete,
    NeedsRepair,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum ProgressAction {
    EnableNetwork,
    EnableDiscovery,
    SelectStorage,
    Resume,
    RepairStorage,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ProgressAssessment {
    pub disposition: ProgressDisposition,
    pub phase: ProgressPhase,
    pub reason: ProgressReason,
    pub actions: Vec<ProgressAction>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum CheckingPhaseView {
    Queued,
    Preparing,
    Hashing,
    ReconcilingStorage,
    Paused,
    Finalizing,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct CheckingProgressView {
    pub generation: String,
    pub phase: CheckingPhaseView,
    pub pieces_total: u32,
    pub pieces_processed: u32,
    pub pieces_matched: u32,
    pub pieces_absent: u32,
    pub pieces_mismatched: u32,
    pub bytes_hashed: String,
    pub active_hash_jobs: u32,
    pub queued_hash_jobs: u32,
    pub elapsed_millis: String,
    pub last_advance_age_millis: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oldest_active_job_age_millis: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum MetadataAcquisitionPhaseView {
    Discovering,
    Downloading,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct MetadataAcquisitionView {
    pub phase: MetadataAcquisitionPhaseView,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_size_bytes: Option<String>,
    pub received_bytes: String,
    pub block_count: u32,
    pub block_states: String,
    pub active_peers: u32,
    pub requests_in_flight: u32,
    pub hash_retries: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum IntegrityPreparationPhaseView {
    Acquiring,
    WaitingForPeer,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct IntegrityPreparationView {
    pub phase: IntegrityPreparationPhaseView,
    pub needed_hash_ranges: u32,
    pub active_requests: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TorrentPreparationView {
    pub generation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<MetadataAcquisitionView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integrity: Option<IntegrityPreparationView>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ProgressInputs {
    pub task_active: bool,
    pub stopping: bool,
    pub network_disabled: bool,
    pub waiting_for_unmetered_network: bool,
    pub discovery_exhausted: bool,
    pub discovery_active: bool,
    pub discovery_retry_scheduled: bool,
    pub dht_enabled: bool,
    pub integrity_preparation_active: Option<bool>,
    pub seed_admission: SeedAdmissionView,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum TorrentOperationalState {
    Queued,
    Starting,
    Downloading,
    Checking,
    Stopping,
    Seeding,
    Paused,
    Error,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum SeedAdmissionView {
    Active,
    Queued,
    InactiveExempt,
    #[default]
    Ineligible,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum SeedGoalStatusView {
    Unmet,
    #[default]
    Met,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
pub struct SeedGoalView {
    pub status: SeedGoalStatusView,
    pub share_ratio_met: bool,
    pub finished_download_ratio_met: bool,
    pub finished_time_met: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
pub struct TorrentLifetimeView {
    pub uploaded_payload_bytes: String,
    pub downloaded_payload_bytes: String,
    pub active_seconds: String,
    pub finished_seconds: String,
    pub seeding_seconds: String,
    #[schemars(required, schema_with = "required_nullable_string_schema")]
    pub share_ratio_hundredths: Option<String>,
}

impl Default for TorrentLifetimeView {
    fn default() -> Self {
        Self {
            uploaded_payload_bytes: "0".to_owned(),
            downloaded_payload_bytes: "0".to_owned(),
            active_seconds: "0".to_owned(),
            finished_seconds: "0".to_owned(),
            seeding_seconds: "0".to_owned(),
            share_ratio_hundredths: None,
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
pub struct TorrentSeedingView {
    pub admission: SeedAdmissionView,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal: Option<SeedGoalView>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DeliveryPolicy {
    pub min_interval_millis: u32,
    pub max_queue_bytes: u32,
}

impl Default for DeliveryPolicy {
    fn default() -> Self {
        Self {
            min_interval_millis: 100,
            max_queue_bytes: 256 * 1024,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SubscriptionSpec {
    pub selector: ViewSelector,
    pub projection: ViewProjection,
    pub delivery: DeliveryPolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<DiagnosticFilter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_page: Option<CatalogPageRequest>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct IndexRange {
    pub start: u32,
    pub end_exclusive: u32,
}

impl IndexRange {
    pub fn new(start: u32, end_exclusive: u32) -> Option<Self> {
        (start < end_exclusive).then_some(Self {
            start,
            end_exclusive,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ActivePiece {
    pub piece_id: String,
    pub piece_index: u32,
    pub attempt: u32,
    pub piece_length: u32,
    pub stage: ActivePieceStageView,
    pub requested: Vec<IndexRange>,
    pub received: Vec<IndexRange>,
    pub stored: Vec<IndexRange>,
    pub age_millis: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum ActivePieceStageView {
    Requested,
    Received,
    Stored,
    Hashing,
    CheckpointDirty,
    CheckpointSyncing,
    CheckpointCommitting,
    Failed,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum DiskPressureView {
    #[default]
    Idle,
    Normal,
    Backpressured,
    Draining,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum DiskPieceStageView {
    Receiving,
    Queued,
    Writing,
    Stored,
    Hashing,
    CheckpointDirty,
    CheckpointSyncing,
    CheckpointCommitting,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum DiskCheckpointStageView {
    Idle,
    Syncing,
    Committing,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DiskPipelineView {
    pub pressure: DiskPressureView,
    pub checkpoint_stage: DiskCheckpointStageView,
    pub intake_backpressured: bool,
    pub sample_millis: String,
    pub resident_limit_bytes: String,
    pub resident_high_watermark_bytes: String,
    pub resident_low_watermark_bytes: String,
    pub requested_bytes: String,
    pub resident_bytes: String,
    pub queued_write_bytes: String,
    pub writing_bytes: String,
    pub hashing_bytes: String,
    pub checkpoint_dirty_pieces: String,
    pub checkpoint_dirty_bytes: String,
    pub checkpoint_dirty_piece_high_water: String,
    pub checkpoint_dirty_byte_high_water: String,
    pub checkpoint_oldest_dirty_millis: String,
    pub checkpoint_batches_started: String,
    pub checkpoint_batches_completed: String,
    pub checkpoint_pieces_completed: String,
    pub checkpoint_sync_operations_completed: String,
    pub checkpoint_sync_service_micros: String,
    pub checkpoint_sync_service_max_micros: String,
    pub checkpoint_commit_service_micros: String,
    pub checkpoint_commit_service_max_micros: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_active_micros: Option<String>,
    pub storage_jobs_pending: String,
    pub received_bytes_total: String,
    pub stored_bytes_total: String,
    pub verified_bytes_total: String,
    pub receive_rate_bytes: String,
    pub write_rate_bytes: String,
    pub hash_rate_bytes: String,
    pub write_operations_started: String,
    pub write_operations_completed: String,
    pub hash_operations_started: String,
    pub hash_operations_completed: String,
    pub write_queue_wait_micros: String,
    pub write_queue_wait_max_micros: String,
    pub write_service_micros: String,
    pub write_service_max_micros: String,
    pub hash_queue_wait_micros: String,
    pub hash_queue_wait_max_micros: String,
    pub hash_service_micros: String,
    pub hash_service_max_micros: String,
    pub pressure_transition_count: String,
    pub backpressured_millis_total: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

impl Default for DiskPipelineView {
    fn default() -> Self {
        Self {
            pressure: DiskPressureView::Idle,
            checkpoint_stage: DiskCheckpointStageView::Idle,
            intake_backpressured: false,
            sample_millis: "0".to_owned(),
            resident_limit_bytes: "0".to_owned(),
            resident_high_watermark_bytes: "0".to_owned(),
            resident_low_watermark_bytes: "0".to_owned(),
            requested_bytes: "0".to_owned(),
            resident_bytes: "0".to_owned(),
            queued_write_bytes: "0".to_owned(),
            writing_bytes: "0".to_owned(),
            hashing_bytes: "0".to_owned(),
            checkpoint_dirty_pieces: "0".to_owned(),
            checkpoint_dirty_bytes: "0".to_owned(),
            checkpoint_dirty_piece_high_water: "0".to_owned(),
            checkpoint_dirty_byte_high_water: "0".to_owned(),
            checkpoint_oldest_dirty_millis: "0".to_owned(),
            checkpoint_batches_started: "0".to_owned(),
            checkpoint_batches_completed: "0".to_owned(),
            checkpoint_pieces_completed: "0".to_owned(),
            checkpoint_sync_operations_completed: "0".to_owned(),
            checkpoint_sync_service_micros: "0".to_owned(),
            checkpoint_sync_service_max_micros: "0".to_owned(),
            checkpoint_commit_service_micros: "0".to_owned(),
            checkpoint_commit_service_max_micros: "0".to_owned(),
            checkpoint_active_micros: None,
            storage_jobs_pending: "0".to_owned(),
            received_bytes_total: "0".to_owned(),
            stored_bytes_total: "0".to_owned(),
            verified_bytes_total: "0".to_owned(),
            receive_rate_bytes: "0".to_owned(),
            write_rate_bytes: "0".to_owned(),
            hash_rate_bytes: "0".to_owned(),
            write_operations_started: "0".to_owned(),
            write_operations_completed: "0".to_owned(),
            hash_operations_started: "0".to_owned(),
            hash_operations_completed: "0".to_owned(),
            write_queue_wait_micros: "0".to_owned(),
            write_queue_wait_max_micros: "0".to_owned(),
            write_service_micros: "0".to_owned(),
            write_service_max_micros: "0".to_owned(),
            hash_queue_wait_micros: "0".to_owned(),
            hash_queue_wait_max_micros: "0".to_owned(),
            hash_service_micros: "0".to_owned(),
            hash_service_max_micros: "0".to_owned(),
            pressure_transition_count: "0".to_owned(),
            backpressured_millis_total: "0".to_owned(),
            last_error: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DiskPieceView {
    pub row_id: String,
    #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
    pub torrent_id: String,
    pub torrent_name: String,
    pub piece_index: u32,
    pub piece_length: u32,
    pub attempt: u32,
    pub stage: DiskPieceStageView,
    pub requested_bytes: String,
    pub received_bytes: String,
    pub stored_bytes: String,
    pub age_millis: String,
    pub stage_age_millis: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TorrentView {
    #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
    pub torrent_id: String,
    pub protocol_identities: TorrentProtocolIdentities,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_display_name: Option<String>,
    pub state: TorrentState,
    pub operational_state: TorrentOperationalState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_queue_position: Option<u32>,
    #[serde(default)]
    pub transfer_limits: TorrentTransferLimits,
    pub storage_state: StorageState,
    pub storage_root: String,
    pub metadata_available: bool,
    #[serde(default)]
    pub awaiting_file_selection: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_file_selection_position: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_catalog_id: Option<String>,
    #[serde(default)]
    pub selectable_file_count: u32,
    #[serde(default)]
    pub selected_file_count: u32,
    #[serde(default)]
    pub selectable_file_bytes: String,
    #[serde(default)]
    pub selected_file_bytes: String,
    pub piece_count: u32,
    #[schemars(required, schema_with = "required_nullable_string_schema")]
    pub total_size_bytes: Option<String>,
    pub verified_piece_count: u32,
    pub requested_bytes: String,
    pub received_bytes: String,
    pub stored_bytes: String,
    pub active_peer_connections: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub configured_tracker_count: Option<u32>,
    pub payload_download_rate_bytes: String,
    #[schemars(required, schema_with = "required_nullable_string_schema")]
    pub required_payload_bytes: Option<String>,
    #[schemars(required, schema_with = "required_nullable_string_schema")]
    pub remaining_payload_bytes: Option<String>,
    pub eta_payload_download_rate_bytes: String,
    pub eta: TorrentEtaView,
    #[serde(default)]
    pub lifetime: TorrentLifetimeView,
    #[serde(default)]
    pub seeding: TorrentSeedingView,
    pub progress: ProgressAssessment,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checking: Option<CheckingProgressView>,
    pub archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removal_state: Option<RemovalState>,
    pub delete_data_supported: bool,
    pub force_recheck_available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum TorrentEtaView {
    Estimate {
        seconds: String,
    },
    WarmingUp,
    Stalled,
    #[default]
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    Available,
    Unavailable,
    Unsupported,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum PeerDirection {
    Incoming,
    Outgoing,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum PeerTransportKind {
    Tcp,
    Utp,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum PeerMseMethodView {
    PlaintextPayload,
    Rc4,
}

#[derive(
    Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema, TS,
)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum PeerFlagView {
    Incoming,
    Encrypted,
    DownloadAllowed,
    DownloadChoked,
    UploadAllowed,
    UploadChoked,
    ExtensionProtocol,
    MetadataExtension,
    Utp,
    HolePunched,
    OnParole,
    OptimisticUnchoke,
    Snubbed,
    UploadOnly,
    Endgame,
    Seed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum PeerLifecycle {
    TransportConnecting,
    ProtocolHandshaking,
    Connected,
    Disconnecting,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum PeerRole {
    Metadata,
    Content,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum PeerRequestPhase {
    SlowStart,
    Steady,
    Stalled,
}

#[derive(
    Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema, TS,
)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum PeerSourceView {
    Tracker,
    PeerExchange,
    Dht,
    LocalDiscovery,
    Incoming,
    Manual,
    MagnetHint,
    Cache,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum PeerDisconnectReason {
    Connect,
    Handshake,
    SelfConnection,
    DuplicatePeerId,
    Protocol,
    RemoteClosed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum SwarmCatalogState {
    Active,
    Inactive,
    TorrentMissing,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum SwarmPeerState {
    Eligible,
    NotConnectable,
    Dialing,
    Connected,
    BackedOff,
    FailureLimited,
    Banned,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SwarmCountsView {
    pub total: u32,
    pub eligible: u32,
    pub not_connectable: u32,
    pub dialing: u32,
    pub connected: u32,
    pub backed_off: u32,
    pub failure_limited: u32,
    pub banned: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SwarmPeerView {
    pub peer_record_id: String,
    #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
    pub torrent_id: String,
    pub endpoint: String,
    pub sources: Vec<PeerSourceView>,
    pub state: SwarmPeerState,
    pub connectable: bool,
    pub first_observed_age_millis: String,
    pub last_observed_age_millis: String,
    pub retry_in_millis: Option<String>,
    pub dial_attempts: u32,
    pub consecutive_failures: u32,
    pub total_failures: u32,
    pub last_dial_age_millis: Option<String>,
    pub last_connected_age_millis: Option<String>,
    pub last_failure: Option<PeerDisconnectReason>,
    pub last_failure_age_millis: Option<String>,
    pub payload_downloaded_bytes: String,
    pub payload_uploaded_bytes: String,
    pub trust_points: i8,
    pub hash_failures: u8,
    pub valid_pieces: u32,
    pub on_parole: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PeerFieldCapabilities {
    pub local_endpoint: CapabilityStatus,
    pub client_name: CapabilityStatus,
    pub ut_metadata: CapabilityStatus,
    pub interest_directions: CapabilityStatus,
    pub local_choke: CapabilityStatus,
    pub piece_availability: CapabilityStatus,
    pub protocol_rates: CapabilityStatus,
    pub upload: CapabilityStatus,
    pub metadata_stage: CapabilityStatus,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PeerView {
    pub connection_id: String,
    #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
    pub torrent_id: String,
    pub peer_record_id: Option<String>,
    pub direction: PeerDirection,
    pub transport: PeerTransportKind,
    pub lifecycle: PeerLifecycle,
    pub role: PeerRole,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub peer_flags: Vec<PeerFlagView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mse_method: Option<PeerMseMethodView>,
    pub lifecycle_age_millis: String,
    pub remote_endpoint: String,
    pub local_endpoint: Option<String>,
    pub sources: Vec<PeerSourceView>,
    pub peer_id: Option<String>,
    pub client_name: Option<String>,
    pub supports_extensions: Option<bool>,
    pub supports_ut_metadata: Option<bool>,
    pub local_interested: Option<bool>,
    pub remote_interested: Option<bool>,
    pub remote_choking: Option<bool>,
    pub local_choking: Option<bool>,
    pub available_piece_count: Option<u32>,
    pub wanted_piece_count: Option<u32>,
    pub payload_download_rate_bytes: Option<String>,
    pub payload_downloaded_bytes: Option<String>,
    pub protocol_download_rate_bytes: Option<String>,
    pub protocol_downloaded_bytes: Option<String>,
    pub payload_upload_rate_bytes: Option<String>,
    pub payload_uploaded_bytes: Option<String>,
    pub pending_requests: Option<u32>,
    pub target_requests: Option<u32>,
    pub queued_payload_bytes: Option<String>,
    pub oldest_request_age_millis: Option<String>,
    pub request_timeout_millis: Option<String>,
    pub request_phase: Option<PeerRequestPhase>,
    pub connected_age_millis: Option<String>,
    pub last_useful_age_millis: Option<String>,
    pub last_payload_age_millis: Option<String>,
    pub disconnect_reason: Option<PeerDisconnectReason>,
    pub capabilities: PeerFieldCapabilities,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
// UniFFI does not lower boxed record fields. These DTO variants are bounded
// transport values, not retained hot-path engine state.
#[allow(clippy::large_enum_variant)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ViewSnapshot {
    TorrentList {
        torrents: Vec<TorrentView>,
        storage: StorageSettingsSnapshot,
        #[serde(default)]
        client_settings: ClientSettingsRuntimeView,
    },
    Torrent {
        torrent: Option<TorrentView>,
    },
    TorrentPreparation {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        preparation: Option<TorrentPreparationView>,
    },
    PieceActivity {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        piece_count: u32,
        verified: Vec<IndexRange>,
        active: Vec<ActivePiece>,
    },
    SessionDisk {
        pipeline: DiskPipelineView,
        pieces: Vec<DiskPieceView>,
    },
    SessionDht {
        inspection: DhtInspectionView,
    },
    SessionCurrentRates {
        rates: SessionCurrentRatesView,
    },
    SessionSpeedHistory {
        history: SpeedHistoryView,
    },
    Peers {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        peers: Vec<PeerView>,
    },
    Swarm {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        state: SwarmCatalogState,
        captured_millis: String,
        maximum_records: u32,
        counts: SwarmCountsView,
        peers: Vec<SwarmPeerView>,
    },
    Files {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        state: FileCatalogState,
        filesystem_content_base: Option<String>,
        page: CatalogPageView,
        files: Vec<FileView>,
    },
    Media {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        state: MediaCatalogState,
        total_non_padding_files: u32,
        items: Vec<MediaItemView>,
    },
    Trackers {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        state: TrackerCatalogState,
        page: CatalogPageView,
        trackers: Vec<TrackerView>,
    },
    Diagnostics {
        events: Vec<DiagnosticEvent>,
        retention: DiagnosticRetention,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
// Keep this wire enum aligned with ViewSnapshot; UniFFI cannot lower a boxed
// DiskPipelineView field.
#[allow(clippy::large_enum_variant)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ViewPatch {
    TorrentList {
        upsert: Vec<TorrentView>,
        updates: Vec<TorrentRowUpdate>,
        removed: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        storage: Option<StorageSettingsSnapshot>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        client_settings: Option<ClientSettingsRuntimeView>,
    },
    Torrent {
        change: TorrentViewChange,
    },
    TorrentPreparation {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        preparation: Option<TorrentPreparationView>,
    },
    PieceActivity {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        piece_count: u32,
        verified: Vec<IndexRange>,
        cleared: Vec<IndexRange>,
        active_upsert: Vec<ActivePiece>,
        active_updates: Vec<ActivePieceUpdate>,
        active_removed: Vec<String>,
    },
    SessionDisk {
        pipeline: DiskPipelineView,
        upsert: Vec<DiskPieceView>,
        removed: Vec<String>,
    },
    SessionDht {
        inspection: DhtInspectionView,
    },
    SessionCurrentRates {
        rates: SessionCurrentRatesView,
    },
    SessionSpeedHistory {
        append: SpeedHistoryAppend,
    },
    Peers {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        upsert: Vec<PeerView>,
        updates: Vec<PeerRowUpdate>,
        removed: Vec<String>,
    },
    Swarm {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        state: SwarmCatalogState,
        captured_millis: String,
        maximum_records: u32,
        counts: SwarmCountsView,
        upsert: Vec<SwarmPeerView>,
        removed: Vec<String>,
    },
    Files {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        upsert: Vec<FileView>,
        updates: Vec<FileRowUpdate>,
        removed: Vec<String>,
    },
    Media {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        upsert: Vec<MediaItemView>,
        removed: Vec<String>,
    },
    Trackers {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        upsert: Vec<TrackerView>,
        removed: Vec<String>,
    },
    Diagnostics {
        events: Vec<DiagnosticEvent>,
        retention: DiagnosticRetention,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ViewUpdatePayload {
    Snapshot { snapshot: ViewSnapshot },
    Patch { patch: ViewPatch },
    ResetRequired { reason: ResetReason },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum ResetReason {
    QueueOverflow,
    CursorMismatch,
    CursorExpired,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ViewUpdate {
    pub contract_version: u16,
    pub stream_id: String,
    pub epoch: String,
    pub sequence: String,
    pub base_revision: String,
    pub revision: String,
    #[serde(flatten)]
    pub payload: ViewUpdatePayload,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct SubscriptionStats {
    pub queued_bytes: usize,
    pub queue_high_water: usize,
    pub reset_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SubscriptionError {
    InvalidInterval { maximum: u32 },
    InvalidQueueBound { minimum: u32, maximum: u32 },
    InvalidProjection,
    InvalidCatalogPage { maximum: u32 },
    SnapshotExceedsQueue { snapshot: usize, maximum: u32 },
    Closed,
    Internal(String),
}

impl fmt::Display for SubscriptionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInterval { maximum } => {
                write!(
                    formatter,
                    "subscription interval exceeds {maximum} milliseconds"
                )
            }
            Self::InvalidQueueBound { minimum, maximum } => write!(
                formatter,
                "subscription queue must be within {minimum}..={maximum} bytes"
            ),
            Self::InvalidProjection => {
                write!(
                    formatter,
                    "the selected view does not support that projection"
                )
            }
            Self::InvalidCatalogPage { maximum } => write!(
                formatter,
                "catalog page limit must be within 1..={maximum} rows"
            ),
            Self::SnapshotExceedsQueue { snapshot, maximum } => write!(
                formatter,
                "initial snapshot is {snapshot} bytes and exceeds the {maximum}-byte queue"
            ),
            Self::Closed => write!(formatter, "subscription is closed"),
            Self::Internal(message) => write!(formatter, "subscription internal error: {message}"),
        }
    }
}

impl Error for SubscriptionError {}

impl From<crate::ViewSetError> for SubscriptionError {
    fn from(error: crate::ViewSetError) -> Self {
        Self::Internal(error.to_string())
    }
}
