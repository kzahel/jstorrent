//! Runtime-independent direct-file experiment frames.

use std::error::Error;
use std::fmt;

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_CONTROL_FRAME_BYTES: usize = 4 * 1024;
/// RFC 8831 section 6.6 recommends at most 16 KiB messages when the SCTP
/// implementation does not expose message interleaving. `rtc` 0.20.4 does
/// not currently expose RFC 8260 I-DATA, so keep each product payload within
/// that conservative interoperability ceiling.
pub const MAX_CHUNK_BYTES: usize = 16 * 1024;
pub const MAX_DATA_FRAME_BYTES: usize = 64 * 1024;
pub const MAX_RANGE_REQUESTS: usize = 4;

const RANGE_REQUEST: u8 = 0x01;
const CANCEL_REQUEST: u8 = 0x02;
const CHUNK_ACK: u8 = 0x03;
const RANGE_ACCEPTED: u8 = 0x81;
const RANGE_CHUNK: u8 = 0x82;
const RANGE_COMPLETE: u8 = 0x83;
const RANGE_ERROR: u8 = 0xff;

const PREFIX_BYTES: usize = 2;
const REQUEST_ID_BYTES: usize = 4;
const RANGE_REQUEST_BYTES: usize = PREFIX_BYTES + REQUEST_ID_BYTES + 8 + 4;
const CANCEL_REQUEST_BYTES: usize = PREFIX_BYTES + REQUEST_ID_BYTES;
const CHUNK_ACK_BYTES: usize = PREFIX_BYTES + REQUEST_ID_BYTES + 8;
const RANGE_ACCEPTED_BYTES: usize = PREFIX_BYTES + REQUEST_ID_BYTES + 8 + 8 + 4;
const RANGE_CHUNK_HEADER_BYTES: usize = PREFIX_BYTES + REQUEST_ID_BYTES + 8;

#[cfg(feature = "webrtc")]
pub(crate) fn encoded_chunk_payload_bytes(frame: &[u8]) -> usize {
    if frame.len() > RANGE_CHUNK_HEADER_BYTES
        && frame.first() == Some(&PROTOCOL_VERSION)
        && frame.get(1) == Some(&RANGE_CHUNK)
    {
        frame.len() - RANGE_CHUNK_HEADER_BYTES
    } else {
        0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ControlFrame {
    RangeRequest {
        request_id: u32,
        offset: u64,
        length: u32,
    },
    CancelRequest {
        request_id: u32,
    },
    ChunkAck {
        request_id: u32,
        next_offset: u64,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum RangeErrorCode {
    Malformed = 1,
    DuplicateRequest = 2,
    TooManyRequests = 3,
    InvalidRange = 4,
    CapabilityUnavailable = 5,
    ReadUnavailable = 6,
    Inactive = 7,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CodecError {
    Oversized,
    Truncated,
    UnsupportedVersion,
    UnknownFrame,
    InvalidLength,
}

impl fmt::Display for CodecError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Oversized => "frame exceeds its protocol limit",
            Self::Truncated => "frame is truncated",
            Self::UnsupportedVersion => "frame version is unsupported",
            Self::UnknownFrame => "frame type is unknown",
            Self::InvalidLength => "frame length is invalid",
        })
    }
}

impl Error for CodecError {}

pub fn decode_control(bytes: &[u8]) -> Result<ControlFrame, CodecError> {
    if bytes.len() > MAX_CONTROL_FRAME_BYTES {
        return Err(CodecError::Oversized);
    }
    if bytes.len() < PREFIX_BYTES {
        return Err(CodecError::Truncated);
    }
    if bytes[0] != PROTOCOL_VERSION {
        return Err(CodecError::UnsupportedVersion);
    }
    match bytes[1] {
        RANGE_REQUEST if bytes.len() == RANGE_REQUEST_BYTES => {
            let request_id = read_u32(bytes, 2)?;
            let offset = read_u64(bytes, 6)?;
            let length = read_u32(bytes, 14)?;
            if length == 0 || offset.checked_add(u64::from(length)).is_none() {
                return Err(CodecError::InvalidLength);
            }
            Ok(ControlFrame::RangeRequest {
                request_id,
                offset,
                length,
            })
        }
        CANCEL_REQUEST if bytes.len() == CANCEL_REQUEST_BYTES => Ok(ControlFrame::CancelRequest {
            request_id: read_u32(bytes, 2)?,
        }),
        CHUNK_ACK if bytes.len() == CHUNK_ACK_BYTES => Ok(ControlFrame::ChunkAck {
            request_id: read_u32(bytes, 2)?,
            next_offset: read_u64(bytes, 6)?,
        }),
        RANGE_REQUEST | CANCEL_REQUEST | CHUNK_ACK => Err(CodecError::InvalidLength),
        _ => Err(CodecError::UnknownFrame),
    }
}

pub fn encode_range_accepted(
    request_id: u32,
    file_length: u64,
    offset: u64,
    length: u32,
) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(RANGE_ACCEPTED_BYTES);
    bytes.extend_from_slice(&[PROTOCOL_VERSION, RANGE_ACCEPTED]);
    bytes.extend_from_slice(&request_id.to_be_bytes());
    bytes.extend_from_slice(&file_length.to_be_bytes());
    bytes.extend_from_slice(&offset.to_be_bytes());
    bytes.extend_from_slice(&length.to_be_bytes());
    bytes
}

