use super::*;

#[test]
fn maximum_piece_is_the_only_member_of_an_over_budget_plan_window() {
    let piece_length = rstorrent_protocol::metainfo::MAX_PIECE_LENGTH;
    let total_length = 3_u64 * u64::from(piece_length);
    let mut raw_info =
        format!("d6:lengthi{total_length}e4:name3:max12:piece lengthi{piece_length}e6:pieces60:")
            .into_bytes();
    raw_info.extend_from_slice(&[0; 60]);
    raw_info.push(b'e');
    let metainfo = Metainfo::from_info_bytes(&raw_info).expect("maximum-piece metainfo");
    let layout = ContentLayout::from(TorrentLayout::from_metainfo(&metainfo));
    let selection = FileSelection::new_content(&layout, &[]).expect("wanted selection");
    let mut pieces = vec![0, 1, 2].into_iter();

    let (plans, blocks, bytes) = build_content_plan_window(
        &layout,
        &selection,
        &mut pieces,
        256,
        128 * 1024 * 1024,
        true,
    )
    .expect("bounded plan window");

    assert_eq!(plans.len(), 1);
    assert_eq!(blocks, (piece_length as usize).div_ceil(16 * 1024));
    assert_eq!(bytes, piece_length as usize);
    assert_eq!(pieces.as_slice(), [1, 2]);
}

#[test]
fn half_open_dials_do_not_consume_established_connection_slots() {
    let mut config = SwarmConfig::for_request_limit(MIN_PAYLOAD_ALLOWANCE);
    config.max_established_connections = 2;
    config.max_pending_dials = 2;

    assert!(content_dial_slot_available(1, 1, config, false));
    assert!(!content_dial_slot_available(1, 2, config, false));
    assert!(!content_dial_slot_available(2, 0, config, false));
    assert!(content_dial_slot_available(2, 0, config, true));
    assert!(!content_dial_slot_available(2, 1, config, true));
}

#[test]
fn dry_swarm_probe_requires_every_ordinary_connection_action_to_be_exhausted() {
    let dry = crate::peer::PeerRegistryCounts {
        total: 3,
        not_connectable: 1,
        banned: 1,
        failure_limited: 1,
        ..crate::peer::PeerRegistryCounts::default()
    };
    assert!(dry_swarm_probe_available(dry, 0, 0, true, true));

    for blocked in [
        crate::peer::PeerRegistryCounts { eligible: 1, ..dry },
        crate::peer::PeerRegistryCounts { dialing: 1, ..dry },
        crate::peer::PeerRegistryCounts {
            connected: 1,
            ..dry
        },
        crate::peer::PeerRegistryCounts {
            backed_off: 1,
            ..dry
        },
        crate::peer::PeerRegistryCounts {
            failure_limited: 0,
            ..dry
        },
    ] {
        assert!(!dry_swarm_probe_available(blocked, 0, 0, true, true));
    }
    assert!(!dry_swarm_probe_available(dry, 1, 0, true, true));
    assert!(!dry_swarm_probe_available(dry, 0, 1, true, true));
    assert!(!dry_swarm_probe_available(dry, 0, 0, false, true));
    assert!(!dry_swarm_probe_available(dry, 0, 0, true, false));
}

#[test]
fn content_supervisor_owner_rotation_is_complete_and_stable() {
    let mut owner = ContentSupervisorOwner::Storage;
    let mut observed = Vec::new();
    for _ in 0..6 {
        observed.push(owner);
        owner = owner.next();
    }
    assert_eq!(
        observed,
        [
            ContentSupervisorOwner::Storage,
            ContentSupervisorOwner::Peer,
            ContentSupervisorOwner::Discovery,
            ContentSupervisorOwner::Storage,
            ContentSupervisorOwner::Peer,
            ContentSupervisorOwner::Discovery,
        ]
    );
}

#[test]
fn product_profiles_are_generous_and_fill_every_initial_peer_window() {
    assert_eq!(
        DownloadResourceLimits::DESKTOP,
        DownloadResourceLimits::new(256 * 1024 * 1024, 32 * 1024 * 1024, 256 * 1024 * 1024)
    );
    assert_eq!(
        DownloadResourceLimits::ANDROID,
        DownloadResourceLimits::new(128 * 1024 * 1024, 16 * 1024 * 1024, 128 * 1024 * 1024)
    );
    let initial_window_bytes = DEFAULT_MAX_ESTABLISHED_CONNECTIONS
        * DEFAULT_INITIAL_REQUESTS_PER_CONNECTION
        * MIN_PAYLOAD_ALLOWANCE;
    for limits in [
        DownloadResourceLimits::DESKTOP,
        DownloadResourceLimits::ANDROID,
    ] {
        assert_eq!(
            limits.metadata_connections,
            MetadataConnectionLimits::DEFAULT
        );
        assert!(limits.max_outstanding_request_bytes >= initial_window_bytes);
        assert!(limits.max_buffered_payload_bytes >= MIN_PAYLOAD_ALLOWANCE);
        assert_eq!(
            limits.storage_intake_high_watermark_bytes,
            DownloadResourceLimits::default_storage_intake_high_watermark(
                limits.max_buffered_payload_bytes
            )
        );
        assert!(limits.max_active_piece_bytes >= initial_window_bytes);
        limits.validate().expect("valid product profile");
    }
}

#[test]
fn metadata_connection_limits_validate_platform_defaults_and_hard_ceilings() {
    for limits in [
        DownloadResourceLimits::DESKTOP,
        DownloadResourceLimits::ANDROID,
    ] {
        assert_eq!(limits.metadata_connections.max_peers, 30);
        assert_eq!(limits.metadata_connections.max_attempts_per_second, 10);
        assert_eq!(
            limits.metadata_connections.saturated_no_progress_grace,
            Duration::from_secs(15)
        );
        limits
            .validate()
            .expect("valid metadata connection defaults");
    }

    let mut invalid = DownloadResourceLimits::DESKTOP;
    invalid.metadata_connections.max_peers = 0;
    assert!(matches!(
        invalid.validate(),
        Err(DownloadError::InvalidResourceLimit(
            "metadata peer count must be nonzero"
        ))
    ));
    invalid.metadata_connections.max_peers = MetadataConnectionLimits::MAX_PEERS + 1;
    assert!(matches!(
        invalid.validate(),
        Err(DownloadError::InvalidResourceLimit(
            "metadata peer count exceeds the hard ceiling"
        ))
    ));

    invalid = DownloadResourceLimits::DESKTOP;
    invalid.metadata_connections.max_attempts_per_second = 0;
    assert!(matches!(
        invalid.validate(),
        Err(DownloadError::InvalidResourceLimit(
            "metadata connection attempt rate must be nonzero"
        ))
    ));
    invalid.metadata_connections.max_attempts_per_second =
        MetadataConnectionLimits::MAX_ATTEMPTS_PER_SECOND + 1;
    assert!(matches!(
        invalid.validate(),
        Err(DownloadError::InvalidResourceLimit(
            "metadata connection attempt rate exceeds the hard ceiling"
        ))
    ));

    invalid = DownloadResourceLimits::DESKTOP;
    invalid.metadata_connections.saturated_no_progress_grace = Duration::ZERO;
    assert!(matches!(
        invalid.validate(),
        Err(DownloadError::InvalidResourceLimit(
            "metadata saturated no-progress grace must be nonzero"
        ))
    ));
    invalid.metadata_connections.saturated_no_progress_grace =
        MetadataConnectionLimits::MAX_SATURATED_NO_PROGRESS_GRACE + Duration::from_millis(1);
    assert!(matches!(
        invalid.validate(),
        Err(DownloadError::InvalidResourceLimit(
            "metadata saturated no-progress grace exceeds the hard ceiling"
        ))
    ));

    assert!(metadata_cohort_has_capacity(29, 0, 30));
    assert!(!metadata_cohort_has_capacity(29, 1, 30));
    assert!(!metadata_cohort_has_capacity(usize::MAX, 1, 30));
}

