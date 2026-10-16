//! Deterministic restart admission. All times are monotonic milliseconds.
use std::collections::BTreeMap;

pub const QUIET_MS: u64 = 15 * 60 * 1000;
pub const NOTICE_MS: u64 = 60 * 1000;
pub const SNOOZE_MS: u64 = 60 * 60 * 1000;
const CLIENT_LEASE_MS: u64 = 90 * 1000;
const MAX_CLIENTS: usize = 64;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Eligibility {
    Disabled,
    Waiting,
    Blocked,
    Notice(u32),
    Install,
}

#[derive(Clone, Copy)]
struct Client {
    last_report: Option<u64>,
    blocked: bool,
}

pub struct UpdatePolicy {
    pub enabled: bool,
    quiet_ms: u64,
    notice_ms: u64,
    last_activity: u64,
    last_tick: u64,
    last_wall_sample: Option<(u64, u64)>,
    snooze_until: u64,
    notice_started: Option<u64>,
    clients: BTreeMap<String, Client>,
    overflowed: bool,
}

impl UpdatePolicy {
    pub fn new(enabled: bool, now: u64) -> Self {
        Self::with_timing(enabled, now, QUIET_MS, NOTICE_MS)
    }

    pub fn with_timing(enabled: bool, now: u64, quiet_ms: u64, notice_ms: u64) -> Self {
        Self {
            enabled,
            quiet_ms,
            notice_ms,
            last_activity: now,
            last_tick: now,
            last_wall_sample: None,
            snooze_until: 0,
            notice_started: None,
            clients: BTreeMap::new(),
            overflowed: false,
        }
    }

    pub fn connected(&mut self, id: &str) -> bool {
        if !self.clients.contains_key(id) && self.clients.len() >= MAX_CLIENTS {
            // Never treat a connected client whose state we cannot retain as idle.
            // Capacity exceeds all normal desktop transport limits combined.
            self.overflowed = true;
            return false;
        }
        self.clients.entry(id.into()).or_insert(Client {
            last_report: None,
            blocked: true,
        });
        true
    }

    pub fn disconnected(&mut self, id: &str) {
        self.clients.remove(id);
    }

    pub fn report(&mut self, id: &str, now: u64, interacted: bool, blocked: bool) -> bool {
        if !self.connected(id) {
            return false;
        }
        self.clients.insert(
            id.into(),
            Client {
                last_report: Some(now),
                blocked,
            },
        );
        if interacted {
            self.activity(now);
        }
        true
    }

    /// A hidden native window cannot receive user input. Retain its last
    /// unfinished-flow blocker even if WebKit suspends background timers.
    /// Unknown native state and all attached browser leases remain fail-closed.
    pub fn native_inactive(&mut self, id: &str, now: u64) {
        if let Some(client) = self.clients.get_mut(id)
            && client.last_report.is_some()
        {
            client.last_report = Some(now);
        }
    }

    pub fn activity(&mut self, now: u64) {
        self.last_activity = now;
        self.notice_started = None;
    }

    pub fn snooze(&mut self, now: u64) {
        self.activity(now);
        self.snooze_until = now.saturating_add(SNOOZE_MS);
    }

    pub fn has_known_flow(&self) -> bool {
        self.clients
            .values()
            .any(|client| client.last_report.is_some() && client.blocked)
    }

    pub fn candidate_changed(&mut self) {
        self.notice_started = None;
    }

    pub fn observe_clock(&mut self, now: u64) {
        // A stalled event loop, suspend or backwards clock invalidates quiet time.
        if now < self.last_tick || now.saturating_sub(self.last_tick) > 30_000 {
            self.activity(now);
        }
        self.last_tick = now;
    }

    /// Some platform monotonic clocks pause during sleep. Wall time can only
    /// invalidate quiet time, never advance eligibility or shorten a snooze.
    pub fn observe_wall_clock(&mut self, now: u64, wall: u64) {
        if let Some((previous_now, previous_wall)) = self.last_wall_sample
            && (wall < previous_wall
                || wall
                    .saturating_sub(previous_wall)
                    .abs_diff(now.saturating_sub(previous_now))
                    > 30_000)
        {
            self.activity(now);
        }
        self.last_wall_sample = Some((now, wall));
        self.observe_clock(now);
    }

