//! A single desktop-owned dialog with observable cancellation and child reaping.
use rstorrent_platform::{DownloadDirectoryPicker, PickerError, PickerFuture};
use std::path::Path;
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
use std::path::PathBuf;
use std::sync::Arc;
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
use std::time::Duration;
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
use tokio::process::Command;
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
use tokio::sync::oneshot;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

const HELPER_ARGUMENT: &str = "--desktop-folder-dialog";
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
const MAX_FRAME_BYTES: usize = 16 * 1024;
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
const PICKER_TIMEOUT: Duration = Duration::from_secs(300);

pub struct DesktopDownloadPicker {
    permit: Arc<Semaphore>,
    shutdown: CancellationToken,
}

impl DesktopDownloadPicker {
    pub fn new() -> Self {
        Self {
            permit: Arc::new(Semaphore::new(1)),
            shutdown: CancellationToken::new(),
        }
    }

    pub fn is_busy(&self) -> bool {
        self.permit.available_permits() == 0
    }

    pub fn acquire(&self) -> Result<OwnedSemaphorePermit, PickerError> {
        if self.shutdown.is_cancelled() {
            return Err(PickerError::Failed("desktop is shutting down".into()));
        }
        let permit =
            self.permit.clone().try_acquire_owned().map_err(|_| {
                PickerError::Failed("another download folder dialog is open".into())
            })?;
        if self.shutdown.is_cancelled() {
            return Err(PickerError::Failed("desktop is shutting down".into()));
        }
        Ok(permit)
    }

    pub fn begin_shutdown(&self) {
        self.shutdown.cancel();
    }

    pub async fn shutdown(&self) {
        self.begin_shutdown();
        // The helper actor holds this permit until kill/wait has completed.
        let _joined = self.permit.acquire().await;
    }

    pub async fn cancelled(&self) {
        self.shutdown.cancelled().await;
    }
}

impl DownloadDirectoryPicker for DesktopDownloadPicker {
    fn choose<'a>(&'a self, starting_directory: &'a Path) -> PickerFuture<'a> {
        Box::pin(async move {
            #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
            {
                let _ = starting_directory;
                Err(PickerError::Unsupported)
            }
            #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
            {
                let permit = self.acquire()?;
                let input = serde_json::to_vec(starting_directory)
                    .map_err(|_| PickerError::InvalidStartingDirectory)?;
                if input.len() > MAX_FRAME_BYTES || !starting_directory.is_dir() {
                    return Err(PickerError::InvalidStartingDirectory);
                }
                let mut command =
                    Command::new(std::env::current_exe().map_err(PickerError::Launch)?);
                command.arg(HELPER_ARGUMENT);
                #[cfg(windows)]
                command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW (native dialog still visible).
                let (sender, receiver) = oneshot::channel();
                let shutdown = self.shutdown.clone();
                tauri::async_runtime::spawn(async move {
                    run_helper(command, input, permit, sender, shutdown, PICKER_TIMEOUT).await;
                });
                receiver
                    .await
                    .map_err(|_| PickerError::Failed("dialog owner closed".into()))?
            }
        })
    }
}

#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
async fn run_helper(
    mut command: Command,
    input: Vec<u8>,
    _permit: OwnedSemaphorePermit,
    mut sender: oneshot::Sender<Result<Option<PathBuf>, PickerError>>,
    shutdown: CancellationToken,
    timeout: Duration,
) {
    use std::process::Stdio;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = sender.send(Err(PickerError::Launch(error)));
            return;
        }
    };
    let mut stdin = child.stdin.take().expect("piped helper input");
    let mut stdout = child
        .stdout
        .take()
        .expect("piped helper output")
        .take(MAX_FRAME_BYTES as u64 + 1);
    let exchange = async {
        stdin.write_all(&input).await.map_err(PickerError::Launch)?;
        drop(stdin);
        let mut output = Vec::new();
        stdout
            .read_to_end(&mut output)
            .await
            .map_err(PickerError::Launch)?;
        if output.len() > MAX_FRAME_BYTES {
            return Err(PickerError::InvalidOutput);
        }
        let selected: Option<PathBuf> =
            serde_json::from_slice(&output).map_err(|_| PickerError::InvalidOutput)?;
        if selected
            .as_ref()
            .is_some_and(|p| !p.is_absolute() || p.to_str().is_none_or(|s| s.len() > 4096))
        {
            return Err(PickerError::InvalidOutput);
        }
        Ok(selected)
    };
    let result = tokio::select! {
        biased;
        () = shutdown.cancelled() => Err(PickerError::Failed("desktop is shutting down".into())),
        () = sender.closed() => Err(PickerError::Failed("requesting view disconnected".into())),
        result = tokio::time::timeout(timeout, exchange) => result.unwrap_or_else(|_| Err(PickerError::Failed("folder dialog timed out".into()))),
    };
    let result = if result.is_err() {
        let _ = child.kill().await;
        result
    } else {
        // Successful output is not successful process termination.
        match tokio::time::timeout(Duration::from_secs(2), child.wait()).await {
            Ok(Ok(status)) if status.success() => result,
            _ => {
                let _ = child.kill().await;
                Err(PickerError::Failed(
                    "folder dialog did not exit cleanly".into(),
                ))
            }
        }
    };
    let _ = child.wait().await;
    let _ = sender.send(result);
}

