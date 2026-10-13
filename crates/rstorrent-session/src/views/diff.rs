//! Deterministic snapshot-diff and patch-coalescing operations.
//!
//! The hub and delivery accumulators supply immutable values to this module.
//! It owns no shared state, lock, channel, or task.

use std::collections::{BTreeMap, BTreeSet};

use crate::diagnostics::{
    MAX_DIAGNOSTIC_PATCH_BYTES, MAX_DIAGNOSTIC_PATCH_EVENTS, patch_encoded_len,
};
use crate::file_views::FileViewChange;
use crate::media_catalog_views::MediaItemView;
use crate::settings::{ClientSettingsRuntimeView, StorageSettingsSnapshot};
use crate::tracker_views::{TrackerView, TrackerViewModel};

use super::ranges::{difference, insert_interval, remove_interval};
use super::{
    ActivePiece, ActivePieceUpdate, DiskSessionView, FileRowUpdate, IndexRange, PeerRowUpdate,
    PeerView, SubscriptionSpec, SwarmModel, TorrentModel, TorrentRowUpdate, TorrentView,
    TorrentViewChange, ViewPatch, ViewProjection, ViewSelector, ViewUpdate, ViewUpdatePayload,
};

pub(super) fn patch_for(
    spec: &SubscriptionSpec,
    previous: &BTreeMap<String, TorrentModel>,
    current: &BTreeMap<String, TorrentModel>,
    previous_storage: Option<&StorageSettingsSnapshot>,
    current_storage: &StorageSettingsSnapshot,
    previous_client_settings: Option<&ClientSettingsRuntimeView>,
    current_client_settings: &ClientSettingsRuntimeView,
) -> Option<ViewPatch> {
    match (&spec.selector, spec.projection) {
        (ViewSelector::TorrentList, ViewProjection::Summary) => {
            let mut upsert = Vec::new();
            let mut updates = Vec::new();
            for (id, model) in current {
                match previous.get(id) {
                    None => upsert.push(model.view.clone()),
                    Some(old) => {
                        if let Some(update) = TorrentRowUpdate::between(&old.view, &model.view) {
                            updates.push(update);
                        }
                    }
                }
            }
            let removed = previous
                .keys()
                .filter(|id| !current.contains_key(*id))
                .cloned()
                .collect::<Vec<_>>();
            let storage =
                (previous_storage != Some(current_storage)).then(|| current_storage.clone());
            let client_settings = (previous_client_settings != Some(current_client_settings))
                .then(|| current_client_settings.clone());
            (!upsert.is_empty()
                || !updates.is_empty()
                || !removed.is_empty()
                || storage.is_some()
                || client_settings.is_some())
            .then_some(ViewPatch::TorrentList {
                upsert,
                updates,
                removed,
                storage,
                client_settings,
            })
        }
        (ViewSelector::Torrent { torrent_id }, ViewProjection::Summary) => {
            let old = previous.get(torrent_id).map(|model| &model.view);
            let next = current.get(torrent_id).map(|model| &model.view);
            selected_torrent_patch(old, next)
        }
        (ViewSelector::Torrent { torrent_id }, ViewProjection::Preparation) => {
            let old = previous
                .get(torrent_id)
                .and_then(|model| model.preparation.as_ref());
            let next = current
                .get(torrent_id)
                .and_then(|model| model.preparation.as_ref());
            (old != next).then(|| ViewPatch::TorrentPreparation {
                torrent_id: torrent_id.clone(),
                preparation: next.cloned(),
            })
        }
        (ViewSelector::Torrent { torrent_id }, ViewProjection::PieceActivity) => {
            let old = previous.get(torrent_id);
            let next = current.get(torrent_id);
            if old == next {
                return None;
            }
            let old_verified = old.map_or(&[][..], |model| model.verified.as_slice());
            let next_verified = next.map_or(&[][..], |model| model.verified.as_slice());
            let verified = difference(next_verified, old_verified);
            let cleared = difference(old_verified, next_verified);
            let empty = BTreeMap::new();
            let old_active = old.map_or(&empty, |model| &model.active);
            let next_active = next.map_or(&empty, |model| &model.active);
            let (active_upsert, active_updates, active_removed) =
                active_piece_patch(old_active, next_active);
            Some(ViewPatch::PieceActivity {
                torrent_id: torrent_id.clone(),
                piece_count: next.map_or(0, |model| model.view.piece_count),
                verified,
                cleared,
                active_upsert,
                active_updates,
                active_removed,
            })
        }
        (ViewSelector::Torrent { torrent_id }, ViewProjection::Peers) => {
            let empty = BTreeMap::new();
            let old = previous
                .get(torrent_id)
                .map_or(&empty, |model| &model.peers);
            let next = current.get(torrent_id).map_or(&empty, |model| &model.peers);
            peer_collection_patch(torrent_id, old, next)
        }
        (ViewSelector::Torrent { torrent_id }, ViewProjection::Swarm) => {
            match (previous.get(torrent_id), current.get(torrent_id)) {
                (Some(old), Some(next)) => {
                    swarm_collection_patch(torrent_id, &old.swarm, &next.swarm)
                }
                _ => None,
            }
        }
        (ViewSelector::Torrent { torrent_id }, ViewProjection::Files) => {
            let old = previous
                .get(torrent_id)
                .and_then(|model| model.files.as_ref());
            let next = current
                .get(torrent_id)
                .and_then(|model| model.files.as_ref());
            match (old, next) {
                (Some(old), Some(next)) if old.patchable_catalog_matches(next) => {
                    let page = spec
                        .catalog_page
                        .expect("validated file projection has a catalog page");
                    let updates = page
                        .bounds(next.count())
                        .filter_map(|index| {
                            FileRowUpdate::between(&old.row(index), &next.row(index))
                        })
                        .collect::<Vec<_>>();
                    (!updates.is_empty()).then(|| ViewPatch::Files {
                        torrent_id: torrent_id.clone(),
                        upsert: Vec::new(),
                        updates,
                        removed: Vec::new(),
                    })
                }
                _ => None,
            }
        }
        (ViewSelector::Torrent { torrent_id }, ViewProjection::Media) => {
            let old = previous
                .get(torrent_id)
                .and_then(|model| model.files.as_ref());
            let next = current
                .get(torrent_id)
                .and_then(|model| model.files.as_ref());
            match (old, next) {
                (Some(old), Some(next)) if old.patchable_catalog_matches(next) => {
                    let old = old
                        .media_rows()
                        .into_iter()
                        .map(|item| (item.media_id.clone(), item))
                        .collect::<BTreeMap<_, _>>();
                    let next = next
                        .media_rows()
                        .into_iter()
                        .map(|item| (item.media_id.clone(), item))
                        .collect::<BTreeMap<_, _>>();
                    let upsert = next
                        .iter()
                        .filter(|(id, item)| old.get(*id) != Some(*item))
                        .map(|(_, item)| item.clone())
                        .collect::<Vec<_>>();
                    let removed = old
                        .keys()
                        .filter(|id| !next.contains_key(*id))
                        .cloned()
                        .collect::<Vec<_>>();
                    (!upsert.is_empty() || !removed.is_empty()).then(|| ViewPatch::Media {
                        torrent_id: torrent_id.clone(),
                        upsert,
                        removed,
                    })
                }
                _ => None,
            }
        }
        (ViewSelector::Torrent { torrent_id }, ViewProjection::Trackers) => {
            let page = spec
                .catalog_page
                .expect("validated tracker projection has a catalog page");
            let old = previous
                .get(torrent_id)
                .map_or_else(BTreeMap::new, |model| {
                    model
                        .trackers
                        .row_map_page(page.bounds(model.trackers.count_usize()))
                });
            let next = current.get(torrent_id).map_or_else(BTreeMap::new, |model| {
                model
                    .trackers
                    .row_map_page(page.bounds(model.trackers.count_usize()))
            });
            tracker_collection_patch(torrent_id, &old, &next)
        }
        (
            ViewSelector::TorrentList,
            ViewProjection::PieceActivity
            | ViewProjection::Preparation
            | ViewProjection::Peers
            | ViewProjection::Swarm
            | ViewProjection::Files
            | ViewProjection::Media
            | ViewProjection::Trackers,
        ) => None,
        (
            _,
            ViewProjection::Disk
            | ViewProjection::Dht
            | ViewProjection::CurrentRates
            | ViewProjection::SpeedHistory
            | ViewProjection::Diagnostics,
        ) => None,
        (ViewSelector::SessionDht, _) => None,
        (ViewSelector::SessionCurrentRates { .. }, _) => None,
        (ViewSelector::SessionSpeedHistory { .. }, _) => None,
    }
}

