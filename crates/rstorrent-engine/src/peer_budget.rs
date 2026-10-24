//! Runtime-independent session TCP peer admission and owned accounting.

use std::collections::BTreeMap;
use std::error::Error;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tokio_util::sync::CancellationToken;

pub const DEFAULT_CONNECTION_LIMIT: usize = 200;
pub const DEFAULT_INCOMING_CONNECTION_SLACK: usize = 10;
pub const DEFAULT_LISTEN_BACKLOG: u32 = 5;

const MIN_EFFECTIVE_CONNECTION_LIMIT: usize = 5;
const OPEN_FILE_MARGIN: usize = 20;
const CONNECTION_FILE_PERCENT: usize = 80;
const MAX_REPORTED_OPEN_FILES: usize = 10_000_000;
#[cfg(not(any(unix, windows)))]
const OPEN_FILE_QUERY_FALLBACK: usize = 1_024;
#[cfg(windows)]
const OPEN_FILE_PLATFORM_FALLBACK: usize = 10_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PeerBudgetConfig {
    pub configured_limit: usize,
    pub incoming_slack: usize,
    pub max_open_files: usize,
}

impl PeerBudgetConfig {
    pub fn system_default() -> Self {
        Self {
            configured_limit: DEFAULT_CONNECTION_LIMIT,
            incoming_slack: DEFAULT_INCOMING_CONNECTION_SLACK,
            max_open_files: detected_max_open_files(),
        }
    }

    pub fn effective_limit(self) -> usize {
        effective_connection_limit(self.configured_limit, self.max_open_files)
    }
}

impl Default for PeerBudgetConfig {
    fn default() -> Self {
        Self::system_default()
    }
}

pub const fn effective_connection_limit(configured: usize, max_open_files: usize) -> usize {
    let reported = if max_open_files > MAX_REPORTED_OPEN_FILES {
        MAX_REPORTED_OPEN_FILES
    } else {
        max_open_files
    };
    let available = reported.saturating_sub(OPEN_FILE_MARGIN);
    let connection_files = available.saturating_mul(CONNECTION_FILE_PERCENT) / 100;
    let descriptor_limit = if connection_files < MIN_EFFECTIVE_CONNECTION_LIMIT {
        MIN_EFFECTIVE_CONNECTION_LIMIT
    } else {
        connection_files
    };
    if configured < descriptor_limit {
        configured
    } else {
        descriptor_limit
    }
}

#[cfg(unix)]
fn detected_max_open_files() -> usize {
    rustix::process::getrlimit(rustix::process::Resource::Nofile)
        .current
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(MAX_REPORTED_OPEN_FILES)
        .min(MAX_REPORTED_OPEN_FILES)
}

#[cfg(windows)]
const fn detected_max_open_files() -> usize {
    OPEN_FILE_PLATFORM_FALLBACK
}

