use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use url::Url;
use uuid::Uuid;

const PRODUCT_DATABASE_FILENAME: &str = "product.db";
/// Schema 2 is the frozen baseline every public release ships; later
/// versions append a step to `PRODUCT_MIGRATION_STEPS` (Tactical 358), as the
/// session catalog does. The ledger in `durable-data-migrations` lists them.
const PRODUCT_BASELINE_SCHEMA_VERSION: i64 = 2;
const PRODUCT_SCHEMA_VERSION: i64 = 3;

type ProductMigrationStep = fn(&rusqlite::Transaction<'_>) -> Result<(), ProductStateError>;

/// `PRODUCT_MIGRATION_STEPS[i]` migrates baseline + i to the next version.
/// Append only; a shipped step is never edited.
const PRODUCT_MIGRATION_STEPS: &[ProductMigrationStep] = &[migrate_product_2_to_3];

const _: () = assert!(
    PRODUCT_BASELINE_SCHEMA_VERSION + PRODUCT_MIGRATION_STEPS.len() as i64
        == PRODUCT_SCHEMA_VERSION,
    "PRODUCT_SCHEMA_VERSION must equal the baseline plus one step per version"
);

/// The frozen schema-2 tables. Never edit; append a migration step instead.
const PRODUCT_BASELINE_TABLES_SQL: &str = "CREATE TABLE product_state (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            installation_id TEXT NOT NULL UNIQUE CHECK (
                length(installation_id) = 36
            ),
            created_at_millis TEXT NOT NULL CHECK (
                length(created_at_millis) BETWEEN 1 AND 20
            ),
            first_version TEXT NOT NULL CHECK (
                length(first_version) BETWEEN 1 AND 128
            ),
            current_version TEXT NOT NULL CHECK (
                length(current_version) BETWEEN 1 AND 128
            ),
            disclosure_version INTEGER NOT NULL DEFAULT 0 CHECK (
                disclosure_version BETWEEN 0 AND 1
            ),
            statistics_enabled INTEGER NOT NULL DEFAULT 1 CHECK (
                statistics_enabled IN (0, 1)
            ),
            torrents_added TEXT NOT NULL DEFAULT '0' CHECK (
                length(torrents_added) BETWEEN 1 AND 20
            ),
            downloads_completed TEXT NOT NULL DEFAULT '0' CHECK (
                length(downloads_completed) BETWEEN 1 AND 20
            ),
            foreground_sessions TEXT NOT NULL DEFAULT '0' CHECK (
                length(foreground_sessions) BETWEEN 1 AND 20
            ),
            reset_generation TEXT NOT NULL CHECK (
                length(reset_generation) = 36
            ),
            last_start_millis TEXT NOT NULL CHECK (
                length(last_start_millis) BETWEEN 1 AND 20
            ),
            last_clean_shutdown_millis TEXT CHECK (
                last_clean_shutdown_millis IS NULL OR
                length(last_clean_shutdown_millis) BETWEEN 1 AND 20
            ),
            legacy_updater_id_permitted INTEGER NOT NULL DEFAULT 0 CHECK (
                legacy_updater_id_permitted IN (0, 1)
            )
         );
         CREATE TABLE product_source_watermarks (
            source_epoch BLOB PRIMARY KEY CHECK (
                length(source_epoch) = 16 AND source_epoch <> zeroblob(16)
            ),
            last_sequence TEXT NOT NULL CHECK (
                length(last_sequence) BETWEEN 1 AND 20
            )
         ) WITHOUT ROWID;";

/// Desktop shell switches (Tactical 358). Other platforms keep their shell
/// preferences in platform stores and never write this row.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DesktopShellPreferences {
    pub run_in_background: bool,
    pub notify_download_complete: bool,
    pub notify_needs_attention: bool,
    pub notify_while_focused: bool,
    pub prevent_sleep_during_active_downloads: bool,
}
const BUSY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const MAX_PRODUCT_VERSION_BYTES: usize = 128;
const MAX_U64_TEXT_BYTES: usize = 20;
pub const CURRENT_PRODUCT_DISCLOSURE_VERSION: u32 = 1;
pub const MAX_PRODUCT_SOURCES: usize = 128;
pub const PRODUCT_FEEDBACK_URL: &str = "https://jstorrent.com/feedback.html";
pub const PRODUCT_PRIVACY_URL: &str = "https://jstorrent.com/privacy.html";
pub const MAX_PRODUCT_FEEDBACK_URL_BYTES: usize = 2 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProductMilestoneKind {
    TorrentAdded,
    DownloadCompleted,
}

