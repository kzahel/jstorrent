//! Owned media producer. Framing/credit policy stays in range_protocol.
use crate::codec::RangeErrorCode;
use crate::endpoint::{
    EndpointMetrics, ExperimentSource, OutboundFrame, REQUEST_INACTIVE_TIMEOUT, SharedApplication,
    queue_frame_to,
};
use crate::range_protocol::{self as wire, CreditWindow};
use rstorrent_session::MediaCapabilityLease;
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, watch};
use tokio_util::sync::CancellationToken;

pub(crate) struct RangeProducer {
    pub application: SharedApplication,
    pub capability: String,
    pub id: u32,
    pub state: Arc<Mutex<CreditWindow>>,
    pub updates: watch::Receiver<()>,
    pub outbound: mpsc::Sender<OutboundFrame>,
    pub cancel: CancellationToken,
    pub connection_cancel: CancellationToken,
    pub metrics: Arc<EndpointMetrics>,
    pub source: ExperimentSource,
    pub priority: u8,
}

impl RangeProducer {
    async fn queue(&self, bytes: Vec<u8>) -> bool {
        tokio::select! {
            _ = self.connection_cancel.cancelled() => false,
            result = queue_frame_to(&self.outbound, &self.metrics, bytes, true, self.id, self.priority) => result,
        }
    }
    pub async fn run(mut self) -> &'static str {
        let lease = self
            .application
            .lock()
            .await
            .resolve_media_capability(&self.capability);
        let mut lease = match lease {
            Ok(lease) => lease,
            Err(_) => {
                self.queue(wire::error(self.id, RangeErrorCode::CapabilityUnavailable))
                    .await;
                return "capability_unavailable";
            }
        };
        let (mut current, end) = {
            let state = self.state.lock().unwrap();
            (state.sent, state.end)
        };
        if end > lease.length() {
            self.queue(wire::error(self.id, RangeErrorCode::InvalidRange))
                .await;
            return "invalid_range";
        }
        let mut served = current;
        let mut terminal = "complete";
        let mut error = None;
        while current < end {
            if self.cancel.is_cancelled() {
                terminal = "cancelled";
                break;
            }
            let (available, consumed) = {
                let state = self.state.lock().unwrap();
                (state.available(), state.consumed)
            };
            if consumed > served {
                lease.touch_served((consumed - served) as usize);
                served = consumed;
            }
            if available == 0 {
                let changed = tokio::select! {
                    _ = self.connection_cancel.cancelled() => return "driver_closed",
                    _ = self.cancel.cancelled() => { terminal = "cancelled"; break; },
                    changed = tokio::time::timeout(REQUEST_INACTIVE_TIMEOUT, self.updates.changed()) => changed,
                };
                if !matches!(changed, Ok(Ok(()))) {
                    terminal = "inactive";
                    error = Some(RangeErrorCode::Inactive);
                    break;
                }
                continue;
            }
            let read = read_batch(&mut lease, current, available, self.source);
            let bytes = tokio::select! {
                _ = self.connection_cancel.cancelled() => return "driver_closed",
                _ = self.cancel.cancelled() => { terminal = "cancelled"; break; },
                bytes = read => match bytes {
                    Ok(bytes) if bytes.len() == available => bytes,
                    _ => { terminal = "read_unavailable"; error = Some(RangeErrorCode::ReadUnavailable); break; },
                },
            };
            // Fragment one bounded verified read into independent <=16-KiB messages.
            for payload in bytes.chunks(wire::MAX_PAYLOAD) {
                if self.cancel.is_cancelled() {
                    terminal = "cancelled";
                    break;
                }
                if !self.queue(wire::data(self.id, current, payload)).await {
                    return "queue_closed";
                }
                self.state.lock().unwrap().sent(payload.len());
                current += payload.len() as u64;
            }
            lease.touch();
        }
        let frame = match error {
            Some(code) => wire::error(self.id, code),
            None => wire::terminal(
                self.id,
                if terminal == "cancelled" { 0x84 } else { 0x83 },
                current,
            ),
        };
        if !self.queue(frame).await {
            return "queue_closed";
        }
        // Keep the fixed reservation through the terminal barrier and all received
        // bytes. No task/ID/window recycling can outrun a cancelled bulk stream.
        loop {
            let consumed = self.state.lock().unwrap().consumed;
            if consumed > served {
                lease.touch_served((consumed - served) as usize);
                served = consumed;
            }
            if consumed == current {
                return terminal;
            }
            let changed = tokio::select! {
                _ = self.connection_cancel.cancelled() => return "driver_closed",
                changed = tokio::time::timeout(REQUEST_INACTIVE_TIMEOUT, self.updates.changed()) => changed,
            };
            if !matches!(changed, Ok(Ok(()))) {
                return "inactive";
            }
        }
    }
}

async fn read_batch(
    lease: &mut MediaCapabilityLease,
    offset: u64,
    length: usize,
    source: ExperimentSource,
) -> Result<Vec<u8>, ()> {
    lease.wait_for_range(offset, length).await.map_err(|_| ())?;
    #[cfg(feature = "experiment")]
    if matches!(source, ExperimentSource::GeneratedRanges) {
        return Ok(crate::endpoint::generated_bytes(offset, length));
    }
    #[cfg(not(feature = "experiment"))]
    let _ = source;
    lease.read_range(offset, length).await.map_err(|_| ())
}
