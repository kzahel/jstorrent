//! PlaysVideo download manifests (Tactical 391).
//!
//! Legacy JSTorrent wrote `.<v1 info hash>.jstorrent.json` beside each
//! download. PlaysVideo reads that sidecar to learn a file's magnet, info hash
//! and metainfo file index, so a video started on one device can be
//! downloaded and resumed on another. This module owns the frozen file
//! contract, a pure body builder, and the single best-effort writer task.
//!
//! The writer never changes torrent state: every failure is a bounded
//! diagnostic, and startup reconciliation recreates anything missed.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rstorrent_engine::{
    ContentShape, DirectContentLayout, PlatformStorageFailureKind, PlatformStorageTarget,
    StorageFileAccess, StorageFileKey, StorageFileLocator, StorageFilePool, StorageFilePoolError,
    StorageFileReference, StorageFileRole, StorageObjectKind, validate_content_name,
};
use rstorrent_protocol::content::TorrentContent;
use rstorrent_protocol::identity::InfoHashes;
use rstorrent_protocol::storage_layout::ContentLayout;
use serde::Serialize;
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::control::TorrentState;
use crate::diagnostics::{DiagnosticSeverity, category};
use crate::store::{SessionStore, StorageRootLocation, StoreError};
use crate::views::ViewHub;

/// Bodies listing more non-padding files than this are not written.
pub(crate) const MAX_MANIFEST_FILES: usize = 10_000;
/// Minimum time between two writes of one torrent's sidecar.
pub(crate) const MANIFEST_WRITE_INTERVAL: Duration = Duration::from_secs(2);
/// A failed write is retried once after this long, then at the next mark.
pub(crate) const MANIFEST_RETRY_DELAY: Duration = Duration::from_secs(30);
/// Shutdown drains pending writes for at most this long.
pub(crate) const MANIFEST_SHUTDOWN_BUDGET: Duration = Duration::from_secs(2);
/// Existing sidecars larger than this are never read back for comparison.
const MAX_COMPARED_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;

/// The sidecar name PlaysVideo matches: `.<40 lowercase hex>.jstorrent.json`.
pub(crate) fn manifest_file_name(info_hashes: InfoHashes) -> Option<String> {
    info_hashes
        .v1_hash()
        .map(|hash| format!(".{hash}.jstorrent.json"))
}

/// The temporary name a path-root write renames over the sidecar.
pub(crate) fn manifest_temp_name(file_name: &str) -> String {
    format!("{file_name}.tmp")
}

/// Everything the body depends on, read from the durable record.
pub(crate) struct ManifestInput<'a> {
    pub content: &'a TorrentContent,
    pub info_hashes: InfoHashes,
    pub magnet: &'a str,
    pub have: Option<&'a [bool]>,
    pub skip_files: &'a [u32],
    pub state: TorrentState,
    pub verification_pending: bool,
}

/// A rendered sidecar and where it belongs relative to the storage root.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ManifestBody {
    /// `.<hash>.jstorrent.json`.
    pub file_name: String,
    /// `Some(content name)` when the sidecar lives inside the content
    /// directory of a multi-file torrent; `None` beside a single file.
    pub directory: Option<String>,
    /// The root-relative payload name: the single file or the content
    /// directory. The sidecar waits until it exists.
    pub content_name: String,
    pub bytes: Vec<u8>,
}

impl ManifestBody {
    /// Platform-root path components of the sidecar.
    pub(crate) fn components(&self) -> Vec<String> {
        self.directory
            .iter()
            .cloned()
            .chain(std::iter::once(self.file_name.clone()))
            .collect()
    }

    fn fingerprint(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.directory.hash(&mut hasher);
        self.file_name.hash(&mut hasher);
        self.bytes.hash(&mut hasher);
        hasher.finish()
    }
}

/// Why a torrent gets no sidecar. None of these is an error for the torrent.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ManifestSkip {
    /// Pure v2 torrents have no 40-hex identity PlaysVideo accepts.
    PureV2,
    TooManyFiles(usize),
    /// A payload path equals the sidecar or its temporary name.
    Collision,
    Layout(String),
}

