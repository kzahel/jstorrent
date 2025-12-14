use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: String,
    #[serde(flatten)]
    pub op: Operation,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Operation {
    // Folder Picker
    PickDownloadDirectory,

    // Delete Download Root
    DeleteDownloadRoot { key: String },

    // Handshake
    Handshake {
        #[serde(rename = "extensionId")]
        extension_id: String,
        #[serde(rename = "installId")]
        install_id: String,
    },
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(flatten)]
    pub payload: ResponsePayload,
}

use jstorrent_common::DownloadRoot;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ResponsePayload {
    Empty,
    DaemonInfo {
        port: u16,
        token: String,
        version: String,
        roots: Vec<DownloadRoot>,
    },
    Path { path: String },
    RootAdded { root: DownloadRoot },
    RootRemoved { key: String },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "event", content = "payload")]
pub enum Event {
    Log {
        message: String,
    },
    MagnetAdded {
        link: String,
    },
    TorrentAdded {
        name: String,
        infohash: String,
        #[serde(rename = "contentsBase64")]
        contents_base64: String,
    },
}
