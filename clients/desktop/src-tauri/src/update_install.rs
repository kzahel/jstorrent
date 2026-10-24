//! Desktop package preflight and one-shot relaunch, after joined shutdown.
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::Manager;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Presentation {
    Foreground,
    Unfocused,
    Minimized,
    Hidden,
}
impl Presentation {
    pub(crate) fn capture(app: &tauri::AppHandle) -> Self {
        if app.try_state::<crate::DesktopState>().is_some_and(|state| {
            state
                .window_hidden
                .load(std::sync::atomic::Ordering::Acquire)
        }) {
            return Self::Hidden;
        }
        let Some(window) = app.get_webview_window(crate::MAIN_WINDOW_LABEL) else {
            return Self::Hidden;
        };
        if window.is_minimized().unwrap_or(false) {
            Self::Minimized
        } else if !window.is_visible().unwrap_or(false) {
            Self::Hidden
        } else if window.is_focused().unwrap_or(false) {
            Self::Foreground
        } else {
            Self::Unfocused
        }
    }
    fn as_str(self) -> &'static str {
        match self {
            Self::Foreground => "foreground",
            Self::Unfocused => "unfocused",
            Self::Minimized => "minimized",
            Self::Hidden => "hidden",
        }
    }
    fn parse(value: &str) -> Option<Self> {
        match value {
            "foreground" => Some(Self::Foreground),
            "unfocused" => Some(Self::Unfocused),
            "minimized" => Some(Self::Minimized),
            "hidden" => Some(Self::Hidden),
            _ => None,
        }
    }
    pub(crate) fn startup() -> Option<Self> {
        let args: Vec<_> = std::env::args().collect();
        let requested = args.iter().find_map(|arg| {
            arg.strip_prefix("--update-presentation=")
                .and_then(Self::parse)
        })?;
        let cutoff = args.iter().find_map(|arg| {
            arg.strip_prefix("--update-focus-cutoff=")
                .and_then(|value| value.parse::<u64>().ok())
        });
        if requested == Self::Foreground
            && cutoff.is_some()
            && !cutoff
                .zip(last_input_millis())
                .is_some_and(|(before, now)| now <= before.saturating_add(10))
        {
            Some(Self::Unfocused)
        } else {
            Some(requested)
        }
    }
    pub(crate) fn should_focus(self) -> bool {
        self == Self::Foreground
    }
}

/// Win32's ordinary show path restores an iconic window. Present the new
/// window minimized without activation in one native operation instead.
#[cfg(windows)]
pub(crate) fn show_minimized(window: &tauri::WebviewWindow) -> Result<(), String> {
    let handle = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    // Keep this crate's unsafe-code prohibition. The same bounded, windowless
    // OS helper used for input sampling posts asynchronously, so startup does
    // not wait on a GUI message sent back to its own blocked thread.
    const API: &str = r#"$ErrorActionPreference='Stop'; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class JSTorrentUpdateWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command); }';"#;
    let script = format!(
        "{API} if (-not [JSTorrentUpdateWindow]::ShowWindowAsync([IntPtr]::new({handle}),7)) {{ exit 1 }}"
    );
    let mut command = std::process::Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(0x0800_0000);
    bounded_output_with_timeout(command, Duration::from_secs(5))
        .ok_or_else(|| "Could not restore the minimized window".to_owned())?;
    Ok(())
}

pub(crate) struct PreparedInstall {
    pub bytes: Vec<u8>,
    pub presentation: Presentation,
    pub focus_cutoff: Option<u64>,
    pub cache: PathBuf,
    pub relaunch_token: String,
    pub version: String,
}
impl PreparedInstall {
    pub(crate) fn cancel_file(&self) -> PathBuf {
        self.cache.join(format!("cancel-{}", self.relaunch_token))
    }
}

