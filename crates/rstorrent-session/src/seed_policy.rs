//! Runtime-independent libtorrent-shaped seed goals and queue ranking.

use std::error::Error;
use std::fmt;

pub(crate) const DEFAULT_ACTIVE_SEEDS: u16 = 5;
pub(crate) const DEFAULT_SHARE_RATIO_LIMIT_PERCENT: u32 = 200;
pub(crate) const DEFAULT_FINISHED_DOWNLOAD_RATIO_LIMIT_PERCENT: u32 = 700;
pub(crate) const DEFAULT_FINISHED_TIME_LIMIT_SECONDS: u32 = 86_400;
pub(crate) const HARD_ACTIVE_TORRENT_LIMIT: usize = 500;
pub(crate) const AUTO_MANAGE_INTERVAL_SECONDS: u64 = 30;
pub(crate) const AUTO_MANAGE_STARTUP_SECONDS: u64 = 60;
pub(crate) const INACTIVE_UPLOAD_RATE_BYTES_PER_SECOND: u64 = 2_048;
pub(crate) const INACTIVE_DOWNLOAD_RATE_BYTES_PER_SECOND: u64 = 2_048;
pub(crate) const RECENTLY_STARTED_ACTIVE_SECONDS: u64 = 30 * 60;

const GOAL_UNMET_FLAG: u32 = 0x4000_0000;
const NO_SEEDS_FLAG: u32 = 0x2000_0000;
const RECENTLY_STARTED_FLAG: u32 = 0x1000_0000;
const PRIORITY_MASK: u32 = 0x0fff_ffff;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct SeedGoalLimits {
    pub(crate) share_ratio_limit_percent: u32,
    pub(crate) finished_download_ratio_limit_percent: u32,
    pub(crate) finished_time_limit_seconds: u32,
}

