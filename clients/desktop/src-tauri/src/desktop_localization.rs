//! Presentation-only locale ownership; no locale enters the application API.
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU8, Ordering};

use serde::{Deserialize, Serialize};

const ENGLISH_CATALOG: &str = include_str!("../locales/en.json");
#[cfg(debug_assertions)]
const GERMAN_CATALOG: &str = include_str!("../locales/de.json");
const MISSING_MESSAGE: &str = "Localized message unavailable";
const PREFERENCE_FILENAME: &str = "presentation-preferences.json";
const LANGUAGE_KEY: &str = "language";
const MAX_PREFERENCE_BYTES: u64 = 64 * 1024;
pub(crate) const DIALOG_LOCALE_ENV: &str = "JSTORRENT_DIALOG_LOCALE";
pub(crate) const LOCALE_CHANGED_EVENT: &str = "desktop://locale-changed";
static ENGLISH: OnceLock<HashMap<String, String>> = OnceLock::new();
#[cfg(debug_assertions)]
static GERMAN: OnceLock<HashMap<String, String>> = OnceLock::new();
static CURRENT_LOCALE: AtomicU8 = AtomicU8::new(0);

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum LocalePreference {
    #[default]
    System,
    En,
    De,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopLocaleSnapshot {
    pub(crate) preference: LocalePreference,
    pub(crate) locale: &'static str,
    pub(crate) available_locales: Vec<&'static str>,
}

/// Owns just one tolerant UI preference. Operational settings stay in SQLite.
pub(crate) struct DesktopLocaleOwner {
    path: PathBuf,
    preference: LocalePreference,
    system_locales: Vec<String>,
    allow_preview: bool,
}

impl DesktopLocaleOwner {
    pub(crate) fn open(config_dir: &Path) -> Self {
        Self::open_with_locales(config_dir, system_locales(), preview_enabled())
    }

    fn open_with_locales(
        config_dir: &Path,
        system_locales: Vec<String>,
        allow_preview: bool,
    ) -> Self {
        let path = config_dir.join(PREFERENCE_FILENAME);
        // A malformed/missing field is a per-field default, never a request to
        // replace the store. Reads intentionally leave even damaged data intact.
        let preference = read_preferences(&path)
            .ok()
            .and_then(|fields| fields.get(LANGUAGE_KEY).cloned())
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default();
        Self {
            path,
            preference,
            system_locales,
            allow_preview,
        }
    }

    pub(crate) fn snapshot(&self) -> DesktopLocaleSnapshot {
        DesktopLocaleSnapshot {
            preference: self.preference,
            locale: resolve_locale(self.preference, &self.system_locales, self.allow_preview),
            available_locales: if self.allow_preview {
                vec!["en", "de"]
            } else {
                vec!["en"]
            },
        }
    }

    pub(crate) fn refresh_system(&mut self) -> DesktopLocaleSnapshot {
        self.system_locales = system_locales();
        self.snapshot()
    }

    pub(crate) fn select(
        &mut self,
        preference: LocalePreference,
    ) -> Result<DesktopLocaleSnapshot, String> {
        if preference == LocalePreference::De && !self.allow_preview {
            return Err("desktop locale is not available in this build".to_owned());
        }
        // Always reread to preserve fields written by a newer client or another
        // preference owner. Never replace unreadable/non-object preferences.
        let mut fields = read_preferences(&self.path)?;
        if fields
            .get(LANGUAGE_KEY)
            .is_some_and(|value| serde_json::from_value::<LocalePreference>(value.clone()).is_err())
        {
            return Err("desktop language preference is not supported by this build".to_owned());
        }
        if preference == LocalePreference::System {
            fields.remove(LANGUAGE_KEY);
        } else {
            fields.insert(
                LANGUAGE_KEY.to_owned(),
                serde_json::to_value(preference).expect("locale preference serializes"),
            );
        }
        persist_preferences(&self.path, &fields)?;
        self.preference = preference;
        Ok(self.refresh_system())
    }
}

fn read_preferences(path: &Path) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    // Inspect before opening: a damaged preference path must not turn startup
    // into a blocking pipe/device read, nor replace a link on an explicit edit.
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Default::default()),
        Err(_) => return Err("desktop presentation preferences could not be inspected".to_owned()),
    };
    if !metadata.file_type().is_file() || metadata.len() > MAX_PREFERENCE_BYTES {
        return Err("desktop presentation preferences are not a bounded regular file".to_owned());
    }
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Default::default()),
        Err(_) => return Err("desktop presentation preferences could not be read".to_owned()),
    };
    if file
        .metadata()
        .map_err(|_| "desktop presentation preferences could not be inspected")?
        .len()
        > MAX_PREFERENCE_BYTES
    {
        return Err("desktop presentation preferences exceed their size limit".to_owned());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(MAX_PREFERENCE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "desktop presentation preferences could not be read")?;
    if bytes.len() as u64 > MAX_PREFERENCE_BYTES {
        return Err("desktop presentation preferences exceed their size limit".to_owned());
    }
    match serde_json::from_slice(&bytes) {
        Ok(serde_json::Value::Object(fields)) => Ok(fields),
        _ => Err("desktop presentation preferences are not a readable object".to_owned()),
    }
}

