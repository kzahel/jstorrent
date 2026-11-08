use rstorrent_protocol::content::TorrentContent;
use rstorrent_protocol::identity::{InfoHashes, V1InfoHash, V2InfoHash};
use rstorrent_protocol::metainfo::{Metainfo, MetainfoFile, MetainfoMode};

use super::*;

const HASH: [u8; 20] = [0xab; 20];
const HEX: &str = "abababababababababababababababababababab";

fn file(path: &[&str], length: u64, offset: u64, padding: bool) -> MetainfoFile {
    MetainfoFile {
        path: path.iter().map(|part| (*part).to_owned()).collect(),
        length,
        offset,
        padding,
    }
}

fn content(
    name: &str,
    mode: MetainfoMode,
    files: Vec<MetainfoFile>,
    private: bool,
) -> TorrentContent {
    let total_length = files.iter().map(|file| file.length).sum::<u64>();
    let piece_length = 4;
    let pieces = total_length.div_ceil(u64::from(piece_length)).max(1) as usize;
    TorrentContent::from_v1_metainfo(Metainfo {
        info_hash: HASH,
        piece_hashes: vec![[0; 20]; pieces],
        piece_length,
        total_length,
        name: name.to_owned(),
        private,
        mode,
        files,
    })
}

fn single() -> TorrentContent {
    content(
        "movie.mkv",
        MetainfoMode::SingleFile,
        vec![file(&["movie.mkv"], 8, 0, false)],
        false,
    )
}

/// Three payload files around a BEP 47 padding file; pieces are 4 bytes.
/// a.mkv = piece 0, padding fills piece 1, sub/b.mkv = piece 2, empty = none.
fn tree() -> TorrentContent {
    content(
        "Show",
        MetainfoMode::MultiFile,
        vec![
            file(&["a.mkv"], 4, 0, false),
            file(&[".pad", "4"], 4, 4, true),
            file(&["sub", "b.mkv"], 4, 8, false),
            file(&["empty.txt"], 0, 12, false),
        ],
        false,
    )
}

fn input<'a>(content: &'a TorrentContent, have: &'a [bool], skip: &'a [u32]) -> ManifestInput<'a> {
    ManifestInput {
        content,
        info_hashes: InfoHashes::v1(V1InfoHash::new(HASH)),
        magnet: "magnet:?xt=urn:btih:abababababababababababababababababababab",
        have: Some(have),
        skip_files: skip,
        state: TorrentState::Downloading,
        verification_pending: false,
    }
}

fn json(body: &ManifestBody) -> serde_json::Value {
    serde_json::from_slice(&body.bytes).expect("manifest JSON")
}

#[test]
fn single_file_manifest_sits_beside_the_payload() {
    let content = single();
    let body = build_manifest(&input(&content, &[true, true], &[])).expect("body");
    assert_eq!(body.file_name, format!(".{HEX}.jstorrent.json"));
    assert_eq!(body.directory, None);
    assert_eq!(body.components(), vec![format!(".{HEX}.jstorrent.json")]);
    assert_eq!(
        json(&body),
        serde_json::json!({
            "infohash": HEX,
            "magnet": "magnet:?xt=urn:btih:abababababababababababababababababababab",
            "files": { "movie.mkv": { "index": 0, "complete": true } },
        })
    );
    let partial = build_manifest(&input(&content, &[true, false], &[])).expect("body");
    assert_eq!(json(&partial)["files"]["movie.mkv"]["complete"], false);
}

#[test]
fn tree_manifest_lists_relative_paths_and_keeps_padding_indices() {
    let content = tree();
    let body = build_manifest(&input(&content, &[true, false, true], &[])).expect("body");
    assert_eq!(body.directory.as_deref(), Some("Show"));
    assert_eq!(
        body.components(),
        vec!["Show".to_owned(), format!(".{HEX}.jstorrent.json")]
    );
    assert_eq!(
        json(&body)["files"],
        serde_json::json!({
            "a.mkv": { "index": 0, "complete": true },
            "sub/b.mkv": { "index": 2, "complete": true },
            "empty.txt": { "index": 3, "complete": true },
        })
    );
    let missing = build_manifest(&input(&content, &[true, true, false], &[])).expect("body");
    assert_eq!(json(&missing)["files"]["sub/b.mkv"]["complete"], false);
    assert_eq!(json(&missing)["files"]["a.mkv"]["complete"], true);
}

#[test]
fn skipped_files_are_listed_incomplete_even_when_their_pieces_verify() {
    let content = tree();
    let body = build_manifest(&input(&content, &[true, true, true], &[0, 3])).expect("body");
    let files = &json(&body)["files"];
    assert_eq!(files["a.mkv"]["complete"], false);
    assert_eq!(files["empty.txt"]["complete"], false);
    assert_eq!(files["sub/b.mkv"]["complete"], true);
}

