use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::ffi::OsString;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use rstorrent_protocol::content::TorrentContent;
use rstorrent_protocol::merkle::{
    MERKLE_BLOCK_SIZE, MerkleAccumulator, MerkleError, Sha256Hash, hash_block,
};
use rstorrent_protocol::metainfo::{Metainfo, MetainfoFormat};
use rstorrent_protocol::peer_wire::{BlockRequest, MAX_REQUEST_BLOCK_LENGTH};
use rstorrent_protocol::storage_layout::{
    ContentLayout, FileSelection, LayoutError, LayoutSegment, SegmentTarget, TorrentLayout,
};
use sha1::{Digest, Sha1};
use tokio::fs::File;

use crate::checkpoint::DurabilityTarget;
use crate::direct_content_layout::ContentShape;
use crate::identity::{ContentFingerprint, TorrentId};
use crate::part_file::{
    PartFile, PartFileCheckpointReference, PartFileError, PartFileIdentity, PartFileSpan,
};
use crate::positional_io::{read_exact_at, write_all_at};
use crate::resume_validation::{ResumeStorageEvidence, ResumeValidationRejectReason};
use crate::storage_file_pool::{
    DEFAULT_STORAGE_FILE_LIMIT, PlatformStorageFailure, PlatformStorageFailureKind,
    PlatformStorageTarget, StorageFileAccess, StorageFileKey, StorageFileLease, StorageFileLocator,
    StorageFilePool, StorageFilePoolError, StorageFileReference, StorageFileRole,
    StorageObjectKind,
};

pub const VERIFICATION_CHUNK_LENGTH: usize = 16 * 1024;
pub const MAX_UPLOAD_READ_SEGMENTS: usize = MAX_REQUEST_BLOCK_LENGTH as usize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FastResumeValidation {
    pub evidence: ResumeStorageEvidence,
    pub committed_pieces: usize,
    pub relevant_files: usize,
    pub artifact_observations: usize,
    pub part_header_bytes: u64,
    pub payload_bytes_read: u64,
    pub hash_jobs: usize,
}

/// One-shot, in-memory physical extents from a completed content generation.
/// Construction stays in the storage owner after verification and durability.
#[derive(Debug)]
pub struct CompletedStorageEvidence {
    identity: TorrentArtifactIdentity,
    info_hashes: rstorrent_protocol::identity::InfoHashes,
    oversized: Vec<(usize, u64)>,
}

impl CompletedStorageEvidence {
    pub fn matches(&self, identity: TorrentArtifactIdentity) -> bool {
        self.identity == identity
    }

    pub(crate) fn torrent_id(&self) -> TorrentId {
        self.identity.torrent_id
    }

    pub(crate) fn matches_content(&self, torrent_id: TorrentId, content: &TorrentContent) -> bool {
        self.torrent_id() == torrent_id && self.info_hashes == content.info_hashes()
    }

