use super::*;
use crate::{
    ApplicationConfig, ApplicationService, NetworkConfig, NetworkPolicy, PathRootStartupPolicy,
    ResponseOutcome,
};
use serde_json::json;

struct Fixture {
    owned: TempDir,
    source: PathBuf,
    destination: PathBuf,
    discovery: Discovery,
}

impl Fixture {
    fn cohort(platform: &str) -> Self {
        let owned = tempfile::tempdir().unwrap();
        let source = owned.path().join("legacy");
        let destination = owned.path().join("destination");
        fs::create_dir_all(source.join("profiles")).unwrap();
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/legacy-desktop-v0.2.1")
            .join(platform);
        let manifest: Value =
            serde_json::from_slice(&fs::read(fixtures.join("manifest.json")).unwrap()).unwrap();
        let mut discovery = Discovery {
            version: 1,
            profiles: Vec::new(),
        };
        for profile in manifest["profiles"].as_array().unwrap() {
            let variant = profile["variant"].as_str().unwrap();
            let id = profile["sourceProfile"].as_str().unwrap().to_owned();
            let root_path = owned.path().join(profile["location"].as_str().unwrap());
            if profile["availability"] == "available" {
                fs::create_dir_all(&root_path).unwrap();
            }
            let directory = source.join("profiles").join(&id);
            fs::create_dir_all(&directory).unwrap();
            let kv: BTreeMap<String, String> = serde_json::from_slice(
                &fs::read(fixtures.join(format!("{variant}.json"))).unwrap(),
            )
            .unwrap();
            let connection = Connection::open(directory.join("data.db")).unwrap();
            connection
                .execute_batch("CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                .unwrap();
            for (key, value) in kv {
                connection
                    .execute("INSERT INTO kv VALUES (?1, ?2)", params![key, value])
                    .unwrap();
            }
            connection.close().unwrap();
            discovery.profiles.push(Profile {
                profile_id: id,
                port: 0,
                download_roots: vec![Root {
                    key: profile["rootKey"].as_str().unwrap().to_owned(),
                    path: root_path,
                    display_name: variant.to_owned(),
                }],
            });
        }
        let fixture = Self {
            owned,
            source,
            destination,
            discovery,
        };
        fixture.save_discovery();
        fixture
    }

    fn save_discovery(&self) {
        fs::write(
            self.source.join("rpc-info.json"),
            serde_json::to_vec(&self.discovery).unwrap(),
        )
        .unwrap();
    }

    fn database(&self, variant: &str) -> Connection {
        let profile = self
            .discovery
            .profiles
            .iter()
            .find(|p| p.download_roots[0].display_name == variant)
            .unwrap();
        Connection::open(
            self.source
                .join("profiles")
                .join(&profile.profile_id)
                .join("data.db"),
        )
        .unwrap()
    }

    fn retain_only(&mut self, variant: &str) {
        self.discovery
            .profiles
            .retain(|p| p.download_roots[0].display_name == variant);
        self.save_discovery();
    }

    fn migrate(&self) -> LegacyDesktopImportReport {
        SessionStore::migrate_legacy_desktop(&self.destination, "default", &self.source)
            .unwrap()
            .unwrap()
    }

    fn open(&self) -> SessionStore {
        SessionStore::open(&self.destination, "default", &[]).unwrap()
    }
}

#[test]
fn released_linux_and_windows_cohorts_import_without_trusting_completion() {
    for platform in ["linux", "windows"] {
        let fixture = Fixture::cohort(platform);
        let report = fixture.migrate();
        assert_eq!(
            (
                report.profiles,
                report.imported,
                report.skipped,
                report.already_present
            ),
            (7, 3, 5, 0)
        );
        assert!(report.skipped_profiles.is_empty());
        assert!(report.prepared_source_bytes < 1024);
        let store = fixture.open();
        let snapshot = store.snapshot().unwrap();
        assert_eq!(snapshot.torrents.len(), 3);
        for torrent in &snapshot.torrents {
            let resume = store.load_resume(&torrent.torrent_id).unwrap();
            assert!(!resume.desired_running);
            if let Some(have) = resume.have {
                assert_eq!(have.verified_count(), 0);
                assert_eq!(resume.state, TorrentState::Checking);
            } else {
                assert!(resume.download_queue_position.is_none());
            }
        }
        assert!(
            snapshot
                .torrents
                .iter()
                .any(|torrent| torrent.selection_default == FilePriority::Skip
                    && torrent.selection_exceptions == vec![0])
        );
        assert_eq!(
            store.legacy_desktop_import_report().unwrap().unwrap(),
            report
        );
        let backup = fixture.destination.join("legacy-desktop-backup");
        let retained: Vec<_> = fs::read_dir(backup)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(retained.len(), 1);
        let roots = fs::read_to_string(retained[0].join("roots.json")).unwrap();
        assert!(!roots.contains("token"));
        assert!(!roots.contains("port"));
        assert_eq!(fs::read_dir(&retained[0]).unwrap().count(), 8);
    }
}

#[test]
fn existing_identity_at_another_location_and_settings_are_unchanged() {
    let mut fixture = Fixture::cohort("linux");
    fixture.retain_only("multifile");
    let payload = fixture.owned.path().join("existing-downloads");
    fs::create_dir(&payload).unwrap();
    let mut store = SessionStore::open(
        &fixture.destination,
        "default",
        &[ConfiguredStorageRoot::path("existing", payload.clone())],
    )
    .unwrap();
    let kv = read_kv(&fixture.database("multifile")).unwrap();
    let source = decode_binary(
        kv.iter()
            .find(|(key, _)| key.contains("14ad47") && key.ends_with("torrentfile"))
            .unwrap()
            .1,
    )
    .unwrap();
    let response = store
        .handle_torrent_bytes(
            &bytes_request(
                "existing".to_owned(),
                source.len(),
                FileSelectionIntent::None,
            ),
            source,
        )
        .unwrap();
    assert!(matches!(response.outcome, ResponseOutcome::Success { .. }));
    let before = store.snapshot().unwrap();
    drop(store);
    let report = fixture.migrate();
    assert_eq!((report.imported, report.already_present), (1, 1));
    assert!(report.settings_preserved);
    let store = fixture.open();
    let after = store.snapshot().unwrap();
    assert_eq!(after.client_settings, before.client_settings);
    let original = after
        .torrents
        .iter()
        .find(|torrent| torrent.torrent_id == before.torrents[0].torrent_id)
        .unwrap();
    assert_eq!(original, &before.torrents[0]);
    let root: String = store
        .connection
        .query_row("SELECT default_root FROM storage_settings", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(root, "existing");
    assert!(payload.is_dir());
}

#[test]
fn marker_prevents_resurrection_after_removal_and_no_longer_needs_source() {
    let mut fixture = Fixture::cohort("linux");
    fixture.retain_only("disjoint");
    fixture.migrate();
    let mut store = fixture.open();
    for torrent in store.snapshot().unwrap().torrents {
        let operation = format!("remove-{}", torrent.torrent_id);
        store
            .handle_durable(&RequestEnvelope {
                version: CONTROL_VERSION,
                request_id: operation.clone(),
                expected_revision: None,
                command: Command::RemoveTorrent {
                    torrent_id: torrent.torrent_id.clone(),
                    data: RemovalDataPolicy::Keep,
                },
            })
            .unwrap();
        store
            .finalize_removal(
                &torrent.torrent_id,
                &store
                    .load_removal(&torrent.torrent_id)
                    .unwrap()
                    .operation_id,
            )
            .unwrap();
    }
    drop(store);
    fs::remove_dir_all(&fixture.source).unwrap();
    let report = fixture.migrate();
    assert!(report.already_completed);
    assert!(fixture.open().snapshot().unwrap().torrents.is_empty());
}

#[test]
fn an_existing_unset_default_is_preserved() {
    let mut fixture = Fixture::cohort("linux");
    fixture.retain_only("disjoint");
    let before = fixture.open().snapshot().unwrap().client_settings;
    assert!(fixture.migrate().settings_preserved);
    let store = fixture.open();
    assert_eq!(store.snapshot().unwrap().client_settings, before);
    let root: Option<String> = store
        .connection
        .query_row("SELECT default_root FROM storage_settings", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(root, None);
}

#[test]
fn matching_legacy_copies_coalesce_independently_of_discovery_order() {
    let mut reports = Vec::new();
    for reverse in [false, true] {
        let mut fixture = Fixture::cohort("linux");
        fixture.discovery.profiles.retain(|profile| {
            matches!(
                profile.download_roots[0].display_name.as_str(),
                "alpha" | "same"
            )
        });
        let alpha = fixture
            .discovery
            .profiles
            .iter()
            .find(|profile| profile.download_roots[0].display_name == "alpha")
            .unwrap();
        let path = alpha.download_roots[0].path.clone();
        let kv = read_kv(&fixture.database("alpha")).unwrap();
        let (key, raw) = kv.iter().find(|(key, _)| key.ends_with(":state")).unwrap();
        let mut state: Value = serde_json::from_str(raw).unwrap();
        let same = fixture
            .discovery
            .profiles
            .iter_mut()
            .find(|profile| profile.download_roots[0].display_name == "same")
            .unwrap();
        same.download_roots[0].path = path;
        state["storageKey"] = json!(same.download_roots[0].key);
        fixture
            .database("same")
            .execute(
                "UPDATE kv SET value = ?2 WHERE key = ?1",
                params![key, state.to_string()],
            )
            .unwrap();
        if reverse {
            fixture.discovery.profiles.reverse();
        }
        fixture.save_discovery();
        let report = fixture.migrate();
        assert_eq!(
            (report.imported, report.already_present, report.skipped),
            (1, 1, 0)
        );
        assert_eq!(fixture.open().snapshot().unwrap().torrents.len(), 1);
        reports.push(report);
    }
    assert_eq!(reports[0], reports[1]);
}

#[test]
fn invalid_mapped_settings_hold_content_and_pending_metadata() {
    let mut fixture = Fixture::cohort("linux");
    fixture.retain_only("disjoint");
    let database = fixture.database("disjoint");
    database
        .execute("INSERT INTO kv VALUES ('config:dhtEnabled', 'null')", [])
        .unwrap();
    let kv = read_kv(&database).unwrap();
    for (key, raw) in kv.iter().filter(|(key, _)| key.ends_with(":state")) {
        let mut state: Value = serde_json::from_str(raw).unwrap();
        state["userState"] = json!(if key.contains("12345678") {
            "awaitingFileSelection"
        } else {
            "active"
        });
        database
            .execute(
                "UPDATE kv SET value = ?2 WHERE key = ?1",
                params![key, state.to_string()],
            )
            .unwrap();
    }
    drop(database);
    let report = fixture.migrate();
    assert!(report.settings_need_attention);
    assert_eq!(report.imported, 2);
    let store = fixture.open();
    for torrent in store.snapshot().unwrap().torrents {
        let resume = store.load_resume(&torrent.torrent_id).unwrap();
        assert!(!resume.desired_running);
        if resume.raw_info.is_none() {
            assert!(torrent.awaiting_file_selection);
            assert!(resume.download_queue_position.is_none());
        }
    }
}

#[tokio::test]
async fn missing_imported_root_is_not_created_at_application_startup() {
    let mut fixture = Fixture::cohort("linux");
    fixture.retain_only("unavailable");
    let root = fixture.discovery.profiles[0].download_roots[0].path.clone();
    assert!(!root.exists());
    assert_eq!(fixture.migrate().imported, 1);
    let mut store = fixture.open();
    let mut settings = store.snapshot().unwrap().client_settings;
    settings.listener = crate::settings::ListenerPolicy::AutomaticLoopback;
    settings.dht_enabled = false;
    let transaction = store.connection.transaction().unwrap();
    replace_client_settings(&transaction, &settings).unwrap();
    transaction.commit().unwrap();
    drop(store);
    let mut service = ApplicationService::open(
        ApplicationConfig::new(
            fixture.destination.clone(),
            "default".to_owned(),
            vec![],
            NetworkConfig::new(
                NetworkPolicy::LoopbackOnly,
                Duration::from_secs(1),
                Duration::from_secs(1),
            ),
        )
        .with_path_root_startup_policy(PathRootStartupPolicy::PreserveUnavailable),
    )
    .await
    .unwrap();
    assert!(!root.exists());
    let snapshot = snapshot(&mut service).await;
    assert_eq!(snapshot.torrents.len(), 1);
    let torrent = &snapshot.torrents[0];
    assert_eq!(torrent.state, crate::TorrentState::AwaitingStorage);
    assert_eq!(torrent.storage_state, crate::StorageState::Unavailable);
    assert!(!torrent.desired_running);
    assert_eq!(torrent.verified_piece_count, 0);
    assert_eq!(
        crate::views::assess_progress(torrent, crate::ProgressInputs::default()).reason,
        crate::ProgressReason::WaitingForStorage
    );
    service.shutdown().await.unwrap();
    assert!(!root.exists());
}

#[test]
fn malformed_record_and_oversized_binary_do_not_abort_other_records() {
    for mutation in ["bad-json", "oversized", "hash-mismatch"] {
        let mut fixture = Fixture::cohort("linux");
        fixture.retain_only("disjoint");
        let database = fixture.database("disjoint");
        let key: String = database
            .query_row(
                "SELECT key FROM kv WHERE key LIKE '%0d74%:state'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        if mutation == "bad-json" {
            database
                .execute("UPDATE kv SET value = '{' WHERE key = ?1", [&key])
                .unwrap();
        } else if mutation == "oversized" {
            database
                .execute(
                    "UPDATE kv SET value = ?1 WHERE key LIKE '%:torrentfile'",
                    ["x".repeat(MAX_VALUE_BYTES + 1)],
                )
                .unwrap();
        } else {
            let raw: String = database
                .query_row(
                    "SELECT value FROM kv WHERE key = 'session:torrents'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            let mut index: Value = serde_json::from_str(&raw).unwrap();
            index["torrents"][1]["magnetUri"] =
                json!("magnet:?xt=urn:btih:ffffffffffffffffffffffffffffffffffffffff");
            database
                .execute(
                    "UPDATE kv SET value = ?1 WHERE key = 'session:torrents'",
                    [index.to_string()],
                )
                .unwrap();
        }
        drop(database);
        let report = fixture.migrate();
        assert_eq!((report.imported, report.skipped), (1, 1));
    }
}

#[test]
fn destination_error_rolls_back_roots_torrents_and_marker_then_retries() {
    let mut fixture = Fixture::cohort("linux");
    fixture.retain_only("disjoint");
    let store = fixture.open();
    store.connection.execute_batch("CREATE TRIGGER fail_second BEFORE INSERT ON torrents
        WHEN (SELECT count(*) FROM torrents) = 1 BEGIN SELECT RAISE(ABORT, 'injected destination failure'); END;").unwrap();
    drop(store);
    assert!(
        SessionStore::migrate_legacy_desktop(&fixture.destination, "default", &fixture.source)
            .is_err()
    );
    let store = fixture.open();
    assert!(store.snapshot().unwrap().torrents.is_empty());
    assert!(store.storage_roots().unwrap().is_empty());
    assert!(store.legacy_desktop_import_report().unwrap().is_none());
    store
        .connection
        .execute_batch("DROP TRIGGER fail_second")
        .unwrap();
    drop(store);
    assert_eq!(fixture.migrate().imported, 2);
}

#[test]
fn wal_only_source_state_is_backed_up_and_sources_stay_unchanged() {
    let mut fixture = Fixture::cohort("linux");
    fixture.retain_only("disjoint");
    let database = fixture.database("disjoint");
    database.pragma_update(None, "journal_mode", "WAL").unwrap();
    database
        .pragma_update(None, "wal_autocheckpoint", 0)
        .unwrap();
    database
        .execute("INSERT INTO kv VALUES ('config:dhtEnabled', 'false')", [])
        .unwrap();
    let before = read_kv(&database).unwrap();
    let report = fixture.migrate();
    assert_eq!(report.imported, 2);
    assert!(
        !fixture
            .open()
            .snapshot()
            .unwrap()
            .client_settings
            .dht_enabled
    );
    assert_eq!(read_kv(&database).unwrap(), before);
}

#[test]
fn old_and_future_destinations_are_refused_without_reset() {
    for schema in [25, SCHEMA_VERSION + 1] {
        let fixture = Fixture::cohort("linux");
        let store = fixture.open();
        store
            .connection
            .pragma_update(None, "user_version", schema)
            .unwrap();
        drop(store);
        let before = fs::read(fixture.destination.join(DATABASE_FILENAME)).unwrap();
        assert!(matches!(
            SessionStore::migrate_legacy_desktop(&fixture.destination, "default", &fixture.source),
            Err(StoreError::UnsupportedSchema { .. })
        ));
        assert_eq!(
            fs::read(fixture.destination.join(DATABASE_FILENAME)).unwrap(),
            before
        );
    }
}

#[test]
fn live_source_traversal_and_bad_discovery_are_refused_before_destination_creation() {
    let fixture = Fixture::cohort("linux");
    let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let mut value = serde_json::to_value(&fixture.discovery).unwrap();
    value["profiles"][0]["port"] = json!(listener.local_addr().unwrap().port());
    fs::write(fixture.source.join("rpc-info.json"), value.to_string()).unwrap();
    assert!(
        SessionStore::migrate_legacy_desktop(&fixture.destination, "default", &fixture.source)
            .is_err()
    );
    assert!(!fixture.destination.exists());
    fs::write(fixture.source.join("rpc-info.json"), "{").unwrap();
    assert!(
        SessionStore::migrate_legacy_desktop(&fixture.destination, "default", &fixture.source)
            .is_err()
    );
    assert!(!fixture.destination.exists());
    let mut value = serde_json::to_value(&fixture.discovery).unwrap();
    value["profiles"][0]["profile_id"] = json!("../../outside");
    fs::write(fixture.source.join("rpc-info.json"), value.to_string()).unwrap();
    assert_eq!(fixture.migrate().skipped_profiles.len(), 1);
}

#[test]
fn cached_magnet_metadata_preserves_identity_trackers_and_skip_selection() {
    let mut fixture = Fixture::cohort("linux");
    fixture.retain_only("multifile");
    let database = fixture.database("multifile");
    let mut index: Value = serde_json::from_str(
        &database
            .query_row::<String, _, _>(
                "SELECT value FROM kv WHERE key = 'session:torrents'",
                [],
                |row| row.get(0),
            )
            .unwrap(),
    )
    .unwrap();
    let hash = index["torrents"][1]["infoHash"]
        .as_str()
        .unwrap()
        .to_owned();
    let key = format!("session:torrent:{hash}:torrentfile");
    let source = decode_binary(
        &database
            .query_row::<String, _, _>("SELECT value FROM kv WHERE key = ?1", [&key], |row| {
                row.get(0)
            })
            .unwrap(),
    )
    .unwrap();
    let info = Metainfo::info_bytes_with_limits(&source, EXPLICIT_IMPORT_METAINFO_LIMITS).unwrap();
    database
        .execute(
            "INSERT INTO kv VALUES (?1, ?2)",
            params![
                format!("session:torrent:{hash}:infodict"),
                serde_json::to_string(&base64::engine::general_purpose::STANDARD.encode(info))
                    .unwrap()
            ],
        )
        .unwrap();
    index["torrents"][1]["source"] = json!("magnet");
    index["torrents"][1]["magnetUri"] = json!(format!(
        "magnet:?xt=urn:btih:{hash}&tr=http%3A%2F%2F127.0.0.1%3A12345%2Fannounce"
    ));
    database
        .execute(
            "UPDATE kv SET value = ?1 WHERE key = 'session:torrents'",
            [index.to_string()],
        )
        .unwrap();
    drop(database);
    assert_eq!(fixture.migrate().imported, 2);
    let store = fixture.open();
    let snapshot = store.snapshot().unwrap();
    let torrent = snapshot
        .torrents
        .iter()
        .find(|torrent| {
            store
                .load_resume(&torrent.torrent_id)
                .unwrap()
                .info_hashes
                .contains(FullInfoHash::V1(V1InfoHash::new(
                    decode_hex_hash(&hash).unwrap(),
                )))
        })
        .unwrap();
    assert_eq!(torrent.selection_default, FilePriority::Skip);
    assert_eq!(torrent.selection_exceptions, vec![0]);
    let resume = store.load_resume(&torrent.torrent_id).unwrap();
    assert!(resume.raw_info.is_some());
    assert_eq!(resume.have.unwrap().verified_count(), 0);
    let source: (String, String, String) = store
        .connection
        .query_row(
            "SELECT kind, fidelity, magnet FROM torrent_source WHERE torrent_id = ?1",
            [decode_torrent_id(&torrent.torrent_id).unwrap().as_bytes()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!((&*source.0, &*source.1), ("magnet", "verbatim"));
    assert!(source.2.contains("tr=http"));
    assert_eq!(resume.trackers.len(), 1);
}

#[test]
fn explicit_pending_empty_selection_and_resume_are_preserved() {
    let mut fixture = Fixture::cohort("linux");
    fixture.retain_only("disjoint");
    let database = fixture.database("disjoint");
    let key = "session:torrent:1234567890abcdef1234567890abcdef12345678:state";
    let raw: String = database
        .query_row("SELECT value FROM kv WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .unwrap();
    let mut state: Value = serde_json::from_str(&raw).unwrap();
    state["magnetSelectOnly"] = json!([]);
    database
        .execute(
            "UPDATE kv SET value = ?2 WHERE key = ?1",
            params![key, state.to_string()],
        )
        .unwrap();
    drop(database);
    fixture.migrate();
    let mut store = fixture.open();
    let snapshot = store.snapshot().unwrap();
    let pending = snapshot
        .torrents
        .iter()
        .find(|torrent| torrent.piece_count == 0)
        .unwrap();
    let resume = store.load_resume(&pending.torrent_id).unwrap();
    assert_eq!(pending.selection_default, FilePriority::Skip);
    assert!(!resume.desired_running);
    assert!(resume.download_queue_position.is_none());
    let response = store
        .handle_durable(&RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "resume-imported".to_owned(),
            expected_revision: None,
            command: Command::Resume {
                torrent_id: pending.torrent_id.clone(),
            },
        })
        .unwrap();
    assert!(matches!(response.outcome, ResponseOutcome::Success { .. }));
    assert!(
        store
            .load_resume(&pending.torrent_id)
            .unwrap()
            .download_queue_position
            .is_some()
    );
}

#[tokio::test]
async fn ordinary_offline_checker_reuses_good_bytes_and_rejects_corruption() {
    // Independently authored tiny metainfo; no external source fixture imported.
    for corrupt in [false, true] {
        let mut fixture = Fixture::cohort("linux");
        fixture.retain_only("alpha");
        let bytes = vec![42u8; 16384];
        let piece = <sha1::Sha1 as sha1::Digest>::digest(&bytes);
        let mut info =
            b"d6:lengthi16384e4:name10:shared.exe12:piece lengthi16384e6:pieces20:".to_vec();
        info.extend_from_slice(&piece);
        info.push(b'e');
        let hash = <sha1::Sha1 as sha1::Digest>::digest(&info)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let mut source = b"d4:info".to_vec();
        source.extend_from_slice(&info);
        source.push(b'e');
        let profile = &fixture.discovery.profiles[0];
        let mut payload = bytes.clone();
        if corrupt {
            payload[0] ^= 1;
        }
        fs::write(profile.download_roots[0].path.join("shared.exe"), &payload).unwrap();
        let database = fixture.database("alpha");
        database.execute_batch("DELETE FROM kv").unwrap();
        for (key, value) in [
            ("session:torrents".to_owned(), json!({"version":2,"torrents":[{"infoHash":hash,"source":"file"}]}).to_string()),
            (format!("session:torrent:{hash}:state"), json!({"userState":"stopped","storageKey":profile.download_roots[0].key,"bitfield":"ff","filePriorities":[0]}).to_string()),
            (format!("session:torrent:{hash}:torrentfile"), serde_json::to_string(&base64::engine::general_purpose::STANDARD.encode(&source)).unwrap()),
        ] { database.execute("INSERT INTO kv VALUES (?1, ?2)", params![key, value]).unwrap(); }
        drop(database);
        fixture.migrate();
        let mut store = fixture.open();
        let torrent_id = store.snapshot().unwrap().torrents[0].torrent_id.clone();
        let imported = store.load_resume(&torrent_id).unwrap();
        assert!(
            imported.safety_policy.extensions.is_empty(),
            "legacy import must retain executable-file intent"
        );
        assert!(imported.skip_files.is_empty());
        let transaction = store.connection.transaction().unwrap();
        replace_client_settings(
            &transaction,
            &ClientSettings {
                listener: crate::ListenerPolicy::AutomaticLoopback,
                ..ClientSettings::default()
            },
        )
        .unwrap();
        transaction.commit().unwrap();
        drop(store);
        let mut service = ApplicationService::open(
            ApplicationConfig::new(
                fixture.destination.clone(),
                "default".to_owned(),
                vec![],
                NetworkConfig::new(
                    NetworkPolicy::LoopbackOnly,
                    Duration::from_secs(1),
                    Duration::from_secs(1),
                ),
            )
            .with_path_root_startup_policy(PathRootStartupPolicy::PreserveUnavailable),
        )
        .await
        .unwrap();
        let id = snapshot(&mut service).await.torrents[0].torrent_id.clone();
        let result = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let snapshot = snapshot(&mut service).await;
                let torrent = &snapshot.torrents[0];
                if torrent.state != TorrentState::Checking {
                    break torrent.verified_piece_count;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(result, u32::from(!corrupt));
        assert!(
            !snapshot(&mut service)
                .await
                .torrents
                .iter()
                .find(|torrent| torrent.torrent_id == id)
                .unwrap()
                .desired_running
        );
        service.shutdown().await.unwrap();
        assert_eq!(
            fs::read(profile.download_roots[0].path.join("shared.exe")).unwrap(),
            payload
        );
    }
}

async fn snapshot(service: &mut ApplicationService) -> ServiceSnapshot {
    let response = service
        .dispatch(RequestEnvelope {
            version: CONTROL_VERSION,
            request_id: "migration-test-snapshot".to_owned(),
            expected_revision: None,
            command: Command::Snapshot,
        })
        .await
        .unwrap();
    match response.outcome {
        ResponseOutcome::Success { snapshot } => snapshot,
        outcome => panic!("{outcome:?}"),
    }
}

pub(super) fn commit_boundary(phase: &str) {
    if std::env::var("RSTORRENT_TEST_LEGACY_CRASH").as_deref() == Ok(phase) {
        std::process::exit(86);
    }
}

#[test]
fn atomic_boundary_child() {
    if let (Ok(destination), Ok(source)) = (
        std::env::var("RSTORRENT_TEST_LEGACY_DESTINATION"),
        std::env::var("RSTORRENT_TEST_LEGACY_SOURCE"),
    ) {
        SessionStore::migrate_legacy_desktop(
            Path::new(&destination),
            "default",
            Path::new(&source),
        )
        .unwrap();
    }
}

#[test]
fn process_exit_before_and_after_commit_has_one_atomic_outcome() {
    for phase in ["before_commit", "after_commit"] {
        let mut fixture = Fixture::cohort("linux");
        fixture.retain_only("disjoint");
        let database = fixture.database("disjoint");
        database
            .execute(
                "INSERT OR REPLACE INTO kv VALUES ('config:downloadSpeedUnlimited', 'false')",
                [],
            )
            .unwrap();
        database
            .execute(
                "INSERT OR REPLACE INTO kv VALUES ('config:downloadSpeedLimit', '1234')",
                [],
            )
            .unwrap();
        drop(database);
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "store::legacy_desktop::tests::atomic_boundary_child",
                "--nocapture",
            ])
            .env("RSTORRENT_TEST_LEGACY_CRASH", phase)
            .env("RSTORRENT_TEST_LEGACY_DESTINATION", &fixture.destination)
            .env("RSTORRENT_TEST_LEGACY_SOURCE", &fixture.source)
            .env("TMPDIR", fixture.owned.path())
            .env("TMP", fixture.owned.path())
            .env("TEMP", fixture.owned.path())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(86));
        let completed = phase == "after_commit";
        if completed {
            let store = fixture.open();
            assert!(store.legacy_desktop_import_report().unwrap().is_some());
            assert_eq!(store.snapshot().unwrap().torrents.len(), 2);
            assert_eq!(store.storage_roots().unwrap().len(), 1);
        } else {
            let read = Connection::open_with_flags(
                fixture.destination.join(DATABASE_FILENAME),
                OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .unwrap();
            let count: i64 = read
                .query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get(0))
                .unwrap();
            assert_eq!(count, 0); // Schema, settings, roots and records rolled back together.
            assert!(completed_report(&read).unwrap().is_none());
        }
        let report = fixture.migrate();
        assert_eq!(report.already_completed, completed);
        assert!(!report.settings_preserved);
        let snapshot = fixture.open().snapshot().unwrap();
        assert_eq!(snapshot.torrents.len(), 2);
        assert_eq!(
            snapshot.client_settings.download_rate_limit,
            TransferRateLimit::Limited {
                bytes_per_second: 1234
            }
        );
    }
}

#[test]
fn read_only_source_snapshot_is_durable_without_changing_legacy_bytes() {
    let owned = tempfile::tempdir().unwrap();
    let source_path = owned.path().join("data.db");
    let target_path = owned.path().join("snapshot.db");
    let source = Connection::open(&source_path).unwrap();
    source
        .execute_batch("CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO kv VALUES ('session:torrents', 'unchanged')")
        .unwrap();
    source.close().unwrap();
    let before = fs::read(&source_path).unwrap();
    let original_permissions = fs::metadata(&source_path).unwrap().permissions();
    let mut read_only = original_permissions.clone();
    read_only.set_readonly(true);
    fs::set_permissions(&source_path, read_only).unwrap();
    let result = snapshot_database(&source_path, &target_path);
    // Restore before asserting so Windows can remove the controlled fixture.
    fs::set_permissions(&source_path, original_permissions).unwrap();
    assert_eq!(fs::read(&source_path).unwrap(), before);
    let snapshot = result.unwrap();
    assert_eq!(read_kv(&snapshot).unwrap()["session:torrents"], "unchanged");
}
