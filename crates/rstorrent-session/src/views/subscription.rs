//! Legacy single-view bounded delivery accumulator.
//!
//! One subscriber owns its queue, byte accounting, cadence, continuity, close
//! state, and notification. The hub supplies snapshots and patches; this
//! module never reads hub projection maps and owns no task.

use std::collections::{BTreeSet, VecDeque};
use std::sync::Mutex;

use tokio::sync::Notify;
use tokio::time::Instant;

use crate::diagnostics::valid_filter;
use crate::speed::{MAX_SPEED_SERIES, SpeedHistoryPosition, SpeedMetric};

use super::contract::{
    MAX_CATALOG_PAGE_ROWS, MAX_SUBSCRIPTION_INTERVAL_MILLIS, MAX_SUBSCRIPTION_QUEUE_BYTES,
    MIN_SUBSCRIPTION_QUEUE_BYTES,
};
use super::diff::coalesce;
use super::{
    ResetReason, SubscriptionError, SubscriptionSpec, VIEW_CONTRACT_VERSION, ViewPatch,
    ViewProjection, ViewSelector, ViewSnapshot, ViewUpdate, ViewUpdatePayload,
};

#[derive(Debug)]
pub(super) struct SubscriberInner {
    pub(super) stream_id: u64,
    pub(super) epoch: u64,
    pub(super) spec: SubscriptionSpec,
    pub(super) queue: Mutex<QueueState>,
    pub(super) notify: Notify,
}

#[derive(Debug)]
pub(super) struct QueueState {
    pub(super) entries: VecDeque<QueuedUpdate>,
    pub(super) queued_bytes: usize,
    pub(super) queue_high_water: usize,
    pub(super) reset_count: u64,
    pub(super) next_sequence: u64,
    pub(super) tail_revision: u64,
    pub(super) next_delivery: Instant,
    pub(super) needs_resync: bool,
    pub(super) speed_history: Option<SpeedHistoryPosition>,
    pub(super) closed: bool,
}

#[derive(Debug)]
pub(super) struct QueuedUpdate {
    pub(super) update: ViewUpdate,
    pub(super) encoded_bytes: usize,
}

impl SubscriberInner {
    pub(super) fn enqueue_snapshot(
        &self,
        revision: u64,
        snapshot: ViewSnapshot,
    ) -> Result<(), SubscriptionError> {
        self.replace_with_snapshot(revision, snapshot)
    }

    pub(super) fn enqueue_patch(
        &self,
        revision: u64,
        patch: ViewPatch,
    ) -> Result<(), SubscriptionError> {
        self.enqueue(revision, ViewUpdatePayload::Patch { patch }, true)
    }

    pub(super) fn enqueue_diagnostic_patch(
        &self,
        revision: u64,
        patch: ViewPatch,
    ) -> Result<(), SubscriptionError> {
        self.enqueue(revision, ViewUpdatePayload::Patch { patch }, false)
    }

    pub(super) fn enqueue_speed_history(
        &self,
        revision: u64,
        history: crate::SpeedHistoryView,
    ) -> Result<(), SubscriptionError> {
        let append = {
            let mut queue = self
                .queue
                .lock()
                .map_err(|_| SubscriptionError::Internal("queue lock is poisoned".to_owned()))?;
            if queue.closed || queue.needs_resync {
                return Ok(());
            }
            let Some(position) = queue.speed_history.as_mut() else {
                drop(queue);
                return self.replace_with_snapshot(
                    revision,
                    ViewSnapshot::SessionSpeedHistory { history },
                );
            };
            match position.append_to(&history) {
                Ok(append) => append,
                Err(_) => {
                    drop(queue);
                    return self.replace_with_snapshot(
                        revision,
                        ViewSnapshot::SessionSpeedHistory { history },
                    );
                }
            }
        };
        if let Some(append) = append {
            self.enqueue_patch(revision, ViewPatch::SessionSpeedHistory { append })?;
        }
        Ok(())
    }

