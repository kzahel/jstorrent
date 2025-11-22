use crate::protocol::{Event, ResponsePayload};
use crate::state::State;
use anyhow::{Context, Result};
use base64::{engine::general_purpose, Engine as _};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

pub struct TcpState {
    pub writer: tokio::net::tcp::OwnedWriteHalf,
}

pub async fn open_tcp(
    state: &State,
    host: String,
    port: u16,
    event_tx: mpsc::Sender<Event>,
) -> Result<ResponsePayload> {
    let addr = format!("{}:{}", host, port);
    let stream = TcpStream::connect(&addr)
        .await
        .context("Failed to connect to TCP host")?;

    let (mut reader, writer) = stream.into_split();
    let socket_id = state.next_id();

    state.tcp_sockets.lock().unwrap().insert(socket_id, TcpState { writer });

    // Spawn read task
    tokio::spawn(async move {
        let mut buf = [0u8; 64 * 1024]; // 64KB buffer
        loop {
            match reader.read(&mut buf).await {
                Ok(0) => {
                    // EOF
                    let _ = event_tx
                        .send(Event::TcpClosed { socket_id })
                        .await;
                    break;
                }
                Ok(n) => {
                    let data = general_purpose::STANDARD.encode(&buf[..n]);
                    if event_tx
                        .send(Event::TcpData { socket_id, data })
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(e) => {
                    let _ = event_tx
                        .send(Event::TcpError {
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

pub async fn write_tcp(
    state: &State,
    socket_id: u32,
    data_b64: String,
) -> Result<ResponsePayload> {
    let mut sockets = state.tcp_sockets.lock().unwrap();
    let socket = sockets
        .get_mut(&socket_id)
        .context("Socket not found")?;

    let data = general_purpose::STANDARD
        .decode(data_b64)
        .context("Invalid base64 data")?;

    socket
        .writer
        .write_all(&data)
        .await
        .context("Failed to write to socket")?;

    Ok(ResponsePayload::Empty)
}

pub async fn close_tcp(state: &State, socket_id: u32) -> Result<ResponsePayload> {
    if state.tcp_sockets.lock().unwrap().remove(&socket_id).is_some() {
        Ok(ResponsePayload::Empty)
    } else {
        Err(anyhow::anyhow!("Socket not found"))
    }
}
