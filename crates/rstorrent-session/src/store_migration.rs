//! Forward migration of shipped session catalogs.
//!
//! A catalog is never reset or discarded on upgrade. Each schema change after
//! the frozen baseline appends one hand-written step that moves a catalog from
//! its version to the next, and a released-catalog fixture proves it.
//! Fresh catalogs are the baseline plus every step, so fresh and migrated
//! catalogs cannot drift apart.
//!
//! SQLite cannot alter an existing column's type or constraint. A step that
//! needs one rebuilds the table inside the step (create the new table, copy
//! the rows, drop the old one, rename) and relies on the runner's foreign-key
//! check before commit; prefer additive changes where they express the model.

use rusqlite::{Connection, Transaction, TransactionBehavior};

use crate::store::StoreError;
use crate::store_schema::{BASELINE_SCHEMA_VERSION, SCHEMA_VERSION};

/// Debug builds only: set to fail every catalog migration (Tactical 369).
#[cfg(debug_assertions)]
pub(crate) const FAIL_MIGRATION_ENV: &str = "RSTORRENT_TEST_FAIL_MIGRATION";

/// Moves a catalog from one version to the next inside the runner's
/// transaction. It must not commit, change `user_version` or touch files.
pub(crate) type MigrationStep = fn(&Transaction<'_>) -> Result<(), StoreError>;

/// `MIGRATION_STEPS[i]` migrates `BASELINE_SCHEMA_VERSION + i` to the next
/// version. Append only; a step that has shipped is never edited.
const MIGRATION_STEPS: &[MigrationStep] = &[migrate_26_to_27, migrate_27_to_28, migrate_28_to_29];

const _: () = assert!(
    BASELINE_SCHEMA_VERSION + MIGRATION_STEPS.len() as i64 == SCHEMA_VERSION,
    "SCHEMA_VERSION must equal the baseline plus one migration step per version"
);

/// Schema 27 (Tactical 344): seeding stop limits. Session limits are NULL
/// for off; torrent overrides are NULL for the session limit and -1 for no
/// limit. `seed_limit_stopped` marks a pause made by a reached limit.
fn migrate_26_to_27(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    transaction.execute_batch(SEED_STOP_SETTINGS_COLUMNS_27)?;
    transaction.execute_batch(
        "ALTER TABLE torrents ADD COLUMN seed_stop_ratio_percent INTEGER CHECK (
            seed_stop_ratio_percent IS NULL OR
            seed_stop_ratio_percent BETWEEN -1 AND 2147483647
         );
         ALTER TABLE torrents ADD COLUMN seed_stop_time_seconds INTEGER CHECK (
            seed_stop_time_seconds IS NULL OR
            seed_stop_time_seconds BETWEEN -1 AND 2147483647
         );
         ALTER TABLE torrents ADD COLUMN seed_limit_stopped INTEGER NOT NULL DEFAULT 0
            CHECK (
                seed_limit_stopped IN (0, 1) AND
                (seed_limit_stopped = 0 OR desired_state = 'paused')
            );",
    )?;
    Ok(())
}

/// Schema 28 (Tactical 358): the quiet network defaults marker moves into the
/// catalog so applying the defaults and recording them share a transaction.
fn migrate_27_to_28(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    transaction.execute_batch(NETWORK_DEFAULTS_COLUMN_28)?;
    Ok(())
}

fn migrate_28_to_29(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    crate::store::file_state::migrate(transaction)?;
    crate::store::safety::migrate(transaction)
}

const NETWORK_DEFAULTS_COLUMN_28: &str = "ALTER TABLE client_settings
     ADD COLUMN network_defaults_version INTEGER NOT NULL DEFAULT 0
     CHECK (network_defaults_version >= 0);";

const SEED_STOP_SETTINGS_COLUMNS_27: &str =
    "ALTER TABLE client_settings ADD COLUMN seed_stop_ratio_percent INTEGER CHECK (
        seed_stop_ratio_percent IS NULL OR
        seed_stop_ratio_percent BETWEEN 0 AND 2147483647
     );
     ALTER TABLE client_settings ADD COLUMN seed_stop_time_seconds INTEGER CHECK (
        seed_stop_time_seconds IS NULL OR
        seed_stop_time_seconds BETWEEN 0 AND 2147483647
     );";

/// Brings a standalone baseline `client_settings` table, as settings tests
/// create it, to the current columns.
#[cfg(test)]
pub(crate) fn upgrade_client_settings_for_test(transaction: &Transaction<'_>) {
    transaction
        .execute_batch(SEED_STOP_SETTINGS_COLUMNS_27)
        .expect("schema 27 client settings columns");
    transaction
        .execute_batch(NETWORK_DEFAULTS_COLUMN_28)
        .expect("schema 28 client settings column");
    transaction
        .execute_batch(crate::store::safety::SETTINGS_SQL)
        .expect("schema 29 safety settings");
}