pub fn encode_range_chunk(
    request_id: u32,
    offset: u64,
    payload: &[u8],
) -> Result<Vec<u8>, CodecError> {
    if payload.is_empty() {
        return Err(CodecError::InvalidLength);
    }
    if payload.len() > MAX_CHUNK_BYTES
        || RANGE_CHUNK_HEADER_BYTES.saturating_add(payload.len()) > MAX_DATA_FRAME_BYTES
    {
        return Err(CodecError::Oversized);
    }
    let mut bytes = Vec::with_capacity(RANGE_CHUNK_HEADER_BYTES + payload.len());
    bytes.extend_from_slice(&[PROTOCOL_VERSION, RANGE_CHUNK]);
    bytes.extend_from_slice(&request_id.to_be_bytes());
    bytes.extend_from_slice(&offset.to_be_bytes());
    bytes.extend_from_slice(payload);
    Ok(bytes)
}

pub fn encode_range_complete(request_id: u32) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(PREFIX_BYTES + REQUEST_ID_BYTES);
    bytes.extend_from_slice(&[PROTOCOL_VERSION, RANGE_COMPLETE]);
    bytes.extend_from_slice(&request_id.to_be_bytes());
    bytes
}

pub fn encode_range_error(request_id: u32, code: RangeErrorCode) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(PREFIX_BYTES + REQUEST_ID_BYTES + 1);
    bytes.extend_from_slice(&[PROTOCOL_VERSION, RANGE_ERROR]);
    bytes.extend_from_slice(&request_id.to_be_bytes());
    bytes.push(code as u8);
    bytes
}

fn read_u32(bytes: &[u8], start: usize) -> Result<u32, CodecError> {
    let source = bytes.get(start..start + 4).ok_or(CodecError::Truncated)?;
    Ok(u32::from_be_bytes(
        source.try_into().map_err(|_| CodecError::Truncated)?,
    ))
}

