//! Library media delivery owned by the view hub.
//!
//! The hub keeps one shared index and the last result of each live
//! `(query, page)`. After every publish that can change a Library result, each
//! live memo entry equals evaluation against the current state, so a new
//! consumer's snapshot and a long-lived consumer's patched page agree. A
//! changed page shape is delivered as a snapshot, changed progress alone as a
//! row upsert.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Weak};

use crate::file_views::FileViewChange;
use crate::library_views::{LibraryIndex, LibraryMediaQuery, LibraryResult, LibraryTorrentInput};

use super::super::subscription::SubscriberInner;
use super::super::view_set::ViewSetInner;
use super::super::{
    CatalogPageRequest, DEFAULT_VIEW_SET_QUEUE_BYTES, SubscriptionError, SubscriptionSpec,
    TorrentModel, ViewPatch, ViewProjection, ViewSelector, ViewSnapshot,
};
use super::HubState;

#[derive(Debug, Default)]
pub(crate) struct LibraryState {
    index: Arc<LibraryIndex>,
    memo: BTreeMap<LibraryKey, Memo>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct LibraryKey {
    query: LibraryMediaQuery,
    offset: u32,
    limit: u32,
}

#[derive(Debug)]
struct Memo {
    result: LibraryResult,
    positions: HashMap<String, usize>,
}

impl Memo {
    fn new(result: LibraryResult) -> Self {
        let positions = result
            .items
            .iter()
            .enumerate()
            .map(|(position, item)| (item.item_id.clone(), position))
            .collect();
        Self { result, positions }
    }
}

/// What changed in the hub since the previous Library publish.
pub(super) enum LibraryChange<'a> {
    /// Torrents, catalogs, names, archive flags or verified pieces.
    Durable,
    /// Rows of one torrent's files, as reported by its progress model.
    Progress {
        torrent_id: &'a str,
        changes: &'a [FileViewChange],
    },
}

enum Target {
    Subscriber(Arc<SubscriberInner>),
    ViewSet(Arc<ViewSetInner>, String),
}

enum Delivery {
    Snapshot(ViewSnapshot),
    Patch(ViewPatch),
}

impl LibraryKey {
    fn from_spec(spec: &SubscriptionSpec) -> Option<Self> {
        let (ViewSelector::Library { query }, ViewProjection::LibraryMedia) =
            (&spec.selector, spec.projection)
        else {
            return None;
        };
        let page = spec.catalog_page?;
        Some(Self {
            query: query.clone(),
            offset: page.offset,
            limit: page.limit,
        })
    }

    fn page(&self) -> CatalogPageRequest {
        CatalogPageRequest {
            offset: self.offset,
            limit: self.limit,
        }
    }
}

impl LibraryState {
    pub(super) fn snapshot(
        &self,
        query: &LibraryMediaQuery,
        page: CatalogPageRequest,
        torrents: &BTreeMap<String, TorrentModel>,
    ) -> ViewSnapshot {
        snapshot(evaluate(&self.index, query, page, torrents))
    }
}

/// Whether anything a Library result depends on differs between two hub
/// states, besides catalogs and names, which the index compares itself.
pub(super) fn library_progress_changed(
    previous: &BTreeMap<String, TorrentModel>,
    current: &BTreeMap<String, TorrentModel>,
) -> bool {
    previous.len() != current.len()
        || current.iter().any(|(torrent_id, model)| {
            previous.get(torrent_id).is_none_or(|old| {
                old.verified != model.verified || old.files.is_some() != model.files.is_some()
            })
        })
}

fn torrent_name<'a>(torrent_id: &'a str, model: &'a TorrentModel) -> std::borrow::Cow<'a, str> {
    match model
        .view
        .display_name
        .as_deref()
        .or(model.view.source_display_name.as_deref())
    {
        Some(name) => std::borrow::Cow::Borrowed(name),
        None => std::borrow::Cow::Owned(format!(
            "Torrent {}",
            torrent_id.get(..12).unwrap_or(torrent_id)
        )),
    }
}