#[test]
fn outbound_attempt_sub_budgets_must_be_nonzero() {
    let mut network = loopback_network(Duration::from_secs(1));
    network.utp_fallback_timeout = Duration::ZERO;
    assert!(matches!(
        validate_network_config(network),
        Err(DownloadError::InvalidNetworkTimeout {
            operation: "uTP fallback"
        })
    ));

    network = loopback_network(Duration::from_secs(1));
    network.outgoing_handshake_timeout = Duration::ZERO;
    assert!(matches!(
        validate_network_config(network),
        Err(DownloadError::InvalidNetworkTimeout {
            operation: "outgoing handshake"
        })
    ));
}

#[test]
fn metadata_turnover_selects_oldest_expired_zero_contributor() {
    let now = Duration::from_secs(30);
    let grace = Duration::from_secs(15);
    let states = [
        MetadataWorkerTurnoverState {
            attempt_id: 4_u64,
            connected_at: Duration::from_secs(10),
            turnover_requested: false,
            contributed: true,
        },
        MetadataWorkerTurnoverState {
            attempt_id: 3_u64,
            connected_at: Duration::from_secs(10),
            turnover_requested: false,
            contributed: false,
        },
        MetadataWorkerTurnoverState {
            attempt_id: 2_u64,
            connected_at: Duration::from_secs(9),
            turnover_requested: true,
            contributed: false,
        },
        MetadataWorkerTurnoverState {
            attempt_id: 1_u64,
            connected_at: Duration::from_secs(16),
            turnover_requested: false,
            contributed: false,
        },
    ];
    assert_eq!(
        select_metadata_turnover_candidate(states, now, grace),
        Some(3)
    );
    assert_eq!(
        select_metadata_turnover_candidate(states, Duration::from_secs(24), grace),
        None
    );
}

#[test]
fn metadata_dial_pacer_spaces_attempts_without_catch_up_bursts() {
    let mut pacer = MetadataDialPacer::new(10);
    assert!(pacer.is_ready(Duration::ZERO));
    pacer.record_attempt(Duration::ZERO);
    assert_eq!(
        pacer.until_ready(Duration::from_millis(99)),
        Duration::from_millis(1)
    );
    assert!(!pacer.is_ready(Duration::from_millis(99)));
    assert!(pacer.is_ready(Duration::from_millis(100)));

    pacer.record_attempt(Duration::from_secs(1));
    assert_eq!(
        pacer.until_ready(Duration::from_secs(1)),
        Duration::from_millis(100)
    );
    assert!(!pacer.is_ready(Duration::from_millis(1_099)));
    assert!(pacer.is_ready(Duration::from_millis(1_100)));

    let mut maximum_rate = MetadataDialPacer::new(30);
    maximum_rate.record_attempt(Duration::ZERO);
    assert_eq!(
        maximum_rate.until_ready(Duration::ZERO),
        Duration::from_nanos(33_333_334)
    );
}

#[test]
fn storage_intake_watermark_must_fit_a_block_and_the_resident_ceiling() {
    let mut too_small = DownloadResourceLimits::DESKTOP;
    too_small.storage_intake_high_watermark_bytes = MIN_PAYLOAD_ALLOWANCE - 1;
    assert!(matches!(
        too_small.validate(),
        Err(DownloadError::InvalidResourceLimit(
            "storage intake high watermark must fit one request block"
        ))
    ));

    let mut too_large = DownloadResourceLimits::DESKTOP;
    too_large.storage_intake_high_watermark_bytes = too_large.max_buffered_payload_bytes + 1;
    assert!(matches!(
        too_large.validate(),
        Err(DownloadError::InvalidResourceLimit(
            "storage intake high watermark must not exceed the buffered payload allowance"
        ))
    ));
}

#[tokio::test]
async fn capable_peer_grows_pipeline_beyond_initial_request_window() {
    let payload = Arc::new(
        (0..(32 * MIN_PAYLOAD_ALLOWANCE))
            .map(|index| ((index * 31 + index / 23) & 0xff) as u8)
            .collect::<Vec<_>>(),
    );
    let info = single_file_info_with_piece_length(&payload, payload.len());
    let metainfo = Metainfo::from_info_bytes(&info).expect("window probe metainfo");
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind window probe peer");
    let address = listener.local_addr().expect("window probe address");
    let max_pending = Arc::new(AtomicUsize::new(0));
    let peer_task = tokio::spawn(serve_window_probe_peer(
        listener,
        metainfo.info_hash,
        payload.clone(),
        max_pending.clone(),
    ));
    let output = test_path("adaptive-window.bin");
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        address,
        PeerSource::Manual,
        loopback_network(Duration::from_secs(2)),
    )
    .expect("peer session");
    let control = DownloadControl::new();
    let payload_limit = payload.len();

    let report = timeout(
        Duration::from_secs(5),
        run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: output.clone(),
                max_buffered_payload_bytes: payload_limit,
                storage_intake_high_watermark_bytes: payload_limit,
                swarm_config: SwarmConfig::for_request_limit(payload_limit),
                skip_files: Vec::new(),
                high_priority_files: Vec::new(),
            },
            metainfo,
            control.clone(),
            None,
            &mut peers,
            None,
        ),
    )
    .await
    .expect("bounded window probe")
    .expect("window probe completion");

    assert_eq!(report.verified_piece_count, 1);
    assert_eq!(report.bytes_written, payload.len());
    assert!(
        max_pending.load(Ordering::Acquire) > DEFAULT_INITIAL_REQUESTS_PER_CONNECTION,
        "peer never observed the request window grow"
    );
    assert!(
        report.outstanding_request_high_water
            > DEFAULT_INITIAL_REQUESTS_PER_CONNECTION * MIN_PAYLOAD_ALLOWANCE
    );
    assert!(report.outstanding_request_high_water <= payload_limit);
    assert!(report.payload_high_water <= payload_limit);
    let swarm = control
        .diagnostic_snapshot()
        .swarm
        .expect("window diagnostics");
    assert!(swarm.request_target_max > DEFAULT_INITIAL_REQUESTS_PER_CONNECTION);
    assert_eq!(swarm.useful_payload_bytes, payload.len());
    assert_eq!(tokio::fs::read(&output).await.expect("output"), *payload);
    timeout(Duration::from_secs(1), peer_task)
        .await
        .expect("window peer joined")
        .expect("window peer task");
    let _ = tokio::fs::remove_file(output).await;
}