fn persist_preferences(
    path: &Path,
    fields: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let mut bytes = serde_json::to_vec_pretty(fields)
        .map_err(|_| "desktop presentation preference encoding failed")?;
    bytes.push(b'\n');
    if bytes.len() as u64 > MAX_PREFERENCE_BYTES {
        return Err("desktop presentation preferences exceed their size limit".to_owned());
    }
    let parent = path
        .parent()
        .ok_or("desktop presentation preference directory is unavailable")?;
    std::fs::create_dir_all(parent)
        .map_err(|_| "desktop presentation preference directory could not be created")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "desktop presentation preference temporary file failed")?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "desktop presentation preference write failed")?;
    temporary
        .persist(path)
        .map_err(|_| "desktop presentation preference replacement failed")?;
    Ok(())
}

fn resolve_locale(
    preference: LocalePreference,
    requested: &[String],
    allow_preview: bool,
) -> &'static str {
    match preference {
        LocalePreference::En => "en",
        LocalePreference::De if allow_preview => "de",
        LocalePreference::De => "en",
        LocalePreference::System => requested
            .iter()
            .find_map(|tag| {
                let language = tag.split(['-', '_', '.', '@']).next()?.to_ascii_lowercase();
                match language.as_str() {
                    "de" if allow_preview => Some("de"),
                    "en" | "c" | "posix" => Some("en"),
                    _ => None,
                }
            })
            .unwrap_or("en"),
    }
}

pub(crate) fn preview_enabled() -> bool {
    cfg!(debug_assertions)
        && matches!(
            option_env!("VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES"),
            Some("1")
        )
}

pub(crate) fn activate(locale: &str) {
    CURRENT_LOCALE.store(
        u8::from(preview_enabled() && locale == "de"),
        Ordering::Relaxed,
    );
}

pub(crate) fn current_locale() -> &'static str {
    if CURRENT_LOCALE.load(Ordering::Relaxed) == 1 {
        "de"
    } else {
        "en"
    }
}

pub(crate) fn text(key: &str) -> &'static str {
    text_for_locale(key, current_locale())
}

pub(crate) fn text_for_locale(key: &str, locale: &str) -> &'static str {
    #[cfg(debug_assertions)]
    if preview_enabled() && locale == "de" {
        let german = GERMAN.get_or_init(|| {
            serde_json::from_str(GERMAN_CATALOG)
                .expect("packaged desktop German catalog must be valid")
        });
        if let Some(value) = german.get(key) {
            return value;
        }
    }
    #[cfg(not(debug_assertions))]
    let _ = locale;
    let english = ENGLISH.get_or_init(|| {
        serde_json::from_str(ENGLISH_CATALOG)
            .expect("packaged desktop English catalog must be valid")
    });
    match english.get(key) {
        Some(value) => value,
        None => {
            eprintln!("missing desktop localized message: {key}");
            MISSING_MESSAGE
        }
    }
}

pub(crate) fn format_for_locale(key: &str, locale: &str, values: &[(&str, &str)]) -> String {
    format_template(text_for_locale(key, locale), values)
}

fn format_template(template: &str, values: &[(&str, &str)]) -> String {
    // Parse the template once. User values are data, including braces that
    // happen to resemble a different argument; never interpolate them again.
    let mut rendered = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        rendered.push_str(&rest[..open]);
        rest = &rest[open..];
        let Some(close) = rest.find('}') else {
            break;
        };
        let name = &rest[1..close];
        if let Some((_, value)) = values.iter().find(|(key, _)| *key == name) {
            rendered.push_str(value);
        } else {
            rendered.push_str(&rest[..=close]);
        }
        rest = &rest[close + 1..];
    }
    rendered.push_str(rest);
    rendered
}

