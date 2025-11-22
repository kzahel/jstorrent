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
    // TCP
    OpenTcp {
        host: String,
        port: u16,
    },
    WriteTcp {
        #[serde(rename = "socketId")]
        socket_id: u32,
        data: String, // Base64 encoded
    },
    CloseTcp {
        #[serde(rename = "socketId")]
        socket_id: u32,
    },

    // UDP
    OpenUdp {
        #[serde(rename = "bindHost")]
        bind_host: Option<String>,
        #[serde(rename = "bindPort")]
        bind_port: Option<u16>,
    },
    SendUdp {
        #[serde(rename = "socketId")]
        socket_id: u32,
        #[serde(rename = "remoteHost")]
        remote_host: String,
        #[serde(rename = "remotePort")]
        remote_port: u16,
        data: String, // Base64 encoded
    },
    CloseUdp {
        #[serde(rename = "socketId")]
        socket_id: u32,
    },

    // File I/O
    SetDownloadRoot {
        path: String,
    },
    EnsureDir {
        path: String,
    },
    ReadFile {
        path: String,
        offset: u64,
        length: usize,
    },
    WriteFile {
        path: String,
        offset: u64,
        data: String, // Base64 encoded
    },
    StatFile {
        path: String,
    },

    // Atomic Move
    AtomicMove {
        from: String,
        to: String,
        overwrite: Option<bool>,
    },

    // Folder Picker
    PickDownloadDirectory,

    // Hashing
    HashSha1 {
        data: String, // Base64 encoded
    },
    HashFile {
        path: String,
        offset: u64,
        length: usize,
    },

    // Handshake
    Handshake {
        #[serde(rename = "extensionId")]
        extension_id: String,
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

#[derive(Debug, Serialize, Default)]
#[serde(untagged)]
pub enum ResponsePayload {
    #[default]
    Empty,
    SocketId {
        #[serde(rename = "socketId")]
        socket_id: u32,
    },
    Data {
        data: String, // Base64
    },
    Stat {
        size: u64,
        mtime: u64, // Unix timestamp ms
        is_dir: bool,
    },
    Path {
        path: String,
    },
    Hash {
        hash: String, // Hex encoded SHA1
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum Event {
    TcpData {
        #[serde(rename = "socketId")]
        socket_id: u32,
        data: String, // Base64
    },
    TcpClosed {
        #[serde(rename = "socketId")]
        socket_id: u32,
    },
    TcpError {
        #[serde(rename = "socketId")]
        socket_id: u32,
        error: String,
    },
    UdpData {
        #[serde(rename = "socketId")]
        socket_id: u32,
        data: String, // Base64
        #[serde(rename = "remoteHost")]
        remote_host: String,
        #[serde(rename = "remotePort")]
        remote_port: u16,
    },
    UdpError {
        #[serde(rename = "socketId")]
        socket_id: u32,
        error: String,
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
