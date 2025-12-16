use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
    response::Response,
    routing::get,
    Router,
};
use futures::{sink::SinkExt, stream::StreamExt};
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use socket2::{SockRef, Socket, Domain, Type, Protocol};
use tokio::sync::mpsc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::{timeout, Duration};
use std::collections::HashMap;
use tokio::sync::Mutex;
use crate::AppState;


// Opcodes
const OP_CLIENT_HELLO: u8 = 0x01;
const OP_SERVER_HELLO: u8 = 0x02;
const OP_AUTH: u8 = 0x03;
const OP_AUTH_RESULT: u8 = 0x04;
const OP_ERROR: u8 = 0x7F;

const OP_TCP_CONNECT: u8 = 0x10;
const OP_TCP_CONNECTED: u8 = 0x11;
const OP_TCP_SEND: u8 = 0x12;
const OP_TCP_RECV: u8 = 0x13;
const OP_TCP_CLOSE: u8 = 0x14;

// TCP Server opcodes
const OP_TCP_LISTEN: u8 = 0x15;
const OP_TCP_LISTEN_RESULT: u8 = 0x16;
const OP_TCP_ACCEPT: u8 = 0x17;
const OP_TCP_STOP_LISTEN: u8 = 0x18;

const OP_UDP_BIND: u8 = 0x20;
const OP_UDP_BOUND: u8 = 0x21;
const OP_UDP_SEND: u8 = 0x22;
const OP_UDP_RECV: u8 = 0x23;
const OP_UDP_CLOSE: u8 = 0x24;
const OP_UDP_JOIN_MULTICAST: u8 = 0x25;
const OP_UDP_LEAVE_MULTICAST: u8 = 0x26;

const PROTOCOL_VERSION: u8 = 1;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/io", get(ws_handler))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

struct Envelope {
    version: u8,
    msg_type: u8,
    flags: u16,
    request_id: u32,
}

impl Envelope {
    fn new(msg_type: u8, request_id: u32) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            msg_type,
            flags: 0,
            request_id,
        }
    }

    fn to_bytes(&self) -> [u8; 8] {
        let mut bytes = [0u8; 8];
        bytes[0] = self.version;
        bytes[1] = self.msg_type;
        bytes[2..4].copy_from_slice(&self.flags.to_le_bytes());
        bytes[4..8].copy_from_slice(&self.request_id.to_le_bytes());
        bytes
    }

    fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 8 {
            return None;
        }
        Some(Self {
            version: bytes[0],
            msg_type: bytes[1],
            flags: u16::from_le_bytes(bytes[2..4].try_into().unwrap()),
            request_id: u32::from_le_bytes(bytes[4..8].try_into().unwrap()),
        })
    }
}

struct SocketManager {
    tcp_sockets: HashMap<u32, mpsc::Sender<Vec<u8>>>,
    pending_connects: HashMap<u32, tokio::task::AbortHandle>,
    udp_sockets: HashMap<u32, Arc<UdpSocket>>,
    tcp_servers: HashMap<u32, tokio::task::JoinHandle<()>>,
    next_socket_id: u32,
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(100);

