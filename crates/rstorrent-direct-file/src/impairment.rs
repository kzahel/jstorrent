//! Experiment-only bounded UDP delay/loss, below DTLS/SCTP and above the socket.
use crate::endpoint::ExperimentSource;
use std::{collections::VecDeque, net::SocketAddr, time::Duration};
use tokio::time::Instant;
const MAX_QUEUED: usize = 32 * 1024 * 1024;
pub(crate) struct Datagram {
    pub incoming: bool,
    pub address: SocketAddr,
    pub bytes: Vec<u8>,
    due: Instant,
}
pub(crate) struct Impairment {
    delay: Duration,
    loss_every: u32,
    sequence: u64,
    incoming: VecDeque<Datagram>,
    outgoing: VecDeque<Datagram>,
    rate_mib: u32,
    last_outgoing: Instant,
    tokens: f64,
    last_refill: Instant,
    bytes: usize,
    pub high_water: usize,
    pub dropped: usize,
    pub overflow: usize,
}
impl Impairment {
    pub fn new(source: ExperimentSource) -> Self {
        let (delay, loss_every, rate_mib) = match source {
            ExperimentSource::Network {
                delay_ms,
                loss_every,
                rate_mib,
            } => (delay_ms, loss_every, rate_mib),
            _ => (0, 0, 0),
        };
        Self {
            delay: Duration::from_millis(delay),
            loss_every,
            sequence: 0,
            incoming: VecDeque::new(),
            outgoing: VecDeque::new(),
            rate_mib,
            last_outgoing: Instant::now(),
            tokens: 32768.0,
            last_refill: Instant::now(),
            bytes: 0,
            high_water: 0,
            dropped: 0,
            overflow: 0,
        }
    }
    pub fn enabled(&self) -> bool {
        !self.delay.is_zero() || self.loss_every > 0 || self.rate_mib > 0
    }
    pub fn enqueue(&mut self, incoming: bool, address: SocketAddr, bytes: &[u8]) {
        self.sequence += 1;
        if self.loss_every > 0 && self.sequence.is_multiple_of(u64::from(self.loss_every)) {
            self.dropped += 1;
            return;
        }
        if self.bytes.saturating_add(bytes.len()) > MAX_QUEUED {
            self.overflow += 1;
            return;
        }
        self.bytes += bytes.len();
        self.high_water = self.high_water.max(self.bytes);
        let mut due = Instant::now() + self.delay;
        if !incoming && self.rate_mib > 0 {
            let serialization = Duration::from_secs_f64(
                bytes.len() as f64 / (f64::from(self.rate_mib) * 1048576.0),
            );
            due = due.max(self.last_outgoing + serialization);
            self.last_outgoing = due;
        }
        let queue = if incoming {
            &mut self.incoming
        } else {
            &mut self.outgoing
        };
        queue.push_back(Datagram {
            incoming,
            address,
            bytes: bytes.to_vec(),
            due,
        });
    }
    fn outgoing_deadline(&self, now: Instant) -> Option<Instant> {
        let head = self.outgoing.front()?;
        if self.rate_mib == 0 {
            return Some(head.due);
        }
        let rate = f64::from(self.rate_mib) * 1048576.0;
        let tokens =
            (self.tokens + now.duration_since(self.last_refill).as_secs_f64() * rate).min(32768.0);
        let wait = Duration::from_secs_f64(((head.bytes.len() as f64 - tokens) / rate).max(0.0));
        Some(head.due.max(now + wait))
    }
    pub fn deadline(&self) -> Instant {
        self.incoming
            .front()
            .map(|d| d.due)
            .into_iter()
            .chain(self.outgoing_deadline(Instant::now()))
            .min()
            .unwrap_or_else(|| Instant::now() + Duration::from_secs(86400))
    }
    pub fn pop_due(&mut self) -> Option<Datagram> {
        self.pop_due_at(Instant::now())
    }
    fn pop_due_at(&mut self, now: Instant) -> Option<Datagram> {
        let incoming = self.incoming.front().is_some_and(|d| d.due <= now);
        let outgoing = self.outgoing_deadline(now).is_some_and(|due| due <= now);
        let datagram = if incoming {
            self.incoming.pop_front()
        } else if outgoing {
            self.outgoing.pop_front()
        } else {
            None
        }?;
        if !datagram.incoming && self.rate_mib > 0 {
            self.tokens = (self.tokens
                + now.duration_since(self.last_refill).as_secs_f64()
                    * f64::from(self.rate_mib)
                    * 1048576.0)
                .min(32768.0);
            self.tokens = (self.tokens - datagram.bytes.len() as f64).max(0.0);
            self.last_refill = now;
        }
        self.bytes -= datagram.bytes.len();
        Some(datagram)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delayed_wakeups_cannot_release_an_unbounded_shaped_burst() {
        let mut network = Impairment::new(ExperimentSource::Network {
            delay_ms: 0,
            loss_every: 0,
            rate_mib: 1,
        });
        let address = "127.0.0.1:1".parse().unwrap();
        for _ in 0..100 {
            network.enqueue(false, address, &[0; 2000]);
        }
        let released_at = network.last_refill + Duration::from_millis(60);
        let mut bytes = 0;
        while let Some(packet) = network.pop_due_at(released_at) {
            bytes += packet.bytes.len();
        }
        assert!(bytes > 0 && bytes < 40000);
        network.enqueue(true, address, &[1]);
        assert!(network.pop_due_at(released_at).unwrap().incoming);
    }
    #[tokio::test]
    async fn actual_datagrams_delay_and_loss_are_bounded() {
        let mut network = Impairment::new(ExperimentSource::Network {
            delay_ms: 5,
            loss_every: 3,
            rate_mib: 0,
        });
        let address = "127.0.0.1:1".parse().unwrap();
        for _ in 0..3 {
            network.enqueue(true, address, &[1, 2]);
        }
        assert!(network.pop_due().is_none());
        assert_eq!(network.dropped, 1);
        tokio::time::sleep(Duration::from_millis(8)).await;
        assert_eq!(network.pop_due().unwrap().bytes, [1, 2]);
        assert!(network.pop_due().is_some());
        assert!(network.pop_due().is_none());
        assert_eq!(network.high_water, 4);
        network.enqueue(false, address, &vec![0; MAX_QUEUED + 1]);
        assert_eq!(network.overflow, 1);
    }
}
