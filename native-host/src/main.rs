
mod atomic_move;
mod folder_picker;
mod fs;
mod hashing;
mod ipc;
mod path_safety;
mod protocol;
mod rpc;
mod state;
mod tcp;
mod udp;

use anyhow::{Context, Result};
use protocol::{Event, Operation, Request, Response, ResponsePayload};
use state::State;
use tokio::io::{self, AsyncWriteExt};
use tokio::sync::mpsc;
use std::path::PathBuf;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<()> {
    let mut stdin = io::stdin();
    let mut stdout = io::stdout();

    let (event_tx, mut event_rx) = mpsc::channel(32);
    
    // Initialize state with event sender
    let download_root = dirs::download_dir().unwrap_or_else(|| PathBuf::from("."));
    let state = Arc::new(State::new(download_root, Some(event_tx.clone())));

    // Start RPC server
    let (port, token) = rpc::start_server(state.clone()).await;
    
    // Write discovery file
    let info = rpc::RpcInfo {
        version: 1,
        pid: std::process::id(),
        port,
        token,
        started: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        last_used: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        browser: rpc::BrowserInfo {
            name: "Unknown".to_string(), // TODO: Infer from parent process?
            binary: std::env::current_exe().unwrap_or_default().to_string_lossy().to_string(),
            profile_id: "Default".to_string(), // TODO: Infer from args/env
            profile_path: None,
            extension_id: None, // TODO: Infer
        },
    };
    
    if let Err(e) = rpc::write_discovery_file(info) {
        eprintln!("Failed to write discovery file: {}", e);
    }

    // Spawn a task to read from stdin
    let (req_tx, mut req_rx) = mpsc::channel::<Event>(100);

    loop {
        tokio::select! {
            // Handle incoming requests
            msg_res = ipc::read_message(&mut stdin) => {
                match msg_res {
                    Ok(Some(msg_bytes)) => {
                        let req: Request = match serde_json::from_slice(&msg_bytes) {
                            Ok(req) => req,
                            Err(e) => {
                                eprintln!("Failed to parse request: {}", e);
                                continue;
                            }
                        };

                        let response = handle_request(&state, req, event_tx.clone()).await;
                        if let Err(e) = ipc::write_message(&mut stdout, &response).await {
                            eprintln!("Failed to write response: {}", e);
                            break;
                        }
                    }
                    Ok(None) => {
                        // EOF
                        break;
                    }
                    Err(e) => {
                        eprintln!("Error reading message: {}", e);
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
        }
    }

    Ok(())
}

async fn handle_request(
    state: &State,
    req: Request,
    event_tx: mpsc::Sender<Event>,
) -> Response {
    let result = match req.op {
        Operation::OpenTcp { host, port } => tcp::open_tcp(state, host, port, event_tx).await,
        Operation::WriteTcp { socket_id, data } => tcp::write_tcp(state, socket_id, data).await,
        Operation::CloseTcp { socket_id } => tcp::close_tcp(state, socket_id).await,
        
        Operation::OpenUdp { bind_host, bind_port } => udp::open_udp(state, bind_host, bind_port, event_tx).await,
        Operation::SendUdp { socket_id, remote_host, remote_port, data } => udp::send_udp(state, socket_id, remote_host, remote_port, data).await,
        Operation::CloseUdp { socket_id } => udp::close_udp(state, socket_id).await,

        Operation::SetDownloadRoot { path } => fs::set_download_root(state, path).await,
        Operation::EnsureDir { path } => fs::ensure_dir(state, path).await,
        Operation::ReadFile { path, offset, length } => fs::read_file(state, path, offset, length).await,
        Operation::WriteFile { path, offset, data } => fs::write_file(state, path, offset, data).await,
        Operation::StatFile { path } => fs::stat_file(state, path).await,

        Operation::AtomicMove { from, to, overwrite } => atomic_move::atomic_move(state, from, to, overwrite).await,
        
        Operation::PickDownloadDirectory => folder_picker::pick_download_directory(state).await,
        
        Operation::HashSha1 { data } => hashing::hash_sha1(data).await,
        Operation::HashFile { path, offset, length } => hashing::hash_file(state, path, offset, length).await,
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
