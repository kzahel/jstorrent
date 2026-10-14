//! Session catalog files: how a stored catalog is opened, the copy kept
//! before migrating it, and the user's explicit Clear app data. Nothing here
//! discards a catalog that holds data on the application's own initiative.

use std::fs::{self, File};
use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, MAIN_DB, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::store::StoreError;
use crate::store_schema::{BASELINE_SCHEMA_VERSION, SCHEMA_VERSION};

pub(crate) const DATABASE_FILENAME: &str = "session.db";
const METRICS_DATABASE_FILENAME: &str = "metrics.db";
const WAL_FILENAME: &str = "session.db-wal";
const SHM_FILENAME: &str = "session.db-shm";
pub(crate) const PRE_MIGRATION_FILENAME: &str = "session.db.pre-migration";
const PRE_MIGRATION_TEMPORARY_FILENAME: &str = "session.db.pre-migration.tmp";
const INSPECTION_TIMEOUT: Duration = Duration::from_secs(2);

const USER_CLEAR_FILES: [&str; 8] = [
    "session.db-wal",
    "session.db-shm",
    DATABASE_FILENAME,
    PRE_MIGRATION_TEMPORARY_FILENAME,
    PRE_MIGRATION_FILENAME,
    "metrics.db-wal",
    "metrics.db-shm",
    METRICS_DATABASE_FILENAME,
];

pub(crate) fn preflight_private_profile_clear(profile_root: &Path) -> Result<(), StoreError> {
    let metadata = fs::symlink_metadata(profile_root)
        .map_err(|source| io_error("inspect profile directory", source))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(StoreError::UnsafeProfileFile {
            basename: "profile",
            reason: "profile root is not a real directory".to_owned(),
        });
    }
    for basename in USER_CLEAR_FILES {
        validate_fixed_file(&profile_root.join(basename), basename)?;
    }
    Ok(())
}

pub(crate) fn clear_private_profile(profile_root: &Path) -> Result<(), StoreError> {
    preflight_private_profile_clear(profile_root)?;
    for basename in USER_CLEAR_FILES {
        let path = profile_root.join(basename);
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(source) => return Err(io_error("clear private profile file", source)),
        }
    }
    sync_directory(profile_root)
}

/// A reset that an earlier release performed on a pre-baseline catalog. No new
/// reports are created; an unpublished one is still announced once.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProfileResetReport {
    pub previous_schema_version: i64,
    pub discarded_categories: Vec<String>,
    pub database_basenames_considered: Vec<String>,
    pub external_payload_modified: bool,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum CatalogPreparation {
    Current,
    Create,
    Migrate { from: i64 },
}

/// Decides how to open the profile catalog without ever discarding one that
/// holds data. Only the user's Clear app data removes a nonempty catalog.
pub(crate) fn prepare_catalog(profile_root: &Path) -> Result<CatalogPreparation, StoreError> {
    let database_path = profile_root.join(DATABASE_FILENAME);
    let wal_path = profile_root.join(WAL_FILENAME);
    let shm_path = profile_root.join(SHM_FILENAME);
    validate_fixed_file(&database_path, DATABASE_FILENAME)?;
    validate_fixed_file(&wal_path, WAL_FILENAME)?;
    validate_fixed_file(&shm_path, SHM_FILENAME)?;
    validate_fixed_file(
        &profile_root.join(PRE_MIGRATION_FILENAME),
        PRE_MIGRATION_FILENAME,
    )?;
    validate_fixed_file(
        &profile_root.join(PRE_MIGRATION_TEMPORARY_FILENAME),
        PRE_MIGRATION_TEMPORARY_FILENAME,
    )?;

    if !database_path.exists() {
        if wal_path.exists() || shm_path.exists() {
            return Err(StoreError::UnsafeProfileFile {
                basename: DATABASE_FILENAME,
                reason: "database is missing while SQLite auxiliary files remain".to_owned(),
            });
        }
        return Ok(CatalogPreparation::Create);
    }

    let database_length = fs::metadata(&database_path)
        .map_err(|source| io_error("inspect session database", source))?
        .len();
    if database_length == 0 {
        if wal_path.exists() || shm_path.exists() {
            return Err(StoreError::UnsafeProfileFile {
                basename: DATABASE_FILENAME,
                reason: "empty database has SQLite auxiliary files".to_owned(),
            });
        }
        // A zero-byte file holds no catalog, so replacing it loses nothing.
        remove_fixed_file(&database_path, DATABASE_FILENAME)?;
        sync_directory(profile_root)?;
        return Ok(CatalogPreparation::Create);
    }

    classify_catalog_version(
        inspect_user_version(&database_path)?,
        BASELINE_SCHEMA_VERSION,
        SCHEMA_VERSION,
    )
}

