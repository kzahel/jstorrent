import type {
  ActivePiece,
  ActivePieceUpdate,
  DiagnosticEvent,
  FileRowUpdate,
  FileView,
  IndexRange,
  OpenViewSetResponse,
  PeerRowUpdate,
  PeerView,
  SpeedHistoryAppend,
  SpeedHistoryView,
  TorrentRowUpdate,
  TorrentView,
  UpdateBatch,
  ViewPatch,
  ViewSnapshot,
} from "./api";
import {
  validateActivePiece,
  validateFileView,
  validatePeerView,
  validateTorrentView,
} from "./validation";

export interface ViewSetState {
  viewSetId: string;
  epoch: string;
  cursor: string;
  durableRevision: string;
  serverNowMillis: string;
  views: Record<string, ViewSnapshot>;
  deliveryResetCount: number;
  lastDeliveryResetReason: string | null;
}

import { ViewSetContinuityError } from "./api/errors";

export { ViewSetContinuityError };

export function reduceOpenViewSet(response: OpenViewSetResponse): ViewSetState {
  if (response.initial.view_set_id !== response.view_set_id) {
    throw new ViewSetContinuityError("initial batch belongs to another view set");
  }
  return reduceUpdateBatch(undefined, response.initial);
}

export function reduceUpdateBatch(
  state: ViewSetState | undefined,
  batch: UpdateBatch,
): ViewSetState {
  if (batch.api_version !== 1) {
    throw new ViewSetContinuityError("unsupported application API version");
  }
  if (state !== undefined && state.viewSetId !== batch.view_set_id) {
    throw new ViewSetContinuityError("update belongs to another view set");
  }
  if (state !== undefined && state.epoch === batch.epoch) {
    if (state.cursor === batch.cursor) return state;
    if (state.cursor !== batch.base_cursor) {
      throw new ViewSetContinuityError("update does not continue the view-set cursor");
    }
    if (batch.updates.some((update) => update.type === "reset_required")) {
      throw new ViewSetContinuityError("reset did not rotate the view-set epoch");
    }
  } else {
    if (state === undefined && batch.base_cursor !== "0") {
      throw new ViewSetContinuityError("new view-set epoch does not start at cursor zero");
    }
    if (
      state !== undefined &&
      batch.updates[0]?.type !== "reset_required"
    ) {
      throw new ViewSetContinuityError("epoch changed without an explicit reset");
    }
    if (
      state !== undefined &&
      BigInt(batch.cursor) <= BigInt(state.cursor)
    ) {
      throw new ViewSetContinuityError("reset reused an old view-set cursor");
    }
  }

  const deliveryResets = batch.updates.filter(
    (update) => update.type === "reset_required",
  );
  const next: ViewSetState = {
    viewSetId: batch.view_set_id,
    epoch: batch.epoch,
    cursor: batch.cursor,
    durableRevision: batch.durable_revision,
    serverNowMillis: batch.server_now_millis,
    views: state?.epoch === batch.epoch ? { ...state.views } : {},
    deliveryResetCount:
      (state?.deliveryResetCount ?? 0) +
      deliveryResets.length,
    lastDeliveryResetReason:
      deliveryResets.at(-1)?.reason ?? state?.lastDeliveryResetReason ?? null,
  };
  for (const update of batch.updates) {
    switch (update.type) {
      case "reset_required":
        if (update.view_id === undefined || update.view_id === null) {
          next.views = {};
        } else {
          delete next.views[update.view_id];
        }
        break;
      case "view_removed":
        delete next.views[update.view_id];
        break;
      case "snapshot":
        next.views[update.view_id] = cloneSnapshot(update.snapshot);
        break;
      case "patch": {
        const previous = next.views[update.view_id];
        if (previous === undefined) {
          throw new ViewSetContinuityError(
            `patch for unknown view ${update.view_id}`,
          );
        }
        next.views[update.view_id] = applyPatch(previous, update.patch);
        break;
      }
    }
  }
  return next;
}

