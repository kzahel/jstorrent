import { message as localizedMessage } from "../../localization/runtime";
import type {
  DemoScenarioId,
  DemoScenarioSummary,
  DiskPieceRow,
  DiskSet,
  FileRow,
  FileSet,
  InspectionSnapshot,
  LogRow,
  MediaRow,
  MediaSet,
  PeerRow,
  SwarmRow,
  SwarmSet,
  PieceMapSet,
  SpeedInspectionView,
  TorrentEta,
  TorrentCheckingProgress,
  TorrentRow,
  TrackerRow,
  TrackerSet,
} from "../model";
import {
  DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW,
  type DhtInspectionView,
  type SpeedHistoryView,
} from "../../api";
import { emptyDiskSet } from "../state";

const BASE_TIME_MS = Date.UTC(2026, 7, 1, 8, 0, 0);
const BUNNY_ID = "t1-00000000000000000000000000000001";
const SINTEL_ID = "t1-00000000000000000000000000000002";
const ARCH_ID = "t1-00000000000000000000000000000003";
const MEDIA_LIBRARY_ID = "t1-00000000000000000000000000000004";
const DEMO_INFO_HASHES: Readonly<Record<string, string>> = {
  [BUNNY_ID]: "a962f460b83861cfb5faa1d7ad7da9c3f3cc2fc4",
  [SINTEL_ID]: "08ada5a7a6183aae1e09d831df6748d566095a10",
  [ARCH_ID]: "e2d1f50a5d72bfc9c4d6c3f9913b1dfb2cf4f210",
  [MEDIA_LIBRARY_ID]: "c3cc3e6ca44942f80e7b7b318773c18360864027",
};

export const DEMO_SCENARIOS: readonly DemoScenarioSummary[] = [
  {
    id: "healthy-download",
    title: localizedMessage("inspection.demo.catalog.healthy.download"),
    description: localizedMessage("inspection.demo.catalog.metadata.useful.peers.sustained.transfer.and.completion"),
    durationMs: 110_000,
    autoplay: true,
  },
  {
    id: "media-library",
    title: localizedMessage("inspection.demo.catalog.tv.media.library"),
    description: localizedMessage("inspection.demo.catalog.misordered.episodes.sidecars.and.exact.file.progress"),
    durationMs: 60_000,
    autoplay: false,
  },
  {
    id: "checking-progress",
    title: localizedMessage("inspection.demo.catalog.checking.progress"),
    description: localizedMessage("inspection.demo.catalog.queued.hashing.fencing.paused.and.finalizing.checker"),
    durationMs: 60_000,
    autoplay: true,
  },
  {
    id: "stalled-metadata",
    title: localizedMessage("inspection.demo.catalog.stalled.metadata"),
    description: localizedMessage("inspection.demo.catalog.candidates.exist.but.no.metadata.request.is"),
    durationMs: 120_000,
    autoplay: true,
  },
  {
    id: "tracker-recovery",
    title: localizedMessage("inspection.demo.catalog.tracker.recovery"),
    description: localizedMessage("inspection.demo.catalog.a.udp.timeout.backs.off.retries.and"),
    durationMs: 80_000,
    autoplay: true,
  },
  {
    id: "endgame",
    title: localizedMessage("inspection.demo.catalog.endgame"),
    description: localizedMessage("inspection.demo.catalog.the.final.blocks.duplicate.safely.and.converge"),
    durationMs: 35_000,
    autoplay: true,
  },
  {
    id: "piece-retry",
    title: localizedMessage("inspection.demo.catalog.piece.hash.retry"),
    description: localizedMessage("inspection.demo.catalog.a.corrupt.attempt.fails.clears.and.retries"),
    durationMs: 30_000,
    autoplay: true,
  },
  {
    id: "large-swarm",
    title: localizedMessage("inspection.demo.catalog.large.swarm"),
    description: localizedMessage("inspection.demo.catalog.2.000.torrents.10.000.connections.and"),
    durationMs: 60_000,
    autoplay: false,
  },
  {
    id: "swarm-lifecycle",
    title: localizedMessage("inspection.demo.catalog.swarm.lifecycle"),
    description: localizedMessage("inspection.demo.catalog.peer.candidates.merge.dial.connect.back.off"),
    durationMs: 45_000,
    autoplay: true,
  },
  {
    id: "file-progress",
    title: localizedMessage("inspection.demo.catalog.file.progress"),
    description: localizedMessage("inspection.demo.catalog.a.4.096.row.file.tree.with"),
    durationMs: 90_000,
    autoplay: true,
  },
  {
    id: "slow-disk-pressure",
    title: localizedMessage("inspection.demo.catalog.slow.disk.pressure"),
    description: localizedMessage("inspection.demo.catalog.receive.buffers.fill.intake.pauses.drains.and"),
    durationMs: 70_000,
    autoplay: true,
  },
  {
    id: "disk-error",
    title: localizedMessage("inspection.demo.catalog.disk.error"),
    description: localizedMessage("inspection.demo.catalog.a.storage.write.fails.and.leaves.an"),
    durationMs: 60_000,
    autoplay: false,
  },
  {
    id: "diagnostic-console",
    title: localizedMessage("inspection.demo.catalog.diagnostic.console"),
    description: localizedMessage("inspection.demo.catalog.mixed.structured.records.scopes.severities.and.a"),
    durationMs: 45_000,
    autoplay: true,
  },
  {
    id: "speed-steady",
    title: localizedMessage("inspection.demo.catalog.speed.steady"),
    description: localizedMessage("inspection.demo.catalog.a.sustained.transfer.with.a.narrow.stable"),
    durationMs: 90_000,
    autoplay: true,
  },
  {
    id: "speed-bursty",
    title: localizedMessage("inspection.demo.catalog.speed.bursty"),
    description: localizedMessage("inspection.demo.catalog.short.payload.bursts.separate.receive.storage.and"),
    durationMs: 90_000,
    autoplay: true,
  },
  {
    id: "speed-idle",
    title: localizedMessage("inspection.demo.catalog.speed.idle"),
    description: localizedMessage("inspection.demo.catalog.complete.zero.buckets.remain.distinct.from.stale"),
    durationMs: 60_000,
    autoplay: false,
  },
  {
    id: "speed-hash-retry",
    title: localizedMessage("inspection.demo.catalog.speed.hash.retry"),
    description: localizedMessage("inspection.demo.catalog.failed.work.remains.counted.before.a.clean"),
    durationMs: 45_000,
    autoplay: true,
  },
  {
    id: "speed-traffic-breakdown",
    title: localizedMessage("inspection.demo.catalog.speed.traffic"),
    description: localizedMessage("inspection.demo.catalog.peer.metadata.dht.tracker.and.hash.traffic"),
    durationMs: 60_000,
    autoplay: true,
  },
  {
    id: "speed-history",
    title: localizedMessage("inspection.demo.catalog.speed.history.gaps"),
    description: localizedMessage("inspection.demo.catalog.retained.history.contains.explicit.process.offline.gaps"),
    durationMs: 60_000,
    autoplay: false,
  },
  {
    id: "speed-unavailable-upload",
    title: localizedMessage("inspection.demo.catalog.speed.unavailable.upload"),
    description: localizedMessage("inspection.demo.catalog.payload.upload.is.unavailable.rather.than.reported"),
    durationMs: 60_000,
    autoplay: false,
  },
  {
    id: "speed-stale",
    title: localizedMessage("inspection.demo.catalog.speed.stale"),
    description: localizedMessage("inspection.demo.catalog.the.last.authoritative.plot.freezes.when.delivery"),
    durationMs: 60_000,
    autoplay: false,
  },
  {
    id: "speed-reset",
    title: localizedMessage("inspection.demo.catalog.speed.epoch.reset"),
    description: localizedMessage("inspection.demo.catalog.a.new.history.epoch.replaces.the.previous"),
    durationMs: 60_000,
    autoplay: true,
  },
  {
    id: "dht-observatory",
    title: localizedMessage("inspection.demo.catalog.dht.observatory"),
    description: localizedMessage("inspection.demo.catalog.routing.depth.freshness.replacements.and.lookup.convergence"),
    durationMs: 70_000,
    autoplay: true,
  },
  {
    id: "empty-library",
    title: localizedMessage("inspection.demo.catalog.empty.library"),
    description: localizedMessage("inspection.demo.catalog.a.clean.first.run.library.with.no"),
    durationMs: 60_000,
    autoplay: false,
  },
];

export function isDemoScenarioId(value: string | null): value is DemoScenarioId {
  return DEMO_SCENARIOS.some((scenario) => scenario.id === value);
}

export function demoScenario(id: DemoScenarioId): DemoScenarioSummary {
  const result = DEMO_SCENARIOS.find((scenario) => scenario.id === id);
  if (result === undefined) throw new Error(`unknown demo scenario: ${id}`);
  return result;
}

