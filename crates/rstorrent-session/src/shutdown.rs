//! Application shutdown options, progress and the network cleanup cutoff.

use std::fmt;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

/// Default time application shutdown spends on network courtesy: tracker
/// `stopped` announces and UPnP mapping and pinhole deletes, together.
pub const DEFAULT_NETWORK_CLEANUP_BUDGET: Duration = Duration::from_secs(2);

/// Progress reported while `ApplicationService::shutdown_with` runs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ShutdownProgress {
    /// Active torrents are being stopped and their verified pieces flushed.
    StoppingTorrents {
        count: usize,
    },
    /// Tracker `stopped` announces and port-mapping removal have started
    /// and will end within `budget` or when hurried.
    NetworkCleanup {
        budget: Duration,
    },
    /// Torrents whose `stopped` announces did not finish in time.
    TrackerStopsCutShort {
        torrents: usize,
    },
    /// A port mapping or pinhole that could not be removed in time and
    /// stays on the router until its lease expires.
    PortMappingLeft {
        detail: String,
    },
    NetworkStopped,
    SavingState,
    Finished,
}

pub type ShutdownProgressSink = Arc<dyn Fn(ShutdownProgress) + Send + Sync>;

/// Options for `ApplicationService::shutdown_with`.
#[derive(Clone)]
pub struct ShutdownOptions {
    pub network_cleanup_budget: Duration,
    /// Cancelling ends network courtesy work immediately. Torrent stops and
    /// local persistence still complete.
    pub hurry: CancellationToken,
    /// Called synchronously at each phase; must not block.
    pub progress: Option<ShutdownProgressSink>,
}

impl Default for ShutdownOptions {
    fn default() -> Self {
        Self {
            network_cleanup_budget: DEFAULT_NETWORK_CLEANUP_BUDGET,
            hurry: CancellationToken::new(),
            progress: None,
        }
    }
}

impl fmt::Debug for ShutdownOptions {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ShutdownOptions")
            .field("network_cleanup_budget", &self.network_cleanup_budget)
            .field("hurry", &self.hurry.is_cancelled())
            .field("progress", &self.progress.is_some())
            .finish()
    }
}

impl ShutdownOptions {
    pub(crate) fn report(&self, progress: ShutdownProgress) {
        if let Some(sink) = &self.progress {
            sink(progress);
        }
    }
}

/// When network courtesy work must stop: at `deadline` or when `hurry` is
/// cancelled, whichever comes first. Tracker `stopped` announces stop at
/// `tracker_deadline`, leaving the last quarter of the budget to remove port
/// mappings, which otherwise stay open on the router until their lease ends.
#[derive(Clone, Debug)]
pub(crate) struct CleanupCutoff {
    pub tracker_deadline: Instant,
    pub deadline: Instant,
    pub hurry: CancellationToken,
}

impl CleanupCutoff {
    pub(crate) fn starting_now(budget: Duration, hurry: CancellationToken) -> Self {
        let now = Instant::now();
        Self {
            tracker_deadline: now + budget - budget / 4,
            deadline: now + budget,
            hurry,
        }
    }

    pub(crate) async fn reached(&self) {
        tokio::select! {
            () = tokio::time::sleep_until(tokio::time::Instant::from_std(self.deadline)) => {}
            () = self.hurry.cancelled() => {}
        }
    }
}
