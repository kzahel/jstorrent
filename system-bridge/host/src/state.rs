use std::path::PathBuf;
use std::sync::Mutex;
use tokio::sync::mpsc;
use crate::protocol::Event;

pub struct State {
    pub download_root: Mutex<PathBuf>,
    pub event_sender: Option<mpsc::Sender<Event>>,
    pub rpc_info: Mutex<Option<crate::rpc::RpcInfo>>,
}

impl State {
    pub fn new(download_root: PathBuf, event_sender: Option<mpsc::Sender<Event>>) -> Self {
        Self {
            download_root: Mutex::new(download_root),
            event_sender,
            rpc_info: Mutex::new(None),
        }
    }
}