    pub(super) fn replace_with_snapshot(
        &self,
        revision: u64,
        snapshot: ViewSnapshot,
    ) -> Result<(), SubscriptionError> {
        let mut queue = self
            .queue
            .lock()
            .map_err(|_| SubscriptionError::Internal("queue lock is poisoned".to_owned()))?;
        if queue.closed {
            return Err(SubscriptionError::Closed);
        }
        queue.entries.clear();
        queue.queued_bytes = 0;
        queue.needs_resync = false;
        queue.speed_history = match &snapshot {
            ViewSnapshot::SessionSpeedHistory { history } => Some(
                SpeedHistoryPosition::from_view(history)
                    .map_err(|error| SubscriptionError::Internal(error.to_string()))?,
            ),
            _ => None,
        };
        let update = make_update(
            self,
            &mut queue,
            revision,
            ViewUpdatePayload::Snapshot { snapshot },
        );
        let encoded_bytes = encoded_len(&update)?;
        if encoded_bytes > self.spec.delivery.max_queue_bytes as usize {
            return Err(SubscriptionError::SnapshotExceedsQueue {
                snapshot: encoded_bytes,
                maximum: self.spec.delivery.max_queue_bytes,
            });
        }
        push_update(&mut queue, update, encoded_bytes);
        drop(queue);
        self.notify.notify_one();
        Ok(())
    }

    pub(super) fn enqueue(
        &self,
        revision: u64,
        payload: ViewUpdatePayload,
        allow_coalesce: bool,
    ) -> Result<(), SubscriptionError> {
        let mut queue = self
            .queue
            .lock()
            .map_err(|_| SubscriptionError::Internal("queue lock is poisoned".to_owned()))?;
        if queue.closed || queue.needs_resync {
            return Ok(());
        }
        if allow_coalesce
            && let Some(back) = queue.entries.back_mut()
            && coalesce(&mut back.update, &payload)
        {
            let (previous_bytes, next_bytes) = {
                let previous_bytes = back.encoded_bytes;
                back.update.revision = revision.to_string();
                back.encoded_bytes = encoded_len(&back.update)?;
                (previous_bytes, back.encoded_bytes)
            };
            queue.tail_revision = revision;
            queue.queued_bytes = queue.queued_bytes - previous_bytes + next_bytes;
            if queue.queued_bytes <= self.spec.delivery.max_queue_bytes as usize {
                queue.queue_high_water = queue.queue_high_water.max(queue.queued_bytes);
                drop(queue);
                self.notify.notify_one();
                return Ok(());
            }
        } else {
            let update = make_update(self, &mut queue, revision, payload);
            let encoded_bytes = encoded_len(&update)?;
            if encoded_bytes <= self.spec.delivery.max_queue_bytes as usize
                && queue.queued_bytes + encoded_bytes <= self.spec.delivery.max_queue_bytes as usize
            {
                push_update(&mut queue, update, encoded_bytes);
                drop(queue);
                self.notify.notify_one();
                return Ok(());
            }
        }

        queue.entries.clear();
        queue.queued_bytes = 0;
        queue.needs_resync = true;
        queue.reset_count = queue.reset_count.saturating_add(1);
        let update = make_update(
            self,
            &mut queue,
            revision,
            ViewUpdatePayload::ResetRequired {
                reason: ResetReason::QueueOverflow,
            },
        );
        let encoded_bytes = encoded_len(&update)?;
        push_update(&mut queue, update, encoded_bytes);
        drop(queue);
        self.notify.notify_one();
        Ok(())
    }
}

