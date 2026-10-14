import type {
  ActivePiece,
  ApiErrorEnvelope,
  ApiHello,
  ApplicationServerFrame,
  ChooseDownloadRootResponse,
  IndexRange,
  MediaUrlResponse,
  OpenViewSetResponse,
  ResponseEnvelope,
  ServiceSnapshot,
  TorrentListImportReport,
  TorrentView,
  UpdateBatch,
  ViewPatch,
  ViewSnapshot,
  ViewUpdate,
} from "./api/generated/v1";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW,
} from "./api/generated/v1";
import { assertApiSchema, SchemaError } from "./api/schema";

const MAX_FRAME_BYTES = 512 * 1024;
const MAX_HTTP_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_APPLICATION_FRAME_BYTES = MAX_HTTP_RESPONSE_BYTES + 4 * 1024;
const MAX_MAGNET_BYTES = 16 * 1024;
const MAX_IMPORT_FAILURES = 4_096;
const MAX_IMPORT_FAILURE_NAME_BYTES = 64 * 1024;
const MAX_IMPORT_FAILURE_REASON_BYTES = 16 * 1024;
const MAX_COLLECTION = 100_000;
const MAX_ACTIVE_PEERS = 256;
const MAX_SWARM_PEERS = 1_000;
const PEER_FLAGS = [
  "incoming",
  "encrypted",
  "download_allowed",
  "download_choked",
  "upload_allowed",
  "upload_choked",
  "extension_protocol",
  "metadata_extension",
  "utp",
  "hole_punched",
  "on_parole",
  "optimistic_unchoke",
  "snubbed",
  "upload_only",
  "endgame",
  "seed",
] as const;
const MAX_FILE_CATALOG = 374_998;
const MAX_TRACKER_CATALOG = 999_994;
const MAX_CATALOG_PAGE_ROWS = 1_024;
const MAX_DISK_PIECES = 16_384;
const MAX_ACTIVE_PIECES = 16_384;
const DHT_BUCKETS = 160;
const DHT_BUCKET_CAPACITY = 8;
const MAX_DHT_TRANSACTIONS = 256;
const MAX_DHT_LOOKUPS_PER_FAMILY = 16;
const MAX_DHT_LOOKUPS = MAX_DHT_LOOKUPS_PER_FAMILY * 2;
const MAX_DHT_LOOKUP_CANDIDATES = 256;
const MAX_DHT_LOOKUP_PEERS = 200;
const MAX_DIAGNOSTIC_EVENTS = 2_048;
const MAX_DIAGNOSTIC_PATCH_EVENTS = 128;
const MAX_METADATA_BYTES = 30 * 1024 * 1024;
const METADATA_BLOCK_BYTES = 16 * 1024;
const MAX_METADATA_BLOCKS = MAX_METADATA_BYTES / METADATA_BLOCK_BYTES;
const MAX_U32 = 4_294_967_295;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const IDENTIFIER = /^[A-Za-z0-9._-]{1,128}$/;
const TORRENT_ID = /^t1-[0-9a-f]{32}$/;
const V1_INFO_HASH = /^[0-9a-f]{40}$/;
const V2_INFO_HASH = /^[0-9a-f]{64}$/;
const SHA1_HEX = /^[A-Fa-f0-9]{40}$/;
const DIAGNOSTIC_CATEGORY = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+){0,3}$/;
const DIAGNOSTIC_IDENTIFIER = /^[a-z0-9_.-]{1,48}$/;

import { ContractError } from "./api/errors";

export { ContractError };

function parseBoundedJson(source: string, maximum: number, label: string): unknown {
  if (new TextEncoder().encode(source).byteLength > maximum) {
    throw new ContractError(`${label} exceeds the client bound`);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new ContractError(`${label} is not valid JSON`);
  }
}

function generated<T>(definition: string, value: unknown): T {
  try {
    assertApiSchema<T>(definition, value);
    return value;
  } catch (error) {
    if (error instanceof SchemaError) {
      throw new ContractError(error.message);
    }
    throw error;
  }
}

export function decodeApiHello(source: string): ApiHello {
  const value = generated<ApiHello>(
    "ApiHello",
    parseBoundedJson(source, MAX_FRAME_BYTES, "API hello response"),
  );
  validateApiHello(value);
  return value;
}

function validateApiHello(value: ApiHello): void {
  if (value.api.minimum > 1 || value.api.current < 1) {
    throw new ContractError("API version 1 is not supported by the server");
  }
  decimal(value.limits.lease_millis, "view-set lease");
  boundedInteger(
    value.limits.max_view_sets_per_owner,
    "maximum view sets",
    1,
    65_535,
  );
  boundedInteger(value.limits.max_views_per_set, "maximum views", 1, 65_535);
  boundedInteger(
    value.limits.max_view_id_bytes,
    "maximum view ID bytes",
    1,
    65_535,
  );
  boundedInteger(value.limits.min_queue_bytes, "minimum queue bytes", 1, MAX_U32);
  boundedInteger(value.limits.max_queue_bytes, "maximum queue bytes", 1, MAX_U32);
  boundedInteger(
    value.limits.max_snapshot_bytes,
    "maximum snapshot bytes",
    value.limits.max_queue_bytes,
    MAX_U32,
  );
  boundedInteger(value.limits.max_wait_millis, "maximum wait", 0, MAX_U32);
  if (
    value.limits.min_queue_bytes > value.limits.default_queue_bytes ||
    value.limits.default_queue_bytes > value.limits.max_queue_bytes
  ) {
    throw new ContractError("API queue limits are inconsistent");
  }
}

export function decodeApplicationServerFrame(
  source: string,
): ApplicationServerFrame {
  const value = generated<ApplicationServerFrame>(
    "ApplicationServerFrame",
    parseBoundedJson(
      source,
      MAX_APPLICATION_FRAME_BYTES,
      "application WebSocket frame",
    ),
  );
  switch (value.type) {
    case "download_root_chosen":
      connectionIdentifier(value.call_id, "call ID");
      if (value.response.root !== null) validateStorageRoot(value.response.root);
      break;
    case "connected":
      if (value.api_version !== 1 || value.encoding !== "json") {
        throw new ContractError("unsupported application connection contract");
      }
      validateApiHello(value.hello);
      boundedInteger(
        value.connection_limits.max_attachments,
        "maximum attachments",
        1,
        65_535,
      );
      boundedInteger(
        value.connection_limits.max_pending_calls,
        "maximum pending calls",
        1,
        65_535,
      );
      boundedInteger(
        value.connection_limits.max_client_message_bytes,
        "maximum client message bytes",
        1,
        MAX_U32,
      );
      boundedInteger(
        value.connection_limits.max_application_payload_bytes,
        "maximum application payload bytes",
        1,
        MAX_U32,
      );
      boundedInteger(
        value.connection_limits.max_torrent_source_bytes,
        "maximum torrent source bytes",
        1,
        MAX_U32,
      );
      boundedInteger(
        value.connection_limits.heartbeat_idle_millis,
        "heartbeat idle",
        1,
        MAX_U32,
      );
      boundedInteger(
        value.connection_limits.heartbeat_timeout_millis,
        "heartbeat timeout",
        1,
        MAX_U32,
      );
      break;
    case "result":
      connectionIdentifier(value.call_id, "call ID");
      switch (value.result.type) {
        case "command_response":
          validateResponse(value.result.response);
          break;
        case "view_set_opened":
          validateOpenViewSetResponse(value.result.response);
          break;
        case "view_set_updated":
        case "view_set_closed":
          break;
        case "media_url":
          validateMediaUrlResponse(value.result.response);
          break;
      }
      break;
    case "call_error":
      connectionIdentifier(value.call_id, "call ID");
      validateApplicationConnectionError(value.error);
      break;
    case "torrent_upload_ready":
      connectionIdentifier(value.call_id, "call ID");
      connectionIdentifier(value.upload_id, "upload ID");
      break;
    case "attached":
      connectionIdentifier(value.call_id, "call ID");
      connectionIdentifier(value.stream_id, "stream ID");
      identifier(value.view_set_id, "view-set ID");
      break;
    case "view_batch":
      connectionIdentifier(value.stream_id, "stream ID");
      validateUpdateBatch(value.batch);
      break;
    case "stream_error":
      connectionIdentifier(value.stream_id, "stream ID");
      validateApplicationConnectionError(value.error);
      break;
    case "detached":
      connectionIdentifier(value.call_id, "call ID");
      connectionIdentifier(value.stream_id, "stream ID");
      break;
    case "connection_error":
      validateApplicationConnectionError(value.error);
      break;
  }
  return value;
}

export function decodeResponseEnvelope(source: string): ResponseEnvelope {
  const value = generated<ResponseEnvelope>(
    "ResponseEnvelope",
    parseBoundedJson(source, MAX_FRAME_BYTES, "command response"),
  );
  validateResponse(value);
  return value;
}

export function decodeApiErrorEnvelope(source: string): ApiErrorEnvelope {
  const value = generated<ApiErrorEnvelope>(
    "ApiErrorEnvelope",
    parseBoundedJson(source, MAX_FRAME_BYTES, "API error response"),
  );
  boundedString(value.error.message, "API error message", 1_024);
  return value;
}

export function decodeChooseDownloadRootResponse(
  source: string,
): ChooseDownloadRootResponse {
  const value = generated<ChooseDownloadRootResponse>(
    "ChooseDownloadRootResponse",
    parseBoundedJson(source, MAX_FRAME_BYTES, "download folder response"),
  );
  if (value.root !== null) validateStorageRoot(value.root);
  return value;
}

export function decodeMediaUrlResponse(source: string): MediaUrlResponse {
  const value = generated<MediaUrlResponse>(
    "MediaUrlResponse",
    parseBoundedJson(source, MAX_FRAME_BYTES, "media URL response"),
  );
  validateMediaUrlResponse(value);
  return value;
}

function validateMediaUrlResponse(value: MediaUrlResponse): void {
  torrentId(value.torrent_id);
  boundedInteger(value.file_index, "media file index", 0, MAX_U32);
  if (value.outcome.type === "created") {
    const source = boundedUtf8String(value.outcome.url, "media URL", 1_024);
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new ContractError("media URL is invalid");
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^\/media\/v1\/[A-Za-z0-9_-]{43}$/.test(url.pathname)
    ) {
      throw new ContractError("media URL is not a bounded HTTP capability");
    }
    decimal(value.outcome.idle_timeout_millis, "media URL idle timeout");
    decimal(value.outcome.absolute_timeout_millis, "media URL absolute timeout");
  }
}

/**
 * Tactical 348 bundle import report. The type is not in the generated
 * schema, so this checks it by hand with the engine's own bounds.
 */
export function decodeTorrentListImportReport(
  source: string,
): TorrentListImportReport {
  return validateTorrentListImportReport(
    parseBoundedJson(source, MAX_HTTP_RESPONSE_BYTES, "torrent list import report"),
  );
}

export function validateTorrentListImportReport(
  value: unknown,
): TorrentListImportReport {
  const report = exactRecord(
    value,
    "torrent list import report",
    ["added", "already_present", "failed"],
  );
  const failed = report.failed;
  if (!Array.isArray(failed) || failed.length > MAX_IMPORT_FAILURES) {
    throw new ContractError("torrent list import failures must be a bounded array");
  }
  return {
    added: boundedInteger(report.added, "torrent list import added", 0, MAX_U32),
    already_present: boundedInteger(
      report.already_present,
      "torrent list import already present",
      0,
      MAX_U32,
    ),
    failed: failed.map((entry) => {
      const failure = exactRecord(entry, "torrent list import failure", ["name", "reason"]);
      return {
        name: boundedUtf8String(
          failure.name,
          "torrent list import failure name",
          MAX_IMPORT_FAILURE_NAME_BYTES,
        ),
        reason: boundedUtf8String(
          failure.reason,
          "torrent list import failure reason",
          MAX_IMPORT_FAILURE_REASON_BYTES,
        ),
      };
    }),
  };
}

function exactRecord(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  const record = asRecord(value, label);
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new ContractError(`${label} has unknown field ${key}`);
  }
  for (const key of keys) {
    if (!(key in record)) throw new ContractError(`${label} is missing ${key}`);
  }
  return record;
}

export function decodeOpenViewSetResponse(source: string): OpenViewSetResponse {
  const value = generated<OpenViewSetResponse>(
    "OpenViewSetResponse",
    parseBoundedJson(source, MAX_HTTP_RESPONSE_BYTES, "open view-set response"),
  );
  validateOpenViewSetResponse(value);
  return value;
}

function validateOpenViewSetResponse(value: OpenViewSetResponse): void {
  identifier(value.view_set_id, "view-set ID");
  decimal(value.lease_millis, "view-set lease");
  boundedInteger(value.effective_queue_bytes, "view-set queue bytes", 1, MAX_U32);
  validateUpdateBatch(value.initial);
  if (value.initial.view_set_id !== value.view_set_id) {
    throw new ContractError("initial batch belongs to another view set");
  }
}

export function decodeUpdateBatch(source: string): UpdateBatch {
  const value = generated<UpdateBatch>(
    "UpdateBatch",
    parseBoundedJson(source, MAX_HTTP_RESPONSE_BYTES, "view-set update response"),
  );
  validateUpdateBatch(value);
  return value;
}

function validateUpdateBatch(batch: UpdateBatch): void {
  if (batch.api_version !== 1) {
    throw new ContractError("unsupported application API version");
  }
  identifier(batch.view_set_id, "view-set ID");
  decimal(batch.epoch, "view-set epoch");
  decimal(batch.base_cursor, "view-set base cursor");
  decimal(batch.cursor, "view-set cursor");
  decimal(batch.durable_revision, "durable revision");
  decimal(batch.server_now_millis, "server monotonic time");
  const base = BigInt(batch.base_cursor);
  const cursor = BigInt(batch.cursor);
  if (
    (batch.updates.length === 0 && cursor !== base) ||
    (batch.updates.length > 0 && cursor <= base)
  ) {
    throw new ContractError("view-set batch cursor does not match its updates");
  }
  for (const update of batch.updates) {
    if ("view_id" in update && update.view_id !== null) {
      identifier(update.view_id, "view ID");
    }
    switch (update.type) {
      case "snapshot":
        validateViewSnapshot(update.snapshot);
        break;
      case "patch":
        validateViewPatch(update.patch);
        break;
      case "view_removed":
      case "reset_required":
        break;
    }
  }
}

