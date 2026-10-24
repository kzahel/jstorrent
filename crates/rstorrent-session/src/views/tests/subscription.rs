//! Legacy queue, continuity, overflow, and diagnostic delivery behavior.

use super::support::*;

#[tokio::test]
async fn removed_torrent_replaces_queued_piece_changes_with_empty_snapshot() {
    let id = "t1-000102030405060708090a0b0c0d0e0f";
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    let subscription = hub.subscribe(piece_spec(4096)).expect("subscribe");
    subscription.next_update().await.expect("initial snapshot");
    hub.record_pieces_durable(id, &[1, 3], 1)
        .expect("durable pieces");
    hub.record_activity(
        id,
        TorrentActivity::PieceStarted {
            piece_index: 0,
            piece_length: 16384,
            attempt: 1,
        },
    )
    .expect("active attempt");
    let mut removed = snapshot(2, 4);
    removed.torrents.clear();
    hub.replace_durable(&removed, &BTreeMap::new())
        .expect("remove torrent");
    let update = subscription.next_update().await.expect("removal snapshot");
    assert_eq!(update.revision, "2");
    assert!(matches!(update.payload,
        ViewUpdatePayload::Snapshot { snapshot: ViewSnapshot::PieceActivity {
            piece_count: 0, verified, active, ..
        }} if verified.is_empty() && active.is_empty()));
}

#[tokio::test]
async fn starts_with_snapshot_and_keeps_large_indices() {
    let hub = ViewHub::new(&snapshot(7, 1_000_000)).expect("hub");
    let subscription = hub.subscribe(piece_spec(4096)).expect("subscribe");
    let update = subscription.next_update().await.expect("snapshot");
    assert_eq!(update.sequence, "1");
    assert_eq!(update.revision, "7");
    let ViewUpdatePayload::Snapshot {
        snapshot:
            ViewSnapshot::PieceActivity {
                piece_count,
                verified,
                ..
            },
    } = update.payload
    else {
        panic!("expected piece snapshot");
    };
    assert_eq!(piece_count, 1_000_000);
    assert!(verified.is_empty());

    hub.record_activity(
        "t1-000102030405060708090a0b0c0d0e0f",
        TorrentActivity::PieceStarted {
            piece_index: 900_000,
            piece_length: 32 * 1024 * 1024,
            attempt: 1,
        },
    )
    .expect("activity");
    let update = subscription.next_update().await.expect("patch");
    let ViewUpdatePayload::Patch { patch } = update.payload else {
        panic!("expected patch");
    };
    let serialized = serde_json::to_string(&patch).expect("serialize");
    assert!(serialized.contains("900000"));
    assert!(serialized.contains("33554432"));
}

#[tokio::test]
async fn durable_piece_batch_publishes_one_coherent_patch() {
    let torrent_id = "t1-000102030405060708090a0b0c0d0e0f";
    let hub = ViewHub::new(&snapshot(0, 4)).expect("hub");
    let subscription = hub.subscribe(piece_spec(4096)).expect("subscribe");
    subscription.next_update().await.expect("snapshot");

    hub.record_pieces_durable(torrent_id, &[3, 1, 1], 1)
        .expect("record durable batch");
    let update = subscription.next_update().await.expect("batch patch");
    assert_eq!(update.revision, "1");
    let ViewUpdatePayload::Patch {
        patch:
            ViewPatch::PieceActivity {
                verified,
                cleared,
                active_upsert,
                active_removed,
                ..
            },
    } = update.payload
    else {
        panic!("expected piece batch patch");
    };
    assert_eq!(
        verified,
        vec![
            IndexRange {
                start: 1,
                end_exclusive: 2,
            },
            IndexRange {
                start: 3,
                end_exclusive: 4,
            },
        ]
    );
    assert!(cleared.is_empty());
    assert!(active_upsert.is_empty());
    assert!(active_removed.is_empty());
    assert_eq!(
        hub.inner
            .lock()
            .expect("hub lock")
            .torrents
            .get(torrent_id)
            .expect("torrent model")
            .view
            .verified_piece_count,
        2
    );
}