export function buildScenarioSnapshot(
  scenarioId: DemoScenarioId,
  elapsedMs: number,
  running: boolean,
  revision: number,
): InspectionSnapshot {
  const scenario = demoScenario(scenarioId);
  const elapsed = clamp(elapsedMs, 0, scenario.durationMs);
  const content = buildScenarioContent(scenarioId, elapsed);
  const torrents = Object.fromEntries(content.torrents.map((row) => [row.id, row]));
  const peersByTorrent = Object.fromEntries(
    Object.entries(content.peers).map(([torrentId, rows]) => [
      torrentId,
      {
        order: rows.map((row) => row.connectionId),
        rows: Object.fromEntries(rows.map((row) => [row.connectionId, row])),
      },
    ]),
  );
  const filesByTorrent = content.files ?? {};
  const derivedMediaByTorrent = Object.fromEntries(
    Object.entries(filesByTorrent).map(([torrentId, files]) => [
      torrentId,
      demoMediaSet(torrentId, files),
    ]),
  );
  const mediaByTorrent = {
    ...derivedMediaByTorrent,
    ...(content.media ?? {}),
  };
  const swarmByTorrent = content.swarm ?? {};
  const trackersByTorrent = content.trackers ?? {};
  const piecesByTorrent = content.pieces ?? {};
  const disk = content.disk ?? emptyDiskSet();
  const active = content.torrents.filter(
    (torrent) => torrent.status === "downloading" || torrent.status === "metadata",
  );
  return {
    revision,
    durableRevision: String(revision),
    session: {
      connection: { type: "demo" },
      downloadRate: sum(active.map((torrent) => torrent.downloadRate)),
      uploadRate: sum(active.map((torrent) => torrent.uploadRate ?? 0)),
      dhtNodes: scenarioId === "empty-library" ? 0 : 638,
      knownPeers: sum(content.torrents.map((torrent) => torrent.peersKnown ?? 0)),
    },
    demo: {
      scenarioId,
      elapsedMs: elapsed,
      running,
      durationMs: scenario.durationMs,
    },
    storage: { roots: [], defaultRoot: null, showAddOptions: true },
    clientSettings: structuredClone(DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW),
    torrentOrder: content.torrents.map((torrent) => torrent.id),
    torrents,
    peersByTorrent,
    swarmByTorrent,
    filesByTorrent,
    mediaByTorrent,
    trackersByTorrent,
    piecesByTorrent,
    disk,
    dht: buildDhtInspection(elapsed, scenarioId),
    speed: buildSpeedHistory(elapsed, scenarioId),
    logs: content.logs.slice(-2_048),
    logLoss: {
      sourceEvictedCount: 0,
      retainedFromSequence: content.logs.at(-2_048)?.id ?? "1",
      localEvictedCount: Math.max(0, content.logs.length - 2_048),
      deliveryResetCount: 0,
      lastDeliveryResetReason: null,
    },
    viewStatus: {
      library: { status: "ready" },
      torrentSummary: { status: "ready" },
      peers: { status: "ready" },
      swarm: { status: "ready" },
      files: { status: "ready" },
      media: { status: "ready" },
      trackers: { status: "ready" },
      pieces: { status: "ready" },
      disk: { status: "ready" },
      dht: scenarioId === "dht-observatory" && elapsed >= 60_000 && elapsed < 65_000
        ? { status: "stale", reason: localizedMessage("inspection.demo.catalog.demo.observation.delivery.paused") }
        : { status: "ready" },
      speed: scenarioId === "speed-stale"
        ? { status: "stale", reason: localizedMessage("inspection.demo.catalog.demo.delivery.paused") }
        : { status: "ready" },
      logs: { status: "ready" },
    },
  };
}

function buildDhtInspection(
  elapsedMs: number,
  scenarioId: DemoScenarioId,
): DhtInspectionView {
  const isObservatory = scenarioId === "dht-observatory";
  const offline = isObservatory && elapsedMs < 2_500;
  const bootstrap = isObservatory && elapsedMs >= 2_500 && elapsedMs < 7_000;
  const sparse = isObservatory && elapsedMs >= 7_000 && elapsedMs < 12_000;
  const inactive = isObservatory && elapsedMs >= 65_000;
  const deepOutlier = isObservatory && elapsedMs >= 45_000 && !inactive;
  const lookupActive = isObservatory && elapsedMs >= 15_000 && elapsedMs < 40_000;
  const malformed = isObservatory && elapsedMs >= 35_000 ? 3 : 0;
  const rateLimited = isObservatory && elapsedMs >= 40_000 ? 17 : 0;
  const buckets = Array.from({ length: 160 }, (_, bucketIndex) => ({
    bucket_index: bucketIndex,
    good_nodes: 0,
    questionable_nodes: 0,
    replacement_candidates: 0,
    oldest_live_response_age_millis: null as string | null,
  }));
  if (!offline && !bootstrap && !inactive) {
    for (let depth = 0; depth <= 24; depth += 1) {
      if (sparse && ![0, 8, 17, 24].includes(depth)) continue;
      const bucket = buckets[159 - depth]!;
      const live = sparse ? (depth === 24 ? 2 : 4) : depth < 24 ? 7 : 3;
      const questionable = depth === 16 ? 2 : 0;
      bucket.good_nodes = live - questionable;
      bucket.questionable_nodes = questionable;
      bucket.replacement_candidates = depth % 5 === 0 ? 2 : depth % 3 === 0 ? 1 : 0;
      const ageSeconds = depth >= 20
        ? 720 + (depth - 20) * 38
        : depth === 16
          ? 925
          : 35 + depth * 19;
      bucket.oldest_live_response_age_millis = String(ageSeconds * 1_000);
    }
    if (deepOutlier) {
      const outlier = buckets[120]!;
      outlier.good_nodes = 1;
      outlier.replacement_candidates = 1;
      outlier.oldest_live_response_age_millis = "44000";
    }
  }
  const routingNodes = buckets.reduce(
    (total, bucket) => total + bucket.good_nodes + bucket.questionable_nodes,
    0,
  );
  const occupied = buckets.filter(
    (bucket) => bucket.good_nodes + bucket.questionable_nodes > 0,
  );
  const deepest = occupied.length === 0
    ? null
    : Math.max(...occupied.map((bucket) => 159 - bucket.bucket_index));
  const lookupAge = Math.max(0, elapsedMs - 15_000);
  const convergence = lookupAge < 7_000 ? 8 : lookupAge < 15_000 ? 17 : 24;
  const lastImprovementAt = lookupAge < 7_000 ? 1_500 : lookupAge < 15_000 ? 7_000 : 15_000;
  const lookups = lookupActive
    ? [
        {
          family: "ipv4" as const,
          lookup_id: "41",
          target_id: "6f8d9fa18b1c2d3e4f5061728394a5b6c7d8e9f0",
          age_millis: String(lookupAge),
          deadline_in_millis: String(Math.max(0, 30_000 - lookupAge)),
          unqueried_candidates: lookupAge < 10_000 ? 18 : 7,
          in_flight_candidates: 3,
          responded_candidates: lookupAge < 7_000 ? 11 : lookupAge < 15_000 ? 26 : 44,
          failed_candidates: lookupAge < 7_000 ? 1 : 5,
          discovered_peers: lookupAge < 15_000 ? 0 : 12,
          closest_responded_prefix_bits: convergence,
          last_convergence_improvement_age_millis: String(
            Math.max(0, lookupAge - lastImprovementAt),
          ),
        },
      ]
    : [];
  const lifecycle = inactive
      ? "inactive"
      : offline
        ? "offline"
      : bootstrap
        ? "bootstrap_empty"
        : "participating";
  const queriesSent = String(Math.floor(elapsedMs / 700) + (bootstrap ? 0 : 31));
  const responsesReceived = String(
    Math.floor(elapsedMs / 1_050) + (bootstrap ? 0 : 24),
  );
  const queriesReceived = String(Math.floor(elapsedMs / 1_800));
  const discoveredPeers = lookupActive && lookupAge >= 15_000 ? "12" : "0";
  const bootstrapAttempts = bootstrap ? "1" : "2";
  const routingRefreshes = elapsedMs >= 30_000 ? "1" : "0";
  const datagramBytesSent = String(Math.floor(elapsedMs * 1.7));
  const datagramBytesReceived = String(Math.floor(elapsedMs * 2.4) + malformed * 11);
  const emptyIpv6Buckets = Array.from({ length: 160 }, (_, bucket_index) => ({
    bucket_index,
    good_nodes: 0,
    questionable_nodes: 0,
    replacement_candidates: 0,
    oldest_live_response_age_millis: null as string | null,
  }));
  return {
    lifecycle,
    network_policy: offline ? "offline" : "loopback_only",
    captured_millis: String(1_700_000_000_000 + elapsedMs),
    active_transactions: lookupActive ? 3 : 0,
    active_lookups: lookups.length,
    queries_sent: queriesSent,
    responses_received: responsesReceived,
    queries_received: queriesReceived,
    malformed_received: String(malformed),
    family_mismatched: "0",
    rate_limited: String(rateLimited),
    discovered_peers: discoveredPeers,
    bootstrap_attempts: bootstrapAttempts,
    routing_refreshes: routingRefreshes,
    datagram_bytes_sent: datagramBytesSent,
    datagram_bytes_received: datagramBytesReceived,
    announces_sent: "0",
    announces_succeeded: "0",
    announces_failed: "0",
    families: [
      {
        family: "ipv4",
        lifecycle,
        local_node_id: "4a8c1284e76d095b3f2101ccd09a7e5b621de340",
        local_address: "127.0.0.1:6881",
        observed_external_address: null,
        routing_nodes: routingNodes,
        occupied_buckets: occupied.length,
        deepest_shared_prefix_bits: deepest,
        active_transactions: lookupActive ? 3 : 0,
        active_lookups: lookups.length,
        queries_sent: queriesSent,
        responses_received: responsesReceived,
        queries_received: queriesReceived,
        malformed_received: String(malformed),
        family_mismatched: "0",
        rate_limited: String(rateLimited),
        discovered_peers: discoveredPeers,
        bootstrap_attempts: bootstrapAttempts,
        routing_refreshes: routingRefreshes,
        datagram_bytes_sent: datagramBytesSent,
        datagram_bytes_received: datagramBytesReceived,
        announces_sent: "0",
        announces_succeeded: "0",
        announces_failed: "0",
        buckets,
      },
      {
        family: "ipv6",
        lifecycle: inactive ? "inactive" : offline ? "offline" : "bootstrap_empty",
        local_node_id: "85c2f1a7093b4d6e8f102132435465768798a9ba",
        local_address: "[::1]:6881",
        observed_external_address: null,
        routing_nodes: 0,
        occupied_buckets: 0,
        deepest_shared_prefix_bits: null,
        active_transactions: 0,
        active_lookups: 0,
        queries_sent: "0",
        responses_received: "0",
        queries_received: "0",
        malformed_received: "0",
        family_mismatched: "0",
        rate_limited: "0",
        discovered_peers: "0",
        bootstrap_attempts: "0",
        routing_refreshes: "0",
        datagram_bytes_sent: "0",
        datagram_bytes_received: "0",
        announces_sent: "0",
        announces_succeeded: "0",
        announces_failed: "0",
        buckets: emptyIpv6Buckets,
      },
    ],
    lookups,
  };
}

