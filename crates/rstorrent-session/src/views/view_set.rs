use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::contract::{
    API_VERSION, DEFAULT_VIEW_SET_QUEUE_BYTES, MAX_VIEW_DELIVERY_INTERVAL_MILLIS,
    MAX_VIEW_ID_BYTES, MAX_VIEW_SET_QUEUE_BYTES, MAX_VIEW_SET_SNAPSHOT_BYTES, MAX_VIEWS_PER_SET,
    MIN_VIEW_SET_QUEUE_BYTES, OpenViewSetRequest, OpenViewSetResponse, UpdateBatch,
    UpdateViewSetRequest, ViewSetError, ViewSetOwner, ViewSetStats, ViewSetUpdate, ViewSpec,
};
use super::{ResetReason, ViewPatch, ViewSnapshot, coalesce_patch};
use crate::speed::{MAX_SPEED_SERIES, SpeedHistoryPosition, SpeedMetric};
use tokio::sync::Notify;
static NEXT_VIEW_SET_EPOCH: AtomicU64 = AtomicU64::new(1);

#[derive(Debug)]
pub(crate) struct ViewSetInner {
    clock_origin: Instant,
    pub(super) id: String,
    owner: ViewSetOwner,
    state: Mutex<ViewSetState>,
    pub(super) notify: Notify,
    polling: AtomicBool,
    pub(super) lease: Duration,
}

#[derive(Debug)]
struct ViewSetState {
    epoch: u64,
    acknowledged_cursor: u64,
    next_cursor: u64,
    durable_revision: u64,
    pub(super) views: BTreeMap<String, ViewSpec>,
    pub(super) queue_bytes_limit: u32,
    pending: VecDeque<QueuedViewSetUpdate>,
    pending_bytes: usize,
    last_delivered: BTreeMap<String, Instant>,
    speed_histories: BTreeMap<String, SpeedHistoryPosition>,
    in_flight: Option<StoredBatch>,
    queue_high_water: usize,
    reset_count: u64,
    reset_pending: Option<ResetReason>,
    last_client_activity: Instant,
    closed: bool,
}

#[derive(Clone, Debug)]
struct QueuedViewSetUpdate {
    update: ViewSetUpdate,
    encoded_bytes: usize,
    ready_at: Instant,
}

#[derive(Clone, Debug)]
struct StoredBatch {
    batch: UpdateBatch,
    encoded_bytes: usize,
}

pub(super) struct ViewSetInitialState {
    pub(super) clock_origin: Instant,
    pub(super) revision: u64,
    pub(super) views: BTreeMap<String, ViewSpec>,
    pub(super) queue_bytes_limit: u32,
    pub(super) snapshots: Vec<ViewSetUpdate>,
    pub(super) now: Instant,
    pub(super) lease: Duration,
}

pub(super) enum PollState {
    Ready(UpdateBatch),
    Wait(Option<Instant>),
    Reset(ResetReason),
    Closed,
}

impl ViewSetInner {
    pub(super) fn new(
        id: String,
        owner: ViewSetOwner,
        initial: ViewSetInitialState,
    ) -> Result<Arc<Self>, ViewSetError> {
        let ViewSetInitialState {
            clock_origin,
            revision,
            views,
            queue_bytes_limit,
            snapshots,
            now,
            lease,
        } = initial;
        let inner = Arc::new(Self {
            clock_origin,
            id,
            owner,
            state: Mutex::new(ViewSetState {
                epoch: next_epoch(),
                acknowledged_cursor: 0,
                next_cursor: 1,
                durable_revision: revision,
                views,
                queue_bytes_limit,
                pending: VecDeque::new(),
                pending_bytes: 0,
                last_delivered: BTreeMap::new(),
                speed_histories: BTreeMap::new(),
                in_flight: None,
                queue_high_water: 0,
                reset_count: 0,
                reset_pending: None,
                last_client_activity: now,
                closed: false,
            }),
            notify: Notify::new(),
            polling: AtomicBool::new(false),
            lease,
        });
        inner.install_initial(snapshots, now)?;
        Ok(inner)
    }

