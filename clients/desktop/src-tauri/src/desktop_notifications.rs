use std::collections::{HashMap, VecDeque};

use rstorrent_session::{StorageState, TorrentRowUpdate, TorrentState, TorrentView};

use crate::desktop_localization;

const MAX_NOTIFICATION_NAME_CHARS: usize = 120;
const MAX_RECENTLY_REMOVED_TORRENTS: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DesktopNotificationKind {
    DownloadComplete,
    NeedsAttention,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DesktopNotification {
    pub(crate) kind: DesktopNotificationKind,
    pub(crate) title: &'static str,
    pub(crate) body: String,
    #[cfg(target_os = "linux")]
    pub(crate) open_label: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct TorrentObservation {
    torrent_id: String,
    display_name: Option<String>,
    state: TorrentState,
    storage_state: StorageState,
    received_bytes: Option<u128>,
    verified_piece_count: u32,
}

impl From<&TorrentView> for TorrentObservation {
    fn from(torrent: &TorrentView) -> Self {
        Self {
            torrent_id: torrent.torrent_id.clone(),
            display_name: torrent
                .display_name
                .clone()
                .or_else(|| torrent.source_display_name.clone()),
            state: torrent.state,
            storage_state: torrent.storage_state,
            received_bytes: torrent.received_bytes.parse().ok(),
            verified_piece_count: torrent.verified_piece_count,
        }
    }
}

#[derive(Clone, Debug)]
struct TrackedTorrent {
    view: Option<TorrentView>,
    observation: TorrentObservation,
    completion_armed: bool,
    attention_active: bool,
}

#[derive(Default)]
pub(crate) struct DesktopNotificationPolicy {
    established: bool,
    torrents: HashMap<String, TrackedTorrent>,
    recently_removed: VecDeque<String>,
}

impl DesktopNotificationPolicy {
    pub(crate) fn establish<'a>(&mut self, torrents: impl IntoIterator<Item = &'a TorrentView>) {
        self.torrents = torrents
            .into_iter()
            .map(|torrent| {
                let observation = TorrentObservation::from(torrent);
                let attention_active = needs_attention(&observation);
                (
                    observation.torrent_id.clone(),
                    TrackedTorrent {
                        view: Some(torrent.clone()),
                        observation,
                        completion_armed: false,
                        attention_active,
                    },
                )
            })
            .collect();
        self.recently_removed.clear();
        self.established = true;
    }

    pub(crate) fn apply_patch<'a>(
        &mut self,
        upsert: impl IntoIterator<Item = &'a TorrentView>,
        updates: impl IntoIterator<Item = &'a TorrentRowUpdate>,
        removed: impl IntoIterator<Item = &'a String>,
    ) -> Result<Vec<DesktopNotification>, ()> {
        if !self.established {
            return Err(());
        }
        for torrent_id in removed {
            self.remove(torrent_id);
        }
        let mut notifications = upsert
            .into_iter()
            .filter_map(|torrent| self.apply_view(torrent.clone()))
            .collect::<Vec<_>>();
        for update in updates {
            let Some(mut view) = self
                .torrents
                .get(&update.torrent_id)
                .and_then(|tracked| tracked.view.clone())
            else {
                self.reset();
                return Err(());
            };
            if update.apply(&mut view).is_err() {
                self.reset();
                return Err(());
            }
            if let Some(notification) = self.apply_view(view) {
                notifications.push(notification);
            }
        }
        Ok(notifications)
    }

    pub(crate) fn reset(&mut self) {
        self.established = false;
        self.torrents.clear();
        self.recently_removed.clear();
    }

    fn remove(&mut self, torrent_id: &str) {
        self.torrents.remove(torrent_id);
        if let Some(index) = self
            .recently_removed
            .iter()
            .position(|removed| removed == torrent_id)
        {
            self.recently_removed.remove(index);
        }
        if self.recently_removed.len() == MAX_RECENTLY_REMOVED_TORRENTS {
            self.recently_removed.pop_front();
        }
        self.recently_removed.push_back(torrent_id.to_owned());
    }

    fn apply_view(&mut self, view: TorrentView) -> Option<DesktopNotification> {
        let observation = TorrentObservation::from(&view);
        self.apply_observation_with_view(observation, Some(view))
    }

    #[cfg(test)]
    fn apply_observation(
        &mut self,
        observation: TorrentObservation,
    ) -> Option<DesktopNotification> {
        self.apply_observation_with_view(observation, None)
    }

    fn apply_observation_with_view(
        &mut self,
        observation: TorrentObservation,
        view: Option<TorrentView>,
    ) -> Option<DesktopNotification> {
        let Some(previous) = self.torrents.remove(&observation.torrent_id) else {
            let was_removed = self
                .recently_removed
                .iter()
                .position(|removed| removed == &observation.torrent_id)
                .and_then(|index| self.recently_removed.remove(index))
                .is_some();
            let attention_active = needs_attention(&observation);
            let notification = if was_removed {
                None
            } else if attention_active {
                Some(attention_notification(&observation))
            } else if is_download_complete(&observation)
                && observation.received_bytes.is_some_and(|bytes| bytes > 0)
            {
                Some(completion_notification(&observation))
            } else {
                None
            };
            self.torrents.insert(
                observation.torrent_id.clone(),
                TrackedTorrent {
                    view,
                    observation,
                    completion_armed: false,
                    attention_active,
                },
            );
            return notification;
        };

        let attention_active = needs_attention(&observation);
        let attention_edge = attention_active && !previous.attention_active;
        let mut completion_armed = previous.completion_armed;
        if observation.state == TorrentState::Checking
            || previous.observation.state == TorrentState::Checking
        {
            completion_armed = false;
        } else if observes_download_progress(&previous.observation, &observation) {
            completion_armed = true;
        }
        let completion_edge = completion_armed && is_download_complete(&observation);
        if completion_edge {
            completion_armed = false;
        }

        self.torrents.insert(
            observation.torrent_id.clone(),
            TrackedTorrent {
                view,
                observation: observation.clone(),
                completion_armed,
                attention_active,
            },
        );

        if attention_edge {
            Some(attention_notification(&observation))
        } else if completion_edge {
            Some(completion_notification(&observation))
        } else {
            None
        }
    }
}

