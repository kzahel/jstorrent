use std::error::Error;
use std::fmt::Write;
use std::path::{Path, PathBuf};

use rstorrent_gateway::{
    ApiError, ApiErrorCode, ApiErrorEnvelope, ApplicationClientFrame, ApplicationConnectionError,
    ApplicationConnectionErrorCode, ApplicationConnectionLimits, ApplicationServerFrame,
    ChooseDownloadRootRequest, ChooseDownloadRootResponse, CreateMediaUrlRequest,
};
use rstorrent_session::{
    ActiveDownloadsClampReason, ActivePiece, ActivePieceFieldUpdate, ActivePieceStageView,
    ActivePieceUpdate, ActiveSeedLimit, AddTorrentBytesRequest, AddTorrentDisposition,
    AddTorrentResult, AdvertisedPeerEndpointScope, AdvertisedPeerEndpointStatus,
    AdvertisedPeerEndpointUnavailableReason, ApiBackendIdentity, ApiEncoding, ApiHello, ApiLimits,
    ApiVersion, ApplicationCall, ApplicationCallResult, ApplicationNetworkPrerequisiteView,
    ApplicationNetworkRuntimeState, ApplicationNetworkRuntimeView, BandwidthDirectionRuntimeView,
    BandwidthRuntimeView, CapabilityStatus, CatalogPageRequest, CatalogPageView, CheckingPhaseView,
    CheckingProgressView, ClientSettings, ClientSettingsApplicationState,
    ClientSettingsDegradedReason, ClientSettingsPatch, ClientSettingsRuntimeView, Command,
    CommandResult, DeliveryMode, DeliveryPolicy, DhtAddressFamilyView, DhtBucketView,
    DhtFamilyInspectionView, DhtInspectionView, DhtLifecycleView, DhtLookupView,
    DhtNetworkPolicyView, DiagnosticCategory, DiagnosticEvent, DiagnosticField, DiagnosticFilter,
    DiagnosticProfile, DiagnosticRetention, DiagnosticSeverity, DiagnosticSubject, DiagnosticValue,
    DiskCheckpointStageView, DiskPieceStageView, DiskPieceView, DiskPipelineView, DiskPressureView,
    EffectiveListenerSettings, EncryptionPolicy, ErrorCode, ErrorResponse, FileCatalogState,
    FileFieldUpdate, FileIndexRange, FilePriority, FileRowUpdate, FileSelectionIntent,
    FileSelectionOverride, FileSelectionView, FileView, HttpsServerAuthenticationPolicy,
    IndexRange, IntegrityPreparationPhaseView, IntegrityPreparationView, Ipv6PinholeFailureStage,
    Ipv6PinholeStatus, ListenerBindFailureReason, ListenerPolicy, ListenerStatus,
    MagnetExportResult, MagnetExportSource, MediaCatalogState, MediaFileAvailability,
    MediaItemView, MediaRoleView, MediaUrlOutcome, MediaUrlResponse, MetadataAcquisitionPhaseView,
    MetadataAcquisitionView, OpenViewSetOptions, OpenViewSetRequest, OpenViewSetResponse,
    PeerDirection, PeerDisconnectReason, PeerFieldCapabilities, PeerFieldUpdate, PeerFlagView,
    PeerLifecycle, PeerMseMethodView, PeerRequestPhase, PeerRole, PeerRowUpdate, PeerSourceView,
    PeerTransportKind, PeerView, PendingFileSelectionBase, PortMappingFailureStage,
    PortMappingMechanism, PortMappingPolicy, PortMappingStatus, ProgressAction, ProgressAssessment,
    ProgressDisposition, ProgressPhase, ProgressReason, RemovalDataPolicy, RemovalState,
    RequestEnvelope, ResetReason, ResponseEnvelope, ResponseOutcome, SeedAdmissionView,
    SeedGoalStatusView, SeedGoalView, ServiceSnapshot, SessionCurrentRatesView, SessionUdpStatus,
    SpeedCurrentRate, SpeedHistoryAppend, SpeedHistoryView, SpeedMetric, SpeedMetricAvailability,
    SpeedPersistenceState, SpeedRange, SpeedSeriesAppend, SpeedSeriesView, StorageRootAvailability,
    StorageRootSnapshot, StorageSettingsSnapshot, StorageState, SubscriptionSpec,
    SwarmCatalogState, SwarmCountsView, SwarmPeerState, SwarmPeerView, TorrentEtaView,
    TorrentFieldUpdate, TorrentLifetimeView, TorrentOperationalState, TorrentPreparationView,
    TorrentProtocolIdentities, TorrentRowUpdate, TorrentSeedingView, TorrentSettingsPatch,
    TorrentSnapshot, TorrentState, TorrentTransferLimits, TorrentView, TorrentViewChange,
    TrackerAnnounceEventView, TrackerCatalogState, TrackerConnectionFamilyView,
    TrackerNextActionView, TrackerSecurityView, TrackerSourceView, TrackerStatusView,
    TrackerTransportView, TrackerView, TransferRateLimit, TransportAddressFamily,
    TransportFamilyRuntimeView, UpdateBatch, UpdateViewSetRequest, ViewDeliveryPolicy, ViewPatch,
    ViewProjection, ViewSelector, ViewSetUpdate, ViewSnapshot, ViewSpec, ViewUpdate,
    ViewUpdatePayload,
};
use schemars::JsonSchema;
use serde::Serialize;
use serde_json::{Map, Value};
use ts_rs::{Config, TS};

