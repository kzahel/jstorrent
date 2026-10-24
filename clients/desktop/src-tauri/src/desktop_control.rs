use rstorrent_session::ApplicationService;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub struct DesktopControlOwner {
    cancel: CancellationToken,
    tasks: Vec<tauri::async_runtime::JoinHandle<Result<(), String>>>,
}

impl DesktopControlOwner {
    pub async fn open(
        config_dir: &Path,
        service: Arc<Mutex<ApplicationService>>,
        picker: Arc<crate::download_picker::DesktopDownloadPicker>,
    ) -> Result<Self, String> {
        let cancel = CancellationToken::new();
        let tasks = Vec::new();
        #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
        let _ = &picker;
        #[cfg(any(unix, windows))]
        let tasks = {
            use rstorrent_gateway::desktop_control::DesktopControlServer;
            use rstorrent_native_host::control::{BootstrapServer, ControlReady};
            let mut secret = [0_u8; 32];
            getrandom::fill(&mut secret).map_err(|_| "desktop control randomness failed")?;
            let credential: String = secret.iter().map(|b| format!("{b:02x}")).collect();
            let instance_id = uuid::Uuid::new_v4().simple().to_string();
            let server = DesktopControlServer::bind(
                service,
                credential.clone(),
                instance_id.clone(),
                env!("CARGO_PKG_VERSION").to_owned(),
            )
            .await
            .map_err(|e| e.to_string())?;
            #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
            let server = server.with_download_directory_picker(picker);
            let bootstrap = BootstrapServer::bind(
                &config_dir.join("native-host"),
                ControlReady {
                    endpoint: format!("http://{}", server.local_addr()),
                    credential,
                    instance_id,
                    profile_id: "default".to_owned(),
                },
            )
            .map_err(|e| format!("bind desktop bootstrap: {e}"))?;
            let mut tasks = tasks;
            let bootstrap_cancel = cancel.clone();
            tasks.push(tauri::async_runtime::spawn(async move {
                bootstrap
                    .serve(bootstrap_cancel)
                    .await
                    .map_err(|e| e.to_string())
            }));
            let control_cancel = cancel.clone();
            tasks.push(tauri::async_runtime::spawn(async move {
                server
                    .serve(control_cancel)
                    .await
                    .map_err(|e| e.to_string())
            }));
            tasks
        };
        #[cfg(not(any(unix, windows)))]
        let _ = (config_dir, service);
        Ok(Self { cancel, tasks })
    }

    pub async fn shutdown(self) -> Result<(), String> {
        self.cancel.cancel();
        let mut failed = false;
        for task in self.tasks {
            if !matches!(task.await, Ok(Ok(()))) {
                failed = true;
            }
        }
        if failed {
            Err("desktop control owner failed".to_owned())
        } else {
            Ok(())
        }
    }
}

pub fn background_launch<'a>(arguments: impl IntoIterator<Item = &'a str>) -> bool {
    arguments
        .into_iter()
        .any(|argument| argument == rstorrent_native_host::control::BACKGROUND_ARGUMENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_explicit_background_intent_suppresses_window() {
        assert!(background_launch(["rstorrent", "--extension-background"]));
        assert!(!background_launch(["rstorrent"]));
        assert!(!background_launch([
            "rstorrent",
            "--extension-background=1"
        ]));
    }
}
