//! Presentation-only locale ownership; no locale enters the application API.
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};

use serde::{Deserialize, Serialize};

const MISSING_MESSAGE: &str = "Localized message unavailable";
const PREFERENCE_FILENAME: &str = "presentation-preferences.json";
const LANGUAGE_KEY: &str = "language";
const MAX_PREFERENCE_BYTES: u64 = 64 * 1024;
pub(crate) const DIALOG_LOCALE_ENV: &str = "JSTORRENT_DIALOG_LOCALE";
pub(crate) const LOCALE_CHANGED_EVENT: &str = "desktop://locale-changed";
static CURRENT_LOCALE: RwLock<&'static str> = RwLock::new(FALLBACK_LOCALE);

struct LocaleCatalogSource {
    locale: &'static str,
    json: &'static str,
}

struct LocaleRegistry {
    declared: &'static [&'static str],
    fallback: &'static str,
    sources: &'static [LocaleCatalogSource],
    catalogs: OnceLock<HashMap<&'static str, HashMap<String, String>>>,
}

include!(concat!(env!("OUT_DIR"), "/desktop_locale_registry.rs"));

impl LocaleRegistry {
    fn available(&self) -> Vec<&'static str> {
        self.sources.iter().map(|source| source.locale).collect()
    }

    fn preference(&self, value: serde_json::Value) -> Option<LocalePreference> {
        let preference: LocalePreference = serde_json::from_value(value).ok()?;
        match &preference {
            LocalePreference::System => Some(preference),
            LocalePreference::Language(tag) if self.declared.contains(&tag.as_str()) => {
                Some(preference)
            }
            _ => None,
        }
    }

    fn lookup(&self, requested: &str) -> Option<&'static str> {
        if requested.len() > 128 {
            return None;
        }
        if let Some(source) = self
            .sources
            .iter()
            .find(|source| source.locale.eq_ignore_ascii_case(requested))
        {
            return Some(source.locale);
        }
        let mut candidate = requested.split(['.', '@']).next()?.replace('_', "-");
        if matches!(candidate.as_str(), "C" | "POSIX") {
            return Some(self.fallback);
        }
        loop {
            if let Some(source) = self
                .sources
                .iter()
                .find(|source| source.locale.eq_ignore_ascii_case(&candidate))
            {
                return Some(source.locale);
            }
            let (parent, _) = candidate.rsplit_once('-')?;
            candidate.truncate(parent.len());
            // RFC 4647 lookup also removes a trailing extension singleton.
            if candidate
                .rsplit('-')
                .next()
                .is_some_and(|part| part.len() == 1)
            {
                let (parent, _) = candidate.rsplit_once('-')?;
                candidate.truncate(parent.len());
            }
        }
    }

    fn resolve(&self, preference: &LocalePreference, requested: &[String]) -> &'static str {
        match preference {
            LocalePreference::Language(tag) => self.lookup(tag).unwrap_or(self.fallback),
            LocalePreference::System => requested
                .iter()
                .find_map(|tag| self.lookup(tag))
                .unwrap_or(self.fallback),
        }
    }

    fn text(&'static self, key: &str, locale: &str) -> Option<&'static str> {
        let locale = self.lookup(locale).unwrap_or(self.fallback);
        let catalogs = self.catalogs.get_or_init(|| {
            self.sources
                .iter()
                .map(|source| {
                    (
                        source.locale,
                        serde_json::from_str(source.json)
                            .expect("packaged desktop catalog must be valid"),
                    )
                })
                .collect()
        });
        catalogs
            .get(locale)
            .and_then(|catalog| catalog.get(key))
            .or_else(|| {
                catalogs
                    .get(self.fallback)
                    .and_then(|catalog| catalog.get(key))
            })
            .map(String::as_str)
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub(crate) enum LocalePreference {
    #[default]
    System,
    Language(String),
}

impl TryFrom<String> for LocalePreference {
    type Error = &'static str;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value == "system" {
            return Ok(Self::System);
        }
        if value.is_empty()
            || value.len() > 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err("invalid desktop locale preference");
        }
        Ok(Self::Language(value))
    }
}

