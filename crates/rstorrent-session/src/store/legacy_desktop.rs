//! Shared legacy conversion/atomic commit with desktop discovery and an Android adapter.
//! No runtime, engine, or payload writer exists here.
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::Read;
use std::net::{Ipv4Addr, SocketAddr, TcpStream};

use base64::Engine;
use rusqlite::backup::{Backup, StepResult};
use rusqlite::{OpenFlags, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tempfile::TempDir;

use super::*;
use crate::CONTROL_VERSION;

const MAX_DISCOVERY_BYTES: usize = 1024 * 1024;
const MAX_PROFILES: usize = 16;
const MAX_RECORDS: usize = 4096;
const MAX_DATABASE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_METAINFO_BYTES: usize = 8 * 1024 * 1024;
const MAX_PREPARED_BYTES: usize = 64 * 1024 * 1024;
const MAX_VALUE_BYTES: usize = 12 * 1024 * 1024;
const MAX_REPORT_BYTES: usize = 1024 * 1024;
mod android;
pub use android::{LegacyAndroidBootstrap, LegacyAndroidRootBinding};

#[derive(Clone, Copy)]
enum ImportKind {
    Desktop,
    Android,
}
impl ImportKind {
    fn table(self) -> &'static str {
        match self {
            Self::Desktop => "legacy_desktop_import",
            Self::Android => "legacy_android_import",
        }
    }
    fn backup_name(self) -> &'static str {
        match self {
            Self::Desktop => "legacy-desktop-backup",
            Self::Android => "legacy-android-backup",
        }
    }
}

/// Counts and ordinal outcomes only: no paths, tokens, names, or torrent hashes.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct LegacyDesktopImportReport {
    pub already_completed: bool,
    pub profiles: usize,
    pub skipped_profiles: Vec<usize>,
    pub imported: usize,
    pub already_present: usize,
    pub skipped: usize,
    pub imported_roots: usize,
    pub prepared_source_bytes: usize,
    pub settings_preserved: bool,
    pub settings_need_attention: bool,
    pub outcomes: Vec<LegacyDesktopRecordOutcome>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LegacyDesktopRecordOutcome {
    pub profile: usize,
    pub record: usize,
    pub disposition: String,
}

#[derive(Deserialize, Serialize)]
struct Discovery {
    version: u32,
    profiles: Vec<Profile>,
}

// Intentionally omit all runtime authority from the retained manifest.
#[derive(Deserialize, Serialize)]
struct Profile {
    profile_id: String,
    download_roots: Vec<Root>,
    #[serde(default, skip_serializing)]
    port: u16,
}

#[derive(Clone, Deserialize, Serialize)]
struct Root {
    key: String,
    path: PathBuf,
    display_name: String,
}

#[derive(Deserialize)]
struct Index {
    version: u32,
    torrents: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    info_hash: String,
    source: String,
    magnet_uri: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    user_state: String,
    storage_key: String,
    file_priorities: Option<Vec<u8>>,
    magnet_select_only: Option<Vec<u32>>,
    queue_position: Option<u64>,
}

#[derive(Clone, Debug)]
enum LegacyRootLocation {
    Path(PathBuf),
    Platform(String),
}
#[derive(Clone)]
struct PlannedRoot {
    display_name: String,
    location: LegacyRootLocation,
}

struct PlannedRecord {
    profile: usize,
    record: usize,
    identity: FullInfoHash,
    root: PlannedRoot,
    running: bool,
    awaiting_selection: bool,
    queue_position: u64,
    prepared: Option<PreparedTorrentBytes>,
    magnet: Option<String>,
    selection: FileSelectionIntent,
}

struct Plan {
    records: Vec<PlannedRecord>,
    report: LegacyDesktopImportReport,
    settings: Option<ClientSettings>,
    backup: TempDir,
    android: Option<LegacyAndroidBootstrap>,
}

impl SessionStore {
    /// Strict desktop-only entry point, invoked while both products are quiescent.
    /// Older destination formats are refused before ordinary reset-capable open.
    /// The caller must fence legacy relaunch and own the destination profile.
    pub fn migrate_legacy_desktop(
        profile_root: &Path,
        profile_id: &str,
        legacy_root: &Path,
    ) -> Result<Option<LegacyDesktopImportReport>, StoreError> {
        if profile_root
            .try_exists()
            .map_err(|e| io_error("inspect destination directory", e))?
        {
            directory(profile_root)?;
        }
        let database = profile_root.join(DATABASE_FILENAME);
        let mut existing = false;
        if database
            .try_exists()
            .map_err(|e| io_error("inspect destination", e))?
        {
            regular_file(&database)?;
            let read = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            let version: i64 = read.pragma_query_value(None, "user_version", |row| row.get(0))?;
            existing = version == SCHEMA_VERSION;
            let empty: bool = read.query_row(
                "SELECT NOT EXISTS(SELECT 1 FROM sqlite_master)",
                [],
                |row| row.get(0),
            )?;
            // A crash before the first transaction can leave an empty SQLite file.
            if !existing && !(version == 0 && empty) {
                return Err(StoreError::UnsupportedSchema {
                    actual: version,
                    maximum: SCHEMA_VERSION,
                });
            }
            if let Some(mut report) = completed_report(&read)? {
                report.already_completed = true;
                return Ok(Some(report));
            }
        }
        let discovery_file = legacy_root.join("rpc-info.json");
        if !discovery_file
            .try_exists()
            .map_err(|e| io_error("inspect legacy discovery", e))?
        {
            return Ok(None);
        }
        // Snapshot and validate first, before creating/opening the destination.
        let plan = prepare_plan(legacy_root)?;
        let mut store = if existing {
            Self::open_with_initial_client_settings(
                profile_root,
                profile_id,
                &[],
                &ClientSettings::fresh_profile_default(),
            )?
        } else {
            validate_identifier(
                profile_id,
                "profile ID",
                crate::control::MAX_PROFILE_ID_LENGTH,
            )
            .map_err(|(_, message)| invalid(&message))?;
            fs::create_dir_all(profile_root)
                .map_err(|e| io_error("create destination directory", e))?;
            let connection = Connection::open(&database)?;
            connection.busy_timeout(BUSY_TIMEOUT)?;
            connection.pragma_update(None, "foreign_keys", true)?;
            configure_durable_connection(&connection)?;
            Self {
                connection,
                profile_id: profile_id.to_owned(),
                database_path: Some(database),
                reset_client_settings: ClientSettings::fresh_profile_default(),
                pending_reconciliations: Vec::new(),
            }
        };
        store
            .apply_legacy_plan(plan, existing, ImportKind::Desktop)
            .map(Some)
    }