fn observes_download_progress(previous: &TorrentObservation, current: &TorrentObservation) -> bool {
    let transfer_generation = matches!(previous.state, TorrentState::Downloading)
        || matches!(current.state, TorrentState::Downloading);
    increased(previous.received_bytes, current.received_bytes)
        || (transfer_generation && current.verified_piece_count > previous.verified_piece_count)
}

fn increased(previous: Option<u128>, current: Option<u128>) -> bool {
    matches!((previous, current), (Some(previous), Some(current)) if current > previous)
}

fn is_download_complete(observation: &TorrentObservation) -> bool {
    observation.state == TorrentState::Complete
        && observation.storage_state == StorageState::Available
}

fn needs_attention(observation: &TorrentObservation) -> bool {
    matches!(
        observation.state,
        TorrentState::NeedsRepair | TorrentState::Error
    ) || observation.storage_state == StorageState::NeedsRepair
}

fn completion_notification(observation: &TorrentObservation) -> DesktopNotification {
    let locale = desktop_localization::current_locale();
    DesktopNotification {
        kind: DesktopNotificationKind::DownloadComplete,
        title: desktop_localization::text_for_locale(
            "notification.download-complete.title",
            locale,
        ),
        body: desktop_localization::format_for_locale(
            "notification.download-complete.body",
            locale,
            &[("name", &notification_name(observation, locale))],
        ),
        #[cfg(target_os = "linux")]
        open_label: desktop_localization::text_for_locale("notification.open", locale),
    }
}

fn attention_notification(observation: &TorrentObservation) -> DesktopNotification {
    let locale = desktop_localization::current_locale();
    DesktopNotification {
        kind: DesktopNotificationKind::NeedsAttention,
        title: desktop_localization::text_for_locale("notification.needs-attention.title", locale),
        body: desktop_localization::format_for_locale(
            "notification.needs-attention.body",
            locale,
            &[("name", &notification_name(observation, locale))],
        ),
        #[cfg(target_os = "linux")]
        open_label: desktop_localization::text_for_locale("notification.open", locale),
    }
}

fn notification_name(observation: &TorrentObservation, locale: &str) -> String {
    let normalized = observation
        .display_name
        .as_deref()
        .unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty() {
        return desktop_localization::text_for_locale("notification.unnamed-torrent", locale)
            .to_owned();
    }
    if normalized.chars().count() <= MAX_NOTIFICATION_NAME_CHARS {
        return normalized;
    }
    let mut bounded = normalized
        .chars()
        .take(MAX_NOTIFICATION_NAME_CHARS - 1)
        .collect::<String>();
    bounded.push('…');
    bounded
}