    pub(crate) fn expected_length(&self, file_index: usize, logical_length: u64) -> u64 {
        self.oversized
            .binary_search_by_key(&file_index, |entry| entry.0)
            .map_or(logical_length, |index| self.oversized[index].1)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct StorageDiscoverySummary {
    pub expected_files: usize,
    pub present_files: usize,
    pub oversized_files: usize,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct SelectiveWriteStats {
    pub wanted_bytes: usize,
    pub skipped_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SelectionReconcileReport {
    pub route_epoch: u64,
    pub promoted_files: Vec<usize>,
    pub demoted_files: Vec<usize>,
    pub invalidated_pieces: Vec<usize>,
}

#[derive(Debug)]
pub struct SelectiveUploadReadPlan {
    request: BlockRequest,
    route_epoch: u64,
    spans: Vec<SelectiveUploadReadSpan>,
}

pub const MAX_ACTIVE_FILE_READ_BYTES: usize = 64 * 1024;

#[derive(Debug)]
pub struct SelectiveFileReadPlan {
    file_index: usize,
    offset: u64,
    length: usize,
    route_epoch: u64,
    source: RetainedFileSource,
}

impl SelectiveFileReadPlan {
    pub const fn file_index(&self) -> usize {
        self.file_index
    }

    pub const fn offset(&self) -> u64 {
        self.offset
    }

    pub const fn length(&self) -> usize {
        self.length
    }

    pub const fn route_epoch(&self) -> u64 {
        self.route_epoch
    }

    pub async fn execute(self) -> Result<Vec<u8>, SelectiveStorageError> {
        let source = self.source.acquire(StorageFileAccess::ReadExisting).await?;
        tokio::task::spawn_blocking(move || {
            let mut bytes = vec![0_u8; self.length];
            read_exact_at(source.file(), &mut bytes, self.offset)?;
            Ok::<_, io::Error>(bytes)
        })
        .await
        .map_err(|source| SelectiveStorageError::Io {
            operation: "join active file read",
            source: io::Error::other(source),
        })?
        .map_err(|source| SelectiveStorageError::Io {
            operation: "read active file range",
            source,
        })
    }
}

#[derive(Clone, Debug)]
enum SelectiveUploadReadSpan {
    File {
        source: RetainedFileSource,
        file_offset: u64,
        block_offset: usize,
        length: usize,
    },
    Part {
        source: PartFileCheckpointReference,
        file_offset: u64,
        block_offset: usize,
        length: usize,
    },
    Padding {
        block_offset: usize,
        length: usize,
    },
}

impl SelectiveUploadReadPlan {
    pub const fn request(&self) -> BlockRequest {
        self.request
    }

    pub const fn route_epoch(&self) -> u64 {
        self.route_epoch
    }

    pub fn segment_count(&self) -> usize {
        self.spans.len()
    }

    pub async fn execute(self) -> Result<Vec<u8>, SelectiveStorageError> {
        let mut block = vec![0_u8; self.request.length as usize];
        for span in self.spans {
            let (source, file_offset, block_offset, length) =
                match span {
                    SelectiveUploadReadSpan::File {
                        source,
                        file_offset,
                        block_offset,
                        length,
                    } => (
                        source.acquire(StorageFileAccess::ReadExisting).await?,
                        file_offset,
                        block_offset,
                        length,
                    ),
                    SelectiveUploadReadSpan::Part {
                        source,
                        file_offset,
                        block_offset,
                        length,
                    } => (
                        source
                            .acquire(StorageFileAccess::ReadExisting)
                            .await
                            .map_err(SelectiveStorageError::PartFile)?,
                        file_offset,
                        block_offset,
                        length,
                    ),
                    SelectiveUploadReadSpan::Padding {
                        block_offset,
                        length,
                    } => {
                        let end = block_offset.checked_add(length).ok_or(
                            SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow),
                        )?;
                        block
                            .get_mut(block_offset..end)
                            .ok_or(SelectiveStorageError::Layout(
                                LayoutError::ArithmeticOverflow,
                            ))?
                            .fill(0);
                        continue;
                    }
                };
            let bytes = tokio::task::spawn_blocking(move || {
                let mut bytes = vec![0_u8; length];
                read_exact_at(source.file(), &mut bytes, file_offset)?;
                Ok::<_, io::Error>(bytes)
            })
            .await
            .map_err(|source| SelectiveStorageError::Io {
                operation: "join active upload read",
                source: io::Error::other(source),
            })?
            .map_err(|source| SelectiveStorageError::Io {
                operation: "read active upload range",
                source,
            })?;
            let end =
                block_offset
                    .checked_add(bytes.len())
                    .ok_or(SelectiveStorageError::Layout(
                        LayoutError::ArithmeticOverflow,
                    ))?;
            block
                .get_mut(block_offset..end)
                .ok_or(SelectiveStorageError::Layout(
                    LayoutError::ArithmeticOverflow,
                ))?
                .copy_from_slice(&bytes);
        }
        Ok(block)
    }
}

#[derive(Debug)]
pub struct DescriptorFile {
    pub file_index: usize,
    pub file: std::fs::File,
}

#[derive(Debug)]
pub struct DescriptorStorage {
    pub wanted_files: Vec<DescriptorFile>,
    pub part_file: std::fs::File,
    pub reopened_part_file: std::fs::File,
}

#[cfg_attr(not(feature = "descriptor-storage-diagnostics"), allow(dead_code))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DescriptorFileRole {
    Wanted,
    Skipped,
    Padding,
}

#[cfg_attr(not(feature = "descriptor-storage-diagnostics"), allow(dead_code))]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DescriptorStoragePlanFile {
    pub file_index: usize,
    pub path: Vec<String>,
    pub length: u64,
    pub role: DescriptorFileRole,
}

#[cfg_attr(not(feature = "descriptor-storage-diagnostics"), allow(dead_code))]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DescriptorStoragePlan {
    pub info_hash: [u8; 20],
    pub name: String,
    pub content_shape: ContentShape,
    pub files: Vec<DescriptorStoragePlanFile>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TorrentStoragePaths {
    /// Whether direct content is one file or a directory tree.
    pub content_shape: ContentShape,
    /// Final metainfo-derived file or directory beneath the selected root.
    pub content: PathBuf,
    /// Hidden, opaque-owner-keyed selective boundary-byte part file.
    pub part: PathBuf,
}

/// Placement policy for the selective boundary-byte part artifact used by
/// path-backed storage.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub enum PathPartLocation {
    /// Keep the opaque owner-keyed part artifact beside ordinary content.
    #[default]
    AdjacentToPayload,
    /// Keep the same artifact in a caller-owned auxiliary directory.
    AuxiliaryDirectory(PathBuf),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TorrentArtifactIdentity {
    pub torrent_id: TorrentId,
    pub content_fingerprint: ContentFingerprint,
}

impl TorrentArtifactIdentity {
    fn part_file(self, layout: &ContentLayout) -> PartFileIdentity {
        PartFileIdentity {
            torrent_id: self.torrent_id,
            content_fingerprint: self.content_fingerprint,
            piece_count: layout.piece_count(),
            piece_length: layout.piece_length(),
            total_length: layout.total_length(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct PlatformStorageSpec {
    pub pool: StorageFilePool,
    pub root_id: String,
    pub storage_id: String,
    pub content_name: String,
    pub content_shape: ContentShape,
    pub storage_generation: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResumedStorage {
    Created,
    Existing,
}

#[derive(Debug)]
pub enum SelectiveStorageError {
    InvalidOutputPath,
    InvalidContentName,
    ExistingPartFile(PathBuf),
    UnexpectedFileType {
        path: PathBuf,
    },
    UnexpectedFileLength {
        file_index: usize,
        expected: u64,
        actual: u64,
    },
    Layout(LayoutError),
    Merkle(MerkleError),
    PartFile(PartFileError),
    MissingWantedFile {
        file_index: usize,
    },
    StaleWriteRoute {
        file_index: usize,
    },
    InvalidDescriptorManifest {
        role: &'static str,
        file_index: usize,
        reason: &'static str,
    },
    NonemptyDescriptor {
        role: &'static str,
        file_index: usize,
        length: u64,
    },
    PaddingInPeerBlock,
    InvalidVerifiedPiece {
        piece_index: usize,
    },
    IncompleteSelection {
        piece_index: usize,
    },
    InvalidStorageOperation(&'static str),
    Io {
        operation: &'static str,
        source: io::Error,
    },
}

impl fmt::Display for SelectiveStorageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidOutputPath => write!(formatter, "output path has no file name"),
            Self::InvalidContentName => {
                write!(formatter, "content name is not one safe path component")
            }
            Self::ExistingPartFile(path) => {
                write!(formatter, "part file already exists: {}", path.display())
            }
            Self::UnexpectedFileType { path } => {
                write!(
                    formatter,
                    "resumable storage is not a regular file: {}",
                    path.display()
                )
            }
            Self::UnexpectedFileLength {
                file_index,
                expected,
                actual,
            } => write!(
                formatter,
                "resumable file {file_index} has length {actual}, expected {expected}"
            ),
            Self::Layout(error) => write!(formatter, "storage layout: {error}"),
            Self::Merkle(error) => write!(formatter, "storage Merkle verification: {error}"),
            Self::PartFile(error) => write!(formatter, "part file: {error}"),
            Self::MissingWantedFile { file_index } => {
                write!(formatter, "wanted file {file_index} is not open")
            }
            Self::StaleWriteRoute { file_index } => {
                write!(formatter, "wanted file {file_index} write route is stale")
            }
            Self::InvalidDescriptorManifest {
                role,
                file_index,
                reason,
            } => write!(
                formatter,
                "{role} descriptor for file {file_index} is invalid: {reason}"
            ),
            Self::NonemptyDescriptor {
                role,
                file_index,
                length,
            } => write!(
                formatter,
                "{role} descriptor for file {file_index} is not empty: {length} bytes"
            ),
            Self::PaddingInPeerBlock => {
                write!(formatter, "peer block unexpectedly includes padding")
            }
            Self::InvalidVerifiedPiece { piece_index } => {
                write!(formatter, "verified piece index {piece_index} is invalid")
            }
            Self::IncompleteSelection { piece_index } => {
                write!(formatter, "required piece {piece_index} is not verified")
            }
            Self::InvalidStorageOperation(operation) => {
                write!(formatter, "{operation} is invalid for this storage backing")
            }
            Self::Io { operation, source } => write!(formatter, "{operation}: {source}"),
        }
    }
}

impl Error for SelectiveStorageError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Layout(error) => Some(error),
            Self::Merkle(error) => Some(error),
            Self::PartFile(error) => Some(error),
            Self::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

impl SelectiveStorageError {
    pub fn platform_failure_kind(&self) -> Option<PlatformStorageFailureKind> {
        match self {
            Self::PartFile(error) => error.platform_failure_kind(),
            Self::Io { source, .. } => source
                .get_ref()
                .and_then(|error| error.downcast_ref::<StorageFilePoolError>())
                .and_then(StorageFilePoolError::platform_failure_kind),
            _ => None,
        }
    }

    pub(crate) fn is_missing_or_short_source(&self) -> bool {
        match self {
            Self::MissingWantedFile { .. } => true,
            Self::UnexpectedFileLength {
                expected, actual, ..
            } => actual < expected,
            Self::PartFile(
                PartFileError::MissingSlot { .. } | PartFileError::TruncatedPayload { .. },
            ) => true,
            _ if self.platform_failure_kind() == Some(PlatformStorageFailureKind::Missing) => true,
            _ => error_chain_contains_absent_source(self),
        }
    }
}

fn error_chain_contains_absent_source(error: &(dyn Error + 'static)) -> bool {
    let mut current = error.source();
    while let Some(source) = current {
        if source.downcast_ref::<io::Error>().is_some_and(|error| {
            matches!(
                error.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::UnexpectedEof
            )
        }) || source
            .downcast_ref::<PlatformStorageFailure>()
            .is_some_and(|failure| failure.kind == PlatformStorageFailureKind::Missing)
        {
            return true;
        }
        current = source.source();
    }
    false
}

async fn validate_expected_parent_chain(
    root: &Path,
    components: &[String],
    validated: &mut BTreeSet<PathBuf>,
) -> Result<(), SelectiveStorageError> {
    let mut parent = root.to_path_buf();
    for component in components.iter().take(components.len().saturating_sub(1)) {
        parent.push(component);
        if validated.contains(&parent) {
            continue;
        }
        match tokio::fs::symlink_metadata(&parent).await {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
                validated.insert(parent.clone());
            }
            Ok(_) => {
                return Err(SelectiveStorageError::UnexpectedFileType {
                    path: parent.clone(),
                });
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(source) => {
                return Err(SelectiveStorageError::Io {
                    operation: "inspect expected payload parent",
                    source,
                });
            }
        }
    }
    Ok(())
}

impl From<LayoutError> for SelectiveStorageError {
    fn from(error: LayoutError) -> Self {
        Self::Layout(error)
    }
}

impl From<MerkleError> for SelectiveStorageError {
    fn from(error: MerkleError) -> Self {
        Self::Merkle(error)
    }
}

impl From<PartFileError> for SelectiveStorageError {
    fn from(error: PartFileError) -> Self {
        Self::PartFile(error)
    }
}

#[derive(Debug)]
enum StorageBacking {
    Paths {
        content_root: PathBuf,
        part_path: PathBuf,
        part_reference: StorageFileReference,
        storage_id: String,
    },
    Platform {
        spec: PlatformStorageSpec,
        part_reference: StorageFileReference,
    },
    Descriptors {
        reopened_part_file: Option<std::fs::File>,
    },
}

#[derive(Debug)]
pub struct SelectiveStorage {
    content: Option<Arc<TorrentContent>>,
    backing: StorageBacking,
    identity: PartFileIdentity,
    content_shape: ContentShape,
    layout: ContentLayout,
    selection: FileSelection,
    files: Vec<Option<RetainedFile>>,
    skipped_sources: Vec<Option<RetainedFileSource>>,
    part_file: Option<PartFile>,
    part_checkpoint_handle: Option<Arc<OnceLock<CheckpointFileReference>>>,
    pending_promotions: Vec<usize>,
    route_epoch: u64,
    verified: Vec<bool>,
    storage_generation: u64,
}

pub(crate) type CheckpointHandles =
    BTreeMap<DurabilityTarget, Arc<OnceLock<CheckpointFileReference>>>;

#[derive(Clone, Debug)]
pub(crate) enum CheckpointFileReference {
    Dynamic(StorageFileReference),
    Fixed(StorageFileLease),
}

impl CheckpointFileReference {
    pub(crate) async fn acquire(&self) -> Result<StorageFileLease, SelectiveStorageError> {
        match self {
            Self::Dynamic(reference) => reference
                .open(StorageFileAccess::ReadWriteExisting)
                .await
                .map(StorageFileLease::from)
                .map_err(|error| SelectiveStorageError::Io {
                    operation: "acquire durability checkpoint file",
                    source: io::Error::other(error),
                }),
            Self::Fixed(file) => Ok(file.clone()),
        }
    }
}

#[derive(Clone, Debug)]
struct RetainedFile {
    source: RetainedFileSource,
    routing_generation: u64,
}

#[derive(Clone, Debug)]
enum RetainedFileSource {
    Dynamic {
        reference: StorageFileReference,
        file_index: usize,
        expected_length: u64,
    },
    Fixed(StorageFileLease),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RetainedSourceObservation {
    Exact,
    Missing,
    WrongLength(Option<u64>),
    WrongKind,
}

impl RetainedFileSource {
    async fn observe_exact(
        &self,
        expected_length: u64,
    ) -> Result<RetainedSourceObservation, SelectiveStorageError> {
        match self {
            Self::Dynamic { reference, .. } => {
                let observation =
                    reference
                        .observe()
                        .await
                        .map_err(|error| SelectiveStorageError::Io {
                            operation: "observe resume payload source",
                            source: io::Error::other(error),
                        })?;
                if !observation.exists {
                    return Ok(RetainedSourceObservation::Missing);
                }
                if observation.kind != Some(crate::storage_file_pool::StorageObjectKind::File) {
                    return Ok(RetainedSourceObservation::WrongKind);
                }
                Ok(if observation.length == Some(expected_length) {
                    RetainedSourceObservation::Exact
                } else {
                    RetainedSourceObservation::WrongLength(observation.length)
                })
            }
            Self::Fixed(file) => {
                let actual = file
                    .file()
                    .metadata()
                    .map_err(|source| SelectiveStorageError::Io {
                        operation: "inspect resume payload descriptor",
                        source,
                    })?
                    .len();
                Ok(if actual == expected_length {
                    RetainedSourceObservation::Exact
                } else {
                    RetainedSourceObservation::WrongLength(Some(actual))
                })
            }
        }
    }

    async fn acquire(
        &self,
        access: StorageFileAccess,
    ) -> Result<StorageFileLease, SelectiveStorageError> {
        match self {
            Self::Dynamic {
                reference,
                file_index,
                expected_length,
            } => {
                let file = reference.open(access).await.map(StorageFileLease::from);
                let file = match file {
                    Ok(file) => file,
                    Err(StorageFilePoolError::Io { source, .. })
                        if source.kind() == io::ErrorKind::NotFound =>
                    {
                        return Err(SelectiveStorageError::MissingWantedFile {
                            file_index: *file_index,
                        });
                    }
                    Err(StorageFilePoolError::PlatformFailure(failure))
                        if failure.kind == PlatformStorageFailureKind::Missing =>
                    {
                        return Err(SelectiveStorageError::MissingWantedFile {
                            file_index: *file_index,
                        });
                    }
                    Err(error) => {
                        return Err(SelectiveStorageError::Io {
                            operation: "acquire selected file",
                            source: io::Error::other(error),
                        });
                    }
                };
                let actual = file
                    .file()
                    .metadata()
                    .map_err(|source| SelectiveStorageError::Io {
                        operation: "inspect acquired selected file",
                        source,
                    })?
                    .len();
                if actual >= *expected_length {
                    return Ok(file);
                }
                if matches!(access, StorageFileAccess::ReadWriteCreate) {
                    file.file().set_len(*expected_length).map_err(|source| {
                        SelectiveStorageError::Io {
                            operation: "size acquired selected file",
                            source,
                        }
                    })?;
                    return Ok(file);
                }
                Err(SelectiveStorageError::UnexpectedFileLength {
                    file_index: *file_index,
                    expected: *expected_length,
                    actual,
                })
            }
            Self::Fixed(file) => Ok(file.clone()),
        }
    }

    fn checkpoint_reference(&self) -> CheckpointFileReference {
        match self {
            Self::Dynamic { reference, .. } => CheckpointFileReference::Dynamic(reference.clone()),
            Self::Fixed(file) => CheckpointFileReference::Fixed(file.clone()),
        }
    }

    async fn is_available(&self) -> Result<bool, SelectiveStorageError> {
        match self {
            Self::Dynamic {
                reference,
                expected_length,
                ..
            } => {
                let file = match reference.open(StorageFileAccess::ReadExisting).await {
                    Ok(file) => file,
                    Err(StorageFilePoolError::Io { source, .. })
                        if source.kind() == io::ErrorKind::NotFound =>
                    {
                        return Ok(false);
                    }
                    Err(StorageFilePoolError::PlatformFailure(failure))
                        if failure.kind == PlatformStorageFailureKind::Missing =>
                    {
                        return Ok(false);
                    }
                    Err(error) => {
                        return Err(SelectiveStorageError::Io {
                            operation: "probe selected file source",
                            source: io::Error::other(error),
                        });
                    }
                };
                Ok(file
                    .file()
                    .metadata()
                    .map_err(|source| SelectiveStorageError::Io {
                        operation: "inspect selected file source",
                        source,
                    })?
                    .len()
                    >= *expected_length)
            }
            Self::Fixed(_) => Ok(true),
        }
    }
}

impl RetainedFile {
    async fn new(control: File, operation: &'static str) -> Result<Self, SelectiveStorageError> {
        let file = control.into_std().await;
        let _ = operation;
        Ok(Self {
            source: RetainedFileSource::Fixed(StorageFileLease::fixed(file)),
            routing_generation: 0,
        })
    }

    fn dynamic(reference: StorageFileReference, file_index: usize, expected_length: u64) -> Self {
        Self {
            source: RetainedFileSource::Dynamic {
                reference,
                file_index,
                expected_length,
            },
            routing_generation: 0,
        }
    }

    async fn acquire(
        &self,
        access: StorageFileAccess,
    ) -> Result<StorageFileLease, SelectiveStorageError> {
        self.source.acquire(access).await
    }

    fn checkpoint_reference(&self) -> CheckpointFileReference {
        self.source.checkpoint_reference()
    }
}

#[derive(Clone, Debug)]
struct SelectiveWritePlan {
    payload: Arc<Vec<u8>>,
    spans: Vec<SelectiveWriteSpan>,
    stats: SelectiveWriteStats,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SelectiveWriteSpan {
    destination: SelectiveWriteDestination,
    block_offset: usize,
    length: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SelectiveWriteDestination {
    WantedFile {
        file_index: usize,
        file_offset: u64,
        routing_generation: u64,
    },
    PartFile(PartFileSpan),
}

#[derive(Debug)]
struct ExecutableWriteSpan {
    file: ExecutableFileSource,
    file_offset: u64,
    block_offset: usize,
    length: usize,
}

#[derive(Clone, Debug)]
enum ExecutableFileSource {
    Wanted(RetainedFileSource),
    Part(PartFileCheckpointReference),
}

impl ExecutableFileSource {
    async fn acquire_write(&self) -> Result<StorageFileLease, SelectiveStorageError> {
        match self {
            Self::Wanted(source) => source.acquire(StorageFileAccess::ReadWriteCreate).await,
            Self::Part(source) => source
                .acquire(StorageFileAccess::ReadWriteExisting)
                .await
                .map_err(SelectiveStorageError::PartFile),
        }
    }
}

#[derive(Debug)]
pub(crate) struct SelectiveWriteJob {
    payload: Arc<Vec<u8>>,
    spans: Vec<ExecutableWriteSpan>,
    stats: SelectiveWriteStats,
}

impl SelectiveWriteJob {
    pub(crate) async fn execute(self) -> Result<SelectiveWriteStats, SelectiveStorageError> {
        let payload = self.payload;
        for span in self.spans {
            let file = span.file.acquire_write().await?;
            let payload = payload.clone();
            tokio::task::spawn_blocking(move || {
                write_all_at(
                    file.file(),
                    &payload[span.block_offset..span.block_offset + span.length],
                    span.file_offset,
                )
            })
            .await
            .map_err(|source| SelectiveStorageError::Io {
                operation: "join positional selected write",
                source: io::Error::other(source),
            })?
            .map_err(|source| SelectiveStorageError::Io {
                operation: "write positional selected range",
                source,
            })?;
        }
        Ok(self.stats)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct SelectiveHashIoStats {
    wanted_file_seeks: usize,
    wanted_file_reads: usize,
    part_file_reads: usize,
    wanted_file_duplicates: usize,
    blocking_jobs: usize,
}

#[derive(Debug)]
pub(crate) struct SelectiveHashPlan {
    spans: Vec<BlockingHashSpan>,
    algorithm: PieceHashAlgorithm,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PieceHashAlgorithm {
    Sha1,
    V2Merkle { target_height: u8 },
    Hybrid { target_height: u8, zero_length: u32 },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ComputedPieceHash {
    Sha1([u8; 20]),
    Sha256 {
        root: Sha256Hash,
        retained_hash_high_water: usize,
    },
    Hybrid {
        sha1: [u8; 20],
        sha256_root: Sha256Hash,
        retained_hash_high_water: usize,
    },
}

#[derive(Clone, Debug)]
enum BlockingHashSpan {
    WantedFile {
        file: RetainedFileSource,
        file_offset: u64,
        length: usize,
    },
    PartFile {
        file: PartFileCheckpointReference,
        span: PartFileSpan,
    },
    Padding {
        length: usize,
    },
}

type BlockingHashResult = Result<([u8; 20], SelectiveHashIoStats), SelectiveStorageError>;

impl SelectiveHashPlan {
    async fn hash(self) -> BlockingHashResult {
        if self.algorithm != PieceHashAlgorithm::Sha1 {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "SHA-1 execution of a v2 hash plan",
            ));
        }
        let mut hasher = Sha1::new();
        let mut stats = SelectiveHashIoStats {
            blocking_jobs: 1,
            ..SelectiveHashIoStats::default()
        };
        let zeroes = [0_u8; VERIFICATION_CHUNK_LENGTH];
        for span in self.spans {
            match span {
                BlockingHashSpan::WantedFile {
                    file,
                    file_offset,
                    length,
                } => {
                    let file = file.acquire(StorageFileAccess::ReadExisting).await?;
                    let (next_hasher, reads) = spawn_blocking_hash_span(
                        hasher,
                        file,
                        file_offset,
                        length,
                        "read selected content range in blocking verification job",
                    )
                    .await?;
                    hasher = next_hasher;
                    stats.wanted_file_reads = stats.wanted_file_reads.saturating_add(reads);
                }
                BlockingHashSpan::PartFile { file, span } => {
                    let file = file
                        .acquire(StorageFileAccess::ReadExisting)
                        .await
                        .map_err(SelectiveStorageError::PartFile)?;
                    let (next_hasher, reads) = spawn_blocking_hash_span(
                        hasher,
                        file,
                        span.file_offset,
                        span.length,
                        "read part-file range in blocking verification job",
                    )
                    .await?;
                    hasher = next_hasher;
                    stats.part_file_reads = stats.part_file_reads.saturating_add(reads);
                }
                BlockingHashSpan::Padding { length } => {
                    let mut consumed = 0_usize;
                    while consumed < length {
                        let length = (length - consumed).min(zeroes.len());
                        hasher.update(&zeroes[..length]);
                        consumed += length;
                    }
                }
            }
        }
        Ok((hasher.finalize().into(), stats))
    }

    async fn hash_content(self) -> Result<ComputedPieceHash, SelectiveStorageError> {
        let (target_height, hybrid_zero_length) = match self.algorithm {
            PieceHashAlgorithm::Sha1 => {
                return self
                    .hash()
                    .await
                    .map(|(hash, _)| ComputedPieceHash::Sha1(hash));
            }
            PieceHashAlgorithm::V2Merkle { target_height } => (target_height, None),
            PieceHashAlgorithm::Hybrid {
                target_height,
                zero_length,
            } => (target_height, Some(zero_length)),
        };
        let mut accumulator = MerkleAccumulator::new(0)?;
        let mut sha1 = hybrid_zero_length.map(|_| Sha1::new());
        let mut high_water = 0;
        for span in self.spans {
            let (source, offset, length) = match span {
                BlockingHashSpan::WantedFile {
                    file,
                    file_offset,
                    length,
                } => (
                    file.acquire(StorageFileAccess::ReadExisting).await?,
                    file_offset,
                    length,
                ),
                BlockingHashSpan::PartFile { file, span } => (
                    file.acquire(StorageFileAccess::ReadExisting)
                        .await
                        .map_err(SelectiveStorageError::PartFile)?,
                    span.file_offset,
                    span.length,
                ),
                BlockingHashSpan::Padding { .. } => {
                    return Err(SelectiveStorageError::InvalidStorageOperation(
                        "v2 Merkle plan contains a padding span",
                    ));
                }
            };
            let (next_accumulator, next_sha1) = tokio::task::spawn_blocking(move || {
                hash_merkle_file_span_with_sha1(accumulator, sha1, source, offset, length)
            })
            .await
            .map_err(|source| SelectiveStorageError::Io {
                operation: "join v2 piece blocking verification job",
                source: io::Error::other(source),
            })??;
            accumulator = next_accumulator;
            sha1 = next_sha1;
            high_water = high_water.max(accumulator.retained_hash_high_water());
        }
        let root = accumulator.finish_padded_to(target_height)?;
        if let (Some(mut sha1), Some(zero_length)) = (sha1, hybrid_zero_length) {
            let zeroes = [0_u8; VERIFICATION_CHUNK_LENGTH];
            let mut remaining = usize::try_from(zero_length)
                .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
            while remaining != 0 {
                let length = remaining.min(zeroes.len());
                sha1.update(&zeroes[..length]);
                remaining -= length;
            }
            return Ok(ComputedPieceHash::Hybrid {
                sha1: sha1.finalize().into(),
                sha256_root: root,
                retained_hash_high_water: high_water,
            });
        }
        Ok(ComputedPieceHash::Sha256 {
            root,
            retained_hash_high_water: high_water,
        })
    }

    pub(crate) async fn hash_v2_leaves(self) -> Result<Vec<Sha256Hash>, SelectiveStorageError> {
        if !matches!(
            self.algorithm,
            PieceHashAlgorithm::V2Merkle { .. } | PieceHashAlgorithm::Hybrid { .. }
        ) {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "v2 leaf hashing requires a v2 Merkle plan",
            ));
        }
        if self.spans.len() != 1 {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "v2 piece leaf hashing requires one file-local span",
            ));
        }
        let span = self
            .spans
            .into_iter()
            .next()
            .expect("one v2 leaf span was checked");
        let BlockingHashSpan::WantedFile {
            file,
            file_offset,
            length,
        } = span
        else {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "v2 leaf hashing cannot use part or padding spans",
            ));
        };
        let file = file.acquire(StorageFileAccess::ReadExisting).await?;
        tokio::task::spawn_blocking(move || {
            let mut leaves = Vec::with_capacity(length.div_ceil(MERKLE_BLOCK_SIZE));
            let mut buffer = [0_u8; MERKLE_BLOCK_SIZE];
            let mut consumed = 0_usize;
            while consumed < length {
                let block_length = (length - consumed).min(MERKLE_BLOCK_SIZE);
                let offset = file_offset
                    .checked_add(u64::try_from(consumed).map_err(|_| {
                        SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow)
                    })?)
                    .ok_or(SelectiveStorageError::Layout(
                        LayoutError::ArithmeticOverflow,
                    ))?;
                read_exact_at(file.file(), &mut buffer[..block_length], offset).map_err(
                    |source| SelectiveStorageError::Io {
                        operation: "read selected v2 leaves in blocking verification job",
                        source,
                    },
                )?;
                leaves.push(hash_block(&buffer[..block_length])?);
                consumed += block_length;
            }
            Ok(leaves)
        })
        .await
        .map_err(|source| SelectiveStorageError::Io {
            operation: "join selected v2 leaf verification job",
            source: io::Error::other(source),
        })?
    }
}

fn hash_merkle_file_span_with_sha1(
    mut accumulator: MerkleAccumulator,
    mut sha1: Option<Sha1>,
    file: StorageFileLease,
    file_offset: u64,
    span_length: usize,
) -> Result<(MerkleAccumulator, Option<Sha1>), SelectiveStorageError> {
    let mut buffer = [0_u8; VERIFICATION_CHUNK_LENGTH];
    let mut consumed = 0_usize;
    while consumed < span_length {
        let length = (span_length - consumed).min(buffer.len());
        let offset = file_offset
            .checked_add(
                u64::try_from(consumed)
                    .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?,
            )
            .ok_or(SelectiveStorageError::Layout(
                LayoutError::ArithmeticOverflow,
            ))?;
        read_exact_at(file.file(), &mut buffer[..length], offset).map_err(|source| {
            SelectiveStorageError::Io {
                operation: "read selected v2 range in blocking verification job",
                source,
            }
        })?;
        if let Some(hasher) = sha1.as_mut() {
            hasher.update(&buffer[..length]);
        }
        accumulator.push(hash_block(&buffer[..length])?)?;
        consumed += length;
    }
    Ok((accumulator, sha1))
}

async fn spawn_blocking_hash_span(
    hasher: Sha1,
    file: StorageFileLease,
    file_offset: u64,
    span_length: usize,
    operation: &'static str,
) -> Result<(Sha1, usize), SelectiveStorageError> {
    tokio::task::spawn_blocking(move || {
        hash_file_span(hasher, file, file_offset, span_length, operation)
    })
    .await
    .map_err(|source| SelectiveStorageError::Io {
        operation: "join selected piece blocking verification job",
        source: io::Error::other(source),
    })?
}

fn hash_file_span(
    mut hasher: Sha1,
    file: StorageFileLease,
    file_offset: u64,
    span_length: usize,
    operation: &'static str,
) -> Result<(Sha1, usize), SelectiveStorageError> {
    let mut buffer = [0_u8; VERIFICATION_CHUNK_LENGTH];
    let mut consumed = 0_usize;
    let mut reads = 0_usize;
    while consumed < span_length {
        let length = (span_length - consumed).min(VERIFICATION_CHUNK_LENGTH);
        let offset = file_offset
            .checked_add(
                u64::try_from(consumed)
                    .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?,
            )
            .ok_or(SelectiveStorageError::Layout(
                LayoutError::ArithmeticOverflow,
            ))?;
        read_exact_at(file.file(), &mut buffer[..length], offset)
            .map_err(|source| SelectiveStorageError::Io { operation, source })?;
        hasher.update(&buffer[..length]);
        consumed += length;
        reads = reads.saturating_add(1);
    }
    Ok((hasher, reads))
}

impl SelectiveHashPlan {
    pub(crate) async fn execute_content(self) -> Result<ComputedPieceHash, SelectiveStorageError> {
        self.hash_content().await
    }
}

#[cfg(test)]
async fn await_blocking_hash(
    task: tokio::task::JoinHandle<BlockingHashResult>,
) -> BlockingHashResult {
    task.await.map_err(|source| SelectiveStorageError::Io {
        operation: "join selected piece blocking verification job",
        source: io::Error::other(source),
    })?
}

async fn sync_file(
    file: StorageFileLease,
    operation: &'static str,
) -> Result<(), SelectiveStorageError> {
    tokio::task::spawn_blocking(move || file.file().sync_data())
        .await
        .map_err(|source| SelectiveStorageError::Io {
            operation: "join selected file sync",
            source: io::Error::other(source),
        })?
        .map_err(|source| SelectiveStorageError::Io { operation, source })
}

impl SelectiveStorage {
    pub(crate) async fn inspect_discovered_payload(
        &self,
    ) -> Result<StorageDiscoverySummary, SelectiveStorageError> {
        let mut summary = StorageDiscoverySummary::default();
        for (file_index, metainfo_file) in self.layout.files().iter().enumerate() {
            if metainfo_file.padding {
                continue;
            }
            summary.expected_files += 1;
            let source = self.files[file_index]
                .as_ref()
                .map(|file| &file.source)
                .or_else(|| self.skipped_sources[file_index].as_ref());
            let Some(source) = source else { continue };
            let RetainedFileSource::Dynamic { reference, .. } = source else {
                return Err(SelectiveStorageError::InvalidStorageOperation(
                    "discovered payload uses fixed descriptors",
                ));
            };
            let observation =
                reference
                    .observe()
                    .await
                    .map_err(|error| SelectiveStorageError::Io {
                        operation: "observe discovered payload source",
                        source: io::Error::other(error),
                    })?;
            if !observation.exists {
                continue;
            }
            if observation.kind != Some(StorageObjectKind::File) {
                return Err(SelectiveStorageError::UnexpectedFileType {
                    path: PathBuf::from(metainfo_file.path.join("/")),
                });
            }
            summary.present_files += 1;
            if observation
                .length
                .is_some_and(|length| length > metainfo_file.length)
            {
                summary.oversized_files += 1;
            }
        }
        Ok(summary)
    }

    pub async fn create_content(
        output_root: PathBuf,
        artifact_identity: TorrentArtifactIdentity,
        content: Arc<TorrentContent>,
        skipped: &[usize],
    ) -> Result<Self, SelectiveStorageError> {
        let pool = StorageFilePool::new(DEFAULT_STORAGE_FILE_LIMIT, None)
            .expect("default storage file limit is nonzero");
        Self::create_content_with_pool(output_root, artifact_identity, content, skipped, pool).await
    }

    pub(crate) async fn create_content_with_pool(
        output_root: PathBuf,
        artifact_identity: TorrentArtifactIdentity,
        content: Arc<TorrentContent>,
        skipped: &[usize],
        pool: StorageFilePool,
    ) -> Result<Self, SelectiveStorageError> {
        Self::create_content_with_pool_and_part_location(
            output_root,
            artifact_identity,
            content,
            skipped,
            pool,
            &PathPartLocation::AdjacentToPayload,
        )
        .await
    }

    pub(crate) async fn create_content_with_pool_and_part_location(
        output_root: PathBuf,
        artifact_identity: TorrentArtifactIdentity,
        content: Arc<TorrentContent>,
        skipped: &[usize],
        pool: StorageFilePool,
        part_location: &PathPartLocation,
    ) -> Result<Self, SelectiveStorageError> {
        let layout = ContentLayout::from_content(&content);
        let selection = FileSelection::new_content(&layout, skipped)?;
        let paths = torrent_storage_paths_for_output_with_shape_and_part_location(
            output_root,
            artifact_identity.torrent_id,
            ContentShape::from_content(&content),
            part_location,
        )?;
        let mut storage =
            Self::create_with_paths_and_pool(paths, artifact_identity, layout, selection, pool)
                .await?;
        storage.content = Some(content);
        Ok(storage)
    }

    pub async fn resume_content(
        output_root: PathBuf,
        artifact_identity: TorrentArtifactIdentity,
        content: Arc<TorrentContent>,
        skipped: &[usize],
        verified: Vec<bool>,
    ) -> Result<(Self, ResumedStorage), SelectiveStorageError> {
        let pool = StorageFilePool::new(DEFAULT_STORAGE_FILE_LIMIT, None)
            .expect("default storage file limit is nonzero");
        Self::resume_content_with_pool_and_part_location(
            output_root,
            artifact_identity,
            content,
            skipped,
            verified,
            pool,
            &PathPartLocation::AdjacentToPayload,
        )
        .await
    }

    pub(crate) async fn resume_content_with_pool_and_part_location(
        output_root: PathBuf,
        artifact_identity: TorrentArtifactIdentity,
        content: Arc<TorrentContent>,
        skipped: &[usize],
        verified: Vec<bool>,
        pool: StorageFilePool,
        part_location: &PathPartLocation,
    ) -> Result<(Self, ResumedStorage), SelectiveStorageError> {
        let layout = ContentLayout::from_content(&content);
        let selection = FileSelection::new_content(&layout, skipped)?;
        let paths = torrent_storage_paths_for_output_with_shape_and_part_location(
            output_root,
            artifact_identity.torrent_id,
            ContentShape::from_content(&content),
            part_location,
        )?;
        let (mut storage, resumed) = Self::resume_with_paths_and_pool(
            paths,
            artifact_identity,
            layout,
            selection,
            verified,
            pool,
        )
        .await?;
        storage.content = Some(content);
        Ok((storage, resumed))
    }

    pub async fn create(
        output_root: PathBuf,
        artifact_identity: TorrentArtifactIdentity,
        metainfo: &Metainfo,
        layout: TorrentLayout,
        selection: FileSelection,
    ) -> Result<Self, SelectiveStorageError> {
        let paths = torrent_storage_paths_for_output_with_shape(
            output_root,
            artifact_identity.torrent_id,
            ContentShape::from_metainfo(metainfo),
        )?;
        Self::create_with_paths(paths, artifact_identity, layout, selection).await
    }

    #[cfg(test)]
    pub(crate) async fn create_with_pool(
        output_root: PathBuf,
        artifact_identity: TorrentArtifactIdentity,
        metainfo: &Metainfo,
        layout: TorrentLayout,
        selection: FileSelection,
        pool: StorageFilePool,
    ) -> Result<Self, SelectiveStorageError> {
        let paths = torrent_storage_paths_for_output_with_shape(
            output_root,
            artifact_identity.torrent_id,
            ContentShape::from_metainfo(metainfo),
        )?;
        Self::create_with_paths_and_pool(paths, artifact_identity, layout, selection, pool).await
    }

    pub(crate) async fn create_with_paths(
        paths: TorrentStoragePaths,
        artifact_identity: TorrentArtifactIdentity,
        layout: TorrentLayout,
        selection: FileSelection,
    ) -> Result<Self, SelectiveStorageError> {
        let pool = StorageFilePool::new(DEFAULT_STORAGE_FILE_LIMIT, None)
            .expect("default storage file limit is nonzero");
        Self::create_with_paths_and_pool(paths, artifact_identity, layout, selection, pool).await
    }

    pub(crate) async fn create_with_paths_and_pool(
        paths: TorrentStoragePaths,
        artifact_identity: TorrentArtifactIdentity,
        layout: impl Into<ContentLayout>,
        selection: FileSelection,
        pool: StorageFilePool,
    ) -> Result<Self, SelectiveStorageError> {
        let layout = layout.into();
        let TorrentStoragePaths {
            content_shape,
            content: content_root,
            part: part_path,
        } = paths;
        if path_exists(&part_path, "inspect selected part file").await? {
            return Err(SelectiveStorageError::ExistingPartFile(part_path));
        }

        let storage_id = storage_instance_id(artifact_identity.torrent_id);
        let mut files = Vec::with_capacity(layout.files().len());
        for (file_index, metainfo_file) in layout.files().iter().enumerate() {
            if metainfo_file.padding || !selection.is_wanted(file_index) {
                files.push(None);
                continue;
            }
            let path = payload_path(
                content_shape,
                &content_root,
                &metainfo_file.path,
                file_index,
                layout.files().len(),
            )?;
            files.push(Some(RetainedFile::dynamic(
                path_storage_reference(
                    &pool,
                    &storage_id,
                    0,
                    StorageFileRole::Payload(file_index),
                    path,
                )
                .with_origin_boundary(&content_root),
                file_index,
                metainfo_file.length,
            )));
        }

        let part_reference = path_storage_reference(
            &pool,
            &storage_id,
            0,
            StorageFileRole::Part,
            part_path.clone(),
        );

        let identity = artifact_identity.part_file(&layout);
        let piece_count = layout.piece_count();
        let skipped_sources = vec![None; layout.files().len()];

        Ok(Self {
            content: None,
            backing: StorageBacking::Paths {
                content_root,
                part_path,
                part_reference,
                storage_id,
            },
            identity,
            content_shape,
            layout,
            selection,
            files,
            skipped_sources,
            part_file: None,
            part_checkpoint_handle: None,
            pending_promotions: Vec::new(),
            route_epoch: 0,
            verified: vec![false; piece_count],
            storage_generation: 0,
        })
    }

    pub async fn create_with_platform(
        spec: PlatformStorageSpec,
        artifact_identity: TorrentArtifactIdentity,
        metainfo: &Metainfo,
        layout: TorrentLayout,
        selection: FileSelection,
        verified: Vec<bool>,
    ) -> Result<(Self, ResumedStorage), SelectiveStorageError> {
        let layout = ContentLayout::from(layout);
        Self::create_with_platform_layout(
            spec,
            artifact_identity,
            layout,
            selection,
            verified,
            ContentShape::from_metainfo(metainfo),
        )
        .await
    }

    pub async fn create_content_with_platform(
        spec: PlatformStorageSpec,
        artifact_identity: TorrentArtifactIdentity,
        content: Arc<TorrentContent>,
        skipped: &[usize],
        verified: Vec<bool>,
    ) -> Result<(Self, ResumedStorage), SelectiveStorageError> {
        let layout = ContentLayout::from_content(&content);
        let selection = FileSelection::new_content(&layout, skipped)?;
        let shape = ContentShape::from_content(&content);
        let (mut storage, resumed) = Self::create_with_platform_layout(
            spec,
            artifact_identity,
            layout,
            selection,
            verified,
            shape,
        )
        .await?;
        storage.content = Some(content);
        Ok((storage, resumed))
    }

    async fn create_with_platform_layout(
        spec: PlatformStorageSpec,
        artifact_identity: TorrentArtifactIdentity,
        layout: ContentLayout,
        selection: FileSelection,
        verified: Vec<bool>,
        content_shape: ContentShape,
    ) -> Result<(Self, ResumedStorage), SelectiveStorageError> {
        validate_content_name(&spec.content_name)?;
        if spec.content_shape != content_shape {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "platform content shape",
            ));
        }
        if spec.storage_id != storage_instance_id(artifact_identity.torrent_id) {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "platform storage identity",
            ));
        }
        if verified.len() != layout.piece_count() {
            return Err(SelectiveStorageError::InvalidVerifiedPiece {
                piece_index: verified.len(),
            });
        }
        let content_observation =
            platform_storage_reference(&spec, StorageFileRole::ContentRoot, Vec::new())
                .observe()
                .await
                .map_err(|error| SelectiveStorageError::Io {
                    operation: "observe direct platform content",
                    source: io::Error::other(error),
                })?;
        let part_observation = platform_storage_reference(&spec, StorageFileRole::Part, Vec::new())
            .observe()
            .await
            .map_err(|error| SelectiveStorageError::Io {
                operation: "observe direct platform part file",
                source: io::Error::other(error),
            })?;
        let expected_content_kind = match content_shape {
            ContentShape::File => StorageObjectKind::File,
            ContentShape::Tree => StorageObjectKind::Directory,
        };
        if content_observation.exists && content_observation.kind != Some(expected_content_kind) {
            return Err(SelectiveStorageError::UnexpectedFileType {
                path: PathBuf::from(&spec.content_name),
            });
        }
        if part_observation.exists && part_observation.kind != Some(StorageObjectKind::File) {
            return Err(SelectiveStorageError::UnexpectedFileType {
                path: PathBuf::from(format!(".{}.rstorrent-parts", spec.storage_id)),
            });
        }
        if layout.format() == MetainfoFormat::V2 && part_observation.exists {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "v2 content cannot resume a part artifact",
            ));
        }
        let resumed = if content_observation.exists || part_observation.exists {
            ResumedStorage::Existing
        } else {
            ResumedStorage::Created
        };
        let discovered_part = part_observation.exists;
        if resumed != ResumedStorage::Created {
            spec.pool.invalidate_storage(&spec.storage_id);
        }
        let resuming = resumed != ResumedStorage::Created;
        let mut files = Vec::with_capacity(layout.files().len());
        let mut skipped_sources = Vec::with_capacity(layout.files().len());
        for (file_index, metainfo_file) in layout.files().iter().enumerate() {
            if metainfo_file.padding {
                files.push(None);
                skipped_sources.push(None);
                continue;
            }
            let source = RetainedFileSource::Dynamic {
                reference: platform_storage_reference(
                    &spec,
                    StorageFileRole::Payload(file_index),
                    metainfo_file.path.clone(),
                ),
                file_index,
                expected_length: metainfo_file.length,
            };
            if selection.is_wanted(file_index) {
                files.push(Some(RetainedFile {
                    source,
                    routing_generation: 0,
                }));
                skipped_sources.push(None);
            } else if resuming {
                files.push(None);
                skipped_sources.push(Some(source));
            } else {
                files.push(None);
                skipped_sources.push(None);
            }
        }
        let part_reference = platform_storage_reference(&spec, StorageFileRole::Part, Vec::new());
        let identity = artifact_identity.part_file(&layout);
        let piece_count = layout.piece_count();
        let part_file = if discovered_part {
            Some(PartFile::open_with_reference(part_reference.clone(), None, identity).await?)
        } else {
            None
        };
        Ok((
            Self {
                content: None,
                backing: StorageBacking::Platform {
                    spec: spec.clone(),
                    part_reference,
                },
                identity,
                content_shape: spec.content_shape,
                layout,
                selection,
                files,
                skipped_sources,
                part_file,
                part_checkpoint_handle: None,
                pending_promotions: Vec::new(),
                route_epoch: 0,
                verified: if resumed == ResumedStorage::Created {
                    vec![false; piece_count]
                } else {
                    verified
                },
                storage_generation: spec.storage_generation,
            },
            resumed,
        ))
    }

    pub async fn create_with_descriptors(
        artifact_identity: TorrentArtifactIdentity,
        metainfo: &Metainfo,
        layout: TorrentLayout,
        selection: FileSelection,
        descriptors: DescriptorStorage,
    ) -> Result<Self, SelectiveStorageError> {
        let layout = ContentLayout::from(layout);
        let mut wanted_files =
            collect_descriptors(layout.files().len(), "wanted", descriptors.wanted_files)?;

        let mut files = Vec::with_capacity(layout.files().len());
        for (file_index, metainfo_file) in layout.files().iter().enumerate() {
            let expected = !metainfo_file.padding && selection.is_wanted(file_index);
            let provided = wanted_files[file_index].take();
            match (expected, provided) {
                (true, Some(file)) => {
                    files.push(Some(
                        RetainedFile::new(
                            initialize_descriptor_file(
                                file,
                                "wanted",
                                file_index,
                                metainfo_file.length,
                            )
                            .await?,
                            "retain selected descriptor",
                        )
                        .await?,
                    ));
                }
                (true, None) => {
                    return Err(SelectiveStorageError::InvalidDescriptorManifest {
                        role: "wanted",
                        file_index,
                        reason: "required descriptor is missing",
                    });
                }
                (false, Some(_)) => {
                    return Err(SelectiveStorageError::InvalidDescriptorManifest {
                        role: "wanted",
                        file_index,
                        reason: "descriptor is not expected by the selection",
                    });
                }
                (false, None) => files.push(None),
            }
        }

        let identity = artifact_identity.part_file(&layout);
        let part_file = PartFile::create_preopened(descriptors.part_file, identity).await?;
        let validation_reopen = descriptors
            .reopened_part_file
            .try_clone()
            .map_err(|source| SelectiveStorageError::Io {
                operation: "duplicate descriptor for part-file identity validation",
                source,
            })?;
        drop(PartFile::open_preopened(validation_reopen, identity).await?);
        let piece_count = layout.piece_count();
        let skipped_sources = vec![None; layout.files().len()];

        Ok(Self {
            content: None,
            backing: StorageBacking::Descriptors {
                reopened_part_file: Some(descriptors.reopened_part_file),
            },
            identity,
            content_shape: ContentShape::from_metainfo(metainfo),
            layout,
            selection,
            files,
            skipped_sources,
            part_file: Some(part_file),
            part_checkpoint_handle: None,
            pending_promotions: Vec::new(),
            route_epoch: 0,
            verified: vec![false; piece_count],
            storage_generation: 0,
        })
    }

    pub async fn resume_with_descriptors(
        artifact_identity: TorrentArtifactIdentity,
        metainfo: &Metainfo,
        layout: TorrentLayout,
        selection: FileSelection,
        descriptors: DescriptorStorage,
        verified: Vec<bool>,
    ) -> Result<Self, SelectiveStorageError> {
        let layout = ContentLayout::from(layout);
        if verified.len() != layout.piece_count() {
            return Err(SelectiveStorageError::InvalidVerifiedPiece {
                piece_index: verified.len(),
            });
        }
        let mut wanted_files =
            collect_descriptors(layout.files().len(), "wanted", descriptors.wanted_files)?;
        let mut files = Vec::with_capacity(layout.files().len());
        for (file_index, metainfo_file) in layout.files().iter().enumerate() {
            let expected = !metainfo_file.padding && selection.is_wanted(file_index);
            let provided = wanted_files[file_index].take();
            match (expected, provided) {
                (true, Some(file)) => {
                    files.push(Some(
                        RetainedFile::new(
                            validate_descriptor_length(file, file_index, metainfo_file.length)
                                .await?,
                            "retain resumed selected descriptor",
                        )
                        .await?,
                    ));
                }
                (true, None) => {
                    return Err(SelectiveStorageError::InvalidDescriptorManifest {
                        role: "wanted",
                        file_index,
                        reason: "required descriptor is missing",
                    });
                }
                (false, Some(_)) => {
                    return Err(SelectiveStorageError::InvalidDescriptorManifest {
                        role: "wanted",
                        file_index,
                        reason: "descriptor is not expected by the selection",
                    });
                }
                (false, None) => files.push(None),
            }
        }

        let identity = artifact_identity.part_file(&layout);
        let part_file = PartFile::open_preopened(descriptors.part_file, identity).await?;
        let validation_reopen = descriptors
            .reopened_part_file
            .try_clone()
            .map_err(|source| SelectiveStorageError::Io {
                operation: "duplicate descriptor for resumed part-file identity validation",
                source,
            })?;
        drop(PartFile::open_preopened(validation_reopen, identity).await?);

        let skipped_sources = vec![None; layout.files().len()];
        Ok(Self {
            content: None,
            backing: StorageBacking::Descriptors {
                reopened_part_file: Some(descriptors.reopened_part_file),
            },
            identity,
            content_shape: ContentShape::from_metainfo(metainfo),
            layout,
            selection,
            files,
            skipped_sources,
            part_file: Some(part_file),
            part_checkpoint_handle: None,
            pending_promotions: Vec::new(),
            route_epoch: 0,
            verified,
            storage_generation: 0,
        })
    }

    pub async fn resume(
        output_root: PathBuf,
        artifact_identity: TorrentArtifactIdentity,
        metainfo: &Metainfo,
        layout: TorrentLayout,
        selection: FileSelection,
        verified: Vec<bool>,
    ) -> Result<(Self, ResumedStorage), SelectiveStorageError> {
        let paths = torrent_storage_paths_for_output_with_shape(
            output_root,
            artifact_identity.torrent_id,
            ContentShape::from_metainfo(metainfo),
        )?;
        Self::resume_with_paths(paths, artifact_identity, layout, selection, verified).await
    }

    pub(crate) async fn resume_with_paths(
        paths: TorrentStoragePaths,
        artifact_identity: TorrentArtifactIdentity,
        layout: TorrentLayout,
        selection: FileSelection,
        verified: Vec<bool>,
    ) -> Result<(Self, ResumedStorage), SelectiveStorageError> {
        let pool = StorageFilePool::new(DEFAULT_STORAGE_FILE_LIMIT, None)
            .expect("default storage file limit is nonzero");
        Self::resume_with_paths_and_pool(
            paths,
            artifact_identity,
            layout,
            selection,
            verified,
            pool,
        )
        .await
    }

    pub(crate) async fn resume_with_paths_and_pool(
        paths: TorrentStoragePaths,
        artifact_identity: TorrentArtifactIdentity,
        layout: impl Into<ContentLayout>,
        selection: FileSelection,
        verified: Vec<bool>,
        pool: StorageFilePool,
    ) -> Result<(Self, ResumedStorage), SelectiveStorageError> {
        let layout = layout.into();
        if verified.len() != layout.piece_count() {
            return Err(SelectiveStorageError::InvalidVerifiedPiece {
                piece_index: verified.len(),
            });
        }
        let TorrentStoragePaths {
            content_shape,
            content: content_root,
            part: part_path,
        } = paths;
        let storage_id = storage_instance_id(artifact_identity.torrent_id);
        // Recheck must observe current paths instead of an open handle
        // retained by the preceding download/check generation.
        pool.invalidate_storage(&storage_id);
        let content_exists = path_exists(&content_root, "inspect resumable direct content").await?;
        let part_exists = path_exists(&part_path, "inspect resumable part file").await?;
        if layout.format() == MetainfoFormat::V2 && part_exists {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "v2 content cannot resume a part artifact",
            ));
        }

        if !content_exists && !part_exists {
            let storage = Self::create_with_paths_and_pool(
                TorrentStoragePaths {
                    content_shape,
                    content: content_root,
                    part: part_path,
                },
                artifact_identity,
                layout,
                selection,
                pool,
            )
            .await?;
            return Ok((storage, ResumedStorage::Created));
        }

        let artifact_root = &content_root;
        let resumed = ResumedStorage::Existing;
        let storage_generation = 0;
        if content_exists {
            let artifact_metadata =
                tokio::fs::symlink_metadata(artifact_root)
                    .await
                    .map_err(|source| SelectiveStorageError::Io {
                        operation: "inspect resumable payload artifact",
                        source,
                    })?;
            let expected_type = match content_shape {
                ContentShape::File => artifact_metadata.is_file(),
                ContentShape::Tree => artifact_metadata.is_dir(),
            };
            if !expected_type || artifact_metadata.file_type().is_symlink() {
                return Err(SelectiveStorageError::UnexpectedFileType {
                    path: artifact_root.clone(),
                });
            }
        }

        let mut files = Vec::with_capacity(layout.files().len());
        let mut skipped_sources = Vec::with_capacity(layout.files().len());
        let mut pending_promotions = Vec::new();
        let mut validated_parents = BTreeSet::new();
        for (file_index, metainfo_file) in layout.files().iter().enumerate() {
            if metainfo_file.padding {
                files.push(None);
                skipped_sources.push(None);
                continue;
            }
            let path = payload_path(
                content_shape,
                artifact_root,
                &metainfo_file.path,
                file_index,
                layout.files().len(),
            )?;
            if content_exists && content_shape == ContentShape::Tree {
                validate_expected_parent_chain(
                    artifact_root,
                    &metainfo_file.path,
                    &mut validated_parents,
                )
                .await?;
            }
            match tokio::fs::symlink_metadata(&path).await {
                Ok(metadata) => {
                    if !metadata.is_file() || metadata.file_type().is_symlink() {
                        return Err(SelectiveStorageError::UnexpectedFileType { path });
                    }
                    let source = RetainedFileSource::Dynamic {
                        reference: path_storage_reference(
                            &pool,
                            &storage_id,
                            storage_generation,
                            StorageFileRole::Payload(file_index),
                            path,
                        )
                        .with_origin_boundary(&content_root),
                        file_index,
                        expected_length: metainfo_file.length,
                    };
                    if selection.is_wanted(file_index) {
                        files.push(Some(RetainedFile {
                            source,
                            routing_generation: 0,
                        }));
                        skipped_sources.push(None);
                    } else {
                        files.push(None);
                        skipped_sources.push(Some(source));
                    }
                }
                Err(source) if source.kind() == io::ErrorKind::NotFound => {
                    if !selection.is_wanted(file_index) {
                        files.push(None);
                        skipped_sources.push(None);
                        continue;
                    }
                    files.push(Some(RetainedFile::dynamic(
                        path_storage_reference(
                            &pool,
                            &storage_id,
                            storage_generation,
                            StorageFileRole::Payload(file_index),
                            path,
                        )
                        .with_origin_boundary(&content_root),
                        file_index,
                        metainfo_file.length,
                    )));
                    skipped_sources.push(None);
                    pending_promotions.push(file_index);
                }
                Err(source) => {
                    return Err(SelectiveStorageError::Io {
                        operation: "inspect resumable selected file",
                        source,
                    });
                }
            }
        }

        let identity = artifact_identity.part_file(&layout);
        let part_reference = path_storage_reference(
            &pool,
            &storage_id,
            storage_generation,
            StorageFileRole::Part,
            part_path.clone(),
        );
        let part_file = if part_exists {
            Some(
                PartFile::open_with_reference(
                    part_reference.clone(),
                    Some(part_path.clone()),
                    identity,
                )
                .await?,
            )
        } else {
            None
        };
        let storage = Self {
            content: None,
            backing: StorageBacking::Paths {
                content_root,
                part_path,
                part_reference,
                storage_id,
            },
            identity,
            content_shape,
            layout,
            selection,
            files,
            skipped_sources,
            part_file,
            part_checkpoint_handle: None,
            pending_promotions,
            route_epoch: 0,
            verified,
            storage_generation,
        };
        Ok((storage, resumed))
    }

    pub fn selected_bytes(&self) -> u64 {
        self.layout
            .files()
            .iter()
            .enumerate()
            .filter(|(index, file)| !file.padding && self.selection.is_wanted(*index))
            .map(|(_, file)| file.length)
            .sum()
    }

    /// Validate committed resume pieces from artifact structure alone.
    ///
    /// This method never reads payload bytes and never schedules hash work.
    pub(crate) async fn validate_fast_resume(
        &mut self,
        resumed: ResumedStorage,
    ) -> Result<FastResumeValidation, SelectiveStorageError> {
        self.validate_resume_extents(resumed, None).await
    }

    async fn validate_resume_extents(
        &mut self,
        resumed: ResumedStorage,
        completed: Option<&CompletedStorageEvidence>,
    ) -> Result<FastResumeValidation, SelectiveStorageError> {
        if completed.is_some_and(|proof| {
            !proof.matches(TorrentArtifactIdentity {
                torrent_id: self.identity.torrent_id,
                content_fingerprint: self.identity.content_fingerprint,
            })
        }) {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "completed storage evidence has a different identity",
            ));
        }
        let committed_pieces = self.verified.iter().filter(|verified| **verified).count();
        let mut validation = FastResumeValidation {
            evidence: ResumeStorageEvidence::Matches,
            committed_pieces,
            relevant_files: 0,
            artifact_observations: 0,
            part_header_bytes: self.part_file.as_ref().map_or(0, PartFile::header_length),
            payload_bytes_read: 0,
            hash_jobs: 0,
        };
        if resumed == ResumedStorage::Created && committed_pieces != 0 {
            validation.evidence = ResumeStorageEvidence::ContentMismatch(
                ResumeValidationRejectReason::CreatedStorageWithCommittedPieces,
            );
            return Ok(validation);
        }
        if committed_pieces == 0 {
            if resumed == ResumedStorage::Existing {
                validation.evidence = ResumeStorageEvidence::ContentMismatch(
                    ResumeValidationRejectReason::PendingVerification,
                );
            }
            return Ok(validation);
        }

        // Prefix counts let each file ask whether its piece interval contains
        // a committed bit without a file-by-piece nested scan.
        let mut committed_prefix = Vec::with_capacity(self.verified.len() + 1);
        committed_prefix.push(0_u32);
        for verified in &self.verified {
            let next = committed_prefix
                .last()
                .copied()
                .unwrap_or_default()
                .checked_add(u32::from(*verified))
                .ok_or(SelectiveStorageError::InvalidStorageOperation(
                    "resume committed-piece count overflow",
                ))?;
            committed_prefix.push(next);
        }
        let mut part_required = vec![false; self.verified.len()];

        for (file_index, metainfo_file) in self.layout.files().iter().enumerate() {
            if metainfo_file.padding || metainfo_file.length == 0 {
                continue;
            }
            let range = self
                .layout
                .file_piece_range(file_index)?
                .expect("nonempty files have a piece range");
            let first = usize::try_from(*range.start())
                .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
            let last = usize::try_from(*range.end())
                .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
            if committed_prefix[last + 1] == committed_prefix[first] {
                continue;
            }
            validation.relevant_files += 1;

            let (source, missing_may_use_part) = if self.selection.is_wanted(file_index) {
                (
                    self.files[file_index].as_ref().map(|file| &file.source),
                    self.pending_promotions.contains(&file_index),
                )
            } else {
                (self.skipped_sources[file_index].as_ref(), true)
            };
            let observation = match source {
                Some(source) => {
                    validation.artifact_observations += 1;
                    let physical_length = completed.map_or(metainfo_file.length, |proof| {
                        proof.expected_length(file_index, metainfo_file.length)
                    });
                    source.observe_exact(physical_length).await?
                }
                None => RetainedSourceObservation::Missing,
            };
            match observation {
                RetainedSourceObservation::Exact => continue,
                RetainedSourceObservation::WrongKind => {
                    validation.evidence = ResumeStorageEvidence::NeedsRepair;
                    return Ok(validation);
                }
                RetainedSourceObservation::WrongLength(_) => {
                    validation.evidence = ResumeStorageEvidence::ContentMismatch(
                        ResumeValidationRejectReason::UnexpectedPayloadLength,
                    );
                    return Ok(validation);
                }
                RetainedSourceObservation::Missing if !missing_may_use_part => {
                    validation.evidence = ResumeStorageEvidence::ContentMismatch(
                        ResumeValidationRejectReason::MissingPayloadFile,
                    );
                    return Ok(validation);
                }
                RetainedSourceObservation::Missing => {
                    for piece_index in range {
                        let piece_index = usize::try_from(piece_index).map_err(|_| {
                            SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow)
                        })?;
                        if self.verified[piece_index] {
                            part_required[piece_index] = true;
                        }
                    }
                }
            }
        }

        if !part_required.iter().any(|required| *required) {
            return Ok(validation);
        }
        if self.part_file.is_none()
            && let StorageBacking::Platform { part_reference, .. } = &self.backing
        {
            self.part_file =
                PartFile::open_optional_with_reference(part_reference.clone(), None, self.identity)
                    .await?;
            validation.part_header_bytes =
                self.part_file.as_ref().map_or(0, PartFile::header_length);
        }
        let Some(part_file) = self.part_file.as_ref() else {
            validation.evidence = ResumeStorageEvidence::ContentMismatch(
                ResumeValidationRejectReason::MissingPartFile,
            );
            return Ok(validation);
        };
        validation.artifact_observations += 1;
        let Some(part_length) = part_file.observed_file_length().await? else {
            validation.evidence = ResumeStorageEvidence::ContentMismatch(
                ResumeValidationRejectReason::MissingPartFile,
            );
            return Ok(validation);
        };
        for (piece_index, required) in part_required.into_iter().enumerate() {
            if !required {
                continue;
            }
            if !part_file.has_piece(piece_index)? {
                validation.evidence = ResumeStorageEvidence::ContentMismatch(
                    ResumeValidationRejectReason::MissingPartSlot,
                );
                return Ok(validation);
            }
            if !part_file.has_complete_piece_at_length(piece_index, part_length)? {
                validation.evidence = ResumeStorageEvidence::ContentMismatch(
                    ResumeValidationRejectReason::TruncatedPartSlot,
                );
                return Ok(validation);
            }
        }
        Ok(validation)
    }

    pub fn skipped_bytes(&self) -> u64 {
        self.layout
            .files()
            .iter()
            .enumerate()
            .filter(|(index, file)| !file.padding && !self.selection.is_wanted(*index))
            .map(|(_, file)| file.length)
            .sum()
    }

    pub fn padding_bytes(&self) -> u64 {
        self.layout
            .files()
            .iter()
            .filter(|file| file.padding)
            .map(|file| file.length)
            .sum()
    }

    pub fn part_path(&self) -> Option<&Path> {
        match &self.backing {
            StorageBacking::Paths { part_path, .. } => Some(part_path),
            StorageBacking::Platform { .. } | StorageBacking::Descriptors { .. } => None,
        }
    }

    pub fn part_slots(&self) -> usize {
        self.part_file
            .as_ref()
            .map_or(0, PartFile::mapped_piece_count)
    }

    pub fn has_part_file(&self) -> bool {
        self.part_file.is_some()
    }

    pub const fn storage_generation(&self) -> u64 {
        self.storage_generation
    }

    pub fn verified_pieces(&self) -> &[bool] {
        &self.verified
    }

    pub const fn route_epoch(&self) -> u64 {
        self.route_epoch
    }

    pub fn prepare_upload_read(
        &self,
        request: BlockRequest,
        expected_route_epoch: u64,
    ) -> Result<SelectiveUploadReadPlan, SelectiveStorageError> {
        if expected_route_epoch != self.route_epoch {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "stale active upload route epoch",
            ));
        }
        if request.length == 0 || request.length > MAX_REQUEST_BLOCK_LENGTH {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "invalid active upload request length",
            ));
        }
        let piece_index = usize::try_from(request.index).map_err(|_| {
            SelectiveStorageError::InvalidVerifiedPiece {
                piece_index: usize::MAX,
            }
        })?;
        if !self.verified.get(piece_index).copied().unwrap_or(false) {
            return Err(SelectiveStorageError::InvalidVerifiedPiece { piece_index });
        }
        let segments = self.layout.segments(
            request.index,
            request.begin,
            request.length,
            &self.selection,
        )?;
        if segments.len() > MAX_UPLOAD_READ_SEGMENTS {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "active upload read segment limit",
            ));
        }
        let mut spans = Vec::with_capacity(segments.len());
        for segment in segments {
            let span = match segment.target {
                SegmentTarget::WantedFile {
                    file_index,
                    file_offset,
                } => {
                    let part_span = if self.pending_promotions.contains(&file_index) {
                        match self.part_file.as_ref() {
                            Some(part_file) if part_file.has_piece(piece_index)? => {
                                let span = part_file.plan_read_piece_range(
                                    piece_index,
                                    segment.piece_offset,
                                    segment.length,
                                )?;
                                Some((part_file.checkpoint_reference(), span))
                            }
                            _ => None,
                        }
                    } else {
                        None
                    };
                    if let Some((source, part_span)) = part_span {
                        SelectiveUploadReadSpan::Part {
                            source,
                            file_offset: part_span.file_offset,
                            block_offset: segment.block_offset,
                            length: segment.length,
                        }
                    } else {
                        let file = self.files[file_index]
                            .as_ref()
                            .ok_or(SelectiveStorageError::MissingWantedFile { file_index })?;
                        SelectiveUploadReadSpan::File {
                            source: file.source.clone(),
                            file_offset,
                            block_offset: segment.block_offset,
                            length: segment.length,
                        }
                    }
                }
                SegmentTarget::SkippedFile {
                    file_index,
                    file_offset,
                } => {
                    let part_span = match self.part_file.as_ref() {
                        Some(part_file) if part_file.has_piece(piece_index)? => {
                            let span = part_file.plan_read_piece_range(
                                piece_index,
                                segment.piece_offset,
                                segment.length,
                            )?;
                            Some((part_file.checkpoint_reference(), span))
                        }
                        _ => None,
                    };
                    if let Some((source, part_span)) = part_span {
                        SelectiveUploadReadSpan::Part {
                            source,
                            file_offset: part_span.file_offset,
                            block_offset: segment.block_offset,
                            length: segment.length,
                        }
                    } else {
                        let source = self.skipped_sources[file_index]
                            .as_ref()
                            .ok_or(SelectiveStorageError::MissingWantedFile { file_index })?;
                        SelectiveUploadReadSpan::File {
                            source: source.clone(),
                            file_offset,
                            block_offset: segment.block_offset,
                            length: segment.length,
                        }
                    }
                }
                SegmentTarget::Padding => SelectiveUploadReadSpan::Padding {
                    block_offset: segment.block_offset,
                    length: segment.length,
                },
            };
            spans.push(span);
        }
        Ok(SelectiveUploadReadPlan {
            request,
            route_epoch: self.route_epoch,
            spans,
        })
    }

    pub fn prepare_file_read(
        &self,
        file_index: usize,
        offset: u64,
        length: usize,
        expected_route_epoch: u64,
    ) -> Result<SelectiveFileReadPlan, SelectiveStorageError> {
        if expected_route_epoch != self.route_epoch {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "stale active file route epoch",
            ));
        }
        if length == 0 || length > MAX_ACTIVE_FILE_READ_BYTES {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "invalid active file read length",
            ));
        }
        let file = self
            .layout
            .files()
            .get(file_index)
            .ok_or(SelectiveStorageError::Layout(
                LayoutError::InvalidFileIndex {
                    index: file_index,
                    file_count: self.layout.files().len(),
                },
            ))?;
        if file.padding || !self.selection.is_wanted(file_index) {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "active file is not selected payload",
            ));
        }
        if self.pending_promotions.contains(&file_index) {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "active file promotion is not reconciled",
            ));
        }
        let length_u64 = u64::try_from(length)
            .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
        let end = offset
            .checked_add(length_u64)
            .ok_or(SelectiveStorageError::Layout(
                LayoutError::ArithmeticOverflow,
            ))?;
        if end > file.length {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "active file read exceeds file length",
            ));
        }
        let torrent_start =
            file.offset
                .checked_add(offset)
                .ok_or(SelectiveStorageError::Layout(
                    LayoutError::ArithmeticOverflow,
                ))?;
        let torrent_end =
            torrent_start
                .checked_add(length_u64 - 1)
                .ok_or(SelectiveStorageError::Layout(
                    LayoutError::ArithmeticOverflow,
                ))?;
        let piece_length = u64::from(self.layout.piece_length());
        let first_piece = torrent_start / piece_length;
        let last_piece = torrent_end / piece_length;
        for piece in first_piece..=last_piece {
            let piece = usize::try_from(piece)
                .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
            if !self.verified.get(piece).copied().unwrap_or(false) {
                return Err(SelectiveStorageError::InvalidVerifiedPiece { piece_index: piece });
            }
        }
        let source = self.files[file_index]
            .as_ref()
            .ok_or(SelectiveStorageError::MissingWantedFile { file_index })?
            .source
            .clone();
        Ok(SelectiveFileReadPlan {
            file_index,
            offset,
            length,
            route_epoch: self.route_epoch,
            source,
        })
    }

    pub async fn write_block(
        &mut self,
        piece_index: u32,
        begin: u32,
        bytes: Vec<u8>,
    ) -> Result<SelectiveWriteStats, SelectiveStorageError> {
        let plan = self.plan_write(piece_index, begin, bytes).await?;
        self.execute_write_plan(plan).await
    }

    async fn plan_write(
        &mut self,
        piece_index: u32,
        begin: u32,
        bytes: Vec<u8>,
    ) -> Result<SelectiveWritePlan, SelectiveStorageError> {
        let (segments, stats) = self.plan_layout_write(piece_index, begin, bytes.len())?;
        let piece_index_usize = usize::try_from(piece_index)
            .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
        let payload = Arc::new(bytes);
        let mut spans = Vec::with_capacity(segments.len());
        for segment in segments {
            let destination = match segment.target {
                SegmentTarget::WantedFile {
                    file_index,
                    file_offset,
                } => {
                    let file = self.files[file_index]
                        .as_ref()
                        .ok_or(SelectiveStorageError::MissingWantedFile { file_index })?;
                    SelectiveWriteDestination::WantedFile {
                        file_index,
                        file_offset,
                        routing_generation: file.routing_generation,
                    }
                }
                SegmentTarget::SkippedFile { .. } if self.layout.format() == MetainfoFormat::V2 => {
                    return Err(SelectiveStorageError::InvalidStorageOperation(
                        "write skipped v2 piece",
                    ));
                }
                SegmentTarget::SkippedFile {
                    file_index,
                    file_offset,
                } => match self.files[file_index].as_ref() {
                    Some(file) => SelectiveWriteDestination::WantedFile {
                        file_index,
                        file_offset,
                        routing_generation: file.routing_generation,
                    },
                    None => SelectiveWriteDestination::PartFile(
                        self.ensure_part_file()
                            .await?
                            .plan_write_piece_range(
                                piece_index_usize,
                                segment.piece_offset,
                                segment.length,
                            )
                            .await?,
                    ),
                },
                SegmentTarget::Padding => {
                    unreachable!("padding was rejected while planning the write");
                }
            };
            spans.push(SelectiveWriteSpan {
                destination,
                block_offset: segment.block_offset,
                length: segment.length,
            });
        }
        Ok(SelectiveWritePlan {
            payload,
            spans,
            stats,
        })
    }

    pub(crate) async fn prepare_write(
        &mut self,
        piece_index: u32,
        begin: u32,
        bytes: Vec<u8>,
    ) -> Result<SelectiveWriteJob, SelectiveStorageError> {
        let plan = self.plan_write(piece_index, begin, bytes).await?;
        self.prepare_write_job(plan)
    }

    async fn execute_write_plan(
        &self,
        plan: SelectiveWritePlan,
    ) -> Result<SelectiveWriteStats, SelectiveStorageError> {
        self.prepare_write_job(plan)?.execute().await
    }

    fn prepare_write_job(
        &self,
        plan: SelectiveWritePlan,
    ) -> Result<SelectiveWriteJob, SelectiveStorageError> {
        let mut executable = Vec::with_capacity(plan.spans.len());
        for span in &plan.spans {
            let end = span
                .block_offset
                .checked_add(span.length)
                .filter(|end| *end <= plan.payload.len())
                .ok_or(SelectiveStorageError::Layout(
                    LayoutError::ArithmeticOverflow,
                ))?;
            debug_assert!(end <= plan.payload.len());
            let (file, file_offset) = match span.destination {
                SelectiveWriteDestination::WantedFile {
                    file_index,
                    file_offset,
                    routing_generation,
                } => {
                    let file = self.files[file_index]
                        .as_ref()
                        .ok_or(SelectiveStorageError::StaleWriteRoute { file_index })?;
                    if file.routing_generation != routing_generation {
                        return Err(SelectiveStorageError::StaleWriteRoute { file_index });
                    }
                    (
                        ExecutableFileSource::Wanted(file.source.clone()),
                        file_offset,
                    )
                }
                SelectiveWriteDestination::PartFile(part_span) => {
                    let part_file = self.part_file.as_ref().ok_or(
                        SelectiveStorageError::InvalidStorageOperation(
                            "planned part file is missing",
                        ),
                    )?;
                    part_file.validate_span(part_span)?;
                    (
                        ExecutableFileSource::Part(part_file.checkpoint_reference()),
                        part_span.file_offset,
                    )
                }
            };
            executable.push(ExecutableWriteSpan {
                file,
                file_offset,
                block_offset: span.block_offset,
                length: span.length,
            });
        }
        Ok(SelectiveWriteJob {
            payload: plan.payload,
            spans: executable,
            stats: plan.stats,
        })
    }

    pub(crate) fn write_stats(
        &self,
        piece_index: u32,
        begin: u32,
        length: usize,
    ) -> Result<SelectiveWriteStats, SelectiveStorageError> {
        self.plan_layout_write(piece_index, begin, length)
            .map(|(_, stats)| stats)
    }

    fn plan_layout_write(
        &self,
        piece_index: u32,
        begin: u32,
        length: usize,
    ) -> Result<(Vec<LayoutSegment>, SelectiveWriteStats), SelectiveStorageError> {
        let length = u32::try_from(length)
            .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
        let segments = self
            .layout
            .segments(piece_index, begin, length, &self.selection)?;
        let mut stats = SelectiveWriteStats::default();
        for segment in &segments {
            match segment.target {
                SegmentTarget::WantedFile { .. } => {
                    stats.wanted_bytes = stats.wanted_bytes.saturating_add(segment.length);
                }
                SegmentTarget::SkippedFile { file_index, .. } => {
                    if self.files[file_index].is_some() {
                        stats.wanted_bytes = stats.wanted_bytes.saturating_add(segment.length);
                    } else {
                        stats.skipped_bytes = stats.skipped_bytes.saturating_add(segment.length);
                    }
                }
                SegmentTarget::Padding => {
                    return Err(SelectiveStorageError::PaddingInPeerBlock);
                }
            }
        }
        Ok((segments, stats))
    }

    pub async fn hash_piece(
        &mut self,
        piece_index: u32,
    ) -> Result<[u8; 20], SelectiveStorageError> {
        self.hash_piece_with_stats(piece_index)
            .await
            .map(|(hash, _stats)| hash)
    }

    fn prepare_blocking_hash_plan(
        &self,
        piece_index: usize,
        segments: &[LayoutSegment],
        algorithm: PieceHashAlgorithm,
    ) -> Result<SelectiveHashPlan, SelectiveStorageError> {
        let mut spans = Vec::with_capacity(segments.len());
        for segment in segments {
            match segment.target {
                SegmentTarget::WantedFile {
                    file_index,
                    file_offset,
                } => {
                    let part_span = if self.pending_promotions.contains(&file_index) {
                        self.part_file
                            .as_ref()
                            .map(|part_file| {
                                if !part_file.has_piece(piece_index)? {
                                    return Ok(None);
                                }
                                let span = part_file.plan_read_piece_range(
                                    piece_index,
                                    segment.piece_offset,
                                    segment.length,
                                )?;
                                part_file.validate_span(span)?;
                                Ok::<_, PartFileError>(Some((
                                    part_file.checkpoint_reference(),
                                    span,
                                )))
                            })
                            .transpose()?
                            .flatten()
                    } else {
                        None
                    };
                    if let Some((file, span)) = part_span {
                        spans.push(BlockingHashSpan::PartFile { file, span });
                        continue;
                    }
                    let file = self.files[file_index]
                        .as_ref()
                        .ok_or(SelectiveStorageError::MissingWantedFile { file_index })?;
                    spans.push(BlockingHashSpan::WantedFile {
                        file: file.source.clone(),
                        file_offset,
                        length: segment.length,
                    });
                }
                SegmentTarget::Padding => spans.push(BlockingHashSpan::Padding {
                    length: segment.length,
                }),
                SegmentTarget::SkippedFile {
                    file_index,
                    file_offset,
                } => {
                    let part_span = self
                        .part_file
                        .as_ref()
                        .filter(|part_file| part_file.has_piece(piece_index).unwrap_or(false))
                        .map(|part_file| {
                            let span = part_file.plan_read_piece_range(
                                piece_index,
                                segment.piece_offset,
                                segment.length,
                            )?;
                            part_file.validate_span(span)?;
                            Ok::<_, PartFileError>((part_file.checkpoint_reference(), span))
                        })
                        .transpose()?;
                    if let Some((file, span)) = part_span {
                        spans.push(BlockingHashSpan::PartFile { file, span });
                    } else if let Some(file) = self.skipped_sources[file_index].as_ref() {
                        spans.push(BlockingHashSpan::WantedFile {
                            file: file.clone(),
                            file_offset,
                            length: segment.length,
                        });
                    } else {
                        let part_file = self
                            .part_file
                            .as_ref()
                            .ok_or(SelectiveStorageError::MissingWantedFile { file_index })?;
                        let span = part_file.plan_read_piece_range(
                            piece_index,
                            segment.piece_offset,
                            segment.length,
                        )?;
                        part_file.validate_span(span)?;
                        spans.push(BlockingHashSpan::PartFile {
                            file: part_file.checkpoint_reference(),
                            span,
                        });
                    }
                }
            }
        }
        Ok(SelectiveHashPlan { spans, algorithm })
    }

    pub(crate) fn prepare_hash(
        &self,
        piece_index: u32,
    ) -> Result<SelectiveHashPlan, SelectiveStorageError> {
        let piece_length = self.layout.piece_length_at(piece_index)?;
        let segments = self
            .layout
            .segments(piece_index, 0, piece_length, &self.selection)?;
        let piece_index_usize = usize::try_from(piece_index)
            .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
        let algorithm = match self.content.as_deref() {
            Some(content @ TorrentContent::V2(_)) => PieceHashAlgorithm::V2Merkle {
                target_height: content
                    .piece_hash_target_height(piece_index)
                    .map_err(|_| {
                        SelectiveStorageError::InvalidStorageOperation(
                            "invalid expected piece geometry",
                        )
                    })?
                    .expect("v2 piece hash target exists"),
            },
            Some(TorrentContent::Hybrid(content)) => PieceHashAlgorithm::Hybrid {
                target_height: self
                    .content
                    .as_deref()
                    .expect("hybrid content exists")
                    .piece_hash_target_height(piece_index)
                    .map_err(|_| {
                        SelectiveStorageError::InvalidStorageOperation(
                            "invalid expected piece geometry",
                        )
                    })?
                    .expect("hybrid v2 piece hash target exists"),
                zero_length: content.padding.zero_length(piece_index),
            },
            Some(TorrentContent::V1(_)) | None => PieceHashAlgorithm::Sha1,
        };
        self.prepare_blocking_hash_plan(piece_index_usize, &segments, algorithm)
    }

    async fn hash_piece_with_stats(
        &mut self,
        piece_index: u32,
    ) -> Result<([u8; 20], SelectiveHashIoStats), SelectiveStorageError> {
        let plan = self.prepare_hash(piece_index)?;
        plan.hash().await
    }

    pub async fn hash_piece_content(
        &self,
        piece_index: u32,
    ) -> Result<ComputedPieceHash, SelectiveStorageError> {
        self.prepare_hash(piece_index)?.execute_content().await
    }

    pub fn record_verified(&mut self, piece_index: usize) -> Result<(), SelectiveStorageError> {
        self.set_verified(piece_index, true)
    }

    pub(crate) fn durability_targets(
        &self,
        piece_index: u32,
    ) -> Result<Vec<DurabilityTarget>, SelectiveStorageError> {
        let piece_length = self.layout.piece_length_at(piece_index)?;
        let segments = self
            .layout
            .segments(piece_index, 0, piece_length, &self.selection)?;
        let mut targets = Vec::new();
        for segment in segments {
            let target = match segment.target {
                SegmentTarget::WantedFile { file_index, .. } => {
                    DurabilityTarget::WantedFile(file_index)
                }
                SegmentTarget::SkippedFile { file_index, .. } => {
                    if self.files[file_index].is_some() {
                        DurabilityTarget::WantedFile(file_index)
                    } else {
                        DurabilityTarget::PartFile
                    }
                }
                SegmentTarget::Padding => continue,
            };
            if !targets.contains(&target) {
                targets.push(target);
            }
        }
        Ok(targets)
    }

    pub(crate) async fn checkpoint_handles(
        &mut self,
    ) -> Result<CheckpointHandles, SelectiveStorageError> {
        let mut handles = BTreeMap::new();
        for (file_index, file) in self.files.iter().enumerate() {
            let Some(file) = file else {
                continue;
            };
            let cell = Arc::new(OnceLock::new());
            cell.set(file.checkpoint_reference())
                .expect("new selected-file checkpoint cell is empty");
            handles.insert(DurabilityTarget::WantedFile(file_index), cell);
        }
        let part_cell = Arc::new(OnceLock::new());
        if let Some(part_file) = self.part_file.as_ref() {
            part_cell
                .set(match part_file.checkpoint_reference() {
                    PartFileCheckpointReference::Dynamic(reference) => {
                        CheckpointFileReference::Dynamic(reference)
                    }
                    PartFileCheckpointReference::Fixed(file) => {
                        CheckpointFileReference::Fixed(file)
                    }
                })
                .expect("new part-file checkpoint cell is empty");
        }
        self.part_checkpoint_handle = Some(part_cell.clone());
        handles.insert(DurabilityTarget::PartFile, part_cell);
        Ok(handles)
    }

    pub fn set_verified(
        &mut self,
        piece_index: usize,
        verified: bool,
    ) -> Result<(), SelectiveStorageError> {
        let piece = self
            .verified
            .get_mut(piece_index)
            .ok_or(SelectiveStorageError::InvalidVerifiedPiece { piece_index })?;
        *piece = verified;
        Ok(())
    }

    pub async fn sync_piece(&mut self, piece_index: u32) -> Result<(), SelectiveStorageError> {
        self.sync_pieces(&[piece_index]).await
    }

    pub(crate) async fn sync_pieces(
        &mut self,
        piece_indices: &[u32],
    ) -> Result<(), SelectiveStorageError> {
        let mut wanted_files = Vec::new();
        let mut sync_part = false;
        for &piece_index in piece_indices {
            let piece_length = self.layout.piece_length_at(piece_index)?;
            let segments = self
                .layout
                .segments(piece_index, 0, piece_length, &self.selection)?;
            for segment in segments {
                match segment.target {
                    SegmentTarget::WantedFile { file_index, .. } => {
                        if !wanted_files.contains(&file_index) {
                            wanted_files.push(file_index);
                        }
                    }
                    SegmentTarget::SkippedFile { file_index, .. } => {
                        if self.files[file_index].is_some() {
                            if !wanted_files.contains(&file_index) {
                                wanted_files.push(file_index);
                            }
                        } else {
                            sync_part = true;
                        }
                    }
                    SegmentTarget::Padding => {}
                }
            }
        }
        for file_index in wanted_files {
            let file = self.files[file_index]
                .as_ref()
                .ok_or(SelectiveStorageError::MissingWantedFile { file_index })?
                .acquire(StorageFileAccess::ReadWriteExisting)
                .await?;
            sync_file(file, "flush verified selected piece").await?;
        }
        if sync_part {
            self.part_file_mut()?.sync_payload().await?;
        }
        Ok(())
    }

    /// Finalize direct content without changing its path.
    pub(crate) async fn completed_storage_evidence(
        &self,
    ) -> Result<Option<CompletedStorageEvidence>, SelectiveStorageError> {
        if self.verified.iter().any(|verified| !verified) {
            return Ok(None);
        }
        let Some(content) = &self.content else {
            return Ok(None);
        };
        let mut oversized = Vec::new();
        for (index, file) in self.layout.files().iter().enumerate() {
            if file.padding || file.length == 0 {
                continue;
            }
            let source = self.files[index]
                .as_ref()
                .map(|file| &file.source)
                .or(self.skipped_sources[index].as_ref());
            let Some(source) = source else {
                return Ok(None);
            };
            match source.observe_exact(file.length).await? {
                RetainedSourceObservation::Exact => {}
                RetainedSourceObservation::WrongLength(Some(length)) if length > file.length => {
                    oversized.push((index, length));
                }
                _ => return Ok(None),
            }
        }
        Ok((!oversized.is_empty()).then_some(CompletedStorageEvidence {
            identity: TorrentArtifactIdentity {
                torrent_id: self.identity.torrent_id,
                content_fingerprint: self.identity.content_fingerprint,
            },
            info_hashes: content.info_hashes(),
            oversized,
        }))
    }

    pub async fn finish_content(&mut self) -> Result<(), SelectiveStorageError> {
        self.ensure_complete_selection()?;
        for (file_index, metainfo_file) in self.layout.files().iter().enumerate() {
            if metainfo_file.padding || !self.selection.is_wanted(file_index) {
                continue;
            }
            let file = self.files[file_index]
                .as_ref()
                .ok_or(SelectiveStorageError::MissingWantedFile { file_index })?;
            let actual = match file.acquire(StorageFileAccess::ReadExisting).await {
                Ok(file) => file
                    .file()
                    .metadata()
                    .map_err(|source| SelectiveStorageError::Io {
                        operation: "inspect checked direct content file",
                        source,
                    })?
                    .len(),
                Err(error) if metainfo_file.length == 0 && error.is_missing_or_short_source() => {
                    file.acquire(StorageFileAccess::ReadWriteCreate).await?;
                    continue;
                }
                Err(error) => return Err(error),
            };
            if actual < metainfo_file.length {
                return Err(SelectiveStorageError::UnexpectedFileLength {
                    file_index,
                    expected: metainfo_file.length,
                    actual,
                });
            }
        }
        Ok(())
    }

    fn ensure_complete_selection(&self) -> Result<(), SelectiveStorageError> {
        for piece_index in 0..self.layout.piece_count() {
            let piece_index_u32 = u32::try_from(piece_index)
                .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
            if !self
                .layout
                .request_ranges(piece_index_u32, &self.selection)?
                .is_empty()
                && !self.verified[piece_index]
            {
                return Err(SelectiveStorageError::IncompleteSelection { piece_index });
            }
        }
        Ok(())
    }

    pub async fn reopen_part_file(&mut self) -> Result<(), SelectiveStorageError> {
        if self.part_file.is_none() {
            return Ok(());
        }
        self.part_file.take();
        self.part_file = Some(match &mut self.backing {
            StorageBacking::Paths {
                part_path,
                part_reference,
                ..
            } => {
                PartFile::open_with_reference(
                    part_reference.clone(),
                    Some(part_path.clone()),
                    self.identity,
                )
                .await?
            }
            StorageBacking::Descriptors {
                reopened_part_file, ..
            } => {
                let file = reopened_part_file.take().ok_or(
                    SelectiveStorageError::InvalidStorageOperation(
                        "descriptor part file was already reopened",
                    ),
                )?;
                PartFile::open_preopened(file, self.identity).await?
            }
            StorageBacking::Platform { part_reference, .. } => {
                PartFile::open_with_reference(part_reference.clone(), None, self.identity).await?
            }
        });
        Ok(())
    }

    pub(crate) async fn has_piece_sources(
        &mut self,
        piece_index: u32,
    ) -> Result<bool, SelectiveStorageError> {
        let piece_length = self.layout.piece_length_at(piece_index)?;
        let segments = self
            .layout
            .segments(piece_index, 0, piece_length, &self.selection)?;
        let piece_index = usize::try_from(piece_index)
            .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
        for segment in segments {
            match segment.target {
                SegmentTarget::WantedFile { file_index, .. } => {
                    let file = self.files[file_index]
                        .as_ref()
                        .ok_or(SelectiveStorageError::MissingWantedFile { file_index })?;
                    if file.source.is_available().await? {
                        continue;
                    }
                    if self.pending_promotions.contains(&file_index)
                        && let Some(part_file) = self.part_file.as_ref()
                        && part_file.has_piece(piece_index)?
                    {
                        continue;
                    }
                    return Ok(false);
                }
                SegmentTarget::SkippedFile { file_index, .. } => {
                    if let Some(source) = self.skipped_sources[file_index].clone() {
                        if source.is_available().await? {
                            continue;
                        }
                        self.skipped_sources[file_index] = None;
                    }
                    if self.part_file.is_none()
                        && let StorageBacking::Platform { part_reference, .. } = &self.backing
                    {
                        self.part_file = PartFile::open_optional_with_reference(
                            part_reference.clone(),
                            None,
                            self.identity,
                        )
                        .await?;
                    }
                    let Some(part_file) = self.part_file.as_ref() else {
                        return Ok(false);
                    };
                    if !part_file.has_piece(piece_index)? {
                        return Ok(false);
                    }
                }
                SegmentTarget::Padding => {}
            }
        }
        Ok(true)
    }

    pub(crate) async fn reconcile_after_recheck(&mut self) -> Result<(), SelectiveStorageError> {
        let pending_promotions = std::mem::take(&mut self.pending_promotions);
        for file_index in pending_promotions {
            let mut recoverable = false;
            for piece_index in self
                .layout
                .file_piece_range(file_index)?
                .into_iter()
                .flatten()
            {
                let piece_index = usize::try_from(piece_index)
                    .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
                if self.verified.get(piece_index).copied().unwrap_or(false)
                    && let Some(part_file) = self.part_file.as_ref()
                    && part_file.has_piece(piece_index)?
                {
                    recoverable = true;
                    break;
                }
            }
            if recoverable {
                self.restore_promoted_file(file_index, false).await?;
            }
        }
        self.release_unused_part_slots().await
    }

    pub async fn reconcile_selection(
        &mut self,
        selection: FileSelection,
    ) -> Result<SelectionReconcileReport, SelectiveStorageError> {
        if selection.file_count() != self.layout.files().len() {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "file selection geometry",
            ));
        }
        let next_epoch = self.route_epoch.checked_add(1).ok_or(
            SelectiveStorageError::InvalidStorageOperation("storage route epoch overflow"),
        )?;
        let promoted_files = self
            .layout
            .files()
            .iter()
            .enumerate()
            .filter(|(index, file)| {
                !file.padding && !self.selection.is_wanted(*index) && selection.is_wanted(*index)
            })
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        let demoted_files = self
            .layout
            .files()
            .iter()
            .enumerate()
            .filter(|(index, file)| {
                !file.padding && self.selection.is_wanted(*index) && !selection.is_wanted(*index)
            })
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        if promoted_files.is_empty() && demoted_files.is_empty() {
            return Ok(SelectionReconcileReport {
                route_epoch: self.route_epoch,
                promoted_files,
                demoted_files,
                invalidated_pieces: Vec::new(),
            });
        }

        let previous_files = self.files.clone();
        let previous_skipped_sources = self.skipped_sources.clone();
        let previous_selection = self.selection.clone();
        let previous_verified = self.verified.clone();
        let storage_generation = self.storage_generation;
        let mut promotions_requiring_part = BTreeSet::new();
        for &file_index in &demoted_files {
            if let Some(file) = self.files[file_index].take() {
                self.skipped_sources[file_index] = Some(file.source);
            }
        }
        for &file_index in &promoted_files {
            let metainfo_file = &self.layout.files()[file_index];
            let source = match self.skipped_sources[file_index].take() {
                Some(source) => source,
                None => {
                    promotions_requiring_part.insert(file_index);
                    match &mut self.backing {
                        StorageBacking::Paths {
                            content_root,
                            part_reference,
                            storage_id,
                            ..
                        } => {
                            let path = payload_path(
                                self.content_shape,
                                content_root,
                                &metainfo_file.path,
                                file_index,
                                self.layout.files().len(),
                            )?;
                            RetainedFileSource::Dynamic {
                                reference: path_storage_reference(
                                    part_reference.pool(),
                                    storage_id,
                                    storage_generation,
                                    StorageFileRole::Payload(file_index),
                                    path,
                                )
                                .with_origin_boundary(content_root),
                                file_index,
                                expected_length: metainfo_file.length,
                            }
                        }
                        StorageBacking::Platform { spec, .. } => RetainedFileSource::Dynamic {
                            reference: platform_storage_reference(
                                spec,
                                StorageFileRole::Payload(file_index),
                                metainfo_file.path.clone(),
                            ),
                            file_index,
                            expected_length: metainfo_file.length,
                        },
                        StorageBacking::Descriptors { .. } => {
                            self.files = previous_files;
                            self.skipped_sources = previous_skipped_sources;
                            self.verified = previous_verified;
                            return Err(SelectiveStorageError::InvalidStorageOperation(
                                "dynamic descriptor file selection",
                            ));
                        }
                    }
                }
            };
            self.files[file_index] = Some(RetainedFile {
                source,
                routing_generation: next_epoch,
            });
        }

        let reconcile_result = async {
            let mut invalidated_pieces = BTreeSet::new();
            for &file_index in &promoted_files {
                invalidated_pieces.extend(
                    self.restore_promoted_file(
                        file_index,
                        promotions_requiring_part.contains(&file_index),
                    )
                    .await?,
                );
            }
            self.selection = selection;
            self.release_unused_part_slots().await?;
            Ok::<_, SelectiveStorageError>(invalidated_pieces.into_iter().collect::<Vec<_>>())
        }
        .await;
        let invalidated_pieces = match reconcile_result {
            Ok(invalidated_pieces) => invalidated_pieces,
            Err(error) => {
                self.files = previous_files;
                self.skipped_sources = previous_skipped_sources;
                self.selection = previous_selection;
                self.verified = previous_verified;
                return Err(error);
            }
        };
        self.route_epoch = next_epoch;
        Ok(SelectionReconcileReport {
            route_epoch: next_epoch,
            promoted_files,
            demoted_files,
            invalidated_pieces,
        })
    }

    fn part_file_mut(&mut self) -> Result<&mut PartFile, SelectiveStorageError> {
        self.part_file
            .as_mut()
            .ok_or(SelectiveStorageError::InvalidStorageOperation(
                "required part file is missing",
            ))
    }

    async fn ensure_part_file(&mut self) -> Result<&mut PartFile, SelectiveStorageError> {
        if self.layout.format() == MetainfoFormat::V2 {
            return Err(SelectiveStorageError::InvalidStorageOperation(
                "create v2 part artifact",
            ));
        }
        if self.part_file.is_none() {
            let (part_path, part_reference) = match &self.backing {
                StorageBacking::Paths {
                    part_path,
                    part_reference,
                    ..
                } => (Some(part_path.clone()), part_reference.clone()),
                StorageBacking::Descriptors { .. } => {
                    return Err(SelectiveStorageError::InvalidStorageOperation(
                        "lazy descriptor part-file creation",
                    ));
                }
                StorageBacking::Platform { part_reference, .. } => (None, part_reference.clone()),
            };
            let part_file =
                PartFile::create_with_reference(part_reference, part_path, self.identity).await?;
            if let Some(handle) = self.part_checkpoint_handle.as_ref() {
                handle
                    .set(match part_file.checkpoint_reference() {
                        PartFileCheckpointReference::Dynamic(reference) => {
                            CheckpointFileReference::Dynamic(reference)
                        }
                        PartFileCheckpointReference::Fixed(file) => {
                            CheckpointFileReference::Fixed(file)
                        }
                    })
                    .map_err(|_| {
                        SelectiveStorageError::InvalidStorageOperation(
                            "replace registered part-file checkpoint handle",
                        )
                    })?;
            }
            self.part_file = Some(part_file);
        }
        self.part_file_mut()
    }

    async fn restore_promoted_file(
        &mut self,
        file_index: usize,
        missing_verified_source_invalidates: bool,
    ) -> Result<Vec<usize>, SelectiveStorageError> {
        let metainfo_file = self
            .layout
            .files()
            .get(file_index)
            .ok_or(LayoutError::InvalidFileIndex {
                index: file_index,
                file_count: self.layout.files().len(),
            })?
            .clone();
        let destination = self.files[file_index]
            .as_ref()
            .ok_or(SelectiveStorageError::MissingWantedFile { file_index })?
            .acquire(StorageFileAccess::ReadWriteCreate)
            .await?;
        destination
            .file()
            .set_len(metainfo_file.length)
            .map_err(|source| SelectiveStorageError::Io {
                operation: "size promoted selected file",
                source,
            })?;
        let mut buffer = [0_u8; VERIFICATION_CHUNK_LENGTH];
        let mut file_offset = 0_u64;
        let mut invalidated_pieces = BTreeSet::new();
        while file_offset < metainfo_file.length {
            let torrent_offset = metainfo_file.offset.checked_add(file_offset).ok_or(
                SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow),
            )?;
            let piece_index_u64 = torrent_offset / u64::from(self.layout.piece_length());
            let piece_index = usize::try_from(piece_index_u64)
                .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
            let piece_offset_u64 = torrent_offset % u64::from(self.layout.piece_length());
            let piece_offset = u32::try_from(piece_offset_u64)
                .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
            let piece_remaining = u64::from(self.layout.piece_length()) - piece_offset_u64;
            let length = usize::try_from(
                (metainfo_file.length - file_offset)
                    .min(piece_remaining)
                    .min(buffer.len() as u64),
            )
            .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
            let part_has_piece = match self.part_file.as_ref() {
                Some(part_file) => part_file.has_piece(piece_index)?,
                None => false,
            };
            if self.verified[piece_index] && part_has_piece {
                self.part_file
                    .as_ref()
                    .expect("part file was checked above")
                    .read_piece_range(piece_index, piece_offset, &mut buffer[..length])
                    .await?;
                let destination = destination.clone();
                let payload: Arc<[u8]> = Arc::from(&buffer[..length]);
                tokio::task::spawn_blocking(move || {
                    write_all_at(destination.file(), &payload, file_offset)
                })
                .await
                .map_err(|source| SelectiveStorageError::Io {
                    operation: "join promoted selected-file write",
                    source: io::Error::other(source),
                })?
                .map_err(|source| SelectiveStorageError::Io {
                    operation: "write promoted selected-file range",
                    source,
                })?;
            } else if self.verified[piece_index] && missing_verified_source_invalidates {
                self.verified[piece_index] = false;
                invalidated_pieces.insert(piece_index);
            }
            file_offset =
                file_offset
                    .checked_add(length as u64)
                    .ok_or(SelectiveStorageError::Layout(
                        LayoutError::ArithmeticOverflow,
                    ))?;
        }
        sync_file(destination, "flush promoted selected file").await?;
        Ok(invalidated_pieces.into_iter().collect())
    }

    async fn release_unused_part_slots(&mut self) -> Result<(), SelectiveStorageError> {
        for piece_index in 0..self.layout.piece_count() {
            let piece_index_u32 = u32::try_from(piece_index)
                .map_err(|_| SelectiveStorageError::Layout(LayoutError::ArithmeticOverflow))?;
            if self.piece_requires_part_file(piece_index_u32)? {
                continue;
            }
            if let Some(part_file) = self.part_file.as_mut() {
                part_file.release_piece(piece_index).await?;
            }
        }
        self.remove_empty_part_file().await
    }

    fn piece_requires_part_file(&self, piece_index: u32) -> Result<bool, SelectiveStorageError> {
        if self.layout.format() == MetainfoFormat::V2 {
            return Ok(false);
        }
        let piece_length = self.layout.piece_length_at(piece_index)?;
        Ok(self
            .layout
            .segments(piece_index, 0, piece_length, &self.selection)?
            .into_iter()
            .any(|segment| {
                matches!(
                    segment.target,
                    SegmentTarget::SkippedFile { file_index, .. }
                        if self.files[file_index].is_none()
                )
            }))
    }

    async fn remove_empty_part_file(&mut self) -> Result<(), SelectiveStorageError> {
        if self
            .part_file
            .as_ref()
            .is_none_or(|part_file| part_file.mapped_piece_count() != 0)
        {
            return Ok(());
        }
        match &mut self.backing {
            StorageBacking::Paths {
                part_path,
                part_reference,
                ..
            } => {
                self.part_checkpoint_handle.take();
                self.part_file.take();
                part_reference.pool().invalidate_key(part_reference.key());
                remove_file_if_present(part_path).await.map_err(|source| {
                    SelectiveStorageError::Io {
                        operation: "remove empty part file",
                        source,
                    }
                })?;
            }
            StorageBacking::Descriptors { .. } => {}
            StorageBacking::Platform { part_reference, .. } => {
                self.part_checkpoint_handle.take();
                self.part_file.take();
                part_reference
                    .delete()
                    .await
                    .map_err(|error| SelectiveStorageError::Io {
                        operation: "delete empty platform part file",
                        source: io::Error::other(error),
                    })?;
            }
        }
        Ok(())
    }
}