function buildSpeedHistory(
  elapsedMs: number,
  scenarioId: DemoScenarioId,
): SpeedInspectionView {
  const count = 300;
  const bucketMillis = 100;
  const animatedElapsed = scenarioId === "speed-stale" ? 25_000 : elapsedMs;
  const completeThrough = 1_700_000_000_000 +
    Math.floor(animatedElapsed / bucketMillis) * bucketMillis;
  const start = completeThrough - (count - 1) * bucketMillis;
  const makeValues = (scale: number, lag: number) =>
    Array.from({ length: count }, (_, index) => {
      const phase = (index + Math.floor(elapsedMs / bucketMillis) - lag) / 18;
      const steady = scenarioId === "speed-steady";
      const bursty = scenarioId === "speed-bursty";
      const idle = scenarioId === "speed-idle";
      const envelope = steady ? 0.82 + Math.sin(phase / 5) * 0.035 :
        0.62 + Math.sin(phase / 4) * 0.18;
      const pulse = bursty ? Math.max(0, Math.sin(phase)) ** 5 * 0.72 :
        Math.max(0, Math.sin(phase)) * 0.28;
      if (scenarioId === "speed-history" && index > 105 && index < 155) return null;
      if (scenarioId === "speed-reset" && index < 80) return null;
      return Math.round((idle ? 0 : scale * (envelope + pulse)) * bucketMillis / 1000).toString();
    });
  const catalog: SpeedHistoryView["catalog"] = [
    ...[
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
    ].map((metric) => ({
      metric: metric as SpeedHistoryView["catalog"][number]["metric"],
      available: true,
      reason: null,
    })),
    {
      metric: "payload_uploaded",
      available: false,
      reason: localizedMessage("inspection.demo.catalog.upload.and.seeding.are.not.implemented"),
    },
  ];
  return {
    captured_millis: completeThrough.toString(),
    history_epoch: scenarioId === "speed-reset" && elapsedMs >= 30_000
      ? "demo-speed-2"
      : "demo-speed-1",
    range: "seconds30",
    bucket_millis: bucketMillis.toString(),
    start_millis: start.toString(),
    complete_through_millis: completeThrough.toString(),
    live: true,
    persistence: "healthy",
    current: catalog
      .filter((entry) => entry.available)
      .map((entry) => ({
        metric: entry.metric,
        bytes:
          entry.metric === "payload_received"
            ? scenarioId === "speed-idle" ? "0" : "7864320"
            : entry.metric === "staged_write"
              ? scenarioId === "speed-idle" ? "0" : "7340032"
              : entry.metric === "payload_verified"
                ? scenarioId === "speed-idle" ? "0" : "6815744"
                : demoTrafficRate(entry.metric, scenarioId),
      })),
    series: [
      {
        metric: "payload_received",
        current_rate_bytes: "7864320",
        values: makeValues(8 * 1024 * 1024, 0),
      },
      {
        metric: "staged_write",
        current_rate_bytes: "7340032",
        values: makeValues(7.4 * 1024 * 1024, 3),
      },
      {
        metric: "payload_verified",
        current_rate_bytes: "6815744",
        values: makeValues(6.8 * 1024 * 1024, 7),
      },
    ],
    catalog,
  };
}

function demoTrafficRate(
  metric: SpeedHistoryView["catalog"][number]["metric"],
  scenarioId: DemoScenarioId,
): string {
  if (scenarioId !== "speed-traffic-breakdown" && scenarioId !== "speed-hash-retry") {
    return "0";
  }
  const rates: Partial<Record<typeof metric, string>> = {
    peer_wire_received: "8431200",
    peer_wire_sent: "182000",
    peer_protocol_received: "294000",
    peer_protocol_sent: "96000",
    metadata_payload_received: "42000",
    metadata_payload_sent: "8000",
    dht_received: "18000",
    dht_sent: "12000",
    tracker_received: "1400",
    tracker_sent: "900",
    logical_hash_read: "7020000",
    payload_redundant: "96000",
    payload_hash_failed: scenarioId === "speed-hash-retry" ? "2097152" : "8000",
  };
  return rates[metric] ?? "0";
}

interface ScenarioContent {
  readonly torrents: readonly TorrentRow[];
  readonly peers: Readonly<Record<string, readonly PeerRow[]>>;
  readonly swarm?: Readonly<Record<string, SwarmSet>>;
  readonly files?: Readonly<Record<string, FileSet>>;
  readonly media?: Readonly<Record<string, MediaSet>>;
  readonly trackers?: Readonly<Record<string, TrackerSet>>;
  readonly pieces?: Readonly<Record<string, PieceMapSet>>;
  readonly disk?: DiskSet;
  readonly logs: readonly LogRow[];
}

function buildScenarioContent(
  scenarioId: DemoScenarioId,
  elapsedMs: number,
): ScenarioContent {
  const content = (() => {
    switch (scenarioId) {
    case "healthy-download":
      return healthyDownload(elapsedMs);
    case "media-library":
      return mediaLibrary();
    case "checking-progress":
      return checkingProgress(elapsedMs);
    case "stalled-metadata":
      return stalledMetadata(elapsedMs);
    case "tracker-recovery":
      return trackerRecovery(elapsedMs);
    case "endgame":
      return endgame(elapsedMs);
    case "piece-retry":
      return pieceRetry(elapsedMs);
    case "large-swarm":
      return largeSwarm();
    case "swarm-lifecycle":
      return swarmLifecycle(elapsedMs);
    case "file-progress":
      return fileProgress(elapsedMs);
    case "slow-disk-pressure":
      return slowDiskPressure(elapsedMs);
    case "disk-error":
      return diskError(elapsedMs);
    case "diagnostic-console":
      return diagnosticConsole(elapsedMs);
    case "speed-steady":
    case "speed-bursty":
    case "speed-idle":
    case "speed-hash-retry":
    case "speed-traffic-breakdown":
    case "speed-history":
    case "speed-unavailable-upload":
    case "speed-stale":
    case "speed-reset":
    case "dht-observatory":
      return healthyDownload(elapsedMs);
    case "empty-library":
      return { torrents: [], peers: {}, logs: [] };
    }
  })();
  return {
    ...content,
    pieces: buildPieceMaps(scenarioId, elapsedMs, content.torrents),
  };
}

function checkingProgress(elapsedMs: number): ScenarioContent {
  const total = 1_000;
  const phase: TorrentCheckingProgress["phase"] =
    elapsedMs < 4_000
      ? "queued"
      : elapsedMs < 8_000
        ? "preparing"
        : elapsedMs < 33_000
          ? "hashing"
          : elapsedMs < 40_000
            ? "reconciling_storage"
            : elapsedMs < 46_000
              ? "paused"
              : elapsedMs < 56_000
                ? "hashing"
                : "finalizing";
  const firstHashProgress = clamp((elapsedMs - 8_000) / 25_000, 0, 1);
  const resumedHashProgress = clamp((elapsedMs - 46_000) / 10_000, 0, 1);
  const processed =
    elapsedMs < 46_000
      ? Math.round(total * firstHashProgress)
      : Math.round(total * (0.8 + resumedHashProgress * 0.2));
  const absent = Math.min(processed, 2);
  const mismatched = processed > 2 ? 1 : 0;
  const matched = processed - absent - mismatched;
  const active = phase === "hashing" ? 4 : 0;
  const checking: TorrentCheckingProgress = {
    generation: "7",
    phase,
    piecesTotal: total,
    piecesProcessed: processed,
    piecesMatched: matched,
    piecesAbsent: absent,
    piecesMismatched: mismatched,
    bytesHashed: String(matched * 262_144),
    activeHashJobs: active,
    queuedHashJobs: Math.max(0, total - processed - active),
    elapsedMs,
    lastAdvanceAgeMs: phase === "hashing" ? 180 : Math.max(0, elapsedMs - 33_000),
    oldestActiveJobAgeMs: active === 0 ? null : 740,
  };
  return {
    torrents: [
      torrent({
        id: BUNNY_ID,
        name: "Big Buck Bunny 1080p surround",
        status: "checking",
        sizeBytes: 276_445_467,
        progress: 0.64,
        checking,
        progressReason: localizedMessage("inspection.demo.catalog.conservative.full.verification.is.active"),
      }),
    ],
    peers: {},
    files: { [BUNNY_ID]: demoFileSet(BUNNY_ID, 0.64, 36) },
    logs: timelineLogs(
      BUNNY_ID,
      [
        [0, "info", "integrity", "Full verification queued"],
        [8, "info", "integrity", "Bounded piece hashing started"],
        [33, "info", "storage", "Latest file selection entered its storage fence"],
        [40, "info", "lifecycle", "Checker paused after admitted hashes drained"],
        [46, "info", "lifecycle", "Checker resumed with its cursor retained"],
        [56, "info", "integrity", "Candidate bitmap is finalizing"],
      ],
      elapsedMs,
    ),
  };
}

function healthyDownload(elapsedMs: number): ScenarioContent {
  const seconds = elapsedMs / 1000;
  const metadata = seconds < 7;
  const progress = metadata ? null : clamp((seconds - 7) / 90, 0, 1);
  const complete = progress === 1;
  const rate = metadata || complete ? 0 : 11_400_000 + wave(seconds, 2_600_000);
  const peers = metadata ? buildPeers(BUNNY_ID, 8, seconds, 0.28) : buildPeers(BUNNY_ID, 36, seconds, progress ?? 0);
  const primary = torrent({
    id: BUNNY_ID,
    name: "Big Buck Bunny 1080p surround",
    status: complete ? "complete" : metadata ? "metadata" : "downloading",
    sizeBytes: metadata ? null : 276_445_467,
    progress,
    downloadRate: rate,
    uploadRate: complete ? 310_000 : 82_000,
    peersConnected: peers.length,
    peersKnown: 143,
    eta:
      metadata || complete
        ? { state: "unavailable" }
        : seconds < 8
          ? { state: "warming_up" }
          : estimateEta(Math.max(1, Math.ceil(97 - seconds))),
    progressReason: complete ? "All pieces verified" : metadata ? "Requesting metadata from 8 peers" : "Receiving useful blocks from multiple peers",
  });
  const completed = torrent({
    id: ARCH_ID,
    name: "Arch Linux 2026.08.01 x86_64",
    status: "complete",
    sizeBytes: 1_265_348_608,
    progress: 1,
    uploadRate: 1_820_000,
    uploadedBytes: 3_812_881_408,
    peersConnected: 6,
    peersKnown: 47,
    progressReason: localizedMessage("inspection.demo.catalog.seeding.to.6.peers"),
    addedAtMs: BASE_TIME_MS - 86_400_000,
  });
  const paused = torrent({
    id: SINTEL_ID,
    name: "Sintel 4K open movie",
    status: "paused",
    sizeBytes: 4_294_967_296,
    progress: 0.642,
    downloadedBytes: 2_757_797_003,
    peersConnected: 0,
    peersKnown: 91,
    progressReason: localizedMessage("inspection.demo.catalog.paused.by.user"),
    addedAtMs: BASE_TIME_MS - 7_200_000,
  });
  return {
    torrents: [primary, completed, paused],
    peers: { [BUNNY_ID]: peers },
    files: { [BUNNY_ID]: demoFileSet(BUNNY_ID, progress ?? 0, 36) },
    logs: timelineLogs(BUNNY_ID, [
      [0, "info", "lifecycle", "Torrent added from magnet"],
      [1, "info", "tracker", "Announce started for 3 UDP trackers"],
      [2, "info", "dht", "DHT lookup returned 54 peer candidates"],
      [4, "debug", "peer", "Eight metadata connections established"],
      [7, "info", "metadata", "Metadata verified: 1,055 pieces, 3 files"],
      [8, "info", "scheduler", "Content request window opened across 16 peers"],
      [25, "debug", "storage", "Write queue healthy: 18 jobs, 288 KiB retained"],
      [62, "info", "piece", "Verified 50% of wanted payload"],
      [94, "debug", "scheduler", "Entering bounded endgame"],
      [98, "info", "integrity", "All pieces verified"],
      [99, "info", "storage", "All 3 direct files verified"],
    ], elapsedMs),
  };
}