    /// Completion survives removal of imported torrents: never resurrect on startup.
    pub fn legacy_desktop_import_report(
        &self,
    ) -> Result<Option<LegacyDesktopImportReport>, StoreError> {
        completed_report(&self.connection)
    }

    fn apply_legacy_plan(
        &mut self,
        mut plan: Plan,
        existing: bool,
        kind: ImportKind,
    ) -> Result<LegacyDesktopImportReport, StoreError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if !existing {
            create_schema_26(
                &transaction,
                &self.profile_id,
                &ClientSettings::fresh_profile_default(),
            )?;
            crate::store_migration::upgrade_fresh_catalog(&transaction)?;
        }
        if let Some(mut report) = completed_report_for(&transaction, kind)? {
            report.already_completed = true;
            return Ok(report);
        }
        plan.report.settings_preserved = existing;
        let original_default: Option<String> =
            transaction.query_row("SELECT default_root FROM storage_settings", [], |row| {
                row.get(0)
            })?;
        if !existing && let Some(settings) = &plan.settings {
            replace_client_settings(&transaction, settings)?;
        }
        if let Some(bootstrap) = &plan.android {
            if !existing
                && let Some(value) = bootstrap
                    .preferences
                    .get("show_file_selection")
                    .and_then(Value::as_bool)
            {
                transaction.execute(
                    "UPDATE storage_settings SET show_file_selection = ?1",
                    [value],
                )?;
            }
            for binding in &bootstrap.roots {
                install_root(
                    &transaction,
                    &PlannedRoot {
                        display_name: binding.label.clone(),
                        location: LegacyRootLocation::Platform(binding.root_id.clone()),
                    },
                    &mut plan.report,
                )?;
            }
            if !existing && let Some(default) = &bootstrap.default_root {
                transaction.execute("UPDATE storage_settings SET default_root = ?1 WHERE EXISTS(SELECT 1 FROM storage_roots WHERE root_id = ?1)", [default])?;
            }
        }
        // Decide conflicts among legacy copies before insertion; current owners win.
        let mut signatures: BTreeMap<FullInfoHash, BTreeSet<String>> = BTreeMap::new();
        for record in &plan.records {
            signatures
                .entry(record.identity)
                .or_default()
                .insert(format!(
                    "{:?}/{}/{}/{:?}",
                    record.root.location,
                    record.running,
                    record.awaiting_selection,
                    record.selection,
                ));
        }
        plan.records
            .sort_by_key(|record| (record.queue_position, record.profile, record.record));
        for record in &plan.records {
            if existing_owner(&transaction, record)? {
                outcome(
                    &mut plan.report,
                    record.profile,
                    record.record,
                    "already_present",
                );
                continue;
            }
            if signatures[&record.identity].len() > 1 {
                outcome(
                    &mut plan.report,
                    record.profile,
                    record.record,
                    "conflicting_legacy_copies",
                );
                continue;
            }
            let Some(root_id) = install_root(&transaction, &record.root, &mut plan.report)? else {
                outcome(
                    &mut plan.report,
                    record.profile,
                    record.record,
                    "root_limit",
                );
                continue;
            };
            // Validated intake failures here are destination failures: rollback all.
            let revision = read_revision(&transaction)?;
            let result = if let Some(prepared) = &record.prepared {
                let request = bytes_request(
                    root_id.clone(),
                    prepared.source.len(),
                    record.selection.clone(),
                );
                match add_torrent_bytes(&transaction, &request, prepared, revision) {
                    Ok((_, result)) => result,
                    Err(AddTorrentBytesError::Store(error)) => return Err(error),
                    Err(AddTorrentBytesError::Response(_, message)) => {
                        return Err(StoreError::Configuration(message));
                    }
                }
            } else {
                add_magnet(
                    &transaction,
                    record.magnet.as_deref().expect("planned magnet"),
                    &root_id,
                    false,
                    record.awaiting_selection,
                    &[],
                    revision,
                )
                .map_err(|(_, message)| StoreError::DurableState(message))?
                .1
            };
            let id = decode_torrent_id(&result.torrent_id).expect("intake returns typed ID");
            let running = record.running
                && !record.awaiting_selection
                && !(plan.report.settings_need_attention && !existing);
            transaction.execute(
                "UPDATE torrents SET desired_state = ?2, awaiting_file_selection = ?3,
                 seed_limit_stopped = CASE WHEN ?2 = 'running' THEN 0 ELSE seed_limit_stopped END,
                 verification_requested = CASE WHEN raw_info IS NULL THEN 0 ELSE 1 END,
                 product_completion_eligible = 0 WHERE torrent_id = ?1",
                params![
                    id.as_bytes(),
                    if running { "running" } else { "paused" },
                    record.awaiting_selection
                ],
            )?;
            if record.prepared.is_none() {
                transaction.execute(
                    "DELETE FROM pending_selection_ranges WHERE torrent_id = ?1",
                    [id.as_bytes()],
                )?;
                match &record.selection {
                    FileSelectionIntent::All => {}
                    FileSelectionIntent::None => {
                        transaction.execute("UPDATE torrents SET selection_default = 'skipped' WHERE torrent_id = ?1", [id.as_bytes()])?;
                    }
                    FileSelectionIntent::WantedRanges { ranges } => {
                        transaction.execute("UPDATE torrents SET selection_default = 'skipped' WHERE torrent_id = ?1", [id.as_bytes()])?;
                        let ranges = ranges
                            .iter()
                            .map(|range| MagnetFileIndexRange {
                                start: range.start,
                                end: range.end_exclusive - 1,
                            })
                            .collect::<Vec<_>>();
                        write_pending_ranges(&transaction, &id, &ranges)
                            .map_err(|(_, message)| invalid(&message))?;
                    }
                }
            }
            if record.prepared.is_none()
                && ((!running && !record.awaiting_selection)
                    || (plan.report.settings_need_attention && !existing))
            {
                // Ordinary metadata-only intake fetches even while content is paused.
                // A legacy stopped magnet has no admission rank until explicit Resume.
                transaction.execute(
                    "UPDATE torrents SET download_queue_position = NULL WHERE torrent_id = ?1",
                    [id.as_bytes()],
                )?;
            }
            if running && record.prepared.is_some() {
                download_queue::append(&transaction, &id)?;
            }
            if let Some(magnet) = &record.magnet
                && record.prepared.is_some()
            {
                preserve_magnet(&transaction, &id, magnet)?;
            }
            outcome(&mut plan.report, record.profile, record.record, "imported");
        }
        if existing {
            transaction.execute(
                "UPDATE storage_settings SET default_root = ?1",
                [original_default],
            )?;
        }
        plan.report
            .outcomes
            .sort_by_key(|row| (row.profile, row.record));
        let report_json = serde_json::to_string(&plan.report)?;
        if report_json.len() > MAX_REPORT_BYTES {
            return Err(invalid("migration report exceeds bound"));
        }
        // Retain snapshots at the destination before the marker can reference them.
        // Copying affects only application-private backup files, never payload.
        let profile_root = self
            .database_path
            .as_ref()
            .and_then(|path| path.parent())
            .ok_or_else(|| invalid("legacy import requires a durable destination"))?;
        let backup_name = kind.backup_name();
        let backup_path = profile_root.join(backup_name);
        if backup_path
            .try_exists()
            .map_err(|e| io_error("inspect migration backup", e))?
        {
            // Retry may have left a snapshot before rollback. Never recursively delete it.
            directory(&backup_path)?;
        } else {
            fs::create_dir(&backup_path).map_err(|e| io_error("create migration backup", e))?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&backup_path, fs::Permissions::from_mode(0o700))
                .map_err(|e| io_error("protect migration backups", e))?;
        }
        let retained = tempfile::Builder::new()
            .prefix("snapshot-")
            .tempdir_in(&backup_path)
            .map_err(|e| io_error("retain migration snapshots", e))?;
        for entry in
            fs::read_dir(plan.backup.path()).map_err(|e| io_error("read migration snapshots", e))?
        {
            let entry = entry.map_err(|e| io_error("read migration snapshot", e))?;
            let target = retained.path().join(entry.file_name());
            let mut destination = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(|e| io_error("retain migration snapshot", e))?;
            std::io::copy(
                &mut File::open(entry.path()).map_err(|e| io_error("open snapshot", e))?,
                &mut destination,
            )
            .map_err(|e| io_error("copy migration snapshot", e))?;
            destination
                .sync_all()
                .map_err(|e| io_error("sync migration snapshot", e))?;
        }
        // Sync directory entries before the durable SQLite marker references them.
        #[cfg(unix)]
        {
            for directory in [retained.path(), backup_path.as_path(), profile_root] {
                File::open(directory)
                    .and_then(|file| file.sync_all())
                    .map_err(|e| io_error("sync backup directory", e))?;
            }
        }
        let backup_directory = retained
            .path()
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| invalid("invalid migration snapshot name"))?;
        transaction.execute_batch(&format!(
            "CREATE TABLE {} (
             singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
             report_json TEXT NOT NULL CHECK(length(report_json) <= 1048576),
             backup_directory TEXT NOT NULL CHECK(length(backup_directory) <= 128),
             bootstrap_json TEXT CHECK(length(bootstrap_json) <= 1048576)
             );",
            kind.table()
        ))?;
        if let Some(bootstrap) = &mut plan.android {
            bootstrap.report = plan.report.clone();
        }
        let bootstrap_json = plan
            .android
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        transaction.execute(
            &format!("INSERT INTO {} VALUES (1, ?1, ?2, ?3)", kind.table()),
            params![report_json, backup_directory, bootstrap_json],
        )?;
        #[cfg(test)]
        tests::commit_boundary("before_commit");
        transaction.commit()?;
        #[cfg(test)]
        tests::commit_boundary("after_commit");
        let _ = retained.keep();
        Ok(plan.report)
    }
}

