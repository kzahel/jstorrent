//! Tactical 391: PlaysVideo download manifests through the application.

use super::*;

fn sidecar(directory: &Path, info_hash: [u8; 20]) -> PathBuf {
    directory.join(format!(
        ".{}.jstorrent.json",
        super::super::encode_info_hash(info_hash)
    ))
}

fn read_sidecar(path: &Path) -> Option<serde_json::Value> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

/// Waits until the sidecar exists and satisfies `accept`.
async fn wait_for_sidecar(
    path: &Path,
    label: &str,
    accept: impl Fn(&serde_json::Value) -> bool,
) -> serde_json::Value {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(body) = read_sidecar(path)
                && accept(&body)
            {
                return body;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "{label}: sidecar {} never matched; last body {:?}",
            path.display(),
            read_sidecar(path)
        )
    })
}

fn all_complete(body: &serde_json::Value, expected: bool) -> bool {
    body["files"]
        .as_object()
        .is_some_and(|files| files.values().all(|file| file["complete"] == expected))
}

/// Two 4-byte files under `name`, one piece each.
fn tree_info(name: &str, first: &[u8; 4], second: &[u8; 4]) -> Vec<u8> {
    let mut info = format!(
        "d5:filesld6:lengthi4e4:pathl5:a.bineed6:lengthi4e4:pathl3:sub5:b.bineee4:name{}:{}12:piece lengthi4e6:pieces40:",
        name.len(),
        name
    )
    .into_bytes();
    info.extend_from_slice(&Sha1::digest(first));
    info.extend_from_slice(&Sha1::digest(second));
    info.push(b'e');
    info
}

/// Adds a torrent whose payload already verified, as an earlier run left it.
fn add_complete_torrent(
    config: &ApplicationConfig,
    request_id: &str,
    raw_info: &[u8],
    pieces: &[usize],
) -> String {
    let info_hash: [u8; 20] = Sha1::digest(raw_info).into();
    let mut store = SessionStore::open(
        config.durable_profile_root().expect("durable profile root"),
        &config.profile_id,
        &config.storage_roots,
    )
    .expect("open setup store");
    let torrent_id = add_store_torrent(
        &mut store,
        request_id,
        &super::super::encode_info_hash(info_hash),
    );
    store
        .record_metadata(&torrent_id, raw_info)
        .expect("record metadata");
    store
        .record_pieces(&torrent_id, pieces)
        .expect("record pieces");
    store.mark_complete(&torrent_id).expect("mark complete");
    torrent_id
}

/// Adds a magnet whose one-piece payload a gated loopback peer serves.
fn add_served_magnet(
    configuration: &ApplicationConfig,
    request_id: &str,
    raw_info: &[u8],
    magnet_suffix: &str,
) -> String {
    let info_hash: [u8; 20] = Sha1::digest(raw_info).into();
    let mut store = SessionStore::open(
        configuration
            .durable_profile_root()
            .expect("durable profile root"),
        &configuration.profile_id,
        &configuration.storage_roots,
    )
    .expect("open setup store");
    let hex = super::super::encode_info_hash(info_hash);
    let response = store
        .handle_durable(&RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: request_id.to_owned(),
            expected_revision: None,
            command: Command::AddMagnet {
                magnet: format!("magnet:?xt=urn:btih:{hex}{magnet_suffix}"),
                storage_root: "downloads".to_owned(),
                start_content: true,
                await_file_selection: false,
                skip_files: Vec::new(),
            },
        })
        .expect("add magnet");
    let torrent_id = match response.result {
        Some(CommandResult::AddTorrent { result }) => result.torrent_id,
        _ => panic!("add result"),
    };
    store
        .record_metadata(&torrent_id, raw_info)
        .expect("record metadata");
    torrent_id
}