impl Default for SeedGoalLimits {
    fn default() -> Self {
        Self {
            share_ratio_limit_percent: DEFAULT_SHARE_RATIO_LIMIT_PERCENT,
            finished_download_ratio_limit_percent: DEFAULT_FINISHED_DOWNLOAD_RATIO_LIMIT_PERCENT,
            finished_time_limit_seconds: DEFAULT_FINISHED_TIME_LIMIT_SECONDS,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct SeedGoalInput {
    pub(crate) total_uploaded: u64,
    pub(crate) total_downloaded: u64,
    pub(crate) total_size: u64,
    pub(crate) active_seconds: u64,
    pub(crate) finished_seconds: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct SeedGoalAssessment {
    pub(crate) goal_unmet: bool,
    pub(crate) finished_time_met: bool,
    pub(crate) finished_download_ratio_met: bool,
    pub(crate) share_ratio_met: bool,
    pub(crate) downloaded_base: u64,
    pub(crate) download_seconds: u64,
}

pub(crate) fn assess_seed_goals(
    input: SeedGoalInput,
    limits: SeedGoalLimits,
) -> Result<SeedGoalAssessment, SeedPolicyError> {
    let download_seconds = input
        .active_seconds
        .checked_sub(input.finished_seconds)
        .ok_or(SeedPolicyError::FinishedTimeExceedsActiveTime {
            active_seconds: input.active_seconds,
            finished_seconds: input.finished_seconds,
        })?;
    let downloaded_base = input.total_downloaded.max(input.total_size);

    let finished_time_met = input.finished_seconds >= u64::from(limits.finished_time_limit_seconds);
    let finished_download_ratio_met = download_seconds <= 1
        || u128::from(input.finished_seconds) * 100
            >= u128::from(download_seconds)
                * u128::from(limits.finished_download_ratio_limit_percent);
    let share_ratio_met = downloaded_base == 0
        || u128::from(input.total_uploaded) * 100
            >= u128::from(downloaded_base) * u128::from(limits.share_ratio_limit_percent);

    Ok(SeedGoalAssessment {
        goal_unmet: !finished_time_met && !finished_download_ratio_met && !share_ratio_met,
        finished_time_met,
        finished_download_ratio_met,
        share_ratio_met,
        downloaded_base,
        download_seconds,
    })
}

/// Effective seeding stop limits for one torrent; `None` means no limit.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct SeedStopLimits {
    pub(crate) share_ratio_percent: Option<u32>,
    pub(crate) seeding_seconds: Option<u32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SeedStopReason {
    ShareRatio,
    SeedingTime,
}

/// Whichever stop limit a finished torrent has reached, ratio first. Unlike
/// seed goals, which only rank the queue, a reached limit stops the torrent.
/// The share ratio uses the seed-goal base, `max(downloaded, size)`, so a
/// torrent added already complete must upload its size times the ratio.
/// Seeding time is finished time, which accrues only while admitted.
pub(crate) fn seed_stop_reached(
    input: SeedGoalInput,
    limits: SeedStopLimits,
) -> Option<SeedStopReason> {
    if let Some(percent) = limits.share_ratio_percent {
        let base = input.total_downloaded.max(input.total_size);
        if u128::from(input.total_uploaded) * 100 >= u128::from(base) * u128::from(percent) {
            return Some(SeedStopReason::ShareRatio);
        }
    }
    if let Some(seconds) = limits.seeding_seconds
        && input.finished_seconds >= u64::from(seconds)
    {
        return Some(SeedStopReason::SeedingTime);
    }
    None
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct SeedRankInput {
    pub(crate) selected_finished: bool,
    pub(crate) full_seed: bool,
    pub(crate) paused: bool,
    pub(crate) goals: SeedGoalInput,
    pub(crate) tracker_complete: Option<u32>,
    pub(crate) tracker_incomplete: Option<u32>,
    pub(crate) live_seeds: u32,
    pub(crate) live_peers: u32,
}

pub(crate) fn seed_rank(
    input: SeedRankInput,
    limits: SeedGoalLimits,
) -> Result<u32, SeedPolicyError> {
    if !input.selected_finished {
        return Ok(0);
    }

    let mut rank = 0;
    if assess_seed_goals(input.goals, limits)?.goal_unmet {
        rank |= GOAL_UNMET_FLAG;
    }
    if !input.paused && input.goals.active_seconds < RECENTLY_STARTED_ACTIVE_SECONDS {
        rank |= RECENTLY_STARTED_FLAG;
    }

    let self_seed = u32::from(input.full_seed && !input.paused);
    let seeds = input.tracker_complete.map_or(input.live_seeds, |complete| {
        complete.saturating_sub(self_seed)
    });
    let downloaders = input
        .tracker_incomplete
        .unwrap_or_else(|| input.live_peers.saturating_sub(input.live_seeds));

    let demand = if seeds == 0 {
        rank |= NO_SEEDS_FLAG;
        downloaders & PRIORITY_MASK
    } else {
        let scale = if input.full_seed {
            1_000_u128
        } else {
            500_u128
        };
        let score = (u128::from(downloaders) + 1) * scale / u128::from(seeds);
        u32::try_from(score & u128::from(PRIORITY_MASK)).expect("masked seed demand fits u32")
    };
    Ok(rank | demand)
}

pub(crate) const fn rate_is_inactive(
    selected_finished: bool,
    upload_payload_rate: u64,
    download_payload_rate: u64,
) -> bool {
    if selected_finished {
        upload_payload_rate < INACTIVE_UPLOAD_RATE_BYTES_PER_SECOND
    } else {
        download_payload_rate < INACTIVE_DOWNLOAD_RATE_BYTES_PER_SECOND
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum InactivityTransition {
    BecameInactive,
    BecameActive,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PendingInactivityChange {
    target_inactive: bool,
    observed_at_seconds: u64,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct InactivityState {
    inactive: bool,
    pending: Option<PendingInactivityChange>,
    last_observed_seconds: Option<u64>,
}

impl InactivityState {
    pub(crate) const fn inactive(self) -> bool {
        self.inactive
    }

    pub(crate) fn observe(
        &mut self,
        now_seconds: u64,
        observed_inactive: bool,
    ) -> Result<Option<InactivityTransition>, SeedPolicyError> {
        if self
            .last_observed_seconds
            .is_some_and(|last| now_seconds < last)
        {
            return Err(SeedPolicyError::MonotonicTimeRegressed);
        }
        self.last_observed_seconds = Some(now_seconds);

        if observed_inactive == self.inactive {
            self.pending = None;
            return Ok(None);
        }

        let pending = match self.pending {
            Some(pending) if pending.target_inactive == observed_inactive => pending,
            _ => {
                self.pending = Some(PendingInactivityChange {
                    target_inactive: observed_inactive,
                    observed_at_seconds: now_seconds,
                });
                return Ok(None);
            }
        };
        if now_seconds - pending.observed_at_seconds < AUTO_MANAGE_STARTUP_SECONDS {
            return Ok(None);
        }

        self.inactive = observed_inactive;
        self.pending = None;
        Ok(Some(if observed_inactive {
            InactivityTransition::BecameInactive
        } else {
            InactivityTransition::BecameActive
        }))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SeedPolicyError {
    FinishedTimeExceedsActiveTime {
        active_seconds: u64,
        finished_seconds: u64,
    },
    MonotonicTimeRegressed,
}

impl fmt::Display for SeedPolicyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FinishedTimeExceedsActiveTime { .. } => {
                formatter.write_str("finished time exceeds active time")
            }
            Self::MonotonicTimeRegressed => formatter.write_str("monotonic time regressed"),
        }
    }
}

impl Error for SeedPolicyError {}

#[cfg(test)]
mod seed_stop_tests {
    use super::{SeedGoalInput, SeedStopLimits, SeedStopReason, seed_stop_reached};

    fn input(uploaded: u64, downloaded: u64, size: u64, finished: u64) -> SeedGoalInput {
        SeedGoalInput {
            total_uploaded: uploaded,
            total_downloaded: downloaded,
            total_size: size,
            active_seconds: finished,
            finished_seconds: finished,
        }
    }

    fn limits(ratio: Option<u32>, seconds: Option<u32>) -> SeedStopLimits {
        SeedStopLimits {
            share_ratio_percent: ratio,
            seeding_seconds: seconds,
        }
    }

    #[test]
    fn no_limits_never_stop() {
        assert_eq!(
            seed_stop_reached(input(u64::MAX, 1, 1, u64::MAX), limits(None, None)),
            None
        );
    }

    #[test]
    fn ratio_stops_exactly_at_the_limit() {
        let ratio = limits(Some(200), None);
        assert_eq!(
            seed_stop_reached(input(1_999, 1_000, 1_000, 0), ratio),
            None
        );
        assert_eq!(
            seed_stop_reached(input(2_000, 1_000, 1_000, 0), ratio),
            Some(SeedStopReason::ShareRatio)
        );
    }

    #[test]
    fn ratio_base_is_the_larger_of_downloaded_and_size() {
        let ratio = limits(Some(100), None);
        // Added complete: nothing downloaded, so the size is the base.
        assert_eq!(seed_stop_reached(input(999, 0, 1_000, 0), ratio), None);
        assert_eq!(
            seed_stop_reached(input(1_000, 0, 1_000, 0), ratio),
            Some(SeedStopReason::ShareRatio)
        );
        // Redownloaded bytes raise the base above the size.
        assert_eq!(
            seed_stop_reached(input(1_500, 2_000, 1_000, 0), ratio),
            None
        );
    }

    #[test]
    fn seeding_time_stops_exactly_at_the_limit() {
        let time = limits(None, Some(3_600));
        assert_eq!(seed_stop_reached(input(0, 1, 1, 3_599), time), None);
        assert_eq!(
            seed_stop_reached(input(0, 1, 1, 3_600), time),
            Some(SeedStopReason::SeedingTime)
        );
    }

    #[test]
    fn zero_limits_stop_at_completion_and_ratio_is_reported_first() {
        assert_eq!(
            seed_stop_reached(input(0, 1, 1, 0), limits(Some(0), Some(0))),
            Some(SeedStopReason::ShareRatio)
        );
        assert_eq!(
            seed_stop_reached(input(0, 1, 1, 0), limits(None, Some(0))),
            Some(SeedStopReason::SeedingTime)
        );
    }

    #[test]
    fn maximum_values_do_not_overflow() {
        let ratio = limits(Some(i32::MAX as u32), Some(i32::MAX as u32));
        assert_eq!(
            seed_stop_reached(input(u64::MAX, u64::MAX, u64::MAX, 0), ratio),
            None
        );
        assert_eq!(
            seed_stop_reached(input(0, 0, 0, 0), limits(Some(1), None)),
            Some(SeedStopReason::ShareRatio)
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn goal_input() -> SeedGoalInput {
        SeedGoalInput {
            total_uploaded: 199,
            total_downloaded: 100,
            total_size: 100,
            active_seconds: 1_800,
            finished_seconds: 700,
        }
    }

    fn rank_input() -> SeedRankInput {
        SeedRankInput {
            selected_finished: true,
            full_seed: true,
            paused: true,
            goals: goal_input(),
            tracker_complete: Some(2),
            tracker_incomplete: Some(3),
            live_seeds: 40,
            live_peers: 90,
        }
    }

    #[test]
    fn defaults_match_the_pinned_libtorrent_settings() {
        assert_eq!(DEFAULT_ACTIVE_SEEDS, 5);
        assert_eq!(HARD_ACTIVE_TORRENT_LIMIT, 500);
        assert_eq!(AUTO_MANAGE_INTERVAL_SECONDS, 30);
        assert_eq!(AUTO_MANAGE_STARTUP_SECONDS, 60);
        assert_eq!(INACTIVE_UPLOAD_RATE_BYTES_PER_SECOND, 2_048);
        assert_eq!(INACTIVE_DOWNLOAD_RATE_BYTES_PER_SECOND, 2_048);
        assert_eq!(RECENTLY_STARTED_ACTIVE_SECONDS, 1_800);
        assert_eq!(SeedGoalLimits::default().share_ratio_limit_percent, 200);
        assert_eq!(
            SeedGoalLimits::default().finished_download_ratio_limit_percent,
            700
        );
        assert_eq!(
            SeedGoalLimits::default().finished_time_limit_seconds,
            86_400
        );
    }

    #[test]
    fn reaching_any_one_threshold_clears_goal_unmet() {
        let limits = SeedGoalLimits::default();
        let below_every_threshold = SeedGoalInput {
            total_uploaded: 199,
            total_downloaded: 100,
            total_size: 100,
            active_seconds: 801,
            finished_seconds: 700,
        };
        assert!(
            assess_seed_goals(below_every_threshold, limits)
                .unwrap()
                .goal_unmet
        );

        for met in [
            SeedGoalInput {
                total_uploaded: 200,
                ..below_every_threshold
            },
            SeedGoalInput {
                active_seconds: 800,
                ..below_every_threshold
            },
            SeedGoalInput {
                active_seconds: 98_743,
                finished_seconds: 86_400,
                ..below_every_threshold
            },
        ] {
            assert!(!assess_seed_goals(met, limits).unwrap().goal_unmet);
        }
    }

    #[test]
    fn ratio_boundaries_match_integer_division_semantics() {
        let limits = SeedGoalLimits {
            share_ratio_limit_percent: 200,
            finished_download_ratio_limit_percent: 700,
            finished_time_limit_seconds: u32::MAX,
        };
        let exact = assess_seed_goals(
            SeedGoalInput {
                total_uploaded: 2,
                total_downloaded: 1,
                total_size: 1,
                active_seconds: 8,
                finished_seconds: 7,
            },
            limits,
        )
        .unwrap();
        assert!(exact.share_ratio_met);
        assert!(exact.finished_download_ratio_met);
        assert!(!exact.goal_unmet);

        let below = assess_seed_goals(
            SeedGoalInput {
                total_uploaded: 199,
                total_downloaded: 100,
                total_size: 100,
                active_seconds: 803,
                finished_seconds: 700,
            },
            limits,
        )
        .unwrap();
        assert!(!below.share_ratio_met);
        assert!(!below.finished_download_ratio_met);
        assert!(below.goal_unmet);
    }

    #[test]
    fn zero_size_and_at_most_one_download_second_are_goal_met() {
        let limits = SeedGoalLimits {
            share_ratio_limit_percent: u32::MAX,
            finished_download_ratio_limit_percent: u32::MAX,
            finished_time_limit_seconds: u32::MAX,
        };
        let zero_size = assess_seed_goals(
            SeedGoalInput {
                total_uploaded: 0,
                total_downloaded: 0,
                total_size: 0,
                active_seconds: 2,
                finished_seconds: 0,
            },
            limits,
        )
        .unwrap();
        assert!(zero_size.share_ratio_met);
        assert!(!zero_size.goal_unmet);

        for download_seconds in 0..=1 {
            let assessment = assess_seed_goals(
                SeedGoalInput {
                    total_uploaded: 0,
                    total_downloaded: 1,
                    total_size: 1,
                    active_seconds: 10 + download_seconds,
                    finished_seconds: 10,
                },
                limits,
            )
            .unwrap();
            assert!(assessment.finished_download_ratio_met);
            assert!(!assessment.goal_unmet);
        }
    }

    #[test]
    fn imported_complete_content_uses_total_size_as_ratio_denominator() {
        let assessment = assess_seed_goals(
            SeedGoalInput {
                total_uploaded: 199,
                total_downloaded: 0,
                total_size: 100,
                active_seconds: 103,
                finished_seconds: 2,
            },
            SeedGoalLimits::default(),
        )
        .unwrap();
        assert_eq!(assessment.downloaded_base, 100);
        assert!(!assessment.share_ratio_met);
        assert!(assessment.goal_unmet);
    }

    #[test]
    fn malformed_timer_order_is_rejected_without_underflow() {
        assert_eq!(
            assess_seed_goals(
                SeedGoalInput {
                    active_seconds: 1,
                    finished_seconds: 2,
                    ..goal_input()
                },
                SeedGoalLimits::default(),
            ),
            Err(SeedPolicyError::FinishedTimeExceedsActiveTime {
                active_seconds: 1,
                finished_seconds: 2,
            })
        );
    }

    #[test]
    fn rank_flags_and_demand_match_the_pinned_layout() {
        let input = rank_input();
        assert_eq!(
            seed_rank(input, SeedGoalLimits::default()).unwrap(),
            GOAL_UNMET_FLAG | 2_000
        );

        let no_seeds = SeedRankInput {
            tracker_complete: Some(0),
            tracker_incomplete: Some(17),
            ..input
        };
        assert_eq!(
            seed_rank(no_seeds, SeedGoalLimits::default()).unwrap(),
            GOAL_UNMET_FLAG | NO_SEEDS_FLAG | 17
        );

        let recent = SeedRankInput {
            paused: false,
            goals: SeedGoalInput {
                active_seconds: 1_799,
                finished_seconds: 700,
                ..input.goals
            },
            ..input
        };
        assert_ne!(
            seed_rank(recent, SeedGoalLimits::default()).unwrap() & RECENTLY_STARTED_FLAG,
            0
        );
        let not_recent = SeedRankInput {
            goals: SeedGoalInput {
                active_seconds: 1_800,
                ..recent.goals
            },
            ..recent
        };
        assert_eq!(
            seed_rank(not_recent, SeedGoalLimits::default()).unwrap() & RECENTLY_STARTED_FLAG,
            0
        );
    }

    #[test]
    fn rank_prefers_tracker_counts_and_falls_back_per_missing_side() {
        let input = SeedRankInput {
            paused: false,
            tracker_complete: Some(4),
            tracker_incomplete: None,
            live_seeds: 10,
            live_peers: 15,
            ..rank_input()
        };
        let rank = seed_rank(input, SeedGoalLimits::default()).unwrap();
        assert_eq!(rank & PRIORITY_MASK, 2_000);

        let unknown_seed_count = SeedRankInput {
            tracker_complete: None,
            tracker_incomplete: Some(8),
            ..input
        };
        let rank = seed_rank(unknown_seed_count, SeedGoalLimits::default()).unwrap();
        assert_eq!(rank & PRIORITY_MASK, 900);
    }

    #[test]
    fn partial_finished_rank_uses_half_scale_and_unfinished_rank_is_zero() {
        let full = rank_input();
        let partial = SeedRankInput {
            full_seed: false,
            ..full
        };
        assert_eq!(
            seed_rank(full, SeedGoalLimits::default()).unwrap() & PRIORITY_MASK,
            2_000
        );
        assert_eq!(
            seed_rank(partial, SeedGoalLimits::default()).unwrap() & PRIORITY_MASK,
            1_000
        );
        assert_eq!(
            seed_rank(
                SeedRankInput {
                    selected_finished: false,
                    goals: SeedGoalInput {
                        active_seconds: 0,
                        finished_seconds: 1,
                        ..full.goals
                    },
                    ..full
                },
                SeedGoalLimits::default(),
            ),
            Ok(0)
        );
    }

    #[test]
    fn demand_score_is_masked_without_overflow() {
        let input = SeedRankInput {
            tracker_complete: Some(1),
            tracker_incomplete: Some(u32::MAX),
            ..rank_input()
        };
        let rank = seed_rank(input, SeedGoalLimits::default()).unwrap();
        assert_eq!(rank & !PRIORITY_MASK, GOAL_UNMET_FLAG);
    }

    #[test]
    fn applicable_payload_rate_uses_a_strict_threshold() {
        assert!(rate_is_inactive(true, 2_047, u64::MAX));
        assert!(!rate_is_inactive(true, 2_048, 0));
        assert!(rate_is_inactive(false, u64::MAX, 2_047));
        assert!(!rate_is_inactive(false, 0, 2_048));
    }

    #[test]
    fn inactivity_changes_only_after_a_continuous_sixty_seconds() {
        let mut state = InactivityState::default();
        assert_eq!(state.observe(0, true).unwrap(), None);
        assert_eq!(state.observe(59, true).unwrap(), None);
        assert_eq!(
            state.observe(60, true).unwrap(),
            Some(InactivityTransition::BecameInactive)
        );
        assert!(state.inactive());

        assert_eq!(state.observe(80, false).unwrap(), None);
        assert_eq!(state.observe(100, true).unwrap(), None);
        assert_eq!(state.observe(101, false).unwrap(), None);
        assert_eq!(state.observe(160, false).unwrap(), None);
        assert_eq!(
            state.observe(161, false).unwrap(),
            Some(InactivityTransition::BecameActive)
        );
        assert!(!state.inactive());
    }

    #[test]
    fn reverting_to_current_state_cancels_a_pending_change() {
        let mut state = InactivityState::default();
        state.observe(0, true).unwrap();
        state.observe(30, false).unwrap();
        state.observe(89, true).unwrap();
        assert_eq!(state.observe(90, true).unwrap(), None);
        assert!(!state.inactive());
    }

    #[test]
    fn monotonic_regression_is_rejected() {
        let mut state = InactivityState::default();
        state.observe(10, true).unwrap();
        assert_eq!(
            state.observe(9, true),
            Err(SeedPolicyError::MonotonicTimeRegressed)
        );
    }
}