    pub(crate) fn owner_matches(&self, owner: &ViewSetOwner) -> bool {
        self.owner == *owner
    }

    pub(crate) fn view_specs(&self) -> Result<Vec<ViewSpec>, ViewSetError> {
        let state = self.state()?;
        Ok(state.views.values().cloned().collect())
    }

    pub(super) fn queue_bytes_limit(&self) -> Result<u32, ViewSetError> {
        Ok(self.state()?.queue_bytes_limit)
    }

    pub(super) fn open_response(&self) -> Result<OpenViewSetResponse, ViewSetError> {
        let state = self.state()?;
        let initial = state
            .in_flight
            .as_ref()
            .ok_or_else(|| ViewSetError::Internal("initial batch is absent".to_owned()))?
            .batch
            .clone();
        Ok(OpenViewSetResponse {
            view_set_id: self.id.clone(),
            lease_millis: self.lease.as_millis().to_string(),
            effective_queue_bytes: state.queue_bytes_limit,
            effective_views: state.views.values().cloned().collect(),
            initial,
        })
    }

    pub(crate) fn is_expired(&self, now: Instant) -> bool {
        self.state.lock().map_or(true, |state| {
            state.closed || now.saturating_duration_since(state.last_client_activity) >= self.lease
        })
    }

    /// Returns the last client activity when no consumer is polling and the
    /// client has been silent for at least `minimum_idle`.
    pub(super) fn abandoned_since(&self, now: Instant, minimum_idle: Duration) -> Option<Instant> {
        if self.polling.load(Ordering::Acquire) {
            return None;
        }
        let state = self.state.lock().ok()?;
        (!state.closed && now.saturating_duration_since(state.last_client_activity) >= minimum_idle)
            .then_some(state.last_client_activity)
    }

    pub(crate) fn touch(&self, now: Instant) -> Result<(), ViewSetError> {
        let mut state = self.state()?;
        if state.closed {
            return Err(ViewSetError::Closed);
        }
        state.last_client_activity = now;
        Ok(())
    }

