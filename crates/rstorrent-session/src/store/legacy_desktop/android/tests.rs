use super::*;

struct Fixture {
    owned: TempDir,
    db: PathBuf,
    files: PathBuf,
    destination: PathBuf,
    case: Value,
}
impl Fixture {
    fn new(name: &str) -> Self {
        let owned = tempfile::tempdir().unwrap();
        let files = owned.path().join("files");
        fs::create_dir(&files).unwrap();
        let cohort: Value = serde_json::from_slice(
            &fs::read(
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../tests/fixtures/legacy-android-v1.0.24/cohort.json"),
            )
            .unwrap(),
        )
        .unwrap();
        let case = cohort["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == name)
            .unwrap()
            .clone();
        let db = owned.path().join("jstorrent_kv.db");
        let connection = Connection::open(&db).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT); PRAGMA user_version=1;",
            )
            .unwrap();
        for (key, value) in case["kv"].as_object().unwrap() {
            connection
                .execute(
                    "INSERT INTO kv VALUES (?1,?2)",
                    params![key, value.as_str()],
                )
                .unwrap();
        }
        fs::write(
            files.join("roots.json"),
            serde_json::to_vec(&case["roots"]).unwrap(),
        )
        .unwrap();
        let destination = owned.path().join("destination");
        Self {
            owned,
            db,
            files,
            destination,
            case,
        }
    }
    fn import(&self) -> Result<Option<LegacyAndroidBootstrap>, StoreError> {
        SessionStore::migrate_legacy_android(
            &self.destination,
            "default",
            &self.db,
            &self.files,
            self.owned.path(),
            &self.case["preferences"].to_string(),
            &[],
        )
    }
}
#[test]
fn cohort_is_atomic_repeatable_and_source_preserving() {
    for (name, imported) in [
        ("intact_stopped", 1),
        ("corrupt_active", 1),
        ("revoked_grant", 1),
        ("cached_magnet_whitespace", 1),
        ("pending_stopped", 1),
        ("awaiting_selection", 1),
        ("missing_root", 0),
        ("nullable_state", 0),
        ("invalid_binary", 0),
        ("vpn_and_unmetered", 1),
        ("ambiguous_root", 0),
        ("empty", 0),
        ("private_default", 1),
    ] {
        let fixture = Fixture::new(name);
        let before = fs::read(&fixture.db).unwrap();
        let first = fixture.import().unwrap().unwrap();
        assert_eq!(first.report.imported, imported, "{name}");
        assert!(!first.report.already_completed);
        assert_eq!(fs::read(&fixture.db).unwrap(), before);
        let again = fixture.import().unwrap().unwrap();
        assert!(again.report.already_completed);
        assert_eq!(again.report.imported, imported);
        let store = SessionStore::open(&fixture.destination, "default", &[]).unwrap();
        for torrent in store.snapshot().unwrap().torrents {
            assert_eq!(torrent.verified_piece_count, 0);
        }
        if name == "pending_stopped" {
            let queue: Option<i64> = store
                .connection
                .query_row("SELECT download_queue_position FROM torrents", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(queue, None);
        }
        if name == "private_default" {
            assert!(!fixture.files.join("downloads").exists());
        }
        assert!(fixture.owned.path().exists());
    }
}
#[test]
fn unsupported_preferences_drop_and_bad_setting_does_not_hold_work() {
    let fixture = Fixture::new("vpn_and_unmetered");
    let connection = Connection::open(&fixture.db).unwrap();
    connection
        .execute(
            "INSERT INTO kv VALUES ('config:maxGlobalPeers','\"bad\"')",
            [],
        )
        .unwrap();
    let result = fixture.import().unwrap().unwrap();
    assert_eq!(result.preferences.len(), 1);
    assert_eq!(result.preferences["wifi_only_enabled"], true);
    assert!(!result.report.settings_need_attention);
    let store = SessionStore::open(&fixture.destination, "default", &[]).unwrap();
    let desired: String = store
        .connection
        .query_row("SELECT desired_state FROM torrents", [], |row| row.get(0))
        .unwrap();
    assert_eq!(desired, "running");
    assert!(!read_client_settings(&store.connection).unwrap().dht_enabled);
}
#[test]
fn current_torrent_wins_and_removal_is_not_resurrected() {
    let fixture = Fixture::new("intact_stopped");
    fixture.import().unwrap();
    let connection = Connection::open(fixture.destination.join(DATABASE_FILENAME)).unwrap();
    connection
        .execute("DROP TABLE legacy_android_import", [])
        .unwrap();
    let result = fixture.import().unwrap().unwrap();
    assert_eq!(result.report.already_present, 1);
    assert!(result.report.settings_preserved);
    connection.execute("DELETE FROM torrents", []).unwrap();
    connection.execute("DELETE FROM storage_roots", []).unwrap();
    let result = fixture.import().unwrap().unwrap();
    assert!(result.roots.is_empty());
    assert_eq!(result.report.imported, 0);
}
#[test]
fn unsupported_versions_and_corrupt_index_leave_no_catalog() {
    for version in [2, 99] {
        let fixture = Fixture::new("intact_stopped");
        Connection::open(&fixture.db)
            .unwrap()
            .pragma_update(None, "user_version", version)
            .unwrap();
        assert!(fixture.import().is_err());
        assert!(!fixture.destination.exists());
    }
    let fixture = Fixture::new("intact_stopped");
    Connection::open(&fixture.db)
        .unwrap()
        .execute(
            "UPDATE kv SET value='null' WHERE key='session:torrents'",
            [],
        )
        .unwrap();
    assert!(fixture.import().is_err());
    assert!(!fixture.destination.exists());
}
#[test]
fn committed_wal_is_snapshotted() {
    let fixture = Fixture::new("intact_stopped");
    let connection = Connection::open(&fixture.db).unwrap();
    connection
        .execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
        .unwrap();
    connection
        .execute(
            "UPDATE kv SET value='true' WHERE key='config:dhtEnabled'",
            [],
        )
        .unwrap();
    let before = fs::read(fixture.db.with_file_name("jstorrent_kv.db-wal")).unwrap();
    fixture.import().unwrap();
    assert_eq!(
        before,
        fs::read(fixture.db.with_file_name("jstorrent_kv.db-wal")).unwrap()
    );
    let store = SessionStore::open(&fixture.destination, "default", &[]).unwrap();
    assert!(read_client_settings(&store.connection).unwrap().dht_enabled);
}

#[test]
fn destination_failure_rolls_back_roots_and_marker() {
    let fixture = Fixture::new("intact_stopped");
    let store = SessionStore::open(&fixture.destination, "default", &[]).unwrap();
    store.connection.execute_batch("CREATE TRIGGER reject_import BEFORE INSERT ON torrents BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert!(fixture.import().is_err());
    let roots: i64 = store
        .connection
        .query_row("SELECT count(*) FROM storage_roots", [], |row| row.get(0))
        .unwrap();
    assert_eq!(roots, 0);
    assert!(
        completed_report_for(&store.connection, ImportKind::Android)
            .unwrap()
            .is_none()
    );
    store
        .connection
        .execute_batch("DROP TRIGGER reject_import")
        .unwrap();
    assert_eq!(fixture.import().unwrap().unwrap().report.imported, 1);
}

#[test]
fn atomic_android_boundary_child() {
    if let (Ok(destination), Ok(source)) = (
        std::env::var("RSTORRENT_TEST_ANDROID_DESTINATION"),
        std::env::var("RSTORRENT_TEST_ANDROID_SOURCE"),
    ) {
        SessionStore::migrate_legacy_android(
            Path::new(&destination),
            "default",
            &Path::new(&source).join("jstorrent_kv.db"),
            &Path::new(&source).join("files"),
            Path::new(&source),
            "{}",
            &[],
        )
        .unwrap();
    }
}

#[test]
fn process_exit_keeps_one_android_catalog_commit() {
    for phase in ["before_commit", "after_commit"] {
        let fixture = Fixture::new("intact_stopped");
        let staging = fixture.owned.path().join("child-tmp");
        fs::create_dir(&staging).unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "store::legacy_desktop::android::tests::atomic_android_boundary_child",
                "--nocapture",
            ])
            .env("RSTORRENT_TEST_ANDROID_DESTINATION", &fixture.destination)
            .env("RSTORRENT_TEST_ANDROID_SOURCE", fixture.owned.path())
            .env("RSTORRENT_TEST_LEGACY_CRASH", phase)
            .env("TMPDIR", &staging)
            .env("TMP", &staging)
            .env("TEMP", &staging)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(86));
        let result = fixture.import().unwrap().unwrap();
        assert_eq!(result.report.imported, 1);
        let store = SessionStore::open(&fixture.destination, "default", &[]).unwrap();
        assert_eq!(store.snapshot().unwrap().torrents.len(), 1);
        fs::remove_file(&fixture.db).unwrap();
        fs::remove_file(fixture.files.join("roots.json")).unwrap();
        assert_eq!(fixture.import().unwrap().unwrap().report.imported, 1);
    }
}

