//! Release admission facts. No updater networking or platform dependencies.
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path, time::Duration};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseCompatibility {
    pub schema_version: u32,
    pub stores: BTreeMap<String, StoreCompatibility>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StoreCompatibility {
    pub floor: u32,
    pub target: u32,
    pub lineage: BTreeMap<String, String>,
}
impl DatabaseCompatibility {
    pub fn current() -> Self {
        serde_json::from_str(include_str!(
            "../../../distribution/desktop-compatibility.json"
        ))
        .expect("source-checked database compatibility")
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 || self.stores.len() != 3 {
            return Err("Unsupported database compatibility metadata".into());
        }
        for name in ["session", "product", "metrics"] {
            let store = self
                .stores
                .get(name)
                .ok_or("Missing database compatibility store")?;
            if store.floor == 0
                || store.target < store.floor
                || store.target - store.floor > 255
                || store.lineage.len() != (store.target - store.floor + 1) as usize
            {
                return Err(format!("Invalid {name} schema range"));
            }
            for version in store.floor..=store.target {
                if !store
                    .lineage
                    .get(&version.to_string())
                    .is_some_and(|digest| {
                        digest.len() == 64
                            && digest
                                .bytes()
                                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    })
                {
                    return Err(format!("Invalid {name} migration history"));
                }
            }
        }
        Ok(())
    }
    /// Admission checks the actual store and every known preceding migration.
    pub fn admits(&self, installed: &Self, versions: &BTreeMap<String, u32>) -> Result<(), String> {
        self.validate()?;
        installed.validate()?;
        for name in ["session", "product", "metrics"] {
            let next = &self.stores[name];
            let old = &installed.stores[name];
            for (version, digest) in &old.lineage {
                if next.lineage.get(version) != Some(digest) {
                    return Err(format!(
                        "Waiting for a compatible release: {name} migration history differs"
                    ));
                }
            }
            if let Some(version) = versions.get(name)
                && (*version < next.floor || *version > next.target)
            {
                return Err(format!(
                    "Waiting for a compatible release: {name} database schema {version} is unsupported"
                ));
            }
        }
        Ok(())
    }
}
/// Inspect without creating, migrating or modifying a store. Metrics uses its
/// existing metadata row rather than SQLite user_version. Missing stores are
/// allowed; an unreadable, symlinked or unknown existing store fails closed.
pub fn inspect_update_database(path: &Path, metrics: bool) -> Result<Option<u32>, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Cannot inspect update database".into()),
    };
    if !metadata.file_type().is_file() {
        return Err("Update database is not a regular file".into());
    }
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "Cannot open update database for inspection")?;
    connection
        .busy_timeout(Duration::from_secs(2))
        .map_err(|_| "Cannot inspect update database")?;
    let value: i64 = if metrics {
        connection.query_row(
            "SELECT schema_version FROM metrics_meta WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
    } else {
        connection.pragma_query_value(None, "user_version", |row| row.get(0))
    }
    .map_err(|_| "Cannot read update database schema")?;
    u32::try_from(value)
        .ok()
        .filter(|v| *v > 0)
        .map(Some)
        .ok_or_else(|| "Invalid update database schema".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn release_facts_match_store_owners() {
        let current = DatabaseCompatibility::current();
        current.validate().unwrap();
        assert_eq!(
            current.stores["session"].target as i64,
            crate::store_schema::SCHEMA_VERSION
        );
        current.admits(&current, &BTreeMap::new()).unwrap();
    }
    #[test]
    fn rejects_newer_local_schema_and_changed_migration_and_missing_store() {
        let current = DatabaseCompatibility::current();
        let mut versions =
            BTreeMap::from([("session".into(), current.stores["session"].target + 1)]);
        assert!(current.admits(&current, &versions).is_err());
        versions.insert("session".into(), 1);
        assert!(current.admits(&current, &versions).is_err());
        let mut changed = current.clone();
        changed
            .stores
            .get_mut("session")
            .unwrap()
            .lineage
            .insert("26".into(), "a".repeat(64));
        assert!(changed.admits(&current, &BTreeMap::new()).is_err());
        changed.stores.remove("product");
        assert!(changed.validate().is_err());
    }
    #[test]
    fn admits_forward_schema_bump_but_never_the_reverse() {
        let current = DatabaseCompatibility::current();
        let mut next = current.clone();
        let store = next.stores.get_mut("session").unwrap();
        store.target += 1;
        store
            .lineage
            .insert(store.target.to_string(), "b".repeat(64));
        next.admits(&current, &BTreeMap::new()).unwrap();
        assert!(current.admits(&next, &BTreeMap::new()).is_err());
    }
    #[test]
    fn inspection_never_creates_or_changes_files_and_reads_wal() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("store.db");
        assert_eq!(inspect_update_database(&path, false).unwrap(), None);
        assert!(!path.exists());
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch("PRAGMA journal_mode=WAL; PRAGMA user_version=30;")
            .unwrap();
        assert_eq!(inspect_update_database(&path, false).unwrap(), Some(30));
        assert!(inspect_update_database(&path, true).is_err());
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            30
        );
    }
}