#[test]
fn unsettled_torrents_present_nothing_as_complete() {
    let content = tree();
    let have = [true, true, true];
    for state in [
        TorrentState::Checking,
        TorrentState::NeedsRepair,
        TorrentState::Error,
    ] {
        let body = build_manifest(&ManifestInput {
            state,
            ..input(&content, &have, &[])
        })
        .expect("body");
        assert!(
            json(&body)["files"]
                .as_object()
                .unwrap()
                .values()
                .all(|file| file["complete"] == false),
            "{state:?}"
        );
    }
    let pending = build_manifest(&ManifestInput {
        verification_pending: true,
        ..input(&content, &have, &[])
    })
    .expect("body");
    assert_eq!(json(&pending)["files"]["a.mkv"]["complete"], false);
    let no_have = build_manifest(&ManifestInput {
        have: None,
        ..input(&content, &have, &[])
    })
    .expect("body");
    assert_eq!(json(&no_have)["files"]["empty.txt"]["complete"], false);
    let paused = build_manifest(&ManifestInput {
        state: TorrentState::Paused,
        ..input(&content, &have, &[])
    })
    .expect("body");
    assert_eq!(json(&paused)["files"]["a.mkv"]["complete"], true);
}

#[test]
fn hybrid_torrents_use_the_v1_identity_and_pure_v2_is_skipped() {
    let content = single();
    let hybrid = build_manifest(&ManifestInput {
        info_hashes: InfoHashes::hybrid(V1InfoHash::new(HASH), V2InfoHash::new([0xcd; 32])),
        ..input(&content, &[true, true], &[])
    })
    .expect("hybrid body");
    assert_eq!(hybrid.file_name, format!(".{HEX}.jstorrent.json"));
    assert_eq!(json(&hybrid)["infohash"], HEX);
    assert_eq!(
        build_manifest(&ManifestInput {
            info_hashes: InfoHashes::v2(V2InfoHash::new([0xcd; 32])),
            ..input(&content, &[true, true], &[])
        }),
        Err(ManifestSkip::PureV2)
    );
    assert!(manifest_artifact_names(InfoHashes::v2(V2InfoHash::new([0xcd; 32]))).is_empty());
}

#[test]
fn names_matching_the_sidecar_skip_the_manifest() {
    let sidecar = format!(".{HEX}.jstorrent.json");
    for name in [sidecar.clone(), format!("{sidecar}.tmp")] {
        let single = content(
            &name,
            MetainfoMode::SingleFile,
            vec![file(&[&name], 4, 0, false)],
            false,
        );
        assert_eq!(
            build_manifest(&input(&single, &[true], &[])),
            Err(ManifestSkip::Collision)
        );
        let tree = content(
            "Show",
            MetainfoMode::MultiFile,
            vec![file(&[&name, "inner.mkv"], 4, 0, false)],
            false,
        );
        assert_eq!(
            build_manifest(&input(&tree, &[true], &[])),
            Err(ManifestSkip::Collision)
        );
    }
    // A deeper file with the reserved name is not beside the sidecar.
    let nested = content(
        "Show",
        MetainfoMode::MultiFile,
        vec![file(&["sub", &sidecar], 4, 0, false)],
        false,
    );
    assert!(build_manifest(&input(&nested, &[true], &[])).is_ok());
}

#[test]
fn file_count_is_capped() {
    let files = (0..=MAX_MANIFEST_FILES)
        .map(|index| file(&[&format!("{index}.bin")], 1, index as u64, false))
        .collect();
    let large = content("Many", MetainfoMode::MultiFile, files, false);
    let have = vec![false; large.piece_count()];
    assert_eq!(
        build_manifest(&input(&large, &have, &[])),
        Err(ManifestSkip::TooManyFiles(MAX_MANIFEST_FILES + 1))
    );
}

