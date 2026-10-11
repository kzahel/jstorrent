//! Runtime-independent reliable range framing and cumulative consumption credit.
use crate::codec::RangeErrorCode;

pub const VERSION: u8 = 2;
pub const BULK_LABEL: &str = "rstorrent-direct-file-v2-data";
pub const MAX_BUDGET: usize = 8 * 1024 * 1024;
pub const MAX_WIRE_BYTES: usize = 16 * 1024;
pub const MAX_PAYLOAD: usize = MAX_WIRE_BYTES - 14;
pub const MIN_TRANSPORT: usize = 64 * 1024;
pub const HELLO_TAG: u8 = 4;

/// Bounded BDP allowance at a 64-MiB/s design target; SCTP still owns congestion.
/// Small local RTTs retain the measured 64-KiB operating point.
pub fn transport_window(ceiling: usize, rtt_micros: u64) -> usize {
    let bdp = rtt_micros.saturating_mul(64 * 1024 * 1024) / 1_000_000;
    MIN_TRANSPORT
        .max(usize::try_from(bdp).unwrap_or(MAX_BUDGET))
        .min(ceiling)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Control {
    Read {
        id: u32,
        start: u64,
        end: u64,
        window: u32,
        priority: u8,
    },
    Credit {
        id: u32,
        consumed: u64,
        limit: u64,
    },
    Cancel {
        id: u32,
    },
}

pub fn hello(bytes: &[u8]) -> Option<(usize, usize)> {
    if bytes.len() != 10 || bytes[..2] != [1, HELLO_TAG] {
        return None;
    }
    let budget = u32::from_be_bytes(bytes[2..6].try_into().ok()?) as usize;
    let transport = u32::from_be_bytes(bytes[6..10].try_into().ok()?) as usize;
    (budget > 0 && budget <= MAX_BUDGET && (MIN_TRANSPORT..=MAX_BUDGET).contains(&transport))
        .then_some((budget, transport))
}

pub fn opened(length: u64, budget: usize, transport: usize, version: &[u8; 32]) -> Vec<u8> {
    let mut bytes = vec![VERSION, 0x80];
    bytes.extend(length.to_be_bytes());
    bytes.extend((budget as u32).to_be_bytes());
    bytes.extend((transport as u32).to_be_bytes());
    bytes.extend(version);
    bytes
}

pub fn decode(bytes: &[u8]) -> Result<Control, RangeErrorCode> {
    let bad = RangeErrorCode::Malformed;
    if bytes.len() < 6 || bytes[0] != VERSION {
        return Err(bad);
    }
    let id = u32::from_be_bytes(bytes[2..6].try_into().map_err(|_| bad)?);
    if id == 0 {
        return Err(bad);
    }
    match (bytes[1], bytes.len()) {
        (1, 27) => {
            let start = u64::from_be_bytes(bytes[6..14].try_into().map_err(|_| bad)?);
            let end = u64::from_be_bytes(bytes[14..22].try_into().map_err(|_| bad)?);
            let window = u32::from_be_bytes(bytes[22..26].try_into().map_err(|_| bad)?);
            let priority = bytes[26];
            if start > end || window == 0 || window as usize > MAX_BUDGET || priority > 1 {
                return Err(bad);
            }
            Ok(Control::Read {
                id,
                start,
                end,
                window,
                priority,
            })
        }
        (2, 6) => Ok(Control::Cancel { id }),
        (3, 22) => Ok(Control::Credit {
            id,
            consumed: u64::from_be_bytes(bytes[6..14].try_into().map_err(|_| bad)?),
            limit: u64::from_be_bytes(bytes[14..22].try_into().map_err(|_| bad)?),
        }),
        _ => Err(bad),
    }
}

pub fn data(id: u32, offset: u64, payload: &[u8]) -> Vec<u8> {
    assert!(!payload.is_empty() && payload.len() <= MAX_PAYLOAD);
    let mut bytes = terminal(id, 0x82, offset);
    bytes.extend(payload);
    bytes
}

pub fn terminal(id: u32, tag: u8, offset: u64) -> Vec<u8> {
    let mut bytes = vec![VERSION, tag];
    bytes.extend(id.to_be_bytes());
    bytes.extend(offset.to_be_bytes());
    bytes
}

pub fn error(id: u32, code: RangeErrorCode) -> Vec<u8> {
    let mut bytes = vec![VERSION, 0xff];
    bytes.extend(id.to_be_bytes());
    bytes.push(code as u8);
    bytes
}

#[derive(Debug)]
pub struct CreditWindow {
    pub sent: u64,
    pub consumed: u64,
    pub end: u64,
    limit: u64,
    window: u64,
}

impl CreditWindow {
    pub fn new(start: u64, end: u64, window: u32) -> Self {
        assert!(start <= end && window > 0);
        Self {
            sent: start,
            consumed: start,
            end,
            limit: end.min(start.saturating_add(window.into())),
            window: window.into(),
        }
    }
    pub fn available(&self) -> usize {
        (self.limit - self.sent).min(64 * 1024) as usize
    }
    pub fn sent(&mut self, bytes: usize) {
        assert!(bytes <= self.available());
        self.sent += bytes as u64;
    }
    pub fn update(&mut self, consumed: u64, limit: u64) -> Result<bool, RangeErrorCode> {
        if consumed > self.sent
            || limit > self.end
            || limit < consumed
            || limit.saturating_sub(consumed) > self.window
        {
            return Err(RangeErrorCode::Malformed);
        }
        // Ordered controls may still repeat an old absolute update. Ignore it.
        if consumed <= self.consumed && limit <= self.limit {
            return Ok(false);
        }
        if consumed < self.consumed || limit < self.limit {
            return Err(RangeErrorCode::Malformed);
        }
        let changed = consumed != self.consumed || limit != self.limit;
        self.consumed = consumed;
        self.limit = limit;
        Ok(changed)
    }
}

/// Fixed reservations survive cancellation until the bulk barrier is consumed.
#[derive(Debug)]
pub struct Admission {
    pub budget: usize,
    pub reserved: usize,
    last_id: u32,
}
impl Admission {
    pub fn new(budget: usize) -> Self {
        Self {
            budget,
            reserved: 0,
            last_id: 0,
        }
    }
    pub fn reserve(&mut self, id: u32, bytes: usize) -> Result<(), RangeErrorCode> {
        if id == 0 || id <= self.last_id {
            return Err(RangeErrorCode::DuplicateRequest);
        }
        self.last_id = id;
        if bytes > self.budget - self.reserved {
            return Err(RangeErrorCode::TooManyRequests);
        }
        self.reserved += bytes;
        Ok(())
    }
    pub fn has_seen(&self, id: u32) -> bool {
        id > 0 && id <= self.last_id
    }
    pub fn release(&mut self, bytes: usize) {
        self.reserved -= bytes;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transport_budget_tracks_rtt_without_enlarging_local_bursts() {
        assert_eq!(transport_window(MAX_BUDGET, 500), MIN_TRANSPORT);
        assert_eq!(transport_window(MAX_BUDGET, 100000), 6710886);
        assert_eq!(transport_window(MAX_BUDGET, u64::MAX), MAX_BUDGET);
        assert_eq!(transport_window(MIN_TRANSPORT, 100000), MIN_TRANSPORT);
    }
    #[test]
    fn absolute_credit_rejects_future_and_bounds_grants() {
        let mut w = CreditWindow::new(100, 1000, 64);
        assert_eq!(w.available(), 64);
        w.sent(64);
        assert!(w.update(165, 229).is_err());
        assert!(w.update(101, 166).is_err());
        w.update(132, 196).unwrap();
        assert!(!w.update(100, 164).unwrap());
        assert!(!w.update(132, 196).unwrap());
        assert_eq!(w.available(), 32);
        assert!(w.update(140, 190).is_err());
    }
    #[test]
    fn ranges_and_counters_work_near_u64_max() {
        let mut w = CreditWindow::new(u64::MAX - 20, u64::MAX, 100);
        assert_eq!(w.available(), 20);
        w.sent(20);
        w.update(u64::MAX, u64::MAX).unwrap();
        assert_eq!(w.available(), 0);
        assert_eq!(w.sent, w.consumed);
    }
    #[test]
    fn admission_is_shared_and_ids_never_reused() {
        let mut a = Admission::new(100);
        a.reserve(1, 60).unwrap();
        assert!(a.reserve(2, 60).is_err());
        a.reserve(3, 40).unwrap();
        a.release(60);
        assert!(a.reserve(1, 60).is_err());
        a.reserve(4, 60).unwrap();
        assert_eq!(a.reserved, 100);
    }
    #[test]
    fn hostile_frames_and_wire_total_are_bounded() {
        assert!(decode(&[2, 1, 0, 0, 0, 1]).is_err());
        assert!(decode(&[2, 2, 0, 0, 0, 0]).is_err());
        let frame = data(1, 0, &vec![0; MAX_PAYLOAD]);
        assert_eq!(frame.len(), MAX_WIRE_BYTES);
        assert!(decode(&frame).is_err());
        let mut request = terminal(1, 1, u64::MAX);
        request.extend(0u64.to_be_bytes());
        request.extend(64u32.to_be_bytes());
        request.push(0);
        assert!(decode(&request).is_err());
        request[6..14].copy_from_slice(&0u64.to_be_bytes());
        assert!(decode(&request).is_ok());
        request.push(0);
        assert!(decode(&request).is_err());
    }
}