fn existing_owner(
    transaction: &Transaction<'_>,
    record: &PlannedRecord,
) -> Result<bool, StoreError> {
    let hashes = if let Some(prepared) = &record.prepared {
        prepared.projection.content.info_hashes()
    } else {
        Magnet::parse(record.magnet.as_deref().expect("planned magnet"))
            .map_err(|_| invalid("invalid planned magnet"))?
            .identities
    };
    let mut identities = Vec::new();
    hashes.for_each(|hash| identities.push(hash));
    for hash in identities {
        if find_torrent_id_by_full_hash(transaction, hash)?.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn completed_report(
    connection: &Connection,
) -> Result<Option<LegacyDesktopImportReport>, StoreError> {
    completed_report_for(connection, ImportKind::Desktop)
}

fn completed_report_for(
    connection: &Connection,
    kind: ImportKind,
) -> Result<Option<LegacyDesktopImportReport>, StoreError> {
    if !connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = ?1)",
        [kind.table()],
        |row| row.get::<_, bool>(0),
    )? {
        return Ok(None);
    }
    let json: String = connection.query_row(
        &format!(
            "SELECT report_json FROM {} WHERE singleton = 1 AND length(report_json) <= ?1",
            kind.table()
        ),
        [MAX_REPORT_BYTES as i64],
        |row| row.get(0),
    )?;
    Ok(Some(serde_json::from_str(&json)?))
}