const SCHEMA_ID: &str = "https://rstorrent.invalid/schemas/api/v1";

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = std::env::args_os().skip(1).map(PathBuf::from);
    let declarations_output = arguments
        .next()
        .ok_or("usage: export_types TYPES SCHEMA [FIXTURE] [VIEW_SET_FIXTURE]")?;
    let schema_output = arguments
        .next()
        .ok_or("usage: export_types TYPES SCHEMA [FIXTURE] [VIEW_SET_FIXTURE]")?;
    let fixture_output = arguments.next();
    let view_set_fixture_output = arguments.next();
    if arguments.next().is_some() {
        return Err("usage: export_types TYPES SCHEMA [FIXTURE] [VIEW_SET_FIXTURE]".into());
    }

    write_declarations(&declarations_output)?;
    write_schema(&schema_output)?;
    if let Some(output) = fixture_output {
        write_fixture(output)?;
    }
    if let Some(output) = view_set_fixture_output {
        write_view_set_fixture(output)?;
    }
    Ok(())
}

fn write_declarations(output: &Path) -> Result<(), Box<dyn Error>> {
    let mut declarations = String::from(
        "// Generated by `cargo run -p rstorrent-gateway --bin export_types`.\n\
         // Do not edit by hand.\n\n",
    );
    append::<TransferRateLimit>(&mut declarations)?;
    append::<TorrentTransferLimits>(&mut declarations)?;
    append::<TorrentSettingsPatch>(&mut declarations)?;
    append::<ActiveSeedLimit>(&mut declarations)?;
    append::<ClientSettingsPatch>(&mut declarations)?;
    append::<PendingFileSelectionBase>(&mut declarations)?;
    append::<FileSelectionOverride>(&mut declarations)?;
    append::<Command>(&mut declarations)?;
    append::<ListenerPolicy>(&mut declarations)?;
    append::<PortMappingPolicy>(&mut declarations)?;
    append::<EncryptionPolicy>(&mut declarations)?;
    append::<HttpsServerAuthenticationPolicy>(&mut declarations)?;
    append::<ClientSettings>(&mut declarations)?;
    append::<EffectiveListenerSettings>(&mut declarations)?;
    append::<ClientSettingsDegradedReason>(&mut declarations)?;
    append::<ClientSettingsApplicationState>(&mut declarations)?;
    append::<ListenerBindFailureReason>(&mut declarations)?;
    append::<ListenerStatus>(&mut declarations)?;
    append::<PortMappingMechanism>(&mut declarations)?;
    append::<PortMappingFailureStage>(&mut declarations)?;
    append::<PortMappingStatus>(&mut declarations)?;
    append::<Ipv6PinholeFailureStage>(&mut declarations)?;
    append::<Ipv6PinholeStatus>(&mut declarations)?;
    append::<AdvertisedPeerEndpointScope>(&mut declarations)?;
    append::<AdvertisedPeerEndpointUnavailableReason>(&mut declarations)?;
    append::<AdvertisedPeerEndpointStatus>(&mut declarations)?;
    append::<SessionUdpStatus>(&mut declarations)?;
    append::<TransportAddressFamily>(&mut declarations)?;
    append::<TransportFamilyRuntimeView>(&mut declarations)?;
    append::<ActiveDownloadsClampReason>(&mut declarations)?;
    append::<BandwidthDirectionRuntimeView>(&mut declarations)?;
    append::<BandwidthRuntimeView>(&mut declarations)?;
    append::<ApplicationNetworkPrerequisiteView>(&mut declarations)?;
    append::<ApplicationNetworkRuntimeState>(&mut declarations)?;
    append::<ApplicationNetworkRuntimeView>(&mut declarations)?;
    append::<ClientSettingsRuntimeView>(&mut declarations)?;
    append_value(
        &mut declarations,
        "DEFAULT_CLIENT_SETTINGS",
        "ClientSettings",
        &ClientSettings::fresh_profile_default(),
    )?;
    append_value(
        &mut declarations,
        "DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW",
        "ClientSettingsRuntimeView",
        &ClientSettingsRuntimeView::fresh_profile_default(),
    )?;
    append::<FilePriority>(&mut declarations)?;
    append::<RemovalDataPolicy>(&mut declarations)?;
    append::<RemovalState>(&mut declarations)?;
    append::<ErrorCode>(&mut declarations)?;
    append::<ErrorResponse>(&mut declarations)?;
    append::<FileIndexRange>(&mut declarations)?;
    append::<FileSelectionIntent>(&mut declarations)?;
    append::<AddTorrentBytesRequest>(&mut declarations)?;
    append::<RequestEnvelope>(&mut declarations)?;
    append::<AddTorrentDisposition>(&mut declarations)?;
    append::<AddTorrentResult>(&mut declarations)?;
    append::<MagnetExportSource>(&mut declarations)?;
    append::<MagnetExportResult>(&mut declarations)?;
    append::<CommandResult>(&mut declarations)?;
    append::<ResponseOutcome>(&mut declarations)?;
    append::<ResponseEnvelope>(&mut declarations)?;
    append::<TorrentState>(&mut declarations)?;
    append::<StorageState>(&mut declarations)?;
    append::<TorrentProtocolIdentities>(&mut declarations)?;
    append::<TorrentSnapshot>(&mut declarations)?;
    append::<StorageRootAvailability>(&mut declarations)?;
    append::<StorageRootSnapshot>(&mut declarations)?;
    append::<StorageSettingsSnapshot>(&mut declarations)?;
    append::<ServiceSnapshot>(&mut declarations)?;
    append::<ViewSelector>(&mut declarations)?;
    append::<ViewProjection>(&mut declarations)?;
    append::<DeliveryPolicy>(&mut declarations)?;
    append::<DiagnosticSeverity>(&mut declarations)?;
    append::<DiagnosticCategory>(&mut declarations)?;
    append::<DiagnosticProfile>(&mut declarations)?;
    append::<DiagnosticFilter>(&mut declarations)?;
    append::<DiagnosticSubject>(&mut declarations)?;
    append::<DiagnosticValue>(&mut declarations)?;
    append::<DiagnosticField>(&mut declarations)?;
    append::<DiagnosticEvent>(&mut declarations)?;
    append::<DiagnosticRetention>(&mut declarations)?;
    append::<ProgressDisposition>(&mut declarations)?;
    append::<ProgressPhase>(&mut declarations)?;
    append::<ProgressReason>(&mut declarations)?;
    append::<ProgressAction>(&mut declarations)?;
    append::<ProgressAssessment>(&mut declarations)?;
    append::<SubscriptionSpec>(&mut declarations)?;
    append::<IndexRange>(&mut declarations)?;
    append::<CatalogPageRequest>(&mut declarations)?;
    append::<CatalogPageView>(&mut declarations)?;
    append::<ActivePieceStageView>(&mut declarations)?;
    append::<ActivePiece>(&mut declarations)?;
    append::<ActivePieceFieldUpdate>(&mut declarations)?;
    append::<ActivePieceUpdate>(&mut declarations)?;
    append::<DiskPressureView>(&mut declarations)?;
    append::<DiskCheckpointStageView>(&mut declarations)?;
    append::<DiskPieceStageView>(&mut declarations)?;
    append::<DiskPipelineView>(&mut declarations)?;
    append::<DiskPieceView>(&mut declarations)?;
    append::<DhtLifecycleView>(&mut declarations)?;
    append::<DhtNetworkPolicyView>(&mut declarations)?;
    append::<DhtAddressFamilyView>(&mut declarations)?;
    append::<DhtBucketView>(&mut declarations)?;
    append::<DhtLookupView>(&mut declarations)?;
    append::<DhtFamilyInspectionView>(&mut declarations)?;
    append::<DhtInspectionView>(&mut declarations)?;
    append::<SpeedMetric>(&mut declarations)?;
    append::<SpeedRange>(&mut declarations)?;
    append::<SpeedPersistenceState>(&mut declarations)?;
    append::<SpeedSeriesView>(&mut declarations)?;
    append::<SpeedMetricAvailability>(&mut declarations)?;
    append::<SpeedCurrentRate>(&mut declarations)?;
    append::<SessionCurrentRatesView>(&mut declarations)?;
    append::<SpeedHistoryView>(&mut declarations)?;
    append::<SpeedSeriesAppend>(&mut declarations)?;
    append::<SpeedHistoryAppend>(&mut declarations)?;
    append::<TorrentEtaView>(&mut declarations)?;
    append::<CheckingPhaseView>(&mut declarations)?;
    append::<CheckingProgressView>(&mut declarations)?;
    append::<MetadataAcquisitionPhaseView>(&mut declarations)?;
    append::<MetadataAcquisitionView>(&mut declarations)?;
    append::<IntegrityPreparationPhaseView>(&mut declarations)?;
    append::<IntegrityPreparationView>(&mut declarations)?;
    append::<TorrentPreparationView>(&mut declarations)?;
    append::<TorrentOperationalState>(&mut declarations)?;
    append::<SeedAdmissionView>(&mut declarations)?;
    append::<SeedGoalStatusView>(&mut declarations)?;
    append::<SeedGoalView>(&mut declarations)?;
    append::<TorrentLifetimeView>(&mut declarations)?;
    append::<TorrentSeedingView>(&mut declarations)?;
    append::<TorrentView>(&mut declarations)?;
    append::<TorrentFieldUpdate>(&mut declarations)?;
    append::<TorrentRowUpdate>(&mut declarations)?;
    append::<TorrentViewChange>(&mut declarations)?;
    append::<CapabilityStatus>(&mut declarations)?;
    append::<PeerDirection>(&mut declarations)?;
    append::<PeerTransportKind>(&mut declarations)?;
    append::<PeerMseMethodView>(&mut declarations)?;
    append::<PeerFlagView>(&mut declarations)?;
    append::<PeerLifecycle>(&mut declarations)?;
    append::<PeerRole>(&mut declarations)?;
    append::<PeerRequestPhase>(&mut declarations)?;
    append::<PeerSourceView>(&mut declarations)?;
    append::<PeerDisconnectReason>(&mut declarations)?;
    append::<PeerFieldCapabilities>(&mut declarations)?;
    append::<PeerView>(&mut declarations)?;
    append::<PeerFieldUpdate>(&mut declarations)?;
    append::<PeerRowUpdate>(&mut declarations)?;
    append::<SwarmCatalogState>(&mut declarations)?;
    append::<SwarmCountsView>(&mut declarations)?;
    append::<SwarmPeerState>(&mut declarations)?;
    append::<SwarmPeerView>(&mut declarations)?;
    append::<FileSelectionView>(&mut declarations)?;
    append::<FileCatalogState>(&mut declarations)?;
    append::<FileView>(&mut declarations)?;
    append::<FileFieldUpdate>(&mut declarations)?;
    append::<FileRowUpdate>(&mut declarations)?;
    append::<MediaCatalogState>(&mut declarations)?;
    append::<MediaRoleView>(&mut declarations)?;
    append::<MediaItemView>(&mut declarations)?;
    append::<TrackerCatalogState>(&mut declarations)?;
    append::<TrackerTransportView>(&mut declarations)?;
    append::<TrackerSecurityView>(&mut declarations)?;
    append::<TrackerConnectionFamilyView>(&mut declarations)?;
    append::<TrackerSourceView>(&mut declarations)?;
    append::<TrackerStatusView>(&mut declarations)?;
    append::<TrackerAnnounceEventView>(&mut declarations)?;
    append::<TrackerNextActionView>(&mut declarations)?;
    append::<TrackerView>(&mut declarations)?;
    append::<ViewSnapshot>(&mut declarations)?;
    append::<ViewPatch>(&mut declarations)?;
    append::<ResetReason>(&mut declarations)?;
    append::<ViewUpdatePayload>(&mut declarations)?;
    append::<ViewUpdate>(&mut declarations)?;
    append::<ApiErrorCode>(&mut declarations)?;
    append::<ApiError>(&mut declarations)?;
    append::<ApiErrorEnvelope>(&mut declarations)?;
    append::<ChooseDownloadRootRequest>(&mut declarations)?;
    append::<ChooseDownloadRootResponse>(&mut declarations)?;
    append::<CreateMediaUrlRequest>(&mut declarations)?;
    append::<MediaFileAvailability>(&mut declarations)?;
    append::<MediaUrlOutcome>(&mut declarations)?;
    append::<MediaUrlResponse>(&mut declarations)?;
    append::<ApiEncoding>(&mut declarations)?;
    append::<DeliveryMode>(&mut declarations)?;
    append::<ApiVersion>(&mut declarations)?;
    append::<ApiLimits>(&mut declarations)?;
    append::<ApiBackendIdentity>(&mut declarations)?;
    append::<ApiHello>(&mut declarations)?;
    append::<ViewDeliveryPolicy>(&mut declarations)?;
    append::<ViewSpec>(&mut declarations)?;
    append::<OpenViewSetOptions>(&mut declarations)?;
    append::<OpenViewSetRequest>(&mut declarations)?;
    append::<UpdateViewSetRequest>(&mut declarations)?;
    append::<ViewSetUpdate>(&mut declarations)?;
    append::<UpdateBatch>(&mut declarations)?;
    append::<OpenViewSetResponse>(&mut declarations)?;
    append::<ApplicationCall>(&mut declarations)?;
    append::<ApplicationCallResult>(&mut declarations)?;
    append::<ApplicationConnectionErrorCode>(&mut declarations)?;
    append::<ApplicationConnectionError>(&mut declarations)?;
    append::<ApplicationConnectionLimits>(&mut declarations)?;
    append::<ApplicationClientFrame>(&mut declarations)?;
    append::<ApplicationServerFrame>(&mut declarations)?;
    write_file(output, declarations)
}