    pub(crate) fn close(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.closed = true;
            state.pending.clear();
            state.pending_bytes = 0;
            state.speed_histories.clear();
            state.in_flight = None;
        }
        self.notify.notify_waiters();
    }

    pub(crate) fn replace_views(
        &self,
        views: BTreeMap<String, ViewSpec>,
        updates: Vec<ViewSetUpdate>,
        revision: u64,
        now: Instant,
    ) -> Result<(), ViewSetError> {
        let mut state = self.state()?;
        if state.closed {
            return Err(ViewSetError::Closed);
        }
        state
            .last_delivered
            .retain(|view_id, _| views.contains_key(view_id));
        state.speed_histories.retain(|view_id, _| {
            matches!(
                views.get(view_id),
                Some(ViewSpec::SessionSpeedHistory { .. })
            )
        });
        state.views = views;
        state.durable_revision = revision;
        state.last_client_activity = now;
        for update in updates {
            record_speed_snapshot(&mut state, &update)?;
            enqueue_update(&mut state, update, now)?;
        }
        drop(state);
        self.notify.notify_waiters();
        Ok(())
    }

    pub(crate) fn enqueue_patch(
        &self,
        view_id: &str,
        patch: ViewPatch,
        revision: u64,
    ) -> Result<(), ViewSetError> {
        let mut state = self.state()?;
        if state.closed || state.reset_pending.is_some() {
            return Ok(());
        }
        state.durable_revision = revision;
        let now = Instant::now();
        let ready_at = state
            .views
            .get(view_id)
            .and_then(|spec| {
                state.last_delivered.get(view_id).map(|last| {
                    *last + Duration::from_millis(u64::from(spec.delivery().min_interval_millis))
                })
            })
            .unwrap_or(now)
            .max(now);
        enqueue_update(
            &mut state,
            ViewSetUpdate::Patch {
                view_id: view_id.to_owned(),
                patch,
            },
            ready_at,
        )?;
        drop(state);
        self.notify.notify_waiters();
        Ok(())
    }

    pub(crate) fn enqueue_speed_history(
        &self,
        view_id: &str,
        history: crate::SpeedHistoryView,
        revision: u64,
    ) -> Result<(), ViewSetError> {
        let mut state = self.state()?;
        if state.closed || state.reset_pending.is_some() {
            return Ok(());
        }
        state.durable_revision = revision;
        let now = Instant::now();
        let ready_at = state
            .views
            .get(view_id)
            .and_then(|spec| {
                state.last_delivered.get(view_id).map(|last| {
                    *last + Duration::from_millis(u64::from(spec.delivery().min_interval_millis))
                })
            })
            .unwrap_or(now)
            .max(now);
        let append = match state.speed_histories.get_mut(view_id) {
            Some(position) => match position.append_to(&history) {
                Ok(append) => append,
                Err(_) => {
                    state.speed_histories.insert(
                        view_id.to_owned(),
                        SpeedHistoryPosition::from_view(&history)
                            .map_err(|error| ViewSetError::Internal(error.to_string()))?,
                    );
                    enqueue_update(
                        &mut state,
                        ViewSetUpdate::Snapshot {
                            view_id: view_id.to_owned(),
                            snapshot: ViewSnapshot::SessionSpeedHistory { history },
                        },
                        now,
                    )?;
                    drop(state);
                    self.notify.notify_waiters();
                    return Ok(());
                }
            },
            None => {
                state.speed_histories.insert(
                    view_id.to_owned(),
                    SpeedHistoryPosition::from_view(&history)
                        .map_err(|error| ViewSetError::Internal(error.to_string()))?,
                );
                enqueue_update(
                    &mut state,
                    ViewSetUpdate::Snapshot {
                        view_id: view_id.to_owned(),
                        snapshot: ViewSnapshot::SessionSpeedHistory { history },
                    },
                    now,
                )?;
                drop(state);
                self.notify.notify_waiters();
                return Ok(());
            }
        };
        if let Some(append) = append {
            enqueue_update(
                &mut state,
                ViewSetUpdate::Patch {
                    view_id: view_id.to_owned(),
                    patch: ViewPatch::SessionSpeedHistory { append },
                },
                ready_at,
            )?;
        }
        drop(state);
        self.notify.notify_waiters();
        Ok(())
    }

    pub(crate) fn enqueue_snapshot(
        &self,
        view_id: &str,
        snapshot: ViewSnapshot,
        revision: u64,
    ) -> Result<(), ViewSetError> {
        let mut state = self.state()?;
        if state.closed || state.reset_pending.is_some() {
            return Ok(());
        }
        state.durable_revision = revision;
        record_speed_snapshot(
            &mut state,
            &ViewSetUpdate::Snapshot {
                view_id: view_id.to_owned(),
                snapshot: snapshot.clone(),
            },
        )?;
        enqueue_update(
            &mut state,
            ViewSetUpdate::Snapshot {
                view_id: view_id.to_owned(),
                snapshot,
            },
            Instant::now(),
        )?;
        drop(state);
        self.notify.notify_waiters();
        Ok(())
    }

    fn install_initial(
        &self,
        snapshots: Vec<ViewSetUpdate>,
        now: Instant,
    ) -> Result<(), ViewSetError> {
        let mut state = self.state()?;
        for snapshot in &snapshots {
            record_speed_snapshot(&mut state, snapshot)?;
        }
        for snapshot in &snapshots {
            if let Some(view_id) = snapshot.view_id() {
                state.last_delivered.insert(view_id.to_owned(), now);
            }
        }
        let batch = make_batch(
            &self.id,
            &mut state,
            0,
            snapshots,
            now.saturating_duration_since(self.clock_origin),
        )?;
        let encoded_bytes = encoded_batch_len(&batch)?;
        if encoded_bytes > MAX_VIEW_SET_SNAPSHOT_BYTES as usize {
            return Err(ViewSetError::SnapshotExceedsQueue {
                snapshot: encoded_bytes,
                maximum: MAX_VIEW_SET_SNAPSHOT_BYTES,
            });
        }
        state.queue_high_water = encoded_bytes;
        state.in_flight = Some(StoredBatch {
            batch,
            encoded_bytes,
        });
        Ok(())
    }

    pub(super) fn poll_state(&self, after: u64, now: Instant) -> Result<PollState, ViewSetError> {
        let mut state = self.state()?;
        if state.closed {
            return Ok(PollState::Closed);
        }
        if let Some(in_flight) = &state.in_flight {
            let base = parse_decimal(&in_flight.batch.base_cursor)?;
            let cursor = parse_decimal(&in_flight.batch.cursor)?;
            if after == base {
                let mut batch = in_flight.batch.clone();
                batch.server_now_millis = now
                    .saturating_duration_since(self.clock_origin)
                    .as_millis()
                    .to_string();
                return Ok(PollState::Ready(batch));
            }
            if after == cursor {
                state.acknowledged_cursor = cursor;
                state.in_flight = None;
            } else {
                return Ok(PollState::Reset(ResetReason::CursorMismatch));
            }
        } else if after != state.acknowledged_cursor {
            return Ok(PollState::Reset(ResetReason::CursorMismatch));
        }
        if let Some(reason) = state.reset_pending {
            return Ok(PollState::Reset(reason));
        }
        if state.pending.is_empty() {
            return Ok(PollState::Wait(None));
        }
        let mut updates = Vec::new();
        let mut retained = VecDeque::with_capacity(state.pending.len());
        let mut next_ready = None::<Instant>;
        while let Some(queued) = state.pending.pop_front() {
            if queued.ready_at <= now {
                state.pending_bytes = state.pending_bytes.saturating_sub(queued.encoded_bytes);
                updates.push(queued.update);
            } else {
                next_ready =
                    Some(next_ready.map_or(queued.ready_at, |ready| ready.min(queued.ready_at)));
                retained.push_back(queued);
            }
        }
        state.pending = retained;
        if updates.is_empty() {
            return Ok(PollState::Wait(next_ready));
        }
        for update in &updates {
            if let Some(view_id) = update.view_id() {
                state.last_delivered.insert(view_id.to_owned(), now);
            }
        }
        let base = state.acknowledged_cursor;
        let batch = make_batch(
            &self.id,
            &mut state,
            base,
            updates,
            now.saturating_duration_since(self.clock_origin),
        )?;
        let encoded_bytes = encoded_batch_len(&batch)?;
        let batch_limit = if batch_has_snapshot(&batch) {
            MAX_VIEW_SET_SNAPSHOT_BYTES
        } else {
            state.queue_bytes_limit
        };
        if encoded_bytes > batch_limit as usize {
            state.reset_pending = Some(ResetReason::QueueOverflow);
            return Ok(PollState::Reset(ResetReason::QueueOverflow));
        }
        state.queue_high_water = state.queue_high_water.max(encoded_bytes);
        state.in_flight = Some(StoredBatch {
            batch: batch.clone(),
            encoded_bytes,
        });
        Ok(PollState::Ready(batch))
    }

    pub(super) fn empty_batch(
        &self,
        after: u64,
        now: Instant,
    ) -> Result<UpdateBatch, ViewSetError> {
        let state = self.state()?;
        if state.closed {
            return Err(ViewSetError::Closed);
        }
        Ok(UpdateBatch {
            server_now_millis: now
                .saturating_duration_since(self.clock_origin)
                .as_millis()
                .to_string(),
            api_version: API_VERSION,
            view_set_id: self.id.clone(),
            epoch: state.epoch.to_string(),
            base_cursor: after.to_string(),
            cursor: after.to_string(),
            durable_revision: state.durable_revision.to_string(),
            updates: Vec::new(),
        })
    }

    pub(super) fn reset_with_snapshots(
        &self,
        reason: ResetReason,
        revision: u64,
        mut snapshots: Vec<ViewSetUpdate>,
        now: Instant,
    ) -> Result<UpdateBatch, ViewSetError> {
        let mut state = self.state()?;
        if state.closed {
            return Err(ViewSetError::Closed);
        }
        state.epoch = next_epoch();
        let base_cursor = state.acknowledged_cursor;
        state.durable_revision = revision;
        state.pending.clear();
        state.pending_bytes = 0;
        state.last_delivered.clear();
        state.speed_histories.clear();
        state.in_flight = None;
        state.reset_pending = None;
        state.reset_count = state.reset_count.saturating_add(1);
        let mut updates = vec![ViewSetUpdate::ResetRequired {
            view_id: None,
            reason,
        }];
        updates.append(&mut snapshots);
        for update in &updates {
            record_speed_snapshot(&mut state, update)?;
        }
        for update in &updates {
            if let Some(view_id) = update.view_id() {
                state.last_delivered.insert(view_id.to_owned(), now);
            }
        }
        let batch = make_batch(
            &self.id,
            &mut state,
            base_cursor,
            updates,
            now.saturating_duration_since(self.clock_origin),
        )?;
        let encoded_bytes = encoded_batch_len(&batch)?;
        if encoded_bytes > MAX_VIEW_SET_SNAPSHOT_BYTES as usize {
            return Err(ViewSetError::SnapshotExceedsQueue {
                snapshot: encoded_bytes,
                maximum: MAX_VIEW_SET_SNAPSHOT_BYTES,
            });
        }
        state.queue_high_water = state.queue_high_water.max(encoded_bytes);
        state.in_flight = Some(StoredBatch {
            batch: batch.clone(),
            encoded_bytes,
        });
        Ok(batch)
    }

    pub(super) fn stats(&self) -> Result<ViewSetStats, ViewSetError> {
        let state = self.state()?;
        let in_flight = state
            .in_flight
            .as_ref()
            .map_or(0, |batch| batch.encoded_bytes);
        Ok(ViewSetStats {
            queued_bytes: state.pending_bytes.saturating_add(in_flight),
            queue_high_water: state.queue_high_water,
            reset_count: state.reset_count,
        })
    }

    fn state(&self) -> Result<std::sync::MutexGuard<'_, ViewSetState>, ViewSetError> {
        self.state
            .lock()
            .map_err(|_| ViewSetError::Internal("view-set lock is poisoned".to_owned()))
    }

    pub(super) fn start_poll(&self) -> Result<ActivePoll<'_>, ViewSetError> {
        self.polling
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| ViewSetError::ConsumerBusy)?;
        Ok(ActivePoll { inner: self })
    }
}