#[cfg(not(any(unix, windows)))]
const fn detected_max_open_files() -> usize {
    OPEN_FILE_QUERY_FALLBACK
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PeerBudgetDirection {
    Incoming,
    Outgoing,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PeerBudgetPhase {
    Connecting,
    Established,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct PeerBudgetSnapshot {
    pub configured_limit: usize,
    pub effective_limit: usize,
    pub incoming_slack: usize,
    pub outgoing_connecting: usize,
    pub outgoing_established: usize,
    pub incoming_connecting: usize,
    pub incoming_established: usize,
    pub total: usize,
    pub total_high_water: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PeerBudgetRejection {
    pub direction: PeerBudgetDirection,
    pub current: usize,
    pub maximum: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PeerBudgetReconfiguration {
    pub configured_limit: usize,
    pub effective_limit: usize,
    pub absolute_limit: usize,
    pub cancellation_requests: usize,
    pub within_limit: bool,
}

#[derive(Clone, Debug)]
struct PeerBudgetEntry {
    direction: PeerBudgetDirection,
    phase: PeerBudgetPhase,
    cancellation: CancellationToken,
    cancellation_requested: bool,
}

impl fmt::Display for PeerBudgetRejection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{:?} peer connection limit reached ({}/{})",
            self.direction, self.current, self.maximum
        )
    }
}

impl Error for PeerBudgetRejection {}

#[derive(Debug)]
struct PeerBudgetState {
    config: PeerBudgetConfig,
    effective_limit: usize,
    next_generation: u64,
    outgoing_connecting: usize,
    outgoing_established: usize,
    incoming_connecting: usize,
    incoming_established: usize,
    total_high_water: usize,
    entries: BTreeMap<u64, PeerBudgetEntry>,
}

impl PeerBudgetState {
    fn total(&self) -> usize {
        self.outgoing_connecting
            + self.outgoing_established
            + self.incoming_connecting
            + self.incoming_established
    }

    fn maximum(&self, direction: PeerBudgetDirection) -> usize {
        match direction {
            PeerBudgetDirection::Outgoing => self.effective_limit,
            PeerBudgetDirection::Incoming => self
                .effective_limit
                .saturating_add(self.config.incoming_slack),
        }
    }

    fn increment(&mut self, direction: PeerBudgetDirection, phase: PeerBudgetPhase) {
        *self.counter_mut(direction, phase) += 1;
        self.total_high_water = self.total_high_water.max(self.total());
    }

    fn decrement(&mut self, direction: PeerBudgetDirection, phase: PeerBudgetPhase) {
        let counter = self.counter_mut(direction, phase);
        debug_assert!(*counter > 0, "peer budget counter underflow");
        *counter = counter.saturating_sub(1);
    }

    fn counter_mut(
        &mut self,
        direction: PeerBudgetDirection,
        phase: PeerBudgetPhase,
    ) -> &mut usize {
        match (direction, phase) {
            (PeerBudgetDirection::Outgoing, PeerBudgetPhase::Connecting) => {
                &mut self.outgoing_connecting
            }
            (PeerBudgetDirection::Outgoing, PeerBudgetPhase::Established) => {
                &mut self.outgoing_established
            }
            (PeerBudgetDirection::Incoming, PeerBudgetPhase::Connecting) => {
                &mut self.incoming_connecting
            }
            (PeerBudgetDirection::Incoming, PeerBudgetPhase::Established) => {
                &mut self.incoming_established
            }
        }
    }

    fn snapshot(&self) -> PeerBudgetSnapshot {
        PeerBudgetSnapshot {
            configured_limit: self.config.configured_limit,
            effective_limit: self.effective_limit,
            incoming_slack: self.config.incoming_slack,
            outgoing_connecting: self.outgoing_connecting,
            outgoing_established: self.outgoing_established,
            incoming_connecting: self.incoming_connecting,
            incoming_established: self.incoming_established,
            total: self.total(),
            total_high_water: self.total_high_water,
        }
    }

    fn absolute_limit(&self) -> usize {
        self.effective_limit
            .saturating_add(self.config.incoming_slack)
    }
}

#[derive(Clone, Debug)]
pub struct PeerBudget {
    state: Arc<Mutex<PeerBudgetState>>,
}

impl PeerBudget {
    pub fn new(config: PeerBudgetConfig) -> Self {
        let effective_limit = config.effective_limit();
        Self {
            state: Arc::new(Mutex::new(PeerBudgetState {
                config,
                effective_limit,
                next_generation: 1,
                outgoing_connecting: 0,
                outgoing_established: 0,
                incoming_connecting: 0,
                incoming_established: 0,
                total_high_water: 0,
                entries: BTreeMap::new(),
            })),
        }
    }

    pub fn system_default() -> Self {
        Self::new(PeerBudgetConfig::system_default())
    }

    pub fn try_acquire(
        &self,
        direction: PeerBudgetDirection,
    ) -> Result<PeerBudgetPermit, PeerBudgetRejection> {
        let mut state = self.state_guard();
        let current = state.total();
        let maximum = state.maximum(direction);
        if current >= maximum {
            return Err(PeerBudgetRejection {
                direction,
                current,
                maximum,
            });
        }
        let generation = state.next_generation;
        if generation == 0 {
            return Err(PeerBudgetRejection {
                direction,
                current,
                maximum: current,
            });
        }
        state.next_generation = generation.checked_add(1).unwrap_or(0);
        let cancellation = CancellationToken::new();
        state.entries.insert(
            generation,
            PeerBudgetEntry {
                direction,
                phase: PeerBudgetPhase::Connecting,
                cancellation: cancellation.clone(),
                cancellation_requested: false,
            },
        );
        state.increment(direction, PeerBudgetPhase::Connecting);
        Ok(PeerBudgetPermit {
            state: self.state.clone(),
            generation,
            direction,
            phase: PeerBudgetPhase::Connecting,
            cancellation,
            active: true,
        })
    }

    pub fn reconfigure(&self, configured_limit: usize) -> PeerBudgetReconfiguration {
        let (outcome, cancellations) = {
            let mut state = self.state_guard();
            state.config.configured_limit = configured_limit;
            state.effective_limit = state.config.effective_limit();
            let absolute_limit = state.absolute_limit();
            let excess = state.total().saturating_sub(absolute_limit);
            let already_requested = state
                .entries
                .values()
                .filter(|entry| entry.cancellation_requested)
                .count();
            let additional = excess.saturating_sub(already_requested);
            let mut candidates = state
                .entries
                .iter()
                .filter(|(_, entry)| !entry.cancellation_requested)
                .map(|(generation, entry)| (*generation, entry.phase))
                .collect::<Vec<_>>();
            candidates.sort_by(
                |(left_generation, left_phase), (right_generation, right_phase)| {
                    phase_eviction_order(*left_phase)
                        .cmp(&phase_eviction_order(*right_phase))
                        .then_with(|| right_generation.cmp(left_generation))
                },
            );
            let selected = candidates
                .into_iter()
                .take(additional)
                .map(|(generation, _)| generation)
                .collect::<Vec<_>>();
            let cancellations = selected
                .iter()
                .filter_map(|generation| {
                    let entry = state.entries.get_mut(generation)?;
                    entry.cancellation_requested = true;
                    Some(entry.cancellation.clone())
                })
                .collect::<Vec<_>>();
            (
                PeerBudgetReconfiguration {
                    configured_limit,
                    effective_limit: state.effective_limit,
                    absolute_limit,
                    cancellation_requests: cancellations.len(),
                    within_limit: state.total() <= absolute_limit,
                },
                cancellations,
            )
        };
        for cancellation in cancellations {
            cancellation.cancel();
        }
        outcome
    }

    /// Retire one direction without changing the shared connection limit.
    pub fn cancel_incoming(&self) {
        let cancellations = {
            let mut state = self.state_guard();
            state
                .entries
                .values_mut()
                .filter(|entry| {
                    entry.direction == PeerBudgetDirection::Incoming
                        && !entry.cancellation_requested
                })
                .map(|entry| {
                    entry.cancellation_requested = true;
                    entry.cancellation.clone()
                })
                .collect::<Vec<_>>()
        };
        for cancellation in cancellations {
            cancellation.cancel();
        }
    }

    pub fn within_absolute_limit(&self) -> bool {
        let state = self.state_guard();
        state.total() <= state.absolute_limit()
    }

    pub fn snapshot(&self) -> PeerBudgetSnapshot {
        self.state_guard().snapshot()
    }

    fn state_guard(&self) -> MutexGuard<'_, PeerBudgetState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Default for PeerBudget {
    fn default() -> Self {
        Self::system_default()
    }
}

#[derive(Debug)]
pub struct PeerBudgetPermit {
    state: Arc<Mutex<PeerBudgetState>>,
    generation: u64,
    direction: PeerBudgetDirection,
    phase: PeerBudgetPhase,
    cancellation: CancellationToken,
    active: bool,
}

impl PeerBudgetPermit {
    pub const fn generation(&self) -> u64 {
        self.generation
    }

    pub const fn direction(&self) -> PeerBudgetDirection {
        self.direction
    }

    pub const fn phase(&self) -> PeerBudgetPhase {
        self.phase
    }

    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancellation.clone()
    }

    pub fn mark_established(&mut self) {
        if self.phase == PeerBudgetPhase::Established || !self.active {
            return;
        }
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.decrement(self.direction, self.phase);
        self.phase = PeerBudgetPhase::Established;
        state.increment(self.direction, self.phase);
        if let Some(entry) = state.entries.get_mut(&self.generation) {
            debug_assert_eq!(entry.direction, self.direction);
            entry.phase = self.phase;
        }
    }
}

impl Drop for PeerBudgetPermit {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        self.active = false;
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.entries.remove(&self.generation);
        state.decrement(self.direction, self.phase);
    }
}

