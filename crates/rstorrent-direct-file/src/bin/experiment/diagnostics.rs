//! Numeric, experiment-only SCTP log observations. Never retain log text/payload.
use serde::Serialize;
use std::sync::Mutex;
#[derive(Clone, Default, Serialize)]
pub struct Diagnostic {
    pub initial_receive_window: u64,
    pub max_congestion_window: u64,
    pub slow_start_updates: u64,
    pub avoidance_updates: u64,
    pub recovery_updates: u64,
    pub retransmission_timeouts: u64,
}
struct Logger;
static LOGGER: Logger = Logger;
static DIAGNOSTIC: Mutex<Diagnostic> = Mutex::new(Diagnostic {
    initial_receive_window: 0,
    max_congestion_window: 0,
    slow_start_updates: 0,
    avoidance_updates: 0,
    recovery_updates: 0,
    retransmission_timeouts: 0,
});
impl log::Log for Logger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.target().starts_with("rtc_sctp::association")
    }
    fn log(&self, record: &log::Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let text = record.args().to_string();
        if !(text.contains("initial rwnd=") || text.contains("updated cwnd=")) {
            return;
        }
        let mut diagnostic = DIAGNOSTIC.lock().unwrap();
        if let Some(value) = number(&text, "initial rwnd=") {
            diagnostic.initial_receive_window = value;
        }
        if let Some(value) = number(&text, "updated cwnd=") {
            diagnostic.max_congestion_window = diagnostic.max_congestion_window.max(value);
            if text.contains("(SS)") {
                diagnostic.slow_start_updates += 1;
            }
            if text.contains("(CA)") {
                diagnostic.avoidance_updates += 1;
            }
            if text.contains("(FR)") {
                diagnostic.recovery_updates += 1;
            }
            if text.contains("(RTO)") {
                diagnostic.retransmission_timeouts += 1;
            }
        }
    }
    fn flush(&self) {}
}
fn number(text: &str, key: &str) -> Option<u64> {
    text.split_once(key)?
        .1
        .split(|c: char| !c.is_ascii_digit())
        .next()?
        .parse()
        .ok()
}
pub fn enable() {
    log::set_logger(&LOGGER).expect("experiment logger");
    log::set_max_level(log::LevelFilter::Trace);
}
pub fn reset() {
    *DIAGNOSTIC.lock().unwrap() = Diagnostic::default();
}
pub fn snapshot() -> Diagnostic {
    DIAGNOSTIC.lock().unwrap().clone()
}