#[cfg(test)]
mod tests {
    use super::{
        DesktopNotificationKind, DesktopNotificationPolicy, StorageState, TorrentObservation,
        TorrentState, TrackedTorrent,
    };

    fn observation(
        torrent_id: &str,
        state: TorrentState,
        storage_state: StorageState,
        received_bytes: u128,
        verified_piece_count: u32,
    ) -> TorrentObservation {
        TorrentObservation {
            torrent_id: torrent_id.to_owned(),
            display_name: Some("Example download".to_owned()),
            state,
            storage_state,
            received_bytes: Some(received_bytes),
            verified_piece_count,
        }
    }

    fn establish(policy: &mut DesktopNotificationPolicy, torrent: TorrentObservation) {
        policy.established = true;
        policy.torrents.insert(
            torrent.torrent_id.clone(),
            TrackedTorrent {
                view: None,
                attention_active: super::needs_attention(&torrent),
                observation: torrent,
                completion_armed: false,
            },
        );
    }

    fn apply(
        policy: &mut DesktopNotificationPolicy,
        torrent: TorrentObservation,
    ) -> Option<DesktopNotificationKind> {
        if !policy.established {
            return None;
        }
        policy
            .apply_observation(torrent)
            .map(|notification| notification.kind)
    }

    #[test]
    fn initial_terminal_state_and_zero_work_completion_do_not_replay() {
        let mut policy = DesktopNotificationPolicy::default();
        establish(
            &mut policy,
            observation(
                "complete",
                TorrentState::Complete,
                StorageState::Available,
                100,
                1,
            ),
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "complete",
                    TorrentState::Complete,
                    StorageState::Available,
                    100,
                    1,
                )
            ),
            None
        );

        let mut zero_work = DesktopNotificationPolicy::default();
        establish(
            &mut zero_work,
            observation(
                "zero-work",
                TorrentState::Downloading,
                StorageState::Available,
                100,
                1,
            ),
        );
        assert_eq!(
            apply(
                &mut zero_work,
                observation(
                    "zero-work",
                    TorrentState::Complete,
                    StorageState::Available,
                    100,
                    1,
                )
            ),
            None
        );
    }

    #[test]
    fn observed_progress_arms_one_completion() {
        let mut policy = DesktopNotificationPolicy::default();
        establish(
            &mut policy,
            observation(
                "download",
                TorrentState::Downloading,
                StorageState::Available,
                10,
                0,
            ),
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "download",
                    TorrentState::Downloading,
                    StorageState::Available,
                    20,
                    1,
                )
            ),
            None
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "download",
                    TorrentState::Complete,
                    StorageState::Available,
                    20,
                    1,
                )
            ),
            Some(DesktopNotificationKind::DownloadComplete)
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "download",
                    TorrentState::Complete,
                    StorageState::Available,
                    20,
                    1,
                )
            ),
            None
        );
    }

    #[test]
    fn coalesced_progress_and_completion_patch_notifies() {
        let mut policy = DesktopNotificationPolicy::default();
        establish(
            &mut policy,
            observation(
                "coalesced",
                TorrentState::Downloading,
                StorageState::Available,
                10,
                0,
            ),
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "coalesced",
                    TorrentState::Complete,
                    StorageState::Available,
                    20,
                    1,
                )
            ),
            Some(DesktopNotificationKind::DownloadComplete)
        );
    }

    #[test]
    fn received_bytes_bridge_metadata_to_complete_without_arming_recheck_only_work() {
        let mut download = DesktopNotificationPolicy::default();
        establish(
            &mut download,
            observation(
                "metadata-coalesced",
                TorrentState::AwaitingMetadata,
                StorageState::Available,
                0,
                0,
            ),
        );
        assert_eq!(
            apply(
                &mut download,
                observation(
                    "metadata-coalesced",
                    TorrentState::Complete,
                    StorageState::Available,
                    4_195_035,
                    257,
                )
            ),
            Some(DesktopNotificationKind::DownloadComplete)
        );

        let mut recheck = DesktopNotificationPolicy::default();
        establish(
            &mut recheck,
            observation(
                "coalesced-recheck",
                TorrentState::Paused,
                StorageState::Available,
                4_195_035,
                0,
            ),
        );
        assert_eq!(
            apply(
                &mut recheck,
                observation(
                    "coalesced-recheck",
                    TorrentState::Complete,
                    StorageState::Available,
                    4_195_035,
                    257,
                )
            ),
            None
        );
    }

    #[test]
    fn checking_clears_completion_generation_but_later_repair_can_rearm() {
        let mut policy = DesktopNotificationPolicy::default();
        establish(
            &mut policy,
            observation(
                "recheck",
                TorrentState::Downloading,
                StorageState::Available,
                10,
                0,
            ),
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "recheck",
                    TorrentState::Downloading,
                    StorageState::Available,
                    20,
                    1,
                )
            ),
            None
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "recheck",
                    TorrentState::Checking,
                    StorageState::Available,
                    20,
                    0,
                )
            ),
            None
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "recheck",
                    TorrentState::Complete,
                    StorageState::Available,
                    20,
                    1,
                )
            ),
            None
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "recheck",
                    TorrentState::Downloading,
                    StorageState::Available,
                    21,
                    1,
                )
            ),
            None
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "recheck",
                    TorrentState::Complete,
                    StorageState::Available,
                    22,
                    2,
                )
            ),
            Some(DesktopNotificationKind::DownloadComplete)
        );
    }

    #[test]
    fn attention_is_edge_triggered_and_rearmed_by_recovery() {
        let mut policy = DesktopNotificationPolicy::default();
        establish(
            &mut policy,
            observation(
                "attention",
                TorrentState::Downloading,
                StorageState::Available,
                10,
                0,
            ),
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "attention",
                    TorrentState::Error,
                    StorageState::Available,
                    10,
                    0,
                )
            ),
            Some(DesktopNotificationKind::NeedsAttention)
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "attention",
                    TorrentState::Error,
                    StorageState::NeedsRepair,
                    10,
                    0,
                )
            ),
            None
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "attention",
                    TorrentState::Paused,
                    StorageState::Available,
                    10,
                    0,
                )
            ),
            None
        );
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "attention",
                    TorrentState::NeedsRepair,
                    StorageState::Available,
                    10,
                    0,
                )
            ),
            Some(DesktopNotificationKind::NeedsAttention)
        );
    }

    #[test]
    fn reset_removal_and_new_rows_do_not_replay_completion() {
        let mut policy = DesktopNotificationPolicy::default();
        establish(
            &mut policy,
            observation(
                "removed",
                TorrentState::Downloading,
                StorageState::Available,
                10,
                0,
            ),
        );
        policy.remove("removed");
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "removed",
                    TorrentState::Complete,
                    StorageState::Available,
                    20,
                    1,
                )
            ),
            None
        );
        policy.reset();
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "removed",
                    TorrentState::Error,
                    StorageState::NeedsRepair,
                    20,
                    1,
                )
            ),
            None
        );
    }

    #[test]
    fn new_runtime_attention_row_emits_and_content_is_bounded() {
        let mut policy = DesktopNotificationPolicy {
            established: true,
            torrents: HashMap::new(),
            ..DesktopNotificationPolicy::default()
        };
        let mut torrent = observation(
            "new-error",
            TorrentState::Error,
            StorageState::Available,
            0,
            0,
        );
        torrent.display_name = Some(format!("  {}\nsecret  ", "x".repeat(200)));
        let notification = policy
            .apply_observation(torrent)
            .expect("new attention edge");
        assert_eq!(notification.kind, DesktopNotificationKind::NeedsAttention);
        assert!(!notification.body.contains('\n'));
        assert!(notification.body.chars().count() < 180);
        assert!(!notification.body.contains("new-error"));
    }

    #[test]
    fn new_runtime_completed_row_requires_received_payload() {
        let mut policy = DesktopNotificationPolicy {
            established: true,
            ..DesktopNotificationPolicy::default()
        };
        assert_eq!(
            apply(
                &mut policy,
                observation(
                    "coalesced-new",
                    TorrentState::Complete,
                    StorageState::Available,
                    4_195_035,
                    257,
                )
            ),
            Some(DesktopNotificationKind::DownloadComplete)
        );

        let mut zero_work = DesktopNotificationPolicy {
            established: true,
            ..DesktopNotificationPolicy::default()
        };
        assert_eq!(
            apply(
                &mut zero_work,
                observation(
                    "complete-new",
                    TorrentState::Complete,
                    StorageState::Available,
                    0,
                    257,
                )
            ),
            None
        );
    }

    use std::collections::HashMap;
}
