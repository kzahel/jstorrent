
mod folder_picker;
mod ipc;
mod path_safety;
mod protocol;
mod rpc;
mod state;
mod logging;
mod daemon_manager;

use anyhow::Result;
use protocol::{Event, Operation, Request, Response, ResponsePayload};
use state::State;
use tokio::io::{self, AsyncWriteExt};
use tokio::sync::mpsc;
use std::path::PathBuf;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<()> {
    logging::init("jstorrent-native-host.log");
    log!("Native Host started. PID: {}", std::process::id());

    let mut stdin = io::stdin();
    let mut stdout = io::stdout();

    let (event_tx, mut event_rx) = mpsc::channel(32);
    
    // Initialize state with event sender
    let download_root = dirs::download_dir().unwrap_or_else(|| PathBuf::from("."));
    let state = Arc::new(State::new(download_root, Some(event_tx.clone())));

    // Start Daemon
    // Start Daemon - DELAYED until Handshake
    let mut daemon_manager = daemon_manager::DaemonManager::new(state.clone());
    // if let Err(e) = daemon_manager.start().await {
    //     log!("Failed to start daemon: {}", e);
    //     // We continue, but the extension might fail to connect
    // }


    // Start RPC server (Legacy? Or still needed for link-handler?)
    // The design doc says link-handler talks to native-host via "minimal RPC".
    // So we keep rpc.rs.
    let (port, token) = rpc::start_server(state.clone()).await;
    
    // Initialize system info to find parent process (the browser)
    let mut system = sysinfo::System::new_all();
    system.refresh_all();
    
    let mut current_pid = sysinfo::Pid::from(std::process::id() as usize);
    let mut browser_binary = String::new();
    let mut browser_name = "Unknown".to_string();

    // Walk up the process tree to find the best candidate
    // Priority:
    // 1. Known browser (Chrome, Firefox, etc.)
    // 2. First parent that is NOT the native host itself (or a wrapper)
    
    let mut fallback_binary = String::new();
    let mut fallback_name = String::new();

    for _ in 0..10 { // Increase depth to 10 just in case
        if let Some(process) = system.process(current_pid) {
            if let Some(parent) = process.parent() {
                current_pid = parent;
                if let Some(parent_proc) = system.process(current_pid) {
                    let name = parent_proc.name().to_lowercase();
                    let exe = parent_proc.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
                    
                    // Check if this is likely the host itself or a wrapper
                    let is_host_or_wrapper = name.contains("jstorrent") || name.contains("native-host") || exe.contains("jstorrent") || exe.contains("native-host");
                    
                    if !is_host_or_wrapper {
                        // Check for known browsers
                        if name.contains("chrome") || name.contains("firefox") || name.contains("brave") || name.contains("edge") || name.contains("safari") || name.contains("opera") || name.contains("vivaldi") || name.contains("arc") {
                            browser_binary = exe;
                            browser_name = parent_proc.name().to_string();
                            break;
                        }
                        
                        // If we haven't found a fallback yet, this is our first non-host parent
                        if fallback_binary.is_empty() && !exe.is_empty() {
                            fallback_binary = exe;
                            fallback_name = parent_proc.name().to_string();
                        }
                    }
                }
            } else {
                break;
            }
        } else {
            break;
        }
    }

    // If we didn't find a known browser, use the fallback
    if browser_binary.is_empty() && !fallback_binary.is_empty() {
        browser_binary = fallback_binary;
        browser_name = fallback_name;
    }

    // Extract extension ID from args (if present)
    // Chrome passes origin as first argument: chrome-extension://<id>/
    let mut extension_id = None;
    for arg in std::env::args().skip(1) {
        if arg.starts_with("chrome-extension://") {
            extension_id = arg.trim_start_matches("chrome-extension://")
                .trim_end_matches('/')
                .to_string()
                .into();
            break;
        }
    }

    // Write discovery file
    let info = rpc::RpcInfo {
        version: 1,
        pid: std::process::id(),
        port,
        token,
        started: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        last_used: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        browser: rpc::BrowserInfo {
            name: browser_name,
            binary: browser_binary,
            extension_id: extension_id.clone(),
        },
        salt: uuid::Uuid::new_v4().to_string(),
        download_roots: Vec::new(),
        install_id: None,
    };
    
    // Store info in state so we can update it later (e.g. on handshake)
    if let Ok(mut info_guard) = state.rpc_info.lock() {
        *info_guard = Some(info.clone());
    }
    
    match rpc::write_discovery_file(info) {
        Ok(roots) => {
            // Update roots in state
            if let Ok(mut info_guard) = state.rpc_info.lock() {
                if let Some(info) = info_guard.as_mut() {
                    info.download_roots = roots;
                }
            }
        },
        Err(e) => eprintln!("Failed to write discovery file: {}", e),
    }

    // Spawn a task to read from stdin


    loop {
        tokio::select! {
            // Handle incoming requests
            msg_res = ipc::read_message(&mut stdin) => {
                match msg_res {
                    Ok(Some(msg_bytes)) => {
                        let req: Request = match serde_json::from_slice(&msg_bytes) {
                            Ok(req) => req,
                            Err(e) => {
                                log!("Failed to parse request: {}", e);
                                continue;
                            }
                        };
                        
                        log!("Received request: {:?}", req);

                        let response = handle_request(&state, req, event_tx.clone(), &mut daemon_manager).await;
                        log!("Sending response: {:?}", response);
                        
                        if let Err(e) = ipc::write_message(&mut stdout, &response).await {
                            log!("Failed to write response: {}", e);
                            break;
                        }
                    }
                    Ok(None) => {
                        // EOF
                        log!("Stdin EOF received. Exiting.");
                        break;
                    }
                    Err(e) => {
                        log!("Error reading message: {}", e);
                        break;
                    }
                }
            }

            // Handle outgoing events
            Some(event) = event_rx.recv() => {
                if let Err(e) = ipc::write_message(&mut stdout, &event).await {
                    eprintln!("Failed to write event: {}", e);
                    break;
                }
            }

            // Handle shutdown signal
            _ = tokio::signal::ctrl_c() => {
                log!("Received Ctrl-C, shutting down...");
                break;
            }
        }
    }

    // Stop daemon
    daemon_manager.stop().await;

    log!("Native Host finished.");

    Ok(())
}

