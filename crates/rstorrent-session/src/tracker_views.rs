use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::HttpsServerAuthenticationPolicy;
use crate::store::{StoredTracker, StoredTrackerSource, StoredTrackerTransport};
use rstorrent_engine::{
    TrackerAnnounceEvent, TrackerConnectionFamily, TrackerEndpoint, TrackerNextAction,
    TrackerRuntimeRecordSnapshot, TrackerRuntimeSnapshot, TrackerRuntimeStatus, TrackerSource,
    TrackerTransport,
};
use rstorrent_protocol::magnet::{MAX_TRACKER_URL_LENGTH, UdpTrackerUrl};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum TrackerCatalogState {
    Available,
    TorrentMissing,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum TrackerTransportView {
    Udp,
    Http,
    Https,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum TrackerSecurityView {
    Unencrypted,
    EncryptedSystemTrust,
    EncryptedUnauthenticated,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum TrackerConnectionFamilyView {
    Ipv4,
    Ipv6,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum TrackerSourceView {
    Magnet,
    Metainfo,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum TrackerStatusView {
    Unsupported,
    Inactive,
    Disabled,
    Idle,
    Announcing,
    RetryWait,
    ReannounceWait,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum TrackerAnnounceEventView {
    Started,
    Update,
    Completed,
    Stopped,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[serde(rename_all = "snake_case")]
pub enum TrackerNextActionView {
    Announce,
    Retry,
    Reannounce,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TrackerView {
    pub tracker_id: String,
    pub url: String,
    pub transport: TrackerTransportView,
    pub security: TrackerSecurityView,
    pub source: TrackerSourceView,
    pub tier: u32,
    pub status: TrackerStatusView,
    pub announce_event: Option<TrackerAnnounceEventView>,
    pub total_attempts: u32,
    pub consecutive_failures: u32,
    pub last_connection_family: Option<TrackerConnectionFamilyView>,
    pub last_peer_count: Option<u32>,
    pub seeders: Option<u32>,
    pub leechers: Option<u32>,
    pub interval_seconds: Option<u32>,
    pub next_action: Option<TrackerNextActionView>,
    /// Application-clock deadline; compare with UpdateBatch::server_now_millis.
    /// This is not a Unix timestamp and is not persisted across runtime restart.
    pub next_action_at_millis: Option<String>,
    /// Last accepted success on the same application monotonic clock.
    pub last_success_at_millis: Option<String>,
    /// Last accepted failure on the same application monotonic clock.
    pub last_failure_at_millis: Option<String>,
    pub last_error: Option<String>,
}

impl TrackerView {
    fn inactive(
        tracker: &StoredTracker,
        https_authentication: HttpsServerAuthenticationPolicy,
    ) -> Self {
        Self {
            tracker_id: tracker_id(tracker.tier, tracker.position),
            url: redact_tracker_url(&tracker.url),
            transport: match tracker.transport {
                StoredTrackerTransport::Udp => TrackerTransportView::Udp,
                StoredTrackerTransport::Http => TrackerTransportView::Http,
                StoredTrackerTransport::Https => TrackerTransportView::Https,
            },
            security: tracker_security(tracker.transport, https_authentication),
            source: match tracker.source {
                StoredTrackerSource::Magnet => TrackerSourceView::Magnet,
                StoredTrackerSource::Metainfo => TrackerSourceView::Metainfo,
            },
            tier: tracker.tier,
            status: if tracker_is_operational(tracker) {
                TrackerStatusView::Inactive
            } else {
                TrackerStatusView::Unsupported
            },
            announce_event: None,
            total_attempts: 0,
            consecutive_failures: 0,
            last_connection_family: None,
            last_peer_count: None,
            seeders: None,
            leechers: None,
            interval_seconds: None,
            next_action: None,
            next_action_at_millis: None,
            last_success_at_millis: None,
            last_failure_at_millis: None,
            last_error: None,
        }
    }
}

const fn tracker_security(
    transport: StoredTrackerTransport,
    https_authentication: HttpsServerAuthenticationPolicy,
) -> TrackerSecurityView {
    match transport {
        StoredTrackerTransport::Udp | StoredTrackerTransport::Http => {
            TrackerSecurityView::Unencrypted
        }
        StoredTrackerTransport::Https => match https_authentication {
            HttpsServerAuthenticationPolicy::SystemTrust => {
                TrackerSecurityView::EncryptedSystemTrust
            }
            HttpsServerAuthenticationPolicy::Disabled => {
                TrackerSecurityView::EncryptedUnauthenticated
            }
        },
    }
}

fn tracker_is_operational(tracker: &StoredTracker) -> bool {
    if tracker.url.len() > MAX_TRACKER_URL_LENGTH
        || !tracker.url.is_ascii()
        || tracker
            .url
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b' ')
        || tracker.url.contains('#')
    {
        return false;
    }
    match tracker.transport {
        StoredTrackerTransport::Udp => UdpTrackerUrl::from_metainfo_url(&tracker.url).is_some(),
        StoredTrackerTransport::Http => TrackerEndpoint::from_http_url(&tracker.url)
            .is_some_and(|endpoint| endpoint.transport() == TrackerTransport::Http),
        StoredTrackerTransport::Https => TrackerEndpoint::from_http_url(&tracker.url)
            .is_some_and(|endpoint| endpoint.transport() == TrackerTransport::Https),
    }
}

impl TrackerView {
    fn from_runtime(record: &TrackerRuntimeRecordSnapshot, captured_at: Duration) -> Self {
        Self {
            tracker_id: record.tracker_id.clone(),
            url: redact_tracker_url(&record.url),
            transport: match record.transport {
                TrackerTransport::Udp => TrackerTransportView::Udp,
                TrackerTransport::Http => TrackerTransportView::Http,
                TrackerTransport::Https => TrackerTransportView::Https,
            },
            security: match record.transport {
                TrackerTransport::Udp | TrackerTransport::Http => TrackerSecurityView::Unencrypted,
                TrackerTransport::Https => match record.https_authentication {
                    Some(rstorrent_engine::TrackerHttpsAuthentication::Disabled) => {
                        TrackerSecurityView::EncryptedUnauthenticated
                    }
                    Some(rstorrent_engine::TrackerHttpsAuthentication::SystemTrust) | None => {
                        TrackerSecurityView::EncryptedSystemTrust
                    }
                },
            },
            source: match record.source {
                TrackerSource::Magnet => TrackerSourceView::Magnet,
                TrackerSource::Metainfo => TrackerSourceView::Metainfo,
            },
            tier: record.tier,
            status: match record.status {
                TrackerRuntimeStatus::Inactive => TrackerStatusView::Inactive,
                TrackerRuntimeStatus::Disabled => TrackerStatusView::Disabled,
                TrackerRuntimeStatus::Idle => TrackerStatusView::Idle,
                TrackerRuntimeStatus::Announcing => TrackerStatusView::Announcing,
                TrackerRuntimeStatus::RetryWait => TrackerStatusView::RetryWait,
                TrackerRuntimeStatus::ReannounceWait => TrackerStatusView::ReannounceWait,
            },
            announce_event: record.announce_event.map(|event| match event {
                TrackerAnnounceEvent::Started => TrackerAnnounceEventView::Started,
                TrackerAnnounceEvent::Update => TrackerAnnounceEventView::Update,
                TrackerAnnounceEvent::Completed => TrackerAnnounceEventView::Completed,
                TrackerAnnounceEvent::Stopped => TrackerAnnounceEventView::Stopped,
            }),
            total_attempts: record.total_attempts,
            consecutive_failures: u32::from(record.consecutive_failures),
            last_connection_family: record.last_connection_family.map(|family| match family {
                TrackerConnectionFamily::Ipv4 => TrackerConnectionFamilyView::Ipv4,
                TrackerConnectionFamily::Ipv6 => TrackerConnectionFamilyView::Ipv6,
            }),
            last_peer_count: record.last_peer_count,
            seeders: record.seeders,
            leechers: record.leechers,
            interval_seconds: record
                .interval
                .map(|interval| interval.as_secs().try_into().unwrap_or(u32::MAX)),
            next_action: record.next_action.map(|action| match action {
                TrackerNextAction::Announce => TrackerNextActionView::Announce,
                TrackerNextAction::Retry => TrackerNextActionView::Retry,
                TrackerNextAction::Reannounce => TrackerNextActionView::Reannounce,
            }),
            next_action_at_millis: record
                .next_action_in
                .map(|duration| captured_at.saturating_add(duration).as_millis().to_string()),
            last_success_at_millis: record
                .last_success_age
                .map(|duration| captured_at.saturating_sub(duration).as_millis().to_string()),
            last_failure_at_millis: record
                .last_failure_age
                .map(|duration| captured_at.saturating_sub(duration).as_millis().to_string()),
            last_error: record.last_error.clone(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TrackerViewModel {
    catalog: Arc<[StoredTracker]>,
    runtime: BTreeMap<String, TrackerView>,
    https_authentication: HttpsServerAuthenticationPolicy,
}

impl Default for TrackerViewModel {
    fn default() -> Self {
        Self {
            catalog: Arc::from([]),
            runtime: BTreeMap::new(),
            https_authentication: HttpsServerAuthenticationPolicy::default(),
        }
    }
}

impl TrackerViewModel {
    pub(crate) fn from_trackers(
        trackers: &[StoredTracker],
        https_authentication: HttpsServerAuthenticationPolicy,
    ) -> Self {
        Self {
            catalog: Arc::from(trackers),
            runtime: BTreeMap::new(),
            https_authentication,
        }
    }

    pub(crate) fn catalog_matches(&self, other: &Self) -> bool {
        self.catalog == other.catalog
    }

    pub(crate) fn replace_snapshot(
        &mut self,
        snapshot: &TrackerRuntimeSnapshot,
        captured_at: Duration,
    ) -> Self {
        let previous = Self {
            catalog: Arc::clone(&self.catalog),
            runtime: std::mem::take(&mut self.runtime),
            https_authentication: self.https_authentication,
        };
        self.runtime = snapshot
            .records
            .iter()
            .map(|record| {
                (
                    record.tracker_id.clone(),
                    TrackerView::from_runtime(record, captured_at),
                )
            })
            .collect();
        previous
    }

    #[cfg(test)]
    pub(crate) fn rows(&self) -> Vec<TrackerView> {
        self.rows_page(0..self.count_usize())
    }

    pub(crate) fn rows_page(&self, range: std::ops::Range<usize>) -> Vec<TrackerView> {
        if self.catalog.is_empty() {
            return self
                .runtime
                .values()
                .skip(range.start)
                .take(range.len())
                .cloned()
                .collect();
        }
        self.catalog
            .iter()
            .skip(range.start)
            .take(range.len())
            .map(|tracker| {
                let id = tracker_id(tracker.tier, tracker.position);
                self.runtime.get(&id).map_or_else(
                    || TrackerView::inactive(tracker, self.https_authentication),
                    Clone::clone,
                )
            })
            .collect()
    }

    pub(crate) fn count_usize(&self) -> usize {
        if self.catalog.is_empty() {
            self.runtime.len()
        } else {
            self.catalog.len()
        }
    }

    pub(crate) fn count(&self) -> u32 {
        self.count_usize().try_into().unwrap_or(u32::MAX)
    }

    pub(crate) fn row_map_page(
        &self,
        range: std::ops::Range<usize>,
    ) -> BTreeMap<String, TrackerView> {
        self.rows_page(range)
            .into_iter()
            .map(|view| (view.tracker_id.clone(), view))
            .collect()
    }
}

fn tracker_id(tier: u32, position: u32) -> String {
    format!("{tier:06}:{position:06}")
}

fn redact_tracker_url(url: &str) -> String {
    let Some((scheme, remainder)) = url.split_once("://") else {
        return "invalid-tracker".to_owned();
    };
    let authority_end = remainder.find(['/', '?', '#']).unwrap_or(remainder.len());
    let authority = remainder[..authority_end]
        .rsplit_once('@')
        .map_or(&remainder[..authority_end], |(_, authority)| authority);
    format!("{}://{authority}", scheme.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use crate::HttpsServerAuthenticationPolicy;
    use crate::store::{StoredTracker, StoredTrackerSource, StoredTrackerTransport};
    use rstorrent_engine::{
        TrackerConnectionFamily, TrackerNextAction, TrackerRuntimeRecordSnapshot,
        TrackerRuntimeSnapshot, TrackerRuntimeStatus, TrackerSource, TrackerTransport,
    };

    use super::{
        TrackerConnectionFamilyView, TrackerNextActionView, TrackerSecurityView, TrackerStatusView,
        TrackerViewModel,
    };

    #[test]
    fn durable_catalog_redacts_credentials_and_projects_transport_security() {
        let model = TrackerViewModel::from_trackers(
            &[
                StoredTracker {
                    tier: 0,
                    position: 0,
                    url: "udp://tracker.example:6969/private-key".to_owned(),
                    transport: StoredTrackerTransport::Udp,
                    source: StoredTrackerSource::Metainfo,
                },
                StoredTracker {
                    tier: 1,
                    position: 0,
                    url: "https://user:secret@tracker.example/announce?passkey=secret".to_owned(),
                    transport: StoredTrackerTransport::Https,
                    source: StoredTrackerSource::Metainfo,
                },
                StoredTracker {
                    tier: 2,
                    position: 0,
                    url: "https:///missing-host".to_owned(),
                    transport: StoredTrackerTransport::Https,
                    source: StoredTrackerSource::Metainfo,
                },
            ],
            HttpsServerAuthenticationPolicy::Disabled,
        );
        let rows = model.rows();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].url, "udp://tracker.example:6969");
        assert_eq!(rows[0].status, TrackerStatusView::Inactive);
        assert_eq!(rows[0].security, TrackerSecurityView::Unencrypted);
        assert_eq!(rows[1].url, "https://tracker.example");
        assert_eq!(rows[1].status, TrackerStatusView::Inactive);
        assert_eq!(
            rows[1].security,
            TrackerSecurityView::EncryptedUnauthenticated
        );
        assert_eq!(rows[2].status, TrackerStatusView::Unsupported);
    }

    #[test]
    fn runtime_snapshot_replaces_catalog_and_maps_monotonic_values() {
        let mut model = TrackerViewModel::default();
        model.replace_snapshot(
            &TrackerRuntimeSnapshot {
                captured_at: Duration::from_secs(9),
                active: true,
                records: vec![TrackerRuntimeRecordSnapshot {
                    tracker_id: "000000:000000".to_owned(),
                    url: "udp://tracker.example:6969/private-key".to_owned(),
                    tier: 0,
                    source: TrackerSource::Magnet,
                    transport: TrackerTransport::Udp,
                    https_authentication: None,
                    status: TrackerRuntimeStatus::RetryWait,
                    announce_event: None,
                    total_attempts: 2,
                    consecutive_failures: 1,
                    last_connection_family: Some(TrackerConnectionFamily::Ipv6),
                    last_peer_count: Some(20),
                    seeders: Some(12),
                    leechers: Some(8),
                    interval: Some(Duration::from_secs(600)),
                    next_action: Some(TrackerNextAction::Retry),
                    next_action_in: Some(Duration::from_millis(1250)),
                    last_success_age: Some(Duration::from_secs(8)),
                    last_failure_age: Some(Duration::from_millis(250)),
                    last_error: Some("timeout".to_owned()),
                }],
            },
            Duration::from_secs(9),
        );
        let row = &model.rows()[0];
        assert_eq!(row.status, TrackerStatusView::RetryWait);
        assert_eq!(row.next_action, Some(TrackerNextActionView::Retry));
        assert_eq!(row.next_action_at_millis.as_deref(), Some("10250"));
        assert_eq!(row.last_success_at_millis.as_deref(), Some("1000"));
        assert_eq!(row.last_failure_at_millis.as_deref(), Some("8750"));
        assert_eq!(row.interval_seconds, Some(600));
        assert_eq!(
            row.last_connection_family,
            Some(TrackerConnectionFamilyView::Ipv6)
        );
        assert_eq!(row.url, "udp://tracker.example:6969");
    }

    #[test]
    fn large_catalog_pages_traverse_without_omissions_or_duplicates() {
        let trackers = (0..2_050_u32)
            .map(|position| StoredTracker {
                tier: position / 700,
                position,
                url: format!("https://tracker-{position}.example/announce/private"),
                transport: StoredTrackerTransport::Https,
                source: StoredTrackerSource::Metainfo,
            })
            .collect::<Vec<_>>();
        let model =
            TrackerViewModel::from_trackers(&trackers, HttpsServerAuthenticationPolicy::Disabled);
        let rows = [0..1_024, 1_024..2_048, 2_048..2_050]
            .into_iter()
            .flat_map(|range| model.rows_page(range))
            .collect::<Vec<_>>();
        assert_eq!(rows.len(), trackers.len());
        let ids = rows
            .iter()
            .map(|row| row.tracker_id.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(ids.len(), trackers.len());
        assert_eq!(rows[0].tracker_id, "000000:000000");
        assert_eq!(rows[2_049].tracker_id, "000002:002049");
        assert!(
            rows.iter()
                .all(|row| row.status == TrackerStatusView::Inactive)
        );
        assert!(
            rows.iter()
                .all(|row| { row.security == TrackerSecurityView::EncryptedUnauthenticated })
        );
    }
}