#[tokio::test]
async fn request_pipeline_exceeds_independently_bounded_resident_payload() {
    let payload = Arc::new(
        (0..(8 * MIN_PAYLOAD_ALLOWANCE))
            .map(|index| ((index * 17 + index / 11) & 0xff) as u8)
            .collect::<Vec<_>>(),
    );
    let info = single_file_info_with_piece_length(&payload, payload.len());
    let metainfo = Metainfo::from_info_bytes(&info).expect("resource split metainfo");
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind resource split peer");
    let address = listener.local_addr().expect("resource split address");
    let max_pending = Arc::new(AtomicUsize::new(0));
    let peer_task = tokio::spawn(serve_window_probe_peer(
        listener,
        metainfo.info_hash,
        payload.clone(),
        max_pending,
    ));
    let output = test_path("independent-resource-budgets.bin");
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        address,
        PeerSource::Manual,
        loopback_network(Duration::from_secs(2)),
    )
    .expect("peer session");
    let control = DownloadControl::new();
    control.set_storage_write_delay(Duration::from_millis(25));

    let report = timeout(
        Duration::from_secs(5),
        run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: output.clone(),
                max_buffered_payload_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
                storage_intake_high_watermark_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
                swarm_config: SwarmConfig::for_request_limit(8 * MIN_PAYLOAD_ALLOWANCE),
                skip_files: Vec::new(),
                high_priority_files: Vec::new(),
            },
            metainfo,
            control.clone(),
            None,
            &mut peers,
            None,
        ),
    )
    .await
    .expect("resource split deadline")
    .expect("resource split completion");

    assert_eq!(report.verified_piece_count, 1);
    assert!(report.payload_high_water <= 2 * MIN_PAYLOAD_ALLOWANCE);
    assert!(report.outstanding_request_high_water >= 4 * MIN_PAYLOAD_ALLOWANCE);
    assert!(report.outstanding_request_high_water > report.payload_high_water);
    assert_eq!(control.snapshot().buffered_payload_bytes, 0);
    timeout(Duration::from_secs(1), peer_task)
        .await
        .expect("resource split peer joined")
        .expect("resource split peer task");
    let _ = tokio::fs::remove_file(output).await;
}

#[tokio::test]
async fn multi_peer_split_availability_completes_and_joins_every_socket() {
    let first = vec![0x31; 16 * 1024];
    let second = vec![0x72; 16 * 1024];
    let metainfo =
        Metainfo::from_bytes(&two_piece_metainfo(&first, &second)).expect("two-piece metainfo");
    let peers_payload = Arc::new(vec![first.clone(), second.clone()]);
    let first_listener = TcpListener::bind("127.0.0.1:0").await.expect("bind A");
    let first_address = first_listener.local_addr().expect("address A");
    let second_listener = TcpListener::bind("127.0.0.1:0").await.expect("bind B");
    let second_address = second_listener.local_addr().expect("address B");
    let peer_a = tokio::spawn(serve_content_peer(
        first_listener,
        metainfo.info_hash,
        peers_payload.clone(),
        vec![true, false],
    ));
    let peer_b = tokio::spawn(serve_content_peer(
        second_listener,
        metainfo.info_hash,
        peers_payload,
        vec![false, true],
    ));

    let control = DownloadControl::new();
    let output = test_path("split-availability");
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        first_address,
        PeerSource::Manual,
        loopback_network(Duration::from_secs(2)),
    )
    .expect("peer session");
    peers
        .observe_address(second_address, PeerSource::Manual)
        .expect("second peer");
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
            control,
            None,
            &mut peers,
            None,
        ),
    )
    .await
    .expect("bounded multi-peer download")
    .expect("multi-peer download");

    assert_eq!(report.block_count, 2);
    assert_eq!(report.verified_piece_count, 2);
    assert!(report.payload_high_water <= 2 * MIN_PAYLOAD_ALLOWANCE);
    assert_eq!(
        tokio::fs::read(output.join("a")).await.expect("file A"),
        first
    );
    assert_eq!(
        tokio::fs::read(output.join("b")).await.expect("file B"),
        second
    );
    timeout(Duration::from_secs(1), peer_a)
        .await
        .expect("peer A joined")
        .expect("peer A task");
    timeout(Duration::from_secs(1), peer_b)
        .await
        .expect("peer B joined")
        .expect("peer B task");
    let _ = tokio::fs::remove_dir_all(output).await;
}

#[tokio::test]
async fn endgame_cancel_reaches_loser_before_slow_storage_completes() {
    let payload = vec![0x7d; MIN_PAYLOAD_ALLOWANCE];
    let metainfo =
        Metainfo::from_info_bytes(&single_file_info(&payload)).expect("endgame metainfo");
    let loser_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind endgame loser");
    let loser_address = loser_listener.local_addr().expect("loser address");
    let winner_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind endgame winner");
    let winner_address = winner_listener.local_addr().expect("winner address");
    let requests_ready = Arc::new(Barrier::new(2));
    let loser = tokio::spawn(serve_endgame_loser(
        loser_listener,
        metainfo.info_hash,
        requests_ready.clone(),
    ));
    let winner = tokio::spawn(serve_endgame_winner(
        winner_listener,
        metainfo.info_hash,
        payload.clone(),
        requests_ready,
    ));
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        loser_address,
        PeerSource::Manual,
        loopback_network(Duration::from_secs(2)),
    )
    .expect("peer session");
    peers
        .observe_address(winner_address, PeerSource::Manual)
        .expect("winner peer");
    let control = DownloadControl::new();
    control.set_storage_write_delay(Duration::from_millis(250));
    let task_control = control.clone();
    let output = test_path("endgame-cancel.bin");
    let task_output = output.clone();
    let mut download = tokio::spawn(async move {
        run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: task_output,
                max_buffered_payload_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
                storage_intake_high_watermark_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
                swarm_config: SwarmConfig::for_request_limit(2 * MIN_PAYLOAD_ALLOWANCE),
                skip_files: Vec::new(),
                high_priority_files: Vec::new(),
            },
            metainfo,
            task_control,
            None,
            &mut peers,
            None,
        )
        .await
    });

    let (request, cancel) = timeout(Duration::from_secs(2), loser)
        .await
        .expect("loser observed cancellation")
        .expect("loser task");
    assert_eq!(cancel, request);
    assert!(
        !download.is_finished(),
        "cancel must be emitted before the storage delay completes"
    );
    let report = timeout(Duration::from_secs(3), &mut download)
        .await
        .expect("endgame download deadline")
        .expect("download task")
        .expect("endgame completion");
    assert_eq!(report.verified_piece_count, 1);
    assert_eq!(report.payload_high_water, MIN_PAYLOAD_ALLOWANCE);
    assert_eq!(
        report.outstanding_request_high_water,
        2 * MIN_PAYLOAD_ALLOWANCE
    );
    assert_eq!(
        tokio::fs::read(&output).await.expect("endgame output"),
        payload
    );
    timeout(Duration::from_secs(1), winner)
        .await
        .expect("winner joined")
        .expect("winner task");
    let swarm = control
        .diagnostic_snapshot()
        .swarm
        .expect("terminal swarm diagnostics");
    assert_eq!(swarm.endgame_assignments, 1);
    assert_eq!(swarm.cancelled_request_attempts, 1);
    assert_eq!(swarm.active_request_attempts, 0);
    let _ = tokio::fs::remove_file(output).await;
}