#[tokio::test]
async fn download_writes_manifest_once_payload_exists_and_strips_share_parameters() {
    let root = test_root("manifest-download");
    let configuration = config(&root);
    let payload = vec![0x5a; 4 * 1024];
    let raw_info = single_file_info("video.mkv", &payload, payload.len());
    let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
    let hex = super::super::encode_info_hash(info_hash);
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind content peer");
    let peer = listener.local_addr().expect("peer address");
    let (started_sender, started) = tokio::sync::oneshot::channel();
    let (release, release_receiver) = tokio::sync::oneshot::channel();
    let peer_task = tokio::spawn(serve_single_piece_peer(
        listener,
        info_hash,
        payload.clone(),
        started_sender,
        release_receiver,
    ));
    add_served_magnet(
        &configuration,
        "add-manifest-download",
        &raw_info,
        &format!("&dn=video.mkv&x.pe={peer}&so=0"),
    );

    let service = Arc::new(tokio::sync::Mutex::new(
        ApplicationService::open(configuration)
            .await
            .expect("open application"),
    ));
    ApplicationService::ensure_maintenance_owner(&service).await;
    tokio::time::timeout(Duration::from_secs(5), started)
        .await
        .expect("payload request deadline")
        .expect("peer connected");
    let path = sidecar(&root.join("payload"), info_hash);
    // Storage is prepared but no payload byte exists yet: no artifact.
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(!path.exists(), "the sidecar waits for the payload");

    release.send(()).expect("release payload");
    let after = wait_for_sidecar(&path, "completed", |body| all_complete(body, true)).await;
    assert_eq!(after["infohash"], hex);
    assert_eq!(
        after["files"],
        serde_json::json!({ "video.mkv": { "index": 0, "complete": true } })
    );
    let magnet = after["magnet"].as_str().expect("magnet");
    assert!(
        magnet.starts_with(&format!("magnet:?xt=urn:btih:{hex}")),
        "{magnet}"
    );
    assert!(magnet.contains("dn=video.mkv"), "{magnet}");
    assert!(
        !magnet.contains("x.pe=") && !magnet.contains("so="),
        "share parameters never reach PlaysVideo: {magnet}"
    );
    peer_task.await.expect("peer task");
    assert_eq!(
        fs::read(root.join("payload/video.mkv")).expect("payload"),
        payload
    );
    assert!(
        !root
            .join("payload")
            .join(format!(".{hex}.jstorrent.json.tmp"))
            .exists()
    );

    service.lock().await.shutdown().await.expect("shutdown");
    drop(service);
    fs::remove_dir_all(root).expect("remove test root");
}

/// Two 4-byte files under `name` in a single 8-byte piece.
fn one_piece_tree_info(name: &str, payload: &[u8; 8]) -> Vec<u8> {
    let mut info = format!(
        "d5:filesld6:lengthi4e4:pathl5:a.bineed6:lengthi4e4:pathl5:b.bineee4:name{}:{}12:piece lengthi8e6:pieces20:",
        name.len(),
        name
    )
    .into_bytes();
    info.extend_from_slice(&Sha1::digest(payload));
    info.push(b'e');
    info
}