impl ManifestSkip {
    fn code(&self) -> &'static str {
        match self {
            Self::PureV2 => "pure_v2",
            Self::TooManyFiles(_) => "too_many_files",
            Self::Collision => "name_collision",
            Self::Layout(_) => "invalid_layout",
        }
    }

    fn detail(&self) -> String {
        match self {
            Self::PureV2 => "pure v2 torrents have no v1 info hash".to_owned(),
            Self::TooManyFiles(count) => {
                format!("{count} files exceed the {MAX_MANIFEST_FILES}-file manifest limit")
            }
            Self::Collision => "a torrent file has the manifest's reserved name".to_owned(),
            Self::Layout(detail) => detail.clone(),
        }
    }
}

#[derive(Serialize)]
struct ManifestJson<'a> {
    infohash: String,
    magnet: &'a str,
    files: BTreeMap<String, ManifestFileJson>,
}

#[derive(Serialize)]
struct ManifestFileJson {
    index: usize,
    complete: bool,
}

/// Renders the legacy-compatible sidecar body. Pure: no I/O, no clock.
pub(crate) fn build_manifest(input: &ManifestInput<'_>) -> Result<ManifestBody, ManifestSkip> {
    let file_name = manifest_file_name(input.info_hashes).ok_or(ManifestSkip::PureV2)?;
    let temp_name = manifest_temp_name(&file_name);
    let direct = DirectContentLayout::from_content(input.content)
        .map_err(|error| ManifestSkip::Layout(error.to_string()))?;
    let layout = ContentLayout::from_content(input.content);
    let tree = direct.shape == ContentShape::Tree;
    let payload = direct
        .files
        .iter()
        .filter(|file| !file.padding)
        .collect::<Vec<_>>();
    if payload.len() > MAX_MANIFEST_FILES {
        return Err(ManifestSkip::TooManyFiles(payload.len()));
    }
    let reserved = |component: &str| component == file_name || component == temp_name;
    let collides = if tree {
        payload
            .iter()
            .any(|file| file.components.first().is_some_and(|first| reserved(first)))
    } else {
        reserved(&direct.root_name)
    };
    if collides {
        return Err(ManifestSkip::Collision);
    }
    let settled = !input.verification_pending
        && !matches!(
            input.state,
            TorrentState::Checking | TorrentState::NeedsRepair | TorrentState::Error
        );
    let mut files = BTreeMap::new();
    for file in payload {
        let wanted = input
            .skip_files
            .binary_search(&u32::try_from(file.file_index).unwrap_or(u32::MAX))
            .is_err();
        let complete = settled
            && wanted
            && match (input.have, layout.file_piece_range(file.file_index)) {
                (Some(_), Ok(None)) => true,
                (Some(have), Ok(Some(pieces))) => pieces.into_iter().all(|piece| {
                    usize::try_from(piece)
                        .ok()
                        .and_then(|index| have.get(index))
                        .copied()
                        .unwrap_or(false)
                }),
                (None, _) | (_, Err(_)) => false,
            };
        let relative = if tree {
            file.components.join("/")
        } else {
            direct.root_name.clone()
        };
        files.entry(relative).or_insert(ManifestFileJson {
            index: file.file_index,
            complete,
        });
    }
    let json = ManifestJson {
        infohash: file_name[1..41].to_owned(),
        magnet: input.magnet,
        files,
    };
    let bytes =
        serde_json::to_vec(&json).map_err(|error| ManifestSkip::Layout(error.to_string()))?;
    Ok(ManifestBody {
        file_name,
        directory: tree.then(|| direct.root_name.clone()),
        content_name: direct.root_name,
        bytes,
    })
}