#[tokio::test]
async fn subscribers_have_independent_queues() {
    let hub = ViewHub::new(&snapshot(0, 100)).expect("hub");
    let fast = hub.subscribe(piece_spec(4096)).expect("fast");
    let slow = hub.subscribe(piece_spec(4096)).expect("slow");
    fast.next_update().await.expect("fast snapshot");
    slow.next_update().await.expect("slow snapshot");

    for piece_index in 0..20 {
        hub.record_activity(
            "t1-000102030405060708090a0b0c0d0e0f",
            TorrentActivity::PieceVerified { piece_index },
        )
        .expect("activity");
        fast.next_update().await.expect("fast patch");
    }
    assert_eq!(fast.stats().expect("fast stats").reset_count, 0);
    assert_eq!(slow.stats().expect("slow stats").reset_count, 0);
    let slow_update = slow.next_update().await.expect("coalesced slow patch");
    assert_eq!(slow_update.sequence, "2");
}

#[tokio::test]
async fn overflow_requires_explicit_resync() {
    let torrent_id = "t1-000102030405060708090a0b0c0d0e0f";
    let reference = ViewHub::new(&snapshot(0, 2_000)).expect("reference hub");
    for piece_index in (0..2_000).step_by(2) {
        reference
            .record_activity(torrent_id, TorrentActivity::PieceVerified { piece_index })
            .expect("reference activity");
    }
    let reference_subscription = reference
        .subscribe(piece_spec(4 * 1024 * 1024))
        .expect("reference subscription");
    let final_snapshot = reference_subscription
        .next_update()
        .await
        .expect("reference snapshot");
    let queue_bound = u32::try_from(
        serde_json::to_vec(&final_snapshot)
            .expect("encode reference snapshot")
            .len(),
    )
    .expect("snapshot length fits u32")
    .checked_add(1)
    .expect("small snapshot headroom fits u32")
    .max(4096);

    let hub = ViewHub::new(&snapshot(0, 2_000)).expect("hub");
    let subscription = hub
        .subscribe(piece_spec(queue_bound))
        .expect("subscription");
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        subscription.next_update(),
    )
    .await
    .expect("snapshot delivery timed out")
    .expect("snapshot");

    for piece_index in (0..2_000).step_by(2) {
        hub.record_activity(torrent_id, TorrentActivity::PieceVerified { piece_index })
            .expect("activity");
    }
    assert!(
        subscription.stats().expect("queued stats").queued_bytes > 0,
        "activity must enqueue either a patch or reset"
    );
    let update = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        subscription.next_update(),
    )
    .await
    .expect("reset delivery timed out")
    .expect("reset");
    assert_eq!(
        update.payload,
        ViewUpdatePayload::ResetRequired {
            reason: ResetReason::QueueOverflow
        }
    );
    assert_eq!(subscription.stats().expect("stats").reset_count, 1);
    subscription.resync().expect("resync");
    let replacement = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        subscription.next_update(),
    )
    .await
    .expect("replacement delivery timed out")
    .expect("replacement");
    assert!(matches!(
        replacement.payload,
        ViewUpdatePayload::Snapshot { .. }
    ));
}