pub(super) fn projection_requires_snapshot(
    spec: &SubscriptionSpec,
    previous: &BTreeMap<String, TorrentModel>,
    current: &BTreeMap<String, TorrentModel>,
) -> bool {
    if let (ViewSelector::Torrent { torrent_id }, ViewProjection::PieceActivity) =
        (&spec.selector, spec.projection)
    {
        // Clear ranges refer to the previous geometry. A replacement snapshot
        // also discards any queued patches before a torrent disappears or its
        // metadata changes the number of pieces.
        return previous.get(torrent_id).map(|model| model.view.piece_count)
            != current.get(torrent_id).map(|model| model.view.piece_count);
    }
    if let (ViewSelector::Torrent { torrent_id }, ViewProjection::Swarm) =
        (&spec.selector, spec.projection)
    {
        return previous.contains_key(torrent_id) != current.contains_key(torrent_id);
    }
    if let (ViewSelector::Torrent { torrent_id }, ViewProjection::Trackers) =
        (&spec.selector, spec.projection)
    {
        return previous.contains_key(torrent_id) != current.contains_key(torrent_id);
    }
    let ViewSelector::Torrent { torrent_id } = &spec.selector else {
        return false;
    };
    if !matches!(
        spec.projection,
        ViewProjection::Files | ViewProjection::Media
    ) {
        return false;
    }
    match (previous.get(torrent_id), current.get(torrent_id)) {
        (None, None) => false,
        (Some(old), Some(next)) => match (&old.files, &next.files) {
            (None, None) => false,
            (Some(old), Some(next)) => !old.patchable_catalog_matches(next),
            _ => true,
        },
        _ => true,
    }
}

