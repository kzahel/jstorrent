//! Deterministic, bounded write-credit state; no runtime or storage authority.
use std::collections::VecDeque;

use crate::codec::MAX_CHUNK_BYTES;

pub(crate) const MAX_SEND_WINDOW_BYTES: usize = 4 * MAX_CHUNK_BYTES;

pub(crate) fn valid_window_bytes(bytes: usize) -> bool {
    matches!(bytes, MAX_CHUNK_BYTES | MAX_SEND_WINDOW_BYTES) || bytes == 2 * MAX_CHUNK_BYTES
}

pub(crate) struct SendWindow {
    sent: u64,
    acknowledged: u64,
    end: u64,
    capacity: usize,
    boundaries: VecDeque<u64>,
}

impl SendWindow {
    pub(crate) fn new(offset: u64, end: u64, capacity: usize) -> Self {
        assert!(offset <= end && valid_window_bytes(capacity));
        Self {
            sent: offset,
            acknowledged: offset,
            end,
            capacity,
            boundaries: VecDeque::with_capacity(capacity / MAX_CHUNK_BYTES),
        }
    }

    pub(crate) fn next_chunk(&self) -> Option<(u64, usize)> {
        let length = (self.end - self.sent).min(MAX_CHUNK_BYTES as u64) as usize;
        if length == 0 || self.sent - self.acknowledged + length as u64 > self.capacity as u64 {
            None
        } else {
            Some((self.sent, length))
        }
    }

    pub(crate) fn record_sent(&mut self, length: usize) {
        assert_eq!(self.next_chunk(), Some((self.sent, length)));
        self.sent += length as u64;
        self.boundaries.push_back(self.sent);
    }

    /// Accept only forward credit at a boundary already produced. Cumulative
    /// ACKs may release several chunks, but duplicates/backtracking are errors.
    pub(crate) fn acknowledge(&mut self, next: u64) -> Result<usize, ()> {
        if next <= self.acknowledged || !self.boundaries.contains(&next) {
            return Err(());
        }
        let released = (next - self.acknowledged) as usize;
        self.acknowledged = next;
        while self
            .boundaries
            .front()
            .is_some_and(|boundary| *boundary <= next)
        {
            self.boundaries.pop_front();
        }
        Ok(released)
    }

    pub(crate) fn complete(&self) -> bool {
        self.acknowledged == self.end
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credit_is_bounded_until_a_written_boundary_is_acknowledged() {
        let mut window =
            SendWindow::new(10, 10 + 8 * MAX_CHUNK_BYTES as u64, MAX_SEND_WINDOW_BYTES);
        for _ in 0..4 {
            let (_, length) = window.next_chunk().unwrap();
            window.record_sent(length);
        }
        assert_eq!(window.next_chunk(), None);
        assert_eq!(
            window.acknowledge(10 + MAX_CHUNK_BYTES as u64),
            Ok(MAX_CHUNK_BYTES)
        );
        assert!(window.next_chunk().is_some());
        window.record_sent(MAX_CHUNK_BYTES);
        assert_eq!(window.next_chunk(), None);
    }

    #[test]
    fn invalid_ack_does_not_release_credit() {
        let mut window = SendWindow::new(10, 100_000, MAX_SEND_WINDOW_BYTES);
        window.record_sent(MAX_CHUNK_BYTES);
        for ack in [0, 10, 11, 10 + MAX_CHUNK_BYTES as u64 + 1, u64::MAX] {
            assert_eq!(window.acknowledge(ack), Err(()));
            assert_eq!(window.acknowledged, 10);
        }
        let end = 10 + MAX_CHUNK_BYTES as u64;
        assert_eq!(window.acknowledge(end), Ok(MAX_CHUNK_BYTES));
        assert_eq!(window.acknowledge(end), Err(()));
        assert_eq!(window.acknowledge(10), Err(()));
    }

    #[test]
    fn cumulative_credit_and_short_final_chunk_near_u64_limit() {
        let offset = u64::MAX - 2 * MAX_CHUNK_BYTES as u64 - 7;
        let mut window = SendWindow::new(offset, u64::MAX, MAX_SEND_WINDOW_BYTES);
        window.record_sent(MAX_CHUNK_BYTES);
        window.record_sent(MAX_CHUNK_BYTES);
        window.record_sent(7);
        assert!(!window.complete());
        assert_eq!(window.acknowledge(u64::MAX), Ok(2 * MAX_CHUNK_BYTES + 7));
        assert!(window.complete());
        assert_eq!(window.next_chunk(), None);
        assert_eq!(window.boundaries.len(), 0);
    }

    #[test]
    fn empty_range_and_one_chunk_baseline() {
        assert!(SendWindow::new(42, 42, MAX_CHUNK_BYTES).complete());
        let mut window = SendWindow::new(0, 2 * MAX_CHUNK_BYTES as u64, MAX_CHUNK_BYTES);
        window.record_sent(MAX_CHUNK_BYTES);
        assert_eq!(window.next_chunk(), None);
        assert_eq!(
            window.acknowledge(MAX_CHUNK_BYTES as u64),
            Ok(MAX_CHUNK_BYTES)
        );
        assert!(window.next_chunk().is_some());
    }
}
