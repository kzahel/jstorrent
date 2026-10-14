//! Typed semantic updates for measured hot current-state rows.
//!
//! These values describe domain fields before serialization. Their declaration
//! order is deliberately not a binary field-number registry.

use std::collections::{BTreeMap, BTreeSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::control::{RemovalState, StorageState, TorrentProtocolIdentities, TorrentState};
use crate::file_views::{FileSelectionView, FileView};
use crate::media::MediaFileAvailability;
use crate::settings::TorrentTransferLimits;

use super::contract::{
    ActivePiece, ActivePieceStageView, CheckingProgressView, IndexRange, PeerDirection,
    PeerDisconnectReason, PeerFieldCapabilities, PeerFlagView, PeerLifecycle, PeerMseMethodView,
    PeerRequestPhase, PeerRole, PeerSourceView, PeerTransportKind, PeerView, ProgressAssessment,
    TorrentEtaView, TorrentLifetimeView, TorrentOperationalState, TorrentSeedingView, TorrentView,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RowUpdateError {
    EmptyFields,
    DuplicateField,
    IdentityMismatch,
}

trait SemanticField: Clone {
    type Kind: Copy + Ord;

    fn kind(&self) -> Self::Kind;
}

fn validate_fields<F: SemanticField>(fields: &[F]) -> Result<(), RowUpdateError> {
    if fields.is_empty() {
        return Err(RowUpdateError::EmptyFields);
    }
    let mut kinds = BTreeSet::new();
    if fields.iter().all(|field| kinds.insert(field.kind())) {
        Ok(())
    } else {
        Err(RowUpdateError::DuplicateField)
    }
}

fn merge_fields<F: SemanticField>(current: &mut Vec<F>, next: &[F]) {
    let mut values = current
        .drain(..)
        .map(|field| (field.kind(), field))
        .collect::<BTreeMap<_, _>>();
    values.extend(next.iter().cloned().map(|field| (field.kind(), field)));
    *current = values.into_values().collect();
}

macro_rules! semantic_fields {
    (
        $enum_name:ident, $kind_name:ident, $row:ty,
        { $( $variant:ident => $field:ident : $value:ty ),+ $(,)? }
    ) => {
        #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
        #[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
        #[serde(tag = "field", rename_all = "snake_case")]
        pub enum $enum_name {
            $( $variant { value: $value }, )+
        }

        #[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
        enum $kind_name {
            $( $variant, )+
        }

        impl SemanticField for $enum_name {
            type Kind = $kind_name;

            fn kind(&self) -> Self::Kind {
                match self {
                    $( Self::$variant { .. } => $kind_name::$variant, )+
                }
            }
        }

        impl $enum_name {
            fn apply_to(&self, row: &mut $row) {
                match self {
                    $( Self::$variant { value } => row.$field = value.clone(), )+
                }
            }
        }
    };
}

semantic_fields!(
    TorrentFieldUpdate,
    TorrentFieldKind,
    TorrentView,
    {
        ProtocolIdentities => protocol_identities: TorrentProtocolIdentities,
        DisplayName => display_name: Option<String>,
        SourceDisplayName => source_display_name: Option<String>,
        State => state: TorrentState,
        OperationalState => operational_state: TorrentOperationalState,
        DownloadQueuePosition => download_queue_position: Option<u32>,
        TransferLimits => transfer_limits: TorrentTransferLimits,
        StorageState => storage_state: StorageState,
        MetadataAvailable => metadata_available: bool,
        PrivateTorrent => private_torrent: bool,
        AwaitingFileSelection => awaiting_file_selection: bool,
        PendingFileSelectionPosition => pending_file_selection_position: Option<u32>,
        FileCatalogId => file_catalog_id: Option<String>,
        SelectableFileCount => selectable_file_count: u32,
        SelectedFileCount => selected_file_count: u32,
        SelectableFileBytes => selectable_file_bytes: String,
        SelectedFileBytes => selected_file_bytes: String,
        PieceCount => piece_count: u32,
        TotalSizeBytes => total_size_bytes: Option<String>,
        VerifiedPieceCount => verified_piece_count: u32,
        RequestedBytes => requested_bytes: String,
        ReceivedBytes => received_bytes: String,
        StoredBytes => stored_bytes: String,
        ActivePeerConnections => active_peer_connections: u32,
        ConfiguredTrackerCount => configured_tracker_count: Option<u32>,
        PayloadDownloadRateBytes => payload_download_rate_bytes: String,
        RequiredPayloadBytes => required_payload_bytes: Option<String>,
        RemainingPayloadBytes => remaining_payload_bytes: Option<String>,
        EtaPayloadDownloadRateBytes => eta_payload_download_rate_bytes: String,
        Eta => eta: TorrentEtaView,
        Lifetime => lifetime: TorrentLifetimeView,
        Seeding => seeding: TorrentSeedingView,
        Progress => progress: ProgressAssessment,
        Checking => checking: Option<CheckingProgressView>,
        Archived => archived: bool,
        RemovalState => removal_state: Option<RemovalState>,
        DeleteDataSupported => delete_data_supported: bool,
        ForceRecheckAvailable => force_recheck_available: bool,
        Error => error: Option<String>
    }
);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TorrentRowUpdate {
    pub torrent_id: String,
    pub fields: Vec<TorrentFieldUpdate>,
}

impl TorrentRowUpdate {
    pub(crate) fn between(previous: &TorrentView, current: &TorrentView) -> Option<Self> {
        if previous.torrent_id != current.torrent_id {
            return None;
        }
        let mut fields = Vec::new();
        macro_rules! changed {
            ($variant:ident, $field:ident) => {
                if previous.$field != current.$field {
                    fields.push(TorrentFieldUpdate::$variant {
                        value: current.$field.clone(),
                    });
                }
            };
        }
        changed!(ProtocolIdentities, protocol_identities);
        changed!(DisplayName, display_name);
        changed!(SourceDisplayName, source_display_name);
        changed!(State, state);
        changed!(OperationalState, operational_state);
        changed!(DownloadQueuePosition, download_queue_position);
        changed!(TransferLimits, transfer_limits);
        changed!(StorageState, storage_state);
        changed!(MetadataAvailable, metadata_available);
        changed!(PrivateTorrent, private_torrent);
        changed!(AwaitingFileSelection, awaiting_file_selection);
        changed!(
            PendingFileSelectionPosition,
            pending_file_selection_position
        );
        changed!(FileCatalogId, file_catalog_id);
        changed!(SelectableFileCount, selectable_file_count);
        changed!(SelectedFileCount, selected_file_count);
        changed!(SelectableFileBytes, selectable_file_bytes);
        changed!(SelectedFileBytes, selected_file_bytes);
        changed!(PieceCount, piece_count);
        changed!(TotalSizeBytes, total_size_bytes);
        changed!(VerifiedPieceCount, verified_piece_count);
        changed!(RequestedBytes, requested_bytes);
        changed!(ReceivedBytes, received_bytes);
        changed!(StoredBytes, stored_bytes);
        changed!(ActivePeerConnections, active_peer_connections);
        changed!(ConfiguredTrackerCount, configured_tracker_count);
        changed!(PayloadDownloadRateBytes, payload_download_rate_bytes);
        changed!(RequiredPayloadBytes, required_payload_bytes);
        changed!(RemainingPayloadBytes, remaining_payload_bytes);
        changed!(EtaPayloadDownloadRateBytes, eta_payload_download_rate_bytes);
        changed!(Eta, eta);
        changed!(Lifetime, lifetime);
        changed!(Seeding, seeding);
        changed!(Progress, progress);
        changed!(Checking, checking);
        changed!(Archived, archived);
        changed!(RemovalState, removal_state);
        changed!(DeleteDataSupported, delete_data_supported);
        changed!(ForceRecheckAvailable, force_recheck_available);
        changed!(Error, error);
        (!fields.is_empty()).then(|| Self {
            torrent_id: current.torrent_id.clone(),
            fields,
        })
    }

    pub fn apply(&self, row: &mut TorrentView) -> Result<(), RowUpdateError> {
        if self.torrent_id != row.torrent_id {
            return Err(RowUpdateError::IdentityMismatch);
        }
        validate_fields(&self.fields)?;
        self.fields.iter().for_each(|field| field.apply_to(row));
        Ok(())
    }

    pub fn validate(&self) -> Result<(), RowUpdateError> {
        validate_fields(&self.fields)
    }

    pub(crate) fn merge(&mut self, next: &Self) -> Result<(), RowUpdateError> {
        if self.torrent_id != next.torrent_id {
            return Err(RowUpdateError::IdentityMismatch);
        }
        validate_fields(&self.fields)?;
        validate_fields(&next.fields)?;
        merge_fields(&mut self.fields, &next.fields);
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "change", rename_all = "snake_case")]
// This boundary enum is short-lived and UniFFI-generated. Boxing the complete
// row would complicate that shared boundary without reducing retained state.
#[allow(clippy::large_enum_variant)]
pub enum TorrentViewChange {
    Replace { torrent: Option<TorrentView> },
    Update { update: TorrentRowUpdate },
}

semantic_fields!(
    FileFieldUpdate,
    FileFieldKind,
    FileView,
    {
        Selection => selection: Option<FileSelectionView>,
        DoneBytes => done_bytes: String,
        VerifiedBytes => verified_bytes: String,
        MediaAvailability => media_availability: MediaFileAvailability
    }
);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct FileRowUpdate {
    pub file_id: String,
    pub fields: Vec<FileFieldUpdate>,
}

impl FileRowUpdate {
    pub(crate) fn between(previous: &FileView, current: &FileView) -> Option<Self> {
        if previous.file_id != current.file_id
            || previous.file_index != current.file_index
            || previous.path != current.path
            || previous.length_bytes != current.length_bytes
            || previous.torrent_offset_bytes != current.torrent_offset_bytes
            || previous.first_piece != current.first_piece
            || previous.last_piece != current.last_piece
            || previous.padding != current.padding
        {
            return None;
        }
        let mut fields = Vec::new();
        macro_rules! changed {
            ($variant:ident, $field:ident) => {
                if previous.$field != current.$field {
                    fields.push(FileFieldUpdate::$variant {
                        value: current.$field.clone(),
                    });
                }
            };
        }
        changed!(Selection, selection);
        changed!(DoneBytes, done_bytes);
        changed!(VerifiedBytes, verified_bytes);
        changed!(MediaAvailability, media_availability);
        (!fields.is_empty()).then(|| Self {
            file_id: current.file_id.clone(),
            fields,
        })
    }

    pub(crate) fn apply(&self, row: &mut FileView) -> Result<(), RowUpdateError> {
        if self.file_id != row.file_id {
            return Err(RowUpdateError::IdentityMismatch);
        }
        validate_fields(&self.fields)?;
        self.fields.iter().for_each(|field| field.apply_to(row));
        Ok(())
    }

    pub(crate) fn merge(&mut self, next: &Self) -> Result<(), RowUpdateError> {
        if self.file_id != next.file_id {
            return Err(RowUpdateError::IdentityMismatch);
        }
        validate_fields(&self.fields)?;
        validate_fields(&next.fields)?;
        merge_fields(&mut self.fields, &next.fields);
        Ok(())
    }
}

semantic_fields!(
    PeerFieldUpdate,
    PeerFieldKind,
    PeerView,
    {
        PeerRecordId => peer_record_id: Option<String>,
        Direction => direction: PeerDirection,
        Transport => transport: PeerTransportKind,
        Lifecycle => lifecycle: PeerLifecycle,
        Role => role: PeerRole,
        PeerFlags => peer_flags: Vec<PeerFlagView>,
        MseMethod => mse_method: Option<PeerMseMethodView>,
        LifecycleAgeMillis => lifecycle_age_millis: String,
        RemoteEndpoint => remote_endpoint: String,
        LocalEndpoint => local_endpoint: Option<String>,
        Sources => sources: Vec<PeerSourceView>,
        PeerId => peer_id: Option<String>,
        ClientName => client_name: Option<String>,
        SupportsExtensions => supports_extensions: Option<bool>,
        SupportsUtMetadata => supports_ut_metadata: Option<bool>,
        LocalInterested => local_interested: Option<bool>,
        RemoteInterested => remote_interested: Option<bool>,
        RemoteChoking => remote_choking: Option<bool>,
        LocalChoking => local_choking: Option<bool>,
        AvailablePieceCount => available_piece_count: Option<u32>,
        WantedPieceCount => wanted_piece_count: Option<u32>,
        PayloadDownloadRateBytes => payload_download_rate_bytes: Option<String>,
        PayloadDownloadedBytes => payload_downloaded_bytes: Option<String>,
        ProtocolDownloadRateBytes => protocol_download_rate_bytes: Option<String>,
        ProtocolDownloadedBytes => protocol_downloaded_bytes: Option<String>,
        PayloadUploadRateBytes => payload_upload_rate_bytes: Option<String>,
        PayloadUploadedBytes => payload_uploaded_bytes: Option<String>,
        PendingRequests => pending_requests: Option<u32>,
        TargetRequests => target_requests: Option<u32>,
        QueuedPayloadBytes => queued_payload_bytes: Option<String>,
        OldestRequestAgeMillis => oldest_request_age_millis: Option<String>,
        RequestTimeoutMillis => request_timeout_millis: Option<String>,
        RequestPhase => request_phase: Option<PeerRequestPhase>,
        ConnectedAgeMillis => connected_age_millis: Option<String>,
        LastUsefulAgeMillis => last_useful_age_millis: Option<String>,
        LastPayloadAgeMillis => last_payload_age_millis: Option<String>,
        DisconnectReason => disconnect_reason: Option<PeerDisconnectReason>,
        Capabilities => capabilities: PeerFieldCapabilities
    }
);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PeerRowUpdate {
    pub connection_id: String,
    pub fields: Vec<PeerFieldUpdate>,
}

impl PeerRowUpdate {
    pub(crate) fn between(previous: &PeerView, current: &PeerView) -> Option<Self> {
        if previous.connection_id != current.connection_id
            || previous.torrent_id != current.torrent_id
        {
            return None;
        }
        let mut fields = Vec::new();
        macro_rules! changed {
            ($variant:ident, $field:ident) => {
                if previous.$field != current.$field {
                    fields.push(PeerFieldUpdate::$variant {
                        value: current.$field.clone(),
                    });
                }
            };
        }
        changed!(PeerRecordId, peer_record_id);
        changed!(Direction, direction);
        changed!(Transport, transport);
        changed!(Lifecycle, lifecycle);
        changed!(Role, role);
        changed!(PeerFlags, peer_flags);
        changed!(MseMethod, mse_method);
        changed!(LifecycleAgeMillis, lifecycle_age_millis);
        changed!(RemoteEndpoint, remote_endpoint);
        changed!(LocalEndpoint, local_endpoint);
        changed!(Sources, sources);
        changed!(PeerId, peer_id);
        changed!(ClientName, client_name);
        changed!(SupportsExtensions, supports_extensions);
        changed!(SupportsUtMetadata, supports_ut_metadata);
        changed!(LocalInterested, local_interested);
        changed!(RemoteInterested, remote_interested);
        changed!(RemoteChoking, remote_choking);
        changed!(LocalChoking, local_choking);
        changed!(AvailablePieceCount, available_piece_count);
        changed!(WantedPieceCount, wanted_piece_count);
        changed!(PayloadDownloadRateBytes, payload_download_rate_bytes);
        changed!(PayloadDownloadedBytes, payload_downloaded_bytes);
        changed!(ProtocolDownloadRateBytes, protocol_download_rate_bytes);
        changed!(ProtocolDownloadedBytes, protocol_downloaded_bytes);
        changed!(PayloadUploadRateBytes, payload_upload_rate_bytes);
        changed!(PayloadUploadedBytes, payload_uploaded_bytes);
        changed!(PendingRequests, pending_requests);
        changed!(TargetRequests, target_requests);
        changed!(QueuedPayloadBytes, queued_payload_bytes);
        changed!(OldestRequestAgeMillis, oldest_request_age_millis);
        changed!(RequestTimeoutMillis, request_timeout_millis);
        changed!(RequestPhase, request_phase);
        changed!(ConnectedAgeMillis, connected_age_millis);
        changed!(LastUsefulAgeMillis, last_useful_age_millis);
        changed!(LastPayloadAgeMillis, last_payload_age_millis);
        changed!(DisconnectReason, disconnect_reason);
        changed!(Capabilities, capabilities);
        (!fields.is_empty()).then(|| Self {
            connection_id: current.connection_id.clone(),
            fields,
        })
    }

    pub(crate) fn apply(&self, row: &mut PeerView) -> Result<(), RowUpdateError> {
        if self.connection_id != row.connection_id {
            return Err(RowUpdateError::IdentityMismatch);
        }
        validate_fields(&self.fields)?;
        self.fields.iter().for_each(|field| field.apply_to(row));
        Ok(())
    }

    pub(crate) fn merge(&mut self, next: &Self) -> Result<(), RowUpdateError> {
        if self.connection_id != next.connection_id {
            return Err(RowUpdateError::IdentityMismatch);
        }
        validate_fields(&self.fields)?;
        validate_fields(&next.fields)?;
        merge_fields(&mut self.fields, &next.fields);
        Ok(())
    }
}

semantic_fields!(
    ActivePieceFieldUpdate,
    ActivePieceFieldKind,
    ActivePiece,
    {
        Stage => stage: ActivePieceStageView,
        Requested => requested: Vec<IndexRange>,
        Received => received: Vec<IndexRange>,
        Stored => stored: Vec<IndexRange>,
        AgeMillis => age_millis: String,
        Error => error: Option<String>
    }
);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ActivePieceUpdate {
    pub piece_id: String,
    pub fields: Vec<ActivePieceFieldUpdate>,
}

impl ActivePieceUpdate {
    pub(crate) fn between(previous: &ActivePiece, current: &ActivePiece) -> Option<Self> {
        if previous.piece_id != current.piece_id
            || previous.piece_index != current.piece_index
            || previous.attempt != current.attempt
            || previous.piece_length != current.piece_length
        {
            return None;
        }
        let mut fields = Vec::new();
        macro_rules! changed {
            ($variant:ident, $field:ident) => {
                if previous.$field != current.$field {
                    fields.push(ActivePieceFieldUpdate::$variant {
                        value: current.$field.clone(),
                    });
                }
            };
        }
        changed!(Stage, stage);
        changed!(Requested, requested);
        changed!(Received, received);
        changed!(Stored, stored);
        changed!(AgeMillis, age_millis);
        changed!(Error, error);
        (!fields.is_empty()).then(|| Self {
            piece_id: current.piece_id.clone(),
            fields,
        })
    }

    pub(crate) fn apply(&self, row: &mut ActivePiece) -> Result<(), RowUpdateError> {
        if self.piece_id != row.piece_id {
            return Err(RowUpdateError::IdentityMismatch);
        }
        validate_fields(&self.fields)?;
        self.fields.iter().for_each(|field| field.apply_to(row));
        Ok(())
    }

    pub(crate) fn merge(&mut self, next: &Self) -> Result<(), RowUpdateError> {
        if self.piece_id != next.piece_id {
            return Err(RowUpdateError::IdentityMismatch);
        }
        validate_fields(&self.fields)?;
        validate_fields(&next.fields)?;
        merge_fields(&mut self.fields, &next.fields);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control::{RemovalState, StorageState, TorrentProtocolIdentities, TorrentState};
    use crate::settings::{TorrentTransferLimits, TransferRateLimit};
    use crate::views::{
        CapabilityStatus, CheckingPhaseView, ProgressAction, ProgressDisposition, ProgressPhase,
        ProgressReason, ViewPatch, coalesce_patch,
    };

    const TORRENT_ID: &str = "t1-000102030405060708090a0b0c0d0e0f";

    fn torrent() -> TorrentView {
        TorrentView {
            torrent_id: TORRENT_ID.to_owned(),
            protocol_identities: TorrentProtocolIdentities {
                v1: Some("000102030405060708090a0b0c0d0e0f10111213".to_owned()),
                v2: None,
            },
            display_name: None,
            source_display_name: None,
            state: TorrentState::Downloading,
            operational_state: TorrentOperationalState::Downloading,
            download_queue_position: None,
            transfer_limits: TorrentTransferLimits::default(),
            storage_state: StorageState::Available,
            storage_root: "downloads".to_owned(),
            metadata_available: false,
            private_torrent: false,
            awaiting_file_selection: false,
            pending_file_selection_position: None,
            file_catalog_id: None,
            selectable_file_count: 0,
            selected_file_count: 0,
            selectable_file_bytes: "0".to_owned(),
            selected_file_bytes: "0".to_owned(),
            piece_count: 1,
            total_size_bytes: None,
            verified_piece_count: 0,
            requested_bytes: "0".to_owned(),
            received_bytes: "0".to_owned(),
            stored_bytes: "0".to_owned(),
            active_peer_connections: 0,
            configured_tracker_count: None,
            payload_download_rate_bytes: "0".to_owned(),
            required_payload_bytes: None,
            remaining_payload_bytes: None,
            eta_payload_download_rate_bytes: "0".to_owned(),
            eta: TorrentEtaView::Unavailable,
            lifetime: TorrentLifetimeView::default(),
            seeding: TorrentSeedingView::default(),
            progress: ProgressAssessment {
                disposition: ProgressDisposition::Active,
                phase: ProgressPhase::Transfer,
                reason: ProgressReason::TransferringPieces,
                actions: Vec::new(),
            },
            checking: None,
            archived: false,
            removal_state: None,
            delete_data_supported: false,
            force_recheck_available: false,
            error: None,
        }
    }

    #[test]
    fn torrent_diff_and_apply_cover_every_mutable_field_and_nullable_clear() {
        let previous = torrent();
        let mut current = previous.clone();
        current.protocol_identities.v2 = Some("11".repeat(32));
        current.display_name = Some("verified".to_owned());
        current.source_display_name = Some("source".to_owned());
        current.state = TorrentState::Paused;
        current.operational_state = TorrentOperationalState::Paused;
        current.download_queue_position = Some(3);
        current.transfer_limits = TorrentTransferLimits {
            upload: TransferRateLimit::Limited {
                bytes_per_second: 1024,
            },
            download: TransferRateLimit::Unlimited,
        };
        current.storage_state = StorageState::Available;
        current.metadata_available = true;
        current.private_torrent = true;
        current.piece_count = 4;
        current.total_size_bytes = Some("32771".to_owned());
        current.verified_piece_count = 2;
        current.requested_bytes = "5".to_owned();
        current.received_bytes = "6".to_owned();
        current.stored_bytes = "7".to_owned();
        current.active_peer_connections = 8;
        current.configured_tracker_count = Some(9);
        current.payload_download_rate_bytes = "10".to_owned();
        current.required_payload_bytes = Some("11".to_owned());
        current.remaining_payload_bytes = Some("12".to_owned());
        current.eta_payload_download_rate_bytes = "13".to_owned();
        current.eta = TorrentEtaView::WarmingUp;
        current.lifetime.uploaded_payload_bytes = "14".to_owned();
        current.lifetime.share_ratio_hundredths = Some("1400".to_owned());
        current.seeding.admission = crate::SeedAdmissionView::Active;
        current.seeding.goal = Some(crate::SeedGoalView {
            status: crate::SeedGoalStatusView::Unmet,
            share_ratio_met: false,
            finished_download_ratio_met: false,
            finished_time_met: false,
        });
        current.progress = ProgressAssessment {
            disposition: ProgressDisposition::Waiting,
            phase: ProgressPhase::Discovery,
            reason: ProgressReason::DiscoveringPeers,
            actions: vec![ProgressAction::EnableDiscovery],
        };
        current.checking = Some(CheckingProgressView {
            generation: "1".to_owned(),
            phase: CheckingPhaseView::Hashing,
            pieces_total: 4,
            pieces_processed: 1,
            pieces_matched: 1,
            pieces_absent: 0,
            pieces_mismatched: 0,
            bytes_hashed: "16".to_owned(),
            active_hash_jobs: 1,
            queued_hash_jobs: 2,
            elapsed_millis: "17".to_owned(),
            last_advance_age_millis: "18".to_owned(),
            oldest_active_job_age_millis: Some("19".to_owned()),
        });
        current.archived = true;
        current.removal_state = Some(RemovalState::Pending);
        current.delete_data_supported = true;
        current.force_recheck_available = true;
        current.error = Some("failure".to_owned());

        let update = TorrentRowUpdate::between(&previous, &current).expect("all fields changed");
        assert_eq!(update.fields.len(), 31);
        let mut applied = previous;
        update.apply(&mut applied).expect("apply");
        assert_eq!(applied, current);

        let mut cleared = current.clone();
        cleared.display_name = None;
        cleared.source_display_name = None;
        cleared.download_queue_position = None;
        cleared.configured_tracker_count = None;
        cleared.total_size_bytes = None;
        cleared.required_payload_bytes = None;
        cleared.remaining_payload_bytes = None;
        cleared.checking = None;
        cleared.removal_state = None;
        cleared.error = None;
        let clear = TorrentRowUpdate::between(&current, &cleared).expect("nullable clears");
        clear.apply(&mut current).expect("apply clears");
        assert_eq!(current, cleared);
    }

    #[test]
    fn private_flag_is_absent_on_the_wire_for_public_rows() {
        let public = torrent();
        let wire = serde_json::to_value(&public).expect("serialize public row");
        assert!(wire.get("private_torrent").is_none());
        let decoded: TorrentView = serde_json::from_value(wire).expect("decode public row");
        assert!(!decoded.private_torrent);

        let mut private = public.clone();
        private.private_torrent = true;
        let wire = serde_json::to_value(&private).expect("serialize private row");
        assert_eq!(wire["private_torrent"], serde_json::Value::Bool(true));
        let update = TorrentRowUpdate::between(&public, &private).expect("flag changed");
        assert_eq!(
            update.fields,
            vec![TorrentFieldUpdate::PrivateTorrent { value: true }]
        );
    }

    fn peer() -> PeerView {
        PeerView {
            connection_id: "1".to_owned(),
            torrent_id: TORRENT_ID.to_owned(),
            peer_record_id: None,
            direction: PeerDirection::Incoming,
            transport: PeerTransportKind::Tcp,
            lifecycle: PeerLifecycle::TransportConnecting,
            role: PeerRole::Metadata,
            peer_flags: Vec::new(),
            mse_method: None,
            lifecycle_age_millis: "0".to_owned(),
            remote_endpoint: "127.0.0.1:1".to_owned(),
            local_endpoint: None,
            sources: Vec::new(),
            peer_id: None,
            client_name: None,
            supports_extensions: None,
            supports_ut_metadata: None,
            local_interested: None,
            remote_interested: None,
            remote_choking: None,
            local_choking: None,
            available_piece_count: None,
            wanted_piece_count: None,
            payload_download_rate_bytes: None,
            payload_downloaded_bytes: None,
            protocol_download_rate_bytes: None,
            protocol_downloaded_bytes: None,
            payload_upload_rate_bytes: None,
            payload_uploaded_bytes: None,
            pending_requests: None,
            target_requests: None,
            queued_payload_bytes: None,
            oldest_request_age_millis: None,
            request_timeout_millis: None,
            request_phase: None,
            connected_age_millis: None,
            last_useful_age_millis: None,
            last_payload_age_millis: None,
            disconnect_reason: None,
            capabilities: PeerFieldCapabilities {
                local_endpoint: CapabilityStatus::Unavailable,
                client_name: CapabilityStatus::Unavailable,
                ut_metadata: CapabilityStatus::Unavailable,
                interest_directions: CapabilityStatus::Unavailable,
                local_choke: CapabilityStatus::Unavailable,
                piece_availability: CapabilityStatus::Unavailable,
                protocol_rates: CapabilityStatus::Unavailable,
                upload: CapabilityStatus::Unavailable,
                metadata_stage: CapabilityStatus::Unavailable,
            },
        }
    }

    #[test]
    fn peer_diff_and_apply_cover_every_mutable_field() {
        let previous = peer();
        let mut current = previous.clone();
        current.peer_record_id = Some("2".to_owned());
        current.direction = PeerDirection::Outgoing;
        current.transport = PeerTransportKind::Utp;
        current.lifecycle = PeerLifecycle::Connected;
        current.role = PeerRole::Content;
        current.peer_flags = vec![PeerFlagView::Incoming];
        current.mse_method = Some(PeerMseMethodView::Rc4);
        current.lifecycle_age_millis = "1".to_owned();
        current.remote_endpoint = "127.0.0.1:2".to_owned();
        current.local_endpoint = Some("127.0.0.1:3".to_owned());
        current.sources = vec![PeerSourceView::Tracker];
        current.peer_id = Some("peer".to_owned());
        current.client_name = Some("client".to_owned());
        current.supports_extensions = Some(true);
        current.supports_ut_metadata = Some(true);
        current.local_interested = Some(true);
        current.remote_interested = Some(true);
        current.remote_choking = Some(true);
        current.local_choking = Some(true);
        current.available_piece_count = Some(1);
        current.wanted_piece_count = Some(1);
        current.payload_download_rate_bytes = Some("1".to_owned());
        current.payload_downloaded_bytes = Some("2".to_owned());
        current.protocol_download_rate_bytes = Some("3".to_owned());
        current.protocol_downloaded_bytes = Some("4".to_owned());
        current.payload_upload_rate_bytes = Some("5".to_owned());
        current.payload_uploaded_bytes = Some("6".to_owned());
        current.pending_requests = Some(7);
        current.target_requests = Some(8);
        current.queued_payload_bytes = Some("9".to_owned());
        current.oldest_request_age_millis = Some("10".to_owned());
        current.request_timeout_millis = Some("11".to_owned());
        current.request_phase = Some(PeerRequestPhase::Steady);
        current.connected_age_millis = Some("12".to_owned());
        current.last_useful_age_millis = Some("13".to_owned());
        current.last_payload_age_millis = Some("14".to_owned());
        current.disconnect_reason = Some(PeerDisconnectReason::RemoteClosed);
        current.capabilities.local_endpoint = CapabilityStatus::Available;

        let update = PeerRowUpdate::between(&previous, &current).expect("all fields changed");
        assert_eq!(update.fields.len(), 38);
        let mut applied = previous;
        update.apply(&mut applied).expect("apply");
        assert_eq!(applied, current);
    }

    #[test]
    fn file_and_active_piece_updates_preserve_immutable_identity() {
        let file = FileView {
            file_id: "0".to_owned(),
            file_index: 0,
            path: vec!["file".to_owned()],
            length_bytes: "16".to_owned(),
            torrent_offset_bytes: "0".to_owned(),
            first_piece: Some(0),
            last_piece: Some(0),
            selection: None,
            padding: false,
            done_bytes: "0".to_owned(),
            verified_bytes: "0".to_owned(),
            media_availability: MediaFileAvailability::Unverified,
        };
        let mut next_file = file.clone();
        next_file.selection = Some(FileSelectionView::High);
        next_file.done_bytes = "16".to_owned();
        next_file.verified_bytes = "16".to_owned();
        next_file.media_availability = MediaFileAvailability::Available;
        let update = FileRowUpdate::between(&file, &next_file).expect("file fields");
        assert_eq!(update.fields.len(), 4);
        let mut applied_file = file.clone();
        update.apply(&mut applied_file).expect("apply file");
        assert_eq!(applied_file, next_file);
        next_file.path.push("identity drift".to_owned());
        assert!(FileRowUpdate::between(&file, &next_file).is_none());

        let piece = ActivePiece {
            piece_id: "0:1".to_owned(),
            piece_index: 0,
            attempt: 1,
            piece_length: 16,
            stage: ActivePieceStageView::Requested,
            requested: Vec::new(),
            received: Vec::new(),
            stored: Vec::new(),
            age_millis: "0".to_owned(),
            error: None,
        };
        let mut next_piece = piece.clone();
        next_piece.stage = ActivePieceStageView::Failed;
        next_piece.requested = vec![IndexRange::new(0, 4).expect("range")];
        next_piece.received = vec![IndexRange::new(4, 8).expect("range")];
        next_piece.stored = vec![IndexRange::new(8, 12).expect("range")];
        next_piece.age_millis = "1".to_owned();
        next_piece.error = Some("failed".to_owned());
        let update = ActivePieceUpdate::between(&piece, &next_piece).expect("piece fields");
        assert_eq!(update.fields.len(), 6);
        let mut applied_piece = piece.clone();
        update.apply(&mut applied_piece).expect("apply piece");
        assert_eq!(applied_piece, next_piece);
        next_piece.attempt = 2;
        assert!(ActivePieceUpdate::between(&piece, &next_piece).is_none());
    }

    #[test]
    fn malformed_field_sets_are_rejected_and_merge_is_canonical() {
        let mut row = torrent();
        let empty = TorrentRowUpdate {
            torrent_id: TORRENT_ID.to_owned(),
            fields: Vec::new(),
        };
        assert_eq!(empty.apply(&mut row), Err(RowUpdateError::EmptyFields));
        let duplicate = TorrentRowUpdate {
            torrent_id: TORRENT_ID.to_owned(),
            fields: vec![
                TorrentFieldUpdate::DisplayName {
                    value: Some("one".to_owned()),
                },
                TorrentFieldUpdate::DisplayName {
                    value: Some("two".to_owned()),
                },
            ],
        };
        assert_eq!(
            duplicate.apply(&mut row),
            Err(RowUpdateError::DuplicateField)
        );

        let mut first = TorrentRowUpdate {
            torrent_id: TORRENT_ID.to_owned(),
            fields: vec![TorrentFieldUpdate::StoredBytes {
                value: "1".to_owned(),
            }],
        };
        first
            .merge(&TorrentRowUpdate {
                torrent_id: TORRENT_ID.to_owned(),
                fields: vec![
                    TorrentFieldUpdate::DisplayName { value: None },
                    TorrentFieldUpdate::StoredBytes {
                        value: "2".to_owned(),
                    },
                ],
            })
            .expect("merge");
        assert!(matches!(
            first.fields.as_slice(),
            [
                TorrentFieldUpdate::DisplayName { value: None },
                TorrentFieldUpdate::StoredBytes { value }
            ] if value == "2"
        ));
    }

    fn library_patch(
        upsert: Vec<TorrentView>,
        updates: Vec<TorrentRowUpdate>,
        removed: Vec<String>,
    ) -> ViewPatch {
        ViewPatch::TorrentList {
            upsert,
            updates,
            removed,
            storage: None,
            client_settings: None,
        }
    }

    #[test]
    fn sparse_coalescing_applies_to_full_rows_and_merges_newest_fields() {
        let mut current = library_patch(vec![torrent()], Vec::new(), Vec::new());
        let next = library_patch(
            Vec::new(),
            vec![TorrentRowUpdate {
                torrent_id: TORRENT_ID.to_owned(),
                fields: vec![
                    TorrentFieldUpdate::DisplayName {
                        value: Some("first".to_owned()),
                    },
                    TorrentFieldUpdate::StoredBytes {
                        value: "1".to_owned(),
                    },
                ],
            }],
            Vec::new(),
        );
        assert!(coalesce_patch(&mut current, &next));
        assert!(matches!(
            &current,
            ViewPatch::TorrentList {
                upsert,
                updates,
                removed,
                ..
            } if upsert[0].display_name.as_deref() == Some("first")
                && upsert[0].stored_bytes == "1"
                && updates.is_empty()
                && removed.is_empty()
        ));

        let mut current = library_patch(
            Vec::new(),
            vec![TorrentRowUpdate {
                torrent_id: TORRENT_ID.to_owned(),
                fields: vec![TorrentFieldUpdate::StoredBytes {
                    value: "1".to_owned(),
                }],
            }],
            Vec::new(),
        );
        let next = library_patch(
            Vec::new(),
            vec![TorrentRowUpdate {
                torrent_id: TORRENT_ID.to_owned(),
                fields: vec![
                    TorrentFieldUpdate::DisplayName { value: None },
                    TorrentFieldUpdate::StoredBytes {
                        value: "2".to_owned(),
                    },
                ],
            }],
            Vec::new(),
        );
        assert!(coalesce_patch(&mut current, &next));
        assert!(matches!(
            &current,
            ViewPatch::TorrentList { updates, .. }
                if matches!(
                    updates[0].fields.as_slice(),
                    [
                        TorrentFieldUpdate::DisplayName { value: None },
                        TorrentFieldUpdate::StoredBytes { value }
                    ] if value == "2"
                )
        ));
    }

    #[test]
    fn sparse_coalescing_preserves_remove_reinsert_barriers_and_rejects_ambiguity() {
        let mut current = library_patch(
            Vec::new(),
            vec![TorrentRowUpdate {
                torrent_id: TORRENT_ID.to_owned(),
                fields: vec![TorrentFieldUpdate::StoredBytes {
                    value: "1".to_owned(),
                }],
            }],
            Vec::new(),
        );
        assert!(coalesce_patch(
            &mut current,
            &library_patch(Vec::new(), Vec::new(), vec![TORRENT_ID.to_owned()])
        ));
        assert!(matches!(
            &current,
            ViewPatch::TorrentList {
                upsert,
                updates,
                removed,
                ..
            } if upsert.is_empty() && updates.is_empty() && removed == &[TORRENT_ID]
        ));

        assert!(coalesce_patch(
            &mut current,
            &library_patch(vec![torrent()], Vec::new(), Vec::new())
        ));
        assert!(matches!(
            &current,
            ViewPatch::TorrentList {
                upsert,
                updates,
                removed,
                ..
            } if upsert.len() == 1 && updates.is_empty() && removed.is_empty()
        ));

        let duplicate = torrent();
        let mut malformed =
            library_patch(vec![duplicate.clone(), duplicate], Vec::new(), Vec::new());
        assert!(!coalesce_patch(
            &mut malformed,
            &library_patch(Vec::new(), Vec::new(), Vec::new())
        ));

        let mut removed = library_patch(Vec::new(), Vec::new(), vec![TORRENT_ID.to_owned()]);
        assert!(!coalesce_patch(
            &mut removed,
            &library_patch(
                Vec::new(),
                vec![TorrentRowUpdate {
                    torrent_id: TORRENT_ID.to_owned(),
                    fields: vec![TorrentFieldUpdate::StoredBytes {
                        value: "2".to_owned(),
                    }],
                }],
                Vec::new(),
            )
        ));
    }
}