#[test]
fn path_write_is_atomic_idempotent_and_replaces_stale_temporaries() {
    let root = tempfile::tempdir().expect("root");
    let content = tree();
    let body = build_manifest(&input(&content, &[true, false, false], &[])).expect("body");
    let directory = root.path().join("Show");
    let target = directory.join(&body.file_name);
    let temp = directory.join(manifest_temp_name(&body.file_name));

    // Before the engine's first payload write the content directory does
    // not exist, and the writer must not create it.
    assert_eq!(
        write_path_manifest(root.path(), &body),
        Ok(WriteOutcome::Deferred)
    );
    assert!(!directory.exists());
    let single = single();
    let beside = build_manifest(&input(&single, &[false, false], &[])).expect("body");
    assert_eq!(
        write_path_manifest(root.path(), &beside),
        Ok(WriteOutcome::Deferred)
    );
    assert!(!root.path().join(&beside.file_name).exists());

    std::fs::create_dir(&directory).unwrap();
    assert_eq!(
        write_path_manifest(root.path(), &body),
        Ok(WriteOutcome::Written)
    );
    assert_eq!(std::fs::read(&target).unwrap(), body.bytes);
    assert!(!temp.exists());
    assert_eq!(
        write_path_manifest(root.path(), &body),
        Ok(WriteOutcome::Unchanged)
    );

    std::fs::write(&temp, b"crash leftover").unwrap();
    let longer = build_manifest(&input(&content, &[true, true, true], &[])).expect("body");
    assert_eq!(
        write_path_manifest(root.path(), &longer),
        Ok(WriteOutcome::Written)
    );
    assert_eq!(std::fs::read(&target).unwrap(), longer.bytes);
    assert!(!temp.exists());

    let missing = root.path().join("absent");
    assert!(write_path_manifest(&missing, &body).is_err());
}

#[cfg(unix)]
#[test]
fn path_write_never_follows_links() {
    use std::os::unix::fs::symlink;

    let root = tempfile::tempdir().expect("root");
    let outside = tempfile::tempdir().expect("outside");
    let content = tree();
    let body = build_manifest(&input(&content, &[true, true, true], &[])).expect("body");
    symlink(outside.path(), root.path().join("Show")).unwrap();
    assert!(write_path_manifest(root.path(), &body).is_err());
    assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);

    std::fs::remove_file(root.path().join("Show")).unwrap();
    std::fs::create_dir(root.path().join("Show")).unwrap();
    let foreign = outside.path().join("foreign");
    std::fs::write(&foreign, b"foreign").unwrap();
    let temp = root
        .path()
        .join("Show")
        .join(manifest_temp_name(&body.file_name));
    symlink(&foreign, &temp).unwrap();
    let target = root.path().join("Show").join(&body.file_name);
    symlink(&foreign, &target).unwrap();
    assert_eq!(
        write_path_manifest(root.path(), &body),
        Ok(WriteOutcome::Written)
    );
    assert_eq!(std::fs::read(&foreign).unwrap(), b"foreign");
    assert!(
        !std::fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(std::fs::read(&target).unwrap(), body.bytes);
}

#[test]
fn queue_coalesces_rate_limits_and_keeps_rejections_sticky() {
    let queue = DownloadManifestQueue::default();
    let start = Instant::now();
    queue.mark("a");
    queue.mark("a");
    let Next::Write {
        torrent_id,
        prepared,
        ..
    } = queue.next(start)
    else {
        panic!("dirty torrent is due");
    };
    assert_eq!(torrent_id, "a");
    assert!(!prepared);
    assert!(matches!(queue.next(start), Next::Idle), "marks coalesce");

    queue.state().written.insert(
        "a".to_owned(),
        WrittenManifest {
            fingerprint: Some(1),
            at: start,
        },
    );
    queue.storage_prepared("a");
    match queue.next(start) {
        Next::Wait(due) => assert_eq!(due, start + MANIFEST_WRITE_INTERVAL),
        _ => panic!("a written torrent waits for its interval"),
    }
    let Next::Write {
        prepared,
        fingerprint,
        ..
    } = queue.next(start + MANIFEST_WRITE_INTERVAL)
    else {
        panic!("due after the interval");
    };
    assert!(prepared);
    assert_eq!(fingerprint, Some(1));

    queue.state().rejected.insert("v2".to_owned());
    queue.mark("v2");
    queue.storage_prepared("v2");
    assert!(
        matches!(queue.next(start), Next::Idle),
        "rejections are sticky"
    );
    queue.forget("v2");
    queue.mark("v2");
    assert!(
        matches!(queue.next(start), Next::Write { .. }),
        "forget clears them"
    );
}

/// A platform storage broker served from a temporary directory, recording
/// each open's access mode.
struct FakeBroker {
    root: tempfile::TempDir,
    opens: Arc<Mutex<Vec<StorageFileAccess>>>,
    deny_writes: Arc<std::sync::atomic::AtomicBool>,
    task: tokio::task::JoinHandle<()>,
}