function connectionIdentifier(value: unknown, label: string): string {
  const parsed = boundedString(value, label, 64);
  if (!/^[A-Za-z0-9._-]+$/.test(parsed)) {
    throw new ContractError(`${label} is invalid`);
  }
  return parsed;
}

function validateApplicationConnectionError(value: {
  readonly code: string;
  readonly message: string;
}): void {
  oneOf(value.code, "application connection error code", [
    "authentication_failed",
    "invalid_version",
    "invalid_message",
    "invalid_call",
    "resource_limit",
    "unknown_view_set",
    "consumer_busy",
    "view_set_closed",
    "unknown_stream",
    "invalid_cursor",
    "response_too_large",
    "internal",
  ]);
  boundedString(value.message, "application connection error message", 1_024);
}

function validateResponse(value: unknown): void {
  const response = asRecord(value, "response");
  boundedInteger(response.version, "control version", 1, 65_535);
  identifier(response.request_id, "request ID");
  decimal(response.revision, "revision");
  const status = string(response.status, "response status");
  if (status === "success") {
    validateServiceSnapshot(response.snapshot);
    if (response.result !== undefined) {
      const result = asRecord(response.result, "command result");
      if (result.type === "export_magnet") {
        const magnet = asRecord(result.result, "magnet export result");
        boundedUtf8String(magnet.magnet, "exported magnet", MAX_MAGNET_BYTES);
        oneOf(magnet.source, "magnet export source", [
          "verbatim",
          "canonicalized",
          "synthesized",
        ]);
        boundedInteger(
          magnet.omitted_tracker_count,
          "omitted tracker count",
          0,
          MAX_U32,
        );
      }
    }
  } else if (status === "error") {
    const error = asRecord(response.error, "control error");
    boundedString(error.code, "control error code", 64);
    boundedString(error.message, "control error message", 1_024);
  } else {
    throw new ContractError("unknown response status");
  }
}

function boundedUtf8String(value: unknown, label: string, maximum: number): string {
  const parsed = string(value, label);
  if (new TextEncoder().encode(parsed).byteLength > maximum) {
    throw new ContractError(`${label} exceeds ${maximum} UTF-8 bytes`);
  }
  return parsed;
}

function validateServiceSnapshot(value: unknown): void {
  const snapshot = asRecord(value, "service snapshot");
  snapshot.client_settings ??= structuredClone(DEFAULT_CLIENT_SETTINGS);
  identifier(snapshot.profile_id, "profile ID");
  decimal(snapshot.revision, "snapshot revision");
  validateStorageSettings(snapshot.storage);
  validateClientSettings(snapshot.client_settings);
  const torrents = array(snapshot.torrents, "torrent snapshots");
  for (const item of torrents) {
    const torrent = asRecord(item, "torrent snapshot");
    torrentId(torrent.torrent_id);
    validateProtocolIdentities(torrent.protocol_identities);
    identifier(torrent.storage_root, "storage root");
    boundedString(torrent.state, "torrent state", 32);
    boundedString(torrent.storage_state, "storage state", 32);
    boolean(torrent.metadata_available, "metadata available");
    boolean(torrent.awaiting_file_selection, "awaiting file selection");
    optionalInteger(
      torrent.pending_file_selection_position,
      "pending file selection position",
      500,
    );
    optionalString(torrent.file_catalog_id, "file catalog identity", 64);
    boundedInteger(torrent.selectable_file_count, "selectable file count", 0, 374_998);
    boundedInteger(torrent.selected_file_count, "selected file count", 0, 374_998);
    decimal(torrent.selectable_file_bytes, "selectable file bytes");
    decimal(torrent.selected_file_bytes, "selected file bytes");
    boundedInteger(torrent.piece_count, "piece count", 0, MAX_U32);
    boundedInteger(
      torrent.verified_piece_count,
      "verified piece count",
      0,
      MAX_U32,
    );
    array(torrent.skip_files, "skipped files").forEach((index) =>
      boundedInteger(index, "file index", 0, MAX_U32),
    );
    array(torrent.high_priority_files, "high-priority files").forEach((index) =>
      boundedInteger(index, "file priority index", 0, MAX_U32),
    );
    optionalString(torrent.error, "torrent error", 1_024);
  }
}

function validateUpdate(value: unknown): void {
  const update = asRecord(value, "view update");
  if (update.contract_version !== 2) {
    throw new ContractError("unsupported view contract version");
  }
  decimal(update.stream_id, "stream ID");
  decimal(update.epoch, "stream epoch");
  decimal(update.sequence, "stream sequence");
  decimal(update.base_revision, "base revision");
  decimal(update.revision, "view revision");
  switch (string(update.type, "view update type")) {
    case "snapshot":
      validateViewSnapshot(update.snapshot);
      break;
    case "patch":
      validateViewPatch(update.patch);
      break;
    case "reset_required":
      break;
    default:
      throw new ContractError("unknown view update type");
  }
}

function validateDhtInspection(value: unknown): void {
  const inspection = asRecord(value, "DHT inspection");
  oneOf(inspection.lifecycle, "DHT lifecycle", [
    "offline",
    "bootstrap_empty",
    "participating",
    "inactive",
  ]);
  oneOf(inspection.network_policy, "DHT network policy", [
    "offline",
    "loopback_only",
    "online",
  ]);
  decimal(inspection.captured_millis, "DHT capture time");
  const activeTransactions = boundedInteger(
    inspection.active_transactions,
    "DHT active transactions",
    0,
    MAX_DHT_TRANSACTIONS * 2,
  );
  const activeLookups = boundedInteger(
    inspection.active_lookups,
    "DHT active lookups",
    0,
    MAX_DHT_LOOKUPS,
  );
  for (const [field, label] of [
    ["queries_sent", "queries sent"],
    ["responses_received", "responses received"],
    ["queries_received", "queries received"],
    ["malformed_received", "malformed datagrams"],
    ["family_mismatched", "family-mismatched datagrams"],
    ["rate_limited", "rate-limited datagrams"],
    ["discovered_peers", "discovered peers"],
    ["bootstrap_attempts", "bootstrap attempts"],
    ["routing_refreshes", "routing refreshes"],
    ["datagram_bytes_sent", "datagram bytes sent"],
    ["datagram_bytes_received", "datagram bytes received"],
    ["announces_sent", "announces sent"],
    ["announces_succeeded", "announces succeeded"],
    ["announces_failed", "announces failed"],
  ] as const) {
    decimal(inspection[field], `DHT ${label}`);
  }

  const families = array(inspection.families, "DHT address families");
  if (families.length > 2) {
    throw new ContractError("DHT inspection contains too many address families");
  }
  const familyNames = new Set<string>();
  let countedActiveTransactions = 0;
  let countedActiveLookups = 0;
  const familyLookupCounts = new Map<string, number>();
  for (const value of families) {
    const family = asRecord(value, "DHT address family");
    const familyName = oneOf(family.family, "DHT address family", ["ipv4", "ipv6"]);
    if (familyNames.has(familyName)) {
      throw new ContractError("DHT address families must be unique");
    }
    familyNames.add(familyName);
    oneOf(family.lifecycle, "DHT family lifecycle", [
      "offline",
      "bootstrap_empty",
      "participating",
      "inactive",
    ]);
    sha1Hex(family.local_node_id, "DHT local node ID");
    boundedString(family.local_address, "DHT local address", 64);
    if (family.observed_external_address !== null) {
      boundedString(
        family.observed_external_address,
        "DHT observed external address",
        64,
      );
    }
    const routingNodes = boundedInteger(
      family.routing_nodes,
      "DHT routing nodes",
      0,
      DHT_BUCKETS * DHT_BUCKET_CAPACITY,
    );
    const occupiedBuckets = boundedInteger(
      family.occupied_buckets,
      "DHT occupied buckets",
      0,
      DHT_BUCKETS,
    );
    const deepest = family.deepest_shared_prefix_bits === null
      ? null
      : boundedInteger(
          family.deepest_shared_prefix_bits,
          "DHT deepest shared prefix",
          0,
          159,
        );
    countedActiveTransactions += boundedInteger(
      family.active_transactions,
      "DHT family active transactions",
      0,
      MAX_DHT_TRANSACTIONS,
    );
    const familyActiveLookups = boundedInteger(
      family.active_lookups,
      "DHT family active lookups",
      0,
      MAX_DHT_LOOKUPS_PER_FAMILY,
    );
    countedActiveLookups += familyActiveLookups;
    familyLookupCounts.set(familyName, familyActiveLookups);
    for (const [field, label] of [
      ["queries_sent", "queries sent"],
      ["responses_received", "responses received"],
      ["queries_received", "queries received"],
      ["malformed_received", "malformed datagrams"],
      ["family_mismatched", "family-mismatched datagrams"],
      ["rate_limited", "rate-limited datagrams"],
      ["discovered_peers", "discovered peers"],
      ["bootstrap_attempts", "bootstrap attempts"],
      ["routing_refreshes", "routing refreshes"],
      ["datagram_bytes_sent", "datagram bytes sent"],
      ["datagram_bytes_received", "datagram bytes received"],
      ["announces_sent", "announces sent"],
      ["announces_succeeded", "announces succeeded"],
      ["announces_failed", "announces failed"],
    ] as const) {
      decimal(family[field], `DHT ${familyName} ${label}`);
    }

    const buckets = array(family.buckets, `DHT ${familyName} buckets`);
    if (buckets.length !== DHT_BUCKETS) {
      throw new ContractError("DHT family must contain exactly 160 buckets");
    }
    let countedNodes = 0;
    let countedOccupied = 0;
    let countedDeepest: number | null = null;
    buckets.forEach((bucketValue, index) => {
      const bucket = asRecord(bucketValue, "DHT bucket");
      if (boundedInteger(bucket.bucket_index, "DHT bucket index", 0, 159) !== index) {
        throw new ContractError("DHT buckets are not in exact engine index order");
      }
      const good = boundedInteger(
        bucket.good_nodes,
        "DHT good nodes",
        0,
        DHT_BUCKET_CAPACITY,
      );
      const questionable = boundedInteger(
        bucket.questionable_nodes,
        "DHT questionable nodes",
        0,
        DHT_BUCKET_CAPACITY,
      );
      boundedInteger(
        bucket.replacement_candidates,
        "DHT replacement candidates",
        0,
        DHT_BUCKET_CAPACITY,
      );
      if (good + questionable > DHT_BUCKET_CAPACITY) {
        throw new ContractError("DHT live bucket occupancy exceeds K=8");
      }
      const live = good + questionable;
      if ((bucket.oldest_live_response_age_millis === null) !== (live === 0)) {
        throw new ContractError("DHT bucket freshness does not match live occupancy");
      }
      if (bucket.oldest_live_response_age_millis !== null) {
        decimal(bucket.oldest_live_response_age_millis, "DHT oldest response age");
      }
      countedNodes += live;
      if (live > 0) {
        countedOccupied += 1;
        countedDeepest = Math.max(countedDeepest ?? 0, 159 - index);
      }
    });
    if (countedNodes !== routingNodes || countedOccupied !== occupiedBuckets) {
      throw new ContractError("DHT routing aggregates do not match bucket occupancy");
    }
    if (countedDeepest !== deepest) {
      throw new ContractError("DHT deepest prefix does not match bucket occupancy");
    }
  }
  if (countedActiveTransactions !== activeTransactions) {
    throw new ContractError("DHT family transaction gauges do not match the aggregate");
  }
  if (countedActiveLookups !== activeLookups) {
    throw new ContractError("DHT family lookup gauges do not match the aggregate");
  }

  const lookups = array(inspection.lookups, "DHT lookups");
  if (lookups.length !== activeLookups || lookups.length > MAX_DHT_LOOKUPS) {
    throw new ContractError("DHT lookup rows do not match the active lookup gauge");
  }
  const lookupIds = new Set<string>();
  const countedLookupsByFamily = new Map<string, number>();
  for (const value of lookups) {
    const lookup = asRecord(value, "DHT lookup");
    const family = oneOf(lookup.family, "DHT lookup address family", ["ipv4", "ipv6"]);
    if (!familyNames.has(family)) {
      throw new ContractError("DHT lookup references an inactive address family");
    }
    const lookupId = decimal(lookup.lookup_id, "DHT lookup ID");
    const familyLookupId = `${family}:${lookupId}`;
    if (lookupIds.has(familyLookupId)) {
      throw new ContractError("DHT lookup IDs must be unique within an address family");
    }
    lookupIds.add(familyLookupId);
    countedLookupsByFamily.set(family, (countedLookupsByFamily.get(family) ?? 0) + 1);
    sha1Hex(lookup.target_id, "DHT lookup target ID");
    decimal(lookup.age_millis, "DHT lookup age");
    decimal(lookup.deadline_in_millis, "DHT lookup deadline");
    let candidateCount = 0;
    for (const [field, label] of [
      ["unqueried_candidates", "unqueried candidates"],
      ["in_flight_candidates", "in-flight candidates"],
      ["responded_candidates", "responded candidates"],
      ["failed_candidates", "failed candidates"],
    ] as const) {
      candidateCount += boundedInteger(
        lookup[field],
        `DHT ${label}`,
        0,
        MAX_DHT_LOOKUP_CANDIDATES,
      );
    }
    if (candidateCount > MAX_DHT_LOOKUP_CANDIDATES) {
      throw new ContractError("DHT lookup candidates exceed their fixed bound");
    }
    boundedInteger(
      lookup.discovered_peers,
      "DHT lookup discovered peers",
      0,
      MAX_DHT_LOOKUP_PEERS,
    );
    if (lookup.closest_responded_prefix_bits !== null) {
      boundedInteger(
        lookup.closest_responded_prefix_bits,
        "DHT closest responded prefix",
        0,
        160,
      );
    }
    if (lookup.last_convergence_improvement_age_millis !== null) {
      decimal(
        lookup.last_convergence_improvement_age_millis,
        "DHT convergence improvement age",
      );
    }
  }
  for (const family of familyNames) {
    if ((countedLookupsByFamily.get(family) ?? 0) !== familyLookupCounts.get(family)) {
      throw new ContractError("DHT lookup rows do not match the family lookup gauge");
    }
  }
}