pub(crate) fn cancelled_startup(config: &Path) -> bool {
    let token = std::env::args().find_map(|arg| {
        arg.strip_prefix("--update-relaunch-token=")
            .map(str::to_owned)
    });
    token.is_some_and(|token| cancelled_token(config, &token))
}
fn cancelled_token(config: &Path, token: &str) -> bool {
    if token.len() != 32 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return false;
    }
    let marker = config.join("update-cache").join(format!("cancel-{token}"));
    if marker.is_file() {
        let _ = std::fs::remove_file(marker);
        true
    } else {
        false
    }
}

pub(crate) fn validate_payload(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("Update payload is empty".into());
    }
    #[cfg(target_os = "macos")]
    {
        use std::path::Component;
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
        let mut expanded = 0u64;
        let mut entries = 0usize;
        for entry in archive.entries().map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            entries += 1;
            expanded = expanded
                .checked_add(entry.size())
                .ok_or("Update archive size overflow")?;
            if entries > 100_000 || expanded > 2 * 1024 * 1024 * 1024 {
                return Err("Expanded update exceeds its resource limit".into());
            }
            let path = entry.path().map_err(|error| error.to_string())?;
            if !path
                .components()
                .all(|part| matches!(part, Component::Normal(_)))
                || path.components().count() < 1
            {
                return Err("Update archive has an unsafe path".into());
            }
            if !(entry.header().entry_type().is_file() || entry.header().entry_type().is_dir()) {
                return Err("Update archive contains unsupported links or special files".into());
            }
        }
        if entries == 0 {
            return Err("Update archive is empty".into());
        }
    }
    #[cfg(target_os = "linux")]
    if !bytes.starts_with(b"\x7fELF") {
        return Err("Update is not an AppImage executable".into());
    }
    #[cfg(windows)]
    if !bytes.starts_with(b"MZ") {
        return Err("Update is not a Windows installer".into());
    }
    Ok(())
}

fn installed_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "linux")]
    if let Some(path) = app.env().appimage {
        return Ok(PathBuf::from(path));
    }
    #[cfg(not(target_os = "linux"))]
    let _ = app;
    std::env::current_exe().map_err(|error| error.to_string())
}

pub(crate) fn preflight(app: &tauri::AppHandle, payload: &[u8]) -> Result<(), String> {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    let bytes = payload.len();
    #[cfg(target_os = "macos")]
    let expanded = {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(payload));
        let mut total = 0u64;
        for entry in archive.entries().map_err(|error| error.to_string())? {
            total = total
                .checked_add(entry.map_err(|error| error.to_string())?.size())
                .ok_or("Update expansion overflow")?;
            if total > 2 * 1024 * 1024 * 1024 {
                return Err("Expanded update exceeds its resource limit".into());
            }
        }
        total
    };
    #[cfg(not(target_os = "macos"))]
    let expanded = 0u64;
    let required = (bytes as u64)
        .saturating_mul(4)
        .max(expanded.saturating_add(bytes as u64))
        .saturating_add(64 * 1024 * 1024);
    if !matches!(
        bundle_type(),
        Some(BundleType::App | BundleType::Nsis | BundleType::AppImage)
    ) {
        return Err("This package requires a manual update".into());
    }
    let executable = installed_path(app)?;
    #[cfg(target_os = "macos")]
    let target = executable
        .ancestors()
        .nth(3)
        .ok_or("Missing application bundle")?;
    #[cfg(not(target_os = "macos"))]
    let target = executable.as_path();
    let parent = target.parent().ok_or("Missing installation directory")?;
    if std::fs::symlink_metadata(target)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Linked installations require manual updating".into());
    }
    tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "Installation needs permission; update manually".to_owned())?;
    #[cfg(unix)]
    {
        let available = rustix::fs::statvfs(parent).map_err(|error| error.to_string())?;
        let free = available.f_bavail.saturating_mul(available.f_frsize);
        if free < required {
            return Err("Not enough free disk space to install the update".into());
        }
    }
    #[cfg(windows)]
    {
        let required = required.max(
            std::fs::metadata(&executable)
                .map_err(|error| error.to_string())?
                .len()
                .saturating_mul(3)
                .saturating_add(bytes as u64 * 2)
                .saturating_add(64 * 1024 * 1024),
        );
        if env!("JSTORRENT_NSIS_CURRENT_USER") != "true" {
            return Err("This installer requires manual updating".into());
        }
        let path = parent
            .to_str()
            .ok_or("Invalid installation path")?
            .replace("'", "''");
        let mut command = std::process::Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", &format!("([System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot('{path}'))).AvailableFreeSpace")]);
        command.creation_flags(0x0800_0000);
        let free = bounded_output(command)
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .and_then(|text| text.trim().parse::<u64>().ok())
            .ok_or("Could not verify installation disk space")?;
        if free < required {
            return Err("Not enough free disk space to install the update".into());
        }
    }
    Ok(())
}