#[cfg_attr(not(feature = "descriptor-storage-diagnostics"), allow(dead_code))]
pub fn plan_descriptor_storage(
    metainfo: &Metainfo,
    skip_files: &[usize],
) -> Result<DescriptorStoragePlan, SelectiveStorageError> {
    let layout = TorrentLayout::from_metainfo(metainfo);
    let selection = FileSelection::new(&layout, skip_files)?;
    let files = layout
        .files()
        .iter()
        .enumerate()
        .map(|(file_index, file)| DescriptorStoragePlanFile {
            file_index,
            path: file.path.clone(),
            length: file.length,
            role: if file.padding {
                DescriptorFileRole::Padding
            } else if selection.is_wanted(file_index) {
                DescriptorFileRole::Wanted
            } else {
                DescriptorFileRole::Skipped
            },
        })
        .collect();
    Ok(DescriptorStoragePlan {
        info_hash: metainfo.info_hash,
        name: metainfo.name.clone(),
        content_shape: ContentShape::from_metainfo(metainfo),
        files,
    })
}

pub async fn validate_direct_fast_resume_with_path(
    storage_root: &Path,
    artifact_identity: TorrentArtifactIdentity,
    metainfo: &Metainfo,
    verified: &[bool],
    skipped: &[usize],
    pool: StorageFilePool,
) -> Result<FastResumeValidation, SelectiveStorageError> {
    let layout = TorrentLayout::from_metainfo(metainfo);
    let selection = FileSelection::new(&layout, skipped)?;
    let paths =
        torrent_storage_paths_for_metainfo(storage_root, metainfo, artifact_identity.torrent_id)?;
    let (mut storage, resumed) = SelectiveStorage::resume_with_paths_and_pool(
        paths,
        artifact_identity,
        layout,
        selection,
        verified.to_vec(),
        pool,
    )
    .await?;
    storage.validate_fast_resume(resumed).await
}