#[tokio::test]
async fn sole_corrupt_source_is_banned_and_clean_peer_retries_piece() {
    let payload = (0..MIN_PAYLOAD_ALLOWANCE)
        .map(|index| ((index * 29 + index / 11) & 0xff) as u8)
        .collect::<Vec<_>>();
    let mut corrupt = payload.clone();
    corrupt[37] ^= 0x80;
    let metainfo =
        Metainfo::from_info_bytes(&single_file_info(&payload)).expect("hash retry metainfo");
    let corrupt_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind corrupt peer");
    let corrupt_address = corrupt_listener.local_addr().expect("corrupt address");
    let clean_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind clean peer");
    let clean_address = clean_listener.local_addr().expect("clean address");
    let corrupt_task = tokio::spawn(serve_content_peer(
        corrupt_listener,
        metainfo.info_hash,
        Arc::new(vec![corrupt]),
        vec![true],
    ));
    let clean_task = tokio::spawn(serve_content_peer(
        clean_listener,
        metainfo.info_hash,
        Arc::new(vec![payload.clone()]),
        vec![true],
    ));
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        corrupt_address,
        PeerSource::Manual,
        loopback_network(Duration::from_secs(2)),
    )
    .expect("peer session");
    peers
        .observe_address(clean_address, PeerSource::Manual)
        .expect("clean peer");
    let mut swarm_config = SwarmConfig::for_request_limit(MIN_PAYLOAD_ALLOWANCE);
    swarm_config.max_established_connections = 1;
    swarm_config.max_pending_dials = 1;
    let control = DownloadControl::new();
    let activity = Arc::new(RecordingActivitySink::default());
    control.set_activity_sink(activity.clone());
    let metrics = Arc::new(RecordingByteMetricSink::default());
    control.set_byte_metric_sink(metrics.clone());
    let output = test_path("piece-hash-retry.bin");

    let report = timeout(
        Duration::from_secs(3),
        run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: output.clone(),
                max_buffered_payload_bytes: MIN_PAYLOAD_ALLOWANCE,
                storage_intake_high_watermark_bytes: MIN_PAYLOAD_ALLOWANCE,
                swarm_config,
                skip_files: Vec::new(),
                high_priority_files: Vec::new(),
            },
            metainfo,
            control.clone(),
            None,
            &mut peers,
            None,
        ),
    )
    .await
    .expect("bounded hash recovery")
    .expect("clean peer completes failed piece");

    assert_eq!(report.verified_piece_count, 1);
    assert_eq!(report.selected_written_bytes, 2 * payload.len());
    assert_eq!(
        tokio::fs::read(&output).await.expect("direct output"),
        payload
    );
    let snapshot = control
        .diagnostic_snapshot()
        .swarm
        .expect("hash failure diagnostics");
    assert_eq!(snapshot.piece_hash_failures, 1);
    assert_eq!(snapshot.failed_piece_bytes, MIN_PAYLOAD_ALLOWANCE);
    assert_eq!(snapshot.last_hash_failure_contributors, 1);
    assert_eq!(snapshot.active_request_attempts, 0);
    assert_eq!(snapshot.outstanding_request_bytes, 0);
    assert_eq!(
        metrics.bytes(ByteMetric::PayloadReceived),
        2 * payload.len() as u64
    );
    assert_eq!(
        metrics.bytes(ByteMetric::StagedWrite),
        2 * payload.len() as u64
    );
    assert_eq!(
        metrics.bytes(ByteMetric::PayloadVerified),
        payload.len() as u64
    );
    assert_eq!(
        metrics.bytes(ByteMetric::PayloadHashFailed),
        payload.len() as u64
    );
    assert_eq!(
        metrics.bytes(ByteMetric::LogicalHashRead),
        2 * payload.len() as u64
    );
    assert!(
        metrics.bytes(ByteMetric::PeerWireReceived) > 2 * payload.len() as u64,
        "peer wire bytes were {}",
        metrics.bytes(ByteMetric::PeerWireReceived),
    );
    assert_eq!(
        metrics.bytes(ByteMetric::PeerWireReceived),
        metrics.bytes(ByteMetric::PayloadReceived)
            + metrics.bytes(ByteMetric::PeerProtocolReceived)
            + metrics.bytes(ByteMetric::MetadataPayloadReceived)
            + metrics.bytes(ByteMetric::PeerUnclassifiedReceived),
    );
    assert_eq!(
        metrics.bytes(ByteMetric::PeerWireSent),
        metrics.bytes(ByteMetric::PeerProtocolSent)
            + metrics.bytes(ByteMetric::MetadataPayloadSent)
            + metrics.bytes(ByteMetric::PeerUnclassifiedSent),
    );
    let corrupt_record = peers
        .peers
        .with_state(|state| {
            state
                .registry
                .find_endpoint(PeerEndpoint::new(corrupt_address).expect("corrupt endpoint"))
                .cloned()
        })
        .expect("corrupt record");
    assert_eq!(corrupt_record.phase(), crate::peer::PeerPhase::Banned);
    assert_eq!(corrupt_record.integrity().trust_points, -2);
    assert_eq!(corrupt_record.integrity().hash_failures, 1);
    let clean_record = peers
        .peers
        .with_state(|state| {
            state
                .registry
                .find_endpoint(PeerEndpoint::new(clean_address).expect("clean endpoint"))
                .cloned()
        })
        .expect("clean record");
    assert_eq!(clean_record.integrity().trust_points, 1);
    assert_eq!(clean_record.integrity().valid_pieces, 1);
    {
        let events = activity
            .events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(events.iter().any(|event| matches!(
            event,
            DownloadActivityEvent::PieceHashFailed {
                piece_index: 0,
                contributor_count: 1,
                failed_bytes: MIN_PAYLOAD_ALLOWANCE,
            }
        )));
        assert_eq!(
            events
                .iter()
                .filter_map(|event| match event {
                    DownloadActivityEvent::PieceStarted {
                        piece_index: 0,
                        attempt,
                        ..
                    } => Some(*attempt),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(
                    event,
                    DownloadActivityEvent::PieceHashing { piece_index: 0 }
                ))
                .count(),
            2
        );
    }
    for task in [corrupt_task, clean_task] {
        timeout(Duration::from_secs(1), task)
            .await
            .expect("hash recovery peer joined")
            .expect("hash recovery peer task");
    }
    let _ = tokio::fs::remove_file(output).await;
}

