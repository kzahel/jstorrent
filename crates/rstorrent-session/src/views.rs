//! Session view subsystem facade.
//!
//! Portable contracts and pure algorithms point inward. The private hub
//! coordinator owns mutable projection state, registries, and the sole lease
//! reaper task while delivery accumulators own their independent queues.

mod contract;
mod diff;
mod eta;
mod hub;
mod model;
mod ranges;
mod row_updates;
mod subscription;
mod view_set;

pub use contract::{
    API_VERSION, ActivePiece, ActivePieceStageView, ApiBackendIdentity, ApiEncoding, ApiHello,
    ApiLimits, ApiVersion, CapabilityStatus, CatalogPageRequest, CatalogPageView,
    CheckingPhaseView, CheckingProgressView, DeliveryMode, DeliveryPolicy, DhtAddressFamilyView,
    DhtBucketView, DhtFamilyInspectionView, DhtInspectionView, DhtLifecycleView, DhtLookupView,
    DhtNetworkPolicyView, DiskCheckpointStageView, DiskPieceStageView, DiskPieceView,
    DiskPipelineView, DiskPressureView, IndexRange, IntegrityPreparationPhaseView,
    IntegrityPreparationView, MetadataAcquisitionPhaseView, MetadataAcquisitionView,
    OpenViewSetOptions, OpenViewSetRequest, OpenViewSetResponse, PeerDirection,
    PeerDisconnectReason, PeerFieldCapabilities, PeerFlagView, PeerLifecycle, PeerMseMethodView,
    PeerRequestPhase, PeerRole, PeerSourceView, PeerTransportKind, PeerView, ProgressAction,
    ProgressAssessment, ProgressDisposition, ProgressInputs, ProgressPhase, ProgressReason,
    ResetReason, SeedAdmissionView, SeedGoalStatusView, SeedGoalView, SeedStopView,
    SubscriptionError, SubscriptionSpec, SubscriptionStats, SwarmCatalogState, SwarmCountsView,
    SwarmPeerState, SwarmPeerView, TorrentEtaView, TorrentLifetimeView, TorrentOperationalState,
    TorrentPreparationView, TorrentSeedingView, TorrentView, UpdateBatch, UpdateViewSetRequest,
    VIEW_CONTRACT_VERSION, ViewDeliveryPolicy, ViewPatch, ViewProjection, ViewSelector,
    ViewSetError, ViewSetOwner, ViewSetStats, ViewSetUpdate, ViewSnapshot, ViewSpec, ViewUpdate,
    ViewUpdatePayload,
};
pub(crate) use eta::TorrentEtaRuntime;
pub(crate) use hub::ViewSetLeaseReaper;
pub use hub::{ViewHub, ViewSet, ViewSubscription};
pub use row_updates::{
    ActivePieceFieldUpdate, ActivePieceUpdate, FileFieldUpdate, FileRowUpdate, PeerFieldUpdate,
    PeerRowUpdate, RowUpdateError, TorrentFieldUpdate, TorrentRowUpdate, TorrentViewChange,
};

pub(crate) use contract::{
    DEFAULT_VIEW_SET_QUEUE_BYTES, VIEW_SET_LEASE_MILLIS, VIEW_SET_REAPER_INTERVAL_MILLIS,
};
pub(crate) use diff::coalesce_patch;
pub use model::assess_progress;
use model::{DiskSessionModel, DiskSessionView, SwarmModel, TorrentModel};
pub(crate) use model::{DurableTorrentViewState, TorrentActivity};
pub(crate) use ranges::ranges_from_pieces;
pub(crate) use subscription::validate_spec;

#[cfg(test)]
#[path = "views/tests/mod.rs"]
mod tests;