pub async fn validate_direct_fast_resume_content_with_path(
    storage_root: &Path,
    artifact_identity: TorrentArtifactIdentity,
    content: Arc<TorrentContent>,
    verified: &[bool],
    skipped: &[usize],
    pool: StorageFilePool,
) -> Result<FastResumeValidation, SelectiveStorageError> {
    validate_direct_completed_content_with_path(
        storage_root,
        artifact_identity,
        content,
        verified,
        skipped,
        pool,
        None,
    )
    .await
}

pub async fn validate_direct_completed_content_with_path(
    storage_root: &Path,
    artifact_identity: TorrentArtifactIdentity,
    content: Arc<TorrentContent>,
    verified: &[bool],
    skipped: &[usize],
    pool: StorageFilePool,
    completed: Option<&CompletedStorageEvidence>,
) -> Result<FastResumeValidation, SelectiveStorageError> {
    let layout = ContentLayout::from_content(&content);
    let selection = FileSelection::new_content(&layout, skipped)?;
    let paths = torrent_storage_paths_with_shape(
        storage_root,
        content.name(),
        artifact_identity.torrent_id,
        ContentShape::from_content(&content),
    )?;
    let (mut storage, resumed) = SelectiveStorage::resume_with_paths_and_pool(
        paths,
        artifact_identity,
        layout,
        selection,
        verified.to_vec(),
        pool,
    )
    .await?;
    storage.content = Some(content);
    storage.validate_resume_extents(resumed, completed).await
}

