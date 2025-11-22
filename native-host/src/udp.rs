use crate::protocol::{Event, ResponsePayload};
use crate::state::State;
use anyhow::{Context, Result};
use base64::{engine::general_purpose, Engine as _};
use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::sync::mpsc;

pub struct UdpState {
    pub socket: Arc<UdpSocket>,
}

pub async fn open_udp(
    state: &State,
    bind_host: Option<String>,
    bind_port: Option<u16>,
    event_tx: mpsc::Sender<Event>,
) -> Result<ResponsePayload> {
    let host = bind_host.unwrap_or_else(|| "0.0.0.0".to_string());
    let port = bind_port.unwrap_or(0);
    let addr = format!("{}:{}", host, port);

    let socket = UdpSocket::bind(&addr)
        .await
        .context("Failed to bind UDP socket")?;
    let socket = Arc::new(socket);
    let socket_id = state.next_id();

    state
        .udp_sockets
        .lock()
        .unwrap()
        .insert(socket_id, UdpState { socket: socket.clone() });

    // Spawn read task
    tokio::spawn(async move {
        let mut buf = [0u8; 64 * 1024]; // 64KB buffer
        loop {
            match socket.recv_from(&mut buf).await {
                Ok((n, peer)) => {
                    let data = general_purpose::STANDARD.encode(&buf[..n]);
                    let remote_host = peer.ip().to_string();
                    let remote_port = peer.port();

                    if event_tx
                        .send(Event::UdpData {
                            socket_id,
                            data,
                            remote_host,
                            remote_port,
                        })
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(e) => {
                    let _ = event_tx
                        .send(Event::UdpError {
                            socket_id,
                            error: e.to_string(),
                        })
                        .await;
                    break;
                }
            }
        }
    });

    Ok(ResponsePayload::SocketId { socket_id })
}

pub async fn send_udp(
    state: &State,
    socket_id: u32,
    remote_host: String,
    remote_port: u16,
    data_b64: String,
) -> Result<ResponsePayload> {
    let sockets = state.udp_sockets.lock().unwrap();
    let socket_state = sockets
        .get(&socket_id)
        .context("Socket not found")?;

    let data = general_purpose::STANDARD
        .decode(data_b64)
        .context("Invalid base64 data")?;
    let remote_addr = format!("{}:{}", remote_host, remote_port);

    socket_state
        .socket
        .send_to(&data, &remote_addr)
        .await
        .context("Failed to send UDP packet")?;

    Ok(ResponsePayload::Empty)
}

pub async fn close_udp(state: &State, socket_id: u32) -> Result<ResponsePayload> {
    if state.udp_sockets.lock().unwrap().remove(&socket_id).is_some() {
        Ok(ResponsePayload::Empty)
    } else {
        Err(anyhow::anyhow!("Socket not found"))
    }
}