fn prepare_plan(legacy_root: &Path) -> Result<Plan, StoreError> {
    directory(legacy_root)?;
    let discovery_path = legacy_root.join("rpc-info.json");
    let mut discovery: Discovery =
        serde_json::from_slice(&bounded_file(&discovery_path, MAX_DISCOVERY_BYTES)?)?;
    if discovery.version != 1 {
        return Err(invalid("unsupported legacy discovery version"));
    }
    if discovery.profiles.len() > MAX_PROFILES {
        return Err(invalid("too many legacy profiles"));
    }
    discovery
        .profiles
        .sort_by(|a, b| a.profile_id.cmp(&b.profile_id));
    refuse_live_sources(&discovery)?;
    let mut plan = Plan {
        records: Vec::new(),
        report: LegacyDesktopImportReport {
            profiles: discovery.profiles.len(),
            ..Default::default()
        },
        settings: None,
        android: None,
        backup: tempfile::tempdir().map_err(|e| io_error("create source snapshots", e))?,
    };
    let mut seen_profiles = BTreeSet::new();
    let mut total_records = 0usize;
    let mut configs = Vec::new();
    for (profile_index, profile) in discovery.profiles.iter().enumerate() {
        let result = (|| {
            if uuid::Uuid::parse_str(&profile.profile_id).is_err()
                || !seen_profiles.insert(&profile.profile_id)
            {
                return Err(invalid("invalid or repeated legacy profile ID"));
            }
            if profile.download_roots.len() > MAX_STORAGE_ROOTS {
                return Err(invalid("too many legacy roots"));
            }
            let profiles_path = legacy_root.join("profiles");
            directory(&profiles_path)?;
            let profile_path = profiles_path.join(&profile.profile_id);
            directory(&profile_path)?;
            let snapshot_path = plan
                .backup
                .path()
                .join(format!("{}.db", profile.profile_id));
            let snapshot = snapshot_database(&profile_path.join("data.db"), &snapshot_path)?;
            let kv = read_kv(&snapshot)?;
            let index: Index = serde_json::from_str(
                kv.get("session:torrents")
                    .ok_or_else(|| invalid("missing legacy torrent index"))?,
            )?;
            if index.version != 2 {
                return Err(invalid("unsupported legacy session version"));
            }
            total_records = total_records
                .checked_add(index.torrents.len())
                .ok_or_else(|| invalid("record count overflow"))?;
            if total_records > MAX_RECORDS {
                return Err(invalid("legacy record count exceeds bound"));
            }
            configs.push(
                kv.iter()
                    .filter(|(key, _)| key.starts_with("config:"))
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect::<BTreeMap<_, _>>(),
            );
            for (record_index, entry) in index.torrents.into_iter().enumerate() {
                match plan_record(profile_index, record_index, profile, entry, &kv) {
                    Ok(record) => {
                        let bytes = record
                            .prepared
                            .as_ref()
                            .map_or(0, |prepared| prepared.source.len());
                        if plan.report.prepared_source_bytes + bytes > MAX_PREPARED_BYTES {
                            outcome(
                                &mut plan.report,
                                profile_index,
                                record_index,
                                "source_bytes_limit",
                            );
                        } else {
                            plan.report.prepared_source_bytes += bytes;
                            plan.records.push(record);
                        }
                    }
                    Err(_) => outcome(
                        &mut plan.report,
                        profile_index,
                        record_index,
                        "invalid_source_record",
                    ),
                }
            }
            Ok::<_, StoreError>(())
        })();
        if result.is_err() {
            plan.report.skipped_profiles.push(profile_index);
        }
    }
    // Check for active owners again after backup; callers still own relaunch fencing.
    refuse_live_sources(&discovery)?;
    fs::write(
        plan.backup.path().join("roots.json"),
        serde_json::to_vec(&discovery)?,
    )
    .map_err(|e| io_error("save sanitized root snapshot", e))?;
    match map_settings(&configs) {
        Ok(settings) => plan.settings = Some(settings),
        Err(_) => plan.report.settings_need_attention = true,
    }
    Ok(plan)
}

