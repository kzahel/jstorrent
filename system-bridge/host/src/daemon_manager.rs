use anyhow::{Context, Result};
use std::process::{Child, Command, Stdio};
use std::io::{BufRead, BufReader};

pub struct DaemonManager {
    child: Option<Child>,
    pub port: Option<u16>,
    pub token: Option<String>,
}

impl DaemonManager {
    pub fn new() -> Self {
        Self {
            child: None,
            port: None,
            token: None,
        }
    }

    pub async fn start(&mut self, install_id: &str) -> Result<()> {
        let exe_path = std::env::current_exe()?;
        let exe_dir = exe_path.parent().context("Failed to get executable directory")?;
        
        // Assume io-daemon is in the same directory
        let daemon_path = exe_dir.join("jstorrent-io-daemon");
        
        let token = uuid::Uuid::new_v4().to_string();
        self.token = Some(token.clone());

        // TODO: Pass token via stdin or temp file instead of command line arg.
        // Command line args are visible in `ps aux` output which is a security concern.
        let mut cmd = Command::new(daemon_path);
        cmd.arg("--port")
            .arg("0") // Let OS pick port
            .arg("--token")
            .arg(&token)
            .arg("--parent-pid")
            .arg(std::process::id().to_string())
            .arg("--install-id")
            .arg(install_id)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        // Pass DEV_ORIGINS from env file if set (for CORS in dev mode)
        if let Some(dev_origins) = jstorrent_common::read_env_value("DEV_ORIGINS") {
            cmd.env("JSTORRENT_DEV_ORIGINS", dev_origins);
        }

        let mut child = cmd.spawn().context("Failed to spawn io-daemon")?;

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

    pub async fn refresh_config(&self) -> Result<()> {
        if let (Some(port), Some(token)) = (self.port, &self.token) {
            let client = reqwest::Client::new();
            let url = format!("http://127.0.0.1:{}/api/read-rpc-info-from-disk", port);
            
            // We don't really need to wait for response, but it's good to log errors
            let res = client.post(&url)
                .header("Authorization", format!("Bearer {}", token))
                .send()
                .await?;
                
            if !res.status().is_success() {
                crate::log!("Failed to refresh daemon config: {}", res.status());
                return Err(anyhow::anyhow!("Failed to refresh daemon config: {}", res.status()));
            }
            crate::log!("Daemon config refresh triggered successfully");
        }
        Ok(())
    }


    pub async fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