#[test]
fn invalid_root_labels_skip_binding_without_aborting_catalog() {
    for label in ["   ", "\0invalid"] {
        let fixture = Fixture::new("intact_stopped");
        let mut roots = fixture.case["roots"].clone();
        roots["roots"][0]["display_name"] = serde_json::Value::String(label.to_owned());
        fs::write(fixture.files.join("roots.json"), roots.to_string()).unwrap();
        let result = fixture.import().unwrap().unwrap();
        assert_eq!(result.report.imported, 0);
        assert_eq!(result.report.skipped, 1);
        assert!(result.roots.is_empty());
    }
}

#[test]
fn roots_and_preferences_carry_without_a_native_legacy_database() {
    let mut fixture = Fixture::new("intact_stopped");
    fs::remove_file(&fixture.db).unwrap();
    fixture.case["preferences"] = serde_json::json!({"wifi_only_enabled":true});
    let bootstrap = fixture.import().unwrap().unwrap();
    assert_eq!(bootstrap.report.imported, 0);
    assert_eq!(bootstrap.roots.len(), 1);
    assert_eq!(bootstrap.preferences["wifi_only_enabled"], true);
    assert!(!fixture.db.exists());
    let empty = Fixture::new("empty");
    fs::remove_file(&empty.db).unwrap();
    fs::remove_file(empty.files.join("roots.json")).unwrap();
    assert!(empty.import().unwrap().is_none());
    assert!(!empty.destination.exists());
}

#[test]
fn registry_capacity_is_checked_before_committing_source_bindings() {
    let mut fixture = Fixture::new("intact_stopped");
    fixture.case["preferences"] = serde_json::json!({"_registry_budget_bytes":0});
    let result = fixture.import().unwrap().unwrap();
    assert_eq!(result.report.imported, 0);
    assert_eq!(result.report.skipped, 1);
    assert!(result.roots.is_empty());
    assert!(!result.preferences.contains_key("_registry_budget_bytes"));
    let binding = LegacyAndroidRootBinding {
        root_id: "x".to_owned(),
        label: "a💩".to_owned(),
        tree_uri: "y".to_owned(),
    };
    assert_eq!(encoded_binding_cost(&binding), 36);
}
