//! Generates a populated session catalog fixture with the code under test.
//!
//! Released fixtures must come from released code: run this test, unmodified,
//! in a worktree checked out at the release tag, then copy the output into
//! `tests/fixtures/catalog/` and record the tag and digest in its README.
//!
//! ```text
//! RSTORRENT_CATALOG_FIXTURE_OUT=/tmp/v26.sqlite \
//!     cargo test -p rstorrent-session --test catalog_fixture_generator -- --ignored
//! ```
//!
//! It uses only the public store API and SQL that satisfies the catalog's own
//! constraints, so the same file compiles against every released version.

use std::path::Path;

use rstorrent_session::{
    AddTorrentBytesRequest, CONTROL_VERSION, Command, ConfiguredStorageRoot, RequestEnvelope,
    ResponseEnvelope, ResponseOutcome, SessionStore,
};

#[test]
#[ignore = "writes a catalog fixture; run explicitly at a release tag"]
fn generate_catalog_fixture() {
    let output = std::env::var_os("RSTORRENT_CATALOG_FIXTURE_OUT")
        .expect("set RSTORRENT_CATALOG_FIXTURE_OUT to the fixture path");
    let output = Path::new(&output);
    assert!(!output.exists(), "refusing to overwrite {output:?}");

    let work = tempfile::tempdir().expect("temporary directory");
    let profile = work.path().join("profile");
    let downloads = work.path().join("downloads");
    let movies = work.path().join("movies");
    std::fs::create_dir_all(&downloads).expect("downloads root");
    std::fs::create_dir_all(&movies).expect("movies root");
    let roots = [
        ConfiguredStorageRoot::path("downloads", downloads).with_label("Downloads"),
        ConfiguredStorageRoot::path("movies", movies).with_label("Movies"),
    ];
    let mut store = SessionStore::open(&profile, "default", &roots).expect("open catalog");

    let single = add_bytes(
        &mut store,
        "add-single",
        "downloads",
        &single_file_torrent(),
        true,
        false,
    );
    let multi = add_bytes(
        &mut store,
        "add-multi",
        "movies",
        &multi_file_torrent(),
        true,
        false,
    );
    let paused = add_bytes(
        &mut store,
        "add-paused",
        "downloads",
        &paused_torrent(),
        false,
        false,
    );
    let archived = add_bytes(
        &mut store,
        "add-archived",
        "downloads",
        &archived_torrent(),
        true,
        false,
    );
    let removing = add_bytes(
        &mut store,
        "add-removing",
        "downloads",
        &removing_torrent(),
        true,
        false,
    );
    add_bytes(
        &mut store,
        "add-pending-selection",
        "downloads",
        &pending_torrent(),
        true,
        true,
    );
    let magnet = command_result(
        &mut store,
        "add-magnet",
        Command::AddMagnet {
            magnet: format!(
                "magnet:?xt=urn:btih:{}&dn=fixture-magnet&tr=udp%3A%2F%2Ftracker.example%3A6969&x.pe=192.0.2.7%3A51413",
                "0123456789abcdef0123456789abcdef01234567"
            ),
            storage_root: "downloads".to_owned(),
            start_content: true,
            await_file_selection: false,
            skip_files: Vec::new(),
        },
    );
    assert!(magnet, "magnet add must succeed");

    for (request_id, command) in [
        (
            "priority-high",
            serde_json::json!({
                "type": "set_file_priority",
                "torrent_id": multi,
                "file_indices": [0],
                "priority": "high",
            }),
        ),
        (
            "priority-skip",
            serde_json::json!({
                "type": "set_file_priority",
                "torrent_id": multi,
                "file_indices": [2],
                "priority": "skip",
            }),
        ),
        (
            "client-settings",
            serde_json::json!({
                "type": "update_client_settings",
                "patch": {
                    "peer_connection_limit": 150,
                    "active_seeds": {"type": "limited", "torrents": 3},
                    "share_ratio_limit_percent": 150,
                    "finished_time_limit_seconds": 7_200,
                    "upload_rate_limit": {"type": "limited", "bytes_per_second": 262_144},
                },
            }),
        ),
        (
            "torrent-settings",
            serde_json::json!({
                "type": "update_torrent_settings",
                "torrent_id": single,
                "patch": {
                    "download_rate_limit": {"type": "limited", "bytes_per_second": 131_072},
                },
            }),
        ),
        (
            "pause",
            serde_json::json!({"type": "pause", "torrent_id": paused}),
        ),
        (
            "archive",
            serde_json::json!({"type": "archive", "torrent_id": archived}),
        ),
        (
            "remove",
            serde_json::json!({"type": "remove_torrent", "torrent_id": removing, "data": "keep"}),
        ),
        (
            "default-root",
            serde_json::json!({"type": "set_default_storage_root", "storage_root": "movies"}),
        ),
        (
            "show-add-options",
            serde_json::json!({"type": "set_show_add_options", "show": false}),
        ),
    ] {
        let command: Command = serde_json::from_value(command).expect("command JSON");
        assert!(
            command_result(&mut store, request_id, command),
            "{request_id} must succeed"
        );
    }
    store
        .record_pieces(&single, &[0])
        .expect("record a verified piece");
    store
        .record_pieces(&multi, &[0, 1])
        .expect("record verified pieces");
    drop(store);

    let connection = rusqlite::Connection::open(profile.join("session.db")).expect("reopen");
    connection
        .execute_batch(
            "UPDATE torrents SET
                total_uploaded = 123456789, total_downloaded = 98765432,
                active_seconds = 90000, finished_seconds = 50000, seeding_seconds = 40000
             WHERE torrent_id = (SELECT min(torrent_id) FROM torrents);
             INSERT INTO dht_state(singleton, format_version) VALUES (1, 2);
             INSERT INTO dht_nodes(family, sample_order, node_id, address, port)
                VALUES (4, 0, x'00000000000000000000000000000000000000a1', x'c0000208', 6881);",
        )
        .expect("populate counters and DHT state");
    connection
        .execute(
            "VACUUM INTO ?1",
            [output.to_str().expect("UTF-8 output path")],
        )
        .expect("write fixture");
}