function cloneSnapshot(snapshot: ViewSnapshot): ViewSnapshot {
  switch (snapshot.type) {
    case "torrent_list":
      return {
        ...snapshot,
        torrents: [...snapshot.torrents],
        storage: {
          ...snapshot.storage,
          roots: [...snapshot.storage.roots],
        },
        client_settings: structuredClone(snapshot.client_settings),
      };
    case "torrent":
      return { ...snapshot };
    case "torrent_preparation":
      return structuredClone(snapshot);
    case "piece_activity":
      return {
        ...snapshot,
        verified: [...snapshot.verified],
        active: [...snapshot.active],
      };
    case "session_disk":
      return {
        ...snapshot,
        pipeline: { ...snapshot.pipeline },
        pieces: [...snapshot.pieces],
      };
    case "session_dht":
      return {
        ...snapshot,
        inspection: cloneDhtInspection(snapshot.inspection),
      };
    case "session_current_rates":
      return {
        ...snapshot,
        rates: {
          ...snapshot.rates,
          rates: snapshot.rates.rates.map((entry) => ({ ...entry })),
        },
      };
    case "session_speed_history":
      return {
        ...snapshot,
        history: cloneSpeedHistory(snapshot.history),
      };
    case "peers":
      return { ...snapshot, peers: [...snapshot.peers] };
    case "swarm":
      return {
        ...snapshot,
        counts: { ...snapshot.counts },
        peers: [...snapshot.peers],
      };
    case "files":
      return { ...snapshot, files: [...snapshot.files] };
    case "media":
      return { ...snapshot, items: [...snapshot.items] };
    case "trackers":
      return { ...snapshot, trackers: [...snapshot.trackers] };
    case "diagnostics":
      return {
        ...snapshot,
        events: [...snapshot.events],
        retention: { ...snapshot.retention },
      };
  }
}

