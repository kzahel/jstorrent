use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicU8, Ordering};

use rstorrent_session::{DesktopShellPreferences, ProductStateOwner};
use serde::{Deserialize, Serialize};

/// The pre-Tactical-358 shell settings file. This version only imports it
/// once and never writes, rewrites or deletes it; the migration ledger
/// tracks its removal.
const LEGACY_SETTINGS_FILE_NAME: &str = "desktop-shell.json";
const MAX_LEGACY_SETTINGS_BYTES: u64 = 4 * 1024;

const SHUTDOWN_RUNNING: u8 = 0;
const SHUTDOWN_STOPPING: u8 = 1;
const SHUTDOWN_FINAL_EXIT: u8 = 2;
const SHUTDOWN_FAILED: u8 = 3;

/// Desktop shell switches, stored in the product database.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct DesktopShellSettings {
    pub(crate) run_in_background: bool,
    pub(crate) notifications: DesktopNotificationSettings,
    pub(crate) power: DesktopPowerSettings,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DesktopNotificationSettings {
    pub(crate) notify_download_complete: bool,
    pub(crate) notify_needs_attention: bool,
    pub(crate) notify_while_focused: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DesktopPowerSettings {
    pub(crate) prevent_sleep_during_active_downloads: bool,
}

impl Default for DesktopPowerSettings {
    fn default() -> Self {
        Self {
            prevent_sleep_during_active_downloads: true,
        }
    }
}

impl Default for DesktopNotificationSettings {
    fn default() -> Self {
        Self {
            notify_download_complete: true,
            notify_needs_attention: true,
            notify_while_focused: true,
        }
    }
}

impl DesktopShellSettings {
    pub(crate) fn defaults() -> Self {
        Self {
            run_in_background: true,
            ..Self::default()
        }
    }

    fn from_preferences(preferences: DesktopShellPreferences) -> Self {
        Self {
            run_in_background: preferences.run_in_background,
            notifications: DesktopNotificationSettings {
                notify_download_complete: preferences.notify_download_complete,
                notify_needs_attention: preferences.notify_needs_attention,
                notify_while_focused: preferences.notify_while_focused,
            },
            power: DesktopPowerSettings {
                prevent_sleep_during_active_downloads: preferences
                    .prevent_sleep_during_active_downloads,
            },
        }
    }

    fn preferences(self) -> DesktopShellPreferences {
        DesktopShellPreferences {
            run_in_background: self.run_in_background,
            notify_download_complete: self.notifications.notify_download_complete,
            notify_needs_attention: self.notifications.notify_needs_attention,
            notify_while_focused: self.notifications.notify_while_focused,
            prevent_sleep_during_active_downloads: self.power.prevent_sleep_during_active_downloads,
        }
    }
}

pub(crate) struct LoadedDesktopShellSettings {
    pub(crate) settings: DesktopShellSettings,
    /// The legacy file recorded that an older build already applied the quiet
    /// network defaults; the session catalog records it without reapplying.
    pub(crate) legacy_network_defaults_applied: bool,
    pub(crate) diagnostic: Option<String>,
}

/// Reads the shell switches from the product database. The first start of
/// this version imports them from the legacy file, if one is readable, and
/// otherwise stores defaults. Never writes the legacy file.
pub(crate) fn load_desktop_shell_settings(
    config_dir: &Path,
    product: &ProductStateOwner,
) -> Result<LoadedDesktopShellSettings, String> {
    let (legacy, diagnostic) = match read_legacy_shell_settings(config_dir) {
        Ok(legacy) => (legacy, None),
        Err(error) => (
            None,
            Some(format!("legacy desktop shell settings ignored: {error}")),
        ),
    };
    let legacy_network_defaults_applied = legacy
        .as_ref()
        .is_some_and(|legacy| legacy.network_defaults_applied);
    let stored = product
        .desktop_shell_preferences()
        .map_err(|error| format!("read desktop shell settings: {error}"))?;
    let settings = match stored {
        Some(preferences) => DesktopShellSettings::from_preferences(preferences),
        None => {
            let settings =
                legacy.map_or_else(DesktopShellSettings::defaults, |legacy| legacy.settings);
            write_settings(product, settings)?;
            settings
        }
    };
    Ok(LoadedDesktopShellSettings {
        settings,
        legacy_network_defaults_applied,
        diagnostic,
    })
}

pub(crate) fn persist_run_in_background(
    product: &ProductStateOwner,
    current: DesktopShellSettings,
    run_in_background: bool,
) -> Result<DesktopShellSettings, String> {
    let next = DesktopShellSettings {
        run_in_background,
        ..current
    };
    write_settings(product, next)?;
    Ok(next)
}

pub(crate) fn persist_notification_settings(
    product: &ProductStateOwner,
    current: DesktopShellSettings,
    notifications: DesktopNotificationSettings,
) -> Result<DesktopShellSettings, String> {
    let next = DesktopShellSettings {
        notifications,
        ..current
    };
    write_settings(product, next)?;
    Ok(next)
}

pub(crate) fn persist_power_settings(
    product: &ProductStateOwner,
    current: DesktopShellSettings,
    power: DesktopPowerSettings,
) -> Result<DesktopShellSettings, String> {
    let next = DesktopShellSettings { power, ..current };
    write_settings(product, next)?;
    Ok(next)
}

pub(crate) fn reset_desktop_shell_settings(
    product: &ProductStateOwner,
) -> Result<DesktopShellSettings, String> {
    let defaults = DesktopShellSettings::defaults();
    write_settings(product, defaults)?;
    Ok(defaults)
}

fn write_settings(
    product: &ProductStateOwner,
    settings: DesktopShellSettings,
) -> Result<(), String> {
    product
        .replace_desktop_shell_preferences(settings.preferences())
        .map_err(|error| format!("save desktop shell settings: {error}"))
}

struct LegacyShellSettings {
    settings: DesktopShellSettings,
    network_defaults_applied: bool,
}

/// Reads `desktop-shell.json` versions 3 and 4 read-only and tolerantly:
/// a missing or wrong-typed field takes its default, unknown fields are
/// ignored. `Ok(None)` when there is no file.
fn read_legacy_shell_settings(config_dir: &Path) -> Result<Option<LegacyShellSettings>, String> {
    let path = config_dir.join(LEGACY_SETTINGS_FILE_NAME);
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("could not be opened: {error}")),
    };
    let mut bytes = Vec::new();
    file.take(MAX_LEGACY_SETTINGS_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("could not be read: {error}"))?;
    if bytes.len() as u64 > MAX_LEGACY_SETTINGS_BYTES {
        return Err("exceeded the size limit".to_owned());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "was malformed".to_owned())?;
    let version = value.get("version").and_then(serde_json::Value::as_u64);
    if !matches!(version, Some(3 | 4)) {
        return Err(format!("used unsupported version {version:?}"));
    }
    let defaults = DesktopShellSettings::defaults();
    let flag = |object: Option<&serde_json::Value>, key: &str, default: bool| {
        object
            .and_then(|object| object.get(key))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(default)
    };
    let notifications = value.get("notifications");
    let power = value.get("power");
    Ok(Some(LegacyShellSettings {
        settings: DesktopShellSettings {
            run_in_background: flag(
                Some(&value),
                "run_in_background",
                defaults.run_in_background,
            ),
            notifications: DesktopNotificationSettings {
                notify_download_complete: flag(
                    notifications,
                    "notify_download_complete",
                    defaults.notifications.notify_download_complete,
                ),
                notify_needs_attention: flag(
                    notifications,
                    "notify_needs_attention",
                    defaults.notifications.notify_needs_attention,
                ),
                notify_while_focused: flag(
                    notifications,
                    "notify_while_focused",
                    defaults.notifications.notify_while_focused,
                ),
            },
            power: DesktopPowerSettings {
                prevent_sleep_during_active_downloads: flag(
                    power,
                    "prevent_sleep_during_active_downloads",
                    defaults.power.prevent_sleep_during_active_downloads,
                ),
            },
        },
        network_defaults_applied: value
            .get("network_defaults_version")
            .and_then(serde_json::Value::as_u64)
            .is_some_and(|marker| marker >= 1),
    }))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ShutdownPhase {
    Running,
    Stopping,
    FinalExit,
    Failed,
}