pub(super) struct ActivePoll<'a> {
    inner: &'a ViewSetInner,
}

impl Drop for ActivePoll<'_> {
    fn drop(&mut self) {
        self.inner.polling.store(false, Ordering::Release);
    }
}

fn validate_specs(views: &[ViewSpec]) -> Result<BTreeMap<String, ViewSpec>, ViewSetError> {
    if views.is_empty() || views.len() > MAX_VIEWS_PER_SET {
        return Err(ViewSetError::InvalidViewCount {
            maximum: MAX_VIEWS_PER_SET,
        });
    }
    let mut output = BTreeMap::new();
    for view in views {
        let id = view.view_id();
        if id.is_empty()
            || id.len() > MAX_VIEW_ID_BYTES
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(ViewSetError::InvalidViewId);
        }
        if view.delivery().min_interval_millis > MAX_VIEW_DELIVERY_INTERVAL_MILLIS {
            return Err(ViewSetError::InvalidDeliveryInterval {
                maximum: MAX_VIEW_DELIVERY_INTERVAL_MILLIS,
            });
        }
        if let ViewSpec::SessionCurrentRates { metrics, .. } = view {
            let unique = metrics
                .iter()
                .copied()
                .collect::<std::collections::BTreeSet<_>>();
            if metrics.is_empty()
                || metrics.len() > SpeedMetric::AVAILABLE.len()
                || unique.len() != metrics.len()
                || metrics
                    .iter()
                    .any(|metric| !SpeedMetric::AVAILABLE.contains(metric))
            {
                return Err(ViewSetError::InvalidView(format!(
                    "session current rates require 1..={} distinct available metrics",
                    SpeedMetric::AVAILABLE.len()
                )));
            }
        }
        if let ViewSpec::SessionSpeedHistory { metrics, .. } = view {
            let unique = metrics
                .iter()
                .copied()
                .collect::<std::collections::BTreeSet<_>>();
            if metrics.is_empty()
                || metrics.len() > MAX_SPEED_SERIES
                || unique.len() != metrics.len()
                || metrics
                    .iter()
                    .any(|metric| !SpeedMetric::AVAILABLE.contains(metric))
            {
                return Err(ViewSetError::InvalidView(format!(
                    "session speed history requires 1..={MAX_SPEED_SERIES} distinct available metrics"
                )));
            }
        }
        let spec = view.subscription_spec(DEFAULT_VIEW_SET_QUEUE_BYTES);
        super::validate_spec(&spec)
            .map_err(|error| ViewSetError::InvalidView(error.to_string()))?;
        if output.insert(id.to_owned(), view.clone()).is_some() {
            return Err(ViewSetError::DuplicateViewId(id.to_owned()));
        }
    }
    Ok(output)
}