function mediaLibrary(): ScenarioContent {
  const catalog = namedMediaLibraryCatalog();
  const requiredBytes = catalog.files.order.reduce(
    (total, id) => {
      const file = catalog.files.rows[id];
      return file === undefined || file.selection === "skipped"
        ? total
        : total + BigInt(file.lengthBytes);
    },
    0n,
  );
  const doneBytes = catalog.files.order.reduce(
    (total, id) => total + BigInt(catalog.files.rows[id]?.doneBytes ?? "0"),
    0n,
  );
  const totalBytes = catalog.files.order.reduce(
    (total, id) => total + BigInt(catalog.files.rows[id]?.lengthBytes ?? "0"),
    0n,
  );
  return {
    torrents: [
      torrent({
        id: MEDIA_LIBRARY_ID,
        name: "North Shore Stories · Seasons 1–2",
        status: "downloading",
        sizeBytes: Number(totalBytes),
        progress: Number(doneBytes) / Number(totalBytes),
        downloadedBytes: Number(doneBytes),
        requiredPayloadBytes: requiredBytes.toString(),
        remainingPayloadBytes: (requiredBytes - doneBytes).toString(),
        downloadRate: 3_800_000,
        uploadRate: 96_000,
        peersConnected: 11,
        peersKnown: 38,
        eta: estimateEta(214),
        progressReason: localizedMessage("inspection.demo.catalog.downloading.selected.episodes"),
      }),
    ],
    peers: {
      [MEDIA_LIBRARY_ID]: buildPeers(MEDIA_LIBRARY_ID, 11, 24, 0.58),
    },
    files: { [MEDIA_LIBRARY_ID]: catalog.files },
    media: { [MEDIA_LIBRARY_ID]: catalog.media },
    logs: timelineLogs(
      MEDIA_LIBRARY_ID,
      [[0, "info", "metadata", "Metadata verified: 8 files, 6 videos"]],
      60_000,
    ),
  };
}

function namedMediaLibraryCatalog(): {
  readonly files: FileSet;
  readonly media: MediaSet;
} {
  const fixtures: readonly {
    readonly path: readonly string[];
    readonly lengthBytes: bigint;
    readonly doneBytes: bigint;
    readonly verifiedBytes: bigint;
    readonly selection: "normal" | "high" | "skipped";
    readonly role?: MediaRow["role"];
  }[] = [
    {
      path: ["North Shore Stories", "Season 01", "North.Shore.Stories.S01E10.1080p.WEB-DL.mkv"],
      lengthBytes: 810_000_000n,
      doneBytes: 310_000_000n,
      verifiedBytes: 280_000_000n,
      selection: "normal",
      role: episodeRole(1, 10),
    },
    {
      path: ["North Shore Stories", "poster.jpg"],
      lengthBytes: 2_400_000n,
      doneBytes: 2_400_000n,
      verifiedBytes: 2_400_000n,
      selection: "normal",
    },
    {
      path: ["North Shore Stories", "Season 01", "North.Shore.Stories.S01E02.1080p.WEB-DL.mp4"],
      lengthBytes: 760_000_000n,
      doneBytes: 760_000_000n,
      verifiedBytes: 760_000_000n,
      selection: "high",
      role: episodeRole(1, 2),
    },
    {
      path: ["North Shore Stories", "Season 01", "North.Shore.Stories.S01E01.1080p.WEB-DL.mkv"],
      lengthBytes: 745_000_000n,
      doneBytes: 745_000_000n,
      verifiedBytes: 745_000_000n,
      selection: "normal",
      role: episodeRole(1, 1),
    },
    {
      path: ["North Shore Stories", "Season 01", "North.Shore.Stories.S01E07E08.mkv"],
      lengthBytes: 1_120_000_000n,
      doneBytes: 0n,
      verifiedBytes: 0n,
      selection: "skipped",
      role: { ...episodeRole(1, 7), endingEpisodeNumber: 8 },
    },
    {
      path: ["North Shore Stories", "Season 02", "North.Shore.Stories.S02E01.mkv"],
      lengthBytes: 825_000_000n,
      doneBytes: 120_000_000n,
      verifiedBytes: 96_000_000n,
      selection: "normal",
      role: episodeRole(2, 1),
    },
    {
      path: ["North Shore Stories", "Extras", "Behind the scenes.webm"],
      lengthBytes: 184_000_000n,
      doneBytes: 0n,
      verifiedBytes: 0n,
      selection: "normal",
      role: { type: "unclassified_video" },
    },
    {
      path: ["North Shore Stories", "README.nfo"],
      lengthBytes: 18_000n,
      doneBytes: 18_000n,
      verifiedBytes: 18_000n,
      selection: "normal",
    },
  ];
  let offset = 0n;
  const fileRows = fixtures.map((fixture, index): FileRow => {
    const name = fixture.path.at(-1) ?? "";
    const extension = name.includes(".") ? name.split(".").at(-1) ?? "" : "";
    const row: FileRow = {
      id: String(index),
      torrentId: MEDIA_LIBRARY_ID,
      index,
      path: fixture.path,
      name,
      folder: fixture.path.slice(0, -1).join("/"),
      extension: extension.toLowerCase(),
      lengthBytes: fixture.lengthBytes.toString(),
      torrentOffsetBytes: offset.toString(),
      firstPiece: Number(offset / 262_144n),
      lastPiece: Number((offset + fixture.lengthBytes - 1n) / 262_144n),
      selection: fixture.selection,
      padding: false,
      doneBytes: fixture.doneBytes.toString(),
      verifiedBytes: fixture.verifiedBytes.toString(),
      mediaAvailability:
        fixture.verifiedBytes === fixture.lengthBytes
          ? "available"
          : fixture.doneBytes > 0n && fixture.role !== undefined
            ? "streamable"
            : "unverified",
      storagePath: `/Users/demo/Downloads/${fixture.path.join("/")}`,
    };
    offset += fixture.lengthBytes;
    return row;
  });
  const mediaRows = fixtures.flatMap((fixture, index): MediaRow[] => {
    const file = fileRows[index];
    return fixture.role === undefined || file === undefined
      ? []
      : [
          {
            id: file.id,
            torrentId: file.torrentId,
            fileIndex: file.index,
            path: file.path,
            name: file.name,
            folder: file.folder,
            extension: file.extension,
            lengthBytes: file.lengthBytes,
            selection: fixture.selection,
            doneBytes: file.doneBytes,
            verifiedBytes: file.verifiedBytes,
            mediaAvailability: file.mediaAvailability,
            role: fixture.role,
          },
        ];
  });
  return {
    files: {
      state: "available",
      filesystemContentBase: "/Users/demo/Downloads/North Shore Stories",
      page: {
        offset: 0,
        limit: 1024,
        total: fileRows.length,
        nextOffset: null,
      },
      order: fileRows.map((row) => row.id),
      rows: Object.fromEntries(fileRows.map((row) => [row.id, row])),
    },
    media: {
      state: "available",
      totalNonPaddingFiles: fileRows.length,
      order: mediaRows.map((row) => row.id),
      rows: Object.fromEntries(mediaRows.map((row) => [row.id, row])),
    },
  };
}

function episodeRole(
  seasonNumber: number,
  episodeNumber: number,
): Extract<MediaRow["role"], { readonly type: "episode" }> {
  return {
    type: "episode",
    seriesTitleHint: "North Shore Stories",
    seasonNumber,
    episodeNumber,
    endingEpisodeNumber: null,
  };
}

function diagnosticConsole(elapsedMs: number): ScenarioContent {
  const base = healthyDownload(45_000);
  const categories = [
    "lifecycle.session",
    "tracker.announce",
    "discovery.dht",
    "peer.connection",
    "metadata.exchange",
    "scheduler.request",
    "piece.block",
    "storage.io",
    "integrity.hash",
    "performance.backpressure",
  ] as const;
  const severities = ["info", "debug", "trace", "info", "warning"] as const;
  const messages = [
    "Application profile opened",
    "Tracker announce completed with fresh peers",
    "DHT lookup returned candidate endpoints",
    "Peer extension handshake completed",
    "Piece request window advanced",
    "Storage queue crossed its high watermark",
    "Piece hash verification succeeded",
  ] as const;
  const count = Math.min(10_000, 100 + Math.floor(elapsedMs / 4.5));
  const logs: LogRow[] = Array.from({ length: count }, (_, index) => {
    const category = categories[index % categories.length] ?? "lifecycle.session";
    const torrentId =
      index % 11 === 0 ? null : index % 5 === 0 ? SINTEL_ID : BUNNY_ID;
    const pieceIndex = (index * 17) % 1_055;
    return {
      id: String(index + 1),
      timestampMs: BASE_TIME_MS + index * 210,
      severity: severities[index % severities.length] ?? "info",
      category,
      code: `${category.replaceAll(".", "_")}_${index % 4}`,
      message: messages[index % messages.length] ?? "Diagnostic activity observed",
      torrentId,
      subjects:
        torrentId === null
          ? []
          : category === "piece.block" || category === "integrity.hash"
            ? [{ type: "piece", piece_index: pieceIndex, attempt: 1 + (index % 3) }]
            : category === "tracker.announce"
              ? [{ type: "tracker", tracker_id: "udp://tracker.example:6969/announce" }]
              : [],
      fields: [
        { key: "event_index", value: { type: "count", value: String(index) } },
        ...(category === "storage.io"
          ? [
              {
                key: "queued_bytes",
                value: { type: "bytes" as const, value: String(524_288 + index * 16_384) },
              },
            ]
          : []),
      ],
    };
  });
  return { ...base, logs };
}