pub(crate) struct ShutdownGate {
    phase: AtomicU8,
}

impl ShutdownGate {
    pub(crate) const fn new() -> Self {
        Self {
            phase: AtomicU8::new(SHUTDOWN_RUNNING),
        }
    }

    pub(crate) fn phase(&self) -> ShutdownPhase {
        match self.phase.load(Ordering::Acquire) {
            SHUTDOWN_RUNNING => ShutdownPhase::Running,
            SHUTDOWN_STOPPING => ShutdownPhase::Stopping,
            SHUTDOWN_FINAL_EXIT => ShutdownPhase::FinalExit,
            SHUTDOWN_FAILED => ShutdownPhase::Failed,
            _ => unreachable!("shutdown state is internal"),
        }
    }

    pub(crate) fn try_start(&self) -> bool {
        self.phase
            .compare_exchange(
                SHUTDOWN_RUNNING,
                SHUTDOWN_STOPPING,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    pub(crate) fn complete(&self) {
        self.phase.store(SHUTDOWN_FINAL_EXIT, Ordering::Release);
    }

    pub(crate) fn fail(&self) {
        self.phase.store(SHUTDOWN_FAILED, Ordering::Release);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CloseAction {
    Allow,
    Hide,
    StartShutdown,
    Prevent,
}

pub(crate) fn close_action(shutdown_phase: ShutdownPhase, run_in_background: bool) -> CloseAction {
    match shutdown_phase {
        ShutdownPhase::FinalExit => CloseAction::Allow,
        ShutdownPhase::Running if run_in_background => CloseAction::Hide,
        ShutdownPhase::Running => CloseAction::StartShutdown,
        ShutdownPhase::Stopping | ShutdownPhase::Failed => CloseAction::Prevent,
    }
}

#[cfg(test)]
mod tests {
    use rstorrent_session::ProductStateOwner;

    use super::{
        CloseAction, DesktopNotificationSettings, DesktopPowerSettings, DesktopShellSettings,
        LEGACY_SETTINGS_FILE_NAME, ShutdownGate, ShutdownPhase, close_action,
        load_desktop_shell_settings, persist_notification_settings, persist_power_settings,
        persist_run_in_background, reset_desktop_shell_settings,
    };

    fn product() -> ProductStateOwner {
        ProductStateOwner::open_ephemeral("1.0.0").expect("product state")
    }

    fn legacy(directory: &std::path::Path, contents: &str) -> Vec<u8> {
        let path = directory.join(LEGACY_SETTINGS_FILE_NAME);
        std::fs::write(&path, contents).expect("legacy file");
        std::fs::read(path).expect("legacy bytes")
    }

    #[test]
    fn fresh_install_stores_defaults_without_a_legacy_file() {
        let directory = tempfile::tempdir().unwrap();
        let product = product();
        let loaded = load_desktop_shell_settings(directory.path(), &product).unwrap();
        assert_eq!(loaded.settings, DesktopShellSettings::defaults());
        assert!(loaded.settings.run_in_background);
        assert!(!loaded.legacy_network_defaults_applied);
        assert!(loaded.diagnostic.is_none());
        assert!(product.desktop_shell_preferences().unwrap().is_some());
        assert!(!directory.path().join(LEGACY_SETTINGS_FILE_NAME).exists());
    }

    #[test]
    fn released_version_three_file_is_imported_once_and_left_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        legacy(
            directory.path(),
            r#"{"version":3,"run_in_background":false,
               "notifications":{"notify_download_complete":false,
                 "notify_needs_attention":true,"notify_while_focused":false},
               "power":{"prevent_sleep_during_active_downloads":false}}"#,
        );
        let product = product();
        let loaded = load_desktop_shell_settings(directory.path(), &product).unwrap();
        let expected = DesktopShellSettings {
            run_in_background: false,
            notifications: DesktopNotificationSettings {
                notify_download_complete: false,
                notify_needs_attention: true,
                notify_while_focused: false,
            },
            power: DesktopPowerSettings {
                prevent_sleep_during_active_downloads: false,
            },
        };
        assert_eq!(loaded.settings, expected);
        assert!(!loaded.legacy_network_defaults_applied);
        // The database now owns the switches; a later file change is ignored.
        persist_run_in_background(&product, expected, true).unwrap();
        legacy(
            directory.path(),
            r#"{"version":3,"run_in_background":false}"#,
        );
        let reloaded = load_desktop_shell_settings(directory.path(), &product).unwrap();
        assert!(reloaded.settings.run_in_background);
    }

    #[test]
    fn version_four_marker_and_tolerant_fields_are_imported() {
        let directory = tempfile::tempdir().unwrap();
        legacy(
            directory.path(),
            r#"{"version":4,"run_in_background":"yes","future":1,
               "notifications":{"notify_while_focused":false},
               "network_defaults_version":1}"#,
        );
        let loaded = load_desktop_shell_settings(directory.path(), &product()).unwrap();
        assert!(loaded.legacy_network_defaults_applied);
        assert!(
            loaded.settings.run_in_background,
            "wrong type takes the default"
        );
        assert!(!loaded.settings.notifications.notify_while_focused);
        assert!(loaded.settings.notifications.notify_download_complete);
    }

    #[test]
    fn unreadable_or_unknown_files_use_defaults_and_are_never_rewritten() {
        for contents in [
            "not json",
            r#"{"version":9}"#,
            r#"{"run_in_background":false}"#,
        ] {
            let directory = tempfile::tempdir().unwrap();
            let bytes = legacy(directory.path(), contents);
            let loaded = load_desktop_shell_settings(directory.path(), &product()).unwrap();
            assert_eq!(
                loaded.settings,
                DesktopShellSettings::defaults(),
                "{contents}"
            );
            assert!(loaded.diagnostic.is_some(), "{contents}");
            assert_eq!(
                std::fs::read(directory.path().join(LEGACY_SETTINGS_FILE_NAME)).unwrap(),
                bytes,
                "{contents}"
            );
        }
    }

    #[test]
    fn switches_persist_and_reset_through_the_product_database() {
        let directory = tempfile::tempdir().unwrap();
        let product = product();
        let current = load_desktop_shell_settings(directory.path(), &product)
            .unwrap()
            .settings;
        let notifications = DesktopNotificationSettings {
            notify_download_complete: false,
            notify_needs_attention: false,
            notify_while_focused: true,
        };
        let current = persist_notification_settings(&product, current, notifications).unwrap();
        let power = DesktopPowerSettings {
            prevent_sleep_during_active_downloads: false,
        };
        let current = persist_power_settings(&product, current, power).unwrap();
        let current = persist_run_in_background(&product, current, false).unwrap();
        assert_eq!(
            load_desktop_shell_settings(directory.path(), &product)
                .unwrap()
                .settings,
            current
        );
        assert_eq!(
            reset_desktop_shell_settings(&product).unwrap(),
            DesktopShellSettings::defaults()
        );
        assert_eq!(
            load_desktop_shell_settings(directory.path(), &product)
                .unwrap()
                .settings,
            DesktopShellSettings::defaults()
        );
    }

    #[test]
    fn close_policy_and_shutdown_admission_are_closed() {
        assert_eq!(
            close_action(ShutdownPhase::Running, true),
            CloseAction::Hide
        );
        assert_eq!(
            close_action(ShutdownPhase::Running, false),
            CloseAction::StartShutdown
        );
        assert_eq!(
            close_action(ShutdownPhase::Stopping, true),
            CloseAction::Prevent
        );
        assert_eq!(
            close_action(ShutdownPhase::Failed, false),
            CloseAction::Prevent
        );
        assert_eq!(
            close_action(ShutdownPhase::FinalExit, true),
            CloseAction::Allow
        );

        let gate = ShutdownGate::new();
        assert!(gate.try_start());
        assert!(!gate.try_start());
        assert_eq!(gate.phase(), ShutdownPhase::Stopping);
        gate.complete();
        assert_eq!(gate.phase(), ShutdownPhase::FinalExit);
        assert!(!gate.try_start());

        let failed = ShutdownGate::new();
        assert!(failed.try_start());
        failed.fail();
        assert_eq!(failed.phase(), ShutdownPhase::Failed);
        assert!(!failed.try_start());
    }
}