pub(crate) fn validated_open(
    request: &OpenViewSetRequest,
) -> Result<(BTreeMap<String, ViewSpec>, u32), ViewSetError> {
    let views = validate_specs(&request.views)?;
    let queue_bytes = request
        .options
        .requested_queue_bytes
        .unwrap_or(DEFAULT_VIEW_SET_QUEUE_BYTES);
    if !(MIN_VIEW_SET_QUEUE_BYTES..=MAX_VIEW_SET_QUEUE_BYTES).contains(&queue_bytes) {
        return Err(ViewSetError::InvalidQueueBound {
            minimum: MIN_VIEW_SET_QUEUE_BYTES,
            maximum: MAX_VIEW_SET_QUEUE_BYTES,
        });
    }
    Ok((views, queue_bytes))
}

pub(crate) fn validated_update(
    request: &UpdateViewSetRequest,
) -> Result<BTreeMap<String, ViewSpec>, ViewSetError> {
    validate_specs(&request.views)
}

pub(crate) fn generate_view_set_id() -> Result<String, ViewSetError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| ViewSetError::Internal(error.to_string()))?;
    let mut output = String::with_capacity(35);
    output.push_str("vs_");
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut output, "{byte:02x}")
            .map_err(|error| ViewSetError::Internal(error.to_string()))?;
    }
    Ok(output)
}