#[tokio::test]
async fn prepared_tree_without_payload_creates_no_directory_and_restarts_without_recheck() {
    let root = test_root("manifest-tree-restart");
    let configuration = config(&root);
    let payload = *b"aaaabbbb";
    let raw_info = one_piece_tree_info("Show", &payload);
    let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind content peer");
    let peer = listener.local_addr().expect("peer address");
    let (started_sender, started) = tokio::sync::oneshot::channel();
    let (_release, release_receiver) = tokio::sync::oneshot::channel::<()>();
    let peer_task = tokio::spawn(serve_single_piece_peer(
        listener,
        info_hash,
        payload.to_vec(),
        started_sender,
        release_receiver,
    ));
    let torrent_id = add_served_magnet(
        &configuration,
        "add-manifest-tree",
        &raw_info,
        &format!("&x.pe={peer}"),
    );
    let content = root.join("payload/Show");

    let service = Arc::new(tokio::sync::Mutex::new(
        ApplicationService::open(configuration.clone())
            .await
            .expect("open application"),
    ));
    ApplicationService::ensure_maintenance_owner(&service).await;
    tokio::time::timeout(Duration::from_secs(5), started)
        .await
        .expect("payload request deadline")
        .expect("peer connected");
    // Storage is prepared and the writer has had time to run.
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        !content.exists(),
        "the writer must not create the content directory"
    );
    peer_task.abort();
    service.lock().await.shutdown().await.expect("shutdown");
    drop(service);
    assert!(!content.exists(), "the shutdown drain creates nothing");

    let mut service = ApplicationService::open(configuration)
        .await
        .expect("reopen application");
    let resume = service
        .store_mut()
        .expect("store")
        .load_resume(&torrent_id)
        .expect("resume");
    assert!(
        !resume.verification.is_pending() && resume.state != TorrentState::Checking,
        "fresh storage must not be rediscovered as existing content"
    );
    assert!(!content.exists());
    service.shutdown().await.expect("shutdown");
    drop(service);
    fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn startup_reconciles_manifests_recheck_flips_them_and_shutdown_drains() {
    let root = test_root("manifest-reconcile");
    let configuration = config(&root);
    let payload = (0..32_768)
        .map(|offset| ((offset * 31 + offset / 13) & 0xff) as u8)
        .collect::<Vec<_>>();
    let raw_info = single_file_info("complete.bin", &payload, 16_384);
    let info_hash: [u8; 20] = Sha1::digest(&raw_info).into();
    let torrent_id =
        add_complete_torrent(&configuration, "add-manifest-complete", &raw_info, &[0, 1]);
    let output = root.join("payload/complete.bin");
    fs::create_dir_all(output.parent().expect("payload parent")).expect("payload root");
    fs::write(&output, &payload).expect("write payload");
    let path = sidecar(&root.join("payload"), info_hash);

    let mut service = ApplicationService::open(configuration.clone())
        .await
        .expect("open application");
    let body = wait_for_sidecar(&path, "startup", |body| all_complete(body, true)).await;
    assert_eq!(
        body["files"],
        serde_json::json!({ "complete.bin": { "index": 0, "complete": true } })
    );

    let mut corrupt = payload.clone();
    corrupt[20_000] ^= 0xff;
    fs::write(&output, &corrupt).expect("corrupt second piece");
    service
        .dispatch(RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "manifest-force-recheck".to_owned(),
            expected_revision: None,
            command: Command::ForceRecheck {
                torrent_id: torrent_id.clone(),
            },
        })
        .await
        .expect("force recheck");
    wait_for_sidecar(&path, "recheck", |body| all_complete(body, false)).await;
    service.shutdown().await.expect("shutdown");
    drop(service);

    // Restart reconciliation recreates a missing sidecar; shutdown drains
    // the pending write instead of abandoning it.
    fs::remove_file(&path).expect("remove sidecar");
    let mut service = ApplicationService::open(configuration)
        .await
        .expect("reopen application");
    service.shutdown().await.expect("shutdown drains");
    drop(service);
    let restored = read_sidecar(&path).expect("drained sidecar");
    assert!(all_complete(&restored, false));
    fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn delete_data_prunes_the_content_directory_and_keep_leaves_the_sidecar() {
    let root = test_root("manifest-removal");
    let configuration = config(&root);
    let deleted_info = tree_info("deleted", b"aaaa", b"bbbb");
    let kept_info = tree_info("kept", b"cccc", b"dddd");
    let deleted = add_complete_torrent(
        &configuration,
        "add-manifest-deleted",
        &deleted_info,
        &[0, 1],
    );
    let kept = add_complete_torrent(&configuration, "add-manifest-kept", &kept_info, &[0, 1]);
    let payload = root.join("payload");
    for (name, first, second) in [("deleted", b"aaaa", b"bbbb"), ("kept", b"cccc", b"dddd")] {
        fs::create_dir_all(payload.join(name).join("sub")).expect("content tree");
        fs::write(payload.join(name).join("a.bin"), first).expect("first file");
        fs::write(payload.join(name).join("sub/b.bin"), second).expect("second file");
    }
    let deleted_sidecar = sidecar(&payload.join("deleted"), Sha1::digest(&deleted_info).into());
    let kept_sidecar = sidecar(&payload.join("kept"), Sha1::digest(&kept_info).into());

    let mut service = ApplicationService::open(configuration)
        .await
        .expect("open application");
    let body = wait_for_sidecar(&deleted_sidecar, "tree", |body| all_complete(body, true)).await;
    assert_eq!(
        body["files"],
        serde_json::json!({
            "a.bin": { "index": 0, "complete": true },
            "sub/b.bin": { "index": 1, "complete": true },
        })
    );
    wait_for_sidecar(&kept_sidecar, "kept tree", |body| all_complete(body, true)).await;

    for (torrent_id, data) in [
        (deleted, RemovalDataPolicy::DeleteData),
        (kept, RemovalDataPolicy::Keep),
    ] {
        service
            .dispatch(RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: format!("remove-manifest-{torrent_id}"),
                expected_revision: None,
                command: Command::RemoveTorrent { torrent_id, data },
            })
            .await
            .expect("remove");
    }
    assert!(
        !payload.join("deleted").exists(),
        "Delete data must remove the sidecar so the content directory is pruned"
    );
    let kept_body = read_sidecar(&kept_sidecar).expect("kept sidecar");
    assert!(all_complete(&kept_body, true));
    assert_eq!(
        fs::read(payload.join("kept/a.bin")).expect("kept payload"),
        b"cccc"
    );

    service.shutdown().await.expect("shutdown");
    drop(service);
    assert!(
        !payload.join("deleted").exists(),
        "nothing recreates a deleted sidecar"
    );
    fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn private_torrent_manifest_magnets_omit_trackers() {
    let root = test_root("manifest-private-magnet");
    let configuration = config(&root);
    let raw_info =
        b"d6:lengthi4e4:name4:test12:piece lengthi4e6:pieces20:aaaaaaaaaaaaaaaaaaaa7:privatei1ee";
    let info_hash: [u8; 20] = Sha1::digest(raw_info).into();
    let hex = super::super::encode_info_hash(info_hash);
    let mut store = SessionStore::open(
        configuration
            .durable_profile_root()
            .expect("durable profile root"),
        &configuration.profile_id,
        &configuration.storage_roots,
    )
    .expect("open store");
    let response = store
        .handle_durable(&RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "add-private-manifest".to_owned(),
            expected_revision: None,
            command: Command::AddMagnet {
                magnet: format!(
                    "magnet:?xt=urn:btih:{hex}&dn=test&tr=https%3A%2F%2Ftracker.example%2Fpasskey%2Fannounce"
                ),
                storage_root: "downloads".to_owned(),
                start_content: false,
                await_file_selection: false,
                skip_files: Vec::new(),
            },
        })
        .expect("add private torrent");
    let torrent_id = match response.result {
        Some(CommandResult::AddTorrent { result }) => result.torrent_id,
        _ => panic!("add result"),
    };
    store
        .record_metadata(&torrent_id, raw_info)
        .expect("record metadata");
    let private = store
        .download_manifest_magnet(&torrent_id, true)
        .expect("private magnet");
    assert_eq!(private, format!("magnet:?xt=urn:btih:{hex}&dn=test"));
    let public = store
        .download_manifest_magnet(&torrent_id, false)
        .expect("public magnet");
    assert!(public.contains("tr="), "{public}");
    drop(store);
    fs::remove_dir_all(root).expect("remove test root");
}

