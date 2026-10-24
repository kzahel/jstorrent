use super::*;
use crate::driver::AppliedFileSelection;
use crate::{
    FileSelectionUpdate, IncomingPeerService, IncomingPeerServiceConfig, IncomingTcpBootstrap,
    PeerBudget, ResumeValidationIntent, ResumeValidationRejectReason, TorrentPeerHandle,
};
use rstorrent_protocol::content::{TorrentContentProjection, TorrentIntegrity};
use rstorrent_protocol::merkle::{file_root_from_data, piece_root_from_data};
use rstorrent_protocol::metainfo::DURABLE_METAINFO_LIMITS;

fn bstr(output: &mut Vec<u8>, value: &[u8]) {
    output.extend_from_slice(value.len().to_string().as_bytes());
    output.push(b':');
    output.extend_from_slice(value);
}

fn pure_v2_source(files: &[(&[u8], &[u8])], piece_length: u32) -> Vec<u8> {
    let roots = files
        .iter()
        .map(|(_, data)| file_root_from_data(data).expect("nonempty v2 fixture file"))
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
    let large = files
        .iter()
        .zip(&roots)
        .filter(|((_, data), _)| data.len() > piece_length as usize)
        .collect::<Vec<_>>();
    if !large.is_empty() {
        source.extend_from_slice(b"12:piece layersd");
        for ((_, data), root) in large {
            bstr(&mut source, root);
            let hashes = data
                .chunks(piece_length as usize)
                .map(|piece| piece_root_from_data(piece, piece_length).expect("v2 piece root"))
                .collect::<Vec<_>>();
            bstr(&mut source, &hashes.concat());
        }
        source.push(b'e');
    }
    source.push(b'e');
    source
}

#[tokio::test]
async fn pure_v2_complete_source_download_rechecks_and_reopens_without_part_file() {
    let small = vec![0x19; 17];
    let large = (0..40_000)
        .map(|index| ((index * 37 + index / 11) & 0xff) as u8)
        .collect::<Vec<_>>();
    let piece_length = 32 * 1024;
    let source = pure_v2_source(&[(b"a", &small), (b"b", &large)], piece_length);
    let projection =
        TorrentContentProjection::from_bytes_with_limits(&source, DURABLE_METAINFO_LIMITS)
            .expect("complete pure-v2 source");
    let info_only = projection
        .content
        .v2()
        .expect("v2 descriptor")
        .raw_info
        .clone();
    let v2_hash = projection
        .content
        .info_hashes()
        .v2_hash()
        .expect("v2 identity");
    let identity = TorrentIdentityContext::new(
        test_torrent_id(),
        projection.content.info_hashes(),
        projection.content.swarm_key(),
    )
    .expect("pure-v2 runtime identity");
    let wire_hash = projection.content.swarm_key().into_bytes();
    let pieces = Arc::new(vec![
        small.clone(),
        large[..piece_length as usize].to_vec(),
        large[piece_length as usize..].to_vec(),
    ]);
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind pure-v2 content peer");
    let address = listener.local_addr().expect("pure-v2 peer address");
    let (requested, mut requests) = mpsc::unbounded_channel();
    let peer_task = tokio::spawn(serve_content_peer_recording(
        listener,
        wire_hash,
        pieces,
        vec![true; 3],
        Duration::from_secs(2),
        Some(requested),
    ));
    let root = test_path("pure-v2-complete-source");
    tokio::fs::create_dir(&root)
        .await
        .expect("create pure-v2 storage root");
    let control = DownloadControl::new();
    let peers = TorrentPeerHandle::new(Arc::new(control.clone())).expect("pure-v2 peer state");
    peers
        .observe_discovered_peer(PeerObservation::dialable(
            PeerEndpoint::new(address).expect("pure-v2 peer endpoint"),
            PeerSource::Manual,
        ))
        .expect("observe pure-v2 peer");
    let checkpoints = Arc::new(RecordingCheckpointSink::default());
    let report = timeout(
        Duration::from_secs(4),
        resume_metainfo_with_control(
            ResumableMetainfoDownloadConfig {
                identity,
                metainfo_source: source.clone(),
                storage_root: root.clone(),
                network: loopback_network(Duration::from_secs(2)),
                peer_budget: PeerBudget::system_default(),
                mse_dh: crate::MseDhWorkOwner::new(),
                encryption: crate::PeerEncryptionPolicyHandle::default(),
                peer_exchange: crate::PeerExchangePolicyHandle::default(),
                torrent_peers: Some(peers),
                resource_limits: resource_limits(2 * MIN_PAYLOAD_ALLOWANCE),
                skip_files: vec![0],
                high_priority_files: Vec::new(),
                verified_pieces: vec![false; 3],
                resume_validation: ResumeValidationIntent::Full,
                download_missing: true,
                dht: None,
                trackers: None,
            },
            checkpoints.clone(),
            control,
        ),
    )
    .await
    .expect("bounded pure-v2 download")
    .expect("pure-v2 download");

    assert_eq!(report.info_hash, wire_hash);
    assert_eq!(report.verified_piece_count, 2);
    assert_eq!(report.skipped_piece_count, 1);
    assert_eq!(report.part_written_bytes, 0);
    assert!(!report.part_reopened);
    assert_eq!(tokio::fs::read(root.join("root/b")).await.unwrap(), large);
    assert!(!root.join("root/a").exists());
    while let Ok(piece) = requests.try_recv() {
        assert_ne!(piece, 0, "skipped v2 file piece was requested");
    }
    timeout(Duration::from_secs(1), peer_task)
        .await
        .expect("pure-v2 peer joined")
        .expect("pure-v2 peer task");
    let mut durable = checkpoints.batches();
    assert_eq!(durable.len(), 1);
    durable[0].sort_unstable();
    assert_eq!(durable, vec![vec![1, 2]]);

    let reopen_control = DownloadControl::new();
    let reopen_peers =
        TorrentPeerHandle::new(Arc::new(reopen_control.clone())).expect("reopen peer state");
    let reopen = resume_metainfo_with_control(
        ResumableMetainfoDownloadConfig {
            identity,
            metainfo_source: source,
            storage_root: root.clone(),
            network: loopback_network(Duration::from_secs(2)),
            peer_budget: PeerBudget::system_default(),
            mse_dh: crate::MseDhWorkOwner::new(),
            encryption: crate::PeerEncryptionPolicyHandle::default(),
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            torrent_peers: Some(reopen_peers),
            resource_limits: resource_limits(2 * MIN_PAYLOAD_ALLOWANCE),
            skip_files: vec![0],
            high_priority_files: Vec::new(),
            verified_pieces: vec![false, true, true],
            resume_validation: ResumeValidationIntent::Full,
            download_missing: false,
            dht: None,
            trackers: None,
        },
        Arc::new(RecordingCheckpointSink::default()),
        reopen_control,
    )
    .await
    .expect("pure-v2 direct reopen");
    assert_eq!(reopen.verified_piece_count, 2);
    assert!(!reopen.part_reopened);
    assert_eq!(tokio::fs::read(root.join("root/b")).await.unwrap(), large);

    let unavailable_peer = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("reserve unavailable v2 peer");
    let unavailable_address = unavailable_peer.local_addr().expect("peer address");
    drop(unavailable_peer);
    let candidate_control = DownloadControl::new();
    let candidate = timeout(
        Duration::from_secs(4),
        resume_magnet_with_control(
            ResumableMagnetDownloadConfig {
                identity,
                magnet: format!("magnet:?xt=urn:btmh:1220{v2_hash}&x.pe={unavailable_address}"),
                storage_root: root.clone(),
                network: loopback_network(Duration::from_secs(1)),
                peer_budget: PeerBudget::system_default(),
                mse_dh: crate::MseDhWorkOwner::new(),
                encryption: crate::PeerEncryptionPolicyHandle::default(),
                peer_exchange: crate::PeerExchangePolicyHandle::default(),
                torrent_peers: None,
                resource_limits: resource_limits(2 * MIN_PAYLOAD_ALLOWANCE),
                skip_files: vec![0],
                high_priority_files: Vec::new(),
                verified_info: Some(info_only),
                verified_pieces: vec![false, true, true],
                resume_validation: ResumeValidationIntent::FastEligible,
                download_missing: true,
                dht: None,
                trackers: Some(Vec::new()),
            },
            Arc::new(RecordingCheckpointSink::default()),
            candidate_control.clone(),
        ),
    )
    .await
    .expect("local reconstruction stays bounded")
    .expect("reconstruct complete v2 file without a peer");
    assert_eq!(candidate.verified_piece_count, 2);
    assert_eq!(candidate.bytes_written, 0);
    assert_eq!(tokio::fs::read(root.join("root/b")).await.unwrap(), large);
    tokio::fs::remove_dir_all(root)
        .await
        .expect("remove pure-v2 fixture root");
}

fn test_identity_from_outer(bytes: &[u8]) -> TorrentIdentityContext {
    let metainfo = Metainfo::from_bytes(bytes).expect("valid test metainfo");
    test_identity(metainfo.info_hash)
}

