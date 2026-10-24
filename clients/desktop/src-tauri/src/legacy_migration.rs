//! Production-identity startup seam. Incubation never reads personal legacy state.
use std::path::Path;

use rstorrent_session::{LegacyDesktopImportReport, SessionStore};

pub fn ensure_legacy_quiet() -> Result<(), String> {
    match rstorrent_native_host::legacy::old_process_is_running() {
        Ok(false) => Ok(()),
        Ok(true) => Err("Close JSTorrent desktop and legacy extension pages, then reopen the updated desktop app. Your legacy data has been preserved.".to_owned()),
        Err(_) => Err("Could not verify that legacy JSTorrent has stopped. Your legacy data has been preserved; close legacy clients and retry.".to_owned()),
    }
}

pub fn migrate_before_startup(
    identifier: &str,
    os_config: &Path,
    app_data: &Path,
) -> Result<Option<LegacyDesktopImportReport>, String> {
    if identifier != "com.jstorrent.desktop" {
        return Ok(None);
    }
    SessionStore::migrate_legacy_desktop(
        &app_data.join("profile"),
        "default",
        &os_config.join("jstorrent-native"),
    )
    .map_err(|error| {
        format!("Could not migrate JSTorrent data: {error}. Your legacy data has been preserved.")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incubation_never_reads_or_creates_legacy_state() {
        let owned = tempfile::tempdir().unwrap();
        let absent = owned.path().join("absent");
        assert_eq!(
            migrate_before_startup("com.jstorrent.rstorrent", &absent, &absent).unwrap(),
            None
        );
        assert!(!absent.exists());
    }

    #[test]
    fn production_fresh_install_without_legacy_state_creates_nothing() {
        let owned = tempfile::tempdir().unwrap();
        let absent = owned.path().join("absent");
        assert_eq!(
            migrate_before_startup("com.jstorrent.desktop", owned.path(), &absent).unwrap(),
            None
        );
        assert!(!absent.exists());
    }

    #[test]
    fn production_invalid_source_returns_actionable_preservation_error() {
        let owned = tempfile::tempdir().unwrap();
        let source = owned.path().join("jstorrent-native");
        std::fs::create_dir(&source).unwrap();
        std::fs::write(source.join("rpc-info.json"), "{").unwrap();
        let error = migrate_before_startup(
            "com.jstorrent.desktop",
            owned.path(),
            &owned.path().join("app"),
        )
        .unwrap_err();
        assert!(error.contains("legacy data has been preserved"));
        assert!(!owned.path().join("app").exists());
    }
}
