use base64::Engine as _;
use rstorrent_remote_crypto::{ClientId, ResumeClientHello};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::RemoteHostError;
use crate::owner::RemoteSecurityView;

pub const LOGIN_REQUEST: &[u8; 4] = b"RSL1";
pub const LOGIN_RESPONSE: &[u8; 4] = b"RSL2";
pub const LOGIN_FINALIZATION: &[u8; 4] = b"RSL3";
pub const RESUME_REQUEST: &[u8; 4] = b"RSR1";
pub const RESUME_RESPONSE: &[u8; 4] = b"RSR2";
pub const RESUME_FINALIZATION: &[u8; 4] = b"RSR3";
pub const AUTHENTICATED_READY_MAGIC: &[u8; 4] = b"RSA2";
pub const AUTHORIZATION_CHOICE_MAGIC: &[u8; 4] = b"RSA3";
pub const AUTHENTICATION_SUCCEEDED_MAGIC: &[u8; 4] = b"RSA4";
pub const HOST_GREETING_MAGIC: &[u8; 4] = b"RHG1";
pub const REMOTE_CONTROL_REQUEST_MAGIC: &[u8; 4] = b"RSC2";
pub const REMOTE_CONTROL_RESPONSE_MAGIC: &[u8; 4] = b"RSC3";
#[cfg(feature = "direct-file-webrtc")]
pub const DIRECT_FILE_REQUEST_MAGIC: &[u8; 4] = b"RDF1";
#[cfg(feature = "direct-file-webrtc")]
pub const DIRECT_FILE_RESPONSE_MAGIC: &[u8; 4] = b"RDF2";