/// Exact sidecar names a Delete data removal must remove, relative to the
/// sidecar's directory. Empty for pure v2 torrents.
pub(crate) fn manifest_artifact_names(info_hashes: InfoHashes) -> Vec<String> {
    manifest_file_name(info_hashes)
        .map(|name| vec![manifest_temp_name(&name), name])
        .unwrap_or_default()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WriteOutcome {
    Written,
    Unchanged,
    /// The payload path does not exist yet. Creating the content directory
    /// would turn fresh storage into existing storage and force a recheck on
    /// the next start, so the sidecar waits for the engine's first write.
    Deferred,
}

/// Atomically replaces the sidecar under a path root.
fn write_path_manifest(root: &Path, body: &ManifestBody) -> Result<WriteOutcome, String> {
    if !std::fs::metadata(root).is_ok_and(|metadata| metadata.is_dir()) {
        return Err("storage root is unavailable".to_owned());
    }
    validate_content_name(&body.file_name).map_err(|error| error.to_string())?;
    validate_content_name(&body.content_name).map_err(|error| error.to_string())?;
    let content = root.join(&body.content_name);
    match std::fs::symlink_metadata(&content) {
        Ok(metadata)
            if !metadata.file_type().is_symlink()
                && if body.directory.is_some() {
                    metadata.is_dir()
                } else {
                    metadata.is_file()
                } => {}
        Ok(_) => return Err("torrent content has an unexpected type".to_owned()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WriteOutcome::Deferred);
        }
        Err(error) => return Err(format!("inspect torrent content: {error}")),
    }
    let directory = if body.directory.is_some() {
        content
    } else {
        root.to_path_buf()
    };
    let target = directory.join(&body.file_name);
    match std::fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.is_file() => {
            if metadata.len() == body.bytes.len() as u64
                && std::fs::read(&target).is_ok_and(|existing| existing == body.bytes)
            {
                return Ok(WriteOutcome::Unchanged);
            }
        }
        Ok(metadata) if metadata.is_dir() => {
            return Err("manifest path is occupied by a directory".to_owned());
        }
        // A symlink or special object is replaced by the rename below, never
        // written through.
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("inspect manifest: {error}")),
    }
    let temp = directory.join(manifest_temp_name(&body.file_name));
    match std::fs::remove_file(&temp) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("remove stale manifest temporary file: {error}")),
    }
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(&body.bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, &target)?;
        sync_directory(&directory);
        Ok::<_, std::io::Error>(())
    })();
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("write manifest: {error}"));
    }
    Ok(WriteOutcome::Written)
}