fn classify_catalog_version(
    version: i64,
    baseline: i64,
    current: i64,
) -> Result<CatalogPreparation, StoreError> {
    if version == current {
        Ok(CatalogPreparation::Current)
    } else if (baseline..current).contains(&version) {
        Ok(CatalogPreparation::Migrate { from: version })
    } else if (1..baseline).contains(&version) {
        Err(StoreError::RetiredSchema {
            actual: version,
            minimum: baseline,
        })
    } else if version > current {
        Err(StoreError::UnsupportedSchema {
            actual: version,
            maximum: current,
        })
    } else {
        Err(StoreError::UnsafeProfileFile {
            basename: DATABASE_FILENAME,
            reason: "nonempty database has no recognized schema version".to_owned(),
        })
    }
}

/// Copies the catalog beside itself before the first migration step, keeping
/// only the most recent copy. A failure leaves the catalog untouched.
pub(crate) fn write_pre_migration_copy(
    connection: &Connection,
    profile_root: &Path,
) -> Result<(), StoreError> {
    let temporary = profile_root.join(PRE_MIGRATION_TEMPORARY_FILENAME);
    let destination = profile_root.join(PRE_MIGRATION_FILENAME);
    remove_fixed_file_if_present(&temporary, PRE_MIGRATION_TEMPORARY_FILENAME)?;
    connection
        .backup(MAIN_DB, &temporary, None)
        .map_err(profile_sqlite_error)?;
    File::open(&temporary)
        .and_then(|file| file.sync_all())
        .map_err(|source| io_error("sync pre-migration copy", source))?;
    validate_fixed_file(&destination, PRE_MIGRATION_FILENAME)?;
    fs::rename(&temporary, &destination)
        .map_err(|source| io_error("publish pre-migration copy", source))?;
    sync_directory(profile_root)
}

fn inspect_user_version(database_path: &Path) -> Result<i64, StoreError> {
    let connection = Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(profile_sqlite_error)?;
    connection
        .busy_timeout(INSPECTION_TIMEOUT)
        .map_err(profile_sqlite_error)?;
    connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(profile_sqlite_error)
}

fn validate_fixed_file(path: &Path, basename: &'static str) -> Result<(), StoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(StoreError::UnsafeProfileFile {
            basename,
            reason: "symbolic links are not accepted".to_owned(),
        }),
        Ok(metadata) if !metadata.is_file() => Err(StoreError::UnsafeProfileFile {
            basename,
            reason: "path is not a regular file".to_owned(),
        }),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(io_error("inspect profile file", source)),
    }
}

fn remove_fixed_file_if_present(path: &Path, basename: &'static str) -> Result<(), StoreError> {
    if path.exists() {
        remove_fixed_file(path, basename)?;
    }
    Ok(())
}

fn remove_fixed_file(path: &Path, basename: &'static str) -> Result<(), StoreError> {
    validate_fixed_file(path, basename)?;
    fs::remove_file(path).map_err(|source| io_error("remove profile file", source))
}

#[cfg(unix)]
fn sync_directory(profile_root: &Path) -> Result<(), StoreError> {
    File::open(profile_root)
        .and_then(|directory| directory.sync_all())
        .map_err(|source| io_error("sync profile directory", source))
}

#[cfg(windows)]
fn sync_directory(_profile_root: &Path) -> Result<(), StoreError> {
    // Windows does not offer a portable unprivileged directory-fsync
    // operation. Opening a directory as a regular File fails with access
    // denied. The pre-migration copy is synced before its rename, and the
    // migration itself is one SQLite transaction. Those steps support
    // process-interruption recovery; they do not promise Unix
    // directory-barrier durability across arbitrary power loss.
    Ok(())
}

fn profile_sqlite_error(error: rusqlite::Error) -> StoreError {
    match &error {
        rusqlite::Error::SqliteFailure(failure, _)
            if matches!(
                failure.code,
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
            ) =>
        {
            StoreError::ProfileResetBusy
        }
        _ => StoreError::UnsafeProfileFile {
            basename: DATABASE_FILENAME,
            reason: error.to_string(),
        },
    }
}

