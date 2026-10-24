#[cfg(any(target_os = "linux", all(test, unix)))]
mod unix {
    use std::fs;
    use std::os::unix::fs::{PermissionsExt, symlink};
    use std::path::{Component, Path, PathBuf};
    use std::process::{Command, Output};

    use crate::{APPLICATION_ID, SERVICE_NAME};

    const DESKTOP_TEMPLATE: &str =
        include_str!("../resources/com.jstorrent.rstorrent.crostini.desktop.in");
    const SERVICE_TEMPLATE: &str =
        include_str!("../resources/com.jstorrent.rstorrent.crostini.service.in");
    const MAX_WEB_FILES: usize = 4096;
    const MAX_WEB_BYTES: u64 = 128 * 1024 * 1024;

    #[derive(Clone, Debug)]
    struct InstallPaths {
        install_root: PathBuf,
        versions: PathBuf,
        current: PathBuf,
        command: PathBuf,
        desktop: PathBuf,
        service: PathBuf,
        icon: PathBuf,
        profile: PathBuf,
        ownership: PathBuf,
    }

    impl InstallPaths {
        #[cfg(target_os = "linux")]
        fn system() -> Result<Self, String> {
            let home = std::env::var_os("HOME")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .ok_or_else(|| "HOME is unavailable".to_owned())?;
            let data = std::env::var_os("XDG_DATA_HOME")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".local/share"));
            let config = std::env::var_os("XDG_CONFIG_HOME")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config"));
            Self::for_roots(&home, &data, &config)
        }

        fn for_roots(home: &Path, data: &Path, config: &Path) -> Result<Self, String> {
            for (path, label) in [(home, "home"), (data, "data"), (config, "config")] {
                if !path.is_absolute() || path == Path::new("/") {
                    return Err(format!("unsafe {label} directory {}", path.display()));
                }
                let value = path
                    .to_str()
                    .ok_or_else(|| format!("{label} directory is not valid UTF-8"))?;
                if value.contains(['\0', '\n', '\r']) {
                    return Err(format!("unsafe {label} directory {}", path.display()));
                }
            }
            let install_root = data.join("rstorrent-crostini");
            Ok(Self {
                versions: install_root.join("versions"),
                current: install_root.join("current"),
                command: home.join(".local/bin/rstorrent-crostini"),
                desktop: data
                    .join("applications")
                    .join(format!("{APPLICATION_ID}.desktop")),
                service: config.join("systemd/user").join(SERVICE_NAME),
                icon: data
                    .join("icons/hicolor/128x128/apps")
                    .join(format!("{APPLICATION_ID}.png")),
                profile: install_root.join("profile"),
                ownership: install_root.join("ownership-v1"),
                install_root,
            })
        }
    }

    #[cfg(target_os = "linux")]
    pub fn install_bundle(bundle: &Path) -> Result<(), String> {
        let paths = InstallPaths::system()?;
        install_bundle_at(bundle, &paths, true)
    }

    #[cfg(target_os = "linux")]
    pub fn uninstall(purge: bool) -> Result<(), String> {
        let paths = InstallPaths::system()?;
        uninstall_at(&paths, purge, true)
    }

    fn install_bundle_at(
        bundle: &Path,
        paths: &InstallPaths,
        operate_systemd: bool,
    ) -> Result<(), String> {
        validate_bundle(bundle)?;
        let version = env!("CARGO_PKG_VERSION");
        let version_target = PathBuf::from("versions").join(version);
        let version_directory = paths.install_root.join(&version_target);
        ensure_real_directory(&paths.install_root, "install root")?;
        ensure_real_directory(&paths.versions, "versions directory")?;
        if operate_systemd {
            stop_service_if_present()?;
        }

        let staging = paths
            .versions
            .join(format!(".{version}.tmp-{}", std::process::id()));
        if staging.exists() {
            ensure_owned_staging_path(&staging, &paths.versions)?;
            fs::remove_dir_all(&staging)
                .map_err(|error| format!("could not clear install staging: {error}"))?;
        }
        fs::create_dir(&staging)
            .map_err(|error| format!("could not create install staging: {error}"))?;
        copy_executable(
            &bundle.join("bin/rstorrent-crostini"),
            &staging.join("bin/rstorrent-crostini"),
        )?;
        copy_executable(
            &bundle.join("bin/rstorrent-gateway"),
            &staging.join("bin/rstorrent-gateway"),
        )?;
        copy_web_tree(&bundle.join("web"), &staging.join("web"))?;
        atomic_write(
            &staging.join("VERSION"),
            format!("{version}\n").as_bytes(),
            0o644,
        )?;
        if version_directory.exists() {
            ensure_version_directory(&version_directory, &paths.versions)?;
            fs::remove_dir_all(&version_directory)
                .map_err(|error| format!("could not replace installed version: {error}"))?;
        }
        fs::rename(&staging, &version_directory)
            .map_err(|error| format!("could not install version: {error}"))?;

        atomic_symlink(&version_target, &paths.current)?;
        atomic_symlink(
            &paths.current.join("bin/rstorrent-crostini"),
            &paths.command,
        )?;
        let quoted_binary = quote_exec_path(&paths.command)?;
        atomic_write(
            &paths.desktop,
            DESKTOP_TEMPLATE
                .replace("@RSTORRENT_CROSTINI_BINARY@", &quoted_binary)
                .as_bytes(),
            0o644,
        )?;
        atomic_write(
            &paths.service,
            SERVICE_TEMPLATE
                .replace("@RSTORRENT_CROSTINI_BINARY@", &quoted_binary)
                .as_bytes(),
            0o644,
        )?;
        copy_regular_file(&bundle.join("icons/rstorrent-128.png"), &paths.icon, 0o644)?;
        atomic_write(
            &paths.ownership,
            ownership_manifest(paths)?.as_bytes(),
            0o600,
        )?;

        if operate_systemd {
            reload_user_service_manager()?;
            refresh_desktop_caches(paths);
        }
        println!("Installed JSTorrent for ChromeOS Linux {version}.");
        println!("Open JSTorrent for ChromeOS Linux from the Chromebook Launcher.");
        Ok(())
    }

    fn uninstall_at(
        paths: &InstallPaths,
        purge: bool,
        operate_systemd: bool,
    ) -> Result<(), String> {
        verify_ownership(paths)?;
        if operate_systemd {
            stop_service_if_present()?;
        }
        for path in [
            &paths.desktop,
            &paths.service,
            &paths.icon,
            &paths.command,
            &paths.current,
            &paths.ownership,
        ] {
            remove_file_if_present(path)?;
        }
        if paths.versions.exists() {
            ensure_real_directory(&paths.versions, "versions directory")?;
            fs::remove_dir_all(&paths.versions)
                .map_err(|error| format!("could not remove installed versions: {error}"))?;
        }
        if purge && paths.profile.exists() {
            ensure_real_directory(&paths.profile, "profile directory")?;
            fs::remove_dir_all(&paths.profile)
                .map_err(|error| format!("could not purge profile: {error}"))?;
        }
        if paths.install_root.exists()
            && fs::read_dir(&paths.install_root)
                .map_err(|error| format!("could not inspect install root: {error}"))?
                .next()
                .is_none()
        {
            fs::remove_dir(&paths.install_root)
                .map_err(|error| format!("could not remove empty install root: {error}"))?;
        }
        if operate_systemd {
            reload_user_service_manager()?;
            refresh_desktop_caches(paths);
        }
        println!("Removed JSTorrent for ChromeOS Linux application files.");
        if purge {
            println!("The Crostini profile was also removed. Downloads were preserved.");
        } else {
            println!("The Crostini profile and downloads were preserved.");
        }
        Ok(())
    }

    fn validate_bundle(bundle: &Path) -> Result<(), String> {
        let metadata = fs::symlink_metadata(bundle)
            .map_err(|error| format!("could not inspect bundle {}: {error}", bundle.display()))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("bundle must be a real directory".to_owned());
        }
        for relative in [
            "bin/rstorrent-crostini",
            "bin/rstorrent-gateway",
            "web/index.html",
            "icons/rstorrent-128.png",
        ] {
            let path = bundle.join(relative);
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| format!("bundle is missing {relative}: {error}"))?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(format!("bundle file {relative} must be a regular file"));
            }
        }
        Ok(())
    }

    fn copy_web_tree(source: &Path, destination: &Path) -> Result<(), String> {
        let mut pending = vec![(source.to_owned(), destination.to_owned())];
        let mut files = 0usize;
        let mut bytes = 0u64;
        while let Some((source, destination)) = pending.pop() {
            let metadata = fs::symlink_metadata(&source)
                .map_err(|error| format!("could not inspect web asset: {error}"))?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(format!(
                    "web path {} is not a real directory",
                    source.display()
                ));
            }
            fs::create_dir_all(&destination)
                .map_err(|error| format!("could not create web directory: {error}"))?;
            for entry in fs::read_dir(&source)
                .map_err(|error| format!("could not list web assets: {error}"))?
            {
                let entry =
                    entry.map_err(|error| format!("could not inspect web asset: {error}"))?;
                let file_type = entry
                    .file_type()
                    .map_err(|error| format!("could not inspect web asset type: {error}"))?;
                let target = destination.join(entry.file_name());
                if file_type.is_dir() && !file_type.is_symlink() {
                    pending.push((entry.path(), target));
                } else if file_type.is_file() && !file_type.is_symlink() {
                    files = files.saturating_add(1);
                    bytes = bytes.saturating_add(
                        entry
                            .metadata()
                            .map_err(|error| format!("could not inspect web asset: {error}"))?
                            .len(),
                    );
                    if files > MAX_WEB_FILES || bytes > MAX_WEB_BYTES {
                        return Err("web bundle exceeds its file or byte limit".to_owned());
                    }
                    copy_regular_file(&entry.path(), &target, 0o644)?;
                } else {
                    return Err(format!("unsupported web asset {}", entry.path().display()));
                }
            }
        }
        Ok(())
    }

    fn copy_executable(source: &Path, destination: &Path) -> Result<(), String> {
        copy_regular_file(source, destination, 0o755)
    }

    fn copy_regular_file(source: &Path, destination: &Path, mode: u32) -> Result<(), String> {
        let metadata = fs::symlink_metadata(source)
            .map_err(|error| format!("could not inspect {}: {error}", source.display()))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(format!("{} is not a regular file", source.display()));
        }
        let bytes = fs::read(source)
            .map_err(|error| format!("could not read {}: {error}", source.display()))?;
        atomic_write(destination, &bytes, mode)
    }

    fn atomic_write(path: &Path, contents: &[u8], mode: u32) -> Result<(), String> {
        let parent = path
            .parent()
            .ok_or_else(|| format!("install path has no parent: {}", path.display()))?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
        let temporary = parent.join(format!(".rstorrent-write-{}.tmp", std::process::id()));
        fs::write(&temporary, contents)
            .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(mode))
            .map_err(|error| format!("could not secure {}: {error}", temporary.display()))?;
        fs::rename(&temporary, path)
            .map_err(|error| format!("could not install {}: {error}", path.display()))
    }

    fn atomic_symlink(target: &Path, destination: &Path) -> Result<(), String> {
        let parent = destination
            .parent()
            .ok_or_else(|| format!("link path has no parent: {}", destination.display()))?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
        let temporary = parent.join(format!(".rstorrent-link-{}.tmp", std::process::id()));
        remove_file_if_present(&temporary)?;
        symlink(target, &temporary)
            .map_err(|error| format!("could not create {}: {error}", temporary.display()))?;
        fs::rename(&temporary, destination)
            .map_err(|error| format!("could not install {}: {error}", destination.display()))
    }

    fn quote_exec_path(path: &Path) -> Result<String, String> {
        let value = path
            .to_str()
            .ok_or_else(|| "install command is not valid UTF-8".to_owned())?;
        if value.contains(['\0', '\n', '\r']) {
            return Err("install command contains control characters".to_owned());
        }
        Ok(format!(
            "\"{}\"",
            value.replace('\\', "\\\\").replace('"', "\\\"")
        ))
    }

    fn ownership_manifest(paths: &InstallPaths) -> Result<String, String> {
        let values = [
            ("install_root", &paths.install_root),
            ("command", &paths.command),
            ("desktop", &paths.desktop),
            ("service", &paths.service),
            ("icon", &paths.icon),
            ("profile_preserved", &paths.profile),
        ];
        let mut manifest = "rstorrent-crostini-ownership-v1\n".to_owned();
        for (name, path) in values {
            let value = path
                .to_str()
                .ok_or_else(|| format!("owned path {name} is not valid UTF-8"))?;
            if value.contains(['\0', '\n', '\r']) {
                return Err(format!("owned path {name} contains control characters"));
            }
            manifest.push_str(name);
            manifest.push('=');
            manifest.push_str(value);
            manifest.push('\n');
        }
        Ok(manifest)
    }

    fn verify_ownership(paths: &InstallPaths) -> Result<(), String> {
        let actual = fs::read_to_string(&paths.ownership).map_err(|error| {
            format!(
                "could not read ownership manifest {}: {error}",
                paths.ownership.display()
            )
        })?;
        if actual == ownership_manifest(paths)? {
            Ok(())
        } else {
            Err("ownership manifest does not match; refusing removal".to_owned())
        }
    }

    fn ensure_real_directory(path: &Path, label: &str) -> Result<(), String> {
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(()),
            Ok(_) => Err(format!(
                "{label} {} is not a real directory",
                path.display()
            )),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir_all(path)
                .map_err(|error| format!("could not create {label}: {error}")),
            Err(error) => Err(format!("could not inspect {label}: {error}")),
        }
    }

    fn ensure_owned_staging_path(path: &Path, versions: &Path) -> Result<(), String> {
        if path.parent() != Some(versions)
            || !path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with('.') && name.contains(".tmp-"))
        {
            return Err("unsafe install staging path".to_owned());
        }
        ensure_real_directory(path, "install staging")
    }

    fn ensure_version_directory(path: &Path, versions: &Path) -> Result<(), String> {
        if path.parent() != Some(versions)
            || path
                .components()
                .any(|component| matches!(component, Component::ParentDir))
        {
            return Err("unsafe installed version path".to_owned());
        }
        ensure_real_directory(path, "installed version")
    }

    fn remove_file_if_present(path: &Path) -> Result<(), String> {
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_file() || metadata.file_type().is_symlink() => {
                fs::remove_file(path)
                    .map_err(|error| format!("could not remove {}: {error}", path.display()))
            }
            Ok(_) => Err(format!("refusing to remove non-file {}", path.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("could not inspect {}: {error}", path.display())),
        }
    }

    fn stop_service_if_present() -> Result<(), String> {
        let output = Command::new("systemctl")
            .args(["--user", "stop", SERVICE_NAME])
            .output()
            .map_err(|error| format!("could not stop JSTorrent service: {error}"))?;
        if output.status.success() {
            return Ok(());
        }
        let detail = String::from_utf8_lossy(&output.stderr);
        if detail.contains("not loaded") || detail.contains("not found") {
            Ok(())
        } else {
            Err(format!(
                "could not stop JSTorrent service: {}",
                detail.trim()
            ))
        }
    }

    fn reload_user_service_manager() -> Result<(), String> {
        checked_command(
            Command::new("systemctl")
                .args(["--user", "daemon-reload"])
                .output(),
            "reload the user service manager",
        )
    }

    fn checked_command(result: std::io::Result<Output>, action: &str) -> Result<(), String> {
        let output = result.map_err(|error| format!("could not {action}: {error}"))?;
        if output.status.success() {
            return Ok(());
        }
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if detail.is_empty() {
            Err(format!("could not {action} (exit {})", output.status))
        } else {
            Err(format!("could not {action}: {detail}"))
        }
    }

    fn refresh_desktop_caches(paths: &InstallPaths) {
        if let Some(directory) = paths.desktop.parent() {
            let _ = Command::new("update-desktop-database")
                .arg(directory)
                .output();
        }
        if let Some(directory) = paths.icon.ancestors().nth(4) {
            let _ = Command::new("gtk-update-icon-cache")
                .args(["-f", "-t"])
                .arg(directory)
                .output();
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn fixture_bundle(root: &Path) -> PathBuf {
            let bundle = root.join("bundle");
            fs::create_dir_all(bundle.join("bin")).unwrap();
            fs::create_dir_all(bundle.join("web/assets")).unwrap();
            fs::create_dir_all(bundle.join("icons")).unwrap();
            fs::write(bundle.join("bin/rstorrent-crostini"), b"launcher").unwrap();
            fs::write(bundle.join("bin/rstorrent-gateway"), b"gateway").unwrap();
            fs::write(bundle.join("web/index.html"), b"index").unwrap();
            fs::write(bundle.join("web/assets/app.js"), b"app").unwrap();
            fs::write(bundle.join("icons/rstorrent-128.png"), b"png").unwrap();
            bundle
        }

        #[test]
        fn installs_idempotently_and_preserves_profile_on_normal_uninstall() {
            let temp = tempfile::tempdir().unwrap();
            let home = temp.path().join("home");
            let data = home.join(".local/share");
            let config = home.join(".config");
            fs::create_dir_all(&home).unwrap();
            let paths = InstallPaths::for_roots(&home, &data, &config).unwrap();
            let bundle = fixture_bundle(temp.path());

            install_bundle_at(&bundle, &paths, false).unwrap();
            install_bundle_at(&bundle, &paths, false).unwrap();
            assert_eq!(
                fs::read_link(&paths.current).unwrap(),
                Path::new("versions/0.1.0")
            );
            assert!(paths.command.is_symlink());
            assert!(paths.desktop.is_file());
            assert!(paths.service.is_file());
            assert!(paths.icon.is_file());
            assert!(paths.current.join("web/index.html").is_file());
            let service = fs::read_to_string(&paths.service).unwrap();
            assert!(service.contains("NoNewPrivileges=true"));
            assert!(!service.contains("[Install]"));
            let desktop = fs::read_to_string(&paths.desktop).unwrap();
            assert!(desktop.contains("Terminal=false"));
            assert!(desktop.contains("StartupWMClass=com.jstorrent.rstorrent.crostini"));

            fs::create_dir_all(&paths.profile).unwrap();
            fs::write(paths.profile.join("state"), b"preserved").unwrap();
            uninstall_at(&paths, false, false).unwrap();
            assert_eq!(fs::read(paths.profile.join("state")).unwrap(), b"preserved");
            assert!(!paths.command.exists());
            assert!(!paths.service.exists());
            assert!(!paths.desktop.exists());
        }

        #[test]
        fn purge_removes_only_the_recorded_profile_and_preserves_downloads() {
            let temp = tempfile::tempdir().unwrap();
            let home = temp.path().join("home");
            let data = home.join(".local/share");
            let config = home.join(".config");
            fs::create_dir_all(home.join("Downloads")).unwrap();
            fs::write(home.join("Downloads/keep"), b"payload").unwrap();
            let paths = InstallPaths::for_roots(&home, &data, &config).unwrap();
            let bundle = fixture_bundle(temp.path());
            install_bundle_at(&bundle, &paths, false).unwrap();
            fs::create_dir_all(&paths.profile).unwrap();
            fs::write(paths.profile.join("state"), b"profile").unwrap();

            uninstall_at(&paths, true, false).unwrap();
            assert!(!paths.profile.exists());
            assert_eq!(fs::read(home.join("Downloads/keep")).unwrap(), b"payload");
        }

        #[test]
        fn ownership_mismatch_and_bundle_symlinks_fail_closed() {
            let temp = tempfile::tempdir().unwrap();
            let home = temp.path().join("home");
            let data = home.join(".local/share");
            let config = home.join(".config");
            fs::create_dir_all(&home).unwrap();
            let paths = InstallPaths::for_roots(&home, &data, &config).unwrap();
            let bundle = fixture_bundle(temp.path());
            install_bundle_at(&bundle, &paths, false).unwrap();
            fs::write(&paths.ownership, b"tampered\n").unwrap();
            assert!(uninstall_at(&paths, false, false).is_err());
            assert!(paths.command.exists());

            let linked = temp.path().join("linked-bundle");
            symlink(&bundle, &linked).unwrap();
            assert!(validate_bundle(&linked).is_err());
        }

        #[test]
        fn templates_and_owned_paths_remain_exact() {
            assert!(DESKTOP_TEMPLATE.contains("Name=JSTorrent for ChromeOS Linux"));
            assert!(SERVICE_TEMPLATE.contains("Restart=on-failure"));
            assert!(!SERVICE_TEMPLATE.contains("systemctl --user enable"));
            let paths = InstallPaths::for_roots(
                Path::new("/home/test"),
                Path::new("/home/test/.local/share"),
                Path::new("/home/test/.config"),
            )
            .unwrap();
            let manifest = ownership_manifest(&paths).unwrap();
            assert!(
                manifest.contains(
                    "profile_preserved=/home/test/.local/share/rstorrent-crostini/profile"
                )
            );
            assert!(!manifest.contains("Downloads"));
        }
    }
}

#[cfg(target_os = "linux")]
pub use unix::{install_bundle, uninstall};

#[cfg(not(target_os = "linux"))]
pub fn install_bundle(_bundle: &std::path::Path) -> Result<(), String> {
    Err("the ChromeOS Linux installer runs only on Linux".to_owned())
}

#[cfg(not(target_os = "linux"))]
pub fn uninstall(_purge: bool) -> Result<(), String> {
    Err("the ChromeOS Linux uninstaller runs only on Linux".to_owned())
}