#[tokio::test]
async fn ambiguous_corrupt_generation_records_suspects_without_false_bans() {
    let payload = (0..(2 * MIN_PAYLOAD_ALLOWANCE))
        .map(|index| ((index * 17 + index / 13) & 0xff) as u8)
        .collect::<Vec<_>>();
    let mut corrupt = payload.clone();
    corrupt[17] ^= 0x40;
    corrupt[MIN_PAYLOAD_ALLOWANCE + 17] ^= 0x40;
    let info = single_file_info_with_piece_length(&payload, payload.len());
    let metainfo = Metainfo::from_info_bytes(&info).expect("ambiguous hash metainfo");
    let first_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind first suspect");
    let first_address = first_listener.local_addr().expect("first suspect address");
    let second_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind second suspect");
    let second_address = second_listener
        .local_addr()
        .expect("second suspect address");
    let clean_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind clean generation");
    let clean_address = clean_listener.local_addr().expect("clean address");
    let first_task = tokio::spawn(serve_one_block_then_choke_peer(
        first_listener,
        metainfo.info_hash,
        Arc::new(corrupt),
    ));
    let second_task = tokio::spawn(serve_one_block_then_choke_peer(
        second_listener,
        metainfo.info_hash,
        Arc::new(payload.clone()),
    ));
    let clean_task = tokio::spawn(serve_content_peer(
        clean_listener,
        metainfo.info_hash,
        Arc::new(vec![payload.clone()]),
        vec![true],
    ));
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        first_address,
        PeerSource::Manual,
        loopback_network(Duration::from_secs(2)),
    )
    .expect("peer session");
    peers
        .observe_address(second_address, PeerSource::Manual)
        .expect("second suspect");
    peers
        .observe_address(clean_address, PeerSource::Manual)
        .expect("clean peer");
    let mut swarm_config = SwarmConfig::for_request_limit(2 * MIN_PAYLOAD_ALLOWANCE);
    swarm_config.max_established_connections = 2;
    swarm_config.max_pending_dials = 1;
    swarm_config.unproductive_grace = Duration::from_millis(50);
    let control = DownloadControl::new();
    let output = test_path("ambiguous-piece-hash-retry.bin");

    let report = timeout(
        Duration::from_secs(3),
        run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: output.clone(),
                max_buffered_payload_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
                storage_intake_high_watermark_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
                swarm_config,
                skip_files: Vec::new(),
                high_priority_files: Vec::new(),
            },
            metainfo,
            control.clone(),
            None,
            &mut peers,
            None,
        ),
    )
    .await
    .expect("bounded ambiguous recovery")
    .expect("clean generation completes");

    assert_eq!(report.verified_piece_count, 1);
    assert_eq!(report.selected_written_bytes, 2 * payload.len());
    assert_eq!(
        tokio::fs::read(&output).await.expect("direct output"),
        payload
    );
    let snapshot = control
        .diagnostic_snapshot()
        .swarm
        .expect("ambiguous hash diagnostics");
    assert_eq!(snapshot.piece_hash_failures, 1);
    assert_eq!(snapshot.failed_piece_bytes, payload.len());
    assert_eq!(snapshot.last_hash_failure_contributors, 2);
    for address in [first_address, second_address] {
        let record = peers
            .peers
            .with_state(|state| {
                state
                    .registry
                    .find_endpoint(PeerEndpoint::new(address).expect("suspect endpoint"))
                    .cloned()
            })
            .expect("suspect record");
        assert_ne!(record.phase(), crate::peer::PeerPhase::Banned);
        assert_eq!(record.integrity().trust_points, -2);
        assert_eq!(record.integrity().hash_failures, 1);
        assert!(record.integrity().on_parole);
    }
    let clean_record = peers
        .peers
        .with_state(|state| {
            state
                .registry
                .find_endpoint(PeerEndpoint::new(clean_address).expect("clean endpoint"))
                .cloned()
        })
        .expect("clean record");
    assert_eq!(clean_record.integrity().trust_points, 1);
    for task in [first_task, second_task, clean_task] {
        timeout(Duration::from_secs(1), task)
            .await
            .expect("ambiguous recovery peer joined")
            .expect("ambiguous recovery peer task");
    }
    let _ = tokio::fs::remove_file(output).await;
}

#[tokio::test]
async fn disconnect_and_choke_reassign_only_their_outstanding_blocks() {
    run_adverse_reassignment_case(AdverseRequestAction::Disconnect).await;
    run_adverse_reassignment_case(AdverseRequestAction::Choke).await;
}

#[tokio::test]
async fn useful_peer_at_end_of_full_pending_cohort_completes_promptly() {
    assert_eq!(DEFAULT_MAX_PENDING_DIALS, 30);
    let first = vec![0x13; 16 * 1024];
    let second = vec![0x57; 16 * 1024];
    let metainfo =
        Metainfo::from_bytes(&two_piece_metainfo(&first, &second)).expect("two-piece metainfo");
    let mut silent_addresses = Vec::new();
    let mut silent_tasks = Vec::new();
    for _ in 1..DEFAULT_MAX_PENDING_DIALS {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind silent peer");
        silent_addresses.push(listener.local_addr().expect("silent address"));
        silent_tasks.push(tokio::spawn(accept_handshake_without_reply(listener)));
    }
    let useful = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind useful peer");
    let useful_address = useful.local_addr().expect("useful address");
    let useful_task = tokio::spawn(serve_content_peer(
        useful,
        metainfo.info_hash,
        Arc::new(vec![first, second]),
        vec![true, true],
    ));
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        silent_addresses[0],
        PeerSource::Manual,
        loopback_network(Duration::from_secs(5)),
    )
    .expect("peer session");
    for address in &silent_addresses[1..] {
        peers
            .observe_address(*address, PeerSource::Manual)
            .expect("silent peer");
    }
    peers
        .observe_address(useful_address, PeerSource::Manual)
        .expect("30th useful peer");
    let output = test_path("silent-handshake-parallel");
    let report = timeout(
        Duration::from_secs(2),
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
    .expect("silent handshakes did not serialize progress")
    .expect("useful peer completed");
    assert_eq!(report.verified_piece_count, 2);
    silent_tasks.push(useful_task);
    for task in silent_tasks {
        timeout(Duration::from_secs(1), task)
            .await
            .expect("peer joined")
            .expect("peer task");
    }
    let _ = tokio::fs::remove_dir_all(output).await;
}

#[tokio::test]
async fn cancellation_joins_a_full_silent_pending_cohort() {
    let payload = vec![0x31; 16 * 1024];
    let metainfo =
        Metainfo::from_info_bytes(&single_file_info(&payload)).expect("single-piece metainfo");
    let accepted = Arc::new(AtomicUsize::new(0));
    let mut addresses = Vec::new();
    let mut tasks = Vec::new();
    for _ in 0..DEFAULT_MAX_PENDING_DIALS {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind silent peer");
        addresses.push(listener.local_addr().expect("silent address"));
        tasks.push(tokio::spawn(accept_handshake_without_reply_and_count(
            listener,
            Some(accepted.clone()),
        )));
    }
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        addresses[0],
        PeerSource::Manual,
        loopback_network(Duration::from_secs(5)),
    )
    .expect("peer session");
    for address in &addresses[1..] {
        peers
            .observe_address(*address, PeerSource::Manual)
            .expect("silent peer");
    }
    let output = test_path("full-silent-pending-cancel.bin");
    let control = DownloadControl::new();
    let task_output = output.clone();
    let task_control = control.clone();
    let download = tokio::spawn(async move {
        let result = run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: task_output,
                max_buffered_payload_bytes: MIN_PAYLOAD_ALLOWANCE,
                storage_intake_high_watermark_bytes: MIN_PAYLOAD_ALLOWANCE,
                swarm_config: SwarmConfig::for_request_limit(MIN_PAYLOAD_ALLOWANCE),
                skip_files: Vec::new(),
                high_priority_files: Vec::new(),
            },
            metainfo,
            task_control,
            None,
            &mut peers,
            None,
        )
        .await;
        (result, peers)
    });
    let all_started = timeout(Duration::from_secs(2), async {
        while accepted.load(Ordering::Acquire) < DEFAULT_MAX_PENDING_DIALS {
            tokio::task::yield_now().await;
        }
    })
    .await;
    assert!(
        all_started.is_ok(),
        "only {} of {DEFAULT_MAX_PENDING_DIALS} pending handshakes started",
        accepted.load(Ordering::Acquire)
    );
    control.cancel();
    let (result, peers) = timeout(Duration::from_secs(1), download)
        .await
        .expect("download joined")
        .expect("download task");
    assert!(matches!(result, Err(DownloadError::Cancelled)));
    assert_eq!(accepted.load(Ordering::Acquire), DEFAULT_MAX_PENDING_DIALS);
    assert!(peers.peers.with_state(|state| {
        state
            .registry
            .records()
            .all(|record| record.phase() == PeerPhase::Idle)
    }));
    for task in tasks {
        timeout(Duration::from_secs(1), task)
            .await
            .expect("silent peer joined")
            .expect("silent peer task");
    }
    assert!(!output.exists());
    let content = output.clone();
    assert!(
        !content.exists(),
        "cancellation before the first write leaves no empty artifact"
    );
}