fn append<T: TS>(output: &mut String) -> Result<(), std::fmt::Error> {
    let declaration = T::decl(&Config::default())
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");
    writeln!(output, "export {declaration}\n")
}

fn append_value<T: Serialize>(
    output: &mut String,
    constant: &str,
    type_name: &str,
    value: &T,
) -> Result<(), Box<dyn Error>> {
    let value = serde_json::to_string(value)?;
    writeln!(output, "export const {constant}: {type_name} = {value};\n")?;
    Ok(())
}

fn write_schema(output: &Path) -> Result<(), Box<dyn Error>> {
    let mut definitions = Map::new();
    add_schema::<ApiErrorEnvelope>(&mut definitions, "ApiErrorEnvelope")?;
    add_schema::<ChooseDownloadRootRequest>(&mut definitions, "ChooseDownloadRootRequest")?;
    add_schema::<ChooseDownloadRootResponse>(&mut definitions, "ChooseDownloadRootResponse")?;
    add_schema::<CreateMediaUrlRequest>(&mut definitions, "CreateMediaUrlRequest")?;
    add_schema::<MediaUrlResponse>(&mut definitions, "MediaUrlResponse")?;
    add_schema::<ApiHello>(&mut definitions, "ApiHello")?;
    add_schema::<AddTorrentBytesRequest>(&mut definitions, "AddTorrentBytesRequest")?;
    add_schema::<RequestEnvelope>(&mut definitions, "RequestEnvelope")?;
    add_schema::<ResponseEnvelope>(&mut definitions, "ResponseEnvelope")?;
    add_schema::<OpenViewSetRequest>(&mut definitions, "OpenViewSetRequest")?;
    add_schema::<UpdateViewSetRequest>(&mut definitions, "UpdateViewSetRequest")?;
    add_schema::<OpenViewSetResponse>(&mut definitions, "OpenViewSetResponse")?;
    add_schema::<UpdateBatch>(&mut definitions, "UpdateBatch")?;
    add_schema::<ApplicationClientFrame>(&mut definitions, "ApplicationClientFrame")?;
    add_schema::<ApplicationServerFrame>(&mut definitions, "ApplicationServerFrame")?;

    let document = Value::Object(Map::from_iter([
        (
            "$schema".to_owned(),
            Value::String("https://json-schema.org/draft/2020-12/schema".to_owned()),
        ),
        ("$id".to_owned(), Value::String(SCHEMA_ID.to_owned())),
        ("$defs".to_owned(), Value::Object(definitions)),
    ]));
    let mut encoded = serde_json::to_string_pretty(&document)?;
    encoded.push('\n');
    write_file(output, encoded)
}

