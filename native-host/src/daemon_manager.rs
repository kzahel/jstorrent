use anyhow::{Context, Result};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::Duration;
use crate::state::State;
use std::io::{BufRead, BufReader};

pub struct DaemonManager {
    state: Arc<State>,
    child: Option<Child>,
    pub port: Option<u16>,
    pub token: Option<String>,
}

impl DaemonManager {
    pub fn new(state: Arc<State>) -> Self {
        Self {
            state,
            child: None,
            port: None,
            token: None,
        }
    }

    pub async fn start(&mut self) -> Result<()> {
        let exe_path = std::env::current_exe()?;
        let exe_dir = exe_path.parent().context("Failed to get executable directory")?;
        
        // Assume io-daemon is in the same directory
        let daemon_path = exe_dir.join("jstorrent-io-daemon");
        
        let token = uuid::Uuid::new_v4().to_string();
        self.token = Some(token.clone());

        let root = self.state.download_root.lock().unwrap().clone();

        let mut child = Command::new(daemon_path)
            .arg("--port")
            .arg("0") // Let OS pick port
            .arg("--token")
            .arg(&token)
            .arg("--parent-pid")
            .arg(std::process::id().to_string())
            .arg("--root")
            .arg(root)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .context("Failed to spawn io-daemon")?;

        // Read port from stdout
        if let Some(stdout) = child.stdout.take() {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            if reader.read_line(&mut line).is_ok() {
                if let Ok(port) = line.trim().parse::<u16>() {
                    self.port = Some(port);
                    crate::log!("Daemon started on port {}", port);
                }
            }
        }

        self.child = Some(child);
        Ok(())
    }

    pub async fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
