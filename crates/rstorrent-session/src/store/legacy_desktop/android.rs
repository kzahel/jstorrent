//! Android source adapter. No JNI, Android lifecycle, or URI access lives here.
use super::*;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LegacyAndroidRootBinding {
    pub root_id: String,
    pub label: String,
    pub tree_uri: String,
}

/// Private bootstrap manifest, never a public diagnostic or application view.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct LegacyAndroidBootstrap {
    pub report: LegacyDesktopImportReport,
    pub roots: Vec<LegacyAndroidRootBinding>,
    pub default_root: Option<String>,
    pub preferences: BTreeMap<String, Value>,
}

#[derive(Deserialize)]
struct Roots {
    roots: Vec<AndroidRoot>,
}
#[derive(Deserialize)]
struct AndroidRoot {
    key: String,
    uri: String,
    display_name: String,
}

impl SessionStore {
    /// Call before ordinary open, after Android has replaced/killed the old package.
    /// `existing_bindings` comes from the current adapter registry, not old grants.
    pub fn migrate_legacy_android(
        profile_root: &Path,
        profile_id: &str,
        source_database: &Path,
        source_files: &Path,
        snapshot_directory: &Path,
        preferences_json: &str,
        existing_bindings: &[LegacyAndroidRootBinding],
    ) -> Result<Option<LegacyAndroidBootstrap>, StoreError> {
        if preferences_json.len() > 16 * 1024 || existing_bindings.len() > MAX_STORAGE_ROOTS {
            return Err(invalid("Android migration input exceeds bound"));
        }
        let database = profile_root.join(DATABASE_FILENAME);
        let mut existing = false;
        if database
            .try_exists()
            .map_err(|e| io_error("inspect destination", e))?
        {
            regular_file(&database)?;
            let read = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            existing = destination_catalog_exists(&read)?;
            if let Some(bootstrap) = android_bootstrap(&read)? {
                return Ok(Some(bootstrap));
            }
        }
        let mut preferences: BTreeMap<String, Value> = serde_json::from_str(preferences_json)?;
        // The platform supplies actual remaining encoded registry capacity,
        // including pending operations. This private bridge key is not a setting.
        let default_budget = (256usize * 1024)
            .saturating_sub(existing_bindings.iter().map(encoded_binding_cost).sum());
        let mut registry_budget =
            preferences
                .remove("_registry_budget_bytes")
                .map_or(default_budget, |value| {
                    value
                        .as_u64()
                        .and_then(|n| usize::try_from(n).ok())
                        .filter(|n| *n <= 256 * 1024)
                        .unwrap_or(0)
                });
        let database_present = source_database
            .try_exists()
            .map_err(|e| io_error("inspect legacy database", e))?;
        let roots_path = source_files.join("roots.json");
        let roots_present = roots_path
            .try_exists()
            .map_err(|e| io_error("inspect legacy roots", e))?;
        if !database_present && !roots_present && preferences.is_empty() {
            return Ok(None);
        }
        directory(source_files)?;
        directory(snapshot_directory)?;
        let backup = tempfile::Builder::new()
            .prefix("legacy-android-")
            .tempdir_in(snapshot_directory)
            .map_err(|e| io_error("create Android snapshot", e))?;
        let snapshot = if database_present {
            snapshot_database(source_database, &backup.path().join("jstorrent_kv.db"))?
        } else {
            // A companion-only/unused standalone app may have roots/preferences
            // without ever creating a native session. No synthetic source file.
            let empty = Connection::open_in_memory()?;
            empty.execute_batch(
                "CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT); PRAGMA user_version=1;",
            )?;
            empty
        };
        let version: i64 = snapshot.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version != 1 {
            return Err(invalid("unsupported Android legacy database version"));
        }
        let mut kv = read_kv(&snapshot)?;
        for key in [
            "config:activeDownloads",
            "config:activeSeeds",
            "config:upnpEnabled",
        ] {
            let value: Option<String> = snapshot
                .query_row(
                    "SELECT value FROM kv WHERE key = ?1 AND length(CAST(value AS BLOB)) <= 4096",
                    [key],
                    |row| row.get(0),
                )
                .optional()?
                .flatten();
            if let Some(value) = value {
                kv.insert(key.to_owned(), value);
            }
        }
        // An installed empty source legitimately has no session index yet.
        let index = if let Some(raw) = kv.get("session:torrents") {
            serde_json::from_str::<Index>(raw)?
        } else {
            let has_session: bool = snapshot.query_row(
                "SELECT EXISTS(SELECT 1 FROM kv WHERE key LIKE 'session:%')",
                [],
                |row| row.get(0),
            )?;
            if has_session {
                return Err(invalid("missing Android legacy index"));
            }
            Index {
                version: 2,
                torrents: vec![],
            }
        };
        if index.version != 2 || index.torrents.len() > MAX_RECORDS {
            return Err(invalid("unsupported Android session index"));
        }
        let source_roots = if roots_present {
            let bytes = bounded_file(&roots_path, MAX_DISCOVERY_BYTES)?;
            fs::write(backup.path().join("roots.json"), &bytes)
                .map_err(|e| io_error("snapshot legacy roots", e))?;
            serde_json::from_slice::<Roots>(&bytes)?.roots
        } else {
            vec![]
        };
        if source_roots.len() > MAX_STORAGE_ROOTS {
            return Err(invalid("legacy root count exceeds bound"));
        }
        let mut bootstrap = LegacyAndroidBootstrap::default();
        let mut roots = BTreeMap::new();
        let mut ambiguous = BTreeSet::new();
        for root in source_roots {
            // The pinned writer keys exact URIs by the first 16 SHA-256 hex digits.
            if root.key.len() != 16
                || root.key != format!("{:x}", Sha256::digest(root.uri.as_bytes()))[..16]
                || root.uri.len() > 16 * 1024
                || !root.uri.starts_with("content://")
                || !root.uri.contains("/tree/")
                || root.uri.contains('\0')
                || root.display_name.trim().is_empty()
                || root.display_name.contains('\0')
                || root.display_name.len() > 256
            {
                continue;
            }
            if roots.contains_key(&root.key) {
                ambiguous.insert(root.key);
                continue;
            }
            let current = existing_bindings
                .iter()
                .find(|binding| binding.tree_uri == root.uri);
            let binding = current.cloned().unwrap_or(LegacyAndroidRootBinding {
                root_id: format!("legacy-android-{}", root.key),
                label: root.display_name,
                tree_uri: root.uri,
            });
            if current.is_none() {
                let cost = encoded_binding_cost(&binding);
                if cost > registry_budget {
                    continue;
                }
                registry_budget -= cost;
            }
            if existing_bindings.iter().any(|current| {
                current.root_id == binding.root_id && current.tree_uri != binding.tree_uri
            }) {
                ambiguous.insert(root.key);
                continue;
            }
            roots.insert(root.key, binding);
        }
        roots.retain(|key, _| !ambiguous.contains(key));
        bootstrap.roots = roots.values().cloned().collect();
        // Read this supported root preference directly: desktop's closed map omits it.
        let default: Option<String> = snapshot.query_row("SELECT value FROM kv WHERE key = 'config:defaultRootKey' AND length(CAST(value AS BLOB)) <= 256", [], |row| row.get(0)).optional()?.flatten();
        bootstrap.default_root = default
            .and_then(|raw| serde_json::from_str::<String>(&raw).ok())
            .and_then(|key| roots.get(&key).map(|root| root.root_id.clone()));
        for (key, value) in preferences {
            if (matches!(
                key.as_str(),
                "wifi_only_enabled"
                    | "background_downloads_enabled"
                    | "cpu_wake_lock_enabled"
                    | "show_file_selection"
            ) && value.is_boolean())
                || (key == "when_downloads_complete"
                    && matches!(value.as_str(), Some("stop_and_close" | "keep_seeding")))
            {
                bootstrap.preferences.insert(key, value);
            }
        }
        let mut plan = Plan {
            records: vec![],
            report: LegacyDesktopImportReport {
                profiles: 1,
                ..Default::default()
            },
            settings: Some(best_effort_settings(&kv)),
            backup,
            android: Some(bootstrap),
        };
        for (ordinal, value) in index.torrents.into_iter().enumerate() {
            let result = (|| {
                let entry: Entry = serde_json::from_value(value)?;
                let prefix = format!("session:torrent:{}:state", entry.info_hash);
                let mut state: Value = serde_json::from_str(
                    kv.get(&prefix)
                        .ok_or_else(|| invalid("missing Android legacy state"))?,
                )?;
                // Missing storageKey takes the pinned FileBindings private fallback.
                if state.get("storageKey").is_none() {
                    state["storageKey"] = Value::String(String::new());
                }
                let state: State = serde_json::from_value(state)?;
                let root = if matches!(state.storage_key.as_str(), "" | "default") {
                    let path = source_files.join("downloads");
                    validate_storage_root("legacy-private", "Downloads", &path)?;
                    PlannedRoot {
                        display_name: "Downloads".to_owned(),
                        location: LegacyRootLocation::Path(path),
                    }
                } else {
                    let binding = roots
                        .get(&state.storage_key)
                        .ok_or_else(|| invalid("unknown Android legacy root"))?;
                    PlannedRoot {
                        display_name: binding.label.clone(),
                        location: LegacyRootLocation::Platform(binding.root_id.clone()),
                    }
                };
                plan_record_with_root(0, ordinal, entry, state, &kv, root)
            })();
            match result {
                Ok(record) => {
                    let bytes = record
                        .prepared
                        .as_ref()
                        .map_or(0, |prepared| prepared.source.len());
                    if plan.report.prepared_source_bytes + bytes > MAX_PREPARED_BYTES {
                        outcome(&mut plan.report, 0, ordinal, "source_bytes_limit");
                    } else {
                        plan.report.prepared_source_bytes += bytes;
                        plan.records.push(record);
                    }
                }
                Err(_) => outcome(&mut plan.report, 0, ordinal, "invalid_source_record"),
            }
        }
        let mut store = if existing {
            Self::open(profile_root, profile_id, &[])?
        } else {
            validate_identifier(
                profile_id,
                "profile ID",
                crate::control::MAX_PROFILE_ID_LENGTH,
            )
            .map_err(|(_, message)| invalid(&message))?;
            fs::create_dir_all(profile_root)
                .map_err(|e| io_error("create Android destination", e))?;
            let connection = Connection::open(&database)?;
            connection.busy_timeout(BUSY_TIMEOUT)?;
            connection.pragma_update(None, "foreign_keys", true)?;
            configure_durable_connection(&connection)?;
            Self {
                connection,
                profile_id: profile_id.to_owned(),
                database_path: Some(database),
                reset_client_settings: ClientSettings::fresh_profile_default(),
                pending_reconciliations: vec![],
            }
        };
        let report = store.apply_legacy_plan(plan, existing, ImportKind::Android)?;
        let mut bootstrap = android_bootstrap(&store.connection)?
            .ok_or_else(|| invalid("missing committed Android bootstrap"))?;
        bootstrap.report = report;
        Ok(Some(bootstrap))
    }
}