impl ProductMilestoneKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TorrentAdded => "torrent_added",
            Self::DownloadCompleted => "download_completed",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ProductStateError> {
        match value {
            "torrent_added" => Ok(Self::TorrentAdded),
            "download_completed" => Ok(Self::DownloadCompleted),
            _ => Err(ProductStateError::InvalidState(
                "product milestone has an unknown kind".to_owned(),
            )),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProductMilestone {
    pub source_epoch: [u8; 16],
    pub sequence: u64,
    pub kind: ProductMilestoneKind,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(rename_all = "camelCase")]
pub struct ProductSummary {
    pub installation_id: String,
    pub created_at_millis: String,
    pub first_version: String,
    pub current_version: String,
    pub disclosure_version: u32,
    pub statistics_enabled: bool,
    pub torrents_added: String,
    pub downloads_completed: String,
    pub foreground_sessions: String,
    pub reset_generation: String,
    pub last_start_millis: String,
    pub last_clean_shutdown_millis: Option<String>,
    pub days_since_first_use: u64,
    pub transmission_allowed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProductFeedbackPlatform {
    Desktop,
    Android,
}

impl ProductFeedbackPlatform {
    fn as_str(self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::Android => "android",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProductFeedbackEnvironment {
    pub platform: ProductFeedbackPlatform,
    pub application_version: String,
    pub android_release: Option<String>,
    pub device: Option<String>,
}

impl ProductFeedbackEnvironment {
    pub fn desktop(application_version: impl Into<String>) -> Self {
        Self {
            platform: ProductFeedbackPlatform::Desktop,
            application_version: application_version.into(),
            android_release: None,
            device: None,
        }
    }

    pub fn android(
        application_version: impl Into<String>,
        android_release: impl Into<String>,
        device: impl Into<String>,
    ) -> Self {
        Self {
            platform: ProductFeedbackPlatform::Android,
            application_version: application_version.into(),
            android_release: Some(android_release.into()),
            device: Some(device.into()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(rename_all = "camelCase")]
pub struct ProductFeedbackField {
    pub name: String,
    pub value: String,
    pub pseudonymous: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(rename_all = "camelCase")]
pub struct ProductFeedbackPreview {
    pub destination: String,
    pub url: String,
    pub fields: Vec<ProductFeedbackField>,
    pub statistics_available: bool,
    pub statistics_included: bool,
    pub hosted_context_ready: bool,
}

pub fn build_product_feedback_preview(
    summary: &ProductSummary,
    environment: &ProductFeedbackEnvironment,
    include_statistics: bool,
    hosted_context_ready: bool,
) -> Result<ProductFeedbackPreview, ProductStateError> {
    validate_feedback_environment(environment)?;
    let statistics_available = summary.transmission_allowed && hosted_context_ready;
    let statistics_included = include_statistics && statistics_available;
    let mut fields = vec![
        feedback_field("platform", environment.platform.as_str(), false),
        feedback_field("v", &environment.application_version, false),
    ];
    if environment.platform == ProductFeedbackPlatform::Android {
        fields.push(feedback_field(
            "android",
            environment
                .android_release
                .as_deref()
                .expect("validated Android environment"),
            false,
        ));
        fields.push(feedback_field(
            "device",
            environment
                .device
                .as_deref()
                .expect("validated Android environment"),
            false,
        ));
    }
    if statistics_included {
        fields.extend([
            feedback_field("id", &summary.installation_id, true),
            feedback_field("days", &summary.days_since_first_use.to_string(), true),
            feedback_field("added", &summary.torrents_added, true),
            feedback_field("completed", &summary.downloads_completed, true),
            feedback_field("sessions", &summary.foreground_sessions, true),
        ]);
    }
    let mut url = Url::parse(PRODUCT_FEEDBACK_URL).map_err(|_| {
        ProductStateError::InvalidConfiguration("product feedback base URL is invalid".to_owned())
    })?;
    {
        let mut query = url.query_pairs_mut();
        for field in &fields {
            query.append_pair(&field.name, &field.value);
        }
    }
    let url = url.to_string();
    if url.len() > MAX_PRODUCT_FEEDBACK_URL_BYTES {
        return Err(ProductStateError::InvalidConfiguration(format!(
            "product feedback URL exceeds {MAX_PRODUCT_FEEDBACK_URL_BYTES} bytes"
        )));
    }
    Ok(ProductFeedbackPreview {
        destination: PRODUCT_FEEDBACK_URL.to_owned(),
        url,
        fields,
        statistics_available,
        statistics_included,
        hosted_context_ready,
    })
}

fn feedback_field(name: &str, value: &str, pseudonymous: bool) -> ProductFeedbackField {
    ProductFeedbackField {
        name: name.to_owned(),
        value: value.to_owned(),
        pseudonymous,
    }
}

fn validate_feedback_environment(
    environment: &ProductFeedbackEnvironment,
) -> Result<(), ProductStateError> {
    validate_version(&environment.application_version)?;
    match (
        environment.platform,
        environment.android_release.as_deref(),
        environment.device.as_deref(),
    ) {
        (ProductFeedbackPlatform::Desktop, None, None) => Ok(()),
        (ProductFeedbackPlatform::Android, Some(android), Some(device)) => {
            validate_feedback_value(android, "Android release")?;
            validate_feedback_value(device, "Android device")
        }
        _ => Err(ProductStateError::InvalidConfiguration(
            "product feedback environment does not match its platform".to_owned(),
        )),
    }
}

fn validate_feedback_value(value: &str, field: &str) -> Result<(), ProductStateError> {
    if value.is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
        return Err(ProductStateError::InvalidConfiguration(format!(
            "{field} must be 1..=512 bytes without control characters"
        )));
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProductStatePageUsage {
    pub page_size: u64,
    pub page_count: u64,
}

#[derive(Debug)]
pub enum ProductStateError {
    Io {
        operation: &'static str,
        source: std::io::Error,
    },
    Sqlite(rusqlite::Error),
    InvalidConfiguration(String),
    InvalidState(String),
    UnsupportedSchema {
        actual: i64,
        maximum: i64,
    },
    RequiredPragma(&'static str),
    OwnerPoisoned,
    SourceLimit,
    SequenceGap {
        expected: u64,
        actual: u64,
    },
}

impl fmt::Display for ProductStateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { operation, source } => write!(formatter, "{operation}: {source}"),
            Self::Sqlite(error) => write!(formatter, "product state SQLite: {error}"),
            Self::InvalidConfiguration(message) => {
                write!(formatter, "product state configuration: {message}")
            }
            Self::InvalidState(message) => write!(formatter, "invalid product state: {message}"),
            Self::UnsupportedSchema { actual, maximum } => write!(
                formatter,
                "unsupported product-state schema {actual}; maximum is {maximum}"
            ),
            Self::RequiredPragma(pragma) => {
                write!(formatter, "product state could not enable {pragma}")
            }
            Self::OwnerPoisoned => formatter.write_str("product-state owner lock is poisoned"),
            Self::SourceLimit => write!(
                formatter,
                "product state exceeds the {MAX_PRODUCT_SOURCES}-source watermark limit"
            ),
            Self::SequenceGap { expected, actual } => write!(
                formatter,
                "product milestone sequence gap: expected {expected}, received {actual}"
            ),
        }
    }
}

impl std::error::Error for ProductStateError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            Self::Sqlite(error) => Some(error),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for ProductStateError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

/// The usage-statistics choice as an update check reports it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UpdaterStatistics {
    /// The current disclosure was not reviewed yet (first run not finished).
    Unreviewed,
    On,
    Off,
}

impl UpdaterStatistics {
    /// The `X-Statistics` header value.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unreviewed => "unreviewed",
            Self::On => "on",
            Self::Off => "off",
        }
    }
}

pub struct ProductStateStore {
    connection: Connection,
    database_path: Option<PathBuf>,
}

#[derive(Clone)]
pub struct ProductStateOwner {
    store: Arc<Mutex<ProductStateStore>>,
}

impl fmt::Debug for ProductStateOwner {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProductStateOwner")
            .finish_non_exhaustive()
    }
}

impl ProductStateOwner {
    pub fn open(
        application_data_root: &Path,
        current_version: &str,
        legacy_installation_id: Option<&str>,
    ) -> Result<Self, ProductStateError> {
        Ok(Self::from_store(ProductStateStore::open(
            application_data_root,
            current_version,
            legacy_installation_id,
        )?))
    }

    pub fn open_ephemeral(current_version: &str) -> Result<Self, ProductStateError> {
        Ok(Self::from_store(ProductStateStore::open_ephemeral(
            current_version,
        )?))
    }

    pub fn from_store(store: ProductStateStore) -> Self {
        Self {
            store: Arc::new(Mutex::new(store)),
        }
    }

    fn store(&self) -> Result<MutexGuard<'_, ProductStateStore>, ProductStateError> {
        self.store
            .lock()
            .map_err(|_| ProductStateError::OwnerPoisoned)
    }

    pub fn summary(&self) -> Result<ProductSummary, ProductStateError> {
        self.store()?.summary()
    }

    pub fn acknowledge_disclosure(
        &self,
        statistics_enabled: bool,
    ) -> Result<ProductSummary, ProductStateError> {
        self.store()?.acknowledge_disclosure(statistics_enabled)
    }

    pub fn set_statistics_enabled(
        &self,
        statistics_enabled: bool,
    ) -> Result<ProductSummary, ProductStateError> {
        self.store()?.set_statistics_enabled(statistics_enabled)
    }

    pub fn reset_statistics(&self) -> Result<ProductSummary, ProductStateError> {
        self.store()?.reset_statistics()
    }

    pub fn clear_app_data(&self) -> Result<ProductSummary, ProductStateError> {
        self.store()?.clear_app_data()
    }

    pub fn record_foreground_session(&self) -> Result<ProductSummary, ProductStateError> {
        self.store()?.record_foreground_session()
    }

    pub fn record_clean_shutdown(&self) -> Result<(), ProductStateError> {
        self.store()?.record_clean_shutdown()
    }

    pub fn apply_milestones(
        &self,
        milestones: &[ProductMilestone],
    ) -> Result<ProductSummary, ProductStateError> {
        self.store()?.apply_milestones(milestones)
    }

    pub fn database_path(&self) -> Result<Option<PathBuf>, ProductStateError> {
        Ok(self.store()?.database_path().map(Path::to_path_buf))
    }

    pub fn updater_installation_id(&self) -> Result<Option<String>, ProductStateError> {
        self.store()?.updater_installation_id()
    }

    pub fn updater_statistics(&self) -> Result<UpdaterStatistics, ProductStateError> {
        self.store()?.updater_statistics()
    }

    pub fn desktop_shell_preferences(
        &self,
    ) -> Result<Option<DesktopShellPreferences>, ProductStateError> {
        self.store()?.desktop_shell_preferences()
    }

    pub fn replace_desktop_shell_preferences(
        &self,
        preferences: DesktopShellPreferences,
    ) -> Result<(), ProductStateError> {
        self.store()?.replace_desktop_shell_preferences(preferences)
    }
}

impl fmt::Debug for ProductStateStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProductStateStore")
            .field("database_path", &self.database_path)
            .finish_non_exhaustive()
    }
}