/// Brings a freshly created baseline catalog to the current version within
/// the creating transaction.
pub(crate) fn upgrade_fresh_catalog(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    apply_steps(transaction, BASELINE_SCHEMA_VERSION, MIGRATION_STEPS)
}

/// Migrates a stored catalog from `from` to the current version in one
/// transaction. On any error nothing is committed and the catalog keeps its
/// original version, so the next open retries.
pub(crate) fn migrate_catalog(connection: &mut Connection, from: i64) -> Result<(), StoreError> {
    migrate_with_steps(connection, from, MIGRATION_STEPS)
}

fn migrate_with_steps(
    connection: &mut Connection,
    from: i64,
    steps: &[MigrationStep],
) -> Result<(), StoreError> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let observed: i64 = transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if observed != from {
        return Err(StoreError::DurableState(format!(
            "catalog version changed from {from} to {observed} before migration"
        )));
    }
    apply_steps(&transaction, from, steps)?;
    // Tactical 369 dry runs: debug builds can fail a real migration after its
    // steps ran, exercising the rollback and the recovery screen.
    #[cfg(debug_assertions)]
    if std::env::var_os(FAIL_MIGRATION_ENV).is_some() {
        return Err(StoreError::DurableState(format!(
            "migration from schema {from} failed on purpose ({FAIL_MIGRATION_ENV})"
        )));
    }
    let violations: i64 =
        transaction.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })?;
    if violations != 0 {
        return Err(StoreError::DurableState(format!(
            "migration from schema {from} left {violations} foreign-key violations"
        )));
    }
    transaction.commit()?;
    Ok(())
}