pub(crate) fn install(app: &tauri::AppHandle, prepared: PreparedInstall) -> Result<(), String> {
    validate_payload(&prepared.bytes)?;
    #[cfg(windows)]
    {
        use std::io::Write;
        let installer = prepared.cache.join("update-setup.exe");
        let mut file = std::fs::File::create(&installer).map_err(|error| error.to_string())?;
        file.write_all(&prepared.bytes)
            .and_then(|()| file.sync_all())
            .map_err(|error| error.to_string())?;
        drop(file);
        // A separate copy releases the installed executable before NSIS runs.
        // Own relaunch explicitly: /R can hand off through Explorer and silently
        // omit it, and an installer failure must still resume the old host.
        let target = installed_path(app)?;
        let helper = prepared.cache.join("update-helper.exe");
        std::fs::copy(&target, &helper).map_err(|error| error.to_string())?;
        let mut command = std::process::Command::new(helper);
        command.args([
            std::ffi::OsStr::new("--desktop-update-windows-install"),
            std::ffi::OsStr::new(&std::process::id().to_string()),
            target.as_os_str(),
            installer.as_os_str(),
            std::ffi::OsStr::new(prepared.presentation.as_str()),
            std::ffi::OsStr::new(&prepared.focus_cutoff.unwrap_or(0).to_string()),
            prepared.cancel_file().as_os_str(),
        ]);
        #[cfg(feature = "update-qualification")]
        if app
            .config()
            .identifier
            .starts_with("com.jstorrent.qualification.")
            && let Some(root) = crate::debug_data_root_override()
        {
            command.env("RSTORRENT_DESKTOP_DATA_ROOT", root);
        }
        command.creation_flags(0x0800_0000);
        command.spawn().map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let ready = prepared.cache.join("relaunch-ready");
        let _ = std::fs::remove_file(&ready);
        let executable = installed_path(app)?;
        let mut command =
            std::process::Command::new(std::env::current_exe().map_err(|error| error.to_string())?);
        command
            .arg("--desktop-update-relaunch")
            .arg(std::process::id().to_string())
            .arg(&executable)
            .arg(prepared.presentation.as_str())
            .arg(&ready)
            .arg(prepared.focus_cutoff.unwrap_or(0).to_string())
            .arg(prepared.cancel_file());
        #[cfg(feature = "update-qualification")]
        if app
            .config()
            .identifier
            .starts_with("com.jstorrent.qualification.")
            && std::env::args().any(|arg| arg == "--qualification-hold-relaunch")
        {
            command.arg("--qualification-hold");
        }
        let helper = command.spawn().map_err(|error| error.to_string())?;
        if let Err(error) = replace_package(app, &prepared.bytes, &prepared.version) {
            let mut helper = helper;
            let _ = helper.kill();
            let _ = helper.wait();
            return Err(error.to_string());
        }
        let presentation = if prepared.presentation == Presentation::Foreground
            && Presentation::capture(app) != Presentation::Foreground
        {
            Presentation::Unfocused
        } else {
            prepared.presentation
        };
        std::fs::write(&ready, presentation.as_str()).map_err(|error| error.to_string())?;
    }
    app.exit(0);
    Ok(())
}

