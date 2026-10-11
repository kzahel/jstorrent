use rstorrent_protocol::identity::InfoHashes;
use rstorrent_protocol::magnet::{MAX_MAGNET_LENGTH, Magnet};

pub(crate) const MAX_FILE_SELECTION_ENTRIES: usize = 4096;
const MAX_FILE_INDEX: usize = 374_998;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::settings::{
    ClientSettings, ClientSettingsPatch, StorageSettingsSnapshot, TorrentSettingsPatch,
    TorrentTransferLimits,
};

pub const CONTROL_VERSION: u16 = 1;
pub const MAX_REQUEST_ID_LENGTH: usize = 128;
pub const MAX_PROFILE_ID_LENGTH: usize = 128;
pub const MAX_ROOT_ID_LENGTH: usize = 128;
pub const MAX_ROOT_LABEL_LENGTH: usize = 256;
pub const MAX_ERROR_MESSAGE_LENGTH: usize = 1024;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[schemars(extend("minProperties" = 1))]
pub struct TorrentProtocolIdentities {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "String", regex(pattern = "^[0-9a-f]{40}$"))]
    pub v1: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "String", regex(pattern = "^[0-9a-f]{64}$"))]
    pub v2: Option<String>,
}

impl TorrentProtocolIdentities {
    pub fn from_info_hashes(info_hashes: InfoHashes) -> Self {
        Self {
            v1: info_hashes.v1_hash().map(|hash| hash.to_string()),
            v2: info_hashes.v2_hash().map(|hash| hash.to_string()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct FileIndexRange {
    pub start: u32,
    pub end_exclusive: u32,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FileSelectionIntent {
    #[default]
    All,
    None,
    WantedRanges {
        ranges: Vec<FileIndexRange>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RequestEnvelope {
    pub version: u16,
    pub request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<String>,
    pub command: Command,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct AddTorrentBytesRequest {
    pub version: u16,
    pub request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<String>,
    pub storage_root: String,
    #[serde(default = "default_true")]
    pub start_content: bool,
    #[serde(default)]
    pub await_file_selection: bool,
    #[serde(default)]
    pub selection: FileSelectionIntent,
    pub source_length: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    AddMagnet {
        magnet: String,
        storage_root: String,
        #[serde(default = "default_true")]
        start_content: bool,
        #[serde(default)]
        await_file_selection: bool,
        #[serde(default)]
        skip_files: Vec<u32>,
    },
    SetFilePriority {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        file_indices: Vec<u32>,
        priority: FilePriority,
    },
    SetFilePriorityRanges {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        ranges: Vec<FileIndexRange>,
        priority: FilePriority,
    },
    DownloadFiles {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        file_indices: Vec<u32>,
    },
    MoveDownloadToTop {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
    },
    MoveDownloadToBottom {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
    },
    SetDefaultStorageRoot {
        storage_root: String,
    },
    SetShowAddOptions {
        show: bool,
    },
    SetShowFileSelection {
        show: bool,
    },
    ConfirmPendingFileSelection {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        catalog_id: String,
        base: PendingFileSelectionBase,
        overrides: Vec<FileSelectionOverride>,
        #[serde(default)]
        disable_future: bool,
    },
    DownloadAllPendingAdd {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
    },
    CancelPendingAdd {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
    },
    UpdateClientSettings {
        patch: ClientSettingsPatch,
    },
    ResetClientSettings,
    UpdateTorrentSettings {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        patch: TorrentSettingsPatch,
    },
    RemoveStorageRoot {
        storage_root: String,
    },
    ClearAppData,
    ExportMagnet {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
    },
    Snapshot,
    Pause {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
    },
    Resume {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
    },
    ForceRecheck {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
    },
    Archive {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
    },
    RestoreArchive {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
    },
    RemoveTorrent {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        data: RemovalDataPolicy,
    },
    Shutdown,
}

impl Command {
    pub(crate) fn is_mutation(&self) -> bool {
        matches!(
            self,
            Self::AddMagnet { .. }
                | Self::SetDefaultStorageRoot { .. }
                | Self::SetShowAddOptions { .. }
                | Self::SetShowFileSelection { .. }
                | Self::ConfirmPendingFileSelection { .. }
                | Self::DownloadAllPendingAdd { .. }
                | Self::CancelPendingAdd { .. }
                | Self::UpdateClientSettings { .. }
                | Self::ResetClientSettings
                | Self::UpdateTorrentSettings { .. }
                | Self::RemoveStorageRoot { .. }
                | Self::ClearAppData
                | Self::Pause { .. }
                | Self::Resume { .. }
                | Self::ForceRecheck { .. }
                | Self::SetFilePriority { .. }
                | Self::SetFilePriorityRanges { .. }
                | Self::DownloadFiles { .. }
                | Self::MoveDownloadToTop { .. }
                | Self::MoveDownloadToBottom { .. }
                | Self::Archive { .. }
                | Self::RestoreArchive { .. }
                | Self::RemoveTorrent { .. }
        )
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum PendingFileSelectionBase {
    #[default]
    Current,
    All,
    None,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct FileSelectionOverride {
    pub range: FileIndexRange,
    pub selected: bool,
}

const fn default_true() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum FilePriority {
    #[default]
    Normal,
    High,
    Skip,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum RemovalDataPolicy {
    Keep,
    DeleteData,
}

impl RemovalDataPolicy {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Keep => "keep",
            Self::DeleteData => "delete_data",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "keep" => Some(Self::Keep),
            "delete_data" => Some(Self::DeleteData),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum RemovalState {
    Pending,
    AwaitingPlatform,
    Failed,
}

impl RemovalState {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::AwaitingPlatform => "awaiting_platform",
            Self::Failed => "failed",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "awaiting_platform" => Some(Self::AwaitingPlatform),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ResponseEnvelope {
    pub version: u16,
    pub request_id: String,
    pub revision: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<CommandResult>,
    #[serde(flatten)]
    pub outcome: ResponseOutcome,
}

impl ResponseEnvelope {
    pub fn success(request_id: String, revision: u64, snapshot: ServiceSnapshot) -> Self {
        Self {
            version: CONTROL_VERSION,
            request_id,
            revision: revision.to_string(),
            result: None,
            outcome: ResponseOutcome::Success { snapshot },
        }
    }

    pub fn error(
        request_id: String,
        revision: u64,
        code: ErrorCode,
        message: impl Into<String>,
    ) -> Self {
        let mut message = message.into();
        if message.len() > MAX_ERROR_MESSAGE_LENGTH {
            let mut boundary = MAX_ERROR_MESSAGE_LENGTH;
            while !message.is_char_boundary(boundary) {
                boundary -= 1;
            }
            message.truncate(boundary);
        }
        Self {
            version: CONTROL_VERSION,
            request_id,
            revision: revision.to_string(),
            result: None,
            outcome: ResponseOutcome::Error {
                error: ErrorResponse { code, message },
            },
        }
    }

    pub(crate) fn with_result(mut self, result: CommandResult) -> Self {
        self.result = Some(result);
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommandResult {
    AddTorrent { result: AddTorrentResult },
    ExportMagnet { result: MagnetExportResult },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum MagnetExportSource {
    Verbatim,
    Canonicalized,
    Synthesized,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct MagnetExportResult {
    pub magnet: String,
    pub source: MagnetExportSource,
    pub omitted_tracker_count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct AddTorrentResult {
    #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
    pub torrent_id: String,
    pub disposition: AddTorrentDisposition,
    pub resulting_revision: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AddTorrentDisposition {
    Added,
    AlreadyPresent,
    SelectionExpanded {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        newly_wanted_count: Option<u32>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ResponseOutcome {
    Success { snapshot: ServiceSnapshot },
    Error { error: ErrorResponse },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ErrorResponse {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidVersion,
    InvalidRequest,
    RequestConflict,
    StaleRevision,
    UnknownStorageRoot,
    StorageRootInUse,
    UnknownTorrent,
    InvalidTorrentState,
    InvalidDurableState,
    ResourceLimit,
    StorageNeedsRepair,
    Busy,
    Internal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ServiceSnapshot {
    pub profile_id: String,
    pub revision: String,
    #[serde(default)]
    pub storage: StorageSettingsSnapshot,
    #[serde(default)]
    pub client_settings: ClientSettings,
    pub torrents: Vec<TorrentSnapshot>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TorrentSnapshot {
    #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
    pub torrent_id: String,
    pub protocol_identities: TorrentProtocolIdentities,
    pub storage_root: String,
    pub state: TorrentState,
    pub storage_state: StorageState,
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
    pub verified_piece_count: u32,
    #[serde(default)]
    pub desired_running: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_queue_position: Option<u32>,
    #[serde(default)]
    pub transfer_limits: TorrentTransferLimits,
    pub skip_files: Vec<u32>,
    #[serde(default)]
    pub high_priority_files: Vec<u32>,
    #[serde(default)]
    pub selection_default: FilePriority,
    #[serde(default)]
    pub selection_exceptions: Vec<u32>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removal_state: Option<RemovalState>,
    #[serde(default)]
    pub delete_data_supported: bool,
    #[serde(default)]
    pub force_recheck_available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum TorrentState {
    AwaitingMetadata,
    AwaitingStorage,
    Checking,
    Downloading,
    Paused,
    Complete,
    NeedsRepair,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum StorageState {
    Available,
    Unavailable,
    NeedsRepair,
}

pub(crate) fn validate_request(request: &RequestEnvelope) -> Result<(), (ErrorCode, String)> {
    if request.version != CONTROL_VERSION {
        return Err((
            ErrorCode::InvalidVersion,
            format!(
                "control version {} is unsupported; expected {CONTROL_VERSION}",
                request.version
            ),
        ));
    }
    validate_identifier(&request.request_id, "request ID", MAX_REQUEST_ID_LENGTH)?;
    if let Some(revision) = &request.expected_revision {
        parse_revision(revision)?;
    }
    match &request.command {
        Command::AddMagnet {
            magnet,
            storage_root,
            start_content: _,
            await_file_selection: _,
            skip_files,
        } => {
            if magnet.len() > MAX_MAGNET_LENGTH {
                return Err((
                    ErrorCode::InvalidRequest,
                    format!("magnet exceeds {MAX_MAGNET_LENGTH} bytes"),
                ));
            }
            Magnet::parse(magnet)
                .map_err(|error| (ErrorCode::InvalidRequest, error.to_string()))?;
            validate_identifier(storage_root, "storage root", MAX_ROOT_ID_LENGTH)?;
            if skip_files.len() > MAX_FILE_SELECTION_ENTRIES {
                return Err((
                    ErrorCode::InvalidRequest,
                    format!("file selection exceeds {MAX_FILE_SELECTION_ENTRIES} entries"),
                ));
            }
            let mut previous = None;
            for index in skip_files {
                if usize::try_from(*index).map_or(true, |index| index >= MAX_FILE_INDEX) {
                    return Err((
                        ErrorCode::InvalidRequest,
                        "file selection index exceeds the supported file bound".to_owned(),
                    ));
                }
                if previous.is_some_and(|previous| previous >= *index) {
                    return Err((
                        ErrorCode::InvalidRequest,
                        "file selection indices must be sorted and unique".to_owned(),
                    ));
                }
                previous = Some(*index);
            }
        }
        Command::SetFilePriority {
            torrent_id,
            file_indices,
            priority: _,
        }
        | Command::DownloadFiles {
            torrent_id,
            file_indices,
        } => {
            validate_torrent_id(torrent_id)?;
            if file_indices.is_empty() || file_indices.len() > MAX_FILE_SELECTION_ENTRIES {
                return Err((
                    ErrorCode::InvalidRequest,
                    format!(
                        "file selection must contain between 1 and {MAX_FILE_SELECTION_ENTRIES} entries"
                    ),
                ));
            }
            let mut previous = None;
            for index in file_indices {
                if usize::try_from(*index).map_or(true, |index| index >= MAX_FILE_INDEX) {
                    return Err((
                        ErrorCode::InvalidRequest,
                        "file selection index exceeds the supported file bound".to_owned(),
                    ));
                }
                if previous.is_some_and(|previous| previous >= *index) {
                    return Err((
                        ErrorCode::InvalidRequest,
                        "file selection indices must be sorted and unique".to_owned(),
                    ));
                }
                previous = Some(*index);
            }
        }
        Command::MoveDownloadToTop { torrent_id }
        | Command::MoveDownloadToBottom { torrent_id } => {
            validate_torrent_id(torrent_id)?;
        }
        Command::SetFilePriorityRanges {
            torrent_id,
            ranges,
            priority: _,
        } => {
            validate_torrent_id(torrent_id)?;
            validate_file_ranges(ranges, false)?;
        }
        Command::Pause { torrent_id }
        | Command::Resume { torrent_id }
        | Command::ForceRecheck { torrent_id }
        | Command::Archive { torrent_id }
        | Command::RestoreArchive { torrent_id }
        | Command::RemoveTorrent { torrent_id, .. }
        | Command::CancelPendingAdd { torrent_id }
        | Command::DownloadAllPendingAdd { torrent_id }
        | Command::ExportMagnet { torrent_id } => {
            validate_torrent_id(torrent_id)?;
        }
        Command::ConfirmPendingFileSelection {
            torrent_id,
            catalog_id,
            base: _,
            overrides,
            disable_future: _,
        } => {
            validate_torrent_id(torrent_id)?;
            if catalog_id.len() != 64 || !catalog_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err((
                    ErrorCode::InvalidRequest,
                    "file catalog identity must be 64 hexadecimal characters".to_owned(),
                ));
            }
            if overrides.len() > MAX_FILE_SELECTION_ENTRIES {
                return Err((
                    ErrorCode::InvalidRequest,
                    format!("file selection overrides exceed {MAX_FILE_SELECTION_ENTRIES} entries"),
                ));
            }
            let ranges = overrides
                .iter()
                .map(|entry| entry.range)
                .collect::<Vec<_>>();
            validate_file_ranges(&ranges, true)?;
        }
        Command::UpdateTorrentSettings { torrent_id, patch } => {
            validate_torrent_id(torrent_id)?;
            if patch.is_empty() {
                return Err((
                    ErrorCode::InvalidRequest,
                    "torrent settings patch must contain at least one property".to_owned(),
                ));
            }
            patch
                .validate()
                .map_err(|error| (ErrorCode::InvalidRequest, error.to_string()))?;
        }
        Command::SetDefaultStorageRoot { storage_root }
        | Command::RemoveStorageRoot { storage_root } => {
            validate_identifier(storage_root, "storage root", MAX_ROOT_ID_LENGTH)?;
        }
        Command::UpdateClientSettings { patch } => {
            if patch.is_empty() {
                return Err((
                    ErrorCode::InvalidRequest,
                    "client settings patch must contain at least one property".to_owned(),
                ));
            }
            patch
                .validate()
                .map_err(|error| (ErrorCode::InvalidRequest, error.to_string()))?;
        }
        Command::ResetClientSettings | Command::ClearAppData => {}
        Command::SetShowAddOptions { .. } | Command::SetShowFileSelection { .. } => {}
        Command::Snapshot | Command::Shutdown => {}
    }
    Ok(())
}

fn validate_file_ranges(
    ranges: &[FileIndexRange],
    allow_empty: bool,
) -> Result<(), (ErrorCode, String)> {
    if (!allow_empty && ranges.is_empty()) || ranges.len() > MAX_FILE_SELECTION_ENTRIES {
        return Err((
            ErrorCode::InvalidRequest,
            format!(
                "file selection must contain between {} and {MAX_FILE_SELECTION_ENTRIES} ranges",
                usize::from(!allow_empty)
            ),
        ));
    }
    let mut previous_end = None;
    for range in ranges {
        if range.start >= range.end_exclusive
            || usize::try_from(range.end_exclusive).map_or(true, |end| end > MAX_FILE_INDEX)
        {
            return Err((
                ErrorCode::InvalidRequest,
                "file selection range is empty or exceeds the supported file bound".to_owned(),
            ));
        }
        if previous_end.is_some_and(|end| end >= range.start) {
            return Err((
                ErrorCode::InvalidRequest,
                "file selection ranges must be sorted, disjoint, and non-adjacent".to_owned(),
            ));
        }
        previous_end = Some(range.end_exclusive);
    }
    Ok(())
}

pub fn validate_add_torrent_bytes_request(
    request: &AddTorrentBytesRequest,
) -> Result<(), (ErrorCode, String)> {
    if request.version != CONTROL_VERSION {
        return Err((
            ErrorCode::InvalidVersion,
            format!(
                "control version {} is unsupported; expected {CONTROL_VERSION}",
                request.version
            ),
        ));
    }
    validate_identifier(&request.request_id, "request ID", MAX_REQUEST_ID_LENGTH)?;
    if let Some(revision) = &request.expected_revision {
        parse_revision(revision)?;
    }
    validate_identifier(&request.storage_root, "storage root", MAX_ROOT_ID_LENGTH)?;
    let FileSelectionIntent::WantedRanges { ranges } = &request.selection else {
        return validate_torrent_source_declaration(request);
    };
    validate_file_ranges(ranges, true)?;
    validate_torrent_source_declaration(request)
}

fn validate_torrent_source_declaration(
    request: &AddTorrentBytesRequest,
) -> Result<(), (ErrorCode, String)> {
    if request.source_length == 0
        || request.source_length as usize
            > rstorrent_protocol::metainfo::MAX_EXPLICIT_METAINFO_LENGTH
    {
        return Err((
            ErrorCode::InvalidRequest,
            format!(
                "torrent source length must be 1..={} bytes",
                rstorrent_protocol::metainfo::MAX_EXPLICIT_METAINFO_LENGTH
            ),
        ));
    }
    Ok(())
}

pub(crate) fn parse_revision(value: &str) -> Result<u64, (ErrorCode, String)> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err((
            ErrorCode::InvalidRequest,
            "revision must be a canonical unsigned decimal string".to_owned(),
        ));
    }
    value.parse().map_err(|_| {
        (
            ErrorCode::InvalidRequest,
            "revision exceeds the supported unsigned 64-bit range".to_owned(),
        )
    })
}

pub(crate) fn validate_identifier(
    value: &str,
    label: &str,
    maximum: usize,
) -> Result<(), (ErrorCode, String)> {
    if value.is_empty()
        || value.len() > maximum
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err((
            ErrorCode::InvalidRequest,
            format!("{label} must be 1..={maximum} ASCII letters, digits, '.', '-', or '_'"),
        ));
    }
    Ok(())
}

pub(crate) fn validate_torrent_id(value: &str) -> Result<(), (ErrorCode, String)> {
    if value.parse::<rstorrent_engine::TorrentId>().is_err() {
        return Err((
            ErrorCode::InvalidRequest,
            "torrent ID must use the canonical t1- plus 32 lowercase hexadecimal grammar"
                .to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn encode_info_hash(info_hash: [u8; 20]) -> String {
    let mut output = String::with_capacity(40);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in info_hash {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{
        CONTROL_VERSION, Command, ErrorCode, FileIndexRange, FilePriority, RequestEnvelope,
        encode_info_hash, validate_request,
    };

    #[test]
    fn settings_commands_require_nonempty_patches_and_old_variants_are_absent() {
        let empty = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "empty-settings-patch".to_owned(),
            expected_revision: None,
            command: Command::UpdateClientSettings {
                patch: crate::ClientSettingsPatch::default(),
            },
        };
        assert_eq!(
            validate_request(&empty).map_err(|error| error.0),
            Err(ErrorCode::InvalidRequest)
        );
        let reset = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "reset-client-settings".to_owned(),
            expected_revision: None,
            command: Command::ResetClientSettings,
        };
        assert_eq!(validate_request(&reset), Ok(()));
        assert_eq!(
            serde_json::to_value(reset).unwrap()["command"],
            serde_json::json!({ "type": "reset_client_settings" })
        );
        assert!(
            serde_json::from_str::<RequestEnvelope>(
                r#"{"version":1,"request_id":"old","command":{"type":"set_client_settings","settings":{}}}"#,
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<RequestEnvelope>(
                r#"{"version":1,"request_id":"old","command":{"type":"set_torrent_transfer_limits","torrent_id":"t1-000102030405060708090a0b0c0d0e0f","limits":{}}}"#,
            )
            .is_err()
        );
    }

    #[test]
    fn validates_sorted_bounded_selection() {
        let request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "request-1".to_owned(),
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
        };
        assert_eq!(validate_request(&request), Ok(()));

        let mut invalid = request;
        if let Command::AddMagnet { skip_files, .. } = &mut invalid.command {
            *skip_files = vec![3, 1];
        }
        assert_eq!(
            validate_request(&invalid).map_err(|error| error.0),
            Err(ErrorCode::InvalidRequest)
        );
    }

    #[test]
    fn add_defaults_to_starting_content_and_file_priority_is_bounded() {
        let add: RequestEnvelope = serde_json::from_str(
            r#"{"version":1,"request_id":"add","command":{"type":"add_magnet","magnet":"magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213","storage_root":"downloads"}}"#,
        )
        .expect("decode legacy add envelope");
        assert!(matches!(
            add.command,
            Command::AddMagnet {
                start_content: true,
                ..
            }
        ));

        let mut request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "priority".to_owned(),
            expected_revision: None,
            command: Command::SetFilePriority {
                torrent_id: "t1-000102030405060708090a0b0c0d0e0f".to_owned(),
                file_indices: vec![1, 3],
                priority: FilePriority::Skip,
            },
        };
        assert_eq!(validate_request(&request), Ok(()));
        if let Command::SetFilePriority { file_indices, .. } = &mut request.command {
            *file_indices = vec![3, 1];
        }
        assert!(validate_request(&request).is_err());
        if let Command::SetFilePriority { file_indices, .. } = &mut request.command {
            file_indices.clear();
        }
        assert!(validate_request(&request).is_err());

        request.command = Command::DownloadFiles {
            torrent_id: "t1-000102030405060708090a0b0c0d0e0f".to_owned(),
            file_indices: vec![1, 3],
        };
        assert_eq!(validate_request(&request), Ok(()));
        if let Command::DownloadFiles { file_indices, .. } = &mut request.command {
            *file_indices = vec![3, 3];
        }
        assert!(validate_request(&request).is_err());
    }

    #[test]
    fn ranged_file_priority_requires_canonical_nonadjacent_ranges() {
        let mut request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "priority-ranges".to_owned(),
            expected_revision: None,
            command: Command::SetFilePriorityRanges {
                torrent_id: "t1-000102030405060708090a0b0c0d0e0f".to_owned(),
                ranges: vec![
                    FileIndexRange {
                        start: 1,
                        end_exclusive: 3,
                    },
                    FileIndexRange {
                        start: 5,
                        end_exclusive: 374_998,
                    },
                ],
                priority: FilePriority::Skip,
            },
        };
        assert_eq!(validate_request(&request), Ok(()));

        let Command::SetFilePriorityRanges { ranges, .. } = &mut request.command else {
            unreachable!();
        };
        ranges[1].start = 3;
        assert_eq!(
            validate_request(&request).map_err(|error| error.0),
            Err(ErrorCode::InvalidRequest)
        );
    }

    #[test]
    fn info_hash_identifier_is_lowercase_hex() {
        assert_eq!(
            encode_info_hash([
                0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0xaa, 0xbb, 0xcc, 0xdd,
                0xee, 0xff, 0x10, 0x11, 0x12, 0x13,
            ]),
            "00010203040506070809aabbccddeeff10111213"
        );
    }

    #[test]
    fn revisions_are_canonical_decimal_strings() {
        let mut request = RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "request-1".to_owned(),
            expected_revision: Some("18446744073709551615".to_owned()),
            command: Command::Snapshot,
        };
        assert_eq!(validate_request(&request), Ok(()));
        for invalid in ["", "01", "-1", "18446744073709551616"] {
            request.expected_revision = Some(invalid.to_owned());
            assert_eq!(
                validate_request(&request).map_err(|error| error.0),
                Err(ErrorCode::InvalidRequest)
            );
        }
    }
}