fn evaluate(
    index: &LibraryIndex,
    query: &LibraryMediaQuery,
    page: CatalogPageRequest,
    torrents: &BTreeMap<String, TorrentModel>,
) -> LibraryResult {
    index.evaluate(query, page, |torrent_id| {
        torrents
            .get(torrent_id)
            .and_then(|model| model.files.as_ref())
    })
}

fn snapshot(result: LibraryResult) -> ViewSnapshot {
    ViewSnapshot::LibraryMedia {
        page: result.page,
        facets: result.facets,
        items: result.items,
        groups: result.groups,
    }
}

impl HubState {
    /// Rebuilds the index for torrents whose catalog, name or archive flag
    /// changed. Returns whether the index changed.
    pub(super) fn sync_library_index(&mut self) -> bool {
        let names = self
            .torrents
            .iter()
            .map(|(torrent_id, model)| torrent_name(torrent_id, model))
            .collect::<Vec<_>>();
        let inputs = self
            .torrents
            .iter()
            .zip(&names)
            .map(|((torrent_id, model), name)| LibraryTorrentInput {
                torrent_id,
                name,
                archived: model.view.archived,
                files: model.files.as_ref(),
            });
        let Some(index) = self.library.index.synced(inputs) else {
            return false;
        };
        self.library.index = Arc::new(index);
        true
    }

    /// Records a snapshot just built for a new consumer so that the next
    /// progress change patches it instead of replacing it. A snapshot is
    /// evaluated against the current state, so it equals any existing entry.
    pub(super) fn remember_library_snapshot(
        &mut self,
        spec: &SubscriptionSpec,
        snapshot: &ViewSnapshot,
    ) {
        let Some(key) = LibraryKey::from_spec(spec) else {
            return;
        };
        let ViewSnapshot::LibraryMedia {
            page,
            facets,
            items,
            groups,
        } = snapshot
        else {
            return;
        };
        self.library.memo.entry(key).or_insert_with(|| {
            Memo::new(LibraryResult {
                page: *page,
                facets: facets.clone(),
                items: items.clone(),
                groups: groups.clone(),
            })
        });
    }

    pub(super) fn publish_library(
        &mut self,
        change: LibraryChange<'_>,
    ) -> Result<(), SubscriptionError> {
        let consumers = self.library_consumers()?;
        if consumers.is_empty() {
            self.library.memo.clear();
            return Ok(());
        }
        let keys = consumers
            .iter()
            .map(|(key, _)| key.clone())
            .collect::<BTreeSet<_>>();
        let deliveries = match change {
            LibraryChange::Durable => self.reevaluate(&keys),
            LibraryChange::Progress {
                torrent_id,
                changes,
            } => {
                let mut changed_items = Vec::new();
                let mut moved = false;
                for change in changes {
                    let file_index = change.current.file_index;
                    let Some(length) = self.library.index.item_length(torrent_id, file_index)
                    else {
                        continue;
                    };
                    let offline = |verified: &str| verified.parse::<u64>().ok() == Some(length);
                    if offline(&change.previous.verified_bytes)
                        != offline(&change.current.verified_bytes)
                    {
                        // Offline membership moves items between filters and
                        // facets; only a fresh evaluation is exact.
                        moved = true;
                        break;
                    }
                    changed_items.push(file_index);
                }
                if moved {
                    self.reevaluate(&keys)
                } else if changed_items.is_empty() {
                    return Ok(());
                } else {
                    self.patch_rows(&keys, torrent_id, &changed_items)
                }
            }
        };
        self.library.memo.retain(|key, _| keys.contains(key));
        self.deliver(consumers, deliveries)
    }

    fn reevaluate(&mut self, keys: &BTreeSet<LibraryKey>) -> BTreeMap<LibraryKey, Delivery> {
        let mut deliveries = BTreeMap::new();
        for key in keys {
            let result = evaluate(&self.library.index, &key.query, key.page(), &self.torrents);
            let delivery = match self.library.memo.get(key) {
                Some(memo) if memo.result.same_shape(&result) => {
                    let upsert = result
                        .items
                        .iter()
                        .zip(&memo.result.items)
                        .filter(|(next, previous)| next != previous)
                        .map(|(next, _)| next.clone())
                        .collect::<Vec<_>>();
                    (!upsert.is_empty())
                        .then_some(Delivery::Patch(ViewPatch::LibraryMedia { upsert }))
                }
                _ => Some(Delivery::Snapshot(snapshot(result.clone()))),
            };
            self.library.memo.insert(key.clone(), Memo::new(result));
            if let Some(delivery) = delivery {
                deliveries.insert(key.clone(), delivery);
            }
        }
        deliveries
    }