fn read_u64(bytes: &[u8], start: usize) -> Result<u64, CodecError> {
    let source = bytes.get(start..start + 8).ok_or(CodecError::Truncated)?;
    Ok(u64::from_be_bytes(
        source.try_into().map_err(|_| CodecError::Truncated)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(request_id: u32, offset: u64, length: u32) -> Vec<u8> {
        let mut bytes = vec![PROTOCOL_VERSION, RANGE_REQUEST];
        bytes.extend_from_slice(&request_id.to_be_bytes());
        bytes.extend_from_slice(&offset.to_be_bytes());
        bytes.extend_from_slice(&length.to_be_bytes());
        bytes
    }

    fn cancel(request_id: u32) -> Vec<u8> {
        let mut bytes = vec![PROTOCOL_VERSION, CANCEL_REQUEST];
        bytes.extend_from_slice(&request_id.to_be_bytes());
        bytes
    }

    fn ack(request_id: u32, next_offset: u64) -> Vec<u8> {
        let mut bytes = vec![PROTOCOL_VERSION, CHUNK_ACK];
        bytes.extend_from_slice(&request_id.to_be_bytes());
        bytes.extend_from_slice(&next_offset.to_be_bytes());
        bytes
    }

    #[test]
    fn decodes_each_control_frame_exactly() {
        assert_eq!(
            decode_control(&request(7, 11, 13)),
            Ok(ControlFrame::RangeRequest {
                request_id: 7,
                offset: 11,
                length: 13,
            })
        );
        assert_eq!(
            decode_control(&cancel(9)),
            Ok(ControlFrame::CancelRequest { request_id: 9 })
        );
        assert_eq!(
            decode_control(&ack(12, 65_535)),
            Ok(ControlFrame::ChunkAck {
                request_id: 12,
                next_offset: 65_535,
            })
        );
    }

    #[test]
    fn rejects_truncated_oversized_unknown_stale_and_overflowing_control() {
        assert_eq!(decode_control(&[]), Err(CodecError::Truncated));
        assert_eq!(
            decode_control(&[PROTOCOL_VERSION + 1, CANCEL_REQUEST, 0, 0, 0, 1]),
            Err(CodecError::UnsupportedVersion)
        );
        assert_eq!(
            decode_control(&[PROTOCOL_VERSION, 0x44]),
            Err(CodecError::UnknownFrame)
        );
        assert_eq!(
            decode_control(&vec![0; MAX_CONTROL_FRAME_BYTES + 1]),
            Err(CodecError::Oversized)
        );
        assert_eq!(
            decode_control(&request(1, 0, 0)),
            Err(CodecError::InvalidLength)
        );
        assert_eq!(
            decode_control(&request(1, u64::MAX, 1)),
            Err(CodecError::InvalidLength)
        );
        let mut trailing = cancel(1);
        trailing.push(0);
        assert_eq!(decode_control(&trailing), Err(CodecError::InvalidLength));
    }

    #[test]
    fn emits_bounded_response_frames_with_exact_identifiers_and_offsets() {
        let accepted = encode_range_accepted(7, 1_000, 20, 30);
        assert_eq!(accepted.len(), RANGE_ACCEPTED_BYTES);
        assert_eq!(&accepted[..2], &[PROTOCOL_VERSION, RANGE_ACCEPTED]);
        assert_eq!(read_u32(&accepted, 2), Ok(7));
        assert_eq!(read_u64(&accepted, 6), Ok(1_000));
        assert_eq!(read_u64(&accepted, 14), Ok(20));
        assert_eq!(read_u32(&accepted, 22), Ok(30));

        let payload = vec![0xa5; MAX_CHUNK_BYTES];
        let chunk = encode_range_chunk(8, 50, &payload).expect("maximum chunk");
        assert!(chunk.len() <= MAX_DATA_FRAME_BYTES);
        assert_eq!(read_u32(&chunk, 2), Ok(8));
        assert_eq!(read_u64(&chunk, 6), Ok(50));
        assert_eq!(&chunk[RANGE_CHUNK_HEADER_BYTES..], payload);

        assert_eq!(
            encode_range_chunk(1, 0, &[]),
            Err(CodecError::InvalidLength)
        );
        assert_eq!(
            encode_range_chunk(1, 0, &vec![0; MAX_CHUNK_BYTES + 1]),
            Err(CodecError::Oversized)
        );
        assert_eq!(
            encode_range_complete(9),
            vec![PROTOCOL_VERSION, RANGE_COMPLETE, 0, 0, 0, 9]
        );
        assert_eq!(
            encode_range_error(10, RangeErrorCode::Inactive),
            vec![PROTOCOL_VERSION, RANGE_ERROR, 0, 0, 0, 10, 7]
        );
    }
}