function applyPatch(snapshot: ViewSnapshot, patch: ViewPatch): ViewSnapshot {
  if (snapshot.type !== patch.type) {
    throw new ViewSetContinuityError("patch projection does not match its view");
  }
  switch (patch.type) {
    case "torrent_list": {
      if (snapshot.type !== "torrent_list") throw new Error("unreachable");
      const torrents = new Map(
        snapshot.torrents.map((torrent) => [torrent.torrent_id, torrent]),
      );
      for (const torrentId of patch.removed) torrents.delete(torrentId);
      for (const torrent of patch.upsert) {
        torrents.set(torrent.torrent_id, torrent);
      }
      for (const update of patch.updates) {
        const torrent = torrents.get(update.torrent_id);
        if (torrent === undefined) {
          throw new ViewSetContinuityError(
            `torrent update for unknown row ${update.torrent_id}`,
          );
        }
        torrents.set(update.torrent_id, applyTorrentUpdate(torrent, update));
      }
      return {
        type: "torrent_list",
        torrents: [...torrents.values()],
        storage: patch.storage ?? snapshot.storage,
        client_settings: patch.client_settings ?? snapshot.client_settings,
      };
    }
    case "torrent": {
      if (patch.change.change === "replace") {
        return { type: "torrent", torrent: patch.change.torrent };
      }
      if (snapshot.type !== "torrent") throw new Error("unreachable");
      if (snapshot.torrent === null) {
        throw new ViewSetContinuityError("torrent update has no selected row");
      }
      return {
        type: "torrent",
        torrent: applyTorrentUpdate(snapshot.torrent, patch.change.update),
      };
    }
    case "torrent_preparation": {
      if (snapshot.type !== "torrent_preparation") throw new Error("unreachable");
      if (snapshot.torrent_id !== patch.torrent_id) {
        throw new ViewSetContinuityError("preparation torrent identity mismatch");
      }
      return {
        type: "torrent_preparation",
        torrent_id: patch.torrent_id,
        preparation: structuredClone(patch.preparation),
      };
    }
    case "piece_activity": {
      if (snapshot.type !== "piece_activity") throw new Error("unreachable");
      let verified = snapshot.verified;
      for (const range of patch.cleared) verified = removeRange(verified, range);
      for (const range of patch.verified) verified = insertRange(verified, range);
      const active = new Map(
        snapshot.active.map((piece) => [piece.piece_id, piece]),
      );
      for (const pieceId of patch.active_removed) active.delete(pieceId);
      for (const piece of patch.active_upsert) active.set(piece.piece_id, piece);
      for (const update of patch.active_updates) {
        const piece = active.get(update.piece_id);
        if (piece === undefined) {
          throw new ViewSetContinuityError(
            `active-piece update for unknown row ${update.piece_id}`,
          );
        }
        active.set(
          update.piece_id,
          applyActivePieceUpdate(piece, update, patch.piece_count),
        );
      }
      return {
        type: "piece_activity",
        torrent_id: patch.torrent_id,
        piece_count: patch.piece_count,
        verified,
        active: [...active.values()],
      };
    }
    case "session_disk": {
      if (snapshot.type !== "session_disk") throw new Error("unreachable");
      const pieces = new Map(
        snapshot.pieces.map((piece) => [piece.row_id, piece]),
      );
      for (const rowId of patch.removed) pieces.delete(rowId);
      for (const piece of patch.upsert) pieces.set(piece.row_id, piece);
      return {
        type: "session_disk",
        pipeline: patch.pipeline,
        pieces: [...pieces.values()],
      };
    }
    case "session_dht":
      return {
        type: "session_dht",
        inspection: cloneDhtInspection(patch.inspection),
      };
    case "session_current_rates":
      return {
        type: "session_current_rates",
        rates: {
          ...patch.rates,
          rates: patch.rates.rates.map((entry) => ({ ...entry })),
        },
      };
    case "session_speed_history": {
      if (snapshot.type !== "session_speed_history") throw new Error("unreachable");
      return {
        type: "session_speed_history",
        history: applySpeedHistoryAppend(snapshot.history, patch.append),
      };
    }
    case "peers": {
      if (snapshot.type !== "peers") throw new Error("unreachable");
      const peers = new Map(
        snapshot.peers.map((peer) => [peer.connection_id, peer]),
      );
      for (const connectionId of patch.removed) peers.delete(connectionId);
      for (const peer of patch.upsert) peers.set(peer.connection_id, peer);
      for (const update of patch.updates) {
        const peer = peers.get(update.connection_id);
        if (peer === undefined) {
          throw new ViewSetContinuityError(
            `peer update for unknown row ${update.connection_id}`,
          );
        }
        peers.set(update.connection_id, applyPeerUpdate(peer, update));
      }
      return {
        type: "peers",
        torrent_id: patch.torrent_id,
        peers: [...peers.values()],
      };
    }
    case "swarm": {
      if (snapshot.type !== "swarm") throw new Error("unreachable");
      const peers = new Map(
        snapshot.peers.map((peer) => [peer.peer_record_id, peer]),
      );
      for (const recordId of patch.removed) peers.delete(recordId);
      for (const peer of patch.upsert) peers.set(peer.peer_record_id, peer);
      if (
        peers.size > patch.maximum_records ||
        patch.counts.total !== peers.size ||
        (patch.state !== "active" && peers.size !== 0)
      ) {
        throw new ViewSetContinuityError("swarm patch violates its row bound or counts");
      }
      return {
        type: "swarm",
        torrent_id: patch.torrent_id,
        state: patch.state,
        captured_millis: patch.captured_millis,
        maximum_records: patch.maximum_records,
        counts: { ...patch.counts },
        peers: [...peers.values()],
      };
    }
    case "files": {
      if (snapshot.type !== "files") throw new Error("unreachable");
      const files = new Map(
        snapshot.files.map((file) => [file.file_id, file]),
      );
      for (const fileId of patch.removed) files.delete(fileId);
      for (const file of patch.upsert) files.set(file.file_id, file);
      for (const update of patch.updates) {
        const file = files.get(update.file_id);
        if (file === undefined) {
          throw new ViewSetContinuityError(
            `file update for unknown row ${update.file_id}`,
          );
        }
        files.set(update.file_id, applyFileUpdate(file, update));
      }
      return {
        type: "files",
        torrent_id: patch.torrent_id,
        state: snapshot.state,
        filesystem_content_base: snapshot.filesystem_content_base,
        page: snapshot.page,
        files: [...files.values()],
      };
    }
    case "media": {
      if (snapshot.type !== "media") throw new Error("unreachable");
      const items = new Map(
        snapshot.items.map((item) => [item.media_id, item]),
      );
      for (const mediaId of patch.removed) items.delete(mediaId);
      for (const item of patch.upsert) items.set(item.media_id, item);
      return {
        type: "media",
        torrent_id: patch.torrent_id,
        state: snapshot.state,
        total_non_padding_files: snapshot.total_non_padding_files,
        items: [...items.values()],
      };
    }
    case "trackers": {
      if (snapshot.type !== "trackers") throw new Error("unreachable");
      const trackers = new Map(
        snapshot.trackers.map((tracker) => [tracker.tracker_id, tracker]),
      );
      for (const trackerId of patch.removed) trackers.delete(trackerId);
      for (const tracker of patch.upsert) {
        trackers.set(tracker.tracker_id, tracker);
      }
      return {
        type: "trackers",
        torrent_id: patch.torrent_id,
        state: snapshot.state,
        page: snapshot.page,
        trackers: [...trackers.values()],
      };
    }
    case "diagnostics": {
      if (snapshot.type !== "diagnostics") throw new Error("unreachable");
      return {
        type: "diagnostics",
        events: mergeDiagnostics(snapshot.events, patch.events),
        retention: { ...patch.retention },
      };
    }
  }
}