function validateTorrentPreparation(value: unknown): void {
  if (value === null) return;
  const preparation = asRecord(value, "torrent preparation");
  decimal(preparation.generation, "preparation generation");
  const metadata = preparation.metadata;
  const integrity = preparation.integrity;
  if ((metadata === undefined || metadata === null) &&
      (integrity === undefined || integrity === null)) {
    throw new ContractError("torrent preparation has no active phase");
  }

  if (metadata !== undefined && metadata !== null) {
    const current = asRecord(metadata, "metadata acquisition");
    const phase = oneOf(current.phase, "metadata acquisition phase", [
      "discovering",
      "downloading",
    ]);
    const receivedBytes = Number(decimal(current.received_bytes, "metadata received bytes"));
    if (!Number.isSafeInteger(receivedBytes) || receivedBytes > MAX_METADATA_BYTES) {
      throw new ContractError("metadata received bytes exceed their bound");
    }
    const blockCount = boundedInteger(
      current.block_count,
      "metadata block count",
      0,
      MAX_METADATA_BLOCKS,
    );
    boundedInteger(current.active_peers, "active metadata peers", 0, 200);
    boundedInteger(current.requests_in_flight, "metadata requests in flight", 0, 400);
    boundedInteger(current.hash_retries, "metadata hash retries", 0, MAX_U32);
    const encoded = boundedString(current.block_states, "metadata block states", 640);
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new ContractError("metadata block states are not padded base64");
    }
    let binary: string;
    try {
      binary = atob(encoded);
    } catch {
      throw new ContractError("metadata block states are not valid base64");
    }
    if (btoa(binary) !== encoded || binary.length !== Math.ceil(blockCount / 4)) {
      throw new ContractError("metadata block states have invalid canonical geometry");
    }

    const totalValue = current.total_size_bytes;
    if (totalValue === undefined || totalValue === null) {
      if (
        phase !== "discovering" ||
        receivedBytes !== 0 ||
        blockCount !== 0 ||
        binary.length !== 0
      ) {
        throw new ContractError("unknown metadata geometry contains invented progress");
      }
    } else {
      const totalBytes = Number(decimal(totalValue, "metadata total size"));
      if (
        !Number.isSafeInteger(totalBytes) ||
        totalBytes < 1 ||
        totalBytes > MAX_METADATA_BYTES ||
        phase !== "downloading" ||
        blockCount !== Math.ceil(totalBytes / METADATA_BLOCK_BYTES)
      ) {
        throw new ContractError("metadata total and block geometry disagree");
      }
      let countedBytes = 0;
      for (let index = 0; index < binary.length * 4; index += 1) {
        const byte = binary.charCodeAt(Math.floor(index / 4));
        const state = (byte >> ((index % 4) * 2)) & 0b11;
        if (index >= blockCount) {
          if (state !== 0) {
            throw new ContractError("metadata block-state padding is not zero");
          }
        } else if (state === 0b11) {
          throw new ContractError("metadata block state uses a reserved value");
        } else if (state === 0b10) {
          countedBytes += Math.min(
            METADATA_BLOCK_BYTES,
            totalBytes - index * METADATA_BLOCK_BYTES,
          );
        }
      }
      if (countedBytes !== receivedBytes) {
        throw new ContractError("metadata byte count disagrees with received blocks");
      }
    }
  }

  if (integrity !== undefined && integrity !== null) {
    const current = asRecord(integrity, "integrity preparation");
    const phase = oneOf(current.phase, "integrity preparation phase", [
      "acquiring",
      "waiting_for_peer",
    ]);
    const needed = boundedInteger(
      current.needed_hash_ranges,
      "needed hash ranges",
      1,
      MAX_U32,
    );
    const active = boundedInteger(
      current.active_requests,
      "active hash requests",
      0,
      MAX_U32,
    );
    if (needed === 0 || (phase === "acquiring" ? active === 0 : active !== 0)) {
      throw new ContractError("integrity preparation phase and requests disagree");
    }
  }
}

function validateViewSnapshot(value: unknown): void {
  const snapshot = asRecord(value, "view snapshot");
  if (snapshot.type === "torrent_list") {
    snapshot.client_settings ??= structuredClone(
      DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW,
    );
  }
  switch (string(snapshot.type, "view snapshot type")) {
    case "torrent_list":
      array(snapshot.torrents, "torrent list").forEach(validateTorrentView);
      validateStorageSettings(snapshot.storage);
      validateClientSettingsRuntime(snapshot.client_settings);
      break;
    case "torrent":
      if (snapshot.torrent !== null) validateTorrentView(snapshot.torrent);
      break;
    case "torrent_preparation":
      torrentId(snapshot.torrent_id);
      validateTorrentPreparation(snapshot.preparation);
      break;
    case "piece_activity": {
      torrentId(snapshot.torrent_id);
      const pieceCount = boundedInteger(
        snapshot.piece_count,
        "piece count",
        0,
        MAX_U32,
      );
      validateRanges(snapshot.verified, pieceCount, "verified pieces");
      validateActivePieces(snapshot.active, pieceCount, "active pieces");
      break;
    }
    case "session_disk": {
      validateDiskPipeline(snapshot.pipeline);
      const pieces = array(snapshot.pieces, "active disk pieces");
      if (pieces.length > MAX_DISK_PIECES) {
        throw new ContractError("disk piece view exceeds its row bound");
      }
      pieces.forEach(validateDiskPiece);
      break;
    }
    case "session_dht":
      validateDhtInspection(snapshot.inspection);
      break;
    case "session_current_rates":
      validateCurrentRates(snapshot.rates);
      break;
    case "session_speed_history":
      validateSpeedHistory(snapshot.history);
      break;
    case "peers": {
      const owningTorrent = string(snapshot.torrent_id, "peer-view torrent ID");
      torrentId(owningTorrent);
      const peers = array(snapshot.peers, "active peers");
      if (peers.length > MAX_ACTIVE_PEERS) {
        throw new ContractError("active peer view exceeds its row bound");
      }
      peers.forEach((peer) => validatePeerView(peer, owningTorrent));
      break;
    }
    case "swarm": {
      const owningTorrent = string(snapshot.torrent_id, "swarm-view torrent ID");
      torrentId(owningTorrent);
      const state = oneOf(snapshot.state, "swarm catalog state", [
        "active",
        "inactive",
        "torrent_missing",
      ]);
      decimal(snapshot.captured_millis, "swarm capture time");
      const maximumRecords = boundedInteger(
        snapshot.maximum_records,
        "swarm record maximum",
        0,
        MAX_SWARM_PEERS,
      );
      const peers = array(snapshot.peers, "swarm peers");
      if (peers.length > maximumRecords) {
        throw new ContractError("swarm view exceeds its row bound");
      }
      peers.forEach((peer) => validateSwarmPeerView(peer, owningTorrent));
      const total = validateSwarmCounts(snapshot.counts, peers.length);
      if (state !== "active" && peers.length !== 0) {
        throw new ContractError("inactive swarm catalog contains rows");
      }
      if (state !== "active" && total !== 0) {
        throw new ContractError("inactive swarm catalog contains nonzero counts");
      }
      break;
    }
    case "files": {
      torrentId(snapshot.torrent_id);
      oneOf(snapshot.state, "file catalog state", [
        "metadata_pending",
        "available",
        "torrent_missing",
      ]);
      optionalString(snapshot.filesystem_content_base, "filesystem content base", 16_384);
      const page = validateCatalogPage(snapshot.page, MAX_FILE_CATALOG);
      const files = array(snapshot.files, "torrent files");
      if (
        files.length !==
        Math.min(page.limit, Math.max(0, page.total - page.offset))
      ) {
        throw new ContractError("file view does not match its declared page");
      }
      files.forEach(validateFileView);
      files.forEach((value) => {
        const file = asRecord(value, "file view");
        const index = boundedInteger(
          file.file_index,
          "file index",
          0,
          MAX_FILE_CATALOG - 1,
        );
        if (
          index < page.offset ||
          index >= page.offset + page.limit
        ) {
          throw new ContractError("file view is outside its declared page");
        }
      });
      if (snapshot.state !== "available" && files.length !== 0) {
        throw new ContractError("unavailable file catalog contains rows");
      }
      break;
    }
    case "media": {
      torrentId(snapshot.torrent_id);
      const state = oneOf(snapshot.state, "media catalog state", [
        "metadata_pending",
        "available",
        "torrent_missing",
      ]);
      const totalFiles = boundedInteger(
        snapshot.total_non_padding_files,
        "non-padding file count",
        0,
        MAX_FILE_CATALOG,
      );
      const items = array(snapshot.items, "media items");
      if (items.length > totalFiles) {
        throw new ContractError("media item count exceeds the file catalog");
      }
      items.forEach(validateMediaItemView);
      if (state !== "available" && (items.length !== 0 || totalFiles !== 0)) {
        throw new ContractError("unavailable media catalog contains rows");
      }
      break;
    }
    case "trackers": {
      torrentId(snapshot.torrent_id);
      oneOf(snapshot.state, "tracker catalog state", [
        "available",
        "torrent_missing",
      ]);
      const page = validateCatalogPage(snapshot.page, MAX_TRACKER_CATALOG);
      const trackers = array(snapshot.trackers, "torrent trackers");
      if (
        trackers.length !==
        Math.min(page.limit, Math.max(0, page.total - page.offset))
      ) {
        throw new ContractError("tracker view does not match its declared page");
      }
      trackers.forEach(validateTrackerView);
      if (snapshot.state !== "available" && trackers.length !== 0) {
        throw new ContractError("unavailable tracker catalog contains rows");
      }
      break;
    }
    case "diagnostics": {
      const events = array(snapshot.events, "diagnostic events");
      if (events.length > MAX_DIAGNOSTIC_EVENTS) {
        throw new ContractError("diagnostic snapshot exceeds its event bound");
      }
      events.forEach(validateDiagnosticEvent);
      validateDiagnosticRetention(snapshot.retention);
      break;
    }
    default:
      throw new ContractError("unknown view snapshot type");
  }
}