impl ProductStateStore {
    pub fn open(
        application_data_root: &Path,
        current_version: &str,
        legacy_installation_id: Option<&str>,
    ) -> Result<Self, ProductStateError> {
        Self::open_at(
            application_data_root,
            current_version,
            legacy_installation_id,
            now_millis()?,
        )
    }

    pub fn open_ephemeral(current_version: &str) -> Result<Self, ProductStateError> {
        Self::open_ephemeral_at(current_version, now_millis()?)
    }

    fn open_at(
        application_data_root: &Path,
        current_version: &str,
        legacy_installation_id: Option<&str>,
        now_millis: u64,
    ) -> Result<Self, ProductStateError> {
        validate_version(current_version)?;
        std::fs::create_dir_all(application_data_root).map_err(|source| ProductStateError::Io {
            operation: "create product-state directory",
            source,
        })?;
        let database_path = application_data_root.join(PRODUCT_DATABASE_FILENAME);
        let connection = Connection::open(&database_path)?;
        configure_durable_connection(&connection)?;
        initialize(
            connection,
            current_version,
            legacy_installation_id,
            now_millis,
            Some(database_path),
        )
    }

    fn open_ephemeral_at(
        current_version: &str,
        now_millis: u64,
    ) -> Result<Self, ProductStateError> {
        validate_version(current_version)?;
        let connection = Connection::open_in_memory()?;
        connection.pragma_update(None, "foreign_keys", true)?;
        initialize(connection, current_version, None, now_millis, None)
    }

    pub fn summary(&self) -> Result<ProductSummary, ProductStateError> {
        self.summary_at(now_millis()?)
    }

    fn summary_at(&self, now_millis: u64) -> Result<ProductSummary, ProductStateError> {
        read_summary(&self.connection, now_millis)
    }