    pub fn evaluate(&mut self, now: u64, blocked: bool) -> Eligibility {
        self.observe_clock(now);
        let client_blocked = self.clients.values().any(|client| {
            client.blocked
                || client
                    .last_report
                    .is_none_or(|last| now.saturating_sub(last) > CLIENT_LEASE_MS)
        });
        if !self.enabled {
            self.notice_started = None;
            return Eligibility::Disabled;
        }
        if blocked || client_blocked || self.overflowed {
            self.notice_started = None;
            return Eligibility::Blocked;
        }
        if now < self.snooze_until || now.saturating_sub(self.last_activity) < self.quiet_ms {
            self.notice_started = None;
            return Eligibility::Waiting;
        }
        let started = *self.notice_started.get_or_insert(now);
        let remaining = self.notice_ms.saturating_sub(now.saturating_sub(started));
        if remaining == 0 {
            Eligibility::Install
        } else {
            Eligibility::Notice(remaining.div_ceil(1000) as u32)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tick_until(policy: &mut UpdatePolicy, end: u64) -> Eligibility {
        let mut result = Eligibility::Waiting;
        for now in (0..=end).step_by(1000) {
            result = policy.evaluate(now, false);
        }
        result
    }

    #[test]
    fn suspend_resets_notice_even_when_the_monotonic_clock_pauses() {
        let mut policy = UpdatePolicy::with_timing(true, 0, 1000, 1000);
        policy.observe_wall_clock(0, 100_000);
        policy.observe_wall_clock(1000, 101_000);
        assert_eq!(policy.evaluate(1000, false), Eligibility::Notice(1));
        policy.observe_wall_clock(2000, 901_000);
        assert_eq!(policy.evaluate(2000, false), Eligibility::Waiting);
        policy.observe_wall_clock(3000, 902_000);
        assert_eq!(policy.evaluate(3000, false), Eligibility::Notice(1));
        policy.observe_wall_clock(4000, 903_000);
        assert_eq!(policy.evaluate(4000, false), Eligibility::Install);
    }

    #[test]
    fn wall_clock_changes_only_invalidate_quiet_time_and_keep_snooze() {
        for changed_wall in [0, 1_000_000] {
            let mut policy = UpdatePolicy::with_timing(true, 0, 1000, 1000);
            policy.observe_wall_clock(0, 100_000);
            policy.snooze(0);
            policy.observe_wall_clock(1000, changed_wall);
            assert_eq!(policy.evaluate(1000, false), Eligibility::Waiting);
            policy.observe_wall_clock(2000, changed_wall + 1000);
            assert_eq!(policy.evaluate(2000, false), Eligibility::Waiting);
            assert_eq!(policy.snooze_until, SNOOZE_MS);
        }
    }

    #[test]
    fn transfers_do_not_gate_the_fifteen_minute_boundary_and_notice() {
        let mut policy = UpdatePolicy::new(true, 0);
        assert_eq!(
            tick_until(&mut policy, QUIET_MS - 1000),
            Eligibility::Waiting
        );
        assert_eq!(policy.evaluate(QUIET_MS, false), Eligibility::Notice(60));
        for now in (QUIET_MS + 1000..QUIET_MS + NOTICE_MS).step_by(1000) {
            policy.evaluate(now, false);
        }
        assert_eq!(
            policy.evaluate(QUIET_MS + NOTICE_MS, false),
            Eligibility::Install
        );
    }

    #[test]
    fn stale_and_old_clients_block_until_disconnected() {
        let mut policy = UpdatePolicy::with_timing(true, 0, 1000, 1000);
        policy.connected("old");
        assert_eq!(policy.evaluate(1000, false), Eligibility::Blocked);
        policy.report("old", 1000, false, false);
        assert_eq!(policy.evaluate(1000, false), Eligibility::Notice(1));
        policy.disconnected("old");
        assert_eq!(policy.evaluate(2000, false), Eligibility::Install);
    }

    #[test]
    fn background_work_and_candidate_changes_do_not_count_as_interaction() {
        let mut policy = UpdatePolicy::with_timing(true, 0, 1000, 1000);
        policy.observe_clock(500);
        policy.candidate_changed();
        assert_eq!(policy.evaluate(1000, false), Eligibility::Notice(1));
        policy.candidate_changed();
        assert_eq!(policy.evaluate(1500, false), Eligibility::Notice(1));
        assert_eq!(policy.evaluate(2500, false), Eligibility::Install);
    }

    #[test]
    fn stale_report_never_proves_idle() {
        let mut policy = UpdatePolicy::with_timing(true, 0, 1000, 1000);
        policy.report("client", 0, false, false);
        for now in (0..=CLIENT_LEASE_MS + 1000).step_by(1000) {
            policy.evaluate(now, false);
        }
        assert_eq!(
            policy.evaluate(CLIENT_LEASE_MS + 2000, false),
            Eligibility::Blocked
        );
        policy.report("client", CLIENT_LEASE_MS + 2000, false, false);
        assert_eq!(
            policy.evaluate(CLIENT_LEASE_MS + 2000, false),
            Eligibility::Notice(1)
        );
    }

    #[test]
    fn native_inactivity_preserves_blockers_without_exempting_remote_clients() {
        let mut policy = UpdatePolicy::with_timing(true, 0, 1000, 1000);
        policy.connected("main");
        policy.native_inactive("main", 1000);
        assert_eq!(policy.evaluate(1000, false), Eligibility::Blocked);
        policy.report("main", 1000, false, true);
        policy.native_inactive("main", 100_000);
        assert_eq!(policy.evaluate(100_000, false), Eligibility::Blocked);
        policy.report("main", 100_000, false, false);
        policy.report("remote", 100_000, false, false);
        for now in (100_000..=200_000).step_by(1000) {
            policy.native_inactive("main", now);
            policy.evaluate(now, false);
        }
        assert_eq!(policy.evaluate(201_000, false), Eligibility::Blocked);
        policy.disconnected("remote");
        assert_eq!(policy.evaluate(201_000, false), Eligibility::Notice(1));
    }

    #[test]
    fn input_opt_out_and_blocker_cancel_countdown() {
        let mut policy = UpdatePolicy::with_timing(true, 0, 1000, 1000);
        assert_eq!(policy.evaluate(1000, false), Eligibility::Notice(1));
        policy.activity(1500);
        assert_eq!(policy.evaluate(2000, false), Eligibility::Waiting);
        assert_eq!(policy.evaluate(2500, false), Eligibility::Notice(1));
        assert_eq!(policy.evaluate(3000, true), Eligibility::Blocked);
        assert_eq!(policy.evaluate(3500, false), Eligibility::Notice(1));
        policy.enabled = false;
        assert_eq!(policy.evaluate(4500, false), Eligibility::Disabled);
    }

    #[test]
    fn sleep_resets_quiet_and_snooze_cannot_be_skipped() {
        let mut policy = UpdatePolicy::with_timing(true, 0, 1000, 1000);
        policy.snooze(0);
        assert_eq!(policy.evaluate(1000, false), Eligibility::Waiting);
        assert_eq!(
            policy.evaluate(SNOOZE_MS + 5000, false),
            Eligibility::Waiting
        );
        assert_eq!(
            policy.evaluate(SNOOZE_MS + 6000, false),
            Eligibility::Notice(1)
        );
    }

    #[test]
    fn reports_are_bounded_and_do_not_refresh_quiet_without_input() {
        let mut policy = UpdatePolicy::with_timing(true, 0, 1000, 1000);
        for index in 0..MAX_CLIENTS {
            assert!(policy.report(&index.to_string(), 0, false, false));
        }
        assert_eq!(policy.evaluate(1000, false), Eligibility::Notice(1));
        assert!(!policy.report("overflow", 0, false, false));
        assert_eq!(policy.evaluate(2000, false), Eligibility::Blocked);
    }
}