fn torrent_list_row_patch(previous: &TorrentView, current: &TorrentView) -> Option<ViewPatch> {
    TorrentRowUpdate::between(previous, current).map(|update| ViewPatch::TorrentList {
        upsert: Vec::new(),
        updates: vec![update],
        removed: Vec::new(),
        storage: None,
        client_settings: None,
    })
}

fn selected_torrent_patch(
    previous: Option<&TorrentView>,
    current: Option<&TorrentView>,
) -> Option<ViewPatch> {
    match (previous, current) {
        (Some(previous), Some(current)) => {
            TorrentRowUpdate::between(previous, current).map(|update| ViewPatch::Torrent {
                change: TorrentViewChange::Update { update },
            })
        }
        _ if previous != current => Some(ViewPatch::Torrent {
            change: TorrentViewChange::Replace {
                torrent: current.cloned(),
            },
        }),
        _ => None,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn targeted_activity_patch(
    spec: &SubscriptionSpec,
    torrent_id: &str,
    previous_view: &TorrentView,
    next_view: &TorrentView,
    previous_verified: &[IndexRange],
    next_verified: &[IndexRange],
    previous_active: &BTreeMap<u32, ActivePiece>,
    next_active: &BTreeMap<u32, ActivePiece>,
    file_changes: &[FileViewChange],
    media_upsert: &[MediaItemView],
) -> Option<ViewPatch> {
    match (&spec.selector, spec.projection) {
        (ViewSelector::TorrentList, ViewProjection::Summary) => {
            torrent_list_row_patch(previous_view, next_view)
        }
        (
            ViewSelector::Torrent {
                torrent_id: selected,
            },
            ViewProjection::Summary,
        ) if selected == torrent_id => selected_torrent_patch(Some(previous_view), Some(next_view)),
        (
            ViewSelector::Torrent {
                torrent_id: selected,
            },
            ViewProjection::PieceActivity,
        ) if selected == torrent_id => {
            let verified = difference(next_verified, previous_verified);
            let cleared = difference(previous_verified, next_verified);
            let (active_upsert, active_updates, active_removed) =
                active_piece_patch(previous_active, next_active);
            (!verified.is_empty()
                || !cleared.is_empty()
                || !active_upsert.is_empty()
                || !active_updates.is_empty()
                || !active_removed.is_empty())
            .then(|| ViewPatch::PieceActivity {
                torrent_id: torrent_id.to_owned(),
                piece_count: next_view.piece_count,
                verified,
                cleared,
                active_upsert,
                active_updates,
                active_removed,
            })
        }
        (
            ViewSelector::Torrent {
                torrent_id: selected,
            },
            ViewProjection::Files,
        ) if selected == torrent_id && !file_changes.is_empty() => {
            let updates = file_changes
                .iter()
                .filter(|change| {
                    spec.catalog_page
                        .expect("validated file projection has a catalog page")
                        .contains(change.current.file_index)
                })
                .filter_map(|change| FileRowUpdate::between(&change.previous, &change.current))
                .collect::<Vec<_>>();
            (!updates.is_empty()).then(|| ViewPatch::Files {
                torrent_id: torrent_id.to_owned(),
                upsert: Vec::new(),
                updates,
                removed: Vec::new(),
            })
        }
        (
            ViewSelector::Torrent {
                torrent_id: selected,
            },
            ViewProjection::Media,
        ) if selected == torrent_id && !media_upsert.is_empty() => Some(ViewPatch::Media {
            torrent_id: torrent_id.to_owned(),
            upsert: media_upsert.to_vec(),
            removed: Vec::new(),
        }),
        _ => None,
    }
}

pub(super) fn targeted_peer_patch(
    spec: &SubscriptionSpec,
    torrent_id: &str,
    previous_view: &TorrentView,
    next_view: &TorrentView,
    previous_peers: &BTreeMap<String, PeerView>,
    next_peers: &BTreeMap<String, PeerView>,
) -> Option<ViewPatch> {
    match (&spec.selector, spec.projection) {
        (ViewSelector::TorrentList, ViewProjection::Summary) => {
            torrent_list_row_patch(previous_view, next_view)
        }
        (
            ViewSelector::Torrent {
                torrent_id: selected,
            },
            ViewProjection::Summary,
        ) if selected == torrent_id => selected_torrent_patch(Some(previous_view), Some(next_view)),
        (
            ViewSelector::Torrent {
                torrent_id: selected,
            },
            ViewProjection::Peers,
        ) if selected == torrent_id => {
            peer_collection_patch(torrent_id, previous_peers, next_peers)
        }
        _ => None,
    }
}

pub(super) fn targeted_torrent_view_patch(
    spec: &SubscriptionSpec,
    torrent_id: &str,
    previous: &TorrentView,
    current: &TorrentView,
) -> Option<ViewPatch> {
    match (&spec.selector, spec.projection) {
        (ViewSelector::TorrentList, ViewProjection::Summary) => {
            torrent_list_row_patch(previous, current)
        }
        (
            ViewSelector::Torrent {
                torrent_id: selected,
            },
            ViewProjection::Summary,
        ) if selected == torrent_id => selected_torrent_patch(Some(previous), Some(current)),
        _ => None,
    }
}

pub(super) fn targeted_swarm_patch(
    spec: &SubscriptionSpec,
    torrent_id: &str,
    previous: &SwarmModel,
    current: &SwarmModel,
) -> Option<ViewPatch> {
    match (&spec.selector, spec.projection) {
        (
            ViewSelector::Torrent {
                torrent_id: selected,
            },
            ViewProjection::Swarm,
        ) if selected == torrent_id => swarm_collection_patch(torrent_id, previous, current),
        _ => None,
    }
}

pub(super) fn targeted_tracker_patch(
    spec: &SubscriptionSpec,
    torrent_id: &str,
    previous_view: &TorrentView,
    next_view: &TorrentView,
    previous_trackers: &TrackerViewModel,
    next_trackers: &TrackerViewModel,
) -> Option<ViewPatch> {
    match (&spec.selector, spec.projection) {
        (ViewSelector::TorrentList, ViewProjection::Summary) => {
            torrent_list_row_patch(previous_view, next_view)
        }
        (
            ViewSelector::Torrent {
                torrent_id: selected,
            },
            ViewProjection::Summary,
        ) if selected == torrent_id => selected_torrent_patch(Some(previous_view), Some(next_view)),
        (
            ViewSelector::Torrent {
                torrent_id: selected,
            },
            ViewProjection::Trackers,
        ) if selected == torrent_id => {
            let page = spec
                .catalog_page
                .expect("validated tracker projection has a catalog page");
            let previous =
                previous_trackers.row_map_page(page.bounds(previous_trackers.count_usize()));
            let next = next_trackers.row_map_page(page.bounds(next_trackers.count_usize()));
            tracker_collection_patch(torrent_id, &previous, &next)
        }
        _ => None,
    }
}

fn peer_collection_patch(
    torrent_id: &str,
    previous: &BTreeMap<String, PeerView>,
    current: &BTreeMap<String, PeerView>,
) -> Option<ViewPatch> {
    let mut upsert = Vec::new();
    let mut updates = Vec::new();
    for (id, peer) in current {
        match previous.get(id) {
            None => upsert.push(peer.clone()),
            Some(old) => {
                if let Some(update) = PeerRowUpdate::between(old, peer) {
                    updates.push(update);
                }
            }
        }
    }
    let removed = previous
        .keys()
        .filter(|id| !current.contains_key(*id))
        .cloned()
        .collect::<Vec<_>>();
    (!upsert.is_empty() || !updates.is_empty() || !removed.is_empty()).then(|| ViewPatch::Peers {
        torrent_id: torrent_id.to_owned(),
        upsert,
        updates,
        removed,
    })
}

fn swarm_collection_patch(
    torrent_id: &str,
    previous: &SwarmModel,
    current: &SwarmModel,
) -> Option<ViewPatch> {
    if previous == current {
        return None;
    }
    let upsert = current
        .peers
        .iter()
        .filter(|(id, peer)| previous.peers.get(*id) != Some(*peer))
        .map(|(_, peer)| peer.clone())
        .collect();
    let removed = previous
        .peers
        .keys()
        .filter(|id| !current.peers.contains_key(*id))
        .cloned()
        .collect();
    Some(ViewPatch::Swarm {
        torrent_id: torrent_id.to_owned(),
        state: current.state,
        captured_millis: current.captured_millis.clone(),
        maximum_records: current.maximum_records,
        counts: current.counts.clone(),
        upsert,
        removed,
    })
}

fn tracker_collection_patch(
    torrent_id: &str,
    previous: &BTreeMap<String, TrackerView>,
    current: &BTreeMap<String, TrackerView>,
) -> Option<ViewPatch> {
    let upsert = current
        .iter()
        .filter(|(id, tracker)| previous.get(*id) != Some(*tracker))
        .map(|(_, tracker)| tracker.clone())
        .collect::<Vec<_>>();
    let removed = previous
        .keys()
        .filter(|id| !current.contains_key(*id))
        .cloned()
        .collect::<Vec<_>>();
    (!upsert.is_empty() || !removed.is_empty()).then(|| ViewPatch::Trackers {
        torrent_id: torrent_id.to_owned(),
        upsert,
        removed,
    })
}

pub(super) fn disk_patch(
    previous: &DiskSessionView,
    current: &DiskSessionView,
) -> Option<ViewPatch> {
    let upsert = current
        .pieces
        .iter()
        .filter(|(id, piece)| previous.pieces.get(*id) != Some(*piece))
        .map(|(_, piece)| piece.clone())
        .collect::<Vec<_>>();
    let removed = previous
        .pieces
        .keys()
        .filter(|id| !current.pieces.contains_key(*id))
        .cloned()
        .collect::<Vec<_>>();
    (previous.pipeline != current.pipeline || !upsert.is_empty() || !removed.is_empty()).then(
        || ViewPatch::SessionDisk {
            pipeline: current.pipeline.clone(),
            upsert,
            removed,
        },
    )
}

fn active_piece_patch(
    previous: &BTreeMap<u32, ActivePiece>,
    current: &BTreeMap<u32, ActivePiece>,
) -> (Vec<ActivePiece>, Vec<ActivePieceUpdate>, Vec<String>) {
    let mut upsert = Vec::new();
    let mut updates = Vec::new();
    for (piece_index, piece) in current {
        match previous.get(piece_index) {
            Some(old) if old.piece_id == piece.piece_id => {
                if let Some(update) = ActivePieceUpdate::between(old, piece) {
                    updates.push(update);
                }
            }
            _ => upsert.push(piece.clone()),
        }
    }
    let removed = previous
        .iter()
        .filter(|(piece_index, piece)| {
            current
                .get(*piece_index)
                .is_none_or(|current| current.piece_id != piece.piece_id)
        })
        .map(|(_, piece)| piece.piece_id.clone())
        .collect();
    (upsert, updates, removed)
}

pub(super) fn coalesce(update: &mut ViewUpdate, next: &ViewUpdatePayload) -> bool {
    let (ViewUpdatePayload::Patch { patch: current }, ViewUpdatePayload::Patch { patch: next }) =
        (&mut update.payload, next)
    else {
        return false;
    };
    coalesce_patch(current, next)
}

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
fn coalesce_sparse_rows<Row: Clone, Update: Clone>(
    current_upsert: &[Row],
    current_updates: &[Update],
    current_removed: &[String],
    next_upsert: &[Row],
    next_updates: &[Update],
    next_removed: &[String],
    row_id: impl Fn(&Row) -> String,
    update_id: impl Fn(&Update) -> String,
    apply: impl Fn(&Update, &mut Row) -> bool,
    merge: impl Fn(&mut Update, &Update) -> bool,
) -> Option<(Vec<Row>, Vec<Update>, Vec<String>)> {
    let mut rows = current_upsert
        .iter()
        .cloned()
        .map(|row| (row_id(&row), row))
        .collect::<BTreeMap<_, _>>();
    let mut updates = current_updates
        .iter()
        .cloned()
        .map(|update| (update_id(&update), update))
        .collect::<BTreeMap<_, _>>();
    let mut removed = current_removed.iter().cloned().collect::<BTreeSet<_>>();
    if rows.len() != current_upsert.len()
        || updates.len() != current_updates.len()
        || removed.len() != current_removed.len()
        || rows
            .keys()
            .any(|id| updates.contains_key(id) || removed.contains(id))
        || updates.keys().any(|id| removed.contains(id))
    {
        return None;
    }

    let next_row_ids = next_upsert.iter().map(&row_id).collect::<BTreeSet<_>>();
    let next_update_ids = next_updates.iter().map(&update_id).collect::<BTreeSet<_>>();
    let next_removed_ids = next_removed.iter().collect::<BTreeSet<_>>();
    if next_row_ids.len() != next_upsert.len()
        || next_update_ids.len() != next_updates.len()
        || next_removed_ids.len() != next_removed.len()
        || next_row_ids
            .iter()
            .any(|id| next_update_ids.contains(id) || next_removed_ids.contains(id))
        || next_update_ids
            .iter()
            .any(|id| next_removed_ids.contains(id))
    {
        return None;
    }

    for id in next_removed {
        rows.remove(id);
        updates.remove(id);
        removed.insert(id.clone());
    }
    for row in next_upsert {
        let id = row_id(row);
        rows.insert(id.clone(), row.clone());
        updates.remove(&id);
        removed.remove(&id);
    }
    for next_update in next_updates {
        let id = update_id(next_update);
        if removed.contains(&id) {
            return None;
        }
        if let Some(row) = rows.get_mut(&id) {
            if !apply(next_update, row) {
                return None;
            }
        } else if let Some(update) = updates.get_mut(&id) {
            if !merge(update, next_update) {
                return None;
            }
        } else {
            updates.insert(id, next_update.clone());
        }
    }
    Some((
        rows.into_values().collect(),
        updates.into_values().collect(),
        removed.into_iter().collect(),
    ))
}

pub(crate) fn coalesce_patch(current: &mut ViewPatch, next: &ViewPatch) -> bool {
    match (current, next) {
        (
            ViewPatch::TorrentList {
                upsert,
                updates,
                removed,
                storage,
                client_settings,
            },
            ViewPatch::TorrentList {
                upsert: next_upsert,
                updates: next_updates,
                removed: next_removed,
                storage: next_storage,
                client_settings: next_client_settings,
            },
        ) => {
            let Some((next_rows, next_fields, next_removed_ids)) = coalesce_sparse_rows(
                upsert,
                updates,
                removed,
                next_upsert,
                next_updates,
                next_removed,
                |torrent| torrent.torrent_id.clone(),
                |update| update.torrent_id.clone(),
                |update, torrent| update.apply(torrent).is_ok(),
                |current, next| current.merge(next).is_ok(),
            ) else {
                return false;
            };
            *upsert = next_rows;
            *updates = next_fields;
            *removed = next_removed_ids;
            if next_storage.is_some() {
                *storage = next_storage.clone();
            }
            if next_client_settings.is_some() {
                *client_settings = next_client_settings.clone();
            }
            true
        }
        (
            ViewPatch::Torrent { change },
            ViewPatch::Torrent {
                change: next_change,
            },
        ) => match next_change {
            TorrentViewChange::Replace { .. } => {
                *change = next_change.clone();
                true
            }
            TorrentViewChange::Update { update } => match change {
                TorrentViewChange::Replace {
                    torrent: Some(torrent),
                } => update.apply(torrent).is_ok(),
                TorrentViewChange::Replace { torrent: None } => false,
                TorrentViewChange::Update { update: current } => current.merge(update).is_ok(),
            },
        },
        (
            ViewPatch::TorrentPreparation {
                torrent_id,
                preparation,
            },
            ViewPatch::TorrentPreparation {
                torrent_id: next_id,
                preparation: next_preparation,
            },
        ) if torrent_id == next_id => {
            *preparation = next_preparation.clone();
            true
        }
        (
            ViewPatch::PieceActivity {
                torrent_id,
                piece_count,
                verified,
                cleared,
                active_upsert,
                active_updates,
                active_removed,
            },
            ViewPatch::PieceActivity {
                torrent_id: next_id,
                piece_count: next_piece_count,
                verified: next_verified,
                cleared: next_cleared,
                active_upsert: next_active_upsert,
                active_updates: next_active_updates,
                active_removed: next_active_removed,
            },
        ) if torrent_id == next_id => {
            let Some((next_rows, next_fields, next_removed_ids)) = coalesce_sparse_rows(
                active_upsert,
                active_updates,
                active_removed,
                next_active_upsert,
                next_active_updates,
                next_active_removed,
                |piece| piece.piece_id.clone(),
                |update| update.piece_id.clone(),
                |update, piece| update.apply(piece).is_ok(),
                |current, next| current.merge(next).is_ok(),
            ) else {
                return false;
            };
            for range in next_cleared {
                remove_interval(verified, *range);
                insert_interval(cleared, *range);
            }
            for range in next_verified {
                remove_interval(cleared, *range);
                insert_interval(verified, *range);
            }
            *piece_count = *next_piece_count;
            *active_upsert = next_rows;
            *active_updates = next_fields;
            *active_removed = next_removed_ids;
            true
        }
        (
            ViewPatch::SessionDisk {
                pipeline,
                upsert,
                removed,
            },
            ViewPatch::SessionDisk {
                pipeline: next_pipeline,
                upsert: next_upsert,
                removed: next_removed,
            },
        ) => {
            let mut values = upsert
                .drain(..)
                .map(|piece| (piece.row_id.clone(), piece))
                .collect::<BTreeMap<_, _>>();
            for id in next_removed {
                values.remove(id);
            }
            for piece in next_upsert {
                values.insert(piece.row_id.clone(), piece.clone());
            }
            let mut removed_ids = removed.drain(..).collect::<BTreeSet<_>>();
            for piece in next_upsert {
                removed_ids.remove(&piece.row_id);
            }
            removed_ids.extend(next_removed.iter().cloned());
            *pipeline = next_pipeline.clone();
            *upsert = values.into_values().collect();
            *removed = removed_ids.into_iter().collect();
            true
        }
        (
            ViewPatch::SessionDht { inspection },
            ViewPatch::SessionDht {
                inspection: next_inspection,
            },
        ) => {
            *inspection = next_inspection.clone();
            true
        }
        (
            ViewPatch::SessionCurrentRates { rates },
            ViewPatch::SessionCurrentRates { rates: next_rates },
        ) => {
            *rates = next_rates.clone();
            true
        }
        (
            ViewPatch::SessionSpeedHistory { append },
            ViewPatch::SessionSpeedHistory {
                append: next_append,
            },
        ) => append.merge(next_append).is_ok(),
        (
            ViewPatch::Peers {
                torrent_id,
                upsert,
                updates,
                removed,
            },
            ViewPatch::Peers {
                torrent_id: next_id,
                upsert: next_upsert,
                updates: next_updates,
                removed: next_removed,
            },
        ) if torrent_id == next_id => {
            let Some((next_rows, next_fields, next_removed_ids)) = coalesce_sparse_rows(
                upsert,
                updates,
                removed,
                next_upsert,
                next_updates,
                next_removed,
                |peer| peer.connection_id.clone(),
                |update| update.connection_id.clone(),
                |update, peer| update.apply(peer).is_ok(),
                |current, next| current.merge(next).is_ok(),
            ) else {
                return false;
            };
            *upsert = next_rows;
            *updates = next_fields;
            *removed = next_removed_ids;
            true
        }
        (
            ViewPatch::Swarm {
                torrent_id,
                state,
                captured_millis,
                maximum_records,
                counts,
                upsert,
                removed,
            },
            ViewPatch::Swarm {
                torrent_id: next_id,
                state: next_state,
                captured_millis: next_captured_millis,
                maximum_records: next_maximum_records,
                counts: next_counts,
                upsert: next_upsert,
                removed: next_removed,
            },
        ) if torrent_id == next_id => {
            let mut values = upsert
                .drain(..)
                .map(|peer| (peer.peer_record_id.clone(), peer))
                .collect::<BTreeMap<_, _>>();
            for id in next_removed {
                values.remove(id);
            }
            for peer in next_upsert {
                values.insert(peer.peer_record_id.clone(), peer.clone());
            }
            let mut removed_ids = removed.drain(..).collect::<BTreeSet<_>>();
            for peer in next_upsert {
                removed_ids.remove(&peer.peer_record_id);
            }
            removed_ids.extend(next_removed.iter().cloned());
            *state = *next_state;
            *captured_millis = next_captured_millis.clone();
            *maximum_records = *next_maximum_records;
            *counts = next_counts.clone();
            *upsert = values.into_values().collect();
            *removed = removed_ids.into_iter().collect();
            true
        }
        (
            ViewPatch::Files {
                torrent_id,
                upsert,
                updates,
                removed,
            },
            ViewPatch::Files {
                torrent_id: next_id,
                upsert: next_upsert,
                updates: next_updates,
                removed: next_removed,
            },
        ) if torrent_id == next_id => {
            let Some((next_rows, next_fields, next_removed_ids)) = coalesce_sparse_rows(
                upsert,
                updates,
                removed,
                next_upsert,
                next_updates,
                next_removed,
                |file| file.file_id.clone(),
                |update| update.file_id.clone(),
                |update, file| update.apply(file).is_ok(),
                |current, next| current.merge(next).is_ok(),
            ) else {
                return false;
            };
            *upsert = next_rows;
            *updates = next_fields;
            *removed = next_removed_ids;
            true
        }
        (
            ViewPatch::Trackers {
                torrent_id,
                upsert,
                removed,
            },
            ViewPatch::Trackers {
                torrent_id: next_id,
                upsert: next_upsert,
                removed: next_removed,
            },
        ) if torrent_id == next_id => {
            let mut values = upsert
                .drain(..)
                .map(|tracker| (tracker.tracker_id.clone(), tracker))
                .collect::<BTreeMap<_, _>>();
            for id in next_removed {
                values.remove(id);
            }
            for tracker in next_upsert {
                values.insert(tracker.tracker_id.clone(), tracker.clone());
            }
            let mut removed_ids = removed.drain(..).collect::<std::collections::BTreeSet<_>>();
            for tracker in next_upsert {
                removed_ids.remove(&tracker.tracker_id);
            }
            removed_ids.extend(next_removed.iter().cloned());
            *upsert = values.into_values().collect();
            *removed = removed_ids.into_iter().collect();
            true
        }
        (
            ViewPatch::Media {
                torrent_id,
                upsert,
                removed,
            },
            ViewPatch::Media {
                torrent_id: next_id,
                upsert: next_upsert,
                removed: next_removed,
            },
        ) if torrent_id == next_id => {
            let mut values = upsert
                .drain(..)
                .map(|item| (item.media_id.clone(), item))
                .collect::<BTreeMap<_, _>>();
            for id in next_removed {
                values.remove(id);
            }
            for item in next_upsert {
                values.insert(item.media_id.clone(), item.clone());
            }
            let mut removed_ids = removed.drain(..).collect::<BTreeSet<_>>();
            for item in next_upsert {
                removed_ids.remove(&item.media_id);
            }
            removed_ids.extend(next_removed.iter().cloned());
            *upsert = values.into_values().collect();
            *removed = removed_ids.into_iter().collect();
            true
        }
        (
            ViewPatch::Diagnostics { events, retention },
            ViewPatch::Diagnostics {
                events: next_events,
                retention: next_retention,
            },
        ) => {
            if events.len().saturating_add(next_events.len()) > MAX_DIAGNOSTIC_PATCH_EVENTS
                || patch_encoded_len(events).saturating_add(patch_encoded_len(next_events))
                    > MAX_DIAGNOSTIC_PATCH_BYTES
            {
                return false;
            }
            events.extend(next_events.iter().cloned());
            *retention = next_retention.clone();
            true
        }
        _ => false,
    }
}