fn plan_record(
    profile_index: usize,
    record_index: usize,
    profile: &Profile,
    entry: Value,
    kv: &BTreeMap<String, String>,
) -> Result<PlannedRecord, StoreError> {
    let entry: Entry = serde_json::from_value(entry)?;
    decode_hex_hash(&entry.info_hash)?;
    let prefix = format!("session:torrent:{}", entry.info_hash);
    let state: State = serde_json::from_str(
        kv.get(&format!("{prefix}:state"))
            .ok_or_else(|| invalid("missing legacy state"))?,
    )?;
    if !matches!(
        state.user_state.as_str(),
        "active" | "stopped" | "queued" | "awaitingFileSelection"
    ) {
        return Err(invalid("unknown legacy run intent"));
    }
    let roots: Vec<_> = profile
        .download_roots
        .iter()
        .filter(|root| root.key == state.storage_key)
        .collect();
    if roots.len() != 1 {
        return Err(invalid("unknown or ambiguous legacy root"));
    }
    let root = roots[0].clone();
    validate_storage_root("legacy-root", &root.display_name, &root.path)?;
    if root
        .path
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(invalid("non-normal legacy root path"));
    }
    plan_record_with_root(
        profile_index,
        record_index,
        entry,
        state,
        kv,
        PlannedRoot {
            display_name: root.display_name,
            location: LegacyRootLocation::Path(root.path),
        },
    )
}

fn plan_record_with_root(
    profile_index: usize,
    record_index: usize,
    entry: Entry,
    state: State,
    kv: &BTreeMap<String, String>,
    root: PlannedRoot,
) -> Result<PlannedRecord, StoreError> {
    if !matches!(
        state.user_state.as_str(),
        "active" | "stopped" | "queued" | "awaitingFileSelection"
    ) {
        return Err(invalid("unknown legacy run intent"));
    }
    let identity = FullInfoHash::V1(V1InfoHash::new(decode_hex_hash(&entry.info_hash)?));
    let prefix = format!("session:torrent:{}", entry.info_hash);
    let magnet = if entry.source == "magnet" {
        let source = entry
            .magnet_uri
            .ok_or_else(|| invalid("missing legacy magnet"))?;
        let parsed = Magnet::parse(&source).map_err(|_| invalid("invalid legacy magnet"))?;
        if !parsed.identities.contains(identity) {
            return Err(invalid("legacy magnet hash mismatch"));
        }
        Some(source)
    } else if entry.source == "file" {
        None
    } else {
        return Err(invalid("unknown source kind"));
    };
    let source = if entry.source == "file" {
        Some(decode_binary(
            kv.get(&format!("{prefix}:torrentfile"))
                .ok_or_else(|| invalid("missing torrent file"))?,
        )?)
    } else if let Some(value) = kv.get(&format!("{prefix}:infodict")) {
        let info = decode_binary(value)?;
        // Independently authored outer wrapper; exact info bytes remain untouched.
        let mut outer = b"d4:info".to_vec();
        outer.extend_from_slice(&info);
        outer.push(b'e');
        Some(outer)
    } else {
        None
    };
    let selection = selection_intent(&state, magnet.as_deref(), source.as_deref())?;
    if source.is_none() {
        let request = bytes_request("legacy-root".to_owned(), 1, selection.clone());
        validate_add_torrent_bytes_request(&request).map_err(|(_, message)| invalid(&message))?;
    }
    let prepared = source
        .map(|source| {
            let request = bytes_request("legacy-root".to_owned(), source.len(), selection.clone());
            let prepared = prepare_torrent_bytes(&request, source)
                .map_err(|(_, message)| invalid(&message))?;
            if !prepared.projection.content.info_hashes().contains(identity) {
                return Err(invalid("legacy metainfo hash mismatch"));
            }
            if let Some(magnet) = &magnet {
                let parsed = Magnet::parse(magnet).map_err(|_| invalid("invalid legacy magnet"))?;
                let mut matches = true;
                parsed.identities.for_each(|hash| {
                    matches &= prepared.projection.content.info_hashes().contains(hash)
                });
                if !matches {
                    return Err(invalid("cached metadata hash mismatch"));
                }
            }
            Ok(prepared)
        })
        .transpose()?;
    Ok(PlannedRecord {
        profile: profile_index,
        record: record_index,
        identity,
        root,
        running: matches!(state.user_state.as_str(), "active" | "queued"),
        awaiting_selection: state.user_state == "awaitingFileSelection",
        queue_position: state.queue_position.unwrap_or(u64::MAX),
        prepared,
        magnet,
        selection,
    })
}