#[tokio::test]
async fn full_choked_set_is_replaced_by_an_eligible_useful_peer() {
    let first = vec![0x21; 16 * 1024];
    let second = vec![0x84; 16 * 1024];
    let metainfo =
        Metainfo::from_bytes(&two_piece_metainfo(&first, &second)).expect("two-piece metainfo");
    let mut addresses = Vec::new();
    let mut tasks = Vec::new();
    for _ in 0..8 {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind choked peer");
        addresses.push(listener.local_addr().expect("choked address"));
        tasks.push(tokio::spawn(serve_permanently_choked_peer(
            listener,
            metainfo.info_hash,
            vec![0xc0],
        )));
    }
    let useful_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind replacement peer");
    let useful_address = useful_listener.local_addr().expect("replacement address");
    tasks.push(tokio::spawn(serve_content_peer(
        useful_listener,
        metainfo.info_hash,
        Arc::new(vec![first, second]),
        vec![true, true],
    )));
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        addresses[0],
        PeerSource::Manual,
        loopback_network(Duration::from_secs(2)),
    )
    .expect("peer session");
    for address in addresses.into_iter().skip(1) {
        peers
            .observe_address(address, PeerSource::Manual)
            .expect("choked peer");
    }
    peers
        .observe_address(useful_address, PeerSource::Manual)
        .expect("replacement peer");
    let mut swarm_config = SwarmConfig::for_request_limit(2 * MIN_PAYLOAD_ALLOWANCE);
    swarm_config.unproductive_grace = Duration::from_millis(100);
    let output = test_path("choked-capacity-replacement");
    let report = timeout(
        Duration::from_secs(3),
        run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: output.clone(),
                max_buffered_payload_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
                storage_intake_high_watermark_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
                swarm_config,
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
    .expect("bounded replacement")
    .expect("replacement peer completed");
    assert_eq!(report.verified_piece_count, 2);
    for task in tasks {
        timeout(Duration::from_secs(1), task)
            .await
            .expect("peer joined")
            .expect("peer task");
    }
    let _ = tokio::fs::remove_dir_all(output).await;
}

#[tokio::test]
async fn full_irrelevant_set_is_replaced_by_a_wanted_piece_peer() {
    let first = vec![0x18; 16 * 1024];
    let second = vec![0xa6; 16 * 1024];
    let metainfo =
        Metainfo::from_bytes(&two_piece_metainfo(&first, &second)).expect("two-piece metainfo");
    let payload = Arc::new(vec![first, second]);
    let mut addresses = Vec::new();
    let mut tasks = Vec::new();
    for _ in 0..8 {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind irrelevant peer");
        addresses.push(listener.local_addr().expect("irrelevant address"));
        tasks.push(tokio::spawn(serve_content_peer(
            listener,
            metainfo.info_hash,
            payload.clone(),
            vec![false, false],
        )));
    }
    let useful_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind wanted-piece peer");
    let useful_address = useful_listener.local_addr().expect("wanted-piece address");
    tasks.push(tokio::spawn(serve_content_peer(
        useful_listener,
        metainfo.info_hash,
        payload,
        vec![true, true],
    )));
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        addresses[0],
        PeerSource::Manual,
        loopback_network(Duration::from_secs(2)),
    )
    .expect("peer session");
    for address in addresses.into_iter().skip(1) {
        peers
            .observe_address(address, PeerSource::Manual)
            .expect("irrelevant peer");
    }
    peers
        .observe_address(useful_address, PeerSource::Manual)
        .expect("wanted-piece peer");
    let mut swarm_config = SwarmConfig::for_request_limit(2 * MIN_PAYLOAD_ALLOWANCE);
    swarm_config.unproductive_grace = Duration::from_millis(50);
    let output = test_path("irrelevant-capacity-replacement");

    let report = timeout(
        Duration::from_secs(3),
        run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: output.clone(),
                max_buffered_payload_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
                storage_intake_high_watermark_bytes: 2 * MIN_PAYLOAD_ALLOWANCE,
                swarm_config,
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
    .expect("bounded wanted-piece replacement")
    .expect("wanted-piece peer completed");

    assert_eq!(report.verified_piece_count, 2);
    for task in tasks {
        timeout(Duration::from_secs(1), task)
            .await
            .expect("irrelevant peer joined")
            .expect("irrelevant peer task");
    }
    let _ = tokio::fs::remove_dir_all(output).await;
}

#[tokio::test]
async fn full_choked_set_without_an_alternative_waits_without_churn() {
    let payload = vec![0x5b; 16 * 1024];
    let metainfo =
        Metainfo::from_info_bytes(&single_file_info(&payload)).expect("single-piece metainfo");
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind choked peer");
    let address = listener.local_addr().expect("choked address");
    let peer_task = tokio::spawn(serve_permanently_choked_peer(
        listener,
        metainfo.info_hash,
        vec![0x80],
    ));
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        address,
        PeerSource::Manual,
        loopback_network(Duration::from_secs(2)),
    )
    .expect("peer session");
    let mut swarm_config = SwarmConfig::for_request_limit(MIN_PAYLOAD_ALLOWANCE);
    swarm_config.max_established_connections = 1;
    swarm_config.unproductive_grace = Duration::from_millis(50);
    let output = test_path("choked-no-alternative.bin");
    let control = DownloadControl::new();
    let result = {
        let mut download = Box::pin(run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: output.clone(),
                max_buffered_payload_bytes: MIN_PAYLOAD_ALLOWANCE,
                storage_intake_high_watermark_bytes: MIN_PAYLOAD_ALLOWANCE,
                swarm_config,
                skip_files: Vec::new(),
                high_priority_files: Vec::new(),
            },
            metainfo,
            control.clone(),
            None,
            &mut peers,
            None,
        ));
        assert!(
            timeout(Duration::from_millis(200), &mut download)
                .await
                .is_err(),
            "no-alternative state must wait"
        );
        control.cancel();
        download.await
    };
    assert!(matches!(result, Err(DownloadError::Cancelled)));
    let record = peers
        .peers
        .with_state(|state| state.registry.records().next().cloned())
        .expect("retained peer");
    assert_eq!(record.history().dial_attempts, 1);
    assert_eq!(record.history().total_failures, 0);
    timeout(Duration::from_secs(1), peer_task)
        .await
        .expect("choked peer joined")
        .expect("choked peer task");
    let _ = tokio::fs::remove_file(output.clone()).await;
}