impl From<LocalePreference> for String {
    fn from(value: LocalePreference) -> Self {
        match value {
            LocalePreference::System => "system".to_owned(),
            LocalePreference::Language(tag) => tag,
        }
    }
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
    registry: &'static LocaleRegistry,
}

impl DesktopLocaleOwner {
    pub(crate) fn open(config_dir: &Path) -> Self {
        Self::open_with_registry(config_dir, system_locales(), &DESKTOP_LOCALE_REGISTRY)
    }

    fn open_with_registry(
        config_dir: &Path,
        system_locales: Vec<String>,
        registry: &'static LocaleRegistry,
    ) -> Self {
        let path = config_dir.join(PREFERENCE_FILENAME);
        // A malformed/missing field is a per-field default, never a request to
        // replace the store. Reads intentionally leave even damaged data intact.
        let preference = read_preferences(&path)
            .ok()
            .and_then(|fields| fields.get(LANGUAGE_KEY).cloned())
            .and_then(|value| registry.preference(value))
            .unwrap_or_default();
        Self {
            path,
            preference,
            system_locales,
            registry,
        }
    }

    pub(crate) fn snapshot(&self) -> DesktopLocaleSnapshot {
        DesktopLocaleSnapshot {
            preference: self.preference.clone(),
            locale: self
                .registry
                .resolve(&self.preference, &self.system_locales),
            available_locales: self.registry.available(),
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
        if let LocalePreference::Language(tag) = &preference
            && !self
                .registry
                .sources
                .iter()
                .any(|source| source.locale == tag)
        {
            return Err("desktop locale is not available in this build".to_owned());
        }
        // Always reread to preserve fields written by a newer client or another
        // preference owner. Never replace unreadable/non-object preferences.
        let mut fields = read_preferences(&self.path)?;
        if fields
            .get(LANGUAGE_KEY)
            .is_some_and(|value| self.registry.preference(value.clone()).is_none())
        {
            return Err("desktop language preference is not supported by this build".to_owned());
        }
        if preference == LocalePreference::System {
            fields.remove(LANGUAGE_KEY);
        } else {
            fields.insert(
                LANGUAGE_KEY.to_owned(),
                serde_json::to_value(&preference).expect("locale preference serializes"),
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

pub(crate) fn activate(locale: &str) {
    let locale = DESKTOP_LOCALE_REGISTRY
        .lookup(locale)
        .unwrap_or(FALLBACK_LOCALE);
    *CURRENT_LOCALE
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = locale;
}

pub(crate) fn current_locale() -> &'static str {
    *CURRENT_LOCALE
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(crate) fn text(key: &str) -> &'static str {
    text_for_locale(key, current_locale())
}

pub(crate) fn text_for_locale(key: &str, locale: &str) -> &'static str {
    match DESKTOP_LOCALE_REGISTRY.text(key, locale) {
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
        return vec![FALLBACK_LOCALE.to_owned()];
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
#[path = "../locale_registry_build.rs"]
mod registry_build_tests;

#[cfg(test)]
mod tests {
    use super::*;

    static SYNTHETIC_PREVIEW: LocaleRegistry = LocaleRegistry {
        declared: &["en", "fr", "zh-Hant"],
        fallback: "en",
        sources: &[
            LocaleCatalogSource {
                locale: "en",
                json: r#"{"show":"Show", "fallback":"English fallback", "body":"{name} finished."}"#,
            },
            LocaleCatalogSource {
                locale: "fr",
                json: r#"{"show":"Afficher", "body":"{name} a terminé."}"#,
            },
            LocaleCatalogSource {
                locale: "zh-Hant",
                json: r#"{"show":"顯示"}"#,
            },
        ],
        catalogs: OnceLock::new(),
    };
    static SYNTHETIC_SHIPPING: LocaleRegistry = LocaleRegistry {
        declared: &["en", "fr", "zh-Hant"],
        fallback: "en",
        sources: &[LocaleCatalogSource {
            locale: "en",
            json: r#"{"show":"Show"}"#,
        }],
        catalogs: OnceLock::new(),
    };

    fn language(tag: &str) -> LocalePreference {
        LocalePreference::Language(tag.to_owned())
    }
    fn owner(directory: &Path, preview: bool, system: &[&str]) -> DesktopLocaleOwner {
        DesktopLocaleOwner::open_with_registry(
            directory,
            system.iter().map(|tag| (*tag).to_owned()).collect(),
            if preview {
                &SYNTHETIC_PREVIEW
            } else {
                &SYNTHETIC_SHIPPING
            },
        )
    }

    #[test]
    fn synthetic_french_negotiates_regions_script_parents_and_fallback() {
        let resolve = |tags: &[&str]| {
            SYNTHETIC_PREVIEW.resolve(
                &LocalePreference::System,
                &tags.iter().map(|tag| (*tag).to_owned()).collect::<Vec<_>>(),
            )
        };
        assert_eq!(resolve(&["es-ES", "fr-CA", "en-US"]), "fr");
        assert_eq!(resolve(&["FR_ca.UTF-8"]), "fr");
        assert_eq!(resolve(&["zh-Hant-TW"]), "zh-Hant");
        assert_eq!(resolve(&["zh-Hant-TW-u-nu-hanidec"]), "zh-Hant");
        assert_eq!(resolve(&["en-US", "fr-CA"]), "en");
        assert_eq!(resolve(&["C.UTF-8", "fr"]), "en");
        assert_eq!(resolve(&["not-a-locale"]), "en");
        assert_eq!(SYNTHETIC_SHIPPING.resolve(&language("fr"), &[]), "en");
    }

    #[test]
    fn synthetic_french_catalog_falls_back_per_message_and_formats_safely() {
        assert_eq!(SYNTHETIC_PREVIEW.text("show", "fr"), Some("Afficher"));
        assert_eq!(SYNTHETIC_PREVIEW.text("show", "fr-CA"), Some("Afficher"));
        assert_eq!(
            SYNTHETIC_PREVIEW.text("fallback", "fr"),
            Some("English fallback")
        );
        assert_eq!(SYNTHETIC_PREVIEW.text("show", "unknown"), Some("Show"));
        assert_eq!(
            format_template(
                SYNTHETIC_PREVIEW.text("body", "fr").unwrap(),
                &[("name", "{other}")]
            ),
            "{other} a terminé."
        );
    }

    #[test]
    fn reads_are_tolerant_and_never_rewrite_unknown_or_malformed_data() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(PREFERENCE_FILENAME);
        for original in [
            br#"{"language":"future-locale","future":{"kept":true}}"#.as_slice(),
            b"not json",
            b"[1,2,3]",
            br#"{"language":false}"#,
        ] {
            std::fs::write(&path, original).unwrap();
            let mut owner = owner(directory.path(), true, &["en"]);
            assert_eq!(owner.snapshot().preference, LocalePreference::System);
            assert!(owner.select(language("fr")).is_err());
            assert_eq!(std::fs::read(&path).unwrap(), original);
        }
    }

    #[test]
    fn synthetic_french_selection_survives_restart_and_preserves_fields() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(PREFERENCE_FILENAME);
        std::fs::write(&path, br#"{"future":{"keep":7}}"#).unwrap();
        let mut selected = owner(directory.path(), true, &["en"]);
        assert_eq!(selected.select(language("fr")).unwrap().locale, "fr");
        let mut reopened = owner(directory.path(), true, &["en"]);
        assert_eq!(reopened.snapshot().preference, language("fr"));
        assert_eq!(reopened.snapshot().locale, "fr");
        reopened.select(LocalePreference::System).unwrap();
        let fields = read_preferences(&path).unwrap();
        assert!(!fields.contains_key(LANGUAGE_KEY));
        assert_eq!(fields["future"]["keep"], 7);
        assert_eq!(
            owner(directory.path(), true, &["fr-CA"]).snapshot().locale,
            "fr"
        );
    }

    #[test]
    fn declared_but_unavailable_preference_survives_shipping_read_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(PREFERENCE_FILENAME);
        let original = br#"{"language":"fr","future":7}"#;
        std::fs::write(&path, original).unwrap();
        let mut shipping = owner(directory.path(), false, &["fr-CA"]);
        assert_eq!(shipping.snapshot().preference, language("fr"));
        assert_eq!(shipping.snapshot().locale, "en");
        assert_eq!(std::fs::read(&path).unwrap(), original);
        assert!(shipping.select(language("fr")).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        shipping.select(language("en")).unwrap();
        assert_eq!(read_preferences(&path).unwrap()["future"], 7);
    }

    #[test]
    fn unavailable_selection_and_oversized_store_do_not_write() {
        let directory = tempfile::tempdir().unwrap();
        let mut owner = owner(directory.path(), false, &[]);
        assert!(owner.select(language("fr")).is_err());
        assert!(owner.select(language("future")).is_err());
        assert!(!owner.path.exists());
        let data = vec![b' '; MAX_PREFERENCE_BYTES as usize + 1];
        std::fs::write(&owner.path, &data).unwrap();
        assert!(owner.select(language("en")).is_err());
        assert_eq!(std::fs::read(&owner.path).unwrap(), data);
    }

    #[test]
    fn nonregular_preferences_remain_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(PREFERENCE_FILENAME);
        std::fs::create_dir(&path).unwrap();
        let mut selected = owner(directory.path(), true, &[]);
        assert_eq!(selected.snapshot().preference, LocalePreference::System);
        assert!(selected.select(language("en")).is_err());
        assert!(path.is_dir());
        #[cfg(unix)]
        {
            std::fs::remove_dir(&path).unwrap();
            let target = directory.path().join("untouched.json");
            let original = br#"{"language":"fr","future":7}"#;
            std::fs::write(&target, original).unwrap();
            std::os::unix::fs::symlink(&target, &path).unwrap();
            let mut selected = owner(directory.path(), true, &[]);
            assert_eq!(selected.snapshot().preference, LocalePreference::System);
            assert!(selected.select(language("en")).is_err());
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
    fn persisted_english_german_and_system_wire_values_are_unchanged() {
        for value in ["en", "de", "system"] {
            let preference: LocalePreference =
                serde_json::from_value(serde_json::json!(value)).unwrap();
            assert_eq!(serde_json::to_value(preference).unwrap(), value);
        }
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(PREFERENCE_FILENAME);
        let original = br#"{"language":"de","future":true}"#;
        std::fs::write(&path, original).unwrap();
        let actual = DesktopLocaleOwner::open(directory.path());
        assert_eq!(actual.snapshot().preference, language("de"));
        assert_eq!(
            actual.snapshot().locale,
            if actual.snapshot().available_locales.contains(&"de") {
                "de"
            } else {
                FALLBACK_LOCALE
            }
        );
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }

    #[test]
    fn resolves_packaged_fallback_and_named_placeholders_without_reinterpreting_user_data() {
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
    fn generated_native_availability_matches_manifest_and_build_gates() {
        let manifest: serde_json::Value =
            serde_json::from_str(include_str!("../../../../localization/locales.json")).unwrap();
        let mut expected: Vec<&str> = manifest["supportedLocales"]["desktop"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap())
            .collect();
        assert_eq!(expected, SHIPPING_LOCALES);
        if cfg!(debug_assertions)
            && option_env!("VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES") == Some("1")
        {
            expected.extend(
                manifest["previewLocales"]["desktop"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|value| value.as_str().unwrap()),
            );
        }
        assert_eq!(DESKTOP_LOCALE_REGISTRY.available(), expected);
        let fallback = DESKTOP_LOCALE_REGISTRY
            .sources
            .iter()
            .find(|source| source.locale == FALLBACK_LOCALE)
            .unwrap();
        let keys: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(fallback.json).unwrap();
        for source in DESKTOP_LOCALE_REGISTRY.sources {
            let catalog: serde_json::Map<String, serde_json::Value> =
                serde_json::from_str(source.json).unwrap();
            assert_eq!(
                catalog.keys().collect::<Vec<_>>(),
                keys.keys().collect::<Vec<_>>()
            );
        }
    }
}