fn environment_locales() -> Vec<String> {
    let mut result = Vec::new();
    if std::env::var("LC_ALL").is_ok_and(|value| matches!(value.as_str(), "C" | "POSIX")) {
        return vec!["en".to_owned()];
    }
    for key in ["LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(value) = std::env::var(key) {
            result.extend(
                value
                    .split(':')
                    .filter(|tag| !tag.is_empty() && tag.len() <= 128)
                    .take(16)
                    .map(str::to_owned),
            );
        }
    }
    result
}

pub(crate) fn system_locales() -> Vec<String> {
    let mut result = Vec::new();
    #[cfg(target_os = "macos")]
    if let Some(output) = locale_command(std::process::Command::new("/usr/bin/defaults").args([
        "read",
        "-g",
        "AppleLanguages",
    ])) {
        result.extend(
            output
                .split(|character: char| {
                    !(character.is_ascii_alphanumeric() || character == '-' || character == '_')
                })
                .filter(|tag| (2..=35).contains(&tag.len()))
                .map(str::to_owned),
        );
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[System.Globalization.CultureInfo]::CurrentUICulture.Name",
            ])
            .creation_flags(0x0800_0000);
        if let Some(output) = locale_command(&mut command) {
            result.extend(
                output
                    .split_whitespace()
                    .filter(|tag| tag.len() <= 128)
                    .map(str::to_owned),
            );
        }
    }
    result.extend(environment_locales());
    result
}