function fileProgress(elapsedMs: number): ScenarioContent {
  const progress = clamp(0.18 + elapsedMs / 160_000, 0, 0.92);
  const ordinaryDoneProgress = clamp(0.18 + elapsedMs / 120_000, 0, 0.94);
  const hashFailureActive = elapsedMs >= 36_000 && elapsedMs < 48_000;
  const doneProgress = hashFailureActive
    ? Math.min(ordinaryDoneProgress, progress + 0.005)
    : ordinaryDoneProgress;
  const rate = 18_600_000 + wave(elapsedMs / 1_000, 3_200_000);
  const files = demoFileSet(BUNNY_ID, doneProgress, 4_096, progress);
  const total = Object.values(files.rows).reduce(
    (sum, file) => sum + Number(file.lengthBytes),
    0,
  );
  return {
    torrents: [
      torrent({
        id: BUNNY_ID,
        name: "Open Movies production archive",
        status: "downloading",
        sizeBytes: total,
        progress,
        downloadRate: rate,
        uploadRate: 84_000,
        peersConnected: 22,
        peersKnown: 138,
        eta: estimateEta(Math.max(1, Math.ceil(84 - elapsedMs / 1_000))),
        progressReason: localizedMessage("inspection.demo.catalog.stored.blocks.lead.verified.pieces.in.the"),
      }),
    ],
    peers: { [BUNNY_ID]: buildPeers(BUNNY_ID, 22, elapsedMs / 1_000, progress) },
    files: { [BUNNY_ID]: files },
    logs: timelineLogs(
      BUNNY_ID,
      [
        [0, "info", "metadata", "Metadata verified: 4,096 files"],
        [2, "info", "storage", "Content file layout opened"],
        [8, "debug", "piece", "Stored blocks crossed a file boundary"],
        [18, "debug", "integrity", "Verified piece advanced two file rows"],
        [36, "warning", "piece", "Hash failure regressed unverified Done bytes"],
      ],
      elapsedMs,
    ),
  };
}

function demoFileSet(
  torrentId: string,
  doneProgress: number,
  count: number,
  verifiedProgress = doneProgress,
): FileSet {
  const rows: FileRow[] = [];
  let offset = 0n;
  for (let index = 0; index < count; index += 1) {
    const padding = index === count - 3;
    const length = padding
      ? 262_144n
      : BigInt(1_200_000 + ((index * 7919) % 9_000_000));
    const fileDoneProgress = clamp(doneProgress * count - index, 0, 1);
    const fileVerifiedProgress = Math.min(
      fileDoneProgress,
      clamp(verifiedProgress * count - index, 0, 1),
    );
    const done = padding
      ? length
      : BigInt(Math.floor(Number(length) * fileDoneProgress));
    const verified = padding
      ? length
      : BigInt(Math.floor(Number(length) * fileVerifiedProgress));
    const folder = padding
      ? ".pad"
      : index % 5 === 0
        ? "featurettes/behind-the-scenes"
        : index % 3 === 0
          ? "audio/lossless"
          : "video/chapter-reels";
    const name = padding
      ? length.toString()
      : `asset-${String(index + 1).padStart(3, "0")}.${index % 5 === 0 ? "mkv" : index % 3 === 0 ? "flac" : "mp4"}`;
    const path = [folder, name];
    const id = index.toString();
    rows.push({
      id,
      torrentId,
      index,
      path,
      name,
      folder,
      extension: padding ? "" : name.split(".").at(-1) ?? "",
      lengthBytes: length.toString(),
      torrentOffsetBytes: offset.toString(),
      firstPiece: Math.floor(Number(offset / 262_144n)),
      lastPiece: Math.floor(Number((offset + length - 1n) / 262_144n)),
      selection: padding
        ? null
        : index % 29 === 0
          ? "skipped"
          : index % 17 === 0
            ? "high"
            : "normal",
      padding,
      doneBytes: done.toString(),
      verifiedBytes: verified.toString(),
      mediaAvailability: "incomplete",
      storagePath: `/Users/demo/Downloads/${torrentId}/${path.join("/")}`,
    });
    offset += length;
  }
  return {
    state: "available",
    filesystemContentBase: `/Users/demo/Downloads/${torrentId}`,
    page: {
      offset: 0,
      limit: 1024,
      total: rows.length,
      nextOffset: null,
    },
    order: rows.map((row) => row.id),
    rows: Object.fromEntries(rows.map((row) => [row.id, row])),
  };
}

function demoMediaSet(torrentId: string, files: FileSet): MediaSet {
  const rows = files.order
    .map((id) => files.rows[id])
    .filter((row): row is FileRow =>
      row !== undefined &&
      !row.padding &&
      ["mp4", "mkv", "avi", "webm", "mov", "m4v"].includes(row.extension),
    )
    .map(
      (file): MediaRow => ({
        id: file.id,
        torrentId,
        fileIndex: file.index,
        path: file.path,
        name: file.name,
        folder: file.folder,
        extension: file.extension,
        lengthBytes: file.lengthBytes,
        selection: file.selection ?? "normal",
        doneBytes: file.doneBytes,
        verifiedBytes: file.verifiedBytes,
        mediaAvailability: file.mediaAvailability,
        role: { type: "unclassified_video" },
      }),
    );
  return {
    state: files.state,
    totalNonPaddingFiles: files.order.filter(
      (id) => files.rows[id]?.padding === false,
    ).length,
    order: rows.map((row) => row.id),
    rows: Object.fromEntries(rows.map((row) => [row.id, row])),
  };
}

function stalledMetadata(elapsedMs: number): ScenarioContent {
  const seconds = elapsedMs / 1000;
  const peers = buildPeers(BUNNY_ID, 18, seconds, 0).map((peer, index) => ({
    ...peer,
    state: index < 6 ? ("connected" as const) : peer.state,
    downloadRate: 0,
    requestsPending: 0,
    useful: false,
    flags: index < 6 ? (["download_choked"] as const) : [],
  }));
  return {
    torrents: [
      torrent({
        id: BUNNY_ID,
        name: "Big Buck Bunny (magnet metadata)",
        status: "metadata",
        sizeBytes: null,
        progress: null,
        peersConnected: peers.length,
        peersKnown: 127,
        progressReason: localizedMessage("inspection.demo.catalog.candidates.available.no.metadata.request.is.active"),
        preparation: {
          generation: "1",
          metadata: {
            phase: "downloading",
            totalSizeBytes: 8_388_608,
            receivedBytes: 2_097_152,
            blockCount: 512,
            blockStates: Uint8Array.from(
              { length: 128 },
              (_, index) => (index < 32 ? 0xaa : 0),
            ),
            activePeers: 6,
            requestsInFlight: 0,
            hashRetries: 0,
          },
          integrity: null,
        },
      }),
    ],
    peers: { [BUNNY_ID]: peers },
    logs: timelineLogs(BUNNY_ID, [
      [0, "info", "lifecycle", "Torrent added from magnet"],
      [2, "info", "dht", "DHT lookup returned 127 candidates"],
      [5, "debug", "peer", "Six extension handshakes completed"],
      [12, "warning", "metadata", "No metadata request has been active for 7 seconds"],
      [30, "warning", "scheduler", "Metadata peers remain connected but unproductive"],
      [60, "warning", "metadata", "Stall persists; candidate replacement is available"],
    ], elapsedMs),
  };
}

function trackerRecovery(elapsedMs: number): ScenarioContent {
  const seconds = elapsedMs / 1000;
  const recovered = seconds >= 22;
  const metadata = seconds < 29;
  const progress = !recovered || metadata ? null : clamp((seconds - 29) / 42, 0, 1);
  const peers = recovered ? buildPeers(BUNNY_ID, 14, seconds, progress ?? 0) : [];
  if (seconds >= 45 && peers[0] !== undefined) {
    peers[0] = {
      ...peers[0],
      connectionId: `${BUNNY_ID.slice(0, 8)}-reconnect-00001`,
      state: "connected",
      useful: true,
    };
  }
  const rate = progress === null || progress === 1 ? 0 : 8_800_000 + wave(seconds, 1_200_000);
  const nowMs = performance.now();
  const primaryStatus: TrackerRow["status"] =
    seconds < 3
      ? "announcing"
      : seconds < 22
        ? "retry_wait"
        : "reannounce_wait";
  const primary: TrackerRow = {
    id: "udp://tracker.openbittorrent.com:80",
    torrentId: BUNNY_ID,
    url: "udp://tracker.openbittorrent.com:80",
    transport: "udp",
    security: "unencrypted",
    source: "magnet",
    tier: 0,
    status: primaryStatus,
    announceEvent: seconds < 3 ? "started" : null,
    totalAttempts: seconds < 22 ? 1 : 2,
    consecutiveFailures: seconds >= 3 && seconds < 22 ? 1 : 0,
    lastConnectionFamily: seconds < 22 ? null : "ipv4",
    lastPeerCount: seconds < 22 ? null : 42,
    seeders: seconds < 22 ? null : 31,
    leechers: seconds < 22 ? null : 11,
    intervalSeconds: seconds < 22 ? null : 600,
    nextAction:
      seconds < 3 ? null : seconds < 22 ? "retry" : "reannounce",
    nextActionAtMs:
      seconds < 3
        ? null
        : seconds < 22
          ? nowMs + Math.max(0, (22 - seconds) * 1_000)
          : nowMs + Math.max(0, (622 - seconds) * 1_000),
    lastSuccessAtMs: seconds < 22 ? null : nowMs - (seconds - 22) * 1_000,
    lastFailureAtMs: seconds < 3 ? null : nowMs - (seconds - 3) * 1_000,
    error: seconds >= 3 && seconds < 22 ? "UDP announce timed out" : null,
  };
  const fallback: TrackerRow = {
    id: "udp://tracker.opentrackr.org:1337",
    torrentId: BUNNY_ID,
    url: "udp://tracker.opentrackr.org:1337",
    transport: "udp",
    security: "unencrypted",
    source: "magnet",
    tier: 0,
    status: seconds < 22 ? "idle" : "reannounce_wait",
    announceEvent: null,
    totalAttempts: seconds < 22 ? 0 : 1,
    consecutiveFailures: 0,
    lastConnectionFamily: seconds < 22 ? null : "ipv4",
    lastPeerCount: seconds < 22 ? null : 18,
    seeders: seconds < 22 ? null : 14,
    leechers: seconds < 22 ? null : 4,
    intervalSeconds: seconds < 22 ? null : 900,
    nextAction: seconds < 22 ? "announce" : "reannounce",
    nextActionAtMs:
      nowMs + (seconds < 22 ? 0 : Math.max(0, (922 - seconds) * 1_000)),
    lastSuccessAtMs: seconds < 22 ? null : nowMs - (seconds - 22) * 1_000,
    lastFailureAtMs: null,
    error: null,
  };
  return {
    torrents: [
      torrent({
        id: BUNNY_ID,
        name: "Big Buck Bunny via tracker retry",
        status: progress === 1 ? "complete" : metadata ? "metadata" : "downloading",
        sizeBytes: metadata ? null : 276_445_467,
        progress,
        downloadRate: rate,
        peersConnected: peers.length,
        peersKnown: recovered ? 42 : 0,
        configuredTrackerCount: 2,
        eta:
          progress === null || progress === 1
            ? { state: "unavailable" }
            : estimateEta(Math.max(1, Math.ceil(100 - seconds))),
        progressReason: recovered ? (metadata ? "Tracker recovered; negotiating metadata" : "Downloading from recovered tracker cohort") : "UDP tracker retry scheduled in 22 seconds",
      }),
    ],
    peers: { [BUNNY_ID]: peers },
    trackers: {
      [BUNNY_ID]: {
        state: "available",
        page: { offset: 0, limit: 1024, total: 2, nextOffset: null },
        order: [primary.id, fallback.id],
        rows: { [primary.id]: primary, [fallback.id]: fallback },
      },
    },
    logs: timelineLogs(BUNNY_ID, [
      [0, "info", "tracker", "UDP announce started"],
      [3, "warning", "tracker", "UDP announce timed out"],
      [3, "info", "tracker", "Retry scheduled with bounded backoff"],
      [22, "info", "tracker", "Retry succeeded with 42 candidates"],
      [24, "debug", "peer", "Fourteen connection attempts admitted"],
      [29, "info", "metadata", "Metadata verified after tracker recovery"],
    ], elapsedMs),
  };
}