fn record_speed_snapshot(
    state: &mut ViewSetState,
    update: &ViewSetUpdate,
) -> Result<(), ViewSetError> {
    match update {
        ViewSetUpdate::Snapshot {
            view_id,
            snapshot: ViewSnapshot::SessionSpeedHistory { history },
        } => {
            state.speed_histories.insert(
                view_id.clone(),
                SpeedHistoryPosition::from_view(history)
                    .map_err(|error| ViewSetError::Internal(error.to_string()))?,
            );
        }
        ViewSetUpdate::Snapshot { view_id, .. } | ViewSetUpdate::ViewRemoved { view_id } => {
            state.speed_histories.remove(view_id);
        }
        ViewSetUpdate::Patch { .. } | ViewSetUpdate::ResetRequired { .. } => {}
    }
    Ok(())
}

fn enqueue_update(
    state: &mut ViewSetState,
    update: ViewSetUpdate,
    ready_at: Instant,
) -> Result<(), ViewSetError> {
    if matches!(
        update,
        ViewSetUpdate::Snapshot { .. } | ViewSetUpdate::ViewRemoved { .. }
    ) && let Some(view_id) = update.view_id()
    {
        let mut kept = VecDeque::with_capacity(state.pending.len());
        while let Some(queued) = state.pending.pop_front() {
            if queued.update.view_id() == Some(view_id) {
                state.pending_bytes = state.pending_bytes.saturating_sub(queued.encoded_bytes);
            } else {
                kept.push_back(queued);
            }
        }
        state.pending = kept;
    }
    if let ViewSetUpdate::Patch {
        view_id: next_id,
        patch: next_patch,
    } = &update
        && coalesce_pending_patch(state, next_id, next_patch, ready_at)?
    {
        return enforce_bound(state);
    }
    let encoded_bytes = encoded_update_len(&update)?;
    state.pending_bytes = state.pending_bytes.saturating_add(encoded_bytes);
    state.pending.push_back(QueuedViewSetUpdate {
        update,
        encoded_bytes,
        ready_at,
    });
    enforce_bound(state)
}