    pub fn acknowledge_disclosure(
        &mut self,
        statistics_enabled: bool,
    ) -> Result<ProductSummary, ProductStateError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE product_state
             SET disclosure_version = ?1, statistics_enabled = ?2
             WHERE singleton = 1",
            params![
                i64::from(CURRENT_PRODUCT_DISCLOSURE_VERSION),
                statistics_enabled
            ],
        )?;
        transaction.commit()?;
        self.summary()
    }

    pub fn set_statistics_enabled(
        &mut self,
        statistics_enabled: bool,
    ) -> Result<ProductSummary, ProductStateError> {
        let transaction = self.connection.transaction()?;
        let disclosure_version: i64 = transaction.query_row(
            "SELECT disclosure_version FROM product_state WHERE singleton = 1",
            [],
            |row| row.get(0),
        )?;
        if disclosure_version != i64::from(CURRENT_PRODUCT_DISCLOSURE_VERSION) {
            return Err(ProductStateError::InvalidState(
                "statistics preference cannot change before current disclosure acknowledgement"
                    .to_owned(),
            ));
        }
        transaction.execute(
            "UPDATE product_state SET statistics_enabled = ?1 WHERE singleton = 1",
            [statistics_enabled],
        )?;
        transaction.commit()?;
        self.summary()
    }

    pub fn reset_statistics(&mut self) -> Result<ProductSummary, ProductStateError> {
        self.reset_statistics_at(now_millis()?)
    }

    pub fn clear_app_data(&mut self) -> Result<ProductSummary, ProductStateError> {
        let now_millis = now_millis()?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE product_state
             SET installation_id = ?1,
                 created_at_millis = ?2,
                 first_version = current_version,
                 disclosure_version = 0,
                 statistics_enabled = 1,
                 torrents_added = '0',
                 downloads_completed = '0',
                 foreground_sessions = '0',
                 reset_generation = ?3,
                 last_start_millis = ?2,
                 last_clean_shutdown_millis = NULL,
                 legacy_updater_id_permitted = 0
             WHERE singleton = 1",
            params![
                Uuid::new_v4().to_string(),
                encode_u64(now_millis),
                Uuid::new_v4().to_string(),
            ],
        )?;
        transaction.execute("DELETE FROM product_source_watermarks", [])?;
        transaction.commit()?;
        self.summary_at(now_millis)
    }

    fn reset_statistics_at(
        &mut self,
        now_millis: u64,
    ) -> Result<ProductSummary, ProductStateError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE product_state
             SET installation_id = ?1,
                 created_at_millis = ?2,
                 torrents_added = '0',
                 downloads_completed = '0',
                 foreground_sessions = '0',
                 reset_generation = ?3,
                 legacy_updater_id_permitted = 0
             WHERE singleton = 1",
            params![
                Uuid::new_v4().to_string(),
                encode_u64(now_millis),
                Uuid::new_v4().to_string(),
            ],
        )?;
        transaction.commit()?;
        self.summary_at(now_millis)
    }

    /// The stored desktop shell switches, or `None` before the desktop first
    /// writes them.
    pub fn desktop_shell_preferences(
        &self,
    ) -> Result<Option<DesktopShellPreferences>, ProductStateError> {
        Ok(self
            .connection
            .query_row(
                "SELECT run_in_background, notify_download_complete,
                        notify_needs_attention, notify_while_focused,
                        prevent_sleep_during_active_downloads
                 FROM desktop_shell_settings WHERE singleton = 1",
                [],
                |row| {
                    Ok(DesktopShellPreferences {
                        run_in_background: row.get(0)?,
                        notify_download_complete: row.get(1)?,
                        notify_needs_attention: row.get(2)?,
                        notify_while_focused: row.get(3)?,
                        prevent_sleep_during_active_downloads: row.get(4)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn replace_desktop_shell_preferences(
        &mut self,
        preferences: DesktopShellPreferences,
    ) -> Result<(), ProductStateError> {
        self.connection.execute(
            "INSERT INTO desktop_shell_settings(
                singleton, run_in_background, notify_download_complete,
                notify_needs_attention, notify_while_focused,
                prevent_sleep_during_active_downloads
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(singleton) DO UPDATE SET
                run_in_background = excluded.run_in_background,
                notify_download_complete = excluded.notify_download_complete,
                notify_needs_attention = excluded.notify_needs_attention,
                notify_while_focused = excluded.notify_while_focused,
                prevent_sleep_during_active_downloads =
                    excluded.prevent_sleep_during_active_downloads",
            params![
                preferences.run_in_background,
                preferences.notify_download_complete,
                preferences.notify_needs_attention,
                preferences.notify_while_focused,
                preferences.prevent_sleep_during_active_downloads,
            ],
        )?;
        Ok(())
    }

    pub fn record_foreground_session(&mut self) -> Result<ProductSummary, ProductStateError> {
        let transaction = self.connection.transaction()?;
        increment_counter(&transaction, "foreground_sessions")?;
        transaction.commit()?;
        self.summary()
    }

    pub fn updater_installation_id(&self) -> Result<Option<String>, ProductStateError> {
        let (installation_id, current_disclosure, statistics_enabled, legacy_permitted) =
            self.updater_policy()?;
        Ok(((current_disclosure && statistics_enabled)
            || (!current_disclosure && legacy_permitted))
            .then_some(installation_id))
    }

    /// The statistics choice an update check reports, without any identifier,
    /// so opted-out installations can be counted (maintainer policy,
    /// 2026-10-15, in `docs/topics/product-state-and-feedback.md`).
    pub fn updater_statistics(&self) -> Result<UpdaterStatistics, ProductStateError> {
        let (_, current_disclosure, statistics_enabled, _) = self.updater_policy()?;
        Ok(match (current_disclosure, statistics_enabled) {
            (false, _) => UpdaterStatistics::Unreviewed,
            (true, true) => UpdaterStatistics::On,
            (true, false) => UpdaterStatistics::Off,
        })
    }

    fn updater_policy(&self) -> Result<(String, bool, bool, bool), ProductStateError> {
        let (installation_id, disclosure_version, statistics_enabled, legacy_permitted) =
            self.connection.query_row(
                "SELECT installation_id, disclosure_version, statistics_enabled,
                        legacy_updater_id_permitted
                 FROM product_state WHERE singleton = 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, bool>(2)?,
                        row.get::<_, bool>(3)?,
                    ))
                },
            )?;
        let current_disclosure =
            disclosure_version == i64::from(CURRENT_PRODUCT_DISCLOSURE_VERSION);
        Ok((
            installation_id,
            current_disclosure,
            statistics_enabled,
            legacy_permitted,
        ))
    }

    pub fn record_clean_shutdown(&mut self) -> Result<(), ProductStateError> {
        let now = now_millis()?;
        self.connection.execute(
            "UPDATE product_state SET last_clean_shutdown_millis = ?1 WHERE singleton = 1",
            [encode_u64(now)],
        )?;
        Ok(())
    }

    pub fn apply_milestones(
        &mut self,
        milestones: &[ProductMilestone],
    ) -> Result<ProductSummary, ProductStateError> {
        if milestones.is_empty() {
            return self.summary();
        }
        let source_epoch = milestones[0].source_epoch;
        if source_epoch == [0; 16] {
            return Err(ProductStateError::InvalidState(
                "product milestone source epoch is zero".to_owned(),
            ));
        }
        if milestones
            .iter()
            .any(|milestone| milestone.source_epoch != source_epoch)
        {
            return Err(ProductStateError::InvalidState(
                "product milestone batch mixes source epochs".to_owned(),
            ));
        }
        let transaction = self.connection.transaction()?;
        let mut last_sequence = source_watermark(&transaction, &source_epoch)?;
        if last_sequence.is_none() {
            let source_count: i64 = transaction.query_row(
                "SELECT COUNT(*) FROM product_source_watermarks",
                [],
                |row| row.get(0),
            )?;
            if source_count
                >= i64::try_from(MAX_PRODUCT_SOURCES).expect("source limit fits SQLite i64")
            {
                return Err(ProductStateError::SourceLimit);
            }
        }
        for milestone in milestones {
            if milestone.sequence == 0 {
                return Err(ProductStateError::InvalidState(
                    "product milestone sequence is zero".to_owned(),
                ));
            }
            if last_sequence.is_some_and(|last| milestone.sequence <= last) {
                continue;
            }
            let expected = last_sequence.map_or(1, |last| last.saturating_add(1));
            if milestone.sequence != expected {
                return Err(ProductStateError::SequenceGap {
                    expected,
                    actual: milestone.sequence,
                });
            }
            match milestone.kind {
                ProductMilestoneKind::TorrentAdded => {
                    increment_counter(&transaction, "torrents_added")?
                }
                ProductMilestoneKind::DownloadCompleted => {
                    increment_counter(&transaction, "downloads_completed")?
                }
            }
            last_sequence = Some(milestone.sequence);
        }
        if let Some(last_sequence) = last_sequence {
            transaction.execute(
                "INSERT INTO product_source_watermarks(source_epoch, last_sequence)
                 VALUES (?1, ?2)
                 ON CONFLICT(source_epoch) DO UPDATE SET
                    last_sequence = excluded.last_sequence",
                params![source_epoch.as_slice(), encode_u64(last_sequence)],
            )?;
        }
        transaction.commit()?;
        self.summary()
    }

    pub fn page_usage(&self) -> Result<ProductStatePageUsage, ProductStateError> {
        Ok(ProductStatePageUsage {
            page_size: pragma_u64(&self.connection, "page_size")?,
            page_count: pragma_u64(&self.connection, "page_count")?,
        })
    }

    pub fn database_path(&self) -> Option<&Path> {
        self.database_path.as_deref()
    }
}

fn initialize(
    mut connection: Connection,
    current_version: &str,
    legacy_installation_id: Option<&str>,
    now_millis: u64,
    database_path: Option<PathBuf>,
) -> Result<ProductStateStore, ProductStateError> {
    connection.pragma_update(None, "foreign_keys", true)?;
    let foreign_keys: i64 =
        connection.pragma_query_value(None, "foreign_keys", |row| row.get(0))?;
    if foreign_keys != 1 {
        return Err(ProductStateError::RequiredPragma("foreign_keys"));
    }
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    match version {
        0 => create_schema(
            &mut connection,
            current_version,
            legacy_installation_id,
            now_millis,
        )?,
        1 => {
            migrate_schema_1(&mut connection, legacy_installation_id)?;
            migrate_product_schema(&mut connection, PRODUCT_BASELINE_SCHEMA_VERSION)?;
        }
        PRODUCT_SCHEMA_VERSION => validate_schema(&connection)?,
        from if (PRODUCT_BASELINE_SCHEMA_VERSION..PRODUCT_SCHEMA_VERSION).contains(&from) => {
            migrate_product_schema(&mut connection, from)?;
        }
        actual => {
            return Err(ProductStateError::UnsupportedSchema {
                actual,
                maximum: PRODUCT_SCHEMA_VERSION,
            });
        }
    }
    connection.execute(
        "UPDATE product_state
         SET current_version = ?1, last_start_millis = ?2
         WHERE singleton = 1",
        params![current_version, encode_u64(now_millis)],
    )?;
    validate_schema(&connection)?;
    #[cfg(unix)]
    if let Some(path) = &database_path {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path)
            .map_err(|source| ProductStateError::Io {
                operation: "read product-state permissions",
                source,
            })?
            .permissions();
        permissions.set_mode(0o600);
        std::fs::set_permissions(path, permissions).map_err(|source| ProductStateError::Io {
            operation: "set product-state permissions",
            source,
        })?;
    }
    Ok(ProductStateStore {
        connection,
        database_path,
    })
}

fn migrate_schema_1(
    connection: &mut Connection,
    legacy_installation_id: Option<&str>,
) -> Result<(), ProductStateError> {
    let stored_installation_id: String = connection.query_row(
        "SELECT installation_id FROM product_state WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    let legacy_updater_id_permitted = legacy_installation_id
        .and_then(canonical_uuid)
        .is_some_and(|legacy| legacy == stored_installation_id);
    let transaction = connection.transaction()?;
    transaction.execute_batch(
        "ALTER TABLE product_state
         ADD COLUMN legacy_updater_id_permitted INTEGER NOT NULL DEFAULT 0 CHECK (
            legacy_updater_id_permitted IN (0, 1)
         );",
    )?;
    transaction.execute(
        "UPDATE product_state SET legacy_updater_id_permitted = ?1 WHERE singleton = 1",
        [legacy_updater_id_permitted],
    )?;
    transaction.pragma_update(None, "user_version", PRODUCT_BASELINE_SCHEMA_VERSION)?;
    transaction.commit()?;
    Ok(())
}

/// Runs every step from `from` in one transaction; a failure leaves the
/// database at `from` for the next open.
fn migrate_product_schema(connection: &mut Connection, from: i64) -> Result<(), ProductStateError> {
    let transaction = connection.transaction()?;
    apply_product_steps(&transaction, from)?;
    transaction.commit()?;
    validate_schema(connection)
}

fn apply_product_steps(
    transaction: &rusqlite::Transaction<'_>,
    from: i64,
) -> Result<(), ProductStateError> {
    let first = usize::try_from(from - PRODUCT_BASELINE_SCHEMA_VERSION)
        .ok()
        .filter(|first| *first <= PRODUCT_MIGRATION_STEPS.len())
        .ok_or_else(|| {
            ProductStateError::InvalidState(format!("no migration path from product schema {from}"))
        })?;
    for (offset, step) in PRODUCT_MIGRATION_STEPS.iter().enumerate().skip(first) {
        step(transaction)?;
        transaction.pragma_update(
            None,
            "user_version",
            PRODUCT_BASELINE_SCHEMA_VERSION + offset as i64 + 1,
        )?;
    }
    Ok(())
}

/// Product schema 3 (Tactical 358): desktop shell switches move here from
/// `desktop-shell.json`. The row is absent until the desktop writes it.
fn migrate_product_2_to_3(
    transaction: &rusqlite::Transaction<'_>,
) -> Result<(), ProductStateError> {
    transaction.execute_batch(
        "CREATE TABLE desktop_shell_settings (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            run_in_background INTEGER NOT NULL CHECK (run_in_background IN (0, 1)),
            notify_download_complete INTEGER NOT NULL
                CHECK (notify_download_complete IN (0, 1)),
            notify_needs_attention INTEGER NOT NULL
                CHECK (notify_needs_attention IN (0, 1)),
            notify_while_focused INTEGER NOT NULL
                CHECK (notify_while_focused IN (0, 1)),
            prevent_sleep_during_active_downloads INTEGER NOT NULL
                CHECK (prevent_sleep_during_active_downloads IN (0, 1))
         );",
    )?;
    Ok(())
}

fn create_schema(
    connection: &mut Connection,
    current_version: &str,
    legacy_installation_id: Option<&str>,
    now_millis: u64,
) -> Result<(), ProductStateError> {
    let legacy_installation_id = legacy_installation_id.and_then(canonical_uuid);
    let legacy_updater_id_permitted = legacy_installation_id.is_some();
    let installation_id = legacy_installation_id
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let transaction = connection.transaction()?;
    transaction.execute_batch(PRODUCT_BASELINE_TABLES_SQL)?;
    let now = encode_u64(now_millis);
    transaction.execute(
        "INSERT INTO product_state(
            singleton, installation_id, created_at_millis, first_version,
            current_version, reset_generation, last_start_millis,
            legacy_updater_id_permitted
         ) VALUES (1, ?1, ?2, ?3, ?3, ?4, ?2, ?5)",
        params![
            installation_id,
            now,
            current_version,
            Uuid::new_v4().to_string(),
            legacy_updater_id_permitted,
        ],
    )?;
    transaction.pragma_update(None, "user_version", PRODUCT_BASELINE_SCHEMA_VERSION)?;
    apply_product_steps(&transaction, PRODUCT_BASELINE_SCHEMA_VERSION)?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
fn baseline_schema_sql(connection: &mut Connection) -> Vec<(String, Option<String>)> {
    // The frozen baseline is everything `create_schema` writes before steps.
    let transaction = connection.transaction().expect("baseline transaction");
    transaction
        .execute_batch(PRODUCT_BASELINE_TABLES_SQL)
        .expect("baseline tables");
    transaction.commit().expect("commit baseline");
    let mut statement = connection
        .prepare("SELECT name, sql FROM sqlite_master ORDER BY name")
        .expect("schema query");
    statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("schema rows")
        .collect::<Result<_, _>>()
        .expect("schema")
}

fn validate_schema(connection: &Connection) -> Result<(), ProductStateError> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version != PRODUCT_SCHEMA_VERSION {
        return Err(ProductStateError::UnsupportedSchema {
            actual: version,
            maximum: PRODUCT_SCHEMA_VERSION,
        });
    }
    let row = connection
        .query_row(
            "SELECT installation_id, created_at_millis, first_version,
                    current_version, disclosure_version, statistics_enabled,
                    torrents_added, downloads_completed, foreground_sessions,
                    reset_generation, last_start_millis,
                    last_clean_shutdown_millis, legacy_updater_id_permitted
             FROM product_state WHERE singleton = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, bool>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, bool>(12)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| {
            ProductStateError::InvalidState("product singleton is missing".to_owned())
        })?;
    Uuid::parse_str(&row.0)
        .map_err(|_| ProductStateError::InvalidState("installation ID is not a UUID".to_owned()))?;
    decode_u64(&row.1, "creation time")?;
    validate_version(&row.2).map_err(invalid_configuration_as_state)?;
    validate_version(&row.3).map_err(invalid_configuration_as_state)?;
    if !(0..=i64::from(CURRENT_PRODUCT_DISCLOSURE_VERSION)).contains(&row.4) {
        return Err(ProductStateError::InvalidState(
            "product disclosure version is unsupported".to_owned(),
        ));
    }
    let _statistics_enabled = row.5;
    decode_u64(&row.6, "torrents-added counter")?;
    decode_u64(&row.7, "downloads-completed counter")?;
    decode_u64(&row.8, "foreground-sessions counter")?;
    Uuid::parse_str(&row.9).map_err(|_| {
        ProductStateError::InvalidState("reset generation is not a UUID".to_owned())
    })?;
    decode_u64(&row.10, "last-start time")?;
    if let Some(value) = &row.11 {
        decode_u64(value, "last-clean-shutdown time")?;
    }
    let _legacy_updater_id_permitted = row.12;
    let source_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM product_source_watermarks",
        [],
        |row| row.get(0),
    )?;
    if source_count > i64::try_from(MAX_PRODUCT_SOURCES).expect("source limit fits SQLite i64") {
        return Err(ProductStateError::InvalidState(
            "product source watermark count exceeds its limit".to_owned(),
        ));
    }
    let mut statement = connection
        .prepare("SELECT last_sequence FROM product_source_watermarks ORDER BY source_epoch")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    for sequence in rows {
        let sequence = decode_u64(&sequence?, "source watermark")?;
        if sequence == 0 {
            return Err(ProductStateError::InvalidState(
                "product source watermark is zero".to_owned(),
            ));
        }
    }
    Ok(())
}