function validateViewPatch(value: unknown): void {
  const patch = asRecord(value, "view patch");
  switch (string(patch.type, "view patch type")) {
    case "torrent_list":
      array(patch.upsert, "torrent upserts").forEach(validateTorrentView);
      validateRowUpdates(patch.updates, "torrent", "torrent_id", torrentId, 35);
      array(patch.removed, "torrent removals").forEach(torrentId);
      validateDisjointRowOperations(
        patch.upsert,
        patch.updates,
        patch.removed,
        "torrent_id",
        "torrent",
      );
      if (patch.storage !== undefined && patch.storage !== null) {
        validateStorageSettings(patch.storage);
      }
      if (patch.client_settings !== undefined && patch.client_settings !== null) {
        validateClientSettingsRuntime(patch.client_settings);
      }
      break;
    case "torrent": {
      const change = asRecord(patch.change, "selected torrent change");
      if (change.change === "replace") {
        if (change.torrent !== null) validateTorrentView(change.torrent);
      } else if (change.change === "update") {
        validateRowUpdate(change.update, "torrent", "torrent_id", torrentId, 28);
      } else {
        throw new ContractError("unknown selected torrent change");
      }
      break;
    }
    case "torrent_preparation":
      torrentId(patch.torrent_id);
      validateTorrentPreparation(patch.preparation);
      break;
    case "piece_activity": {
      torrentId(patch.torrent_id);
      const pieceCount = boundedInteger(
        patch.piece_count,
        "piece count",
        0,
        MAX_U32,
      );
      validateRanges(patch.verified, pieceCount, "verified pieces");
      validateRanges(patch.cleared, pieceCount, "cleared pieces");
      validateActivePieces(patch.active_upsert, pieceCount, "active piece upserts");
      validateRowUpdates(
        patch.active_updates,
        "active piece",
        "piece_id",
        (value) => boundedString(value, "active piece ID", 64),
        6,
        MAX_ACTIVE_PIECES,
      );
      validatePieceIds(patch.active_removed, "active piece removals");
      validateDisjointRowOperations(
        patch.active_upsert,
        patch.active_updates,
        patch.active_removed,
        "piece_id",
        "active piece",
      );
      break;
    }
    case "session_disk": {
      validateDiskPipeline(patch.pipeline);
      const upserts = array(patch.upsert, "active disk piece upserts");
      if (upserts.length > MAX_DISK_PIECES) {
        throw new ContractError("disk piece patch exceeds its row bound");
      }
      upserts.forEach(validateDiskPiece);
      array(patch.removed, "active disk piece removals").forEach((rowId) =>
        boundedString(rowId, "disk piece row ID", 256),
      );
      break;
    }
    case "session_dht":
      validateDhtInspection(patch.inspection);
      break;
    case "session_current_rates":
      validateCurrentRates(patch.rates);
      break;
    case "session_speed_history":
      validateSpeedHistoryAppend(patch.append);
      break;
    case "peers": {
      const owningTorrent = string(patch.torrent_id, "peer-view torrent ID");
      torrentId(owningTorrent);
      const upserts = array(patch.upsert, "active peer upserts");
      if (upserts.length > MAX_ACTIVE_PEERS) {
        throw new ContractError("active peer patch exceeds its row bound");
      }
      upserts.forEach((peer) => validatePeerView(peer, owningTorrent));
      validateRowUpdates(
        patch.updates,
        "peer",
        "connection_id",
        (value) => decimal(value, "peer connection ID"),
        38,
        MAX_ACTIVE_PEERS,
      );
      array(patch.removed, "active peer removals").forEach((connection) =>
        decimal(connection, "peer connection ID"),
      );
      validateDisjointRowOperations(
        patch.upsert,
        patch.updates,
        patch.removed,
        "connection_id",
        "peer",
      );
      break;
    }
    case "swarm": {
      const owningTorrent = string(patch.torrent_id, "swarm-view torrent ID");
      torrentId(owningTorrent);
      oneOf(patch.state, "swarm catalog state", [
        "active",
        "inactive",
        "torrent_missing",
      ]);
      decimal(patch.captured_millis, "swarm capture time");
      const maximumRecords = boundedInteger(
        patch.maximum_records,
        "swarm record maximum",
        0,
        MAX_SWARM_PEERS,
      );
      const upserts = array(patch.upsert, "swarm peer upserts");
      if (upserts.length > maximumRecords) {
        throw new ContractError("swarm patch exceeds its row bound");
      }
      upserts.forEach((peer) => validateSwarmPeerView(peer, owningTorrent));
      array(patch.removed, "swarm peer removals").forEach((recordId) =>
        decimal(recordId, "swarm peer record ID"),
      );
      const total = validateSwarmCounts(patch.counts);
      if (patch.state !== "active" && (upserts.length !== 0 || total !== 0)) {
        throw new ContractError("inactive swarm patch contains rows or nonzero counts");
      }
      break;
    }
    case "files": {
      torrentId(patch.torrent_id);
      const upserts = array(patch.upsert, "file upserts");
      if (upserts.length > MAX_CATALOG_PAGE_ROWS) {
        throw new ContractError("file patch exceeds its row bound");
      }
      upserts.forEach(validateFileView);
      validateRowUpdates(
        patch.updates,
        "file",
        "file_id",
        (value) => decimal(value, "file ID"),
        4,
        MAX_CATALOG_PAGE_ROWS,
      );
      array(patch.removed, "file removals").forEach((fileId) =>
        decimal(fileId, "file ID"),
      );
      validateDisjointRowOperations(
        patch.upsert,
        patch.updates,
        patch.removed,
        "file_id",
        "file",
      );
      break;
    }
    case "media": {
      torrentId(patch.torrent_id);
      const upserts = array(patch.upsert, "media upserts");
      if (upserts.length > MAX_FILE_CATALOG) {
        throw new ContractError("media patch exceeds its row bound");
      }
      upserts.forEach(validateMediaItemView);
      array(patch.removed, "media removals").forEach((mediaId) =>
        decimal(mediaId, "media ID"),
      );
      validateDisjointRowOperations(
        patch.upsert,
        [],
        patch.removed,
        "media_id",
        "media",
      );
      break;
    }
    case "trackers": {
      torrentId(patch.torrent_id);
      const upserts = array(patch.upsert, "tracker upserts");
      if (upserts.length > MAX_CATALOG_PAGE_ROWS) {
        throw new ContractError("tracker patch exceeds its row bound");
      }
      upserts.forEach(validateTrackerView);
      array(patch.removed, "tracker removals").forEach((trackerId) =>
        boundedString(trackerId, "tracker ID", 2_048),
      );
      break;
    }
    case "diagnostics": {
      const events = array(patch.events, "diagnostic events");
      if (events.length > MAX_DIAGNOSTIC_PATCH_EVENTS) {
        throw new ContractError("diagnostic patch exceeds its event bound");
      }
      events.forEach(validateDiagnosticEvent);
      validateDiagnosticRetention(patch.retention);
      break;
    }
    default:
      throw new ContractError("unknown view patch type");
  }
}

function validateRowUpdates(
  value: unknown,
  label: string,
  idField: string,
  validateId: (value: unknown) => unknown,
  maximumFields: number,
  maximumRows = Number.MAX_SAFE_INTEGER,
): void {
  const updates = array(value, `${label} updates`);
  if (updates.length > maximumRows) {
    throw new ContractError(`${label} updates exceed their row bound`);
  }
  const identities = new Set<string>();
  for (const update of updates) {
    const row = validateRowUpdate(update, label, idField, validateId, maximumFields);
    const identity = string(row[idField], `${label} update identity`);
    if (identities.has(identity)) {
      throw new ContractError(`${label} updates contain duplicate rows`);
    }
    identities.add(identity);
  }
}

function validateRowUpdate(
  value: unknown,
  label: string,
  idField: string,
  validateId: (value: unknown) => unknown,
  maximumFields: number,
): Record<string, unknown> {
  const update = asRecord(value, `${label} update`);
  validateId(update[idField]);
  const fields = array(update.fields, `${label} update fields`);
  if (fields.length === 0 || fields.length > maximumFields) {
    throw new ContractError(`${label} update field count is invalid`);
  }
  const kinds = new Set<string>();
  for (const value of fields) {
    const field = asRecord(value, `${label} update field`);
    const kind = boundedString(field.field, `${label} update field kind`, 64);
    if (kinds.has(kind)) {
      throw new ContractError(`${label} update repeats field ${kind}`);
    }
    kinds.add(kind);
  }
  return update;
}

function validateDisjointRowOperations(
  upsertValue: unknown,
  updateValue: unknown,
  removedValue: unknown,
  idField: string,
  label: string,
): void {
  const identities = new Set<string>();
  const add = (identity: string) => {
    if (identities.has(identity)) {
      throw new ContractError(`${label} patch repeats a row operation`);
    }
    identities.add(identity);
  };
  array(upsertValue, `${label} upserts`).forEach((value) =>
    add(string(asRecord(value, `${label} upsert`)[idField], `${label} identity`)),
  );
  array(updateValue, `${label} updates`).forEach((value) =>
    add(string(asRecord(value, `${label} update`)[idField], `${label} identity`)),
  );
  array(removedValue, `${label} removals`).forEach((value) =>
    add(string(value, `${label} identity`)),
  );
}

const SPEED_METRICS = [
  "payload_received",
  "staged_write",
  "payload_verified",
  "peer_wire_received",
  "peer_wire_sent",
  "peer_protocol_received",
  "peer_protocol_sent",
  "metadata_payload_received",
  "metadata_payload_sent",
  "peer_unclassified_received",
  "peer_unclassified_sent",
  "dht_received",
  "dht_sent",
  "tracker_received",
  "tracker_sent",
  "logical_hash_read",
  "payload_redundant",
  "payload_hash_failed",
  "payload_uploaded",
] as const;

const SPEED_RANGE_GEOMETRY = {
  seconds30: { bucketMillis: 100n, count: 300, live: true },
  minutes2: { bucketMillis: 500n, count: 240, live: true },
  minutes10: { bucketMillis: 2_000n, count: 300, live: true },
  hour1: { bucketMillis: 10_000n, count: 360, live: true },
  hours24: { bucketMillis: 60_000n, count: 1_440, live: false },
  days30: { bucketMillis: 15n * 60_000n, count: 2_880, live: false },
  years2: { bucketMillis: 24n * 60n * 60_000n, count: 730, live: false },
} as const;

function validateSpeedHistory(value: unknown): void {
  const history = asRecord(value, "speed history");
  decimal(history.captured_millis, "speed capture time");
  boundedString(history.history_epoch, "speed history epoch", 128);
  const range = oneOf(history.range, "speed range", [
    "seconds30",
    "minutes2",
    "minutes10",
    "hour1",
    "hours24",
    "days30",
    "years2",
  ]);
  const bucketMillis = BigInt(decimal(history.bucket_millis, "speed bucket interval"));
  const start = BigInt(decimal(history.start_millis, "speed history start"));
  const completeThrough = BigInt(decimal(
    history.complete_through_millis,
    "speed complete-through time",
  ));
  const geometry = SPEED_RANGE_GEOMETRY[range];
  const historySpan = bucketMillis * BigInt(geometry.count - 1);
  const expectedStart = completeThrough > historySpan
    ? completeThrough - historySpan
    : 0n;
  if (
    bucketMillis !== geometry.bucketMillis ||
    start !== expectedStart ||
    history.live !== geometry.live
  ) {
    throw new ContractError("speed history geometry does not match its range");
  }
  if (typeof history.live !== "boolean") {
    throw new ContractError("speed live flag is not boolean");
  }
  oneOf(history.persistence, "speed persistence state", ["healthy", "degraded"]);
  const series = array(history.series, "speed series");
  if (series.length === 0 || series.length > 8) {
    throw new ContractError("speed history requires 1..=8 series");
  }
  let bucketCount: number | null = null;
  const selected = new Set<string>();
  for (const item of series) {
    const row = asRecord(item, "speed series");
    const metric = oneOf(row.metric, "speed metric", SPEED_METRICS);
    if (selected.has(metric)) throw new ContractError("speed series are duplicated");
    selected.add(metric);
    const values = array(row.values, "speed values");
    bucketCount ??= values.length;
    if (values.length !== bucketCount || values.length !== geometry.count) {
      throw new ContractError("speed series lengths are inconsistent or unbounded");
    }
    values.forEach((sample) => {
      if (sample !== null) decimal(sample, "speed bucket bytes");
    });
  }
  const catalog = array(history.catalog, "speed metric catalog");
  if (catalog.length > SPEED_METRICS.length) {
    throw new ContractError("speed metric catalog exceeds its bound");
  }
  const catalogMetrics = new Set<string>();
  for (const item of catalog) {
    const entry = asRecord(item, "speed metric availability");
    const metric = oneOf(entry.metric, "speed metric", SPEED_METRICS);
    if (catalogMetrics.has(metric)) {
      throw new ContractError("speed metric catalog is duplicated");
    }
    catalogMetrics.add(metric);
    if (typeof entry.available !== "boolean") {
      throw new ContractError("speed metric availability is not boolean");
    }
    optionalString(entry.reason, "speed metric unavailability reason", 256);
  }
}

function validateCurrentRates(value: unknown): void {
  const current = asRecord(value, "session current rates");
  decimal(current.captured_millis, "current-rate capture time");
  const rates = array(current.rates, "session current-rate values");
  if (rates.length === 0 || rates.length > SPEED_METRICS.length) {
    throw new ContractError("session current rates require bounded metrics");
  }
  const metrics = new Set<string>();
  for (const item of rates) {
    const rate = asRecord(item, "session current rate");
    const metric = oneOf(rate.metric, "speed metric", SPEED_METRICS);
    if (metrics.has(metric)) {
      throw new ContractError("session current-rate metrics are duplicated");
    }
    metrics.add(metric);
    if (rate.bytes !== null) decimal(rate.bytes, "session current-rate bytes");
  }
}

function validateSpeedHistoryAppend(value: unknown): void {
  const append = asRecord(value, "speed history append");
  decimal(append.captured_millis, "speed append capture time");
  boundedString(append.history_epoch, "speed history epoch", 128);
  const base = BigInt(decimal(
    append.base_complete_through_millis,
    "speed append base position",
  ));
  decimal(append.start_millis, "speed append window start");
  const through = BigInt(decimal(
    append.complete_through_millis,
    "speed append complete-through position",
  ));
  if (through < base) {
    throw new ContractError("speed history append moves backwards");
  }
  const persistence = append.persistence;
  if (persistence !== undefined && persistence !== null) {
    oneOf(persistence, "speed persistence state", ["healthy", "degraded"]);
  }
  const series = array(append.series, "speed history append series");
  if (series.length === 0) {
    if (persistence === undefined || persistence === null || through !== base) {
      throw new ContractError("empty speed append must change persistence only");
    }
    return;
  }
  if (series.length > 8 || through === base) {
    throw new ContractError("speed history append series are invalid");
  }
  const metrics = new Set<string>();
  let valueCount: number | null = null;
  for (const item of series) {
    const entry = asRecord(item, "speed history series append");
    const metric = oneOf(entry.metric, "speed metric", SPEED_METRICS);
    if (metrics.has(metric)) {
      throw new ContractError("speed history append metrics are duplicated");
    }
    metrics.add(metric);
    const values = array(entry.values, "speed history appended values");
    valueCount ??= values.length;
    if (values.length === 0 || values.length !== valueCount || values.length > 2_880) {
      throw new ContractError("speed history append lengths are invalid");
    }
    values.forEach((sample) => {
      if (sample !== null) decimal(sample, "speed appended bucket bytes");
    });
  }
}

function validateStorageSettings(value: unknown): void {
  const settings = asRecord(value, "storage settings");
  const roots = array(settings.roots, "storage roots");
  if (roots.length > 32) {
    throw new ContractError("storage roots exceed their bound");
  }
  const rootIds = new Set<string>();
  for (const item of roots) {
    const rootId = validateStorageRoot(item);
    if (rootIds.has(rootId)) {
      throw new ContractError("storage roots contain duplicate IDs");
    }
    rootIds.add(rootId);
  }
  if (settings.default_root !== undefined && settings.default_root !== null) {
    const defaultRoot = identifier(settings.default_root, "default storage root");
    if (!rootIds.has(defaultRoot)) {
      throw new ContractError("default storage root is not configured");
    }
  }
  boolean(settings.show_add_options, "show add options");
  boolean(settings.show_file_selection, "show file selection");
}