fn selection_intent(
    state: &State,
    magnet: Option<&str>,
    source: Option<&[u8]>,
) -> Result<FileSelectionIntent, StoreError> {
    if let Some(priorities) = &state.file_priorities {
        if priorities.len() > MAX_FILE_SELECTION_ENTRIES
            || priorities.iter().any(|value| *value > 1)
        {
            return Err(invalid("unsupported legacy priorities"));
        }
        if let Some(source) = source {
            let content = TorrentContentProjection::from_bytes_with_limits(
                source,
                EXPLICIT_IMPORT_METAINFO_LIMITS,
            )
            .map_err(|_| invalid("invalid metadata"))?;
            if priorities.len() != content.content.files().count() {
                return Err(invalid("priority length mismatch"));
            }
        } else {
            return Err(invalid("file priorities without metadata"));
        }
        return wanted_indices(
            priorities
                .iter()
                .enumerate()
                .filter_map(|(i, value)| (*value == 0).then_some(i as u32))
                .collect(),
        );
    }
    if let Some(indices) = &state.magnet_select_only {
        return wanted_indices(indices.clone());
    }
    if let Some(magnet) = magnet {
        let parsed = Magnet::parse(magnet).map_err(|_| invalid("invalid magnet selection"))?;
        if let Some(selection) = parsed.select_only {
            return Ok(FileSelectionIntent::WantedRanges {
                ranges: selection
                    .ranges()
                    .iter()
                    .map(|range| crate::FileIndexRange {
                        start: range.start,
                        end_exclusive: range.end + 1,
                    })
                    .collect(),
            });
        }
    }
    Ok(FileSelectionIntent::All)
}

fn wanted_indices(mut indices: Vec<u32>) -> Result<FileSelectionIntent, StoreError> {
    if indices.len() > MAX_FILE_SELECTION_ENTRIES {
        return Err(invalid("selection exceeds bound"));
    }
    indices.sort_unstable();
    indices.dedup();
    if indices.is_empty() {
        return Ok(FileSelectionIntent::None);
    }
    let mut ranges: Vec<crate::FileIndexRange> = Vec::new();
    for index in indices {
        if index > rstorrent_protocol::magnet::MAX_FILE_INDEX {
            return Err(invalid("file index exceeds bound"));
        }
        let end_exclusive = index + 1;
        if let Some(last) = ranges.last_mut()
            && last.end_exclusive == index
        {
            last.end_exclusive = end_exclusive;
        } else {
            ranges.push(crate::FileIndexRange {
                start: index,
                end_exclusive,
            });
        }
    }
    Ok(FileSelectionIntent::WantedRanges { ranges })
}

fn bytes_request(
    root: String,
    length: usize,
    selection: FileSelectionIntent,
) -> AddTorrentBytesRequest {
    AddTorrentBytesRequest {
        version: CONTROL_VERSION,
        request_id: "legacy-desktop-import".to_owned(),
        expected_revision: None,
        storage_root: root,
        start_content: false,
        await_file_selection: false,
        selection,
        source_length: length as u32,
    }
}