    // Task to send binary frames to client
    let mut send_task = tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            if sender.send(Message::Binary(data)).await.is_err() {
                break;
            }
        }
    });

    let socket_manager = Arc::new(Mutex::new(SocketManager {
        tcp_sockets: HashMap::new(),
        pending_connects: HashMap::new(),
        udp_sockets: HashMap::new(),
        tcp_servers: HashMap::new(),
        next_socket_id: 0x10000, // Start high to avoid collision with client-assigned IDs
    }));

    // Authentication State Machine
    let mut authenticated = false;

    // Helper to send message
    let send_msg = |tx: &mpsc::Sender<Vec<u8>>, msg_type: u8, req_id: u32, payload: Vec<u8>| {
        let tx = tx.clone();
        async move {
            let env = Envelope::new(msg_type, req_id);
            let mut data = env.to_bytes().to_vec();
            data.extend_from_slice(&payload);
            tx.send(data).await.ok();
        }
    };

    let send_error = |tx: &mpsc::Sender<Vec<u8>>, req_id: u32, msg: &str| {
        send_msg(tx, OP_ERROR, req_id, msg.as_bytes().to_vec())
    };

    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Binary(data) = msg {
            if data.len() < 8 {
                continue;
            }
            
            let env = match Envelope::from_bytes(&data[..8]) {
                Some(e) => e,
                None => continue,
            };

            if env.version != PROTOCOL_VERSION {
                send_error(&tx, env.request_id, "Invalid protocol version").await;
                break;
            }

            let payload = &data[8..];

            if !authenticated {
                match env.msg_type {
                    OP_CLIENT_HELLO => {
                        // Respond with SERVER_HELLO
                        send_msg(&tx, OP_SERVER_HELLO, env.request_id, vec![]).await;
                    }
                    OP_AUTH => {
                        // Parse AUTH payload
                        // Format: authType(1) + token + '\0' + extensionId + '\0' + installId
                        // Desktop ignores extensionId/installId but must parse them
                        if payload.is_empty() {
                            send_error(&tx, env.request_id, "Empty auth payload").await;
                            break;
                        }

                        let auth_type = payload[0];
                        let data = &payload[1..];

                        let token = match auth_type {
                            0 => {
                                // New format: null-separated fields
                                // Find first null byte to extract token
                                let token_end = data.iter().position(|&b| b == 0).unwrap_or(data.len());
                                String::from_utf8_lossy(&data[..token_end]).to_string()
                            }
                            1 => {
                                // Legacy format: raw token (entire remaining payload)
                                String::from_utf8_lossy(data).to_string()
                            }
                            _ => {
                                send_error(&tx, env.request_id, "Unknown auth type").await;
                                break;
                            }
                        };
                        
                        // Verify token (simple string match for now, or check against state)
                        // In main.rs we generated a token. We need to check it.
                        // But wait, AppState doesn't have the token!
                        // The token was generated in `rpc::start_server` and passed to `DaemonManager`.
                        // The `io-daemon` receives the token as a CLI arg.
                        // We need to store it in `AppState`.
                        
                        if token == state.token {
                            authenticated = true;
                            // Send AUTH_RESULT success (0)
                            send_msg(&tx, OP_AUTH_RESULT, env.request_id, vec![0]).await;
                        } else {
                            // Send AUTH_RESULT failure (1) + message
                            let mut p = vec![1];
                            p.extend_from_slice(b"Invalid token");
                            send_msg(&tx, OP_AUTH_RESULT, env.request_id, p).await;
                            break; // Close connection
                        }
                    }
                    _ => {
                        send_error(&tx, env.request_id, "Authentication required").await;
                        break;
                    }
                }
                continue;
            }

            // Authenticated - Handle I/O
            match env.msg_type {
                OP_TCP_CONNECT => {
                    // Payload: socketId(u4), hostname_len(u2), hostname, port(u2), timeout(u4)
                    // Wait, spec says: socketId(u32), hostname(string), port(u16), timeout(u32)
                    // We need to parse this manually.
                    // Let's assume packed: socketId(4) + hostname_len(2) + hostname + port(2) + timeout(4)
                    // Or maybe just socketId(4) + null-terminated hostname? 
                    // The spec says "Exact byte layout is intentionally omitted".
                    // Let's define a layout:
                    // socketId (4 bytes LE)
                    // port (2 bytes LE)
                    // hostname (rest of payload, utf8)
                    // (Ignoring timeout for simplicity or appending it?)
                    
                    if payload.len() < 6 {
                        continue;
                    }
                    let socket_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
                    let port = u16::from_le_bytes(payload[4..6].try_into().unwrap());
                    let hostname = String::from_utf8_lossy(&payload[6..]).to_string();

                    let manager = socket_manager.clone();
                    let tx_clone = tx.clone();
                    let req_id = env.request_id;

                    let task = tokio::spawn(async move {
                        // 30 second connect timeout - backstop for slow connections (satellite, poor mobile)
                        // The TypeScript engine manages its own adaptive timeout and will cancel earlier
                        let connect_timeout = Duration::from_secs(30);

                        let connect_result = match timeout(
                            connect_timeout,
                            TcpStream::connect(format!("{}:{}", hostname, port))
                        ).await {
                            Ok(result) => result,
                            Err(_) => Err(std::io::Error::new(
                                std::io::ErrorKind::TimedOut,
                                "Connection timeout"
                            )),
                        };

                        match connect_result {
                            Ok(stream) => {
                                let (mut read_half, mut write_half) = stream.into_split();
                                let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(32);

                                // Move from pending to established
                                {
                                    let mut mgr = manager.lock().await;
                                    mgr.pending_connects.remove(&socket_id);
                                    mgr.tcp_sockets.insert(socket_id, write_tx);
                                }
                                
                                // Send TCP_CONNECTED
                                // Payload: socketId(4), status(1 byte=0), errno(4 bytes=0)
                                let mut resp = socket_id.to_le_bytes().to_vec();
                                resp.push(0); // Success
                                resp.extend_from_slice(&0u32.to_le_bytes());
                                
                                let env = Envelope::new(OP_TCP_CONNECTED, req_id);
                                let mut data = env.to_bytes().to_vec();
                                data.extend_from_slice(&resp);
                                tx_clone.send(data).await.ok();

                                // Read task
                                let tx_read = tx_clone.clone();
                                tokio::spawn(async move {
                                    let mut buf = [0u8; 8192];
                                    loop {
                                        match read_half.read(&mut buf).await {
                                            Ok(0) => break, // EOF
                                            Ok(n) => {
                                                // Send TCP_RECV
                                                // Payload: socketId(4) + data
                                                let mut p = socket_id.to_le_bytes().to_vec();
                                                p.extend_from_slice(&buf[..n]);
                                                
                                                let env = Envelope::new(OP_TCP_RECV, 0); // Async event, req_id=0
                                                let mut d = env.to_bytes().to_vec();
                                                d.extend_from_slice(&p);
                                                if tx_read.send(d).await.is_err() {
                                                    break;
                                                }
                                            }
                                            Err(_) => break,
                                        }
                                    }
                                    // Send TCP_CLOSE
                                    // Payload: socketId(4), reason(1), errno(4)
                                    let mut p = socket_id.to_le_bytes().to_vec();
                                    p.push(0); // Normal closure
                                    p.extend_from_slice(&0u32.to_le_bytes());
                                    
                                    let env = Envelope::new(OP_TCP_CLOSE, 0);
                                    let mut d = env.to_bytes().to_vec();
                                    d.extend_from_slice(&p);
                                    tx_read.send(d).await.ok();
                                });

                                // Write task
                                tokio::spawn(async move {
                                    while let Some(data) = write_rx.recv().await {
                                        if write_half.write_all(&data).await.is_err() {
                                            break;
                                        }
                                    }
                                });
                            }
                            Err(_) => {
                                // Remove from pending on failure
                                manager.lock().await.pending_connects.remove(&socket_id);

                                // Send TCP_CONNECTED failure
                                let mut resp = socket_id.to_le_bytes().to_vec();
                                resp.push(1); // Failure
                                resp.extend_from_slice(&1u32.to_le_bytes()); // Generic error

                                let env = Envelope::new(OP_TCP_CONNECTED, req_id);
                                let mut data = env.to_bytes().to_vec();
                                data.extend_from_slice(&resp);
                                tx_clone.send(data).await.ok();
                            }
                        }
                    });

                    // Track pending connection for cancellation
                    socket_manager.lock().await.pending_connects.insert(socket_id, task.abort_handle());
                }
                OP_TCP_SEND => {
                    // Payload: socketId(4) + data
                    if payload.len() >= 4 {
                        let socket_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
                        let data = payload[4..].to_vec();
                        if let Some(sender) = socket_manager.lock().await.tcp_sockets.get(&socket_id) {
                            sender.send(data).await.ok();
                        }
                    }
                }
                OP_TCP_CLOSE => {
                    // Payload: socketId(4)
                    if payload.len() >= 4 {
                        let socket_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
                        let mut mgr = socket_manager.lock().await;

                        // Remove established socket
                        mgr.tcp_sockets.remove(&socket_id);

                        // Cancel pending connect if exists (allows immediate cleanup)
                        if let Some(handle) = mgr.pending_connects.remove(&socket_id) {
                            handle.abort();
                        }
                    }
                }
                OP_TCP_LISTEN => {
                    // Payload: serverId(4), port(2), bind_addr(string)
                    if payload.len() >= 6 {
                        let server_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
                        let port = u16::from_le_bytes(payload[4..6].try_into().unwrap());
                        let bind_addr = String::from_utf8_lossy(&payload[6..]).to_string();
                        let addr = if bind_addr.is_empty() {
                            format!("0.0.0.0:{}", port)
                        } else {
                            format!("{}:{}", bind_addr, port)
                        };

                        let manager = socket_manager.clone();
                        let tx_clone = tx.clone();
                        let req_id = env.request_id;

                        tokio::spawn(async move {
                            match TcpListener::bind(&addr).await {
                                Ok(listener) => {
                                    let bound_port = listener.local_addr().map(|a| a.port()).unwrap_or(0);

                                    // Send TCP_LISTEN_RESULT success
                                    // Payload: serverId(4), status(1), boundPort(2), errno(4)
                                    let mut resp = server_id.to_le_bytes().to_vec();
                                    resp.push(0); // Success
                                    resp.extend_from_slice(&bound_port.to_le_bytes());
                                    resp.extend_from_slice(&0u32.to_le_bytes());

                                    let env = Envelope::new(OP_TCP_LISTEN_RESULT, req_id);
                                    let mut data = env.to_bytes().to_vec();
                                    data.extend_from_slice(&resp);
                                    tx_clone.send(data).await.ok();

                                    // Spawn accept loop
                                    let tx_accept = tx_clone.clone();
                                    let manager_accept = manager.clone();
                                    let accept_handle = tokio::spawn(async move {
                                        loop {
                                            match listener.accept().await {
                                                Ok((stream, peer_addr)) => {
                                                    // Allocate a new socket ID for this connection
                                                    let socket_id = {
                                                        let mut mgr = manager_accept.lock().await;
                                                        let id = mgr.next_socket_id;
                                                        mgr.next_socket_id += 1;
                                                        id
                                                    };

                                                    // Send TCP_ACCEPT
                                                    // Payload: serverId(4), socketId(4), remotePort(2), remoteAddr(string)
                                                    let mut p = server_id.to_le_bytes().to_vec();
                                                    p.extend_from_slice(&socket_id.to_le_bytes());
                                                    p.extend_from_slice(&peer_addr.port().to_le_bytes());
                                                    let addr_str = peer_addr.ip().to_string();
                                                    p.extend_from_slice(addr_str.as_bytes());

                                                    let env = Envelope::new(OP_TCP_ACCEPT, 0);
                                                    let mut d = env.to_bytes().to_vec();
                                                    d.extend_from_slice(&p);
                                                    if tx_accept.send(d).await.is_err() {
                                                        break;
                                                    }

                                                    // Set up read/write for the accepted connection
                                                    let (mut read_half, mut write_half) = stream.into_split();
                                                    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(32);

                                                    manager_accept.lock().await.tcp_sockets.insert(socket_id, write_tx);

                                                    // Read task
                                                    let tx_read = tx_accept.clone();
                                                    tokio::spawn(async move {
                                                        let mut buf = [0u8; 8192];
                                                        loop {
                                                            match read_half.read(&mut buf).await {
                                                                Ok(0) => break,
                                                                Ok(n) => {
                                                                    let mut p = socket_id.to_le_bytes().to_vec();
                                                                    p.extend_from_slice(&buf[..n]);

                                                                    let env = Envelope::new(OP_TCP_RECV, 0);
                                                                    let mut d = env.to_bytes().to_vec();
                                                                    d.extend_from_slice(&p);
                                                                    if tx_read.send(d).await.is_err() {
                                                                        break;
                                                                    }
                                                                }
                                                                Err(_) => break,
                                                            }
                                                        }
                                                        // Send TCP_CLOSE
                                                        let mut p = socket_id.to_le_bytes().to_vec();
                                                        p.push(0);
                                                        p.extend_from_slice(&0u32.to_le_bytes());

                                                        let env = Envelope::new(OP_TCP_CLOSE, 0);
                                                        let mut d = env.to_bytes().to_vec();
                                                        d.extend_from_slice(&p);
                                                        tx_read.send(d).await.ok();
                                                    });

                                                    // Write task
                                                    tokio::spawn(async move {
                                                        while let Some(data) = write_rx.recv().await {
                                                            if write_half.write_all(&data).await.is_err() {
                                                                break;
                                                            }
                                                        }
                                                    });
                                                }
                                                Err(_) => break,
                                            }
                                        }
                                    });

                                    manager.lock().await.tcp_servers.insert(server_id, accept_handle);
                                }
                                Err(_e) => {
                                    // Send TCP_LISTEN_RESULT failure
                                    let mut resp = server_id.to_le_bytes().to_vec();
                                    resp.push(1); // Failure
                                    resp.extend_from_slice(&0u16.to_le_bytes());
                                    resp.extend_from_slice(&1u32.to_le_bytes()); // Generic errno

                                    let env = Envelope::new(OP_TCP_LISTEN_RESULT, req_id);
                                    let mut data = env.to_bytes().to_vec();
                                    data.extend_from_slice(&resp);
                                    tx_clone.send(data).await.ok();
                                }
                            }
                        });
                    }
                }
                OP_TCP_STOP_LISTEN => {
                    // Payload: serverId(4)
                    if payload.len() >= 4 {
                        let server_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
                        if let Some(handle) = socket_manager.lock().await.tcp_servers.remove(&server_id) {
                            handle.abort();
                        }
                    }
                }
                OP_UDP_BIND => {
                    // Payload: socketId(4), port(2), bind_addr(string)
                    if payload.len() >= 6 {
                        let socket_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
                        let port = u16::from_le_bytes(payload[4..6].try_into().unwrap());
                        let bind_addr = String::from_utf8_lossy(&payload[6..]).to_string();
                        let addr = if bind_addr.is_empty() {
                            format!("0.0.0.0:{}", port)
                        } else {
                            format!("{}:{}", bind_addr, port)
                        };

                        let manager = socket_manager.clone();
                        let tx_clone = tx.clone();
                        let req_id = env.request_id;

                        tokio::spawn(async move {
                            // Use socket2 to create UDP socket with SO_REUSEADDR
                            // This prevents "address already in use" errors when quickly
                            // reconnecting (e.g., page reload)
                            let bind_result = (|| -> std::io::Result<UdpSocket> {
                                let socket_addr: std::net::SocketAddr = addr.parse()
                                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
                                let domain = if socket_addr.is_ipv4() { Domain::IPV4 } else { Domain::IPV6 };
                                let socket = Socket::new(domain, Type::DGRAM, Some(Protocol::UDP))?;
                                socket.set_reuse_address(true)?;
                                socket.set_nonblocking(true)?;
                                socket.bind(&socket_addr.into())?;
                                let std_socket: std::net::UdpSocket = socket.into();
                                UdpSocket::from_std(std_socket)
                            })();

                            match bind_result {
                                Ok(socket) => {
                                    let local_port = socket.local_addr().map(|a| a.port()).unwrap_or(0);
                                    let socket = Arc::new(socket);
                                    manager.lock().await.udp_sockets.insert(socket_id, socket.clone());
                                    
                                    // Send UDP_BOUND
                                    // Payload: socketId(4), status(1), bound_port(2), errno(4)
                                    let mut resp = socket_id.to_le_bytes().to_vec();
                                    resp.push(0); // Success
                                    resp.extend_from_slice(&local_port.to_le_bytes());
                                    resp.extend_from_slice(&0u32.to_le_bytes());
                                    
                                    let env = Envelope::new(OP_UDP_BOUND, req_id);
                                    let mut data = env.to_bytes().to_vec();
                                    data.extend_from_slice(&resp);
                                    tx_clone.send(data).await.ok();

                                    // Read task
                                    let tx_read = tx_clone.clone();
                                    tokio::spawn(async move {
                                        let mut buf = [0u8; 65535];
                                        loop {
                                            match socket.recv_from(&mut buf).await {
                                                Ok((n, peer)) => {
                                                    // Send UDP_RECV
                                                    // Payload: socketId(4), port(2), addr(string), data
                                                    // Layout: socketId(4) + port(2) + addr_len(2) + addr + data
                                                    let mut p = socket_id.to_le_bytes().to_vec();
                                                    p.extend_from_slice(&peer.port().to_le_bytes());
                                                    let addr_str = peer.ip().to_string();
                                                    p.extend_from_slice(&(addr_str.len() as u16).to_le_bytes());
                                                    p.extend_from_slice(addr_str.as_bytes());
                                                    p.extend_from_slice(&buf[..n]);
                                                    
                                                    let env = Envelope::new(OP_UDP_RECV, 0);
                                                    let mut d = env.to_bytes().to_vec();
                                                    d.extend_from_slice(&p);
                                                    if tx_read.send(d).await.is_err() {
                                                        break;
                                                    }
                                                }
                                                Err(_) => break,
                                            }
                                        }
                                        // Send UDP_CLOSE
                                        let mut p = socket_id.to_le_bytes().to_vec();
                                        p.push(0);
                                        p.extend_from_slice(&0u32.to_le_bytes());
                                        let env = Envelope::new(OP_UDP_CLOSE, 0);
                                        let mut d = env.to_bytes().to_vec();
                                        d.extend_from_slice(&p);
                                        tx_read.send(d).await.ok();
                                    });
                                }
                                Err(e) => {
                                    // Send UDP_BOUND failure
                                    let mut resp = socket_id.to_le_bytes().to_vec();
                                    resp.push(1); // Failure
                                    resp.extend_from_slice(&0u16.to_le_bytes());
                                    resp.extend_from_slice(&1u32.to_le_bytes());
                                    
                                    let env = Envelope::new(OP_UDP_BOUND, req_id);
                                    let mut data = env.to_bytes().to_vec();
                                    data.extend_from_slice(&resp);
                                    tx_clone.send(data).await.ok();
                                }
                            }
                        });
                    }
                }
                OP_UDP_SEND => {
                    // Payload: socketId(4), dest_port(2), dest_addr(string), data
                    // Layout: socketId(4) + dest_port(2) + dest_addr_len(2) + dest_addr + data
                    if payload.len() >= 8 {
                        let socket_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
                        let dest_port = u16::from_le_bytes(payload[4..6].try_into().unwrap());
                        let addr_len = u16::from_le_bytes(payload[6..8].try_into().unwrap()) as usize;
                        
                        if payload.len() >= 8 + addr_len {
                            let dest_addr = String::from_utf8_lossy(&payload[8..8+addr_len]).to_string();
                            let data = &payload[8+addr_len..];
                            
                            if let Some(socket) = socket_manager.lock().await.udp_sockets.get(&socket_id) {
                                let addr = format!("{}:{}", dest_addr, dest_port);
                                socket.send_to(data, &addr).await.ok();
                            }
                        }
                    }
                }
                OP_UDP_CLOSE => {
                    // Payload: socketId(4)
                    if payload.len() >= 4 {
                        let socket_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
                        socket_manager.lock().await.udp_sockets.remove(&socket_id);
                    }
                }
                OP_UDP_JOIN_MULTICAST => {
                    // Payload: socketId(4), groupAddr(string)
                    if payload.len() >= 4 {
                        let socket_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
                        let group_addr = String::from_utf8_lossy(&payload[4..]).to_string();

                        if let Some(socket) = socket_manager.lock().await.udp_sockets.get(&socket_id) {
                            if let Ok(group) = group_addr.parse::<std::net::Ipv4Addr>() {
                                let sock_ref = SockRef::from(socket.as_ref());
                                if let Err(e) = sock_ref.join_multicast_v4(&group, &std::net::Ipv4Addr::UNSPECIFIED) {
                                    eprintln!("Failed to join multicast {}: {}", group_addr, e);
                                }
                            }
                        }
                    }
                }
                OP_UDP_LEAVE_MULTICAST => {
                    // Payload: socketId(4), groupAddr(string)
                    if payload.len() >= 4 {
                        let socket_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
                        let group_addr = String::from_utf8_lossy(&payload[4..]).to_string();

                        if let Some(socket) = socket_manager.lock().await.udp_sockets.get(&socket_id) {
                            if let Ok(group) = group_addr.parse::<std::net::Ipv4Addr>() {
                                let sock_ref = SockRef::from(socket.as_ref());
                                let _ = sock_ref.leave_multicast_v4(&group, &std::net::Ipv4Addr::UNSPECIFIED);
                            }
                        }
                    }
                }
                _ => {
                    // Unknown opcode
                    send_error(&tx, env.request_id, "Unknown opcode").await;
                }
            }
        }
    }

    // Clean up all resources when WebSocket disconnects
    {
        let manager = socket_manager.lock().await;
        // Abort all TCP server tasks to release their ports
        for (_, handle) in manager.tcp_servers.iter() {
            handle.abort();
        }
        // TCP sockets and UDP sockets will be cleaned up when dropped
    }

    send_task.abort();
}