#[tokio::test]
async fn diagnostics_filter_before_queue_and_report_ring_drops() {
    let hub = ViewHub::new(&snapshot(0, 1)).expect("hub");
    let filtered = hub
        .subscribe(SubscriptionSpec {
            selector: ViewSelector::TorrentList,
            projection: ViewProjection::Diagnostics,
            delivery: DeliveryPolicy {
                min_interval_millis: 0,
                max_queue_bytes: 4 * 1024 * 1024,
            },
            diagnostics: Some(DiagnosticFilter {
                profile: DiagnosticProfile::Normal,
                minimum_severity: DiagnosticSeverity::Trace,
                categories: vec![DiagnosticCategory::from_static(category::PIECE_BLOCK)],
            }),
            catalog_page: None,
        })
        .expect("subscribe");
    filtered.next_update().await.expect("snapshot");
    hub.record_diagnostic(
        DiagnosticSeverity::Trace,
        category::PIECE_BLOCK,
        "block_received",
        None,
        "trace",
        &[],
    )
    .expect("record trace");
    assert_eq!(filtered.stats().expect("stats").queued_bytes, 0);

    hub.record_diagnostic(
        DiagnosticSeverity::Warning,
        category::TRACKER_ANNOUNCE,
        "tracker_unavailable",
        None,
        "warning",
        &[],
    )
    .expect("record warning");
    let warning = filtered.next_update().await.expect("warning patch");
    assert!(
        serde_json::to_string(&warning)
            .expect("encode")
            .contains("tracker_unavailable")
    );

    for index in 0..MAX_DIAGNOSTIC_EVENTS + 20 {
        hub.record_diagnostic(
            DiagnosticSeverity::Warning,
            category::TRACKER_ANNOUNCE,
            "bounded",
            None,
            &format!("event {index}"),
            &[("hostile", "\u{202e}<script>")],
        )
        .expect("record bounded event");
    }
    // Android previously requested 256 KiB even though retained history can
    // exceed it. Prove the real bounded snapshot refuses that old budget.
    let old_budget = hub.subscribe(SubscriptionSpec {
        selector: ViewSelector::TorrentList,
        projection: ViewProjection::Diagnostics,
        delivery: DeliveryPolicy {
            min_interval_millis: 0,
            max_queue_bytes: 256 * 1024,
        },
        diagnostics: Some(DiagnosticFilter {
            profile: DiagnosticProfile::Normal,
            minimum_severity: DiagnosticSeverity::Info,
            categories: Vec::new(),
        }),
        catalog_page: None,
    });
    assert!(matches!(
        old_budget,
        Err(crate::SubscriptionError::SnapshotExceedsQueue { snapshot, maximum })
            if snapshot > maximum as usize && maximum == 256 * 1024
    ));

    let subscription = hub
        .subscribe(SubscriptionSpec {
            selector: ViewSelector::TorrentList,
            projection: ViewProjection::Diagnostics,
            delivery: DeliveryPolicy {
                min_interval_millis: 0,
                max_queue_bytes: 4 * 1024 * 1024,
            },
            diagnostics: Some(DiagnosticFilter {
                profile: DiagnosticProfile::Normal,
                minimum_severity: DiagnosticSeverity::Info,
                categories: Vec::new(),
            }),
            catalog_page: None,
        })
        .expect("bounded subscription");
    let snapshot = subscription.next_update().await.expect("bounded snapshot");
    let high_water = subscription.stats().expect("stats").queue_high_water;
    assert!(high_water > 256 * 1024 && high_water <= 4 * 1024 * 1024);
    subscription.resync().expect("full retained-history resync");
    let replacement = subscription.next_update().await.expect("resync snapshot");
    assert_eq!(snapshot.payload, replacement.payload);
    println!("bounded diagnostic snapshot high-water: {high_water} bytes");
    let ViewUpdatePayload::Snapshot {
        snapshot: ViewSnapshot::Diagnostics { events, retention },
    } = snapshot.payload
    else {
        panic!("expected diagnostic snapshot");
    };
    assert_eq!(events.len(), MAX_DIAGNOSTIC_EVENTS);
    assert_ne!(retention.source_evicted_count, "0");
    assert!(
        events
            .iter()
            .all(|event| !event.message.contains('\u{202e}'))
    );
    assert!(
        events
            .iter()
            .flat_map(|event| &event.fields)
            .all(|field| match &field.value {
                DiagnosticValue::Text { value }
                | DiagnosticValue::Endpoint { value }
                | DiagnosticValue::ErrorCode { value }
                | DiagnosticValue::Count { value }
                | DiagnosticValue::Bytes { value }
                | DiagnosticValue::DurationMillis { value } => !value.contains('\u{202e}'),
                DiagnosticValue::Boolean { .. } => true,
            })
    );
}