fn install_root(
    transaction: &Transaction<'_>,
    root: &PlannedRoot,
    report: &mut LegacyDesktopImportReport,
) -> Result<Option<String>, StoreError> {
    let (id, kind, locator) = match &root.location {
        LegacyRootLocation::Path(path) => {
            let path = path.to_str().ok_or_else(|| invalid("invalid root path"))?;
            if let Some(id) = transaction
                .query_row(
                    "SELECT root_id FROM storage_roots WHERE kind = 'path' AND locator = ?1",
                    [path],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
            {
                return Ok(Some(id));
            }
            (
                format!("legacy-{}", uuid::Uuid::new_v4().simple()),
                "path",
                Some(path),
            )
        }
        LegacyRootLocation::Platform(id) => {
            if let Some(kind) = transaction
                .query_row(
                    "SELECT kind FROM storage_roots WHERE root_id = ?1",
                    [id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
            {
                if kind != "platform" {
                    return Err(invalid("legacy platform root ID conflict"));
                }
                return Ok(Some(id.clone()));
            }
            (id.clone(), "platform", Some("platform-capability:"))
        }
    };
    let count: i64 =
        transaction.query_row("SELECT count(*) FROM storage_roots", [], |row| row.get(0))?;
    if count >= MAX_STORAGE_ROOTS as i64 {
        return Ok(None);
    }
    transaction.execute(
        "INSERT INTO storage_roots VALUES (?1, ?2, ?3, ?4)",
        params![id, root.display_name, kind, locator],
    )?;
    transaction.execute(
        "UPDATE storage_settings SET default_root = ?1 WHERE default_root IS NULL",
        [&id],
    )?;
    increment_revision(transaction)?;
    report.imported_roots += 1;
    Ok(Some(id))
}

fn preserve_magnet(
    transaction: &Transaction<'_>,
    id: &TorrentId,
    source: &str,
) -> Result<(), StoreError> {
    let magnet = Magnet::parse(source).map_err(|_| invalid("invalid planned magnet"))?;
    transaction.execute(
        "UPDATE torrents SET magnet = ?2 WHERE torrent_id = ?1",
        params![id.as_bytes(), canonical_magnet(&magnet)],
    )?;
    transaction.execute(
        "UPDATE torrent_source SET kind = 'magnet', fidelity = 'verbatim', magnet = ?2,
        metainfo = NULL, byte_length = ?3, sha256 = ?4 WHERE torrent_id = ?1",
        params![
            id.as_bytes(),
            source,
            source.len() as i64,
            Sha256::digest(source.as_bytes()).as_slice()
        ],
    )?;
    for (position, tracker) in magnet.trackers.iter().enumerate() {
        let transport = match tracker.transport() {
            TrackerUrlTransport::Udp => "udp",
            TrackerUrlTransport::Http => "http",
            TrackerUrlTransport::Https => "https",
        };
        transaction.execute("INSERT OR IGNORE INTO torrent_trackers(torrent_id, tier, position, url, transport, source)
            VALUES (?1, 0, ?2, ?3, ?4, 'magnet')", params![id.as_bytes(), position as i64, tracker.url(), transport])?;
    }
    Ok(())
}

fn snapshot_database(path: &Path, target: &Path) -> Result<Connection, StoreError> {
    regular_file(path)?;
    if fs::metadata(path)
        .map_err(|e| io_error("inspect source length", e))?
        .len()
        > MAX_DATABASE_BYTES
    {
        return Err(invalid("legacy database file exceeds bound"));
    }
    for suffix in ["-wal", "-shm"] {
        let auxiliary = path.with_file_name(format!(
            "{}{suffix}",
            path.file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| invalid("invalid source database name"))?
        ));
        if auxiliary
            .try_exists()
            .map_err(|e| io_error("inspect source auxiliary", e))?
        {
            regular_file(&auxiliary)?;
            if fs::metadata(&auxiliary)
                .map_err(|e| io_error("inspect source auxiliary length", e))?
                .len()
                > MAX_DATABASE_BYTES * 2
            {
                return Err(invalid("legacy SQLite auxiliary exceeds bound"));
            }
        }
    }
    let source = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    source.busy_timeout(BUSY_TIMEOUT)?;
    let pages: i64 = source.pragma_query_value(None, "page_count", |row| row.get(0))?;
    let page_size: i64 = source.pragma_query_value(None, "page_size", |row| row.get(0))?;
    if pages.saturating_mul(page_size) > MAX_DATABASE_BYTES as i64 {
        return Err(invalid("legacy database exceeds bound"));
    }
    let mut snapshot = Connection::open(target)?;
    snapshot.pragma_update(
        None,
        "max_page_count",
        MAX_DATABASE_BYTES as i64 / page_size,
    )?;
    {
        let backup = Backup::new(&source, &mut snapshot)?;
        if backup.step(-1)? != StepResult::Done {
            return Err(StoreError::ProfileResetBusy);
        }
    }
    let integrity: String =
        snapshot.pragma_query_value(None, "integrity_check", |row| row.get(0))?;
    if integrity != "ok" {
        return Err(invalid("legacy snapshot integrity failure"));
    }
    snapshot.pragma_update(None, "journal_mode", "DELETE")?;
    snapshot
        .close()
        .map_err(|(_, error)| StoreError::Sqlite(error))?;
    // Windows FlushFileBuffers requires write access. This is our private
    // SQLite snapshot; the legacy source remains opened read-only above.
    fs::OpenOptions::new()
        .write(true)
        .open(target)
        .and_then(|file| file.sync_all())
        .map_err(|e| io_error("sync source snapshot", e))?;
    Ok(Connection::open_with_flags(
        target,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?)
}

fn read_kv(connection: &Connection) -> Result<BTreeMap<String, String>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT key, length(CAST(value AS BLOB)), value, length(CAST(key AS BLOB)) FROM kv
        WHERE key LIKE 'session:%' OR key LIKE 'config:%' ORDER BY key LIMIT 20001",
    )?;
    let mut rows = statement.query([])?;
    let mut kv = BTreeMap::new();
    let mut count = 0;
    while let Some(row) = rows.next()? {
        count += 1;
        if count > 20000 {
            return Err(invalid("legacy KV count exceeds bound"));
        }
        if row.get::<_, i64>(3)? > 256 {
            return Err(invalid("legacy KV key exceeds bound"));
        }
        let Some(length) = row.get::<_, Option<i64>>(1)? else {
            continue;
        };
        let key: String = row.get(0)?;
        if key.len() > 256 {
            return Err(invalid("legacy KV key exceeds bound"));
        }
        if key.starts_with("config:")
            && !matches!(
                key.as_str(),
                "config:dhtEnabled"
                    | "config:pexEnabled"
                    | "config:maxGlobalPeers"
                    | "config:maxUploadSlots"
                    | "config:encryptionPolicy"
                    | "config:uploadSpeedUnlimited"
                    | "config:uploadSpeedLimit"
                    | "config:downloadSpeedUnlimited"
                    | "config:downloadSpeedLimit"
            )
        {
            continue;
        }
        if key == "session:torrents" && length > MAX_DISCOVERY_BYTES as i64 {
            return Err(invalid("legacy index exceeds bound"));
        }
        if key.starts_with("config:") && length > 4096 {
            // Keep a small invalid sentinel so unsupported settings hold new work.
            kv.insert(key, "null".to_owned());
            continue;
        }
        if length > MAX_VALUE_BYTES as i64 {
            continue;
        }
        if key.ends_with(":state") && length > MAX_DISCOVERY_BYTES as i64 {
            continue;
        }
        if key.starts_with("session:")
            && key != "session:torrents"
            && ![":state", ":torrentfile", ":infodict"]
                .iter()
                .any(|suffix| key.ends_with(suffix))
        {
            continue;
        }
        if let Ok(value) = row.get::<_, String>(2) {
            kv.insert(key, value);
        }
    }
    Ok(kv)
}

fn map_settings(configs: &[BTreeMap<String, String>]) -> Result<ClientSettings, StoreError> {
    let mut settings = ClientSettings::fresh_profile_default();
    // Equivalent closed fields only; conflicting configurations hold new work.
    let mut merged = BTreeMap::new();
    for config in configs {
        for (key, raw) in config {
            let value: Value = serde_json::from_str(raw)?;
            if let Some(previous) = merged.insert(key.clone(), value.clone())
                && previous != value
            {
                return Err(invalid("conflicting legacy settings"));
            }
        }
    }
    for (key, value) in &merged {
        match key.as_str() {
            "config:dhtEnabled" => {
                settings.dht_enabled = value
                    .as_bool()
                    .ok_or_else(|| invalid("invalid DHT setting"))?
            }
            "config:pexEnabled" => {
                settings.peer_exchange_enabled = value
                    .as_bool()
                    .ok_or_else(|| invalid("invalid PEX setting"))?
            }
            "config:maxGlobalPeers" => {
                settings.peer_connection_limit = serde_json::from_value(value.clone())?
            }
            "config:maxUploadSlots" => {
                settings.upload_slots = serde_json::from_value(value.clone())?
            }
            "config:encryptionPolicy" => {
                settings.encryption = serde_json::from_value(value.clone())?
            }
            "config:uploadSpeedUnlimited" | "config:downloadSpeedUnlimited" => {
                value
                    .as_bool()
                    .ok_or_else(|| invalid("invalid legacy rate policy"))?;
            }
            "config:uploadSpeedLimit" | "config:downloadSpeedLimit" => {
                value
                    .as_u64()
                    .and_then(|rate| u32::try_from(rate).ok())
                    .ok_or_else(|| invalid("invalid legacy rate value"))?;
            }
            _ => {}
        }
    }
    for (direction, limit) in [
        ("upload", &mut settings.upload_rate_limit),
        ("download", &mut settings.download_rate_limit),
    ] {
        if merged.get(&format!("config:{direction}SpeedUnlimited")) == Some(&Value::Bool(false)) {
            let rate = merged
                .get(&format!("config:{direction}SpeedLimit"))
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok())
                .ok_or_else(|| invalid("invalid legacy rate limit"))?;
            *limit = TransferRateLimit::Limited {
                bytes_per_second: rate,
            };
        }
    }
    settings
        .validate()
        .map_err(|_| invalid("unsupported legacy settings"))?;
    Ok(settings)
}

fn refuse_live_sources(discovery: &Discovery) -> Result<(), StoreError> {
    for profile in &discovery.profiles {
        if profile.port != 0
            && TcpStream::connect_timeout(
                &SocketAddr::from((Ipv4Addr::LOCALHOST, profile.port)),
                Duration::from_millis(100),
            )
            .is_ok()
        {
            return Err(invalid(
                "close JSTorrent desktop and legacy extension pages before migration",
            ));
        }
    }
    Ok(())
}

fn decode_binary(value: &str) -> Result<Vec<u8>, StoreError> {
    if value.len() > MAX_VALUE_BYTES {
        return Err(invalid("encoded source exceeds bound"));
    }
    let base64: String = serde_json::from_str(value)?;
    if base64.len() > MAX_METAINFO_BYTES.div_ceil(3) * 4 {
        return Err(invalid("decoded source exceeds bound"));
    }
    let normalized: String = base64
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .map(|c| match c {
            '-' => '+',
            '_' => '/',
            _ => c,
        })
        .collect();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(normalized)
        .map_err(|_| invalid("invalid source base64"))?;
    if bytes.len() > MAX_METAINFO_BYTES {
        return Err(invalid("decoded source exceeds bound"));
    }
    Ok(bytes)
}

fn decode_hex_hash(value: &str) -> Result<[u8; 20], StoreError> {
    if value.len() != 40 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(invalid("invalid legacy info hash"));
    }
    let mut hash = [0; 20];
    for (index, byte) in hash.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| invalid("invalid info hash"))?;
    }
    Ok(hash)
}

