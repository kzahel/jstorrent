use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rstorrent_native_host::legacy;
use rstorrent_native_host::{HOST_NAME, LAUNCH_CONFIG_FILENAME, LaunchConfig, MAX_FRAME_BYTES};
use serde::Serialize;
use sha2::{Digest, Sha256};

const PRODUCTION_EXTENSION_ORIGIN: &str = "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk/";
const BETA_EXTENSION_ORIGIN: &str = "chrome-extension://gcgoepclopkgijmclmlheafaglmbjlcc/";
const HOST_DESCRIPTION: &str = "JSTorrent desktop bootstrap";
const HOST_MANIFEST_FILENAME: &str = "com.jstorrent.rstorrent.native.json";
const HOST_DIRECTORY: &str = "native-host";
const MAX_HOST_BINARY_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Platform {
    MacOS,
    Linux,
    Windows,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RegistrationReport {
    pub stable_host: PathBuf,
    pub browser_manifests: usize,
}

#[derive(Debug, Serialize)]
struct NativeHostManifest<'a> {
    name: &'static str,
    description: &'static str,
    path: &'a Path,
    #[serde(rename = "type")]
    transport: &'static str,
    allowed_origins: &'a [&'static str],
}

pub fn repair_native_host_registration(
    app_config_dir: &Path,
    home_dir: &Path,
    appimage: Option<&Path>,
) -> Result<RegistrationReport, String> {
    let desktop_executable =
        std::env::current_exe().map_err(|error| format!("resolve desktop executable: {error}"))?;
    let bundled_host = desktop_executable
        .parent()
        .ok_or_else(|| "desktop executable has no parent directory".to_owned())?
        .join(host_executable_filename());
    let desktop_launch_target = appimage.unwrap_or(&desktop_executable);
    install_for_platform(
        runtime_platform(),
        app_config_dir,
        home_dir,
        desktop_launch_target,
        &bundled_host,
    )
}

fn install_for_platform(
    platform: Platform,
    app_config_dir: &Path,
    home_dir: &Path,
    desktop_executable: &Path,
    bundled_host: &Path,
) -> Result<RegistrationReport, String> {
    if !desktop_executable.is_absolute() || !bundled_host.is_absolute() {
        return Err("desktop and native host paths must be absolute".to_owned());
    }
    let stable_directory = app_config_dir.join(HOST_DIRECTORY);
    fs::create_dir_all(&stable_directory)
        .map_err(|error| format!("create native host directory: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let metadata = fs::symlink_metadata(&stable_directory).map_err(|e| e.to_string())?;
        if !metadata.is_dir() || metadata.uid() != rustix::process::getuid().as_raw() {
            return Err("native host directory is not owned by the current user".to_owned());
        }
        fs::set_permissions(&stable_directory, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let stable_host = install_versioned_host(bundled_host, &stable_directory)?;

    let launch_config = launch_config(platform, desktop_executable)?;
    let launch_bytes = serde_json::to_vec_pretty(&launch_config)
        .map_err(|error| format!("encode native host launch config: {error}"))?;
    atomic_write(
        &stable_directory.join(LAUNCH_CONFIG_FILENAME),
        &launch_bytes,
    )?;

    let manifest_bytes = manifest_bytes(&stable_host)?;
    let stable_manifest = stable_directory.join(HOST_MANIFEST_FILENAME);
    atomic_write(&stable_manifest, &manifest_bytes)?;

    let browser_manifests = match platform {
        Platform::MacOS | Platform::Linux => {
            install_browser_manifests(platform, home_dir, &manifest_bytes)?
        }
        Platform::Windows => {
            register_windows_manifest(&stable_manifest)?;
            1
        }
    };
    remove_stale_hosts(&stable_directory, &stable_host);

    Ok(RegistrationReport {
        stable_host,
        browser_manifests,
    })
}

fn host_executable_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "rstorrent-native-host.exe"
    } else {
        "rstorrent-native-host"
    }
}

fn runtime_platform() -> Platform {
    if cfg!(target_os = "macos") {
        Platform::MacOS
    } else if cfg!(target_os = "windows") {
        Platform::Windows
    } else {
        Platform::Linux
    }
}

fn manifest_bytes(host_path: &Path) -> Result<Vec<u8>, String> {
    named_manifest_bytes(
        HOST_NAME,
        host_path,
        &[PRODUCTION_EXTENSION_ORIGIN, BETA_EXTENSION_ORIGIN],
    )
}

fn named_manifest_bytes(
    name: &'static str,
    host_path: &Path,
    origins: &[&'static str],
) -> Result<Vec<u8>, String> {
    if !host_path.is_absolute() {
        return Err("native host manifest path must be absolute".to_owned());
    }
    let manifest = NativeHostManifest {
        name,
        description: HOST_DESCRIPTION,
        path: host_path,
        transport: "stdio",
        allowed_origins: origins,
    };
    let bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("encode native host manifest: {error}"))?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err("native host manifest exceeds 64 KiB".to_owned());
    }
    Ok(bytes)
}