const MAX_HANDSHAKE_MESSAGE_BYTES: usize = 4 * 1024;
const MAX_JSON_BYTES: usize = 2 * 1024;
const MAX_CONTROL_REQUEST_BYTES: usize = 16 * 1024;
const MAX_CONTROL_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
#[cfg(feature = "direct-file-webrtc")]
pub const MAX_DIRECT_FILE_SIGNALING_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationReady {
    pub protocol_version: u16,
    pub host_build: String,
    pub host_pin: String,
    pub host_resume_public_key: String,
    pub authorization_generation: u64,
    pub authorization_challenge: String,
    pub protocol_floor: u16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HostGreeting {
    pub relay_id: [u8; 32],
    pub host_id: [u8; 32],
    pub protocol_version: u16,
}

impl HostGreeting {
    pub fn to_bytes(self) -> [u8; 70] {
        let mut encoded = [0_u8; 70];
        encoded[..4].copy_from_slice(HOST_GREETING_MAGIC);
        encoded[4..36].copy_from_slice(&self.relay_id);
        encoded[36..68].copy_from_slice(&self.host_id);
        encoded[68..].copy_from_slice(&self.protocol_version.to_be_bytes());
        encoded
    }

    pub fn from_bytes(encoded: &[u8]) -> Result<Self, RemoteHostError> {
        if encoded.len() != 70 || &encoded[..4] != HOST_GREETING_MAGIC {
            return Err(RemoteHostError::Protocol);
        }
        Ok(Self {
            relay_id: encoded[4..36]
                .try_into()
                .map_err(|_| RemoteHostError::Protocol)?,
            host_id: encoded[36..68]
                .try_into()
                .map_err(|_| RemoteHostError::Protocol)?,
            protocol_version: u16::from_be_bytes(
                encoded[68..]
                    .try_into()
                    .map_err(|_| RemoteHostError::Protocol)?,
            ),
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "choice", rename_all = "snake_case", deny_unknown_fields)]
pub enum AuthorizationChoice {
    Shared {
        client_build: Option<String>,
    },
    Private {
        client_id: String,
        client_public_key: String,
        signature: String,
        label: String,
        client_build: Option<String>,
        route_observation: Option<String>,
        browser_observation: Option<String>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizationSucceeded {
    pub client_id: String,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationSucceeded {
    pub protocol_version: u16,
    pub authorization: Option<AuthorizationSucceeded>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub circuit_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_generation: Option<u64>,
}

#[cfg(feature = "direct-file-webrtc")]
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DirectSessionDescription {
    #[serde(rename = "type")]
    pub kind: DirectSdpType,
    pub sdp: String,
}

#[cfg(feature = "direct-file-webrtc")]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectSdpType {
    Offer,
    Answer,
}

#[cfg(feature = "direct-file-webrtc")]
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DirectIceCandidate {
    pub candidate: String,
    pub sdp_mid: Option<String>,
    pub sdp_m_line_index: Option<u16>,
    pub username_fragment: Option<String>,
}

#[cfg(feature = "direct-file-webrtc")]
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum DirectFileRequest {
    Open {
        request_id: u32,
        circuit_generation: u64,
        browser_peer_generation: u64,
        torrent_id: String,
        file_index: u32,
        offer: DirectSessionDescription,
    },
    Candidate {
        request_id: u32,
        circuit_generation: u64,
        browser_peer_generation: u64,
        candidate: DirectIceCandidate,
    },
    EndOfCandidates {
        request_id: u32,
        circuit_generation: u64,
        browser_peer_generation: u64,
    },
    Close {
        request_id: u32,
        circuit_generation: u64,
        browser_peer_generation: u64,
        outcome: DirectFileCloseOutcome,
    },
}

#[cfg(feature = "direct-file-webrtc")]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectFileCloseOutcome {
    Complete,
    Cancelled,
    SinkFailed,
}

#[cfg(feature = "direct-file-webrtc")]
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum DirectFileResponse {
    Opened {
        request_id: u32,
        circuit_generation: u64,
        browser_peer_generation: u64,
        host_peer_generation: u64,
        file_length: String,
        max_chunk_bytes: u32,
        answer: DirectSessionDescription,
        candidates: Vec<DirectIceCandidate>,
    },
    Candidate {
        request_id: u32,
        circuit_generation: u64,
        browser_peer_generation: u64,
        host_peer_generation: u64,
        candidate: DirectIceCandidate,
    },
    EndOfCandidates {
        request_id: u32,
        circuit_generation: u64,
        browser_peer_generation: u64,
        host_peer_generation: u64,
    },
    Status {
        request_id: u32,
        circuit_generation: u64,
        browser_peer_generation: u64,
        host_peer_generation: u64,
        state: DirectFileStatus,
        bytes_sent: String,
        candidate_class: Option<DirectCandidateClass>,
    },
    Rejected {
        request_id: u32,
        circuit_generation: u64,
        browser_peer_generation: u64,
        reason: DirectFileFailure,
    },
    Closed {
        request_id: u32,
        circuit_generation: u64,
        browser_peer_generation: u64,
        host_peer_generation: Option<u64>,
        outcome: DirectFileCloseOutcome,
    },
}

#[cfg(feature = "direct-file-webrtc")]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectFileStatus {
    Negotiating,
    Connected,
    Transferring,
    Complete,
}

#[cfg(feature = "direct-file-webrtc")]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectCandidateClass {
    Host,
    ServerReflexive,
    PeerReflexive,
}

#[cfg(feature = "direct-file-webrtc")]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectFileFailure {
    Disabled,
    Busy,
    Unsupported,
    InvalidRequest,
    FileUnavailable,
    SignalingLimit,
    DirectUnavailable,
    Cancelled,
    CircuitClosed,
    Internal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RemoteControlRequest {
    pub request_id: u32,
    pub operation: RemoteControlOperation,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum RemoteControlOperation {
    Inspect,
    Rename { client_id: String, label: String },
    Revoke { client_id: String },
    RevokeAllOther { retained_client_id: String },
    CloseCircuit { circuit_id: String },
    RequirePasswordEverywhere,
    SetDirectFileTransfers { enabled: bool },
    StopDirectFileTransfers,
    SignOutThisBrowser,
    ClearHistory,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RemoteControlResponse {
    pub request_id: u32,
    pub outcome: RemoteControlOutcome,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum RemoteControlOutcome {
    Security { security: Box<RemoteSecurityView> },
    Count { count: usize },
    Complete,
    SignedOut { authorization_revoked: bool },
    Error { message: String },
}

pub fn encode_json_record<T: Serialize>(
    magic: &[u8; 4],
    value: &T,
) -> Result<Vec<u8>, RemoteHostError> {
    let encoded = serde_json::to_vec(value).map_err(|_| RemoteHostError::Protocol)?;
    if encoded.len() > MAX_JSON_BYTES {
        return Err(RemoteHostError::Protocol);
    }
    let mut message = Vec::with_capacity(4 + encoded.len());
    message.extend_from_slice(magic);
    message.extend_from_slice(&encoded);
    Ok(message)
}

pub fn decode_json_record<T: DeserializeOwned>(
    magic: &[u8; 4],
    message: &[u8],
) -> Result<T, RemoteHostError> {
    let payload = protocol_payload(message, magic)?;
    if payload.len() > MAX_JSON_BYTES {
        return Err(RemoteHostError::Protocol);
    }
    serde_json::from_slice(payload).map_err(|_| RemoteHostError::Protocol)
}

pub fn decode_control_request(message: &[u8]) -> Result<RemoteControlRequest, RemoteHostError> {
    let payload = message
        .strip_prefix(REMOTE_CONTROL_REQUEST_MAGIC)
        .filter(|payload| !payload.is_empty() && payload.len() <= MAX_CONTROL_REQUEST_BYTES)
        .ok_or(RemoteHostError::Protocol)?;
    serde_json::from_slice(payload).map_err(|_| RemoteHostError::Protocol)
}

pub fn encode_control_request(request: &RemoteControlRequest) -> Result<Vec<u8>, RemoteHostError> {
    let encoded = serde_json::to_vec(request).map_err(|_| RemoteHostError::Protocol)?;
    if encoded.len() > MAX_CONTROL_REQUEST_BYTES {
        return Err(RemoteHostError::Protocol);
    }
    let mut message = Vec::with_capacity(4 + encoded.len());
    message.extend_from_slice(REMOTE_CONTROL_REQUEST_MAGIC);
    message.extend_from_slice(&encoded);
    Ok(message)
}

pub fn encode_control_response(
    response: &RemoteControlResponse,
) -> Result<Vec<u8>, RemoteHostError> {
    let encoded = serde_json::to_vec(response).map_err(|_| RemoteHostError::Protocol)?;
    if encoded.len() > MAX_CONTROL_RESPONSE_BYTES {
        return Err(RemoteHostError::Protocol);
    }
    let mut message = Vec::with_capacity(4 + encoded.len());
    message.extend_from_slice(REMOTE_CONTROL_RESPONSE_MAGIC);
    message.extend_from_slice(&encoded);
    Ok(message)
}

pub fn decode_control_response(message: &[u8]) -> Result<RemoteControlResponse, RemoteHostError> {
    let payload = message
        .strip_prefix(REMOTE_CONTROL_RESPONSE_MAGIC)
        .filter(|payload| !payload.is_empty() && payload.len() <= MAX_CONTROL_RESPONSE_BYTES)
        .ok_or(RemoteHostError::Protocol)?;
    serde_json::from_slice(payload).map_err(|_| RemoteHostError::Protocol)
}

#[cfg(feature = "direct-file-webrtc")]
pub fn encode_direct_file_response(
    response: &DirectFileResponse,
) -> Result<Vec<u8>, RemoteHostError> {
    encode_bounded_record(
        DIRECT_FILE_RESPONSE_MAGIC,
        response,
        MAX_DIRECT_FILE_SIGNALING_BYTES,
    )
}

#[cfg(feature = "direct-file-webrtc")]
pub fn encode_direct_file_request(request: &DirectFileRequest) -> Result<Vec<u8>, RemoteHostError> {
    encode_bounded_record(
        DIRECT_FILE_REQUEST_MAGIC,
        request,
        MAX_DIRECT_FILE_SIGNALING_BYTES,
    )
}

#[cfg(feature = "direct-file-webrtc")]
pub fn decode_direct_file_request(message: &[u8]) -> Result<DirectFileRequest, RemoteHostError> {
    decode_bounded_record(
        DIRECT_FILE_REQUEST_MAGIC,
        message,
        MAX_DIRECT_FILE_SIGNALING_BYTES,
    )
}

#[cfg(feature = "direct-file-webrtc")]
pub fn decode_direct_file_response(message: &[u8]) -> Result<DirectFileResponse, RemoteHostError> {
    decode_bounded_record(
        DIRECT_FILE_RESPONSE_MAGIC,
        message,
        MAX_DIRECT_FILE_SIGNALING_BYTES,
    )
}

#[cfg(feature = "direct-file-webrtc")]
fn encode_bounded_record<T: Serialize>(
    magic: &[u8; 4],
    value: &T,
    maximum: usize,
) -> Result<Vec<u8>, RemoteHostError> {
    let encoded = serde_json::to_vec(value).map_err(|_| RemoteHostError::Protocol)?;
    if encoded.is_empty() || encoded.len() > maximum {
        return Err(RemoteHostError::Protocol);
    }
    let mut message = Vec::with_capacity(4 + encoded.len());
    message.extend_from_slice(magic);
    message.extend_from_slice(&encoded);
    Ok(message)
}

#[cfg(feature = "direct-file-webrtc")]
fn decode_bounded_record<T: DeserializeOwned>(
    magic: &[u8; 4],
    message: &[u8],
    maximum: usize,
) -> Result<T, RemoteHostError> {
    let payload = message
        .strip_prefix(magic)
        .filter(|payload| !payload.is_empty() && payload.len() <= maximum)
        .ok_or(RemoteHostError::Protocol)?;
    serde_json::from_slice(payload).map_err(|_| RemoteHostError::Protocol)
}

pub fn protocol_payload<'a>(
    message: &'a [u8],
    magic: &[u8; 4],
) -> Result<&'a [u8], RemoteHostError> {
    message
        .strip_prefix(magic)
        .filter(|payload| !payload.is_empty() && message.len() <= MAX_HANDSHAKE_MESSAGE_BYTES)
        .ok_or(RemoteHostError::Protocol)
}

pub fn encode_resume_request(client_id: ClientId, hello: &ResumeClientHello) -> Vec<u8> {
    let hello = hello.to_bytes();
    let mut encoded = Vec::with_capacity(4 + 16 + hello.len());
    encoded.extend_from_slice(RESUME_REQUEST);
    encoded.extend_from_slice(client_id.as_bytes());
    encoded.extend_from_slice(&hello);
    encoded
}

pub fn decode_resume_request(
    message: &[u8],
) -> Result<(ClientId, ResumeClientHello), RemoteHostError> {
    let payload = protocol_payload(message, RESUME_REQUEST)?;
    if payload.len() != 16 + 101 {
        return Err(RemoteHostError::Protocol);
    }
    let client_id = ClientId::new(
        payload[..16]
            .try_into()
            .map_err(|_| RemoteHostError::Protocol)?,
    );
    let hello =
        ResumeClientHello::from_bytes(&payload[16..]).map_err(|_| RemoteHostError::Protocol)?;
    Ok((client_id, hello))
}

pub(crate) fn encode_id(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn decode_id<const N: usize>(value: &str) -> Result<[u8; N], RemoteHostError> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| RemoteHostError::Protocol)?
        .try_into()
        .map_err(|_| RemoteHostError::Protocol)
}

#[cfg(test)]
mod tests {
    use rstorrent_remote_crypto::{OperationSeed, ResumeContext, start_client_resume};

    use super::*;
    use rstorrent_remote_crypto::{
        AuthorizationGeneration, Binding, HostId, HostPin, P256PublicKey, RelayId, Username,
    };

    #[test]
    fn json_messages_are_typed_bounded_and_exact() {
        let ready = AuthenticationReady {
            protocol_version: 1,
            host_build: "test-host".to_owned(),
            host_pin: encode_id(&[1; 64]),
            host_resume_public_key: encode_id(&[2; 65]),
            authorization_generation: 4,
            authorization_challenge: encode_id(&[3; 32]),
            protocol_floor: 1,
        };
        let encoded = encode_json_record(AUTHENTICATED_READY_MAGIC, &ready).unwrap();
        assert_eq!(
            decode_json_record::<AuthenticationReady>(AUTHENTICATED_READY_MAGIC, &encoded).unwrap(),
            ready
        );
        assert!(
            decode_json_record::<AuthenticationReady>(AUTHORIZATION_CHOICE_MAGIC, &encoded)
                .is_err()
        );
        let oversized = AuthorizationChoice::Shared {
            client_build: Some("x".repeat(MAX_JSON_BYTES)),
        };
        assert!(encode_json_record(AUTHORIZATION_CHOICE_MAGIC, &oversized).is_err());
    }

    #[test]
    fn resume_request_has_one_strict_client_identifier_and_crypto_hello() {
        let context = ResumeContext::new(
            Binding::new(
                RelayId::new([1; 32]),
                Username::parse("alice").unwrap(),
                HostId::new([2; 32]),
            ),
            HostPin::new(HostId::new([2; 32]), [3; 32]),
            P256PublicKey::from_bytes(
                p256::ecdsa::SigningKey::from_slice(&[4; 32])
                    .unwrap()
                    .verifying_key()
                    .to_sec1_point(false)
                    .as_bytes(),
            )
            .unwrap(),
            ClientId::new([5; 16]),
            P256PublicKey::from_bytes(
                p256::ecdsa::SigningKey::from_slice(&[6; 32])
                    .unwrap()
                    .verifying_key()
                    .to_sec1_point(false)
                    .as_bytes(),
            )
            .unwrap(),
            AuthorizationGeneration::new(1),
            AuthorizationGeneration::new(1),
            1,
        );
        let start = start_client_resume(context, OperationSeed::new([7; 32]));
        let encoded = encode_resume_request(ClientId::new([5; 16]), start.hello());
        let (client_id, hello) = decode_resume_request(&encoded).unwrap();
        assert_eq!(client_id, ClientId::new([5; 16]));
        assert_eq!(hello, *start.hello());
        assert!(decode_resume_request(&encoded[..encoded.len() - 1]).is_err());
    }

    #[cfg(feature = "direct-file-webrtc")]
    #[test]
    fn direct_file_signaling_is_closed_versioned_and_bounded() {
        let request = DirectFileRequest::Open {
            request_id: 7,
            circuit_generation: 11,
            browser_peer_generation: 13,
            torrent_id: "t1-0123456789abcdef0123456789abcdef".to_owned(),
            file_index: 3,
            offer: DirectSessionDescription {
                kind: DirectSdpType::Offer,
                sdp: "v=0\r\n".to_owned(),
            },
        };
        let encoded = encode_direct_file_request(&request).unwrap();
        assert_eq!(decode_direct_file_request(&encoded).unwrap(), request);
        assert!(decode_direct_file_response(&encoded).is_err());

        let mut unknown = serde_json::to_value(&request).unwrap();
        unknown
            .as_object_mut()
            .unwrap()
            .insert("unknown".to_owned(), serde_json::Value::Bool(true));
        let mut unknown_record = DIRECT_FILE_REQUEST_MAGIC.to_vec();
        unknown_record.extend_from_slice(&serde_json::to_vec(&unknown).unwrap());
        assert!(decode_direct_file_request(&unknown_record).is_err());

        let oversized = DirectFileRequest::Open {
            request_id: 1,
            circuit_generation: 1,
            browser_peer_generation: 1,
            torrent_id: "t1-0123456789abcdef0123456789abcdef".to_owned(),
            file_index: 0,
            offer: DirectSessionDescription {
                kind: DirectSdpType::Offer,
                sdp: "x".repeat(MAX_DIRECT_FILE_SIGNALING_BYTES),
            },
        };
        assert!(encode_direct_file_request(&oversized).is_err());

        let response = DirectFileResponse::Rejected {
            request_id: 7,
            circuit_generation: 11,
            browser_peer_generation: 13,
            reason: DirectFileFailure::FileUnavailable,
        };
        let encoded = encode_direct_file_response(&response).unwrap();
        assert_eq!(decode_direct_file_response(&encoded).unwrap(), response);
    }
}