fn read_summary(
    connection: &Connection,
    now_millis: u64,
) -> Result<ProductSummary, ProductStateError> {
    let row = connection.query_row(
        "SELECT installation_id, created_at_millis, first_version,
                current_version, disclosure_version, statistics_enabled,
                torrents_added, downloads_completed, foreground_sessions,
                reset_generation, last_start_millis,
                last_clean_shutdown_millis
         FROM product_state WHERE singleton = 1",
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, u32>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, Option<String>>(11)?,
            ))
        },
    )?;
    let created_at_millis = decode_u64(&row.1, "creation time")?;
    let days_since_first_use = now_millis
        .saturating_sub(created_at_millis)
        .checked_div(86_400_000)
        .unwrap_or(0);
    let transmission_allowed = row.4 == CURRENT_PRODUCT_DISCLOSURE_VERSION && row.5;
    Ok(ProductSummary {
        installation_id: row.0,
        created_at_millis: row.1,
        first_version: row.2,
        current_version: row.3,
        disclosure_version: row.4,
        statistics_enabled: row.5,
        torrents_added: row.6,
        downloads_completed: row.7,
        foreground_sessions: row.8,
        reset_generation: row.9,
        last_start_millis: row.10,
        last_clean_shutdown_millis: row.11,
        days_since_first_use,
        transmission_allowed,
    })
}

fn source_watermark(
    transaction: &Transaction<'_>,
    source_epoch: &[u8; 16],
) -> Result<Option<u64>, ProductStateError> {
    transaction
        .query_row(
            "SELECT last_sequence FROM product_source_watermarks
             WHERE source_epoch = ?1",
            [source_epoch.as_slice()],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|value| decode_u64(&value, "source watermark"))
        .transpose()
}

fn increment_counter(
    transaction: &Transaction<'_>,
    column: &'static str,
) -> Result<(), ProductStateError> {
    if !matches!(
        column,
        "torrents_added" | "downloads_completed" | "foreground_sessions"
    ) {
        return Err(ProductStateError::InvalidConfiguration(
            "unknown product counter".to_owned(),
        ));
    }
    let query = format!("SELECT {column} FROM product_state WHERE singleton = 1");
    let current: String = transaction.query_row(&query, [], |row| row.get(0))?;
    let next = decode_u64(&current, column)?.saturating_add(1);
    let update = format!("UPDATE product_state SET {column} = ?1 WHERE singleton = 1");
    transaction.execute(&update, [encode_u64(next)])?;
    Ok(())
}

fn validate_version(value: &str) -> Result<(), ProductStateError> {
    if value.is_empty()
        || value.len() > MAX_PRODUCT_VERSION_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(ProductStateError::InvalidConfiguration(format!(
            "product version must be 1..={MAX_PRODUCT_VERSION_BYTES} bytes without control characters"
        )));
    }
    Ok(())
}