/// Recovery uses the same one-shot context and never replays startup intake.
pub(crate) fn relaunch_installed(
    app: &tauri::AppHandle,
    cache: &Path,
    presentation: Presentation,
    cutoff: Option<u64>,
    cancel: &Path,
) -> Result<(), String> {
    let ready = cache.join("recovery-ready");
    let _ = std::fs::remove_file(&ready);
    let mut command =
        std::process::Command::new(std::env::current_exe().map_err(|error| error.to_string())?);
    command
        .arg("--desktop-update-relaunch")
        .arg(std::process::id().to_string())
        .arg(installed_path(app)?)
        .arg(presentation.as_str())
        .arg(&ready)
        .arg(cutoff.unwrap_or(0).to_string())
        .arg(cancel);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut helper = command.spawn().map_err(|error| error.to_string())?;
    if let Err(error) = std::fs::write(&ready, presentation.as_str()) {
        let _ = helper.kill();
        let _ = helper.wait();
        return Err(error.to_string());
    }
    app.exit(0);
    Ok(())
}

/// Runs before Tauri/single-instance startup and never creates a window.
pub(crate) fn run_relaunch_helper() -> bool {
    let args: Vec<_> = std::env::args_os().collect();
    #[cfg(windows)]
    if args
        .get(1)
        .is_some_and(|value| value == "--desktop-update-windows-install")
    {
        run_windows_install_helper(&args);
        return true;
    }
    if args
        .get(1)
        .is_none_or(|value| value != "--desktop-update-relaunch")
    {
        return false;
    }
    if args.len() != 8 && !(cfg!(feature = "update-qualification") && args.len() == 9) {
        return true;
    }
    let Some(pid) = args[2]
        .to_str()
        .and_then(|value| value.parse::<i32>().ok())
        .filter(|value| *value > 0)
    else {
        return true;
    };
    let target = Path::new(&args[3]);
    let Some(presentation) = args[4].to_str().and_then(Presentation::parse) else {
        return true;
    };
    let ready = Path::new(&args[5]);
    let cutoff = args[6]
        .to_str()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let cancel = Path::new(&args[7]);
    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        let parent_alive = parent_is_alive(pid);
        if cancel.is_file() {
            let _ = std::fs::remove_file(cancel);
            return true;
        }
        if !parent_alive && ready.is_file() {
            #[cfg(feature = "update-qualification")]
            if args.get(8).is_some_and(|arg| arg == "--qualification-hold") {
                let parent = ready.parent().expect("ready file parent");
                let release = parent.join("relaunch-release");
                let waiting = parent.join("relaunch-waiting");
                if std::fs::write(&waiting, b"old process exited").is_err() {
                    return true;
                }
                let until = Instant::now() + Duration::from_secs(45);
                while !release.is_file() && !cancel.is_file() && Instant::now() < until {
                    std::thread::sleep(Duration::from_millis(50));
                }
                if !release.is_file() || cancel.is_file() {
                    return true;
                }
                let _ = std::fs::remove_file(release);
                let _ = std::fs::remove_file(waiting);
            }
            let presentation = std::fs::read_to_string(ready)
                .ok()
                .and_then(|value| Presentation::parse(value.trim()))
                .unwrap_or(presentation);
            let _ = std::fs::remove_file(ready);
            if cancel.is_file() {
                return true;
            }
            let _ = std::process::Command::new(target)
                .arg(format!("--update-presentation={}", presentation.as_str()))
                .arg(format!("--update-focus-cutoff={cutoff}"))
                .spawn();
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    true
}

fn parent_is_alive(pid: i32) -> bool {
    #[cfg(unix)]
    return rustix::process::test_kill_process(
        rustix::process::Pid::from_raw(pid).expect("positive parent PID"),
    )
    .is_ok();
    #[cfg(windows)]
    {
        let mut command = std::process::Command::new("tasklist.exe");
        command.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
        command.creation_flags(0x0800_0000);
        bounded_output(command).is_none_or(|output| {
            !output.status.success()
                || String::from_utf8_lossy(&output.stdout).lines().any(|line| {
                    line.split(',')
                        .nth(1)
                        .is_some_and(|value| value.trim_matches('"') == pid.to_string())
                })
        })
    }
    #[cfg(not(any(unix, windows)))]
    true
}

#[cfg(windows)]
fn run_windows_install_helper(args: &[std::ffi::OsString]) {
    if args.len() != 8 {
        return;
    }
    let Some(pid) = args[2]
        .to_str()
        .and_then(|value| value.parse::<i32>().ok())
        .filter(|pid| *pid > 0)
    else {
        return;
    };
    let target = Path::new(&args[3]);
    let installer = Path::new(&args[4]);
    let Some(presentation) = args[5].to_str().and_then(Presentation::parse) else {
        return;
    };
    let Some(cutoff) = args[6].to_str().and_then(|value| value.parse::<u64>().ok()) else {
        return;
    };
    let cancel = Path::new(&args[7]);
    let Some(token) = cancel
        .file_name()
        .and_then(|value| value.to_str())
        .and_then(|value| value.strip_prefix("cancel-"))
        .filter(|value| value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
    else {
        return;
    };
    let deadline = Instant::now() + Duration::from_secs(180);
    while parent_is_alive(pid) {
        if cancel.is_file() || Instant::now() >= deadline {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    if cancel.is_file() {
        return;
    }
    let mut command = std::process::Command::new(installer);
    command.args(["/S", "/UPDATE"]).creation_flags(0x0800_0000);
    let succeeded = match command.spawn() {
        Err(_) => false,
        Ok(mut child) => {
            let deadline = Instant::now() + Duration::from_secs(180);
            loop {
                // Never interrupt an installer midway through replacement.
                // Cancellation suppresses relaunch; NSIS has no /R authority.
                if cancel.is_file() || Instant::now() >= deadline {
                    return;
                }
                match child.try_wait() {
                    Ok(Some(status)) => break status.success(),
                    Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                    Err(_) => return,
                }
            }
        }
    };
    if !succeeded {
        // This package embeds the UI/resources in its executable. Preserve A
        // until installation finishes, and restore it if NSIS reports failure.
        let restored = (|| -> Result<(), std::io::Error> {
            let next = tempfile::NamedTempFile::new_in(
                target
                    .parent()
                    .ok_or_else(|| std::io::Error::other("Missing install parent"))?,
            )?;
            std::fs::copy(&args[0], next.path())?;
            next.as_file().sync_all()?;
            next.persist(target).map_err(|error| error.error)?;
            Ok(())
        })();
        if restored.is_err() {
            return;
        }
    }
    if !cancel.is_file() {
        let _ = std::process::Command::new(target)
            .arg(format!("--update-presentation={}", presentation.as_str()))
            .arg(format!("--update-focus-cutoff={cutoff}"))
            .arg(format!("--update-relaunch-token={token}"))
            .creation_flags(0x0800_0000)
            .spawn();
    }
}

#[cfg(target_os = "macos")]
fn replace_package(app: &tauri::AppHandle, bytes: &[u8], version: &str) -> Result<(), String> {
    let executable = installed_path(app)?;
    let target = executable
        .ancestors()
        .nth(3)
        .ok_or("Missing application bundle")?;
    let parent = target.parent().ok_or("Missing application parent")?;
    let staging = tempfile::Builder::new()
        .prefix(".jstorrent-update-")
        .tempdir_in(parent)
        .map_err(|error| error.to_string())?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
    archive
        .unpack(staging.path())
        .map_err(|error| error.to_string())?;
    let bundles: Vec<_> = std::fs::read_dir(staging.path())
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_ok_and(|kind| kind.is_dir())
                && entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "app")
        })
        .collect();
    if bundles.len() != 1 {
        return Err("Update must contain one application bundle".into());
    }
    // Preserve a user's renamed installation rather than requiring the archive
    // root to have the same filename as the installed app.
    let next = bundles[0].path();
    let info = next.join("Contents/Info.plist");
    if std::fs::metadata(&info)
        .map_err(|error| error.to_string())?
        .len()
        > 1024 * 1024
    {
        return Err("Update application metadata exceeds its limit".into());
    }
    for (field, expected) in [
        ("CFBundleIdentifier", app.config().identifier.as_str()),
        ("CFBundleShortVersionString", version),
    ] {
        let mut command = std::process::Command::new("/usr/bin/plutil");
        command
            .args(["-extract", field, "raw", "-o", "-"])
            .arg(&info);
        let output = bounded_output(command).ok_or("Could not read update application identity")?;
        if String::from_utf8_lossy(&output.stdout).trim() != expected {
            return Err("Update application identity or version does not match its offer".into());
        }
    }
    if !next.join("Contents/MacOS/jstorrent-client").is_file() {
        return Err("Update does not contain this application".into());
    }
    let status = std::process::Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict"])
        .arg(&next)
        .status()
        .map_err(|error| error.to_string())?;
    if !status.success() {
        return Err("Updated application code signature is invalid".into());
    }
    // Both complete bundles remain on the same filesystem. At every instant
    // the installed path names either the old bundle or the new one.
    rustix::fs::renameat_with(
        rustix::fs::CWD,
        target,
        rustix::fs::CWD,
        &next,
        rustix::fs::RenameFlags::EXCHANGE,
    )
    .map_err(|error| error.to_string())?;
    std::fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn replace_package(app: &tauri::AppHandle, bytes: &[u8], version: &str) -> Result<(), String> {
    use std::io::Write;
    let _ = version;
    let target = installed_path(app)?;
    let parent = target.parent().ok_or("Missing AppImage parent")?;
    let mut next = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    next.write_all(bytes)
        .and_then(|()| {
            next.as_file()
                .set_permissions(std::fs::metadata(&target)?.permissions())
        })
        .and_then(|()| next.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    next.persist(&target).map_err(|error| error.to_string())?;
    std::fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// A coarse timestamp used only to avoid reactivating over newer user input
/// during the process gap. It never decides update eligibility, records input
/// contents, or leaves this one-shot relaunch context.
pub(crate) fn last_input_millis() -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        let idle = objc2_core_graphics::CGEventSource::seconds_since_last_event_type(
            objc2_core_graphics::CGEventSourceStateID::CombinedSessionState,
            objc2_core_graphics::CGEventType(u32::MAX),
        );
        if !idle.is_finite() || idle < 0.0 {
            return None;
        }
        let now = rustix::time::clock_gettime(rustix::time::ClockId::Monotonic);
        let now = (now.tv_sec as u64)
            .checked_mul(1000)?
            .checked_add(now.tv_nsec as u64 / 1_000_000)?;
        now.checked_sub((idle * 1000.0) as u64)
    }
    #[cfg(target_os = "linux")]
    {
        // GNOME Wayland exposes coarse idle time without keyboard contents.
        // A missing facility suppresses reactivation rather than guessing.
        let mut command = std::process::Command::new("gdbus");
        command.args([
            "call",
            "--session",
            "--dest",
            "org.gnome.Mutter.IdleMonitor",
            "--object-path",
            "/org/gnome/Mutter/IdleMonitor/Core",
            "--method",
            "org.gnome.Mutter.IdleMonitor.GetIdletime",
        ]);
        let output = bounded_output(command)?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8(output.stdout).ok()?;
        let idle = text
            .trim()
            .strip_prefix("(uint64 ")?
            .trim_end_matches(",)")
            .parse::<u64>()
            .ok()?;
        let now = rustix::time::clock_gettime(rustix::time::ClockId::Monotonic);
        let now = (now.tv_sec as u64)
            .checked_mul(1000)?
            .checked_add(now.tv_nsec as u64 / 1_000_000)?;
        now.checked_sub(idle)
    }
    #[cfg(windows)]
    {
        let mut command = std::process::Command::new("powershell.exe");
        // Query only the coarse last-input timestamp; never capture events.
        command.args(["-NoProfile", "-NonInteractive", "-Command", r#"Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class JSTorrentIdle { [StructLayout(LayoutKind.Sequential)] struct Input { public uint Size; public uint Tick; } [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref Input input); [DllImport("kernel32.dll")] static extern ulong GetTickCount64(); public static ulong Read() { Input input = new Input(); input.Size = 8; if (!GetLastInputInfo(ref input)) throw new Exception("input time unavailable"); ulong now = GetTickCount64(); return now - unchecked((uint)now - input.Tick); } }'; [JSTorrentIdle]::Read()"#]);
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let output = bounded_output_with_timeout(command, Duration::from_secs(5))?;
        String::from_utf8(output.stdout).ok()?.trim().parse().ok()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    None
}

#[cfg(any(target_os = "macos", target_os = "linux", windows))]
fn bounded_output(command: std::process::Command) -> Option<std::process::Output> {
    bounded_output_with_timeout(command, Duration::from_secs(2))
}
#[cfg(any(target_os = "macos", target_os = "linux", windows))]
fn bounded_output_with_timeout(
    mut command: std::process::Command,
    timeout: Duration,
) -> Option<std::process::Output> {
    use std::process::Stdio;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + timeout;
    loop {
        if child.try_wait().ok()?.is_some() {
            return child
                .wait_with_output()
                .ok()
                .filter(|output| output.status.success());
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    fn archive(path: &str, kind: tar::EntryType, size: u64) -> Vec<u8> {
        use std::io::Write;
        let mut header = tar::Header::new_gnu();
        header.set_mode(0o644);
        header.set_size(size);
        header.set_entry_type(kind);
        header.as_mut_bytes()[..path.len()].copy_from_slice(path.as_bytes());
        header.set_cksum();
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(header.as_bytes()).unwrap();
        encoder.write_all(&[0; 1024]).unwrap();
        encoder.finish().unwrap()
    }
    #[test]
    fn archive_validation_refuses_escape_links_special_files_and_expansion() {
        assert!(validate_payload(&archive("../escape", tar::EntryType::Regular, 0)).is_err());
        assert!(validate_payload(&archive("/absolute", tar::EntryType::Regular, 0)).is_err());
        for kind in [
            tar::EntryType::Symlink,
            tar::EntryType::Link,
            tar::EntryType::Fifo,
        ] {
            assert!(validate_payload(&archive("Application.app/file", kind, 0)).is_err());
        }
        assert!(
            validate_payload(&archive(
                "Application.app/file",
                tar::EntryType::Regular,
                2 * 1024 * 1024 * 1024 + 1
            ))
            .is_err()
        );
        validate_payload(&archive("Application.app/file", tar::EntryType::Regular, 0)).unwrap();
    }
}

#[cfg(test)]
mod cancellation_tests {
    use super::*;
    #[test]
    fn cancellation_is_scoped_to_one_handoff_and_never_an_ordinary_launch() {
        let root = tempfile::tempdir().unwrap();
        let token = "0123456789abcdef0123456789abcdef";
        std::fs::create_dir(root.path().join("update-cache")).unwrap();
        let marker = root
            .path()
            .join("update-cache")
            .join(format!("cancel-{token}"));
        std::fs::write(&marker, b"quit").unwrap();
        assert!(!cancelled_token(root.path(), "../cancel"));
        assert!(!cancelled_token(
            root.path(),
            "ffffffffffffffffffffffffffffffff"
        ));
        assert!(cancelled_token(root.path(), token));
        assert!(!cancelled_token(root.path(), token));
    }
}
