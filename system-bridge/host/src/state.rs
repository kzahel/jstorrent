use std::sync::Mutex;
use tokio::sync::mpsc;
use crate::protocol::Event;

pub struct State {
    pub event_sender: Option<mpsc::Sender<Event>>,
    pub rpc_info: Mutex<Option<crate::rpc::RpcInfo>>,
}

impl State {
    pub fn new(event_sender: Option<mpsc::Sender<Event>>) -> Self {
        Self {
            event_sender,
            rpc_info: Mutex::new(None),
        }
    }
}