fn canonical_uuid(value: &str) -> Option<&str> {
    let value = value.trim();
    Uuid::parse_str(value)
        .ok()
        .filter(|uuid| uuid.to_string() == value)
        .map(|_| value)
}

fn invalid_configuration_as_state(error: ProductStateError) -> ProductStateError {
    ProductStateError::InvalidState(error.to_string())
}

fn encode_u64(value: u64) -> String {
    value.to_string()
}

fn decode_u64(value: &str, field: &str) -> Result<u64, ProductStateError> {
    if value.is_empty()
        || value.len() > MAX_U64_TEXT_BYTES
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(ProductStateError::InvalidState(format!(
            "{field} is not a canonical unsigned integer"
        )));
    }
    value.parse().map_err(|_| {
        ProductStateError::InvalidState(format!("{field} exceeds the supported range"))
    })
}

fn now_millis() -> Result<u64, ProductStateError> {
    let duration = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| {
        ProductStateError::InvalidState("system clock is before the Unix epoch".to_owned())
    })?;
    u64::try_from(duration.as_millis()).map_err(|_| {
        ProductStateError::InvalidState("system clock milliseconds overflow u64".to_owned())
    })
}

fn configure_durable_connection(connection: &Connection) -> Result<(), ProductStateError> {
    connection.busy_timeout(BUSY_TIMEOUT)?;
    let journal_mode: String =
        connection.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        connection.pragma_update(None, "journal_mode", "WAL")?;
    }
    let journal_mode: String =
        connection.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        return Err(ProductStateError::RequiredPragma("journal_mode=WAL"));
    }
    connection.pragma_update(None, "synchronous", "FULL")?;
    let synchronous: i64 = connection.pragma_query_value(None, "synchronous", |row| row.get(0))?;
    if synchronous != 2 {
        return Err(ProductStateError::RequiredPragma("synchronous=FULL"));
    }
    Ok(())
}

fn pragma_u64(connection: &Connection, pragma: &str) -> Result<u64, ProductStateError> {
    let value: i64 = connection.pragma_query_value(None, pragma, |row| row.get(0))?;
    u64::try_from(value)
        .map_err(|_| ProductStateError::InvalidState(format!("negative product SQLite {pragma}")))
}

#[cfg(test)]
mod tests {
    use super::{
        CURRENT_PRODUCT_DISCLOSURE_VERSION, MAX_PRODUCT_SOURCES, PRODUCT_DATABASE_FILENAME,
        PRODUCT_FEEDBACK_URL, PRODUCT_SCHEMA_VERSION, ProductFeedbackEnvironment, ProductMilestone,
        ProductMilestoneKind, ProductStateError, ProductStateStore, UpdaterStatistics,
        build_product_feedback_preview,
    };

    const START: u64 = 1_800_000_000_000;

    const RELEASED_PRODUCT_DATABASES: &[(i64, &[u8])] =
        &[(2, include_bytes!("../tests/fixtures/product/v2.sqlite"))];

    fn schema(connection: &rusqlite::Connection) -> Vec<(String, Option<String>)> {
        let mut statement = connection
            .prepare("SELECT name, sql FROM sqlite_master ORDER BY name")
            .expect("schema query");
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("schema rows")
            .collect::<Result<_, _>>()
            .expect("schema")
    }

    /// Every product value an open does not deliberately update.
    fn durable_values(connection: &rusqlite::Connection) -> Vec<String> {
        let mut values: Vec<String> = connection
            .query_row(
                "SELECT installation_id, created_at_millis, first_version,
                        disclosure_version, statistics_enabled, torrents_added,
                        downloads_completed, foreground_sessions, reset_generation,
                        last_clean_shutdown_millis, legacy_updater_id_permitted
                 FROM product_state",
                [],
                |row| {
                    (0..11)
                        .map(|index| {
                            let value: rusqlite::types::Value = row.get(index)?;
                            Ok(format!("{value:?}"))
                        })
                        .collect()
                },
            )
            .expect("product row");
        let mut statement = connection
            .prepare("SELECT source_epoch, last_sequence FROM product_source_watermarks")
            .expect("watermarks");
        let rows = statement
            .query_map([], |row| {
                Ok(format!(
                    "{:?}|{}",
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, String>(1)?
                ))
            })
            .expect("watermark rows");
        for row in rows {
            values.push(row.expect("watermark"));
        }
        values
    }

    #[test]
    fn released_product_databases_migrate_keeping_every_value_and_consent() {
        let fresh_root = tempfile::tempdir().expect("fresh root");
        let fresh = ProductStateStore::open_at(fresh_root.path(), "9.9.9", None, START).unwrap();
        let fresh_schema = schema(&fresh.connection);
        drop(fresh);
        for (version, bytes) in RELEASED_PRODUCT_DATABASES {
            let root = tempfile::tempdir().expect("product root");
            let path = root.path().join(PRODUCT_DATABASE_FILENAME);
            std::fs::write(&path, bytes).expect("install fixture");
            let original = rusqlite::Connection::open(&path).expect("raw fixture");
            let before = durable_values(&original);
            drop(original);

            let migrated = ProductStateStore::open_at(root.path(), "9.9.9", None, START).unwrap();
            assert_eq!(
                migrated
                    .connection
                    .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                    .unwrap(),
                PRODUCT_SCHEMA_VERSION
            );
            assert_eq!(
                schema(&migrated.connection),
                fresh_schema,
                "product {version}"
            );
            assert_eq!(
                durable_values(&migrated.connection),
                before,
                "product {version}"
            );
            assert!(!migrated.summary().unwrap().statistics_enabled);
            assert_eq!(migrated.desktop_shell_preferences().unwrap(), None);
        }
    }

    #[test]
    fn product_baseline_definitions_stay_frozen() {
        let (version, bytes) = RELEASED_PRODUCT_DATABASES[0];
        assert_eq!(version, super::PRODUCT_BASELINE_SCHEMA_VERSION);
        let root = tempfile::tempdir().expect("product root");
        let path = root.path().join(PRODUCT_DATABASE_FILENAME);
        std::fs::write(&path, bytes).expect("install fixture");
        let released = rusqlite::Connection::open(&path).expect("released");
        let mut fresh = rusqlite::Connection::open_in_memory().expect("fresh");
        assert_eq!(super::baseline_schema_sql(&mut fresh), schema(&released));
    }

    #[test]
    fn desktop_shell_preferences_round_trip_and_survive_clear_and_reopen() {
        let root = tempfile::tempdir().expect("product root");
        let mut store = ProductStateStore::open_at(root.path(), "1", None, START).unwrap();
        assert_eq!(store.desktop_shell_preferences().unwrap(), None);
        let preferences = super::DesktopShellPreferences {
            run_in_background: false,
            notify_download_complete: true,
            notify_needs_attention: false,
            notify_while_focused: true,
            prevent_sleep_during_active_downloads: false,
        };
        store
            .replace_desktop_shell_preferences(preferences)
            .unwrap();
        store.clear_app_data().unwrap();
        drop(store);
        let reopened = ProductStateStore::open_at(root.path(), "2", None, START + 1).unwrap();
        assert_eq!(
            reopened.desktop_shell_preferences().unwrap(),
            Some(preferences)
        );
    }