function requireUniqueFields(
  fields: ReadonlyArray<{ readonly field: string }>,
  row: string,
): void {
  if (fields.length === 0) {
    throw new ViewSetContinuityError(`${row} update has no fields`);
  }
  const kinds = new Set(fields.map((field) => field.field));
  if (kinds.size !== fields.length) {
    throw new ViewSetContinuityError(`${row} update repeats a field`);
  }
}

function applyTorrentUpdate(
  torrent: TorrentView,
  update: TorrentRowUpdate,
): TorrentView {
  if (torrent.torrent_id !== update.torrent_id) {
    throw new ViewSetContinuityError("torrent update identity mismatch");
  }
  requireUniqueFields(update.fields, "torrent");
  const next = structuredClone(torrent);
  for (const field of update.fields) {
    switch (field.field) {
      case "protocol_identities": next.protocol_identities = field.value; break;
      case "display_name": next.display_name = field.value; break;
      case "source_display_name": next.source_display_name = field.value; break;
      case "state": next.state = field.value; break;
      case "operational_state": next.operational_state = field.value; break;
      case "download_queue_position": next.download_queue_position = field.value; break;
      case "transfer_limits": next.transfer_limits = field.value; break;
      case "storage_state": next.storage_state = field.value; break;
      case "metadata_available": next.metadata_available = field.value; break;
      case "private_torrent": next.private_torrent = field.value; break;
      case "awaiting_file_selection": next.awaiting_file_selection = field.value; break;
      case "pending_file_selection_position": next.pending_file_selection_position = field.value; break;
      case "file_catalog_id": next.file_catalog_id = field.value; break;
      case "selectable_file_count": next.selectable_file_count = field.value; break;
      case "selected_file_count": next.selected_file_count = field.value; break;
      case "selectable_file_bytes": next.selectable_file_bytes = field.value; break;
      case "selected_file_bytes": next.selected_file_bytes = field.value; break;
      case "piece_count": next.piece_count = field.value; break;
      case "total_size_bytes": next.total_size_bytes = field.value; break;
      case "verified_piece_count": next.verified_piece_count = field.value; break;
      case "requested_bytes": next.requested_bytes = field.value; break;
      case "received_bytes": next.received_bytes = field.value; break;
      case "stored_bytes": next.stored_bytes = field.value; break;
      case "active_peer_connections": next.active_peer_connections = field.value; break;
      case "configured_tracker_count": next.configured_tracker_count = field.value; break;
      case "payload_download_rate_bytes": next.payload_download_rate_bytes = field.value; break;
      case "required_payload_bytes": next.required_payload_bytes = field.value; break;
      case "remaining_payload_bytes": next.remaining_payload_bytes = field.value; break;
      case "eta_payload_download_rate_bytes": next.eta_payload_download_rate_bytes = field.value; break;
      case "eta": next.eta = field.value; break;
      case "lifetime": next.lifetime = field.value; break;
      case "seeding": next.seeding = field.value; break;
      case "progress": next.progress = field.value; break;
      case "checking": next.checking = field.value; break;
      case "archived": next.archived = field.value; break;
      case "removal_state": next.removal_state = field.value; break;
      case "delete_data_supported": next.delete_data_supported = field.value; break;
      case "force_recheck_available": next.force_recheck_available = field.value; break;
      case "error": next.error = field.value; break;
      default: field satisfies never;
    }
  }
  validateTorrentView(next);
  return next;
}

