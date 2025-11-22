use anyhow::{Context, Result};
use clap::Parser;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use sysinfo::{Pid, System};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// The magnet link or torrent file path to handle
    target: String,
}

enum Mode {
    Magnet(String),
    Torrent {
        file_name: String,
        contents_base64: String,
    },
}

#[derive(Deserialize, Debug)]
struct RpcInfo {
    version: u32,
    pid: u32,
    port: u16,
    token: String,
    started: u64,
    last_used: u64,
    browser: BrowserInfo,
}

#[derive(Deserialize, Debug)]
struct BrowserInfo {
    name: String,
    binary: String,
    profile_id: String,
    profile_path: Option<String>,
    extension_id: Option<String>,
}

#[derive(Deserialize, Debug)]
struct HealthResponse {
    status: String,
    pid: u32,
    version: u32,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let target = args.target;

    let mode = if target.starts_with("magnet:") {
        Mode::Magnet(target)
    } else {
        let path = PathBuf::from(&target);
        if !path.exists() {
            eprintln!("Error: File does not exist: {}", target);
            std::process::exit(1);
        }
        let contents = fs::read(&path).context("Failed to read torrent file")?;
        use base64::{Engine as _, engine::general_purpose};
        let contents_base64 = general_purpose::STANDARD.encode(contents);
        
        Mode::Torrent {
            file_name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
            contents_base64,
        }
    };

    // 1. Find valid hosts
    let hosts = find_hosts()?;

    // 2. Try to connect to a host
    for host in hosts {
        if try_send_request(&host, &mode).is_ok() {
            println!("Successfully sent request to host (PID {})", host.pid);
            return Ok(());
        }
    }

    // 3. Fallback: Launch browser
    println!("No running host found. Launching browser...");
    launch_browser()?;

    Ok(())
}

fn find_hosts() -> Result<Vec<RpcInfo>> {
    let config_dir = dirs::config_dir().ok_or_else(|| anyhow::anyhow!("No config dir"))?;
    let app_dir = config_dir.join("jstorrent-native-host");
    
    if !app_dir.exists() {
        return Ok(vec![]);
    }

    let mut hosts = Vec::new();
    let mut system = System::new_all();
    system.refresh_all();

    for entry in fs::read_dir(app_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                if filename.starts_with("rpc-info-") {
                    if let Ok(file) = fs::File::open(&path) {
                        if let Ok(info) = serde_json::from_reader::<_, RpcInfo>(file) {
                            // Validate PID
                            if system.process(Pid::from(info.pid as usize)).is_some() {
                                hosts.push(info);
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort by last_used (descending)
    hosts.sort_by(|a, b| b.last_used.cmp(&a.last_used));

    Ok(hosts)
}

fn try_send_request(info: &RpcInfo, mode: &Mode) -> Result<()> {
    let client = Client::new();
    let base_url = format!("http://127.0.0.1:{}", info.port);

    // Check health
    let health_url = format!("{}/health?token={}", base_url, info.token);
    let resp = client.get(&health_url).send()?;
    if !resp.status().is_success() {
        return Err(anyhow::anyhow!("Health check failed"));
    }

    // Send request
    let (url, body) = match mode {
        Mode::Magnet(magnet) => (
            format!("{}/add-magnet?token={}", base_url, info.token),
            serde_json::json!({ "magnet": magnet }),
        ),
        Mode::Torrent { file_name, contents_base64 } => (
            format!("{}/add-torrent?token={}", base_url, info.token),
            serde_json::json!({ "file_name": file_name, "contents_base64": contents_base64 }),
        ),
    };

    let resp = client.post(&url).json(&body).send()?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err(anyhow::anyhow!("Failed to add request"))
    }
}

fn launch_browser() -> Result<()> {
    // Try to find the most recently used profile info from disk, even if process is dead
    // For now, let's just try to launch the default browser or a specific one if we can guess.
    
    // Ideally we should read the rpc-info files again (without PID check) to find the browser path.
    // But for simplicity, let's assume we can just open the URL with the system default handler 
    // IF we can construct a chrome-extension:// URL.
    
    // But we don't know the extension ID unless we read a config file.
    // Let's try to read the config files again.
    
    let config_dir = dirs::config_dir().ok_or_else(|| anyhow::anyhow!("No config dir"))?;
    let app_dir = config_dir.join("jstorrent-native-host");
    
    let mut best_info: Option<RpcInfo> = None;
    
    if app_dir.exists() {
        for entry in fs::read_dir(app_dir)? {
            let entry = entry?;
            let path = entry.path();
            if let Ok(file) = fs::File::open(&path) {
                if let Ok(info) = serde_json::from_reader::<_, RpcInfo>(file) {
                    if best_info.is_none() || info.last_used > best_info.as_ref().unwrap().last_used {
                        best_info = Some(info);
                    }
                }
            }
        }
    }
    
    if let Some(info) = best_info {
        if let Some(ext_id) = info.browser.extension_id {
            // Construct URL: chrome-extension://<id>/magnet-handler.html?magnet=<magnet>
            // Note: The extension needs to support this page.
            // Assuming the design doc implies the extension handles this.
            
            let url = format!(
                "chrome-extension://{}/magnet-handler.html?source=stub",
                ext_id
            );
            
            println!("Launching browser: {} with URL: {}", info.browser.binary, url);
            
            // Launch browser
            // We use the binary path from info
            Command::new(&info.browser.binary)
                .arg(url)
                // .arg(format!("--profile-directory={}", info.browser.profile_id)) // Optional, might be tricky if profile_id is "Default" vs path
                .spawn()
                .context("Failed to launch browser")?;
                
            return Ok(());
        }
    }
    
    // Fallback: If we can't find config or extension ID, we can't do much.
    // We could try to open the magnet link directly, but that would just loop back to us!
    // So we must error out if we can't find the extension.
    
    Err(anyhow::anyhow!("Could not determine browser/extension to launch."))
}