impl FakeBroker {
    fn start() -> (Self, StorageFilePool) {
        use rstorrent_engine::{
            PlatformStorageFailure, PlatformStorageOperation, StorageObservation,
            platform_storage_channel,
        };
        let (client, broker) = platform_storage_channel();
        let pool = StorageFilePool::new(8, Some(client)).expect("pool");
        let root = tempfile::tempdir().expect("broker root");
        let opens = Arc::new(Mutex::new(Vec::new()));
        let deny_writes = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let base = root.path().to_path_buf();
        let task_opens = opens.clone();
        let task_deny = deny_writes.clone();
        let task = tokio::spawn(async move {
            while let Some(request) = broker.next_request().await {
                let path = request
                    .path
                    .iter()
                    .fold(base.clone(), |path, part| path.join(part));
                let missing =
                    || PlatformStorageFailure::new(PlatformStorageFailureKind::Missing, "absent");
                match request.operation {
                    PlatformStorageOperation::Observe => {
                        let observation = match std::fs::metadata(&path) {
                            Ok(metadata) if metadata.is_dir() => StorageObservation::present(
                                StorageObjectKind::Directory,
                                None,
                                None,
                            ),
                            Ok(metadata) => StorageObservation::present(
                                StorageObjectKind::File,
                                Some(metadata.len()),
                                None,
                            ),
                            Err(_) => Ok(StorageObservation::missing()),
                        }
                        .expect("observation");
                        broker.complete_observation(request.request_id, observation);
                    }
                    PlatformStorageOperation::Open => {
                        task_opens.lock().unwrap().push(request.access);
                        let opened = match request.access {
                            StorageFileAccess::ReadExisting => std::fs::File::open(&path).ok(),
                            _ if task_deny.load(std::sync::atomic::Ordering::SeqCst) => {
                                broker.complete_error(
                                    request.request_id,
                                    PlatformStorageFailure::new(
                                        PlatformStorageFailureKind::PermissionDenied,
                                        "grant revoked",
                                    ),
                                );
                                continue;
                            }
                            _ => {
                                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                                std::fs::OpenOptions::new()
                                    .read(true)
                                    .write(true)
                                    .create(true)
                                    .truncate(false)
                                    .open(&path)
                                    .ok()
                            }
                        };
                        match opened {
                            Some(file) => {
                                broker.complete_file(request.request_id, file);
                            }
                            None => {
                                broker.complete_error(request.request_id, missing());
                            }
                        }
                    }
                    PlatformStorageOperation::Delete => {
                        let _ = std::fs::remove_file(&path);
                        broker.complete_deleted(request.request_id);
                    }
                }
            }
        });
        (
            Self {
                root,
                opens,
                deny_writes,
                task,
            },
            pool,
        )
    }

    fn writes(&self) -> usize {
        self.opens
            .lock()
            .unwrap()
            .iter()
            .filter(|access| **access != StorageFileAccess::ReadExisting)
            .count()
    }
}

#[tokio::test]
async fn platform_write_defers_compares_truncates_and_never_marks_the_root_unhealthy() {
    let (broker, pool) = FakeBroker::start();
    let content = tree();
    let long = build_manifest(&ManifestInput {
        magnet: "magnet:?xt=urn:btih:abababababababababababababababababababab&dn=a-long-display-name",
        ..input(&content, &[true, false, true], &[])
    })
    .expect("body");
    let short = build_manifest(&input(&content, &[true, true, true], &[])).expect("body");
    assert!(short.bytes.len() < long.bytes.len());
    let target = broker.root.path().join("Show").join(&long.file_name);

    assert_eq!(
        write_platform_manifest(&pool, "saf", "t1-owner", &long).await,
        Ok(WriteOutcome::Deferred)
    );
    assert!(
        !broker.root.path().join("Show").exists(),
        "nothing is created"
    );
    assert_eq!(broker.writes(), 0);

    std::fs::create_dir(broker.root.path().join("Show")).unwrap();
    assert_eq!(
        write_platform_manifest(&pool, "saf", "t1-owner", &long).await,
        Ok(WriteOutcome::Written)
    );
    assert_eq!(std::fs::read(&target).unwrap(), long.bytes);
    assert_eq!(
        write_platform_manifest(&pool, "saf", "t1-owner", &long).await,
        Ok(WriteOutcome::Unchanged)
    );
    assert_eq!(broker.writes(), 1, "identical bytes are not rewritten");

    assert_eq!(
        write_platform_manifest(&pool, "saf", "t1-owner", &short).await,
        Ok(WriteOutcome::Written)
    );
    assert_eq!(
        std::fs::read(&target).unwrap(),
        short.bytes,
        "a shorter body truncates the old one"
    );
    assert_eq!(pool.snapshot().cached_entries, 0, "handles are released");

    broker
        .deny_writes
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(
        write_platform_manifest(&pool, "saf", "t1-owner", &long)
            .await
            .is_err()
    );
    assert!(
        pool.take_platform_root_failures().is_empty(),
        "a sidecar failure never marks the storage root unhealthy"
    );
    broker.task.abort();
}
