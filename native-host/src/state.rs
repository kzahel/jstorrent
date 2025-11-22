use crate::udp::UdpState;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex};
use std::sync::atomic::{AtomicU32, Ordering};
use tokio::net::TcpStream;
use tokio::net::UdpSocket;
use tokio::sync::mpsc;
use crate::protocol::Event;
use crate::tcp::TcpState;

pub struct State {
    pub download_root: Mutex<PathBuf>,
    pub tcp_sockets: Mutex<HashMap<u32, TcpState>>,
    pub udp_sockets: Mutex<HashMap<u32, UdpState>>,
    pub next_socket_id: AtomicU32,
    pub event_sender: Option<mpsc::Sender<Event>>,
}

impl State {
    pub fn new(download_root: PathBuf, event_sender: Option<mpsc::Sender<Event>>) -> Self {
        Self {
            download_root: Mutex::new(download_root),
            tcp_sockets: Mutex::new(HashMap::new()),
            udp_sockets: Mutex::new(HashMap::new()),
            next_socket_id: AtomicU32::new(1),
            event_sender,
        }
    }

    pub fn next_id(&self) -> u32 {
        self.next_socket_id.fetch_add(1, Ordering::Relaxed)
    }
}
