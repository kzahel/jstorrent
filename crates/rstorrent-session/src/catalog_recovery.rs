//! What a host offers when its torrent catalog will not open (Tactical 369).
//!
//! Nothing here opens the catalog for writing. Diagnosis reads the stored
//! version; export reads a private copy of the database and its write-ahead
//! log, so a catalog that failed to migrate, is newer than this build, or is
//! otherwise refused stays byte-for-byte unchanged.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::profile_reset::{DATABASE_FILENAME, WAL_FILENAME, validate_fixed_file};
use crate::store_schema::{BASELINE_SCHEMA_VERSION, SCHEMA_VERSION};

const MAX_DETAILS_BYTES: usize = 2 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum CatalogRecoveryReason {
    /// An older catalog failed to migrate; it is unchanged and an update
    /// with a fix will migrate it.
    MigrationFailed,
    /// A newer version of the app wrote the catalog.
    NewerVersion,
    /// A pre-release catalog older than every supported version.
    RetiredVersion,
    /// Another running copy holds the catalog.
    Locked,
    /// The catalog or the app's other data could not be read.
    Unreadable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
pub struct CatalogRecoveryStatus {
    pub reason: CatalogRecoveryReason,
    /// The catalog's stored version, when it could be read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_version: Option<u32>,
    /// The catalog version this build writes.
    pub supported_version: u32,
    /// Whether the torrent list can be exported from the catalog.
    pub export_available: bool,
    /// Bounded text for a bug report: versions and the open error.
    pub details: String,
}

/// Classifies a catalog that failed to open, from its files and the open
/// error's text. Reads the stored version only.
pub fn diagnose_catalog(profile_root: &Path, failure: &str) -> CatalogRecoveryStatus {
    let catalog_version = read_catalog_version(profile_root);
    let lowered = failure.to_ascii_lowercase();
    let locked = lowered.contains("database is locked") || lowered.contains("is busy");
    let reason = match catalog_version {
        _ if locked => CatalogRecoveryReason::Locked,
        Some(version) if version > SCHEMA_VERSION => CatalogRecoveryReason::NewerVersion,
        Some(version) if (1..BASELINE_SCHEMA_VERSION).contains(&version) => {
            CatalogRecoveryReason::RetiredVersion
        }
        Some(version) if (BASELINE_SCHEMA_VERSION..SCHEMA_VERSION).contains(&version) => {
            CatalogRecoveryReason::MigrationFailed
        }
        _ => CatalogRecoveryReason::Unreadable,
    };
    let export_available =
        !locked && catalog_version.is_some_and(|version| version >= BASELINE_SCHEMA_VERSION);
    let mut details = format!(
        "catalog version: {}; supported version: {SCHEMA_VERSION}; error: {failure}",
        catalog_version.map_or_else(|| "unreadable".to_owned(), |version| version.to_string())
    );
    if details.len() > MAX_DETAILS_BYTES {
        details.truncate(details.floor_char_boundary(MAX_DETAILS_BYTES));
    }
    CatalogRecoveryStatus {
        reason,
        catalog_version: catalog_version.and_then(|version| u32::try_from(version).ok()),
        supported_version: u32::try_from(SCHEMA_VERSION).expect("schema version fits u32"),
        export_available,
        details,
    }
}

fn read_catalog_version(profile_root: &Path) -> Option<i64> {
    let path = profile_root.join(DATABASE_FILENAME);
    validate_fixed_file(&path, DATABASE_FILENAME).ok()?;
    if !path.is_file() {
        return None;
    }
    let connection = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .ok()
}

#[derive(Debug, Eq, PartialEq)]
pub struct CatalogExportError(pub String);

impl std::fmt::Display for CatalogExportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for CatalogExportError {}

/// The Tactical 348 torrent list bundle from a catalog that may not open
/// normally. Copies the database and any write-ahead log into a private
/// temporary directory and reads the copy; the profile is never written.
pub fn export_torrent_list_read_only(profile_root: &Path) -> Result<Vec<u8>, CatalogExportError> {
    let error = |message: String| CatalogExportError(message);
    let database = profile_root.join(DATABASE_FILENAME);
    let wal = profile_root.join(WAL_FILENAME);
    validate_fixed_file(&database, DATABASE_FILENAME).map_err(|e| error(e.to_string()))?;
    validate_fixed_file(&wal, WAL_FILENAME).map_err(|e| error(e.to_string()))?;
    if !database.is_file() {
        return Err(error("there is no torrent catalog to export".to_owned()));
    }
    let copy = tempfile::tempdir().map_err(|e| error(format!("create a working copy: {e}")))?;
    let copied_database = copy.path().join(DATABASE_FILENAME);
    std::fs::copy(&database, &copied_database)
        .map_err(|e| error(format!("copy the torrent catalog: {e}")))?;
    if wal.is_file() {
        std::fs::copy(&wal, copy.path().join(WAL_FILENAME))
            .map_err(|e| error(format!("copy the torrent catalog log: {e}")))?;
    }
    let connection =
        Connection::open(&copied_database).map_err(|e| error(format!("read the copy: {e}")))?;
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| error(format!("read the catalog version: {e}")))?;
    if version < BASELINE_SCHEMA_VERSION {
        return Err(error(format!(
            "catalog version {version} is older than any version this app can read"
        )));
    }
    let torrents = crate::store::torrent_list_export_from(&connection)
        .map_err(|e| error(format!("read torrents: {e}")))?;
    crate::torrent_list::write_bundle(torrents).map_err(|e| error(e.to_string()))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{CatalogRecoveryReason, diagnose_catalog, export_torrent_list_read_only};
    use crate::SessionStore;
    use crate::torrent_list::read_bundle;

    const RELEASED_V26: &[u8] = include_bytes!("../tests/fixtures/catalog/v26.sqlite");

    fn profile_files(root: &Path) -> Vec<(String, Vec<u8>)> {
        let mut files: Vec<_> = std::fs::read_dir(root)
            .unwrap()
            .map(|entry| {
                let entry = entry.unwrap();
                (
                    entry.file_name().to_string_lossy().into_owned(),
                    std::fs::read(entry.path()).unwrap(),
                )
            })
            .collect();
        files.sort();
        files
    }

    #[test]
    fn a_catalog_awaiting_migration_exports_without_changing_any_file() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("session.db"), RELEASED_V26).unwrap();
        let before = profile_files(root.path());
        let status = diagnose_catalog(root.path(), "migration from schema 26 failed");
        assert_eq!(status.reason, CatalogRecoveryReason::MigrationFailed);
        assert_eq!(status.catalog_version, Some(26_u32));
        assert!(status.export_available);
        let bundle = export_torrent_list_read_only(root.path()).unwrap();
        assert_eq!(read_bundle(&bundle).unwrap().len(), 6);
        assert_eq!(profile_files(root.path()), before);
    }

    #[test]
    fn rows_still_in_the_write_ahead_log_are_exported() {
        let live = tempfile::tempdir().unwrap();
        let payload = tempfile::tempdir().unwrap();
        let root = crate::ConfiguredStorageRoot::path("downloads", payload.path().to_owned());
        let mut store =
            SessionStore::open(live.path(), "default", std::slice::from_ref(&root)).unwrap();
        let added = store
            .handle_durable(&crate::RequestEnvelope {
                version: crate::CONTROL_VERSION,
                request_id: "wal-row".to_owned(),
                expected_revision: None,
                command: crate::Command::AddMagnet {
                    magnet: format!("magnet:?xt=urn:btih:{}", "cd".repeat(20)),
                    storage_root: "downloads".to_owned(),
                    start_content: false,
                    await_file_selection: false,
                    skip_files: Vec::new(),
                },
            })
            .unwrap();
        assert!(matches!(
            added.outcome,
            crate::ResponseOutcome::Success { .. }
        ));
        // Copy the profile as a crash would leave it: database plus log.
        let crashed = tempfile::tempdir().unwrap();
        for name in ["session.db", "session.db-wal"] {
            std::fs::copy(live.path().join(name), crashed.path().join(name)).unwrap();
        }
        drop(store);
        let before = profile_files(crashed.path());
        let bundle = export_torrent_list_read_only(crashed.path()).unwrap();
        let torrents = read_bundle(&bundle).unwrap();
        assert!(
            torrents
                .iter()
                .any(|torrent| torrent.manifest.info_hash_v1.as_deref() == Some(&"cd".repeat(20)))
        );
        assert_eq!(profile_files(crashed.path()), before);
    }

    #[test]
    fn newer_retired_locked_and_missing_catalogs_are_classified() {
        let newer = tempfile::tempdir().unwrap();
        std::fs::write(newer.path().join("session.db"), RELEASED_V26).unwrap();
        drop(SessionStore::open(newer.path(), "default", &[]).unwrap());
        rusqlite::Connection::open(newer.path().join("session.db"))
            .unwrap()
            .pragma_update(None, "user_version", 99)
            .unwrap();
        let status = diagnose_catalog(newer.path(), "session schema 99 is newer");
        assert_eq!(status.reason, CatalogRecoveryReason::NewerVersion);
        assert!(status.export_available);
        assert_eq!(
            read_bundle(&export_torrent_list_read_only(newer.path()).unwrap())
                .unwrap()
                .len(),
            6
        );

        let retired = tempfile::tempdir().unwrap();
        let connection = rusqlite::Connection::open(retired.path().join("session.db")).unwrap();
        connection
            .execute_batch("CREATE TABLE torrents(id INTEGER); PRAGMA user_version = 19;")
            .unwrap();
        drop(connection);
        let status = diagnose_catalog(retired.path(), "session schema 19 predates");
        assert_eq!(status.reason, CatalogRecoveryReason::RetiredVersion);
        assert!(!status.export_available);
        assert!(export_torrent_list_read_only(retired.path()).is_err());

        let locked = diagnose_catalog(newer.path(), "session database: database is locked");
        assert_eq!(locked.reason, CatalogRecoveryReason::Locked);
        assert!(!locked.export_available);

        let missing = tempfile::tempdir().unwrap();
        let status = diagnose_catalog(missing.path(), "product state could not open");
        assert_eq!(status.reason, CatalogRecoveryReason::Unreadable);
        assert!(!status.export_available);
        assert!(status.details.contains("product state could not open"));
    }
}
