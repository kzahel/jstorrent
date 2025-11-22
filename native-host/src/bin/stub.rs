use anyhow::{Context, Result};
use clap::Parser;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::thread;
use std::time::Duration;
use sysinfo::{Pid, System};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use std::ffi::OsStr;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;

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

fn main() {
    if let Err(e) = run() {
        show_error(&format!("JSTorrent could not process your link.\n\nReason: {}", e));
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let args = Args::parse();
    let target = args.target;

    // 1. Parse Input
    let mode = if target.starts_with("magnet:") {
        Mode::Magnet(target)
    } else {
        let path = PathBuf::from(&target);
        if !path.exists() {
            return Err(anyhow::anyhow!("File does not exist: {}", target));
        }
        let contents = fs::read(&path).context("Failed to read torrent file")?;
        use base64::{Engine as _, engine::general_purpose};
        let contents_base64 = general_purpose::STANDARD.encode(contents);
        
        Mode::Torrent {
            file_name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
            contents_base64,
        }
    };

    // 2. Check for existing host
    let mut host_info = find_running_host();

    // 3. If not found, launch browser
    if host_info.is_none() {
        launch_browser()?;
        
        // 4. Poll for host startup
        host_info = wait_for_host()?;
    }

    let info = host_info.ok_or_else(|| anyhow::anyhow!("Failed to connect to JSTorrent Native Host"))?;

    // 5. Send Payload
    send_payload(&info, &mode)?;

    Ok(())
}

fn find_running_host() -> Option<RpcInfo> {
    let config_dir = dirs::config_dir()?;
    let app_dir = config_dir.join("jstorrent-native-host");
    
    if !app_dir.exists() {
        return None;
    }

    let mut system = System::new_all();
    system.refresh_all();

    if let Ok(entries) = fs::read_dir(app_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                    if filename.starts_with("rpc-info-") {
                        if let Ok(file) = fs::File::open(&path) {
                            if let Ok(info) = serde_json::from_reader::<_, RpcInfo>(file) {
                                if system.process(Pid::from(info.pid as usize)).is_some() {
                                    return Some(info);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

fn wait_for_host() -> Result<Option<RpcInfo>> {
    let timeout = Duration::from_secs(10);
    let start = std::time::Instant::now();
    let poll_interval = Duration::from_millis(200);

    while start.elapsed() < timeout {
        if let Some(info) = find_running_host() {
            // Verify health
            if check_health(&info).is_ok() {
                return Ok(Some(info));
            }
        }
        thread::sleep(poll_interval);
    }
    
    Err(anyhow::anyhow!("Timed out waiting for native host to start"))
}

fn check_health(info: &RpcInfo) -> Result<()> {
    let client = Client::builder().timeout(Duration::from_secs(1)).build()?;
    let url = format!("http://127.0.0.1:{}/health?token={}", info.port, info.token);
    let resp = client.get(&url).send()?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(anyhow::anyhow!("Health check failed"))
    }
}

fn get_launch_url() -> String {
    // Check for launcher.env override
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            let env_path = dir.join("launcher.env");
            if env_path.exists() {
                if let Ok(content) = fs::read_to_string(env_path) {
                    for line in content.lines() {
                        if let Some(url) = line.strip_prefix("LAUNCH_URL=") {
                            return url.trim().to_string();
                        }
                    }
                }
            }
        }
    }
    "https://new.jstorrent.com/launch".to_string()
}

fn launch_browser() -> Result<()> {
    let url = get_launch_url();
    
    // Try to find browser from previous runs (rpc-info files, even if dead)
    // For simplicity, we'll just use system default open for now, or fallback to known browsers if needed.
    // The design doc says: "If previous rpc-info has browser binary -> try that first."
    
    // Let's try to find a previous binary
    let binary = find_previous_browser_binary();
    
    if let Some(bin) = binary {
        // Try launching specific binary
        if Command::new(&bin).arg(&url).spawn().is_ok() {
            return Ok(());
        }
    }

    // Fallback to system open
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open").arg(&url).spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(&url).spawn()?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd").args(["/C", "start", &url]).spawn()?;
    }

    Ok(())
}

fn find_previous_browser_binary() -> Option<String> {
    let config_dir = dirs::config_dir()?;
    let app_dir = config_dir.join("jstorrent-native-host");
    
    if !app_dir.exists() {
        return None;
    }

    let mut best_info: Option<RpcInfo> = None;
    
    if let Ok(entries) = fs::read_dir(app_dir) {
        for entry in entries.flatten() {
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
    
    best_info.map(|i| i.browser.binary)
}

fn send_payload(info: &RpcInfo, mode: &Mode) -> Result<()> {
    let client = Client::new();
    let base_url = format!("http://127.0.0.1:{}", info.port);

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
        Err(anyhow::anyhow!("Failed to add request: {}", resp.status()))
    }
}

fn show_error(msg: &str) {
    #[cfg(target_os = "windows")]
    {
        unsafe {
            let wide_msg: Vec<u16> = OsStr::new(msg).encode_wide().chain(std::iter::once(0)).collect();
            let wide_title: Vec<u16> = OsStr::new("JSTorrent Error").encode_wide().chain(std::iter::once(0)).collect();
            MessageBoxW(0, wide_msg.as_ptr(), wide_title.as_ptr(), MB_ICONERROR | MB_OK);
        }
    }

    #[cfg(target_os = "macos")]
    {
        let script = format!("display alert \"JSTorrent Error\" message \"{}\"", msg.replace("\"", "\\\""));
        let _ = Command::new("osascript").arg("-e").arg(script).output();
    }

    #[cfg(target_os = "linux")]
    {
        if Command::new("zenity").arg("--error").arg(format!("--text={}", msg)).output().is_err() {
             if Command::new("kdialog").arg("--error").arg(msg).output().is_err() {
                 eprintln!("{}", msg);
             }
        }
    }
}