/// Runs before Tauri, registration and singleton setup. No library is opened.
pub fn run_helper_if_requested() -> bool {
    if std::env::args_os().nth(1).as_deref() != Some(std::ffi::OsStr::new(HELPER_ARGUMENT)) {
        return false;
    }
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    {
        use std::io::{Read, Write};
        let result = (|| -> Result<(), ()> {
            #[cfg(target_os = "linux")]
            if std::env::var_os("DISPLAY").is_none()
                && std::env::var_os("WAYLAND_DISPLAY").is_none()
            {
                return Err(());
            }
            let mut input = Vec::new();
            std::io::stdin()
                .take(MAX_FRAME_BYTES as u64 + 1)
                .read_to_end(&mut input)
                .map_err(|_| ())?;
            if input.len() > MAX_FRAME_BYTES {
                return Err(());
            }
            let starting: PathBuf = serde_json::from_slice(&input).map_err(|_| ())?;
            if !starting.is_absolute() || !starting.is_dir() {
                return Err(());
            }
            #[cfg(target_os = "macos")]
            {
                use objc2::MainThreadMarker;
                use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
                let main = MainThreadMarker::new().ok_or(())?;
                let app = NSApplication::sharedApplication(main);
                if !app.setActivationPolicy(NSApplicationActivationPolicy::Accessory) {
                    return Err(());
                }
                // rfd enters a modal loop directly, rather than NSApplication::run.
                // Complete launch before activation so AppKit finishes registering
                // this short-lived process and routes panel input/accessibility.
                app.finishLaunching();
                // This helper exists only for an explicit user picker request.
                // No product window, menu, library or event-loop owner is built.
                #[allow(deprecated)]
                app.activateIgnoringOtherApps(true);
            }
            let selected = rfd::FileDialog::new()
                .set_title(crate::desktop_localization::text(
                    "dialog.download-folder.title",
                ))
                .set_directory(starting)
                .pick_folder();
            let output = serde_json::to_vec(&selected).map_err(|_| ())?;
            if output.len() > MAX_FRAME_BYTES {
                return Err(());
            }
            std::io::stdout().write_all(&output).map_err(|_| ())
        })();
        if result.is_err() {
            std::process::exit(1);
        }
    }
    true
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn disconnect_and_quit_reap_owned_child_before_releasing_admission() {
        for quit in [false, true] {
            let picker = DesktopDownloadPicker::new();
            let permit = picker.acquire().unwrap();
            assert!(picker.acquire().is_err());
            let directory = tempfile::tempdir().unwrap();
            let pid_file = directory.path().join("pid");
            let mut command = Command::new("/bin/sh");
            command
                .args(["-c", "echo $$ > \"$1\"; exec sleep 60", "picker-test"])
                .arg(&pid_file);
            let (sender, receiver) = oneshot::channel();
            let task = tokio::spawn(run_helper(
                command,
                b"null".to_vec(),
                permit,
                sender,
                picker.shutdown.clone(),
                PICKER_TIMEOUT,
            ));
            tokio::time::timeout(Duration::from_secs(2), async {
                while !pid_file.exists() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            let pid = std::fs::read_to_string(pid_file).unwrap();
            if quit {
                picker.shutdown.cancel();
            } else {
                drop(receiver);
            }
            tokio::time::timeout(Duration::from_secs(2), task)
                .await
                .unwrap()
                .unwrap();
            assert!(
                !std::process::Command::new("/bin/kill")
                    .args(["-0", pid.trim()])
                    .stderr(std::process::Stdio::null())
                    .status()
                    .unwrap()
                    .success()
            );
            assert_eq!(picker.permit.available_permits(), 1);
            if quit {
                assert!(picker.acquire().is_err());
            }
        }
    }

    #[tokio::test]
    async fn helper_failure_is_not_cancel_and_deadline_releases_admission() {
        for script in ["printf null; exit 1", "printf invalid", "exec sleep 60"] {
            let picker = DesktopDownloadPicker::new();
            let mut command = Command::new("/bin/sh");
            command.args(["-c", script]);
            let (sender, receiver) = oneshot::channel();
            run_helper(
                command,
                Vec::new(),
                picker.acquire().unwrap(),
                sender,
                picker.shutdown.clone(),
                Duration::from_millis(50),
            )
            .await;
            assert!(receiver.await.unwrap().is_err(), "{script}");
            assert_eq!(picker.permit.available_permits(), 1);
        }
    }
}