#[cfg(any(target_os = "macos", windows))]
fn locale_command(command: &mut std::process::Command) -> Option<String> {
    use std::process::Stdio;
    use std::time::{Duration, Instant};
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut bytes = Vec::new();
                child
                    .stdout
                    .take()?
                    .take(8193)
                    .read_to_end(&mut bytes)
                    .ok()?;
                return (status.success() && bytes.len() <= 8192)
                    .then(|| String::from_utf8(bytes).ok())
                    .flatten();
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_system_languages_regions_fallback_and_release_gate() {
        let languages = vec!["fr-FR".to_owned(), "de-DE".to_owned(), "en-US".to_owned()];
        assert_eq!(
            resolve_locale(LocalePreference::System, &languages, true),
            "de"
        );
        assert_eq!(
            resolve_locale(LocalePreference::System, &languages, false),
            "en"
        );
        assert_eq!(
            resolve_locale(LocalePreference::De, &languages, false),
            "en"
        );
        assert_eq!(resolve_locale(LocalePreference::En, &languages, true), "en");
        assert_eq!(
            resolve_locale(LocalePreference::System, &["de_DE.UTF-8".to_owned()], true),
            "de"
        );
        assert_eq!(
            resolve_locale(LocalePreference::System, &["not-a-locale".to_owned()], true),
            "en"
        );
    }

    #[test]
    fn reads_are_tolerant_and_never_rewrite_unknown_or_malformed_data() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(PREFERENCE_FILENAME);
        let original = br#"{"language":"future-locale","future":{"kept":true}}"#;
        std::fs::write(&path, original).unwrap();
        let mut owner =
            DesktopLocaleOwner::open_with_locales(directory.path(), vec!["en".to_owned()], true);
        assert_eq!(owner.snapshot().preference, LocalePreference::System);
        assert!(owner.select(LocalePreference::En).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        for damaged in [b"not json".as_slice(), b"[1,2,3]".as_slice()] {
            std::fs::write(&path, damaged).unwrap();
            let mut owner = DesktopLocaleOwner::open_with_locales(directory.path(), vec![], true);
            assert_eq!(owner.snapshot().locale, "en");
            assert!(owner.select(LocalePreference::De).is_err());
            assert_eq!(std::fs::read(&path).unwrap(), damaged);
            assert_eq!(owner.snapshot().preference, LocalePreference::System);
        }
    }

    #[test]
    fn explicit_selection_survives_restart_preserves_fields_and_system_clears_override() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(PREFERENCE_FILENAME);
        std::fs::write(&path, br#"{"future":{"keep":7}}"#).unwrap();
        let mut owner =
            DesktopLocaleOwner::open_with_locales(directory.path(), vec!["en".to_owned()], true);
        assert_eq!(owner.select(LocalePreference::De).unwrap().locale, "de");
        let mut reopened =
            DesktopLocaleOwner::open_with_locales(directory.path(), vec!["en".to_owned()], true);
        assert_eq!(reopened.snapshot().preference, LocalePreference::De);
        assert_eq!(reopened.snapshot().locale, "de");
        reopened.select(LocalePreference::System).unwrap();
        let fields = read_preferences(&path).unwrap();
        assert!(!fields.contains_key(LANGUAGE_KEY));
        assert_eq!(fields["future"]["keep"], 7);
        let system =
            DesktopLocaleOwner::open_with_locales(directory.path(), vec!["de-AT".to_owned()], true);
        assert_eq!(system.snapshot().locale, "de");
    }

    #[test]
    fn unavailable_selection_and_oversized_store_do_not_write() {
        let directory = tempfile::tempdir().unwrap();
        let mut owner = DesktopLocaleOwner::open_with_locales(directory.path(), vec![], false);
        assert!(owner.select(LocalePreference::De).is_err());
        assert!(!owner.path.exists());
        let data = vec![b' '; MAX_PREFERENCE_BYTES as usize + 1];
        std::fs::write(&owner.path, &data).unwrap();
        assert!(owner.select(LocalePreference::En).is_err());
        assert_eq!(std::fs::read(&owner.path).unwrap(), data);
    }

    #[test]
    fn nonregular_preferences_remain_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(PREFERENCE_FILENAME);
        std::fs::create_dir(&path).unwrap();
        let mut owner = DesktopLocaleOwner::open_with_locales(directory.path(), vec![], true);
        assert_eq!(owner.snapshot().preference, LocalePreference::System);
        assert!(owner.select(LocalePreference::En).is_err());
        assert!(path.is_dir());
        #[cfg(unix)]
        {
            std::fs::remove_dir(&path).unwrap();
            let target = directory.path().join("untouched.json");
            let original = br#"{"language":"de","future":7}"#;
            std::fs::write(&target, original).unwrap();
            std::os::unix::fs::symlink(&target, &path).unwrap();
            let mut owner = DesktopLocaleOwner::open_with_locales(directory.path(), vec![], true);
            assert_eq!(owner.snapshot().preference, LocalePreference::System);
            assert!(owner.select(LocalePreference::En).is_err());
            assert!(
                std::fs::symlink_metadata(&path)
                    .unwrap()
                    .file_type()
                    .is_symlink()
            );
            assert_eq!(std::fs::read(&target).unwrap(), original);
        }
    }

    #[test]
    fn resolves_packaged_english_and_named_placeholders_without_reinterpreting_user_data() {
        assert_eq!(text_for_locale("tray.show", "en"), "Show JSTorrent");
        assert_eq!(
            format_template("{name} finished downloading.", &[("name", "Sintel")]),
            "Sintel finished downloading."
        );
        assert_eq!(
            format_template("{name}: {other}", &[("name", "{other}"), ("other", "safe")]),
            "{other}: safe"
        );
        assert_eq!(
            format_template("before {unfinished", &[]),
            "before {unfinished"
        );
    }

    #[test]
    #[cfg(debug_assertions)]
    fn german_native_catalog_has_exact_english_keys_and_localizes_product_text() {
        let english: HashMap<String, String> = serde_json::from_str(ENGLISH_CATALOG).unwrap();
        let german: HashMap<String, String> = serde_json::from_str(GERMAN_CATALOG).unwrap();
        assert_eq!(
            english.keys().collect::<std::collections::BTreeSet<_>>(),
            german.keys().collect()
        );
        assert_ne!(german["tray.quit"], english["tray.quit"]);
        assert_ne!(
            german["dialog.download-folder.title"],
            english["dialog.download-folder.title"]
        );
        assert_eq!(
            text_for_locale("tray.quit", "de"),
            if preview_enabled() {
                &german["tray.quit"]
            } else {
                &english["tray.quit"]
            }
        );
    }

    #[test]
    fn native_availability_matches_the_renderer_build_gate() {
        let directory = tempfile::tempdir().unwrap();
        let owner = DesktopLocaleOwner::open(directory.path());
        assert_eq!(
            preview_enabled(),
            cfg!(debug_assertions)
                && option_env!("VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES") == Some("1")
        );
        assert_eq!(
            owner.snapshot().available_locales,
            if preview_enabled() {
                vec!["en", "de"]
            } else {
                vec!["en"]
            }
        );
    }
}