#[tokio::test]
async fn multi_piece_single_file_uses_torrent_offsets_and_publishes() {
    let payload = (0..(3 * 16 * 1024 + 731))
        .map(|index| ((index * 47 + index / 19) & 0xff) as u8)
        .collect::<Vec<_>>();
    let info = single_file_info_with_piece_length(&payload, 32 * 1024);
    let metainfo = Metainfo::from_info_bytes(&info).expect("multi-piece single-file metainfo");
    let pieces = payload
        .chunks(32 * 1024)
        .map(<[u8]>::to_vec)
        .collect::<Vec<_>>();
    assert_eq!(pieces.len(), 2);
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind multi-piece peer");
    let address = listener.local_addr().expect("multi-piece peer address");
    let peer_task = tokio::spawn(serve_content_peer(
        listener,
        metainfo.info_hash,
        Arc::new(pieces),
        vec![true; metainfo.piece_count()],
    ));
    let output = test_path("multi-piece-single-file.bin");
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        address,
        PeerSource::Manual,
        loopback_network(Duration::from_secs(2)),
    )
    .expect("peer session");

    let report = timeout(
        Duration::from_secs(3),
        run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: output.clone(),
                max_buffered_payload_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
                storage_intake_high_watermark_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
                swarm_config: SwarmConfig::for_request_limit(2 * MIN_PAYLOAD_ALLOWANCE),
                skip_files: Vec::new(),
                high_priority_files: Vec::new(),
            },
            metainfo,
            DownloadControl::new(),
            None,
            &mut peers,
            None,
        ),
    )
    .await
    .expect("bounded multi-piece single-file download")
    .expect("multi-piece single-file completion");

    assert_eq!(report.piece_count, 2);
    assert_eq!(report.verified_piece_count, 2);
    assert_eq!(report.bytes_written, payload.len());
    assert_eq!(report.selected_written_bytes, payload.len());
    assert_eq!(
        tokio::fs::read(&output).await.expect("direct file"),
        payload
    );
    timeout(Duration::from_secs(1), peer_task)
        .await
        .expect("multi-piece peer joined")
        .expect("multi-piece peer task");
    let _ = tokio::fs::remove_file(output).await;
}

#[tokio::test]
async fn one_entry_multi_file_uses_same_pipeline_and_publishes_a_tree() {
    let payload = (0..(2 * MIN_PAYLOAD_ALLOWANCE + 509))
        .map(|index| ((index * 41 + index / 29) & 0xff) as u8)
        .collect::<Vec<_>>();
    let info = one_entry_multi_file_info(&payload, MIN_PAYLOAD_ALLOWANCE);
    let metainfo = Metainfo::from_info_bytes(&info).expect("one-entry multi-file metainfo");
    let pieces = payload
        .chunks(MIN_PAYLOAD_ALLOWANCE)
        .map(<[u8]>::to_vec)
        .collect::<Vec<_>>();
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind one-entry peer");
    let address = listener.local_addr().expect("one-entry peer address");
    let peer_task = tokio::spawn(serve_content_peer(
        listener,
        metainfo.info_hash,
        Arc::new(pieces),
        vec![true; metainfo.piece_count()],
    ));
    let output = test_path("one-entry-multi");
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        address,
        PeerSource::Manual,
        loopback_network(Duration::from_secs(2)),
    )
    .expect("peer session");

    let report = run_content_download(
        ContentDownloadConfig {
            artifact_identity: test_artifact_identity(),
            output_path: output.clone(),
            max_buffered_payload_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
            storage_intake_high_watermark_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
            swarm_config: SwarmConfig::for_request_limit(2 * MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
        },
        metainfo,
        DownloadControl::new(),
        None,
        &mut peers,
        None,
    )
    .await
    .expect("one-entry multi-file completion");

    assert_eq!(report.bytes_written, payload.len());
    assert!(output.is_dir());
    assert_eq!(
        tokio::fs::read(output.join("payload.bin"))
            .await
            .expect("read one-entry completion"),
        payload
    );
    timeout(Duration::from_secs(1), peer_task)
        .await
        .expect("one-entry peer joined")
        .expect("one-entry peer task");
    tokio::fs::remove_dir_all(output)
        .await
        .expect("remove one-entry completion");
}