fn add_bytes(
    store: &mut SessionStore,
    request_id: &str,
    root: &str,
    source: &[u8],
    start: bool,
    await_file_selection: bool,
) -> String {
    let request = AddTorrentBytesRequest {
        version: CONTROL_VERSION,
        request_id: request_id.to_owned(),
        expected_revision: None,
        storage_root: root.to_owned(),
        start_content: start,
        await_file_selection,
        selection: Default::default(),
        source_length: source.len() as u32,
    };
    let response = store
        .handle_torrent_bytes(&request, source.to_vec())
        .expect("add torrent bytes");
    added_id(response)
}

fn command_result(store: &mut SessionStore, request_id: &str, command: Command) -> bool {
    let request = RequestEnvelope {
        version: CONTROL_VERSION,
        request_id: request_id.to_owned(),
        expected_revision: None,
        command,
    };
    let response = store.handle_durable(&request).expect("durable command");
    matches!(response.outcome, ResponseOutcome::Success { .. })
}

fn added_id(response: ResponseEnvelope) -> String {
    let value = serde_json::to_value(&response).expect("response JSON");
    value
        .pointer("/result/result/torrent_id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_else(|| panic!("add did not succeed: {value}"))
        .to_owned()
}

fn bencode_string(value: &[u8]) -> Vec<u8> {
    let mut encoded = format!("{}:", value.len()).into_bytes();
    encoded.extend_from_slice(value);
    encoded
}

fn torrent(info: Vec<u8>, tracker: &str) -> Vec<u8> {
    let mut source = b"d8:announce".to_vec();
    source.extend(bencode_string(tracker.as_bytes()));
    source.extend_from_slice(b"7:comment");
    source.extend(bencode_string(b"catalog fixture"));
    source.extend_from_slice(b"4:info");
    source.extend(info);
    source.push(b'e');
    source
}

fn single_info(name: &str, length: u64, fill: u8) -> Vec<u8> {
    let piece_length = 16_384_u64;
    let pieces = length.div_ceil(piece_length) as usize;
    let mut info = format!("d6:lengthi{length}e4:name").into_bytes();
    info.extend(bencode_string(name.as_bytes()));
    info.extend(format!("12:piece lengthi{piece_length}e6:pieces").into_bytes());
    info.extend(bencode_string(&vec![fill; pieces * 20]));
    info.push(b'e');
    info
}

fn single_file_torrent() -> Vec<u8> {
    torrent(
        single_info("single.bin", 40_000, b'a'),
        "udp://tracker.example:6969/announce",
    )
}

fn paused_torrent() -> Vec<u8> {
    torrent(
        single_info("paused.bin", 20_000, b'p'),
        "https://tracker.example/announce",
    )
}

fn archived_torrent() -> Vec<u8> {
    torrent(
        single_info("archived.bin", 10_000, b'r'),
        "https://tracker.example/announce",
    )
}

fn removing_torrent() -> Vec<u8> {
    torrent(
        single_info("removing.bin", 10_000, b'x'),
        "https://tracker.example/announce",
    )
}

fn multi_file_torrent() -> Vec<u8> {
    multi_file_torrent_named("multi", b'm')
}

fn pending_torrent() -> Vec<u8> {
    multi_file_torrent_named("pending", b'q')
}

fn multi_file_torrent_named(name: &str, fill: u8) -> Vec<u8> {
    let piece_length = 16_384_u64;
    let files: [(&str, u64); 3] = [("a.mkv", 30_000), ("b.srt", 2_000), ("c.nfo", 500)];
    let total: u64 = files.iter().map(|(_, length)| length).sum();
    let mut info = b"d5:filesl".to_vec();
    for (name, length) in files {
        info.extend(format!("d6:lengthi{length}e4:pathl").into_bytes());
        info.extend(bencode_string(name.as_bytes()));
        info.extend_from_slice(b"ee");
    }
    info.extend_from_slice(b"e4:name");
    info.extend(bencode_string(name.as_bytes()));
    info.extend(format!("12:piece lengthi{piece_length}e6:pieces").into_bytes());
    info.extend(bencode_string(&vec![
        fill;
        total.div_ceil(piece_length) as usize
            * 20
    ]));
    info.push(b'e');
    torrent(info, "udp://tracker.example:6969/announce")
}