fn io_error(operation: &'static str, source: std::io::Error) -> StoreError {
    StoreError::Io { operation, source }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use rusqlite::Connection;

    use super::{
        CatalogPreparation, DATABASE_FILENAME, PRE_MIGRATION_FILENAME, SHM_FILENAME, WAL_FILENAME,
        classify_catalog_version, clear_private_profile, prepare_catalog, write_pre_migration_copy,
    };
    use crate::SessionStore;
    use crate::store::StoreError;

    #[cfg(unix)]
    #[test]
    fn clear_private_profile_rejects_a_link_before_removing_any_file() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().expect("temporary profile");
        let profile = root.path().join("profile");
        fs::create_dir(&profile).expect("create profile");
        let session = profile.join(DATABASE_FILENAME);
        fs::write(&session, b"session").expect("write session sentinel");
        let outside = root.path().join("outside");
        fs::write(&outside, b"external").expect("write outside sentinel");
        symlink(&outside, profile.join("metrics.db")).expect("link metrics file");
        assert!(clear_private_profile(&profile).is_err());
        assert_eq!(fs::read(session).unwrap(), b"session");
        assert_eq!(fs::read(outside).unwrap(), b"external");
    }

    #[test]
    fn clear_private_profile_removes_the_pre_migration_copy() {
        let root = tempfile::tempdir().expect("temporary profile");
        fs::write(root.path().join(DATABASE_FILENAME), b"session").expect("session");
        fs::write(root.path().join(PRE_MIGRATION_FILENAME), b"copy").expect("copy");
        clear_private_profile(root.path()).expect("clear profile");
        assert!(!root.path().join(DATABASE_FILENAME).exists());
        assert!(!root.path().join(PRE_MIGRATION_FILENAME).exists());
    }

    fn catalog(root: &Path, version: i64) -> Vec<u8> {
        let path = root.join(DATABASE_FILENAME);
        let connection = Connection::open(&path).expect("catalog");
        connection
            .execute_batch(
                "CREATE TABLE torrents(value TEXT);
                 INSERT INTO torrents VALUES ('user data');",
            )
            .expect("catalog rows");
        connection
            .pragma_update(None, "user_version", version)
            .expect("catalog version");
        drop(connection);
        fs::read(path).expect("catalog bytes")
    }

    fn profile_files(root: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(root)
            .expect("list profile")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    #[test]
    fn versions_classify_without_any_reset() {
        assert_eq!(
            classify_catalog_version(26, 26, 26).unwrap(),
            CatalogPreparation::Current
        );
        assert_eq!(
            classify_catalog_version(26, 26, 28).unwrap(),
            CatalogPreparation::Migrate { from: 26 }
        );
        assert_eq!(
            classify_catalog_version(27, 26, 28).unwrap(),
            CatalogPreparation::Migrate { from: 27 }
        );
        assert!(matches!(
            classify_catalog_version(25, 26, 28),
            Err(StoreError::RetiredSchema {
                actual: 25,
                minimum: 26
            })
        ));
        assert!(matches!(
            classify_catalog_version(29, 26, 28),
            Err(StoreError::UnsupportedSchema {
                actual: 29,
                maximum: 28
            })
        ));
        for version in [0, -1] {
            assert!(matches!(
                classify_catalog_version(version, 26, 28),
                Err(StoreError::UnsafeProfileFile { .. })
            ));
        }
    }

    #[test]
    fn retired_and_future_catalogs_are_refused_byte_for_byte_unchanged() {
        for version in [1, 18, 19, 22, 25, crate::store_schema::SCHEMA_VERSION + 1] {
            let root = tempfile::tempdir().expect("profile");
            let bytes = catalog(root.path(), version);
            let files = profile_files(root.path());
            let error = SessionStore::open(root.path(), "default", &[])
                .err()
                .unwrap_or_else(|| panic!("schema {version} must be refused"));
            assert!(
                matches!(
                    error,
                    StoreError::RetiredSchema { .. } | StoreError::UnsupportedSchema { .. }
                ),
                "schema {version}: {error}"
            );
            assert_eq!(
                fs::read(root.path().join(DATABASE_FILENAME)).expect("catalog"),
                bytes,
                "schema {version} catalog must be untouched"
            );
            assert_eq!(profile_files(root.path()), files);
        }
    }

    #[test]
    fn empty_or_absent_catalog_is_created_and_auxiliary_leftovers_fail_closed() {
        let absent = tempfile::tempdir().expect("absent");
        assert_eq!(
            prepare_catalog(absent.path()).unwrap(),
            CatalogPreparation::Create
        );

        let empty = tempfile::tempdir().expect("empty");
        fs::write(empty.path().join(DATABASE_FILENAME), b"").expect("empty catalog");
        assert_eq!(
            prepare_catalog(empty.path()).unwrap(),
            CatalogPreparation::Create
        );
        assert!(!empty.path().join(DATABASE_FILENAME).exists());

        for leftover in [WAL_FILENAME, SHM_FILENAME] {
            let root = tempfile::tempdir().expect("leftover");
            fs::write(root.path().join(leftover), b"leftover").expect("leftover file");
            assert!(matches!(
                prepare_catalog(root.path()),
                Err(StoreError::UnsafeProfileFile { .. })
            ));
            assert!(root.path().join(leftover).exists());
        }
    }

    #[test]
    fn malformed_unversioned_and_unsafe_shapes_fail_closed() {
        let malformed = tempfile::tempdir().expect("malformed");
        fs::write(malformed.path().join(DATABASE_FILENAME), b"not sqlite").expect("malformed");
        assert!(matches!(
            prepare_catalog(malformed.path()),
            Err(StoreError::UnsafeProfileFile { .. })
        ));
        assert_eq!(
            fs::read(malformed.path().join(DATABASE_FILENAME)).unwrap(),
            b"not sqlite"
        );

        let unversioned = tempfile::tempdir().expect("unversioned");
        catalog(unversioned.path(), 0);
        assert!(matches!(
            prepare_catalog(unversioned.path()),
            Err(StoreError::UnsafeProfileFile { .. })
        ));
        assert!(unversioned.path().join(DATABASE_FILENAME).exists());

        #[cfg(unix)]
        for basename in [DATABASE_FILENAME, PRE_MIGRATION_FILENAME] {
            let root = tempfile::tempdir().expect("symlink");
            let target = root.path().join("target");
            fs::write(&target, b"target").expect("target");
            std::os::unix::fs::symlink(&target, root.path().join(basename)).expect("symlink");
            assert!(matches!(
                prepare_catalog(root.path()),
                Err(StoreError::UnsafeProfileFile { .. })
            ));
            assert_eq!(fs::read(&target).unwrap(), b"target");
        }
    }

    #[test]
    fn busy_catalog_fails_without_changing_it() {
        let root = tempfile::tempdir().expect("profile");
        let bytes = catalog(root.path(), 25);
        let blocker =
            Connection::open(root.path().join(DATABASE_FILENAME)).expect("blocking connection");
        blocker
            .execute_batch("BEGIN EXCLUSIVE;")
            .expect("exclusive blocker");
        assert!(matches!(
            prepare_catalog(root.path()),
            Err(StoreError::ProfileResetBusy)
        ));
        blocker.execute_batch("ROLLBACK;").expect("release blocker");
        drop(blocker);
        assert_eq!(
            fs::read(root.path().join(DATABASE_FILENAME)).unwrap(),
            bytes
        );
    }

    #[test]
    fn pre_migration_copy_holds_the_catalog_and_keeps_only_the_latest() {
        let root = tempfile::tempdir().expect("profile");
        catalog(root.path(), 26);
        let connection = Connection::open(root.path().join(DATABASE_FILENAME)).expect("catalog");
        write_pre_migration_copy(&connection, root.path()).expect("first copy");
        connection
            .execute("INSERT INTO torrents VALUES ('second')", [])
            .expect("change catalog");
        write_pre_migration_copy(&connection, root.path()).expect("second copy");

        let copy = Connection::open(root.path().join(PRE_MIGRATION_FILENAME)).expect("copy");
        let rows: i64 = copy
            .query_row("SELECT count(*) FROM torrents", [], |row| row.get(0))
            .expect("copied rows");
        let version: i64 = copy
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("copied version");
        assert_eq!((rows, version), (2, 26));
        drop(copy);
        assert_eq!(
            profile_files(root.path()),
            [DATABASE_FILENAME, PRE_MIGRATION_FILENAME]
        );
    }
}