fn add_schema<T: JsonSchema>(
    definitions: &mut Map<String, Value>,
    name: &str,
) -> Result<(), Box<dyn Error>> {
    let mut root = schemars::schema_for!(T).to_value();
    let object = root
        .as_object_mut()
        .ok_or("generated JSON Schema root is not an object")?;
    object.remove("$schema");
    if let Some(Value::Object(nested)) = object.remove("$defs") {
        for (nested_name, nested_schema) in nested {
            insert_definition(definitions, nested_name, nested_schema)?;
        }
    }
    object.remove("title");
    insert_definition(definitions, name.to_owned(), root)
}

fn insert_definition(
    definitions: &mut Map<String, Value>,
    name: String,
    schema: Value,
) -> Result<(), Box<dyn Error>> {
    if let Some(previous) = definitions.get(&name) {
        if previous != &schema {
            return Err(format!("conflicting generated schema definition {name}").into());
        }
    } else {
        definitions.insert(name, schema);
    }
    Ok(())
}

fn write_file(output: &Path, contents: impl AsRef<[u8]>) -> Result<(), Box<dyn Error>> {
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(output, contents)?;
    Ok(())
}

fn write_fixture(output: PathBuf) -> Result<(), Box<dyn Error>> {
    let torrent_id = "t1-000102030405060708090a0b0c0d0e0f".to_owned();
    let updates = vec![
        ViewUpdate {
            contract_version: rstorrent_session::VIEW_CONTRACT_VERSION,
            stream_id: "41".to_owned(),
            epoch: "9".to_owned(),
            sequence: "1".to_owned(),
            base_revision: "7".to_owned(),
            revision: "7".to_owned(),
            payload: ViewUpdatePayload::Snapshot {
                snapshot: ViewSnapshot::PieceActivity {
                    torrent_id: torrent_id.clone(),
                    piece_count: 1_000_000,
                    verified: vec![IndexRange {
                        start: 65_536,
                        end_exclusive: 70_000,
                    }],
                    active: Vec::new(),
                },
            },
        },
        ViewUpdate {
            contract_version: rstorrent_session::VIEW_CONTRACT_VERSION,
            stream_id: "41".to_owned(),
            epoch: "9".to_owned(),
            sequence: "2".to_owned(),
            base_revision: "7".to_owned(),
            revision: "7".to_owned(),
            payload: ViewUpdatePayload::Patch {
                patch: ViewPatch::PieceActivity {
                    torrent_id,
                    piece_count: 1_000_000,
                    verified: vec![IndexRange {
                        start: 900_000,
                        end_exclusive: 900_001,
                    }],
                    cleared: vec![IndexRange {
                        start: 65_536,
                        end_exclusive: 65_537,
                    }],
                    active_upsert: vec![ActivePiece {
                        piece_id: "900001:1".to_owned(),
                        piece_index: 900_001,
                        attempt: 1,
                        piece_length: 32 * 1024 * 1024,
                        stage: ActivePieceStageView::Requested,
                        requested: vec![IndexRange {
                            start: 0,
                            end_exclusive: 16 * 1024,
                        }],
                        received: Vec::new(),
                        stored: Vec::new(),
                        age_millis: "125".to_owned(),
                        error: None,
                    }],
                    active_updates: Vec::new(),
                    active_removed: Vec::new(),
                },
            },
        },
    ];
    let mut encoded = serde_json::to_string_pretty(&updates)?;
    encoded.push('\n');
    write_file(&output, encoded)
}

