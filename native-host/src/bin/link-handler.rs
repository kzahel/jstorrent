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
use jstorrent_common::{UnifiedRpcInfo, ProfileEntry, BrowserInfo, DownloadRoot, get_config_dir};

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
struct HealthResponse {
    status: String,
    pid: u32,
    version: u32,
}

#[path = "../logging.rs"]
mod logging;

fn main() {
    logging::init("jstorrent-log-handler.log");
    log!("Link Handler started. PID: {}", std::process::id());

    // Set up signal handler
    if let Err(e) = ctrlc::set_handler(move || {
        log!("Received signal, shutting down...");
        std::process::exit(0);
    }) {
        log!("Error setting Ctrl-C handler: {}", e);
    }

    let args = Args::parse();
    let target = args.target.clone();

    if let Err(e) = run(args) {
        show_error(&format!("JSTorrent could not process your link.\n\nReason: {}", e), Some(&target));
        std::process::exit(1);
    }

    log!("Link Handler finished successfully.");
}

fn run(args: Args) -> Result<()> {
    let target = args.target;
    log!("DEBUG: Starting JSTorrent Link Handler");
    log!("DEBUG: Target: {}", target);

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
    log!("DEBUG: Checking for running host...");
    let mut host_info = find_running_host();

    // 3. If not found, launch browser
    if host_info.is_none() {
        log!("DEBUG: No running host found. Launching browser...");
        launch_browser()?;
        
        // 4. Poll for host startup
        log!("DEBUG: Waiting for host to start...");
        host_info = wait_for_host()?;
    } else {
        log!("DEBUG: Found running host.");
    }

    let info = host_info.ok_or_else(|| anyhow::anyhow!("Failed to connect to JSTorrent Native Host"))?;

    // 5. Send Payload
    log!("DEBUG: Sending payload to host at port {}...", info.port);
    send_payload(&info, &mode)?;
    log!("DEBUG: Payload sent successfully.");

    Ok(())
}

fn find_running_host() -> Option<ProfileEntry> {
    let config_dir = get_config_dir()?;
    let app_dir = config_dir.join("jstorrent-native");
    let rpc_file = app_dir.join("rpc-info.json");
    
    if !rpc_file.exists() {
        return None;
    }

    let mut system = System::new_all();
    system.refresh_all();

    if let Ok(file) = fs::File::open(&rpc_file) {
        if let Ok(mut info) = serde_json::from_reader::<_, UnifiedRpcInfo>(file) {
            // Sort profiles by last_used descending
            info.profiles.sort_by(|a, b| b.last_used.cmp(&a.last_used));
            
            for profile in info.profiles {
                // Check if PID is running
                if system.process(Pid::from(profile.pid as usize)).is_some() {
                    // Check health
                    if check_health(&profile).is_ok() {
                        return Some(profile);
                    }
                }
            }
        }
    }
    None
}

fn wait_for_host() -> Result<Option<ProfileEntry>> {
    let timeout = Duration::from_secs(10);
    let start = std::time::Instant::now();
    let poll_interval = Duration::from_millis(200);

    while start.elapsed() < timeout {
        if let Some(info) = find_running_host() {
            return Ok(Some(info));
        }
        thread::sleep(poll_interval);
    }
    
    Err(anyhow::anyhow!("Timed out waiting for native host to start"))
}

fn check_health(info: &ProfileEntry) -> Result<()> {
    let client = Client::builder().timeout(Duration::from_secs(1)).build()?;
    let url = format!("http://127.0.0.1:{}/health?token={}", info.port, info.token);
    let resp = client.get(&url).send()?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(anyhow::anyhow!("Health check failed"))
    }
}

fn get_launcher_env_path() -> Option<PathBuf> {
    // 1. Check ~/.config/jstorrent-native/jstorrent-native.env (or env override)
    if let Some(config_dir) = get_config_dir() {
        let env_path = config_dir.join("jstorrent-native").join("jstorrent-native.env");
        if env_path.exists() {
            return Some(env_path);
        }
    }

    // 2. Fallback to executable directory
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            let env_path = dir.join("jstorrent-native.env");
            if env_path.exists() {
                return Some(env_path);
            }
        }
    }
    None
}

fn get_launch_url() -> String {
    if let Some(env_path) = get_launcher_env_path() {
        if let Ok(content) = fs::read_to_string(env_path) {
            for line in content.lines() {
                if let Some(url) = line.strip_prefix("LAUNCH_URL=") {
                    return url.trim().to_string();
                }
            }
        }
    }
    "https://new.jstorrent.com/launch".to_string()
}