const fn phase_eviction_order(phase: PeerBudgetPhase) -> u8 {
    match phase {
        PeerBudgetPhase::Connecting => 0,
        PeerBudgetPhase::Established => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_CONNECTION_LIMIT, DEFAULT_INCOMING_CONNECTION_SLACK, PeerBudget, PeerBudgetConfig,
        PeerBudgetDirection, PeerBudgetPhase, effective_connection_limit,
    };

    fn budget(limit: usize, slack: usize) -> PeerBudget {
        PeerBudget::new(PeerBudgetConfig {
            configured_limit: limit,
            incoming_slack: slack,
            max_open_files: 10_000,
        })
    }

    #[test]
    fn incoming_cancellation_preserves_outgoing_permits_and_limit() {
        let budget = PeerBudget::system_default();
        let inbound = budget.try_acquire(PeerBudgetDirection::Incoming).unwrap();
        let mut established = budget.try_acquire(PeerBudgetDirection::Incoming).unwrap();
        established.mark_established();
        let outbound = budget.try_acquire(PeerBudgetDirection::Outgoing).unwrap();
        let limit = budget.snapshot().effective_limit;
        budget.cancel_incoming();
        budget.cancel_incoming();
        assert!(inbound.cancellation_token().is_cancelled());
        assert!(established.cancellation_token().is_cancelled());
        assert!(!outbound.cancellation_token().is_cancelled());
        assert_eq!(budget.snapshot().effective_limit, limit);
    }

    #[test]
    fn libtorrent_defaults_and_descriptor_clamp_are_exact() {
        let defaults = PeerBudgetConfig::system_default();
        assert_eq!(defaults.configured_limit, DEFAULT_CONNECTION_LIMIT);
        assert_eq!(defaults.incoming_slack, DEFAULT_INCOMING_CONNECTION_SLACK);
        assert_eq!(effective_connection_limit(200, 256), 188);
        assert_eq!(effective_connection_limit(200, 1_024), 200);
        assert_eq!(effective_connection_limit(200, 20), 5);
        assert_eq!(effective_connection_limit(3, 20), 3);
        assert_eq!(effective_connection_limit(200, usize::MAX), 200);
    }

    #[test]
    fn outgoing_stops_at_normal_limit_and_incoming_uses_only_slack() {
        let budget = budget(2, 1);
        let outgoing = budget
            .try_acquire(PeerBudgetDirection::Outgoing)
            .expect("first outgoing");
        let incoming = budget
            .try_acquire(PeerBudgetDirection::Incoming)
            .expect("second normal connection");
        assert!(budget.try_acquire(PeerBudgetDirection::Outgoing).is_err());
        let slack = budget
            .try_acquire(PeerBudgetDirection::Incoming)
            .expect("incoming slack");
        let rejection = budget
            .try_acquire(PeerBudgetDirection::Incoming)
            .expect_err("slack ceiling");
        assert_eq!(rejection.current, 3);
        assert_eq!(rejection.maximum, 3);
        drop((outgoing, incoming, slack));
        assert_eq!(budget.snapshot().total, 0);
        assert_eq!(budget.snapshot().total_high_water, 3);
    }

    #[test]
    fn phase_transfer_does_not_change_total_or_generation() {
        let budget = budget(2, 0);
        let mut permit = budget
            .try_acquire(PeerBudgetDirection::Incoming)
            .expect("permit");
        let generation = permit.generation();
        assert_eq!(permit.phase(), PeerBudgetPhase::Connecting);
        permit.mark_established();
        assert_eq!(permit.phase(), PeerBudgetPhase::Established);
        assert_eq!(permit.generation(), generation);
        let snapshot = budget.snapshot();
        assert_eq!(snapshot.incoming_connecting, 0);
        assert_eq!(snapshot.incoming_established, 1);
        assert_eq!(snapshot.total, 1);
        assert_eq!(snapshot.total_high_water, 1);
        permit.mark_established();
        assert_eq!(budget.snapshot(), snapshot);
    }

    #[test]
    fn reconfiguration_applies_clamp_before_deterministic_eviction() {
        let budget = budget(6, 1);
        let oldest_connecting = budget
            .try_acquire(PeerBudgetDirection::Outgoing)
            .expect("oldest connecting");
        let mut oldest_established = budget
            .try_acquire(PeerBudgetDirection::Incoming)
            .expect("oldest established");
        oldest_established.mark_established();
        let newest_connecting = budget
            .try_acquire(PeerBudgetDirection::Outgoing)
            .expect("newest connecting");
        let mut newest_established = budget
            .try_acquire(PeerBudgetDirection::Incoming)
            .expect("newest established");
        newest_established.mark_established();
        let newest = budget
            .try_acquire(PeerBudgetDirection::Incoming)
            .expect("newest connection");

        let outcome = budget.reconfigure(1);
        assert_eq!(outcome.effective_limit, 1);
        assert_eq!(outcome.absolute_limit, 2);
        assert_eq!(outcome.cancellation_requests, 3);
        assert!(!outcome.within_limit);
        assert!(newest.cancellation_token().is_cancelled());
        assert!(newest_connecting.cancellation_token().is_cancelled());
        assert!(oldest_connecting.cancellation_token().is_cancelled());
        assert!(!newest_established.cancellation_token().is_cancelled());
        assert!(!oldest_established.cancellation_token().is_cancelled());
        assert_eq!(budget.reconfigure(1).cancellation_requests, 0);

        drop((newest, newest_connecting, oldest_connecting));
        assert!(budget.within_absolute_limit());
        assert!(budget.try_acquire(PeerBudgetDirection::Outgoing).is_err());
        drop((newest_established, oldest_established));
        assert_eq!(budget.snapshot().total, 0);
    }

    #[test]
    fn increasing_limit_changes_admission_without_cancelling_live_permits() {
        let budget = budget(1, 0);
        let first = budget
            .try_acquire(PeerBudgetDirection::Outgoing)
            .expect("first permit");
        assert!(budget.try_acquire(PeerBudgetDirection::Outgoing).is_err());
        let outcome = budget.reconfigure(2);
        assert_eq!(outcome.effective_limit, 2);
        assert_eq!(outcome.cancellation_requests, 0);
        let second = budget
            .try_acquire(PeerBudgetDirection::Outgoing)
            .expect("newly admitted permit");
        assert!(!first.cancellation_token().is_cancelled());
        drop((first, second));
    }
}