function validateClientSettings(value: unknown): void {
  const settings = asRecord(value, "client settings");
  const listener = asRecord(settings.listener, "listener policy");
  const listenerType = oneOf(listener.type, "listener policy type", [
    "disabled",
    "automatic_loopback",
    "fixed_loopback",
    "automatic_local_network",
    "fixed_local_network",
  ]);
  if (listenerType === "fixed_loopback" || listenerType === "fixed_local_network") {
    boundedInteger(listener.port, "fixed listener port", 1_024, 65_535);
  }
  boundedInteger(
    settings.preferred_listen_port,
    "preferred listener port",
    1_024,
    65_535,
  );
  oneOf(settings.port_mapping, "port mapping policy", ["disabled", "upnp"]);
  boundedInteger(
    settings.peer_connection_limit,
    "peer connection limit",
    1,
    2_000,
  );
  boundedInteger(settings.upload_slots, "upload slots", 0, 50);
  boundedInteger(settings.active_downloads, "active downloads", 1, 20);
  validateActiveSeedLimit(settings.active_seeds, "active seeds");
  boundedInteger(
    settings.share_ratio_limit_percent,
    "share ratio priority goal",
    0,
    2_147_483_647,
  );
  boundedInteger(
    settings.finished_download_ratio_limit_percent,
    "finished/download time priority goal",
    0,
    2_147_483_647,
  );
  boundedInteger(
    settings.finished_time_limit_seconds,
    "finished time priority goal",
    0,
    2_147_483_647,
  );
  validateTransferRateLimit(settings.upload_rate_limit, "upload rate limit");
  validateTransferRateLimit(settings.download_rate_limit, "download rate limit");
  oneOf(settings.encryption, "encryption policy", [
    "disabled",
    "allow",
    "prefer",
    "required",
  ]);
  boolean(settings.ipv6_enabled, "IPv6 enabled");
  oneOf(
    settings.tracker_https_server_authentication,
    "tracker HTTPS server authentication policy",
    ["system_trust", "disabled"],
  );
}

function validateClientSettingsRuntime(value: unknown): void {
  const runtime = asRecord(value, "client settings runtime");
  validateClientSettings(runtime.configured);
  const effectiveListenerValue = runtime.effective_listener;
  let listener: Record<string, unknown> | null = null;
  if (effectiveListenerValue !== undefined && effectiveListenerValue !== null) {
    const effective = asRecord(
      effectiveListenerValue,
      "effective listener settings",
    );
    listener = asRecord(effective.listener, "effective listener policy");
    const listenerType = oneOf(listener.type, "effective listener policy type", [
      "disabled",
      "automatic_loopback",
      "fixed_loopback",
      "automatic_local_network",
      "fixed_local_network",
    ]);
    if (listenerType === "fixed_loopback" || listenerType === "fixed_local_network") {
      boundedInteger(listener.port, "effective fixed listener port", 1_024, 65_535);
    }
    boundedInteger(
      effective.preferred_listen_port,
      "effective preferred listener port",
      1_024,
      65_535,
    );
  }
  oneOf(runtime.effective_port_mapping, "effective port mapping policy", [
    "disabled",
    "upnp",
  ]);
  boundedInteger(
    runtime.effective_peer_connection_limit,
    "effective peer connection limit",
    1,
    2_000,
  );
  boundedInteger(runtime.effective_upload_slots, "effective upload slots", 0, 50);
  boundedInteger(
    runtime.effective_active_downloads,
    "effective active downloads",
    1,
    20,
  );
  const effectiveSeeds = validateActiveSeedLimit(
    runtime.effective_active_seeds,
    "effective active seeds",
  );
  validateTransferRateLimit(
    runtime.effective_upload_rate_limit,
    "effective upload rate limit",
  );
  validateTransferRateLimit(
    runtime.effective_download_rate_limit,
    "effective download rate limit",
  );
  if (
    runtime.active_downloads_clamp_reason !== undefined &&
    runtime.active_downloads_clamp_reason !== null
  ) {
    oneOf(
      runtime.active_downloads_clamp_reason,
      "active downloads clamp reason",
      ["platform_limit"],
    );
  }
  boundedInteger(runtime.active_download_count, "active download count", 0, 20);
  boundedInteger(runtime.checking_count, "checking count", 0, 1);
  const activeSeedCount = boundedInteger(
    runtime.active_seed_count,
    "active seed count",
    0,
    500,
  );
  const inactiveSeedCount = boundedInteger(
    runtime.inactive_seed_count,
    "inactive-exempt seed count",
    0,
    500,
  );
  if (activeSeedCount + inactiveSeedCount > 500) {
    throw new ContractError("active seed counts exceed the shared hard limit");
  }
  if (effectiveSeeds !== null && activeSeedCount > effectiveSeeds) {
    throw new ContractError("active seed count exceeds the effective seed limit");
  }
  oneOf(runtime.effective_encryption, "effective encryption policy", [
    "disabled",
    "allow",
    "prefer",
    "required",
  ]);
  boolean(runtime.effective_ipv6_enabled, "effective IPv6 enabled");
  if (
    runtime.effective_tracker_https_server_authentication !== undefined &&
    runtime.effective_tracker_https_server_authentication !== null
  ) {
    oneOf(
      runtime.effective_tracker_https_server_authentication,
      "effective tracker HTTPS server authentication policy",
      ["system_trust", "disabled"],
    );
  }
  [
    [runtime.transport_application, "transport application"],
    [runtime.port_mapping_application, "port mapping application"],
    [runtime.peer_connections_application, "peer connections application"],
    [runtime.upload_slots_application, "upload slots application"],
    [runtime.bandwidth_application, "bandwidth application"],
    [runtime.encryption_application, "encryption application"],
    [runtime.ipv6_application, "IPv6 application"],
    [
      runtime.tracker_https_authentication_application,
      "tracker HTTPS authentication application",
    ],
  ].forEach(([value, label]) => validateSettingsApplicationState(value, String(label)));
  validateBandwidthRuntime(runtime.bandwidth);

  const transportFamilies = array(
    runtime.transport_families,
    "transport address families",
  );
  if (transportFamilies.length > 2) {
    throw new ContractError("transport runtime contains too many address families");
  }
  const transportFamilyNames = new Set<string>();
  for (const value of transportFamilies) {
    const family = asRecord(value, "transport address family");
    const familyName = oneOf(family.family, "transport address family", [
      "ipv4",
      "ipv6",
    ]);
    if (transportFamilyNames.has(familyName)) {
      throw new ContractError("transport address families must be unique");
    }
    transportFamilyNames.add(familyName);
    boolean(family.configured, "transport family configured state");
    optionalString(family.tcp_endpoint, "transport TCP endpoint", 64);
    optionalString(family.udp_endpoint, "transport UDP endpoint", 64);
    optionalString(
      family.advertised_endpoint,
      "transport advertised endpoint",
      64,
    );
  }

  const status = asRecord(runtime.listener_status, "listener status");
  const statusType = oneOf(status.type, "listener status type", [
    "disabled",
    "listening",
    "bind_failed",
  ]);
  if (statusType === "listening") {
    const address = boundedString(status.address, "listener address", 64);
    const port = boundedInteger(status.port, "listener port", 1, 65_535);
    if (listener === null || listener.type === "disabled") {
      throw new ContractError("disabled listener reports a listening status");
    }
    if (
      (listener.type === "automatic_loopback" || listener.type === "fixed_loopback") &&
      address !== "127.0.0.1"
    ) {
      throw new ContractError("loopback listener reports another address");
    }
    if (
      (listener.type === "automatic_local_network" ||
        listener.type === "fixed_local_network") &&
      !isConcreteNonLoopbackIpv4(address)
    ) {
      throw new ContractError("local-network listener address is invalid");
    }
    if (
      (listener.type === "fixed_loopback" || listener.type === "fixed_local_network") &&
      listener.port !== port
    ) {
      throw new ContractError("fixed listener status reports another port");
    }
  } else if (statusType === "bind_failed") {
    oneOf(status.reason, "listener bind failure reason", [
      "address_in_use",
      "permission_denied",
      "address_unavailable",
      "other",
    ]);
    boundedString(status.detail, "listener bind failure detail", 512);
    if (listener !== null && listener.type === "disabled") {
      throw new ContractError("disabled listener reports a bind failure");
    }
    if (listener !== null) {
      throw new ContractError("bind failure cannot retain an effective listener");
    }
  } else if (listener === null || listener.type !== "disabled") {
    throw new ContractError("enabled listener reports a disabled status");
  }

  const udpStatus = asRecord(runtime.session_udp_status, "session UDP status");
  const udpStatusType = oneOf(udpStatus.type, "session UDP status type", [
    "unavailable",
    "bound",
  ]);
  if (udpStatusType === "bound") {
    boundedString(
      udpStatus.address,
      "session UDP address",
      64,
    );
    const udpPort = boundedInteger(
      udpStatus.port,
      "session UDP port",
      1,
      65_535,
    );
    const coordinated = boolean(
      udpStatus.coordinated_with_tcp,
      "session UDP coordination state",
    );
    if (
      coordinated &&
      (statusType !== "listening" ||
        status.port !== udpPort)
    ) {
      throw new ContractError(
        "coordinated session UDP port differs from the active listener",
      );
    }
  }

  const mappingStatus = asRecord(runtime.port_mapping_status, "port mapping status");
  const mappingStatusType = oneOf(
    mappingStatus.type,
    "port mapping status type",
    [
      "disabled",
      "ineligible",
      "discovering",
      "mapping",
      "mapped",
      "failed",
      "renewal_failed",
      "cleanup_failed",
      "stopping",
    ],
  );
  if (mappingStatusType === "disabled") {
    if (runtime.effective_port_mapping !== "disabled") {
      throw new ContractError("enabled port mapping reports a disabled status");
    }
  } else if (runtime.effective_port_mapping !== "upnp") {
    throw new ContractError("disabled port mapping reports active runtime work");
  }
  if (mappingStatusType === "mapped") {
    oneOf(mappingStatus.mechanism, "port mapping mechanism", ["upnp_igd_v2"]);
    const localAddress = boundedString(
      mappingStatus.local_address,
      "mapped local address",
      64,
    );
    const localPort = boundedInteger(
      mappingStatus.local_port,
      "mapped local port",
      1,
      65_535,
    );
    boundedString(mappingStatus.external_address, "mapped external address", 64);
    boundedInteger(mappingStatus.external_port, "mapped external port", 1, 65_535);
    boundedInteger(mappingStatus.lease_seconds, "mapping lease", 1, MAX_U32);
    if (
      statusType !== "listening" ||
      status.address !== localAddress ||
      status.port !== localPort
    ) {
      throw new ContractError("mapped endpoint differs from the active listener");
    }
  } else if (mappingStatusType === "failed") {
    oneOf(mappingStatus.stage, "port mapping failure stage", [
      "discovery",
      "description",
      "external_address",
      "add",
      "verify",
      "renewal",
      "delete",
    ]);
    boundedString(mappingStatus.detail, "port mapping failure detail", 512);
  } else if (mappingStatusType === "renewal_failed") {
    boundedString(
      mappingStatus.external_address,
      "renewal-failed external address",
      64,
    );
    boundedInteger(
      mappingStatus.external_port,
      "renewal-failed external port",
      1,
      65_535,
    );
    boundedString(mappingStatus.detail, "mapping renewal failure detail", 512);
  } else if (mappingStatusType === "cleanup_failed") {
    boundedString(
      mappingStatus.external_address,
      "cleanup-failed external address",
      64,
    );
    boundedInteger(
      mappingStatus.external_port,
      "cleanup-failed external port",
      1,
      65_535,
    );
    boundedInteger(
      mappingStatus.remaining_lease_seconds,
      "cleanup-failed remaining lease",
      0,
      MAX_U32,
    );
    boundedString(mappingStatus.detail, "mapping cleanup failure detail", 512);
  }

  const pinholeStatus = asRecord(
    runtime.ipv6_pinhole_status,
    "IPv6 pinhole status",
  );
  const pinholeStatusType = oneOf(
    pinholeStatus.type,
    "IPv6 pinhole status type",
    [
      "disabled",
      "ineligible",
      "discovering",
      "service_unavailable",
      "action_unavailable",
      "inbound_pinhole_disallowed",
      "unfiltered",
      "creating",
      "pinholed",
      "failed",
      "renewal_failed",
      "cleanup_failed",
      "stopping",
    ],
  );
  if (pinholeStatusType === "disabled") {
    if (runtime.effective_port_mapping !== "disabled") {
      throw new ContractError("enabled port mapping reports a disabled IPv6 pinhole status");
    }
  } else if (runtime.effective_port_mapping !== "upnp") {
    throw new ContractError("disabled port mapping reports active IPv6 pinhole work");
  }
  if (pinholeStatusType === "action_unavailable") {
    boundedString(pinholeStatus.detail, "IPv6 pinhole action detail", 512);
  } else if (
    pinholeStatusType === "unfiltered" ||
    pinholeStatusType === "creating" ||
    pinholeStatusType === "pinholed" ||
    pinholeStatusType === "renewal_failed" ||
    pinholeStatusType === "cleanup_failed"
  ) {
    boundedString(
      pinholeStatus.internal_address,
      "IPv6 pinhole internal address",
      64,
    );
    boundedInteger(
      pinholeStatus.internal_port,
      "IPv6 pinhole internal port",
      1_024,
      65_535,
    );
    if (pinholeStatusType === "pinholed") {
      boundedInteger(pinholeStatus.lease_seconds, "IPv6 pinhole lease", 1, 86_400);
    } else if (pinholeStatusType === "renewal_failed") {
      boundedString(pinholeStatus.detail, "IPv6 pinhole renewal detail", 512);
    } else if (pinholeStatusType === "cleanup_failed") {
      boundedInteger(
        pinholeStatus.remaining_lease_seconds,
        "IPv6 pinhole remaining lease",
        0,
        86_400,
      );
      boundedString(pinholeStatus.detail, "IPv6 pinhole cleanup detail", 512);
    }
  } else if (pinholeStatusType === "failed") {
    oneOf(pinholeStatus.stage, "IPv6 pinhole failure stage", [
      "discovery",
      "description",
      "firewall_status",
      "add",
      "renewal",
      "delete",
    ]);
    boundedString(pinholeStatus.detail, "IPv6 pinhole failure detail", 512);
  }
}