fn apply_steps(
    transaction: &Transaction<'_>,
    from: i64,
    steps: &[MigrationStep],
) -> Result<(), StoreError> {
    let first = usize::try_from(from - BASELINE_SCHEMA_VERSION)
        .ok()
        .filter(|first| *first <= steps.len())
        .ok_or_else(|| StoreError::DurableState(format!("no migration path from schema {from}")))?;
    for (offset, step) in steps.iter().enumerate().skip(first) {
        step(transaction)?;
        let version = BASELINE_SCHEMA_VERSION + offset as i64 + 1;
        transaction.pragma_update(None, "user_version", version)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::Path;

    use rusqlite::{Connection, Transaction};

    use super::{MigrationStep, migrate_with_steps};
    use crate::SessionStore;
    use crate::profile_reset::{DATABASE_FILENAME, PRE_MIGRATION_FILENAME};
    use crate::store::StoreError;
    use crate::store_schema::{BASELINE_SCHEMA_VERSION, SCHEMA_VERSION};

    /// Every released catalog version with its fixture, generated by the
    /// release tag named in `tests/fixtures/catalog/README.md`.
    const RELEASED_CATALOGS: &[(i64, &[u8])] =
        &[(26, include_bytes!("../tests/fixtures/catalog/v26.sqlite"))];

    fn install_fixture(root: &Path, bytes: &[u8]) {
        fs::create_dir_all(root).expect("profile root");
        fs::write(root.join(DATABASE_FILENAME), bytes).expect("install fixture");
    }

    fn table_columns(connection: &Connection, table: &str) -> Vec<String> {
        let mut statement = connection
            .prepare(&format!(
                "SELECT name FROM pragma_table_info('{table}') ORDER BY cid"
            ))
            .expect("table columns");
        statement
            .query_map([], |row| row.get(0))
            .expect("query columns")
            .collect::<Result<_, _>>()
            .expect("column names")
    }

    /// Every row of every table, rendered so equal data compares equal.
    /// With `columns`, only those columns of each table are rendered.
    fn table_rows_with(
        connection: &Connection,
        columns: Option<&BTreeMap<String, Vec<String>>>,
    ) -> BTreeMap<String, Vec<String>> {
        let mut statement = connection
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .expect("list tables");
        let tables: Vec<String> = statement
            .query_map([], |row| row.get(0))
            .expect("query tables")
            .collect::<Result<_, _>>()
            .expect("table names");
        tables
            .into_iter()
            .map(|table| {
                let selected = columns
                    .and_then(|columns| columns.get(&table))
                    .map(|columns| {
                        columns
                            .iter()
                            .map(|column| format!("\"{column}\""))
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .unwrap_or_else(|| "*".to_owned());
                let mut statement = connection
                    .prepare(&format!("SELECT {selected} FROM \"{table}\""))
                    .expect("select rows");
                let columns = statement.column_count();
                let mut rows: Vec<String> = statement
                    .query_map([], |row| {
                        (0..columns)
                            .map(|index| {
                                let value: rusqlite::types::Value = row.get(index)?;
                                Ok(format!("{value:?}"))
                            })
                            .collect::<Result<Vec<_>, _>>()
                            .map(|values| values.join("|"))
                    })
                    .expect("query rows")
                    .collect::<Result<_, _>>()
                    .expect("rows");
                rows.sort();
                (table, rows)
            })
            .collect()
    }

    fn table_rows(connection: &Connection) -> BTreeMap<String, Vec<String>> {
        table_rows_with(connection, None)
    }

    fn schema(connection: &Connection) -> Vec<(String, String, Option<String>)> {
        let mut statement = connection
            .prepare(
                "SELECT type, name, sql FROM sqlite_master
                 WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
            )
            .expect("schema query");
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("schema rows")
            .collect::<Result<_, _>>()
            .expect("schema")
    }

    fn user_version(connection: &Connection) -> i64 {
        connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("user_version")
    }

    #[test]
    fn released_catalogs_open_with_every_row_and_the_fresh_schema() {
        let fresh_root = tempfile::tempdir().expect("fresh profile");
        let fresh = SessionStore::open(fresh_root.path(), "default", &[]).expect("fresh catalog");
        let fresh_schema = schema(fresh.connection());
        drop(fresh);

        for (version, bytes) in RELEASED_CATALOGS {
            let root = tempfile::tempdir().expect("profile");
            install_fixture(root.path(), bytes);
            let original = Connection::open(root.path().join(DATABASE_FILENAME)).expect("raw");
            assert_eq!(user_version(&original), *version);
            let original_rows = table_rows(&original);
            let original_columns: BTreeMap<String, Vec<String>> = original_rows
                .keys()
                .map(|table| (table.clone(), table_columns(&original, table)))
                .collect();
            assert!(
                original_rows["torrents"].len() >= 7,
                "fixture {version} must hold populated torrents"
            );
            drop(original);

            let store = SessionStore::open(root.path(), "default", &[])
                .unwrap_or_else(|error| panic!("open released catalog {version}: {error}"));
            assert_eq!(user_version(store.connection()), SCHEMA_VERSION);
            assert_eq!(
                schema(store.connection()),
                fresh_schema,
                "catalog {version} must migrate to exactly the fresh schema"
            );
            // Steps may add columns; every original column keeps its value.
            let migrated_rows = table_rows_with(store.connection(), Some(&original_columns));
            for (table, rows) in &original_rows {
                assert_eq!(
                    migrated_rows.get(table),
                    Some(rows),
                    "table {table} from released catalog {version} must survive unchanged"
                );
            }
            assert_eq!(
                store.snapshot().expect("snapshot").torrents.len(),
                original_rows["torrents"].len()
            );
            for (table, column) in [
                ("file_selection", "exceptions"),
                ("file_priorities", "high"),
            ] {
                let mut rows = store
                    .connection()
                    .prepare(&format!("SELECT torrent_id, {column} FROM file_state"))
                    .unwrap();
                let masks = rows
                    .query_map([], |row| {
                        Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Vec<u8>>(1)?))
                    })
                    .unwrap();
                for row in masks {
                    let (id, bytes) = row.unwrap();
                    let original = store.connection().prepare(&format!("SELECT file_index FROM {table} WHERE torrent_id = ?1 ORDER BY file_index")).unwrap().query_map([id], |row| row.get::<_, u32>(0)).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
                    assert_eq!(
                        crate::file_bitmap::FileBitmap::decode(bytes)
                            .unwrap()
                            .indices(),
                        original
                    );
                }
            }
            assert_eq!(
                store
                    .connection()
                    .query_row("SELECT count(*) FROM torrent_file_safety", [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                0,
                "migration never applies new rules to existing torrents or magnets"
            );
            drop(store);
            assert_eq!(
                root.path().join(PRE_MIGRATION_FILENAME).exists(),
                *version != SCHEMA_VERSION,
                "a pre-migration copy exists exactly when catalog {version} migrated"
            );
        }
    }

    #[test]
    fn migrated_v26_catalog_starts_without_stop_limits() {
        let root = tempfile::tempdir().expect("profile");
        install_fixture(root.path(), RELEASED_CATALOGS[0].1);
        let store = SessionStore::open(root.path(), "default", &[]).expect("migrate v26");
        let settings = store.client_settings().expect("settings");
        assert_eq!(settings.seed_stop_ratio_percent, crate::SeedStopLimit::Off);
        assert_eq!(settings.seed_stop_time_seconds, crate::SeedStopLimit::Off);
        let snapshot = store.snapshot().expect("snapshot");
        assert!(
            snapshot
                .torrents
                .iter()
                .any(|torrent| !torrent.desired_running)
        );
        for torrent in snapshot.torrents {
            assert_eq!(torrent.seed_stop_limits, Default::default());
            assert!(!torrent.seed_limit_stopped);
        }
        // Schema 28: released profiles have not had the quiet network
        // defaults applied, so the desktop applies them once on upgrade.
        let marker: i64 = store
            .connection()
            .query_row(
                "SELECT network_defaults_version FROM client_settings",
                [],
                |row| row.get(0),
            )
            .expect("network defaults marker");
        assert_eq!(marker, 0);
    }

    #[test]
    fn baseline_definitions_stay_frozen() {
        let (version, bytes) = RELEASED_CATALOGS[0];
        assert_eq!(version, BASELINE_SCHEMA_VERSION);
        let released = tempfile::tempdir().expect("released profile");
        install_fixture(released.path(), bytes);
        let released =
            Connection::open(released.path().join(DATABASE_FILENAME)).expect("released catalog");

        let mut fresh = Connection::open_in_memory().expect("fresh connection");
        let transaction = fresh.transaction().expect("transaction");
        crate::store::create_baseline_for_test(&transaction);
        transaction.commit().expect("commit baseline");
        assert_eq!(user_version(&fresh), BASELINE_SCHEMA_VERSION);
        assert_eq!(
            schema(&fresh),
            schema(&released),
            "the baseline definitions must match the released schema-26 catalog"
        );
    }

    fn add_column(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "ALTER TABLE client_settings ADD COLUMN test_step INTEGER NOT NULL DEFAULT 7;",
        )?;
        Ok(())
    }

    fn add_table(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "CREATE TABLE test_step_table(value INTEGER NOT NULL);
             INSERT INTO test_step_table VALUES (1);",
        )?;
        Ok(())
    }

    fn fail(_transaction: &Transaction<'_>) -> Result<(), StoreError> {
        Err(StoreError::DurableState("injected step failure".to_owned()))
    }

    fn orphan_reference(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "PRAGMA defer_foreign_keys = ON;
             INSERT INTO file_priorities(torrent_id, file_index, priority)
                VALUES (x'0102030405060708090a0b0c0d0e0f10', 0, 'high');",
        )?;
        Ok(())
    }

    fn baseline_fixture_connection(root: &Path) -> Connection {
        install_fixture(root, RELEASED_CATALOGS[0].1);
        let connection = Connection::open(root.join(DATABASE_FILENAME)).expect("fixture");
        connection
            .pragma_update(None, "foreign_keys", true)
            .expect("foreign keys");
        connection
    }

    #[test]
    fn runner_commits_every_step_and_its_version_together() {
        let root = tempfile::tempdir().expect("profile");
        let mut connection = baseline_fixture_connection(root.path());
        let before = table_rows(&connection);
        let steps: [MigrationStep; 2] = [add_column, add_table];
        migrate_with_steps(&mut connection, BASELINE_SCHEMA_VERSION, &steps).expect("migrate");
        assert_eq!(user_version(&connection), BASELINE_SCHEMA_VERSION + 2);
        let test_step: i64 = connection
            .query_row("SELECT test_step FROM client_settings", [], |row| {
                row.get(0)
            })
            .expect("added column");
        assert_eq!(test_step, 7);
        let after = table_rows(&connection);
        assert_eq!(after["torrents"], before["torrents"]);
        assert_eq!(after["test_step_table"].len(), 1);
    }

    #[test]
    fn failed_or_inconsistent_migration_leaves_the_catalog_unchanged() {
        let root = tempfile::tempdir().expect("profile");
        let mut connection = baseline_fixture_connection(root.path());
        let before = table_rows(&connection);
        let before_schema = schema(&connection);

        let failing: [MigrationStep; 2] = [add_column, fail];
        assert!(migrate_with_steps(&mut connection, BASELINE_SCHEMA_VERSION, &failing).is_err());
        assert_eq!(user_version(&connection), BASELINE_SCHEMA_VERSION);
        assert_eq!(schema(&connection), before_schema);
        assert_eq!(table_rows(&connection), before);

        let orphaning: [MigrationStep; 1] = [orphan_reference];
        assert!(migrate_with_steps(&mut connection, BASELINE_SCHEMA_VERSION, &orphaning).is_err());
        assert_eq!(user_version(&connection), BASELINE_SCHEMA_VERSION);
        assert_eq!(table_rows(&connection), before);

        let stale: [MigrationStep; 1] = [add_column];
        assert!(migrate_with_steps(&mut connection, BASELINE_SCHEMA_VERSION + 1, &stale).is_err());
        assert_eq!(table_rows(&connection), before);
    }
}