function applyFileUpdate(file: FileView, update: FileRowUpdate): FileView {
  if (file.file_id !== update.file_id) {
    throw new ViewSetContinuityError("file update identity mismatch");
  }
  requireUniqueFields(update.fields, "file");
  const next = structuredClone(file);
  for (const field of update.fields) {
    switch (field.field) {
      case "selection": next.selection = field.value; break;
      case "done_bytes": next.done_bytes = field.value; break;
      case "verified_bytes": next.verified_bytes = field.value; break;
      case "media_availability": next.media_availability = field.value; break;
      default: field satisfies never;
    }
  }
  validateFileView(next);
  return next;
}

function applyPeerUpdate(peer: PeerView, update: PeerRowUpdate): PeerView {
  if (peer.connection_id !== update.connection_id) {
    throw new ViewSetContinuityError("peer update identity mismatch");
  }
  requireUniqueFields(update.fields, "peer");
  const next = structuredClone(peer);
  for (const field of update.fields) {
    switch (field.field) {
      case "peer_record_id": next.peer_record_id = field.value; break;
      case "direction": next.direction = field.value; break;
      case "transport": next.transport = field.value; break;
      case "lifecycle": next.lifecycle = field.value; break;
      case "role": next.role = field.value; break;
      case "peer_flags": next.peer_flags = field.value; break;
      case "mse_method": next.mse_method = field.value; break;
      case "lifecycle_age_millis": next.lifecycle_age_millis = field.value; break;
      case "remote_endpoint": next.remote_endpoint = field.value; break;
      case "local_endpoint": next.local_endpoint = field.value; break;
      case "sources": next.sources = field.value; break;
      case "peer_id": next.peer_id = field.value; break;
      case "client_name": next.client_name = field.value; break;
      case "supports_extensions": next.supports_extensions = field.value; break;
      case "supports_ut_metadata": next.supports_ut_metadata = field.value; break;
      case "local_interested": next.local_interested = field.value; break;
      case "remote_interested": next.remote_interested = field.value; break;
      case "remote_choking": next.remote_choking = field.value; break;
      case "local_choking": next.local_choking = field.value; break;
      case "available_piece_count": next.available_piece_count = field.value; break;
      case "wanted_piece_count": next.wanted_piece_count = field.value; break;
      case "payload_download_rate_bytes": next.payload_download_rate_bytes = field.value; break;
      case "payload_downloaded_bytes": next.payload_downloaded_bytes = field.value; break;
      case "protocol_download_rate_bytes": next.protocol_download_rate_bytes = field.value; break;
      case "protocol_downloaded_bytes": next.protocol_downloaded_bytes = field.value; break;
      case "payload_upload_rate_bytes": next.payload_upload_rate_bytes = field.value; break;
      case "payload_uploaded_bytes": next.payload_uploaded_bytes = field.value; break;
      case "pending_requests": next.pending_requests = field.value; break;
      case "target_requests": next.target_requests = field.value; break;
      case "queued_payload_bytes": next.queued_payload_bytes = field.value; break;
      case "oldest_request_age_millis": next.oldest_request_age_millis = field.value; break;
      case "request_timeout_millis": next.request_timeout_millis = field.value; break;
      case "request_phase": next.request_phase = field.value; break;
      case "connected_age_millis": next.connected_age_millis = field.value; break;
      case "last_useful_age_millis": next.last_useful_age_millis = field.value; break;
      case "last_payload_age_millis": next.last_payload_age_millis = field.value; break;
      case "disconnect_reason": next.disconnect_reason = field.value; break;
      case "capabilities": next.capabilities = field.value; break;
    }
  }
  validatePeerView(next, next.torrent_id);
  return next;
}

function applyActivePieceUpdate(
  piece: ActivePiece,
  update: ActivePieceUpdate,
  pieceCount: number,
): ActivePiece {
  if (piece.piece_id !== update.piece_id) {
    throw new ViewSetContinuityError("active-piece update identity mismatch");
  }
  requireUniqueFields(update.fields, "active-piece");
  const next = structuredClone(piece);
  for (const field of update.fields) {
    switch (field.field) {
      case "stage": next.stage = field.value; break;
      case "requested": next.requested = field.value; break;
      case "received": next.received = field.value; break;
      case "stored": next.stored = field.value; break;
      case "age_millis": next.age_millis = field.value; break;
      case "error": next.error = field.value; break;
    }
  }
  validateActivePiece(next, pieceCount);
  return next;
}

