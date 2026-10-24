//! Download policy is independent of file priority and content verification.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub(crate) const MAX_CUSTOM_EXTENSIONS: usize = 128;
pub(crate) const MAX_EXTENSION_BYTES: usize = 32;
const RECOMMENDED: &[&str] = &[
    ".exe",
    ".com",
    ".scr",
    ".msi",
    ".msix",
    ".bat",
    ".cmd",
    ".ps1",
    ".vbs",
    ".js",
    ".jse",
    ".wsf",
    ".hta",
    ".lnk",
    ".url",
    ".dmg",
    ".pkg",
    ".app",
    ".command",
    ".sh",
    ".apk",
    ".appimage",
    ".deb",
    ".rpm",
    ".jar",
    ".desktop",
];
const ARCHIVES: &[&str] = &[".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".tgz"];

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum FileSafetyPreset {
    #[default]
    Recommended,
    Archives,
    Custom,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[serde(deny_unknown_fields)]
pub struct FileSafetySettings {
    pub enabled: bool,
    pub preset: FileSafetyPreset,
    #[schemars(length(max = 128))]
    pub custom_extensions: Vec<String>,
    pub mark_internet_origin: bool,
}

impl Default for FileSafetySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            preset: FileSafetyPreset::Recommended,
            custom_extensions: Vec::new(),
            mark_internet_origin: true,
        }
    }
}

impl FileSafetySettings {
    pub(crate) fn validate(&self) -> Result<(), &'static str> {
        if self.custom_extensions.len() > MAX_CUSTOM_EXTENSIONS {
            return Err("at most 128 custom extensions are allowed");
        }
        for extension in &self.custom_extensions {
            if extension.len() < 2
                || extension.len() > MAX_EXTENSION_BYTES
                || !extension.starts_with('.')
                || extension.ends_with('.')
                || !extension[1..]
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.')
                || extension.contains("..")
            {
                return Err(
                    "extensions must start with a dot and contain 1–31 ASCII letters, digits or dots",
                );
            }
        }
        Ok(())
    }

    pub(crate) fn policy(&self) -> FileSafetyPolicy {
        let mut extensions: Vec<String> = if !self.enabled {
            Vec::new()
        } else {
            match self.preset {
                FileSafetyPreset::Recommended => {
                    RECOMMENDED.iter().map(|s| (*s).to_owned()).collect()
                }
                FileSafetyPreset::Archives => RECOMMENDED
                    .iter()
                    .chain(ARCHIVES)
                    .map(|s| (*s).to_owned())
                    .collect(),
                FileSafetyPreset::Custom => self
                    .custom_extensions
                    .iter()
                    .map(|s| s.to_ascii_lowercase())
                    .collect(),
            }
        };
        extensions.sort();
        extensions.dedup();
        // Prefer the most specific suffix in explanations (.tar.gz over .gz).
        extensions.sort_by_key(|s| std::cmp::Reverse(s.len()));
        FileSafetyPolicy {
            version: 1,
            preset: self.preset,
            extensions,
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct FileSafetyPolicy {
    pub version: u16,
    pub preset: FileSafetyPreset,
    pub extensions: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct FileSafetySummary {
    pub blocked_file_count: u32,
    pub blocked_file_bytes: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct FileSafetyView {
    pub matched_extension: String,
    pub preset: FileSafetyPreset,
    pub overridden: bool,
    pub blocked: bool,
}

impl FileSafetyPolicy {
    pub(crate) fn match_file(&self, root: Option<&str>, path: &[String]) -> Option<String> {
        self.match_path(path).or_else(|| {
            (self.extensions.iter().any(|extension| extension == ".app")
                && root.is_some_and(|name| {
                    name.get(name.len().saturating_sub(4)..)
                        .is_some_and(|suffix| suffix.eq_ignore_ascii_case(".app"))
                }))
            .then(|| ".app".into())
        })
    }

    pub(crate) fn match_path(&self, path: &[String]) -> Option<String> {
        let filename = path.last()?.to_ascii_lowercase();
        self.extensions
            .iter()
            .find(|extension| {
                filename.ends_with(extension.as_str())
                    || extension.as_str() == ".app"
                        && path
                            .iter()
                            .any(|component| component.to_ascii_lowercase().ends_with(".app"))
            })
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn presets_compound_extensions_and_bundles() {
        let mut settings = FileSafetySettings::default();
        let policy = settings.policy();
        for name in ["movie.mkv.EXE", "installer.dmg", "script.ps1"] {
            assert!(policy.match_path(&[name.into()]).is_some());
        }
        assert_eq!(
            policy.match_path(&[
                "Player.APP".into(),
                "Contents".into(),
                "MacOS".into(),
                "Player".into()
            ]),
            Some(".app".into())
        );
        assert_eq!(
            policy.match_file(Some("Player.APP"), &["Contents".into(), "binary".into()]),
            Some(".app".into())
        );
        for name in ["movie.exe.mkv", "roms.zip", "linux.iso"] {
            assert!(policy.match_path(&[name.into()]).is_none());
        }
        settings.preset = FileSafetyPreset::Custom;
        settings.custom_extensions = vec![".TAR.GZ".into(), ".gz".into()];
        assert!(settings.validate().is_ok());
        assert_eq!(
            settings.policy().match_path(&["data.tar.gz".into()]),
            Some(".tar.gz".into())
        );
        for bad in ["exe", ".", ".*", ".a/b", ".a..b", ".é", ".exe "] {
            settings.custom_extensions = vec![bad.into()];
            assert!(settings.validate().is_err(), "{bad}");
        }
        settings.enabled = false;
        assert!(settings.policy().extensions.is_empty());
    }
}