pub(crate) fn validate_spec(spec: &SubscriptionSpec) -> Result<(), SubscriptionError> {
    if spec.delivery.min_interval_millis > MAX_SUBSCRIPTION_INTERVAL_MILLIS {
        return Err(SubscriptionError::InvalidInterval {
            maximum: MAX_SUBSCRIPTION_INTERVAL_MILLIS,
        });
    }
    if !(MIN_SUBSCRIPTION_QUEUE_BYTES..=MAX_SUBSCRIPTION_QUEUE_BYTES)
        .contains(&spec.delivery.max_queue_bytes)
    {
        return Err(SubscriptionError::InvalidQueueBound {
            minimum: MIN_SUBSCRIPTION_QUEUE_BYTES,
            maximum: MAX_SUBSCRIPTION_QUEUE_BYTES,
        });
    }
    if matches!(spec.selector, ViewSelector::TorrentList)
        && matches!(
            spec.projection,
            ViewProjection::PieceActivity
                | ViewProjection::Dht
                | ViewProjection::Peers
                | ViewProjection::Swarm
                | ViewProjection::Files
                | ViewProjection::Media
                | ViewProjection::Trackers
        )
    {
        return Err(SubscriptionError::InvalidProjection);
    }
    if matches!(spec.selector, ViewSelector::Torrent { .. })
        && matches!(
            spec.projection,
            ViewProjection::Disk
                | ViewProjection::Dht
                | ViewProjection::CurrentRates
                | ViewProjection::SpeedHistory
        )
    {
        return Err(SubscriptionError::InvalidProjection);
    }
    match (&spec.selector, spec.projection) {
        (ViewSelector::SessionDht, ViewProjection::Dht) => {}
        (ViewSelector::SessionDht, _) | (_, ViewProjection::Dht) => {
            return Err(SubscriptionError::InvalidProjection);
        }
        (ViewSelector::SessionCurrentRates { metrics }, ViewProjection::CurrentRates)
            if !metrics.is_empty()
                && metrics.len() <= SpeedMetric::AVAILABLE.len()
                && metrics
                    .iter()
                    .all(|metric| SpeedMetric::AVAILABLE.contains(metric))
                && metrics.iter().copied().collect::<BTreeSet<_>>().len() == metrics.len() => {}
        (ViewSelector::SessionCurrentRates { .. }, _) | (_, ViewProjection::CurrentRates) => {
            return Err(SubscriptionError::InvalidProjection);
        }
        (ViewSelector::SessionSpeedHistory { metrics, .. }, ViewProjection::SpeedHistory)
            if !metrics.is_empty()
                && metrics.len() <= MAX_SPEED_SERIES
                && metrics
                    .iter()
                    .all(|metric| SpeedMetric::AVAILABLE.contains(metric))
                && metrics.iter().copied().collect::<BTreeSet<_>>().len() == metrics.len() => {}
        (ViewSelector::SessionSpeedHistory { .. }, _) | (_, ViewProjection::SpeedHistory) => {
            return Err(SubscriptionError::InvalidProjection);
        }
        _ => {}
    }
    if spec.projection != ViewProjection::Diagnostics && spec.diagnostics.is_some() {
        return Err(SubscriptionError::InvalidProjection);
    }
    match (&spec.selector, spec.projection) {
        (ViewSelector::Library { query }, ViewProjection::LibraryMedia) => {
            query.validate().map_err(SubscriptionError::InvalidQuery)?;
        }
        (ViewSelector::Library { .. }, _) | (_, ViewProjection::LibraryMedia) => {
            return Err(SubscriptionError::InvalidProjection);
        }
        _ => {}
    }
    let catalog_projection = matches!(
        spec.projection,
        ViewProjection::Files | ViewProjection::Trackers | ViewProjection::LibraryMedia
    );
    if catalog_projection != spec.catalog_page.is_some() {
        return Err(SubscriptionError::InvalidProjection);
    }
    let maximum_rows = if spec.projection == ViewProjection::LibraryMedia {
        crate::MAX_LIBRARY_PAGE_ROWS
    } else {
        MAX_CATALOG_PAGE_ROWS
    };
    if let Some(page) = spec.catalog_page
        && !(1..=maximum_rows).contains(&page.limit)
    {
        return Err(SubscriptionError::InvalidCatalogPage {
            maximum: maximum_rows,
        });
    }
    if let Some(filter) = &spec.diagnostics
        && !valid_filter(filter)
    {
        return Err(SubscriptionError::InvalidProjection);
    }
    Ok(())
}

pub(super) fn parse_revision(value: &str) -> Result<u64, SubscriptionError> {
    value
        .parse()
        .map_err(|_| SubscriptionError::Internal("invalid snapshot revision".to_owned()))
}

fn make_update(
    subscriber: &SubscriberInner,
    queue: &mut QueueState,
    revision: u64,
    payload: ViewUpdatePayload,
) -> ViewUpdate {
    let sequence = queue.next_sequence;
    queue.next_sequence = queue.next_sequence.saturating_add(1);
    let base_revision = queue.tail_revision;
    queue.tail_revision = revision;
    ViewUpdate {
        contract_version: VIEW_CONTRACT_VERSION,
        stream_id: subscriber.stream_id.to_string(),
        epoch: subscriber.epoch.to_string(),
        sequence: sequence.to_string(),
        base_revision: base_revision.to_string(),
        revision: revision.to_string(),
        payload,
    }
}

fn encoded_len(update: &ViewUpdate) -> Result<usize, SubscriptionError> {
    serde_json::to_vec(update)
        .map(|bytes| bytes.len())
        .map_err(|error| SubscriptionError::Internal(error.to_string()))
}

fn push_update(queue: &mut QueueState, update: ViewUpdate, encoded_bytes: usize) {
    queue.queued_bytes += encoded_bytes;
    queue.queue_high_water = queue.queue_high_water.max(queue.queued_bytes);
    queue.entries.push_back(QueuedUpdate {
        update,
        encoded_bytes,
    });
}