pub async fn validate_direct_fast_resume_with_platform(
    spec: PlatformStorageSpec,
    artifact_identity: TorrentArtifactIdentity,
    metainfo: &Metainfo,
    verified: &[bool],
    skipped: &[usize],
) -> Result<FastResumeValidation, SelectiveStorageError> {
    let layout = TorrentLayout::from_metainfo(metainfo);
    let selection = FileSelection::new(&layout, skipped)?;
    let (mut storage, resumed) = SelectiveStorage::create_with_platform(
        spec,
        artifact_identity,
        metainfo,
        layout,
        selection,
        verified.to_vec(),
    )
    .await?;
    storage.validate_fast_resume(resumed).await
}

pub async fn validate_direct_fast_resume_content_with_platform(
    spec: PlatformStorageSpec,
    artifact_identity: TorrentArtifactIdentity,
    content: Arc<TorrentContent>,
    verified: &[bool],
    skipped: &[usize],
) -> Result<FastResumeValidation, SelectiveStorageError> {
    validate_direct_completed_content_with_platform(
        spec,
        artifact_identity,
        content,
        verified,
        skipped,
        None,
    )
    .await
}

pub async fn validate_direct_completed_content_with_platform(
    spec: PlatformStorageSpec,
    artifact_identity: TorrentArtifactIdentity,
    content: Arc<TorrentContent>,
    verified: &[bool],
    skipped: &[usize],
    completed: Option<&CompletedStorageEvidence>,
) -> Result<FastResumeValidation, SelectiveStorageError> {
    let (mut storage, resumed) = SelectiveStorage::create_content_with_platform(
        spec,
        artifact_identity,
        content,
        skipped,
        verified.to_vec(),
    )
    .await?;
    storage.validate_resume_extents(resumed, completed).await
}

fn collect_descriptors(
    file_count: usize,
    role: &'static str,
    descriptors: Vec<DescriptorFile>,
) -> Result<Vec<Option<std::fs::File>>, SelectiveStorageError> {
    let mut files: Vec<Option<std::fs::File>> = (0..file_count).map(|_| None).collect();
    for descriptor in descriptors {
        let file = files.get_mut(descriptor.file_index).ok_or(
            SelectiveStorageError::InvalidDescriptorManifest {
                role,
                file_index: descriptor.file_index,
                reason: "file index is out of range",
            },
        )?;
        if file.is_some() {
            return Err(SelectiveStorageError::InvalidDescriptorManifest {
                role,
                file_index: descriptor.file_index,
                reason: "file index is duplicated",
            });
        }
        *file = Some(descriptor.file);
    }
    Ok(files)
}

async fn initialize_descriptor_file(
    file: std::fs::File,
    role: &'static str,
    file_index: usize,
    length: u64,
) -> Result<File, SelectiveStorageError> {
    let file = File::from_std(file);
    let existing_length = file
        .metadata()
        .await
        .map_err(|source| SelectiveStorageError::Io {
            operation: "inspect descriptor content file",
            source,
        })?
        .len();
    if existing_length != 0 {
        return Err(SelectiveStorageError::NonemptyDescriptor {
            role,
            file_index,
            length: existing_length,
        });
    }
    file.set_len(length)
        .await
        .map_err(|source| SelectiveStorageError::Io {
            operation: "size descriptor content file",
            source,
        })?;
    Ok(file)
}

async fn validate_descriptor_length(
    file: std::fs::File,
    file_index: usize,
    expected: u64,
) -> Result<File, SelectiveStorageError> {
    let file = File::from_std(file);
    let actual = file
        .metadata()
        .await
        .map_err(|source| SelectiveStorageError::Io {
            operation: "inspect resumable descriptor file",
            source,
        })?
        .len();
    if actual != expected {
        return Err(SelectiveStorageError::UnexpectedFileLength {
            file_index,
            expected,
            actual,
        });
    }
    Ok(file)
}

pub fn selective_part_path(output_root: &Path) -> Result<PathBuf, SelectiveStorageError> {
    sibling_with_suffix(output_root, ".rstorrent-parts")
}

pub fn torrent_storage_paths(
    storage_root: &Path,
    content_name: &str,
    torrent_id: TorrentId,
) -> Result<TorrentStoragePaths, SelectiveStorageError> {
    torrent_storage_paths_with_shape(storage_root, content_name, torrent_id, ContentShape::Tree)
}

pub fn torrent_storage_paths_for_metainfo(
    storage_root: &Path,
    metainfo: &Metainfo,
    torrent_id: TorrentId,
) -> Result<TorrentStoragePaths, SelectiveStorageError> {
    torrent_storage_paths_with_shape(
        storage_root,
        &metainfo.name,
        torrent_id,
        ContentShape::from_metainfo(metainfo),
    )
}

pub fn torrent_storage_paths_with_shape(
    storage_root: &Path,
    content_name: &str,
    torrent_id: TorrentId,
    content_shape: ContentShape,
) -> Result<TorrentStoragePaths, SelectiveStorageError> {
    validate_content_name(content_name)?;
    let content = storage_root.join(content_name);
    torrent_storage_paths_for_output_with_shape(content, torrent_id, content_shape)
}

pub fn validate_content_name(content_name: &str) -> Result<(), SelectiveStorageError> {
    if content_name.is_empty()
        || content_name.len() > 255
        || matches!(content_name, "." | "..")
        || content_name
            .bytes()
            .any(|byte| matches!(byte, 0 | b'/' | b'\\' | b':'))
        || is_internal_artifact_name(content_name)
    {
        return Err(SelectiveStorageError::InvalidContentName);
    }
    Ok(())
}

fn is_internal_artifact_name(name: &str) -> bool {
    let Some(name) = name.strip_prefix('.') else {
        return false;
    };
    name.strip_suffix(".rstorrent-parts")
        .is_some_and(|owner| owner.parse::<TorrentId>().is_ok())
}

pub(crate) fn torrent_storage_paths_for_output_with_shape(
    content: PathBuf,
    torrent_id: TorrentId,
    content_shape: ContentShape,
) -> Result<TorrentStoragePaths, SelectiveStorageError> {
    torrent_storage_paths_for_output_with_shape_and_part_location(
        content,
        torrent_id,
        content_shape,
        &PathPartLocation::AdjacentToPayload,
    )
}

pub(crate) fn torrent_storage_paths_for_output_with_shape_and_part_location(
    content: PathBuf,
    torrent_id: TorrentId,
    content_shape: ContentShape,
    part_location: &PathPartLocation,
) -> Result<TorrentStoragePaths, SelectiveStorageError> {
    let parent = content
        .parent()
        .ok_or(SelectiveStorageError::InvalidOutputPath)?;
    let part_parent = match part_location {
        PathPartLocation::AdjacentToPayload => parent,
        PathPartLocation::AuxiliaryDirectory(directory) => directory,
    };
    let artifact_base = part_parent.join(torrent_id.to_string());
    let part = selective_part_path(&artifact_base)?;
    if content == part {
        return Err(SelectiveStorageError::InvalidContentName);
    }
    Ok(TorrentStoragePaths {
        content_shape,
        content,
        part,
    })
}

fn payload_path(
    content_shape: ContentShape,
    artifact_root: &Path,
    components: &[String],
    file_index: usize,
    file_count: usize,
) -> Result<PathBuf, SelectiveStorageError> {
    match content_shape {
        ContentShape::File if file_index == 0 && file_count == 1 => Ok(artifact_root.to_path_buf()),
        ContentShape::File => Err(SelectiveStorageError::InvalidStorageOperation(
            "single-file content requires exactly one logical file",
        )),
        ContentShape::Tree => Ok(joined_path(artifact_root, components)),
    }
}

fn sibling_with_suffix(path: &Path, suffix: &str) -> Result<PathBuf, SelectiveStorageError> {
    let file_name = path
        .file_name()
        .ok_or(SelectiveStorageError::InvalidOutputPath)?;
    let mut sibling = OsString::from(".");
    sibling.push(file_name);
    sibling.push(suffix);
    Ok(path.with_file_name(sibling))
}

fn joined_path(root: &Path, components: &[String]) -> PathBuf {
    let mut path = root.to_path_buf();
    path.extend(components);
    path
}

fn storage_instance_id(torrent_id: TorrentId) -> String {
    torrent_id.to_string()
}

fn path_storage_reference(
    pool: &StorageFilePool,
    storage_id: &str,
    storage_generation: u64,
    role: StorageFileRole,
    path: PathBuf,
) -> StorageFileReference {
    StorageFileReference::new(
        pool.clone(),
        StorageFileKey {
            storage_id: storage_id.to_owned(),
            storage_generation,
            role,
        },
        StorageFileLocator::Path(path),
    )
}

fn platform_storage_reference(
    spec: &PlatformStorageSpec,
    role: StorageFileRole,
    components: Vec<String>,
) -> StorageFileReference {
    let path = match role {
        StorageFileRole::ContentRoot => vec![spec.content_name.clone()],
        StorageFileRole::Payload(_) => match spec.content_shape {
            ContentShape::File => vec![spec.content_name.clone()],
            ContentShape::Tree => std::iter::once(spec.content_name.clone())
                .chain(components)
                .collect(),
        },
        StorageFileRole::Part => vec![format!(".{}.rstorrent-parts", spec.storage_id)],
    };
    StorageFileReference::new(
        spec.pool.clone(),
        StorageFileKey {
            storage_id: spec.storage_id.clone(),
            storage_generation: spec.storage_generation,
            role,
        },
        StorageFileLocator::Platform(PlatformStorageTarget {
            root_id: spec.root_id.clone(),
            storage_id: spec.storage_id.clone(),
            storage_generation: spec.storage_generation,
            role,
            path,
        }),
    )
}

async fn path_exists(path: &Path, operation: &'static str) -> Result<bool, SelectiveStorageError> {
    tokio::fs::try_exists(path)
        .await
        .map_err(|source| SelectiveStorageError::Io { operation, source })
}

async fn remove_file_if_present(path: &Path) -> Result<(), io::Error> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

pub async fn remove_selective_part_if_present(output_root: &Path) -> Result<(), io::Error> {
    let part = selective_part_path(output_root)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid output root"))?;
    remove_file_if_present(&part).await
}