#[tokio::test]
async fn dry_swarm_probe_recovers_after_three_transient_handshake_failures() {
    let payload = b"bounded dry swarm recovery".to_vec();
    let metainfo =
        Metainfo::from_info_bytes(&single_file_info(&payload)).expect("dry-swarm metainfo");
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind recovering peer");
    let address = listener.local_addr().expect("recovering peer address");
    let peer_task = tokio::spawn(serve_content_peer_after_failed_handshakes(
        listener,
        3,
        metainfo.info_hash,
        Arc::new(vec![payload.clone()]),
        vec![true],
    ));

    let control = DownloadControl::new();
    let activity = Arc::new(RecordingActivitySink::default());
    control.set_activity_sink(activity.clone());
    let network = loopback_network(Duration::from_millis(250));
    let peer_handle = crate::torrent_peer::TorrentPeerHandle::with_registry_config(
        PeerRegistryConfig {
            max_records: 4,
            max_consecutive_failures: 3,
            reconnect_backoff: Duration::from_millis(20),
        },
        Arc::new(control.clone()),
    )
    .expect("peer handle");
    let mut peers = TorrentPeerCoordinator::new_with_peer_state(
        network,
        control.clone(),
        crate::peer_budget::PeerBudget::system_default(),
        Some(peer_handle),
        crate::mse::MseDhWorkOwner::new(),
        crate::network::PeerEncryptionPolicyHandle::new(network.encryption),
        crate::PeerExchangePolicyHandle::new(network.peer_exchange),
    )
    .expect("peer coordinator");
    peers
        .observe_address(address, PeerSource::Dht)
        .expect("DHT peer observation");
    let output = test_path("dry-swarm-recovery.bin");

    let report = timeout(
        Duration::from_secs(3),
        run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: output.clone(),
                max_buffered_payload_bytes: MIN_PAYLOAD_ALLOWANCE,
                storage_intake_high_watermark_bytes: MIN_PAYLOAD_ALLOWANCE,
                swarm_config: SwarmConfig::for_request_limit(MIN_PAYLOAD_ALLOWANCE),
                skip_files: Vec::new(),
                high_priority_files: Vec::new(),
            },
            metainfo,
            control,
            None,
            &mut peers,
            None,
        ),
    )
    .await
    .expect("bounded dry-swarm recovery")
    .expect("probe completed content");

    assert_eq!(report.verified_piece_count, 1);
    assert_eq!(report.bytes_written, payload.len());
    assert_eq!(
        tokio::fs::read(&output).await.expect("direct output"),
        payload
    );
    peer_task.await.expect("recovering peer task");

    {
        let events = activity
            .events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, DownloadActivityEvent::PeerDialStarted { .. }))
                .count(),
            4
        );
        assert_eq!(
            events
                .iter()
                .filter_map(|event| match event {
                    DownloadActivityEvent::DrySwarmProbeStarted {
                        failures,
                        ordinal,
                        next_delay_seconds,
                        ..
                    } => Some((*failures, *ordinal, *next_delay_seconds)),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            [(3, 1, 5 * 60)]
        );
    }

    let snapshot = peers.registry_snapshot();
    assert_eq!(snapshot.counts.total, 1);
    assert_eq!(snapshot.counts.dialing, 0);
    assert_eq!(snapshot.counts.connected, 0);
    assert_eq!(snapshot.counts.failure_limited, 0);
    assert_eq!(snapshot.records[0].history.consecutive_failures, 0);
    assert_eq!(peers.dry_swarm_probe.admissions(), 0);
    assert_eq!(peers.dry_swarm_probe.next_at(), None);

    let _ = tokio::fs::remove_file(output).await;
}

async fn serve_content_peer_after_failed_handshakes(
    listener: TcpListener,
    failures: usize,
    info_hash: [u8; 20],
    pieces: Arc<Vec<Vec<u8>>>,
    available: Vec<bool>,
) {
    for _ in 0..failures {
        let (stream, _) = listener.accept().await.expect("accept failed handshake");
        drop(stream);
    }
    serve_content_peer(listener, info_hash, pieces, available).await;
}

#[tokio::test]
async fn unrelated_messages_do_not_prevent_expiry_and_late_payload_is_safe() {
    let payload = vec![0x6a; 16 * 1024];
    let metainfo =
        Metainfo::from_info_bytes(&single_file_info(&payload)).expect("single-piece metainfo");
    let old_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind old peer");
    let old_address = old_listener.local_addr().expect("old address");
    let replacement_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind replacement peer");
    let replacement_address = replacement_listener
        .local_addr()
        .expect("replacement address");
    let old_task = tokio::spawn(serve_delayed_block_peer(
        old_listener,
        metainfo.info_hash,
        payload.clone(),
        Duration::from_millis(130),
        Some(Duration::from_millis(25)),
    ));
    let replacement_task = tokio::spawn(serve_delayed_block_peer(
        replacement_listener,
        metainfo.info_hash,
        payload.clone(),
        Duration::from_millis(100),
        None,
    ));
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        old_address,
        PeerSource::Manual,
        loopback_network(Duration::from_secs(2)),
    )
    .expect("peer session");
    peers
        .observe_address(replacement_address, PeerSource::Manual)
        .expect("replacement peer");
    let mut swarm_config = SwarmConfig::for_request_limit(MIN_PAYLOAD_ALLOWANCE);
    swarm_config.request_timeout = Duration::from_millis(75);
    let output = test_path("late-request-payload.bin");
    let control = DownloadControl::new();
    let report = timeout(
        Duration::from_secs(3),
        run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: output.clone(),
                max_buffered_payload_bytes: MIN_PAYLOAD_ALLOWANCE,
                storage_intake_high_watermark_bytes: MIN_PAYLOAD_ALLOWANCE,
                swarm_config,
                skip_files: Vec::new(),
                high_priority_files: Vec::new(),
            },
            metainfo,
            control.clone(),
            None,
            &mut peers,
            None,
        ),
    )
    .await
    .expect("bounded expiry and late response")
    .expect("late response download");
    assert_eq!(report.verified_piece_count, 1);
    assert_eq!(report.payload_high_water, MIN_PAYLOAD_ALLOWANCE);
    assert!(control.snapshot().requested_bytes >= 2 * MIN_PAYLOAD_ALLOWANCE);
    assert_eq!(tokio::fs::read(&output).await.expect("output"), payload);
    for task in [old_task, replacement_task] {
        timeout(Duration::from_secs(1), task)
            .await
            .expect("delayed peer joined")
            .expect("delayed peer task");
    }
    let _ = tokio::fs::remove_file(output).await;
}

#[tokio::test]
async fn sampled_stall_moves_a_burst_peers_window_to_a_healthy_peer() {
    let payload = (0..(8 * MIN_PAYLOAD_ALLOWANCE))
        .map(|index| ((index * 43 + index / 17) & 0xff) as u8)
        .collect::<Vec<_>>();
    let info = single_file_info_with_piece_length(&payload, payload.len());
    let metainfo = Metainfo::from_info_bytes(&info).expect("stall metainfo");
    let stalled_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind stalled peer");
    let stalled_address = stalled_listener.local_addr().expect("stalled address");
    let useful_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind useful peer");
    let useful_address = useful_listener.local_addr().expect("useful address");
    let stalled_task = tokio::spawn(serve_delayed_block_peer_with_timeout(
        stalled_listener,
        metainfo.info_hash,
        payload.clone(),
        Duration::ZERO,
        None,
        Duration::from_secs(10),
    ));
    let useful_task = tokio::spawn(serve_content_peer_with_timeout(
        useful_listener,
        metainfo.info_hash,
        Arc::new(vec![payload.clone()]),
        vec![true],
        Duration::from_secs(10),
    ));
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        stalled_address,
        PeerSource::Manual,
        loopback_network(Duration::from_secs(10)),
    )
    .expect("peer session");
    peers
        .observe_address(useful_address, PeerSource::Manual)
        .expect("useful peer");
    let payload_limit = payload.len();
    let mut swarm_config = SwarmConfig::for_request_limit(payload_limit);
    swarm_config.request_timeout = Duration::from_secs(10);
    let control = DownloadControl::new();
    let output = test_path("sampled-stall.bin");

    let report = timeout(
        Duration::from_secs(7),
        run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: output.clone(),
                max_buffered_payload_bytes: payload_limit,
                storage_intake_high_watermark_bytes: payload_limit,
                swarm_config,
                skip_files: Vec::new(),
                high_priority_files: Vec::new(),
            },
            metainfo,
            control.clone(),
            None,
            &mut peers,
            None,
        ),
    )
    .await
    .expect("adaptive stall deadline")
    .expect("healthy peer completed stalled work");

    assert_eq!(report.verified_piece_count, 1);
    assert_eq!(tokio::fs::read(&output).await.expect("output"), payload);
    assert!(control.snapshot().requested_bytes > report.bytes_written);
    for task in [stalled_task, useful_task] {
        timeout(Duration::from_secs(1), task)
            .await
            .expect("peer joined")
            .expect("peer task");
    }
    let _ = tokio::fs::remove_file(output).await;
}