function cloneDhtInspection(
  inspection: Extract<ViewSnapshot, { type: "session_dht" }>["inspection"],
): Extract<ViewSnapshot, { type: "session_dht" }>["inspection"] {
  return {
    ...inspection,
    families: inspection.families.map((family) => ({
      ...family,
      buckets: family.buckets.map((bucket) => ({ ...bucket })),
    })),
    lookups: inspection.lookups.map((lookup) => ({ ...lookup })),
  };
}

function cloneSpeedHistory(
  history: Extract<ViewSnapshot, { type: "session_speed_history" }>["history"],
): Extract<ViewSnapshot, { type: "session_speed_history" }>["history"] {
  return {
    ...history,
    series: history.series.map((series) => ({
      ...series,
      values: [...series.values],
    })),
    catalog: history.catalog.map((entry) => ({ ...entry })),
  };
}

function applySpeedHistoryAppend(
  history: SpeedHistoryView,
  append: SpeedHistoryAppend,
): SpeedHistoryView {
  if (
    history.history_epoch !== append.history_epoch ||
    history.complete_through_millis !== append.base_complete_through_millis
  ) {
    throw new ViewSetContinuityError("speed history append does not continue its position");
  }
  const bucket = BigInt(history.bucket_millis);
  const base = BigInt(append.base_complete_through_millis);
  const through = BigInt(append.complete_through_millis);
  if (bucket === 0n || through < base || (through - base) % bucket !== 0n) {
    throw new ViewSetContinuityError("speed history append range is invalid");
  }
  const count = Number((through - base) / bucket);
  const window = history.series[0]?.values.length ?? 0;
  const expectedStart = through > bucket * BigInt(Math.max(0, window - 1))
    ? through - bucket * BigInt(Math.max(0, window - 1))
    : 0n;
  if (
    count > window ||
    BigInt(append.start_millis) !== expectedStart ||
    (count === 0 && (append.persistence == null || append.series.length !== 0)) ||
    (count !== 0 && append.series.length !== history.series.length)
  ) {
    throw new ViewSetContinuityError("speed history append shape is invalid");
  }
  if (
    count !== 0 &&
    history.series.some((series, index) => {
      const update = append.series[index];
      return update?.metric !== series.metric || update.values.length !== count;
    })
  ) {
    throw new ViewSetContinuityError("speed history append series are incompatible");
  }
  return {
    ...history,
    captured_millis: append.captured_millis,
    start_millis: append.start_millis,
    complete_through_millis: append.complete_through_millis,
    persistence: append.persistence ?? history.persistence,
    series: history.series.map((series, index) => ({
      ...series,
      values: count === 0
        ? [...series.values]
        : [...series.values.slice(count), ...append.series[index]!.values],
    })),
    catalog: history.catalog.map((entry) => ({ ...entry })),
  };
}

function mergeDiagnostics(
  previous: readonly DiagnosticEvent[],
  updates: readonly DiagnosticEvent[],
): DiagnosticEvent[] {
  const events = new Map(previous.map((event) => [event.sequence, event]));
  for (const event of updates) events.set(event.sequence, event);
  return [...events.values()]
    .sort((left, right) =>
      BigInt(left.sequence) < BigInt(right.sequence) ? -1 : 1,
    )
    .slice(-2_048);
}

function insertRange(
  ranges: readonly IndexRange[],
  inserted: IndexRange,
): IndexRange[] {
  const output: IndexRange[] = [];
  let merged = { ...inserted };
  let placed = false;
  for (const range of ranges) {
    if (range.end_exclusive < merged.start) {
      output.push(range);
    } else if (merged.end_exclusive < range.start) {
      if (!placed) {
        output.push(merged);
        placed = true;
      }
      output.push(range);
    } else {
      merged = {
        start: Math.min(merged.start, range.start),
        end_exclusive: Math.max(merged.end_exclusive, range.end_exclusive),
      };
    }
  }
  if (!placed) output.push(merged);
  return output;
}

function removeRange(
  ranges: readonly IndexRange[],
  removed: IndexRange,
): IndexRange[] {
  const output: IndexRange[] = [];
  for (const range of ranges) {
    if (
      range.end_exclusive <= removed.start ||
      range.start >= removed.end_exclusive
    ) {
      output.push(range);
      continue;
    }
    if (range.start < removed.start) {
      output.push({ start: range.start, end_exclusive: removed.start });
    }
    if (range.end_exclusive > removed.end_exclusive) {
      output.push({
        start: removed.end_exclusive,
        end_exclusive: range.end_exclusive,
      });
    }
  }
  return output;
}