    #[test]
    fn fresh_state_is_stable_private_and_not_transmitted_before_disclosure() {
        let root = tempfile::tempdir().expect("temporary product root");
        let first = ProductStateStore::open_at(root.path(), "1.2.3", None, START)
            .expect("open product state");
        let first_summary = first.summary_at(START).expect("fresh summary");
        assert!(uuid::Uuid::parse_str(&first_summary.installation_id).is_ok());
        assert_eq!(first_summary.first_version, "1.2.3");
        assert_eq!(first_summary.current_version, "1.2.3");
        assert!(first_summary.statistics_enabled);
        assert_eq!(first_summary.disclosure_version, 0);
        assert!(!first_summary.transmission_allowed);
        assert_eq!(first.updater_installation_id().unwrap(), None);
        assert_eq!(
            first.updater_statistics().unwrap(),
            UpdaterStatistics::Unreviewed
        );
        assert_eq!(first_summary.days_since_first_use, 0);
        drop(first);

        let reopened = ProductStateStore::open_at(root.path(), "1.2.4", None, START + 86_400_000)
            .expect("reopen product state");
        let reopened_summary = reopened
            .summary_at(START + 86_400_000)
            .expect("reopened summary");
        assert_eq!(
            reopened_summary.installation_id,
            first_summary.installation_id
        );
        assert_eq!(reopened_summary.first_version, "1.2.3");
        assert_eq!(reopened_summary.current_version, "1.2.4");
        assert_eq!(reopened_summary.days_since_first_use, 1);
        assert!(root.path().join(PRODUCT_DATABASE_FILENAME).is_file());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(root.path().join(PRODUCT_DATABASE_FILENAME))
                .expect("product database metadata")
                .permissions()
                .mode();
            assert_eq!(mode & 0o077, 0);
        }
    }

    #[test]
    fn valid_legacy_id_is_adopted_only_for_fresh_state() {
        let root = tempfile::tempdir().expect("temporary product root");
        let legacy = "87e66203-9849-44c5-a557-8e77c29e7587";
        let first = ProductStateStore::open_at(root.path(), "1", Some(legacy), START)
            .expect("adopt legacy ID");
        assert_eq!(first.summary_at(START).unwrap().installation_id, legacy);
        assert_eq!(
            first.updater_installation_id().unwrap().as_deref(),
            Some(legacy)
        );
        drop(first);

        let reopened = ProductStateStore::open_at(
            root.path(),
            "2",
            Some("6521c174-0aa9-4fc8-b1fe-702ff3d332d6"),
            START + 1,
        )
        .expect("reopen existing product state");
        assert_eq!(
            reopened.summary_at(START + 1).unwrap().installation_id,
            legacy
        );
        assert_eq!(
            reopened.updater_installation_id().unwrap().as_deref(),
            Some(legacy)
        );

        let malformed_root = tempfile::tempdir().expect("malformed legacy root");
        let malformed = ProductStateStore::open_at(
            malformed_root.path(),
            "1",
            Some("87E66203-9849-44C5-A557-8E77C29E7587"),
            START,
        )
        .expect("replace noncanonical legacy ID");
        assert_ne!(
            malformed.summary_at(START).unwrap().installation_id,
            "87e66203-9849-44c5-a557-8e77c29e7587"
        );
        assert_eq!(malformed.updater_installation_id().unwrap(), None);
    }

    #[test]
    fn disclosure_preference_and_reset_are_atomic() {
        let root = tempfile::tempdir().expect("temporary product root");
        let mut store = ProductStateStore::open_at(root.path(), "1", None, START).unwrap();
        assert!(matches!(
            store.set_statistics_enabled(false),
            Err(ProductStateError::InvalidState(_))
        ));
        let acknowledged = store.acknowledge_disclosure(true).unwrap();
        assert_eq!(
            acknowledged.disclosure_version,
            CURRENT_PRODUCT_DISCLOSURE_VERSION
        );
        assert!(acknowledged.transmission_allowed);
        assert!(store.updater_installation_id().unwrap().is_some());
        assert_eq!(store.updater_statistics().unwrap(), UpdaterStatistics::On);
        let disabled = store.set_statistics_enabled(false).unwrap();
        assert!(!disabled.statistics_enabled);
        assert!(!disabled.transmission_allowed);
        assert_eq!(store.updater_installation_id().unwrap(), None);
        assert_eq!(store.updater_statistics().unwrap(), UpdaterStatistics::Off);
        assert_eq!(UpdaterStatistics::Off.as_str(), "off");
        let old_id = disabled.installation_id;
        let old_generation = disabled.reset_generation;
        store.record_foreground_session().unwrap();
        let reset = store.reset_statistics_at(START + 5).unwrap();
        assert_ne!(reset.installation_id, old_id);
        assert_ne!(reset.reset_generation, old_generation);
        assert_eq!(reset.created_at_millis, (START + 5).to_string());
        assert_eq!(reset.foreground_sessions, "0");
        assert!(!reset.statistics_enabled);
        assert!(!reset.transmission_allowed);
        assert_eq!(store.updater_installation_id().unwrap(), None);
    }

    #[test]
    fn clear_app_data_forgets_identity_statistics_and_disclosure() {
        let root = tempfile::tempdir().expect("temporary product root");
        let mut store = ProductStateStore::open_at(root.path(), "1", None, START).unwrap();
        let before = store.acknowledge_disclosure(true).unwrap();
        assert!(before.transmission_allowed);
        let cleared = store.clear_app_data().unwrap();
        assert_ne!(cleared.installation_id, before.installation_id);
        assert_eq!(cleared.disclosure_version, 0);
        assert!(!cleared.transmission_allowed);
        assert_eq!(cleared.torrents_added, "0");
        assert_eq!(cleared.downloads_completed, "0");
        assert_eq!(cleared.foreground_sessions, "0");
        assert_eq!(store.updater_installation_id().unwrap(), None);
        drop(store);
        let reopened = ProductStateStore::open_at(root.path(), "2", None, START + 1).unwrap();
        assert_eq!(
            reopened.summary_at(START + 1).unwrap().installation_id,
            cleared.installation_id
        );
        assert_eq!(
            reopened.summary_at(START + 1).unwrap().disclosure_version,
            0
        );
    }

    #[test]
    fn reset_removes_the_pre_disclosure_legacy_updater_exception() {
        let root = tempfile::tempdir().expect("temporary product root");
        let legacy = "87e66203-9849-44c5-a557-8e77c29e7587";
        let mut store = ProductStateStore::open_at(root.path(), "1", Some(legacy), START).unwrap();
        assert_eq!(
            store.updater_installation_id().unwrap().as_deref(),
            Some(legacy)
        );
        store.acknowledge_disclosure(false).unwrap();
        assert_eq!(store.updater_installation_id().unwrap(), None);
        store.reset_statistics_at(START + 1).unwrap();
        assert_eq!(store.updater_installation_id().unwrap(), None);
    }

    #[test]
    fn schema_one_migration_recovers_legacy_updater_provenance_without_a_second_id() {
        let root = tempfile::tempdir().expect("temporary product root");
        let legacy = "87e66203-9849-44c5-a557-8e77c29e7587";
        let store = ProductStateStore::open_at(root.path(), "1", Some(legacy), START).unwrap();
        store
            .connection
            .execute_batch(
                "DROP TABLE desktop_shell_settings;
                 ALTER TABLE product_state DROP COLUMN legacy_updater_id_permitted;
                 PRAGMA user_version = 1;",
            )
            .expect("downgrade fixture to original schema one");
        drop(store);

        let migrated =
            ProductStateStore::open_at(root.path(), "2", Some(legacy), START + 1).unwrap();
        assert_eq!(migrated.summary().unwrap().installation_id, legacy);
        assert_eq!(
            migrated.updater_installation_id().unwrap().as_deref(),
            Some(legacy)
        );
    }

    #[test]
    fn feedback_preview_has_a_closed_ordered_allowlist_and_release_gate() {
        let mut store = ProductStateStore::open_ephemeral_at("1.2.3", START).unwrap();
        store.acknowledge_disclosure(true).unwrap();
        store.record_foreground_session().unwrap();
        store
            .apply_milestones(&[
                ProductMilestone {
                    source_epoch: [4; 16],
                    sequence: 1,
                    kind: ProductMilestoneKind::TorrentAdded,
                },
                ProductMilestone {
                    source_epoch: [4; 16],
                    sequence: 2,
                    kind: ProductMilestoneKind::DownloadCompleted,
                },
            ])
            .unwrap();
        let summary = store.summary_at(START + 2 * 86_400_000).unwrap();
        let environment = ProductFeedbackEnvironment::desktop("1.2.3");

        let gated = build_product_feedback_preview(&summary, &environment, true, false).unwrap();
        assert_eq!(
            gated.url,
            format!("{PRODUCT_FEEDBACK_URL}?platform=desktop&v=1.2.3")
        );
        assert!(!gated.statistics_available);
        assert!(!gated.statistics_included);
        assert_eq!(
            gated
                .fields
                .iter()
                .map(|field| field.name.as_str())
                .collect::<Vec<_>>(),
            ["platform", "v"]
        );

        let included = build_product_feedback_preview(&summary, &environment, true, true).unwrap();
        assert!(included.statistics_available);
        assert!(included.statistics_included);
        assert_eq!(
            included
                .fields
                .iter()
                .map(|field| field.name.as_str())
                .collect::<Vec<_>>(),
            [
                "platform",
                "v",
                "id",
                "days",
                "added",
                "completed",
                "sessions"
            ]
        );
        assert!(
            included
                .url
                .contains("&days=2&added=1&completed=1&sessions=1")
        );
        for prohibited in [
            "torrent", "hash", "path", "root", "tracker", "peer", "error", "log",
        ] {
            assert!(
                !included
                    .url
                    .split_once('?')
                    .expect("feedback URL has query")
                    .1
                    .contains(prohibited)
            );
        }

        let omitted = build_product_feedback_preview(&summary, &environment, false, true).unwrap();
        assert_eq!(omitted.url, gated.url);
        assert!(!omitted.statistics_included);
    }

    #[test]
    fn android_feedback_environment_is_encoded_and_bounded_without_partial_urls() {
        let store = ProductStateStore::open_ephemeral_at("1", START).unwrap();
        let summary = store.summary_at(START).unwrap();
        let preview = build_product_feedback_preview(
            &summary,
            &ProductFeedbackEnvironment::android("0.1", "13", "Google nami/🙂"),
            true,
            true,
        )
        .unwrap();
        assert_eq!(
            preview.url,
            "https://jstorrent.com/feedback.html?platform=android&v=0.1&android=13&device=Google+nami%2F%F0%9F%99%82"
        );
        assert!(!preview.statistics_included);
        assert!(matches!(
            build_product_feedback_preview(
                &summary,
                &ProductFeedbackEnvironment::android("0.1", "13", "x".repeat(513)),
                false,
                false,
            ),
            Err(ProductStateError::InvalidConfiguration(_))
        ));
    }

    #[test]
    fn milestone_application_is_ordered_idempotent_and_source_bounded() {
        let mut store = ProductStateStore::open_ephemeral_at("1", START).unwrap();
        let source = [7; 16];
        let milestones = [
            ProductMilestone {
                source_epoch: source,
                sequence: 1,
                kind: ProductMilestoneKind::TorrentAdded,
            },
            ProductMilestone {
                source_epoch: source,
                sequence: 2,
                kind: ProductMilestoneKind::DownloadCompleted,
            },
        ];
        let applied = store.apply_milestones(&milestones).unwrap();
        assert_eq!(applied.torrents_added, "1");
        assert_eq!(applied.downloads_completed, "1");
        let replayed = store.apply_milestones(&milestones).unwrap();
        assert_eq!(replayed.torrents_added, "1");
        assert_eq!(replayed.downloads_completed, "1");
        assert!(matches!(
            store.apply_milestones(&[ProductMilestone {
                source_epoch: source,
                sequence: 4,
                kind: ProductMilestoneKind::TorrentAdded,
            }]),
            Err(ProductStateError::SequenceGap {
                expected: 3,
                actual: 4
            })
        ));

        for index in 1..MAX_PRODUCT_SOURCES {
            let mut epoch = [0; 16];
            epoch[..8].copy_from_slice(&(index as u64).to_be_bytes());
            epoch[15] = 1;
            store
                .apply_milestones(&[ProductMilestone {
                    source_epoch: epoch,
                    sequence: 1,
                    kind: ProductMilestoneKind::TorrentAdded,
                }])
                .unwrap();
        }
        assert!(matches!(
            store.apply_milestones(&[ProductMilestone {
                source_epoch: [9; 16],
                sequence: 1,
                kind: ProductMilestoneKind::TorrentAdded,
            }]),
            Err(ProductStateError::SourceLimit)
        ));
    }

    #[test]
    fn maximum_source_watermarks_keep_native_storage_bounded() {
        let root = tempfile::tempdir().expect("temporary product root");
        let mut store = ProductStateStore::open_at(root.path(), "1", None, START).unwrap();
        for index in 0..MAX_PRODUCT_SOURCES {
            let mut epoch = [0; 16];
            epoch[..8].copy_from_slice(&((index + 1) as u64).to_be_bytes());
            store
                .apply_milestones(&[ProductMilestone {
                    source_epoch: epoch,
                    sequence: 1,
                    kind: ProductMilestoneKind::TorrentAdded,
                }])
                .unwrap();
        }

        let usage = store.page_usage().expect("read product page usage");
        let database = root.path().join(PRODUCT_DATABASE_FILENAME);
        let database_bytes = std::fs::metadata(&database)
            .expect("product database metadata")
            .len();
        let wal_bytes = std::fs::metadata(database.with_extension("db-wal"))
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        eprintln!(
            "product-state high water: page_size={} page_count={} logical_bytes={} database_bytes={} wal_bytes={}",
            usage.page_size,
            usage.page_count,
            usage.page_size * usage.page_count,
            database_bytes,
            wal_bytes,
        );

        assert!(usage.page_size * usage.page_count <= 64 * 1024);
        assert!(database_bytes <= 64 * 1024);
        assert!(wal_bytes <= 4 * 1024 * 1024);
        assert_eq!(store.summary().unwrap().torrents_added, "128");
    }

    #[test]
    fn counter_saturates_and_clock_rollback_reports_zero_days() {
        let mut store = ProductStateStore::open_ephemeral_at("1", START).unwrap();
        store
            .connection
            .execute(
                "UPDATE product_state SET foreground_sessions = ?1 WHERE singleton = 1",
                [u64::MAX.to_string()],
            )
            .unwrap();
        let summary = store.record_foreground_session().unwrap();
        assert_eq!(summary.foreground_sessions, u64::MAX.to_string());
        assert_eq!(store.summary_at(START - 1).unwrap().days_since_first_use, 0);
    }

    #[test]
    fn malformed_and_future_state_fail_closed() {
        let root = tempfile::tempdir().expect("temporary product root");
        let store = ProductStateStore::open_at(root.path(), "1", None, START).unwrap();
        store
            .connection
            .execute(
                "UPDATE product_state SET torrents_added = '01' WHERE singleton = 1",
                [],
            )
            .unwrap();
        drop(store);
        assert!(matches!(
            ProductStateStore::open_at(root.path(), "1", None, START + 1),
            Err(ProductStateError::InvalidState(_))
        ));

        let future = tempfile::tempdir().expect("future product root");
        let store = ProductStateStore::open_at(future.path(), "1", None, START).unwrap();
        store
            .connection
            .pragma_update(None, "user_version", PRODUCT_SCHEMA_VERSION + 1)
            .unwrap();
        drop(store);
        assert!(matches!(
            ProductStateStore::open_at(future.path(), "1", None, START + 1),
            Err(ProductStateError::UnsupportedSchema { .. })
        ));
    }

    #[test]
    fn milestone_kind_round_trips_closed_names() {
        for kind in [
            ProductMilestoneKind::TorrentAdded,
            ProductMilestoneKind::DownloadCompleted,
        ] {
            assert_eq!(ProductMilestoneKind::parse(kind.as_str()).unwrap(), kind);
        }
        assert!(ProductMilestoneKind::parse("arbitrary_event").is_err());
    }
}