#[tokio::test]
async fn tracker_peer_discovered_during_content_becomes_useful() {
    let payload = b"late tracker peer payload".to_vec();
    let info = single_file_info(&payload);
    let info_hash: [u8; 20] = Sha1::digest(&info).into();
    let metadata_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind metadata-only peer");
    let metadata_address = metadata_listener.local_addr().expect("metadata address");
    let metadata_task = tokio::spawn(serve_metadata_then_piece(
        metadata_listener,
        info,
        payload.clone(),
        vec![0x00],
    ));
    let useful_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind late useful peer");
    let useful_address = useful_listener.local_addr().expect("useful address");
    let useful_task = tokio::spawn(serve_content_peer(
        useful_listener,
        info_hash,
        Arc::new(vec![payload.clone()]),
        vec![true],
    ));
    let unavailable_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind unavailable placeholder");
    let unavailable = unavailable_listener
        .local_addr()
        .expect("unavailable address");
    drop(unavailable_listener);
    let tracker = UdpSocket::bind("127.0.0.1:0")
        .await
        .expect("bind delayed tracker");
    let tracker_address = tracker.local_addr().expect("tracker address");
    let tracker_task = tokio::spawn(serve_one_shot_udp_tracker(
        tracker,
        info_hash,
        unavailable,
        useful_address,
        Duration::from_millis(150),
    ));
    let output = test_path("late-tracker-content.bin");
    let result = timeout(
        Duration::from_secs(3),
        download_magnet(MagnetDownloadConfig {
            identity: test_identity(info_hash),
            magnet: format!(
                "magnet:?xt=urn:btih:{}&x.pe={metadata_address}&\
                     tr=udp%3A%2F%2F{tracker_address}%2Fannounce",
                hex(&info_hash)
            ),
            output_path: output.clone(),
            network: loopback_network(Duration::from_secs(2)),
            resource_limits: resource_limits(MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            dht: None,
        }),
    )
    .await
    .expect("bounded late discovery")
    .expect("late discovered peer completed content");
    assert_eq!(result.verified_piece_count, 1);
    assert_eq!(
        tokio::fs::read(&output).await.expect("downloaded output"),
        payload
    );
    for task in [metadata_task, useful_task, tracker_task] {
        timeout(Duration::from_secs(1), task)
            .await
            .expect("scripted owner joined")
            .expect("scripted task");
    }
    let _ = tokio::fs::remove_file(output).await;
}

#[tokio::test]
async fn pex_is_the_only_source_for_a_useful_second_hop() {
    let payload = b"PEX-only second-hop payload".to_vec();
    let info = single_file_info(&payload);
    let info_hash: [u8; 20] = Sha1::digest(&info).into();
    let useful_listener = TcpListener::bind("[::1]:0")
        .await
        .expect("bind PEX useful peer");
    let useful_address = useful_listener.local_addr().expect("useful address");
    let useful_task = tokio::spawn(serve_content_peer(
        useful_listener,
        info_hash,
        Arc::new(vec![payload.clone()]),
        vec![true],
    ));
    let bootstrap_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind PEX bootstrap");
    let bootstrap_address = bootstrap_listener.local_addr().expect("bootstrap address");
    let bootstrap_task = tokio::spawn(serve_metadata_then_pex(
        bootstrap_listener,
        info,
        useful_address,
    ));
    let output = test_path("pex-second-hop.bin");
    let report = timeout(
        Duration::from_secs(3),
        download_magnet(MagnetDownloadConfig {
            identity: test_identity(info_hash),
            magnet: format!(
                "magnet:?xt=urn:btih:{}&x.pe={bootstrap_address}",
                hex(&info_hash)
            ),
            output_path: output.clone(),
            network: loopback_network(Duration::from_secs(2)),
            resource_limits: resource_limits(MIN_PAYLOAD_ALLOWANCE),
            skip_files: Vec::new(),
            high_priority_files: Vec::new(),
            dht: None,
        }),
    )
    .await
    .expect("bounded PEX topology")
    .expect("PEX second hop completed");
    assert_eq!(report.verified_piece_count, 1);
    assert_eq!(tokio::fs::read(&output).await.expect("output"), payload);
    for task in [bootstrap_task, useful_task] {
        timeout(Duration::from_secs(1), task)
            .await
            .expect("PEX peer joined")
            .expect("PEX peer task");
    }
    let _ = tokio::fs::remove_file(output).await;
}

#[tokio::test]
async fn dht_peer_discovered_during_content_becomes_useful() {
    let payload = b"late DHT peer payload".to_vec();
    let metainfo =
        Metainfo::from_info_bytes(&single_file_info(&payload)).expect("single-piece metainfo");
    let unavailable_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind unavailable content peer");
    let unavailable_address = unavailable_listener
        .local_addr()
        .expect("unavailable content address");
    let unavailable_task = tokio::spawn(serve_content_peer(
        unavailable_listener,
        metainfo.info_hash,
        Arc::new(vec![payload.clone()]),
        vec![false],
    ));
    let useful_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind DHT content peer");
    let useful_address = useful_listener.local_addr().expect("DHT content address");
    let useful_task = tokio::spawn(serve_content_peer(
        useful_listener,
        metainfo.info_hash,
        Arc::new(vec![payload.clone()]),
        vec![true],
    ));
    let dht_socket = UdpSocket::bind("127.0.0.1:0")
        .await
        .expect("bind scripted DHT");
    let dht_address = dht_socket.local_addr().expect("DHT address");
    let dht_task = tokio::spawn(serve_dht_peer(
        dht_socket,
        metainfo.info_hash,
        useful_address,
    ));
    let dht = DhtService::start(dht_config(dht_address))
        .await
        .expect("start DHT client");
    let mut peers = TorrentPeerCoordinator::from_endpoint(
        unavailable_address,
        PeerSource::Manual,
        loopback_network(Duration::from_secs(2)),
    )
    .expect("peer session");
    peers.dht = Some(dht.handle());
    let output = test_path("late-dht-content.bin");

    let report = timeout(
        Duration::from_secs(3),
        run_content_download(
            ContentDownloadConfig {
                artifact_identity: test_artifact_identity(),
                output_path: output.clone(),
                max_buffered_payload_bytes: MIN_PAYLOAD_ALLOWANCE,
                storage_intake_high_watermark_bytes: MIN_PAYLOAD_ALLOWANCE,
                swarm_config: SwarmConfig::for_request_limit(MIN_PAYLOAD_ALLOWANCE),
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
    .expect("bounded late DHT discovery")
    .expect("late DHT peer completed content");

    assert_eq!(report.verified_piece_count, 1);
    assert_eq!(tokio::fs::read(&output).await.expect("output"), payload);
    let discovered = peers
        .peers
        .with_state(|state| {
            state
                .registry
                .find_endpoint(PeerEndpoint::new(useful_address).expect("DHT endpoint"))
                .cloned()
        })
        .expect("DHT peer retained");
    assert!(discovered.sources().contains(PeerSource::Dht));
    for task in [unavailable_task, useful_task, dht_task] {
        timeout(Duration::from_secs(1), task)
            .await
            .expect("scripted DHT owner joined")
            .expect("scripted DHT task");
    }
    dht.shutdown().await.expect("DHT shutdown");
    let _ = tokio::fs::remove_file(output).await;
}