#[tokio::test]
async fn delete_data_waits_for_an_in_flight_manifest_write() {
    let root = test_root("manifest-quiesce");
    let configuration = config(&root);
    let raw_info = tree_info("fenced", b"eeee", b"ffff");
    let torrent_id =
        add_complete_torrent(&configuration, "add-manifest-fenced", &raw_info, &[0, 1]);
    let payload = root.join("payload");
    fs::create_dir_all(payload.join("fenced/sub")).expect("content tree");
    fs::write(payload.join("fenced/a.bin"), b"eeee").expect("first file");
    fs::write(payload.join("fenced/sub/b.bin"), b"ffff").expect("second file");
    let path = sidecar(&payload.join("fenced"), Sha1::digest(&raw_info).into());
    let service = Arc::new(tokio::sync::Mutex::new(
        ApplicationService::open(configuration)
            .await
            .expect("open application"),
    ));
    wait_for_sidecar(&path, "fenced", |body| all_complete(body, true)).await;

    let gate = service
        .lock()
        .await
        .download_manifests
        .as_ref()
        .expect("writer")
        .hold_write_gate_for_test()
        .await;
    let removal = tokio::spawn({
        let service = service.clone();
        let torrent_id = torrent_id.clone();
        async move {
            service
                .lock()
                .await
                .dispatch(RequestEnvelope {
                    version: CONTROL_VERSION,
                    request_id: "remove-manifest-fenced".to_owned(),
                    expected_revision: None,
                    command: Command::RemoveTorrent {
                        torrent_id,
                        data: RemovalDataPolicy::DeleteData,
                    },
                })
                .await
                .expect("remove")
        }
    });
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        !removal.is_finished(),
        "Delete data must wait for the in-flight write"
    );
    assert!(
        path.exists(),
        "nothing is deleted while a write is in flight"
    );
    drop(gate);
    tokio::time::timeout(Duration::from_secs(10), removal)
        .await
        .expect("removal finishes once the write ends")
        .expect("removal task");
    assert!(!payload.join("fenced").exists());

    service.lock().await.shutdown().await.expect("shutdown");
    assert!(!payload.join("fenced").exists(), "nothing recreates it");
    drop(service);
    fs::remove_dir_all(root).expect("remove test root");
}