async fn handle_request(
    state: &State,
    req: Request,
    _event_tx: mpsc::Sender<Event>,
    daemon_manager: &mut daemon_manager::DaemonManager,
) -> Response {
    let result = match req.op {
        Operation::PickDownloadDirectory => {
            let res = folder_picker::pick_download_directory(state).await;
            if let Ok(_) = res {
                 // If successful, refresh daemon config
                 if let Err(e) = daemon_manager.refresh_config().await {
                     log!("Failed to refresh daemon config: {}", e);
                 }
            }
            res
        },

        
        Operation::Handshake { extension_id, install_id } => {
            log!("Handling Handshake for extension_id: {}, install_id: {}", extension_id, install_id);
            // Update extension ID and install ID in state and rewrite discovery file
            let mut success = false;
            if let Ok(mut info_guard) = state.rpc_info.lock() {
                if let Some(info) = info_guard.as_mut() {
                    info.browser.extension_id = Some(extension_id);
                    info.install_id = Some(install_id.clone()); // Update install_id
                    match crate::rpc::write_discovery_file(info.clone()) {
                        Ok(roots) => {
                            info.download_roots = roots;
                            success = true;
                        },
                        Err(e) => eprintln!("Failed to update discovery file on handshake: {}", e),
                    }
                }
            }
            
            if success {
                let start_result = if daemon_manager.port.is_none() {
                     log!("Starting daemon with install_id: {}", install_id);
                     daemon_manager.start(&install_id).await
                } else {
                    let _ = daemon_manager.refresh_config().await;
                    Ok(())
                };

                if let Err(e) = start_result {
                    log!("Failed to start daemon: {}", e);
                    Err(anyhow::anyhow!("Failed to start daemon"))
                } else {
                    log!("Handshake success, checking daemon info: {:?} {:?}", daemon_manager.port, daemon_manager.token);
                    if let (Some(port), Some(token)) = (daemon_manager.port, daemon_manager.token.clone()) {
                         // Get roots from rpc_info
                         let roots = state.rpc_info.lock().unwrap()
                             .as_ref()
                             .map(|info| info.download_roots.clone())
                             .unwrap_or_default();
                         
                         Ok(ResponsePayload::DaemonInfo { port, token, roots })
                    } else {
                         log!("Daemon info missing");
                         Err(anyhow::anyhow!("Daemon not running"))
                    }
                }
            } else {
                log!("Handshake failed to update state");
                Err(anyhow::anyhow!("Failed to update extension ID or install ID"))
            }
        }
    };

    match result {
        Ok(payload) => Response {
            id: req.id,
            ok: true,
            error: None,
            payload,
        },
        Err(e) => Response {
            id: req.id,
            ok: false,
            error: Some(e.to_string()),
            payload: ResponsePayload::Empty,
        },
    }
}