    /// Rebuilds only the rows of memoized pages that hold a changed file.
    /// A query without a memo entry gets a fresh snapshot.
    fn patch_rows(
        &mut self,
        keys: &BTreeSet<LibraryKey>,
        torrent_id: &str,
        file_indices: &[u32],
    ) -> BTreeMap<LibraryKey, Delivery> {
        let mut deliveries = BTreeMap::new();
        let Some(files) = self
            .torrents
            .get(torrent_id)
            .and_then(|model| model.files.as_ref())
        else {
            return deliveries;
        };
        for key in keys {
            let Some(memo) = self.library.memo.get_mut(key) else {
                let result = evaluate(&self.library.index, &key.query, key.page(), &self.torrents);
                deliveries.insert(key.clone(), Delivery::Snapshot(snapshot(result.clone())));
                self.library.memo.insert(key.clone(), Memo::new(result));
                continue;
            };
            let mut upsert = Vec::new();
            for &file_index in file_indices {
                let item_id = format!("{torrent_id}:{file_index}");
                let Some(&position) = memo.positions.get(&item_id) else {
                    continue;
                };
                let Some(row) = self.library.index.item(torrent_id, file_index, files) else {
                    continue;
                };
                if memo.result.items[position] != row {
                    memo.result.items[position] = row.clone();
                    upsert.push(row);
                }
            }
            if !upsert.is_empty() {
                deliveries.insert(
                    key.clone(),
                    Delivery::Patch(ViewPatch::LibraryMedia { upsert }),
                );
            }
        }
        deliveries
    }

    fn library_consumers(&mut self) -> Result<Vec<(LibraryKey, Target)>, SubscriptionError> {
        self.subscribers.retain(|_, weak| weak.strong_count() != 0);
        let mut consumers = self
            .subscribers
            .values()
            .filter_map(Weak::upgrade)
            .filter_map(|subscriber| {
                LibraryKey::from_spec(&subscriber.spec)
                    .map(|key| (key, Target::Subscriber(subscriber)))
            })
            .collect::<Vec<_>>();
        self.retain_live_view_sets();
        for view_set in self.view_sets.values() {
            for spec in view_set.view_specs()? {
                if let Some(key) =
                    LibraryKey::from_spec(&spec.subscription_spec(DEFAULT_VIEW_SET_QUEUE_BYTES))
                {
                    consumers.push((
                        key,
                        Target::ViewSet(Arc::clone(view_set), spec.view_id().to_owned()),
                    ));
                }
            }
        }
        Ok(consumers)
    }

    fn deliver(
        &self,
        consumers: Vec<(LibraryKey, Target)>,
        deliveries: BTreeMap<LibraryKey, Delivery>,
    ) -> Result<(), SubscriptionError> {
        let revision = self.revision;
        for (key, target) in consumers {
            let Some(delivery) = deliveries.get(&key) else {
                continue;
            };
            match (target, delivery) {
                (Target::Subscriber(subscriber), Delivery::Snapshot(snapshot)) => {
                    subscriber.enqueue_snapshot(revision, snapshot.clone())?;
                }
                (Target::Subscriber(subscriber), Delivery::Patch(patch)) => {
                    subscriber.enqueue_patch(revision, patch.clone())?;
                }
                (Target::ViewSet(view_set, view_id), Delivery::Snapshot(snapshot)) => {
                    view_set.enqueue_snapshot(&view_id, snapshot.clone(), revision)?;
                }
                (Target::ViewSet(view_set, view_id), Delivery::Patch(patch)) => {
                    view_set.enqueue_patch(&view_id, patch.clone(), revision)?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
impl super::ViewHub {
    pub(crate) fn library_memo_len(&self) -> usize {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .library
            .memo
            .len()
    }
}
