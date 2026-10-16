use std::error::Error;
use std::fmt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rstorrent_engine::dht::{DhtIdentity, DhtSnapshot};
use rstorrent_engine::{ContentFingerprint, TorrentId, validate_content_name};
use rstorrent_protocol::bencode::ParseError;
use rstorrent_protocol::content::{ContentFileRef, TorrentContent, TorrentContentProjection};
use rstorrent_protocol::dht::{DhtEndpoint, DhtIp, NodeContact, NodeId};
use rstorrent_protocol::identity::{FullInfoHash, InfoHashes, V1InfoHash, V2InfoHash};
use rstorrent_protocol::magnet::{
    FileIndexRange as MagnetFileIndexRange, MAX_MAGNET_LENGTH, MAX_PEER_HINTS, MAX_TRACKERS,
    Magnet, MagnetShareParameters, PeerHint, SelectOnly, TrackerUrl, TrackerUrlTransport,
    replace_share_parameters,
};
use rstorrent_protocol::metainfo::{
    DURABLE_METAINFO_LIMITS, EXPLICIT_IMPORT_METAINFO_LIMITS, Metainfo, MetainfoError,
    MetainfoTrackerTransport, ParsedInfo, ParsedInfoKind,
};
use rstorrent_protocol::storage_layout::{ContentLayout, FileSelection};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use sha2::{Digest as Sha256Digest, Sha256};

use crate::control::{
    AddTorrentBytesRequest, AddTorrentDisposition, AddTorrentResult, Command, CommandResult,
    ErrorCode, FilePriority, FileSelectionIntent, FileSelectionOverride,
    MAX_FILE_SELECTION_ENTRIES, MagnetExportOptions, MagnetExportResult, MagnetExportSource,
    MagnetPeerHint, MagnetPeerHintOmission, PendingFileSelectionBase, RemovalDataPolicy,
    RemovalState, RequestEnvelope, ResponseEnvelope, ServiceSnapshot, StorageState,
    TorrentSnapshot, TorrentState, encode_info_hash, parse_revision,
    validate_add_torrent_bytes_request, validate_identifier, validate_request,
};
use crate::download_queue::{self, QueueEdge};
use crate::durable_state::{DerivedStateInput, VerificationState, derive_torrent_state};
use crate::have::{HaveError, HaveState, MAX_DURABLE_HAVE_STATE_BYTES, MAX_DURABLE_PIECES};
use crate::product_state::{ProductMilestone, ProductMilestoneKind};
use crate::profile_reset::{
    CatalogPreparation, DATABASE_FILENAME, ProfileResetReport, prepare_catalog,
    write_pre_migration_copy,
};
use crate::settings::{
    ClientSettings, SettingsPersistenceError, StorageRootAvailability, StorageRootSnapshot,
    StorageSettingsSnapshot, TorrentSeedStopLimit, TorrentSeedStopLimits, TorrentSettingsPatch,
    TorrentTransferLimits, TransferRateLimit, create_client_settings, read_client_settings,
    replace_client_settings,
};
use crate::share_peer_hints::{ShareEndpointFacts, select_peer_hints};
use crate::store_schema::{
    BASELINE_SCHEMA_VERSION, DHT_TABLES_SQL, DOWNLOAD_QUEUE_INDEX_SQL, FILE_PRIORITIES_TABLE_SQL,
    REMOVAL_TABLE_SQL, SCHEMA_VERSION, SOURCE_TABLES_SQL,
};

const MAX_RECEIPTS: i64 = 1024;
/// Tactical 339/340 quiet network defaults; see `apply_quiet_network_defaults_once`.
const QUIET_NETWORK_DEFAULTS_VERSION: i64 = 1;
const MAX_PENDING_PRODUCT_MILESTONES: i64 = 1024;
pub(crate) const EPHEMERAL_SESSION_MAX_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_STORAGE_ROOTS: usize = 32;
pub const MAX_STORAGE_ROOT_LOCATOR_LENGTH: usize = 4096;
const BUSY_TIMEOUT: Duration = Duration::from_secs(2);

mod legacy_desktop;
mod torrent_list_export;
pub use legacy_desktop::{
    LegacyAndroidBootstrap, LegacyAndroidRootBinding, LegacyDesktopImportReport,
    LegacyDesktopRecordOutcome,
};
pub(crate) use torrent_list_export::torrent_list_export_from;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfiguredStorageRoot {
    pub id: String,
    pub label: String,
    pub location: StorageRootLocation,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageRootLocation {
    Path(PathBuf),
    PlatformCapability,
}

impl ConfiguredStorageRoot {
    pub fn path(id: impl Into<String>, path: PathBuf) -> Self {
        let id = id.into();
        let label = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or(&id)
            .to_owned();
        Self {
            id,
            label,
            location: StorageRootLocation::Path(path),
        }
    }

    pub fn platform(id: impl Into<String>) -> Self {
        let id = id.into();
        Self {
            label: id.clone(),
            id,
            location: StorageRootLocation::PlatformCapability,
        }
    }

    pub fn with_label(mut self, label: impl Into<String>) -> Self {
        self.label = label.into();
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoredStorageRoot {
    pub id: String,
    pub label: String,
    pub location: StorageRootLocation,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StoredTrackerTransport {
    Udp,
    Http,
    Https,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StoredTrackerSource {
    Magnet,
    Metainfo,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoredTracker {
    pub tier: u32,
    pub position: u32,
    pub url: String,
    pub transport: StoredTrackerTransport,
    pub source: StoredTrackerSource,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResumeRecord {
    pub torrent_id: TorrentId,
    pub info_hashes: InfoHashes,
    pub magnet: String,
    pub storage_root: String,
    pub skip_files: Vec<u32>,
    pub high_priority_files: Vec<u32>,
    pub trackers: Vec<StoredTracker>,
    pub state: TorrentState,
    pub storage_state: StorageState,
    pub desired_running: bool,
    pub download_queue_position: Option<i64>,
    pub accounting: TorrentAccounting,
    pub raw_info: Option<Vec<u8>>,
    /// Verbatim complete outer metainfo. Pure-v2 restart requires this source
    /// because `raw_info` cannot carry piece layers.
    pub metainfo_source: Option<Vec<u8>>,
    pub have: Option<HaveState>,
    pub(crate) verification: VerificationState,
    pub(crate) quarantine_reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct TorrentAccounting {
    pub total_uploaded: u64,
    pub total_downloaded: u64,
    pub active_seconds: u64,
    pub finished_seconds: u64,
    pub seeding_seconds: u64,
    pub tracker_complete: Option<u32>,
    pub tracker_incomplete: Option<u32>,
}

pub(crate) const MAX_ACCOUNTING_BATCH: usize = 500;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct TorrentAccountingUpdate {
    pub(crate) torrent_id: TorrentId,
    pub(crate) accounting: TorrentAccounting,
}

fn decode_torrent_accounting(
    total_uploaded: i64,
    total_downloaded: i64,
    active_seconds: i64,
    finished_seconds: i64,
    seeding_seconds: i64,
    tracker_complete: Option<i64>,
    tracker_incomplete: Option<i64>,
) -> Result<TorrentAccounting, StoreError> {
    let accounting = TorrentAccounting {
        total_uploaded: u64::try_from(total_uploaded)
            .map_err(|_| StoreError::DurableState("negative lifetime upload total".to_owned()))?,
        total_downloaded: u64::try_from(total_downloaded)
            .map_err(|_| StoreError::DurableState("negative lifetime download total".to_owned()))?,
        active_seconds: u64::try_from(active_seconds)
            .map_err(|_| StoreError::DurableState("negative active time".to_owned()))?,
        finished_seconds: u64::try_from(finished_seconds)
            .map_err(|_| StoreError::DurableState("negative finished time".to_owned()))?,
        seeding_seconds: u64::try_from(seeding_seconds)
            .map_err(|_| StoreError::DurableState("negative seeding time".to_owned()))?,
        tracker_complete: tracker_complete
            .map(u32::try_from)
            .transpose()
            .map_err(|_| StoreError::DurableState("invalid tracker complete count".to_owned()))?,
        tracker_incomplete: tracker_incomplete
            .map(u32::try_from)
            .transpose()
            .map_err(|_| StoreError::DurableState("invalid tracker incomplete count".to_owned()))?,
    };
    if accounting.finished_seconds > accounting.active_seconds {
        return Err(StoreError::DurableState(
            "finished time exceeds active time".to_owned(),
        ));
    }
    if accounting.seeding_seconds > accounting.finished_seconds {
        return Err(StoreError::DurableState(
            "seeding time exceeds finished time".to_owned(),
        ));
    }
    Ok(accounting)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct EncodedTorrentAccounting {
    total_uploaded: i64,
    total_downloaded: i64,
    active_seconds: i64,
    finished_seconds: i64,
    seeding_seconds: i64,
    tracker_complete: Option<i64>,
    tracker_incomplete: Option<i64>,
}

fn encode_torrent_accounting(
    accounting: TorrentAccounting,
) -> Result<EncodedTorrentAccounting, StoreError> {
    if accounting.finished_seconds > accounting.active_seconds {
        return Err(StoreError::DurableState(
            "finished time exceeds active time".to_owned(),
        ));
    }
    if accounting.seeding_seconds > accounting.finished_seconds {
        return Err(StoreError::DurableState(
            "seeding time exceeds finished time".to_owned(),
        ));
    }
    let bounded = |value, field| {
        i64::try_from(value)
            .map_err(|_| StoreError::DurableState(format!("{field} exceeds durable range")))
    };
    Ok(EncodedTorrentAccounting {
        total_uploaded: bounded(accounting.total_uploaded, "lifetime upload total")?,
        total_downloaded: bounded(accounting.total_downloaded, "lifetime download total")?,
        active_seconds: bounded(accounting.active_seconds, "active time")?,
        finished_seconds: bounded(accounting.finished_seconds, "finished time")?,
        seeding_seconds: bounded(accounting.seeding_seconds, "seeding time")?,
        tracker_complete: accounting.tracker_complete.map(i64::from),
        tracker_incomplete: accounting.tracker_incomplete.map(i64::from),
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RemovalRecord {
    pub torrent_id: String,
    pub operation_id: String,
    pub storage_root: String,
    pub policy: RemovalDataPolicy,
    pub state: RemovalState,
    pub raw_info: Option<Vec<u8>>,
    pub error: Option<String>,
}

pub struct SessionStore {
    connection: Connection,
    profile_id: String,
    database_path: Option<PathBuf>,
    reset_client_settings: ClientSettings,
    pending_reconciliations: Vec<PendingReconciliation>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PendingReconciliation {
    pub(crate) winner: String,
    pub(crate) loser: String,
}

pub(crate) struct PreparedTorrentBytes {
    source: Vec<u8>,
    source_digest: [u8; 32],
    projection: TorrentContentProjection,
    selection_default: FilePriority,
    selection_exceptions: Vec<u32>,
}

impl PreparedTorrentBytes {
    pub(crate) fn full_identity(&self) -> FullInfoHash {
        match &self.projection.content {
            TorrentContent::V1(content) => {
                FullInfoHash::V1(V1InfoHash::new(content.metainfo.info_hash))
            }
            TorrentContent::V2(content) => FullInfoHash::V2(
                content
                    .info_hashes
                    .v2_hash()
                    .expect("pure-v2 projection has a v2 identity"),
            ),
            TorrentContent::Hybrid(content) => FullInfoHash::V1(
                content
                    .info_hashes
                    .v1_hash()
                    .expect("hybrid projection has a v1 identity"),
            ),
        }
    }
}

pub(crate) fn prepare_torrent_bytes(
    request: &AddTorrentBytesRequest,
    source: Vec<u8>,
) -> Result<PreparedTorrentBytes, (ErrorCode, String)> {
    validate_add_torrent_bytes_request(request)?;
    if source.len() != request.source_length as usize {
        return Err((
            ErrorCode::InvalidRequest,
            format!(
                "torrent source length {} does not match declared length {}",
                source.len(),
                request.source_length
            ),
        ));
    }
    let source_digest: [u8; 32] = Sha256::digest(&source).into();
    let projection =
        TorrentContentProjection::from_bytes_with_limits(&source, EXPLICIT_IMPORT_METAINFO_LIMITS)
            .map_err(metainfo_intake_error)?;
    let (selection_default, selection_exceptions) =
        project_content_file_selection(&request.selection, &projection.content)?;
    Ok(PreparedTorrentBytes {
        source,
        source_digest,
        projection,
        selection_default,
        selection_exceptions,
    })
}

fn project_content_file_selection(
    selection: &FileSelectionIntent,
    content: &TorrentContent,
) -> Result<(FilePriority, Vec<u32>), (ErrorCode, String)> {
    let files = content.files().collect::<Vec<_>>();
    project_file_selection_refs(selection, &files)
}

#[cfg(test)]
fn project_file_selection(
    selection: &FileSelectionIntent,
    files: &[rstorrent_protocol::metainfo::MetainfoFile],
) -> Result<(FilePriority, Vec<u32>), (ErrorCode, String)> {
    let files = files.iter().map(ContentFileRef::V1).collect::<Vec<_>>();
    project_file_selection_refs(selection, &files)
}

fn project_file_selection_refs(
    selection: &FileSelectionIntent,
    files: &[ContentFileRef<'_>],
) -> Result<(FilePriority, Vec<u32>), (ErrorCode, String)> {
    if let FileSelectionIntent::WantedRanges { ranges } = selection
        && ranges
            .last()
            .is_some_and(|range| range.end_exclusive as usize > files.len())
    {
        return Err((
            ErrorCode::InvalidRequest,
            "file selection range exceeds the torrent file catalog".to_owned(),
        ));
    }
    let mut exceptions = Vec::new();
    let ranges = match selection {
        FileSelectionIntent::All => return Ok((FilePriority::Normal, exceptions)),
        FileSelectionIntent::None => None,
        FileSelectionIntent::WantedRanges { ranges } => Some(ranges.as_slice()),
    };
    let mut range_index = 0;
    for (index, file) in files.iter().enumerate() {
        if file.padding() {
            continue;
        }
        let index_u32 = u32::try_from(index).map_err(|_| {
            (
                ErrorCode::InvalidRequest,
                "torrent file index exceeds the supported range".to_owned(),
            )
        })?;
        let wanted = ranges.is_some_and(|ranges| {
            while ranges
                .get(range_index)
                .is_some_and(|range| range.end_exclusive <= index_u32)
            {
                range_index += 1;
            }
            ranges
                .get(range_index)
                .is_some_and(|range| range.start <= index_u32 && index_u32 < range.end_exclusive)
        });
        if wanted {
            exceptions.push(index_u32);
            if exceptions.len() > MAX_FILE_SELECTION_ENTRIES {
                return Err((
                    ErrorCode::ResourceLimit,
                    format!("file selection exceeds {MAX_FILE_SELECTION_ENTRIES} exceptions"),
                ));
            }
        }
    }
    Ok((FilePriority::Skip, exceptions))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct DatabasePageUsage {
    pub(crate) page_size: u64,
    pub(crate) page_count: u64,
    pub(crate) maximum_page_count: u64,
}

impl fmt::Debug for SessionStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SessionStore")
            .field("profile_id", &self.profile_id)
            .field("database_path", &self.database_path)
            .finish_non_exhaustive()
    }
}

impl SessionStore {
    pub fn open(
        profile_root: &Path,
        profile_id: &str,
        storage_roots: &[ConfiguredStorageRoot],
    ) -> Result<Self, StoreError> {
        Self::open_with_initial_client_settings(
            profile_root,
            profile_id,
            storage_roots,
            &ClientSettings::default(),
        )
    }

    pub(crate) fn open_with_initial_client_settings(
        profile_root: &Path,
        profile_id: &str,
        storage_roots: &[ConfiguredStorageRoot],
        initial_client_settings: &ClientSettings,
    ) -> Result<Self, StoreError> {
        std::fs::create_dir_all(profile_root).map_err(|source| StoreError::Io {
            operation: "create profile directory",
            source,
        })?;
        let preparation = prepare_catalog(profile_root)?;
        let database_path = profile_root.join(DATABASE_FILENAME);
        let connection = Connection::open(&database_path)?;
        Self::initialize(
            connection,
            profile_id,
            storage_roots,
            Some(database_path),
            None,
            initial_client_settings,
            Some((profile_root, preparation)),
        )
    }

    pub fn open_ephemeral(
        profile_id: &str,
        storage_roots: &[ConfiguredStorageRoot],
    ) -> Result<Self, StoreError> {
        Self::open_ephemeral_with_maximum_bytes(
            profile_id,
            storage_roots,
            EPHEMERAL_SESSION_MAX_BYTES,
        )
    }

    pub(crate) fn open_ephemeral_with_initial_client_settings(
        profile_id: &str,
        storage_roots: &[ConfiguredStorageRoot],
        initial_client_settings: &ClientSettings,
    ) -> Result<Self, StoreError> {
        Self::initialize(
            Connection::open_in_memory()?,
            profile_id,
            storage_roots,
            None,
            Some(EPHEMERAL_SESSION_MAX_BYTES),
            initial_client_settings,
            None,
        )
    }

    fn open_ephemeral_with_maximum_bytes(
        profile_id: &str,
        storage_roots: &[ConfiguredStorageRoot],
        maximum_bytes: u64,
    ) -> Result<Self, StoreError> {
        Self::initialize(
            Connection::open_in_memory()?,
            profile_id,
            storage_roots,
            None,
            Some(maximum_bytes),
            &ClientSettings::default(),
            None,
        )
    }

    fn initialize(
        mut connection: Connection,
        profile_id: &str,
        storage_roots: &[ConfiguredStorageRoot],
        database_path: Option<PathBuf>,
        ephemeral_maximum_bytes: Option<u64>,
        initial_client_settings: &ClientSettings,
        durable_preparation: Option<(&Path, CatalogPreparation)>,
    ) -> Result<Self, StoreError> {
        initial_client_settings.validate().map_err(|error| {
            StoreError::Configuration(format!("initial client settings are invalid: {error}"))
        })?;
        validate_identifier(
            profile_id,
            "profile ID",
            crate::control::MAX_PROFILE_ID_LENGTH,
        )
        .map_err(|(_, message)| StoreError::Configuration(message))?;
        connection.pragma_update(None, "foreign_keys", true)?;
        let foreign_keys: i64 =
            connection.pragma_query_value(None, "foreign_keys", |row| row.get(0))?;
        if foreign_keys != 1 {
            return Err(StoreError::RequiredPragma("foreign_keys"));
        }

        if let Some(maximum_bytes) = ephemeral_maximum_bytes {
            configure_ephemeral_connection(&connection, maximum_bytes)?;
            create_or_validate_catalog(&mut connection, profile_id, initial_client_settings)?;
        } else {
            connection.busy_timeout(BUSY_TIMEOUT)?;
            let (profile_root, preparation) =
                durable_preparation.expect("durable initialization has a profile preparation");
            match preparation {
                CatalogPreparation::Current => {
                    configure_durable_connection(&connection)?;
                    create_or_validate_catalog(
                        &mut connection,
                        profile_id,
                        initial_client_settings,
                    )?;
                }
                CatalogPreparation::Create => {
                    connection.pragma_update(None, "synchronous", "FULL")?;
                    create_or_validate_catalog(
                        &mut connection,
                        profile_id,
                        initial_client_settings,
                    )?;
                    configure_durable_connection(&connection)?;
                }
                CatalogPreparation::Migrate { from } => {
                    configure_durable_connection(&connection)?;
                    write_pre_migration_copy(&connection, profile_root)?;
                    crate::store_migration::migrate_catalog(&mut connection, from)?;
                    validate_catalog(&connection, profile_id)?;
                }
            }
        }
        register_storage_roots(&mut connection, storage_roots)?;
        normalize_archived_intent(&mut connection)?;

        let store = Self {
            connection,
            profile_id: profile_id.to_owned(),
            database_path,
            reset_client_settings: initial_client_settings.clone(),
            pending_reconciliations: Vec::new(),
        };
        if ephemeral_maximum_bytes.is_some() {
            let usage = store.page_usage()?;
            if usage.page_count > usage.maximum_page_count {
                return Err(StoreError::RequiredPragma("max_page_count"));
            }
        }
        Ok(store)
    }

    pub fn database_path(&self) -> Option<&Path> {
        self.database_path.as_deref()
    }

    pub(crate) fn take_pending_reconciliations(&mut self) -> Vec<PendingReconciliation> {
        std::mem::take(&mut self.pending_reconciliations)
    }

    pub(crate) fn page_usage(&self) -> Result<DatabasePageUsage, StoreError> {
        database_page_usage(&self.connection)
    }

    pub fn revision(&self) -> Result<u64, StoreError> {
        read_revision(&self.connection)
    }

    pub(crate) fn find_owner(
        &self,
        identity: FullInfoHash,
    ) -> Result<Option<TorrentId>, StoreError> {
        find_torrent_id_by_full_hash(&self.connection, identity)
    }

    pub(crate) fn load_identities(
        &self,
        torrent_id: &str,
    ) -> Result<(TorrentId, InfoHashes), StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        Ok((torrent_id, read_info_hashes(&self.connection, &torrent_id)?))
    }

    pub fn pending_profile_reset_report(&self) -> Result<Option<ProfileResetReport>, StoreError> {
        let row = self
            .connection
            .query_row(
                "SELECT previous_schema_version, discarded_categories_json,
                        database_basenames_json, external_payload_modified
                 FROM profile_reset_report
                 WHERE singleton = 1 AND startup_published = 0",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, bool>(3)?,
                    ))
                },
            )
            .optional()?;
        row.map(|row| {
            Ok(ProfileResetReport {
                previous_schema_version: row.0,
                discarded_categories: serde_json::from_str(&row.1)?,
                database_basenames_considered: serde_json::from_str(&row.2)?,
                external_payload_modified: row.3,
            })
        })
        .transpose()
    }

    pub fn acknowledge_profile_reset_report(&mut self) -> Result<(), StoreError> {
        self.connection.execute(
            "UPDATE profile_reset_report SET startup_published = 1
             WHERE singleton = 1 AND startup_published = 0",
            [],
        )?;
        Ok(())
    }

    pub fn pending_product_milestones(&self) -> Result<Vec<ProductMilestone>, StoreError> {
        let source_epoch = read_product_source_epoch(&self.connection)?;
        let mut statement = self.connection.prepare(
            "SELECT sequence, kind
             FROM product_milestones
             ORDER BY sequence",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut milestones = Vec::new();
        for row in rows {
            let (sequence, kind) = row?;
            milestones.push(ProductMilestone {
                source_epoch,
                sequence: u64::try_from(sequence).map_err(|_| {
                    StoreError::DurableState("product milestone has an invalid sequence".to_owned())
                })?,
                kind: ProductMilestoneKind::parse(&kind)
                    .map_err(|error| StoreError::DurableState(error.to_string()))?,
            });
        }
        if milestones.len()
            > usize::try_from(MAX_PENDING_PRODUCT_MILESTONES)
                .expect("product milestone bound fits usize")
        {
            return Err(StoreError::DurableState(
                "product milestone outbox exceeds its durable bound".to_owned(),
            ));
        }
        Ok(milestones)
    }

    pub fn acknowledge_product_milestones(
        &mut self,
        source_epoch: [u8; 16],
        through_sequence: u64,
    ) -> Result<usize, StoreError> {
        if source_epoch == [0; 16] {
            return Err(StoreError::DurableState(
                "product milestone acknowledgement has a zero source epoch".to_owned(),
            ));
        }
        let transaction = self.connection.transaction()?;
        let stored_epoch = read_product_source_epoch(&transaction)?;
        if stored_epoch != source_epoch {
            return Err(StoreError::DurableState(
                "product milestone acknowledgement has the wrong source epoch".to_owned(),
            ));
        }
        let next_sequence: i64 = transaction.query_row(
            "SELECT next_sequence FROM product_milestone_state WHERE singleton = 1",
            [],
            |row| row.get(0),
        )?;
        let maximum_issued = u64::try_from(next_sequence - 1).map_err(|_| {
            StoreError::DurableState("product milestone sequence state is invalid".to_owned())
        })?;
        if through_sequence > maximum_issued {
            return Err(StoreError::DurableState(
                "product milestone acknowledgement skips unissued sequence values".to_owned(),
            ));
        }
        let through_sequence = i64::try_from(through_sequence).map_err(|_| {
            StoreError::DurableState("product milestone acknowledgement overflows".to_owned())
        })?;
        let removed = transaction.execute(
            "DELETE FROM product_milestones WHERE sequence <= ?1",
            [through_sequence],
        )?;
        transaction.commit()?;
        Ok(removed)
    }

    pub fn dropped_product_milestone_count(&self) -> Result<u64, StoreError> {
        let value: i64 = self.connection.query_row(
            "SELECT dropped_milestones
             FROM product_milestone_state WHERE singleton = 1",
            [],
            |row| row.get(0),
        )?;
        u64::try_from(value).map_err(|_| {
            StoreError::DurableState("product milestone drop count is invalid".to_owned())
        })
    }

    pub(crate) fn has_pending_file_selection(&self) -> Result<bool, StoreError> {
        Ok(self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM torrents WHERE awaiting_file_selection = 1)",
            [],
            |row| row.get(0),
        )?)
    }

    pub fn snapshot(&self) -> Result<ServiceSnapshot, StoreError> {
        read_snapshot(&self.connection, &self.profile_id)
    }

    pub fn client_settings(&self) -> Result<ClientSettings, StoreError> {
        read_client_settings(&self.connection).map_err(StoreError::from)
    }

    pub(crate) fn load_accounting(
        &self,
        torrent_id: &TorrentId,
    ) -> Result<TorrentAccounting, StoreError> {
        let row = self
            .connection
            .query_row(
                "SELECT total_uploaded, total_downloaded, active_seconds,
                        finished_seconds, seeding_seconds, tracker_complete,
                        tracker_incomplete
                 FROM torrents WHERE torrent_id = ?1",
                [torrent_id.as_bytes()],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, Option<i64>>(5)?,
                        row.get::<_, Option<i64>>(6)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| StoreError::UnknownTorrent(torrent_id.to_string()))?;
        decode_torrent_accounting(row.0, row.1, row.2, row.3, row.4, row.5, row.6)
    }

    pub(crate) fn replace_accounting_batch(
        &mut self,
        updates: &[TorrentAccountingUpdate],
    ) -> Result<(), StoreError> {
        if updates.len() > MAX_ACCOUNTING_BATCH {
            return Err(StoreError::ResourceLimit {
                resource: "accounting batch rows",
                actual: updates.len(),
                maximum: MAX_ACCOUNTING_BATCH,
            });
        }
        let mut unique = std::collections::BTreeSet::new();
        let mut encoded = Vec::with_capacity(updates.len());
        for update in updates {
            if !unique.insert(update.torrent_id) {
                return Err(StoreError::DurableState(format!(
                    "duplicate accounting update for {}",
                    update.torrent_id
                )));
            }
            encoded.push((
                update.torrent_id,
                encode_torrent_accounting(update.accounting)?,
            ));
        }

        let transaction = self.connection.transaction()?;
        for (torrent_id, accounting) in encoded {
            let changed = transaction.execute(
                "UPDATE torrents
                 SET total_uploaded = ?2, total_downloaded = ?3,
                     active_seconds = ?4, finished_seconds = ?5,
                     seeding_seconds = ?6, tracker_complete = ?7,
                     tracker_incomplete = ?8
                 WHERE torrent_id = ?1
                   AND total_uploaded <= ?2
                   AND total_downloaded <= ?3
                   AND active_seconds <= ?4
                   AND finished_seconds <= ?5
                   AND seeding_seconds <= ?6",
                params![
                    torrent_id.as_bytes().as_slice(),
                    accounting.total_uploaded,
                    accounting.total_downloaded,
                    accounting.active_seconds,
                    accounting.finished_seconds,
                    accounting.seeding_seconds,
                    accounting.tracker_complete,
                    accounting.tracker_incomplete,
                ],
            )?;
            if changed != 1 {
                return Err(StoreError::DurableState(format!(
                    "accounting update for {torrent_id} was missing or regressed"
                )));
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn storage_roots(&self) -> Result<Vec<StoredStorageRoot>, StoreError> {
        read_storage_roots(&self.connection)
    }

    pub fn install_path_storage_root(
        &mut self,
        root_id: &str,
        label: &str,
        path: &Path,
    ) -> Result<(u64, String), StoreError> {
        validate_storage_root(root_id, label, path)?;
        let locator = path
            .to_str()
            .ok_or_else(|| {
                StoreError::Configuration("storage root path is not valid UTF-8".to_owned())
            })?
            .to_owned();
        if let Some(existing) = self
            .connection
            .query_row(
                "SELECT root_id FROM storage_roots
                 WHERE kind = 'path' AND locator = ?1",
                [&locator],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            return Ok((self.revision()?, existing));
        }
        let count: i64 =
            self.connection
                .query_row("SELECT COUNT(*) FROM storage_roots", [], |row| row.get(0))?;
        if count >= i64::try_from(MAX_STORAGE_ROOTS).expect("root bound fits i64") {
            return Err(StoreError::Configuration(format!(
                "storage root count exceeds {MAX_STORAGE_ROOTS}"
            )));
        }
        let transaction = self.connection.transaction()?;
        let revision = increment_revision(&transaction)?;
        transaction.execute(
            "INSERT INTO storage_roots(root_id, label, kind, locator)
             VALUES (?1, ?2, 'path', ?3)",
            params![root_id, label, locator],
        )?;
        transaction.execute(
            "UPDATE storage_settings SET default_root = ?1
             WHERE singleton = 1 AND default_root IS NULL",
            [root_id],
        )?;
        transaction.commit()?;
        Ok((revision, root_id.to_owned()))
    }

    pub fn install_platform_storage_root(
        &mut self,
        root_id: &str,
        label: &str,
        make_default: bool,
    ) -> Result<u64, StoreError> {
        validate_identifier(root_id, "storage root", crate::control::MAX_ROOT_ID_LENGTH)
            .map_err(|(_, message)| StoreError::Configuration(message))?;
        validate_root_label(label)?;
        let existing = self
            .connection
            .query_row(
                "SELECT kind, locator, label FROM storage_roots WHERE root_id = ?1",
                [root_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        if let Some((kind, locator, current_label)) = existing {
            if kind != "platform" || locator != "platform-capability:" {
                return Err(StoreError::Configuration(format!(
                    "storage root {root_id} is not a platform capability"
                )));
            }
            let current_default = self.connection.query_row(
                "SELECT default_root FROM storage_settings WHERE singleton = 1",
                [],
                |row| row.get::<_, Option<String>>(0),
            )?;
            if current_label == label
                && current_default.is_some()
                && (!make_default || current_default.as_deref() == Some(root_id))
            {
                return self.revision();
            }
        } else {
            let count: i64 =
                self.connection
                    .query_row("SELECT COUNT(*) FROM storage_roots", [], |row| row.get(0))?;
            if count >= i64::try_from(MAX_STORAGE_ROOTS).expect("root bound fits i64") {
                return Err(StoreError::Configuration(format!(
                    "storage root count exceeds {MAX_STORAGE_ROOTS}"
                )));
            }
        }

        let transaction = self.connection.transaction()?;
        let revision = increment_revision(&transaction)?;
        transaction.execute(
            "INSERT INTO storage_roots(root_id, label, kind, locator)
             VALUES (?1, ?2, 'platform', 'platform-capability:')
             ON CONFLICT(root_id) DO UPDATE SET label = excluded.label",
            params![root_id, label],
        )?;
        if make_default {
            transaction.execute(
                "UPDATE storage_settings SET default_root = ?1 WHERE singleton = 1",
                [root_id],
            )?;
        } else {
            transaction.execute(
                "UPDATE storage_settings SET default_root = ?1
                 WHERE singleton = 1 AND default_root IS NULL",
                [root_id],
            )?;
        }
        transaction.commit()?;
        Ok(revision)
    }

    pub fn repair_platform_storage_root(
        &mut self,
        root_id: &str,
        label: &str,
    ) -> Result<u64, StoreError> {
        validate_identifier(root_id, "storage root", crate::control::MAX_ROOT_ID_LENGTH)
            .map_err(|(_, message)| StoreError::Configuration(message))?;
        validate_root_label(label)?;
        let current = self
            .connection
            .query_row(
                "SELECT kind, locator, label FROM storage_roots WHERE root_id = ?1",
                [root_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((kind, locator, current_label)) = current else {
            return Err(StoreError::Configuration(format!(
                "storage root {root_id} is not configured"
            )));
        };
        if kind != "platform" || locator != "platform-capability:" {
            return Err(StoreError::Configuration(format!(
                "storage root {root_id} is not a platform capability"
            )));
        }
        if current_label == label {
            return self.revision();
        }
        let transaction = self.connection.transaction()?;
        let revision = increment_revision(&transaction)?;
        transaction.execute(
            "UPDATE storage_roots SET label = ?2 WHERE root_id = ?1",
            params![root_id, label],
        )?;
        transaction.commit()?;
        Ok(revision)
    }

    /// Stops using a platform root. When it is the default, `replacement`
    /// becomes the default, or none. The catalog row is deleted only when no
    /// torrent references it; otherwise it stays so those torrents can be
    /// repaired. Returns whether the row was deleted.
    pub fn detach_platform_storage_root(
        &mut self,
        root_id: &str,
        replacement: Option<&str>,
    ) -> Result<bool, StoreError> {
        let kind = self
            .connection
            .query_row(
                "SELECT kind FROM storage_roots WHERE root_id = ?1",
                [root_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| {
                StoreError::Configuration(format!("storage root {root_id} is not configured"))
            })?;
        if kind != "platform" {
            return Err(StoreError::Configuration(format!(
                "storage root {root_id} is not a platform capability"
            )));
        }
        if replacement == Some(root_id) {
            return Err(StoreError::Configuration(
                "a detached storage root cannot replace itself".to_owned(),
            ));
        }
        let transaction = self.connection.transaction()?;
        increment_revision(&transaction)?;
        transaction.execute(
            "UPDATE storage_settings SET default_root = ?2
             WHERE singleton = 1 AND default_root = ?1",
            params![root_id, replacement],
        )?;
        let references: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM torrents WHERE storage_root = ?1",
            [root_id],
            |row| row.get(0),
        )?;
        let removed = references == 0;
        if removed {
            transaction.execute("DELETE FROM storage_roots WHERE root_id = ?1", [root_id])?;
        }
        transaction.commit()?;
        Ok(removed)
    }

    pub fn repair_path_storage_root(
        &mut self,
        root_id: &str,
        label: &str,
        path: &Path,
    ) -> Result<u64, StoreError> {
        validate_storage_root(root_id, label, path)?;
        let locator = path
            .to_str()
            .ok_or_else(|| {
                StoreError::Configuration("storage root path is not valid UTF-8".to_owned())
            })?
            .to_owned();
        let duplicate = self
            .connection
            .query_row(
                "SELECT root_id FROM storage_roots
                 WHERE kind = 'path' AND locator = ?1 AND root_id <> ?2",
                params![locator, root_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(duplicate) = duplicate {
            return Err(StoreError::Configuration(format!(
                "selected folder is already registered as {duplicate}"
            )));
        }
        let transaction = self.connection.transaction()?;
        let revision = increment_revision(&transaction)?;
        let updated = transaction.execute(
            "UPDATE storage_roots
             SET label = ?2, kind = 'path', locator = ?3
             WHERE root_id = ?1",
            params![root_id, label, locator],
        )?;
        if updated != 1 {
            return Err(StoreError::Configuration(format!(
                "storage root {root_id} is not configured"
            )));
        }
        transaction.commit()?;
        Ok(revision)
    }

    pub fn load_dht_snapshot(&self) -> Result<Option<DhtSnapshot>, StoreError> {
        let state = self
            .connection
            .query_row(
                "SELECT format_version FROM dht_state WHERE singleton = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let Some(version) = state else {
            return Ok(None);
        };
        let version = u32::try_from(version)
            .map_err(|_| StoreError::DurableState("invalid DHT format version".to_owned()))?;
        let mut statement = self.connection.prepare(
            "SELECT family, node_id, address, port
             FROM dht_nodes ORDER BY family, sample_order",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, Vec<u8>>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?;
        let mut nodes_v4 = Vec::new();
        let mut nodes_v6 = Vec::new();
        for row in rows {
            let (family, remote_id, address, port) = row?;
            let id = NodeId(remote_id.try_into().map_err(|_| {
                StoreError::DurableState("invalid saved DHT contact ID".to_owned())
            })?);
            let port = u16::try_from(port)
                .ok()
                .filter(|port| *port != 0)
                .ok_or_else(|| StoreError::DurableState("invalid saved DHT port".to_owned()))?;
            let ip = match family {
                4 => DhtIp::V4(<[u8; 4]>::try_from(address).map_err(|_| {
                    StoreError::DurableState("invalid saved DHT IPv4 address".to_owned())
                })?),
                6 => DhtIp::V6(<[u8; 16]>::try_from(address).map_err(|_| {
                    StoreError::DurableState("invalid saved DHT IPv6 address".to_owned())
                })?),
                _ => {
                    return Err(StoreError::DurableState(
                        "invalid saved DHT address family".to_owned(),
                    ));
                }
            };
            let contact = NodeContact {
                id,
                address: DhtEndpoint::new(ip, port),
            };
            if family == 4 {
                nodes_v4.push(contact);
            } else {
                nodes_v6.push(contact);
            }
        }
        let mut identity_statement = self.connection.prepare(
            "SELECT family, address, node_id
             FROM dht_identities ORDER BY family, identity_order",
        )?;
        let identity_rows = identity_statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, Vec<u8>>(2)?,
            ))
        })?;
        let mut identities_v4 = Vec::new();
        let mut identities_v6 = Vec::new();
        for row in identity_rows {
            let (family, address, identity_node_id) = row?;
            let node_id = NodeId(identity_node_id.try_into().map_err(|_| {
                StoreError::DurableState("invalid persisted DHT identity node ID".to_owned())
            })?);
            let identity = match family {
                4 => DhtIdentity {
                    address: IpAddr::V4(Ipv4Addr::from(<[u8; 4]>::try_from(address).map_err(
                        |_| {
                            StoreError::DurableState(
                                "invalid persisted DHT identity IPv4 address".to_owned(),
                            )
                        },
                    )?)),
                    node_id,
                },
                6 => DhtIdentity {
                    address: IpAddr::V6(Ipv6Addr::from(<[u8; 16]>::try_from(address).map_err(
                        |_| {
                            StoreError::DurableState(
                                "invalid persisted DHT identity IPv6 address".to_owned(),
                            )
                        },
                    )?)),
                    node_id,
                },
                _ => {
                    return Err(StoreError::DurableState(
                        "invalid persisted DHT identity family".to_owned(),
                    ));
                }
            };
            if family == 4 {
                identities_v4.push(identity);
            } else {
                identities_v6.push(identity);
            }
        }
        DhtSnapshot {
            version,
            identities_v4,
            identities_v6,
            nodes_v4,
            nodes_v6,
        }
        .validate()
        .map(Some)
        .map_err(|error| StoreError::DurableState(error.to_string()))
    }

    pub fn save_dht_snapshot(&mut self, snapshot: DhtSnapshot) -> Result<(), StoreError> {
        let snapshot = snapshot
            .validate()
            .map_err(|error| StoreError::DurableState(error.to_string()))?;
        let transaction = self.connection.transaction()?;
        transaction.execute("DELETE FROM dht_identities", [])?;
        transaction.execute("DELETE FROM dht_nodes", [])?;
        transaction.execute("DELETE FROM dht_state", [])?;
        transaction.execute(
            "INSERT INTO dht_state(singleton, format_version) VALUES (1, ?1)",
            [i64::from(snapshot.version)],
        )?;
        for (family, identities) in [
            (4_i64, snapshot.identities_v4.clone()),
            (6_i64, snapshot.identities_v6.clone()),
        ] {
            for (order, identity) in identities.into_iter().enumerate() {
                let address = match identity.address {
                    IpAddr::V4(address) => address.octets().to_vec(),
                    IpAddr::V6(address) => address.octets().to_vec(),
                };
                transaction.execute(
                    "INSERT INTO dht_identities(
                        family, identity_order, address, node_id
                     ) VALUES (?1, ?2, ?3, ?4)",
                    params![
                        family,
                        i64::try_from(order).expect("DHT identity order is bounded"),
                        address,
                        identity.node_id.0.as_slice(),
                    ],
                )?;
            }
        }
        for (family, nodes) in [(4_i64, snapshot.nodes_v4), (6_i64, snapshot.nodes_v6)] {
            for (order, node) in nodes.into_iter().enumerate() {
                let address = match node.address.ip {
                    DhtIp::V4(address) => address.to_vec(),
                    DhtIp::V6(address) => address.to_vec(),
                };
                transaction.execute(
                    "INSERT INTO dht_nodes(
                        family, sample_order, node_id, address, port
                     ) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        family,
                        i64::try_from(order).expect("DHT sample order is bounded"),
                        node.id.0.as_slice(),
                        address,
                        i64::from(node.address.port),
                    ],
                )?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn handle_durable(
        &mut self,
        request: &RequestEnvelope,
    ) -> Result<ResponseEnvelope, StoreError> {
        self.handle_durable_with_share_endpoints(request, None)
    }

    /// [`handle_durable`](Self::handle_durable) with the runtime's
    /// reachability facts for a magnet export's peer hint. `None` means the
    /// caller has no network runtime.
    pub(crate) fn handle_durable_with_share_endpoints(
        &mut self,
        request: &RequestEnvelope,
        share_endpoints: Option<&ShareEndpointFacts>,
    ) -> Result<ResponseEnvelope, StoreError> {
        if let Err((code, message)) = validate_request(request) {
            return Ok(ResponseEnvelope::error(
                request.request_id.clone(),
                self.revision()?,
                code,
                message,
            ));
        }
        if !request.command.is_mutation() {
            let mut response = ResponseEnvelope::success(
                request.request_id.clone(),
                self.revision()?,
                self.snapshot()?,
            );
            if let Command::ExportMagnet {
                torrent_id,
                options,
            } = &request.command
            {
                response = match self.export_magnet(torrent_id, options.as_ref(), share_endpoints) {
                    Ok(Ok(result)) => response.with_result(CommandResult::ExportMagnet { result }),
                    Ok(Err((code, message))) => ResponseEnvelope::error(
                        request.request_id.clone(),
                        self.revision()?,
                        code,
                        message,
                    ),
                    Err(StoreError::UnknownTorrent(_)) => ResponseEnvelope::error(
                        request.request_id.clone(),
                        self.revision()?,
                        ErrorCode::UnknownTorrent,
                        format!("torrent {torrent_id} is not in the profile"),
                    ),
                    Err(error) => return Err(error),
                };
            }
            return Ok(response);
        }

        let request_json = serde_json::to_string(request)?;
        let transaction = self.connection.transaction()?;
        if let Some((stored_request, stored_response)) = transaction
            .query_row(
                "SELECT request_json, response_json
                 FROM request_receipts
                 WHERE request_id = ?1",
                [&request.request_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
        {
            if stored_request == request_json {
                let response = serde_json::from_str(&stored_response)?;
                transaction.commit()?;
                return Ok(response);
            }
            let revision = read_revision(&transaction)?;
            transaction.commit()?;
            return Ok(ResponseEnvelope::error(
                request.request_id.clone(),
                revision,
                ErrorCode::RequestConflict,
                "request ID was already used for a different envelope",
            ));
        }

        let current_revision = read_revision(&transaction)?;
        let expected_revision = request
            .expected_revision
            .as_deref()
            .map(parse_revision)
            .transpose()
            .map_err(|(_, message)| StoreError::DurableState(message))?;
        let response = if expected_revision.is_some_and(|expected| expected != current_revision) {
            ResponseEnvelope::error(
                request.request_id.clone(),
                current_revision,
                ErrorCode::StaleRevision,
                format!(
                    "expected revision {}, current revision is {current_revision}",
                    request
                        .expected_revision
                        .as_deref()
                        .expect("checked expected revision is present")
                ),
            )
        } else {
            // A typed command rejection must not commit earlier writes made
            // by that command. Keep its error receipt outside the savepoint.
            transaction.execute_batch("SAVEPOINT command_mutation")?;
            let response = apply_mutation(
                &transaction,
                request,
                current_revision,
                &self.profile_id,
                &self.reset_client_settings,
            )?;
            if matches!(response.outcome, crate::ResponseOutcome::Error { .. }) {
                transaction.execute_batch("ROLLBACK TO command_mutation")?;
            }
            transaction.execute_batch("RELEASE command_mutation")?;
            response
        };

        let response_json = serde_json::to_string(&response)?;
        let response_revision = sql_revision(
            response
                .revision
                .parse()
                .map_err(|_| StoreError::DurableState("invalid response revision".to_owned()))?,
        )?;
        transaction.execute(
            "INSERT INTO request_receipts(
                request_id, request_json, response_json, revision
             ) VALUES (?1, ?2, ?3, ?4)",
            params![
                request.request_id,
                request_json,
                response_json,
                response_revision
            ],
        )?;
        transaction.execute(
            "DELETE FROM request_receipts
             WHERE receipt_order <= (
                SELECT COALESCE(MAX(receipt_order), 0) - ?1
                FROM request_receipts
             )",
            [MAX_RECEIPTS],
        )?;
        transaction.commit()?;
        Ok(response)
    }

    pub fn handle_torrent_bytes(
        &mut self,
        request: &AddTorrentBytesRequest,
        source: Vec<u8>,
    ) -> Result<ResponseEnvelope, StoreError> {
        match prepare_torrent_bytes(request, source) {
            Ok(prepared) => self.handle_prepared_torrent_bytes(request, &prepared),
            Err((code, message)) => Ok(ResponseEnvelope::error(
                request.request_id.clone(),
                self.revision()?,
                code,
                message,
            )),
        }
    }

    pub(crate) fn handle_prepared_torrent_bytes(
        &mut self,
        request: &AddTorrentBytesRequest,
        prepared: &PreparedTorrentBytes,
    ) -> Result<ResponseEnvelope, StoreError> {
        let request_json = torrent_bytes_receipt_json(request, &prepared.source_digest)?;
        if let Some(response) =
            replay_or_conflict(&self.connection, &request.request_id, &request_json)?
        {
            return Ok(response);
        }
        let transaction = self.connection.transaction()?;
        let current_revision = read_revision(&transaction)?;
        let expected_revision = request
            .expected_revision
            .as_deref()
            .map(parse_revision)
            .transpose()
            .map_err(|(_, message)| StoreError::DurableState(message))?;
        let response = if expected_revision.is_some_and(|expected| expected != current_revision) {
            ResponseEnvelope::error(
                request.request_id.clone(),
                current_revision,
                ErrorCode::StaleRevision,
                format!(
                    "expected revision {}, current revision is {current_revision}",
                    request
                        .expected_revision
                        .as_deref()
                        .expect("checked expected revision is present")
                ),
            )
        } else {
            match add_torrent_bytes(&transaction, request, prepared, current_revision) {
                Ok((revision, result)) => ResponseEnvelope::success(
                    request.request_id.clone(),
                    revision,
                    read_snapshot(&transaction, &self.profile_id)?,
                )
                .with_result(CommandResult::AddTorrent { result }),
                Err(AddTorrentBytesError::Response(code, message)) => ResponseEnvelope::error(
                    request.request_id.clone(),
                    current_revision,
                    code,
                    message,
                ),
                Err(AddTorrentBytesError::Store(error)) => return Err(error),
            }
        };
        insert_receipt(&transaction, &request.request_id, &request_json, &response)?;
        transaction.commit()?;
        Ok(response)
    }

    pub fn load_resume(&self, torrent_id: &str) -> Result<ResumeRecord, StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        let row = self
            .connection
            .query_row(
                "SELECT magnet, storage_root, raw_info,
                        piece_count, content_fingerprint, have_state,
                        desired_state, verification_requested,
                        verification_completed, quarantine_reason,
                        download_queue_position, total_uploaded,
                        total_downloaded, active_seconds, finished_seconds,
                        seeding_seconds, tracker_complete, tracker_incomplete
                 FROM torrents
                WHERE torrent_id = ?1",
                [torrent_id.as_bytes()],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<Vec<u8>>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, Option<Vec<u8>>>(4)?,
                        row.get::<_, Option<Vec<u8>>>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, i64>(8)?,
                        row.get::<_, Option<String>>(9)?,
                        row.get::<_, Option<i64>>(10)?,
                        row.get::<_, i64>(11)?,
                        row.get::<_, i64>(12)?,
                        row.get::<_, i64>(13)?,
                        row.get::<_, i64>(14)?,
                        row.get::<_, i64>(15)?,
                        row.get::<_, Option<i64>>(16)?,
                        row.get::<_, Option<i64>>(17)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| StoreError::UnknownTorrent(torrent_id.to_string()))?;
        let verification_requested = u64::try_from(row.7).map_err(|_| {
            StoreError::DurableState("invalid requested verification generation".to_owned())
        })?;
        let verification_completed = u64::try_from(row.8).map_err(|_| {
            StoreError::DurableState("invalid completed verification generation".to_owned())
        })?;
        let verification = VerificationState::new(verification_requested, verification_completed)
            .ok_or_else(|| {
            StoreError::DurableState(
                "completed verification exceeds requested generation".to_owned(),
            )
        })?;
        let skip_files = read_selection(&self.connection, &torrent_id)?;
        let high_priority_files = read_high_priority_files(&self.connection, &torrent_id)?;
        if high_priority_files
            .iter()
            .any(|index| skip_files.binary_search(index).is_ok())
        {
            return Err(StoreError::DurableState(
                "skipped file retains a high priority".to_owned(),
            ));
        }
        let trackers = read_trackers(&self.connection, &torrent_id)?;
        let have = match (row.3, row.4, row.5) {
            (None, None, None) => None,
            (Some(piece_count), Some(fingerprint), Some(bytes)) => {
                let piece_count = bounded_piece_count(piece_count)?;
                let fingerprint: [u8; 32] = fingerprint.try_into().map_err(|_| {
                    StoreError::DurableState("invalid content fingerprint length".to_owned())
                })?;
                Some(HaveState::decode(
                    &bytes,
                    torrent_id,
                    ContentFingerprint::from_digest(fingerprint),
                    piece_count,
                )?)
            }
            _ => {
                return Err(StoreError::DurableState(
                    "piece count and have state must appear together".to_owned(),
                ));
            }
        };
        let info_hashes = read_info_hashes(&self.connection, &torrent_id)?;
        let metainfo_source = read_verbatim_metainfo_source(&self.connection, &torrent_id)?;
        let mut operational_magnet = match (row.0, info_hashes.v1_hash(), info_hashes.v2_hash()) {
            (Some(magnet), _, _) => magnet,
            (None, Some(v1), None) => format!("magnet:?xt=urn:btih:{v1}"),
            (None, None, Some(v2)) => format!("magnet:?xt=urn:btmh:1220{v2}"),
            (None, _, _) => String::new(),
        };
        // Operational magnets written before a presentation claim (`dn`,
        // later `xl`) was retained recover it from the verified source.
        if let Ok(mut parsed) = Magnet::parse(&operational_magnet)
            && (parsed.display_name.is_none() || parsed.exact_length.is_none())
            && let Some(source) =
                read_verified_retained_magnet(&self.connection, &torrent_id, info_hashes)?
            && (parsed.display_name.is_none() && source.parsed.display_name.is_some()
                || parsed.exact_length.is_none() && source.parsed.exact_length.is_some())
        {
            parsed.display_name = parsed.display_name.or(source.parsed.display_name);
            parsed.exact_length = parsed.exact_length.or(source.parsed.exact_length);
            operational_magnet = canonical_magnet(&parsed);
        }
        let desired_running = match row.6.as_str() {
            "running" => true,
            "paused" => false,
            _ => {
                return Err(StoreError::DurableState(
                    "invalid desired torrent state".to_owned(),
                ));
            }
        };
        let (has_wanted_pieces, all_wanted_verified, evidence_error) = match (&row.2, &have) {
            (Some(raw_info), Some(have)) => {
                match wanted_piece_evidence(raw_info, metainfo_source.as_deref(), &skip_files, have)
                {
                    Ok((has_wanted, all_verified)) => (has_wanted, all_verified, None),
                    Err(error) => (true, false, Some(bounded_error(&error.to_string()))),
                }
            }
            _ => (true, false, None),
        };
        let quarantine_reason = row.9.or(evidence_error);
        let state = derive_torrent_state(DerivedStateInput {
            metadata_available: row.2.is_some(),
            root_available: true,
            desired_running,
            has_wanted_pieces,
            verification,
            all_wanted_verified,
            quarantined: quarantine_reason.is_some(),
        });
        let storage_state = if quarantine_reason.is_some() {
            StorageState::NeedsRepair
        } else {
            StorageState::Available
        };
        let accounting =
            decode_torrent_accounting(row.11, row.12, row.13, row.14, row.15, row.16, row.17)?;
        Ok(ResumeRecord {
            torrent_id,
            info_hashes,
            magnet: operational_magnet,
            storage_root: row.1,
            skip_files,
            high_priority_files,
            trackers,
            state,
            storage_state,
            desired_running,
            download_queue_position: row.10,
            accounting,
            raw_info: row.2,
            metainfo_source,
            have,
            verification,
            quarantine_reason,
        })
    }

    fn export_magnet(
        &self,
        torrent_id: &str,
        options: Option<&MagnetExportOptions>,
        share_endpoints: Option<&ShareEndpointFacts>,
    ) -> Result<Result<MagnetExportResult, (ErrorCode, String)>, StoreError> {
        let (base, raw_info) = self.export_base_magnet(torrent_id)?;
        let Some(options) = options else {
            return Ok(Ok(base));
        };
        let content = raw_info.as_deref().map(share_content_facts).transpose()?;
        Ok(apply_share_options(
            base,
            content.as_ref(),
            options,
            share_endpoints,
        ))
    }

    fn export_base_magnet(
        &self,
        torrent_id: &str,
    ) -> Result<(MagnetExportResult, Option<Vec<u8>>), StoreError> {
        export_base_magnet_from(&self.connection, torrent_id)
    }

    pub fn load_removal(&self, torrent_id: &str) -> Result<RemovalRecord, StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        self.connection
            .query_row(
                "SELECT r.operation_id, t.storage_root, r.data_policy, r.state,
                        t.raw_info, r.error
                 FROM removal_jobs r
                 JOIN torrents t ON t.torrent_id = r.torrent_id
                 WHERE r.torrent_id = ?1",
                [torrent_id.as_bytes()],
                |row| {
                    Ok(RemovalRow {
                        operation_id: row.get(0)?,
                        storage_root: row.get(1)?,
                        data_policy: row.get(2)?,
                        state: row.get(3)?,
                        raw_info: row.get(4)?,
                        error: row.get(5)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| StoreError::UnknownTorrent(torrent_id.to_string()))
            .and_then(|row| removal_record(&torrent_id.to_string(), row))
    }

    pub fn load_removals(&self) -> Result<Vec<RemovalRecord>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT t.torrent_id, r.operation_id, t.storage_root, r.data_policy,
                    r.state, t.raw_info, r.error
             FROM removal_jobs r
             JOIN torrents t ON t.torrent_id = r.torrent_id
             ORDER BY t.torrent_id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, Vec<u8>>(0)?,
                RemovalRow {
                    operation_id: row.get(1)?,
                    storage_root: row.get(2)?,
                    data_policy: row.get(3)?,
                    state: row.get(4)?,
                    raw_info: row.get(5)?,
                    error: row.get(6)?,
                },
            ))
        })?;
        let mut removals = Vec::new();
        for row in rows {
            let row = row?;
            let torrent_id = decode_stored_torrent_id(row.0)?;
            removals.push(removal_record(&torrent_id.to_string(), row.1)?);
        }
        Ok(removals)
    }

    pub fn set_removal_state(
        &mut self,
        torrent_id: &str,
        operation_id: &str,
        state: RemovalState,
        error: Option<&str>,
    ) -> Result<u64, StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        let transaction = self.connection.transaction()?;
        let current = transaction
            .query_row(
                "SELECT state FROM removal_jobs
                 WHERE torrent_id = ?1 AND operation_id = ?2",
                params![torrent_id.as_bytes(), operation_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| {
                StoreError::DurableState("removal operation is stale or unavailable".to_owned())
            })?;
        let current = RemovalState::parse(&current)
            .ok_or_else(|| StoreError::DurableState("invalid removal state".to_owned()))?;
        let transition_allowed = matches!(
            (current, state),
            (
                RemovalState::Pending,
                RemovalState::AwaitingPlatform | RemovalState::Failed
            ) | (RemovalState::AwaitingPlatform, RemovalState::Failed)
        );
        if !transition_allowed {
            return Err(StoreError::DurableState(format!(
                "invalid removal transition from {} to {}",
                current.as_str(),
                state.as_str()
            )));
        }
        let revision = increment_revision(&transaction)?;
        let updated = transaction.execute(
            "UPDATE removal_jobs
             SET state = ?3, error = ?4, updated_revision = ?5
             WHERE torrent_id = ?1 AND operation_id = ?2",
            params![
                torrent_id.as_bytes(),
                operation_id,
                state.as_str(),
                error.map(bounded_error),
                sql_revision(revision)?,
            ],
        )?;
        if updated != 1 {
            return Err(StoreError::DurableState(
                "removal operation is stale or unavailable".to_owned(),
            ));
        }
        transaction.execute(
            "UPDATE torrents SET updated_revision = ?2 WHERE torrent_id = ?1",
            params![torrent_id.as_bytes(), sql_revision(revision)?],
        )?;
        transaction.commit()?;
        Ok(revision)
    }

    pub fn finalize_removal(
        &mut self,
        torrent_id: &str,
        operation_id: &str,
    ) -> Result<u64, StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        let transaction = self.connection.transaction()?;
        let state = transaction
            .query_row(
                "SELECT state FROM removal_jobs
                 WHERE torrent_id = ?1 AND operation_id = ?2",
                params![torrent_id.as_bytes(), operation_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| {
                StoreError::DurableState("removal operation is stale or unavailable".to_owned())
            })?;
        let state = RemovalState::parse(&state)
            .ok_or_else(|| StoreError::DurableState("invalid removal state".to_owned()))?;
        if state == RemovalState::Failed {
            return Err(StoreError::DurableState(
                "failed removal must be explicitly retried".to_owned(),
            ));
        }
        let revision = increment_revision(&transaction)?;
        let removed = transaction.execute(
            "DELETE FROM torrents WHERE torrent_id = ?1",
            [torrent_id.as_bytes()],
        )?;
        if removed != 1 {
            return Err(StoreError::UnknownTorrent(torrent_id.to_string()));
        }
        transaction.commit()?;
        Ok(revision)
    }

    /// One-time desktop migration, before runtime construction. Retain data,
    /// running intent and port preference; legacy defaults are not consent.
    /// Applies the quiet network defaults (incoming listener and port mapping
    /// off) once per profile and records that in the same transaction. When
    /// `already_applied` says an older build applied them, only the marker is
    /// set. Returns whether the defaults were applied now.
    pub(crate) fn apply_quiet_network_defaults_once(
        &mut self,
        already_applied: bool,
    ) -> Result<bool, StoreError> {
        let transaction = self.connection.transaction()?;
        let marker: i64 = transaction.query_row(
            "SELECT network_defaults_version FROM client_settings WHERE singleton = 1",
            [],
            |row| row.get(0),
        )?;
        if marker >= QUIET_NETWORK_DEFAULTS_VERSION {
            return Ok(false);
        }
        transaction.execute(
            "UPDATE client_settings SET network_defaults_version = ?1 WHERE singleton = 1",
            [QUIET_NETWORK_DEFAULTS_VERSION],
        )?;
        if already_applied {
            transaction.commit()?;
            return Ok(false);
        }
        let mut settings = read_client_settings(&transaction)?;
        if let crate::ListenerPolicy::FixedLoopback { port }
        | crate::ListenerPolicy::FixedLocalNetwork { port } = settings.listener
        {
            settings.preferred_listen_port = port;
        }
        settings.listener = crate::ListenerPolicy::Disabled;
        settings.port_mapping = crate::PortMappingPolicy::Disabled;
        if replace_client_settings(&transaction, &settings)? {
            let revision = read_revision(&transaction)?;
            next_revision_strict(&transaction, revision)?;
        }
        transaction.commit()?;
        Ok(true)
    }

    pub fn record_metadata(
        &mut self,
        torrent_id: &str,
        raw_info: &[u8],
    ) -> Result<u64, StoreError> {
        validate_raw_info_length(raw_info)?;
        let current_owner = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        let parsed = ParsedInfo::from_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
            .map_err(map_durable_metainfo_error)?;
        let known_hashes = read_info_hashes(&self.connection, &current_owner)?;
        let parsed_hashes = parsed.info_hashes();
        let mut known_matches = true;
        known_hashes.for_each(|identity| known_matches &= parsed_hashes.contains(identity));
        if !known_matches {
            return Err(StoreError::DurableState(
                "verified metadata does not match torrent identity".to_owned(),
            ));
        }
        let (name, piece_count, file_count, is_padding) = match parsed.kind() {
            ParsedInfoKind::V1(metainfo) => (
                metainfo.name.as_str(),
                metainfo.piece_count(),
                metainfo.files.len(),
                Some(
                    metainfo
                        .files
                        .iter()
                        .map(|file| file.padding)
                        .collect::<Vec<_>>(),
                ),
            ),
            ParsedInfoKind::V2(metainfo) => (
                metainfo.name.as_str(),
                metainfo.layout.piece_count(),
                metainfo.files.len(),
                None,
            ),
            ParsedInfoKind::Hybrid(metainfo) => (
                metainfo.v2.name.as_str(),
                metainfo.v2.layout.piece_count(),
                metainfo.v2.files.len(),
                None,
            ),
        };
        validate_content_name(name).map_err(|error| StoreError::DurableState(error.to_string()))?;
        let authenticated_owners = authenticated_owners(&self.connection, parsed_hashes)?;
        if !authenticated_owners
            .iter()
            .any(|candidate| candidate.torrent_id == current_owner)
        {
            return Err(StoreError::UnknownTorrent(torrent_id.to_owned()));
        }
        if authenticated_owners.len() > 1
            && authenticated_owners
                .iter()
                .any(|candidate| !candidate.provisional)
        {
            return Err(StoreError::DurableState(
                "authenticated hybrid aliases collide after content authority began".to_owned(),
            ));
        }
        let owner = authenticated_owners
            .first()
            .map(|candidate| candidate.torrent_id)
            .ok_or_else(|| StoreError::UnknownTorrent(torrent_id.to_owned()))?;
        let losers = authenticated_owners
            .iter()
            .filter(|candidate| candidate.torrent_id != owner)
            .map(|candidate| candidate.torrent_id)
            .collect::<Vec<_>>();
        let reconciled_magnet = (authenticated_owners.len() > 1)
            .then(|| combined_reconciliation_magnet(&authenticated_owners, parsed_hashes))
            .transpose()?
            .flatten();
        let fingerprint = ContentFingerprint::for_info_bytes(raw_info);
        let have = HaveState::empty(owner, fingerprint, piece_count)?.encode();
        validate_have_state_length(&have)?;
        let transaction = self.connection.transaction()?;
        for loser in &losers {
            let removed = transaction.execute(
                "DELETE FROM torrents WHERE torrent_id = ?1",
                [loser.as_bytes().as_slice()],
            )?;
            if removed != 1 {
                return Err(StoreError::UnknownTorrent(loser.to_string()));
            }
        }
        if let Some(magnet) = reconciled_magnet.as_ref() {
            transaction.execute(
                "UPDATE torrents SET magnet = ?2 WHERE torrent_id = ?1",
                params![owner.as_bytes().as_slice(), canonical_magnet(magnet)],
            )?;
            replace_reconciled_discovery(&transaction, &owner, magnet)?;
        }
        let mut alias_error = None;
        parsed_hashes.for_each(|identity| {
            if alias_error.is_some() {
                return;
            }
            alias_error = transaction
                .execute(
                    "INSERT OR IGNORE INTO torrent_identities(torrent_id, protocol, full_hash)
                     VALUES (?1, ?2, ?3)",
                    params![
                        owner.as_bytes().as_slice(),
                        identity.protocol().as_str(),
                        identity.as_bytes()
                    ],
                )
                .err();
        });
        if alias_error.is_some() {
            return Err(StoreError::DurableState(
                "authenticated metadata identity collides with another torrent owner".to_owned(),
            ));
        }
        if read_info_hashes(&transaction, &owner)? != parsed_hashes {
            return Err(StoreError::DurableState(
                "authenticated aliases were not reserved for the surviving owner".to_owned(),
            ));
        }
        let selection_default: String = transaction
            .query_row(
                "SELECT selection_default FROM torrents WHERE torrent_id = ?1",
                [owner.as_bytes().as_slice()],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| StoreError::UnknownTorrent(torrent_id.to_string()))?;
        if selection_default == "skipped" {
            let ranges = read_pending_ranges(&transaction, &owner)
                .map_err(|(_, message)| StoreError::DurableState(message))?;
            let mut selected = Vec::new();
            for range in ranges {
                let end = usize::try_from(range.end)
                    .unwrap_or(usize::MAX)
                    .min(file_count.saturating_sub(1));
                let start = usize::try_from(range.start).unwrap_or(usize::MAX);
                if start > end {
                    continue;
                }
                for index in start..=end {
                    if is_padding.as_ref().is_some_and(|padding| padding[index]) {
                        continue;
                    }
                    selected.push(index);
                    if selected.len() > MAX_FILE_SELECTION_ENTRIES {
                        return Err(StoreError::ResourceLimit {
                            resource: "file selection exceptions",
                            actual: selected.len(),
                            maximum: MAX_FILE_SELECTION_ENTRIES,
                        });
                    }
                }
            }
            for index in selected {
                transaction.execute(
                    "INSERT INTO file_selection(torrent_id, file_index, wanted)
                     VALUES (?1, ?2, 1)",
                    params![
                        owner.as_bytes().as_slice(),
                        i64::try_from(index).map_err(|_| StoreError::DurableState(
                            "file index overflow".to_owned()
                        ))?
                    ],
                )?;
            }
            transaction.execute(
                "DELETE FROM pending_selection_ranges WHERE torrent_id = ?1",
                [owner.as_bytes().as_slice()],
            )?;
        } else if selection_default != "wanted" {
            return Err(StoreError::DurableState(
                "invalid selection default".to_owned(),
            ));
        }
        let revision = increment_revision(&transaction)?;
        let revision_sql = sql_revision(revision)?;
        let updated = transaction.execute(
            "UPDATE torrents
             SET raw_info = ?2,
                 content_fingerprint = ?3,
                 piece_count = ?4,
                 have_state = ?5,
                 error = NULL,
                 updated_revision = ?6
             WHERE torrent_id = ?1",
            params![
                owner.as_bytes().as_slice(),
                raw_info,
                fingerprint.as_bytes().as_slice(),
                i64::try_from(piece_count)
                    .map_err(|_| StoreError::DurableState("piece count overflow".to_owned()))?,
                have,
                revision_sql,
            ],
        )?;
        if updated != 1 {
            return Err(StoreError::UnknownTorrent(torrent_id.to_string()));
        }
        transaction.commit()?;
        for loser in losers {
            self.pending_reconciliations.push(PendingReconciliation {
                winner: owner.to_string(),
                loser: loser.to_string(),
            });
        }
        if current_owner != owner {
            return Err(StoreError::Reconciled {
                winner: owner.to_string(),
                loser: current_owner.to_string(),
            });
        }
        Ok(revision)
    }

    pub fn record_piece(
        &mut self,
        torrent_id: &str,
        piece_index: usize,
    ) -> Result<u64, StoreError> {
        self.record_pieces(torrent_id, &[piece_index])
    }

    pub fn record_pieces(
        &mut self,
        torrent_id: &str,
        piece_indices: &[usize],
    ) -> Result<u64, StoreError> {
        if piece_indices.is_empty() {
            return Err(StoreError::DurableState(
                "durable piece batch must be nonempty".to_owned(),
            ));
        }
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        let transaction = self.connection.transaction()?;
        let (piece_count, fingerprint, bytes) = read_have_columns(&transaction, &torrent_id)?;
        let mut have = HaveState::decode(&bytes, torrent_id, fingerprint, piece_count)?;
        let (raw_info, completion_eligible, completion_counted) = transaction.query_row(
            "SELECT raw_info, product_completion_eligible, product_completion_counted
             FROM torrents WHERE torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, bool>(1)?,
                    row.get::<_, bool>(2)?,
                ))
            },
        )?;
        let skip_files = read_selection(&transaction, &torrent_id)?;
        let metainfo_source = read_verbatim_metainfo_source(&transaction, &torrent_id)?;
        let (_, complete_before) =
            wanted_piece_evidence(&raw_info, metainfo_source.as_deref(), &skip_files, &have)?;
        let mut newly_verified = false;
        for &piece_index in piece_indices {
            let was_verified = have.pieces().get(piece_index).copied().unwrap_or(false);
            have.set(piece_index, true)?;
            newly_verified |= !was_verified;
        }
        let (has_wanted, complete_after) =
            wanted_piece_evidence(&raw_info, metainfo_source.as_deref(), &skip_files, &have)?;
        let downloaded_completion = newly_verified
            && has_wanted
            && !complete_before
            && complete_after
            && completion_eligible
            && !completion_counted;
        let revision = increment_revision(&transaction)?;
        let revision_sql = sql_revision(revision)?;
        transaction.execute(
            "UPDATE torrents
             SET have_state = ?2,
                 updated_revision = ?3,
                 download_queue_position = CASE WHEN ?4 THEN NULL
                                                ELSE download_queue_position END,
                 product_completion_eligible = CASE WHEN ?4 THEN 0
                                                    ELSE product_completion_eligible END,
                 product_completion_counted = CASE WHEN ?4 THEN 1
                                                   ELSE product_completion_counted END
             WHERE torrent_id = ?1",
            params![
                torrent_id.as_bytes(),
                have.encode(),
                revision_sql,
                downloaded_completion
            ],
        )?;
        if downloaded_completion {
            append_product_milestone(&transaction, ProductMilestoneKind::DownloadCompleted)?;
        }
        transaction.commit()?;
        Ok(revision)
    }

    pub fn invalidate_pieces(
        &mut self,
        torrent_id: &str,
        piece_indices: &[usize],
    ) -> Result<u64, StoreError> {
        if piece_indices.is_empty() {
            return Err(StoreError::DurableState(
                "invalidated piece batch must be nonempty".to_owned(),
            ));
        }
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        let transaction = self.connection.transaction()?;
        let (piece_count, fingerprint, bytes) = read_have_columns(&transaction, &torrent_id)?;
        let mut have = HaveState::decode(&bytes, torrent_id, fingerprint, piece_count)?;
        for &piece_index in piece_indices {
            have.set(piece_index, false)?;
        }
        let revision = increment_revision(&transaction)?;
        let revision_sql = sql_revision(revision)?;
        transaction.execute(
            "UPDATE torrents
             SET have_state = ?2,
                 updated_revision = ?3
             WHERE torrent_id = ?1",
            params![torrent_id.as_bytes(), have.encode(), revision_sql],
        )?;
        transaction.commit()?;
        Ok(revision)
    }

    pub fn replace_have(&mut self, torrent_id: &str, have: &HaveState) -> Result<u64, StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        if have.torrent_id() != torrent_id {
            return Err(StoreError::DurableState(
                "replacement have state has the wrong identity".to_owned(),
            ));
        }
        let encoded = have.encode();
        validate_have_state_length(&encoded)?;
        let transaction = self.connection.transaction()?;
        let (piece_count, fingerprint, _) = read_have_columns(&transaction, &torrent_id)?;
        if have.pieces().len() != piece_count || have.content_fingerprint() != fingerprint {
            return Err(StoreError::DurableState(
                "replacement have state has the wrong piece count".to_owned(),
            ));
        }
        let revision = increment_revision(&transaction)?;
        let revision_sql = sql_revision(revision)?;
        transaction.execute(
            "UPDATE torrents
             SET have_state = ?2, updated_revision = ?3
             WHERE torrent_id = ?1",
            params![torrent_id.as_bytes(), encoded, revision_sql],
        )?;
        transaction.commit()?;
        Ok(revision)
    }

    pub fn begin_recheck(&mut self, torrent_id: &str) -> Result<u64, StoreError> {
        self.begin_recheck_with_generation(torrent_id)
            .map(|(revision, _)| revision)
    }

    pub(crate) fn begin_recheck_with_generation(
        &mut self,
        torrent_id: &str,
    ) -> Result<(u64, u64), StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        let transaction = self.connection.transaction()?;
        let (requested, completed, updated_revision) = transaction
            .query_row(
                "SELECT verification_requested, verification_completed, updated_revision
                 FROM torrents WHERE torrent_id = ?1 AND raw_info IS NOT NULL
                       AND have_state IS NOT NULL",
                [torrent_id.as_bytes()],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| {
                StoreError::DurableState(
                    "recheck requires verified metadata and have state".to_owned(),
                )
            })?;
        if requested != completed {
            let revision = u64::try_from(updated_revision)
                .map_err(|_| StoreError::DurableState("torrent revision is invalid".to_owned()))?;
            let generation = u64::try_from(requested).map_err(|_| {
                StoreError::DurableState("verification generation is invalid".to_owned())
            })?;
            return Ok((revision, generation));
        }
        let next_requested = requested.checked_add(1).ok_or_else(|| {
            StoreError::DurableState("verification generation overflow".to_owned())
        })?;
        let revision = increment_revision(&transaction)?;
        let revision_sql = sql_revision(revision)?;
        let updated = transaction.execute(
            "UPDATE torrents
             SET error = NULL, verification_requested = ?2,
                 updated_revision = ?3
             WHERE torrent_id = ?1 AND raw_info IS NOT NULL
                   AND have_state IS NOT NULL",
            params![torrent_id.as_bytes(), next_requested, revision_sql,],
        )?;
        if updated != 1 {
            return Err(StoreError::DurableState(
                "recheck requires verified metadata and have state".to_owned(),
            ));
        }
        transaction.commit()?;
        let generation = u64::try_from(next_requested).map_err(|_| {
            StoreError::DurableState("verification generation is invalid".to_owned())
        })?;
        Ok((revision, generation))
    }

    pub fn complete_recheck(
        &mut self,
        torrent_id: &str,
        have: &HaveState,
    ) -> Result<u64, StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        let requested = self
            .connection
            .query_row(
                "SELECT verification_requested FROM torrents WHERE torrent_id = ?1",
                [torrent_id.as_bytes()],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .ok_or_else(|| StoreError::UnknownTorrent(torrent_id.to_string()))?;
        let generation = u64::try_from(requested).map_err(|_| {
            StoreError::DurableState("verification generation is invalid".to_owned())
        })?;
        self.complete_recheck_generation(&torrent_id.to_string(), generation, have)
    }

    pub(crate) fn complete_recheck_generation(
        &mut self,
        torrent_id: &str,
        generation: u64,
        have: &HaveState,
    ) -> Result<u64, StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        if have.torrent_id() != torrent_id {
            return Err(StoreError::DurableState(
                "replacement have state has the wrong identity".to_owned(),
            ));
        }
        let transaction = self.connection.transaction()?;
        let (piece_count, fingerprint, current_bytes) =
            read_have_columns(&transaction, &torrent_id)?;
        if have.pieces().len() != piece_count || have.content_fingerprint() != fingerprint {
            return Err(StoreError::DurableState(
                "replacement have state has the wrong piece count".to_owned(),
            ));
        }
        let (requested, completed, updated_revision) = transaction.query_row(
            "SELECT verification_requested, verification_completed, updated_revision
             FROM torrents WHERE torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )?;
        let generation_sql = i64::try_from(generation)
            .map_err(|_| StoreError::DurableState("verification generation overflow".to_owned()))?;
        if requested != generation_sql {
            return Err(StoreError::DurableState(
                "stale recheck completion generation".to_owned(),
            ));
        }
        if completed == requested {
            let current = HaveState::decode(&current_bytes, torrent_id, fingerprint, piece_count)?;
            if &current == have {
                return u64::try_from(updated_revision).map_err(|_| {
                    StoreError::DurableState("torrent revision is invalid".to_owned())
                });
            }
            return Err(StoreError::DurableState(
                "completed verification generation has different evidence".to_owned(),
            ));
        }
        let (raw_info, desired_state, archived, retained) = transaction.query_row(
            "SELECT raw_info, desired_state, archived,
                    NOT EXISTS(SELECT 1 FROM removal_jobs r
                               WHERE r.torrent_id = torrents.torrent_id)
             FROM torrents WHERE torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, bool>(3)?,
                ))
            },
        )?;
        let skip_files = read_selection(&transaction, &torrent_id)?;
        let metainfo_source = read_verbatim_metainfo_source(&transaction, &torrent_id)?;
        let (has_wanted, all_wanted_verified) =
            wanted_piece_evidence(&raw_info, metainfo_source.as_deref(), &skip_files, have)?;
        if desired_state == "running" && !all_wanted_verified && !archived && retained {
            download_queue::append(&transaction, &torrent_id)?;
        }
        let revision = increment_revision(&transaction)?;
        let revision_sql = sql_revision(revision)?;
        transaction.execute(
            "UPDATE torrents
             SET have_state = ?2,
                 error = NULL, quarantine_reason = NULL,
                 verification_completed = verification_requested,
                 product_completion_eligible = CASE
                    WHEN ?4 AND product_completion_counted = 0 THEN 0
                    ELSE product_completion_eligible END,
                 updated_revision = ?3
             WHERE torrent_id = ?1",
            params![
                torrent_id.as_bytes(),
                have.encode(),
                revision_sql,
                has_wanted && all_wanted_verified
            ],
        )?;
        transaction.commit()?;
        Ok(revision)
    }

    /// Durably stops a running torrent whose seeding stop limit was reached.
    /// Returns false, changing nothing, unless the torrent is running and not
    /// archived, being removed or awaiting a file selection.
    pub(crate) fn stop_at_seed_limit(&mut self, torrent_id: &str) -> Result<bool, StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::UnknownTorrent(torrent_id.to_owned()))?;
        let transaction = self.connection.transaction()?;
        let eligible: bool = transaction
            .query_row(
                "SELECT t.desired_state = 'running' AND t.archived = 0
                        AND t.awaiting_file_selection = 0 AND r.torrent_id IS NULL
                 FROM torrents t
                 LEFT JOIN removal_jobs r ON r.torrent_id = t.torrent_id
                 WHERE t.torrent_id = ?1",
                [torrent_id.as_bytes()],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| StoreError::UnknownTorrent(torrent_id.to_string()))?;
        if !eligible {
            return Ok(false);
        }
        let revision = next_revision_strict(&transaction, read_revision(&transaction)?)?;
        transaction.execute(
            "UPDATE torrents
             SET desired_state = 'paused', seed_limit_stopped = 1, updated_revision = ?2
             WHERE torrent_id = ?1",
            params![
                torrent_id.as_bytes(),
                i64::try_from(revision)
                    .map_err(|_| StoreError::DurableState("revision overflow".to_owned()))?
            ],
        )?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn mark_complete(&mut self, torrent_id: &str) -> Result<u64, StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        let transaction = self.connection.transaction()?;
        let queue_position = transaction
            .query_row(
                "SELECT download_queue_position FROM torrents WHERE torrent_id = ?1",
                [torrent_id.as_bytes()],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()?
            .ok_or_else(|| StoreError::UnknownTorrent(torrent_id.to_string()))?;
        if queue_position.is_none() {
            return read_revision(&transaction);
        }
        let revision = increment_revision(&transaction)?;
        let updated = transaction.execute(
            "UPDATE torrents
             SET download_queue_position = NULL, error = NULL, updated_revision = ?2
             WHERE torrent_id = ?1",
            params![torrent_id.as_bytes(), sql_revision(revision)?],
        )?;
        if updated != 1 {
            return Err(StoreError::UnknownTorrent(torrent_id.to_string()));
        }
        transaction.commit()?;
        Ok(revision)
    }

    pub fn mark_awaiting_storage(
        &mut self,
        torrent_id: &str,
        message: Option<&str>,
    ) -> Result<u64, StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        let transaction = self.connection.transaction()?;
        let revision = increment_revision(&transaction)?;
        let updated = transaction.execute(
            "UPDATE torrents SET error = ?2, updated_revision = ?3 WHERE torrent_id = ?1",
            params![
                torrent_id.as_bytes(),
                message.map(bounded_error),
                sql_revision(revision)?
            ],
        )?;
        if updated != 1 {
            return Err(StoreError::UnknownTorrent(torrent_id.to_string()));
        }
        transaction.commit()?;
        Ok(revision)
    }

    pub fn reset_have_from_metadata(&mut self, torrent_id: &str) -> Result<HaveState, StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        let raw_info = self
            .connection
            .query_row(
                "SELECT raw_info FROM torrents WHERE torrent_id = ?1",
                [torrent_id.as_bytes()],
                |row| row.get::<_, Option<Vec<u8>>>(0),
            )
            .optional()?
            .ok_or_else(|| StoreError::UnknownTorrent(torrent_id.to_string()))?
            .ok_or_else(|| {
                StoreError::DurableState("torrent has no verified metadata".to_owned())
            })?;
        let metainfo_source = read_verbatim_metainfo_source(&self.connection, &torrent_id)?;
        let content = parse_durable_content_descriptor(&raw_info, metainfo_source.as_deref())?;
        if content.info_hashes != read_info_hashes(&self.connection, &torrent_id)? {
            return Err(StoreError::DurableState(
                "stored metadata does not match torrent identity".to_owned(),
            ));
        }
        let have = HaveState::empty(
            torrent_id,
            ContentFingerprint::for_info_bytes(&raw_info),
            content.layout.piece_count(),
        )?;
        self.replace_have(&torrent_id.to_string(), &have)?;
        Ok(have)
    }

    pub fn mark_needs_repair(
        &mut self,
        torrent_id: &str,
        message: &str,
    ) -> Result<u64, StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        let transaction = self.connection.transaction()?;
        let revision = increment_revision(&transaction)?;
        let updated = transaction.execute(
            "UPDATE torrents
             SET quarantine_reason = ?2, error = ?2, updated_revision = ?3
             WHERE torrent_id = ?1",
            params![
                torrent_id.as_bytes(),
                bounded_error(message),
                sql_revision(revision)?,
            ],
        )?;
        if updated != 1 {
            return Err(StoreError::UnknownTorrent(torrent_id.to_string()));
        }
        transaction.commit()?;
        Ok(revision)
    }

    pub fn mark_error(&mut self, torrent_id: &str, message: &str) -> Result<u64, StoreError> {
        let torrent_id = decode_torrent_id(torrent_id)
            .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
        let error = bounded_error(message);
        let transaction = self.connection.transaction()?;
        let revision = increment_revision(&transaction)?;
        let revision_sql = sql_revision(revision)?;
        let updated = transaction.execute(
            "UPDATE torrents
             SET error = ?2,
                 updated_revision = ?3
             WHERE torrent_id = ?1",
            params![torrent_id.as_bytes(), error, revision_sql],
        )?;
        if updated != 1 {
            return Err(StoreError::UnknownTorrent(torrent_id.to_string()));
        }
        transaction.commit()?;
        Ok(revision)
    }
}

struct VerifiedRetainedMagnet {
    magnet: String,
    source: MagnetExportSource,
    parsed: Magnet,
}

fn export_base_magnet_from(
    connection: &Connection,
    torrent_id: &str,
) -> Result<(MagnetExportResult, Option<Vec<u8>>), StoreError> {
    let torrent_id = decode_torrent_id(torrent_id)
        .ok_or_else(|| StoreError::DurableState("invalid torrent identity".to_owned()))?;
    let raw_info = connection
        .query_row(
            "SELECT raw_info FROM torrents WHERE torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| row.get::<_, Option<Vec<u8>>>(0),
        )
        .optional()?
        .ok_or_else(|| StoreError::UnknownTorrent(torrent_id.to_string()))?;
    let content_name = raw_info.as_deref().map(durable_content_name).transpose()?;

    let info_hashes = read_info_hashes(connection, &torrent_id)?;
    if let Some(retained) = read_verified_retained_magnet(connection, &torrent_id, info_hashes)? {
        return Ok((
            MagnetExportResult {
                magnet: retained.magnet,
                source: retained.source,
                omitted_tracker_count: 0,
                peer_hints: Vec::new(),
                peer_hint_omission: None,
            },
            raw_info,
        ));
    }

    Ok((
        synthesize_magnet_export(
            info_hashes,
            content_name.as_deref(),
            &read_trackers(connection, &torrent_id)?,
        ),
        raw_info,
    ))
}

fn read_verified_retained_magnet(
    connection: &Connection,
    torrent_id: &TorrentId,
    info_hashes: InfoHashes,
) -> Result<Option<VerifiedRetainedMagnet>, StoreError> {
    let source = connection
        .query_row(
            "SELECT kind, fidelity, magnet, byte_length, sha256
             FROM torrent_source WHERE torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Vec<u8>>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((kind, fidelity, Some(magnet), byte_length, digest)) = source else {
        return Ok(None);
    };
    if kind != "magnet"
        || usize::try_from(byte_length).ok() != Some(magnet.len())
        || digest != Sha256::digest(magnet.as_bytes()).as_slice()
    {
        return Ok(None);
    }
    let Ok(parsed) = Magnet::parse(&magnet) else {
        return Ok(None);
    };
    if parsed.identities != info_hashes {
        return Ok(None);
    }
    let source = match fidelity.as_str() {
        "verbatim" => MagnetExportSource::Verbatim,
        "canonicalized" => MagnetExportSource::Canonicalized,
        _ => return Ok(None),
    };
    Ok(Some(VerifiedRetainedMagnet {
        magnet,
        source,
        parsed,
    }))
}

fn torrent_bytes_receipt_json(
    request: &AddTorrentBytesRequest,
    source_digest: &[u8; 32],
) -> Result<String, serde_json::Error> {
    let mut request_value = serde_json::to_value(request)?;
    request_value
        .as_object_mut()
        .expect("torrent byte request serializes as an object")
        .insert(
            "source_sha256".to_owned(),
            serde_json::Value::String(encode_digest(source_digest)),
        );
    serde_json::to_string(&serde_json::json!({
        "operation": "add_torrent_bytes",
        "request": request_value,
    }))
}

#[derive(Debug)]
pub enum StoreError {
    Io {
        operation: &'static str,
        source: std::io::Error,
    },
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    Have(HaveError),
    UnsupportedSchema {
        actual: i64,
        maximum: i64,
    },
    /// A catalog from before the supported baseline. It is left unchanged;
    /// only the user's Clear app data replaces it.
    RetiredSchema {
        actual: i64,
        minimum: i64,
    },
    ProfileResetBusy,
    UnsafeProfileFile {
        basename: &'static str,
        reason: String,
    },
    RequiredPragma(&'static str),
    Configuration(String),
    UnknownTorrent(String),
    Reconciled {
        winner: String,
        loser: String,
    },
    DurableState(String),
    ResourceLimit {
        resource: &'static str,
        actual: usize,
        maximum: usize,
    },
}

impl fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { operation, source } => write!(formatter, "{operation}: {source}"),
            Self::Sqlite(error) => write!(formatter, "session database: {error}"),
            Self::Json(error) => write!(formatter, "session JSON: {error}"),
            Self::Have(error) => write!(formatter, "verified-piece state: {error}"),
            Self::UnsupportedSchema { actual, maximum } => write!(
                formatter,
                "session schema {actual} is newer than supported version {maximum}"
            ),
            Self::RetiredSchema { actual, minimum } => write!(
                formatter,
                "session schema {actual} predates supported version {minimum}; \
                 it was left unchanged and can be discarded only by clearing app data"
            ),
            Self::ProfileResetBusy => {
                formatter.write_str("session database is busy; it was left unchanged")
            }
            Self::UnsafeProfileFile { basename, reason } => {
                write!(
                    formatter,
                    "unsafe session profile file {basename}: {reason}"
                )
            }
            Self::RequiredPragma(pragma) => {
                write!(formatter, "session database could not enable {pragma}")
            }
            Self::Configuration(message) => write!(formatter, "session configuration: {message}"),
            Self::UnknownTorrent(torrent_id) => {
                write!(formatter, "torrent {torrent_id} is not in the profile")
            }
            Self::Reconciled { winner, loser } => {
                write!(
                    formatter,
                    "torrent {loser} reconciled into older owner {winner}"
                )
            }
            Self::DurableState(message) => write!(formatter, "invalid durable state: {message}"),
            Self::ResourceLimit {
                resource,
                actual,
                maximum,
            } => write!(
                formatter,
                "durable {resource} {actual} exceeds limit {maximum}"
            ),
        }
    }
}

impl StoreError {
    pub fn is_resource_limit(&self) -> bool {
        matches!(self, Self::ResourceLimit { .. })
            || matches!(
                self,
                Self::Sqlite(rusqlite::Error::SqliteFailure(failure, _))
                    if failure.code == rusqlite::ErrorCode::DiskFull
            )
    }
}

impl Error for StoreError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            Self::Sqlite(error) => Some(error),
            Self::Json(error) => Some(error),
            Self::Have(error) => Some(error),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<HaveError> for StoreError {
    fn from(error: HaveError) -> Self {
        match error {
            HaveError::InvalidPieceCount { actual, maximum } => Self::ResourceLimit {
                resource: "piece count",
                actual,
                maximum,
            },
            error => Self::Have(error),
        }
    }
}

impl From<SettingsPersistenceError> for StoreError {
    fn from(error: SettingsPersistenceError) -> Self {
        match error {
            SettingsPersistenceError::Sqlite(error) => Self::Sqlite(error),
            SettingsPersistenceError::Corrupt(message) => Self::DurableState(message),
        }
    }
}

fn configure_ephemeral_connection(
    connection: &Connection,
    maximum_bytes: u64,
) -> Result<(), StoreError> {
    connection.pragma_update(None, "journal_mode", "MEMORY")?;
    let journal_mode: String =
        connection.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
    if !journal_mode.eq_ignore_ascii_case("memory") {
        return Err(StoreError::RequiredPragma("journal_mode=MEMORY"));
    }

    connection.pragma_update(None, "synchronous", "OFF")?;
    let synchronous: i64 = connection.pragma_query_value(None, "synchronous", |row| row.get(0))?;
    if synchronous != 0 {
        return Err(StoreError::RequiredPragma("synchronous=OFF"));
    }

    connection.pragma_update(None, "temp_store", "MEMORY")?;
    let temp_store: i64 = connection.pragma_query_value(None, "temp_store", |row| row.get(0))?;
    if temp_store != 2 {
        return Err(StoreError::RequiredPragma("temp_store=MEMORY"));
    }

    let page_size = pragma_u64(connection, "page_size")?;
    let maximum_page_count = maximum_bytes / page_size;
    if maximum_page_count == 0 {
        return Err(StoreError::Configuration(
            "ephemeral session database maximum is smaller than one SQLite page".to_owned(),
        ));
    }
    let maximum_page_count = i64::try_from(maximum_page_count).map_err(|_| {
        StoreError::Configuration(
            "ephemeral session database page maximum exceeds SQLite i64".to_owned(),
        )
    })?;
    connection.pragma_update(None, "max_page_count", maximum_page_count)?;
    let configured: i64 =
        connection.pragma_query_value(None, "max_page_count", |row| row.get(0))?;
    if configured != maximum_page_count {
        return Err(StoreError::RequiredPragma("max_page_count"));
    }
    Ok(())
}

fn decode_torrent_id(value: &str) -> Option<TorrentId> {
    value.parse().ok()
}

fn decode_stored_torrent_id(bytes: Vec<u8>) -> Result<TorrentId, StoreError> {
    let bytes: [u8; 16] = bytes
        .try_into()
        .map_err(|_| StoreError::DurableState("invalid torrent ID length".to_owned()))?;
    TorrentId::new(bytes)
        .map_err(|_| StoreError::DurableState("invalid zero torrent ID".to_owned()))
}

fn read_info_hashes(
    connection: &Connection,
    torrent_id: &TorrentId,
) -> Result<InfoHashes, StoreError> {
    let mut statement = connection.prepare(
        "SELECT protocol, full_hash FROM torrent_identities
         WHERE torrent_id = ?1 ORDER BY protocol",
    )?;
    let mut rows = statement.query([torrent_id.as_bytes().as_slice()])?;
    let mut v1 = None;
    let mut v2 = None;
    while let Some(row) = rows.next()? {
        let protocol = row.get::<_, String>(0)?;
        let bytes = row.get::<_, Vec<u8>>(1)?;
        match protocol.as_str() {
            "v1" if v1.is_none() => {
                let bytes = bytes.try_into().map_err(|_| {
                    StoreError::DurableState("invalid v1 identity length".to_owned())
                })?;
                v1 = Some(V1InfoHash::new(bytes));
            }
            "v2" if v2.is_none() => {
                let bytes = bytes.try_into().map_err(|_| {
                    StoreError::DurableState("invalid v2 identity length".to_owned())
                })?;
                v2 = Some(V2InfoHash::new(bytes));
            }
            "v1" | "v2" => {
                return Err(StoreError::DurableState(
                    "duplicate torrent protocol identity".to_owned(),
                ));
            }
            _ => {
                return Err(StoreError::DurableState(
                    "invalid torrent identity protocol".to_owned(),
                ));
            }
        }
    }
    InfoHashes::new(v1, v2)
        .map_err(|_| StoreError::DurableState("torrent has no protocol identity".to_owned()))
}

fn read_verbatim_metainfo_source(
    connection: &Connection,
    torrent_id: &TorrentId,
) -> Result<Option<Vec<u8>>, StoreError> {
    let source = connection
        .query_row(
            "SELECT kind, fidelity, metainfo, byte_length, sha256
             FROM torrent_source WHERE torrent_id = ?1",
            [torrent_id.as_bytes().as_slice()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<Vec<u8>>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Vec<u8>>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((kind, fidelity, source, length, digest)) = source else {
        return Ok(None);
    };
    if kind != "metainfo" {
        return Ok(None);
    }
    if fidelity != "verbatim" {
        return Err(StoreError::DurableState(
            "retained metainfo source is not verbatim".to_owned(),
        ));
    }
    let source = source.ok_or_else(|| {
        StoreError::DurableState("retained metainfo source bytes are missing".to_owned())
    })?;
    if usize::try_from(length).ok() != Some(source.len())
        || digest != Sha256::digest(&source).as_slice()
    {
        return Err(StoreError::DurableState(
            "retained metainfo source integrity mismatch".to_owned(),
        ));
    }
    Ok(Some(source))
}

fn find_torrent_id_by_full_hash(
    connection: &Connection,
    identity: FullInfoHash,
) -> Result<Option<TorrentId>, StoreError> {
    let (protocol, bytes): (&str, &[u8]) = match &identity {
        FullInfoHash::V1(hash) => ("v1", hash.as_bytes()),
        FullInfoHash::V2(hash) => ("v2", hash.as_bytes()),
    };
    connection
        .query_row(
            "SELECT torrent_id FROM torrent_identities
             WHERE protocol = ?1 AND full_hash = ?2",
            params![protocol, bytes],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()?
        .map(decode_stored_torrent_id)
        .transpose()
}

fn allocate_torrent_id(transaction: &Transaction<'_>) -> Result<TorrentId, StoreError> {
    for _ in 0..4 {
        let bytes: Vec<u8> =
            transaction.query_row("SELECT randomblob(16)", [], |row| row.get(0))?;
        let Ok(torrent_id) = decode_stored_torrent_id(bytes) else {
            continue;
        };
        let exists = transaction
            .query_row(
                "SELECT 1 FROM torrents WHERE torrent_id = ?1",
                [torrent_id.as_bytes().as_slice()],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !exists {
            return Ok(torrent_id);
        }
    }
    Err(StoreError::DurableState(
        "could not allocate a unique nonzero torrent ID in four attempts".to_owned(),
    ))
}

fn configure_durable_connection(connection: &Connection) -> Result<(), StoreError> {
    let journal_mode: String =
        connection.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        connection.pragma_update(None, "journal_mode", "WAL")?;
    }
    let journal_mode: String =
        connection.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        return Err(StoreError::RequiredPragma("journal_mode=WAL"));
    }
    connection.pragma_update(None, "synchronous", "FULL")?;
    let synchronous: i64 = connection.pragma_query_value(None, "synchronous", |row| row.get(0))?;
    if synchronous != 2 {
        return Err(StoreError::RequiredPragma("synchronous=FULL"));
    }
    Ok(())
}

fn database_page_usage(connection: &Connection) -> Result<DatabasePageUsage, StoreError> {
    Ok(DatabasePageUsage {
        page_size: pragma_u64(connection, "page_size")?,
        page_count: pragma_u64(connection, "page_count")?,
        maximum_page_count: pragma_u64(connection, "max_page_count")?,
    })
}

fn pragma_u64(connection: &Connection, pragma: &str) -> Result<u64, StoreError> {
    let value: i64 = connection.pragma_query_value(None, pragma, |row| row.get(0))?;
    u64::try_from(value).map_err(|_| StoreError::DurableState(format!("negative SQLite {pragma}")))
}

fn read_product_source_epoch(connection: &Connection) -> Result<[u8; 16], StoreError> {
    let bytes: Vec<u8> = connection.query_row(
        "SELECT source_epoch FROM product_milestone_state WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    let source_epoch: [u8; 16] = bytes.try_into().map_err(|_| {
        StoreError::DurableState("product milestone source epoch has invalid length".to_owned())
    })?;
    if source_epoch == [0; 16] {
        return Err(StoreError::DurableState(
            "product milestone source epoch is zero".to_owned(),
        ));
    }
    Ok(source_epoch)
}

fn append_product_milestone(
    transaction: &Transaction<'_>,
    kind: ProductMilestoneKind,
) -> Result<bool, StoreError> {
    let (next_sequence, dropped): (i64, i64) = transaction.query_row(
        "SELECT next_sequence, dropped_milestones
         FROM product_milestone_state WHERE singleton = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if next_sequence < 1 || dropped < 0 {
        return Err(StoreError::DurableState(
            "product milestone state is invalid".to_owned(),
        ));
    }
    let pending: i64 =
        transaction.query_row("SELECT count(*) FROM product_milestones", [], |row| {
            row.get(0)
        })?;
    if !(0..=MAX_PENDING_PRODUCT_MILESTONES).contains(&pending) {
        return Err(StoreError::DurableState(
            "product milestone outbox exceeds its durable bound".to_owned(),
        ));
    }
    if pending == MAX_PENDING_PRODUCT_MILESTONES || next_sequence == i64::MAX {
        transaction.execute(
            "UPDATE product_milestone_state
             SET dropped_milestones = CASE
                WHEN dropped_milestones < 9223372036854775807
                THEN dropped_milestones + 1
                ELSE dropped_milestones END
             WHERE singleton = 1",
            [],
        )?;
        return Ok(false);
    }
    transaction.execute(
        "INSERT INTO product_milestones(sequence, kind) VALUES (?1, ?2)",
        params![next_sequence, kind.as_str()],
    )?;
    transaction.execute(
        "UPDATE product_milestone_state SET next_sequence = ?1 WHERE singleton = 1",
        [next_sequence + 1],
    )?;
    Ok(true)
}

fn create_or_validate_catalog(
    connection: &mut Connection,
    profile_id: &str,
    initial_client_settings: &ClientSettings,
) -> Result<(), StoreError> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version != 0 {
        return validate_catalog(connection, profile_id);
    }
    let transaction = connection.transaction()?;
    create_schema_26(&transaction, profile_id, initial_client_settings)?;
    crate::store_migration::upgrade_fresh_catalog(&transaction)?;
    // The frozen baseline writes only baseline settings columns.
    replace_client_settings(&transaction, initial_client_settings)?;
    transaction.commit()?;
    validate_catalog(connection, profile_id)
}

/// Creates the frozen schema-26 baseline that every public release shipped.
/// Never edit these definitions: a schema change appends a step in
/// `store_migration`, and fresh catalogs run every step after this.
fn create_schema_26(
    transaction: &Transaction<'_>,
    profile_id: &str,
    initial_client_settings: &ClientSettings,
) -> Result<(), StoreError> {
    transaction.execute_batch(
        "CREATE TABLE profile_state (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            profile_id TEXT NOT NULL UNIQUE,
            revision INTEGER NOT NULL CHECK (revision >= 0)
         );
         CREATE TABLE profile_reset_report (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            previous_schema_version INTEGER NOT NULL CHECK (
                previous_schema_version BETWEEN 1 AND 25
            ),
            discarded_categories_json TEXT NOT NULL CHECK (
                length(discarded_categories_json) BETWEEN 2 AND 1024
            ),
            database_basenames_json TEXT NOT NULL CHECK (
                length(database_basenames_json) BETWEEN 2 AND 256
            ),
            external_payload_modified INTEGER NOT NULL CHECK (
                external_payload_modified = 0
            ),
            startup_published INTEGER NOT NULL DEFAULT 0 CHECK (
                startup_published IN (0, 1)
            )
         );
         CREATE TABLE storage_roots (
            root_id TEXT PRIMARY KEY,
            label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 256),
            kind TEXT NOT NULL CHECK (kind IN ('path', 'platform')),
            locator TEXT NOT NULL CHECK (length(locator) BETWEEN 1 AND 4096)
         );
         CREATE TABLE storage_settings (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            default_root TEXT
                REFERENCES storage_roots(root_id)
                ON UPDATE CASCADE ON DELETE SET NULL,
            show_add_options INTEGER NOT NULL DEFAULT 1
                CHECK (show_add_options IN (0, 1)),
            show_file_selection INTEGER NOT NULL DEFAULT 1
                CHECK (show_file_selection IN (0, 1))
         );
         CREATE TABLE torrents (
            torrent_id BLOB PRIMARY KEY CHECK (
                length(torrent_id) = 16 AND torrent_id <> zeroblob(16)
            ),
            magnet TEXT CHECK (magnet IS NULL OR length(magnet) <= 16384),
            storage_root TEXT NOT NULL
                REFERENCES storage_roots(root_id) ON UPDATE CASCADE,
            desired_state TEXT NOT NULL
                CHECK (desired_state IN ('running', 'paused')),
            awaiting_file_selection INTEGER NOT NULL DEFAULT 0
                CHECK (awaiting_file_selection IN (0, 1)),
            raw_info BLOB CHECK (
                raw_info IS NULL OR length(raw_info) <= 67108864
            ),
            content_fingerprint BLOB CHECK (
                content_fingerprint IS NULL OR length(content_fingerprint) = 32
            ),
            verification_requested INTEGER NOT NULL DEFAULT 0 CHECK (
                verification_requested >= 0
            ),
            verification_completed INTEGER NOT NULL DEFAULT 0 CHECK (
                verification_completed >= 0 AND
                verification_completed <= verification_requested
            ),
            quarantine_reason TEXT CHECK (
                quarantine_reason IS NULL OR length(quarantine_reason) <= 1024
            ),
            piece_count INTEGER CHECK (
                piece_count IS NULL OR
                (piece_count > 0 AND piece_count <= 2097152)
            ),
            have_state BLOB CHECK (
                have_state IS NULL OR length(have_state) <= 262206
            ),
            error TEXT CHECK (error IS NULL OR length(error) <= 1024),
            archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
            selection_default TEXT NOT NULL DEFAULT 'wanted'
                CHECK (selection_default IN ('wanted', 'skipped')),
            download_queue_position INTEGER,
            upload_rate_limit INTEGER NOT NULL DEFAULT 0 CHECK (
                upload_rate_limit = 0 OR
                upload_rate_limit BETWEEN 1024 AND 4294967295
            ),
            download_rate_limit INTEGER NOT NULL DEFAULT 0 CHECK (
                download_rate_limit = 0 OR
                download_rate_limit BETWEEN 1024 AND 4294967295
            ),
            total_uploaded INTEGER NOT NULL DEFAULT 0 CHECK (
                total_uploaded >= 0
            ),
            total_downloaded INTEGER NOT NULL DEFAULT 0 CHECK (
                total_downloaded >= 0
            ),
            active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (
                active_seconds >= 0
            ),
            finished_seconds INTEGER NOT NULL DEFAULT 0 CHECK (
                finished_seconds >= 0 AND finished_seconds <= active_seconds
            ),
            seeding_seconds INTEGER NOT NULL DEFAULT 0 CHECK (
                seeding_seconds >= 0 AND seeding_seconds <= finished_seconds
            ),
            product_completion_eligible INTEGER NOT NULL DEFAULT 1 CHECK (
                product_completion_eligible IN (0, 1)
            ),
            product_completion_counted INTEGER NOT NULL DEFAULT 0 CHECK (
                product_completion_counted IN (0, 1) AND
                product_completion_eligible + product_completion_counted <= 1
            ),
            tracker_complete INTEGER CHECK (
                tracker_complete IS NULL OR
                tracker_complete BETWEEN 0 AND 4294967295
            ),
            tracker_incomplete INTEGER CHECK (
                tracker_incomplete IS NULL OR
                tracker_incomplete BETWEEN 0 AND 4294967295
            ),
            created_revision INTEGER NOT NULL,
            updated_revision INTEGER NOT NULL,
            CHECK (
                (raw_info IS NULL AND content_fingerprint IS NULL AND
                 piece_count IS NULL AND have_state IS NULL) OR
                (raw_info IS NOT NULL AND content_fingerprint IS NOT NULL AND
                 piece_count IS NOT NULL AND have_state IS NOT NULL)
            )
         ) WITHOUT ROWID;
         CREATE TABLE torrent_identities (
            torrent_id BLOB NOT NULL CHECK (
                length(torrent_id) = 16 AND torrent_id <> zeroblob(16)
            ) REFERENCES torrents(torrent_id) ON DELETE CASCADE,
            protocol TEXT NOT NULL CHECK (protocol IN ('v1', 'v2')),
            full_hash BLOB NOT NULL CHECK (
                (protocol = 'v1' AND length(full_hash) = 20) OR
                (protocol = 'v2' AND length(full_hash) = 32)
            ),
            PRIMARY KEY (torrent_id, protocol),
            UNIQUE (protocol, full_hash)
         ) WITHOUT ROWID;
         CREATE TABLE file_selection (
            torrent_id BLOB NOT NULL CHECK (
                length(torrent_id) = 16 AND torrent_id <> zeroblob(16)
            ) REFERENCES torrents(torrent_id) ON DELETE CASCADE,
            file_index INTEGER NOT NULL
                CHECK (file_index >= 0 AND file_index < 374998),
            wanted INTEGER NOT NULL CHECK (wanted IN (0, 1)),
            PRIMARY KEY (torrent_id, file_index)
         ) WITHOUT ROWID;
         CREATE TABLE pending_selection_ranges (
            torrent_id BLOB NOT NULL CHECK (
                length(torrent_id) = 16 AND torrent_id <> zeroblob(16)
            ) REFERENCES torrents(torrent_id) ON DELETE CASCADE,
            range_start INTEGER NOT NULL CHECK (
                range_start >= 0 AND range_start < 374998
            ),
            range_end INTEGER NOT NULL CHECK (
                range_end >= range_start AND range_end < 374998
            ),
            PRIMARY KEY (torrent_id, range_start)
         ) WITHOUT ROWID;
         CREATE TABLE request_receipts (
            receipt_order INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id TEXT NOT NULL UNIQUE,
            request_json TEXT NOT NULL CHECK (length(request_json) <= 32768),
            response_json TEXT NOT NULL CHECK (length(response_json) <= 1048576),
            revision INTEGER NOT NULL CHECK (revision >= 0)
         );
         CREATE TABLE product_milestone_state (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            source_epoch BLOB NOT NULL CHECK (
                length(source_epoch) = 16 AND source_epoch <> zeroblob(16)
            ),
            next_sequence INTEGER NOT NULL CHECK (next_sequence >= 1),
            dropped_milestones INTEGER NOT NULL DEFAULT 0 CHECK (
                dropped_milestones >= 0
            )
         );
         CREATE TABLE product_milestones (
            sequence INTEGER PRIMARY KEY CHECK (sequence >= 1),
            kind TEXT NOT NULL CHECK (
                kind IN ('torrent_added', 'download_completed')
            )
         ) WITHOUT ROWID;",
    )?;
    transaction.execute(
        "INSERT INTO profile_state(singleton, profile_id, revision)
         VALUES (1, ?1, 0)",
        [profile_id],
    )?;
    transaction.execute(
        "INSERT INTO storage_settings(
            singleton, default_root, show_add_options, show_file_selection
         ) VALUES (1, NULL, 1, 1)",
        [],
    )?;
    let source_epoch = *uuid::Uuid::new_v4().as_bytes();
    transaction.execute(
        "INSERT INTO product_milestone_state(
            singleton, source_epoch, next_sequence, dropped_milestones
         ) VALUES (1, ?1, 1, 0)",
        [source_epoch.as_slice()],
    )?;
    create_client_settings(transaction, initial_client_settings)?;
    transaction.execute_batch(DHT_TABLES_SQL)?;
    transaction.execute_batch(REMOVAL_TABLE_SQL)?;
    transaction.execute_batch(SOURCE_TABLES_SQL)?;
    transaction.execute_batch(DOWNLOAD_QUEUE_INDEX_SQL)?;
    transaction.execute_batch(FILE_PRIORITIES_TABLE_SQL)?;
    transaction.pragma_update(None, "user_version", BASELINE_SCHEMA_VERSION)?;
    Ok(())
}

fn validate_catalog(connection: &Connection, profile_id: &str) -> Result<(), StoreError> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version != SCHEMA_VERSION {
        return Err(StoreError::UnsupportedSchema {
            actual: version,
            maximum: SCHEMA_VERSION,
        });
    }
    let stored_profile: String = connection.query_row(
        "SELECT profile_id FROM profile_state WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    if stored_profile != profile_id {
        return Err(StoreError::Configuration(format!(
            "session database belongs to profile {stored_profile}, not {profile_id}"
        )));
    }
    let invalid_file_priorities: i64 = connection.query_row(
        "SELECT count(*) FROM file_priorities WHERE priority <> 'high'",
        [],
        |row| row.get(0),
    )?;
    if invalid_file_priorities != 0 {
        return Err(StoreError::DurableState(
            "catalog contains an invalid file priority".to_owned(),
        ));
    }
    let invalid_identity_owners: i64 = connection.query_row(
        "SELECT count(*) FROM torrents t
         WHERE (SELECT count(*) FROM torrent_identities i
                WHERE i.torrent_id = t.torrent_id) NOT BETWEEN 1 AND 2",
        [],
        |row| row.get(0),
    )?;
    if invalid_identity_owners != 0 {
        return Err(StoreError::DurableState(format!(
            "{invalid_identity_owners} torrent owners do not have one or two protocol identities"
        )));
    }
    read_product_source_epoch(connection)?;
    let (next_sequence, dropped): (i64, i64) = connection.query_row(
        "SELECT next_sequence, dropped_milestones
         FROM product_milestone_state WHERE singleton = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if next_sequence < 1 || dropped < 0 {
        return Err(StoreError::DurableState(
            "product milestone state is invalid".to_owned(),
        ));
    }
    let (pending, minimum, maximum): (i64, Option<i64>, Option<i64>) = connection.query_row(
        "SELECT count(*), min(sequence), max(sequence) FROM product_milestones",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let non_contiguous = match (pending, minimum, maximum) {
        (0, None, None) => false,
        (count, Some(first), Some(last)) if count > 0 => {
            Some(last) != next_sequence.checked_sub(1)
                || last.checked_sub(first) != count.checked_sub(1)
        }
        _ => true,
    };
    if !(0..=MAX_PENDING_PRODUCT_MILESTONES).contains(&pending) || non_contiguous {
        return Err(StoreError::DurableState(
            "product milestone outbox is invalid or non-contiguous".to_owned(),
        ));
    }
    let unknown_product_milestones: i64 = connection.query_row(
        "SELECT count(*) FROM product_milestones
         WHERE kind NOT IN ('torrent_added', 'download_completed')",
        [],
        |row| row.get(0),
    )?;
    if unknown_product_milestones != 0 {
        return Err(StoreError::DurableState(
            "product milestone outbox contains an unknown kind".to_owned(),
        ));
    }
    let invalid_completion_state: i64 = connection.query_row(
        "SELECT count(*) FROM torrents
         WHERE product_completion_eligible NOT IN (0, 1)
            OR product_completion_counted NOT IN (0, 1)
            OR product_completion_eligible + product_completion_counted > 1",
        [],
        |row| row.get(0),
    )?;
    if invalid_completion_state != 0 {
        return Err(StoreError::DurableState(
            "catalog contains invalid product completion state".to_owned(),
        ));
    }
    read_client_settings(connection)?;
    Ok(())
}

fn validate_storage_root(root_id: &str, label: &str, path: &Path) -> Result<(), StoreError> {
    validate_identifier(root_id, "storage root", crate::control::MAX_ROOT_ID_LENGTH)
        .map_err(|(_, message)| StoreError::Configuration(message))?;
    validate_root_label(label)?;
    if !path.is_absolute() {
        return Err(StoreError::Configuration(
            "storage root path must be absolute".to_owned(),
        ));
    }
    let locator = path.to_str().ok_or_else(|| {
        StoreError::Configuration("storage root path is not valid UTF-8".to_owned())
    })?;
    validate_root_locator(locator)
}

fn validate_root_label(label: &str) -> Result<(), StoreError> {
    if label.is_empty() || label.len() > crate::control::MAX_ROOT_LABEL_LENGTH {
        return Err(StoreError::Configuration(format!(
            "storage root label must be 1..={} bytes",
            crate::control::MAX_ROOT_LABEL_LENGTH
        )));
    }
    Ok(())
}

fn validate_root_locator(locator: &str) -> Result<(), StoreError> {
    if locator.is_empty() || locator.len() > MAX_STORAGE_ROOT_LOCATOR_LENGTH {
        return Err(StoreError::Configuration(format!(
            "storage root locator must be 1..={MAX_STORAGE_ROOT_LOCATOR_LENGTH} bytes"
        )));
    }
    Ok(())
}

fn read_storage_roots(connection: &Connection) -> Result<Vec<StoredStorageRoot>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT root_id, label, kind, locator
         FROM storage_roots ORDER BY root_id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let mut roots = Vec::new();
    for row in rows {
        let (id, label, kind, locator) = row?;
        validate_identifier(&id, "storage root", crate::control::MAX_ROOT_ID_LENGTH)
            .map_err(|(_, message)| StoreError::DurableState(message))?;
        validate_root_label(&label).map_err(|error| StoreError::DurableState(error.to_string()))?;
        validate_root_locator(&locator)
            .map_err(|error| StoreError::DurableState(error.to_string()))?;
        let location = match kind.as_str() {
            "path" => StorageRootLocation::Path(PathBuf::from(locator)),
            "platform" if locator == "platform-capability:" => {
                StorageRootLocation::PlatformCapability
            }
            _ => {
                return Err(StoreError::DurableState(
                    "invalid storage root kind or locator".to_owned(),
                ));
            }
        };
        roots.push(StoredStorageRoot {
            id,
            label,
            location,
        });
    }
    if roots.len() > MAX_STORAGE_ROOTS {
        return Err(StoreError::DurableState(format!(
            "storage root count exceeds {MAX_STORAGE_ROOTS}"
        )));
    }
    Ok(roots)
}

fn read_storage_settings(connection: &Connection) -> Result<StorageSettingsSnapshot, StoreError> {
    let (default_root, show_add_options, show_file_selection) = connection.query_row(
        "SELECT default_root, show_add_options, show_file_selection
         FROM storage_settings WHERE singleton = 1",
        [],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, bool>(1)?,
                row.get::<_, bool>(2)?,
            ))
        },
    )?;
    let roots = read_storage_roots(connection)?
        .into_iter()
        .map(|root| {
            let (display_path, availability) = match &root.location {
                StorageRootLocation::Path(path) => (
                    path.to_str().map(str::to_owned),
                    if path.is_dir() && std::fs::read_dir(path).is_ok() {
                        StorageRootAvailability::Available
                    } else {
                        StorageRootAvailability::Unavailable
                    },
                ),
                StorageRootLocation::PlatformCapability => {
                    (None, StorageRootAvailability::Available)
                }
            };
            StorageRootSnapshot {
                root_id: root.id,
                label: root.label,
                display_path,
                availability,
            }
        })
        .collect();
    Ok(StorageSettingsSnapshot {
        roots,
        default_root,
        show_add_options,
        show_file_selection,
    })
}

/// Profiles written before archive implied paused intent may hold archived
/// rows that are running or awaiting add-time selection. Neither state can be
/// reached by current commands, so normalize them once in a single revision.
fn normalize_archived_intent(connection: &mut Connection) -> Result<(), StoreError> {
    let transaction = connection.transaction()?;
    let stale: i64 = transaction.query_row(
        "SELECT count(*) FROM torrents
         WHERE archived = 1
           AND (desired_state = 'running' OR awaiting_file_selection = 1)",
        [],
        |row| row.get(0),
    )?;
    if stale == 0 {
        return Ok(());
    }
    let revision = next_revision_strict(&transaction, read_revision(&transaction)?)?;
    let revision_sql = sql_revision(revision)?;
    transaction.execute(
        "UPDATE torrents SET archived = 0, updated_revision = ?1
         WHERE archived = 1 AND awaiting_file_selection = 1",
        [revision_sql],
    )?;
    transaction.execute(
        "UPDATE torrents SET desired_state = 'paused', updated_revision = ?1
         WHERE archived = 1 AND desired_state = 'running'",
        [revision_sql],
    )?;
    transaction.commit()?;
    Ok(())
}

fn register_storage_roots(
    connection: &mut Connection,
    storage_roots: &[ConfiguredStorageRoot],
) -> Result<(), StoreError> {
    if storage_roots.len() > MAX_STORAGE_ROOTS {
        return Err(StoreError::Configuration(format!(
            "configured storage root count exceeds {MAX_STORAGE_ROOTS}"
        )));
    }
    let transaction = connection.transaction()?;
    for root in storage_roots {
        validate_identifier(&root.id, "storage root", crate::control::MAX_ROOT_ID_LENGTH)
            .map_err(|(_, message)| StoreError::Configuration(message))?;
        validate_root_label(&root.label)?;
        let (kind, locator) = match &root.location {
            StorageRootLocation::Path(path) => (
                "path",
                path.to_str().ok_or_else(|| {
                    StoreError::Configuration(format!(
                        "storage root {} is not representable as UTF-8",
                        root.id
                    ))
                })?,
            ),
            StorageRootLocation::PlatformCapability => ("platform", "platform-capability:"),
        };
        validate_root_locator(locator)?;
        transaction.execute(
            "INSERT INTO storage_roots(root_id, label, kind, locator)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(root_id) DO UPDATE SET
                label = excluded.label,
                kind = excluded.kind,
                locator = excluded.locator",
            params![root.id, root.label, kind, locator],
        )?;
    }
    if let Some(first) = storage_roots.first() {
        transaction.execute(
            "UPDATE storage_settings SET default_root = ?1
             WHERE singleton = 1 AND default_root IS NULL",
            [&first.id],
        )?;
    }
    let count: i64 =
        transaction.query_row("SELECT COUNT(*) FROM storage_roots", [], |row| row.get(0))?;
    if count > i64::try_from(MAX_STORAGE_ROOTS).expect("root bound fits i64") {
        return Err(StoreError::Configuration(format!(
            "storage root count exceeds {MAX_STORAGE_ROOTS}"
        )));
    }
    transaction.commit()?;
    Ok(())
}

fn apply_mutation(
    transaction: &Transaction<'_>,
    request: &RequestEnvelope,
    current_revision: u64,
    profile_id: &str,
    reset_client_settings: &ClientSettings,
) -> Result<ResponseEnvelope, StoreError> {
    if matches!(&request.command, Command::ClearAppData) {
        return Ok(ResponseEnvelope::error(
            request.request_id.clone(),
            current_revision,
            ErrorCode::InvalidRequest,
            "app data clear requires the application owner".to_owned(),
        ));
    }
    if matches!(
        &request.command,
        Command::UpdateClientSettings { .. } | Command::ResetClientSettings
    ) {
        let settings = match &request.command {
            Command::UpdateClientSettings { patch } => {
                let current = read_client_settings(transaction)?;
                match patch.apply_to(&current) {
                    Ok(settings) => settings,
                    Err(error) => {
                        return Ok(ResponseEnvelope::error(
                            request.request_id.clone(),
                            current_revision,
                            ErrorCode::InvalidRequest,
                            error.to_string(),
                        ));
                    }
                }
            }
            Command::ResetClientSettings => reset_client_settings.clone(),
            _ => unreachable!("matched settings command"),
        };
        let changed = replace_client_settings(transaction, &settings)?;
        let revision = if changed {
            next_revision_strict(transaction, current_revision)?
        } else {
            current_revision
        };
        return Ok(ResponseEnvelope::success(
            request.request_id.clone(),
            revision,
            read_snapshot(transaction, profile_id)?,
        ));
    }
    if let Command::AddMagnet {
        magnet,
        storage_root,
        start_content,
        await_file_selection,
        skip_files,
    } = &request.command
    {
        return match add_magnet(
            transaction,
            magnet,
            storage_root,
            *start_content,
            *await_file_selection,
            skip_files,
            current_revision,
        ) {
            Ok((revision, result)) => Ok(ResponseEnvelope::success(
                request.request_id.clone(),
                revision,
                read_snapshot(transaction, profile_id)?,
            )
            .with_result(CommandResult::AddTorrent { result })),
            Err((code, message)) => Ok(ResponseEnvelope::error(
                request.request_id.clone(),
                current_revision,
                code,
                message,
            )),
        };
    }
    let result = match &request.command {
        Command::AddMagnet { .. } => unreachable!("magnet adds are handled above"),
        Command::SetFilePriority {
            torrent_id,
            file_indices,
            priority,
        } => set_file_priority(
            transaction,
            torrent_id,
            file_indices,
            *priority,
            current_revision,
        ),
        Command::SetFilePriorityRanges {
            torrent_id,
            ranges,
            priority,
        } => set_file_priority_indices(
            transaction,
            torrent_id,
            ranges
                .iter()
                .flat_map(|range| range.start..range.end_exclusive),
            *priority,
            false,
            current_revision,
        ),
        Command::DownloadFiles {
            torrent_id,
            file_indices,
        } => download_files(transaction, torrent_id, file_indices, current_revision),
        Command::MoveDownloadToTop { torrent_id } => {
            move_download_to_edge(transaction, torrent_id, QueueEdge::Top, current_revision)
        }
        Command::MoveDownloadToBottom { torrent_id } => {
            move_download_to_edge(transaction, torrent_id, QueueEdge::Bottom, current_revision)
        }
        Command::SetDefaultStorageRoot { storage_root } => {
            set_default_storage_root(transaction, storage_root, current_revision)
        }
        Command::SetShowAddOptions { show } => {
            set_show_add_options(transaction, *show, current_revision)
        }
        Command::SetShowFileSelection { show } => {
            set_show_file_selection(transaction, *show, current_revision)
        }
        Command::ConfirmPendingFileSelection {
            torrent_id,
            catalog_id,
            base,
            overrides,
            disable_future,
        } => confirm_pending_file_selection(
            transaction,
            torrent_id,
            catalog_id,
            *base,
            overrides,
            *disable_future,
            current_revision,
        ),
        Command::DownloadAllPendingAdd {
            torrent_id,
            disable_future,
        } => download_all_pending_add(transaction, torrent_id, *disable_future, current_revision),
        Command::CancelPendingAdd { torrent_id } => {
            cancel_pending_add(transaction, torrent_id, current_revision)
        }
        Command::UpdateClientSettings { .. } | Command::ResetClientSettings => {
            unreachable!("settings are handled atomically above")
        }
        Command::UpdateTorrentSettings { torrent_id, patch } => {
            update_torrent_settings(transaction, torrent_id, *patch, current_revision)
        }
        Command::RemoveStorageRoot { storage_root } => {
            remove_storage_root(transaction, storage_root, current_revision)
        }
        Command::ClearAppData => unreachable!("application service owns profile reset"),
        Command::Pause { torrent_id } => {
            set_desired_state(transaction, torrent_id, false, current_revision)
        }
        Command::Resume { torrent_id } => {
            set_desired_state(transaction, torrent_id, true, current_revision)
        }
        Command::ForceRecheck { torrent_id } => {
            force_recheck(transaction, torrent_id, current_revision)
        }
        Command::Archive { torrent_id } => {
            set_archived(transaction, torrent_id, true, current_revision)
        }
        Command::RestoreArchive { torrent_id } => {
            set_archived(transaction, torrent_id, false, current_revision)
        }
        Command::RemoveTorrent { torrent_id, data } => {
            begin_removal(transaction, torrent_id, *data, current_revision)
        }
        Command::ExportMagnet { .. } | Command::Snapshot | Command::Shutdown => {
            unreachable!("non-mutations are handled before transaction")
        }
    };
    match result {
        Ok(revision) => Ok(ResponseEnvelope::success(
            request.request_id.clone(),
            revision,
            read_snapshot(transaction, profile_id)?,
        )),
        Err((code, message)) => Ok(ResponseEnvelope::error(
            request.request_id.clone(),
            current_revision,
            code,
            message,
        )),
    }
}

enum AddTorrentBytesError {
    Response(ErrorCode, String),
    Store(StoreError),
}

fn add_torrent_bytes(
    transaction: &Transaction<'_>,
    request: &AddTorrentBytesRequest,
    prepared: &PreparedTorrentBytes,
    current_revision: u64,
) -> Result<(u64, AddTorrentResult), AddTorrentBytesError> {
    let source = &prepared.source;
    let source_digest = &prepared.source_digest;
    let projection = &prepared.projection;
    let selection_default = prepared.selection_default;
    let selection_exceptions = &prepared.selection_exceptions;
    let content = &projection.content;
    let mut identities = Vec::with_capacity(content.info_hashes().identity_count());
    content
        .info_hashes()
        .for_each(|identity| identities.push(identity));
    let mut existing = None;
    for identity in &identities {
        if let Some(owner) = find_torrent_id_by_full_hash(transaction, *identity)
            .map_err(AddTorrentBytesError::Store)?
        {
            existing.get_or_insert(owner);
        }
    }
    if let Some(existing) = existing {
        return Ok((
            current_revision,
            add_result(
                existing.to_string(),
                AddTorrentDisposition::AlreadyPresent,
                current_revision,
            ),
        ));
    }
    let root_exists = transaction
        .query_row(
            "SELECT 1 FROM storage_roots WHERE root_id = ?1",
            [&request.storage_root],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| AddTorrentBytesError::Store(StoreError::Sqlite(error)))?
        .is_some();
    if !root_exists {
        return Err(AddTorrentBytesError::Response(
            ErrorCode::UnknownStorageRoot,
            format!("storage root {} is not configured", request.storage_root),
        ));
    }
    let torrent_id = allocate_torrent_id(transaction).map_err(AddTorrentBytesError::Store)?;
    let raw_info = &source[projection.info_span.clone()];
    let fingerprint = ContentFingerprint::for_info_bytes(raw_info);
    let have = HaveState::empty(torrent_id, fingerprint, content.piece_count())
        .map_err(|error| {
            AddTorrentBytesError::Response(ErrorCode::ResourceLimit, error.to_string())
        })?
        .encode();
    let revision = current_revision.checked_add(1).ok_or_else(|| {
        AddTorrentBytesError::Response(ErrorCode::Internal, "profile revision overflow".to_owned())
    })?;
    let revision_sql = i64::try_from(revision).map_err(|_| {
        AddTorrentBytesError::Response(ErrorCode::Internal, "profile revision overflow".to_owned())
    })?;
    transaction
        .execute(
            "UPDATE profile_state SET revision = ?1 WHERE singleton = 1",
            [revision_sql],
        )
        .map_err(|error| AddTorrentBytesError::Store(StoreError::Sqlite(error)))?;
    transaction
        .execute(
            "INSERT INTO torrents(
                torrent_id, magnet, storage_root, desired_state, awaiting_file_selection,
                raw_info, content_fingerprint, piece_count, have_state,
                created_revision, updated_revision, selection_default
             ) VALUES (
                ?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10
             )",
            params![
                torrent_id.as_bytes().as_slice(),
                request.storage_root,
                if request.start_content && !request.await_file_selection {
                    "running"
                } else {
                    "paused"
                },
                request.await_file_selection,
                raw_info,
                fingerprint.as_bytes().as_slice(),
                i64::try_from(content.piece_count()).map_err(|_| {
                    AddTorrentBytesError::Response(
                        ErrorCode::Internal,
                        "piece count overflows i64".to_owned(),
                    )
                })?,
                have,
                revision_sql,
                if selection_default == FilePriority::Normal {
                    "wanted"
                } else {
                    "skipped"
                },
            ],
        )
        .map_err(|error| AddTorrentBytesError::Store(StoreError::Sqlite(error)))?;
    for identity in identities {
        transaction
            .execute(
                "INSERT INTO torrent_identities(torrent_id, protocol, full_hash)
                 VALUES (?1, ?2, ?3)",
                params![
                    torrent_id.as_bytes().as_slice(),
                    identity.protocol().as_str(),
                    identity.as_bytes()
                ],
            )
            .map_err(|error| AddTorrentBytesError::Store(StoreError::Sqlite(error)))?;
    }
    if request.start_content && !request.await_file_selection {
        download_queue::append(transaction, &torrent_id).map_err(AddTorrentBytesError::Store)?;
    }
    transaction
        .execute(
            "INSERT INTO torrent_source(
                torrent_id, kind, fidelity, magnet, metainfo, byte_length, sha256
             ) VALUES (?1, 'metainfo', 'verbatim', NULL, ?2, ?3, ?4)",
            params![
                torrent_id.as_bytes().as_slice(),
                source,
                i64::try_from(source.len()).map_err(|_| {
                    AddTorrentBytesError::Response(
                        ErrorCode::Internal,
                        "torrent source length overflows i64".to_owned(),
                    )
                })?,
                source_digest,
            ],
        )
        .map_err(|error| AddTorrentBytesError::Store(StoreError::Sqlite(error)))?;
    for tracker in content.trackers() {
        let transport = match tracker.transport {
            MetainfoTrackerTransport::Udp => "udp",
            MetainfoTrackerTransport::Http => "http",
            MetainfoTrackerTransport::Https => "https",
        };
        transaction
            .execute(
                "INSERT INTO torrent_trackers(
                    torrent_id, tier, position, url, transport, source
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'metainfo')",
                params![
                    torrent_id.as_bytes().as_slice(),
                    i64::from(tracker.tier),
                    i64::from(tracker.position),
                    tracker.url.as_str(),
                    transport,
                ],
            )
            .map_err(|error| AddTorrentBytesError::Store(StoreError::Sqlite(error)))?;
    }
    let exception_wanted = selection_default == FilePriority::Skip;
    for file_index in selection_exceptions {
        transaction
            .execute(
                "INSERT INTO file_selection(torrent_id, file_index, wanted)
                 VALUES (?1, ?2, ?3)",
                params![
                    torrent_id.as_bytes().as_slice(),
                    i64::from(*file_index),
                    exception_wanted
                ],
            )
            .map_err(|error| AddTorrentBytesError::Store(StoreError::Sqlite(error)))?;
    }
    append_product_milestone(transaction, ProductMilestoneKind::TorrentAdded)
        .map_err(AddTorrentBytesError::Store)?;
    Ok((
        revision,
        add_result(
            torrent_id.to_string(),
            AddTorrentDisposition::Added,
            revision,
        ),
    ))
}

fn force_recheck(
    transaction: &Transaction<'_>,
    torrent_id: &str,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let torrent_id = decode_torrent_id(torrent_id).ok_or_else(|| {
        (
            ErrorCode::InvalidRequest,
            "invalid torrent identity".to_owned(),
        )
    })?;
    let row = transaction
        .query_row(
            "SELECT raw_info IS NOT NULL, verification_requested,
                    verification_completed,
                    EXISTS(SELECT 1 FROM removal_jobs r
                           WHERE r.torrent_id = torrents.torrent_id)
             FROM torrents WHERE torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| {
                Ok((
                    row.get::<_, bool>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, bool>(3)?,
                ))
            },
        )
        .optional()
        .map_err(internal_error)?
        .ok_or_else(|| {
            (
                ErrorCode::UnknownTorrent,
                format!("torrent {torrent_id} is not in the profile"),
            )
        })?;
    if row.3 {
        return Err((
            ErrorCode::InvalidTorrentState,
            "torrent removal is already in progress".to_owned(),
        ));
    }
    if !row.0 {
        return Err((
            ErrorCode::InvalidTorrentState,
            "force recheck requires verified metadata".to_owned(),
        ));
    }
    if row.1 < 0 || row.2 < 0 || row.2 > row.1 {
        return Err(internal_message(
            "database contains invalid verification generations",
        ));
    }
    let requested = if row.1 == row.2 {
        row.1
            .checked_add(1)
            .ok_or_else(|| internal_message("verification generation overflow"))?
    } else {
        row.1
    };
    if requested == row.1 {
        return Ok(current_revision);
    }
    let revision = next_revision(transaction, current_revision)?;
    let revision_sql =
        i64::try_from(revision).map_err(|_| internal_message("profile revision overflow"))?;
    transaction
        .execute(
            "UPDATE torrents
             SET error = NULL, updated_revision = ?2,
                 verification_requested = ?3
             WHERE torrent_id = ?1",
            params![torrent_id.as_bytes(), revision_sql, requested,],
        )
        .map_err(internal_error)?;
    Ok(revision)
}

fn move_download_to_edge(
    transaction: &Transaction<'_>,
    torrent_id: &str,
    edge: QueueEdge,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let torrent_id = decode_torrent_id(torrent_id).ok_or_else(|| {
        (
            ErrorCode::InvalidRequest,
            "invalid torrent identity".to_owned(),
        )
    })?;
    let eligible = transaction
        .query_row(
            "SELECT download_queue_position IS NOT NULL, archived = 0,
                    NOT EXISTS(SELECT 1 FROM removal_jobs r
                               WHERE r.torrent_id = torrents.torrent_id)
             FROM torrents WHERE torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| {
                Ok((
                    row.get::<_, bool>(0)?,
                    row.get::<_, bool>(1)?,
                    row.get::<_, bool>(2)?,
                ))
            },
        )
        .optional()
        .map_err(internal_error)?
        .ok_or_else(|| {
            (
                ErrorCode::UnknownTorrent,
                format!("torrent {torrent_id} is not in the profile"),
            )
        })?;
    if !(eligible.0 && eligible.1 && eligible.2) {
        return Err((
            ErrorCode::InvalidTorrentState,
            "queue movement requires an incomplete retained download with a queue position"
                .to_owned(),
        ));
    }
    if download_queue::is_at_edge(transaction, &torrent_id, edge)
        .map_err(|error| internal_message(&error.to_string()))?
    {
        return Ok(current_revision);
    }
    let revision = next_revision(transaction, current_revision)?;
    download_queue::move_to_edge(transaction, &torrent_id, edge)
        .map_err(|error| internal_message(&error.to_string()))?;
    transaction
        .execute(
            "UPDATE torrents SET updated_revision = ?2 WHERE torrent_id = ?1",
            params![
                torrent_id.as_bytes(),
                i64::try_from(revision)
                    .map_err(|_| internal_message("profile revision overflow"))?
            ],
        )
        .map_err(internal_error)?;
    Ok(revision)
}

fn set_default_storage_root(
    transaction: &Transaction<'_>,
    storage_root: &str,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let exists = transaction
        .query_row(
            "SELECT 1 FROM storage_roots WHERE root_id = ?1",
            [storage_root],
            |_| Ok(()),
        )
        .optional()
        .map_err(internal_error)?
        .is_some();
    if !exists {
        return Err((
            ErrorCode::UnknownStorageRoot,
            format!("storage root {storage_root} is not configured"),
        ));
    }
    let revision = next_revision(transaction, current_revision)?;
    transaction
        .execute(
            "UPDATE storage_settings SET default_root = ?1 WHERE singleton = 1",
            [storage_root],
        )
        .map_err(internal_error)?;
    Ok(revision)
}

fn set_show_add_options(
    transaction: &Transaction<'_>,
    show: bool,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let revision = next_revision(transaction, current_revision)?;
    transaction
        .execute(
            "UPDATE storage_settings SET show_add_options = ?1 WHERE singleton = 1",
            [show],
        )
        .map_err(internal_error)?;
    Ok(revision)
}

fn set_show_file_selection(
    transaction: &Transaction<'_>,
    show: bool,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let current = transaction
        .query_row(
            "SELECT show_file_selection FROM storage_settings WHERE singleton = 1",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(internal_error)?;
    if current == show {
        return Ok(current_revision);
    }
    let revision = next_revision(transaction, current_revision)?;
    transaction
        .execute(
            "UPDATE storage_settings SET show_file_selection = ?1 WHERE singleton = 1",
            [show],
        )
        .map_err(internal_error)?;
    Ok(revision)
}

fn remove_storage_root(
    transaction: &Transaction<'_>,
    storage_root: &str,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let exists = transaction
        .query_row(
            "SELECT 1 FROM storage_roots WHERE root_id = ?1",
            [storage_root],
            |_| Ok(()),
        )
        .optional()
        .map_err(internal_error)?
        .is_some();
    if !exists {
        return Err((
            ErrorCode::UnknownStorageRoot,
            format!("storage root {storage_root} is not configured"),
        ));
    }
    let references: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM torrents WHERE storage_root = ?1",
            [storage_root],
            |row| row.get(0),
        )
        .map_err(internal_error)?;
    if references != 0 {
        return Err((
            ErrorCode::StorageRootInUse,
            format!("storage root {storage_root} is used by {references} retained torrent(s)"),
        ));
    }
    let revision = next_revision(transaction, current_revision)?;
    // A removed default is replaced by the first other root, or none, as when
    // a platform root is detached.
    transaction
        .execute(
            "UPDATE storage_settings SET default_root = (
                SELECT root_id FROM storage_roots WHERE root_id <> ?1
                ORDER BY root_id LIMIT 1
             )
             WHERE singleton = 1 AND default_root = ?1",
            [storage_root],
        )
        .map_err(internal_error)?;
    transaction
        .execute(
            "DELETE FROM storage_roots WHERE root_id = ?1",
            [storage_root],
        )
        .map_err(internal_error)?;
    Ok(revision)
}

fn add_magnet(
    transaction: &Transaction<'_>,
    source: &str,
    storage_root: &str,
    start_content: bool,
    await_file_selection: bool,
    skip_files: &[u32],
    current_revision: u64,
) -> Result<(u64, AddTorrentResult), (ErrorCode, String)> {
    let magnet =
        Magnet::parse(source).map_err(|error| (ErrorCode::InvalidRequest, error.to_string()))?;
    if !skip_files.is_empty() && magnet.select_only.is_some() {
        return Err((
            ErrorCode::InvalidRequest,
            "skip_files and select-only magnet intent cannot be combined".to_owned(),
        ));
    }
    let existing = transaction
        .query_row(
            "SELECT t.torrent_id, t.raw_info, t.selection_default,
                    desired_state, archived, quarantine_reason,
                    EXISTS(SELECT 1 FROM removal_jobs r
                           WHERE r.torrent_id = t.torrent_id)
             FROM torrents t
             JOIN torrent_identities i ON i.torrent_id = t.torrent_id
             WHERE i.protocol = ?1 AND i.full_hash = ?2",
            params![
                magnet.identity.protocol().as_str(),
                magnet.identity.as_bytes()
            ],
            |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, Option<Vec<u8>>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, bool>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, bool>(6)?,
                ))
            },
        )
        .optional()
        .map_err(internal_error)?;
    if let Some((
        torrent_id,
        raw_info,
        selection_default,
        desired_state,
        archived,
        quarantine_reason,
        removing,
    )) = existing
    {
        let torrent_id = decode_stored_torrent_id(torrent_id)
            .map_err(|error| internal_message(&error.to_string()))?;
        if removing {
            return Err((
                ErrorCode::InvalidTorrentState,
                "torrent removal is already in progress".to_owned(),
            ));
        }
        let Some(select_only) = magnet.select_only.as_ref() else {
            return Ok((
                current_revision,
                add_result(
                    torrent_id.to_string(),
                    AddTorrentDisposition::AlreadyPresent,
                    current_revision,
                ),
            ));
        };
        if raw_info.is_some() && quarantine_reason.is_some() {
            return Err((
                ErrorCode::InvalidTorrentState,
                "file selection cannot change during repair".to_owned(),
            ));
        }
        let file_plan = raw_info
            .as_deref()
            .map(|raw_info| {
                plan_duplicate_selection(
                    transaction,
                    &torrent_id,
                    raw_info,
                    &selection_default,
                    select_only.ranges(),
                )
            })
            .transpose()?;
        let pending_plan = if raw_info.is_none() {
            union_pending_selection(transaction, &torrent_id, select_only.ranges())?
        } else {
            None
        };
        if file_plan
            .as_ref()
            .is_some_and(|(_, changes)| changes.is_empty())
            || raw_info.is_none() && pending_plan.is_none()
        {
            return Ok((
                current_revision,
                add_result(
                    torrent_id.to_string(),
                    AddTorrentDisposition::AlreadyPresent,
                    current_revision,
                ),
            ));
        }
        let revision = next_revision(transaction, current_revision)?;
        if let Some((wanted_value, changes)) = &file_plan {
            for index in changes {
                if *wanted_value {
                    transaction
                        .execute(
                            "INSERT INTO file_selection(torrent_id, file_index, wanted)
                         VALUES (?1, ?2, 1)",
                            params![torrent_id.as_bytes().as_slice(), i64::from(*index)],
                        )
                        .map_err(internal_error)?;
                } else {
                    transaction
                        .execute(
                            "DELETE FROM file_selection
                         WHERE torrent_id = ?1 AND file_index = ?2 AND wanted = 0",
                            params![torrent_id.as_bytes().as_slice(), i64::from(*index)],
                        )
                        .map_err(internal_error)?;
                }
            }
        }
        if let Some(ranges) = &pending_plan {
            write_pending_ranges(transaction, &torrent_id, ranges)?;
        }
        let request_verification = raw_info.is_some() && desired_state == "running" && !archived;
        transaction
            .execute(
                "UPDATE torrents SET updated_revision = ?2,
                    error = CASE WHEN ?3 THEN NULL ELSE error END
                 WHERE torrent_id = ?1",
                params![
                    torrent_id.as_bytes().as_slice(),
                    sql_revision(revision).map_err(|e| internal_message(&e.to_string()))?,
                    request_verification,
                ],
            )
            .map_err(internal_error)?;
        return Ok((
            revision,
            add_result(
                torrent_id.to_string(),
                AddTorrentDisposition::SelectionExpanded {
                    newly_wanted_count: file_plan.as_ref().map(|(_, changes)| changes.len() as u32),
                },
                revision,
            ),
        ));
    }
    let root_exists = transaction
        .query_row(
            "SELECT 1 FROM storage_roots WHERE root_id = ?1",
            [storage_root],
            |_| Ok(()),
        )
        .optional()
        .map_err(internal_error)?
        .is_some();
    if !root_exists {
        return Err((
            ErrorCode::UnknownStorageRoot,
            format!("storage root {storage_root} is not configured"),
        ));
    }
    let torrent_id =
        allocate_torrent_id(transaction).map_err(|error| internal_message(&error.to_string()))?;
    let revision = current_revision
        .checked_add(1)
        .ok_or_else(|| internal_message("profile revision overflow"))?;
    let revision_sql =
        i64::try_from(revision).map_err(|_| internal_message("profile revision overflow"))?;
    transaction
        .execute(
            "UPDATE profile_state SET revision = ?1 WHERE singleton = 1",
            [revision_sql],
        )
        .map_err(internal_error)?;
    transaction
        .execute(
            "INSERT INTO torrents(
                torrent_id, magnet, storage_root, desired_state, awaiting_file_selection,
                created_revision, updated_revision, selection_default
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)",
            params![
                torrent_id.as_bytes().as_slice(),
                canonical_magnet(&magnet),
                storage_root,
                if start_content && !await_file_selection {
                    "running"
                } else {
                    "paused"
                },
                await_file_selection,
                revision_sql,
                if magnet.select_only.is_some() {
                    "skipped"
                } else {
                    "wanted"
                }
            ],
        )
        .map_err(internal_error)?;
    let mut identity_error = None;
    magnet.identities.for_each(|identity| {
        if identity_error.is_some() {
            return;
        }
        identity_error = transaction
            .execute(
                "INSERT INTO torrent_identities(torrent_id, protocol, full_hash)
                 VALUES (?1, ?2, ?3)",
                params![
                    torrent_id.as_bytes().as_slice(),
                    identity.protocol().as_str(),
                    identity.as_bytes()
                ],
            )
            .err();
    });
    if let Some(error) = identity_error {
        return Err(internal_error(error));
    }
    // Magnets have always retained a durable queue position even when added
    // paused so metadata acquisition remains FIFO and a later Resume keeps
    // its original place. Only add-time selection is held outside the
    // content queue until its atomic confirmation.
    if !await_file_selection {
        download_queue::append(transaction, &torrent_id)
            .map_err(|error| internal_message(&error.to_string()))?;
    }
    let source_digest = Sha256::digest(source.as_bytes());
    transaction
        .execute(
            "INSERT INTO torrent_source(
                torrent_id, kind, fidelity, magnet, metainfo, byte_length, sha256
             ) VALUES (?1, 'magnet', 'verbatim', ?2, NULL, ?3, ?4)",
            params![
                torrent_id.as_bytes().as_slice(),
                source,
                i64::try_from(source.len())
                    .map_err(|_| internal_message("magnet length overflows i64"))?,
                source_digest.as_slice(),
            ],
        )
        .map_err(internal_error)?;
    for (position, tracker) in magnet.trackers.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO torrent_trackers(
                    torrent_id, tier, position, url, transport, source
                 ) VALUES (?1, 0, ?2, ?3, ?4, 'magnet')",
                params![
                    torrent_id.as_bytes().as_slice(),
                    i64::try_from(position)
                        .map_err(|_| internal_message("tracker position overflows i64"))?,
                    tracker.url(),
                    tracker_transport_name(tracker.transport()),
                ],
            )
            .map_err(internal_error)?;
    }
    for (position, hint) in magnet.peer_hints.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO torrent_peer_hints(
                    torrent_id, position, host, port, source
                 ) VALUES (?1, ?2, ?3, ?4, 'magnet')",
                params![
                    torrent_id.as_bytes().as_slice(),
                    i64::try_from(position)
                        .map_err(|_| internal_message("peer hint position overflows i64"))?,
                    hint.host,
                    i64::from(hint.port),
                ],
            )
            .map_err(internal_error)?;
    }
    for file_index in skip_files {
        transaction
            .execute(
                "INSERT INTO file_selection(torrent_id, file_index, wanted)
                 VALUES (?1, ?2, 0)",
                params![torrent_id.as_bytes().as_slice(), i64::from(*file_index)],
            )
            .map_err(internal_error)?;
    }
    if let Some(selection) = &magnet.select_only {
        write_pending_ranges(transaction, &torrent_id, selection.ranges())?;
    }
    append_product_milestone(transaction, ProductMilestoneKind::TorrentAdded)
        .map_err(|error| internal_message(&error.to_string()))?;
    Ok((
        revision,
        add_result(
            torrent_id.to_string(),
            AddTorrentDisposition::Added,
            revision,
        ),
    ))
}

fn add_result(
    torrent_id: String,
    disposition: AddTorrentDisposition,
    revision: u64,
) -> AddTorrentResult {
    AddTorrentResult {
        torrent_id,
        disposition,
        resulting_revision: revision.to_string(),
    }
}

fn plan_duplicate_selection(
    transaction: &Transaction<'_>,
    torrent_id: &TorrentId,
    raw_info: &[u8],
    selection_default: &str,
    ranges: &[MagnetFileIndexRange],
) -> Result<(bool, Vec<u32>), (ErrorCode, String)> {
    let metainfo = Metainfo::from_info_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
        .map_err(|error| (ErrorCode::InvalidDurableState, error.to_string()))?;
    let wanted_value = match selection_default {
        "wanted" => false,
        "skipped" => true,
        _ => {
            return Err(internal_message(
                "database contains an invalid selection default",
            ));
        }
    };
    let (_, exceptions) = read_selection_state(transaction, torrent_id)
        .map_err(|error| internal_message(&error.to_string()))?;
    let mut changes = Vec::new();
    for range in ranges {
        let end = usize::try_from(range.end)
            .unwrap_or(usize::MAX)
            .min(metainfo.files.len().saturating_sub(1));
        let start = usize::try_from(range.start).unwrap_or(usize::MAX);
        if start > end {
            continue;
        }
        for index in start..=end {
            if metainfo.files[index].padding {
                continue;
            }
            let index =
                u32::try_from(index).map_err(|_| internal_message("file index overflow"))?;
            let is_exception = exceptions.binary_search(&index).is_ok();
            if wanted_value != is_exception {
                changes.push(index);
            }
        }
    }
    if wanted_value && exceptions.len() + changes.len() > MAX_FILE_SELECTION_ENTRIES {
        return Err((
            ErrorCode::ResourceLimit,
            format!("file selection exceeds {MAX_FILE_SELECTION_ENTRIES} exceptions"),
        ));
    }
    Ok((wanted_value, changes))
}

fn read_pending_ranges(
    transaction: &Transaction<'_>,
    torrent_id: &TorrentId,
) -> Result<Vec<MagnetFileIndexRange>, (ErrorCode, String)> {
    let mut statement = transaction
        .prepare(
            "SELECT range_start, range_end FROM pending_selection_ranges
         WHERE torrent_id = ?1 ORDER BY range_start",
        )
        .map_err(internal_error)?;
    let rows = statement
        .query_map([torrent_id.as_bytes()], |row| {
            Ok(MagnetFileIndexRange {
                start: row.get(0)?,
                end: row.get(1)?,
            })
        })
        .map_err(internal_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(internal_error)
}

fn union_pending_selection(
    transaction: &Transaction<'_>,
    torrent_id: &TorrentId,
    added: &[MagnetFileIndexRange],
) -> Result<Option<Vec<MagnetFileIndexRange>>, (ErrorCode, String)> {
    let initial = read_pending_ranges(transaction, torrent_id)?;
    let mut all = initial.clone();
    all.extend_from_slice(added);
    all.sort_unstable_by_key(|range| (range.start, range.end));
    let mut merged: Vec<MagnetFileIndexRange> = Vec::with_capacity(all.len());
    for range in all {
        if let Some(last) = merged.last_mut()
            && range.start <= last.end.saturating_add(1)
        {
            last.end = last.end.max(range.end);
        } else {
            merged.push(range);
        }
    }
    if merged == initial {
        return Ok(None);
    }
    Ok(Some(merged))
}

fn write_pending_ranges(
    transaction: &Transaction<'_>,
    torrent_id: &TorrentId,
    ranges: &[MagnetFileIndexRange],
) -> Result<(), (ErrorCode, String)> {
    transaction
        .execute(
            "DELETE FROM pending_selection_ranges WHERE torrent_id = ?1",
            [torrent_id.as_bytes()],
        )
        .map_err(internal_error)?;
    for range in ranges {
        transaction.execute(
            "INSERT INTO pending_selection_ranges(torrent_id, range_start, range_end) VALUES (?1, ?2, ?3)",
            params![torrent_id.as_bytes(), i64::from(range.start), i64::from(range.end)],
        ).map_err(internal_error)?;
    }
    Ok(())
}

fn set_file_priority(
    transaction: &Transaction<'_>,
    torrent_id: &str,
    file_indices: &[u32],
    priority: FilePriority,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    set_file_priority_indices(
        transaction,
        torrent_id,
        file_indices.iter().copied(),
        priority,
        false,
        current_revision,
    )
}

fn download_files(
    transaction: &Transaction<'_>,
    torrent_id: &str,
    file_indices: &[u32],
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    set_file_priority_indices(
        transaction,
        torrent_id,
        file_indices.iter().copied(),
        FilePriority::Normal,
        true,
        current_revision,
    )
}

fn set_file_priority_indices<I>(
    transaction: &Transaction<'_>,
    torrent_id: &str,
    file_indices: I,
    priority: FilePriority,
    set_running: bool,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)>
where
    I: Iterator<Item = u32> + Clone,
{
    let torrent_id = decode_torrent_id(torrent_id).ok_or_else(|| {
        (
            ErrorCode::InvalidRequest,
            "invalid torrent identity".to_owned(),
        )
    })?;
    let row = transaction
        .query_row(
            "SELECT t.raw_info, t.quarantine_reason, r.torrent_id IS NOT NULL,
                    t.selection_default, t.desired_state, t.archived,
                    t.download_queue_position, t.awaiting_file_selection
             FROM torrents t
             LEFT JOIN removal_jobs r ON r.torrent_id = t.torrent_id
             WHERE t.torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| {
                Ok((
                    row.get::<_, Option<Vec<u8>>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, bool>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, bool>(7)?,
                ))
            },
        )
        .optional()
        .map_err(internal_error)?
        .ok_or_else(|| {
            (
                ErrorCode::UnknownTorrent,
                format!("torrent {torrent_id} is not in the profile"),
            )
        })?;
    if row.2 {
        return Err((
            ErrorCode::InvalidTorrentState,
            "torrent removal is already in progress".to_owned(),
        ));
    }
    if row.7 {
        return Err((
            ErrorCode::InvalidTorrentState,
            "use the pending file-selection confirmation to change this torrent".to_owned(),
        ));
    }
    let raw_info = row.0.ok_or_else(|| {
        (
            ErrorCode::InvalidTorrentState,
            "file selection requires verified metadata".to_owned(),
        )
    })?;
    let metainfo_source = read_verbatim_metainfo_source(transaction, &torrent_id)
        .map_err(|error| (ErrorCode::InvalidDurableState, error.to_string()))?;
    let content = parse_durable_content_descriptor(&raw_info, metainfo_source.as_deref())
        .map_err(|error| (ErrorCode::InvalidDurableState, error.to_string()))?;
    let files = content.layout.files();
    for file_index in file_indices.clone() {
        let file_index = usize::try_from(file_index).map_err(|_| {
            (
                ErrorCode::InvalidRequest,
                "file selection index exceeds the supported file bound".to_owned(),
            )
        })?;
        let file = files.get(file_index).ok_or_else(|| {
            (
                ErrorCode::InvalidRequest,
                format!("file index {file_index} is outside verified metadata"),
            )
        })?;
        if file.padding {
            return Err((
                ErrorCode::InvalidRequest,
                format!("padding file {file_index} cannot be selected"),
            ));
        }
    }
    let (selection_default, mut exceptions) = read_selection_state(transaction, &torrent_id)
        .map_err(|error| internal_message(&error.to_string()))?;
    let mut high_priority_files = read_high_priority_files(transaction, &torrent_id)
        .map_err(|error| internal_message(&error.to_string()))?;
    let initial_exceptions = exceptions.clone();
    let initial_high_priority_files = high_priority_files.clone();
    for file_index in file_indices.clone() {
        let selection_priority = if priority == FilePriority::Skip {
            FilePriority::Skip
        } else {
            FilePriority::Normal
        };
        if selection_priority == selection_default {
            exceptions.retain(|index| *index != file_index);
        } else if let Err(position) = exceptions.binary_search(&file_index) {
            exceptions.insert(position, file_index);
        }
        if priority == FilePriority::High {
            if let Err(position) = high_priority_files.binary_search(&file_index) {
                high_priority_files.insert(position, file_index);
            }
        } else {
            high_priority_files.retain(|index| *index != file_index);
        }
    }
    if exceptions.len() > MAX_FILE_SELECTION_ENTRIES {
        return Err((
            ErrorCode::ResourceLimit,
            format!("file selection exceeds {MAX_FILE_SELECTION_ENTRIES} exceptions"),
        ));
    }
    if high_priority_files.len() > MAX_FILE_SELECTION_ENTRIES {
        return Err((
            ErrorCode::ResourceLimit,
            format!("file priority exceeds {MAX_FILE_SELECTION_ENTRIES} overrides"),
        ));
    }
    if !matches!(row.3.as_str(), "wanted" | "skipped") {
        return Err(internal_message(
            "database contains an invalid selection default",
        ));
    }
    if !matches!(row.4.as_str(), "running" | "paused") {
        return Err(internal_message(
            "database contains an invalid desired torrent state",
        ));
    }
    if set_running && row.5 {
        return Err((
            ErrorCode::InvalidTorrentState,
            "archived torrent must be restored before downloading files".to_owned(),
        ));
    }
    let selection_changed = exceptions != initial_exceptions;
    let priority_changed = high_priority_files != initial_high_priority_files;
    let running_changed = set_running && row.4 != "running";
    let move_download_to_head = set_running
        && row.6.is_some()
        && !download_queue::is_at_edge(transaction, &torrent_id, QueueEdge::Top)
            .map_err(|error| internal_message(&error.to_string()))?;
    let append_reopened_download = selection_changed
        && priority != FilePriority::Skip
        && row.4 == "running"
        && row.6.is_none();
    if (selection_changed || set_running) && row.1.is_some() {
        return Err((
            ErrorCode::InvalidTorrentState,
            "file selection cannot change during repair".to_owned(),
        ));
    }
    if !selection_changed
        && !priority_changed
        && !running_changed
        && !move_download_to_head
        && !append_reopened_download
    {
        return Ok(current_revision);
    }
    let revision = next_revision(transaction, current_revision)?;
    if selection_changed {
        transaction
            .execute(
                "DELETE FROM file_selection WHERE torrent_id = ?1",
                [torrent_id.as_bytes()],
            )
            .map_err(internal_error)?;
        let exception_wanted = selection_default == FilePriority::Skip;
        for file_index in exceptions {
            transaction
                .execute(
                    "INSERT INTO file_selection(torrent_id, file_index, wanted)
                     VALUES (?1, ?2, ?3)",
                    params![
                        torrent_id.as_bytes(),
                        i64::from(file_index),
                        exception_wanted
                    ],
                )
                .map_err(internal_error)?;
        }
    }
    if priority_changed {
        transaction
            .execute(
                "DELETE FROM file_priorities WHERE torrent_id = ?1",
                [torrent_id.as_bytes()],
            )
            .map_err(internal_error)?;
        for file_index in high_priority_files {
            transaction
                .execute(
                    "INSERT INTO file_priorities(torrent_id, file_index, priority)
                     VALUES (?1, ?2, 'high')",
                    params![torrent_id.as_bytes(), i64::from(file_index)],
                )
                .map_err(internal_error)?;
        }
    }
    let desired_state = if set_running {
        "running"
    } else {
        row.4.as_str()
    };
    transaction
        .execute(
            "UPDATE torrents
             SET desired_state = ?2, error = NULL, updated_revision = ?3,
                 seed_limit_stopped = CASE WHEN ?2 = 'running' THEN 0 ELSE seed_limit_stopped END
             WHERE torrent_id = ?1",
            params![
                torrent_id.as_bytes(),
                desired_state,
                i64::try_from(revision)
                    .map_err(|_| internal_message("profile revision overflow"))?
            ],
        )
        .map_err(internal_error)?;
    if set_running {
        if row.6.is_some() {
            download_queue::move_to_edge(transaction, &torrent_id, QueueEdge::Top)
                .map_err(|error| internal_message(&error.to_string()))?;
        } else if selection_changed {
            download_queue::place_missing(transaction, &torrent_id, QueueEdge::Top)
                .map_err(|error| internal_message(&error.to_string()))?;
        }
    } else if append_reopened_download {
        download_queue::append(transaction, &torrent_id)
            .map_err(|error| internal_message(&error.to_string()))?;
    }
    Ok(revision)
}

fn set_desired_state(
    transaction: &Transaction<'_>,
    torrent_id: &str,
    running: bool,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let torrent_id = decode_torrent_id(torrent_id).ok_or_else(|| {
        (
            ErrorCode::InvalidRequest,
            "invalid torrent identity".to_owned(),
        )
    })?;
    let row = transaction
        .query_row(
            "SELECT t.desired_state, t.quarantine_reason,
                    r.torrent_id IS NOT NULL, t.awaiting_file_selection, t.archived,
                    t.seed_limit_stopped
             FROM torrents t
             LEFT JOIN removal_jobs r ON r.torrent_id = t.torrent_id
             WHERE t.torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, bool>(4)?,
                    row.get::<_, bool>(5)?,
                ))
            },
        )
        .optional()
        .map_err(internal_error)?
        .ok_or_else(|| {
            (
                ErrorCode::UnknownTorrent,
                format!("torrent {torrent_id} is not in the profile"),
            )
        })?;
    if row.2 {
        return Err((
            ErrorCode::InvalidTorrentState,
            "torrent removal is already in progress".to_owned(),
        ));
    }
    if running && row.3 {
        return Err((
            ErrorCode::InvalidTorrentState,
            "torrent must confirm its pending file selection before resuming".to_owned(),
        ));
    }
    if running && row.4 {
        return Err((
            ErrorCode::InvalidTorrentState,
            "archived torrent must be restored before starting".to_owned(),
        ));
    }
    let desired = if running { "running" } else { "paused" };
    if running && row.1.is_some() {
        return Err((
            ErrorCode::InvalidTorrentState,
            "torrent cannot resume while quarantined".to_owned(),
        ));
    }
    // Completion removes queue order. A paused recheck or selection change
    // can subsequently expose missing content without making it runnable.
    // Resume must restore a missing position atomically with running intent.
    let append_missing = running
        && download_queue::queue_position(transaction, &torrent_id)
            .map_err(|error| internal_message(&error.to_string()))?
            .is_none()
        && needs_download_queue(transaction, &torrent_id)
            .map_err(|error| internal_message(&error.to_string()))?;
    if row.0 == desired && !append_missing {
        return Ok(current_revision);
    }
    let revision = current_revision
        .checked_add(1)
        .ok_or_else(|| internal_message("profile revision overflow"))?;
    let revision_sql =
        i64::try_from(revision).map_err(|_| internal_message("profile revision overflow"))?;
    transaction
        .execute(
            "UPDATE profile_state SET revision = ?1 WHERE singleton = 1",
            [revision_sql],
        )
        .map_err(internal_error)?;
    // Resuming a torrent that a seeding limit stopped means keep seeding:
    // its own limits become No limit so the next check does not stop it.
    let keep_seeding = running && row.5;
    transaction
        .execute(
            "UPDATE torrents
             SET desired_state = ?2, error = NULL, updated_revision = ?3,
                 seed_limit_stopped = CASE WHEN ?2 = 'running' THEN 0 ELSE seed_limit_stopped END,
                 seed_stop_ratio_percent =
                    CASE WHEN ?4 THEN -1 ELSE seed_stop_ratio_percent END,
                 seed_stop_time_seconds =
                    CASE WHEN ?4 THEN -1 ELSE seed_stop_time_seconds END
             WHERE torrent_id = ?1",
            params![torrent_id.as_bytes(), desired, revision_sql, keep_seeding],
        )
        .map_err(internal_error)?;
    if append_missing {
        download_queue::append(transaction, &torrent_id)
            .map_err(|error| internal_message(&error.to_string()))?;
    }
    Ok(revision)
}

fn needs_download_queue(
    connection: &Connection,
    torrent_id: &TorrentId,
) -> Result<bool, StoreError> {
    let (archived, raw_info) = connection.query_row(
        "SELECT archived, raw_info FROM torrents WHERE torrent_id = ?1",
        [torrent_id.as_bytes()],
        |row| Ok((row.get::<_, bool>(0)?, row.get::<_, Option<Vec<u8>>>(1)?)),
    )?;
    if archived {
        return Ok(false);
    }
    let Some(raw_info) = raw_info else {
        return Ok(true);
    };
    let (piece_count, fingerprint, bytes) = read_have_columns(connection, torrent_id)?;
    let have = HaveState::decode(&bytes, *torrent_id, fingerprint, piece_count)?;
    let skip_files = read_selection(connection, torrent_id)?;
    let source = read_verbatim_metainfo_source(connection, torrent_id)?;
    let (_, complete) = wanted_piece_evidence(&raw_info, source.as_deref(), &skip_files, &have)?;
    Ok(!complete)
}

fn set_archived(
    transaction: &Transaction<'_>,
    torrent_id: &str,
    archived: bool,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let torrent_id = decode_torrent_id(torrent_id).ok_or_else(|| {
        (
            ErrorCode::InvalidRequest,
            "invalid torrent identity".to_owned(),
        )
    })?;
    let current = transaction
        .query_row(
            "SELECT t.archived, r.torrent_id IS NOT NULL, t.awaiting_file_selection
             FROM torrents t
             LEFT JOIN removal_jobs r ON r.torrent_id = t.torrent_id
             WHERE t.torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| {
                Ok((
                    row.get::<_, bool>(0)?,
                    row.get::<_, bool>(1)?,
                    row.get::<_, bool>(2)?,
                ))
            },
        )
        .optional()
        .map_err(internal_error)?
        .ok_or_else(|| {
            (
                ErrorCode::UnknownTorrent,
                format!("torrent {torrent_id} is not in the profile"),
            )
        })?;
    if current.1 {
        return Err((
            ErrorCode::InvalidTorrentState,
            "torrent removal is already in progress".to_owned(),
        ));
    }
    if current.0 == archived {
        return Ok(current_revision);
    }
    if archived && current.2 {
        return Err((
            ErrorCode::InvalidTorrentState,
            "torrent must confirm or cancel its pending file selection before archiving".to_owned(),
        ));
    }
    let revision = next_revision(transaction, current_revision)?;
    // Archived torrents are inactive: archiving also persists paused intent,
    // and restoring leaves the torrent paused until it is started again.
    transaction
        .execute(
            "UPDATE torrents
             SET archived = ?2, updated_revision = ?3,
                 desired_state = CASE WHEN ?2 THEN 'paused' ELSE desired_state END
             WHERE torrent_id = ?1",
            params![
                torrent_id.as_bytes(),
                archived,
                i64::try_from(revision)
                    .map_err(|_| internal_message("profile revision overflow"))?
            ],
        )
        .map_err(internal_error)?;
    Ok(revision)
}

fn confirm_pending_file_selection(
    transaction: &Transaction<'_>,
    torrent_id: &str,
    catalog_id: &str,
    base: PendingFileSelectionBase,
    overrides: &[FileSelectionOverride],
    disable_future: bool,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let torrent_id = decode_torrent_id(torrent_id).ok_or_else(|| {
        (
            ErrorCode::InvalidRequest,
            "invalid torrent identity".to_owned(),
        )
    })?;
    let row = transaction
        .query_row(
            "SELECT t.raw_info, t.content_fingerprint, t.awaiting_file_selection,
                    t.selection_default, t.quarantine_reason,
                    r.torrent_id IS NOT NULL
             FROM torrents t
             LEFT JOIN removal_jobs r ON r.torrent_id = t.torrent_id
             WHERE t.torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| {
                Ok((
                    row.get::<_, Option<Vec<u8>>>(0)?,
                    row.get::<_, Option<Vec<u8>>>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, bool>(5)?,
                ))
            },
        )
        .optional()
        .map_err(internal_error)?
        .ok_or_else(|| {
            (
                ErrorCode::UnknownTorrent,
                format!("torrent {torrent_id} is not in the profile"),
            )
        })?;
    if !row.2 || row.5 {
        return Err((
            ErrorCode::InvalidTorrentState,
            "torrent is no longer awaiting file selection".to_owned(),
        ));
    }
    if row.4.is_some() {
        return Err((
            ErrorCode::StorageNeedsRepair,
            "torrent storage needs repair before file selection can be confirmed".to_owned(),
        ));
    }
    let raw_info = row.0.ok_or_else(|| {
        (
            ErrorCode::InvalidTorrentState,
            "file selection is waiting for verified metadata".to_owned(),
        )
    })?;
    let fingerprint = row.1.ok_or_else(|| {
        (
            ErrorCode::InvalidDurableState,
            "verified metadata has no catalog identity".to_owned(),
        )
    })?;
    if !encode_hex(&fingerprint).eq_ignore_ascii_case(catalog_id) {
        return Err((
            ErrorCode::StaleRevision,
            "file catalog changed while the selection was open".to_owned(),
        ));
    }
    let metainfo_source = read_verbatim_metainfo_source(transaction, &torrent_id)
        .map_err(|error| (ErrorCode::InvalidDurableState, error.to_string()))?;
    let content = parse_durable_content_descriptor(&raw_info, metainfo_source.as_deref())
        .map_err(|error| (ErrorCode::InvalidDurableState, error.to_string()))?;
    let files = content.layout.files();
    if overrides.last().is_some_and(|entry| {
        usize::try_from(entry.range.end_exclusive).map_or(true, |end| end > files.len())
    }) {
        return Err((
            ErrorCode::InvalidRequest,
            "file selection override exceeds verified metadata".to_owned(),
        ));
    }
    for entry in overrides {
        for index in entry.range.start..entry.range.end_exclusive {
            if files[index as usize].padding {
                return Err((
                    ErrorCode::InvalidRequest,
                    format!("padding file {index} cannot be selected"),
                ));
            }
        }
    }

    let (current_default, current_exceptions) = read_selection_state(transaction, &torrent_id)
        .map_err(|error| internal_message(&error.to_string()))?;
    let selection_default = match base {
        PendingFileSelectionBase::Current => current_default,
        PendingFileSelectionBase::All => FilePriority::Normal,
        PendingFileSelectionBase::None => FilePriority::Skip,
    };
    let default_selected = selection_default == FilePriority::Normal;
    let mut exceptions = Vec::new();
    let mut override_index = 0;
    for (index, file) in files.iter().enumerate() {
        if file.padding {
            continue;
        }
        let index_u32 =
            u32::try_from(index).map_err(|_| internal_message("file index overflows u32"))?;
        while override_index < overrides.len()
            && overrides[override_index].range.end_exclusive <= index_u32
        {
            override_index += 1;
        }
        let selected = overrides
            .get(override_index)
            .filter(|entry| entry.range.start <= index_u32 && index_u32 < entry.range.end_exclusive)
            .map_or_else(
                || match base {
                    PendingFileSelectionBase::Current => {
                        current_exceptions.binary_search(&index_u32).is_err()
                            == (current_default == FilePriority::Normal)
                    }
                    PendingFileSelectionBase::All => true,
                    PendingFileSelectionBase::None => false,
                },
                |entry| entry.selected,
            );
        if selected != default_selected {
            exceptions.push(index_u32);
            if exceptions.len() > MAX_FILE_SELECTION_ENTRIES {
                return Err((
                    ErrorCode::ResourceLimit,
                    format!("file selection exceeds {MAX_FILE_SELECTION_ENTRIES} exceptions"),
                ));
            }
        }
    }

    let revision = next_revision(transaction, current_revision)?;
    transaction
        .execute(
            "DELETE FROM file_selection WHERE torrent_id = ?1",
            [torrent_id.as_bytes()],
        )
        .map_err(internal_error)?;
    transaction
        .execute(
            "DELETE FROM file_priorities WHERE torrent_id = ?1",
            [torrent_id.as_bytes()],
        )
        .map_err(internal_error)?;
    let exception_wanted = selection_default == FilePriority::Skip;
    for index in exceptions {
        transaction
            .execute(
                "INSERT INTO file_selection(torrent_id, file_index, wanted)
                 VALUES (?1, ?2, ?3)",
                params![torrent_id.as_bytes(), i64::from(index), exception_wanted],
            )
            .map_err(internal_error)?;
    }
    let revision_sql =
        i64::try_from(revision).map_err(|_| internal_message("profile revision overflow"))?;
    transaction
        .execute(
            "UPDATE torrents
             SET selection_default = ?2, awaiting_file_selection = 0,
                 desired_state = 'running', seed_limit_stopped = 0, error = NULL, updated_revision = ?3
             WHERE torrent_id = ?1",
            params![
                torrent_id.as_bytes(),
                if selection_default == FilePriority::Normal {
                    "wanted"
                } else {
                    "skipped"
                },
                revision_sql
            ],
        )
        .map_err(internal_error)?;
    download_queue::append(transaction, &torrent_id)
        .map_err(|error| internal_message(&error.to_string()))?;
    if disable_future {
        disable_future_file_selection(transaction, revision)?;
    }
    Ok(revision)
}

/// A "don't show again" choice commits with the add it accompanies, so a
/// rejected add never silently changes the preference.
///
/// The same choice releases every other queued add with the selection it
/// already holds, exactly as if it had been added with the dialog off, so the
/// user is not asked again for adds made before the choice. Torrents being
/// removed or needing storage repair stay queued for their own dialog.
fn disable_future_file_selection(
    transaction: &Transaction<'_>,
    revision: u64,
) -> Result<(), (ErrorCode, String)> {
    transaction
        .execute(
            "UPDATE storage_settings SET show_file_selection = 0 WHERE singleton = 1",
            [],
        )
        .map_err(internal_error)?;
    let queued = {
        let mut statement = transaction
            .prepare(
                "SELECT t.torrent_id FROM torrents t
                 LEFT JOIN removal_jobs r ON r.torrent_id = t.torrent_id
                 WHERE t.awaiting_file_selection = 1
                   AND t.quarantine_reason IS NULL
                   AND r.torrent_id IS NULL
                 ORDER BY t.created_revision, t.torrent_id",
            )
            .map_err(internal_error)?;
        statement
            .query_map([], |row| row.get::<_, Vec<u8>>(0))
            .map_err(internal_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(internal_error)?
    };
    let revision_sql =
        i64::try_from(revision).map_err(|_| internal_message("profile revision overflow"))?;
    for bytes in queued {
        let torrent_id = decode_stored_torrent_id(bytes)
            .map_err(|error| (ErrorCode::InvalidDurableState, error.to_string()))?;
        transaction
            .execute(
                "UPDATE torrents
                 SET awaiting_file_selection = 0, desired_state = 'running', seed_limit_stopped = 0,
                     error = NULL, updated_revision = ?2
                 WHERE torrent_id = ?1",
                params![torrent_id.as_bytes(), revision_sql],
            )
            .map_err(internal_error)?;
        download_queue::append(transaction, &torrent_id)
            .map_err(|error| internal_message(&error.to_string()))?;
    }
    Ok(())
}

/// Explicit all-files consent needs no catalog, so magnets can leave the
/// selection stage before metadata arrives. The transaction is the authority
/// for both selection and runtime admission, including after process restart.
fn download_all_pending_add(
    transaction: &Transaction<'_>,
    torrent_id: &str,
    disable_future: bool,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let decoded = decode_torrent_id(torrent_id).ok_or_else(|| {
        (
            ErrorCode::InvalidRequest,
            "invalid torrent identity".to_owned(),
        )
    })?;
    let (pending, quarantine, removing) = transaction
        .query_row(
            "SELECT t.awaiting_file_selection, t.quarantine_reason,
                    r.torrent_id IS NOT NULL
             FROM torrents t LEFT JOIN removal_jobs r ON r.torrent_id = t.torrent_id
             WHERE t.torrent_id = ?1",
            [decoded.as_bytes()],
            |row| {
                Ok((
                    row.get::<_, bool>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, bool>(2)?,
                ))
            },
        )
        .optional()
        .map_err(internal_error)?
        .ok_or_else(|| {
            (
                ErrorCode::UnknownTorrent,
                format!("torrent {decoded} is not in the profile"),
            )
        })?;
    if !pending || removing {
        return Err((
            ErrorCode::InvalidTorrentState,
            "torrent is no longer awaiting file selection".to_owned(),
        ));
    }
    if quarantine.is_some() {
        return Err((
            ErrorCode::StorageNeedsRepair,
            "torrent storage needs repair before downloading".to_owned(),
        ));
    }
    let revision = next_revision(transaction, current_revision)?;
    for table in [
        "file_selection",
        "file_priorities",
        "pending_selection_ranges",
    ] {
        transaction
            .execute(
                &format!("DELETE FROM {table} WHERE torrent_id = ?1"),
                [decoded.as_bytes()],
            )
            .map_err(internal_error)?;
    }
    transaction
        .execute(
            "UPDATE torrents SET selection_default = 'wanted', awaiting_file_selection = 0,
         desired_state = 'running', seed_limit_stopped = 0, error = NULL, updated_revision = ?2 WHERE torrent_id = ?1",
            params![
                decoded.as_bytes(),
                i64::try_from(revision)
                    .map_err(|_| internal_message("profile revision overflow"))?
            ],
        )
        .map_err(internal_error)?;
    download_queue::append(transaction, &decoded)
        .map_err(|error| internal_message(&error.to_string()))?;
    if disable_future {
        disable_future_file_selection(transaction, revision)?;
    }
    Ok(revision)
}

fn cancel_pending_add(
    transaction: &Transaction<'_>,
    torrent_id: &str,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let decoded = decode_torrent_id(torrent_id).ok_or_else(|| {
        (
            ErrorCode::InvalidRequest,
            "invalid torrent identity".to_owned(),
        )
    })?;
    let pending = transaction
        .query_row(
            "SELECT awaiting_file_selection FROM torrents WHERE torrent_id = ?1",
            [decoded.as_bytes()],
            |row| row.get::<_, bool>(0),
        )
        .optional()
        .map_err(internal_error)?
        .ok_or_else(|| {
            (
                ErrorCode::UnknownTorrent,
                format!("torrent {decoded} is not in the profile"),
            )
        })?;
    if !pending {
        return Err((
            ErrorCode::InvalidTorrentState,
            "torrent is no longer awaiting file selection".to_owned(),
        ));
    }
    begin_removal(
        transaction,
        torrent_id,
        RemovalDataPolicy::Keep,
        current_revision,
    )
}

fn begin_removal(
    transaction: &Transaction<'_>,
    torrent_id: &str,
    policy: RemovalDataPolicy,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let torrent_id = decode_torrent_id(torrent_id).ok_or_else(|| {
        (
            ErrorCode::InvalidRequest,
            "invalid torrent identity".to_owned(),
        )
    })?;
    let removal_state = transaction
        .query_row(
            "SELECT r.state
             FROM torrents t
             LEFT JOIN removal_jobs r ON r.torrent_id = t.torrent_id
             WHERE t.torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(internal_error)?
        .ok_or_else(|| {
            (
                ErrorCode::UnknownTorrent,
                format!("torrent {torrent_id} is not in the profile"),
            )
        })?;
    if removal_state
        .as_deref()
        .is_some_and(|state| state != "failed")
    {
        return Err((
            ErrorCode::InvalidTorrentState,
            "torrent removal is already in progress".to_owned(),
        ));
    }

    let revision = next_revision(transaction, current_revision)?;
    let revision_sql =
        i64::try_from(revision).map_err(|_| internal_message("profile revision overflow"))?;
    let operation_id = format!("remove-{revision}-{}", torrent_id);
    transaction
        .execute(
            "UPDATE torrents
             SET desired_state = 'paused', error = NULL,
                 updated_revision = ?2
             WHERE torrent_id = ?1",
            params![torrent_id.as_bytes(), revision_sql],
        )
        .map_err(internal_error)?;
    transaction
        .execute(
            "INSERT INTO removal_jobs(
                torrent_id, operation_id, data_policy, state, error,
                created_revision, updated_revision
             ) VALUES (?1, ?2, ?3, 'pending', NULL, ?4, ?4)
             ON CONFLICT(torrent_id) DO UPDATE SET
                operation_id = excluded.operation_id,
                data_policy = excluded.data_policy,
                state = 'pending',
                error = NULL,
                created_revision = excluded.created_revision,
                updated_revision = excluded.updated_revision",
            params![
                torrent_id.as_bytes(),
                operation_id,
                policy.as_str(),
                revision_sql
            ],
        )
        .map_err(internal_error)?;
    Ok(revision)
}

fn next_revision(
    transaction: &Transaction<'_>,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let revision = current_revision
        .checked_add(1)
        .ok_or_else(|| internal_message("profile revision overflow"))?;
    let revision_sql =
        i64::try_from(revision).map_err(|_| internal_message("profile revision overflow"))?;
    transaction
        .execute(
            "UPDATE profile_state SET revision = ?1 WHERE singleton = 1",
            [revision_sql],
        )
        .map_err(internal_error)?;
    Ok(revision)
}

fn update_torrent_settings(
    transaction: &Transaction<'_>,
    torrent_id: &str,
    patch: TorrentSettingsPatch,
    current_revision: u64,
) -> Result<u64, (ErrorCode, String)> {
    let torrent_id = decode_torrent_id(torrent_id).ok_or_else(|| {
        (
            ErrorCode::InvalidRequest,
            "invalid torrent identity".to_owned(),
        )
    })?;
    let current = transaction
        .query_row(
            "SELECT upload_rate_limit, download_rate_limit,
                    seed_stop_ratio_percent, seed_stop_time_seconds
             FROM torrents WHERE torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(internal_error)?
        .ok_or_else(|| {
            (
                ErrorCode::UnknownTorrent,
                format!("torrent {torrent_id} is not in the profile"),
            )
        })?;
    let current_limits = TorrentTransferLimits {
        upload: TransferRateLimit::from_persisted(current.0)
            .map_err(|error| internal_message(&format!("invalid durable upload limit: {error}")))?,
        download: TransferRateLimit::from_persisted(current.1).map_err(|error| {
            internal_message(&format!("invalid durable download limit: {error}"))
        })?,
    };
    let current_stop = read_seed_stop_limits(current.2, current.3)
        .map_err(|error| internal_message(&error.to_string()))?;
    let limits = patch
        .apply_to(current_limits)
        .map_err(|error| (ErrorCode::InvalidRequest, error.to_string()))?;
    let stop = patch
        .apply_to_seed_stop(current_stop)
        .map_err(|error| (ErrorCode::InvalidRequest, error.to_string()))?;
    let desired = (
        limits.upload.persisted(),
        limits.download.persisted(),
        stop.ratio_percent.persisted(),
        stop.time_seconds.persisted(),
    );
    if current == desired {
        return Ok(current_revision);
    }
    let revision = next_revision(transaction, current_revision)?;
    let changed = transaction
        .execute(
            "UPDATE torrents
             SET upload_rate_limit = ?2, download_rate_limit = ?3,
                 seed_stop_ratio_percent = ?4, seed_stop_time_seconds = ?5,
                 updated_revision = ?6
             WHERE torrent_id = ?1",
            params![
                torrent_id.as_bytes(),
                desired.0,
                desired.1,
                desired.2,
                desired.3,
                i64::try_from(revision).map_err(|_| internal_message("revision overflow"))?,
            ],
        )
        .map_err(internal_error)?;
    if changed != 1 {
        return Err(internal_message(
            "torrent settings update changed an unexpected row count",
        ));
    }
    Ok(revision)
}

fn read_seed_stop_limits(
    ratio_percent: Option<i64>,
    time_seconds: Option<i64>,
) -> Result<TorrentSeedStopLimits, StoreError> {
    let invalid = |error: crate::ClientSettingsError| {
        StoreError::DurableState(format!("invalid torrent seed stop limit: {error}"))
    };
    Ok(TorrentSeedStopLimits {
        ratio_percent: TorrentSeedStopLimit::from_persisted("seed stop ratio", ratio_percent)
            .map_err(invalid)?,
        time_seconds: TorrentSeedStopLimit::from_persisted("seed stop time", time_seconds)
            .map_err(invalid)?,
    })
}

fn next_revision_strict(
    transaction: &Transaction<'_>,
    current_revision: u64,
) -> Result<u64, StoreError> {
    let revision = current_revision
        .checked_add(1)
        .ok_or_else(|| StoreError::DurableState("profile revision overflow".to_owned()))?;
    let revision_sql = i64::try_from(revision)
        .map_err(|_| StoreError::DurableState("profile revision overflow".to_owned()))?;
    transaction.execute(
        "UPDATE profile_state SET revision = ?1 WHERE singleton = 1",
        [revision_sql],
    )?;
    Ok(revision)
}

fn read_snapshot(connection: &Connection, profile_id: &str) -> Result<ServiceSnapshot, StoreError> {
    let revision = read_revision(connection)?;
    let queue_ordinals = read_download_queue_ordinals(connection)?;
    let pending_ordinals = read_pending_file_selection_ordinals(connection)?;
    let mut statement = connection.prepare(
        "SELECT t.torrent_id, t.storage_root, t.raw_info, t.piece_count,
                t.have_state, t.content_fingerprint, t.error, t.archived,
                r.state, r.error,
                t.desired_state, t.verification_requested,
                t.verification_completed, t.quarantine_reason,
                t.upload_rate_limit, t.download_rate_limit,
                t.awaiting_file_selection, t.seed_stop_ratio_percent,
                t.seed_stop_time_seconds, t.seed_limit_stopped
         FROM torrents t
         LEFT JOIN removal_jobs r ON r.torrent_id = t.torrent_id
         ORDER BY t.torrent_id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, Vec<u8>>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<Vec<u8>>>(2)?,
            row.get::<_, Option<i64>>(3)?,
            row.get::<_, Option<Vec<u8>>>(4)?,
            row.get::<_, Option<Vec<u8>>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, bool>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
            row.get::<_, String>(10)?,
            row.get::<_, i64>(11)?,
            row.get::<_, i64>(12)?,
            row.get::<_, Option<String>>(13)?,
            row.get::<_, i64>(14)?,
            row.get::<_, i64>(15)?,
            row.get::<_, bool>(16)?,
            row.get::<_, Option<i64>>(17)?,
            row.get::<_, Option<i64>>(18)?,
            row.get::<_, bool>(19)?,
        ))
    })?;
    let mut torrents = Vec::new();
    for row in rows {
        let row = row?;
        let torrent_id = decode_stored_torrent_id(row.0)?;
        let protocol_identities = crate::TorrentProtocolIdentities::from_info_hashes(
            read_info_hashes(connection, &torrent_id)?,
        );
        let requested = u64::try_from(row.11).map_err(|_| {
            StoreError::DurableState("invalid requested verification generation".to_owned())
        })?;
        let completed = u64::try_from(row.12).map_err(|_| {
            StoreError::DurableState("invalid completed verification generation".to_owned())
        })?;
        let verification = VerificationState::new(requested, completed).ok_or_else(|| {
            StoreError::DurableState(
                "completed verification exceeds requested generation".to_owned(),
            )
        })?;
        let piece_count = match row.3 {
            Some(piece_count) => bounded_piece_count(piece_count)?,
            None => 0,
        };
        let have = match (&row.4, &row.5, piece_count) {
            (Some(bytes), Some(fingerprint), count) if count != 0 => {
                fingerprint.clone().try_into().ok().and_then(|fingerprint| {
                    HaveState::decode(
                        bytes,
                        torrent_id,
                        ContentFingerprint::from_digest(fingerprint),
                        count,
                    )
                    .ok()
                })
            }
            (None, None, 0) => None,
            _ => None,
        };
        let malformed_have = row.4.is_some() != (piece_count != 0)
            || row.5.is_some() != (piece_count != 0)
            || (row.4.is_some() && have.is_none());
        let (selection_default, selection_exceptions) =
            read_selection_state(connection, &torrent_id)?;
        let skip_files = if selection_default == FilePriority::Normal {
            selection_exceptions.clone()
        } else {
            read_selection(connection, &torrent_id)?
        };
        let high_priority_files = read_high_priority_files(connection, &torrent_id)?;
        let metainfo_source = read_verbatim_metainfo_source(connection, &torrent_id)?;
        let (has_wanted_pieces, all_wanted_verified, evidence_error) = match (&row.2, &have) {
            (Some(raw_info), Some(have)) => {
                match wanted_piece_evidence(raw_info, metainfo_source.as_deref(), &skip_files, have)
                {
                    Ok((has_wanted, all_verified)) => (has_wanted, all_verified, None),
                    Err(error) => (true, false, Some(bounded_error(&error.to_string()))),
                }
            }
            _ => (true, false, None),
        };
        let quarantined = row.13.is_some() || malformed_have || evidence_error.is_some();
        let state = derive_torrent_state(DerivedStateInput {
            metadata_available: row.2.is_some(),
            root_available: true,
            desired_running: row.10 == "running",
            has_wanted_pieces,
            verification,
            all_wanted_verified,
            quarantined,
        });
        let storage_state = if quarantined {
            StorageState::NeedsRepair
        } else {
            StorageState::Available
        };
        let verified_piece_count = if verification.is_pending()
            || matches!(
                state,
                TorrentState::AwaitingStorage | TorrentState::NeedsRepair
            ) {
            0
        } else {
            have.as_ref().map_or(0, HaveState::verified_count)
        };
        let (
            file_catalog_id,
            selectable_file_count,
            selected_file_count,
            selectable_file_bytes,
            selected_file_bytes,
        ) = if row.16 {
            match (&row.2, &row.5) {
                (Some(raw_info), Some(fingerprint)) => {
                    let content =
                        parse_durable_content_descriptor(raw_info, metainfo_source.as_deref())?;
                    let mut selectable_count = 0_u32;
                    let mut selected_count = 0_u32;
                    let mut selectable_bytes = 0_u64;
                    let mut selected_bytes = 0_u64;
                    for (index, file) in content.layout.files().iter().enumerate() {
                        if file.padding {
                            continue;
                        }
                        selectable_count = selectable_count.checked_add(1).ok_or_else(|| {
                            StoreError::DurableState("file count overflow".to_owned())
                        })?;
                        selectable_bytes =
                            selectable_bytes.checked_add(file.length).ok_or_else(|| {
                                StoreError::DurableState("file byte total overflow".to_owned())
                            })?;
                        let index = u32::try_from(index).map_err(|_| {
                            StoreError::DurableState("file index overflow".to_owned())
                        })?;
                        let selected = selection_exceptions.binary_search(&index).is_err()
                            == (selection_default == FilePriority::Normal);
                        if selected {
                            selected_count += 1;
                            selected_bytes =
                                selected_bytes.checked_add(file.length).ok_or_else(|| {
                                    StoreError::DurableState(
                                        "selected byte total overflow".to_owned(),
                                    )
                                })?;
                        }
                    }
                    (
                        Some(encode_hex(fingerprint)),
                        selectable_count,
                        selected_count,
                        selectable_bytes.to_string(),
                        selected_bytes.to_string(),
                    )
                }
                _ => (None, 0, 0, "0".to_owned(), "0".to_owned()),
            }
        } else {
            (None, 0, 0, "0".to_owned(), "0".to_owned())
        };
        torrents.push(TorrentSnapshot {
            torrent_id: torrent_id.to_string(),
            protocol_identities,
            storage_root: row.1,
            state,
            storage_state,
            metadata_available: row.2.is_some(),
            awaiting_file_selection: row.16,
            pending_file_selection_position: pending_ordinals.get(&torrent_id).copied(),
            file_catalog_id,
            selectable_file_count,
            selected_file_count,
            selectable_file_bytes,
            selected_file_bytes,
            piece_count: u32::try_from(piece_count)
                .map_err(|_| StoreError::DurableState("piece count overflow".to_owned()))?,
            verified_piece_count: u32::try_from(verified_piece_count)
                .map_err(|_| StoreError::DurableState("verified count overflow".to_owned()))?,
            desired_running: row.10 == "running",
            download_queue_position: queue_ordinals.get(&torrent_id).copied(),
            transfer_limits: TorrentTransferLimits {
                upload: TransferRateLimit::from_persisted(row.14).map_err(|error| {
                    StoreError::DurableState(format!("invalid torrent upload rate: {error}"))
                })?,
                download: TransferRateLimit::from_persisted(row.15).map_err(|error| {
                    StoreError::DurableState(format!("invalid torrent download rate: {error}"))
                })?,
            },
            seed_stop_limits: read_seed_stop_limits(row.17, row.18)?,
            seed_limit_stopped: row.19,
            skip_files: if selection_default == FilePriority::Normal {
                selection_exceptions.clone()
            } else {
                Vec::new()
            },
            high_priority_files,
            selection_default,
            selection_exceptions,
            archived: row.7,
            removal_state: match row.8.as_deref() {
                Some(value) => {
                    Some(RemovalState::parse(value).ok_or_else(|| {
                        StoreError::DurableState("invalid removal state".to_owned())
                    })?)
                }
                None => None,
            },
            delete_data_supported: true,
            force_recheck_available: row.2.is_some() && row.8.is_none() && row.13.is_none(),
            error: row.9.or(row.13).or(evidence_error).or(row.6),
        });
    }
    Ok(ServiceSnapshot {
        profile_id: profile_id.to_owned(),
        revision: revision.to_string(),
        storage: read_storage_settings(connection)?,
        client_settings: read_client_settings(connection)?,
        torrents,
    })
}

fn read_pending_file_selection_ordinals(
    connection: &Connection,
) -> Result<std::collections::BTreeMap<TorrentId, u32>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT torrent_id FROM torrents
         WHERE awaiting_file_selection = 1
         ORDER BY created_revision, torrent_id",
    )?;
    let rows = statement.query_map([], |row| row.get::<_, Vec<u8>>(0))?;
    let mut ordinals = std::collections::BTreeMap::new();
    for (index, row) in rows.enumerate() {
        let torrent_id = decode_stored_torrent_id(row?)?;
        let ordinal = u32::try_from(index + 1)
            .map_err(|_| StoreError::DurableState("pending add queue is too large".to_owned()))?;
        ordinals.insert(torrent_id, ordinal);
    }
    Ok(ordinals)
}

fn read_download_queue_ordinals(
    connection: &Connection,
) -> Result<std::collections::BTreeMap<TorrentId, u32>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT torrent_id FROM torrents
         WHERE download_queue_position IS NOT NULL
         ORDER BY download_queue_position, torrent_id",
    )?;
    let rows = statement.query_map([], |row| row.get::<_, Vec<u8>>(0))?;
    let mut ordinals = std::collections::BTreeMap::new();
    for (index, row) in rows.enumerate() {
        let torrent_id = decode_stored_torrent_id(row?)?;
        let ordinal = u32::try_from(index + 1)
            .map_err(|_| StoreError::DurableState("download queue is too large".to_owned()))?;
        ordinals.insert(torrent_id, ordinal);
    }
    Ok(ordinals)
}

struct RemovalRow {
    operation_id: String,
    storage_root: String,
    data_policy: String,
    state: String,
    raw_info: Option<Vec<u8>>,
    error: Option<String>,
}

fn removal_record(torrent_id: &str, row: RemovalRow) -> Result<RemovalRecord, StoreError> {
    let policy = RemovalDataPolicy::parse(&row.data_policy)
        .ok_or_else(|| StoreError::DurableState("invalid removal data policy".to_owned()))?;
    let state = RemovalState::parse(&row.state)
        .ok_or_else(|| StoreError::DurableState("invalid removal state".to_owned()))?;
    Ok(RemovalRecord {
        torrent_id: torrent_id.to_string(),
        operation_id: row.operation_id,
        storage_root: row.storage_root,
        policy,
        state,
        raw_info: row.raw_info,
        error: row.error,
    })
}

fn read_selection(connection: &Connection, torrent_id: &TorrentId) -> Result<Vec<u32>, StoreError> {
    let (default, exceptions) = read_selection_state(connection, torrent_id)?;
    if default == FilePriority::Normal {
        return Ok(exceptions);
    }
    let raw_info: Option<Vec<u8>> = connection.query_row(
        "SELECT raw_info FROM torrents WHERE torrent_id = ?1",
        [torrent_id.as_bytes()],
        |row| row.get(0),
    )?;
    let Some(raw_info) = raw_info else {
        return Ok(Vec::new());
    };
    let metainfo_source = read_verbatim_metainfo_source(connection, torrent_id)?;
    let content = parse_durable_content_descriptor(&raw_info, metainfo_source.as_deref())?;
    let mut skipped = Vec::new();
    for (index, file) in content.layout.files().iter().enumerate() {
        let index = u32::try_from(index)
            .map_err(|_| StoreError::DurableState("file index overflow".to_owned()))?;
        if !file.padding && exceptions.binary_search(&index).is_err() {
            skipped.push(index);
        }
    }
    Ok(skipped)
}

fn read_high_priority_files(
    connection: &Connection,
    torrent_id: &TorrentId,
) -> Result<Vec<u32>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT file_index, priority FROM file_priorities
         WHERE torrent_id = ?1 ORDER BY file_index",
    )?;
    let rows = statement.query_map([torrent_id.as_bytes()], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut priorities = Vec::new();
    for row in rows {
        let (index, priority) = row?;
        if priority != "high" {
            return Err(StoreError::DurableState(
                "invalid persisted file priority".to_owned(),
            ));
        }
        if !(0..i64::try_from(DURABLE_METAINFO_LIMITS.max_files).expect("file bound fits i64"))
            .contains(&index)
        {
            return Err(StoreError::DurableState(
                "invalid file priority index".to_owned(),
            ));
        }
        priorities.push(
            u32::try_from(index)
                .map_err(|_| StoreError::DurableState("priority index overflow".to_owned()))?,
        );
    }
    if priorities.len() > MAX_FILE_SELECTION_ENTRIES {
        return Err(StoreError::DurableState(
            "file priority count exceeds the supported bound".to_owned(),
        ));
    }
    Ok(priorities)
}

fn read_selection_state(
    connection: &Connection,
    torrent_id: &TorrentId,
) -> Result<(FilePriority, Vec<u32>), StoreError> {
    let default: String = connection.query_row(
        "SELECT selection_default FROM torrents WHERE torrent_id = ?1",
        [torrent_id.as_bytes()],
        |row| row.get(0),
    )?;
    let (default, expected_wanted) = match default.as_str() {
        "wanted" => (FilePriority::Normal, false),
        "skipped" => (FilePriority::Skip, true),
        _ => {
            return Err(StoreError::DurableState(
                "invalid selection default".to_owned(),
            ));
        }
    };
    let mut statement = connection.prepare(
        "SELECT file_index, wanted FROM file_selection
         WHERE torrent_id = ?1 ORDER BY file_index",
    )?;
    let rows = statement.query_map([torrent_id.as_bytes()], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, bool>(1)?))
    })?;
    let mut selection = Vec::new();
    for row in rows {
        let (index, wanted) = row?;
        if wanted != expected_wanted {
            return Err(StoreError::DurableState(
                "selection exception matches its default".to_owned(),
            ));
        }
        if !(0..i64::try_from(DURABLE_METAINFO_LIMITS.max_files).expect("file bound fits i64"))
            .contains(&index)
        {
            return Err(StoreError::DurableState(
                "invalid file selection index".to_owned(),
            ));
        }
        selection.push(
            u32::try_from(index)
                .map_err(|_| StoreError::DurableState("selection index overflow".to_owned()))?,
        );
    }
    Ok((default, selection))
}

fn read_trackers(
    connection: &Connection,
    torrent_id: &TorrentId,
) -> Result<Vec<StoredTracker>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT tier, position, url, transport, source
         FROM torrent_trackers
         WHERE torrent_id = ?1
         ORDER BY tier, position",
    )?;
    let rows = statement.query_map([torrent_id.as_bytes()], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;
    let mut trackers = Vec::new();
    for row in rows {
        let (tier, position, url, transport, source) = row?;
        let tier = u32::try_from(tier)
            .map_err(|_| StoreError::DurableState("tracker tier overflow".to_owned()))?;
        let position = u32::try_from(position)
            .map_err(|_| StoreError::DurableState("tracker position overflow".to_owned()))?;
        let transport = match transport.as_str() {
            "udp" => StoredTrackerTransport::Udp,
            "http" => StoredTrackerTransport::Http,
            "https" => StoredTrackerTransport::Https,
            _ => {
                return Err(StoreError::DurableState(
                    "invalid tracker transport".to_owned(),
                ));
            }
        };
        let source = match source.as_str() {
            "magnet" => StoredTrackerSource::Magnet,
            "metainfo" => StoredTrackerSource::Metainfo,
            _ => {
                return Err(StoreError::DurableState(
                    "invalid tracker source".to_owned(),
                ));
            }
        };
        trackers.push(StoredTracker {
            tier,
            position,
            url,
            transport,
            source,
        });
    }
    Ok(trackers)
}

fn read_revision(connection: &Connection) -> Result<u64, StoreError> {
    let revision: i64 = connection.query_row(
        "SELECT revision FROM profile_state WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    u64::try_from(revision)
        .map_err(|_| StoreError::DurableState("negative profile revision".to_owned()))
}

fn replay_or_conflict(
    connection: &Connection,
    request_id: &str,
    request_json: &str,
) -> Result<Option<ResponseEnvelope>, StoreError> {
    let Some((stored_request, stored_response)) = connection
        .query_row(
            "SELECT request_json, response_json
             FROM request_receipts WHERE request_id = ?1",
            [request_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
    else {
        return Ok(None);
    };
    if stored_request == request_json {
        return Ok(Some(serde_json::from_str(&stored_response)?));
    }
    Ok(Some(ResponseEnvelope::error(
        request_id.to_owned(),
        read_revision(connection)?,
        ErrorCode::RequestConflict,
        "request ID was already used for a different envelope",
    )))
}

fn insert_receipt(
    transaction: &Transaction<'_>,
    request_id: &str,
    request_json: &str,
    response: &ResponseEnvelope,
) -> Result<(), StoreError> {
    let response_json = serde_json::to_string(response)?;
    let response_revision = sql_revision(
        response
            .revision
            .parse()
            .map_err(|_| StoreError::DurableState("invalid response revision".to_owned()))?,
    )?;
    transaction.execute(
        "INSERT INTO request_receipts(
            request_id, request_json, response_json, revision
         ) VALUES (?1, ?2, ?3, ?4)",
        params![request_id, request_json, response_json, response_revision],
    )?;
    transaction.execute(
        "DELETE FROM request_receipts
         WHERE receipt_order <= (
            SELECT COALESCE(MAX(receipt_order), 0) - ?1
            FROM request_receipts
         )",
        [MAX_RECEIPTS],
    )?;
    Ok(())
}

fn increment_revision(transaction: &Transaction<'_>) -> Result<u64, StoreError> {
    let current = read_revision(transaction)?;
    let revision = current
        .checked_add(1)
        .ok_or_else(|| StoreError::DurableState("profile revision overflow".to_owned()))?;
    let revision_sql = sql_revision(revision)?;
    transaction.execute(
        "UPDATE profile_state SET revision = ?1 WHERE singleton = 1",
        [revision_sql],
    )?;
    Ok(revision)
}

fn sql_revision(revision: u64) -> Result<i64, StoreError> {
    i64::try_from(revision)
        .map_err(|_| StoreError::DurableState("profile revision exceeds SQLite i64".to_owned()))
}

fn read_have_columns(
    connection: &Connection,
    torrent_id: &TorrentId,
) -> Result<(usize, ContentFingerprint, Vec<u8>), StoreError> {
    let row = connection
        .query_row(
            "SELECT piece_count, content_fingerprint, have_state
             FROM torrents WHERE torrent_id = ?1",
            [torrent_id.as_bytes()],
            |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?,
                    row.get::<_, Option<Vec<u8>>>(1)?,
                    row.get::<_, Option<Vec<u8>>>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| StoreError::UnknownTorrent(torrent_id.to_string()))?;
    match row {
        (Some(piece_count), Some(fingerprint), Some(bytes)) => {
            validate_have_state_length(&bytes)?;
            let fingerprint: [u8; 32] = fingerprint.try_into().map_err(|_| {
                StoreError::DurableState("invalid content fingerprint length".to_owned())
            })?;
            Ok((
                bounded_piece_count(piece_count)?,
                ContentFingerprint::from_digest(fingerprint),
                bytes,
            ))
        }
        _ => Err(StoreError::DurableState(
            "torrent has no verified metadata and have state".to_owned(),
        )),
    }
}

fn bounded_piece_count(piece_count: i64) -> Result<usize, StoreError> {
    let piece_count = usize::try_from(piece_count)
        .map_err(|_| StoreError::DurableState("negative piece count".to_owned()))?;
    if piece_count == 0 || piece_count > MAX_DURABLE_PIECES {
        return Err(StoreError::ResourceLimit {
            resource: "piece count",
            actual: piece_count,
            maximum: MAX_DURABLE_PIECES,
        });
    }
    Ok(piece_count)
}

fn validate_raw_info_length(raw_info: &[u8]) -> Result<(), StoreError> {
    if raw_info.len() > DURABLE_METAINFO_LIMITS.max_info_bytes {
        return Err(StoreError::ResourceLimit {
            resource: "raw_info bytes",
            actual: raw_info.len(),
            maximum: DURABLE_METAINFO_LIMITS.max_info_bytes,
        });
    }
    Ok(())
}

#[derive(Clone, Debug)]
struct AuthenticatedOwner {
    torrent_id: TorrentId,
    created_revision: u64,
    provisional: bool,
    magnet: Option<String>,
}

fn authenticated_owners(
    connection: &Connection,
    hashes: InfoHashes,
) -> Result<Vec<AuthenticatedOwner>, StoreError> {
    let mut identities = Vec::with_capacity(hashes.identity_count());
    hashes.for_each(|identity| identities.push(identity));
    let mut owners = Vec::with_capacity(identities.len());
    for identity in identities {
        let Some(torrent_id) = find_torrent_id_by_full_hash(connection, identity)? else {
            continue;
        };
        if owners
            .iter()
            .any(|owner: &AuthenticatedOwner| owner.torrent_id == torrent_id)
        {
            continue;
        }
        let row = connection.query_row(
            "SELECT created_revision,
                    raw_info IS NULL AND
                    verification_requested = 0 AND quarantine_reason IS NULL AND
                    archived = 0 AND
                    NOT EXISTS(SELECT 1 FROM removal_jobs r
                               WHERE r.torrent_id = torrents.torrent_id),
                    magnet
             FROM torrents WHERE torrent_id = ?1",
            [torrent_id.as_bytes().as_slice()],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, bool>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )?;
        owners.push(AuthenticatedOwner {
            torrent_id,
            created_revision: u64::try_from(row.0).map_err(|_| {
                StoreError::DurableState("negative owner creation revision".to_owned())
            })?,
            provisional: row.1,
            magnet: row.2,
        });
    }
    owners.sort_by(|left, right| {
        (left.created_revision, left.torrent_id.as_bytes())
            .cmp(&(right.created_revision, right.torrent_id.as_bytes()))
    });
    Ok(owners)
}

fn combined_reconciliation_magnet(
    owners: &[AuthenticatedOwner],
    hashes: InfoHashes,
) -> Result<Option<Magnet>, StoreError> {
    let mut combined: Option<Magnet> = None;
    for owner in owners {
        let Some(source) = owner.magnet.as_deref() else {
            continue;
        };
        let parsed =
            Magnet::parse(source).map_err(|error| StoreError::DurableState(error.to_string()))?;
        if let Some(target) = combined.as_mut() {
            for hint in parsed.peer_hints {
                if target.peer_hints.len() == MAX_PEER_HINTS {
                    break;
                }
                if !target.peer_hints.contains(&hint) {
                    target.peer_hints.push(hint);
                }
            }
            for tracker in parsed.trackers {
                if target.trackers.len() == MAX_TRACKERS {
                    break;
                }
                if !target
                    .trackers
                    .iter()
                    .any(|existing| existing.url() == tracker.url())
                {
                    target.trackers.push(tracker);
                }
            }
        } else {
            combined = Some(parsed);
        }
    }
    if let Some(combined) = combined.as_mut() {
        combined.identities = hashes;
        combined.identity = if let Some(hash) = hashes.v1_hash() {
            FullInfoHash::V1(hash)
        } else {
            FullInfoHash::V2(
                hashes
                    .v2_hash()
                    .expect("nonempty identity set has one protocol"),
            )
        };
    }
    Ok(combined)
}

fn replace_reconciled_discovery(
    transaction: &Transaction<'_>,
    winner: &TorrentId,
    magnet: &Magnet,
) -> Result<(), StoreError> {
    transaction.execute(
        "DELETE FROM torrent_trackers WHERE torrent_id = ?1",
        [winner.as_bytes().as_slice()],
    )?;
    transaction.execute(
        "DELETE FROM torrent_peer_hints WHERE torrent_id = ?1",
        [winner.as_bytes().as_slice()],
    )?;
    for (position, tracker) in magnet.trackers.iter().enumerate() {
        transaction.execute(
            "INSERT INTO torrent_trackers(
                torrent_id, tier, position, url, transport, source
             ) VALUES (?1, 0, ?2, ?3, ?4, 'magnet')",
            params![
                winner.as_bytes().as_slice(),
                i64::try_from(position)
                    .map_err(|_| StoreError::DurableState("tracker index overflow".to_owned()))?,
                tracker.url(),
                tracker_transport_name(tracker.transport()),
            ],
        )?;
    }
    for (position, hint) in magnet.peer_hints.iter().enumerate() {
        transaction.execute(
            "INSERT INTO torrent_peer_hints(torrent_id, position, host, port, source)
             VALUES (?1, ?2, ?3, ?4, 'magnet')",
            params![
                winner.as_bytes().as_slice(),
                i64::try_from(position).map_err(|_| {
                    StoreError::DurableState("peer hint index overflow".to_owned())
                })?,
                hint.host,
                i64::from(hint.port),
            ],
        )?;
    }
    Ok(())
}

fn validate_have_state_length(bytes: &[u8]) -> Result<(), StoreError> {
    if bytes.len() > MAX_DURABLE_HAVE_STATE_BYTES {
        return Err(StoreError::ResourceLimit {
            resource: "have-state bytes",
            actual: bytes.len(),
            maximum: MAX_DURABLE_HAVE_STATE_BYTES,
        });
    }
    Ok(())
}

fn encode_digest(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(HEX[(byte >> 4) as usize]));
        encoded.push(char::from(HEX[(byte & 0x0f) as usize]));
    }
    encoded
}

fn metainfo_intake_error(error: MetainfoError) -> (ErrorCode, String) {
    let resource_limited = matches!(
        error,
        MetainfoError::InfoTooLarge { .. }
            | MetainfoError::TooManyFiles { .. }
            | MetainfoError::TooManyPieces { .. }
            | MetainfoError::Bencode(
                ParseError::InputTooLarge { .. }
                    | ParseError::StringTooLarge { .. }
                    | ParseError::NestingTooDeep { .. }
                    | ParseError::CollectionTooLarge { .. }
                    | ParseError::TooManyDecodedItems { .. }
            )
    );
    (
        if resource_limited {
            ErrorCode::ResourceLimit
        } else {
            ErrorCode::InvalidRequest
        },
        error.to_string(),
    )
}

fn map_durable_metainfo_error(error: MetainfoError) -> StoreError {
    match error {
        MetainfoError::InfoTooLarge { length, maximum } => StoreError::ResourceLimit {
            resource: "raw_info bytes",
            actual: length,
            maximum,
        },
        MetainfoError::TooManyPieces { actual, maximum } => StoreError::ResourceLimit {
            resource: "piece count",
            actual,
            maximum,
        },
        error => StoreError::DurableState(error.to_string()),
    }
}

struct DurableContentDescriptor {
    info_hashes: InfoHashes,
    layout: ContentLayout,
}

fn durable_content_name(raw_info: &[u8]) -> Result<String, StoreError> {
    validate_raw_info_length(raw_info)?;
    let parsed = ParsedInfo::from_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
        .map_err(map_durable_metainfo_error)?;
    Ok(match parsed.kind() {
        ParsedInfoKind::V1(metainfo) => metainfo.name.clone(),
        ParsedInfoKind::V2(metainfo) => metainfo.name.clone(),
        ParsedInfoKind::Hybrid(metainfo) => metainfo.v2.name.clone(),
    })
}

fn parse_durable_content_descriptor(
    raw_info: &[u8],
    metainfo_source: Option<&[u8]>,
) -> Result<DurableContentDescriptor, StoreError> {
    validate_raw_info_length(raw_info)?;
    match metainfo_source {
        Some(source) => {
            let projection =
                TorrentContentProjection::from_bytes_with_limits(source, DURABLE_METAINFO_LIMITS)
                    .map_err(map_durable_metainfo_error)?;
            if &source[projection.info_span.clone()] != raw_info {
                return Err(StoreError::DurableState(
                    "retained metainfo source does not match raw_info".to_owned(),
                ));
            }
            Ok(DurableContentDescriptor {
                info_hashes: projection.content.info_hashes(),
                layout: ContentLayout::from_content(&projection.content),
            })
        }
        None => {
            let parsed = ParsedInfo::from_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
                .map_err(map_durable_metainfo_error)?;
            let layout = match parsed.kind() {
                ParsedInfoKind::V1(metainfo) => {
                    ContentLayout::from_content(&TorrentContent::from_v1_metainfo(metainfo.clone()))
                }
                ParsedInfoKind::V2(metainfo) => ContentLayout::V2 {
                    layout: metainfo.layout.clone(),
                    files: metainfo
                        .files
                        .iter()
                        .zip(metainfo.layout.files())
                        .map(
                            |(file, geometry)| rstorrent_protocol::metainfo::MetainfoFile {
                                path: file.path.clone(),
                                length: file.length,
                                offset: geometry.logical_offset(),
                                padding: false,
                            },
                        )
                        .collect(),
                },
                ParsedInfoKind::Hybrid(metainfo) => ContentLayout::Hybrid {
                    layout: metainfo.v2.layout.clone(),
                    files: metainfo
                        .v2
                        .files
                        .iter()
                        .zip(metainfo.v2.layout.files())
                        .map(
                            |(file, geometry)| rstorrent_protocol::metainfo::MetainfoFile {
                                path: file.path.clone(),
                                length: file.length,
                                offset: geometry.logical_offset(),
                                padding: false,
                            },
                        )
                        .collect(),
                },
            };
            Ok(DurableContentDescriptor {
                info_hashes: parsed.info_hashes(),
                layout,
            })
        }
    }
}

fn wanted_piece_evidence(
    raw_info: &[u8],
    metainfo_source: Option<&[u8]>,
    skip_files: &[u32],
    have: &HaveState,
) -> Result<(bool, bool), StoreError> {
    let skipped = skip_files
        .iter()
        .map(|index| {
            usize::try_from(*index)
                .map_err(|_| StoreError::DurableState("file index overflow".to_owned()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let content = parse_durable_content_descriptor(raw_info, metainfo_source)?;
    if content.layout.piece_count() != have.pieces().len() {
        return Err(StoreError::DurableState(
            "runtime content piece count does not match have state".to_owned(),
        ));
    }
    let mut has_wanted = false;
    for (piece_index, verified) in have.pieces().iter().copied().enumerate() {
        let piece_index = u32::try_from(piece_index)
            .map_err(|_| StoreError::DurableState("piece index overflow".to_owned()))?;
        let wanted = match &content.layout {
            ContentLayout::V1(layout) => {
                let selection = FileSelection::new(layout, &skipped)
                    .map_err(|error| StoreError::DurableState(error.to_string()))?;
                !layout
                    .request_ranges(piece_index, &selection)
                    .map_err(|error| StoreError::DurableState(error.to_string()))?
                    .is_empty()
            }
            ContentLayout::V2 { layout, .. } | ContentLayout::Hybrid { layout, .. } => {
                let piece = layout
                    .piece(piece_index)
                    .map_err(|error| StoreError::DurableState(error.to_string()))?;
                skipped.binary_search(&piece.file_index).is_err()
            }
        };
        if wanted {
            has_wanted = true;
            if !verified {
                return Ok((true, false));
            }
        }
    }
    Ok((has_wanted, true))
}

fn canonical_magnet(magnet: &Magnet) -> String {
    let mut output = String::from("magnet:?");
    append_magnet_identities(&mut output, magnet.identities);
    if let Some(display_name) = &magnet.display_name {
        output.push_str("&dn=");
        percent_encode_query_value(&mut output, display_name.as_bytes());
    }
    if let Some(exact_length) = magnet.exact_length {
        output.push_str("&xl=");
        output.push_str(&exact_length.to_string());
    }
    for hint in &magnet.peer_hints {
        output.push_str("&x.pe=");
        output.push_str(&hint.magnet_value());
    }
    for tracker in &magnet.trackers {
        output.push_str("&tr=");
        percent_encode_query_value(&mut output, tracker.url().as_bytes());
    }
    if let Some(selection) = &magnet.select_only {
        output.push_str("&so=");
        output.push_str(&selection.canonical());
    }
    output
}

fn synthesize_magnet_export(
    identities: impl Into<InfoHashes>,
    content_name: Option<&str>,
    trackers: &[StoredTracker],
) -> MagnetExportResult {
    let identities = identities.into();
    let mut magnet = String::from("magnet:?");
    append_magnet_identities(&mut magnet, identities);
    if let Some(content_name) = content_name {
        let mut parameter = String::from("&dn=");
        percent_encode_query_value(&mut parameter, content_name.as_bytes());
        if magnet.len() + parameter.len() <= MAX_MAGNET_LENGTH {
            magnet.push_str(&parameter);
        }
    }

    let mut included_trackers = 0_usize;
    let mut omitted_trackers = 0_usize;
    for tracker in trackers {
        if included_trackers == MAX_TRACKERS || TrackerUrl::from_magnet_url(&tracker.url).is_none()
        {
            omitted_trackers += 1;
            continue;
        }
        let mut parameter = String::from("&tr=");
        percent_encode_query_value(&mut parameter, tracker.url.as_bytes());
        if magnet.len() + parameter.len() > MAX_MAGNET_LENGTH {
            omitted_trackers += 1;
            continue;
        }
        magnet.push_str(&parameter);
        included_trackers += 1;
    }

    MagnetExportResult {
        magnet,
        source: MagnetExportSource::Synthesized,
        omitted_tracker_count: u32::try_from(omitted_trackers).unwrap_or(u32::MAX),
        peer_hints: Vec::new(),
        peer_hint_omission: None,
    }
}

/// Verified metainfo facts a share export may publish.
struct ShareContentFacts {
    total_length: u64,
    private: bool,
    /// One entry per file in the `FileView::file_index` space; true for a
    /// BEP 47 padding file.
    padding: Vec<bool>,
}

fn share_content_facts(raw_info: &[u8]) -> Result<ShareContentFacts, StoreError> {
    validate_raw_info_length(raw_info)?;
    let parsed = ParsedInfo::from_bytes_with_limits(raw_info, DURABLE_METAINFO_LIMITS)
        .map_err(map_durable_metainfo_error)?;
    Ok(match parsed.kind() {
        ParsedInfoKind::V1(metainfo) => ShareContentFacts {
            total_length: metainfo.total_length,
            private: metainfo.private,
            padding: metainfo.files.iter().map(|file| file.padding).collect(),
        },
        ParsedInfoKind::V2(metainfo) => ShareContentFacts {
            total_length: metainfo.total_length,
            private: metainfo.private,
            padding: vec![false; metainfo.files.len()],
        },
        ParsedInfoKind::Hybrid(metainfo) => ShareContentFacts {
            total_length: metainfo.v2.total_length,
            private: metainfo.v2.private,
            padding: vec![false; metainfo.v2.files.len()],
        },
    })
}

/// Apply [`MagnetExportOptions`] to a base export. Existing `xl`, `so` and
/// `x.pe` parameters are replaced, never passed through: every published
/// value comes from verified metadata or the session's own endpoints.
fn apply_share_options(
    base: MagnetExportResult,
    content: Option<&ShareContentFacts>,
    options: &MagnetExportOptions,
    share_endpoints: Option<&ShareEndpointFacts>,
) -> Result<MagnetExportResult, (ErrorCode, String)> {
    let exact_length = content
        .filter(|_| options.include_size)
        .map(|content| content.total_length)
        .filter(|length| *length > 0);
    let select_only = if options.file_indices.is_empty() {
        None
    } else {
        let content = content.ok_or_else(|| {
            (
                ErrorCode::InvalidTorrentState,
                "sharing files requires verified metadata".to_owned(),
            )
        })?;
        Some(share_select_only(&options.file_indices, &content.padding)?)
    };
    let (hints, peer_hint_omission) = if !options.peer_hint {
        (Vec::new(), None)
    } else {
        match content {
            None => (Vec::new(), Some(MagnetPeerHintOmission::MetadataPending)),
            Some(content) if content.private => {
                (Vec::new(), Some(MagnetPeerHintOmission::PrivateTorrent))
            }
            Some(_) => match select_peer_hints(share_endpoints) {
                Ok(hints) => (hints, None),
                Err(omission) => (Vec::new(), Some(omission)),
            },
        }
    };
    let magnet_hints = hints
        .iter()
        .map(|hint| PeerHint {
            host: hint.endpoint.ip().to_string(),
            port: hint.endpoint.port(),
        })
        .collect::<Vec<_>>();
    let magnet = replace_share_parameters(
        &base.magnet,
        MagnetShareParameters {
            exact_length,
            select_only: select_only.as_ref(),
            peer_hints: &magnet_hints,
        },
    );
    if magnet.len() > MAX_MAGNET_LENGTH {
        return Err((
            ErrorCode::ResourceLimit,
            format!("shared magnet exceeds {MAX_MAGNET_LENGTH} bytes"),
        ));
    }
    Ok(MagnetExportResult {
        magnet,
        source: base.source,
        omitted_tracker_count: base.omitted_tracker_count,
        peer_hints: hints
            .into_iter()
            .zip(&magnet_hints)
            .map(|(hint, magnet_hint)| MagnetPeerHint {
                endpoint: magnet_hint.magnet_value(),
                scope: hint.scope,
            })
            .collect(),
        peer_hint_omission,
    })
}

/// Encode sorted, unique file indices as BEP 53 ranges after checking each
/// against the verified file list. A gap made only of padding files joins
/// its neighbours, since no client downloads a padding file.
fn share_select_only(
    file_indices: &[u32],
    padding: &[bool],
) -> Result<SelectOnly, (ErrorCode, String)> {
    let mut ranges: Vec<MagnetFileIndexRange> = Vec::new();
    for &index in file_indices {
        match usize::try_from(index)
            .ok()
            .and_then(|position| padding.get(position))
        {
            None => {
                return Err((
                    ErrorCode::InvalidRequest,
                    format!("file index {index} is outside the torrent file list"),
                ));
            }
            Some(true) => {
                return Err((
                    ErrorCode::InvalidRequest,
                    format!("file index {index} is a padding file"),
                ));
            }
            Some(false) => {}
        }
        if let Some(last) = ranges.last_mut()
            && index > last.end
            && padding[last.end as usize + 1..index as usize]
                .iter()
                .all(|padding| *padding)
        {
            last.end = index;
        } else {
            ranges.push(MagnetFileIndexRange {
                start: index,
                end: index,
            });
        }
    }
    SelectOnly::from_ranges(ranges).ok_or_else(|| {
        (
            ErrorCode::InvalidRequest,
            "shared file selection cannot be encoded".to_owned(),
        )
    })
}

fn append_magnet_identities(output: &mut String, identities: InfoHashes) {
    let mut first = true;
    identities.for_each(|identity| {
        if !first {
            output.push('&');
        }
        first = false;
        output.push_str("xt=");
        output.push_str(&encode_magnet_identity(identity));
    });
}

fn encode_magnet_identity(identity: FullInfoHash) -> String {
    match identity {
        FullInfoHash::V1(hash) => format!("urn:btih:{}", encode_info_hash(hash.into_bytes())),
        FullInfoHash::V2(hash) => format!("urn:btmh:1220{}", encode_hex(hash.as_bytes())),
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
}

fn tracker_transport_name(transport: TrackerUrlTransport) -> &'static str {
    match transport {
        TrackerUrlTransport::Udp => "udp",
        TrackerUrlTransport::Http => "http",
        TrackerUrlTransport::Https => "https",
    }
}

fn percent_encode_query_value(output: &mut String, value: &[u8]) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    for byte in value {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            output.push(char::from(*byte));
        } else {
            output.push('%');
            output.push(char::from(HEX[usize::from(byte >> 4)]));
            output.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
    }
}

fn bounded_error(message: &str) -> String {
    if message.len() <= crate::control::MAX_ERROR_MESSAGE_LENGTH {
        return message.to_owned();
    }
    let mut boundary = crate::control::MAX_ERROR_MESSAGE_LENGTH;
    while !message.is_char_boundary(boundary) {
        boundary -= 1;
    }
    message[..boundary].to_owned()
}

fn internal_error(error: rusqlite::Error) -> (ErrorCode, String) {
    (ErrorCode::Internal, error.to_string())
}

fn internal_message(message: &str) -> (ErrorCode, String) {
    (ErrorCode::Internal, message.to_owned())
}

#[cfg(test)]
impl SessionStore {
    pub(crate) fn connection(&self) -> &Connection {
        &self.connection
    }
}

#[cfg(test)]
pub(crate) fn create_baseline_for_test(transaction: &Transaction<'_>) {
    create_schema_26(transaction, "default", &ClientSettings::default())
        .expect("create baseline catalog");
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddrV4};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use rstorrent_engine::dht::{DHT_SNAPSHOT_VERSION, DhtIdentity, DhtSnapshot};
    use rstorrent_protocol::dht::{DhtEndpoint, DhtIp, NodeContact, NodeId};
    use rstorrent_protocol::identity::V2InfoHash;
    use rstorrent_protocol::magnet::{MAX_MAGNET_LENGTH, MAX_TRACKERS, Magnet};
    use rstorrent_protocol::merkle::file_root_from_data;
    use rstorrent_protocol::metainfo::{EXPLICIT_IMPORT_METAINFO_LIMITS, Metainfo, MetainfoFile};
    use rusqlite::{Connection, params};
    use sha1::{Digest, Sha1};
    use sha2::Sha256;

    use super::{
        ConfiguredStorageRoot, MAX_ACCOUNTING_BATCH, MAX_FILE_SELECTION_ENTRIES,
        MAX_PENDING_PRODUCT_MILESTONES, PendingReconciliation, SCHEMA_VERSION, SessionStore,
        StoreError, StoredTracker, StoredTrackerSource, StoredTrackerTransport, TorrentAccounting,
        TorrentAccountingUpdate, append_product_milestone, synthesize_magnet_export,
    };
    use crate::ClientSettings;
    use crate::have::{HaveState, MAX_DURABLE_HAVE_STATE_BYTES, MAX_DURABLE_PIECES};
    use crate::share_peer_hints::ShareEndpointFacts;
    use crate::{
        ActiveSeedLimit, AddTorrentBytesRequest, CONTROL_VERSION, Command, EncryptionPolicy,
        ErrorCode, FileIndexRange, FilePriority, FileSelectionIntent,
        HttpsServerAuthenticationPolicy, ListenerPolicy, MagnetExportSource, PortMappingPolicy,
        ProductMilestoneKind, RemovalDataPolicy, RemovalState, RequestEnvelope, ResponseOutcome,
        StorageState, TorrentState, TorrentTransferLimits, TransferRateLimit,
    };
    use crate::{MagnetExportOptions, MagnetPeerHint, MagnetPeerHintOmission, MagnetPeerHintScope};

    static NEXT_TEST: AtomicU64 = AtomicU64::new(0);

    fn added_torrent_id(response: &crate::ResponseEnvelope) -> String {
        match response.result.as_ref().expect("add result") {
            crate::CommandResult::AddTorrent { result } => result.torrent_id.clone(),
            crate::CommandResult::ExportMagnet { .. } => panic!("unexpected magnet export"),
        }
    }

    fn hybrid_raw_info() -> Vec<u8> {
        fn bstr(output: &mut Vec<u8>, value: &[u8]) {
            output.extend_from_slice(value.len().to_string().as_bytes());
            output.push(b':');
            output.extend_from_slice(value);
        }
        let roots = [
            file_root_from_data(&[1]).expect("first root"),
            file_root_from_data(&[2]).expect("second root"),
        ];
        let mut tree = vec![b'd'];
        for (name, root) in [(b'a', roots[0]), (b'b', roots[1])] {
            bstr(&mut tree, &[name]);
            tree.extend_from_slice(b"d0:d6:lengthi1e11:pieces root32:");
            tree.extend_from_slice(&root);
            tree.extend_from_slice(b"ee");
        }
        tree.push(b'e');
        let mut info = b"d9:file tree".to_vec();
        info.extend_from_slice(&tree);
        info.extend_from_slice(
            concat!(
                "5:filesl",
                "d6:lengthi1e4:pathl1:aee",
                "d4:attr1:p6:lengthi16383ee",
                "d6:lengthi1e4:pathl1:bee",
                "e12:meta versioni2e4:name4:root12:piece lengthi16384e",
                "6:pieces40:"
            )
            .as_bytes(),
        );
        info.extend_from_slice(&[7; 40]);
        info.push(b'e');
        info
    }

    fn only_torrent_id(store: &SessionStore) -> String {
        let snapshot = store.snapshot().expect("snapshot for sole torrent ID");
        assert_eq!(snapshot.torrents.len(), 1, "fixture must have one torrent");
        snapshot.torrents[0].torrent_id.clone()
    }

    #[test]
    fn compact_torrent_selection_projects_nonpadding_files() {
        let files = (0..4)
            .map(|index| MetainfoFile {
                path: vec![index.to_string()],
                length: 1,
                offset: index,
                padding: index == 1,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            super::project_file_selection(&FileSelectionIntent::None, &files)
                .expect("select no payload files"),
            (FilePriority::Skip, Vec::new())
        );
        assert_eq!(
            super::project_file_selection(
                &FileSelectionIntent::WantedRanges {
                    ranges: vec![FileIndexRange {
                        start: 2,
                        end_exclusive: 4,
                    }],
                },
                &files,
            )
            .expect("select a compact wanted range"),
            (FilePriority::Skip, vec![2, 3])
        );
        assert!(
            super::project_file_selection(
                &FileSelectionIntent::WantedRanges {
                    ranges: vec![FileIndexRange {
                        start: 2,
                        end_exclusive: 5,
                    }],
                },
                &files,
            )
            .is_err()
        );
    }

    #[test]
    fn canonical_magnet_preserves_supported_discovery_sources() {
        let parsed = rstorrent_protocol::magnet::Magnet::parse(
            "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213\
             &dn=Source+display+name\
             &x.pe=[::1]:6881\
             &tr=UDP%3A%2F%2FTRACKER.EXAMPLE%3A6969%2Fannounce\
             &tr=udp%3A%2F%2F%5B2001%3Adb8%3A%3A1%5D%3A80\
             &tr=https%3A%2F%2Ftracker.example%2Fsecret%3Fpasskey%3Dabc%26x%3D1",
        )
        .expect("parse magnet");

        assert_eq!(
            super::canonical_magnet(&parsed),
            "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213\
             &dn=Source%20display%20name\
             &x.pe=[::1]:6881\
             &tr=UDP%3A%2F%2FTRACKER.EXAMPLE%3A6969%2Fannounce\
             &tr=udp%3A%2F%2F%5B2001%3Adb8%3A%3A1%5D%3A80\
             &tr=https%3A%2F%2Ftracker.example%2Fsecret%3Fpasskey%3Dabc%26x%3D1"
        );

        let dual = rstorrent_protocol::magnet::Magnet::parse(&format!(
            "magnet:?xt=urn:btmh:1220{}&xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213",
            "aa".repeat(32)
        ))
        .expect("dual-topic magnet");
        assert_eq!(
            super::canonical_magnet(&dual),
            format!(
                "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213&xt=urn:btmh:1220{}",
                "aa".repeat(32)
            )
        );
    }

    #[test]
    fn dual_topic_magnet_reserves_both_full_aliases_for_one_owner() {
        let root = test_root("dual-topic-aliases");
        let configured = configured_root(&root);
        let source = format!(
            "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213&xt=urn:btmh:1220{}",
            "aa".repeat(32)
        );
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open");
        let added = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-dual-topic".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: source.clone(),
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add dual-topic magnet");
        let torrent_id = added_torrent_id(&added);
        let owner = super::decode_torrent_id(&torrent_id).expect("owner id");
        let hashes = super::read_info_hashes(&store.connection, &owner).expect("aliases");
        assert!(hashes.is_hybrid());
        assert_eq!(hashes.v2_hash(), Some(V2InfoHash::new([0xaa; 32])));
        let (export, _) = store
            .export_base_magnet(&torrent_id)
            .expect("hybrid export");
        assert_eq!(export.magnet, source);
    }

    #[test]
    fn hybrid_metadata_reconciles_provisional_aliases_into_first_owner() {
        let root = test_root("hybrid-reconciliation");
        let configured = configured_root(&root);
        let raw_info = hybrid_raw_info();
        let v1 = super::encode_hex(&Sha1::digest(&raw_info));
        let v2 = super::encode_hex(&Sha256::digest(&raw_info));
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open");
        let mut add = |request_id: &str, magnet: String| {
            let response = store
                .handle_durable(&RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: request_id.to_owned(),
                    expected_revision: None,
                    command: Command::AddMagnet {
                        magnet,
                        storage_root: "downloads".to_owned(),
                        start_content: true,
                        await_file_selection: false,
                        skip_files: Vec::new(),
                    },
                })
                .expect("add provisional magnet");
            added_torrent_id(&response)
        };
        let first = add(
            "add-v1-provisional",
            format!(
                "magnet:?xt=urn:btih:{v1}&x.pe=127.0.0.1:6001&tr=http%3A%2F%2Fone.example%2Fannounce&so=0"
            ),
        );
        let second = add(
            "add-v2-provisional",
            format!(
                "magnet:?xt=urn:btmh:1220{v2}&x.pe=127.0.0.1:6002&tr=http%3A%2F%2Ftwo.example%2Fannounce&so=1"
            ),
        );
        let error = store
            .record_metadata(&second, &raw_info)
            .expect_err("later owner stops after committing reconciliation");
        assert!(matches!(
            error,
            StoreError::Reconciled {
                ref winner,
                ref loser,
            } if winner == &first && loser == &second
        ));
        let snapshot = store.snapshot().expect("reconciled snapshot");
        assert_eq!(snapshot.torrents.len(), 1);
        assert_eq!(snapshot.torrents[0].torrent_id, first);
        let winner = super::decode_torrent_id(&first).expect("winner id");
        assert!(
            super::read_info_hashes(&store.connection, &winner)
                .expect("winner aliases")
                .is_hybrid()
        );
        let resume = store.load_resume(&first).expect("winner resume");
        assert_eq!(resume.raw_info.as_deref(), Some(raw_info.as_slice()));
        assert_eq!(resume.skip_files, vec![1]);
        let tracker_count: i64 = store
            .connection
            .query_row(
                "SELECT COUNT(*) FROM torrent_trackers WHERE torrent_id = ?1",
                [winner.as_bytes().as_slice()],
                |row| row.get(0),
            )
            .unwrap();
        let hint_count: i64 = store
            .connection
            .query_row(
                "SELECT COUNT(*) FROM torrent_peer_hints WHERE torrent_id = ?1",
                [winner.as_bytes().as_slice()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((tracker_count, hint_count), (2, 2));
        assert_eq!(
            store.take_pending_reconciliations(),
            [PendingReconciliation {
                winner: first,
                loser: second,
            }]
        );
    }

    #[test]
    fn first_provisional_owner_can_complete_hybrid_reconciliation() {
        let root = test_root("hybrid-reconciliation-first-completes");
        let configured = configured_root(&root);
        let raw_info = hybrid_raw_info();
        let v1 = super::encode_hex(&Sha1::digest(&raw_info));
        let v2 = super::encode_hex(&Sha256::digest(&raw_info));
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open");
        let mut add = |request_id: &str, magnet: String| {
            let response = store
                .handle_durable(&RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: request_id.to_owned(),
                    expected_revision: None,
                    command: Command::AddMagnet {
                        magnet,
                        storage_root: "downloads".to_owned(),
                        start_content: true,
                        await_file_selection: false,
                        skip_files: Vec::new(),
                    },
                })
                .expect("add provisional magnet");
            added_torrent_id(&response)
        };
        let first = add("first-v1", format!("magnet:?xt=urn:btih:{v1}"));
        let second = add("second-v2", format!("magnet:?xt=urn:btmh:1220{v2}"));
        store
            .record_metadata(&first, &raw_info)
            .expect("first owner records authenticated metadata");
        assert!(store.record_metadata(&second, &raw_info).is_err());
        assert_eq!(only_torrent_id(&store), first);
        assert_eq!(
            store.take_pending_reconciliations(),
            [PendingReconciliation {
                winner: first,
                loser: second,
            }]
        );
    }

    #[test]
    fn v2_only_hybrid_metadata_expands_aliases_for_same_owner() {
        let root = test_root("hybrid-v2-owner-expansion");
        let configured = configured_root(&root);
        let raw_info = hybrid_raw_info();
        let v2 = super::encode_hex(&Sha256::digest(&raw_info));
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open");
        let added = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-v2-hybrid-owner".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btmh:1220{v2}&so=0"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add v2 provisional owner");
        let torrent_id = added_torrent_id(&added);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("expand authenticated hybrid aliases");
        let resume = store.load_resume(&torrent_id).expect("load hybrid owner");
        assert!(resume.info_hashes.is_hybrid());
        assert_eq!(resume.raw_info.as_deref(), Some(raw_info.as_slice()));
        assert_eq!(resume.skip_files, vec![1]);
    }

    #[test]
    fn tracker_only_magnet_survives_catalog_reopen() {
        let root = test_root("tracker-magnet");
        let configured = configured_root(&root);
        let source = "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213\
             &tr=UDP%3A%2F%2FTRACKER.EXAMPLE%3A6969%2Fannounce\
             &tr=https%3A%2F%2Ftracker.example%2Fannounce%3Fpasskey%3Dabc";
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");
        let added = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-tracker-only".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: source.to_owned(),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("persist tracker-only source");
        let torrent_id = added_torrent_id(&added);
        drop(store);

        let reopened = SessionStore::open(&root, "default", &[configured]).expect("reopen");
        let resume = reopened
            .load_resume(&torrent_id)
            .expect("load resumed source");
        assert_eq!(
            resume.magnet,
            "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213\
             &tr=UDP%3A%2F%2FTRACKER.EXAMPLE%3A6969%2Fannounce\
             &tr=https%3A%2F%2Ftracker.example%2Fannounce%3Fpasskey%3Dabc"
        );
        assert_eq!(resume.trackers.len(), 2);
        assert_eq!(resume.trackers[0].transport, StoredTrackerTransport::Udp);
        assert_eq!(resume.trackers[1].transport, StoredTrackerTransport::Https);
        assert_eq!(
            resume.trackers[1].url,
            "https://tracker.example/announce?passkey=abc"
        );
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn magnet_export_preserves_verified_source_and_falls_back_after_corruption() {
        let root = test_root("magnet-export-source");
        let configured = configured_root(&root);
        let source = "magnet:?dn=Original%20Name&ws=https%3A%2F%2Fseed.example%2Ffile\
             &tr=udp%3A%2F%2Ftracker.example%3A6969%2Fannounce\
             &xt=urn:btih:000102030405060708090A0B0C0D0E0F10111213&xl=4096";
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open");
        let added = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-export-source".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: source.to_owned(),
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add exact source");
        assert_eq!(added.revision, "1");
        let torrent_id = added_torrent_id(&added);
        let resume = store.load_resume(&torrent_id).expect("load named source");
        let operational = Magnet::parse(&resume.magnet).expect("parse operational magnet");
        assert_eq!(operational.display_name.as_deref(), Some("Original Name"));
        assert_eq!(operational.exact_length, Some(4096));

        let owner = super::decode_torrent_id(&torrent_id).expect("owner");
        store
            .connection
            .execute(
                "UPDATE torrents SET magnet = ?2 WHERE torrent_id = ?1",
                params![
                    owner.as_bytes().as_slice(),
                    "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213\
                     &tr=udp%3A%2F%2Ftracker.example%3A6969%2Fannounce"
                ],
            )
            .expect("simulate older operational magnet");
        let recovered = store
            .load_resume(&torrent_id)
            .expect("recover retained source name");
        let recovered = Magnet::parse(&recovered.magnet).expect("parse recovered magnet");
        assert_eq!(recovered.display_name.as_deref(), Some("Original Name"));
        assert_eq!(recovered.exact_length, Some(4096));

        let export = store
            .handle_durable(&export_request("export-verbatim", &torrent_id))
            .expect("export exact source");
        assert_eq!(export.revision, "1");
        let result = match export.result.expect("export result") {
            crate::CommandResult::ExportMagnet { result } => result,
            crate::CommandResult::AddTorrent { .. } => panic!("unexpected add result"),
        };
        assert_eq!(result.magnet, source);
        assert_eq!(result.source, MagnetExportSource::Verbatim);
        assert_eq!(result.omitted_tracker_count, 0);

        store
            .connection
            .execute(
                "UPDATE torrent_source SET fidelity = 'canonicalized' WHERE torrent_id = ?1",
                [owner.as_bytes().as_slice()],
            )
            .expect("mark source as migrated canonical text");
        let canonicalized = store
            .handle_durable(&export_request("export-canonicalized", &torrent_id))
            .expect("export canonicalized source");
        let result = match canonicalized.result.expect("canonicalized result") {
            crate::CommandResult::ExportMagnet { result } => result,
            crate::CommandResult::AddTorrent { .. } => panic!("unexpected add result"),
        };
        assert_eq!(result.magnet, source);
        assert_eq!(result.source, MagnetExportSource::Canonicalized);

        store
            .connection
            .execute(
                "UPDATE torrent_source SET sha256 = zeroblob(32) WHERE torrent_id = ?1",
                [owner.as_bytes().as_slice()],
            )
            .expect("corrupt retained source digest");
        let fallback = store
            .handle_durable(&export_request("export-fallback", &torrent_id))
            .expect("fall back from corrupt source");
        assert_eq!(fallback.revision, "1");
        let result = match fallback.result.expect("fallback result") {
            crate::CommandResult::ExportMagnet { result } => result,
            crate::CommandResult::AddTorrent { .. } => panic!("unexpected add result"),
        };
        assert_eq!(result.source, MagnetExportSource::Synthesized);
        assert_eq!(
            result.magnet,
            "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213\
             &tr=udp%3A%2F%2Ftracker.example%3A6969%2Fannounce"
        );
        assert_eq!(result.omitted_tracker_count, 0);

        let missing = store
            .handle_durable(&export_request(
                "export-missing",
                "t1-ffffffffffffffffffffffffffffffff",
            ))
            .expect("return typed missing result");
        assert!(matches!(
            missing.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::UnknownTorrent,
                    ..
                }
            }
        ));
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn metainfo_export_synthesizes_verified_name_and_ordered_trackers() {
        let root = test_root("metainfo-magnet-export");
        let configured = configured_root(&root);
        let source = rich_torrent_source();
        let projection =
            Metainfo::project_bytes_with_limits(&source, EXPLICIT_IMPORT_METAINFO_LIMITS)
                .expect("project rich metainfo");
        let info_hash = crate::control::encode_info_hash(projection.metainfo.info_hash);
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open");
        let added = store
            .handle_torrent_bytes(&torrent_bytes_request("add-rich-metainfo", &source), source)
            .expect("add rich metainfo");
        let torrent_id = added_torrent_id(&added);
        let export = store
            .handle_durable(&export_request("export-rich-metainfo", &torrent_id))
            .expect("export synthesized magnet");
        assert_eq!(export.revision, added.revision);
        let result = match export.result.expect("export result") {
            crate::CommandResult::ExportMagnet { result } => result,
            crate::CommandResult::AddTorrent { .. } => panic!("unexpected add result"),
        };
        assert_eq!(result.source, MagnetExportSource::Synthesized);
        assert_eq!(result.omitted_tracker_count, 0);
        assert_eq!(
            result.magnet,
            format!(
                "magnet:?xt=urn:btih:{info_hash}\
                 &dn=Test%20%26%20Stuff\
                 &tr=udp%3A%2F%2Ftracker.example%3A6969%2Fannounce\
                 &tr=https%3A%2F%2Fbackup.example%2Fannounce%3Fkey%3Dabc"
            )
        );
        assert_eq!(
            Magnet::parse(&result.magnet)
                .expect("parse synthesized magnet")
                .trackers
                .len(),
            2
        );
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn synthesized_magnet_reports_count_and_length_omissions() {
        let tracker = |position: u32, url: String| StoredTracker {
            tier: 0,
            position,
            url,
            transport: StoredTrackerTransport::Udp,
            source: StoredTrackerSource::Metainfo,
        };
        let count_trackers = (0..MAX_TRACKERS + 2)
            .map(|index| {
                tracker(
                    index as u32,
                    format!("udp://tracker-{index}.example:80/announce"),
                )
            })
            .collect::<Vec<_>>();
        let count_bounded = synthesize_magnet_export([7; 20], None, &count_trackers);
        assert_eq!(count_bounded.omitted_tracker_count, 2);
        assert_eq!(
            Magnet::parse(&count_bounded.magnet)
                .expect("parse count-bounded magnet")
                .trackers
                .len(),
            MAX_TRACKERS
        );

        let large_token = "%".repeat(1_900);
        let mut length_trackers = (0..3)
            .map(|index| {
                tracker(
                    index,
                    format!("https://large-{index}.example/announce?token={large_token}"),
                )
            })
            .collect::<Vec<_>>();
        let short = "udp://short.example:80/announce";
        length_trackers.push(tracker(3, short.to_owned()));
        let length_bounded = synthesize_magnet_export([8; 20], Some("Bounded"), &length_trackers);
        assert!(length_bounded.magnet.len() <= MAX_MAGNET_LENGTH);
        assert_eq!(length_bounded.omitted_tracker_count, 1);
        assert!(
            length_bounded
                .magnet
                .ends_with("&tr=udp%3A%2F%2Fshort.example%3A80%2Fannounce")
        );
        assert_eq!(
            Magnet::parse(&length_bounded.magnet)
                .expect("parse length-bounded magnet")
                .trackers
                .len(),
            3
        );
    }

    #[test]
    fn torrent_bytes_are_atomic_exact_replayable_and_restartable() {
        let root = test_root("torrent-bytes");
        let configured = configured_root(&root);
        let source = torrent_source();
        let projection = rstorrent_protocol::metainfo::Metainfo::project_bytes_with_limits(
            &source,
            rstorrent_protocol::metainfo::EXPLICIT_IMPORT_METAINFO_LIMITS,
        )
        .expect("fixture metainfo");
        let info_hash = crate::control::encode_info_hash(projection.metainfo.info_hash);
        let raw_info = source[projection.info_span.clone()].to_vec();
        let request = torrent_bytes_request("add-torrent-bytes", &source);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");

        let accepted = store
            .handle_torrent_bytes(&request, source.clone())
            .expect("accept source bytes");
        assert!(matches!(accepted.outcome, ResponseOutcome::Success { .. }));
        assert_eq!(accepted.revision, "1");
        let torrent_id = added_torrent_id(&accepted);
        let stored_receipt: String = store
            .connection
            .query_row(
                "SELECT request_json FROM request_receipts WHERE request_id = ?1",
                [&request.request_id],
                |row| row.get(0),
            )
            .expect("inspect byte-intake receipt");
        let legacy_receipt = serde_json::to_string(&serde_json::json!({
            "operation": "add_torrent_bytes",
            "request": {
                "version": request.version,
                "request_id": request.request_id,
                "storage_root": request.storage_root,
                "start_content": request.start_content,
                "await_file_selection": request.await_file_selection,
                "selection": request.selection,
                "source_length": request.source_length,
                "source_sha256": super::encode_digest(&Sha256::digest(&source)),
            },
        }))
        .expect("encode legacy receipt shape");
        assert_eq!(stored_receipt, legacy_receipt);
        assert_eq!(
            store
                .handle_torrent_bytes(&request, source.clone())
                .expect("replay source bytes"),
            accepted
        );
        let resume = store.load_resume(&torrent_id).expect("load imported row");
        assert_eq!(resume.raw_info.as_deref(), Some(raw_info.as_slice()));
        assert_eq!(resume.state, TorrentState::Paused);
        assert!(!resume.desired_running);
        assert_eq!(resume.magnet, format!("magnet:?xt=urn:btih:{info_hash}"));
        assert_eq!(resume.trackers.len(), 1);
        assert_eq!(resume.trackers[0].tier, 0);
        assert_eq!(resume.trackers[0].position, 0);
        assert_eq!(resume.trackers[0].transport, StoredTrackerTransport::Udp);
        assert_eq!(resume.trackers[0].source, StoredTrackerSource::Metainfo);
        let (kind, fidelity, exact_source, digest): (String, String, Vec<u8>, Vec<u8>) = store
            .connection
            .query_row(
                "SELECT kind, fidelity, metainfo, sha256
                 FROM torrent_source WHERE torrent_id = ?1",
                [super::decode_torrent_id(&torrent_id)
                    .expect("owner")
                    .as_bytes()
                    .as_slice()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("inspect exact source");
        assert_eq!((kind.as_str(), fidelity.as_str()), ("metainfo", "verbatim"));
        assert_eq!(exact_source, source);
        assert_eq!(digest, Sha256::digest(&source).as_slice());
        let tracker: (String, String, String) = store
            .connection
            .query_row(
                "SELECT url, transport, source FROM torrent_trackers
                 WHERE torrent_id = ?1",
                [super::decode_torrent_id(&torrent_id)
                    .expect("owner")
                    .as_bytes()
                    .as_slice()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("inspect projected tracker");
        assert_eq!(
            tracker,
            (
                "udp://tracker.example:6969/passkey".to_owned(),
                "udp".to_owned(),
                "metainfo".to_owned(),
            )
        );
        drop(store);

        let reopened = SessionStore::open(&root, "default", &[configured]).expect("reopen");
        let reopened_resume = reopened
            .load_resume(&torrent_id)
            .expect("restart imported row");
        assert_eq!(
            reopened_resume.raw_info.as_deref(),
            Some(raw_info.as_slice())
        );
        assert_eq!(reopened_resume.trackers, resume.trackers);
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn torrent_bytes_reject_length_conflict_duplicate_and_stale_without_mutation() {
        let root = test_root("torrent-bytes-errors");
        let configured = configured_root(&root);
        let source = torrent_source();
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");

        let mut mismatch = torrent_bytes_request("mismatch", &source);
        mismatch.source_length += 1;
        let rejected = store
            .handle_torrent_bytes(&mismatch, source.clone())
            .expect("reject length mismatch");
        assert!(matches!(
            rejected.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::InvalidRequest,
                    ..
                }
            }
        ));
        assert_eq!(store.revision().expect("unchanged revision"), 0);
        assert!(
            store
                .snapshot()
                .expect("empty snapshot")
                .torrents
                .is_empty()
        );

        let request = torrent_bytes_request("shared-id", &source);
        store
            .handle_torrent_bytes(&request, source.clone())
            .expect("accept first source");
        let mut conflict = request.clone();
        conflict.start_content = true;
        let conflicted = store
            .handle_torrent_bytes(&conflict, source.clone())
            .expect("request conflict");
        assert!(matches!(
            conflicted.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::RequestConflict,
                    ..
                }
            }
        ));
        let mut changed_source = source.clone();
        let comment = changed_source
            .windows(b"preserve me exact".len())
            .position(|window| window == b"preserve me exact")
            .expect("fixture comment");
        changed_source[comment] = b'P';
        let source_conflicted = store
            .handle_torrent_bytes(&request, changed_source)
            .expect("source bytes conflict");
        assert!(matches!(
            source_conflicted.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::RequestConflict,
                    ..
                }
            }
        ));
        let duplicate = store
            .handle_torrent_bytes(
                &torrent_bytes_request("duplicate-source", &source),
                source.clone(),
            )
            .expect("duplicate response");
        assert!(matches!(duplicate.outcome, ResponseOutcome::Success { .. }));
        assert!(matches!(
            duplicate.result,
            Some(crate::CommandResult::AddTorrent {
                result: crate::AddTorrentResult {
                    disposition: crate::AddTorrentDisposition::AlreadyPresent,
                    ..
                }
            })
        ));
        let mut stale = torrent_bytes_request("stale-source", &source);
        stale.expected_revision = Some("0".to_owned());
        let stale = store
            .handle_torrent_bytes(&stale, source.clone())
            .expect("stale response");
        assert!(matches!(
            stale.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::StaleRevision,
                    ..
                }
            }
        ));
        assert_eq!(store.revision().expect("one accepted revision"), 1);
        assert_eq!(store.snapshot().expect("one torrent").torrents.len(), 1);
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    fn test_root(label: &str) -> PathBuf {
        let sequence = NEXT_TEST.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "rstorrent-session-{label}-{}-{sequence}",
            std::process::id()
        ))
    }

    fn configured_root(root: &std::path::Path) -> ConfiguredStorageRoot {
        ConfiguredStorageRoot::path("downloads", root.join("payload"))
    }

    #[test]
    fn product_milestone_outbox_is_ordered_durable_and_acknowledged_by_epoch() {
        let root = test_root("product-outbox");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");

        let first_request = add_hash_request("product-add-first", 0x31);
        let first = store.handle_durable(&first_request).expect("add first");
        assert!(matches!(first.outcome, ResponseOutcome::Success { .. }));
        store
            .handle_durable(&add_hash_request("product-add-duplicate", 0x31))
            .expect("reject duplicate without a milestone");
        store
            .handle_durable(&first_request)
            .expect("replay accepted receipt without a milestone");

        let milestones = store
            .pending_product_milestones()
            .expect("read first milestone");
        assert_eq!(milestones.len(), 1);
        assert_eq!(milestones[0].sequence, 1);
        assert_eq!(milestones[0].kind, ProductMilestoneKind::TorrentAdded);
        let source_epoch = milestones[0].source_epoch;
        assert!(matches!(
            store.acknowledge_product_milestones([7; 16], 1),
            Err(StoreError::DurableState(_))
        ));
        assert!(matches!(
            store.acknowledge_product_milestones(source_epoch, 2),
            Err(StoreError::DurableState(_))
        ));
        assert_eq!(
            store
                .acknowledge_product_milestones(source_epoch, 1)
                .expect("acknowledge first milestone"),
            1
        );
        assert!(
            store
                .pending_product_milestones()
                .expect("empty outbox")
                .is_empty()
        );
        drop(store);

        let mut reopened =
            SessionStore::open(&root, "default", &[configured]).expect("reopen product outbox");
        reopened
            .handle_durable(&add_hash_request("product-add-second", 0x32))
            .expect("add second");
        let milestones = reopened
            .pending_product_milestones()
            .expect("read second milestone");
        assert_eq!(milestones.len(), 1);
        assert_eq!(milestones[0].source_epoch, source_epoch);
        assert_eq!(milestones[0].sequence, 2);
        assert_eq!(milestones[0].kind, ProductMilestoneKind::TorrentAdded);

        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn product_milestone_outbox_drops_only_derived_work_at_its_bound() {
        let maximum = usize::try_from(MAX_PENDING_PRODUCT_MILESTONES).expect("bound fits usize");
        let mut store = SessionStore::open_ephemeral("default", &[]).expect("open ephemeral");
        let transaction = store.connection.transaction().expect("begin outbox fill");
        for _ in 0..maximum {
            assert!(
                append_product_milestone(&transaction, ProductMilestoneKind::TorrentAdded)
                    .expect("append bounded milestone")
            );
        }
        assert!(
            !append_product_milestone(&transaction, ProductMilestoneKind::DownloadCompleted)
                .expect("drop over-bound milestone")
        );
        transaction.commit().expect("commit bounded outbox");

        assert_eq!(
            store
                .pending_product_milestones()
                .expect("read bounded outbox")
                .len(),
            maximum
        );
        assert_eq!(
            store
                .dropped_product_milestone_count()
                .expect("read drop count"),
            1
        );
    }

    fn add_request(request_id: &str) -> RequestEnvelope {
        RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            command: Command::AddMagnet {
                magnet:
                    "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213&x.pe=127.0.0.1:1"
                        .to_owned(),
                storage_root: "downloads".to_owned(),
                start_content: true,
                await_file_selection: false,
                skip_files: vec![1, 3],
            },
        }
    }

    fn add_hash_request(request_id: &str, value: u8) -> RequestEnvelope {
        RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            command: Command::AddMagnet {
                magnet: format!(
                    "magnet:?xt=urn:btih:{}&x.pe=127.0.0.1:1",
                    format!("{value:02x}").repeat(20)
                ),
                storage_root: "downloads".to_owned(),
                start_content: true,
                await_file_selection: false,
                skip_files: Vec::new(),
            },
        }
    }

    fn queued_ids(store: &SessionStore) -> Vec<String> {
        let mut torrents = store.snapshot().expect("queue snapshot").torrents;
        torrents.sort_unstable_by_key(|torrent| torrent.download_queue_position);
        torrents
            .into_iter()
            .filter(|torrent| torrent.download_queue_position.is_some())
            .map(|torrent| torrent.torrent_id)
            .collect()
    }

    #[test]
    fn download_queue_is_durable_replayable_and_keeps_pause_position() {
        let root = test_root("download-queue");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");
        let mut ids = Vec::new();
        for value in 1..=3 {
            let added = store
                .handle_durable(&add_hash_request(&format!("add-{value}"), value))
                .expect("add queued torrent");
            ids.push(added_torrent_id(&added));
        }
        assert_eq!(queued_ids(&store), ids);

        for (request_id, command) in [
            (
                "pause-middle",
                Command::Pause {
                    torrent_id: ids[1].clone(),
                },
            ),
            (
                "resume-middle",
                Command::Resume {
                    torrent_id: ids[1].clone(),
                },
            ),
        ] {
            store
                .handle_durable(&RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: request_id.to_owned(),
                    expected_revision: None,
                    command,
                })
                .expect("change durable intent");
        }
        assert_eq!(queued_ids(&store), ids);

        let move_top = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "move-third-top".to_owned(),
            expected_revision: None,
            command: Command::MoveDownloadToTop {
                torrent_id: ids[2].clone(),
            },
        };
        let accepted = store.handle_durable(&move_top).expect("move to top");
        assert_eq!(
            queued_ids(&store),
            vec![ids[2].clone(), ids[0].clone(), ids[1].clone()]
        );
        assert_eq!(
            store.handle_durable(&move_top).expect("exact replay"),
            accepted
        );

        let conflict = store
            .handle_durable(&RequestEnvelope {
                command: Command::MoveDownloadToBottom {
                    torrent_id: ids[2].clone(),
                },
                ..move_top.clone()
            })
            .expect("request conflict response");
        assert!(matches!(
            conflict.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::RequestConflict,
                    ..
                }
            }
        ));
        let stale = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "stale-queue-move".to_owned(),
                expected_revision: Some("0".to_owned()),
                command: Command::MoveDownloadToBottom {
                    torrent_id: ids[2].clone(),
                },
            })
            .expect("stale response");
        assert!(matches!(
            stale.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::StaleRevision,
                    ..
                }
            }
        ));

        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "move-third-bottom".to_owned(),
                expected_revision: None,
                command: Command::MoveDownloadToBottom {
                    torrent_id: ids[2].clone(),
                },
            })
            .expect("move to bottom");
        assert_eq!(queued_ids(&store), ids);
        drop(store);

        let reopened = SessionStore::open(&root, "default", &[configured]).expect("reopen");
        assert_eq!(queued_ids(&reopened), ids);
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    fn torrent_source() -> Vec<u8> {
        let tracker = "udp://tracker.example:6969/passkey";
        let info = b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let mut source = format!(
            "d8:announce{}:{tracker}7:comment17:preserve me exact4:info",
            tracker.len()
        )
        .into_bytes();
        source.extend_from_slice(info);
        source.push(b'e');
        source
    }

    fn pure_v2_torrent_source() -> Vec<u8> {
        let root: [u8; 32] = Sha256::digest(b"x").into();
        let mut info = b"d9:file treed1:ad0:d6:lengthi1e11:pieces root32:".to_vec();
        info.extend_from_slice(&root);
        info.extend_from_slice(b"eee12:meta versioni2e4:name4:root12:piece lengthi16384ee");
        let mut source = b"d4:info".to_vec();
        source.extend_from_slice(&info);
        source.extend_from_slice(b"12:piece layersdee");
        source
    }

    #[test]
    fn pure_v2_magnet_metadata_export_and_restart_keep_full_identity() {
        let root = test_root("pure-v2-magnet");
        let configured = configured_root(&root);
        let source = pure_v2_torrent_source();
        let projection =
            rstorrent_protocol::content::TorrentContentProjection::from_bytes_with_limits(
                &source,
                EXPLICIT_IMPORT_METAINFO_LIMITS,
            )
            .expect("fixture pure-v2 metainfo");
        let raw_info = source[projection.info_span].to_vec();
        let identity = projection
            .content
            .info_hashes()
            .v2_hash()
            .expect("pure-v2 identity");
        let exact_source = format!(
            "magnet:?dn=Exact&xt=urn:btmh:1220{}&x.pe=127.0.0.1:49001&so=0\
             &tr=udp%3A%2F%2Ftracker.example%3A6969%2Fannounce",
            identity.to_string().to_uppercase()
        );
        let add = |request_id: &str, magnet: String| RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            command: Command::AddMagnet {
                magnet,
                storage_root: "downloads".to_owned(),
                start_content: false,
                await_file_selection: false,
                skip_files: Vec::new(),
            },
        };
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");
        let added = store
            .handle_durable(&add("add-v2-magnet", exact_source.clone()))
            .expect("add pure-v2 magnet");
        let torrent_id = added_torrent_id(&added);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record SHA-256 authenticated v2 info");

        let resume = store.load_resume(&torrent_id).expect("load v2 magnet");
        assert_eq!(resume.info_hashes.v1_hash(), None);
        assert_eq!(resume.info_hashes.v2_hash(), Some(identity));
        assert_eq!(resume.raw_info.as_deref(), Some(raw_info.as_slice()));
        assert_eq!(
            resume.have.as_ref().map(HaveState::pieces),
            Some([false].as_slice())
        );
        assert_eq!(resume.skip_files, Vec::<u32>::new());
        assert_eq!(
            resume.magnet,
            super::canonical_magnet(&Magnet::parse(&exact_source).unwrap())
        );

        let revision = store.revision().expect("revision after metadata");
        let duplicate = store
            .handle_durable(&add(
                "duplicate-v2-magnet",
                format!("magnet:?xt=urn:btmh:1220{identity}"),
            ))
            .expect("deduplicate full v2 identity");
        assert_eq!(added_torrent_id(&duplicate), torrent_id);
        assert_eq!(store.revision().expect("unchanged revision"), revision);

        let exported = store
            .handle_durable(&export_request("export-v2-verbatim", &torrent_id))
            .expect("export v2 source");
        let result = match exported.result.expect("export result") {
            crate::CommandResult::ExportMagnet { result } => result,
            crate::CommandResult::AddTorrent { .. } => panic!("unexpected add result"),
        };
        assert_eq!(result.magnet, exact_source);
        assert_eq!(result.source, MagnetExportSource::Verbatim);

        store
            .connection
            .execute(
                "UPDATE torrent_source SET sha256 = zeroblob(32) WHERE torrent_id = ?1",
                [super::decode_torrent_id(&torrent_id)
                    .expect("owner")
                    .as_bytes()
                    .as_slice()],
            )
            .expect("invalidate retained source");
        let fallback = store
            .handle_durable(&export_request("export-v2-fallback", &torrent_id))
            .expect("synthesize v2 magnet");
        let result = match fallback.result.expect("fallback result") {
            crate::CommandResult::ExportMagnet { result } => result,
            crate::CommandResult::AddTorrent { .. } => panic!("unexpected add result"),
        };
        assert_eq!(result.source, MagnetExportSource::Synthesized);
        assert!(
            result
                .magnet
                .starts_with(&format!("magnet:?xt=urn:btmh:1220{identity}&dn=root"))
        );

        drop(store);
        let reopened = SessionStore::open(&root, "default", &[configured]).expect("reopen");
        let resumed = reopened.load_resume(&torrent_id).expect("resume v2 magnet");
        assert_eq!(resumed.info_hashes.v2_hash(), Some(identity));
        assert_eq!(resumed.raw_info, Some(raw_info));
        drop(reopened);
        fs::remove_dir_all(root).expect("remove profile");
    }

    #[test]
    fn pure_v2_bytes_are_full_identity_deduplicated_and_restartable() {
        let root = test_root("pure-v2-torrent-bytes");
        let configured = configured_root(&root);
        let source = pure_v2_torrent_source();
        let projection =
            rstorrent_protocol::content::TorrentContentProjection::from_bytes_with_limits(
                &source,
                EXPLICIT_IMPORT_METAINFO_LIMITS,
            )
            .expect("fixture pure-v2 metainfo");
        let raw_info = source[projection.info_span.clone()].to_vec();
        let expected_v2 = projection
            .content
            .info_hashes()
            .v2_hash()
            .expect("v2 identity");
        let request = torrent_bytes_request("add-pure-v2", &source);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");

        let added = store
            .handle_torrent_bytes(&request, source.clone())
            .expect("accept pure-v2 source");
        assert!(matches!(added.outcome, ResponseOutcome::Success { .. }));
        let torrent_id = added_torrent_id(&added);
        let resume = store.load_resume(&torrent_id).expect("load v2 resume");
        assert_eq!(resume.info_hashes.v1_hash(), None);
        assert_eq!(resume.info_hashes.v2_hash(), Some(expected_v2));
        assert_eq!(resume.raw_info, Some(raw_info));
        assert_eq!(resume.metainfo_source.as_deref(), Some(source.as_slice()));
        assert_eq!(
            resume.have.as_ref().map(|have| have.pieces()),
            Some([false].as_slice())
        );
        assert_eq!(
            resume.magnet,
            format!("magnet:?xt=urn:btmh:1220{expected_v2}")
        );
        assert_eq!(resume.state, TorrentState::Paused);

        for (request_id, priority) in [
            ("skip-pure-v2-file", FilePriority::Skip),
            ("restore-pure-v2-file", FilePriority::Normal),
        ] {
            store
                .handle_durable(&RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: request_id.to_owned(),
                    expected_revision: None,
                    command: Command::SetFilePriority {
                        torrent_id: torrent_id.clone(),
                        file_indices: vec![0],
                        priority,
                    },
                })
                .expect("change pure-v2 file priority");
            assert_eq!(
                store
                    .load_resume(&torrent_id)
                    .expect("load pure-v2 selection")
                    .skip_files,
                if priority == FilePriority::Skip {
                    vec![0]
                } else {
                    Vec::new()
                }
            );
        }

        let selection_revision = store.revision().expect("selection revision");
        let duplicate = store
            .handle_torrent_bytes(
                &torrent_bytes_request("duplicate-pure-v2", &source),
                source.clone(),
            )
            .expect("deduplicate pure-v2 source");
        let duplicate_id = added_torrent_id(&duplicate);
        assert_eq!(duplicate_id, torrent_id);
        assert_eq!(duplicate.revision, selection_revision.to_string());

        store
            .record_piece(&torrent_id, 0)
            .expect("record pure-v2 piece");
        let reset = store
            .reset_have_from_metadata(&torrent_id)
            .expect("reset pure-v2 have from retained source");
        assert_eq!(reset.pieces(), &[false]);

        drop(store);
        let reopened = SessionStore::open(&root, "default", &[configured]).expect("reopen");
        let resumed = reopened
            .load_resume(&torrent_id)
            .expect("resume after reopen");
        assert_eq!(resumed.metainfo_source, Some(source));
        assert_eq!(resumed.info_hashes.v2_hash(), Some(expected_v2));
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    fn rich_torrent_source() -> Vec<u8> {
        let primary = "udp://tracker.example:6969/announce";
        let backup = "https://backup.example/announce?key=abc";
        let name = "Test & Stuff";
        let info = format!(
            "d6:lengthi4e4:name{}:{name}12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae",
            name.len()
        );
        format!(
            "d13:announce-listll{}:{primary}el{}:{backup}ee4:info{info}e",
            primary.len(),
            backup.len()
        )
        .into_bytes()
    }

    fn export_request(request_id: &str, torrent_id: &str) -> RequestEnvelope {
        RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            command: Command::ExportMagnet {
                torrent_id: torrent_id.to_owned(),
                options: None,
            },
        }
    }

    fn share_request(
        request_id: &str,
        torrent_id: &str,
        options: MagnetExportOptions,
    ) -> RequestEnvelope {
        RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            command: Command::ExportMagnet {
                torrent_id: torrent_id.to_owned(),
                options: Some(options),
            },
        }
    }

    fn export_result(response: crate::ResponseEnvelope) -> crate::MagnetExportResult {
        match response.result.expect("export result") {
            crate::CommandResult::ExportMagnet { result } => result,
            crate::CommandResult::AddTorrent { .. } => panic!("unexpected add result"),
        }
    }

    fn error_code(response: &crate::ResponseEnvelope) -> ErrorCode {
        match &response.outcome {
            ResponseOutcome::Error { error } => error.code,
            ResponseOutcome::Success { .. } => panic!("expected an error response"),
        }
    }

    /// Four files: `a` (2 bytes), a padding file, `b` and `c` (4 bytes each).
    fn share_raw_info(private: bool) -> Vec<u8> {
        let files = concat!(
            "d6:lengthi2e4:pathl1:aee",
            "d4:attr1:p6:lengthi2ee",
            "d6:lengthi4e4:pathl1:bee",
            "d6:lengthi4e4:pathl1:cee",
        );
        let mut raw =
            format!("d5:filesl{files}e4:name5:share12:piece lengthi4e6:pieces60:").into_bytes();
        raw.extend_from_slice(&[7; 60]);
        if private {
            raw.extend_from_slice(b"7:privatei1e");
        }
        raw.push(b'e');
        raw
    }

    fn add_share_torrent(
        store: &mut SessionStore,
        request_id: &str,
        raw_info: &[u8],
    ) -> (String, String) {
        let hash = super::encode_hex(&Sha1::digest(raw_info));
        let source = format!(
            "magnet:?xt=urn:btih:{hash}&dn=Shared&xl=999&so=3&x.pe=10.0.0.9:1\
             &tr=udp%3A%2F%2Ftracker.example%3A6969"
        );
        let added = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: request_id.to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: source.clone(),
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add share magnet");
        (added_torrent_id(&added), source)
    }

    fn lan_facts() -> ShareEndpointFacts {
        ShareEndpointFacts {
            ipv4_listener: Some(SocketAddrV4::new(Ipv4Addr::new(192, 168, 1, 20), 6881)),
            ..ShareEndpointFacts::default()
        }
    }

    #[test]
    fn share_export_replaces_owned_parameters_from_verified_metadata() {
        let root = test_root("share-export");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open");
        let raw_info = share_raw_info(false);
        let (torrent_id, source) = add_share_torrent(&mut store, "add-share", &raw_info);

        // Before metadata: no verified size or file list, and no hint.
        let pending = export_result(
            store
                .handle_durable_with_share_endpoints(
                    &share_request(
                        "share-pending",
                        &torrent_id,
                        MagnetExportOptions {
                            include_size: true,
                            file_indices: Vec::new(),
                            peer_hint: true,
                        },
                    ),
                    Some(&lan_facts()),
                )
                .expect("share before metadata"),
        );
        let hash = super::encode_hex(&Sha1::digest(&raw_info));
        assert_eq!(
            pending.magnet,
            format!("magnet:?xt=urn:btih:{hash}&dn=Shared&tr=udp%3A%2F%2Ftracker.example%3A6969")
        );
        assert!(pending.peer_hints.is_empty());
        assert_eq!(
            pending.peer_hint_omission,
            Some(MagnetPeerHintOmission::MetadataPending)
        );
        let selection_pending = store
            .handle_durable(&share_request(
                "share-pending-files",
                &torrent_id,
                MagnetExportOptions {
                    file_indices: vec![0],
                    ..MagnetExportOptions::default()
                },
            ))
            .expect("typed pending selection error");
        assert_eq!(
            error_code(&selection_pending),
            ErrorCode::InvalidTorrentState
        );

        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record metadata");

        // Without options the retained source is still exported verbatim,
        // and the wire result carries no share fields.
        let plain = store
            .handle_durable(&export_request("share-plain", &torrent_id))
            .expect("plain export");
        let wire = serde_json::to_value(plain.result.as_ref().expect("result")).expect("wire");
        assert!(wire["result"].get("peer_hints").is_none());
        assert!(wire["result"].get("peer_hint_omission").is_none());
        let plain = export_result(plain);
        assert_eq!(plain.magnet, source);
        assert_eq!(plain.source, MagnetExportSource::Verbatim);

        let shared = export_result(
            store
                .handle_durable_with_share_endpoints(
                    &share_request(
                        "share-rich",
                        &torrent_id,
                        MagnetExportOptions {
                            include_size: true,
                            file_indices: vec![0, 2],
                            peer_hint: true,
                        },
                    ),
                    Some(&lan_facts()),
                )
                .expect("rich share"),
        );
        assert_eq!(
            shared.magnet,
            format!(
                "magnet:?xt=urn:btih:{hash}&dn=Shared&tr=udp%3A%2F%2Ftracker.example%3A6969\
                 &xl=12&so=0-2&x.pe=192.168.1.20:6881"
            )
        );
        assert_eq!(shared.source, MagnetExportSource::Verbatim);
        assert_eq!(
            shared.peer_hints,
            vec![MagnetPeerHint {
                endpoint: "192.168.1.20:6881".to_owned(),
                scope: MagnetPeerHintScope::LocalNetwork,
            }]
        );
        assert_eq!(shared.peer_hint_omission, None);
        let parsed = Magnet::parse(&shared.magnet).expect("shared magnet parses");
        assert_eq!(parsed.exact_length, Some(12));
        assert_eq!(parsed.select_only.expect("selection").canonical(), "0-2");

        // A gap holding a real file is kept; options can also drop keys.
        let split = export_result(
            store
                .handle_durable(&share_request(
                    "share-split",
                    &torrent_id,
                    MagnetExportOptions {
                        file_indices: vec![0, 3],
                        ..MagnetExportOptions::default()
                    },
                ))
                .expect("split share"),
        );
        assert!(split.magnet.ends_with("&so=0,3"), "{}", split.magnet);
        assert!(!split.magnet.contains("xl="));
        assert!(!split.magnet.contains("x.pe="));

        // Without a network runtime a requested hint reports why.
        let offline = export_result(
            store
                .handle_durable(&share_request(
                    "share-offline",
                    &torrent_id,
                    MagnetExportOptions {
                        peer_hint: true,
                        ..MagnetExportOptions::default()
                    },
                ))
                .expect("offline share"),
        );
        assert_eq!(
            offline.peer_hint_omission,
            Some(MagnetPeerHintOmission::IncomingDisabled)
        );

        for (request_id, indices, code) in [
            ("share-padding", vec![1], ErrorCode::InvalidRequest),
            ("share-outside", vec![4], ErrorCode::InvalidRequest),
            ("share-unsorted", vec![2, 0], ErrorCode::InvalidRequest),
            ("share-duplicate", vec![2, 2], ErrorCode::InvalidRequest),
            (
                "share-too-many",
                (0..=MAX_FILE_SELECTION_ENTRIES as u32).collect(),
                ErrorCode::InvalidRequest,
            ),
        ] {
            let rejected = store
                .handle_durable(&share_request(
                    request_id,
                    &torrent_id,
                    MagnetExportOptions {
                        file_indices: indices,
                        ..MagnetExportOptions::default()
                    },
                ))
                .expect("typed selection error");
            assert_eq!(error_code(&rejected), code, "{request_id}");
        }
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn share_export_never_hints_a_private_torrent() {
        let root = test_root("share-private");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open");
        let raw_info = share_raw_info(true);
        let (torrent_id, _) = add_share_torrent(&mut store, "add-private-share", &raw_info);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record private metadata");
        let shared = export_result(
            store
                .handle_durable_with_share_endpoints(
                    &share_request(
                        "share-private",
                        &torrent_id,
                        MagnetExportOptions {
                            include_size: true,
                            file_indices: Vec::new(),
                            peer_hint: true,
                        },
                    ),
                    Some(&lan_facts()),
                )
                .expect("private share"),
        );
        assert!(shared.peer_hints.is_empty());
        assert_eq!(
            shared.peer_hint_omission,
            Some(MagnetPeerHintOmission::PrivateTorrent)
        );
        assert!(!shared.magnet.contains("x.pe="), "{}", shared.magnet);
        assert!(shared.magnet.contains("&xl=12"), "{}", shared.magnet);
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    fn torrent_bytes_request(request_id: &str, source: &[u8]) -> AddTorrentBytesRequest {
        AddTorrentBytesRequest {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            storage_root: "downloads".to_owned(),
            start_content: false,
            await_file_selection: false,
            selection: crate::FileSelectionIntent::All,
            source_length: source.len() as u32,
        }
    }

    fn maximum_torrent_source(fill: u8) -> Vec<u8> {
        let outer_bytes =
            rstorrent_protocol::metainfo::EXPLICIT_IMPORT_METAINFO_LIMITS.max_outer_bytes;
        let info_bytes = outer_bytes - b"d4:info".len() - 1;
        let mut prefix = b"d6:lengthi1e4:name1:a12:piece lengthi1e6:pieces20:".to_vec();
        prefix.extend_from_slice(&[0; 20]);
        prefix.extend_from_slice(b"6:source");
        let mut value_bytes = info_bytes - prefix.len() - 1;
        loop {
            let actual = prefix.len() + value_bytes.to_string().len() + 1 + value_bytes + 1;
            if actual == info_bytes {
                break;
            }
            if actual < info_bytes {
                value_bytes += info_bytes - actual;
            } else {
                value_bytes -= actual - info_bytes;
            }
        }
        let mut source = Vec::with_capacity(outer_bytes);
        source.extend_from_slice(b"d4:info");
        source.extend_from_slice(&prefix);
        source.extend_from_slice(value_bytes.to_string().as_bytes());
        source.push(b':');
        source.resize(source.len() + value_bytes, fill);
        source.extend_from_slice(b"ee");
        assert_eq!(source.len(), outer_bytes);
        source
    }

    fn multi_file_torrent_source(file_count: u32) -> Vec<u8> {
        let mut info = b"d5:filesl".to_vec();
        for index in 0..file_count {
            let path = format!("f{index}");
            info.extend_from_slice(
                format!("d6:lengthi1e4:pathl{}:{path}ee", path.len()).as_bytes(),
            );
        }
        info.extend_from_slice(
            format!("e4:name4:root12:piece lengthi{file_count}e6:pieces20:aaaaaaaaaaaaaaaaaaaae")
                .as_bytes(),
        );
        let mut source = b"d4:info".to_vec();
        source.extend_from_slice(&info);
        source.push(b'e');
        source
    }

    #[test]
    fn ranged_file_priority_mutates_without_an_enumerated_request() {
        let root = test_root("ranged-file-priority");
        let mut store = SessionStore::open(
            &root,
            "profile",
            &[ConfiguredStorageRoot::path(
                "downloads",
                root.join("payload"),
            )],
        )
        .expect("open store");
        let source = multi_file_torrent_source(8);
        store
            .handle_torrent_bytes(&torrent_bytes_request("add-ranges", &source), source)
            .expect("add multi-file torrent");
        let torrent_id = store.snapshot().expect("snapshot").torrents[0]
            .torrent_id
            .clone();
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "set-ranges".to_owned(),
                expected_revision: None,
                command: Command::SetFilePriorityRanges {
                    torrent_id: torrent_id.clone(),
                    ranges: vec![
                        FileIndexRange {
                            start: 1,
                            end_exclusive: 3,
                        },
                        FileIndexRange {
                            start: 5,
                            end_exclusive: 8,
                        },
                    ],
                    priority: FilePriority::Skip,
                },
            })
            .expect("apply range mutation");
        assert_eq!(
            store.load_resume(&torrent_id).expect("resume").skip_files,
            [1, 2, 5, 6, 7]
        );
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn ephemeral_store_is_private_bounded_and_preserves_receipts() {
        let configured = ConfiguredStorageRoot::platform("downloads");
        let mut first =
            SessionStore::open_ephemeral("same-profile", std::slice::from_ref(&configured))
                .expect("open first ephemeral store");
        let second =
            SessionStore::open_ephemeral("same-profile", std::slice::from_ref(&configured))
                .expect("open second ephemeral store");

        assert_eq!(first.database_path(), None);
        assert_eq!(first.revision().expect("first revision"), 0);
        assert_eq!(second.revision().expect("second revision"), 0);
        let journal: String = first
            .connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .expect("journal mode");
        let synchronous: i64 = first
            .connection
            .pragma_query_value(None, "synchronous", |row| row.get(0))
            .expect("synchronous");
        let temp_store: i64 = first
            .connection
            .pragma_query_value(None, "temp_store", |row| row.get(0))
            .expect("temp store");
        let foreign_keys: i64 = first
            .connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .expect("foreign keys");
        assert_eq!(journal.to_ascii_lowercase(), "memory");
        assert_eq!(synchronous, 0);
        assert_eq!(temp_store, 2);
        assert_eq!(foreign_keys, 1);
        let usage = first.page_usage().expect("page usage");
        assert!(usage.page_count <= usage.maximum_page_count);
        let maximum_bytes = usage.page_size * usage.maximum_page_count;
        assert!(maximum_bytes <= super::EPHEMERAL_SESSION_MAX_BYTES);
        assert!(super::EPHEMERAL_SESSION_MAX_BYTES - maximum_bytes < usage.page_size);

        let request = add_request("ephemeral-replay");
        let accepted = first.handle_durable(&request).expect("accept request");
        let torrent_id = added_torrent_id(&accepted);
        assert_eq!(
            first.handle_durable(&request).expect("replay request"),
            accepted
        );
        let mut conflict = request;
        conflict.command = Command::Pause { torrent_id };
        assert!(matches!(
            first
                .handle_durable(&conflict)
                .expect("return conflict response")
                .outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::RequestConflict,
                    ..
                }
            }
        ));
        assert_eq!(second.revision().expect("isolated revision"), 0);
        assert!(
            second
                .snapshot()
                .expect("isolated snapshot")
                .torrents
                .is_empty()
        );

        drop(first);
        let fresh = SessionStore::open_ephemeral("same-profile", &[configured])
            .expect("open fresh ephemeral store");
        assert_eq!(fresh.revision().expect("fresh revision"), 0);
        assert!(
            fresh
                .snapshot()
                .expect("fresh snapshot")
                .torrents
                .is_empty()
        );
    }

    #[test]
    fn ephemeral_page_cap_rolls_back_current_metadata_transaction() {
        let configured = ConfiguredStorageRoot::platform("downloads");
        let mut store = SessionStore::open_ephemeral_with_maximum_bytes(
            "bounded",
            std::slice::from_ref(&configured),
            512 * 1024,
        )
        .expect("open bounded ephemeral store");
        let raw_info = single_file_info_for_pieces(100_000, 16_384);
        let torrent_id = crate::control::encode_info_hash(Sha1::digest(&raw_info).into());
        let request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "bounded-add".to_owned(),
            expected_revision: None,
            command: Command::AddMagnet {
                magnet: format!("magnet:?xt=urn:btih:{torrent_id}"),
                storage_root: "downloads".to_owned(),
                start_content: false,
                await_file_selection: false,
                skip_files: Vec::new(),
            },
        };
        let added = store.handle_durable(&request).expect("add pending magnet");
        let torrent_id = added_torrent_id(&added);
        let revision = store.revision().expect("revision before exhaustion");

        let error = store
            .record_metadata(&torrent_id, &raw_info)
            .expect_err("metadata must exceed the page cap");
        assert!(error.is_resource_limit(), "unexpected error: {error}");
        assert!(matches!(
            crate::application_error_response(
                "bounded-metadata".to_owned(),
                revision,
                &crate::ApplicationError::Store(error),
            )
            .outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::ResourceLimit,
                    ..
                }
            }
        ));
        assert_eq!(store.revision().expect("rolled back revision"), revision);
        let resume = store
            .load_resume(&torrent_id)
            .expect("store remains responsive");
        assert_eq!(resume.state, TorrentState::Paused);
        assert!(resume.raw_info.is_none());
    }

    #[test]
    #[ignore = "allocates two maximum metainfo sources to profile the live page cap"]
    fn maximum_ephemeral_source_fits_and_following_import_rolls_back() {
        let configured = ConfiguredStorageRoot::platform("downloads");
        let mut store =
            SessionStore::open_ephemeral("maximum-source", std::slice::from_ref(&configured))
                .expect("open default ephemeral store");
        let first_source = maximum_torrent_source(b'a');
        let first_request = torrent_bytes_request("maximum-source-first", &first_source);
        let first = store
            .handle_torrent_bytes(&first_request, first_source)
            .expect("first maximum source fits");
        assert!(matches!(first.outcome, ResponseOutcome::Success { .. }));
        let usage = store.page_usage().expect("first import page usage");
        assert!(usage.page_count < usage.maximum_page_count);
        assert!(usage.page_count * usage.page_size > 120 * 1024 * 1024);
        println!(
            "maximum ephemeral source page use: {} of {} bytes",
            usage.page_count * usage.page_size,
            usage.maximum_page_count * usage.page_size
        );
        let first_lengths: (i64, i64) = store
            .connection
            .query_row(
                "SELECT length(s.metainfo), length(t.raw_info)
                   FROM torrent_source s
                   JOIN torrents t USING (torrent_id)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("inspect maximum source and exact info");
        assert_eq!(
            first_lengths,
            (
                rstorrent_protocol::metainfo::EXPLICIT_IMPORT_METAINFO_LIMITS.max_outer_bytes
                    as i64,
                (rstorrent_protocol::metainfo::EXPLICIT_IMPORT_METAINFO_LIMITS.max_outer_bytes
                    - b"d4:info".len()
                    - 1) as i64,
            )
        );

        let revision = store.revision().expect("revision before exhaustion");
        let second_source = maximum_torrent_source(b'b');
        let second_request = torrent_bytes_request("maximum-source-second", &second_source);
        let error = store
            .handle_torrent_bytes(&second_request, second_source)
            .expect_err("following maximum source exceeds the live page cap");
        assert!(error.is_resource_limit(), "unexpected error: {error}");
        assert_eq!(store.revision().expect("rolled back revision"), revision);
        assert_eq!(
            store
                .snapshot()
                .expect("store remains responsive")
                .torrents
                .len(),
            1
        );
        assert_eq!(
            store
                .connection
                .query_row("SELECT COUNT(*) FROM torrent_source", [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("count intact source rows"),
            1
        );
    }

    fn multi_file_info() -> Vec<u8> {
        let mut info = b"d5:filesld6:lengthi4e4:pathl5:a.bineed6:lengthi4e4:pathl5:b.bineee4:name5:multi12:piece lengthi4e6:pieces40:".to_vec();
        info.extend_from_slice(&[b'a'; 20]);
        info.extend_from_slice(&[b'b'; 20]);
        info.push(b'e');
        info
    }

    fn single_file_info_for_pieces(piece_count: usize, piece_length: u32) -> Vec<u8> {
        let total_length = u64::try_from(piece_count)
            .expect("piece count fits u64")
            .checked_mul(u64::from(piece_length))
            .expect("fixture length");
        let hash_bytes = piece_count.checked_mul(20).expect("fixture hash bytes");
        let mut info = format!(
            "d6:lengthi{total_length}e4:name1:x12:piece lengthi{piece_length}e6:pieces{hash_bytes}:"
        )
        .into_bytes();
        info.resize(info.len() + hash_bytes, 0);
        info.push(b'e');
        info
    }

    #[test]
    fn metadata_only_add_and_three_value_file_priority_are_durable() {
        let root = test_root("file-priority");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open store");
        let raw_info = multi_file_info();
        let torrent_id = crate::control::encode_info_hash(Sha1::digest(&raw_info).into());
        let added = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "metadata-only-add".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}"),
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add metadata-only torrent");
        let torrent_id = added_torrent_id(&added);
        let pending = store.load_resume(&torrent_id).expect("load pending add");
        assert!(!pending.desired_running);
        assert_eq!(pending.state, TorrentState::Paused);
        assert_eq!(pending.storage_state, StorageState::Available);

        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record metadata");
        let ready = store
            .load_resume(&torrent_id)
            .expect("load metadata-only add");
        assert_eq!(ready.state, TorrentState::Paused);
        assert_eq!(ready.storage_state, StorageState::Available);

        let high = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "high-file".to_owned(),
            expected_revision: None,
            command: Command::SetFilePriority {
                torrent_id: torrent_id.clone(),
                file_indices: vec![0],
                priority: FilePriority::High,
            },
        };
        store.handle_durable(&high).expect("raise file priority");
        let raised_revision = store.revision().expect("raised revision");
        assert_eq!(
            store
                .load_resume(&torrent_id)
                .expect("load raised priority")
                .high_priority_files,
            [0]
        );
        let mut repeated_high = high.clone();
        repeated_high.request_id = "high-file-again".to_owned();
        store
            .handle_durable(&repeated_high)
            .expect("repeat high priority");
        assert_eq!(
            store.revision().expect("idempotent priority revision"),
            raised_revision
        );

        let skip = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "skip-file".to_owned(),
            expected_revision: None,
            command: Command::SetFilePriority {
                torrent_id: torrent_id.clone(),
                file_indices: vec![1],
                priority: FilePriority::Skip,
            },
        };
        let skipped = store.handle_durable(&skip).expect("skip file");
        assert!(matches!(skipped.outcome, ResponseOutcome::Success { .. }));
        let selected = store.load_resume(&torrent_id).expect("load selection");
        assert_eq!(selected.skip_files, vec![1]);
        assert_eq!(selected.high_priority_files, vec![0]);
        assert_eq!(selected.state, TorrentState::Paused);
        assert_eq!(
            store.handle_durable(&skip).expect("replay skip receipt"),
            skipped
        );

        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "raise-skipped-file".to_owned(),
                expected_revision: None,
                command: Command::SetFilePriority {
                    torrent_id: torrent_id.clone(),
                    file_indices: vec![1],
                    priority: FilePriority::High,
                },
            })
            .expect("high implies wanted");
        let raised = store.load_resume(&torrent_id).expect("load raised file");
        assert!(raised.skip_files.is_empty());
        assert_eq!(raised.high_priority_files, [0, 1]);
        for (request_id, priority) in [
            ("normalize-raised-file", FilePriority::Normal),
            ("skip-normalized-file", FilePriority::Skip),
        ] {
            store
                .handle_durable(&RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: request_id.to_owned(),
                    expected_revision: None,
                    command: Command::SetFilePriority {
                        torrent_id: torrent_id.clone(),
                        file_indices: vec![1],
                        priority,
                    },
                })
                .expect("transition file priority");
        }
        let transitioned = store.load_resume(&torrent_id).expect("load transitions");
        assert_eq!(transitioned.skip_files, [1]);
        assert_eq!(transitioned.high_priority_files, [0]);

        drop(store);
        let reopened =
            SessionStore::open(&root, "default", &[configured_root(&root)]).expect("reopen store");
        let reopened_resume = reopened
            .load_resume(&torrent_id)
            .expect("load reopened selection");
        assert_eq!(reopened_resume.skip_files, vec![1]);
        assert_eq!(reopened_resume.high_priority_files, vec![0]);
        drop(reopened);
        fs::remove_dir_all(root).expect("remove profile");
    }

    #[test]
    fn select_only_survives_metadata_and_duplicate_expands_once() {
        let root = test_root("select-only");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open store");
        let raw_info = multi_file_info();
        let torrent_id = crate::control::encode_info_hash(Sha1::digest(&raw_info).into());
        let add = |request_id: &str, so: &str| RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            command: Command::AddMagnet {
                magnet: format!("magnet:?xt=urn:btih:{torrent_id}&so={so}"),
                storage_root: "ignored-on-duplicate".to_owned(),
                start_content: true,
                await_file_selection: false,
                skip_files: Vec::new(),
            },
        };
        let mut first = add("select-one", "1");
        if let Command::AddMagnet { storage_root, .. } = &mut first.command {
            *storage_root = "downloads".to_owned();
        }
        let first = store.handle_durable(&first).expect("add pending selection");
        assert!(matches!(
            first.result,
            Some(crate::CommandResult::AddTorrent {
                result: crate::AddTorrentResult {
                    disposition: crate::AddTorrentDisposition::Added,
                    ..
                }
            })
        ));
        let torrent_id = added_torrent_id(&first);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("resolve selection");
        let snapshot = store.snapshot().expect("resolved snapshot");
        assert_eq!(snapshot.torrents[0].selection_default, FilePriority::Skip);
        assert_eq!(snapshot.torrents[0].selection_exceptions, [1]);
        assert!(snapshot.torrents[0].skip_files.is_empty());

        let expanded = store
            .handle_durable(&add("expand-zero", "0"))
            .expect("expand");
        assert!(matches!(
            expanded.result,
            Some(crate::CommandResult::AddTorrent {
                result: crate::AddTorrentResult {
                    disposition: crate::AddTorrentDisposition::SelectionExpanded {
                        newly_wanted_count: Some(1)
                    },
                    ..
                }
            })
        ));
        let revision = store.revision().expect("expanded revision");
        let no_op = store
            .handle_durable(&add("expand-zero-again", "0"))
            .expect("no-op");
        assert!(matches!(
            no_op.result,
            Some(crate::CommandResult::AddTorrent {
                result: crate::AddTorrentResult {
                    disposition: crate::AddTorrentDisposition::AlreadyPresent,
                    ..
                }
            })
        ));
        assert_eq!(store.revision().expect("unchanged revision"), revision);
        assert_eq!(
            store.snapshot().expect("expanded snapshot").torrents[0].selection_exceptions,
            [0, 1]
        );
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn download_all_pending_magnet_survives_reopen_and_late_metadata() {
        let root = test_root("pending-all-before-metadata");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).unwrap();
        let raw_info = multi_file_info();
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let mut add = add_request("pending-all-add");
        if let Command::AddMagnet {
            magnet,
            skip_files,
            await_file_selection,
            ..
        } = &mut add.command
        {
            *magnet = format!("magnet:?xt=urn:btih:{}&so=1", super::encode_hex(&info_hash));
            skip_files.clear();
            *await_file_selection = true;
        }
        let added = store.handle_durable(&add).unwrap();
        let torrent_id = added_torrent_id(&added);
        let pending = store.snapshot().unwrap();
        assert!(pending.torrents[0].awaiting_file_selection);
        assert!(pending.torrents[0].file_catalog_id.is_none());
        let request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "pending-download-all".into(),
            expected_revision: None,
            command: Command::DownloadAllPendingAdd {
                torrent_id: torrent_id.clone(),
                disable_future: false,
            },
        };
        // A failed durable write must leave the pending choice and source ranges intact.
        store
            .connection
            .execute_batch(
                "CREATE TRIGGER reject_pending_all BEFORE UPDATE ON torrents
            BEGIN SELECT RAISE(ABORT, 'injected pending write failure'); END;",
            )
            .unwrap();
        let before_failure = store.revision().unwrap();
        let failed = store.handle_durable(&request).unwrap();
        assert!(matches!(
            failed.outcome,
            crate::ResponseOutcome::Error { .. }
        ));
        assert_eq!(store.revision().unwrap(), before_failure);
        assert_eq!(
            store.snapshot().unwrap().torrents[0].selection_default,
            FilePriority::Skip
        );
        assert!(store.snapshot().unwrap().torrents[0].awaiting_file_selection);
        store
            .connection
            .execute_batch("DROP TRIGGER reject_pending_all")
            .unwrap();
        assert_eq!(store.handle_durable(&request).unwrap(), failed);
        assert_eq!(store.revision().unwrap(), before_failure);
        let mut request = request;
        request.request_id = "pending-download-all-retry".into();
        let response = store.handle_durable(&request).unwrap();
        assert!(matches!(
            response.outcome,
            crate::ResponseOutcome::Success { .. }
        ));
        let revision = store.revision().unwrap();
        assert_eq!(store.handle_durable(&request).unwrap(), response);
        assert_eq!(store.revision().unwrap(), revision);
        drop(store);
        let mut store = SessionStore::open(&root, "default", &[configured]).unwrap();
        let snapshot = store.snapshot().unwrap();
        assert!(!snapshot.torrents[0].awaiting_file_selection);
        assert!(snapshot.torrents[0].desired_running);
        assert!(snapshot.storage.show_file_selection);
        assert_eq!(snapshot.torrents[0].selection_default, FilePriority::Normal);
        assert!(snapshot.torrents[0].selection_exceptions.is_empty());
        // Delayed catalog arrival cannot resurrect the magnet's select-only ranges.
        store.record_metadata(&torrent_id, &raw_info).unwrap();
        let resume = store.load_resume(&torrent_id).unwrap();
        assert!(resume.skip_files.is_empty());
        assert!(resume.desired_running);
        let mut all = request.clone();
        let before = store.revision().unwrap();
        all.request_id = "reject-existing-all".into();
        let rejected = store.handle_durable(&all).unwrap();
        assert!(matches!(
            rejected.outcome,
            crate::ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::InvalidTorrentState,
                    ..
                }
            }
        ));
        assert_eq!(store.revision().unwrap(), before);
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn download_all_pending_add_disables_future_selection_atomically() {
        let root = test_root("pending-all-disable-future");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).unwrap();
        let mut add = add_request("pending-all-disable-add");
        if let Command::AddMagnet {
            skip_files,
            await_file_selection,
            ..
        } = &mut add.command
        {
            skip_files.clear();
            *await_file_selection = true;
        }
        let torrent_id = added_torrent_id(&store.handle_durable(&add).unwrap());
        assert!(
            store.snapshot().unwrap().torrents[0]
                .file_catalog_id
                .is_none()
        );
        let mut request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "pending-all-disable".into(),
            expected_revision: None,
            command: Command::DownloadAllPendingAdd {
                torrent_id,
                disable_future: true,
            },
        };
        // The preference is written last; its failure must also roll back the add.
        store
            .connection
            .execute_batch(
                "CREATE TRIGGER reject_preference BEFORE UPDATE ON storage_settings
            BEGIN SELECT RAISE(ABORT, 'injected preference write failure'); END;",
            )
            .unwrap();
        let before_failure = store.revision().unwrap();
        let failed = store.handle_durable(&request).unwrap();
        assert!(matches!(
            failed.outcome,
            crate::ResponseOutcome::Error { .. }
        ));
        assert_eq!(store.revision().unwrap(), before_failure);
        let snapshot = store.snapshot().unwrap();
        assert!(snapshot.torrents[0].awaiting_file_selection);
        assert!(!snapshot.torrents[0].desired_running);
        assert!(snapshot.storage.show_file_selection);
        store
            .connection
            .execute_batch("DROP TRIGGER reject_preference")
            .unwrap();
        request.request_id = "pending-all-disable-retry".into();
        let response = store.handle_durable(&request).unwrap();
        assert!(matches!(
            response.outcome,
            crate::ResponseOutcome::Success { .. }
        ));
        drop(store);
        let store = SessionStore::open(&root, "default", &[configured]).unwrap();
        let snapshot = store.snapshot().unwrap();
        assert!(!snapshot.torrents[0].awaiting_file_selection);
        assert!(snapshot.torrents[0].desired_running);
        assert!(!snapshot.storage.show_file_selection);
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pending_add_selection_confirms_atomically_and_survives_reopen() {
        let root = test_root("pending-add-selection");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", std::slice::from_ref(&configured))
            .expect("open store");
        let source = multi_file_torrent_source(3);
        let mut request = torrent_bytes_request("pending-add", &source);
        request.start_content = true;
        request.await_file_selection = true;
        let added = store
            .handle_torrent_bytes(&request, source)
            .expect("add pending torrent");
        let torrent_id = added_torrent_id(&added);
        let pending = store.snapshot().expect("pending snapshot");
        let torrent = &pending.torrents[0];
        assert!(torrent.awaiting_file_selection);
        assert!(!torrent.desired_running);
        assert_eq!(torrent.pending_file_selection_position, Some(1));
        assert_eq!(torrent.selectable_file_count, 3);
        assert_eq!(torrent.selected_file_count, 3);
        let catalog_id = torrent.file_catalog_id.clone().expect("catalog identity");

        let bypass = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pending-resume".to_owned(),
                expected_revision: None,
                command: Command::Resume {
                    torrent_id: torrent_id.clone(),
                },
            })
            .expect("typed resume response");
        assert!(matches!(
            bypass.outcome,
            crate::ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::InvalidTorrentState,
                    ..
                }
            }
        ));

        let confirmation = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "confirm-pending".to_owned(),
            expected_revision: None,
            command: Command::ConfirmPendingFileSelection {
                torrent_id: torrent_id.clone(),
                catalog_id,
                base: crate::PendingFileSelectionBase::All,
                overrides: vec![crate::FileSelectionOverride {
                    range: crate::FileIndexRange {
                        start: 1,
                        end_exclusive: 3,
                    },
                    selected: false,
                }],
                disable_future: true,
            },
        };
        let confirmed = store
            .handle_durable(&confirmation)
            .expect("confirm selection");
        assert!(matches!(
            confirmed.outcome,
            crate::ResponseOutcome::Success { .. }
        ));
        let snapshot = store.snapshot().expect("confirmed snapshot");
        assert!(!snapshot.torrents[0].awaiting_file_selection);
        assert!(snapshot.torrents[0].desired_running);
        assert_eq!(snapshot.torrents[0].skip_files, [1, 2]);
        assert!(!snapshot.storage.show_file_selection);

        drop(store);
        let reopened = SessionStore::open(&root, "default", &[configured]).expect("reopen store");
        let snapshot = reopened.snapshot().expect("reopened snapshot");
        assert!(!snapshot.torrents[0].awaiting_file_selection);
        assert_eq!(snapshot.torrents[0].skip_files, [1, 2]);
        assert!(!snapshot.storage.show_file_selection);
        drop(reopened);
        fs::remove_dir_all(root).expect("remove profile");
    }

    #[test]
    fn disabling_file_selection_releases_queued_adds_with_their_selection() {
        let root = test_root("pending-add-release-queue");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", std::slice::from_ref(&configured))
            .expect("open store");
        let add_pending = |store: &mut SessionStore, request_id: &str, file_count: u32| {
            let source = multi_file_torrent_source(file_count);
            let mut request = torrent_bytes_request(request_id, &source);
            request.await_file_selection = true;
            added_torrent_id(
                &store
                    .handle_torrent_bytes(&request, source)
                    .expect("add pending torrent"),
            )
        };
        let current = add_pending(&mut store, "pending-current", 2);
        let queued = add_pending(&mut store, "pending-queued", 3);
        let mut magnet = add_request("pending-select-only");
        if let Command::AddMagnet {
            magnet,
            skip_files,
            await_file_selection,
            ..
        } = &mut magnet.command
        {
            *magnet = format!("magnet:?xt=urn:btih:{}&so=1", "ab".repeat(20));
            skip_files.clear();
            *await_file_selection = true;
        }
        let select_only = added_torrent_id(&store.handle_durable(&magnet).unwrap());
        let cancelled = add_pending(&mut store, "pending-cancelled", 4);
        let cancel = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "cancel-pending".to_owned(),
                expected_revision: None,
                command: Command::CancelPendingAdd {
                    torrent_id: cancelled.clone(),
                },
            })
            .expect("cancel pending add");
        assert!(matches!(
            cancel.outcome,
            crate::ResponseOutcome::Success { .. }
        ));
        let catalog_id = store
            .snapshot()
            .unwrap()
            .torrents
            .into_iter()
            .find(|torrent| torrent.torrent_id == current)
            .and_then(|torrent| torrent.file_catalog_id)
            .expect("catalog identity");

        let confirmed = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "confirm-none-disable".to_owned(),
                expected_revision: None,
                command: Command::ConfirmPendingFileSelection {
                    torrent_id: current.clone(),
                    catalog_id,
                    base: crate::PendingFileSelectionBase::None,
                    overrides: Vec::new(),
                    disable_future: true,
                },
            })
            .expect("confirm selection");
        assert!(matches!(
            confirmed.outcome,
            crate::ResponseOutcome::Success { .. }
        ));

        drop(store);
        let store = SessionStore::open(&root, "default", &[configured]).expect("reopen store");
        let snapshot = store.snapshot().expect("released snapshot");
        assert!(!snapshot.storage.show_file_selection);
        let find = |torrent_id: &str| {
            snapshot
                .torrents
                .iter()
                .find(|torrent| torrent.torrent_id == torrent_id)
                .expect("torrent in snapshot")
        };
        // The confirmed torrent keeps its own choice; queued torrents keep
        // their add-time selection rather than inheriting it.
        assert_eq!(find(&current).selection_default, FilePriority::Skip);
        let released = find(&queued);
        assert!(!released.awaiting_file_selection);
        assert!(released.desired_running);
        assert_eq!(released.selection_default, FilePriority::Normal);
        assert!(released.skip_files.is_empty());
        let released = find(&select_only);
        assert!(!released.awaiting_file_selection);
        assert!(released.desired_running);
        assert_eq!(released.selection_default, FilePriority::Skip);
        let pending_ranges: i64 = store
            .connection
            .query_row(
                "SELECT count(*) FROM pending_selection_ranges WHERE torrent_id = ?1",
                [super::decode_torrent_id(&select_only).unwrap().as_bytes()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pending_ranges, 1);
        // Released adds join the download queue in add order.
        let order: Vec<_> = [&current, &queued, &select_only]
            .into_iter()
            .map(|torrent_id| find(torrent_id).download_queue_position.expect("queued"))
            .collect();
        assert!(order[0] < order[1] && order[1] < order[2]);
        // A torrent already being removed is never revived.
        let cancelled_pending: bool = store
            .connection
            .query_row(
                "SELECT awaiting_file_selection FROM torrents WHERE torrent_id = ?1",
                [super::decode_torrent_id(&cancelled).unwrap().as_bytes()],
                |row| row.get(0),
            )
            .unwrap();
        assert!(cancelled_pending);
        drop(store);
        fs::remove_dir_all(root).expect("remove profile");
    }

    #[test]
    fn select_only_exception_budget_rejects_metadata_atomically() {
        let root = test_root("select-only-budget");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open store");
        let source =
            multi_file_torrent_source((crate::control::MAX_FILE_SELECTION_ENTRIES + 1) as u32);
        let projection =
            Metainfo::project_bytes_with_limits(&source, EXPLICIT_IMPORT_METAINFO_LIMITS)
                .expect("bounded metainfo");
        let raw_info = &source[projection.info_span];
        let torrent_id = crate::control::encode_info_hash(projection.metainfo.info_hash);
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "select-budget".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!(
                        "magnet:?xt=urn:btih:{torrent_id}&so=0-{}",
                        crate::control::MAX_FILE_SELECTION_ENTRIES
                    ),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("persist compact pending range");
        let torrent_id = only_torrent_id(&store);
        let revision = store.revision().expect("add revision");
        assert!(matches!(
            store.record_metadata(&torrent_id, raw_info),
            Err(StoreError::ResourceLimit {
                resource: "file selection exceptions",
                ..
            })
        ));
        assert_eq!(store.revision().expect("unchanged revision"), revision);
        assert!(!store.snapshot().expect("pending snapshot").torrents[0].metadata_available);
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn all_skipped_idles_running_intent_and_normal_resumes_without_recheck() {
        let root = test_root("all-skipped");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open store");
        let raw_info = multi_file_info();
        let torrent_id = crate::control::encode_info_hash(Sha1::digest(&raw_info).into());
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "running-add".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add running torrent");
        let torrent_id = only_torrent_id(&store);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record metadata");
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "skip-all".to_owned(),
                expected_revision: None,
                command: Command::SetFilePriority {
                    torrent_id: torrent_id.clone(),
                    file_indices: vec![0, 1],
                    priority: FilePriority::Skip,
                },
            })
            .expect("skip all files");
        let idle = store
            .load_resume(&torrent_id)
            .expect("load all-skipped state");
        assert!(idle.desired_running);
        assert_eq!(idle.state, TorrentState::Paused);
        assert_eq!(idle.skip_files, vec![0, 1]);
        assert!(!idle.verification.is_pending());
        let verification_generation = idle.verification.requested();

        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "normal-one".to_owned(),
                expected_revision: None,
                command: Command::SetFilePriority {
                    torrent_id: torrent_id.clone(),
                    file_indices: vec![1],
                    priority: FilePriority::Normal,
                },
            })
            .expect("restore normal priority");
        let resumed = store.load_resume(&torrent_id).expect("load resumed state");
        assert!(resumed.desired_running);
        assert_eq!(resumed.state, TorrentState::Downloading);
        assert_eq!(resumed.skip_files, vec![0]);
        assert_eq!(resumed.verification.requested(), verification_generation);
        assert!(!resumed.verification.is_pending());
        drop(store);
        fs::remove_dir_all(root).expect("remove profile");
    }

    #[test]
    fn download_files_commits_one_replay_safe_wanted_and_running_revision() {
        let root = test_root("download-files-atomic");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", std::slice::from_ref(&configured))
            .expect("open store");
        let raw_info = multi_file_info();
        let torrent_id = crate::control::encode_info_hash(Sha1::digest(&raw_info).into());
        let added = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "download-files-add".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}"),
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: vec![0, 1],
                },
            })
            .expect("add paused all-skipped torrent");
        let torrent_id = added_torrent_id(&added);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record metadata");
        let before = store.load_resume(&torrent_id).expect("load paused intent");
        let revision_before = store.revision().expect("load revision");
        let verification_before = before.verification;
        assert!(!before.desired_running);
        assert_eq!(before.skip_files, [0, 1]);

        let request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "download-files".to_owned(),
            expected_revision: Some(revision_before.to_string()),
            command: Command::DownloadFiles {
                torrent_id: torrent_id.clone(),
                file_indices: vec![1],
            },
        };
        let first = store
            .handle_durable(&request)
            .expect("download skipped file");
        assert!(matches!(first.outcome, ResponseOutcome::Success { .. }));
        assert_eq!(
            first.revision.parse::<u64>().expect("response revision"),
            revision_before + 1
        );
        let running = store.load_resume(&torrent_id).expect("load running intent");
        assert!(running.desired_running);
        assert_eq!(running.skip_files, [0]);
        assert!(running.download_queue_position.is_some());
        assert_eq!(running.verification, verification_before);

        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pause-after-download".to_owned(),
                expected_revision: None,
                command: Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            })
            .expect("pause after download request");
        let revision_after_pause = store.revision().expect("paused revision");
        assert_eq!(store.handle_durable(&request).expect("exact replay"), first);
        let replayed = store.load_resume(&torrent_id).expect("load after replay");
        assert!(!replayed.desired_running);
        assert_eq!(replayed.skip_files, [0]);
        assert_eq!(
            store.revision().expect("replay revision"),
            revision_after_pause
        );

        let stale = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "download-files-stale".to_owned(),
                expected_revision: Some(revision_before.to_string()),
                command: Command::DownloadFiles {
                    torrent_id: torrent_id.clone(),
                    file_indices: vec![0],
                },
            })
            .expect("reject stale download");
        assert!(matches!(
            stale.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::StaleRevision,
                    ..
                }
            }
        ));
        let after_stale = store.load_resume(&torrent_id).expect("load after stale");
        assert!(!after_stale.desired_running);
        assert_eq!(after_stale.skip_files, [0]);

        let wanted_paused_revision = store.revision().expect("wanted paused revision");
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "download-wanted-paused".to_owned(),
                expected_revision: None,
                command: Command::DownloadFiles {
                    torrent_id: torrent_id.clone(),
                    file_indices: vec![1],
                },
            })
            .expect("start already wanted file");
        assert_eq!(
            store.revision().expect("wanted running revision"),
            wanted_paused_revision + 1
        );
        let no_op_revision = store.revision().expect("no-op baseline");
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "download-wanted-running".to_owned(),
                expected_revision: None,
                command: Command::DownloadFiles {
                    torrent_id: torrent_id.clone(),
                    file_indices: vec![1],
                },
            })
            .expect("accept wanted running no-op");
        assert_eq!(store.revision().expect("unchanged no-op"), no_op_revision);

        for (request_id, command) in [
            (
                "pause-before-archive",
                Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            ),
            (
                "archive-before-download",
                Command::Archive {
                    torrent_id: torrent_id.clone(),
                },
            ),
        ] {
            store
                .handle_durable(&RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: request_id.to_owned(),
                    expected_revision: None,
                    command,
                })
                .expect("prepare archived torrent");
        }
        let archived_revision = store.revision().expect("archived revision");
        let archived = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "download-archived".to_owned(),
                expected_revision: None,
                command: Command::DownloadFiles {
                    torrent_id: torrent_id.clone(),
                    file_indices: vec![0],
                },
            })
            .expect("reject archived download");
        assert!(matches!(
            archived.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::InvalidTorrentState,
                    ..
                }
            }
        ));
        let after_archived = store
            .load_resume(&torrent_id)
            .expect("load rejected archived intent");
        assert!(!after_archived.desired_running);
        assert_eq!(after_archived.skip_files, [0]);
        assert_eq!(after_archived.verification, verification_before);
        assert_eq!(
            store.revision().expect("unchanged archived"),
            archived_revision
        );

        drop(store);
        let reopened = SessionStore::open(&root, "default", &[configured]).expect("reopen store");
        let reopened_resume = reopened
            .load_resume(&torrent_id)
            .expect("load reopened intent");
        assert!(!reopened_resume.desired_running);
        assert_eq!(reopened_resume.skip_files, [0]);
        assert_eq!(
            reopened.revision().expect("reopened revision"),
            archived_revision
        );
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn creates_reopens_and_refuses_newer_schema() {
        let root = test_root("schema");
        let configured = configured_root(&root);
        let store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");
        assert_eq!(store.revision().expect("revision"), 0);
        let database_path = store
            .database_path()
            .expect("durable database path")
            .to_owned();
        drop(store);

        let store = SessionStore::open(&root, "default", std::slice::from_ref(&configured))
            .expect("reopen");
        assert_eq!(store.revision().expect("revision"), 0);
        drop(store);

        let connection = Connection::open(database_path).expect("open raw database");
        connection
            .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .expect("set newer version");
        drop(connection);
        assert!(matches!(
            SessionStore::open(&root, "default", &[configured]),
            Err(StoreError::UnsupportedSchema { .. })
        ));
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn seed_stop_limits_persist_stop_and_keep_seeding_atomically() {
        let root = test_root("seed-stop-store");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");
        let added = store
            .handle_durable(&add_request("seed-stop-owner"))
            .expect("add torrent");
        let torrent_id = added_torrent_id(&added);
        let update = |request_id: &str, patch: crate::TorrentSettingsPatch| RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            command: Command::UpdateTorrentSettings {
                torrent_id: torrent_id.clone(),
                patch,
            },
        };
        let own = crate::TorrentSeedStopLimits {
            ratio_percent: crate::TorrentSeedStopLimit::Limited { value: 150 },
            time_seconds: crate::TorrentSeedStopLimit::Off,
        };
        let response = store
            .handle_durable(&update(
                "own-stop-limits",
                crate::TorrentSettingsPatch {
                    seed_stop_ratio_percent: Some(own.ratio_percent),
                    seed_stop_time_seconds: Some(own.time_seconds),
                    ..Default::default()
                },
            ))
            .expect("set stop limits");
        assert!(matches!(response.outcome, ResponseOutcome::Success { .. }));
        assert_eq!(store.snapshot().unwrap().torrents[0].seed_stop_limits, own);
        let invalid = store
            .handle_durable(&update(
                "invalid-stop-limit",
                crate::TorrentSettingsPatch {
                    seed_stop_time_seconds: Some(crate::TorrentSeedStopLimit::Limited {
                        value: u32::MAX,
                    }),
                    ..Default::default()
                },
            ))
            .expect("reject invalid limit");
        assert!(matches!(invalid.outcome, ResponseOutcome::Error { .. }));
        assert_eq!(store.snapshot().unwrap().torrents[0].seed_stop_limits, own);

        // Running torrents stop once; a paused one is not eligible.
        assert!(store.stop_at_seed_limit(&torrent_id).expect("stop"));
        assert!(
            !store
                .stop_at_seed_limit(&torrent_id)
                .expect("already stopped")
        );
        let stopped = &store.snapshot().unwrap().torrents[0];
        assert!(!stopped.desired_running && stopped.seed_limit_stopped);
        drop(store);

        let mut store = SessionStore::open(&root, "default", std::slice::from_ref(&configured))
            .expect("reopen");
        assert!(store.snapshot().unwrap().torrents[0].seed_limit_stopped);
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "keep-seeding".to_owned(),
                expected_revision: None,
                command: Command::Resume {
                    torrent_id: torrent_id.clone(),
                },
            })
            .expect("keep seeding");
        let kept = &store.snapshot().unwrap().torrents[0];
        assert!(kept.desired_running && !kept.seed_limit_stopped);
        assert_eq!(
            kept.seed_stop_limits,
            crate::TorrentSeedStopLimits {
                ratio_percent: crate::TorrentSeedStopLimit::Off,
                time_seconds: crate::TorrentSeedStopLimit::Off,
            }
        );

        // A user pause is never marked as a limit stop, and its resume keeps
        // the torrent's own limits.
        for (request_id, command) in [
            (
                "own-limits-again",
                Command::UpdateTorrentSettings {
                    torrent_id: torrent_id.clone(),
                    patch: crate::TorrentSettingsPatch {
                        seed_stop_ratio_percent: Some(own.ratio_percent),
                        ..Default::default()
                    },
                },
            ),
            (
                "user-pause",
                Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            ),
            (
                "user-resume",
                Command::Resume {
                    torrent_id: torrent_id.clone(),
                },
            ),
        ] {
            store
                .handle_durable(&RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: request_id.to_owned(),
                    expected_revision: None,
                    command,
                })
                .expect(request_id);
        }
        let resumed = &store.snapshot().unwrap().torrents[0];
        assert!(resumed.desired_running && !resumed.seed_limit_stopped);
        assert_eq!(
            resumed.seed_stop_limits.ratio_percent,
            crate::TorrentSeedStopLimit::Limited { value: 150 }
        );

        // The catalog refuses a limit stop on a running torrent.
        assert!(
            store
                .connection
                .execute("UPDATE torrents SET seed_limit_stopped = 1", [])
                .is_err()
        );
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn current_schema_enforces_owner_and_full_alias_authority() {
        let mut store = SessionStore::open_ephemeral(
            "identity-schema",
            &[ConfiguredStorageRoot::platform("downloads")],
        )
        .expect("open current schema");
        let added = store
            .handle_durable(&add_request("identity-owner"))
            .expect("add owner");
        let owner = super::decode_torrent_id(&added_torrent_id(&added)).expect("owner ID");
        let stored_v1: Vec<u8> = store
            .connection
            .query_row(
                "SELECT full_hash FROM torrent_identities
                 WHERE torrent_id = ?1 AND protocol = 'v1'",
                [owner.as_bytes().as_slice()],
                |row| row.get(0),
            )
            .expect("v1 alias");
        assert_eq!(stored_v1.len(), 20);

        store
            .connection
            .execute(
                "INSERT INTO torrent_identities(torrent_id, protocol, full_hash)
                 VALUES (?1, 'v2', ?2)",
                rusqlite::params![owner.as_bytes().as_slice(), [7_u8; 32].as_slice()],
            )
            .expect("attach second protocol alias");
        assert!(
            store
                .connection
                .execute(
                    "INSERT INTO torrent_identities(torrent_id, protocol, full_hash)
                     VALUES (?1, 'v2', ?2)",
                    rusqlite::params![owner.as_bytes().as_slice(), [8_u8; 32].as_slice()],
                )
                .is_err()
        );
        assert!(
            store
                .connection
                .execute(
                    "INSERT INTO torrents(
                        torrent_id, storage_root, desired_state,
                        created_revision, updated_revision
                     ) VALUES (zeroblob(16), 'downloads', 'paused', 0, 0)",
                    [],
                )
                .is_err()
        );
        let second = [9_u8; 16];
        store
            .connection
            .execute(
                "INSERT INTO torrents(
                    torrent_id, storage_root, desired_state,
                    created_revision, updated_revision
                 ) VALUES (?1, 'downloads', 'paused', 0, 0)",
                [second.as_slice()],
            )
            .expect("second owner");
        assert!(
            store
                .connection
                .execute(
                    "INSERT INTO torrent_identities(torrent_id, protocol, full_hash)
                     VALUES (?1, 'v1', ?2)",
                    rusqlite::params![second.as_slice(), stored_v1],
                )
                .is_err()
        );
    }

    #[test]
    fn selected_roots_default_deduplicate_persist_and_block_referenced_removal() {
        let root = test_root("selected-roots");
        let payload = root.join("chosen-payload");
        fs::create_dir_all(&payload).expect("create chosen payload root");
        let payload = fs::canonicalize(&payload).expect("canonical payload root");
        let mut store = SessionStore::open(&root, "default", &[]).expect("open fresh profile");
        let fresh = store.snapshot().expect("fresh snapshot");
        assert!(fresh.storage.roots.is_empty());
        assert_eq!(fresh.storage.default_root, None);
        assert!(fresh.storage.show_add_options);

        let (revision, installed) = store
            .install_path_storage_root("root_00000000000000000000000000000000", "Chosen", &payload)
            .expect("install selected root");
        assert_eq!(revision, 1);
        assert_eq!(installed, "root_00000000000000000000000000000000");
        let selected = store.snapshot().expect("selected snapshot");
        assert_eq!(
            selected.storage.default_root.as_deref(),
            Some(installed.as_str())
        );
        assert_eq!(selected.storage.roots.len(), 1);
        assert_eq!(
            selected.storage.roots[0].availability,
            crate::StorageRootAvailability::Available
        );

        let (deduplicated_revision, deduplicated) = store
            .install_path_storage_root("root_11111111111111111111111111111111", "Alias", &payload)
            .expect("deduplicate selected root");
        assert_eq!(deduplicated_revision, revision);
        assert_eq!(deduplicated, installed);

        let mut add = add_request("add-selected-root");
        let Command::AddMagnet { storage_root, .. } = &mut add.command else {
            unreachable!("test request is add magnet")
        };
        *storage_root = installed.clone();
        store.handle_durable(&add).expect("bind torrent to root");
        let removal = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "remove-referenced-root".to_owned(),
                expected_revision: None,
                command: Command::RemoveStorageRoot {
                    storage_root: installed.clone(),
                },
            })
            .expect("referenced removal response");
        assert!(matches!(
            removal.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::StorageRootInUse,
                    ..
                }
            }
        ));
        drop(store);

        let reopened = SessionStore::open(&root, "default", &[]).expect("reopen profile");
        let persisted = reopened.snapshot().expect("persisted root snapshot");
        assert_eq!(
            persisted.storage.default_root.as_deref(),
            Some(installed.as_str())
        );
        assert_eq!(persisted.torrents[0].storage_root, installed);
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn removing_unreferenced_default_root_promotes_next_root_or_none() {
        let root = test_root("remove-default-root");
        let mut store = SessionStore::open(&root, "default", &[]).expect("open fresh profile");
        let mut paths = Vec::new();
        for name in ["first", "second"] {
            let path = root.join(name);
            fs::create_dir_all(&path).expect("create payload root");
            paths.push(fs::canonicalize(&path).expect("canonical payload root"));
        }
        let (_, first) = store
            .install_path_storage_root("root_00000000000000000000000000000000", "First", &paths[0])
            .expect("install first root");
        let (_, second) = store
            .install_path_storage_root("root_11111111111111111111111111111111", "Second", &paths[1])
            .expect("install second root");
        let remove = |request_id: &str, storage_root: &str| RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            command: Command::RemoveStorageRoot {
                storage_root: storage_root.to_owned(),
            },
        };

        let removed = store
            .handle_durable(&remove("remove-default", &first))
            .expect("default removal response");
        assert!(matches!(removed.outcome, ResponseOutcome::Success { .. }));
        let promoted = store.snapshot().expect("promoted snapshot");
        assert_eq!(promoted.storage.roots.len(), 1);
        assert_eq!(
            promoted.storage.default_root.as_deref(),
            Some(second.as_str())
        );

        let removed = store
            .handle_durable(&remove("remove-last", &second))
            .expect("last removal response");
        assert!(matches!(removed.outcome, ResponseOutcome::Success { .. }));
        drop(store);

        let reopened = SessionStore::open(&root, "default", &[]).expect("reopen profile");
        let persisted = reopened.snapshot().expect("persisted snapshot");
        assert!(persisted.storage.roots.is_empty());
        assert_eq!(persisted.storage.default_root, None);
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn platform_roots_install_repair_and_change_default_without_rebinding() {
        let root = test_root("platform-root-registry");
        let mut store = SessionStore::open(&root, "default", &[]).expect("open fresh profile");
        assert_eq!(
            store
                .install_platform_storage_root("root_a", "Folder A", false)
                .expect("install first platform root"),
            1
        );
        assert_eq!(
            store
                .install_platform_storage_root("root_b", "Folder B", true)
                .expect("install current platform root"),
            2
        );
        let snapshot = store.snapshot().expect("platform root snapshot");
        assert_eq!(snapshot.storage.roots.len(), 2);
        assert_eq!(snapshot.storage.default_root.as_deref(), Some("root_b"));

        let mut add = add_request("add-platform-a");
        let Command::AddMagnet { storage_root, .. } = &mut add.command else {
            unreachable!("test request is add magnet")
        };
        *storage_root = "root_a".to_owned();
        store
            .handle_durable(&add)
            .expect("bind existing torrent to first root");
        assert_eq!(
            store
                .repair_platform_storage_root("root_a", "Repaired A")
                .expect("repair platform root label"),
            4
        );
        assert_eq!(
            store
                .install_platform_storage_root("root_b", "Folder B", true)
                .expect("idempotent current root"),
            4
        );
        let repaired = store.snapshot().expect("repaired snapshot");
        assert_eq!(repaired.storage.default_root.as_deref(), Some("root_b"));
        assert_eq!(
            repaired
                .storage
                .roots
                .iter()
                .find(|candidate| candidate.root_id == "root_a")
                .expect("first root")
                .label,
            "Repaired A"
        );
        assert_eq!(repaired.torrents[0].storage_root, "root_a");
        drop(store);

        let reopened = SessionStore::open(&root, "default", &[]).expect("reopen profile");
        let persisted = reopened.snapshot().expect("persisted platform roots");
        assert_eq!(persisted.storage.roots.len(), 2);
        assert_eq!(persisted.storage.default_root.as_deref(), Some("root_b"));
        assert_eq!(persisted.torrents[0].storage_root, "root_a");
        drop(reopened);
        fs::remove_dir_all(root).expect("remove platform root profile");
    }

    #[test]
    fn missing_selected_root_reopens_unavailable_without_recreation() {
        let root = test_root("unavailable-root");
        let payload = root.join("removable-payload");
        fs::create_dir_all(&payload).expect("create selected root");
        let payload = fs::canonicalize(&payload).expect("canonical selected root");
        let mut store = SessionStore::open(&root, "default", &[]).expect("open fresh profile");
        store
            .install_path_storage_root(
                "root_22222222222222222222222222222222",
                "Removable",
                &payload,
            )
            .expect("install selected root");
        drop(store);
        fs::remove_dir(&payload).expect("make selected root unavailable");

        let reopened = SessionStore::open(&root, "default", &[]).expect("reopen profile");
        let snapshot = reopened.snapshot().expect("unavailable root snapshot");
        assert_eq!(snapshot.storage.roots.len(), 1);
        assert_eq!(
            snapshot.storage.roots[0].availability,
            crate::StorageRootAvailability::Unavailable
        );
        assert!(!payload.exists());
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn dht_snapshot_round_trips_and_rejects_corrupt_rows() {
        let root = test_root("dht-state");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");
        assert_eq!(store.load_dht_snapshot().expect("empty state"), None);
        let snapshot = DhtSnapshot {
            version: DHT_SNAPSHOT_VERSION,
            identities_v4: vec![DhtIdentity {
                address: IpAddr::V4(Ipv4Addr::LOCALHOST),
                node_id: NodeId([1; 20]),
            }],
            identities_v6: vec![DhtIdentity {
                address: IpAddr::V6(Ipv6Addr::LOCALHOST),
                node_id: NodeId([6; 20]),
            }],
            nodes_v4: vec![NodeContact {
                id: NodeId([2; 20]),
                address: DhtEndpoint::new(DhtIp::V4([127, 0, 0, 1]), 6881),
            }],
            nodes_v6: Vec::new(),
        };
        store
            .save_dht_snapshot(snapshot.clone())
            .expect("save DHT state");
        assert_eq!(
            store.load_dht_snapshot().expect("load DHT state"),
            Some(snapshot)
        );
        let database = store
            .database_path()
            .expect("durable database path")
            .to_owned();
        drop(store);
        let connection = Connection::open(&database).expect("inspect database");
        connection
            .execute(
                "UPDATE dht_state SET format_version = 99 WHERE singleton = 1",
                [],
            )
            .expect("corrupt version");
        drop(connection);
        let store = SessionStore::open(&root, "default", &[configured]).expect("reopen");
        assert!(matches!(
            store.load_dht_snapshot(),
            Err(StoreError::DurableState(_))
        ));
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn durable_geometry_and_resource_limits_are_exact() {
        let root = test_root("durable-resource-limits");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open store");
        let raw_info = single_file_info_for_pieces(40_960, 256 * 1024);
        let torrent_id = crate::control::encode_info_hash(Sha1::digest(&raw_info).into());
        let added = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-large-geometry".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}"),
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add geometry");
        let torrent_id = added_torrent_id(&added);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("persist 40,960-piece geometry");
        assert_eq!(
            store
                .load_resume(&torrent_id)
                .expect("load geometry")
                .have
                .expect("have state")
                .pieces()
                .len(),
            40_960
        );

        assert_eq!(
            super::bounded_piece_count(MAX_DURABLE_PIECES as i64).expect("exact piece limit"),
            MAX_DURABLE_PIECES
        );
        assert!(matches!(
            super::bounded_piece_count((MAX_DURABLE_PIECES + 1) as i64),
            Err(StoreError::ResourceLimit {
                resource: "piece count",
                actual,
                maximum,
            }) if actual == MAX_DURABLE_PIECES + 1 && maximum == MAX_DURABLE_PIECES
        ));
        super::validate_have_state_length(&vec![0; MAX_DURABLE_HAVE_STATE_BYTES])
            .expect("exact have-state limit");
        assert!(matches!(
            super::validate_have_state_length(&vec![0; MAX_DURABLE_HAVE_STATE_BYTES + 1]),
            Err(StoreError::ResourceLimit {
                resource: "have-state bytes",
                actual,
                maximum,
            }) if actual == MAX_DURABLE_HAVE_STATE_BYTES + 1
                && maximum == MAX_DURABLE_HAVE_STATE_BYTES
        ));

        let revision = store.revision().expect("revision before rejection");
        let oversized = vec![0; super::DURABLE_METAINFO_LIMITS.max_info_bytes + 1];
        assert!(matches!(
            store.record_metadata(&torrent_id, &oversized),
            Err(StoreError::ResourceLimit {
                resource: "raw_info bytes",
                actual,
                maximum,
            }) if actual == oversized.len()
                && maximum == super::DURABLE_METAINFO_LIMITS.max_info_bytes
        ));
        assert_eq!(store.revision().expect("unchanged revision"), revision);

        let database_path = store
            .database_path()
            .expect("durable database path")
            .to_owned();
        drop(store);
        let connection = Connection::open(database_path).expect("inspect exact schema bounds");
        let exact_id = [0x55_u8; 16];
        let exact_have = vec![0_u8; MAX_DURABLE_HAVE_STATE_BYTES];
        connection
            .execute(
                "INSERT INTO torrents(
                    torrent_id, magnet, storage_root, desired_state,
                    raw_info, content_fingerprint, piece_count, have_state, archived,
                    created_revision, updated_revision
                 ) VALUES (
                    ?1, 'magnet:', 'downloads', 'paused',
                    x'', zeroblob(32), ?2, ?3, 0, 0, 0
                 )",
                rusqlite::params![exact_id.as_slice(), MAX_DURABLE_PIECES as i64, exact_have],
            )
            .expect("schema accepts exact durable bounds");
        assert!(
            connection
                .execute(
                    "UPDATE torrents SET piece_count = ?1 WHERE torrent_id = ?2",
                    rusqlite::params![(MAX_DURABLE_PIECES + 1) as i64, exact_id.as_slice()],
                )
                .is_err()
        );
        assert!(
            connection
                .execute(
                    "UPDATE torrents SET have_state = ?1 WHERE torrent_id = ?2",
                    rusqlite::params![
                        vec![0_u8; MAX_DURABLE_HAVE_STATE_BYTES + 1],
                        exact_id.as_slice()
                    ],
                )
                .is_err()
        );
        drop(connection);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn corrupt_database_is_reported_without_recreation() {
        let root = test_root("corrupt-database");
        fs::create_dir_all(&root).expect("create profile root");
        let database = root.join("session.db");
        let corrupt = b"not a SQLite database";
        fs::write(&database, corrupt).expect("write corrupt database");
        let configured = configured_root(&root);
        assert!(matches!(
            SessionStore::open(&root, "default", &[configured]),
            Err(StoreError::UnsafeProfileFile { .. })
        ));
        assert_eq!(
            fs::read(database).expect("read preserved corrupt database"),
            corrupt
        );
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn deduplicates_mutations_and_rejects_conflicts_and_stale_revisions() {
        let root = test_root("receipts");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", &[configured]).expect("open session store");
        let request = add_request("add-1");
        let first = store.handle_durable(&request).expect("add");
        let torrent_id = added_torrent_id(&first);
        assert_eq!(first.revision, "1");
        assert_eq!(store.handle_durable(&request).expect("retry"), first);

        let mut conflict = request.clone();
        conflict.command = Command::Pause { torrent_id };
        assert!(matches!(
            store.handle_durable(&conflict).expect("conflict").outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::RequestConflict,
                    ..
                }
            }
        ));

        let stale = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "pause-stale".to_owned(),
            expected_revision: Some("0".to_owned()),
            command: conflict.command,
        };
        assert!(matches!(
            store.handle_durable(&stale).expect("stale").outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::StaleRevision,
                    ..
                }
            }
        ));
        assert_eq!(store.revision().expect("unchanged revision"), 1);
        drop(store);

        let mut reopened =
            SessionStore::open(&root, "default", &[]).expect("reopen without active root mapping");
        assert_eq!(
            reopened.handle_durable(&request).expect("durable retry"),
            first
        );
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn archive_persists_paused_intent_and_blocks_starting_until_restored() {
        let root = test_root("archive-paused");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");
        let added = store
            .handle_durable(&add_request("add-archive"))
            .expect("add torrent");
        let torrent_id = added_torrent_id(&added);
        assert!(
            store
                .load_resume(&torrent_id)
                .expect("resume")
                .desired_running
        );
        let request = |request_id: &str, command: Command| RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            command,
        };
        let id = || torrent_id.clone();

        store
            .handle_durable(&request("archive", Command::Archive { torrent_id: id() }))
            .expect("archive");
        let archived_revision = store.revision().expect("archived revision");
        let resume = store.load_resume(&torrent_id).expect("archived resume");
        assert!(!resume.desired_running);
        assert!(store.snapshot().expect("snapshot").torrents[0].archived);

        for (request_id, command) in [
            // DownloadFiles on an archived torrent with metadata is covered by
            // download_files_commits_one_replay_safe_wanted_and_running_revision.
            ("resume", Command::Resume { torrent_id: id() }),
            ("move-top", Command::MoveDownloadToTop { torrent_id: id() }),
        ] {
            let response = store
                .handle_durable(&request(request_id, command))
                .expect("durable response");
            assert!(
                matches!(
                    response.outcome,
                    ResponseOutcome::Error {
                        ref error,
                    } if error.code == ErrorCode::InvalidTorrentState
                        && (error.message.contains("archived")
                            || error.message.contains("queue movement"))
                ),
                "{request_id} must be rejected while archived: {:?}",
                response.outcome
            );
        }
        assert_eq!(store.revision().expect("unchanged"), archived_revision);
        assert!(
            !store
                .load_resume(&torrent_id)
                .expect("resume")
                .desired_running
        );

        store
            .handle_durable(&request(
                "restore",
                Command::RestoreArchive { torrent_id: id() },
            ))
            .expect("restore");
        assert!(!store.snapshot().expect("snapshot").torrents[0].archived);
        assert!(
            !store
                .load_resume(&torrent_id)
                .expect("resume")
                .desired_running
        );
        store
            .handle_durable(&request("start", Command::Resume { torrent_id: id() }))
            .expect("start after restore");
        assert!(
            store
                .load_resume(&torrent_id)
                .expect("resume")
                .desired_running
        );
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn archive_rejects_pending_file_selection() {
        let root = test_root("archive-pending");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open");
        let mut add = add_request("add-pending");
        if let Command::AddMagnet {
            await_file_selection,
            skip_files,
            ..
        } = &mut add.command
        {
            *await_file_selection = true;
            skip_files.clear();
        }
        let torrent_id = added_torrent_id(&store.handle_durable(&add).expect("add pending"));
        let revision = store.revision().expect("revision");
        let response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "archive-pending".to_owned(),
                expected_revision: None,
                command: Command::Archive {
                    torrent_id: torrent_id.clone(),
                },
            })
            .expect("durable response");
        assert!(matches!(
            response.outcome,
            ResponseOutcome::Error { ref error } if error.code == ErrorCode::InvalidTorrentState
        ));
        assert_eq!(store.revision().expect("unchanged"), revision);
        assert!(!store.snapshot().expect("snapshot").torrents[0].archived);
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn open_normalizes_archived_rows_written_before_archive_implied_pause() {
        let root = test_root("archive-normalize");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");
        let running = added_torrent_id(
            &store
                .handle_durable(&add_hash_request("add-running", 0x21))
                .expect("add running"),
        );
        let mut pending_add = add_hash_request("add-pending", 0x22);
        if let Command::AddMagnet {
            await_file_selection,
            ..
        } = &mut pending_add.command
        {
            *await_file_selection = true;
        }
        let pending = added_torrent_id(&store.handle_durable(&pending_add).expect("add pending"));
        let paused = added_torrent_id(
            &store
                .handle_durable(&add_hash_request("add-paused", 0x23))
                .expect("add paused"),
        );
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "archive-paused".to_owned(),
                expected_revision: None,
                command: Command::Archive {
                    torrent_id: paused.clone(),
                },
            })
            .expect("archive paused");
        let database_path = store.database_path().expect("durable path").to_owned();
        drop(store);

        // Simulate rows committed by a build where archive kept running intent.
        let connection = Connection::open(&database_path).expect("open raw database");
        connection
            .execute(
                "UPDATE torrents SET archived = 1 WHERE torrent_id IN (?1, ?2)",
                params![
                    super::decode_torrent_id(&running)
                        .expect("running id")
                        .as_bytes(),
                    super::decode_torrent_id(&pending)
                        .expect("pending id")
                        .as_bytes(),
                ],
            )
            .expect("write legacy archive rows");
        drop(connection);

        let store = SessionStore::open(&root, "default", std::slice::from_ref(&configured))
            .expect("reopen");
        let normalized_revision = store.revision().expect("revision");
        let snapshot = store.snapshot().expect("snapshot");
        let torrent = |id: &str| {
            snapshot
                .torrents
                .iter()
                .find(|torrent| torrent.torrent_id == id)
                .expect("torrent")
        };
        assert!(torrent(&running).archived);
        assert!(
            !store
                .load_resume(&running)
                .expect("running")
                .desired_running
        );
        assert!(!torrent(&pending).archived);
        assert!(torrent(&pending).awaiting_file_selection);
        assert!(torrent(&paused).archived);
        drop(store);

        let store = SessionStore::open(&root, "default", &[configured]).expect("reopen again");
        assert_eq!(store.revision().expect("idempotent"), normalized_revision);
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn archive_and_removal_generations_are_durable_and_idempotent() {
        let root = test_root("retention");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open");
        let added = store
            .handle_durable(&add_request("add-retention"))
            .expect("add torrent");
        let torrent_id = added_torrent_id(&added);

        let archive = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "archive".to_owned(),
            expected_revision: None,
            command: Command::Archive {
                torrent_id: torrent_id.clone(),
            },
        };
        store.handle_durable(&archive).expect("archive");
        let archived_revision = store.revision().expect("archived revision");
        assert!(store.snapshot().expect("snapshot").torrents[0].archived);
        store
            .handle_durable(&RequestEnvelope {
                request_id: "archive-again".to_owned(),
                ..archive.clone()
            })
            .expect("idempotent archive");
        assert_eq!(store.revision().expect("unchanged"), archived_revision);

        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "restore-archive".to_owned(),
                expected_revision: None,
                command: Command::RestoreArchive {
                    torrent_id: torrent_id.clone(),
                },
            })
            .expect("restore archive");
        assert!(!store.snapshot().expect("snapshot").torrents[0].archived);

        let remove = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "remove".to_owned(),
            expected_revision: None,
            command: Command::RemoveTorrent {
                torrent_id: torrent_id.clone(),
                data: RemovalDataPolicy::DeleteData,
            },
        };
        let accepted = store.handle_durable(&remove).expect("request removal");
        let removal = store.load_removal(&torrent_id).expect("load removal");
        assert_eq!(removal.policy, RemovalDataPolicy::DeleteData);
        assert_eq!(removal.state, RemovalState::Pending);
        assert_eq!(
            store.snapshot().expect("snapshot").torrents[0].removal_state,
            Some(RemovalState::Pending)
        );
        assert!(matches!(
            store
                .handle_durable(&RequestEnvelope {
                    request_id: "resume-removing".to_owned(),
                    command: Command::Resume {
                        torrent_id: torrent_id.to_owned(),
                    },
                    ..remove.clone()
                })
                .expect("reject resume")
                .outcome,
            ResponseOutcome::Error { .. }
        ));

        store
            .set_removal_state(
                &torrent_id,
                &removal.operation_id,
                RemovalState::Failed,
                Some("provider unavailable"),
            )
            .expect("record failure");
        drop(store);
        let mut reopened = SessionStore::open(&root, "default", &[]).expect("reopen");
        let failed = reopened.load_removal(&torrent_id).expect("durable failure");
        assert_eq!(failed.state, RemovalState::Failed);
        assert_eq!(failed.error.as_deref(), Some("provider unavailable"));
        assert!(
            reopened
                .finalize_removal(&torrent_id, &failed.operation_id)
                .is_err()
        );

        reopened
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "remove-keep-after-failure".to_owned(),
                expected_revision: None,
                command: Command::RemoveTorrent {
                    torrent_id: torrent_id.to_owned(),
                    data: RemovalDataPolicy::Keep,
                },
            })
            .expect("rearm removal");
        let rearmed = reopened.load_removal(&torrent_id).expect("rearmed job");
        assert_ne!(rearmed.operation_id, removal.operation_id);
        assert_eq!(rearmed.policy, RemovalDataPolicy::Keep);
        assert!(
            reopened
                .finalize_removal(&torrent_id, &removal.operation_id)
                .is_err()
        );
        reopened
            .finalize_removal(&torrent_id, &rearmed.operation_id)
            .expect("finalize current generation");
        assert!(
            reopened
                .snapshot()
                .expect("empty snapshot")
                .torrents
                .is_empty()
        );
        assert_eq!(
            reopened.handle_durable(&remove).expect("receipt replay"),
            accepted
        );
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn records_only_hash_matching_metadata_and_have_state() {
        let root = test_root("metadata");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", &[configured]).expect("open session store");
        let raw_info =
            b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let torrent_id: [u8; 20] = Sha1::digest(raw_info).into();
        let torrent_id = crate::control::encode_info_hash(torrent_id);
        let request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "add".to_owned(),
            expected_revision: None,
            command: Command::AddMagnet {
                magnet: format!("magnet:?xt=urn:btih:{torrent_id}&x.pe=127.0.0.1:1"),
                storage_root: "downloads".to_owned(),
                start_content: true,
                await_file_selection: false,
                skip_files: Vec::new(),
            },
        };
        let added = store.handle_durable(&request).expect("add source");
        let torrent_id = added_torrent_id(&added);
        store
            .record_metadata(&torrent_id, raw_info)
            .expect("record metadata");
        store.record_piece(&torrent_id, 0).expect("record piece");
        let resume = store.load_resume(&torrent_id).expect("load resume");
        assert_eq!(resume.raw_info.as_deref(), Some(raw_info.as_slice()));
        assert_eq!(resume.have.expect("have state").pieces(), &[true]);
        assert_eq!(
            store.snapshot().expect("snapshot").torrents[0].state,
            TorrentState::Complete
        );

        let wrong_id = "000102030405060708090a0b0c0d0e0f10111213";
        assert!(matches!(
            store.record_metadata(wrong_id, raw_info),
            Err(StoreError::DurableState(_))
        ));

        let reserved_name = format!(
            ".{}.rstorrent-staging",
            "0123456789abcdef0123456789abcdef01234567"
        );
        let mut reserved_info = format!(
            "d6:lengthi4e4:name{}:{}12:piece lengthi4e6:pieces20:",
            reserved_name.len(),
            reserved_name
        )
        .into_bytes();
        reserved_info.extend_from_slice(b"aaaaaaaaaaaaaaaaaaaae");
        let reserved_hash: [u8; 20] = Sha1::digest(&reserved_info).into();
        let reserved_id = crate::control::encode_info_hash(reserved_hash);
        let reserved = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-reserved-name".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{reserved_id}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add reserved-name source");
        let reserved_id = added_torrent_id(&reserved);
        store
            .record_metadata(&reserved_id, &reserved_info)
            .expect("legacy hash-shaped artifact names no longer collide with owned artifacts");
        assert!(store.load_resume(&reserved_id).is_ok());
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn records_piece_batch_in_one_revision_and_rolls_back_invalid_index() {
        let root = test_root("piece-batch");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", &[configured]).expect("open session store");
        let mut raw_info = b"d6:lengthi12e4:name5:batch12:piece lengthi4e6:pieces60:".to_vec();
        raw_info.extend_from_slice(&[b'a'; 20]);
        raw_info.extend_from_slice(&[b'b'; 20]);
        raw_info.extend_from_slice(&[b'c'; 20]);
        raw_info.push(b'e');
        let torrent_id: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = crate::control::encode_info_hash(torrent_id);
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-batch".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}&x.pe=127.0.0.1:1"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add source");
        let torrent_id = only_torrent_id(&store);
        assert!(!store.snapshot().expect("metadata snapshot").torrents[0].force_recheck_available);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record metadata");

        assert_eq!(
            store
                .record_pieces(&torrent_id, &[2, 0, 2])
                .expect("record batch"),
            3
        );
        assert_eq!(store.revision().expect("revision"), 3);
        assert_eq!(
            store
                .load_resume(&torrent_id)
                .expect("load batch")
                .have
                .expect("have state")
                .pieces(),
            &[true, false, true]
        );

        assert!(matches!(
            store.record_pieces(&torrent_id, &[1, 3]),
            Err(StoreError::Have(_))
        ));
        assert!(matches!(
            store.record_pieces(&torrent_id, &[]),
            Err(StoreError::DurableState(_))
        ));
        assert_eq!(store.revision().expect("revision after rollback"), 3);
        assert_eq!(
            store
                .load_resume(&torrent_id)
                .expect("load after rollback")
                .have
                .expect("have state")
                .pieces(),
            &[true, false, true]
        );
        assert_eq!(store.record_piece(&torrent_id, 1).expect("single piece"), 4);
        assert_eq!(
            store
                .load_resume(&torrent_id)
                .expect("load complete batch")
                .have
                .expect("have state")
                .pieces(),
            &[true, true, true]
        );
        assert_eq!(
            store
                .invalidate_pieces(&torrent_id, &[1, 1])
                .expect("invalidate uncertain piece"),
            5
        );
        assert_eq!(
            store
                .load_resume(&torrent_id)
                .expect("load invalidated batch")
                .have
                .expect("have state")
                .pieces(),
            &[true, false, true]
        );
        assert!(matches!(
            store.invalidate_pieces(&torrent_id, &[3]),
            Err(StoreError::Have(_))
        ));
        assert!(matches!(
            store.invalidate_pieces(&torrent_id, &[]),
            Err(StoreError::DurableState(_))
        ));
        assert_eq!(store.revision().expect("revision after invalidation"), 5);
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn downloaded_completion_emits_once_and_recheck_or_repair_cannot_reemit() {
        let root = test_root("product-completion");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open");
        let mut raw_info = b"d6:lengthi8e4:name6:metric12:piece lengthi4e6:pieces40:".to_vec();
        raw_info.extend_from_slice(&[b'a'; 20]);
        raw_info.extend_from_slice(&[b'b'; 20]);
        raw_info.push(b'e');
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let info_hash = crate::control::encode_info_hash(info_hash);
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "product-completion-add".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{info_hash}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add completion source");
        let torrent_id = only_torrent_id(&store);
        let added = store
            .pending_product_milestones()
            .expect("read add milestone");
        store
            .acknowledge_product_milestones(added[0].source_epoch, added[0].sequence)
            .expect("acknowledge add milestone");
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record metadata");

        store
            .record_piece(&torrent_id, 0)
            .expect("record incomplete piece");
        assert!(
            store
                .pending_product_milestones()
                .expect("no early completion")
                .is_empty()
        );
        store
            .record_piece(&torrent_id, 1)
            .expect("record downloaded completion");
        let completed = store
            .pending_product_milestones()
            .expect("read completion milestone");
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].kind, ProductMilestoneKind::DownloadCompleted);
        assert!(
            store
                .load_resume(&torrent_id)
                .expect("completed resume")
                .download_queue_position
                .is_none(),
            "downloaded completion and queue removal must be one transaction"
        );

        store
            .record_piece(&torrent_id, 1)
            .expect("repeat complete evidence");
        assert_eq!(
            store
                .pending_product_milestones()
                .expect("still one completion")
                .len(),
            1
        );
        store
            .acknowledge_product_milestones(completed[0].source_epoch, completed[0].sequence)
            .expect("acknowledge completion");

        store
            .invalidate_pieces(&torrent_id, &[1])
            .expect("invalidate completed piece");
        store
            .record_piece(&torrent_id, 1)
            .expect("repair completed piece");
        let (_, generation) = store
            .begin_recheck_with_generation(&torrent_id)
            .expect("begin completed recheck");
        let complete = store
            .load_resume(&torrent_id)
            .expect("load complete recheck evidence")
            .have
            .expect("complete have state");
        store
            .complete_recheck_generation(&torrent_id, generation, &complete)
            .expect("complete recheck");
        assert!(
            store
                .pending_product_milestones()
                .expect("no repair or recheck milestone")
                .is_empty()
        );

        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn complete_existing_content_adoption_disables_later_completion_counting() {
        let root = test_root("product-completion-adoption");
        let configured = configured_root(&root);
        let mut store = SessionStore::open(&root, "default", &[configured]).expect("open");
        let raw_info =
            b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let info_hash: [u8; 20] = Sha1::digest(raw_info).into();
        let info_hash = crate::control::encode_info_hash(info_hash);
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "product-adoption-add".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{info_hash}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add adoption source");
        let torrent_id = only_torrent_id(&store);
        let added = store
            .pending_product_milestones()
            .expect("read add milestone");
        store
            .acknowledge_product_milestones(added[0].source_epoch, added[0].sequence)
            .expect("acknowledge add milestone");
        store
            .record_metadata(&torrent_id, raw_info)
            .expect("record metadata");
        let (_, generation) = store
            .begin_recheck_with_generation(&torrent_id)
            .expect("begin adoption recheck");
        let empty = store
            .load_resume(&torrent_id)
            .expect("load adoption identity")
            .have
            .expect("empty have state");
        let complete =
            HaveState::from_pieces(empty.torrent_id(), empty.content_fingerprint(), vec![true])
                .expect("complete adopted have state");
        store
            .complete_recheck_generation(&torrent_id, generation, &complete)
            .expect("adopt existing complete data");
        store
            .invalidate_pieces(&torrent_id, &[0])
            .expect("invalidate adopted piece");
        store
            .record_piece(&torrent_id, 0)
            .expect("repair adopted piece");
        assert!(
            store
                .pending_product_milestones()
                .expect("adoption never counts as a downloaded completion")
                .is_empty()
        );

        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn piece_checkpoint_preserves_direct_storage_state() {
        let root = test_root("direct-piece-checkpoint");
        let mut store =
            SessionStore::open(&root, "default", &[configured_root(&root)]).expect("open");
        let raw_info =
            b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let torrent_id: [u8; 20] = Sha1::digest(raw_info).into();
        let torrent_id = crate::control::encode_info_hash(torrent_id);
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-direct-checkpoint".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add source");
        let torrent_id = only_torrent_id(&store);
        store
            .record_metadata(&torrent_id, raw_info)
            .expect("record metadata");

        store
            .record_piece(&torrent_id, 0)
            .expect("checkpoint final-owned piece");

        let resume = store.load_resume(&torrent_id).expect("load resume");
        assert_eq!(resume.storage_state, StorageState::Available);
        assert!(
            resume.download_queue_position.is_none(),
            "the durable piece checkpoint owns completion queue removal"
        );
        assert_eq!(resume.have.expect("have state").pieces(), &[true]);
        store
            .mark_complete(&torrent_id)
            .expect("derived completion callback remains an idempotent no-op");
        assert!(
            store
                .load_resume(&torrent_id)
                .expect("load completed resume")
                .download_queue_position
                .is_none()
        );
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn resume_requeues_a_paused_seed_made_incomplete_by_recheck() {
        let root = test_root("paused-recheck-resume-queue");
        let mut store =
            SessionStore::open(&root, "default", &[configured_root(&root)]).expect("open");
        let raw_info =
            b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let hash = crate::control::encode_info_hash(Sha1::digest(raw_info).into());
        let mut add = add_hash_request("add-rechecked-seed", 1);
        if let Command::AddMagnet { magnet, .. } = &mut add.command {
            *magnet = format!("magnet:?xt=urn:btih:{hash}");
        }
        let id = added_torrent_id(&store.handle_durable(&add).expect("add"));
        store.record_metadata(&id, raw_info).expect("metadata");
        store.record_piece(&id, 0).expect("complete piece");
        store.mark_complete(&id).expect("complete");
        let request = |name: &str, command| RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: name.to_owned(),
            expected_revision: None,
            command,
        };
        store
            .handle_durable(&request(
                "pause-seed",
                Command::Pause {
                    torrent_id: id.clone(),
                },
            ))
            .expect("pause");
        // Resuming an intact seed must not insert it into the download queue.
        store
            .handle_durable(&request(
                "resume-intact",
                Command::Resume {
                    torrent_id: id.clone(),
                },
            ))
            .expect("resume intact");
        assert!(queued_ids(&store).is_empty());
        store
            .handle_durable(&request(
                "pause-recheck",
                Command::Pause {
                    torrent_id: id.clone(),
                },
            ))
            .expect("pause before check");
        let (_, generation) = store.begin_recheck_with_generation(&id).expect("begin");
        let old = store.load_resume(&id).expect("resume").have.expect("have");
        let missing =
            HaveState::from_pieces(old.torrent_id(), old.content_fingerprint(), vec![false])
                .expect("missing evidence");
        store
            .complete_recheck_generation(&id, generation, &missing)
            .expect("check");
        assert_eq!(
            store.load_resume(&id).expect("paused result").state,
            TorrentState::Paused
        );
        assert!(queued_ids(&store).is_empty());
        let ahead = added_torrent_id(
            &store
                .handle_durable(&add_hash_request("add-ahead", 2))
                .expect("add queued neighbor"),
        );
        let resume = request(
            "resume-damaged",
            Command::Resume {
                torrent_id: id.clone(),
            },
        );
        let response = store.handle_durable(&resume).expect("resume missing piece");
        assert_eq!(queued_ids(&store), [ahead.clone(), id.clone()]);
        assert_eq!(
            store.handle_durable(&resume).expect("exact replay"),
            response
        );
        store
            .handle_durable(&request(
                "resume-again",
                Command::Resume {
                    torrent_id: id.clone(),
                },
            ))
            .expect("idempotent resume");
        assert_eq!(queued_ids(&store), [ahead.clone(), id.clone()]);
        drop(store);
        let reopened = SessionStore::open(&root, "default", &[]).expect("reopen");
        assert_eq!(queued_ids(&reopened), [ahead, id]);
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn running_complete_recheck_requeues_only_when_wanted_content_is_missing() {
        let root = test_root("recheck-requeue");
        let mut store =
            SessionStore::open(&root, "default", &[configured_root(&root)]).expect("open");
        let mut raw_info = b"d6:lengthi8e4:name6:repair12:piece lengthi4e6:pieces40:".to_vec();
        raw_info.extend_from_slice(&[b'a'; 20]);
        raw_info.extend_from_slice(&[b'b'; 20]);
        raw_info.push(b'e');
        let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
        let info_hash = crate::control::encode_info_hash(info_hash);
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-recheck-requeue".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{info_hash}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add repair source");
        let torrent_id = only_torrent_id(&store);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record repair metadata");
        store
            .record_pieces(&torrent_id, &[0, 1])
            .expect("record complete have");
        store.mark_complete(&torrent_id).expect("mark complete");
        assert!(
            store
                .load_resume(&torrent_id)
                .expect("complete resume")
                .download_queue_position
                .is_none()
        );

        let (_, generation) = store
            .begin_recheck_with_generation(&torrent_id)
            .expect("begin repair check");
        let previous = store
            .load_resume(&torrent_id)
            .expect("checking resume")
            .have
            .expect("checking have");
        let missing = HaveState::from_pieces(
            previous.torrent_id(),
            previous.content_fingerprint(),
            vec![true, false],
        )
        .expect("missing wanted evidence");
        store
            .complete_recheck_generation(&torrent_id, generation, &missing)
            .expect("complete repair check");
        let repair = store.load_resume(&torrent_id).expect("repair resume");
        assert_eq!(repair.state, TorrentState::Downloading);
        assert!(repair.download_queue_position.is_some());

        store
            .record_piece(&torrent_id, 1)
            .expect("record repaired piece");
        store
            .mark_complete(&torrent_id)
            .expect("mark repaired complete");
        let (_, generation) = store
            .begin_recheck_with_generation(&torrent_id)
            .expect("begin complete check");
        let complete = store
            .load_resume(&torrent_id)
            .expect("second checking resume")
            .have
            .expect("second checking have");
        store
            .complete_recheck_generation(&torrent_id, generation, &complete)
            .expect("complete intact check");
        assert!(
            store
                .load_resume(&torrent_id)
                .expect("intact resume")
                .download_queue_position
                .is_none(),
            "an intact complete torrent must remain outside the download queue"
        );

        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn discovered_storage_requests_one_idempotent_recheck_generation() {
        let root = test_root("adopt-storage-recheck");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");
        let raw_info =
            b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let torrent_id: [u8; 20] = Sha1::digest(raw_info).into();
        let torrent_id = crate::control::encode_info_hash(torrent_id);
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-adopted-storage".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add source");
        let torrent_id = only_torrent_id(&store);
        store
            .record_metadata(&torrent_id, raw_info)
            .expect("record metadata");
        let before = store.load_resume(&torrent_id).expect("load unowned row");
        assert_eq!(before.storage_state, StorageState::Available);
        assert!(!before.verification.is_pending());

        let (revision, generation) = store
            .begin_recheck_with_generation(&torrent_id)
            .expect("begin direct-storage recheck");
        let adopted = store.load_resume(&torrent_id).expect("load adopted row");
        assert_eq!(adopted.state, TorrentState::Checking);
        assert_eq!(adopted.storage_state, StorageState::Available);
        assert!(adopted.verification.is_pending());
        assert_eq!(adopted.verification.requested(), generation);
        assert_eq!(store.revision().expect("adoption revision"), revision);
        assert_eq!(
            store
                .begin_recheck_with_generation(&torrent_id)
                .expect("join pending direct-storage recheck"),
            (revision, generation)
        );
        drop(store);

        let mut reopened =
            SessionStore::open(&root, "default", &[configured]).expect("reopen adopted store");
        let restarted = reopened.load_resume(&torrent_id).expect("load restart row");
        assert_eq!(restarted.state, TorrentState::Checking);
        assert_eq!(restarted.verification.requested(), generation);
        assert!(restarted.verification.is_pending());
        assert_eq!(
            reopened
                .begin_recheck_with_generation(&torrent_id)
                .expect("join pending adoption recheck"),
            (revision, generation)
        );
        drop(reopened);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn force_recheck_is_deduplicated_and_replaces_have_with_state() {
        let root = test_root("force-recheck");
        let mut store = SessionStore::open(&root, "default", &[configured_root(&root)])
            .expect("open session store");
        let mut raw_info = b"d6:lengthi12e4:name7:recheck12:piece lengthi4e6:pieces60:".to_vec();
        raw_info.extend_from_slice(&[b'a'; 20]);
        raw_info.extend_from_slice(&[b'b'; 20]);
        raw_info.extend_from_slice(&[b'c'; 20]);
        raw_info.push(b'e');
        let torrent_id: [u8; 20] = Sha1::digest(&raw_info).into();
        let torrent_id = crate::control::encode_info_hash(torrent_id);
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "add-force-recheck".to_owned(),
                expected_revision: None,
                command: Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{torrent_id}"),
                    storage_root: "downloads".to_owned(),
                    start_content: true,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .expect("add source");
        let torrent_id = only_torrent_id(&store);
        store
            .record_metadata(&torrent_id, &raw_info)
            .expect("record metadata");
        assert!(store.snapshot().expect("staging snapshot").torrents[0].force_recheck_available);
        store.record_piece(&torrent_id, 0).expect("record old have");

        let request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "force-recheck".to_owned(),
            expected_revision: None,
            command: Command::ForceRecheck {
                torrent_id: torrent_id.clone(),
            },
        };
        let response = store.handle_durable(&request).expect("request recheck");
        let checking = store.load_resume(&torrent_id).expect("load checking state");
        let first_generation = checking.verification.requested();
        assert!(checking.verification.is_pending());
        assert_eq!(checking.state, TorrentState::Checking);
        let current_have = checking.have.as_ref().expect("old have remains input");
        assert_eq!(current_have.pieces(), &[true, false, false]);
        assert_eq!(
            store.snapshot().expect("checking snapshot").torrents[0].verified_piece_count,
            0,
            "old have is input only while checking"
        );
        let revision = store.revision().expect("checking revision");
        assert_eq!(
            store.handle_durable(&request).expect("replay recheck"),
            response
        );
        assert_eq!(store.revision().expect("revision after replay"), revision);
        store
            .handle_durable(&RequestEnvelope {
                request_id: "equivalent-pending-recheck".to_owned(),
                ..request.clone()
            })
            .expect("deduplicate equivalent pending request");
        assert_eq!(store.revision().expect("pending revision"), revision);
        assert_eq!(
            store
                .load_resume(&torrent_id)
                .expect("pending generation")
                .verification
                .requested(),
            first_generation
        );

        let replacement = HaveState::from_pieces(
            current_have.torrent_id(),
            current_have.content_fingerprint(),
            vec![false, true, true],
        )
        .expect("replacement have");
        store
            .complete_recheck(&torrent_id, &replacement)
            .expect("complete running recheck");
        let completed = store.load_resume(&torrent_id).expect("load replacement");
        assert_eq!(completed.state, TorrentState::Downloading);
        assert_eq!(
            completed.have.expect("replacement have").pieces(),
            &[false, true, true]
        );

        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pause-before-recheck".to_owned(),
                expected_revision: None,
                command: Command::Pause {
                    torrent_id: torrent_id.clone(),
                },
            })
            .expect("pause torrent");
        let (_, second_generation) = store
            .begin_recheck_with_generation(&torrent_id)
            .expect("begin paused recheck");
        assert!(second_generation > first_generation);
        assert!(matches!(
            store.complete_recheck_generation(&torrent_id, first_generation, &replacement),
            Err(StoreError::DurableState(_))
        ));
        assert!(
            store
                .load_resume(&torrent_id)
                .expect("new generation remains pending")
                .verification
                .is_pending()
        );
        store
            .complete_recheck_generation(&torrent_id, second_generation, &replacement)
            .expect("complete paused recheck");
        assert_eq!(
            store.load_resume(&torrent_id).expect("paused result").state,
            TorrentState::Paused
        );
        drop(store);
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn fresh_profile_uses_product_defaults_without_rewriting_reopen() {
        let root = test_root("fresh-client-settings");
        let configured = configured_root(&root);
        let store = SessionStore::open_with_initial_client_settings(
            &root,
            "default",
            std::slice::from_ref(&configured),
            &ClientSettings::fresh_profile_default(),
        )
        .expect("open fresh product profile");
        assert_eq!(
            store.client_settings().expect("read fresh settings"),
            ClientSettings::fresh_profile_default()
        );
        drop(store);

        let reopened = SessionStore::open(&root, "default", &[configured]).expect("reopen profile");
        assert_eq!(
            reopened.client_settings().expect("read retained settings"),
            ClientSettings::fresh_profile_default()
        );
        drop(reopened);
        fs::remove_dir_all(root).expect("remove profile");
    }

    #[test]
    fn network_opt_in_upgrade_preserves_running_intent_data_and_port_preference() {
        let root = test_root("network-opt-in-upgrade");
        let configured = configured_root(&root);
        let mut store = SessionStore::open_with_initial_client_settings(
            &root,
            "default",
            std::slice::from_ref(&configured),
            &ClientSettings::fresh_profile_default(),
        )
        .unwrap();
        let added = store
            .handle_durable(&add_hash_request("network-upgrade-torrent", 8))
            .unwrap();
        let torrent_id = added_torrent_id(&added);
        let paused = store
            .handle_durable(&add_hash_request("network-upgrade-paused-torrent", 9))
            .unwrap();
        let paused_id = added_torrent_id(&paused);
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "pause-network-upgrade-torrent".into(),
                expected_revision: None,
                command: Command::Pause {
                    torrent_id: paused_id.clone(),
                },
            })
            .unwrap();
        let prior = ClientSettings {
            listener: ListenerPolicy::FixedLocalNetwork { port: 42123 },
            upload_slots: 7,
            ..ClientSettings::fresh_profile_default()
        };
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "legacy-network-settings".into(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: prior.clone().into(),
                },
            })
            .unwrap();
        let before = store.snapshot().unwrap();
        assert!(
            before
                .torrents
                .iter()
                .any(|t| t.torrent_id == torrent_id && t.desired_running)
        );
        assert!(
            before
                .torrents
                .iter()
                .any(|t| t.torrent_id == paused_id && !t.desired_running)
        );
        assert!(store.apply_quiet_network_defaults_once(false).unwrap());
        let after = store.snapshot().unwrap();
        assert_eq!(after.torrents, before.torrents);
        assert_eq!(after.torrents.len(), 2);
        assert_eq!(after.client_settings.listener, ListenerPolicy::Disabled);
        assert_eq!(
            after.client_settings.port_mapping,
            PortMappingPolicy::Disabled
        );
        assert_eq!(after.client_settings.preferred_listen_port, 42123);
        assert_eq!(after.client_settings.upload_slots, 7);
        // The marker is durable: re-enabled networking is never held again,
        // and Restore defaults keeps the marker.
        let enabled = ClientSettings {
            listener: ListenerPolicy::AutomaticLocalNetwork,
            port_mapping: PortMappingPolicy::Upnp,
            ..after.client_settings.clone()
        };
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "user-enables-network".into(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: enabled.clone().into(),
                },
            })
            .unwrap();
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "restore-defaults".into(),
                expected_revision: None,
                command: Command::ResetClientSettings,
            })
            .unwrap();
        drop(store);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).unwrap();
        let revision = store.revision().unwrap();
        assert!(!store.apply_quiet_network_defaults_once(false).unwrap());
        assert_eq!(store.revision().unwrap(), revision);
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_network_defaults_marker_is_recorded_without_changing_settings() {
        let root = test_root("legacy-network-defaults");
        let configured = configured_root(&root);
        let enabled = ClientSettings {
            listener: ListenerPolicy::AutomaticLocalNetwork,
            port_mapping: PortMappingPolicy::Upnp,
            ..ClientSettings::default()
        };
        let mut store = SessionStore::open_with_initial_client_settings(
            &root,
            "default",
            std::slice::from_ref(&configured),
            &enabled,
        )
        .unwrap();
        let revision = store.revision().unwrap();
        assert!(!store.apply_quiet_network_defaults_once(true).unwrap());
        assert!(!store.apply_quiet_network_defaults_once(false).unwrap());
        assert_eq!(store.client_settings().unwrap(), enabled);
        assert_eq!(store.revision().unwrap(), revision);
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reset_client_settings_is_atomic_replayable_and_preserves_profile_state() {
        let root = test_root("reset-client-settings");
        let configured = configured_root(&root);
        let reset_target = ClientSettings::fresh_profile_default();
        let mut store = SessionStore::open_with_initial_client_settings(
            &root,
            "default",
            std::slice::from_ref(&configured),
            &reset_target,
        )
        .expect("open profile");
        let added = store
            .handle_durable(&add_hash_request("add-reset-settings-target", 8))
            .expect("add torrent");
        let torrent_id = added_torrent_id(&added);

        let changed = ClientSettings {
            listener: ListenerPolicy::FixedLoopback { port: 7_001 },
            preferred_listen_port: 7_002,
            port_mapping: PortMappingPolicy::Disabled,
            peer_connection_limit: 321,
            upload_slots: 4,
            active_downloads: 4,
            active_seeds: ActiveSeedLimit::Unlimited,
            share_ratio_limit_percent: 101,
            finished_download_ratio_limit_percent: 102,
            finished_time_limit_seconds: 103,
            seed_stop_ratio_percent: crate::SeedStopLimit::Off,
            seed_stop_time_seconds: crate::SeedStopLimit::Off,
            upload_rate_limit: TransferRateLimit::Limited {
                bytes_per_second: 4_096,
            },
            download_rate_limit: TransferRateLimit::Limited {
                bytes_per_second: 8_192,
            },
            encryption: EncryptionPolicy::Required,
            ipv6_enabled: false,
            dht_enabled: false,
            peer_exchange_enabled: false,
            tracker_https_server_authentication: HttpsServerAuthenticationPolicy::Disabled,
        };
        let changed_response = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "change-every-client-setting".to_owned(),
                expected_revision: Some("1".to_owned()),
                command: Command::UpdateClientSettings {
                    patch: changed.clone().into(),
                },
            })
            .expect("change settings");
        assert_eq!(changed_response.revision, "2");
        assert_eq!(store.client_settings().unwrap(), changed);

        let reset = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "reset-every-client-setting".to_owned(),
            expected_revision: Some("2".to_owned()),
            command: Command::ResetClientSettings,
        };
        let reset_response = store.handle_durable(&reset).expect("reset settings");
        assert_eq!(reset_response.revision, "3");
        assert_eq!(store.client_settings().unwrap(), reset_target);
        assert_eq!(store.handle_durable(&reset).unwrap(), reset_response);

        let snapshot = store.snapshot().unwrap();
        assert_eq!(snapshot.torrents.len(), 1);
        assert_eq!(snapshot.torrents[0].torrent_id, torrent_id);
        assert_eq!(snapshot.storage.roots.len(), 1);
        assert_eq!(snapshot.storage.roots[0].root_id, configured.id);

        let no_op = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "reset-default-client-settings".to_owned(),
                expected_revision: Some("3".to_owned()),
                command: Command::ResetClientSettings,
            })
            .expect("reset settings no-op");
        assert_eq!(no_op.revision, "3");
        let stale = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "stale-reset-client-settings".to_owned(),
                expected_revision: Some("2".to_owned()),
                command: Command::ResetClientSettings,
            })
            .expect("reject stale reset");
        assert!(matches!(
            stale.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::StaleRevision,
                    ..
                }
            }
        ));

        drop(store);
        let reopened = SessionStore::open_with_initial_client_settings(
            &root,
            "default",
            &[configured],
            &reset_target,
        )
        .expect("reopen reset profile");
        assert_eq!(reopened.client_settings().unwrap(), reset_target);
        assert_eq!(reopened.snapshot().unwrap().torrents.len(), 1);
        drop(reopened);
        fs::remove_dir_all(root).expect("remove profile");
    }

    #[test]
    fn schema_23_accounting_batches_are_exact_monotonic_and_bounded() {
        let root = test_root("schema-23-accounting");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).unwrap();
        let added = store
            .handle_durable(&add_hash_request("add-accounting-target", 8))
            .unwrap();
        let torrent_id = added_torrent_id(&added);
        let durable_id = store.load_resume(&torrent_id).unwrap().torrent_id;
        assert_eq!(
            store.load_resume(&torrent_id).unwrap().accounting,
            TorrentAccounting::default()
        );

        let accounting = TorrentAccounting {
            total_uploaded: 8_192,
            total_downloaded: 4_096,
            active_seconds: 60,
            finished_seconds: 40,
            seeding_seconds: 30,
            tracker_complete: Some(u32::MAX),
            tracker_incomplete: None,
        };
        store
            .replace_accounting_batch(&[TorrentAccountingUpdate {
                torrent_id: durable_id,
                accounting,
            }])
            .unwrap();
        assert_eq!(
            store.load_resume(&torrent_id).unwrap().accounting,
            accounting
        );

        let regression = TorrentAccounting {
            total_uploaded: accounting.total_uploaded - 1,
            ..accounting
        };
        assert!(
            store
                .replace_accounting_batch(&[TorrentAccountingUpdate {
                    torrent_id: durable_id,
                    accounting: regression,
                }])
                .is_err()
        );
        assert_eq!(
            store.load_resume(&torrent_id).unwrap().accounting,
            accounting
        );

        let malformed = TorrentAccounting {
            active_seconds: 1,
            finished_seconds: 2,
            ..accounting
        };
        assert!(
            store
                .replace_accounting_batch(&[TorrentAccountingUpdate {
                    torrent_id: durable_id,
                    accounting: malformed,
                }])
                .is_err()
        );
        let oversized = vec![
            TorrentAccountingUpdate {
                torrent_id: durable_id,
                accounting,
            };
            MAX_ACCOUNTING_BATCH + 1
        ];
        assert!(matches!(
            store.replace_accounting_batch(&oversized),
            Err(StoreError::ResourceLimit { .. })
        ));

        let database_path = store.database_path().unwrap().to_owned();
        drop(store);
        let reopened =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).unwrap();
        assert_eq!(
            reopened.load_resume(&torrent_id).unwrap().accounting,
            accounting
        );
        drop(reopened);

        let connection = Connection::open(database_path).unwrap();
        connection
            .pragma_update(None, "ignore_check_constraints", true)
            .unwrap();
        connection
            .execute(
                "UPDATE torrents SET active_seconds = 1, finished_seconds = 2",
                [],
            )
            .unwrap();
        drop(connection);
        let corrupt = SessionStore::open(&root, "default", &[configured]).unwrap();
        assert!(matches!(
            corrupt.load_resume(&torrent_id),
            Err(StoreError::DurableState(_))
        ));
        drop(corrupt);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn settings_patches_preserve_omissions_and_reject_invalid_groups_atomically() {
        let root = test_root("settings-patch-semantics");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");
        let added = store
            .handle_durable(&add_hash_request("add-settings-patch-target", 8))
            .expect("add torrent");
        let torrent_id = added_torrent_id(&added);

        let client_request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "update-client-settings-partial".to_owned(),
            expected_revision: Some("1".to_owned()),
            command: Command::UpdateClientSettings {
                patch: crate::ClientSettingsPatch {
                    peer_connection_limit: Some(321),
                    upload_slots: Some(4),
                    ..crate::ClientSettingsPatch::default()
                },
            },
        };
        let client_accepted = store
            .handle_durable(&client_request)
            .expect("apply client patch");
        assert_eq!(client_accepted.revision, "2");
        assert_eq!(
            store.handle_durable(&client_request).unwrap(),
            client_accepted
        );
        let configured_client = store.client_settings().unwrap();
        assert_eq!(configured_client.peer_connection_limit, 321);
        assert_eq!(configured_client.upload_slots, 4);
        assert_eq!(
            configured_client.download_rate_limit,
            TransferRateLimit::Unlimited
        );

        let torrent_request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "update-torrent-settings-partial".to_owned(),
            expected_revision: Some("2".to_owned()),
            command: Command::UpdateTorrentSettings {
                torrent_id: torrent_id.clone(),
                patch: crate::TorrentSettingsPatch {
                    upload_rate_limit: Some(TransferRateLimit::Limited {
                        bytes_per_second: 24 * 1_024,
                    }),
                    download_rate_limit: None,
                    ..Default::default()
                },
            },
        };
        let torrent_accepted = store
            .handle_durable(&torrent_request)
            .expect("apply torrent patch");
        assert_eq!(torrent_accepted.revision, "3");
        assert_eq!(
            store.handle_durable(&torrent_request).unwrap(),
            torrent_accepted
        );
        assert_eq!(
            store.snapshot().unwrap().torrents[0].transfer_limits,
            TorrentTransferLimits {
                upload: TransferRateLimit::Limited {
                    bytes_per_second: 24 * 1_024,
                },
                download: TransferRateLimit::Unlimited,
            }
        );

        let no_op = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "update-client-settings-no-op".to_owned(),
                expected_revision: Some("3".to_owned()),
                command: Command::UpdateClientSettings {
                    patch: crate::ClientSettingsPatch {
                        peer_connection_limit: Some(321),
                        ..crate::ClientSettingsPatch::default()
                    },
                },
            })
            .expect("accept semantic no-op");
        assert_eq!(no_op.revision, "3");

        for (request_id, command) in [
            (
                "reject-empty-client-patch",
                Command::UpdateClientSettings {
                    patch: crate::ClientSettingsPatch::default(),
                },
            ),
            (
                "reject-invalid-client-group",
                Command::UpdateClientSettings {
                    patch: crate::ClientSettingsPatch {
                        peer_connection_limit: Some(500),
                        upload_rate_limit: Some(TransferRateLimit::Limited {
                            bytes_per_second: 1_023,
                        }),
                        ..crate::ClientSettingsPatch::default()
                    },
                },
            ),
            (
                "reject-empty-torrent-patch",
                Command::UpdateTorrentSettings {
                    torrent_id: torrent_id.clone(),
                    patch: crate::TorrentSettingsPatch::default(),
                },
            ),
            (
                "reject-invalid-torrent-group",
                Command::UpdateTorrentSettings {
                    torrent_id: torrent_id.clone(),
                    patch: crate::TorrentSettingsPatch {
                        upload_rate_limit: Some(TransferRateLimit::Limited {
                            bytes_per_second: 48 * 1_024,
                        }),
                        download_rate_limit: Some(TransferRateLimit::Limited {
                            bytes_per_second: 1_023,
                        }),
                        ..Default::default()
                    },
                },
            ),
        ] {
            let response = store
                .handle_durable(&RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: request_id.to_owned(),
                    expected_revision: Some("3".to_owned()),
                    command,
                })
                .expect("return a structured rejection");
            assert!(matches!(
                response.outcome,
                ResponseOutcome::Error {
                    error: crate::ErrorResponse {
                        code: ErrorCode::InvalidRequest,
                        ..
                    }
                }
            ));
            assert_eq!(response.revision, "3");
        }
        assert_eq!(store.revision().unwrap(), 3);
        assert_eq!(store.client_settings().unwrap(), configured_client);
        assert_eq!(
            store.snapshot().unwrap().torrents[0].transfer_limits.upload,
            TransferRateLimit::Limited {
                bytes_per_second: 24 * 1_024,
            }
        );
        drop(store);
        fs::remove_dir_all(root).expect("remove profile");
    }

    #[test]
    fn torrent_transfer_limits_are_atomic_replayable_and_durable() {
        let root = test_root("torrent-transfer-limits");
        let configured = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");
        let added = store
            .handle_durable(&add_hash_request("add-rate-target", 8))
            .expect("add torrent");
        let torrent_id = added_torrent_id(&added);
        let limits = TorrentTransferLimits {
            upload: TransferRateLimit::Limited {
                bytes_per_second: 24 * 1_024,
            },
            download: TransferRateLimit::Limited {
                bytes_per_second: u32::MAX,
            },
        };
        let request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "set-torrent-transfer-limits".to_owned(),
            expected_revision: Some("1".to_owned()),
            command: Command::UpdateTorrentSettings {
                torrent_id: torrent_id.clone(),
                patch: limits.into(),
            },
        };
        let accepted = store.handle_durable(&request).expect("set torrent limits");
        assert_eq!(accepted.revision, "2");
        let ResponseOutcome::Success { snapshot } = &accepted.outcome else {
            panic!("torrent limit mutation must succeed");
        };
        assert_eq!(snapshot.torrents[0].transfer_limits, limits);
        assert_eq!(store.handle_durable(&request).expect("replay"), accepted);

        let no_op = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "torrent-transfer-limits-no-op".to_owned(),
                expected_revision: Some("2".to_owned()),
                command: Command::UpdateTorrentSettings {
                    torrent_id: torrent_id.clone(),
                    patch: limits.into(),
                },
            })
            .expect("no-op torrent limits");
        assert_eq!(no_op.revision, "2");
        let stale = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "torrent-transfer-limits-stale".to_owned(),
                expected_revision: Some("1".to_owned()),
                command: Command::UpdateTorrentSettings {
                    torrent_id,
                    patch: TorrentTransferLimits::default().into(),
                },
            })
            .expect("stale torrent limits");
        assert!(matches!(
            stale.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::StaleRevision,
                    ..
                }
            }
        ));
        let database_path = store.database_path().expect("database path").to_owned();
        drop(store);
        let reopened = SessionStore::open(&root, "default", &[configured]).expect("reopen");
        assert_eq!(
            reopened.snapshot().expect("restart snapshot").torrents[0].transfer_limits,
            limits
        );
        drop(reopened);
        assert!(database_path.exists());
        fs::remove_dir_all(root).expect("remove test profile");
    }

    #[test]
    fn client_settings_are_atomic_replayable_and_profile_scoped() {
        let root = test_root("client-settings-command");
        let configured_root = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured_root))
                .expect("open");
        let configured = ClientSettings {
            listener: ListenerPolicy::FixedLoopback { port: 42_001 },
            preferred_listen_port: 6_881,
            port_mapping: crate::PortMappingPolicy::Disabled,
            peer_connection_limit: 321,
            upload_slots: 3,
            active_downloads: 3,
            upload_rate_limit: crate::TransferRateLimit::Limited {
                bytes_per_second: 64 * 1_024,
            },
            download_rate_limit: crate::TransferRateLimit::Limited {
                bytes_per_second: u32::MAX,
            },
            encryption: Default::default(),
            ipv6_enabled: true,
            tracker_https_server_authentication: Default::default(),
            ..ClientSettings::default()
        };
        let request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "set-client-settings".to_owned(),
            expected_revision: Some("0".to_owned()),
            command: Command::UpdateClientSettings {
                patch: configured.clone().into(),
            },
        };
        let accepted = store.handle_durable(&request).expect("set settings");
        assert_eq!(accepted.revision, "1");
        let ResponseOutcome::Success { snapshot } = &accepted.outcome else {
            panic!("settings mutation must succeed");
        };
        assert_eq!(snapshot.client_settings, configured);
        assert_eq!(store.handle_durable(&request).expect("replay"), accepted);

        let conflict = store
            .handle_durable(&RequestEnvelope {
                command: Command::UpdateClientSettings {
                    patch: ClientSettings::default().into(),
                },
                ..request.clone()
            })
            .expect("settings request conflict");
        assert!(matches!(
            conflict.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::RequestConflict,
                    ..
                }
            }
        ));

        let no_op = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "settings-no-op".to_owned(),
                expected_revision: Some("1".to_owned()),
                command: Command::UpdateClientSettings {
                    patch: configured.clone().into(),
                },
            })
            .expect("no-op settings");
        assert_eq!(no_op.revision, "1");
        let stale = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "settings-stale".to_owned(),
                expected_revision: Some("0".to_owned()),
                command: Command::UpdateClientSettings {
                    patch: ClientSettings::default().into(),
                },
            })
            .expect("stale settings");
        assert!(matches!(
            stale.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::StaleRevision,
                    ..
                }
            }
        ));
        let invalid_request_id = "invalid-settings".to_owned();
        let invalid = store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: invalid_request_id.clone(),
                expected_revision: Some("1".to_owned()),
                command: Command::UpdateClientSettings {
                    patch: ClientSettings {
                        peer_connection_limit: 0,
                        ..ClientSettings::default()
                    }
                    .into(),
                },
            })
            .expect("reject invalid settings");
        assert!(matches!(
            invalid.outcome,
            ResponseOutcome::Error {
                error: crate::ErrorResponse {
                    code: ErrorCode::InvalidRequest,
                    ..
                }
            }
        ));
        assert_eq!(store.revision().unwrap(), 1);
        assert_eq!(store.client_settings().unwrap(), configured);
        drop(store);

        let mut reopened =
            SessionStore::open(&root, "default", &[configured_root]).expect("reopen");
        assert_eq!(reopened.client_settings().unwrap(), configured);
        let reverted = reopened
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: invalid_request_id,
                expected_revision: Some("1".to_owned()),
                command: Command::UpdateClientSettings {
                    patch: ClientSettings::default().into(),
                },
            })
            .expect("retry corrected settings request");
        assert_eq!(reverted.revision, "2");
        assert_eq!(
            reopened.client_settings().unwrap(),
            ClientSettings::default()
        );
        drop(reopened);

        let mut ephemeral =
            SessionStore::open_ephemeral("ephemeral", &[]).expect("open ephemeral store");
        let accepted = ephemeral
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: "ephemeral-settings".to_owned(),
                expected_revision: None,
                command: Command::UpdateClientSettings {
                    patch: ClientSettings {
                        peer_connection_limit: 199,
                        ..ClientSettings::default()
                    }
                    .into(),
                },
            })
            .expect("accept ephemeral settings");
        assert!(matches!(accepted.outcome, ResponseOutcome::Success { .. }));
        assert_eq!(ephemeral.revision().unwrap(), 1);
        assert_eq!(
            ephemeral.client_settings().unwrap(),
            ClientSettings {
                peer_connection_limit: 199,
                ..ClientSettings::default()
            }
        );
        fs::remove_dir_all(root).expect("remove profile");
    }

    #[test]
    fn client_settings_storage_failure_rolls_back_group_revision_and_receipt() {
        let root = test_root("client-settings-rollback");
        let configured_root = configured_root(&root);
        let mut store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured_root))
                .expect("open");
        store
            .connection
            .execute_batch(
                "CREATE TRIGGER reject_client_settings
                 BEFORE UPDATE ON client_settings
                 BEGIN
                    SELECT RAISE(ABORT, 'injected settings write failure');
                 END;",
            )
            .expect("install failure trigger");
        let request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "settings-write-failure".to_owned(),
            expected_revision: Some("0".to_owned()),
            command: Command::UpdateClientSettings {
                patch: ClientSettings {
                    peer_connection_limit: 199,
                    ..ClientSettings::default()
                }
                .into(),
            },
        };
        assert!(store.handle_durable(&request).is_err());
        assert_eq!(store.revision().unwrap(), 0);
        assert_eq!(store.client_settings().unwrap(), ClientSettings::default());

        store
            .connection
            .execute_batch("DROP TRIGGER reject_client_settings")
            .expect("remove failure trigger");
        let accepted = store
            .handle_durable(&request)
            .expect("retry unrecorded request");
        assert_eq!(accepted.revision, "1");
        drop(store);
        fs::remove_dir_all(root).expect("remove profile");
    }

    #[test]
    fn corrupt_client_settings_prevent_profile_open() {
        let root = test_root("client-settings-corrupt-open");
        let configured = configured_root(&root);
        let store =
            SessionStore::open(&root, "default", std::slice::from_ref(&configured)).expect("open");
        let database_path = store.database_path().unwrap().to_owned();
        drop(store);

        let connection = Connection::open(database_path).expect("open raw database");
        connection
            .pragma_update(None, "ignore_check_constraints", true)
            .expect("disable constraints for corruption fixture");
        connection
            .execute(
                "UPDATE client_settings SET peer_connection_limit = -1 WHERE singleton = 1",
                [],
            )
            .expect("write corrupt setting");
        drop(connection);

        let error = match SessionStore::open(&root, "default", &[configured]) {
            Ok(_) => panic!("corrupt settings must prevent profile open"),
            Err(error) => error,
        };
        assert!(matches!(error, StoreError::DurableState(_)));
        fs::remove_dir_all(root).expect("remove profile");
    }
}