#[tokio::test]
async fn full_recheck_recovers_synced_single_file_with_empty_have() {
    let payload = (0..(3 * MIN_PAYLOAD_ALLOWANCE + 731))
        .map(|index| ((index * 43 + index / 17) & 0xff) as u8)
        .collect::<Vec<_>>();
    let raw_info = single_file_info_with_piece_length(&payload, 2 * MIN_PAYLOAD_ALLOWANCE);
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("recheck single-file metainfo");
    let root = test_path("full-recheck-empty-have");
    tokio::fs::create_dir(&root)
        .await
        .expect("create storage root");
    let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
        .expect("plan direct storage");
    let layout = TorrentLayout::from_metainfo(&metainfo);
    let selection = FileSelection::new(&layout, &[]).expect("all files wanted");
    let mut storage = SelectiveStorage::create_with_paths(
        paths.clone(),
        test_artifact_identity(),
        layout.clone(),
        selection.clone(),
    )
    .await
    .expect("create direct content storage");
    for piece_index in 0..layout.piece_count() {
        let piece_index_u32 = u32::try_from(piece_index).expect("bounded piece index");
        let piece_offset = piece_index * metainfo.piece_length as usize;
        for request in layout
            .request_ranges(piece_index_u32, &selection)
            .expect("piece request ranges")
        {
            let begin = request.begin as usize;
            storage
                .write_block(
                    piece_index_u32,
                    request.begin,
                    payload[piece_offset + begin..piece_offset + begin + request.length as usize]
                        .to_vec(),
                )
                .await
                .expect("write uncheckpointed piece bytes");
        }
        storage
            .sync_piece(piece_index_u32)
            .await
            .expect("sync before simulated process death");
        assert_eq!(
            storage
                .hash_piece(piece_index_u32)
                .await
                .expect("hash staged fixture"),
            metainfo.piece_hashes[piece_index]
        );
    }
    drop(storage);
    assert!(paths.content.exists());

    let unused_peer = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind unused recheck peer");
    let peer_address = unused_peer.local_addr().expect("unused peer address");
    let checkpoints = Arc::new(RecordingCheckpointSink::default());
    let result = resume_magnet(
        ResumableMagnetDownloadConfig {
            identity: test_identity(metainfo.info_hash),
            magnet: format!(
                "magnet:?xt=urn:btih:{}&x.pe={peer_address}",
                hex(&metainfo.info_hash)
            ),
            storage_root: root.clone(),
            network: loopback_network(Duration::from_secs(1)),
            peer_budget: PeerBudget::system_default(),
            mse_dh: crate::MseDhWorkOwner::new(),
            encryption: crate::PeerEncryptionPolicyHandle::default(),
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            torrent_peers: None,
            resource_limits: resource_limits(2 * MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            verified_info: Some(raw_info),
            verified_pieces: vec![false; layout.piece_count()],
            resume_validation: ResumeValidationIntent::Full,
            download_missing: true,
            dht: None,
            trackers: None,
        },
        checkpoints.clone(),
    )
    .await;
    assert!(
        result.is_ok(),
        "recover synced pieces without redownload: {result:?}; rechecks: {:?}",
        checkpoints.rechecks()
    );
    let report = result.expect("successful result checked above");

    assert_eq!(report.verified_piece_count, layout.piece_count());
    assert_eq!(report.bytes_written, 0);
    assert_eq!(
        checkpoints.rechecks(),
        vec![vec![true; layout.piece_count()]]
    );
    assert_eq!(
        tokio::fs::read(&paths.content)
            .await
            .expect("direct recovered payload"),
        payload
    );
    assert!(paths.content.exists());
    tokio::fs::remove_dir_all(root)
        .await
        .expect("remove recheck fixture");
}

#[tokio::test]
async fn fast_resume_accepts_complete_completion_without_checker_or_hashing() {
    let payload = (0..(2 * MIN_PAYLOAD_ALLOWANCE + 731))
        .map(|index| ((index * 29 + index / 11) & 0xff) as u8)
        .collect::<Vec<_>>();
    let raw_info = single_file_info_with_piece_length(&payload, MIN_PAYLOAD_ALLOWANCE);
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("fast-resume metainfo");
    let root = test_path("fast-resume-complete");
    tokio::fs::create_dir(&root)
        .await
        .expect("create storage root");
    let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
        .expect("plan storage");
    tokio::fs::write(&paths.content, &payload)
        .await
        .expect("write complete completion");
    let layout = TorrentLayout::from_metainfo(&metainfo);
    let checkpoints = Arc::new(RecordingCheckpointSink::default());
    let activity = Arc::new(RecordingActivitySink::default());
    let control = DownloadControl::new();
    control.set_activity_sink(activity.clone());
    let unused_peer = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind unused fast-resume peer");
    let peer_address = unused_peer.local_addr().expect("unused peer address");

    let report = resume_magnet_with_control(
        ResumableMagnetDownloadConfig {
            identity: test_identity(metainfo.info_hash),
            magnet: format!(
                "magnet:?xt=urn:btih:{}&x.pe={peer_address}",
                hex(&metainfo.info_hash)
            ),
            storage_root: root.clone(),
            network: loopback_network(Duration::from_secs(1)),
            peer_budget: PeerBudget::system_default(),
            mse_dh: crate::MseDhWorkOwner::new(),
            encryption: crate::PeerEncryptionPolicyHandle::default(),
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            torrent_peers: None,
            resource_limits: resource_limits(2 * MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            verified_info: Some(raw_info),
            verified_pieces: vec![true; layout.piece_count()],
            resume_validation: ResumeValidationIntent::FastEligible,
            download_missing: true,
            dht: None,
            trackers: Some(Vec::new()),
        },
        checkpoints.clone(),
        control,
    )
    .await
    .expect("accept complete fast resume");

    assert_eq!(report.bytes_written, 0);
    assert!(checkpoints.rechecks().is_empty());
    {
        let events = activity
            .events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(events.iter().any(|event| matches!(
            event,
            DownloadActivityEvent::FastResumeAccepted {
                committed_pieces,
                payload_bytes_read: 0,
                hash_jobs: 0,
                ..
            } if *committed_pieces == layout.piece_count()
        )));
        assert!(!events.iter().any(|event| matches!(
            event,
            DownloadActivityEvent::CheckerProgress(_)
                | DownloadActivityEvent::CheckerFinished { .. }
                | DownloadActivityEvent::PieceHashing { .. }
        )));
    }
    tokio::fs::remove_dir_all(root).await.expect("remove root");
}

#[tokio::test]
async fn unowned_completion_is_discovered_and_fully_rechecked() {
    let payload = (0..(2 * MIN_PAYLOAD_ALLOWANCE + 731))
        .map(|index| ((index * 41 + index / 13) & 0xff) as u8)
        .collect::<Vec<_>>();
    let raw_info = single_file_info_with_piece_length(&payload, MIN_PAYLOAD_ALLOWANCE);
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("discovery metainfo");
    let root = test_path("discover-complete-completion");
    tokio::fs::create_dir(&root)
        .await
        .expect("create discovery root");
    let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
        .expect("plan discovery storage");
    let mut oversized = payload.clone();
    oversized.extend_from_slice(b"unrelated suffix");
    tokio::fs::write(&paths.content, &oversized)
        .await
        .expect("write oversized existing completion");
    let layout = TorrentLayout::from_metainfo(&metainfo);
    let checkpoints = Arc::new(RecordingCheckpointSink::default());
    let activity = Arc::new(RecordingActivitySink::default());
    let control = DownloadControl::new();
    control.set_activity_sink(activity.clone());
    let unused_peer = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind unused discovery peer");
    let peer_address = unused_peer.local_addr().expect("unused peer address");

    let report = resume_magnet_with_control(
        ResumableMagnetDownloadConfig {
            identity: test_identity(metainfo.info_hash),
            magnet: format!(
                "magnet:?xt=urn:btih:{}&x.pe={peer_address}",
                hex(&metainfo.info_hash)
            ),
            storage_root: root.clone(),
            network: loopback_network(Duration::from_secs(1)),
            peer_budget: PeerBudget::system_default(),
            mse_dh: crate::MseDhWorkOwner::new(),
            encryption: crate::PeerEncryptionPolicyHandle::default(),
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            torrent_peers: None,
            resource_limits: resource_limits(2 * MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            verified_info: Some(raw_info),
            verified_pieces: vec![false; layout.piece_count()],
            resume_validation: ResumeValidationIntent::FastEligible,
            download_missing: true,
            dht: None,
            trackers: Some(Vec::new()),
        },
        checkpoints.clone(),
        control,
    )
    .await
    .expect("discover and check existing completion");

    assert_eq!(report.bytes_written, 0);
    assert_eq!(report.verified_piece_count, layout.piece_count());
    assert_eq!(
        checkpoints.rechecks(),
        vec![vec![true; layout.piece_count()]]
    );
    assert_eq!(
        checkpoints.discoveries(),
        vec![(ResumedStorage::Existing, 1, 1, 1)]
    );
    let stored = tokio::fs::read(&paths.content).await.unwrap();
    assert_eq!(stored.len(), oversized.len());
    assert!(stored.starts_with(&payload));
    assert!(stored.ends_with(b"unrelated suffix"));
    assert!(
        activity
            .events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .any(|event| matches!(
                event,
                DownloadActivityEvent::FastResumeRejected {
                    reason: ResumeValidationRejectReason::PendingVerification,
                    ..
                }
            ))
    );
    tokio::fs::remove_dir_all(root)
        .await
        .expect("remove discovery fixture");
}

#[tokio::test]
async fn cancelling_platform_fast_resume_drops_observation_without_admission() {
    let payload = vec![0x51; MIN_PAYLOAD_ALLOWANCE];
    let raw_info = single_file_info_with_piece_length(&payload, MIN_PAYLOAD_ALLOWANCE);
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("platform resume metainfo");
    let layout = TorrentLayout::from_metainfo(&metainfo);
    let (client, broker) = crate::platform_storage_channel();
    let pool = crate::StorageFilePool::new(4, Some(client)).expect("platform storage pool");
    let checkpoints = Arc::new(RecordingCheckpointSink::default());
    let activity = Arc::new(RecordingActivitySink::default());
    let control = DownloadControl::new();
    control.set_activity_sink(activity.clone());
    control.set_platform_storage(crate::PlatformStorageSpec {
        pool: pool.clone(),
        root_id: "downloads".to_owned(),
        storage_id: test_torrent_id().to_string(),
        content_name: metainfo.name.clone(),
        content_shape: crate::ContentShape::from_metainfo(&metainfo),
        storage_generation: 1,
    });
    let unused_peer = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind unused platform peer");
    let peer_address = unused_peer.local_addr().expect("unused peer address");
    let mut task = tokio::spawn(resume_magnet_with_control(
        ResumableMagnetDownloadConfig {
            identity: test_identity(metainfo.info_hash),
            magnet: format!(
                "magnet:?xt=urn:btih:{}&x.pe={peer_address}",
                hex(&metainfo.info_hash)
            ),
            storage_root: test_path("unused-platform-root"),
            network: loopback_network(Duration::from_secs(1)),
            peer_budget: PeerBudget::system_default(),
            mse_dh: crate::MseDhWorkOwner::new(),
            encryption: crate::PeerEncryptionPolicyHandle::default(),
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            torrent_peers: None,
            resource_limits: resource_limits(2 * MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            verified_info: Some(raw_info),
            verified_pieces: vec![true; layout.piece_count()],
            resume_validation: ResumeValidationIntent::FastEligible,
            download_missing: true,
            dht: None,
            trackers: Some(Vec::new()),
        },
        checkpoints.clone(),
        control.clone(),
    ));
    let request = tokio::select! {
        request = broker.next_request() => request.expect("validation observation"),
        result = &mut task => panic!("download ended before observation: {result:?}"),
    };
    assert_eq!(request.operation, crate::PlatformStorageOperation::Observe);
    assert_eq!(pool.snapshot().platform_pending, 1);
    control.cancel();
    assert!(matches!(
        timeout(Duration::from_secs(1), task)
            .await
            .expect("cancelled validation timed out")
            .expect("join cancelled validation"),
        Err(DownloadError::Cancelled)
    ));
    assert_eq!(pool.snapshot().platform_pending, 0);
    assert!(checkpoints.rechecks().is_empty());
    {
        let events = activity
            .events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(!events.iter().any(|event| matches!(
            event,
            DownloadActivityEvent::FastResumeAccepted { .. }
                | DownloadActivityEvent::FastResumeRejected { .. }
        )));
    }
    broker.cancel_all();
    pool.shutdown().await.expect("shutdown platform pool");
}

#[tokio::test]
async fn full_recheck_verifies_readable_skipped_pieces() {
    let first = vec![0x31; MIN_PAYLOAD_ALLOWANCE];
    let second = vec![0x72; MIN_PAYLOAD_ALLOWANCE];
    let torrent_bytes = two_piece_metainfo(&first, &second);
    let raw_info = Metainfo::info_bytes_with_limits(&torrent_bytes, BEP9_METAINFO_LIMITS)
        .expect("two-file raw info")
        .to_vec();
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("two-file recheck metainfo");
    let root = test_path("full-recheck-skipped-readable");
    tokio::fs::create_dir(&root)
        .await
        .expect("create storage root");
    let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
        .expect("direct paths");
    let layout = TorrentLayout::from_metainfo(&metainfo);
    let all_wanted = FileSelection::new(&layout, &[]).expect("all files wanted");
    let mut storage = SelectiveStorage::create_with_paths(
        paths.clone(),
        test_artifact_identity(),
        layout.clone(),
        all_wanted,
    )
    .await
    .expect("create content storage");
    for (piece_index, payload) in [first.as_slice(), second.as_slice()]
        .into_iter()
        .enumerate()
    {
        let piece_index = u32::try_from(piece_index).expect("piece index");
        storage
            .write_block(piece_index, 0, payload.to_vec())
            .await
            .expect("write staged piece");
        storage.sync_piece(piece_index).await.expect("sync piece");
    }
    drop(storage);

    let skipped = FileSelection::new(&layout, &[1]).expect("second file skipped");
    let (mut storage, resumed) = SelectiveStorage::resume_with_paths(
        paths,
        test_artifact_identity(),
        layout.clone(),
        skipped.clone(),
        vec![false; layout.piece_count()],
    )
    .await
    .expect("resume with skipped retained destination");
    assert_eq!(resumed, ResumedStorage::Existing);
    let control = DownloadControl::new();
    let activity = Arc::new(RecordingActivitySink::default());
    control.set_activity_sink(activity.clone());
    control.checker_started(1, layout.piece_count());
    let mut selection = AppliedFileSelection {
        selection: skipped,
        high_priority_files: Vec::new(),
        revision: 0,
    };
    let content = TorrentContent::from_v1_metainfo(metainfo.clone());
    let content_layout = ContentLayout::from_content(&content);
    let checked = full_recheck_storage(
        &mut storage,
        &content,
        &TorrentIntegrity::V1,
        &content_layout,
        &vec![false; layout.piece_count()],
        &mut selection,
        &control,
    )
    .await
    .expect("recheck skipped readable piece");
    control.checker_set_phase(CheckerPhase::Finalizing);

    assert_eq!(checked.verified, vec![true, true]);
    let finalizing = activity
        .events
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .iter()
        .filter_map(|event| match event {
            DownloadActivityEvent::CheckerProgress(progress)
                if progress.phase == CheckerPhase::Finalizing =>
            {
                Some(progress.as_ref())
            }
            _ => None,
        })
        .next_back()
        .expect("final checker progress")
        .clone();
    assert_eq!(finalizing.pieces_total, 2);
    assert_eq!(finalizing.pieces_processed, 2);
    assert_eq!(finalizing.pieces_matched, 2);
    assert_eq!(finalizing.bytes_hashed, (2 * MIN_PAYLOAD_ALLOWANCE) as u64);
    assert!(
        activity
            .events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .all(|event| !matches!(event, DownloadActivityEvent::PieceHashFailed { .. }))
    );
    control.checker_finished(1);
    assert!(control.checker_snapshot().is_none());

    tokio::fs::remove_dir_all(root)
        .await
        .expect("remove skipped recheck fixture");
}

#[tokio::test]
async fn selection_fence_and_slow_hash_heartbeat_share_one_check_generation() {
    let first = vec![0x19; MIN_PAYLOAD_ALLOWANCE];
    let second = vec![0x83; MIN_PAYLOAD_ALLOWANCE];
    let torrent_bytes = two_piece_metainfo(&first, &second);
    let raw_info = Metainfo::info_bytes_with_limits(&torrent_bytes, BEP9_METAINFO_LIMITS)
        .expect("two-file raw info")
        .to_vec();
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("two-file recheck metainfo");
    let root = test_path("selection-during-slow-recheck");
    tokio::fs::create_dir(&root)
        .await
        .expect("create storage root");
    let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
        .expect("direct paths");
    let layout = TorrentLayout::from_metainfo(&metainfo);
    let selection = FileSelection::new(&layout, &[]).expect("all files wanted");
    let mut storage = SelectiveStorage::create_with_paths(
        paths,
        test_artifact_identity(),
        layout.clone(),
        selection.clone(),
    )
    .await
    .expect("create staged storage");
    for (piece_index, payload) in [first, second].into_iter().enumerate() {
        let piece_index = u32::try_from(piece_index).expect("piece index");
        storage
            .write_block(piece_index, 0, payload)
            .await
            .expect("write staged piece");
        storage.sync_piece(piece_index).await.expect("sync piece");
    }

    let control = DownloadControl::new();
    control
        .set_storage_execution_limits_for_testing(1, 1)
        .expect("single checker job");
    control.set_storage_hash_delay(Duration::from_millis(1_100));
    let activity = Arc::new(RecordingActivitySink::default());
    control.set_activity_sink(activity.clone());
    control.checker_started(11, layout.piece_count());
    let task_control = control.clone();
    let task_content = TorrentContent::from_v1_metainfo(metainfo.clone());
    let task_content_layout = ContentLayout::from_content(&task_content);
    let task_piece_count = task_content_layout.piece_count();
    let task = tokio::spawn(async move {
        let mut selection = AppliedFileSelection {
            selection,
            high_priority_files: Vec::new(),
            revision: 0,
        };
        let result = full_recheck_storage(
            &mut storage,
            &task_content,
            &TorrentIntegrity::V1,
            &task_content_layout,
            &vec![false; task_piece_count],
            &mut selection,
            &task_control,
        )
        .await;
        (result, selection)
    });
    timeout(Duration::from_secs(1), async {
        while control
            .checker_snapshot()
            .is_none_or(|progress| progress.active_hash_jobs != 1)
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("first checker job did not start");
    control.update_file_selection(FileSelectionUpdate {
        revision: 7,
        skip_files: vec![1],
        high_priority_files: Vec::new(),
    });
    timeout(Duration::from_millis(1_050), async {
        loop {
            let heartbeat = activity
                .events
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .iter()
                .filter_map(|event| match event {
                    DownloadActivityEvent::CheckerProgress(progress)
                        if progress.phase == CheckerPhase::ReconcilingStorage
                            || progress
                                .oldest_active_job_age_millis
                                .is_some_and(|age| age >= 900) =>
                    {
                        Some(progress.as_ref().clone())
                    }
                    _ => None,
                })
                .next();
            if heartbeat.is_some_and(|progress| progress.active_hash_jobs == 1) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("slow hash did not publish a live heartbeat");

    assert!(control.pause_checking());
    timeout(Duration::from_secs(2), async {
        while control
            .checker_snapshot()
            .is_none_or(|progress| progress.phase != CheckerPhase::Paused)
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("checker did not drain into its paused phase");
    let paused = control.checker_snapshot().expect("paused checker snapshot");
    assert_eq!(paused.generation, 11);
    assert_eq!(paused.pieces_processed, 1);
    assert_eq!(paused.active_hash_jobs, 0);
    assert!(!task.is_finished());
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(
        control
            .checker_snapshot()
            .expect("retained paused checker")
            .pieces_processed,
        paused.pieces_processed
    );
    control.resume_checking();

    let (checked, final_selection) = timeout(Duration::from_secs(3), task)
        .await
        .expect("selection-aware checker did not finish")
        .expect("checker task joined");
    assert_eq!(checked.expect("checker result").verified, vec![true, true]);
    assert_eq!(final_selection.revision, 7);
    assert!(!final_selection.selection.is_wanted(1));
    assert_eq!(control.applied_file_selection_revision(), 7);
    let progress = activity
        .events
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .iter()
        .filter_map(|event| match event {
            DownloadActivityEvent::CheckerProgress(progress) => Some(progress.as_ref()),
            _ => None,
        })
        .cloned()
        .collect::<Vec<_>>();
    assert!(progress.iter().all(|progress| progress.generation == 11));
    assert!(
        progress
            .iter()
            .any(|progress| progress.phase == CheckerPhase::ReconcilingStorage)
    );
    assert!(
        progress
            .iter()
            .any(|progress| progress.phase == CheckerPhase::Paused)
    );
    assert!(
        progress
            .iter()
            .all(|progress| progress.active_hash_jobs <= 1)
    );

    tokio::fs::remove_dir_all(root)
        .await
        .expect("remove selection recheck fixture");
}

#[tokio::test]
async fn full_recheck_clears_stale_have_and_redownloads_only_corrupt_piece() {
    let payload = (0..(2 * MIN_PAYLOAD_ALLOWANCE))
        .map(|index| ((index * 29 + index / 11) & 0xff) as u8)
        .collect::<Vec<_>>();
    let raw_info = single_file_info_with_piece_length(&payload, MIN_PAYLOAD_ALLOWANCE);
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("stale-have metainfo");
    let pieces = Arc::new(
        payload
            .chunks(MIN_PAYLOAD_ALLOWANCE)
            .map(<[u8]>::to_vec)
            .collect::<Vec<_>>(),
    );
    let root = test_path("full-recheck-stale-have");
    tokio::fs::create_dir(&root)
        .await
        .expect("create storage root");
    let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
        .expect("plan direct storage");
    let layout = TorrentLayout::from_metainfo(&metainfo);
    let selection = FileSelection::new(&layout, &[]).expect("all files wanted");
    let mut storage = SelectiveStorage::create_with_paths(
        paths.clone(),
        test_artifact_identity(),
        layout.clone(),
        selection.clone(),
    )
    .await
    .expect("create staged payload");
    for piece_index in 0..layout.piece_count() {
        let piece_index_u32 = u32::try_from(piece_index).expect("bounded piece index");
        storage
            .write_block(piece_index_u32, 0, pieces[piece_index].clone())
            .await
            .expect("write staged piece");
        storage
            .sync_piece(piece_index_u32)
            .await
            .expect("sync staged piece");
    }
    drop(storage);

    let mut staged = tokio::fs::OpenOptions::new()
        .write(true)
        .open(&paths.content)
        .await
        .expect("open staged file for corruption");
    staged
        .seek(std::io::SeekFrom::Start(MIN_PAYLOAD_ALLOWANCE as u64))
        .await
        .expect("seek corrupt piece");
    staged
        .write_all(&[pieces[1][0] ^ 0xff])
        .await
        .expect("corrupt staged piece");
    staged.sync_all().await.expect("sync corruption");
    drop(staged);

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind repair peer");
    let peer_address = listener.local_addr().expect("repair peer address");
    let (requested_sender, mut requested_receiver) = mpsc::unbounded_channel();
    let peer_task = tokio::spawn(serve_content_peer_recording(
        listener,
        metainfo.info_hash,
        pieces,
        vec![true; layout.piece_count()],
        Duration::from_secs(2),
        Some(requested_sender),
    ));
    let checkpoints = Arc::new(RecordingCheckpointSink::default());
    let report = resume_magnet(
        ResumableMagnetDownloadConfig {
            identity: test_identity(metainfo.info_hash),
            magnet: format!(
                "magnet:?xt=urn:btih:{}&x.pe={peer_address}",
                hex(&metainfo.info_hash)
            ),
            storage_root: root.clone(),
            network: loopback_network(Duration::from_secs(2)),
            peer_budget: PeerBudget::system_default(),
            mse_dh: crate::MseDhWorkOwner::new(),
            encryption: crate::PeerEncryptionPolicyHandle::default(),
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            torrent_peers: None,
            resource_limits: resource_limits(2 * MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            verified_info: Some(raw_info),
            verified_pieces: vec![true; layout.piece_count()],
            resume_validation: ResumeValidationIntent::Full,
            download_missing: true,
            dht: None,
            trackers: None,
        },
        checkpoints.clone(),
    )
    .await
    .expect("repair corrupt staged piece");
    timeout(Duration::from_secs(1), peer_task)
        .await
        .expect("repair peer joined")
        .expect("repair peer task");
    let requested = std::iter::from_fn(|| requested_receiver.try_recv().ok()).collect::<Vec<_>>();

    assert_eq!(checkpoints.rechecks(), vec![vec![true, false]]);
    assert!(!requested.is_empty());
    assert!(requested.iter().all(|piece_index| *piece_index == 1));
    assert_eq!(report.bytes_written, MIN_PAYLOAD_ALLOWANCE);
    assert_eq!(report.verified_piece_count, 2);
    assert_eq!(
        tokio::fs::read(&paths.content)
            .await
            .expect("read repaired completion"),
        payload
    );
    tokio::fs::remove_dir_all(root)
        .await
        .expect("remove stale-have fixture");
}

#[tokio::test]
async fn outgoing_connection_uploads_verified_piece_before_torrent_completion() {
    let payload = (0..(2 * MIN_PAYLOAD_ALLOWANCE))
        .map(|index| ((index * 53 + index / 17) & 0xff) as u8)
        .collect::<Vec<_>>();
    let raw_info = single_file_info_with_piece_length(&payload, MIN_PAYLOAD_ALLOWANCE);
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("duplex metainfo");
    let pieces = Arc::new(
        payload
            .chunks(MIN_PAYLOAD_ALLOWANCE)
            .map(<[u8]>::to_vec)
            .collect::<Vec<_>>(),
    );
    let root = test_path("outgoing-incomplete-upload");
    tokio::fs::create_dir(&root)
        .await
        .expect("create duplex storage root");
    let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
        .expect("duplex paths");
    let layout = TorrentLayout::from_metainfo(&metainfo);
    let selection = FileSelection::new(&layout, &[]).expect("duplex selection");
    let mut storage = SelectiveStorage::create_with_paths(
        paths.clone(),
        test_artifact_identity(),
        layout.clone(),
        selection,
    )
    .await
    .expect("create duplex content");
    storage
        .write_block(0, 0, pieces[0].clone())
        .await
        .expect("stage local complementary piece");
    storage.sync_piece(0).await.expect("sync local piece");
    drop(storage);

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind duplex peer");
    let peer_address = listener.local_addr().expect("duplex peer address");
    let (uploaded_sender, uploaded_receiver) = oneshot::channel();
    let peer_task = tokio::spawn(serve_duplex_complementary_peer(
        listener,
        metainfo.info_hash,
        pieces.clone(),
        uploaded_sender,
    ));
    let checkpoints = Arc::new(RecordingCheckpointSink::default());
    let report = resume_magnet(
        ResumableMagnetDownloadConfig {
            identity: test_identity(metainfo.info_hash),
            magnet: format!(
                "magnet:?xt=urn:btih:{}&x.pe={peer_address}",
                hex(&metainfo.info_hash)
            ),
            storage_root: root.clone(),
            network: loopback_network(Duration::from_secs(3)),
            peer_budget: PeerBudget::system_default(),
            mse_dh: crate::MseDhWorkOwner::new(),
            encryption: crate::PeerEncryptionPolicyHandle::default(),
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            torrent_peers: None,
            resource_limits: resource_limits(2 * MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            verified_info: Some(raw_info),
            verified_pieces: vec![true, false],
            resume_validation: ResumeValidationIntent::Full,
            download_missing: true,
            dht: None,
            trackers: None,
        },
        checkpoints,
    )
    .await
    .expect("complete duplex download");
    let uploaded = timeout(Duration::from_secs(2), uploaded_receiver)
        .await
        .expect("bounded outgoing upload")
        .expect("outgoing upload observed");
    assert_eq!(uploaded, pieces[0]);
    assert_eq!(report.verified_piece_count, 2);
    timeout(Duration::from_secs(2), peer_task)
        .await
        .expect("duplex peer joined")
        .expect("duplex peer task");
    assert_eq!(
        tokio::fs::read(&paths.content)
            .await
            .expect("read duplex completion"),
        payload
    );
    tokio::fs::remove_dir_all(root)
        .await
        .expect("remove duplex fixture");
}

#[tokio::test]
async fn accepted_connection_uploads_and_downloads_before_torrent_completion() {
    let payload = (0..(2 * MIN_PAYLOAD_ALLOWANCE))
        .map(|index| ((index * 61 + index / 29) & 0xff) as u8)
        .collect::<Vec<_>>();
    let raw_info = single_file_info_with_piece_length(&payload, MIN_PAYLOAD_ALLOWANCE);
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("incoming duplex metainfo");
    let pieces = Arc::new(
        payload
            .chunks(MIN_PAYLOAD_ALLOWANCE)
            .map(<[u8]>::to_vec)
            .collect::<Vec<_>>(),
    );
    let root = test_path("incoming-incomplete-upload");
    tokio::fs::create_dir(&root)
        .await
        .expect("create incoming duplex storage root");
    let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
        .expect("incoming duplex paths");
    let layout = TorrentLayout::from_metainfo(&metainfo);
    let selection = FileSelection::new(&layout, &[]).expect("incoming duplex selection");
    let mut storage = SelectiveStorage::create_with_paths(
        paths.clone(),
        test_artifact_identity(),
        layout,
        selection,
    )
    .await
    .expect("create incoming duplex content");
    storage
        .write_block(0, 0, pieces[0].clone())
        .await
        .expect("stage incoming complementary piece");
    storage
        .sync_piece(0)
        .await
        .expect("sync incoming local piece");
    drop(storage);

    let idle_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind idle content peer");
    let idle_address = idle_listener.local_addr().expect("idle peer address");
    let idle_task = tokio::spawn(serve_permanently_choked_peer(
        idle_listener,
        metainfo.info_hash,
        vec![0],
    ));

    let peer_budget = PeerBudget::system_default();
    let mse_dh = crate::MseDhWorkOwner::new();
    let mut incoming_config =
        IncomingPeerServiceConfig::new(IncomingTcpBootstrap::AutomaticLoopback)
            .with_peer_budget(peer_budget.clone())
            .with_mse_dh(mse_dh.clone());
    incoming_config.peer_activity_timeout = Duration::from_secs(5);
    incoming_config.no_request_timeout = Duration::from_secs(5);
    incoming_config.inactivity_timeout = Duration::from_secs(5);
    let service = IncomingPeerService::bind(incoming_config)
        .await
        .expect("bind incoming peer service")
        .expect("incoming service enabled");
    let control = DownloadControl::new();
    control.set_incoming_peer_handle(service.handle());
    let torrent_peers =
        TorrentPeerHandle::new(Arc::new(control.clone())).expect("incoming torrent peer state");
    let checkpoints = Arc::new(RecordingCheckpointSink::default());
    let download_task = tokio::spawn(resume_magnet_with_control(
        ResumableMagnetDownloadConfig {
            identity: test_identity(metainfo.info_hash),
            magnet: format!(
                "magnet:?xt=urn:btih:{}&x.pe={idle_address}",
                hex(&metainfo.info_hash)
            ),
            storage_root: root.clone(),
            network: loopback_network(Duration::from_secs(3)),
            peer_budget,
            mse_dh,
            encryption: crate::PeerEncryptionPolicyHandle::default(),
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            torrent_peers: Some(torrent_peers),
            resource_limits: resource_limits(2 * MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            verified_info: Some(raw_info),
            verified_pieces: vec![true, false],
            resume_validation: ResumeValidationIntent::Full,
            download_missing: true,
            dht: None,
            trackers: None,
        },
        checkpoints,
        control.clone(),
    ));

    timeout(Duration::from_secs(3), async {
        loop {
            if service.snapshot().registrations == 1 {
                break;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("active incoming registration");
    assert!(control.incoming_content_routable());

    let (uploaded_sender, uploaded_receiver) = oneshot::channel();
    let incoming_task = tokio::spawn(serve_incoming_duplex_complementary_peer(
        service.listen_address(),
        metainfo.info_hash,
        pieces.clone(),
        uploaded_sender,
    ));
    let report = timeout(Duration::from_secs(8), download_task)
        .await
        .expect("bounded incoming duplex download")
        .expect("join incoming duplex download")
        .expect("complete incoming duplex download");
    let uploaded = timeout(Duration::from_secs(2), uploaded_receiver)
        .await
        .expect("bounded incoming upload")
        .expect("incoming upload observed");
    assert_eq!(uploaded, pieces[0]);
    assert_eq!(report.verified_piece_count, 2);
    assert!(!control.incoming_content_routable());
    timeout(Duration::from_secs(2), incoming_task)
        .await
        .expect("incoming duplex peer joined")
        .expect("incoming duplex peer task");
    timeout(Duration::from_secs(2), idle_task)
        .await
        .expect("idle peer joined")
        .expect("idle peer task");
    assert_eq!(service.snapshot().registrations, 0);
    let terminal = service.shutdown().await.expect("shutdown incoming service");
    assert_eq!(terminal.registrations, 0);
    assert_eq!(terminal.established, 0);
    assert_eq!(
        tokio::fs::read(&paths.content)
            .await
            .expect("read incoming duplex completion"),
        payload
    );
    tokio::fs::remove_dir_all(root)
        .await
        .expect("remove incoming duplex fixture");
}

/// Handshakes as an accepted peer, then announces pieces at a steady pace
/// that stays within the per-read message bound. Every Have becomes one
/// forwarded content event for the active download.
async fn announce_incoming_haves(
    address: SocketAddr,
    info_hash: [u8; 20],
    piece_count: u32,
    sent: Arc<AtomicUsize>,
) {
    let mut stream = TcpStream::connect(address)
        .await
        .expect("connect announcing peer");
    stream
        .write_all(&encode_handshake(info_hash, [73; 20]))
        .await
        .expect("send announcing handshake");
    let mut handshake = [0; HANDSHAKE_LENGTH];
    stream
        .read_exact(&mut handshake)
        .await
        .expect("read announcing handshake");
    decode_handshake(&handshake, info_hash).expect("valid announcing handshake");
    let (mut reader, mut writer) = stream.into_split();
    let drain = tokio::spawn(async move {
        let mut sink = vec![0; 64 * 1024];
        while matches!(reader.read(&mut sink).await, Ok(read) if read > 0) {}
    });
    let mut index = 0_u32;
    loop {
        let mut batch = Vec::new();
        for _ in 0..32 {
            batch.extend_from_slice(&[0, 0, 0, 5, 4]);
            batch.extend_from_slice(&index.to_be_bytes());
            index = (index + 1) % piece_count;
        }
        if writer.write_all(&batch).await.is_err() {
            break;
        }
        sent.fetch_add(32, Ordering::Relaxed);
        sleep(Duration::from_millis(2)).await;
    }
    drain.abort();
}

#[tokio::test]
async fn cancelling_backpressured_download_does_not_wait_on_incoming_peer() {
    const PIECES: usize = 32;
    let payload = (0..(PIECES * MIN_PAYLOAD_ALLOWANCE))
        .map(|index| ((index * 53 + index / 31) & 0xff) as u8)
        .collect::<Vec<_>>();
    let raw_info = single_file_info_with_piece_length(&payload, MIN_PAYLOAD_ALLOWANCE);
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("announcing peer metainfo");
    let pieces = Arc::new(
        payload
            .chunks(MIN_PAYLOAD_ALLOWANCE)
            .map(<[u8]>::to_vec)
            .collect::<Vec<_>>(),
    );
    let root = test_path("incoming-backpressure-cancel");
    tokio::fs::create_dir(&root)
        .await
        .expect("create announcing peer storage root");

    let source_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind content source");
    let source_address = source_listener
        .local_addr()
        .expect("content source address");
    let source_task = tokio::spawn(serve_content_peer_with_timeout(
        source_listener,
        metainfo.info_hash,
        pieces,
        vec![true; PIECES],
        Duration::from_secs(30),
    ));

    let peer_budget = PeerBudget::system_default();
    let mse_dh = crate::MseDhWorkOwner::new();
    let service = IncomingPeerService::bind(
        IncomingPeerServiceConfig::new(IncomingTcpBootstrap::AutomaticLoopback)
            .with_peer_budget(peer_budget.clone())
            .with_mse_dh(mse_dh.clone()),
    )
    .await
    .expect("bind announcing incoming service")
    .expect("announcing incoming service enabled");
    let control = DownloadControl::new();
    control.set_incoming_peer_handle(service.handle());
    // Slow writes hold the storage pipeline backpressured, which stops the
    // driver from polling inbound content events, as on a slow SAF provider.
    control.set_storage_write_delay(Duration::from_millis(400));
    let torrent_peers =
        TorrentPeerHandle::new(Arc::new(control.clone())).expect("announcing torrent peers");
    let checkpoints = Arc::new(RecordingCheckpointSink::default());
    let download_task = tokio::spawn(resume_magnet_with_control(
        ResumableMagnetDownloadConfig {
            identity: test_identity(metainfo.info_hash),
            magnet: format!(
                "magnet:?xt=urn:btih:{}&x.pe={source_address}",
                hex(&metainfo.info_hash)
            ),
            storage_root: root.clone(),
            network: loopback_network(Duration::from_secs(3)),
            peer_budget,
            mse_dh,
            encryption: crate::PeerEncryptionPolicyHandle::default(),
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            torrent_peers: Some(torrent_peers),
            resource_limits: resource_limits(4 * MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            verified_info: Some(raw_info),
            verified_pieces: vec![false; PIECES],
            resume_validation: ResumeValidationIntent::Full,
            download_missing: true,
            dht: None,
            trackers: None,
        },
        checkpoints,
        control.clone(),
    ));

    timeout(Duration::from_secs(3), async {
        while service.snapshot().registrations != 1 {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("active incoming registration");
    let sent = Arc::new(AtomicUsize::new(0));
    let announce_task = tokio::spawn(announce_incoming_haves(
        service.listen_address(),
        metainfo.info_hash,
        u32::try_from(PIECES).expect("piece count"),
        sent.clone(),
    ));
    timeout(Duration::from_secs(5), async {
        while control.snapshot().storage_jobs_pending == 0
            || sent.load(Ordering::Relaxed)
                < 4 * crate::torrent_peer::INCOMING_CONTENT_EVENT_CAPACITY
        {
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("storage backpressure while the inbound peer announces");
    sleep(Duration::from_millis(200)).await;
    assert_eq!(
        service.snapshot().established,
        1,
        "inbound peer stays attached"
    );

    // Removal pauses through this path. Teardown used to join the inbound
    // peer while it was parked on a full content-event queue nobody read.
    control.cancel_when_safe();
    let result = timeout(Duration::from_secs(15), download_task)
        .await
        .expect("cancelled download must not wait on the inbound peer")
        .expect("join cancelled download");
    assert!(
        matches!(result, Err(DownloadError::Cancelled)),
        "unexpected cancellation result {result:?}"
    );
    assert_eq!(service.snapshot().registrations, 0);
    timeout(Duration::from_secs(5), service.shutdown())
        .await
        .expect("bounded incoming service shutdown")
        .expect("shutdown incoming service");
    timeout(Duration::from_secs(5), announce_task)
        .await
        .expect("announcing peer observes disconnect")
        .expect("announcing peer task");
    source_task.abort();
    tokio::fs::remove_dir_all(root)
        .await
        .expect("remove announcing peer fixture");
}

#[tokio::test]
async fn incoming_contributor_survives_disconnect_until_delayed_hash_finishes() {
    let payload = Arc::new(
        (0..MIN_PAYLOAD_ALLOWANCE)
            .map(|index| ((index * 71 + index / 37) & 0xff) as u8)
            .collect::<Vec<_>>(),
    );
    let raw_info = single_file_info_with_piece_length(&payload, MIN_PAYLOAD_ALLOWANCE);
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("disconnecting peer metainfo");
    let root = test_path("incoming-disconnect-before-hash");
    tokio::fs::create_dir(&root)
        .await
        .expect("create disconnecting peer storage root");
    let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
        .expect("disconnecting peer paths");
    let idle_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind disconnecting peer idle source");
    let idle_address = idle_listener
        .local_addr()
        .expect("disconnecting peer idle address");
    let idle_task = tokio::spawn(serve_permanently_choked_peer(
        idle_listener,
        metainfo.info_hash,
        Vec::new(),
    ));

    let peer_budget = PeerBudget::system_default();
    let mse_dh = crate::MseDhWorkOwner::new();
    let service = IncomingPeerService::bind(
        IncomingPeerServiceConfig::new(IncomingTcpBootstrap::AutomaticLoopback)
            .with_peer_budget(peer_budget.clone())
            .with_mse_dh(mse_dh.clone()),
    )
    .await
    .expect("bind disconnecting incoming service")
    .expect("disconnecting incoming service enabled");
    let control = DownloadControl::new();
    control.set_storage_hash_delay(Duration::from_millis(300));
    control.set_incoming_peer_handle(service.handle());
    let torrent_peers =
        TorrentPeerHandle::new(Arc::new(control.clone())).expect("disconnecting torrent peers");
    let checkpoints = Arc::new(RecordingCheckpointSink::default());
    let download_task = tokio::spawn(resume_magnet_with_control(
        ResumableMagnetDownloadConfig {
            identity: test_identity(metainfo.info_hash),
            magnet: format!(
                "magnet:?xt=urn:btih:{}&x.pe={idle_address}",
                hex(&metainfo.info_hash)
            ),
            storage_root: root.clone(),
            network: loopback_network(Duration::from_secs(3)),
            peer_budget,
            mse_dh,
            encryption: crate::PeerEncryptionPolicyHandle::default(),
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            torrent_peers: Some(torrent_peers),
            resource_limits: resource_limits(2 * MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            verified_info: Some(raw_info),
            verified_pieces: vec![false],
            resume_validation: ResumeValidationIntent::Full,
            download_missing: true,
            dht: None,
            trackers: None,
        },
        checkpoints,
        control,
    ));

    timeout(Duration::from_secs(3), async {
        loop {
            if service.snapshot().registrations == 1 {
                break;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("disconnecting incoming registration");
    let incoming_task = tokio::spawn(serve_incoming_piece_then_disconnect(
        service.listen_address(),
        metainfo.info_hash,
        payload.clone(),
    ));
    incoming_task
        .await
        .expect("disconnecting incoming peer joined");

    let report = timeout(Duration::from_secs(5), download_task)
        .await
        .expect("delayed hash completed")
        .expect("join delayed hash download")
        .expect("disconnecting contributor remained attributable");
    assert_eq!(report.verified_piece_count, 1);
    timeout(Duration::from_secs(2), idle_task)
        .await
        .expect("disconnecting idle peer joined")
        .expect("disconnecting idle peer task");
    let terminal = service
        .shutdown()
        .await
        .expect("shutdown disconnecting incoming service");
    assert_eq!(terminal.registrations, 0);
    assert_eq!(terminal.established, 0);
    assert_eq!(
        tokio::fs::read(&paths.content)
            .await
            .expect("read disconnected contributor completion"),
        *payload
    );
    tokio::fs::remove_dir_all(root)
        .await
        .expect("remove disconnecting contributor fixture");
}

#[tokio::test]
async fn active_upload_read_failure_retracts_route_and_stops_generation() {
    let payload = (0..(2 * MIN_PAYLOAD_ALLOWANCE))
        .map(|index| ((index * 67 + index / 31) & 0xff) as u8)
        .collect::<Vec<_>>();
    let raw_info = single_file_info_with_piece_length(&payload, MIN_PAYLOAD_ALLOWANCE);
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("read-failure metainfo");
    let root = test_path("active-upload-read-failure");
    tokio::fs::create_dir(&root)
        .await
        .expect("create read-failure storage root");
    let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
        .expect("read-failure paths");
    let layout = TorrentLayout::from_metainfo(&metainfo);
    let selection = FileSelection::new(&layout, &[]).expect("read-failure selection");
    let mut storage = SelectiveStorage::create_with_paths(
        paths.clone(),
        test_artifact_identity(),
        layout,
        selection,
    )
    .await
    .expect("create read-failure content");
    storage
        .write_block(0, 0, payload[..MIN_PAYLOAD_ALLOWANCE].to_vec())
        .await
        .expect("stage verified read-failure piece");
    storage
        .sync_piece(0)
        .await
        .expect("sync verified read-failure piece");
    drop(storage);

    let idle_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind read-failure idle peer");
    let idle_address = idle_listener.local_addr().expect("idle peer address");
    let idle_task = tokio::spawn(serve_permanently_choked_peer(
        idle_listener,
        metainfo.info_hash,
        vec![0],
    ));
    let peer_budget = PeerBudget::system_default();
    let mse_dh = crate::MseDhWorkOwner::new();
    let service = IncomingPeerService::bind(
        IncomingPeerServiceConfig::new(IncomingTcpBootstrap::AutomaticLoopback)
            .with_peer_budget(peer_budget.clone())
            .with_mse_dh(mse_dh.clone()),
    )
    .await
    .expect("bind read-failure incoming service")
    .expect("read-failure service enabled");
    let control = DownloadControl::new();
    control.set_incoming_peer_handle(service.handle());
    let torrent_peers =
        TorrentPeerHandle::new(Arc::new(control.clone())).expect("read-failure peer state");
    let checkpoints = Arc::new(RecordingCheckpointSink::default());
    let download_task = tokio::spawn(resume_magnet_with_control(
        ResumableMagnetDownloadConfig {
            identity: test_identity(metainfo.info_hash),
            magnet: format!(
                "magnet:?xt=urn:btih:{}&x.pe={idle_address}",
                hex(&metainfo.info_hash)
            ),
            storage_root: root.clone(),
            network: loopback_network(Duration::from_secs(3)),
            peer_budget,
            mse_dh,
            encryption: crate::PeerEncryptionPolicyHandle::default(),
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            torrent_peers: Some(torrent_peers),
            resource_limits: resource_limits(2 * MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            verified_info: Some(raw_info),
            verified_pieces: vec![true, false],
            resume_validation: ResumeValidationIntent::Full,
            download_missing: true,
            dht: None,
            trackers: None,
        },
        checkpoints,
        control.clone(),
    ));

    timeout(Duration::from_secs(3), async {
        loop {
            if service.snapshot().registrations == 1 {
                break;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("active read-failure registration");
    assert!(control.incoming_content_routable());

    let mut stream = TcpStream::connect(service.listen_address())
        .await
        .expect("connect read-failure requester");
    stream
        .write_all(&encode_handshake(metainfo.info_hash, [73; 20]))
        .await
        .expect("send read-failure handshake");
    let mut handshake = [0; HANDSHAKE_LENGTH];
    stream
        .read_exact(&mut handshake)
        .await
        .expect("read read-failure handshake");
    decode_handshake(&handshake, metainfo.info_hash).expect("valid read-failure handshake");
    let mut peer = PeerConnection::for_test(test_dial_attempt(), stream, Duration::from_secs(3));
    loop {
        if next_peer_message(&mut peer)
            .await
            .expect("read initial active message")
            == PeerMessage::Bitfield(vec![0b1000_0000])
        {
            break;
        }
    }
    send_message(&mut peer, &PeerMessage::Interested)
        .await
        .expect("express read-failure interest");
    loop {
        if next_peer_message(&mut peer)
            .await
            .expect("read active unchoke")
            == PeerMessage::Unchoke
        {
            break;
        }
    }
    tokio::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(&paths.content)
        .await
        .expect("truncate active content payload");
    send_message(
        &mut peer,
        &PeerMessage::Request(rstorrent_protocol::peer_wire::BlockRequest {
            index: 0,
            begin: 0,
            length: u32::try_from(MIN_PAYLOAD_ALLOWANCE).expect("request length"),
        }),
    )
    .await
    .expect("request truncated active piece");

    let error = timeout(Duration::from_secs(5), download_task)
        .await
        .expect("read-failure generation stopped")
        .expect("join read-failure generation")
        .expect_err("active upload failure must stop the generation");
    assert!(matches!(
        error,
        DownloadError::SelectiveStorage(SelectiveStorageError::UnexpectedFileLength {
            file_index: 0,
            actual: 0,
            ..
        })
    ));
    assert!(!control.incoming_content_routable());
    assert_eq!(service.snapshot().registrations, 0);
    drop(peer);
    timeout(Duration::from_secs(2), idle_task)
        .await
        .expect("idle read-failure peer joined")
        .expect("idle read-failure peer task");
    let terminal = service
        .shutdown()
        .await
        .expect("shutdown read-failure service");
    assert_eq!(terminal.registrations, 0);
    assert_eq!(terminal.established, 0);
    tokio::fs::remove_dir_all(root)
        .await
        .expect("remove read-failure fixture");
}

#[tokio::test]
async fn cancelling_full_recheck_stops_admission_and_joins_bounded_hashes() {
    let payload = (0..(8 * MIN_PAYLOAD_ALLOWANCE))
        .map(|index| ((index * 37 + index / 19) & 0xff) as u8)
        .collect::<Vec<_>>();
    let raw_info = single_file_info_with_piece_length(&payload, MIN_PAYLOAD_ALLOWANCE);
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("cancel recheck metainfo");
    let root = test_path("full-recheck-cancel");
    tokio::fs::create_dir(&root)
        .await
        .expect("create storage root");
    let paths = torrent_storage_paths_for_metainfo(&root, &metainfo, test_torrent_id())
        .expect("plan direct storage");
    let layout = TorrentLayout::from_metainfo(&metainfo);
    let selection = FileSelection::new(&layout, &[]).expect("all files wanted");
    let mut storage = SelectiveStorage::create_with_paths(
        paths.clone(),
        test_artifact_identity(),
        layout.clone(),
        selection,
    )
    .await
    .expect("create staged payload");
    for piece_index in 0..layout.piece_count() {
        let piece_index_u32 = u32::try_from(piece_index).expect("bounded piece index");
        let offset = piece_index * MIN_PAYLOAD_ALLOWANCE;
        storage
            .write_block(
                piece_index_u32,
                0,
                payload[offset..offset + MIN_PAYLOAD_ALLOWANCE].to_vec(),
            )
            .await
            .expect("write staged piece");
        storage
            .sync_piece(piece_index_u32)
            .await
            .expect("sync staged piece");
    }
    drop(storage);

    let control = DownloadControl::new();
    control
        .set_storage_execution_limits_for_testing(1, 2)
        .expect("set bounded recheck concurrency");
    control.set_storage_hash_delay(Duration::from_millis(200));
    let task_control = control.clone();
    let checkpoints = Arc::new(RecordingCheckpointSink::default());
    let unused_peer = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind unused cancellation peer");
    let peer_address = unused_peer
        .local_addr()
        .expect("unused cancellation peer address");
    let task = tokio::spawn(resume_magnet_with_control(
        ResumableMagnetDownloadConfig {
            identity: test_identity(metainfo.info_hash),
            magnet: format!(
                "magnet:?xt=urn:btih:{}&x.pe={peer_address}",
                hex(&metainfo.info_hash)
            ),
            storage_root: root.clone(),
            network: loopback_network(Duration::from_secs(1)),
            peer_budget: PeerBudget::system_default(),
            mse_dh: crate::MseDhWorkOwner::new(),
            encryption: crate::PeerEncryptionPolicyHandle::default(),
            peer_exchange: crate::PeerExchangePolicyHandle::default(),
            torrent_peers: None,
            resource_limits: resource_limits(2 * MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            verified_info: Some(raw_info),
            verified_pieces: vec![false; layout.piece_count()],
            resume_validation: ResumeValidationIntent::Full,
            download_missing: true,
            dht: None,
            trackers: None,
        },
        checkpoints,
        task_control,
    ));
    timeout(Duration::from_secs(1), async {
        loop {
            if control.snapshot().storage_hash_operations_active == 2 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("two recheck hashes did not become active");
    control.cancel();
    assert!(matches!(
        timeout(Duration::from_secs(2), task)
            .await
            .expect("cancelled recheck timed out")
            .expect("join cancelled recheck"),
        Err(DownloadError::Cancelled)
    ));
    let progress = control.snapshot();
    assert_eq!(progress.storage_hash_operations_started, 2);
    assert_eq!(progress.storage_hash_operations_completed, 2);
    assert_eq!(progress.storage_hash_operations_active, 0);
    assert_eq!(progress.storage_hash_operations_active_high_water, 2);
    assert!(paths.content.exists());
    tokio::fs::remove_dir_all(root)
        .await
        .expect("remove cancellation fixture");
}

#[tokio::test]
async fn timeout_before_writes_leaves_no_content() {
    let metainfo_path = test_path("fixture.torrent");
    let output_path = test_path("output.bin");
    let mut metainfo = b"d4:infod6:lengthi1e4:name1:x12:piece lengthi16384e6:pieces20:".to_vec();
    metainfo.extend_from_slice(&[1; 20]);
    metainfo.extend_from_slice(b"ee");
    let identity = test_identity_from_outer(&metainfo);
    tokio::fs::write(&metainfo_path, metainfo)
        .await
        .expect("write metainfo");

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind scripted peer");
    let address = listener.local_addr().expect("listener address");
    let peer_task = tokio::spawn(async move {
        let (_stream, _) = listener.accept().await.expect("accept diagnostic");
        tokio::time::sleep(Duration::from_secs(1)).await;
    });

    let result = download_verified_piece(DownloadConfig {
        identity,
        metainfo_path: metainfo_path.clone(),
        peer: address,
        output_path: output_path.clone(),
        network: loopback_network(Duration::from_millis(50)),
        resource_limits: resource_limits(MIN_PAYLOAD_ALLOWANCE),
        skip_files: Vec::new(),
        high_priority_files: Vec::new(),
    })
    .await;

    assert!(matches!(result, Err(DownloadError::PeerTimedOut { .. })));
    assert!(
        !tokio::fs::try_exists(&output_path)
            .await
            .expect("output status")
    );
    peer_task.abort();
    let _ = peer_task.await;
    let _ = tokio::fs::remove_file(metainfo_path).await;
}

#[tokio::test]
async fn selective_timeout_before_writes_leaves_no_content_or_part() {
    let metainfo_path = test_path("selective-timeout.torrent");
    let output_path = test_path("selective-timeout");
    let part = selective_part_path(&output_path).expect("part path");
    tokio::fs::write(&metainfo_path, two_file_metainfo())
        .await
        .expect("write metainfo");

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind scripted peer");
    let address = listener.local_addr().expect("listener address");
    let peer_task = tokio::spawn(async move {
        let (_stream, _) = listener.accept().await.expect("accept diagnostic");
        tokio::time::sleep(Duration::from_secs(1)).await;
    });

    let result = download_verified_piece(DownloadConfig {
        identity: test_identity_from_outer(&two_file_metainfo()),
        metainfo_path: metainfo_path.clone(),
        peer: address,
        output_path: output_path.clone(),
        network: loopback_network(Duration::from_millis(50)),
        resource_limits: resource_limits(MIN_PAYLOAD_ALLOWANCE),
        skip_files: vec![1],
        high_priority_files: Vec::new(),
    })
    .await;

    assert!(matches!(result, Err(DownloadError::PeerTimedOut { .. })));
    assert!(!tokio::fs::try_exists(&output_path).await.expect("output"));
    assert!(!tokio::fs::try_exists(&part).await.expect("part"));

    peer_task.abort();
    let _ = peer_task.await;
    let _ = tokio::fs::remove_file(metainfo_path).await;
}

#[tokio::test]
async fn cancellation_before_writes_leaves_no_content_or_part() {
    let metainfo_path = test_path("selective-cancel.torrent");
    let output_path = test_path("selective-cancel");
    let part = selective_part_path(&output_path).expect("part path");
    tokio::fs::write(&metainfo_path, two_file_metainfo())
        .await
        .expect("write metainfo");

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind scripted peer");
    let address = listener.local_addr().expect("listener address");
    let peer_task = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept diagnostic");
        let mut handshake = [0; HANDSHAKE_LENGTH];
        stream
            .read_exact(&mut handshake)
            .await
            .expect("read diagnostic handshake");
        let mut end = [0; 1];
        assert_eq!(
            stream.read(&mut end).await.expect("wait for peer cleanup"),
            0
        );
    });

    let control = DownloadControl::new();
    let activity = Arc::new(RecordingActivitySink::default());
    control.set_activity_sink(activity.clone());
    let download_control = control.clone();
    let download_task = tokio::spawn(download_verified_piece_with_control(
        DownloadConfig {
            identity: test_identity_from_outer(&two_file_metainfo()),
            metainfo_path: metainfo_path.clone(),
            peer: address,
            output_path: output_path.clone(),
            network: loopback_network(Duration::from_secs(5)),
            resource_limits: resource_limits(MIN_PAYLOAD_ALLOWANCE),
            skip_files: vec![1],
            high_priority_files: Vec::new(),
        },
        download_control,
    ));

    assert!(
        !tokio::fs::try_exists(&part)
            .await
            .expect("part remains lazy")
    );
    timeout(Duration::from_secs(1), async {
        loop {
            if control
                .diagnostic_snapshot()
                .peer_connections
                .iter()
                .any(|peer| peer.lifecycle == PeerConnectionLifecycle::ProtocolHandshaking)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("engine direct active diagnostic peer");

    control.cancel();
    control.cancel();
    let result = download_task.await.expect("download task");
    assert!(matches!(result, Err(DownloadError::Cancelled)));
    assert!(control.is_cancelled());
    let progress = control.snapshot();
    assert_eq!(progress.buffered_payload_bytes, 0);
    assert_eq!(progress.requested_bytes, 0);
    assert_eq!(progress.received_bytes, 0);
    assert_eq!(progress.stored_bytes, 0);
    assert_eq!(progress.storage_jobs_pending, 0);
    assert_eq!(progress.outstanding_request_bytes, 0);
    assert!(control.diagnostic_snapshot().peer_connections.is_empty());
    assert!(!tokio::fs::try_exists(&output_path).await.expect("output"));
    assert!(!tokio::fs::try_exists(&part).await.expect("part"));

    timeout(Duration::from_secs(1), peer_task)
        .await
        .expect("diagnostic peer joined before terminal result")
        .expect("diagnostic peer task");
    {
        let events = activity
            .events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let peer_snapshots = events
            .iter()
            .filter_map(|event| match event {
                DownloadActivityEvent::PeerConnections { peers, .. } => Some(peers.as_slice()),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(peer_snapshots.iter().any(|peers| {
            peers
                .iter()
                .any(|peer| peer.lifecycle == PeerConnectionLifecycle::Disconnecting)
        }));
        assert!(peer_snapshots.last().is_some_and(|peers| peers.is_empty()));
    }
    let _ = tokio::fs::remove_file(metainfo_path).await;
}

#[tokio::test]
async fn preexisting_selective_part_file_is_preserved() {
    let metainfo_path = test_path("selective-existing.torrent");
    let output_path = test_path("selective-existing");
    let outer = two_file_metainfo();
    let identity = test_identity_from_outer(&outer);
    let metainfo = Metainfo::from_bytes(&outer).expect("parse metainfo");
    let paths = torrent_storage_paths_for_output_with_shape(
        output_path.clone(),
        identity.torrent_id(),
        ContentShape::from_metainfo(&metainfo),
    )
    .expect("storage paths");
    let part = paths.part;
    tokio::fs::write(&metainfo_path, outer)
        .await
        .expect("write metainfo");
    tokio::fs::write(&part, b"owned elsewhere")
        .await
        .expect("write existing part");
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind unused peer");
    let address = listener.local_addr().expect("listener address");

    let result = download_verified_piece(DownloadConfig {
        identity,
        metainfo_path: metainfo_path.clone(),
        peer: address,
        output_path: output_path.clone(),
        network: loopback_network(Duration::from_secs(1)),
        resource_limits: resource_limits(MIN_PAYLOAD_ALLOWANCE),
        skip_files: vec![1],
        high_priority_files: Vec::new(),
    })
    .await;
    assert!(matches!(
        result,
        Err(DownloadError::SelectiveStorage(
            SelectiveStorageError::ExistingPartFile(_)
        ))
    ));
    assert_eq!(
        tokio::fs::read(&part).await.expect("preserved part"),
        b"owned elsewhere"
    );

    let _ = tokio::fs::remove_dir_all(paths.content).await;
    let _ = tokio::fs::remove_file(part).await;
    let _ = tokio::fs::remove_file(metainfo_path).await;
}