function endgame(elapsedMs: number): ScenarioContent {
  const seconds = elapsedMs / 1000;
  const progress = clamp(0.987 + seconds / 2200, 0, 1);
  const complete = progress === 1;
  const peers = buildPeers(BUNNY_ID, 24, seconds, progress).map((peer, index) => ({
    ...peer,
    requestsPending: complete ? 0 : index < 10 ? 2 + (index % 3) : peer.requestsPending,
    oldestRequestMs: complete ? null : 280 + index * 19,
  }));
  return {
    torrents: [
      torrent({
        id: BUNNY_ID,
        name: "Big Buck Bunny — endgame inspection",
        status: complete ? "complete" : "downloading",
        sizeBytes: 276_445_467,
        progress,
        downloadRate: complete ? 0 : 3_600_000 + wave(seconds, 900_000),
        peersConnected: 24,
        peersKnown: 186,
        eta: complete
          ? { state: "unavailable" }
          : estimateEta(Math.max(1, Math.ceil(31 - seconds))),
        progressReason: complete ? "All duplicate attempts canceled and pieces verified" : "Strict endgame: 18 blocks have bounded duplicate owners",
      }),
    ],
    peers: { [BUNNY_ID]: peers },
    logs: timelineLogs(BUNNY_ID, [
      [0, "info", "scheduler", "Entering strict endgame with 61 blocks remaining"],
      [3, "debug", "peer", "Duplicate request admitted for block 1048:12"],
      [7, "debug", "protocol", "Cancel sent to losing request owner"],
      [14, "debug", "piece", "Late duplicate payload ignored safely"],
      [29, "info", "integrity", "All 1,055 pieces verified"],
      [30, "info", "storage", "Direct content complete; request owners drained"],
    ], elapsedMs),
  };
}

function pieceRetry(elapsedMs: number): ScenarioContent {
  const seconds = elapsedMs / 1_000;
  const retrying = seconds >= 12;
  const recovered = seconds >= 24;
  const progress = recovered ? 0.427 : 0.426;
  return {
    torrents: [
      torrent({
        id: BUNNY_ID,
        name: "Big Buck Bunny — hash retry inspection",
        status: "downloading",
        sizeBytes: 276_445_467,
        progress,
        downloadRate: seconds >= 9 && seconds < 12 ? 0 : 4_800_000,
        peersConnected: 18,
        peersKnown: 121,
        eta: estimateEta(retrying && !recovered ? 42 : 36),
        progressReason: recovered
          ? "Piece 450 verified on its clean retry"
          : retrying
            ? "Piece 450 is being fetched again after a hash failure"
            : "Piece 450 attempt 1 is moving through storage and hashing",
      }),
    ],
    peers: { [BUNNY_ID]: buildPeers(BUNNY_ID, 18, seconds, progress) },
    logs: timelineLogs(BUNNY_ID, [
      [0, "debug", "piece", "Piece 450 attempt 1 requested"],
      [7, "debug", "storage", "Piece 450 attempt 1 entered hashing"],
      [9, "warning", "integrity", "Piece 450 attempt 1 failed its SHA-1 check"],
      [12, "info", "scheduler", "Piece 450 attempt 2 admitted from clean state"],
      [20, "debug", "storage", "Piece 450 attempt 2 entered hashing"],
      [24, "info", "integrity", "Piece 450 attempt 2 verified"],
    ], elapsedMs),
  };
}

function largeSwarm(): ScenarioContent {
  const torrents: TorrentRow[] = [];
  for (let index = 0; index < 2_000; index += 1) {
    const progress = ((index * 37) % 1000) / 1000;
    const id = fixedId(index + 10_000);
    torrents.push(
      torrent({
        id,
        infoHash: fixedInfoHash(index + 10_000),
        name: `Scale fixture ${String(index + 1).padStart(4, "0")} — ${index % 3 === 0 ? "long multi-file archive and sample media" : "open dataset"}`,
        status: index % 19 === 0 ? "paused" : index % 23 === 0 ? "complete" : "downloading",
        sizeBytes: 250_000_000 + index * 1_048_576,
        progress: index % 23 === 0 ? 1 : progress,
        downloadRate: index % 19 === 0 ? 0 : 80_000 + ((index * 7919) % 18_000_000),
        peersConnected: index % 31,
        peersKnown: 30 + (index % 260),
        eta:
          index % 19 === 0 || index % 23 === 0
            ? { state: "unavailable" }
            : estimateEta(60 + (index * 17) % 86_400),
        progressReason: localizedMessage("inspection.demo.catalog.synthetic.scale.row"),
        addedAtMs: BASE_TIME_MS - index * 60_000,
      }),
    );
  }
  const selectedId = torrents[0]?.id ?? fixedId(10_000);
  if (torrents[0] !== undefined) {
    torrents[0] = {
      ...torrents[0],
      status: "downloading",
      progress: 0.54,
      peersConnected: 10_000,
    };
  }
  return {
    torrents,
    peers: { [selectedId]: buildPeers(selectedId, 10_000, 17, 0.54) },
    swarm: { [selectedId]: buildSwarmSet(selectedId, 1_000, 17) },
    logs: timelineLogs(selectedId, [
      [0, "info", "performance", "Loaded 2,000 torrents and 10,000 peers"],
    ], 60_000),
  };
}

function swarmLifecycle(elapsedMs: number): ScenarioContent {
  const seconds = elapsedMs / 1_000;
  return {
    torrents: [
      torrent({
        id: BUNNY_ID,
        name: "Big Buck Bunny — swarm registry inspection",
        status: "downloading",
        sizeBytes: 276_445_467,
        progress: 0.31,
        downloadRate: seconds < 12 ? 0 : 5_400_000,
        peersConnected: seconds < 12 ? 0 : 2,
        peersKnown: 8,
        eta:
          seconds < 10
            ? { state: "warming_up" }
            : seconds < 12
              ? { state: "stalled" }
              : estimateEta(92),
        progressReason: localizedMessage("inspection.demo.catalog.inspecting.peer.discovery.and.dial.eligibility"),
      }),
    ],
    peers: {
      [BUNNY_ID]: seconds < 12 ? [] : buildPeers(BUNNY_ID, 2, seconds, 0.31),
    },
    swarm: { [BUNNY_ID]: buildSwarmSet(BUNNY_ID, 8, seconds) },
    logs: timelineLogs(BUNNY_ID, [
      [0, "info", "discovery", "Tracker and DHT candidates entered the registry"],
      [8, "info", "peer", "Eligible candidates entered bounded dial attempts"],
      [12, "info", "peer", "Two peer handshakes completed"],
      [22, "warning", "peer", "A failed candidate entered reconnect backoff"],
      [34, "info", "peer", "Backoff expired and the candidate became eligible"],
    ], elapsedMs),
  };
}