fn android_bootstrap(
    connection: &Connection,
) -> Result<Option<LegacyAndroidBootstrap>, StoreError> {
    let Some(mut report) = completed_report_for(connection, ImportKind::Android)? else {
        return Ok(None);
    };
    let raw: String = connection.query_row("SELECT bootstrap_json FROM legacy_android_import WHERE singleton = 1 AND length(bootstrap_json) <= 1048576", [], |row| row.get(0))?;
    let mut bootstrap: LegacyAndroidBootstrap = serde_json::from_str(&raw)?;
    // Adapter replay must not resurrect a root removed after migration.
    let mut roots = Vec::new();
    for root in bootstrap.roots {
        if connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM storage_roots WHERE root_id = ?1 AND kind = 'platform')",
            [&root.root_id],
            |row| row.get::<_, bool>(0),
        )? {
            roots.push(root);
        }
    }
    bootstrap.roots = roots;
    report.already_completed = true;
    bootstrap.report = report;
    Ok(Some(bootstrap))
}

// Java DataOutputStream.writeUTF uses modified UTF-8, then the registry
// base64-encodes its binary records. Round conservatively across record joins.
fn encoded_binding_cost(binding: &LegacyAndroidRootBinding) -> usize {
    let bytes = [&binding.root_id, &binding.label, &binding.tree_uri]
        .into_iter()
        .map(|value| {
            value
                .encode_utf16()
                .map(|unit| match unit {
                    0 => 2usize,
                    1..=0x7f => 1,
                    0x80..=0x7ff => 2,
                    _ => 3,
                })
                .sum::<usize>()
        })
        .sum::<usize>()
        + 14;
    bytes.div_ceil(3) * 4 + 4
}