function validateSettingsApplicationState(value: unknown, label: string): void {
  const state = asRecord(value, label);
  const stateType = oneOf(state.type, `${label} type`, [
    "applying",
    "applied",
    "degraded",
  ]);
  if (stateType !== "degraded") return;
  oneOf(state.reason, `${label} degraded reason`, [
    "transport_bind_failed",
    "transport_handover_failed",
    "port_mapping_failed",
    "port_mapping_cleanup_failed",
    "peer_connection_convergence_failed",
    "upload_slot_convergence_failed",
    "runtime_stopped",
  ]);
  boundedString(state.detail, `${label} degraded detail`, 512);
}

function isConcreteNonLoopbackIpv4(value: string): boolean {
  const octets = value.split(".");
  if (octets.length !== 4) return false;
  const numbers = octets.map((octet) =>
    /^\d{1,3}$/.test(octet) ? Number(octet) : Number.NaN,
  );
  if (numbers.some((octet) => !Number.isInteger(octet) || octet > 255)) {
    return false;
  }
  return (
    numbers[0] !== 0 &&
    numbers[0] !== 127 &&
    numbers[0] !== undefined &&
    numbers[0] < 224 &&
    !(numbers[0] === 255 && numbers.every((octet) => octet === 255))
  );
}

function validateStorageRoot(value: unknown): string {
  const root = asRecord(value, "storage root");
  const rootId = identifier(root.root_id, "storage root ID");
  boundedString(root.label, "storage root label", 256);
  optionalString(root.display_path, "storage root display path", 4_096);
  oneOf(root.availability, "storage root availability", [
    "available",
    "unavailable",
  ]);
  return rootId;
}

export function validateTorrentView(value: unknown): asserts value is TorrentView {
  const torrent = asRecord(value, "torrent view");
  torrentId(torrent.torrent_id);
  validateProtocolIdentities(torrent.protocol_identities);
  optionalString(torrent.display_name, "torrent display name", 255);
  optionalString(torrent.source_display_name, "torrent source display name", 255);
  oneOf(torrent.operational_state, "torrent operational state", [
    "queued",
    "starting",
    "downloading",
    "checking",
    "stopping",
    "seeding",
    "paused",
    "error",
  ]);
  optionalInteger(
    torrent.download_queue_position,
    "download queue position",
    MAX_U32,
  );
  validateTorrentTransferLimits(torrent.transfer_limits, "torrent transfer limits");
  boolean(torrent.metadata_available, "metadata available");
  boolean(torrent.awaiting_file_selection, "awaiting file selection");
  optionalInteger(
    torrent.pending_file_selection_position,
    "pending file selection position",
    500,
  );
  optionalString(torrent.file_catalog_id, "file catalog identity", 64);
  const selectableFileCount = boundedInteger(
    torrent.selectable_file_count,
    "selectable file count",
    0,
    374_998,
  );
  const selectedFileCount = boundedInteger(
    torrent.selected_file_count,
    "selected file count",
    0,
    374_998,
  );
  const selectableFileBytes = decimal(
    torrent.selectable_file_bytes,
    "selectable file bytes",
  );
  const selectedFileBytes = decimal(
    torrent.selected_file_bytes,
    "selected file bytes",
  );
  if (selectedFileCount > selectableFileCount) {
    throw new ContractError("selected file count exceeds selectable files");
  }
  if (BigInt(selectedFileBytes) > BigInt(selectableFileBytes)) {
    throw new ContractError("selected file bytes exceed selectable bytes");
  }
  if (
    torrent.awaiting_file_selection === true &&
    torrent.pending_file_selection_position === null
  ) {
    throw new ContractError("pending file selection has no queue position");
  }
  boundedInteger(torrent.piece_count, "piece count", 0, MAX_U32);
  nullableDecimal(torrent.total_size_bytes, "torrent total size");
  boundedInteger(
    torrent.verified_piece_count,
    "verified piece count",
    0,
    MAX_U32,
  );
  decimal(torrent.requested_bytes, "requested bytes");
  decimal(torrent.received_bytes, "received bytes");
  decimal(torrent.stored_bytes, "stored bytes");
  optionalInteger(
    torrent.configured_tracker_count,
    "configured tracker count",
    MAX_TRACKER_CATALOG,
  );
  const requiredPayload = nullableDecimal(
    torrent.required_payload_bytes,
    "required payload bytes",
  );
  const remainingPayload = nullableDecimal(
    torrent.remaining_payload_bytes,
    "remaining payload bytes",
  );
  if ((requiredPayload === null) !== (remainingPayload === null)) {
    throw new ContractError("torrent ETA payload geometry is incomplete");
  }
  if (
    requiredPayload !== null &&
    remainingPayload !== null &&
    BigInt(remainingPayload) > BigInt(requiredPayload)
  ) {
    throw new ContractError("remaining payload exceeds required payload");
  }
  const etaRate = decimal(
    torrent.eta_payload_download_rate_bytes,
    "ETA payload download rate",
  );
  const eta = asRecord(torrent.eta, "torrent ETA");
  const etaState = oneOf(eta.state, "torrent ETA state", [
    "estimate",
    "warming_up",
    "stalled",
    "unavailable",
  ]);
  if (etaState === "estimate") {
    const seconds = decimal(eta.seconds, "torrent ETA seconds");
    if (
      seconds === "0" ||
      etaRate === "0" ||
      remainingPayload === null ||
      remainingPayload === "0"
    ) {
      throw new ContractError("estimated torrent ETA has inconsistent work or rate");
    }
  } else if (etaRate !== "0") {
    throw new ContractError("non-estimated torrent ETA must expose a zero rate");
  } else if (
    (etaState === "warming_up" || etaState === "stalled") &&
    (remainingPayload === null || remainingPayload === "0")
  ) {
    throw new ContractError("active torrent ETA has no remaining work");
  }
  const lifetime = asRecord(torrent.lifetime, "torrent lifetime accounting");
  const uploaded = decimal(
    lifetime.uploaded_payload_bytes,
    "lifetime uploaded payload",
  );
  const downloaded = decimal(
    lifetime.downloaded_payload_bytes,
    "lifetime downloaded payload",
  );
  const activeSeconds = decimal(lifetime.active_seconds, "active seconds");
  const finishedSeconds = decimal(lifetime.finished_seconds, "finished seconds");
  const seedingSeconds = decimal(lifetime.seeding_seconds, "seeding seconds");
  if (
    BigInt(finishedSeconds) > BigInt(activeSeconds) ||
    BigInt(seedingSeconds) > BigInt(finishedSeconds)
  ) {
    throw new ContractError("torrent lifetime timers are not nested");
  }
  const shareRatio = nullableDecimal(
    lifetime.share_ratio_hundredths,
    "share ratio hundredths",
  );
  const totalSize = torrent.total_size_bytes === null
    ? 0n
    : BigInt(decimal(torrent.total_size_bytes, "torrent total size"));
  const downloadedBase = BigInt(downloaded) > totalSize ? BigInt(downloaded) : totalSize;
  const expectedShareRatio = downloadedBase === 0n
    ? null
    : ((BigInt(uploaded) * 100n) / downloadedBase).toString();
  if (shareRatio !== expectedShareRatio) {
    throw new ContractError("share ratio does not match lifetime payload totals");
  }
  const seeding = asRecord(torrent.seeding, "torrent seeding status");
  const admission = oneOf(seeding.admission, "seed admission", [
    "active",
    "queued",
    "inactive_exempt",
    "ineligible",
  ]);
  const goal = seeding.goal === undefined || seeding.goal === null
    ? null
    : asRecord(seeding.goal, "seed goal");
  if ((torrent.state === "complete") !== (goal !== null)) {
    throw new ContractError("seed goal availability does not match torrent completion");
  }
  if (goal !== null) {
    const status = oneOf(goal.status, "seed goal status", ["unmet", "met"]);
    const anyThresholdMet = [
      boolean(goal.share_ratio_met, "share ratio goal state"),
      boolean(
        goal.finished_download_ratio_met,
        "finished/download time ratio goal state",
      ),
      boolean(goal.finished_time_met, "finished time goal state"),
    ].some(Boolean);
    if ((status === "met") !== anyThresholdMet) {
      throw new ContractError("seed goal status does not match its threshold states");
    }
  }
  if (
    (admission === "active" || admission === "inactive_exempt") &&
    torrent.operational_state !== "seeding"
  ) {
    throw new ContractError("active seed admission is not reported as seeding");
  }
  if (admission === "queued" && torrent.operational_state !== "queued") {
    throw new ContractError("queued seed admission is not reported as queued");
  }
  const progress = asRecord(torrent.progress, "progress assessment");
  oneOf(progress.disposition, "progress disposition", [
    "active",
    "waiting",
    "blocked",
    "inactive",
  ]);
  oneOf(progress.phase, "progress phase", [
    "discovery",
    "metadata",
    "storage",
    "transfer",
    "verification",
    "complete",
  ]);
  boundedString(progress.reason, "progress reason", 64);
  array(progress.actions, "progress actions").forEach((action) =>
    boundedString(action, "progress action", 64),
  );
  if (torrent.checking !== undefined && torrent.checking !== null) {
    const checking = asRecord(torrent.checking, "checking progress");
    decimal(checking.generation, "checking generation");
    oneOf(checking.phase, "checking phase", [
      "queued",
      "preparing",
      "hashing",
      "reconciling_storage",
      "paused",
      "finalizing",
    ]);
    const piecesTotal = boundedInteger(
      checking.pieces_total,
      "checking piece total",
      0,
      MAX_U32,
    );
    const piecesProcessed = boundedInteger(
      checking.pieces_processed,
      "checked pieces",
      0,
      piecesTotal,
    );
    const piecesMatched = boundedInteger(
      checking.pieces_matched,
      "matched pieces",
      0,
      piecesTotal,
    );
    const piecesAbsent = boundedInteger(
      checking.pieces_absent,
      "absent pieces",
      0,
      piecesTotal,
    );
    const piecesMismatched = boundedInteger(
      checking.pieces_mismatched,
      "mismatched pieces",
      0,
      piecesTotal,
    );
    const activeJobs = boundedInteger(
      checking.active_hash_jobs,
      "active checking jobs",
      0,
      piecesTotal,
    );
    const queuedJobs = boundedInteger(
      checking.queued_hash_jobs,
      "queued checking jobs",
      0,
      piecesTotal,
    );
    if (piecesProcessed !== piecesMatched + piecesAbsent + piecesMismatched) {
      throw new ContractError("checking outcome counters do not equal processed pieces");
    }
    if (piecesProcessed + activeJobs + queuedJobs !== piecesTotal) {
      throw new ContractError("checking work counters do not equal the piece total");
    }
    decimal(checking.bytes_hashed, "checking hashed bytes");
    decimal(checking.elapsed_millis, "checking elapsed time");
    decimal(checking.last_advance_age_millis, "checking last advance age");
    const oldestActive =
      checking.oldest_active_job_age_millis === undefined ||
      checking.oldest_active_job_age_millis === null
        ? null
        : decimal(
            checking.oldest_active_job_age_millis,
            "oldest active checking job age",
          );
    if ((activeJobs === 0) !== (oldestActive === null)) {
      throw new ContractError("checking active job age is inconsistent");
    }
  }
  optionalString(torrent.error, "torrent error", 1_024);
}

function validateTorrentTransferLimits(value: unknown, label: string): void {
  const limits = asRecord(value, label);
  validateTransferRateLimit(limits.upload, `${label} upload`);
  validateTransferRateLimit(limits.download, `${label} download`);
}

function validateActiveSeedLimit(value: unknown, label: string): number | null {
  const limit = asRecord(value, label);
  const type = oneOf(limit.type, `${label} type`, ["unlimited", "limited"]);
  return type === "limited"
    ? boundedInteger(limit.torrents, `${label} torrent count`, 0, 500)
    : null;
}

function validateTransferRateLimit(value: unknown, label: string): void {
  const limit = asRecord(value, label);
  const type = oneOf(limit.type, `${label} type`, ["unlimited", "limited"]);
  if (type === "limited") {
    boundedInteger(limit.bytes_per_second, `${label} bytes per second`, 1_024, MAX_U32);
  }
}

function validateBandwidthRuntime(value: unknown): void {
  const bandwidth = asRecord(value, "bandwidth runtime");
  for (const directionName of ["upload", "download"] as const) {
    const direction = asRecord(
      bandwidth[directionName],
      `${directionName} bandwidth runtime`,
    );
    boundedInteger(
      direction.registered_torrents,
      `${directionName} registered torrents`,
      0,
      1_024,
    );
    boundedInteger(
      direction.active_waiters,
      `${directionName} active waiters`,
      0,
      4_096,
    );
    decimal(direction.queued_requested_bytes, `${directionName} queued requested bytes`);
    decimal(direction.granted_bytes, `${directionName} granted bytes`);
    decimal(direction.returned_bytes, `${directionName} returned bytes`);
    decimal(direction.cancelled_requests, `${directionName} cancelled requests`);
    decimal(direction.throttle_wait_micros, `${directionName} throttle wait`);
    decimal(
      direction.throttle_wait_high_water_micros,
      `${directionName} throttle wait high water`,
    );
    const credit = decimal(
      direction.current_burst_credit_bytes,
      `${directionName} burst credit`,
    );
    if (BigInt(credit) > 1_048_576n) {
      throw new ContractError(`${directionName} burst credit exceeds its bound`);
    }
  }
}