fn coalesce_pending_patch(
    state: &mut ViewSetState,
    next_id: &str,
    next_patch: &ViewPatch,
    ready_at: Instant,
) -> Result<bool, ViewSetError> {
    let Some(position) = state
        .pending
        .iter()
        .rposition(|queued| queued.update.view_id() == Some(next_id))
    else {
        return Ok(false);
    };
    let queued = state
        .pending
        .get_mut(position)
        .expect("position came from the same pending queue");
    let ViewSetUpdate::Patch { patch, .. } = &mut queued.update else {
        return Ok(false);
    };
    if !coalesce_patch(patch, next_patch) {
        return Ok(false);
    }

    let previous = queued.encoded_bytes;
    queued.encoded_bytes = encoded_update_len(&queued.update)?;
    queued.ready_at = queued.ready_at.max(ready_at);
    state.pending_bytes = state.pending_bytes - previous + queued.encoded_bytes;
    Ok(true)
}

fn enforce_bound(state: &mut ViewSetState) -> Result<(), ViewSetError> {
    let in_flight = state.in_flight.as_ref().map_or(0, |batch| {
        if batch_has_snapshot(&batch.batch) {
            0
        } else {
            batch.encoded_bytes
        }
    });
    let used = in_flight.saturating_add(state.pending_bytes);
    state.queue_high_water = state.queue_high_water.max(used);
    let pending_snapshot = state
        .pending
        .iter()
        .any(|queued| matches!(queued.update, ViewSetUpdate::Snapshot { .. }));
    let limit = if pending_snapshot {
        MAX_VIEW_SET_SNAPSHOT_BYTES
    } else {
        state.queue_bytes_limit
    };
    if used <= limit as usize {
        return Ok(());
    }
    state.pending.clear();
    state.pending_bytes = 0;
    state.reset_pending = Some(ResetReason::QueueOverflow);
    Ok(())
}

fn batch_has_snapshot(batch: &UpdateBatch) -> bool {
    batch
        .updates
        .iter()
        .any(|update| matches!(update, ViewSetUpdate::Snapshot { .. }))
}

fn make_batch(
    id: &str,
    state: &mut ViewSetState,
    base_cursor: u64,
    updates: Vec<ViewSetUpdate>,
    server_now: Duration,
) -> Result<UpdateBatch, ViewSetError> {
    let cursor = state.next_cursor;
    state.next_cursor = state
        .next_cursor
        .checked_add(1)
        .ok_or_else(|| ViewSetError::Internal("view-set cursor overflow".to_owned()))?;
    Ok(UpdateBatch {
        server_now_millis: server_now.as_millis().to_string(),
        api_version: API_VERSION,
        view_set_id: id.to_owned(),
        epoch: state.epoch.to_string(),
        base_cursor: base_cursor.to_string(),
        cursor: cursor.to_string(),
        durable_revision: state.durable_revision.to_string(),
        updates,
    })
}

fn encoded_update_len(update: &ViewSetUpdate) -> Result<usize, ViewSetError> {
    serde_json::to_vec(update)
        .map(|bytes| bytes.len())
        .map_err(|error| ViewSetError::Internal(error.to_string()))
}

fn encoded_batch_len(batch: &UpdateBatch) -> Result<usize, ViewSetError> {
    // Replays refresh the clock without changing the retained payload. Reserve
    // its full decimal width so a later replay stays within the queue budget.
    serde_json::to_vec(batch)
        .map(|bytes| bytes.len() + 20_usize.saturating_sub(batch.server_now_millis.len()))
        .map_err(|error| ViewSetError::Internal(error.to_string()))
}

pub(super) fn parse_decimal(value: &str) -> Result<u64, ViewSetError> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(ViewSetError::InvalidView(
            "cursor is not canonical decimal".to_owned(),
        ));
    }
    value
        .parse()
        .map_err(|_| ViewSetError::InvalidView("cursor is out of range".to_owned()))
}

fn next_epoch() -> u64 {
    NEXT_VIEW_SET_EPOCH.fetch_add(1, Ordering::Relaxed)
}

#[cfg(test)]
#[path = "tests/view_set.rs"]
mod tests;