function buildSwarmSet(torrentId: string, count: number, seconds: number): SwarmSet {
  const states: readonly SwarmRow["state"][] = [
    "eligible",
    "not_connectable",
    "dialing",
    "connected",
    "backed_off",
    "failure_limited",
    "banned",
  ];
  const rows = Array.from({ length: count }, (_, index): SwarmRow => {
    let state = states[index % states.length] ?? "eligible";
    if (count <= 8) {
      if (index === 2) state = seconds < 8 ? "eligible" : seconds < 12 ? "dialing" : "connected";
      if (index === 4) state = seconds < 22 ? "eligible" : seconds < 34 ? "backed_off" : "eligible";
    }
    const failed = state === "backed_off" || state === "failure_limited";
    return {
      recordId: String(index + 1),
      torrentId,
      endpoint: `10.${Math.floor(index / 65_536) % 250}.${Math.floor(index / 256) % 256}.${(index % 254) + 1}:${4_000 + (index % 2_000)}`,
      sources:
        index % 5 === 0
          ? ["tracker", "dht"]
          : [(["tracker", "dht", "peer_exchange", "magnet_hint"] as const)[index % 4] ?? "tracker"],
      state,
      connectable: state !== "not_connectable",
      firstObservedAgeMs: 18_000 + index * 17,
      lastObservedAgeMs: index * 13,
      retryInMs: state === "backed_off" ? Math.max(0, Math.round((34 - seconds) * 1_000)) : null,
      dialAttempts: index % 4,
      consecutiveFailures: failed ? (index % 3) + 1 : 0,
      totalFailures: failed ? (index % 7) + 1 : index % 2,
      lastDialAgeMs: index % 3 === 0 ? index * 101 : null,
      lastConnectedAgeMs: state === "connected" ? index * 91 : null,
      lastFailure: failed ? (index % 2 === 0 ? "connect" : "handshake") : null,
      lastFailureAgeMs: failed ? index * 83 : null,
      payloadDownloadedBytes: String(
        state === "backed_off"
          ? 512_000_000
          : state === "connected"
            ? 320_000_000
            : index * 1_250_000,
      ),
      payloadUploadedBytes: String(
        state === "backed_off"
          ? 32_000_000
          : state === "connected"
            ? 18_000_000
            : index * 125_000,
      ),
      trustPoints: state === "banned" ? -7 : index % 5,
      hashFailures: state === "banned" ? 3 : 0,
      validPieces: index % 43,
      onParole: index % 17 === 0,
    };
  });
  const counts = {
    total: rows.length,
    eligible: rows.filter((row) => row.state === "eligible").length,
    not_connectable: rows.filter((row) => row.state === "not_connectable").length,
    dialing: rows.filter((row) => row.state === "dialing").length,
    connected: rows.filter((row) => row.state === "connected").length,
    backed_off: rows.filter((row) => row.state === "backed_off").length,
    failure_limited: rows.filter((row) => row.state === "failure_limited").length,
    banned: rows.filter((row) => row.state === "banned").length,
  };
  return {
    state: "active",
    capturedMillis: Math.round(seconds * 1_000),
    maximumRecords: 1_000,
    counts,
    order: rows.map((row) => row.recordId),
    rows: Object.fromEntries(rows.map((row) => [row.recordId, row])),
  };
}

function buildPieceMaps(
  scenarioId: DemoScenarioId,
  elapsedMs: number,
  torrents: readonly TorrentRow[],
): Readonly<Record<string, PieceMapSet>> {
  const torrent = torrents[0];
  if (torrent === undefined || torrent.progress === null) return {};

  const pieceCount = scenarioId === "large-swarm" ? 250_000 : 1_055;
  const verified = new Uint8Array(pieceCount);
  let verifiedCount = Math.min(
    pieceCount,
    Math.max(0, Math.floor(torrent.progress * pieceCount)),
  );
  if (scenarioId === "piece-retry") verifiedCount = 450;
  verified.fill(1, 0, verifiedCount);

  const active = [];
  if (scenarioId === "piece-retry") {
    const seconds = elapsedMs / 1_000;
    if (seconds < 9) {
      active.push(pieceSummary(450, 1, seconds < 4 ? "received" : "hashing", seconds));
    } else if (seconds < 12) {
      active.push(pieceSummary(450, 1, "failed", seconds, "SHA-1 mismatch"));
    } else if (seconds < 24) {
      active.push(
        pieceSummary(
          450,
          2,
          seconds < 16 ? "requested" : seconds < 20 ? "received" : "hashing",
          seconds - 12,
        ),
      );
    } else {
      verified[450] = 1;
    }
  } else if (verifiedCount < pieceCount && scenarioId !== "stalled-metadata") {
    const activeCount = scenarioId === "large-swarm" ? 6 : scenarioId === "endgame" ? 8 : 4;
    const stages = ["requested", "received", "stored", "hashing"] as const;
    for (let index = 0; index < activeCount; index += 1) {
      const pieceIndex = Math.min(pieceCount - 1, verifiedCount + index * 3);
      active.push(
        pieceSummary(
          pieceIndex,
          1,
          stages[index % stages.length] ?? "requested",
          elapsedMs / 1_000 + index,
        ),
      );
    }
  }

  return {
    [torrent.id]: {
      torrentId: torrent.id,
      pieceCount,
      verified,
      active,
      revision: Math.floor(elapsedMs / 250),
    },
  };
}

function pieceSummary(
  pieceIndex: number,
  attempt: number,
  stage: "requested" | "received" | "stored" | "hashing" | "failed",
  ageSeconds: number,
  error: string | null = null,
) {
  const pieceLength = 256 * 1_024;
  const receivedBytes =
    stage === "requested" ? 48 * 1_024 : stage === "received" ? 192 * 1_024 : pieceLength;
  return {
    id: `${pieceIndex}:${attempt}`,
    pieceIndex,
    attempt,
    pieceLength,
    stage,
    requestedBytes: pieceLength,
    receivedBytes,
    storedBytes: stage === "stored" || stage === "hashing" || stage === "failed" ? pieceLength : 0,
    ageMillis: Math.max(0, Math.floor(ageSeconds * 1_000)),
    error,
  } as const;
}

function diskError(elapsedMs: number): ScenarioContent {
  const failed = elapsedMs >= 7_000;
  return {
    torrents: [
      torrent({
        id: BUNNY_ID,
        name: "Big Buck Bunny — storage failure",
        status: failed ? "error" : "downloading",
        sizeBytes: 276_445_467,
        progress: 0.341,
        downloadRate: failed ? 0 : 6_200_000,
        peersConnected: failed ? 0 : 12,
        peersKnown: 88,
        eta: failed ? { state: "unavailable" } : estimateEta(29),
        error: failed ? "Write failed: destination has no free space" : null,
        progressReason: failed ? "Storage requires user action before transfer can resume" : "Downloading normally before the injected failure",
      }),
    ],
    peers: { [BUNNY_ID]: failed ? [] : buildPeers(BUNNY_ID, 12, elapsedMs / 1000, 0.341) },
    disk: demoDiskSet({
      elapsedMs,
      pressure: failed ? "error" : "normal",
      residentBytes: failed ? 0 : 8 * 1024 * 1024,
      queuedWriteBytes: failed ? 0 : 6 * 1024 * 1024,
      writingBytes: failed ? 0 : 256 * 1024,
      pieceCount: failed ? 1 : 18,
      error: failed ? "Write failed: destination has no free space" : null,
    }),
    logs: timelineLogs(BUNNY_ID, [
      [0, "info", "storage", "Opened content files"],
      [5, "warning", "storage", "Write latency exceeded 2 seconds"],
      [7, "error", "storage", "Write failed: no free space on destination"],
      [7, "info", "lifecycle", "Content peers stopped; torrent intent retained"],
    ], elapsedMs),
  };
}

function slowDiskPressure(elapsedMs: number): ScenarioContent {
  const seconds = elapsedMs / 1_000;
  const pressure =
    seconds < 10
      ? "normal"
      : seconds < 36
        ? "backpressured"
        : seconds < 52
          ? "draining"
          : "normal";
  const residentBytes =
    pressure === "backpressured"
      ? 29 * 1024 * 1024
      : pressure === "draining"
        ? Math.max(4 * 1024 * 1024, (29 - (seconds - 36) * 1.4) * 1024 * 1024)
        : seconds >= 52
          ? 3 * 1024 * 1024
          : (4 + seconds * 2.1) * 1024 * 1024;
  const pieceCount = pressure === "backpressured" ? 64 : pressure === "draining" ? 30 : 12;
  const progress = clamp(0.21 + elapsedMs / 180_000, 0, 0.61);
  return {
    torrents: [
      torrent({
        id: BUNNY_ID,
        name: "Big Buck Bunny — slow storage",
        status: "downloading",
        sizeBytes: 276_445_467,
        progress,
        downloadRate: pressure === "backpressured" ? 0 : 12_400_000,
        peersConnected: 22,
        peersKnown: 109,
        progressReason:
          pressure === "backpressured"
            ? "Disk high watermark paused new payload assignment"
            : pressure === "draining"
              ? "Disk queue draining below the low watermark"
              : "Storage intake and peer requests are flowing",
      }),
    ],
    peers: { [BUNNY_ID]: buildPeers(BUNNY_ID, 22, seconds, progress) },
    disk: demoDiskSet({
      elapsedMs,
      pressure,
      residentBytes,
      queuedWriteBytes:
        pressure === "backpressured" ? 23 * 1024 * 1024 : residentBytes * 0.65,
      writingBytes: 256 * 1024,
      pieceCount,
      error: null,
    }),
    logs: timelineLogs(BUNNY_ID, [
      [0, "info", "storage", "Storage pipeline opened with a 32 MiB resident limit"],
      [10, "warning", "storage", "Resident payload crossed the high watermark; intake paused"],
      [36, "info", "storage", "Resident payload fell below the low watermark; intake resumed"],
      [52, "info", "storage", "Storage pipeline returned to normal pressure"],
    ], elapsedMs),
  };
}