#[cfg(unix)]
fn sync_directory(directory: &Path) {
    if let Ok(directory) = std::fs::File::open(directory) {
        let _ = directory.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) {}

/// Rewrites the sidecar in place through the platform storage broker. SAF
/// has no rename, so a concurrent reader can see a torn file; PlaysVideo
/// discards it and reads the sidecar again on its next scan.
async fn write_platform_manifest(
    pool: &StorageFilePool,
    root_id: &str,
    torrent_id: &str,
    body: &ManifestBody,
) -> Result<WriteOutcome, String> {
    let key = StorageFileKey {
        storage_id: torrent_id.to_owned(),
        storage_generation: 1,
        role: StorageFileRole::DownloadManifest,
    };
    let reference = StorageFileReference::new(
        pool.clone(),
        key.clone(),
        StorageFileLocator::Platform(PlatformStorageTarget {
            root_id: root_id.to_owned(),
            storage_id: torrent_id.to_owned(),
            storage_generation: 1,
            role: StorageFileRole::DownloadManifest,
            path: body.components(),
        }),
    );
    // Observing never creates anything. The open below creates missing
    // parents, so it runs only once the payload path exists.
    let content = StorageFileReference::new(
        pool.clone(),
        key.clone(),
        StorageFileLocator::Platform(PlatformStorageTarget {
            root_id: root_id.to_owned(),
            storage_id: torrent_id.to_owned(),
            storage_generation: 1,
            role: StorageFileRole::DownloadManifest,
            path: vec![body.content_name.clone()],
        }),
    );
    let expected_kind = if body.directory.is_some() {
        StorageObjectKind::Directory
    } else {
        StorageObjectKind::File
    };
    match content.observe().await {
        Ok(observation) if !observation.exists => return Ok(WriteOutcome::Deferred),
        Ok(observation) if observation.kind == Some(expected_kind) => {}
        Ok(_) => return Err("torrent content has an unexpected type".to_owned()),
        Err(error) => return Err(platform_error(&error)),
    }
    let existing = match reference.open(StorageFileAccess::ReadExisting).await {
        Ok(handle) => {
            let expected = body.bytes.clone();
            tokio::task::spawn_blocking(move || {
                let mut file = handle.file();
                let length = file.metadata().map(|metadata| metadata.len()).ok();
                if length != Some(expected.len() as u64)
                    || expected.len() as u64 > MAX_COMPARED_MANIFEST_BYTES
                {
                    return false;
                }
                let mut existing = Vec::with_capacity(expected.len());
                file.seek(SeekFrom::Start(0)).is_ok()
                    && file
                        .take(MAX_COMPARED_MANIFEST_BYTES)
                        .read_to_end(&mut existing)
                        .is_ok()
                    && existing == expected
            })
            .await
            .unwrap_or(false)
        }
        Err(error)
            if error.platform_failure_kind() == Some(PlatformStorageFailureKind::Missing) =>
        {
            false
        }
        Err(error) => {
            pool.invalidate_key(&key);
            return Err(platform_error(&error));
        }
    };
    pool.invalidate_key(&key);
    if existing {
        return Ok(WriteOutcome::Unchanged);
    }
    let handle = match reference.open(StorageFileAccess::ReadWriteCreate).await {
        Ok(handle) => handle,
        Err(error) => {
            pool.invalidate_key(&key);
            return Err(platform_error(&error));
        }
    };
    let bytes = body.bytes.clone();
    let written = tokio::task::spawn_blocking(move || {
        let mut file = handle.file();
        // Truncate immediately before writing, not at open time, so a lost
        // open response or an aborted drain cannot leave an empty sidecar.
        file.set_len(0)?;
        file.seek(SeekFrom::Start(0))?;
        file.write_all(&bytes)?;
        file.set_len(bytes.len() as u64)?;
        let _ = file.sync_all();
        Ok::<_, std::io::Error>(())
    })
    .await;
    pool.invalidate_key(&key);
    match written {
        Ok(Ok(())) => Ok(WriteOutcome::Written),
        Ok(Err(error)) => Err(format!("write platform manifest: {error}")),
        Err(error) => Err(format!("platform manifest task failed: {error}")),
    }
}

fn platform_error(error: &StorageFilePoolError) -> String {
    format!("platform manifest: {error}")
}

/// Shared between the writer task, checkpoint sinks and the application.
#[derive(Clone, Debug, Default)]
pub(crate) struct DownloadManifestQueue {
    shared: Arc<QueueShared>,
}

#[derive(Debug, Default)]
struct QueueShared {
    state: Mutex<QueueState>,
    wake: Notify,
}

#[derive(Debug, Default)]
struct QueueState {
    reconcile_all: bool,
    draining: bool,
    dirty: BTreeSet<String>,
    /// Torrents whose storage was prepared in this process. Others are
    /// written only once they hold verified pieces, so a metadata-only or
    /// pending-selection add never creates an artifact.
    prepared: BTreeSet<String>,
    written: HashMap<String, WrittenManifest>,
    /// The last failure reported per torrent, so repeats stay quiet.
    reported: HashMap<String, String>,
    /// Torrents whose metainfo can never produce a sidecar (pure v2, too
    /// many files, a reserved name). Their metainfo is not parsed again.
    rejected: BTreeSet<String>,
    /// Torrents whose last write failed and already have a retry scheduled.
    retried: BTreeSet<String>,
    /// Advanced by every `forget`, so a write that overlapped a removal does
    /// not record bookkeeping for a torrent whose sidecar is being deleted.
    epoch: u64,
}

#[derive(Clone, Copy, Debug)]
struct WrittenManifest {
    fingerprint: Option<u64>,
    at: Instant,
}

impl DownloadManifestQueue {
    fn state(&self) -> MutexGuard<'_, QueueState> {
        self.shared
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Storage for the torrent exists; write its sidecar.
    pub(crate) fn storage_prepared(&self, torrent_id: &str) {
        let mut state = self.state();
        state.prepared.insert(torrent_id.to_owned());
        if !state.rejected.contains(torrent_id) {
            state.dirty.insert(torrent_id.to_owned());
        }
        drop(state);
        self.shared.wake.notify_one();
    }

    /// Completion, selection or identity may have changed.
    pub(crate) fn mark(&self, torrent_id: &str) {
        let mut state = self.state();
        if state.rejected.contains(torrent_id) {
            return;
        }
        state.dirty.insert(torrent_id.to_owned());
        drop(state);
        self.shared.wake.notify_one();
    }

    /// Re-examine every torrent, for startup and newly available roots.
    pub(crate) fn reconcile_all(&self) {
        self.state().reconcile_all = true;
        self.shared.wake.notify_one();
    }

    /// A removal is about to delete artifacts; drop pending work.
    pub(crate) fn forget(&self, torrent_id: &str) {
        let mut state = self.state();
        state.dirty.remove(torrent_id);
        state.prepared.remove(torrent_id);
        state.written.remove(torrent_id);
        state.reported.remove(torrent_id);
        state.rejected.remove(torrent_id);
        state.retried.remove(torrent_id);
        state.epoch = state.epoch.wrapping_add(1);
    }

    /// The next torrent that may be written now, or when one becomes due.
    fn next(&self, now: Instant) -> Next {
        let mut state = self.state();
        if state.reconcile_all {
            return Next::ReconcileAll;
        }
        let mut due = None::<Instant>;
        let mut ready = None;
        for torrent_id in &state.dirty {
            let at = state
                .written
                .get(torrent_id)
                .map_or(now, |written| written.at + MANIFEST_WRITE_INTERVAL);
            if at <= now || state.draining {
                ready = Some(torrent_id.clone());
                break;
            }
            due = Some(due.map_or(at, |due| due.min(at)));
        }
        if let Some(torrent_id) = ready {
            state.dirty.remove(&torrent_id);
            let prepared = state.prepared.contains(&torrent_id);
            let fingerprint = state
                .written
                .get(&torrent_id)
                .and_then(|written| written.fingerprint);
            return Next::Write {
                torrent_id,
                prepared,
                fingerprint,
                epoch: state.epoch,
            };
        }
        match due {
            Some(due) => Next::Wait(due),
            None => Next::Idle,
        }
    }
}

enum Next {
    Idle,
    Wait(Instant),
    ReconcileAll,
    Write {
        torrent_id: String,
        prepared: bool,
        fingerprint: Option<u64>,
        epoch: u64,
    },
}

/// What the store says about one torrent's sidecar.
enum Plan {
    Skip,
    Unchanged,
    Rejected(ManifestSkip),
    Write {
        root: StorageRootLocation,
        root_id: String,
        body: ManifestBody,
    },
}

/// Owns the writer task. One write is in flight at a time host-wide.
#[derive(Debug)]
pub(crate) struct DownloadManifestWriter {
    queue: DownloadManifestQueue,
    roots: Arc<Mutex<Arc<BTreeMap<String, StorageRootLocation>>>>,
    gate: Arc<tokio::sync::Mutex<()>>,
    cancellation: CancellationToken,
    task: Option<JoinHandle<()>>,
}

impl DownloadManifestWriter {
    pub(crate) fn start(
        store: Arc<Mutex<SessionStore>>,
        roots: Arc<BTreeMap<String, StorageRootLocation>>,
        pool: StorageFilePool,
        views: ViewHub,
    ) -> Self {
        let queue = DownloadManifestQueue::default();
        queue.state().reconcile_all = true;
        let roots = Arc::new(Mutex::new(roots));
        let gate = Arc::new(tokio::sync::Mutex::new(()));
        let cancellation = CancellationToken::new();
        let worker = Worker {
            queue: queue.clone(),
            store,
            roots: roots.clone(),
            pool,
            views,
            gate: gate.clone(),
        };
        let task_cancellation = cancellation.clone();
        let task = tokio::spawn(async move { worker.run(task_cancellation).await });
        queue.shared.wake.notify_one();
        Self {
            queue,
            roots,
            gate,
            cancellation,
            task: Some(task),
        }
    }

    pub(crate) fn queue(&self) -> DownloadManifestQueue {
        self.queue.clone()
    }

    /// Publishes the currently available storage roots. A root that became
    /// available re-examines every torrent.
    pub(crate) fn set_storage_roots(&self, roots: Arc<BTreeMap<String, StorageRootLocation>>) {
        let mut current = self
            .roots
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // A root that appeared, or whose location changed, may hold stale or
        // missing sidecars; forget fingerprints so every torrent is compared
        // with the disk again. Both writers skip identical bytes.
        let gained = roots
            .iter()
            .any(|(root, location)| current.get(root) != Some(location));
        *current = roots;
        drop(current);
        if gained {
            self.queue.state().written.clear();
            self.queue.reconcile_all();
        }
    }

    /// Drops pending work for a torrent and waits for an in-flight write to
    /// finish, so removal deletes a sidecar nothing will recreate.
    pub(crate) async fn quiesce(&self, torrent_id: &str) {
        self.queue.forget(torrent_id);
        drop(self.gate.lock().await);
    }

    /// Holds the write gate as an in-flight write would.
    #[cfg(test)]
    pub(crate) async fn hold_write_gate_for_test(&self) -> tokio::sync::OwnedMutexGuard<()> {
        self.gate.clone().lock_owned().await
    }

    /// Drains pending writes within the shutdown budget, then abandons the
    /// rest; startup reconciliation recreates them.
    pub(crate) async fn shutdown(&mut self) -> Result<(), String> {
        self.queue.state().draining = true;
        self.queue.shared.wake.notify_one();
        let Some(mut task) = self.task.take() else {
            return Ok(());
        };
        match tokio::time::timeout(MANIFEST_SHUTDOWN_BUDGET, &mut task).await {
            Ok(result) => result.map_err(|error| error.to_string()),
            Err(_) => {
                self.cancellation.cancel();
                task.abort();
                let _ = task.await;
                Ok(())
            }
        }
    }
}

impl Drop for DownloadManifestWriter {
    fn drop(&mut self) {
        self.cancellation.cancel();
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

struct Worker {
    queue: DownloadManifestQueue,
    store: Arc<Mutex<SessionStore>>,
    roots: Arc<Mutex<Arc<BTreeMap<String, StorageRootLocation>>>>,
    pool: StorageFilePool,
    views: ViewHub,
    gate: Arc<tokio::sync::Mutex<()>>,
}

impl Worker {
    async fn run(self, cancellation: CancellationToken) {
        loop {
            if cancellation.is_cancelled() {
                return;
            }
            match self.queue.next(Instant::now()) {
                Next::ReconcileAll => self.reconcile_all().await,
                Next::Write {
                    torrent_id,
                    prepared,
                    fingerprint,
                    epoch,
                } => {
                    let gate = self.gate.lock().await;
                    tokio::select! {
                        () = cancellation.cancelled() => return,
                        () = self.write(&torrent_id, prepared, fingerprint, epoch) => {}
                    }
                    drop(gate);
                }
                Next::Wait(due) => {
                    if self.queue.state().draining {
                        continue;
                    }
                    tokio::select! {
                        () = cancellation.cancelled() => return,
                        () = self.queue.shared.wake.notified() => {}
                        () = tokio::time::sleep_until(due.into()) => {}
                    }
                }
                Next::Idle => {
                    if self.queue.state().draining {
                        return;
                    }
                    tokio::select! {
                        () = cancellation.cancelled() => return,
                        () = self.queue.shared.wake.notified() => {}
                    }
                }
            }
        }
    }

    async fn reconcile_all(&self) {
        let store = self.store.clone();
        let torrent_ids = tokio::task::spawn_blocking(move || {
            let store = store
                .lock()
                .map_err(|_| "session store lock is poisoned".to_owned())?;
            store
                .snapshot()
                .map(|snapshot| {
                    snapshot
                        .torrents
                        .into_iter()
                        .filter(|torrent| torrent.removal_state.is_none())
                        .map(|torrent| torrent.torrent_id)
                        .collect::<Vec<_>>()
                })
                .map_err(|error| error.to_string())
        })
        .await;
        let mut state = self.queue.state();
        state.reconcile_all = false;
        match torrent_ids {
            Ok(Ok(torrent_ids)) => {
                let fresh = torrent_ids
                    .into_iter()
                    .filter(|torrent_id| !state.rejected.contains(torrent_id))
                    .collect::<Vec<_>>();
                state.dirty.extend(fresh);
            }
            Ok(Err(detail)) => {
                drop(state);
                self.report_failure(None, "reconcile", &detail);
            }
            Err(error) => {
                drop(state);
                self.report_failure(None, "reconcile", &error.to_string());
            }
        }
    }

    async fn write(&self, torrent_id: &str, prepared: bool, fingerprint: Option<u64>, epoch: u64) {
        let store = self.store.clone();
        let roots = self
            .roots
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let owned_id = torrent_id.to_owned();
        let plan = tokio::task::spawn_blocking(move || {
            plan_manifest(&store, &roots, &owned_id, prepared, fingerprint)
        })
        .await;
        let plan = match plan {
            Ok(Ok(plan)) => plan,
            Ok(Err(detail)) => {
                self.report_failure(Some(torrent_id), "plan", &detail);
                return;
            }
            Err(error) => {
                self.report_failure(Some(torrent_id), "plan", &error.to_string());
                return;
            }
        };
        let (root, root_id, body) = match plan {
            Plan::Skip | Plan::Unchanged => return,
            Plan::Rejected(skip) => {
                self.record_written(torrent_id, None, epoch);
                {
                    let mut state = self.queue.state();
                    if state.epoch == epoch {
                        state.rejected.insert(torrent_id.to_owned());
                    }
                }
                self.report_skip(torrent_id, &skip);
                return;
            }
            Plan::Write {
                root,
                root_id,
                body,
            } => (root, root_id, body),
        };
        let result = match root {
            StorageRootLocation::Path(root) => {
                let path_body = body.clone();
                tokio::task::spawn_blocking(move || write_path_manifest(&root, &path_body))
                    .await
                    .unwrap_or_else(|error| Err(format!("manifest task failed: {error}")))
            }
            StorageRootLocation::PlatformCapability => {
                write_platform_manifest(&self.pool, &root_id, torrent_id, &body).await
            }
        };
        match result {
            // Nothing is recorded: the engine's first payload write is
            // followed by a durable-piece mark that retries.
            Ok(WriteOutcome::Deferred) => {}
            Ok(outcome) => {
                self.queue.state().retried.remove(torrent_id);
                let recovered = self
                    .queue
                    .state()
                    .reported
                    .remove(torrent_id)
                    .is_some_and(|key| !key.starts_with("skip:"));
                if recovered {
                    let _ = self.views.record_diagnostic(
                        DiagnosticSeverity::Info,
                        category::STORAGE_IO,
                        "download_manifest_recovered",
                        Some(torrent_id),
                        "PlaysVideo manifest written after an earlier failure",
                        &[],
                    );
                }
                self.record_written(torrent_id, Some(body.fingerprint()), epoch);
                if outcome == WriteOutcome::Written {
                    let bytes = body.bytes.len().to_string();
                    let _ = self.views.record_diagnostic(
                        DiagnosticSeverity::Debug,
                        category::STORAGE_IO,
                        "download_manifest_written",
                        Some(torrent_id),
                        "PlaysVideo manifest written",
                        &[("bytes", &bytes)],
                    );
                }
            }
            Err(detail) => {
                self.record_written(torrent_id, None, epoch);
                self.schedule_retry(torrent_id, epoch);
                self.report_failure(Some(torrent_id), "write", &detail);
            }
        }
    }

    /// A seeding torrent produces no further marks, so one failure would
    /// otherwise leave its sidecar missing or stale until restart.
    fn schedule_retry(&self, torrent_id: &str, epoch: u64) {
        let mut state = self.queue.state();
        if state.epoch != epoch || !state.retried.insert(torrent_id.to_owned()) {
            return;
        }
        // `next` waits MANIFEST_WRITE_INTERVAL after `at`.
        state.written.insert(
            torrent_id.to_owned(),
            WrittenManifest {
                fingerprint: None,
                at: Instant::now() + (MANIFEST_RETRY_DELAY - MANIFEST_WRITE_INTERVAL),
            },
        );
        state.dirty.insert(torrent_id.to_owned());
        drop(state);
        self.queue.shared.wake.notify_one();
    }

    fn record_written(&self, torrent_id: &str, fingerprint: Option<u64>, epoch: u64) {
        let mut state = self.queue.state();
        // A removal forgot this torrent while it was being written; do not
        // resurrect its bookkeeping.
        if state.epoch != epoch {
            return;
        }
        state.written.insert(
            torrent_id.to_owned(),
            WrittenManifest {
                fingerprint,
                at: Instant::now(),
            },
        );
    }

    fn report_skip(&self, torrent_id: &str, skip: &ManifestSkip) {
        let key = format!("skip:{}", skip.code());
        if !self.first_report(torrent_id, &key) {
            return;
        }
        let detail = skip.detail();
        let _ = self.views.record_diagnostic(
            DiagnosticSeverity::Info,
            category::STORAGE_IO,
            "download_manifest_skipped",
            Some(torrent_id),
            "PlaysVideo manifest is not written for this torrent",
            &[("reason", skip.code()), ("detail", &detail)],
        );
    }

    fn report_failure(&self, torrent_id: Option<&str>, stage: &str, detail: &str) {
        let key = format!("{stage}:{detail}");
        if let Some(torrent_id) = torrent_id
            && !self.first_report(torrent_id, &key)
        {
            return;
        }
        let _ = self.views.record_diagnostic(
            DiagnosticSeverity::Warning,
            category::STORAGE_IO,
            "download_manifest_failed",
            torrent_id,
            "PlaysVideo manifest could not be written; the download is unaffected",
            &[("stage", stage), ("detail", detail)],
        );
    }

    fn first_report(&self, torrent_id: &str, key: &str) -> bool {
        let mut state = self.queue.state();
        if state
            .reported
            .get(torrent_id)
            .is_some_and(|last| last == key)
        {
            return false;
        }
        state.reported.insert(torrent_id.to_owned(), key.to_owned());
        true
    }
}

fn plan_manifest(
    store: &Arc<Mutex<SessionStore>>,
    roots: &BTreeMap<String, StorageRootLocation>,
    torrent_id: &str,
    prepared: bool,
    fingerprint: Option<u64>,
) -> Result<Plan, String> {
    let store = store
        .lock()
        .map_err(|_| "session store lock is poisoned".to_owned())?;
    match store.load_removal(torrent_id) {
        Ok(_) => return Ok(Plan::Skip),
        Err(StoreError::UnknownTorrent(_)) => {}
        Err(error) => return Err(error.to_string()),
    }
    let resume = match store.load_resume(torrent_id) {
        Ok(resume) => resume,
        Err(StoreError::UnknownTorrent(_)) => return Ok(Plan::Skip),
        Err(error) => return Err(error.to_string()),
    };
    if resume.raw_info.is_none() {
        return Ok(Plan::Skip);
    }
    let any_verified = resume
        .have
        .as_ref()
        .is_some_and(|have| have.pieces().iter().any(|piece| *piece));
    if !prepared && !any_verified {
        return Ok(Plan::Skip);
    }
    if resume.info_hashes.v1_hash().is_none() {
        return Ok(Plan::Rejected(ManifestSkip::PureV2));
    }
    let Some(root) = roots.get(&resume.storage_root).cloned() else {
        return Ok(Plan::Skip);
    };
    // Both magnet forms are cheap queries; the metainfo parse that decides
    // between them runs after the session store is released.
    let public_magnet = store
        .download_manifest_magnet(torrent_id, false)
        .map_err(|error| error.to_string())?;
    let private_magnet = store
        .download_manifest_magnet(torrent_id, true)
        .map_err(|error| error.to_string())?;
    drop(store);
    let content = match crate::application::parse_resume_content(&resume) {
        Ok(content) => content,
        Err(error) => return Ok(Plan::Rejected(ManifestSkip::Layout(error.to_string()))),
    };
    let magnet = if content.private() {
        private_magnet
    } else {
        public_magnet
    };
    let body = match build_manifest(&ManifestInput {
        content: &content,
        info_hashes: resume.info_hashes,
        magnet: &magnet,
        have: resume.have.as_ref().map(|have| have.pieces()),
        skip_files: &resume.skip_files,
        state: resume.state,
        verification_pending: resume.verification.is_pending(),
    }) {
        Ok(body) => body,
        Err(skip) => return Ok(Plan::Rejected(skip)),
    };
    if fingerprint == Some(body.fingerprint()) {
        return Ok(Plan::Unchanged);
    }
    Ok(Plan::Write {
        root,
        root_id: resume.storage_root,
        body,
    })
}

/// Paths of the sidecar artifacts under a path root, for Delete data.
pub(crate) fn path_manifest_artifacts(
    root: &Path,
    content_name: &str,
    tree: bool,
    info_hashes: InfoHashes,
) -> Vec<PathBuf> {
    let directory = if tree {
        root.join(content_name)
    } else {
        root.to_path_buf()
    };
    manifest_artifact_names(info_hashes)
        .into_iter()
        .map(|name| directory.join(name))
        .collect()
}

#[cfg(test)]
mod tests;