export function validateFileView(value: unknown): void {
  const file = asRecord(value, "file view");
  decimal(file.file_id, "file ID");
  boundedInteger(file.file_index, "file index", 0, MAX_FILE_CATALOG - 1);
  const path = array(file.path, "file path");
  if (path.length === 0 || path.length > 4_096) {
    throw new ContractError("file path component count is invalid");
  }
  let renderedPathBytes = 0;
  path.forEach((component) => {
    const value = boundedString(component, "file path component", 240);
    renderedPathBytes += new TextEncoder().encode(value).byteLength + 1;
  });
  if (renderedPathBytes > 4_096) {
    throw new ContractError("rendered file path exceeds its row bound");
  }
  decimal(file.length_bytes, "file length");
  decimal(file.torrent_offset_bytes, "file torrent offset");
  optionalInteger(file.first_piece, "first file piece", MAX_U32);
  optionalInteger(file.last_piece, "last file piece", MAX_U32);
  if (file.selection !== null) {
    oneOf(file.selection, "file selection", ["normal", "high", "skipped"]);
  }
  boolean(file.padding, "file padding flag");
  if (file.padding && file.selection !== null) {
    throw new ContractError("padding file has a selection state");
  }
  decimal(file.done_bytes, "file done bytes");
  decimal(file.verified_bytes, "file verified bytes");
  const length = BigInt(string(file.length_bytes, "file length"));
  const done = BigInt(string(file.done_bytes, "file done bytes"));
  const verified = BigInt(string(file.verified_bytes, "file verified bytes"));
  if (verified > done || done > length) {
    throw new ContractError("file progress counters are inconsistent");
  }
}

function validateMediaItemView(value: unknown): void {
  const item = asRecord(value, "media item");
  decimal(item.media_id, "media ID");
  boundedInteger(item.file_index, "media file index", 0, MAX_FILE_CATALOG - 1);
  const path = array(item.path, "media path");
  if (path.length === 0 || path.length > 4_096) {
    throw new ContractError("media path component count is invalid");
  }
  let renderedPathBytes = 0;
  path.forEach((component) => {
    const pathComponent = boundedString(component, "media path component", 240);
    renderedPathBytes += new TextEncoder().encode(pathComponent).byteLength + 1;
  });
  if (renderedPathBytes > 4_096) {
    throw new ContractError("rendered media path exceeds its row bound");
  }
  const extension = boundedString(item.extension, "media extension", 16);
  if (!/^[a-z0-9]+$/.test(extension)) {
    throw new ContractError("media extension is invalid");
  }
  decimal(item.length_bytes, "media length");
  oneOf(item.selection, "media selection", ["normal", "high", "skipped"]);
  decimal(item.done_bytes, "media done bytes");
  decimal(item.verified_bytes, "media verified bytes");
  oneOf(item.media_availability, "media availability", [
    "available",
    "streamable",
    "metadata_unavailable",
    "invalid_file",
    "padding",
    "incomplete",
    "checking",
    "unverified",
    "storage_unavailable",
    "removing",
    "server_unavailable",
    "resource_limit",
  ]);
  const length = BigInt(string(item.length_bytes, "media length"));
  const done = BigInt(string(item.done_bytes, "media done bytes"));
  const verified = BigInt(string(item.verified_bytes, "media verified bytes"));
  if (verified > done || done > length) {
    throw new ContractError("media progress counters are inconsistent");
  }
  const role = asRecord(item.role, "media role");
  const roleType = oneOf(role.type, "media role type", [
    "episode",
    "unclassified_video",
  ]);
  if (roleType === "episode") {
    boundedString(role.series_title_hint, "series title hint", 4_096);
    boundedInteger(role.season_number, "season number", 0, 65_535);
    boundedInteger(role.episode_number, "episode number", 0, 65_535);
    optionalInteger(role.ending_episode_number, "ending episode number", 65_535);
  }
}

function validateCatalogPage(
  value: unknown,
  maximumTotal: number,
): { offset: number; limit: number; total: number } {
  const page = asRecord(value, "catalog page");
  const offset = boundedInteger(
    page.offset,
    "catalog page offset",
    0,
    maximumTotal,
  );
  const limit = boundedInteger(
    page.limit,
    "catalog page limit",
    1,
    MAX_CATALOG_PAGE_ROWS,
  );
  const total = boundedInteger(
    page.total,
    "catalog total rows",
    0,
    maximumTotal,
  );
  if (page.next_offset !== null) {
    const next = boundedInteger(
      page.next_offset,
      "next catalog page offset",
      1,
      maximumTotal,
    );
    if (next !== Math.min(offset + limit, total) || next >= total) {
      throw new ContractError("next catalog page offset is inconsistent");
    }
  } else if (offset + limit < total) {
    throw new ContractError("catalog page omitted its next offset");
  }
  return { offset, limit, total };
}

function validateTrackerView(value: unknown): void {
  const tracker = asRecord(value, "tracker view");
  const id = boundedString(tracker.tracker_id, "tracker ID", 13);
  const url = boundedString(tracker.url, "tracker URL", 4_096);
  if (!/^\d{6}:\d{6}$/.test(id) || !/^(udp|http|https):\/\//.test(url)) {
    throw new ContractError("tracker identity or redacted URL is invalid");
  }
  oneOf(tracker.transport, "tracker transport", ["udp", "http", "https"]);
  oneOf(tracker.security, "tracker security", [
    "unencrypted",
    "encrypted_unauthenticated",
  ]);
  if (
    (tracker.transport === "https") !==
    (tracker.security === "encrypted_unauthenticated")
  ) {
    throw new ContractError("tracker transport and security are inconsistent");
  }
  oneOf(tracker.source, "tracker source", ["magnet", "metainfo"]);
  boundedInteger(tracker.tier, "tracker tier", 0, MAX_U32);
  oneOf(tracker.status, "tracker status", [
    "unsupported",
    "inactive",
    "disabled",
    "idle",
    "announcing",
    "retry_wait",
    "reannounce_wait",
  ]);
  if (tracker.announce_event !== null) {
    oneOf(tracker.announce_event, "tracker announce event", [
      "started",
      "update",
      "completed",
      "stopped",
    ]);
  }
  boundedInteger(tracker.total_attempts, "tracker attempts", 0, MAX_U32);
  boundedInteger(tracker.consecutive_failures, "tracker failures", 0, 127);
  if (tracker.last_connection_family !== null) {
    oneOf(tracker.last_connection_family, "tracker connection family", [
      "ipv4",
      "ipv6",
    ]);
  }
  ["last_peer_count", "seeders", "leechers", "interval_seconds"].forEach(
    (field) => optionalInteger(tracker[field], `tracker ${field}`, MAX_U32),
  );
  if (tracker.next_action !== null) {
    oneOf(tracker.next_action, "tracker next action", [
      "announce",
      "retry",
      "reannounce",
    ]);
  }
  [
    "next_action_at_millis",
    "last_success_at_millis",
    "last_failure_at_millis",
  ].forEach((field) => optionalDecimal(tracker[field], `tracker ${field}`));
  optionalString(tracker.last_error, "tracker last error", 256);
}

export function validatePeerView(value: unknown, owningTorrent: string): void {
  const peer = asRecord(value, "active peer");
  decimal(peer.connection_id, "peer connection ID");
  torrentId(peer.torrent_id);
  if (peer.torrent_id !== owningTorrent) {
    throw new ContractError("active peer belongs to another torrent");
  }
  optionalDecimal(peer.peer_record_id, "peer record ID");
  oneOf(peer.direction, "peer direction", ["incoming", "outgoing"]);
  oneOf(peer.transport, "peer transport", ["tcp", "utp"]);
  oneOf(peer.lifecycle, "peer lifecycle", [
    "transport_connecting",
    "protocol_handshaking",
    "connected",
    "disconnecting",
  ]);
  oneOf(peer.role, "peer role", ["metadata", "content"]);
  if (peer.peer_flags !== undefined) {
    const flags = array(peer.peer_flags, "peer flags");
    if (flags.length > PEER_FLAGS.length) {
      throw new ContractError("peer flags exceed their bound");
    }
    flags.forEach((flag) => oneOf(flag, "peer flag", PEER_FLAGS));
    if (new Set(flags).size !== flags.length) {
      throw new ContractError("peer flags contain duplicates");
    }
  }
  if (peer.mse_method !== undefined && peer.mse_method !== null) {
    oneOf(peer.mse_method, "peer MSE method", ["plaintext_payload", "rc4"]);
  }
  decimal(peer.lifecycle_age_millis, "peer lifecycle age");
  boundedString(peer.remote_endpoint, "peer remote endpoint", 128);
  optionalString(peer.local_endpoint, "peer local endpoint", 128);
  const sources = array(peer.sources, "peer sources");
  if (sources.length > 8) throw new ContractError("peer sources exceed their bound");
  sources.forEach((source) =>
    oneOf(source, "peer source", [
      "tracker",
      "peer_exchange",
      "dht",
      "local_discovery",
      "incoming",
      "manual",
      "magnet_hint",
      "cache",
    ]),
  );
  optionalString(peer.peer_id, "peer ID", 128);
  optionalString(peer.client_name, "peer client name", 128);
  [
    "supports_extensions",
    "supports_ut_metadata",
    "local_interested",
    "remote_interested",
    "remote_choking",
    "local_choking",
  ].forEach((field) => optionalBoolean(peer[field], `peer ${field}`));
  ["available_piece_count", "wanted_piece_count", "pending_requests", "target_requests"].forEach(
    (field) => optionalInteger(peer[field], `peer ${field}`, MAX_U32),
  );
  [
    "payload_download_rate_bytes",
    "payload_downloaded_bytes",
    "protocol_download_rate_bytes",
    "protocol_downloaded_bytes",
    "payload_upload_rate_bytes",
    "payload_uploaded_bytes",
    "queued_payload_bytes",
    "oldest_request_age_millis",
    "request_timeout_millis",
    "connected_age_millis",
    "last_useful_age_millis",
    "last_payload_age_millis",
  ].forEach((field) => optionalDecimal(peer[field], `peer ${field}`));
  if (peer.request_phase !== null) {
    oneOf(peer.request_phase, "peer request phase", [
      "slow_start",
      "steady",
      "stalled",
    ]);
  }
  if (peer.disconnect_reason !== null) {
    oneOf(peer.disconnect_reason, "peer disconnect reason", [
      "connect",
      "handshake",
      "protocol",
      "remote_closed",
    ]);
  }
  const capabilities = asRecord(peer.capabilities, "peer capabilities");
  [
    "local_endpoint",
    "client_name",
    "ut_metadata",
    "interest_directions",
    "local_choke",
    "piece_availability",
    "protocol_rates",
    "upload",
    "metadata_stage",
  ].forEach((field) =>
    oneOf(capabilities[field], `peer capability ${field}`, [
      "available",
      "unavailable",
      "unsupported",
    ]),
  );
}

function validateSwarmCounts(value: unknown, expectedTotal?: number): number {
  const counts = asRecord(value, "swarm counts");
  const fields = [
    "total",
    "eligible",
    "not_connectable",
    "dialing",
    "connected",
    "backed_off",
    "failure_limited",
    "banned",
  ] as const;
  for (const field of fields) {
    boundedInteger(counts[field], `swarm ${field} count`, 0, MAX_SWARM_PEERS);
  }
  const total = boundedInteger(counts.total, "swarm total count", 0, MAX_SWARM_PEERS);
  const categorized = fields
    .slice(1)
    .reduce((sum, field) => sum + Number(counts[field]), 0);
  if (categorized !== total || (expectedTotal !== undefined && total !== expectedTotal)) {
    throw new ContractError("swarm counts are inconsistent");
  }
  return total;
}

function validateSwarmPeerView(value: unknown, owningTorrent: string): void {
  const peer = asRecord(value, "swarm peer");
  decimal(peer.peer_record_id, "swarm peer record ID");
  torrentId(peer.torrent_id);
  if (peer.torrent_id !== owningTorrent) {
    throw new ContractError("swarm peer belongs to another torrent");
  }
  boundedString(peer.endpoint, "swarm peer endpoint", 128);
  const sources = array(peer.sources, "swarm peer sources");
  if (sources.length > 8 || new Set(sources).size !== sources.length) {
    throw new ContractError("swarm peer sources exceed their bound or contain duplicates");
  }
  sources.forEach((source) =>
    oneOf(source, "swarm peer source", [
      "tracker",
      "peer_exchange",
      "dht",
      "local_discovery",
      "incoming",
      "manual",
      "magnet_hint",
      "cache",
    ]),
  );
  oneOf(peer.state, "swarm peer state", [
    "eligible",
    "not_connectable",
    "dialing",
    "connected",
    "backed_off",
    "failure_limited",
    "banned",
  ]);
  boolean(peer.connectable, "swarm peer connectable");
  decimal(peer.first_observed_age_millis, "swarm peer first observed age");
  decimal(peer.last_observed_age_millis, "swarm peer last observed age");
  decimal(peer.payload_downloaded_bytes, "swarm peer downloaded payload");
  decimal(peer.payload_uploaded_bytes, "swarm peer uploaded payload");
  [
    "retry_in_millis",
    "last_dial_age_millis",
    "last_connected_age_millis",
    "last_failure_age_millis",
  ].forEach((field) => optionalDecimal(peer[field], `swarm peer ${field}`));
  ["dial_attempts", "consecutive_failures", "total_failures", "valid_pieces"].forEach(
    (field) => boundedInteger(peer[field], `swarm peer ${field}`, 0, MAX_U32),
  );
  boundedInteger(peer.hash_failures, "swarm peer hash failures", 0, 255);
  boundedInteger(peer.trust_points, "swarm peer trust points", -128, 127);
  boolean(peer.on_parole, "swarm peer parole state");
  if (peer.last_failure !== null) {
    oneOf(peer.last_failure, "swarm peer last failure", [
      "connect",
      "handshake",
      "protocol",
      "remote_closed",
    ]);
  }
}