fn best_effort_settings(kv: &BTreeMap<String, String>) -> ClientSettings {
    let mut valid = BTreeMap::new();
    // Rate policy/value form one setting; invalid groups leave the new default.
    for group in [
        vec!["config:dhtEnabled"],
        vec!["config:pexEnabled"],
        vec!["config:maxGlobalPeers"],
        vec!["config:maxUploadSlots"],
        vec!["config:encryptionPolicy"],
        vec!["config:uploadSpeedUnlimited", "config:uploadSpeedLimit"],
        vec!["config:downloadSpeedUnlimited", "config:downloadSpeedLimit"],
    ] {
        let mut candidate = valid.clone();
        for key in group {
            if let Some(value) = kv.get(key) {
                candidate.insert(key.to_owned(), value.clone());
            }
        }
        if map_settings(&[candidate.clone()]).is_ok() {
            valid = candidate;
        }
    }
    let mut settings = map_settings(&[valid]).expect("validated setting groups");
    for (key, raw) in kv {
        let mut candidate = settings.clone();
        let Ok(value) = serde_json::from_str::<Value>(raw) else {
            continue;
        };
        match key.as_str() {
            "config:activeDownloads" => {
                let Some(value) = value.as_u64().and_then(|n| u16::try_from(n).ok()) else {
                    continue;
                };
                candidate.active_downloads = value;
            }
            "config:activeSeeds" => {
                let Some(value) = value.as_u64().and_then(|n| u16::try_from(n).ok()) else {
                    continue;
                };
                candidate.active_seeds = crate::ActiveSeedLimit::Limited { torrents: value };
            }
            "config:upnpEnabled" => {
                let Some(value) = value.as_bool() else {
                    continue;
                };
                candidate.port_mapping = if value {
                    crate::PortMappingPolicy::Upnp
                } else {
                    crate::PortMappingPolicy::Disabled
                };
            }
            _ => continue,
        }
        if candidate.validate().is_ok() {
            settings = candidate;
        }
    }
    settings
}

#[cfg(test)]
mod tests;