fn launch_browser() -> Result<()> {
    let url = get_launch_url();
    log!("DEBUG: Launch URL: {}", url);
    
    // Try to find browser from previous runs (rpc-info files, even if dead)
    
    // Let's try to find a previous binary
    let binary = find_previous_browser_binary();
    
    if let Some(bin) = binary {
        log!("DEBUG: Found previous browser binary: {}", bin);
        // Try launching specific binary
        if Command::new(&bin).arg(&url).spawn().is_ok() {
            log!("DEBUG: Launched using previous binary.");
            return Ok(());
        } else {
            log!("DEBUG: Failed to launch using previous binary. Falling back to system default.");
        }
    } else {
        log!("DEBUG: No previous browser binary found.");
    }

    // Fallback to system open
    #[cfg(target_os = "linux")]
    {
        log!("DEBUG: Attempting xdg-open...");
        if Command::new("xdg-open").arg(&url).spawn().is_err() {
             return Err(anyhow::anyhow!("Could not launch browser. Please open JSTorrent manually: {}", url));
        }
    }
    #[cfg(target_os = "macos")]
    {
        log!("DEBUG: Attempting open...");
        if Command::new("open").arg(&url).spawn().is_err() {
             return Err(anyhow::anyhow!("Could not launch browser. Please open JSTorrent manually: {}", url));
        }
    }
    #[cfg(target_os = "windows")]
    {
        log!("DEBUG: Attempting cmd /C start...");
        if Command::new("cmd").args(["/C", "start", &url]).spawn().is_err() {
             return Err(anyhow::anyhow!("Could not launch browser. Please open JSTorrent manually: {}", url));
        }
    }

    Ok(())
}

fn find_previous_browser_binary() -> Option<String> {
    let config_dir = get_config_dir()?;
    let app_dir = config_dir.join("jstorrent-native");
    let rpc_file = app_dir.join("rpc-info.json");
    
    if !rpc_file.exists() {
        return None;
    }

    let mut best_binary: Option<String> = None;
    let mut best_time = 0;
    
    if let Ok(file) = fs::File::open(&rpc_file) {
         if let Ok(info) = serde_json::from_reader::<_, UnifiedRpcInfo>(file) {
             for profile in info.profiles {
                 if profile.last_used > best_time {
                     best_time = profile.last_used;
                     best_binary = Some(profile.browser.binary);
                 }
             }
         }
    }
    
    best_binary.filter(|b| {
        let b_lower = b.to_lowercase();
        !b.is_empty() 
        && !b.contains("jstorrent-host")
        && !b_lower.contains("python")
        && !b_lower.contains("cargo")
        && !b_lower.contains("sh")
        && !b_lower.ends_with("/sh")
        && !b_lower.ends_with("/bash")
        && !b_lower.ends_with("/zsh")
        && !b_lower.ends_with("/fish")
        && !b_lower.contains("terminal")
        && !b_lower.contains("console")
    })
}

fn send_payload(info: &ProfileEntry, mode: &Mode) -> Result<()> {
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

    log!("DEBUG: Posting to URL: {}", url);
    let resp = client.post(&url).json(&body).send()?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err(anyhow::anyhow!("Failed to add request: {}", resp.status()))
    }
}

fn show_error(msg: &str, link: Option<&str>) {
    let full_msg = if let Some(l) = link {
        format!("{}\n\nLink: {}", msg, l)
    } else {
        msg.to_string()
    };

    // Always print to stderr for debugging/logging
    log!("{}", full_msg);

    #[cfg(target_os = "windows")]
    {
        unsafe {
            let wide_msg: Vec<u16> = OsStr::new(&full_msg).encode_wide().chain(std::iter::once(0)).collect();
            let wide_title: Vec<u16> = OsStr::new("JSTorrent Error").encode_wide().chain(std::iter::once(0)).collect();
            MessageBoxW(0, wide_msg.as_ptr(), wide_title.as_ptr(), MB_ICONERROR | MB_OK);
        }
    }

    #[cfg(target_os = "macos")]
    {
        let script = format!("display alert \"JSTorrent Error\" message \"{}\"", full_msg.replace("\"", "\\\""));
        let _ = Command::new("osascript").arg("-e").arg(script).output();
    }

    #[cfg(target_os = "linux")]
    {
        let zenity_ok = Command::new("zenity")
            .arg("--error")
            .arg(format!("--text={}", full_msg))
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if !zenity_ok {
             let kdialog_ok = Command::new("kdialog")
                 .arg("--error")
                 .arg(&full_msg)
                 .output()
                 .map(|o| o.status.success())
                 .unwrap_or(false);
                 
             if !kdialog_ok {
                 log!("{}", full_msg);
             }
        }
    }
}