function demoDiskSet(input: {
  readonly elapsedMs: number;
  readonly pressure: DiskSet["pipeline"]["pressure"];
  readonly residentBytes: number;
  readonly queuedWriteBytes: number;
  readonly writingBytes: number;
  readonly pieceCount: number;
  readonly error: string | null;
}): DiskSet {
  const pieces: DiskPieceRow[] = Array.from({ length: input.pieceCount }, (_, index) => {
    const stage: DiskPieceRow["stage"] =
      input.error !== null
        ? "failed"
        : index % 9 === 0
          ? "hashing"
          : index % 3 === 0
            ? "writing"
            : index % 3 === 1
              ? "queued"
              : "receiving";
    const length = 256 * 1024;
    const stored = stage === "hashing" ? length : Math.min(length, (index % 8) * 32 * 1024);
    return {
      id: `${BUNNY_ID}:${220 + index}:1`,
      torrentId: BUNNY_ID,
      torrentName: "Big Buck Bunny — slow storage",
      pieceIndex: 220 + index,
      pieceLength: length,
      attempt: 1,
      stage,
      requestedBytes: length,
      receivedBytes: Math.min(length, stored + 64 * 1024),
      storedBytes: stored,
      ageMillis: 1_200 + index * 37,
      stageAgeMillis: 90 + index * 19,
      error: input.error,
    };
  });
  const received = 58 * 1024 * 1024 + input.elapsedMs * 8_000;
  const stored = 52 * 1024 * 1024 + input.elapsedMs * 4_500;
  return {
    pipeline: {
      pressure: input.pressure,
      checkpointStage: input.pressure === "error" ? "error" : "syncing",
      intakeBackpressured: input.pressure === "backpressured",
      sampleMillis: 1_000,
      residentLimitBytes: 32 * 1024 * 1024,
      residentHighWatermarkBytes: 24 * 1024 * 1024,
      residentLowWatermarkBytes: 16 * 1024 * 1024,
      requestedBytes:
        input.pressure === "backpressured" ? 18 * 1024 * 1024 : 42 * 1024 * 1024,
      residentBytes: Math.round(input.residentBytes),
      queuedWriteBytes: Math.round(input.queuedWriteBytes),
      writingBytes: input.writingBytes,
      hashingBytes: 256 * 1024,
      checkpointDirtyPieces: 18,
      checkpointDirtyBytes: 18 * 256 * 1024,
      checkpointDirtyPieceHighWater: 64,
      checkpointDirtyByteHighWater: 64 * 256 * 1024,
      checkpointOldestDirtyMillis: 1_240,
      checkpointBatchesStarted: 7,
      checkpointBatchesCompleted: 6,
      checkpointPiecesCompleted: 146,
      checkpointSyncOperationsCompleted: 12,
      checkpointSyncServiceMicros: 820_000,
      checkpointSyncServiceMaxMicros: 190_000,
      checkpointCommitServiceMicros: 115_000,
      checkpointCommitServiceMaxMicros: 26_000,
      checkpointActiveMicros: 42_000,
      storageJobsPending: input.pieceCount * 6,
      receivedBytesTotal: received,
      storedBytesTotal: stored,
      verifiedBytesTotal: Math.max(0, stored - 2 * 1024 * 1024),
      receiveRateBytes: input.pressure === "backpressured" ? 0 : 12_400_000,
      writeRateBytes: 4_500_000,
      hashRateBytes: 4_200_000,
      writeOperationsStarted: 820 + Math.floor(input.elapsedMs / 90),
      writeOperationsCompleted: 819 + Math.floor(input.elapsedMs / 90),
      hashOperationsStarted: 220 + Math.floor(input.elapsedMs / 700),
      hashOperationsCompleted: 219 + Math.floor(input.elapsedMs / 700),
      writeQueueWaitMicros: 9_800_000,
      writeQueueWaitMaxMicros:
        input.pressure === "backpressured" ? 2_800_000 : 180_000,
      writeServiceMicros: 25_600_000,
      writeServiceMaxMicros: 1_900_000,
      hashQueueWaitMicros: 1_100_000,
      hashQueueWaitMaxMicros: 90_000,
      hashServiceMicros: 7_400_000,
      hashServiceMaxMicros: 240_000,
      pressureTransitionCount: input.pressure === "normal" ? 2 : 1,
      backpressuredMillisTotal: Math.max(
        0,
        Math.min(input.elapsedMs - 10_000, 26_000),
      ),
      lastError: input.error,
    },
    order: pieces.map((piece) => piece.id),
    rows: Object.fromEntries(pieces.map((piece) => [piece.id, piece])),
  };
}

function torrent(input: Partial<TorrentRow> & Pick<TorrentRow, "id" | "name" | "status">): TorrentRow {
  const progress = input.progress ?? null;
  const size = input.sizeBytes ?? null;
  const eta = input.eta ?? { state: "unavailable" };
  const requiredPayloadBytes =
    input.requiredPayloadBytes ?? (size === null ? null : String(size));
  const remainingPayloadBytes =
    input.remainingPayloadBytes ??
    (requiredPayloadBytes === null
      ? null
      : eta.state === "estimate"
        ? eta.seconds
        : input.status === "complete"
          ? "0"
          : requiredPayloadBytes);
  return {
    id: input.id,
    name: input.name,
    status: input.status,
    operationalState:
      input.operationalState ?? operationalStateForStatus(input.status),
    queuePosition: input.queuePosition ?? null,
    transferLimits: input.transferLimits ?? {
      upload: { type: "unlimited" },
      download: { type: "unlimited" },
    },
    sizeBytes: size,
    progress,
    checking: input.checking ?? null,
    downloadRate: input.downloadRate ?? 0,
    uploadRate: input.uploadRate ?? 0,
    downloadedBytes: input.downloadedBytes ?? (size === null || progress === null ? 0 : Math.floor(size * progress)),
    uploadedBytes: input.uploadedBytes ?? 0,
    peersConnected: input.peersConnected ?? 0,
    peersKnown: input.peersKnown ?? 0,
    configuredTrackerCount: input.configuredTrackerCount ?? 0,
    requiredPayloadBytes,
    remainingPayloadBytes,
    etaDownloadRateBytes:
      input.etaDownloadRateBytes ?? (eta.state === "estimate" ? "1" : "0"),
    eta,
    lifetimeUploadedBytes: input.lifetimeUploadedBytes ?? String(input.uploadedBytes ?? 0),
    lifetimeDownloadedBytes:
      input.lifetimeDownloadedBytes ?? String(input.downloadedBytes ?? 0),
    activeSeconds: input.activeSeconds ?? "0",
    finishedSeconds: input.finishedSeconds ?? "0",
    seedingSeconds: input.seedingSeconds ?? "0",
    shareRatioHundredths: input.shareRatioHundredths ?? null,
    seedAdmission:
      input.seedAdmission ?? (input.status === "complete" ? "active" : "ineligible"),
    seedGoal:
      input.seedGoal ??
      (input.status === "complete"
        ? {
            status: "met",
            share_ratio_met: true,
            finished_download_ratio_met: false,
            finished_time_met: false,
          }
        : null),
    addedAtMs: input.addedAtMs ?? BASE_TIME_MS - 3_600_000,
    archived: input.archived ?? false,
    removalState: input.removalState ?? null,
    deleteDataSupported: input.deleteDataSupported ?? true,
    forceRecheckAvailable: input.forceRecheckAvailable ?? false,
    infoHash:
      input.infoHash ??
      DEMO_INFO_HASHES[input.id] ??
      (() => {
        throw new Error(`demo torrent ${input.id} has no explicit info hash`);
      })(),
    error: input.error ?? null,
    progressReason: input.progressReason ?? "Waiting for activity",
    preparation: input.preparation ?? null,
  };
}

function operationalStateForStatus(
  status: TorrentRow["status"],
): TorrentRow["operationalState"] {
  switch (status) {
    case "metadata":
      return "starting";
    case "downloading":
      return "downloading";
    case "checking":
      return "checking";
    case "complete":
      return "seeding";
    case "paused":
      return "paused";
    case "error":
      return "error";
  }
}

function estimateEta(seconds: number): TorrentEta {
  return {
    state: "estimate",
    seconds: String(Math.max(1, Math.floor(seconds))),
  };
}

function buildPeers(
  torrentId: string,
  count: number,
  seconds: number,
  torrentProgress: number,
): PeerRow[] {
  const clients = ["libtorrent 2.0.13", "qBittorrent 5.1", "Transmission 4.1", "Deluge 2.2", "WebTorrent 2.8", "JSTorrent dev"];
  const sources = ["tracker", "dht", "tracker", "dht", "pex", "manual"] as const;
  const rows: PeerRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const connected = index % 11 !== 0;
    const stalled = connected && index % 17 === 0;
    const choked = connected && !stalled && index % 7 === 0;
    const useful = connected && !stalled && !choked && index % 5 !== 0;
    const mseMethod =
      connected && index % 8 === 0
        ? index % 16 === 0
          ? ("plaintext_payload" as const)
          : ("rc4" as const)
        : null;
    const rate = useful ? 110_000 + ((index * 7919 + Math.floor(seconds) * 997) % 2_300_000) : 0;
    const connectionId = `${torrentId.slice(0, 8)}-connection-${String(index + 1).padStart(5, "0")}`;
    rows.push({
      connectionId,
      torrentId,
      state: !connected ? "connecting" : stalled ? "stalled" : choked ? "choked" : "connected",
      endpoint: index % 9 === 0 ? `[2001:db8::${(index % 240) + 1}]:${51413 + (index % 7)}` : `198.51.100.${(index % 250) + 1}:${49152 + (index % 12000)}`,
      client: clients[index % clients.length] ?? "Unknown",
      source: sources[index % sources.length] ?? "tracker",
      progress: clamp(torrentProgress + ((index * 13) % 40) / 100, 0, 1),
      downloadRate: rate,
      uploadRate: connected && index % 4 === 0 ? 18_000 + (index * 187) % 130_000 : 0,
      downloadedBytes: Math.floor(rate * Math.max(1, seconds * (0.3 + (index % 8) / 10))),
      uploadedBytes: connected ? (index * 65_537) % 80_000_000 : 0,
      requestsPending: useful ? 1 + (index % 12) : 0,
      oldestRequestMs: useful ? 45 + ((index * 83) % 2_900) : null,
      connectedAgeMs: connected
        ? Math.max(0, Math.floor(seconds * 1_000) - index * 137)
        : null,
      lastPayloadAgeMs: useful ? 80 + ((index * 193) % 12_000) : null,
      flags: demoPeerFlags(index, connected, choked, useful, mseMethod !== null),
      mseMethod,
      useful,
    });
  }
  return rows;
}

function demoPeerFlags(
  index: number,
  connected: boolean,
  choked: boolean,
  useful: boolean,
  mse: boolean,
): PeerRow["flags"] {
  if (!connected) return [];
  return [
    ...(index % 9 === 0 ? (["incoming"] as const) : []),
    ...(mse ? (["encrypted"] as const) : []),
    choked ? "download_choked" : useful ? "download_allowed" : "download_choked",
    "upload_choked",
    ...(index % 3 !== 0 ? (["extension_protocol"] as const) : []),
    ...(index % 5 === 0 ? (["utp"] as const) : []),
  ];
}

type TimelineEntry = readonly [
  second: number,
  severity: LogRow["severity"],
  category: string,
  message: string,
];

function timelineLogs(
  torrentId: string,
  entries: readonly TimelineEntry[],
  elapsedMs: number,
): LogRow[] {
  return entries
    .filter(([second]) => second * 1000 <= elapsedMs)
    .map(([second, severity, category, message], index) => ({
      id: String(second * 100 + index + 1),
      timestampMs: BASE_TIME_MS + second * 1000,
      severity,
      category,
      code: `${category.replaceAll(".", "_")}_event`,
      message,
      torrentId,
      subjects: [],
      fields: [],
    }));
}

function fixedId(index: number): string {
  return `t1-${index.toString(16).padStart(32, "0").slice(-32)}`;
}

function fixedInfoHash(index: number): string {
  return index.toString(16).padStart(40, "0").slice(-40);
}

function wave(seconds: number, amplitude: number): number {
  return Math.round(Math.sin(seconds / 3.7) * amplitude);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export const DEMO_PRIMARY_TORRENT_ID = BUNNY_ID;
export const DEMO_BASE_TIME_MS = BASE_TIME_MS;