function validateDiagnosticEvent(value: unknown): void {
  const event = asRecord(value, "diagnostic event");
  decimal(event.sequence, "diagnostic sequence");
  decimal(event.timestamp_millis, "diagnostic timestamp");
  oneOf(event.severity, "diagnostic severity", [
    "trace",
    "debug",
    "info",
    "warning",
    "error",
  ]);
  const category = boundedString(event.category, "diagnostic category", 64);
  if (!DIAGNOSTIC_CATEGORY.test(category)) {
    throw new ContractError("diagnostic category is invalid");
  }
  const code = boundedString(event.code, "diagnostic code", 48);
  if (!DIAGNOSTIC_IDENTIFIER.test(code)) {
    throw new ContractError("diagnostic code is invalid");
  }
  if (event.torrent_id !== undefined && event.torrent_id !== null) {
    torrentId(event.torrent_id);
  }
  boundedString(event.message, "diagnostic message", 1_280);
  const subjects = array(event.subjects, "diagnostic subjects");
  if (subjects.length > 4) {
    throw new ContractError("diagnostic subjects exceed their bound");
  }
  subjects.forEach(validateDiagnosticSubject);
  const fields = array(event.fields, "diagnostic fields");
  if (fields.length > 8) {
    throw new ContractError("diagnostic fields exceed their bound");
  }
  for (const field of fields) {
    const record = asRecord(field, "diagnostic field");
    const key = boundedString(record.key, "diagnostic field key", 48);
    if (!DIAGNOSTIC_IDENTIFIER.test(key)) {
      throw new ContractError("diagnostic field key is invalid");
    }
    validateDiagnosticValue(record.value);
  }
}

function validateDiagnosticRetention(value: unknown): void {
  const retention = asRecord(value, "diagnostic retention");
  decimal(retention.source_evicted_count, "diagnostic source eviction count");
  decimal(retention.retained_from_sequence, "diagnostic retained sequence");
}

function validateDiagnosticSubject(value: unknown): void {
  const subject = asRecord(value, "diagnostic subject");
  switch (string(subject.type, "diagnostic subject type")) {
    case "peer_connection":
      boundedString(subject.connection_id, "peer connection subject", 240);
      break;
    case "tracker":
      boundedString(subject.tracker_id, "tracker subject", 240);
      break;
    case "piece":
      boundedInteger(subject.piece_index, "piece subject index", 0, MAX_U32);
      optionalInteger(subject.attempt, "piece subject attempt", MAX_U32);
      break;
    case "file":
      boundedInteger(subject.file_index, "file subject index", 0, MAX_U32);
      break;
    case "task": {
      const kind = boundedString(subject.kind, "task subject kind", 48);
      if (!DIAGNOSTIC_IDENTIFIER.test(kind)) {
        throw new ContractError("task subject kind is invalid");
      }
      boundedString(subject.generation, "task subject generation", 240);
      break;
    }
    default:
      throw new ContractError("diagnostic subject type is unknown");
  }
}

function validateDiagnosticValue(value: unknown): void {
  const diagnosticValue = asRecord(value, "diagnostic value");
  switch (string(diagnosticValue.type, "diagnostic value type")) {
    case "boolean":
      boolean(diagnosticValue.value, "diagnostic boolean value");
      break;
    case "count":
    case "bytes":
    case "duration_millis":
      decimal(diagnosticValue.value, "diagnostic decimal value");
      break;
    case "error_code": {
      const code = boundedString(diagnosticValue.value, "diagnostic error code", 48);
      if (!DIAGNOSTIC_IDENTIFIER.test(code)) {
        throw new ContractError("diagnostic error code is invalid");
      }
      break;
    }
    case "text":
    case "endpoint":
      boundedString(diagnosticValue.value, "diagnostic string value", 960);
      break;
    default:
      throw new ContractError("diagnostic value type is unknown");
  }
}

export function validateActivePiece(
  value: unknown,
  pieceCount: number,
): asserts value is ActivePiece {
  const active = asRecord(value, "active piece");
  const pieceIndex = boundedInteger(
    active.piece_index,
    "active piece index",
    0,
    MAX_U32,
  );
  if (pieceIndex >= pieceCount) {
    throw new ContractError("active piece index exceeds the torrent");
  }
  const pieceLength = boundedInteger(
    active.piece_length,
    "active piece length",
    1,
    MAX_U32,
  );
  const attempt = boundedInteger(active.attempt, "active piece attempt", 1, MAX_U32);
  const pieceId = boundedString(active.piece_id, "active piece ID", 64);
  if (pieceId !== `${pieceIndex}:${attempt}`) {
    throw new ContractError("active piece ID does not match its piece attempt");
  }
  oneOf(active.stage, "active piece stage", [
    "requested",
    "received",
    "stored",
    "hashing",
    "checkpoint_dirty",
    "checkpoint_syncing",
    "checkpoint_committing",
    "failed",
  ]);
  validateRanges(active.requested, pieceLength, "requested blocks");
  validateRanges(active.received, pieceLength, "received blocks");
  validateRanges(active.stored, pieceLength, "stored blocks");
  validateDisjointActiveRanges(active, pieceLength);
  decimal(active.age_millis, "active piece age");
  optionalString(active.error, "active piece error", 256);
}

function validateActivePieces(value: unknown, pieceCount: number, label: string): void {
  const pieces = array(value, label);
  if (pieces.length > MAX_ACTIVE_PIECES || pieces.length > pieceCount) {
    throw new ContractError(`${label} exceeds its bound`);
  }
  const ids = new Set<string>();
  const indices = new Set<number>();
  for (const value of pieces) {
    validateActivePiece(value, pieceCount);
    const piece = value as ActivePiece;
    if (ids.has(piece.piece_id) || indices.has(piece.piece_index)) {
      throw new ContractError(`${label} contains duplicate identity`);
    }
    ids.add(piece.piece_id);
    indices.add(piece.piece_index);
  }
}

function validatePieceIds(value: unknown, label: string): void {
  const values = array(value, label);
  if (values.length > MAX_ACTIVE_PIECES) {
    throw new ContractError(`${label} exceeds its bound`);
  }
  const ids = new Set<string>();
  for (const value of values) {
    const id = boundedString(value, "active piece ID", 64);
    if (!/^(0|[1-9][0-9]*):[1-9][0-9]*$/.test(id) || ids.has(id)) {
      throw new ContractError(`${label} contains an invalid or duplicate ID`);
    }
    ids.add(id);
  }
}

function validateDisjointActiveRanges(
  active: Record<string, unknown>,
  pieceLength: number,
): void {
  const ranges = ["requested", "received", "stored"]
    .flatMap((field) =>
      (active[field] as IndexRange[]).map((range) => ({ ...range, field })),
    )
    .sort((left, right) => left.start - right.start || left.end_exclusive - right.end_exclusive);
  let previousEnd = 0;
  for (const range of ranges) {
    if (range.end_exclusive > pieceLength || range.start < previousEnd) {
      throw new ContractError("active piece lifecycle ranges overlap");
    }
    previousEnd = range.end_exclusive;
  }
}

function validateDiskPipeline(value: unknown): void {
  const pipeline = asRecord(value, "disk pipeline");
  oneOf(pipeline.pressure, "disk pressure", [
    "idle",
    "normal",
    "backpressured",
    "draining",
    "error",
  ]);
  oneOf(pipeline.checkpoint_stage, "disk checkpoint stage", [
    "idle",
    "syncing",
    "committing",
    "error",
  ]);
  boolean(pipeline.intake_backpressured, "disk intake backpressure");
  [
    "sample_millis",
    "resident_limit_bytes",
    "resident_high_watermark_bytes",
    "resident_low_watermark_bytes",
    "requested_bytes",
    "resident_bytes",
    "queued_write_bytes",
    "writing_bytes",
    "hashing_bytes",
    "checkpoint_dirty_pieces",
    "checkpoint_dirty_bytes",
    "checkpoint_dirty_piece_high_water",
    "checkpoint_dirty_byte_high_water",
    "checkpoint_oldest_dirty_millis",
    "checkpoint_batches_started",
    "checkpoint_batches_completed",
    "checkpoint_pieces_completed",
    "checkpoint_sync_operations_completed",
    "checkpoint_sync_service_micros",
    "checkpoint_sync_service_max_micros",
    "checkpoint_commit_service_micros",
    "checkpoint_commit_service_max_micros",
    "storage_jobs_pending",
    "received_bytes_total",
    "stored_bytes_total",
    "verified_bytes_total",
    "receive_rate_bytes",
    "write_rate_bytes",
    "hash_rate_bytes",
    "write_operations_started",
    "write_operations_completed",
    "hash_operations_started",
    "hash_operations_completed",
    "write_queue_wait_micros",
    "write_queue_wait_max_micros",
    "write_service_micros",
    "write_service_max_micros",
    "hash_queue_wait_micros",
    "hash_queue_wait_max_micros",
    "hash_service_micros",
    "hash_service_max_micros",
    "pressure_transition_count",
    "backpressured_millis_total",
  ].forEach((field) => decimal(pipeline[field], `disk ${field}`));
  optionalDecimal(pipeline.checkpoint_active_micros, "disk checkpoint active time");
  optionalString(pipeline.last_error, "disk error", 256);
}

function validateDiskPiece(value: unknown): void {
  const piece = asRecord(value, "active disk piece");
  boundedString(piece.row_id, "disk piece row ID", 256);
  torrentId(piece.torrent_id);
  boundedString(piece.torrent_name, "disk piece torrent name", 255);
  boundedInteger(piece.piece_index, "disk piece index", 0, MAX_U32);
  const pieceLength = boundedInteger(
    piece.piece_length,
    "disk piece length",
    1,
    MAX_U32,
  );
  boundedInteger(piece.attempt, "disk piece attempt", 1, MAX_U32);
  oneOf(piece.stage, "disk piece stage", [
    "receiving",
    "queued",
    "writing",
    "stored",
    "hashing",
    "checkpoint_dirty",
    "checkpoint_syncing",
    "checkpoint_committing",
    "failed",
  ]);
  for (const field of ["requested_bytes", "received_bytes", "stored_bytes"]) {
    const bytes = decimal(piece[field], `disk piece ${field}`);
    if (BigInt(bytes) > BigInt(pieceLength)) {
      throw new ContractError(`disk piece ${field} exceeds the piece length`);
    }
  }
  decimal(piece.age_millis, "disk piece age");
  decimal(piece.stage_age_millis, "disk piece stage age");
  optionalString(piece.error, "disk piece error", 256);
}

function validateRanges(
  value: unknown,
  maximum: number,
  label: string,
): asserts value is IndexRange[] {
  const ranges = array(value, label);
  let previousEnd = 0;
  for (const [index, item] of ranges.entries()) {
    const range = asRecord(item, `${label} range`);
    const start = boundedInteger(range.start, `${label} start`, 0, MAX_U32);
    const end = boundedInteger(
      range.end_exclusive,
      `${label} end`,
      1,
      MAX_U32,
    );
    if (start >= end || end > maximum || (index !== 0 && start <= previousEnd)) {
      throw new ContractError(`${label} are not canonical and bounded`);
    }
    previousEnd = end;
  }
}

function asRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION) {
    throw new ContractError(`${label} must be a bounded array`);
  }
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new ContractError(`${label} must be a string`);
  }
  return value;
}

function boundedString(
  value: unknown,
  label: string,
  maximum: number,
): string {
  const result = string(value, label);
  if (new TextEncoder().encode(result).byteLength > maximum) {
    throw new ContractError(`${label} exceeds ${maximum} bytes`);
  }
  return result;
}

function optionalString(
  value: unknown,
  label: string,
  maximum: number,
): void {
  if (value !== undefined && value !== null) {
    boundedString(value, label, maximum);
  }
}

function optionalDecimal(value: unknown, label: string): void {
  if (value !== undefined && value !== null) decimal(value, label);
}

function nullableDecimal(value: unknown, label: string): string | null {
  return value === null ? null : decimal(value, label);
}

function optionalBoolean(value: unknown, label: string): void {
  if (value !== undefined && value !== null) boolean(value, label);
}

function optionalInteger(value: unknown, label: string, maximum: number): void {
  if (value !== undefined && value !== null) {
    boundedInteger(value, label, 0, maximum);
  }
}

function decimal(value: unknown, label: string): string {
  const result = string(value, label);
  if (!DECIMAL.test(result) || result.length > 20) {
    throw new ContractError(`${label} must be a bounded canonical decimal`);
  }
  return result;
}

function identifier(value: unknown, label: string): string {
  const result = string(value, label);
  if (!IDENTIFIER.test(result)) {
    throw new ContractError(`${label} is invalid`);
  }
  return result;
}

function torrentId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !TORRENT_ID.test(value)) {
    throw new ContractError("torrent ID is invalid");
  }
}

function validateProtocolIdentities(value: unknown): void {
  const identities = asRecord(value, "torrent protocol identities");
  const v1 = identities.v1;
  const v2 = identities.v2;
  if (v1 === undefined && v2 === undefined) {
    throw new ContractError("torrent protocol identities must not be empty");
  }
  if (v1 !== undefined && (typeof v1 !== "string" || !V1_INFO_HASH.test(v1))) {
    throw new ContractError("v1 info hash is invalid");
  }
  if (v2 !== undefined && (typeof v2 !== "string" || !V2_INFO_HASH.test(v2))) {
    throw new ContractError("v2 info hash is invalid");
  }
}

function sha1Hex(value: unknown, label: string): void {
  if (typeof value !== "string" || !SHA1_HEX.test(value)) {
    throw new ContractError(`${label} must be a 20-byte hexadecimal value`);
  }
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new ContractError(`${label} must be boolean`);
  }
  return value;
}

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ContractError(`${label} must be an integer in range`);
  }
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  label: string,
  choices: readonly T[],
): T {
  const result = string(value, label);
  if (!choices.includes(result as T)) {
    throw new ContractError(`${label} is unknown`);
  }
  return result as T;
}

export type ValidatedSnapshot = ServiceSnapshot;
export type ValidatedViewSnapshot = ViewSnapshot;
export type ValidatedViewPatch = ViewPatch;
export type ValidatedViewUpdate = ViewUpdate;