fn bounded_file(path: &Path, maximum: usize) -> Result<Vec<u8>, StoreError> {
    regular_file(path)?;
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| io_error("open legacy discovery", e))?
        .take(maximum as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| io_error("read legacy discovery", e))?;
    if bytes.len() > maximum {
        return Err(invalid("legacy discovery exceeds bound"));
    }
    Ok(bytes)
}

fn regular_file(path: &Path) -> Result<(), StoreError> {
    if !fs::symlink_metadata(path)
        .map_err(|e| io_error("inspect migration file", e))?
        .file_type()
        .is_file()
    {
        return Err(invalid("migration input must be a regular file"));
    }
    Ok(())
}

fn directory(path: &Path) -> Result<(), StoreError> {
    if !fs::symlink_metadata(path)
        .map_err(|e| io_error("inspect migration directory", e))?
        .file_type()
        .is_dir()
    {
        return Err(invalid("migration input must be a directory"));
    }
    Ok(())
}

fn outcome(
    report: &mut LegacyDesktopImportReport,
    profile: usize,
    record: usize,
    disposition: &str,
) {
    match disposition {
        "imported" => report.imported += 1,
        "already_present" => report.already_present += 1,
        _ => report.skipped += 1,
    };
    report.outcomes.push(LegacyDesktopRecordOutcome {
        profile,
        record,
        disposition: disposition.to_owned(),
    });
}

fn invalid(message: &str) -> StoreError {
    StoreError::Configuration(message.to_owned())
}
fn io_error(operation: &'static str, source: std::io::Error) -> StoreError {
    StoreError::Io { operation, source }
}

#[cfg(test)]
mod tests;