#[derive(Serialize)]
struct ViewSetFixture {
    open: OpenViewSetResponse,
    updates: Vec<UpdateBatch>,
}

fn write_view_set_fixture(output: PathBuf) -> Result<(), Box<dyn Error>> {
    let view_set_id = "vs_000102030405060708090a0b0c0d0e0f".to_owned();
    let torrent_id = "t1-000102030405060708090a0b0c0d0e0f".to_owned();
    let view = ViewSpec::TorrentList {
        view_id: "library".to_owned(),
        delivery: ViewDeliveryPolicy::default(),
    };
    let initial = UpdateBatch {
        server_now_millis: "0".to_owned(),
        api_version: rstorrent_session::API_VERSION,
        view_set_id: view_set_id.clone(),
        epoch: "10".to_owned(),
        base_cursor: "0".to_owned(),
        cursor: "1".to_owned(),
        durable_revision: "7".to_owned(),
        updates: vec![ViewSetUpdate::Snapshot {
            view_id: "library".to_owned(),
            snapshot: ViewSnapshot::TorrentList {
                torrents: vec![fixture_torrent(&torrent_id, 0)],
                storage: Default::default(),
                client_settings: Default::default(),
            },
        }],
    };
    let patch = UpdateBatch {
        server_now_millis: "0".to_owned(),
        api_version: rstorrent_session::API_VERSION,
        view_set_id: view_set_id.clone(),
        epoch: "10".to_owned(),
        base_cursor: "1".to_owned(),
        cursor: "2".to_owned(),
        durable_revision: "8".to_owned(),
        updates: vec![ViewSetUpdate::Patch {
            view_id: "library".to_owned(),
            patch: ViewPatch::TorrentList {
                upsert: vec![fixture_torrent(&torrent_id, 1)],
                updates: Vec::new(),
                removed: Vec::new(),
                storage: None,
                client_settings: None,
            },
        }],
    };
    let reset = UpdateBatch {
        server_now_millis: "0".to_owned(),
        api_version: rstorrent_session::API_VERSION,
        view_set_id: view_set_id.clone(),
        epoch: "11".to_owned(),
        base_cursor: "2".to_owned(),
        cursor: "3".to_owned(),
        durable_revision: "9".to_owned(),
        updates: vec![
            ViewSetUpdate::ResetRequired {
                view_id: None,
                reason: ResetReason::QueueOverflow,
            },
            ViewSetUpdate::Snapshot {
                view_id: "library".to_owned(),
                snapshot: ViewSnapshot::TorrentList {
                    torrents: vec![fixture_torrent(&torrent_id, 3)],
                    storage: Default::default(),
                    client_settings: Default::default(),
                },
            },
        ],
    };
    let fixture = ViewSetFixture {
        open: OpenViewSetResponse {
            view_set_id,
            lease_millis: "300000".to_owned(),
            effective_queue_bytes: 262_144,
            effective_views: vec![view],
            initial,
        },
        updates: vec![patch, reset],
    };
    let mut encoded = serde_json::to_string_pretty(&fixture)?;
    encoded.push('\n');
    write_file(&output, encoded)
}