#[cfg(test)]
mod tests {
    use std::io;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};

    use rstorrent_protocol::content::{
        ExpectedPieceIntegrity, TorrentContent, TorrentContentProjection,
    };
    use rstorrent_protocol::merkle::{file_root_from_data, piece_root_from_data};
    use rstorrent_protocol::metainfo::{
        EXPLICIT_IMPORT_METAINFO_LIMITS, Metainfo, MetainfoFile, MetainfoMode,
    };
    use rstorrent_protocol::peer_wire::BlockRequest;
    use rstorrent_protocol::storage_layout::{FileSelection, TorrentLayout};
    use sha1::{Digest, Sha1};

    use crate::checkpoint::DurabilityTarget;
    use crate::identity::{ContentFingerprint, TorrentId};
    use crate::resume_validation::{ResumeStorageEvidence, ResumeValidationRejectReason};
    use crate::storage_file_pool::{StorageFileAccess, StorageFilePool, platform_storage_channel};

    use super::{
        BlockingHashResult, ComputedPieceHash, ContentShape, DEFAULT_STORAGE_FILE_LIMIT,
        DescriptorFile, DescriptorStorage, PathPartLocation, PlatformStorageSpec, ResumedStorage,
        SelectiveStorage, SelectiveStorageError, SelectiveWriteDestination, SelectiveWritePlan,
        SelectiveWriteSpan, SelectiveWriteStats, TorrentArtifactIdentity,
        VERIFICATION_CHUNK_LENGTH, await_blocking_hash, collect_descriptors,
        remove_selective_part_if_present, storage_instance_id, torrent_storage_paths,
        torrent_storage_paths_for_metainfo, torrent_storage_paths_for_output_with_shape,
        torrent_storage_paths_for_output_with_shape_and_part_location,
    };

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn test_torrent_id() -> TorrentId {
        TorrentId::new([0x51; 16]).expect("nonzero test owner")
    }

    fn test_artifact_identity() -> TorrentArtifactIdentity {
        TorrentArtifactIdentity {
            torrent_id: test_torrent_id(),
            content_fingerprint: ContentFingerprint::from_digest([0x52; 32]),
        }
    }

    fn test_path(name: &str) -> PathBuf {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "rstorrent-selective-storage-test-{}-{sequence}",
            std::process::id()
        ));
        std::fs::create_dir(&root).expect("create isolated test parent");
        root.join(name)
    }

    fn make_test_file_writable(path: &Path) {
        let mut permissions = std::fs::metadata(path)
            .expect("read test file permissions")
            .permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            permissions.set_mode(permissions.mode() | 0o200);
        }
        #[cfg(not(unix))]
        permissions.set_readonly(false);
        std::fs::set_permissions(path, permissions).expect("make test file writable");
    }

    fn fixture() -> Metainfo {
        let lengths = [20_000, 50_000, 7_000, 18_000, 0, 3_304, 35_000];
        let paths = [
            &["wanted", "start.bin"][..],
            &["skip", "large.bin"][..],
            &["later.bin"][..],
            &["wanted", "end.bin"][..],
            &["wanted", "empty.bin"][..],
            &[".pad", "3304"][..],
            &["tail.bin"][..],
        ];
        let mut offset = 0_u64;
        let files = lengths
            .into_iter()
            .enumerate()
            .map(|(index, length)| {
                let file = MetainfoFile {
                    path: paths[index].iter().map(|part| (*part).to_owned()).collect(),
                    length,
                    offset,
                    padding: index == 5,
                };
                offset += length;
                file
            })
            .collect();
        Metainfo {
            info_hash: [1; 20],
            piece_hashes: vec![[2; 20]; 5],
            piece_length: 32_768,
            total_length: 133_304,
            name: "fixture".to_owned(),
            private: false,
            mode: MetainfoMode::MultiFile,
            files,
        }
    }

    fn bstr(output: &mut Vec<u8>, value: &[u8]) {
        output.extend_from_slice(value.len().to_string().as_bytes());
        output.push(b':');
        output.extend_from_slice(value);
    }

    fn pure_v2_content(
        files: &[(&[u8], &[u8])],
        piece_length: u32,
    ) -> (
        TorrentContent,
        rstorrent_protocol::content::TorrentIntegrity,
    ) {
        let roots = files
            .iter()
            .map(|(_, data)| file_root_from_data(data).expect("nonempty fixture file"))
            .collect::<Vec<_>>();
        let mut info = b"d9:file treed".to_vec();
        for ((name, data), root) in files.iter().zip(&roots) {
            bstr(&mut info, name);
            info.extend_from_slice(b"d0:d6:lengthi");
            info.extend_from_slice(data.len().to_string().as_bytes());
            info.extend_from_slice(b"e11:pieces root32:");
            info.extend_from_slice(root);
            info.extend_from_slice(b"ee");
        }
        info.extend_from_slice(b"e12:meta versioni2e4:name4:root12:piece lengthi");
        info.extend_from_slice(piece_length.to_string().as_bytes());
        info.extend_from_slice(b"ee");
        let mut source = b"d4:info".to_vec();
        source.extend_from_slice(&info);
        source.extend_from_slice(b"12:piece layersd");
        for ((_, data), root) in files.iter().zip(&roots) {
            if data.len() <= piece_length as usize {
                continue;
            }
            bstr(&mut source, root);
            let hashes = data
                .chunks(piece_length as usize)
                .map(|piece| piece_root_from_data(piece, piece_length).expect("piece root"))
                .collect::<Vec<_>>();
            bstr(&mut source, &hashes.concat());
        }
        source.extend_from_slice(b"ee");
        let projection = TorrentContentProjection::from_bytes_with_limits(
            &source,
            EXPLICIT_IMPORT_METAINFO_LIMITS,
        )
        .expect("complete pure-v2 fixture");
        (projection.content, projection.integrity)
    }

    fn hybrid_content() -> (
        TorrentContent,
        rstorrent_protocol::content::TorrentIntegrity,
    ) {
        let piece_length = 16 * 1024;
        let roots = [
            file_root_from_data(&[1]).expect("first hybrid root"),
            file_root_from_data(&[2]).expect("second hybrid root"),
        ];
        let mut tree = vec![b'd'];
        for (name, root) in [(b'a', roots[0]), (b'b', roots[1])] {
            bstr(&mut tree, &[name]);
            tree.extend_from_slice(b"d0:d6:lengthi1e11:pieces root32:");
            tree.extend_from_slice(&root);
            tree.extend_from_slice(b"ee");
        }
        tree.push(b'e');
        let mut first_piece = vec![1];
        first_piece.resize(piece_length, 0);
        let pieces = [
            <[u8; 20]>::from(Sha1::digest(&first_piece)),
            <[u8; 20]>::from(Sha1::digest([2])),
        ];
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
        info.extend_from_slice(&pieces.concat());
        info.push(b'e');
        let mut source = b"d4:info".to_vec();
        source.extend_from_slice(&info);
        source.extend_from_slice(b"12:piece layersdee");
        let projection = TorrentContentProjection::from_bytes_with_limits(
            &source,
            EXPLICIT_IMPORT_METAINFO_LIMITS,
        )
        .expect("complete hybrid fixture");
        (projection.content, projection.integrity)
    }

    fn hybrid_runtime_content() -> (
        TorrentContent,
        rstorrent_protocol::content::TorrentIntegrity,
        Vec<Vec<u8>>,
    ) {
        const PIECE_LENGTH: usize = 64 * 1024;
        let deterministic = |seed: usize, length: usize| {
            (0..length)
                .map(|index| (((seed + index) * 37 + index / 11) % 251) as u8)
                .collect::<Vec<_>>()
        };
        let files = vec![
            Vec::new(),
            deterministic(7, 137),
            deterministic(11, PIECE_LENGTH + 731),
            deterministic(17, PIECE_LENGTH + 911),
            Vec::new(),
            deterministic(23, 701),
        ];
        let paths: Vec<Vec<&[u8]>> = vec![
            vec![b"a-empty.bin"],
            vec![b"b-one-piece.bin"],
            vec![b"c-nested", b"selected-multi.bin"],
            vec![b"d-skipped-multi.bin"],
            vec![b"e-empty.bin"],
            vec![b"f-short-tail.bin"],
        ];
        let logical_offsets = [0_usize, 0, 65_536, 196_608, 263_055, 327_680];
        let roots = files
            .iter()
            .map(|data| (!data.is_empty()).then(|| file_root_from_data(data).unwrap()))
            .collect::<Vec<_>>();
        let leaf = |output: &mut Vec<u8>, data: &[u8], root: Option<[u8; 32]>| {
            output.extend_from_slice(b"d0:d6:lengthi");
            output.extend_from_slice(data.len().to_string().as_bytes());
            output.push(b'e');
            if let Some(root) = root {
                output.extend_from_slice(b"11:pieces root32:");
                output.extend_from_slice(&root);
            }
            output.extend_from_slice(b"ee");
        };

        let mut tree = vec![b'd'];
        for (path, (data, root)) in paths.iter().zip(files.iter().zip(&roots)) {
            bstr(&mut tree, path[0]);
            if path.len() == 1 {
                leaf(&mut tree, data, *root);
            } else {
                tree.push(b'd');
                bstr(&mut tree, path[1]);
                leaf(&mut tree, data, *root);
                tree.push(b'e');
            }
        }
        tree.push(b'e');

        let mut v1_files = Vec::new();
        let mut v1_payload = Vec::new();
        let mut cursor = 0_usize;
        for ((path, data), logical_offset) in paths.iter().zip(&files).zip(logical_offsets) {
            let gap = logical_offset - cursor;
            if gap != 0 {
                v1_files.extend_from_slice(b"d4:attr1:p6:lengthi");
                v1_files.extend_from_slice(gap.to_string().as_bytes());
                v1_files.extend_from_slice(b"e4:pathl4:.pad");
                bstr(&mut v1_files, gap.to_string().as_bytes());
                v1_files.extend_from_slice(b"ee");
                v1_payload.resize(v1_payload.len() + gap, 0);
                cursor += gap;
            }
            v1_files.extend_from_slice(b"d6:lengthi");
            v1_files.extend_from_slice(data.len().to_string().as_bytes());
            v1_files.extend_from_slice(b"e4:pathl");
            for component in path {
                bstr(&mut v1_files, component);
            }
            v1_files.extend_from_slice(b"ee");
            v1_payload.extend_from_slice(data);
            cursor += data.len();
        }
        let tail = (PIECE_LENGTH - cursor % PIECE_LENGTH) % PIECE_LENGTH;
        if tail != 0 {
            v1_files.extend_from_slice(b"d4:attr1:p6:lengthi");
            v1_files.extend_from_slice(tail.to_string().as_bytes());
            v1_files.extend_from_slice(b"e4:pathl4:.pad");
            bstr(&mut v1_files, tail.to_string().as_bytes());
            v1_files.extend_from_slice(b"ee");
            v1_payload.resize(v1_payload.len() + tail, 0);
        }
        let piece_hashes = v1_payload
            .chunks(PIECE_LENGTH)
            .map(|piece| <[u8; 20]>::from(Sha1::digest(piece)))
            .collect::<Vec<_>>();

        let mut info = b"d9:file tree".to_vec();
        info.extend_from_slice(&tree);
        info.extend_from_slice(b"5:filesl");
        info.extend_from_slice(&v1_files);
        info.extend_from_slice(b"e12:meta versioni2e4:name4:root12:piece lengthi65536e6:pieces");
        bstr(&mut info, &piece_hashes.concat());
        info.push(b'e');

        let mut layers = roots
            .iter()
            .zip(&files)
            .filter_map(|(root, data)| {
                let root = (*root)?;
                (data.len() > PIECE_LENGTH).then(|| {
                    let piece_roots = data
                        .chunks(PIECE_LENGTH)
                        .map(|piece| piece_root_from_data(piece, PIECE_LENGTH as u32).unwrap())
                        .collect::<Vec<_>>();
                    (root, piece_roots.concat())
                })
            })
            .collect::<Vec<_>>();
        layers.sort_unstable_by_key(|(root, _)| *root);
        let mut source = b"d4:info".to_vec();
        source.extend_from_slice(&info);
        source.extend_from_slice(b"12:piece layersd");
        for (root, hashes) in layers {
            bstr(&mut source, &root);
            bstr(&mut source, &hashes);
        }
        source.extend_from_slice(b"ee");
        let projection = TorrentContentProjection::from_bytes_with_limits(
            &source,
            EXPLICIT_IMPORT_METAINFO_LIMITS,
        )
        .expect("complete hybrid runtime fixture");
        (projection.content, projection.integrity, files)
    }

    #[tokio::test]
    async fn hybrid_hashes_real_bytes_once_and_synthesizes_v1_padding() {
        let (content, integrity) = hybrid_content();
        let content = Arc::new(content);
        let output = test_path("hybrid-root");
        let mut storage = SelectiveStorage::create_content(
            output,
            test_artifact_identity(),
            content.clone(),
            &[],
        )
        .await
        .expect("create hybrid storage");
        for (piece, byte) in [(0, 1), (1, 2)] {
            storage
                .write_block(piece, 0, vec![byte])
                .await
                .expect("write hybrid payload byte");
            let actual = storage
                .hash_piece_content(piece)
                .await
                .expect("one-pass hybrid hash");
            let expected = content
                .expected_piece(&integrity, piece)
                .expect("dual hybrid expectation");
            assert!(matches!(
                (actual, expected),
                (
                    ComputedPieceHash::Hybrid {
                        sha1,
                        sha256_root,
                        retained_hash_high_water: 1,
                    },
                    ExpectedPieceIntegrity::Hybrid {
                        v1_sha1,
                        v2_expected_root,
                        ..
                    }
                ) if sha1 == v1_sha1 && sha256_root == v2_expected_root
            ));
        }
        assert_eq!(content.hybrid_padding().unwrap().zero_length(0), 16_383);
        assert_eq!(content.hybrid_padding().unwrap().zero_length(1), 0);
    }

    #[tokio::test]
    async fn pure_v2_writes_and_hashes_file_local_pieces_without_part_or_gap() {
        let skipped = vec![9_u8];
        let selected = (0..40_000)
            .map(|index| (index % 251) as u8)
            .collect::<Vec<_>>();
        let selected_small = vec![0x5a; 17];
        let (content, integrity) = pure_v2_content(
            &[(b"a", &skipped), (b"b", &selected), (b"c", &selected_small)],
            32 * 1024,
        );
        let content = Arc::new(content);
        let output = test_path("root");
        let parent = output.parent().expect("test parent").to_path_buf();
        let mut storage = SelectiveStorage::create_content(
            output.clone(),
            test_artifact_identity(),
            content.clone(),
            &[0],
        )
        .await
        .expect("create v2 storage");

        assert_eq!(
            storage.selected_bytes(),
            (selected.len() + selected_small.len()) as u64
        );
        assert_eq!(storage.skipped_bytes(), skipped.len() as u64);
        assert_eq!(storage.padding_bytes(), 0);
        assert_eq!(storage.part_slots(), 0);
        assert!(!storage.has_part_file());
        assert!(matches!(
            storage.write_block(0, 0, skipped.clone()).await,
            Err(SelectiveStorageError::InvalidStorageOperation(
                "write skipped v2 piece"
            ))
        ));

        for (piece, payload) in selected.chunks(32 * 1024).enumerate() {
            for (block, bytes) in payload.chunks(16 * 1024).enumerate() {
                storage
                    .write_block(
                        u32::try_from(piece + 1).expect("piece"),
                        u32::try_from(block * 16 * 1024).expect("begin"),
                        bytes.to_vec(),
                    )
                    .await
                    .expect("write v2 block");
            }
            let piece_index = u32::try_from(piece + 1).expect("piece index");
            let actual = storage
                .hash_piece_content(piece_index)
                .await
                .expect("hash v2 piece");
            let expected = content
                .expected_piece(&integrity, piece_index)
                .expect("expected root");
            let (
                ComputedPieceHash::Sha256 {
                    root,
                    retained_hash_high_water,
                },
                ExpectedPieceIntegrity::V2Merkle { expected_root, .. },
            ) = (actual, expected)
            else {
                panic!("v2 integrity variants")
            };
            assert_eq!(root, expected_root);
            assert!(retained_hash_high_water <= 2);
            storage.record_verified(piece + 1).expect("record v2 piece");
        }
        storage
            .write_block(3, 0, selected_small)
            .await
            .expect("write one-piece v2 file");
        let actual = storage
            .hash_piece_content(3)
            .await
            .expect("hash one-piece v2 file");
        let expected = content
            .expected_piece(&integrity, 3)
            .expect("one-piece expected root");
        assert!(matches!(
            (actual, expected),
            (
                ComputedPieceHash::Sha256 {
                    root,
                    retained_hash_high_water: 1
                },
                ExpectedPieceIntegrity::V2Merkle {
                    expected_root,
                    target_height: 0,
                    ..
                }
            ) if root == expected_root
        ));
        storage.record_verified(3).expect("record one-piece file");
        assert_eq!(storage.part_slots(), 0);
        assert!(!storage.has_part_file());
        let part = storage
            .part_path()
            .expect("path-backed part name")
            .to_path_buf();
        assert!(!part.exists());
        storage
            .finish_content()
            .await
            .expect("finish selected v2 data");
        assert!(output.exists());
        drop(storage);
        let (mut storage, interrupted_state) = SelectiveStorage::resume_content(
            output.clone(),
            test_artifact_identity(),
            content.clone(),
            &[0],
            vec![false, true, true, true],
        )
        .await
        .expect("resume v2 content");
        assert_eq!(interrupted_state, ResumedStorage::Existing);
        storage
            .finish_content()
            .await
            .expect("finish resumed v2 content");
        assert_eq!(std::fs::read(output.join("b")).expect("direct b"), selected);
        assert_eq!(
            std::fs::read(output.join("c")).expect("direct c"),
            vec![0x5a; 17]
        );
        assert!(!output.join("a").exists());
        drop(storage);

        for path in [output.join("b"), output.join("c")] {
            let mut permissions = std::fs::metadata(&path)
                .expect("read v2 completion permissions")
                .permissions();
            permissions.set_readonly(true);
            std::fs::set_permissions(&path, permissions).expect("make v2 completion read-only");
        }
        let (mut resumed, state) = SelectiveStorage::resume_content(
            output.clone(),
            test_artifact_identity(),
            content.clone(),
            &[0],
            vec![false, true, true, true],
        )
        .await
        .expect("resume direct v2 storage");
        assert_eq!(state, ResumedStorage::Existing);
        assert_eq!(resumed.part_slots(), 0);
        assert!(!resumed.has_part_file());
        for piece_index in 1..=3 {
            let actual = resumed
                .hash_piece_content(piece_index)
                .await
                .expect("hash exact read-only v2 completion");
            let expected = content
                .expected_piece(&integrity, piece_index)
                .expect("expected read-only v2 root");
            assert!(matches!(
                (actual, expected),
                (
                    ComputedPieceHash::Sha256 { root, .. },
                    ExpectedPieceIntegrity::V2Merkle { expected_root, .. }
                ) if root == expected_root
            ));
            resumed
                .record_verified(piece_index as usize)
                .expect("record read-only v2 check");
        }
        resumed
            .finish_content()
            .await
            .expect("finish exact read-only v2 check");
        drop(resumed);

        let b = output.join("b");
        make_test_file_writable(&b);
        let mut corrupted = selected.clone();
        corrupted[17] ^= 0x80;
        std::fs::write(&b, corrupted).expect("corrupt v2 completion in place");
        let (corrupt, state) = SelectiveStorage::resume_content(
            output.clone(),
            test_artifact_identity(),
            content.clone(),
            &[0],
            vec![false, true, true, true],
        )
        .await
        .expect("resume same-length corrupt v2 completion");
        assert_eq!(state, ResumedStorage::Existing);
        let actual = corrupt
            .hash_piece_content(1)
            .await
            .expect("hash same-length corrupt v2 piece");
        let expected = content
            .expected_piece(&integrity, 1)
            .expect("expected v2 root");
        assert!(matches!(
            (actual, expected),
            (
                ComputedPieceHash::Sha256 { root, .. },
                ExpectedPieceIntegrity::V2Merkle { expected_root, .. }
            ) if root != expected_root
        ));
        drop(corrupt);

        std::fs::write(&b, &selected[..1]).expect("truncate v2 completion");
        let (mut truncated, state) = SelectiveStorage::resume_content(
            output.clone(),
            test_artifact_identity(),
            content.clone(),
            &[0],
            vec![false, true, true, true],
        )
        .await
        .expect("inventory truncated v2 completion");
        assert_eq!(state, ResumedStorage::Existing);
        assert!(
            !truncated
                .has_piece_sources(1)
                .await
                .expect("classify truncated v2 piece")
        );
        assert!(truncated.hash_piece_content(1).await.is_err());
        drop(truncated);

        let c = output.join("c");
        make_test_file_writable(&c);
        std::fs::remove_file(&c).expect("remove v2 completion file");
        let (mut missing, state) = SelectiveStorage::resume_content(
            output,
            test_artifact_identity(),
            content,
            &[0],
            vec![false, true, true, true],
        )
        .await
        .expect("inventory missing v2 completion file");
        assert_eq!(state, ResumedStorage::Existing);
        assert!(
            !missing
                .has_piece_sources(3)
                .await
                .expect("classify missing v2 piece")
        );
        assert!(missing.hash_piece_content(3).await.is_err());
        drop(missing);
        std::fs::remove_dir_all(parent).expect("remove v2 storage fixture");
    }

    fn single_file_fixture() -> Metainfo {
        Metainfo {
            info_hash: [9; 20],
            piece_hashes: vec![[3; 20]; 2],
            piece_length: 16_384,
            total_length: 20_000,
            name: "single.bin".to_owned(),
            private: false,
            mode: MetainfoMode::SingleFile,
            files: vec![MetainfoFile {
                path: vec!["single.bin".to_owned()],
                length: 20_000,
                offset: 0,
                padding: false,
            }],
        }
    }

    #[test]
    fn torrent_paths_use_visible_name_and_opaque_owner_artifacts() {
        let root = test_path("torrent-paths");
        let paths = torrent_storage_paths(&root, "Visible Name", test_torrent_id())
            .expect("plan torrent storage paths");

        assert_eq!(paths.content, root.join("Visible Name"));
        assert_eq!(paths.content_shape, ContentShape::Tree);
        assert_eq!(
            paths.part,
            root.join(format!(".{}.rstorrent-parts", test_torrent_id()))
        );
        assert_eq!(
            torrent_storage_paths(&root, "Каталог", test_torrent_id())
                .expect("plan Unicode completion")
                .content,
            root.join("Каталог")
        );
        let maximum_name = "x".repeat(255);
        assert_eq!(
            torrent_storage_paths(&root, &maximum_name, test_torrent_id())
                .expect("plan maximum completion name")
                .content,
            root.join(&maximum_name)
        );
        assert!(matches!(
            torrent_storage_paths(&root, &"x".repeat(256), test_torrent_id()),
            Err(SelectiveStorageError::InvalidContentName)
        ));
        for invalid in [
            "",
            ".",
            "..",
            "nested/name",
            "nested\\name",
            "C:name",
            ".t1-fedcba9876543210fedcba9876543210.rstorrent-parts",
        ] {
            assert!(matches!(
                torrent_storage_paths(&root, invalid, test_torrent_id()),
                Err(SelectiveStorageError::InvalidContentName)
            ));
        }

        let single = single_file_fixture();
        let single_paths = torrent_storage_paths_for_metainfo(&root, &single, test_torrent_id())
            .expect("plan single-file storage paths");
        assert_eq!(single_paths.content_shape, ContentShape::File);
        assert_eq!(single_paths.content, root.join("single.bin"));

        let multi = fixture();
        assert_eq!(
            torrent_storage_paths_for_metainfo(&root, &multi, test_torrent_id())
                .expect("plan multi-file storage paths")
                .content_shape,
            ContentShape::Tree
        );
    }

    #[test]
    fn auxiliary_part_location_changes_only_the_part_parent() {
        let root = test_path("auxiliary-part-paths");
        let auxiliary = test_path("auxiliary-part-directory");
        let content = root.join("Visible Name");
        let paths = torrent_storage_paths_for_output_with_shape_and_part_location(
            content.clone(),
            test_torrent_id(),
            ContentShape::Tree,
            &PathPartLocation::AuxiliaryDirectory(auxiliary.clone()),
        )
        .expect("plan auxiliary part path");

        assert_eq!(paths.content, content);
        assert_eq!(paths.content_shape, ContentShape::Tree);
        assert_eq!(
            paths.part,
            auxiliary.join(format!(".{}.rstorrent-parts", test_torrent_id()))
        );
    }

    #[tokio::test]
    async fn path_storage_writes_skipped_boundaries_to_auxiliary_directory() {
        let root = test_path("auxiliary-part-storage");
        let auxiliary = root.join("work");
        tokio::fs::create_dir_all(&auxiliary)
            .await
            .expect("create auxiliary directory");
        let metainfo = fixture();
        let content = Arc::new(TorrentContent::from_v1_metainfo(metainfo.clone()));
        let output = root.join(&metainfo.name);
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[1, 2]).expect("selection");
        let bytes = torrent_bytes(&metainfo);
        let pool =
            StorageFilePool::new(DEFAULT_STORAGE_FILE_LIMIT, None).expect("storage file pool");
        let mut storage = SelectiveStorage::create_content_with_pool_and_part_location(
            output.clone(),
            test_artifact_identity(),
            content,
            &[1, 2],
            pool,
            &PathPartLocation::AuxiliaryDirectory(auxiliary.clone()),
        )
        .await
        .expect("create storage with auxiliary part location");

        for request in layout.request_ranges(0, &selection).expect("requests") {
            let begin = request.begin as usize;
            storage
                .write_block(
                    0,
                    request.begin,
                    bytes[begin..begin + request.length as usize].to_vec(),
                )
                .await
                .expect("write boundary piece");
        }

        let expected_part = auxiliary.join(format!(".{}.rstorrent-parts", test_torrent_id()));
        assert_eq!(storage.part_path(), Some(expected_part.as_path()));
        assert!(expected_part.is_file());
        assert!(
            !root
                .join(format!(".{}.rstorrent-parts", test_torrent_id()))
                .exists()
        );

        drop(storage);
        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove auxiliary storage fixture");
    }

    fn torrent_bytes(metainfo: &Metainfo) -> Vec<u8> {
        let mut bytes: Vec<u8> = (0..metainfo.total_length)
            .map(|offset| (offset % 251) as u8)
            .collect();
        for file in metainfo.files.iter().filter(|file| file.padding) {
            bytes[file.offset as usize..(file.offset + file.length) as usize].fill(0);
        }
        bytes
    }

    async fn clean(output: &Path) {
        let _ = tokio::fs::remove_dir_all(output).await;
        if let Some(parent) = output.parent() {
            let artifact_base = parent.join(test_torrent_id().to_string());
            let _ = remove_selective_part_if_present(&artifact_base).await;
        }
    }

    #[tokio::test]
    async fn contiguous_wanted_piece_hash_runs_in_one_bounded_job() {
        let output = test_path("contiguous-hash");
        clean(&output).await;
        let piece_length = 256 * 1024_u32;
        let bytes = (0..piece_length as usize)
            .map(|offset| ((offset * 41 + offset / 23) & 0xff) as u8)
            .collect::<Vec<_>>();
        let expected: [u8; 20] = Sha1::digest(&bytes).into();
        let metainfo = Metainfo {
            info_hash: [7; 20],
            piece_hashes: vec![expected],
            piece_length,
            total_length: u64::from(piece_length),
            name: "contiguous".to_owned(),
            private: false,
            mode: MetainfoMode::MultiFile,
            files: vec![MetainfoFile {
                path: vec!["payload.bin".to_owned()],
                length: u64::from(piece_length),
                offset: 0,
                padding: false,
            }],
        };
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[]).expect("selection");
        let mut storage = SelectiveStorage::create(
            output.clone(),
            test_artifact_identity(),
            &metainfo,
            layout.clone(),
            selection.clone(),
        )
        .await
        .expect("create storage");
        for request in layout.request_ranges(0, &selection).expect("requests") {
            let begin = request.begin as usize;
            storage
                .write_block(
                    0,
                    request.begin,
                    bytes[begin..begin + request.length as usize].to_vec(),
                )
                .await
                .expect("write block");
        }
        let (actual, stats) = storage
            .hash_piece_with_stats(0)
            .await
            .expect("hash contiguous piece");
        assert_eq!(actual, expected);
        assert_eq!(stats.wanted_file_seeks, 0);
        assert_eq!(
            stats.wanted_file_reads,
            bytes.len().div_ceil(VERIFICATION_CHUNK_LENGTH)
        );
        assert_eq!(stats.part_file_reads, 0);
        assert_eq!(stats.wanted_file_duplicates, 0);
        assert_eq!(stats.blocking_jobs, 1);
        clean(&output).await;
    }

    #[tokio::test]
    async fn validates_every_write_route_before_mutating_any_destination() {
        let output = test_path("stale-write-route");
        clean(&output).await;
        let metainfo = fixture();
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[]).expect("selection");
        let storage = SelectiveStorage::create(
            output.clone(),
            test_artifact_identity(),
            &metainfo,
            layout,
            selection,
        )
        .await
        .expect("create storage");
        let route = storage.files[0]
            .as_ref()
            .expect("first wanted file")
            .routing_generation;
        let plan = SelectiveWritePlan {
            payload: Arc::new(Vec::from(&b"abcdefgh"[..])),
            spans: vec![
                SelectiveWriteSpan {
                    destination: SelectiveWriteDestination::WantedFile {
                        file_index: 0,
                        file_offset: 0,
                        routing_generation: route,
                    },
                    block_offset: 0,
                    length: 4,
                },
                SelectiveWriteSpan {
                    destination: SelectiveWriteDestination::WantedFile {
                        file_index: 0,
                        file_offset: 4,
                        routing_generation: route.wrapping_add(1),
                    },
                    block_offset: 4,
                    length: 4,
                },
            ],
            stats: SelectiveWriteStats {
                wanted_bytes: 8,
                skipped_bytes: 0,
            },
        };

        assert!(matches!(
            storage.execute_write_plan(plan).await,
            Err(SelectiveStorageError::StaleWriteRoute { file_index: 0 })
        ));
        assert!(
            !output.exists(),
            "a rejected immutable plan must not create its destination"
        );
        clean(&output).await;
    }

    #[tokio::test]
    async fn blocking_hash_preserves_cross_file_and_padding_order() {
        let output = test_path("blocking-cross-file-padding");
        clean(&output).await;
        let piece_length = 256 * 1024_u32;
        let first_length = 100_000_u64;
        let padding_length = 4_000_u64;
        let second_length = u64::from(piece_length) - first_length - padding_length;
        let mut bytes = (0..piece_length as usize)
            .map(|offset| ((offset * 17 + offset / 31) & 0xff) as u8)
            .collect::<Vec<_>>();
        bytes[first_length as usize..(first_length + padding_length) as usize].fill(0);
        let expected: [u8; 20] = Sha1::digest(&bytes).into();
        let metainfo = Metainfo {
            info_hash: [8; 20],
            piece_hashes: vec![expected],
            piece_length,
            total_length: u64::from(piece_length),
            name: "cross-file-padding".to_owned(),
            private: false,
            mode: MetainfoMode::MultiFile,
            files: vec![
                MetainfoFile {
                    path: vec!["first.bin".to_owned()],
                    length: first_length,
                    offset: 0,
                    padding: false,
                },
                MetainfoFile {
                    path: vec![".pad".to_owned(), "4000".to_owned()],
                    length: padding_length,
                    offset: first_length,
                    padding: true,
                },
                MetainfoFile {
                    path: vec!["second.bin".to_owned()],
                    length: second_length,
                    offset: first_length + padding_length,
                    padding: false,
                },
            ],
        };
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[]).expect("selection");
        let pool = StorageFilePool::new(1, None).expect("single-handle file pool");
        let mut storage = SelectiveStorage::create_with_pool(
            output.clone(),
            test_artifact_identity(),
            &metainfo,
            layout.clone(),
            selection.clone(),
            pool,
        )
        .await
        .expect("create storage");
        for request in layout.request_ranges(0, &selection).expect("requests") {
            let begin = request.begin as usize;
            storage
                .write_block(
                    0,
                    request.begin,
                    bytes[begin..begin + request.length as usize].to_vec(),
                )
                .await
                .expect("write block");
        }
        let (actual, stats) = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            storage.hash_piece_with_stats(0),
        )
        .await
        .expect("cross-file hash must not retain one lease while acquiring the next")
        .expect("hash cross-file piece");
        assert_eq!(actual, expected);
        assert_eq!(stats.wanted_file_seeks, 0);
        assert_eq!(stats.wanted_file_duplicates, 0);
        assert_eq!(stats.blocking_jobs, 1);
        assert_eq!(
            stats.wanted_file_reads,
            (first_length as usize).div_ceil(VERIFICATION_CHUNK_LENGTH)
                + (second_length as usize).div_ceil(VERIFICATION_CHUNK_LENGTH)
        );
        assert_eq!(stats.part_file_reads, 0);
        storage.files[2]
            .as_ref()
            .expect("second wanted file")
            .acquire(StorageFileAccess::ReadWriteExisting)
            .await
            .expect("acquire second wanted file")
            .file()
            .set_len(second_length - 1)
            .expect("truncate second cross-file span");
        assert!(matches!(
            storage.hash_piece(0).await,
            Err(SelectiveStorageError::UnexpectedFileLength {
                file_index: 2,
                expected,
                actual,
            }) if expected == second_length && actual == second_length - 1
        ));
        clean(&output).await;
    }

    #[tokio::test]
    async fn active_upload_read_composes_cross_file_padding_and_content_bytes() {
        let output = test_path("active-upload-cross-file-padding");
        clean(&output).await;
        let metainfo = Metainfo {
            info_hash: [0x44; 20],
            piece_hashes: vec![[0; 20]],
            piece_length: 12,
            total_length: 12,
            name: "active-upload".to_owned(),
            private: false,
            mode: MetainfoMode::MultiFile,
            files: vec![
                MetainfoFile {
                    path: vec!["first".to_owned()],
                    length: 4,
                    offset: 0,
                    padding: false,
                },
                MetainfoFile {
                    path: vec![".pad".to_owned(), "3".to_owned()],
                    length: 3,
                    offset: 4,
                    padding: true,
                },
                MetainfoFile {
                    path: vec!["second".to_owned()],
                    length: 5,
                    offset: 7,
                    padding: false,
                },
            ],
        };
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[]).expect("selection");
        let mut storage = SelectiveStorage::create(
            output.clone(),
            test_artifact_identity(),
            &metainfo,
            layout,
            selection,
        )
        .await
        .expect("storage");
        storage
            .write_block(0, 0, b"abcd".to_vec())
            .await
            .expect("first file");
        storage
            .write_block(0, 7, b"efghi".to_vec())
            .await
            .expect("second file");
        storage.record_verified(0).expect("verified");
        let plan = storage
            .prepare_upload_read(
                BlockRequest {
                    index: 0,
                    begin: 0,
                    length: 12,
                },
                storage.route_epoch(),
            )
            .expect("read plan");
        assert_eq!(plan.segment_count(), 3);
        assert_eq!(
            plan.execute().await.expect("read"),
            [
                b'a', b'b', b'c', b'd', 0, 0, 0, b'e', b'f', b'g', b'h', b'i'
            ]
        );
        clean(&output).await;
    }

    #[tokio::test]
    async fn active_upload_read_serves_verified_part_backed_piece() {
        let output = test_path("active-upload-part");
        clean(&output).await;
        let metainfo = fixture();
        let bytes = torrent_bytes(&metainfo);
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[1, 2]).expect("selection");
        let mut storage = SelectiveStorage::create(
            output.clone(),
            test_artifact_identity(),
            &metainfo,
            layout.clone(),
            selection.clone(),
        )
        .await
        .expect("storage");
        for request in layout.request_ranges(0, &selection).expect("requests") {
            let begin = request.begin as usize;
            storage
                .write_block(
                    0,
                    request.begin,
                    bytes[begin..begin + request.length as usize].to_vec(),
                )
                .await
                .expect("piece write");
        }
        storage.record_verified(0).expect("verified");
        let request = BlockRequest {
            index: 0,
            begin: 16_384,
            length: 16_384,
        };
        let plan = storage
            .prepare_upload_read(request, storage.route_epoch())
            .expect("part read plan");
        assert_eq!(plan.segment_count(), 2);
        assert_eq!(
            plan.execute().await.expect("part-backed read"),
            bytes[16_384..32_768]
        );
        clean(&output).await;
    }

    #[tokio::test]
    async fn active_file_read_requires_every_intersecting_verified_piece() {
        let output = test_path("active-file-read");
        clean(&output).await;
        let metainfo = single_file_fixture();
        let bytes = (0..metainfo.total_length as usize)
            .map(|index| (index % 251) as u8)
            .collect::<Vec<_>>();
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[]).expect("selection");
        let mut storage = SelectiveStorage::create(
            output.clone(),
            test_artifact_identity(),
            &metainfo,
            layout,
            selection,
        )
        .await
        .expect("storage");
        storage
            .write_block(0, 0, bytes[..16_384].to_vec())
            .await
            .expect("first piece");
        storage
            .write_block(1, 0, bytes[16_384..].to_vec())
            .await
            .expect("second piece");
        storage.record_verified(0).expect("first verified");
        let epoch = storage.route_epoch();
        assert!(matches!(
            storage.prepare_file_read(0, 10_000, 10_000, epoch),
            Err(SelectiveStorageError::InvalidVerifiedPiece { piece_index: 1 })
        ));
        storage.record_verified(1).expect("second verified");
        let plan = storage
            .prepare_file_read(0, 10_000, 10_000, epoch)
            .expect("verified file read plan");
        assert_eq!(plan.file_index(), 0);
        assert_eq!(plan.offset(), 10_000);
        assert_eq!(plan.length(), 10_000);
        assert_eq!(
            plan.execute().await.expect("active file read"),
            bytes[10_000..]
        );
        assert!(matches!(
            storage.prepare_file_read(0, 0, 1, epoch + 1),
            Err(SelectiveStorageError::InvalidStorageOperation(
                "stale active file route epoch"
            ))
        ));
        clean(&output).await;
    }

    #[tokio::test]
    async fn blocking_hash_reports_a_truncated_content_file() {
        let output = test_path("blocking-truncated");
        clean(&output).await;
        let metainfo = Metainfo {
            info_hash: [9; 20],
            piece_hashes: vec![[0; 20]],
            piece_length: 32_768,
            total_length: 32_768,
            name: "truncated".to_owned(),
            private: false,
            mode: MetainfoMode::MultiFile,
            files: vec![MetainfoFile {
                path: vec!["payload.bin".to_owned()],
                length: 32_768,
                offset: 0,
                padding: false,
            }],
        };
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[]).expect("selection");
        let mut storage = SelectiveStorage::create(
            output.clone(),
            test_artifact_identity(),
            &metainfo,
            layout.clone(),
            selection.clone(),
        )
        .await
        .expect("create storage");
        for request in layout.request_ranges(0, &selection).expect("requests") {
            storage
                .write_block(0, request.begin, vec![3; request.length as usize])
                .await
                .expect("write block");
        }
        storage.files[0]
            .as_ref()
            .expect("wanted file")
            .acquire(StorageFileAccess::ReadWriteExisting)
            .await
            .expect("acquire wanted file")
            .file()
            .set_len(16_384)
            .expect("truncate content file");
        assert!(matches!(
            storage.hash_piece(0).await,
            Err(SelectiveStorageError::UnexpectedFileLength {
                file_index: 0,
                expected: 32_768,
                actual: 16_384,
            })
        ));
        clean(&output).await;
    }

    #[tokio::test]
    async fn blocking_hash_task_panic_is_a_typed_join_failure() {
        let task = tokio::task::spawn_blocking(|| -> BlockingHashResult {
            panic!("controlled blocking hash panic")
        });
        assert!(matches!(
            await_blocking_hash(task).await,
            Err(SelectiveStorageError::Io {
                operation: "join selected piece blocking verification job",
                source,
            }) if source.kind() == std::io::ErrorKind::Other
        ));
    }

    fn new_descriptor(path: &Path) -> std::fs::File {
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(path)
            .expect("create descriptor file")
    }

    fn descriptor_manifest(root: &Path, wanted_indices: &[usize]) -> DescriptorStorage {
        let part_path = root.join("part");
        let part_file = new_descriptor(&part_path);
        let reopened_part_file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&part_path)
            .expect("open manifest part descriptor independently");
        DescriptorStorage {
            wanted_files: wanted_indices
                .iter()
                .map(|&file_index| {
                    let path = root.join(format!("wanted-{file_index}"));
                    DescriptorFile {
                        file_index,
                        file: new_descriptor(&path),
                    }
                })
                .collect(),
            part_file,
            reopened_part_file,
        }
    }

    #[tokio::test]
    async fn coalesced_write_preserves_wanted_and_part_accounting() {
        let output = test_path("coalesced-write-accounting");
        clean(&output).await;
        let metainfo = fixture();
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[1]).expect("selection");
        let bytes = torrent_bytes(&metainfo);
        let mut storage = SelectiveStorage::create(
            output.clone(),
            test_artifact_identity(),
            &metainfo,
            layout,
            selection,
        )
        .await
        .expect("create selected storage");
        let checkpoint_handles = storage
            .checkpoint_handles()
            .await
            .expect("register checkpoint handles");
        assert!(
            checkpoint_handles[&DurabilityTarget::PartFile]
                .get()
                .is_none()
        );

        let planned = storage
            .write_stats(0, 0, metainfo.piece_length as usize)
            .expect("plan coalesced write");
        assert_eq!(planned.wanted_bytes, 20_000);
        assert_eq!(planned.skipped_bytes, 12_768);
        let actual = storage
            .write_block(0, 0, bytes[..metainfo.piece_length as usize].to_vec())
            .await
            .expect("write coalesced piece range");
        assert_eq!(actual, planned);
        assert!(
            checkpoint_handles[&DurabilityTarget::PartFile]
                .get()
                .is_some()
        );
        assert_eq!(
            storage.hash_piece(0).await.expect("hash coalesced piece"),
            <[u8; 20]>::from(Sha1::digest(&bytes[..metainfo.piece_length as usize]))
        );
        clean(&output).await;
    }

    #[tokio::test]
    async fn dynamic_platform_storage_is_lazy_and_verifies_direct_content() {
        let root = test_path("dynamic-platform");
        clean(&root).await;
        tokio::fs::create_dir_all(&root)
            .await
            .expect("create fake provider root");
        let (platform, broker) = platform_storage_channel();
        let pool = StorageFilePool::new(4, Some(platform)).expect("platform pool");
        let provider_root = root.clone();
        let provider = tokio::spawn(async move {
            while let Some(request) = broker.next_request().await {
                let path = request
                    .path
                    .iter()
                    .fold(provider_root.clone(), |path, component| {
                        path.join(component)
                    });
                if matches!(
                    request.operation,
                    crate::storage_file_pool::PlatformStorageOperation::Observe
                ) {
                    let observation = match std::fs::symlink_metadata(&path) {
                        Ok(metadata) => crate::StorageObservation::present(
                            if metadata.is_file() {
                                crate::StorageObjectKind::File
                            } else if metadata.is_dir() {
                                crate::StorageObjectKind::Directory
                            } else {
                                crate::StorageObjectKind::Other
                            },
                            metadata.is_file().then_some(metadata.len()),
                            None,
                        )
                        .expect("provider observation"),
                        Err(error) if error.kind() == io::ErrorKind::NotFound => {
                            crate::StorageObservation::missing()
                        }
                        Err(error) => {
                            broker.complete_error(
                                request.request_id,
                                crate::PlatformStorageFailure::new(
                                    crate::PlatformStorageFailureKind::ProviderRefused,
                                    error.to_string(),
                                ),
                            );
                            continue;
                        }
                    };
                    broker.complete_observation(request.request_id, observation);
                    continue;
                }
                if matches!(
                    request.operation,
                    crate::storage_file_pool::PlatformStorageOperation::Delete
                ) {
                    let result = match std::fs::remove_file(&path) {
                        Ok(()) => Ok(()),
                        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                        Err(error) => Err(error),
                    };
                    match result {
                        Ok(()) => {
                            broker.complete_deleted(request.request_id);
                        }
                        Err(error) => {
                            broker.complete_error(
                                request.request_id,
                                crate::storage_file_pool::PlatformStorageFailure::new(
                                    crate::storage_file_pool::PlatformStorageFailureKind::Internal,
                                    error.to_string(),
                                ),
                            );
                        }
                    }
                    continue;
                }
                assert_eq!(
                    request.operation,
                    crate::storage_file_pool::PlatformStorageOperation::Open
                );
                if matches!(request.access, StorageFileAccess::ReadWriteCreate) {
                    std::fs::create_dir_all(path.parent().expect("provider path parent"))
                        .expect("create provider parents");
                }
                let mut options = std::fs::OpenOptions::new();
                options
                    .read(true)
                    .write(!matches!(request.access, StorageFileAccess::ReadExisting));
                options.create(matches!(request.access, StorageFileAccess::ReadWriteCreate));
                match options.open(path) {
                    Ok(file) => {
                        broker.complete_file(request.request_id, file);
                    }
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {
                        broker.complete_error(
                            request.request_id,
                            crate::storage_file_pool::PlatformStorageFailure::new(
                                crate::storage_file_pool::PlatformStorageFailureKind::Missing,
                                "missing",
                            ),
                        );
                    }
                    Err(error) => {
                        broker.complete_error(
                            request.request_id,
                            crate::storage_file_pool::PlatformStorageFailure::new(
                                crate::storage_file_pool::PlatformStorageFailureKind::Internal,
                                error.to_string(),
                            ),
                        );
                    }
                }
            }
        });

        let metainfo = fixture();
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[1, 2]).expect("selection");
        let bytes = torrent_bytes(&metainfo);
        let spec = PlatformStorageSpec {
            pool: pool.clone(),
            root_id: "downloads".to_owned(),
            storage_id: storage_instance_id(test_torrent_id()),
            content_shape: ContentShape::from_metainfo(&metainfo),
            content_name: metainfo.name.clone(),
            storage_generation: 0,
        };
        let (mut storage, resumed) = SelectiveStorage::create_with_platform(
            spec.clone(),
            test_artifact_identity(),
            &metainfo,
            layout.clone(),
            selection,
            vec![false; layout.piece_count()],
        )
        .await
        .expect("create platform storage");
        assert_eq!(resumed, ResumedStorage::Created);
        assert!(
            std::fs::read_dir(&root)
                .expect("empty provider root")
                .next()
                .is_none()
        );
        assert_eq!(pool.snapshot().current_owned, 0);

        for piece_index in [0_u32, 2, 3, 4] {
            for request in layout
                .request_ranges(piece_index, &storage.selection)
                .expect("piece requests")
            {
                let offset =
                    piece_index as usize * layout.piece_length() as usize + request.begin as usize;
                storage
                    .write_block(
                        piece_index,
                        request.begin,
                        bytes[offset..offset + request.length as usize].to_vec(),
                    )
                    .await
                    .expect("write platform block");
            }
            let offset = piece_index as usize * layout.piece_length() as usize;
            let length = layout.piece_length_at(piece_index).expect("piece length") as usize;
            assert_eq!(
                storage
                    .hash_piece(piece_index)
                    .await
                    .expect("hash platform piece"),
                <[u8; 20]>::from(Sha1::digest(&bytes[offset..offset + length]))
            );
            storage
                .record_verified(piece_index as usize)
                .expect("record platform piece");
        }
        storage
            .finish_content()
            .await
            .expect("finish platform content");
        let mut committed = vec![false; layout.piece_count()];
        for piece_index in [0_usize, 2, 3, 4] {
            committed[piece_index] = true;
        }
        let validation = super::validate_direct_fast_resume_with_platform(
            spec.clone(),
            test_artifact_identity(),
            &metainfo,
            &committed,
            &[1, 2],
        )
        .await
        .expect("validate platform fast resume");
        assert_eq!(validation.evidence, ResumeStorageEvidence::Matches);
        assert_eq!(validation.payload_bytes_read, 0);
        assert_eq!(validation.hash_jobs, 0);
        let selected_path = root.join(&metainfo.name).join("wanted/start.bin");
        std::fs::OpenOptions::new()
            .write(true)
            .open(&selected_path)
            .expect("open platform selected file")
            .set_len(20_001)
            .expect("oversize platform selected file");
        let oversized = super::validate_direct_fast_resume_with_platform(
            spec.clone(),
            test_artifact_identity(),
            &metainfo,
            &committed,
            &[1, 2],
        )
        .await
        .expect("validate oversized platform resume");
        assert_eq!(
            oversized.evidence,
            ResumeStorageEvidence::ContentMismatch(
                ResumeValidationRejectReason::UnexpectedPayloadLength,
            )
        );
        std::fs::OpenOptions::new()
            .write(true)
            .open(selected_path)
            .expect("reopen platform selected file")
            .set_len(20_000)
            .expect("restore platform selected length");
        let resumed_selection = storage.selection.clone();
        drop(storage);
        let (mut resumed, resumed_state) = SelectiveStorage::create_with_platform(
            spec.clone(),
            test_artifact_identity(),
            &metainfo,
            layout.clone(),
            resumed_selection,
            vec![false; layout.piece_count()],
        )
        .await
        .expect("inventory direct platform completion with empty have");
        assert_eq!(resumed_state, ResumedStorage::Existing);
        for piece_index in [0_u32, 2, 3, 4] {
            assert!(
                resumed
                    .has_piece_sources(piece_index)
                    .await
                    .expect("inventory direct platform sources")
            );
            let offset = piece_index as usize * layout.piece_length() as usize;
            let length = layout.piece_length_at(piece_index).expect("piece length") as usize;
            assert_eq!(
                resumed
                    .hash_piece(piece_index)
                    .await
                    .expect("recheck direct platform piece"),
                <[u8; 20]>::from(Sha1::digest(&bytes[offset..offset + length]))
            );
        }
        assert!(pool.snapshot().owned_high_water <= 4);

        drop(resumed);
        drop(spec);

        // The Android provider route carries the same bounded completion
        // evidence and rejects a subsequent extent change before serving it.
        let mut oversized_meta = single_file_fixture();
        let oversized_bytes = vec![0x5a; oversized_meta.total_length as usize];
        oversized_meta.piece_hashes = oversized_bytes
            .chunks(oversized_meta.piece_length as usize)
            .map(|chunk| <[u8; 20]>::from(Sha1::digest(chunk)))
            .collect();
        let oversized_content = Arc::new(TorrentContent::from_v1_metainfo(oversized_meta.clone()));
        let oversized_path = root.join(&oversized_meta.name);
        tokio::fs::write(
            &oversized_path,
            [oversized_bytes.as_slice(), b"suffix"].concat(),
        )
        .await
        .unwrap();
        let oversized_identity = TorrentArtifactIdentity {
            torrent_id: TorrentId::new([0x62; 16]).unwrap(),
            content_fingerprint: test_artifact_identity().content_fingerprint,
        };
        let oversized_spec = PlatformStorageSpec {
            pool: pool.clone(),
            root_id: "downloads".to_owned(),
            storage_id: oversized_identity.torrent_id.to_string(),
            content_shape: ContentShape::File,
            content_name: oversized_meta.name.clone(),
            storage_generation: 0,
        };
        let (mut checked, _) = SelectiveStorage::create_content_with_platform(
            oversized_spec.clone(),
            oversized_identity,
            oversized_content.clone(),
            &[],
            vec![false; 2],
        )
        .await
        .unwrap();
        for piece in 0..2 {
            assert_eq!(
                checked.hash_piece(piece).await.unwrap(),
                oversized_meta.piece_hashes[piece as usize]
            );
            checked.record_verified(piece as usize).unwrap();
        }
        checked.finish_content().await.unwrap();
        let evidence = checked.completed_storage_evidence().await.unwrap().unwrap();
        assert_eq!(
            super::validate_direct_completed_content_with_platform(
                oversized_spec.clone(),
                oversized_identity,
                oversized_content.clone(),
                &[true; 2],
                &[],
                Some(&evidence),
            )
            .await
            .unwrap()
            .evidence,
            ResumeStorageEvidence::Matches
        );
        let seed = crate::SeedContent::open_completed_content_with_platform(
            &oversized_spec,
            &oversized_content,
            &[true; 2],
            &[],
            Some(&evidence),
        )
        .await
        .unwrap();
        assert_eq!(seed.availability(), vec![true; 2]);
        let request = BlockRequest {
            index: 0,
            begin: 0,
            length: 4,
        };
        assert_eq!(
            seed.read_block(request).await.unwrap(),
            oversized_bytes[..4]
        );
        tokio::fs::write(
            &oversized_path,
            [oversized_bytes.as_slice(), b"changed suffix"].concat(),
        )
        .await
        .unwrap();
        assert!(seed.read_block(request).await.is_err());
        assert_eq!(
            super::validate_direct_completed_content_with_platform(
                oversized_spec.clone(),
                oversized_identity,
                oversized_content,
                &[true; 2],
                &[],
                Some(&evidence),
            )
            .await
            .unwrap()
            .evidence,
            ResumeStorageEvidence::ContentMismatch(
                ResumeValidationRejectReason::UnexpectedPayloadLength
            )
        );
        drop(seed);
        drop(checked);
        pool.invalidate_storage(&oversized_spec.storage_id);
        drop(oversized_spec);

        let v2_skipped = vec![0x31; 9];
        let v2_selected = (0..40_000)
            .map(|index| (index % 251) as u8)
            .collect::<Vec<_>>();
        let v2_final = vec![0x5a; 17];
        let (v2_content, _) = pure_v2_content(
            &[(b"a", &v2_skipped), (b"b", &v2_selected), (b"c", &v2_final)],
            32 * 1024,
        );
        let v2_content = Arc::new(v2_content);
        let v2_torrent_id = TorrentId::new([0x61; 16]).expect("v2 platform owner");
        let v2_identity = TorrentArtifactIdentity {
            torrent_id: v2_torrent_id,
            content_fingerprint: ContentFingerprint::from_digest([0x62; 32]),
        };
        let v2_spec = PlatformStorageSpec {
            pool: pool.clone(),
            root_id: "downloads".to_owned(),
            storage_id: storage_instance_id(v2_torrent_id),
            content_shape: ContentShape::Tree,
            content_name: "root".to_owned(),
            storage_generation: 0,
        };
        let (mut v2_storage, v2_created) = SelectiveStorage::create_content_with_platform(
            v2_spec.clone(),
            v2_identity,
            v2_content.clone(),
            &[0],
            vec![false; 4],
        )
        .await
        .expect("create pure-v2 platform storage");
        assert_eq!(v2_created, ResumedStorage::Created);
        assert_eq!(v2_storage.part_slots(), 0);
        assert!(!v2_storage.has_part_file());
        for (piece, payload) in v2_selected.chunks(32 * 1024).enumerate() {
            let piece_index = u32::try_from(piece + 1).expect("v2 piece index");
            for (block, bytes) in payload.chunks(16 * 1024).enumerate() {
                v2_storage
                    .write_block(
                        piece_index,
                        u32::try_from(block * 16 * 1024).expect("v2 block begin"),
                        bytes.to_vec(),
                    )
                    .await
                    .expect("write v2 platform block");
            }
            assert!(matches!(
                v2_storage.hash_piece_content(piece_index).await,
                Ok(ComputedPieceHash::Sha256 { .. })
            ));
            v2_storage
                .record_verified(piece + 1)
                .expect("record v2 platform piece");
        }
        v2_storage
            .write_block(3, 0, v2_final.clone())
            .await
            .expect("write final v2 platform file");
        assert!(matches!(
            v2_storage.hash_piece_content(3).await,
            Ok(ComputedPieceHash::Sha256 { .. })
        ));
        v2_storage
            .record_verified(3)
            .expect("record final v2 platform piece");
        v2_storage
            .finish_content()
            .await
            .expect("finish v2 platform content");
        let v2_validation = super::validate_direct_fast_resume_content_with_platform(
            v2_spec,
            v2_identity,
            v2_content,
            &[false, true, true, true],
            &[0],
        )
        .await
        .expect("validate v2 platform fast resume");
        assert_eq!(v2_validation.evidence, ResumeStorageEvidence::Matches);
        assert_eq!(v2_validation.payload_bytes_read, 0);
        assert_eq!(std::fs::read(root.join("root/b")).unwrap(), v2_selected);
        assert_eq!(std::fs::read(root.join("root/c")).unwrap(), v2_final);
        assert!(!root.join("root/a").exists());
        assert!(pool.snapshot().owned_high_water <= 4);
        drop(v2_storage);

        std::fs::remove_dir_all(root.join("root")).expect("remove pure-v2 completion");
        let (hybrid_content, hybrid_integrity, hybrid_files) = hybrid_runtime_content();
        let hybrid_content = Arc::new(hybrid_content);
        let hybrid_layout =
            rstorrent_protocol::storage_layout::ContentLayout::from_content(&hybrid_content);
        for piece in 0..hybrid_layout.piece_count() as u32 {
            assert!(matches!(
                crate::driver::expected_piece_for_recheck(
                    &hybrid_content,
                    &hybrid_integrity,
                    piece,
                )
                .expect("hybrid recheck expectation"),
                Some(ExpectedPieceIntegrity::Hybrid { .. })
            ));
        }
        let hybrid_torrent_id = TorrentId::new([0x63; 16]).expect("hybrid platform owner");
        let hybrid_identity = TorrentArtifactIdentity {
            torrent_id: hybrid_torrent_id,
            content_fingerprint: ContentFingerprint::from_digest([0x64; 32]),
        };
        let hybrid_spec = PlatformStorageSpec {
            pool: pool.clone(),
            root_id: "downloads".to_owned(),
            storage_id: storage_instance_id(hybrid_torrent_id),
            content_shape: ContentShape::Tree,
            content_name: "root".to_owned(),
            storage_generation: 0,
        };
        let (mut hybrid_storage, hybrid_created) = SelectiveStorage::create_content_with_platform(
            hybrid_spec.clone(),
            hybrid_identity,
            hybrid_content.clone(),
            &[],
            vec![false; hybrid_layout.piece_count()],
        )
        .await
        .expect("create hybrid platform storage");
        assert_eq!(hybrid_created, ResumedStorage::Created);
        for (file_index, data) in hybrid_files.iter().enumerate() {
            let Some(range) = hybrid_layout
                .file_piece_range(file_index)
                .expect("hybrid file piece range")
            else {
                continue;
            };
            for (piece, payload) in range.zip(data.chunks(64 * 1024)) {
                for (block, bytes) in payload.chunks(16 * 1024).enumerate() {
                    hybrid_storage
                        .write_block(piece, (block * 16 * 1024) as u32, bytes.to_vec())
                        .await
                        .expect("write hybrid platform block");
                }
                let actual = hybrid_storage
                    .hash_piece_content(piece)
                    .await
                    .expect("hash staged hybrid platform piece");
                let expected = hybrid_content
                    .expected_piece(&hybrid_integrity, piece)
                    .expect("expected staged hybrid integrity");
                assert!(matches!(
                    (actual, expected),
                    (
                        ComputedPieceHash::Hybrid {
                            sha1,
                            sha256_root,
                            ..
                        },
                        ExpectedPieceIntegrity::Hybrid {
                            v1_sha1,
                            v2_expected_root,
                            ..
                        }
                    ) if sha1 == v1_sha1 && sha256_root == v2_expected_root
                ));
                hybrid_storage
                    .record_verified(piece as usize)
                    .expect("record staged hybrid platform piece");
            }
        }
        hybrid_storage
            .finish_content()
            .await
            .expect("finish hybrid platform content");
        drop(hybrid_storage);
        let (hybrid_reopened, hybrid_resumed) = SelectiveStorage::create_content_with_platform(
            hybrid_spec,
            hybrid_identity,
            hybrid_content.clone(),
            &[],
            vec![false; hybrid_layout.piece_count()],
        )
        .await
        .expect("reopen hybrid platform completion");
        assert_eq!(hybrid_resumed, ResumedStorage::Existing);
        for piece in 0..hybrid_layout.piece_count() as u32 {
            let actual = hybrid_reopened
                .hash_piece_content(piece)
                .await
                .expect("hash reopened hybrid platform piece");
            let expected = hybrid_content
                .expected_piece(&hybrid_integrity, piece)
                .expect("expected reopened hybrid integrity");
            assert!(matches!(
                (actual, expected),
                (
                    ComputedPieceHash::Hybrid {
                        sha1,
                        sha256_root,
                        ..
                    },
                    ExpectedPieceIntegrity::Hybrid {
                        v1_sha1,
                        v2_expected_root,
                        ..
                    }
                ) if sha1 == v1_sha1 && sha256_root == v2_expected_root
            ));
        }
        drop(hybrid_reopened);

        pool.shutdown().await.expect("shutdown pool");
        drop(pool);
        provider.await.expect("join fake provider");
        clean(&root).await;
    }

    #[tokio::test]
    async fn writes_hashes_and_reopens_direct_content() {
        let output = test_path("fixture");
        clean(&output).await;
        let metainfo = fixture();
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[1, 2]).expect("selection");
        let bytes = torrent_bytes(&metainfo);
        let paths = torrent_storage_paths_for_output_with_shape(
            output.clone(),
            test_torrent_id(),
            ContentShape::from_metainfo(&metainfo),
        )
        .expect("storage paths");
        let mut storage = SelectiveStorage::create(
            output.clone(),
            test_artifact_identity(),
            &metainfo,
            layout.clone(),
            selection,
        )
        .await
        .expect("create selected storage");

        assert_eq!(storage.selected_bytes(), 73_000);
        assert_eq!(storage.skipped_bytes(), 57_000);
        assert_eq!(storage.padding_bytes(), 3_304);
        assert!(!tokio::fs::try_exists(&output).await.expect("output state"));
        let content_root = paths.content;
        assert!(
            !tokio::fs::try_exists(&content_root)
                .await
                .expect("lazy content")
        );
        assert!(
            !tokio::fs::try_exists(content_root.join("skip/large.bin"))
                .await
                .expect("skipped content")
        );
        assert!(
            !tokio::fs::try_exists(content_root.join(".pad/3304"))
                .await
                .expect("padding content")
        );
        let part_path = paths.part;
        assert!(
            !tokio::fs::try_exists(&part_path)
                .await
                .expect("part remains lazy")
        );
        assert!(matches!(
            storage.finish_content().await,
            Err(SelectiveStorageError::IncompleteSelection { piece_index: 0 })
        ));
        assert!(!tokio::fs::try_exists(&output).await.expect("output state"));

        let mut wanted_written = 0;
        let mut skipped_written = 0;
        for piece_index in [0_u32, 2, 3, 4] {
            for request in layout
                .request_ranges(piece_index, &storage.selection)
                .expect("requests")
            {
                let torrent_offset =
                    piece_index as usize * layout.piece_length() as usize + request.begin as usize;
                let block =
                    bytes[torrent_offset..torrent_offset + request.length as usize].to_vec();
                let stats = storage
                    .write_block(piece_index, request.begin, block)
                    .await
                    .expect("write mapped block");
                wanted_written += stats.wanted_bytes;
                skipped_written += stats.skipped_bytes;
            }
            let piece_start = piece_index as usize * layout.piece_length() as usize;
            let piece_length = layout.piece_length_at(piece_index).expect("piece length") as usize;
            let expected: [u8; 20] =
                Sha1::digest(&bytes[piece_start..piece_start + piece_length]).into();
            let (actual, stats) = storage
                .hash_piece_with_stats(piece_index)
                .await
                .expect("mixed hash");
            assert_eq!(actual, expected);
            if piece_index == 0 {
                assert_eq!(stats.blocking_jobs, 1);
                assert_eq!(stats.wanted_file_duplicates, 0);
                assert_eq!(stats.wanted_file_seeks, 0);
                assert!(stats.part_file_reads > 0);
            }
            storage
                .record_verified(piece_index as usize)
                .expect("record verified");
        }
        assert!(
            tokio::fs::try_exists(&part_path)
                .await
                .expect("first skipped write created part")
        );
        assert_eq!(wanted_written, 73_000);
        assert_eq!(skipped_written, 24_232);
        assert_eq!(storage.part_slots(), 2);

        storage
            .finish_content()
            .await
            .expect("finish selected tree");
        assert!(
            tokio::fs::try_exists(output.join("wanted/empty.bin"))
                .await
                .expect("empty output")
        );
        assert!(
            !tokio::fs::try_exists(output.join("skip/large.bin"))
                .await
                .expect("skipped output")
        );
        assert!(
            !tokio::fs::try_exists(output.join(".pad/3304"))
                .await
                .expect("padding output")
        );

        storage.reopen_part_file().await.expect("reopen part file");
        assert!(
            tokio::fs::try_exists(&part_path)
                .await
                .expect("part exists")
        );
        clean(&output).await;
    }

    #[tokio::test]
    async fn resumes_direct_trees_without_trusting_geometry() {
        let root = test_path("resume");
        tokio::fs::create_dir(&root).await.expect("create root");
        let metainfo = fixture();
        let paths = torrent_storage_paths(&root, &metainfo.name, test_torrent_id())
            .expect("plan resumable storage paths");
        let output = paths.content.clone();
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[1, 2]).expect("selection");
        let bytes = torrent_bytes(&metainfo);
        let (mut storage, resumed) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            selection.clone(),
            vec![false; layout.piece_count()],
        )
        .await
        .expect("create resumable storage");
        assert_eq!(resumed, ResumedStorage::Created);
        assert!(!paths.content.exists());
        assert!(!paths.part.exists());
        for request in layout
            .request_ranges(0, &selection)
            .expect("first-piece requests")
        {
            let begin = request.begin as usize;
            storage
                .write_block(
                    0,
                    request.begin,
                    bytes[begin..begin + request.length as usize].to_vec(),
                )
                .await
                .expect("write first piece");
        }
        assert!(paths.part.exists());
        let expected_hash = storage.hash_piece(0).await.expect("hash first piece");
        storage.sync_piece(0).await.expect("sync first piece");
        storage.record_verified(0).expect("record first piece");
        drop(storage);

        let mut verified = vec![false; layout.piece_count()];
        verified[0] = true;
        let (mut storage, resumed) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            selection.clone(),
            verified.clone(),
        )
        .await
        .expect("resume direct content");
        assert_eq!(resumed, ResumedStorage::Existing);
        assert_eq!(
            storage.hash_piece(0).await.expect("recheck first piece"),
            expected_hash
        );
        for piece_index in [2_usize, 3, 4] {
            storage
                .record_verified(piece_index)
                .expect("complete selection");
        }
        drop(storage);

        let (storage, resumed) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            selection,
            verified,
        )
        .await
        .expect("resume direct content again");
        assert_eq!(resumed, ResumedStorage::Existing);
        assert!(paths.content.exists());
        drop(storage);

        let wanted = output.join("wanted/start.bin");
        let file = tokio::fs::OpenOptions::new()
            .write(true)
            .open(&wanted)
            .await
            .expect("open wanted file");
        file.set_len(1).await.expect("truncate wanted file");
        drop(file);
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[1, 2]).expect("selection");
        let (mut storage, resumed) = SelectiveStorage::resume_with_paths(
            paths,
            test_artifact_identity(),
            layout,
            selection,
            vec![false; 5],
        )
        .await
        .expect("inventory short direct file");
        assert_eq!(resumed, ResumedStorage::Existing);
        assert!(
            !storage
                .has_piece_sources(0)
                .await
                .expect("classify short source")
        );
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn direct_recheck_accepts_exact_data_and_preserves_oversize() {
        let root = test_path("direct-geometry");
        tokio::fs::create_dir(&root).await.expect("create root");
        let metainfo = single_file_fixture();
        let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
            .expect("plan direct paths");
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[]).expect("selection");
        let bytes = vec![0x5a; metainfo.total_length as usize];
        tokio::fs::write(&paths.content, &bytes)
            .await
            .expect("write exact direct file");
        let mut permissions = tokio::fs::metadata(&paths.content)
            .await
            .expect("read completion metadata")
            .permissions();
        permissions.set_readonly(true);
        tokio::fs::set_permissions(&paths.content, permissions)
            .await
            .expect("make completion read-only");

        let (mut exact, resumed) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            selection.clone(),
            vec![false; layout.piece_count()],
        )
        .await
        .expect("inventory read-only completion");
        assert_eq!(resumed, ResumedStorage::Existing);
        for piece_index in 0..layout.piece_count() {
            exact
                .hash_piece(u32::try_from(piece_index).expect("bounded piece"))
                .await
                .expect("hash read-only completion");
            exact
                .record_verified(piece_index)
                .expect("record checked piece");
        }
        exact
            .finish_content()
            .await
            .expect("finish exact read-only check without mutation");
        drop(exact);

        tokio::fs::remove_file(&paths.content)
            .await
            .expect("remove exact read-only fixture");
        let mut oversized = bytes.clone();
        oversized.extend_from_slice(b"ignored suffix");
        tokio::fs::write(&paths.content, &oversized)
            .await
            .expect("extend direct file");
        let (mut oversized, resumed) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            selection,
            vec![false; layout.piece_count()],
        )
        .await
        .expect("inventory oversized completion");
        assert_eq!(resumed, ResumedStorage::Existing);
        for piece_index in 0..layout.piece_count() {
            oversized
                .hash_piece(u32::try_from(piece_index).expect("bounded piece"))
                .await
                .expect("hash only declared bytes");
            oversized
                .record_verified(piece_index)
                .expect("record checked piece");
        }
        oversized
            .finish_content()
            .await
            .expect("finish oversized direct file without mutation");
        assert_eq!(
            tokio::fs::metadata(&paths.content)
                .await
                .expect("oversized metadata")
                .len(),
            u64::try_from(bytes.len() + b"ignored suffix".len()).expect("bounded fixture")
        );
        assert_eq!(
            tokio::fs::read(&paths.content)
                .await
                .expect("oversized bytes"),
            [bytes.as_slice(), b"ignored suffix"].concat()
        );
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn completed_extents_allow_only_the_verified_size_and_identity() {
        let root = test_path("completed-extents");
        tokio::fs::create_dir(&root).await.unwrap();
        let mut metainfo = single_file_fixture();
        let payload = vec![0x5a; metainfo.total_length as usize];
        metainfo.piece_hashes = payload
            .chunks(metainfo.piece_length as usize)
            .map(|chunk| <[u8; 20]>::from(Sha1::digest(chunk)))
            .collect();
        let content = Arc::new(TorrentContent::from_v1_metainfo(metainfo.clone()));
        let paths =
            torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id()).unwrap();
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[]).unwrap();
        tokio::fs::write(&paths.content, [payload.as_slice(), b"suffix"].concat())
            .await
            .unwrap();
        let (mut storage, resumed) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            selection,
            vec![false; layout.piece_count()],
        )
        .await
        .unwrap();
        storage.content = Some(content.clone());
        assert!(
            storage
                .completed_storage_evidence()
                .await
                .unwrap()
                .is_none()
        );
        for piece in 0..layout.piece_count() {
            let hash = storage.hash_piece(piece as u32).await.unwrap();
            assert_eq!(hash, metainfo.piece_hashes[piece]);
            storage.record_verified(piece).unwrap();
        }
        storage.finish_content().await.unwrap();
        let evidence = storage.completed_storage_evidence().await.unwrap().unwrap();
        assert_eq!(
            storage
                .validate_fast_resume(resumed)
                .await
                .unwrap()
                .evidence,
            ResumeStorageEvidence::ContentMismatch(
                ResumeValidationRejectReason::UnexpectedPayloadLength
            )
        );
        assert_eq!(
            storage
                .validate_resume_extents(resumed, Some(&evidence))
                .await
                .unwrap()
                .evidence,
            ResumeStorageEvidence::Matches
        );
        let pool = StorageFilePool::new(DEFAULT_STORAGE_FILE_LIMIT, None).unwrap();
        let seed = crate::SeedContent::open_completed_content_with_pool(
            &root,
            test_torrent_id(),
            &content,
            &vec![true; layout.piece_count()],
            &[],
            pool.clone(),
            Some(&evidence),
        )
        .await
        .unwrap();
        let request = BlockRequest {
            index: 0,
            begin: 0,
            length: 4,
        };
        assert_eq!(seed.read_block(request).await.unwrap(), payload[..4]);
        let invalid = BlockRequest {
            index: 0,
            begin: metainfo.total_length as u32,
            length: 1,
        };
        assert!(seed.read_block(invalid).await.is_err());
        assert!(
            crate::SeedContent::open_completed_content_with_pool(
                &root,
                TorrentId::new([0x99; 16]).unwrap(),
                &content,
                &vec![true; layout.piece_count()],
                &[],
                pool.clone(),
                Some(&evidence),
            )
            .await
            .is_err()
        );
        let mut wrong = test_artifact_identity();
        wrong.content_fingerprint = ContentFingerprint::from_digest([0x99; 32]);
        assert!(
            super::validate_direct_completed_content_with_path(
                &root,
                wrong,
                content.clone(),
                &vec![true; layout.piece_count()],
                &[],
                pool.clone(),
                Some(&evidence),
            )
            .await
            .is_err()
        );
        tokio::fs::write(
            &paths.content,
            [payload.as_slice(), b"longer suffix"].concat(),
        )
        .await
        .unwrap();
        assert!(seed.read_block(request).await.is_err());
        assert_eq!(
            storage
                .validate_resume_extents(resumed, Some(&evidence))
                .await
                .unwrap()
                .evidence,
            ResumeStorageEvidence::ContentMismatch(
                ResumeValidationRejectReason::UnexpectedPayloadLength
            )
        );
        assert!(
            crate::SeedContent::open_completed_content_with_pool(
                &root,
                test_torrent_id(),
                &content,
                &vec![true; layout.piece_count()],
                &[],
                pool,
                Some(&evidence),
            )
            .await
            .unwrap()
            .availability()
            .iter()
            .all(|available| !available)
        );
        let control = crate::DownloadControl::default();
        control.set_completed_storage_evidence(Some(evidence));
        control.cancel();
        assert!(control.take_completed_storage_evidence().is_none());
        drop(seed);
        drop(storage);
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn fast_resume_accepts_exact_and_same_length_mutated_path_content() {
        let root = test_path("fast-resume-exact");
        tokio::fs::create_dir(&root).await.expect("create root");
        let metainfo = single_file_fixture();
        let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
            .expect("plan direct paths");
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[]).expect("selection");
        tokio::fs::write(&paths.content, vec![0x41; metainfo.total_length as usize])
            .await
            .expect("write exact completion");

        for byte in [0x41, 0x92] {
            tokio::fs::write(&paths.content, vec![byte; metainfo.total_length as usize])
                .await
                .expect("write same-length completion");
            let (mut storage, resumed) = SelectiveStorage::resume_with_paths(
                paths.clone(),
                test_artifact_identity(),
                layout.clone(),
                selection.clone(),
                vec![true; layout.piece_count()],
            )
            .await
            .expect("inventory exact completion");
            let validation = storage
                .validate_fast_resume(resumed)
                .await
                .expect("validate exact completion");
            assert_eq!(validation.evidence, ResumeStorageEvidence::Matches);
            assert_eq!(validation.committed_pieces, layout.piece_count());
            assert_eq!(validation.relevant_files, 1);
            assert_eq!(validation.artifact_observations, 1);
            assert_eq!(validation.payload_bytes_read, 0);
            assert_eq!(validation.hash_jobs, 0);
        }
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn fast_resume_sends_oversized_path_content_to_full_check() {
        let root = test_path("fast-resume-oversized");
        tokio::fs::create_dir(&root).await.expect("create root");
        let metainfo = single_file_fixture();
        let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
            .expect("plan direct paths");
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[]).expect("selection");
        tokio::fs::write(
            &paths.content,
            vec![0x51; metainfo.total_length as usize + 1],
        )
        .await
        .expect("write oversized completion");
        let (mut storage, resumed) = SelectiveStorage::resume_with_paths(
            paths,
            test_artifact_identity(),
            layout.clone(),
            selection,
            vec![true; layout.piece_count()],
        )
        .await
        .expect("inventory oversized completion");
        assert_eq!(
            storage
                .validate_fast_resume(resumed)
                .await
                .expect("validate oversized completion")
                .evidence,
            ResumeStorageEvidence::ContentMismatch(
                ResumeValidationRejectReason::UnexpectedPayloadLength,
            ),
        );
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn fast_resume_validates_part_slot_extent_without_reading_payload() {
        let root = test_path("fast-resume-part-extent");
        tokio::fs::create_dir(&root).await.expect("create root");
        let metainfo = fixture();
        let paths = torrent_storage_paths(&root, &metainfo.name, test_torrent_id())
            .expect("plan storage paths");
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[1, 2]).expect("selection");
        let bytes = torrent_bytes(&metainfo);
        let (mut storage, _) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            selection.clone(),
            vec![false; layout.piece_count()],
        )
        .await
        .expect("create storage");
        for request in layout.request_ranges(0, &selection).expect("requests") {
            let begin = request.begin as usize;
            storage
                .write_block(
                    0,
                    request.begin,
                    bytes[begin..begin + request.length as usize].to_vec(),
                )
                .await
                .expect("write boundary piece");
        }
        storage.sync_piece(0).await.expect("sync boundary piece");
        storage.record_verified(0).expect("record boundary piece");
        drop(storage);

        let mut committed = vec![false; layout.piece_count()];
        committed[0] = true;
        let (mut exact, resumed) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            selection.clone(),
            committed.clone(),
        )
        .await
        .expect("resume exact part slot");
        let validation = exact
            .validate_fast_resume(resumed)
            .await
            .expect("validate exact part slot");
        assert_eq!(validation.evidence, ResumeStorageEvidence::Matches);
        assert!(validation.part_header_bytes > 0);
        assert_eq!(validation.payload_bytes_read, 0);
        assert_eq!(validation.hash_jobs, 0);
        drop(exact);

        let part_length = tokio::fs::metadata(&paths.part)
            .await
            .expect("part metadata")
            .len();
        let part = tokio::fs::OpenOptions::new()
            .write(true)
            .open(&paths.part)
            .await
            .expect("open part for truncation");
        part.set_len(part_length - 1)
            .await
            .expect("truncate part payload");
        drop(part);
        let (mut truncated, resumed) = SelectiveStorage::resume_with_paths(
            paths,
            test_artifact_identity(),
            layout,
            selection,
            committed,
        )
        .await
        .expect("inventory truncated part slot");
        assert_eq!(
            truncated
                .validate_fast_resume(resumed)
                .await
                .expect("validate truncated part slot")
                .evidence,
            ResumeStorageEvidence::ContentMismatch(ResumeValidationRejectReason::TruncatedPartSlot,),
        );
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn resumed_recheck_drops_cached_handles_before_observing_replacement() {
        let root = test_path("direct-replaced-handle");
        tokio::fs::create_dir(&root).await.expect("create root");
        let metainfo = single_file_fixture();
        let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
            .expect("plan direct paths");
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[]).expect("selection");
        let pool = StorageFilePool::new(4, None).expect("file pool");
        let original = vec![0x31; metainfo.total_length as usize];
        let replacement = vec![0x72; metainfo.total_length as usize];
        tokio::fs::write(&paths.content, &original)
            .await
            .expect("write original completion");

        let (mut first, _) = SelectiveStorage::resume_with_paths_and_pool(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            selection.clone(),
            vec![false; layout.piece_count()],
            pool.clone(),
        )
        .await
        .expect("open first generation");
        let first_hash = first.hash_piece(0).await.expect("hash original generation");
        drop(first);

        tokio::fs::remove_file(&paths.content)
            .await
            .expect("unlink original completion");
        tokio::fs::write(&paths.content, &replacement)
            .await
            .expect("write replacement completion");
        let (mut second, _) = SelectiveStorage::resume_with_paths_and_pool(
            paths,
            test_artifact_identity(),
            layout.clone(),
            selection,
            vec![false; layout.piece_count()],
            pool.clone(),
        )
        .await
        .expect("open replacement generation");
        let second_hash = second
            .hash_piece(0)
            .await
            .expect("hash replacement generation");

        assert_ne!(first_hash, second_hash);
        assert_eq!(
            second_hash,
            <[u8; 20]>::from(Sha1::digest(&replacement[..layout.piece_length() as usize]))
        );
        drop(second);
        pool.shutdown().await.expect("shutdown pool");
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn resume_defers_part_promotion_until_recheck_reconciliation() {
        let root = test_path("resume-promote");
        tokio::fs::create_dir(&root).await.expect("create root");
        let metainfo = fixture();
        let paths = torrent_storage_paths(&root, &metainfo.name, test_torrent_id())
            .expect("plan storage paths");
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let skipped = FileSelection::new(&layout, &[1, 2]).expect("initial selection");
        let bytes = torrent_bytes(&metainfo);
        let (mut storage, _) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            skipped.clone(),
            vec![false; layout.piece_count()],
        )
        .await
        .expect("create initial storage");
        for request in layout.request_ranges(0, &skipped).expect("piece requests") {
            let begin = request.begin as usize;
            storage
                .write_block(
                    0,
                    request.begin,
                    bytes[begin..begin + request.length as usize].to_vec(),
                )
                .await
                .expect("write boundary piece");
        }
        storage.record_verified(0).expect("record verified piece");
        storage.sync_piece(0).await.expect("sync verified piece");
        assert!(paths.part.exists());
        drop(storage);

        let promoted = FileSelection::new(&layout, &[2]).expect("promoted selection");
        let mut verified = vec![false; layout.piece_count()];
        verified[0] = true;
        let (mut storage, resumed) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout,
            promoted,
            verified,
        )
        .await
        .expect("resume promoted storage");
        assert_eq!(resumed, ResumedStorage::Existing);
        assert!(!paths.content.join("skip/large.bin").exists());
        assert_eq!(
            storage.hash_piece(0).await.expect("hash promoted piece"),
            <[u8; 20]>::from(Sha1::digest(&bytes[..metainfo.piece_length as usize]))
        );
        storage
            .reconcile_after_recheck()
            .await
            .expect("promote only after recheck");
        assert_eq!(
            tokio::fs::read(paths.content.join("skip/large.bin"))
                .await
                .expect("read promoted file")[..12_768],
            bytes[20_000..32_768]
        );
        assert!(!paths.part.exists());
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn resume_reconciliation_keeps_new_boundary_writes_on_wanted_routes() {
        let root = test_path("resume-new-boundary-route");
        tokio::fs::create_dir(&root).await.expect("create root");
        let metainfo = fixture();
        let paths = torrent_storage_paths(&root, &metainfo.name, test_torrent_id())
            .expect("plan storage paths");
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[1, 2]).expect("selection");
        let bytes = torrent_bytes(&metainfo);
        let (mut storage, _) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            selection.clone(),
            vec![false; layout.piece_count()],
        )
        .await
        .expect("create initial storage");
        for request in layout
            .request_ranges(0, &selection)
            .expect("piece requests")
        {
            let begin = request.begin as usize;
            storage
                .write_block(
                    0,
                    request.begin,
                    bytes[begin..begin + request.length as usize].to_vec(),
                )
                .await
                .expect("write retained boundary piece");
        }
        storage.record_verified(0).expect("record retained piece");
        storage.sync_piece(0).await.expect("sync retained piece");
        drop(storage);

        let mut committed = vec![false; layout.piece_count()];
        committed[0] = true;
        let (mut storage, resumed) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            selection.clone(),
            committed,
        )
        .await
        .expect("resume partial storage");
        assert_eq!(
            storage
                .validate_fast_resume(resumed)
                .await
                .expect("validate partial resume")
                .evidence,
            ResumeStorageEvidence::Matches
        );
        storage
            .reconcile_after_recheck()
            .await
            .expect("reconcile accepted resume routes");

        let piece = 2_u32;
        let piece_offset = piece as usize * metainfo.piece_length as usize;
        for request in layout
            .request_ranges(piece, &selection)
            .expect("new boundary requests")
        {
            let begin = request.begin as usize;
            storage
                .write_block(
                    piece,
                    request.begin,
                    bytes[piece_offset + begin..piece_offset + begin + request.length as usize]
                        .to_vec(),
                )
                .await
                .expect("write new boundary piece");
        }
        let length = layout.piece_length_at(piece).expect("piece length") as usize;
        assert_eq!(
            storage
                .hash_piece(piece)
                .await
                .expect("hash new boundary piece"),
            <[u8; 20]>::from(Sha1::digest(&bytes[piece_offset..piece_offset + length]))
        );

        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn resume_keeps_existing_file_route_when_it_becomes_skipped() {
        let root = test_path("resume-retain-skipped");
        tokio::fs::create_dir(&root).await.expect("create root");
        let metainfo = fixture();
        let paths = torrent_storage_paths(&root, &metainfo.name, test_torrent_id())
            .expect("plan storage paths");
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let all_wanted = FileSelection::new(&layout, &[]).expect("initial selection");
        let bytes = torrent_bytes(&metainfo);
        let (mut storage, _) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            all_wanted.clone(),
            vec![false; layout.piece_count()],
        )
        .await
        .expect("create all-wanted storage");
        for request in layout
            .request_ranges(0, &all_wanted)
            .expect("piece requests")
        {
            let begin = request.begin as usize;
            storage
                .write_block(
                    0,
                    request.begin,
                    bytes[begin..begin + request.length as usize].to_vec(),
                )
                .await
                .expect("write wanted piece");
        }
        storage.record_verified(0).expect("record verified piece");
        storage.sync_piece(0).await.expect("sync verified piece");
        drop(storage);

        let lowered = FileSelection::new(&layout, &[1]).expect("lowered selection");
        let mut verified = vec![false; layout.piece_count()];
        verified[0] = true;
        let (mut storage, resumed) = SelectiveStorage::resume_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout,
            lowered,
            verified,
        )
        .await
        .expect("resume lowered storage");
        assert_eq!(resumed, ResumedStorage::Existing);
        assert!(storage.has_piece_sources(0).await.expect("piece sources"));
        assert_eq!(
            storage.hash_piece(0).await.expect("hash retained route"),
            <[u8; 20]>::from(Sha1::digest(&bytes[..metainfo.piece_length as usize]))
        );
        assert_eq!(
            storage
                .write_stats(0, 0, metainfo.piece_length as usize)
                .expect("retained route stats"),
            SelectiveWriteStats {
                wanted_bytes: 20_000,
                skipped_bytes: metainfo.piece_length as usize - 20_000,
            }
        );
        assert!(!paths.part.exists());
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn live_selection_reconcile_promotes_and_demotes_without_losing_verification() {
        let root = test_path("live-selection-reconcile");
        tokio::fs::create_dir(&root).await.expect("create root");
        let metainfo = fixture();
        let paths = torrent_storage_paths(&root, &metainfo.name, test_torrent_id())
            .expect("plan storage paths");
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let skipped = FileSelection::new(&layout, &[1]).expect("initial selection");
        let bytes = torrent_bytes(&metainfo);
        let mut storage = SelectiveStorage::create_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            skipped.clone(),
        )
        .await
        .expect("create selective storage");
        for request in layout.request_ranges(0, &skipped).expect("piece requests") {
            let begin = request.begin as usize;
            storage
                .write_block(
                    0,
                    request.begin,
                    bytes[begin..begin + request.length as usize].to_vec(),
                )
                .await
                .expect("write boundary piece");
        }
        storage.record_verified(0).expect("record verified piece");
        storage.sync_piece(0).await.expect("sync verified piece");
        assert!(paths.part.exists());

        let all_wanted = FileSelection::new(&layout, &[]).expect("promoted selection");
        let promoted = storage
            .reconcile_selection(all_wanted)
            .await
            .expect("promote skipped file");
        assert_eq!(promoted.route_epoch, 1);
        assert_eq!(promoted.promoted_files, vec![1]);
        assert!(promoted.demoted_files.is_empty());
        assert!(promoted.invalidated_pieces.is_empty());
        assert!(storage.verified_pieces()[0]);
        assert_eq!(
            tokio::fs::read(paths.content.join("skip/large.bin"))
                .await
                .expect("read promoted file")[..12_768],
            bytes[20_000..32_768]
        );
        assert!(!paths.part.exists());

        let skipped_again = FileSelection::new(&layout, &[1]).expect("demoted selection");
        let demoted = storage
            .reconcile_selection(skipped_again)
            .await
            .expect("demote promoted file");
        assert_eq!(demoted.route_epoch, 2);
        assert!(demoted.promoted_files.is_empty());
        assert_eq!(demoted.demoted_files, vec![1]);
        assert!(storage.verified_pieces()[0]);
        assert_eq!(
            storage.hash_piece(0).await.expect("hash retained route"),
            <[u8; 20]>::from(Sha1::digest(&bytes[..metainfo.piece_length as usize]))
        );
        assert_eq!(storage.route_epoch(), 2);

        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn promotion_clears_only_piece_evidence_with_a_missing_part_span() {
        let root = test_path("live-selection-missing-span");
        tokio::fs::create_dir(&root).await.expect("create root");
        let metainfo = fixture();
        let paths = torrent_storage_paths(&root, &metainfo.name, test_torrent_id())
            .expect("plan storage paths");
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let skipped = FileSelection::new(&layout, &[1]).expect("initial selection");
        let bytes = torrent_bytes(&metainfo);
        let mut storage = SelectiveStorage::create_with_paths(
            paths.clone(),
            test_artifact_identity(),
            layout.clone(),
            skipped.clone(),
        )
        .await
        .expect("create selective storage");
        for request in layout.request_ranges(0, &skipped).expect("piece requests") {
            let begin = request.begin as usize;
            storage
                .write_block(
                    0,
                    request.begin,
                    bytes[begin..begin + request.length as usize].to_vec(),
                )
                .await
                .expect("write boundary piece");
        }
        storage.record_verified(0).expect("record verified piece");
        storage.sync_piece(0).await.expect("sync verified piece");
        storage
            .part_file
            .as_mut()
            .expect("boundary piece owns a part slot")
            .release_piece(0)
            .await
            .expect("simulate missing part span");

        let all_wanted = FileSelection::new(&layout, &[]).expect("promoted selection");
        let promoted = storage
            .reconcile_selection(all_wanted)
            .await
            .expect("promote with missing part span");

        assert_eq!(promoted.route_epoch, 1);
        assert_eq!(promoted.invalidated_pieces, vec![0]);
        assert!(!storage.verified_pieces()[0]);
        assert_eq!(
            tokio::fs::read(paths.content.join("skip/large.bin"))
                .await
                .expect("read uncertain promoted file"),
            vec![0; metainfo.files[1].length as usize]
        );
        tokio::fs::remove_dir_all(root).await.expect("remove root");
    }

    #[tokio::test]
    async fn descriptor_storage_reuses_mapping_and_reopens_part_file() {
        let root = test_path("descriptors");
        tokio::fs::create_dir(&root)
            .await
            .expect("create descriptor root");
        let metainfo = fixture();
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[1, 2]).expect("selection");
        let bytes = torrent_bytes(&metainfo);
        let wanted_paths: Vec<_> = [0_usize, 3, 4, 6]
            .into_iter()
            .map(|file_index| {
                let path = root.join(format!("wanted-{file_index}"));
                (file_index, path.clone(), new_descriptor(&path))
            })
            .collect();
        let part_path = root.join("part");
        let part_file = new_descriptor(&part_path);
        let reopened_part_file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&part_path)
            .expect("open independent part descriptor");
        let descriptors = DescriptorStorage {
            wanted_files: wanted_paths
                .into_iter()
                .map(|(file_index, _, file)| DescriptorFile { file_index, file })
                .collect(),
            part_file,
            reopened_part_file,
        };
        let mut storage = SelectiveStorage::create_with_descriptors(
            test_artifact_identity(),
            &metainfo,
            layout.clone(),
            selection,
            descriptors,
        )
        .await
        .expect("create descriptor storage");
        assert_eq!(storage.part_path(), None);

        for piece_index in [0_u32, 2, 3, 4] {
            for request in layout
                .request_ranges(piece_index, &storage.selection)
                .expect("descriptor requests")
            {
                let torrent_offset =
                    piece_index as usize * layout.piece_length() as usize + request.begin as usize;
                storage
                    .write_block(
                        piece_index,
                        request.begin,
                        bytes[torrent_offset..torrent_offset + request.length as usize].to_vec(),
                    )
                    .await
                    .expect("write descriptor block");
            }
            let piece_start = piece_index as usize * layout.piece_length() as usize;
            let piece_length = layout.piece_length_at(piece_index).expect("piece length") as usize;
            let expected: [u8; 20] =
                Sha1::digest(&bytes[piece_start..piece_start + piece_length]).into();
            assert_eq!(
                storage
                    .hash_piece(piece_index)
                    .await
                    .expect("descriptor mixed hash"),
                expected
            );
            storage
                .record_verified(piece_index as usize)
                .expect("record descriptor verification");
        }

        storage
            .finish_content()
            .await
            .expect("sync descriptor storage");
        storage
            .reopen_part_file()
            .await
            .expect("reopen descriptor part file");
        drop(storage);

        for file_index in [0_usize, 3, 4, 6] {
            let path = root.join(format!("wanted-{file_index}"));
            let file = &metainfo.files[file_index];
            assert_eq!(
                std::fs::read(path).expect("read wanted descriptor output"),
                bytes[file.offset as usize..(file.offset + file.length) as usize]
            );
        }
        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove descriptor root");
    }

    #[tokio::test]
    async fn resumes_direct_content_descriptors() {
        let root = test_path("descriptor-resume");
        tokio::fs::create_dir(&root)
            .await
            .expect("create descriptor root");
        let metainfo = fixture();
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[1, 2]).expect("selection");
        let bytes = torrent_bytes(&metainfo);
        let descriptors = descriptor_manifest(&root, &[0, 3, 4, 6]);
        let mut storage = SelectiveStorage::create_with_descriptors(
            test_artifact_identity(),
            &metainfo,
            layout.clone(),
            selection.clone(),
            descriptors,
        )
        .await
        .expect("create descriptor storage");
        for request in layout
            .request_ranges(0, &selection)
            .expect("piece requests")
        {
            let offset = request.begin as usize;
            storage
                .write_block(
                    0,
                    request.begin,
                    bytes[offset..offset + request.length as usize].to_vec(),
                )
                .await
                .expect("write descriptor block");
        }
        storage.record_verified(0).expect("record first piece");
        storage.sync_piece(0).await.expect("sync first piece");
        drop(storage);

        let reopen = |path: &Path| {
            std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(path)
                .expect("reopen descriptor")
        };
        let part_path = root.join("part");
        let descriptors = DescriptorStorage {
            wanted_files: [0_usize, 3, 4, 6]
                .into_iter()
                .map(|file_index| DescriptorFile {
                    file_index,
                    file: reopen(&root.join(format!("wanted-{file_index}"))),
                })
                .collect(),
            part_file: reopen(&part_path),
            reopened_part_file: reopen(&part_path),
        };
        let mut verified = vec![false; layout.piece_count()];
        verified[0] = true;
        let mut resumed = SelectiveStorage::resume_with_descriptors(
            test_artifact_identity(),
            &metainfo,
            layout,
            selection,
            descriptors,
            verified,
        )
        .await
        .expect("resume descriptor storage");
        let expected_piece: [u8; 20] = Sha1::digest(&bytes[..32_768]).into();
        assert_eq!(
            resumed.hash_piece(0).await.expect("hash resumed piece"),
            expected_piece
        );
        drop(resumed);
        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove descriptor root");
    }

    #[test]
    fn descriptor_manifest_rejects_duplicate_and_out_of_range_indices() {
        let first_path = test_path("manifest-first");
        let second_path = test_path("manifest-second");
        let duplicate = collect_descriptors(
            2,
            "wanted",
            vec![
                DescriptorFile {
                    file_index: 1,
                    file: new_descriptor(&first_path),
                },
                DescriptorFile {
                    file_index: 1,
                    file: new_descriptor(&second_path),
                },
            ],
        );
        assert!(matches!(
            duplicate,
            Err(SelectiveStorageError::InvalidDescriptorManifest {
                role: "wanted",
                file_index: 1,
                reason: "file index is duplicated",
            })
        ));
        std::fs::remove_file(first_path).expect("remove first manifest file");
        std::fs::remove_file(second_path).expect("remove second manifest file");

        let range_path = test_path("wanted-manifest-range");
        let out_of_range = collect_descriptors(
            2,
            "wanted",
            vec![DescriptorFile {
                file_index: 2,
                file: new_descriptor(&range_path),
            }],
        );
        assert!(matches!(
            out_of_range,
            Err(SelectiveStorageError::InvalidDescriptorManifest {
                role: "wanted",
                file_index: 2,
                reason: "file index is out of range",
            })
        ));
        std::fs::remove_file(range_path).expect("remove range manifest file");
    }

    #[tokio::test]
    async fn descriptor_manifest_rejects_missing_unexpected_and_nonempty_files() {
        let metainfo = fixture();
        let cases = [
            ("missing-wanted", vec![3, 4, 6], false),
            ("unexpected-wanted", vec![0, 1, 3, 4, 6], false),
            ("nonempty-wanted", vec![0, 3, 4, 6], true),
        ];
        for (name, wanted, make_nonempty) in cases {
            let root = test_path(name);
            tokio::fs::create_dir(&root)
                .await
                .expect("create manifest case root");
            let descriptors = descriptor_manifest(&root, &wanted);
            if make_nonempty {
                std::fs::write(root.join("wanted-0"), b"preserve")
                    .expect("make wanted descriptor nonempty");
            }
            let layout = TorrentLayout::from_metainfo(&metainfo);
            let selection = FileSelection::new(&layout, &[1, 2]).expect("selection");
            let result = SelectiveStorage::create_with_descriptors(
                test_artifact_identity(),
                &metainfo,
                layout,
                selection,
                descriptors,
            )
            .await;
            match name {
                "missing-wanted" => assert!(matches!(
                    result,
                    Err(SelectiveStorageError::InvalidDescriptorManifest {
                        role: "wanted",
                        file_index: 0,
                        reason: "required descriptor is missing",
                    })
                )),
                "unexpected-wanted" => assert!(matches!(
                    result,
                    Err(SelectiveStorageError::InvalidDescriptorManifest {
                        role: "wanted",
                        file_index: 1,
                        reason: "descriptor is not expected by the selection",
                    })
                )),
                "nonempty-wanted" => {
                    assert!(matches!(
                        result,
                        Err(SelectiveStorageError::NonemptyDescriptor {
                            role: "wanted",
                            file_index: 0,
                            length: 8,
                        })
                    ));
                    assert_eq!(
                        std::fs::read(root.join("wanted-0"))
                            .expect("read preserved nonempty descriptor"),
                        b"preserve"
                    );
                }
                _ => unreachable!("all manifest cases are enumerated"),
            }
            tokio::fs::remove_dir_all(root)
                .await
                .expect("remove manifest case root");
        }
    }

    #[tokio::test]
    async fn refuses_and_preserves_a_preexisting_part_file() {
        let output = test_path("existing");
        clean(&output).await;
        let metainfo = fixture();
        let layout = TorrentLayout::from_metainfo(&metainfo);
        let selection = FileSelection::new(&layout, &[1, 2]).expect("selection");
        let paths = torrent_storage_paths_for_output_with_shape(
            output.clone(),
            test_torrent_id(),
            ContentShape::from_metainfo(&metainfo),
        )
        .expect("storage paths");

        let part = paths.part;
        tokio::fs::write(&part, b"owned elsewhere")
            .await
            .expect("create existing part");
        assert!(matches!(
            SelectiveStorage::create(
                output.clone(),
                test_artifact_identity(),
                &metainfo,
                layout,
                selection
            )
            .await,
            Err(SelectiveStorageError::ExistingPartFile(_))
        ));
        assert_eq!(
            tokio::fs::read(&part).await.expect("preserved part"),
            b"owned elsewhere"
        );
        clean(&output).await;
    }
}