fn launch_config(platform: Platform, desktop_executable: &Path) -> Result<LaunchConfig, String> {
    if platform != Platform::MacOS {
        return Ok(LaunchConfig::executable(desktop_executable.to_owned()));
    }
    let application = desktop_executable
        .ancestors()
        .find(|candidate| {
            candidate
                .extension()
                .is_some_and(|extension| extension == "app")
        })
        .ok_or_else(|| {
            "packaged macOS desktop executable is not inside an app bundle".to_owned()
        })?;
    Ok(LaunchConfig::mac_app(application.to_owned()))
}

fn install_versioned_host(source: &Path, directory: &Path) -> Result<PathBuf, String> {
    install_named_host(source, directory, "rstorrent-native-host-v")
}

fn install_named_host(source: &Path, directory: &Path, prefix: &str) -> Result<PathBuf, String> {
    let metadata = fs::metadata(source)
        .map_err(|error| format!("read packaged native host metadata: {error}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_HOST_BINARY_BYTES {
        return Err(
            "packaged native host must be a nonempty file no larger than 32 MiB".to_owned(),
        );
    }
    let digest = sha256_file(source)?;
    let suffix = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    let destination = directory.join(format!(
        "{prefix}{}-{}{suffix}",
        env!("CARGO_PKG_VERSION"),
        &digest[..16]
    ));
    if destination.is_file() {
        return Ok(destination);
    }

    let mut input = File::open(source)
        .map_err(|error| format!("open packaged native host for copy: {error}"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)
        .map_err(|error| format!("create temporary native host: {error}"))?;
    std::io::copy(&mut input, &mut temporary)
        .map_err(|error| format!("copy native host: {error}"))?;
    temporary
        .as_file()
        .set_permissions(metadata.permissions())
        .map_err(|error| format!("set native host permissions: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("sync native host: {error}"))?;
    match temporary.persist_noclobber(&destination) {
        Ok(_) => Ok(destination),
        Err(_error) if destination.is_file() => Ok(destination),
        Err(error) => Err(format!("install native host: {}", error.error)),
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("open native host: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("hash native host: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "native host file has no parent directory".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create native host manifest directory: {error}"))?;
    if fs::read(path).ok().as_deref() == Some(bytes) {
        return Ok(());
    }
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("create temporary native host file: {error}"))?;
    temporary
        .write_all(bytes)
        .map_err(|error| format!("write temporary native host file: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("sync temporary native host file: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("replace native host file atomically: {}", error.error))?;
    Ok(())
}

fn install_browser_manifests(
    platform: Platform,
    home_dir: &Path,
    manifest: &[u8],
) -> Result<usize, String> {
    let mut installed = 0;
    for profile_root in browser_profile_roots(platform, home_dir) {
        if !profile_root.is_dir() {
            continue;
        }
        atomic_write(
            &profile_root
                .join("NativeMessagingHosts")
                .join(HOST_MANIFEST_FILENAME),
            manifest,
        )?;
        installed += 1;
    }
    Ok(installed)
}

fn browser_profile_roots(platform: Platform, home_dir: &Path) -> Vec<PathBuf> {
    match platform {
        Platform::MacOS => {
            let application_support = home_dir.join("Library/Application Support");
            vec![
                application_support.join("Google/Chrome"),
                application_support.join("Google/Chrome for Testing"),
                application_support.join("Chromium"),
            ]
        }
        Platform::Linux => {
            let config = home_dir.join(".config");
            vec![
                config.join("google-chrome"),
                config.join("google-chrome-for-testing"),
                config.join("chromium"),
            ]
        }
        Platform::Windows => Vec::new(),
    }
}

fn remove_stale_hosts(directory: &Path, current: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == current {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.starts_with("rstorrent-native-host-v")
            && entry.file_type().is_ok_and(|kind| kind.is_file())
        {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(target_os = "windows")]
fn register_windows_manifest(manifest: &Path) -> Result<(), String> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    for key_path in [
        format!(r"Software\Google\Chrome\NativeMessagingHosts\{HOST_NAME}"),
        format!(r"Software\Chromium\NativeMessagingHosts\{HOST_NAME}"),
    ] {
        let (key, _) = current_user
            .create_subkey(&key_path)
            .map_err(|error| format!("create native host registry key: {error}"))?;
        key.set_value("", &manifest.as_os_str())
            .map_err(|error| format!("set native host registry manifest: {error}"))?;
    }
    Ok(())
}

/// Installed before migration; only the production replacement owns old routes.
pub fn install_legacy_refusal(
    identifier: &str,
    app_config_dir: &Path,
    home_dir: &Path,
    stable_host: &Path,
) -> Result<Option<RegistrationReport>, String> {
    if identifier != legacy::PRODUCTION_IDENTIFIER {
        return Ok(None);
    }
    install_legacy_for_platform(runtime_platform(), app_config_dir, home_dir, stable_host).map(Some)
}

fn install_legacy_for_platform(
    platform: Platform,
    app_config_dir: &Path,
    home_dir: &Path,
    source: &Path,
) -> Result<RegistrationReport, String> {
    let directory = app_config_dir.join(HOST_DIRECTORY);
    let refusal = install_named_host(source, &directory, legacy::REFUSAL_PREFIX)?;
    let bytes = named_manifest_bytes(
        legacy::HOST_NAME,
        &refusal,
        &[legacy::PRODUCTION_ORIGIN, legacy::PACKAGED_EXTENSION_ORIGIN],
    )?;
    let filename = "com.jstorrent.native.json";
    let manifest = directory.join(filename);
    atomic_write(&manifest, &bytes)?;
    let mut count = 0;
    if platform == Platform::Windows {
        register_legacy_windows_manifest(&manifest)?;
        count = 1;
    } else {
        for root in legacy_browser_roots(platform, home_dir) {
            if root.is_dir() {
                atomic_write(&root.join("NativeMessagingHosts").join(filename), &bytes)?;
                count += 1;
            }
        }
    }
    if platform == Platform::Linux {
        retire_appimage_copy(home_dir, &refusal)?;
    }
    Ok(RegistrationReport {
        stable_host: refusal,
        browser_manifests: count,
    })
}

fn legacy_browser_roots(platform: Platform, home: &Path) -> Vec<PathBuf> {
    let mut roots = browser_profile_roots(platform, home);
    let (base, additional): (PathBuf, &[&str]) = match platform {
        Platform::MacOS => (
            home.join("Library/Application Support"),
            &[
                "Google/Chrome Canary",
                "Google/ChromeForTesting",
                "BraveSoftware/Brave-Browser",
                "Microsoft Edge",
                "Vivaldi",
                "Arc/User Data",
            ],
        ),
        Platform::Linux => (
            home.join(".config"),
            &["BraveSoftware/Brave-Browser", "microsoft-edge"],
        ),
        Platform::Windows => return roots,
    };
    roots.extend(additional.iter().map(|name| base.join(name)));
    roots
}

fn retire_appimage_copy(home: &Path, refusal: &Path) -> Result<(), String> {
    let path = home.join(".local/lib/jstorrent/jstorrent-host");
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("inspect legacy AppImage host: {error}")),
    };
    if !metadata.is_file() || metadata.len() > MAX_HOST_BINARY_BYTES {
        return Err("legacy AppImage host is not a bounded regular file".to_owned());
    }
    let parent = path.parent().expect("fixed legacy path");
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let directory = fs::symlink_metadata(parent).map_err(|error| error.to_string())?;
        if !directory.is_dir()
            || directory.uid() != rustix::process::getuid().as_raw()
            || metadata.uid() != rustix::process::getuid().as_raw()
        {
            return Err("legacy AppImage host is not owned by the current user".to_owned());
        }
    }
    let mut input = File::open(refusal).map_err(|error| error.to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    std::io::copy(&mut input, &mut temporary).map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .set_permissions(
            fs::metadata(refusal)
                .map_err(|error| error.to_string())?
                .permissions(),
        )
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(path)
        .map_err(|error| error.error.to_string())?;
    Ok(())
}

#[cfg(windows)]
fn register_legacy_windows_manifest(manifest: &Path) -> Result<(), String> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_WOW64_32KEY, KEY_WOW64_64KEY, KEY_WRITE};
    let user = RegKey::predef(HKEY_CURRENT_USER);
    for browser in [
        r"Google\Chrome",
        "Chromium",
        r"BraveSoftware\Brave-Browser",
        r"Microsoft\Edge",
    ] {
        let name = format!(
            r"Software\{browser}\NativeMessagingHosts\{}",
            legacy::HOST_NAME
        );
        for view in [KEY_WOW64_32KEY, KEY_WOW64_64KEY] {
            let (key, _) = user
                .create_subkey_with_flags(&name, KEY_WRITE | view)
                .map_err(|error| error.to_string())?;
            key.set_value("", &manifest.as_os_str())
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn register_legacy_windows_manifest(_manifest: &Path) -> Result<(), String> {
    Err("Windows legacy registration is unavailable on this platform".to_owned())
}

#[cfg(not(target_os = "windows"))]
fn register_windows_manifest(_manifest: &Path) -> Result<(), String> {
    Err("Windows native host registration is unavailable on this platform".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn absolute(root: &Path, relative: &str) -> PathBuf {
        root.join(relative)
    }

    #[test]
    fn manifest_is_exact_and_never_takes_over_the_legacy_host() {
        let directory = tempfile::tempdir().unwrap();
        let host = absolute(directory.path(), "rstorrent-native-host");
        let value: serde_json::Value =
            serde_json::from_slice(&manifest_bytes(&host).unwrap()).unwrap();

        assert_eq!(value["name"], "com.jstorrent.rstorrent.native");
        assert_ne!(value["name"], "com.jstorrent.native");
        assert_eq!(value["type"], "stdio");
        assert_eq!(
            value["allowed_origins"],
            serde_json::json!([PRODUCTION_EXTENSION_ORIGIN, BETA_EXTENSION_ORIGIN])
        );
        assert_eq!(value["path"], host.to_string_lossy().as_ref());
    }

    #[test]
    fn browser_roots_are_platform_specific_and_do_not_include_edge() {
        let home = Path::new("/home/tester");
        let mac = browser_profile_roots(Platform::MacOS, home);
        assert!(mac.contains(&home.join("Library/Application Support/Google/Chrome")));
        assert!(mac.contains(&home.join("Library/Application Support/Google/Chrome for Testing")));
        assert!(
            !mac.iter()
                .any(|path| path.to_string_lossy().contains("Edge"))
        );

        let linux = browser_profile_roots(Platform::Linux, home);
        assert!(linux.contains(&home.join(".config/google-chrome")));
        assert!(linux.contains(&home.join(".config/google-chrome-for-testing")));
        assert!(
            !linux
                .iter()
                .any(|path| path.to_string_lossy().contains("edge"))
        );
    }

    #[test]
    fn registration_only_writes_browsers_with_existing_profile_roots() {
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path().join("home");
        let config = directory.path().join("config");
        let desktop = absolute(directory.path(), "JSTorrent");
        let bundled_host = absolute(directory.path(), "rstorrent-native-host");
        fs::create_dir_all(home.join(".config/google-chrome")).unwrap();
        fs::write(&desktop, b"desktop").unwrap();
        fs::write(&bundled_host, b"native-host").unwrap();

        let report =
            install_for_platform(Platform::Linux, &config, &home, &desktop, &bundled_host).unwrap();

        assert_eq!(report.browser_manifests, 1);
        assert!(report.stable_host.is_file());
        assert!(
            home.join(".config/google-chrome/NativeMessagingHosts")
                .join(HOST_MANIFEST_FILENAME)
                .is_file()
        );
        assert!(!home.join(".config/chromium/NativeMessagingHosts").exists());
        let launch: LaunchConfig = serde_json::from_slice(
            &fs::read(config.join(HOST_DIRECTORY).join(LAUNCH_CONFIG_FILENAME)).unwrap(),
        )
        .unwrap();
        assert_eq!(launch, LaunchConfig::executable(desktop));
    }

    #[test]
    fn mac_testing_browser_registration_repairs_its_actual_support_directory() {
        let directory = tempfile::tempdir().unwrap();
        // Chromium's GOOGLE_CHROME_FOR_TESTING_BRANDING fallback in
        // chrome/common/chrome_paths_mac.mm includes both spaces.
        let browser = directory
            .path()
            .join("Library/Application Support/Google/Chrome for Testing");
        fs::create_dir_all(&browser).unwrap();
        let manifest = browser
            .join("NativeMessagingHosts")
            .join(HOST_MANIFEST_FILENAME);
        let bytes = manifest_bytes(&directory.path().join("native-host")).unwrap();
        assert_eq!(
            install_browser_manifests(Platform::MacOS, directory.path(), &bytes).unwrap(),
            1
        );
        assert_eq!(fs::read(&manifest).unwrap(), bytes);
        fs::remove_file(&manifest).unwrap();
        assert_eq!(
            install_browser_manifests(Platform::MacOS, directory.path(), &bytes).unwrap(),
            1
        );
        assert_eq!(fs::read(manifest).unwrap(), bytes);
        assert!(
            !directory
                .path()
                .join("Library/Application Support/Google/Chrome")
                .exists()
        );
    }

    #[test]
    fn mac_launch_targets_the_app_bundle_not_its_inner_executable() {
        let desktop = Path::new("/Applications/JSTorrent.app/Contents/MacOS/rstorrent-desktop");
        assert_eq!(
            launch_config(Platform::MacOS, desktop).unwrap(),
            LaunchConfig::mac_app(PathBuf::from("/Applications/JSTorrent.app"))
        );
    }

    #[test]
    fn stable_host_is_content_versioned_and_repairs_manifest_path() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source-host");
        let stable = directory.path().join("stable");
        fs::create_dir(&stable).unwrap();
        fs::write(&source, b"first host").unwrap();
        let first = install_versioned_host(&source, &stable).unwrap();
        assert_eq!(fs::read(&first).unwrap(), b"first host");

        fs::write(&source, b"second host").unwrap();
        let second = install_versioned_host(&source, &stable).unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read(&second).unwrap(), b"second host");
    }

    #[test]
    fn incubation_never_accesses_legacy_registration_arguments() {
        let owned = tempfile::tempdir().unwrap();
        let absent = owned.path().join("absent");
        assert_eq!(
            install_legacy_refusal("com.jstorrent.rstorrent", &absent, &absent, &absent).unwrap(),
            None
        );
        assert!(!absent.exists());
    }

    #[test]
    fn legacy_registration_fences_released_browser_families_and_repairs_idempotently() {
        for platform in [Platform::MacOS, Platform::Linux] {
            let owned = tempfile::tempdir().unwrap();
            let home = owned.path().join("home");
            let config = owned.path().join("config");
            fs::create_dir_all(config.join(HOST_DIRECTORY)).unwrap();
            let source = owned.path().join("packaged-host");
            fs::write(&source, b"refusal binary").unwrap();
            let roots = legacy_browser_roots(platform, &home);
            for root in &roots {
                fs::create_dir_all(root.join("NativeMessagingHosts")).unwrap();
                fs::write(
                    root.join("NativeMessagingHosts/com.jstorrent.native.json"),
                    b"old registration",
                )
                .unwrap();
            }
            let stable_old = home.join(".local/lib/jstorrent/jstorrent-host");
            if platform == Platform::Linux {
                fs::create_dir_all(stable_old.parent().unwrap()).unwrap();
                fs::write(&stable_old, b"old host").unwrap();
            }
            let first = install_legacy_for_platform(platform, &config, &home, &source).unwrap();
            let second = install_legacy_for_platform(platform, &config, &home, &source).unwrap();
            assert_eq!(first, second);
            assert_eq!(first.browser_manifests, roots.len());
            assert!(legacy::is_refusal_executable(&first.stable_host));
            for root in roots {
                let manifest: serde_json::Value = serde_json::from_slice(
                    &fs::read(root.join("NativeMessagingHosts/com.jstorrent.native.json")).unwrap(),
                )
                .unwrap();
                assert_eq!(manifest["name"], legacy::HOST_NAME);
                assert_eq!(manifest["path"], first.stable_host.to_str().unwrap());
                assert_eq!(
                    manifest["allowed_origins"],
                    serde_json::json!([
                        legacy::PRODUCTION_ORIGIN,
                        legacy::PACKAGED_EXTENSION_ORIGIN
                    ])
                );
            }
            if platform == Platform::Linux {
                assert_eq!(fs::read(stable_old).unwrap(), b"refusal binary");
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn unsafe_appimage_copy_refuses_replacement_without_touching_the_target() {
        use std::os::unix::fs::symlink;
        let owned = tempfile::tempdir().unwrap();
        let source = owned.path().join("source");
        fs::write(&source, b"refusal").unwrap();
        let target = owned.path().join("untouched");
        fs::write(&target, b"original").unwrap();
        let old = owned.path().join(".local/lib/jstorrent/jstorrent-host");
        fs::create_dir_all(old.parent().unwrap()).unwrap();
        symlink(&target, &old).unwrap();
        assert!(retire_appimage_copy(owned.path(), &source).is_err());
        assert_eq!(fs::read(target).unwrap(), b"original");
    }
}