fn fixture_torrent(torrent_id: &str, verified: u32) -> TorrentView {
    TorrentView {
        torrent_id: torrent_id.to_owned(),
        protocol_identities: rstorrent_session::TorrentProtocolIdentities {
            v1: Some("000102030405060708090a0b0c0d0e0f10111213".to_owned()),
            v2: None,
        },
        display_name: Some("Fixture torrent".to_owned()),
        source_display_name: None,
        state: if verified == 3 {
            TorrentState::Complete
        } else {
            TorrentState::Downloading
        },
        operational_state: if verified == 3 {
            TorrentOperationalState::Seeding
        } else {
            TorrentOperationalState::Downloading
        },
        download_queue_position: if verified == 3 { None } else { Some(1) },
        transfer_limits: TorrentTransferLimits::default(),
        storage_state: StorageState::Available,
        storage_root: "downloads".to_owned(),
        metadata_available: true,
        awaiting_file_selection: false,
        pending_file_selection_position: None,
        file_catalog_id: None,
        selectable_file_count: 0,
        selected_file_count: 0,
        selectable_file_bytes: "0".to_owned(),
        selected_file_bytes: "0".to_owned(),
        piece_count: 3,
        total_size_bytes: Some("49152".to_owned()),
        verified_piece_count: verified,
        requested_bytes: "16384".to_owned(),
        received_bytes: "16384".to_owned(),
        stored_bytes: "16384".to_owned(),
        active_peer_connections: 0,
        configured_tracker_count: Some(2),
        payload_download_rate_bytes: "0".to_owned(),
        required_payload_bytes: Some("49152".to_owned()),
        remaining_payload_bytes: Some(if verified == 3 { "0" } else { "32768" }.to_owned()),
        eta_payload_download_rate_bytes: if verified == 3 { "0" } else { "4096" }.to_owned(),
        eta: if verified == 3 {
            TorrentEtaView::Unavailable
        } else {
            TorrentEtaView::Estimate {
                seconds: "8".to_owned(),
            }
        },
        lifetime: rstorrent_session::TorrentLifetimeView {
            share_ratio_hundredths: Some("0".to_owned()),
            ..rstorrent_session::TorrentLifetimeView::default()
        },
        seeding: if verified == 3 {
            rstorrent_session::TorrentSeedingView {
                admission: rstorrent_session::SeedAdmissionView::Active,
                goal: Some(rstorrent_session::SeedGoalView {
                    status: rstorrent_session::SeedGoalStatusView::Unmet,
                    share_ratio_met: false,
                    finished_download_ratio_met: false,
                    finished_time_met: false,
                }),
            }
        } else {
            rstorrent_session::TorrentSeedingView::default()
        },
        progress: ProgressAssessment {
            disposition: if verified == 3 {
                ProgressDisposition::Inactive
            } else {
                ProgressDisposition::Active
            },
            phase: if verified == 3 {
                ProgressPhase::Complete
            } else {
                ProgressPhase::Transfer
            },
            reason: if verified == 3 {
                ProgressReason::Complete
            } else {
                ProgressReason::TransferringPieces
            },
            actions: Vec::new(),
        },
        checking: None,
        archived: false,
        removal_state: None,
        delete_data_supported: true,
        force_recheck_available: true,
        error: None,
    }
}