#[test]
fn diagnostic_patch_coalescing_respects_count_and_byte_bounds() {
    let event = DiagnosticEvent {
        sequence: "1".to_owned(),
        timestamp_millis: "1".to_owned(),
        severity: DiagnosticSeverity::Trace,
        category: DiagnosticCategory::from_static(category::PIECE_BLOCK),
        code: "block_received".to_owned(),
        torrent_id: None,
        message: "received".to_owned(),
        subjects: Vec::new(),
        fields: Vec::new(),
    };
    let retention = DiagnosticRetention {
        source_evicted_count: "0".to_owned(),
        retained_from_sequence: "1".to_owned(),
    };
    let mut count_bounded = ViewPatch::Diagnostics {
        events: vec![event.clone(); MAX_DIAGNOSTIC_PATCH_EVENTS],
        retention: retention.clone(),
    };
    let next = ViewPatch::Diagnostics {
        events: vec![event.clone()],
        retention: retention.clone(),
    };
    assert!(!coalesce_patch(&mut count_bounded, &next));

    let mut large = event;
    large.message = "x".repeat(3_000);
    let mut byte_bounded = ViewPatch::Diagnostics {
        events: vec![large.clone(); 40],
        retention: retention.clone(),
    };
    let next = ViewPatch::Diagnostics {
        events: vec![large; 10],
        retention,
    };
    assert!(!coalesce_patch(&mut byte_bounded, &next));
}

#[tokio::test]
async fn direct_speed_subscription_coalesces_exact_contiguous_points() {
    let hub = ViewHub::new(&snapshot(0, 1)).expect("hub");
    let subscription = hub
        .subscribe(speed_spec(SpeedRange::Seconds30))
        .expect("speed subscription");
    let initial = subscription.next_update().await.expect("speed snapshot");
    let ViewUpdatePayload::Snapshot {
        snapshot: ViewSnapshot::SessionSpeedHistory { history: first },
    } = initial.payload
    else {
        panic!("expected speed history snapshot");
    };
    let second = shifted_history(&first, &[Some("10".to_owned()), None]);
    let third = shifted_history(&second, &[Some("20".to_owned()), Some("30".to_owned())]);

    subscription
        .enqueue_speed_history_for_testing(1, second)
        .expect("first append");
    subscription
        .enqueue_speed_history_for_testing(2, third.clone())
        .expect("second append");

    let update = subscription.next_update().await.expect("coalesced append");
    let ViewUpdatePayload::Patch {
        patch: ViewPatch::SessionSpeedHistory { append },
    } = update.payload
    else {
        panic!("expected speed history append");
    };
    assert_eq!(append.series[0].values.len(), 4);
    let mut reconstructed = first;
    reconstructed
        .apply_append(&append)
        .expect("coalesced append applies");
    assert_eq!(reconstructed, third);
}

fn shifted_history(
    previous: &crate::SpeedHistoryView,
    values: &[Option<String>],
) -> crate::SpeedHistoryView {
    let bucket = previous.bucket_millis.parse::<u64>().expect("bucket");
    let through = previous
        .complete_through_millis
        .parse::<u64>()
        .expect("complete through")
        + bucket * values.len() as u64;
    let window = previous.series[0].values.len();
    let mut next = previous.clone();
    next.captured_millis = through.saturating_add(bucket).to_string();
    next.complete_through_millis = through.to_string();
    next.start_millis = through
        .saturating_sub(bucket * window.saturating_sub(1) as u64)
        .to_string();
    for series in &mut next.series {
        series.values.drain(..values.len());
        series.values.extend(values.iter().cloned());
    }
    next
}
