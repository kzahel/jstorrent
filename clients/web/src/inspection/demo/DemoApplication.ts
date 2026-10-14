import { message as localizedMessage } from "../../localization/runtime";
import type { InspectionApplication } from "../application";
import type {
  ClientSettings,
  SpeedMetric,
  SpeedRange,
  TorrentTransferLimits,
} from "../../api";
import type {
  CommandResult,
  DesiredInspectionViews,
  DemoScenarioId,
  DiskSet,
  InspectionCommand,
  InspectionSnapshot,
  InspectionUpdate,
  KeyedPatch,
  FileRow,
  MediaRow,
  LogRow,
  PeerRow,
  SwarmRow,
  SwarmSet,
  PieceMapSet,
  SpeedInspectionView,
  TorrentRow,
  TrackerRow,
} from "../model";
import { emptyDiskSet, emptyPieceMapSet } from "../state";
import {
  buildScenarioSnapshot,
  DEMO_BASE_TIME_MS,
  DEMO_SCENARIOS,
  demoScenario,
} from "./catalog";

export interface DemoApplicationOptions {
  readonly scenarioId: DemoScenarioId;
  readonly elapsedMs?: number;
  readonly running?: boolean;
  readonly tickMs?: number;
}

export class DemoApplication implements InspectionApplication {
  readonly kind = "demo" as const;
  readonly scenarios = DEMO_SCENARIOS;

  private scenarioId: DemoScenarioId;
  private elapsedMs: number;
  private running: boolean;
  private readonly tickMs: number;
  private revision = 1;
  private readonly listeners = new Set<(update: InspectionUpdate) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private paused = new Set<string>();
  private archived = new Set<string>();
  private removed = new Set<string>();
  private transferLimits = new Map<string, TorrentTransferLimits>();
  private clientSettings: ClientSettings | null = null;
  private extraTorrentCount = 0;
  private commandLogs: LogRow[] = [];
  private snapshot: InspectionSnapshot;
  private desiredViews: DesiredInspectionViews = {
    library: true,
    torrentId: null,
    detail: null,
    logCapture: null,
  };

  constructor(options: DemoApplicationOptions) {
    this.scenarioId = options.scenarioId;
    const scenario = demoScenario(this.scenarioId);
    this.elapsedMs = clamp(options.elapsedMs ?? 0, 0, scenario.durationMs);
    this.running = options.running ?? scenario.autoplay;
    this.tickMs = clamp(options.tickMs ?? 1_000, 250, 60_000);
    this.snapshot = this.buildSnapshot();
  }

  subscribe(listener: (update: InspectionUpdate) => void): () => void {
    this.ensureOpen();
    this.listeners.add(listener);
    listener({ type: "snapshot", snapshot: this.snapshot });
    this.reconcileTimer();
    return () => {
      this.listeners.delete(listener);
      this.reconcileTimer();
    };
  }

  async setViews(views: DesiredInspectionViews): Promise<void> {
    this.ensureOpen();
    if (sameDesiredViews(this.desiredViews, views)) return;
    this.desiredViews = { ...views };
    this.replaceSnapshot();
  }

  async dispatch(command: InspectionCommand): Promise<CommandResult> {
    this.ensureOpen();
    switch (command.type) {
      case "open_file":
        return rejected("Opening files is unavailable in demo scenarios");
      case "set_demo_scenario":
        this.scenarioId = command.scenarioId;
        this.elapsedMs = 0;
        this.running = demoScenario(command.scenarioId).autoplay;
        this.resetOverlays();
        this.replaceSnapshot();
        return accepted(`Loaded ${demoScenario(command.scenarioId).title}`);
      case "set_demo_running":
        this.running = command.running;
        this.advance(0);
        this.reconcileTimer();
        return accepted(command.running ? "Demo clock running" : "Demo clock paused");
      case "advance_demo_clock":
        if (!Number.isFinite(command.milliseconds) || command.milliseconds < 0 || command.milliseconds > 600_000) {
          return rejected("Demo clock advances are limited to 10 minutes");
        }
        this.advance(command.milliseconds);
        return accepted(`Advanced ${Math.round(command.milliseconds / 1000)} seconds`);
      case "reset_demo":
        this.elapsedMs = 0;
        this.running = false;
        this.resetOverlays();
        this.replaceSnapshot();
        this.reconcileTimer();
        return accepted("Demo scenario reset");
      case "pause":
        if (this.snapshot.torrents[command.torrentId] === undefined) return rejected("Torrent is not present");
        this.paused.add(command.torrentId);
        this.addCommandLog("lifecycle", "Torrent paused in demo mode", command.torrentId);
        this.advance(0);
        return accepted("Torrent paused");
      case "resume":
        if (this.snapshot.torrents[command.torrentId] === undefined) return rejected("Torrent is not present");
        if (this.archived.has(command.torrentId)) {
          return rejected("Archived torrent must be restored before starting");
        }
        this.paused.delete(command.torrentId);
        this.addCommandLog("lifecycle", "Torrent resumed in demo mode", command.torrentId);
        this.advance(0);
        return accepted("Torrent resumed");
      case "move_download_to_top":
      case "move_download_to_bottom":
        return rejected("Queue movement is unavailable in demo scenarios");
      case "archive":
        this.archived.add(command.torrentId);
        this.paused.add(command.torrentId);
        this.addCommandLog("lifecycle", "Torrent archived in demo mode", command.torrentId);
        this.advance(0);
        return accepted("Torrent archived");
      case "unarchive":
        this.archived.delete(command.torrentId);
        this.addCommandLog("lifecycle", "Torrent restored from archive", command.torrentId);
        this.advance(0);
        return accepted("Torrent restored");
      case "remove":
        if (this.snapshot.torrents[command.torrentId] === undefined) {
          return rejected("Torrent is not present");
        }
        this.removed.add(command.torrentId);
        this.addCommandLog(
          "lifecycle",
          command.deleteData
            ? "Torrent and downloaded data removed in demo mode"
            : "Torrent removed while retaining data in demo mode",
          command.torrentId,
        );
        this.advance(0);
        return accepted(command.deleteData ? "Torrent and data removed" : "Torrent removed");
      case "add_demo_torrent":
        this.extraTorrentCount = Math.min(8, this.extraTorrentCount + 1);
        this.addCommandLog("lifecycle", "Generated demo transfer added", null);
        this.advance(0);
        return accepted("Generated demo transfer added");
      case "add_magnet":
        return rejected("Live magnet add is unavailable in demo scenarios");
      case "add_torrent_bytes":
        return rejected("Torrent file upload is unavailable in demo scenarios");
      case "add_external_torrent":
        return rejected("External torrent intake is unavailable in demo scenarios");
      case "export_magnet": {
        const torrent = this.snapshot.torrents[command.torrentId];
        if (torrent === undefined) return rejected("Torrent is not present");
        return {
          accepted: true,
          message: localizedMessage("inspection.demo.demo.application.magnet.link.ready"),
          magnetExport: {
            magnet:
              `magnet:?xt=urn:btih:${torrent.infoHash}` +
              `&dn=${encodeMagnetValue(torrent.name)}`,
            source: "synthesized",
            omittedTrackerCount: 0,
          },
        };
      }
      case "set_file_priority":
      case "download_files":
        return rejected("File actions are unavailable in demo scenarios");
      case "force_recheck":
        return rejected("Force recheck is unavailable in demo scenarios");
      case "update_torrent_settings":
        {
          const torrent = this.snapshot.torrents[command.torrentId];
          if (torrent === undefined) {
            return rejected("Torrent is not present");
          }
          const current =
            this.transferLimits.get(command.torrentId) ?? torrent.transferLimits;
          this.transferLimits.set(command.torrentId, {
            upload: command.patch.upload_rate_limit ?? current.upload,
            download: command.patch.download_rate_limit ?? current.download,
          });
        }
        this.addCommandLog(
          "policy",
          "Torrent peer transfer limits changed in demo mode",
          command.torrentId,
        );
        this.advance(0);
        return {
          ...accepted("Torrent transfer limits saved"),
          requestId: `demo-${this.revision}`,
          resultingRevision: String(this.revision),
        };
      case "choose_download_root":
      case "set_default_download_root":
      case "set_show_add_options":
      case "set_show_file_selection":
      case "confirm_pending_file_selection":
      case "download_all_pending_add":
      case "cancel_pending_add":
      case "remove_download_root":
      case "clear_app_data":
        return rejected("Download folder management is unavailable in demo scenarios");
      case "update_client_settings":
        this.clientSettings = {
          ...(this.clientSettings ?? this.snapshot.clientSettings.configured),
          ...command.patch,
        };
        this.addCommandLog(
          "policy",
          "Client settings changed in demo mode",
          null,
        );
        this.advance(0);
        return {
          ...accepted("Connection and seeding settings saved"),
          requestId: `demo-${this.revision}`,
          resultingRevision: String(this.revision),
        };
      case "reset_client_settings":
        return rejected("Settings reset is unavailable in demo scenarios");
    }
  }

  reconnectNow(): void {}

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopTimer();
    this.listeners.clear();
  }

  private advance(milliseconds: number): void {
    const scenario = demoScenario(this.scenarioId);
    const previous = this.snapshot;
    this.elapsedMs = clamp(this.elapsedMs + milliseconds, 0, scenario.durationMs);
    if (this.elapsedMs >= scenario.durationMs) this.running = false;
    this.revision += 1;
    const next = this.buildSnapshot();
    const update = diffSnapshots(previous, next);
    this.snapshot = next;
    if (update !== null) this.emit(update);
    this.reconcileTimer();
  }

  private replaceSnapshot(): void {
    this.revision += 1;
    this.snapshot = this.buildSnapshot();
    this.emit({ type: "snapshot", snapshot: this.snapshot });
  }

  private buildSnapshot(): InspectionSnapshot {
    return materializeDemoViews(
      applyOverlays(
        buildScenarioSnapshot(
          this.scenarioId,
          this.elapsedMs,
          this.running,
          this.revision,
        ),
        this.paused,
        this.archived,
        this.removed,
        this.extraTorrentCount,
        this.commandLogs,
        this.transferLimits,
        this.clientSettings,
      ),
      this.desiredViews,
    );
  }

  private addCommandLog(
    category: string,
    message: string,
    torrentId: string | null,
  ): void {
    this.commandLogs.push({
      id: `demo-command-${this.revision}-${this.commandLogs.length}`,
      timestampMs: DEMO_BASE_TIME_MS + this.elapsedMs,
      severity: "info",
      category,
      code: "user_command",
      message,
      torrentId,
      subjects: [],
      fields: [],
    });
  }

  private resetOverlays(): void {
    this.paused = new Set();
    this.archived = new Set();
    this.removed = new Set();
    this.transferLimits = new Map();
    this.clientSettings = null;
    this.extraTorrentCount = 0;
    this.commandLogs = [];
  }

  private reconcileTimer(): void {
    const shouldRun = !this.closed && this.running && this.listeners.size > 0;
    if (shouldRun && this.timer === null) {
      this.timer = setInterval(() => this.advance(this.tickMs), this.tickMs);
    } else if (!shouldRun) {
      this.stopTimer();
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private emit(update: InspectionUpdate): void {
    for (const listener of this.listeners) listener(update);
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("demo application is closed");
  }
}

function sameDesiredViews(
  left: DesiredInspectionViews,
  right: DesiredInspectionViews,
): boolean {
  return (
    left.library === right.library &&
    left.torrentId === right.torrentId &&
    left.detail === right.detail &&
    left.logCapture?.profile === right.logCapture?.profile &&
    left.logCapture?.torrentId === right.logCapture?.torrentId &&
    left.speed?.range === right.speed?.range &&
    sameStrings(left.speed?.metrics, right.speed?.metrics)
  );
}

function materializeDemoViews(
  source: InspectionSnapshot,
  desired: DesiredInspectionViews,
): InspectionSnapshot {
  const selected =
    desired.torrentId === null ? undefined : source.torrents[desired.torrentId];
  const torrents = desired.library
    ? source.torrents
    : selected === undefined
      ? {}
      : { [selected.id]: selected };
  const peersByTorrent =
    desired.detail === "peers" && desired.torrentId !== null
      ? {
          [desired.torrentId]: source.peersByTorrent[desired.torrentId] ?? {
            order: [],
            rows: {},
          },
        }
      : {};
  const swarmByTorrent =
    desired.detail === "swarm" && desired.torrentId !== null
      ? {
          [desired.torrentId]: source.swarmByTorrent[desired.torrentId] ?? {
            state: "inactive" as const,
            capturedMillis: source.demo?.elapsedMs ?? 0,
            maximumRecords: 1_000,
            counts: {
              total: 0,
              eligible: 0,
              not_connectable: 0,
              dialing: 0,
              connected: 0,
              backed_off: 0,
              failure_limited: 0,
              banned: 0,
            },
            order: [],
            rows: {},
          },
        }
      : {};
  const filesByTorrent =
    desired.detail === "files" && desired.torrentId !== null
      ? {
          [desired.torrentId]: source.filesByTorrent[desired.torrentId] ?? {
            state: "metadata_pending" as const,
            filesystemContentBase: null,
            page: { offset: 0, limit: 1024, total: 0, nextOffset: null },
            order: [],
            rows: {},
          },
        }
      : {};
  const mediaByTorrent =
    desired.detail === "media" && desired.torrentId !== null
      ? {
          [desired.torrentId]: source.mediaByTorrent[desired.torrentId] ?? {
            state: "metadata_pending" as const,
            totalNonPaddingFiles: 0,
            order: [],
            rows: {},
          },
        }
      : {};
  const trackersByTorrent =
    desired.detail === "trackers" && desired.torrentId !== null
      ? {
          [desired.torrentId]: source.trackersByTorrent[desired.torrentId] ?? {
            state: "available" as const,
            page: { offset: 0, limit: 1024, total: 0, nextOffset: null },
            order: [],
            rows: {},
          },
        }
      : {};
  const piecesByTorrent =
    desired.detail === "pieces" && desired.torrentId !== null
      ? {
          [desired.torrentId]:
            source.piecesByTorrent[desired.torrentId] ??
            emptyPieceMapSet(desired.torrentId),
        }
      : {};
  return {
    ...source,
    torrentOrder: desired.library ? source.torrentOrder : [],
    torrents,
    peersByTorrent,
    swarmByTorrent,
    filesByTorrent,
    mediaByTorrent,
    trackersByTorrent,
    piecesByTorrent,
    disk: desired.detail === "disk" ? source.disk : emptyDiskSet(),
    dht: desired.detail === "dht" ? source.dht : null,
    speed:
      desired.detail === "speed"
        ? materializeDemoSpeed(source.speed, desired.speed)
        : null,
    logs: desired.detail === "logs" ? source.logs : [],
    logLoss:
      desired.detail === "logs"
        ? source.logLoss
        : {
            sourceEvictedCount: 0,
            retainedFromSequence: "1",
            localEvictedCount: 0,
            deliveryResetCount: 0,
            lastDeliveryResetReason: null,
          },
    viewStatus: {
      library: desired.library
        ? { status: "ready" }
        : { status: "not_requested" },
      torrentSummary:
        desired.torrentId === null
          ? { status: "not_requested" }
          : selected === undefined
            ? { status: "unavailable", reason: localizedMessage("inspection.demo.demo.application.torrent.is.no.longer.present") }
            : { status: "ready" },
      peers:
        desired.detail === "peers"
          ? { status: "ready" }
          : { status: "not_requested" },
      swarm:
        desired.detail === "swarm"
          ? { status: "ready" }
          : { status: "not_requested" },
      files:
        desired.detail === "files"
          ? { status: "ready" }
          : { status: "not_requested" },
      media:
        desired.detail === "media"
          ? { status: "ready" }
          : { status: "not_requested" },
      trackers:
        desired.detail === "trackers"
          ? { status: "ready" }
          : { status: "not_requested" },
      pieces:
        desired.detail === "pieces"
          ? { status: "ready" }
          : { status: "not_requested" },
      disk:
        desired.detail === "disk"
          ? { status: "ready" }
          : { status: "not_requested" },
      dht:
        desired.detail === "dht"
          ? source.viewStatus.dht
          : { status: "not_requested" },
      speed:
        desired.detail === "speed"
          ? source.viewStatus.speed
          : { status: "not_requested" },
      logs:
        desired.detail === "logs"
          ? { status: "ready" }
          : { status: "not_requested" },
    },
  };
}

const DEMO_SPEED_RANGES: Readonly<
  Record<SpeedRange, { bucketMillis: number; count: number; live: boolean }>
> = {
  seconds30: { bucketMillis: 100, count: 300, live: true },
  minutes2: { bucketMillis: 500, count: 240, live: true },
  minutes10: { bucketMillis: 2_000, count: 300, live: true },
  hour1: { bucketMillis: 10_000, count: 360, live: true },
  hours24: { bucketMillis: 60_000, count: 1_440, live: false },
  days30: { bucketMillis: 15 * 60_000, count: 2_880, live: false },
  years2: { bucketMillis: 24 * 60 * 60_000, count: 730, live: false },
};

function materializeDemoSpeed(
  source: SpeedInspectionView | null,
  selection: DesiredInspectionViews["speed"],
): SpeedInspectionView | null {
  if (source === null) return null;
  const range = selection?.range ?? source.range;
  const metrics = selection?.metrics ?? source.series.map((series) => series.metric);
  const selectedSource = metrics.map((metric) =>
    source.series.find((series) => series.metric === metric),
  );
  if (range === source.range && selectedSource.every((series) => series !== undefined)) {
    return {
      ...source,
      series: selectedSource.filter((series) => series !== undefined),
    };
  }
  const config = DEMO_SPEED_RANGES[range];
  const sourceComplete = numberOrZero(source.complete_through_millis);
  const completeThrough = Math.floor(sourceComplete / config.bucketMillis) * config.bucketMillis;
  const start = completeThrough - (config.count - 1) * config.bucketMillis;
  const current = new Map(
    source.current.map((entry) => [entry.metric, numberOrZero(entry.bytes ?? "0")]),
  );
  const received = current.get("payload_received") ?? 0;
  return {
    ...source,
    captured_millis: sourceComplete.toString(),
    range,
    bucket_millis: config.bucketMillis.toString(),
    start_millis: start.toString(),
    complete_through_millis: completeThrough.toString(),
    live: config.live,
    series: metrics.map((metric, metricIndex) => {
      const rate = demoMetricRate(metric, current, received);
      return {
        metric,
        current_rate_bytes: Math.round(rate).toString(),
        values: Array.from({ length: config.count }, (_, index) => {
          const absoluteBucket = Math.floor(completeThrough / config.bucketMillis) -
            config.count + index + 1;
          const phase = absoluteBucket / 18 - metricIndex * 0.24;
          const envelope = 0.68 + Math.sin(phase / 4.3) * 0.17;
          const pulse = Math.max(0, Math.sin(phase)) * 0.22;
          return Math.round(rate * (envelope + pulse) * config.bucketMillis / 1_000).toString();
        }),
      };
    }),
  };
}

function demoMetricRate(
  metric: SpeedMetric,
  current: ReadonlyMap<SpeedMetric, number>,
  received: number,
): number {
  const explicit = current.get(metric) ?? 0;
  if (explicit > 0) return explicit;
  switch (metric) {
    case "peer_wire_received": return received * 1.06;
    case "peer_wire_sent": return received * 0.018;
    case "peer_protocol_received": return received * 0.035;
    case "peer_protocol_sent": return received * 0.012;
    case "metadata_payload_received": return received * 0.004;
    case "metadata_payload_sent": return received * 0.0008;
    case "peer_unclassified_received": return received * 0.0002;
    case "peer_unclassified_sent": return received * 0.00015;
    case "dht_received": return 18_000;
    case "dht_sent": return 12_000;
    case "tracker_received": return 1_400;
    case "tracker_sent": return 900;
    case "logical_hash_read": return received * 0.87;
    case "payload_redundant": return received * 0.012;
    case "payload_hash_failed": return received * 0.001;
    case "payload_uploaded": return 0;
    case "payload_received":
    case "staged_write":
    case "payload_verified":
      return explicit;
  }
}

function numberOrZero(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function sameStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return left?.length === right?.length &&
    (left?.every((value, index) => value === right?.[index]) ?? true);
}

function applyOverlays(
  source: InspectionSnapshot,
  paused: ReadonlySet<string>,
  archived: ReadonlySet<string>,
  removed: ReadonlySet<string>,
  extraTorrentCount: number,
  commandLogs: readonly LogRow[],
  transferLimits: ReadonlyMap<string, TorrentTransferLimits>,
  clientSettings: ClientSettings | null,
): InspectionSnapshot {
  const torrents: Record<string, TorrentRow> = {};
  for (const id of source.torrentOrder) {
    if (removed.has(id)) continue;
    const row = source.torrents[id];
    if (row === undefined) continue;
    torrents[id] = {
      ...row,
      transferLimits: transferLimits.get(id) ?? row.transferLimits,
      status: paused.has(id) ? "paused" : row.status,
      operationalState: paused.has(id) ? "paused" : row.operationalState,
      archived: archived.has(id),
      downloadRate: paused.has(id) ? 0 : row.downloadRate,
      uploadRate: paused.has(id) ? 0 : row.uploadRate,
      etaDownloadRateBytes: paused.has(id) ? "0" : row.etaDownloadRateBytes,
      eta: paused.has(id) ? { state: "unavailable" } : row.eta,
      progressReason: paused.has(id) ? "Paused in demo mode" : row.progressReason,
    };
  }

  const torrentOrder = source.torrentOrder.filter((id) => !removed.has(id));
  for (let index = 0; index < extraTorrentCount; index += 1) {
    const id = `t1-${String(index + 1).padStart(32, "0")}`;
    const infoHash = `f${String(index + 1).padStart(39, "0")}`;
    torrents[id] = {
      id,
      name: `Generated demo transfer ${index + 1}`,
      status: "downloading",
      operationalState: "downloading",
      queuePosition: null,
      transferLimits: {
        upload: { type: "unlimited" },
        download: { type: "unlimited" },
      },
      sizeBytes: 734_003_200 + index * 104_857_600,
      progress: 0.08 + index * 0.03,
      checking: null,
      downloadRate: 1_200_000 + index * 240_000,
      uploadRate: 0,
      downloadedBytes: 58_720_256 + index * 3_145_728,
      uploadedBytes: 0,
      peersConnected: 4 + index,
      peersKnown: 18 + index * 3,
      configuredTrackerCount: 0,
      requiredPayloadBytes: String(734_003_200 + index * 104_857_600),
      remainingPayloadBytes: String(540 - index * 22),
      etaDownloadRateBytes: "1",
      eta: { state: "estimate", seconds: String(540 - index * 22) },
      lifetimeUploadedBytes: "0",
      lifetimeDownloadedBytes: String(58_720_256 + index * 3_145_728),
      activeSeconds: "0",
      finishedSeconds: "0",
      seedingSeconds: "0",
      shareRatioHundredths: "0",
      seedAdmission: "ineligible",
      seedGoal: null,
      addedAtMs: DEMO_BASE_TIME_MS + source.demo!.elapsedMs,
      archived: false,
      removalState: null,
      deleteDataSupported: true,
      forceRecheckAvailable: false,
      infoHash,
      error: null,
      progressReason: "Generated by the demo adapter",
    };
    torrentOrder.push(id);
  }

  const active = Object.values(torrents).filter(
    (row) => row.status === "downloading" || row.status === "metadata",
  );
  const logs = [...source.logs, ...commandLogs]
    .sort((left, right) => left.timestampMs - right.timestampMs)
    .slice(-2_048);
  const localOverflow = Math.max(
    0,
    source.logs.length + commandLogs.length - 2_048,
  );
  return {
    ...source,
    session: {
      ...source.session,
      downloadRate: active.reduce((sum, row) => sum + row.downloadRate, 0),
      uploadRate: active.reduce((sum, row) => sum + (row.uploadRate ?? 0), 0),
      knownPeers: Object.values(torrents).reduce(
        (sum, row) => sum + (row.peersKnown ?? 0),
        0,
      ),
    },
    torrentOrder,
    torrents,
    clientSettings:
      clientSettings === null
        ? source.clientSettings
        : { ...source.clientSettings, configured: clientSettings },
    peersByTorrent: Object.fromEntries(
      Object.entries(source.peersByTorrent).filter(([torrentId]) => !removed.has(torrentId)),
    ),
    swarmByTorrent: Object.fromEntries(
      Object.entries(source.swarmByTorrent).filter(([torrentId]) => !removed.has(torrentId)),
    ),
    filesByTorrent: Object.fromEntries(
      Object.entries(source.filesByTorrent).filter(([torrentId]) => !removed.has(torrentId)),
    ),
    mediaByTorrent: Object.fromEntries(
      Object.entries(source.mediaByTorrent).filter(
        ([torrentId]) => !removed.has(torrentId),
      ),
    ),
    trackersByTorrent: Object.fromEntries(
      Object.entries(source.trackersByTorrent).filter(
        ([torrentId]) => !removed.has(torrentId),
      ),
    ),
    piecesByTorrent: Object.fromEntries(
      Object.entries(source.piecesByTorrent).filter(
        ([torrentId]) => !removed.has(torrentId),
      ),
    ),
    logs,
    logLoss: {
      ...source.logLoss,
      retainedFromSequence: logs[0]?.id ?? source.logLoss.retainedFromSequence,
      localEvictedCount: source.logLoss.localEvictedCount + localOverflow,
    },
  };
}

function diffSnapshots(
  previous: InspectionSnapshot,
  next: InspectionSnapshot,
): InspectionUpdate | null {
  const torrentUpserts = next.torrentOrder
    .map((id) => next.torrents[id])
    .filter((row): row is TorrentRow => row !== undefined)
    .filter((row) => !shallowEqual(previous.torrents[row.id], row));
  const torrentRemoved = previous.torrentOrder.filter(
    (id) => next.torrents[id] === undefined,
  );
  const peerPatches: Array<
    KeyedPatch<PeerRow> & { readonly torrentId: string; readonly order: readonly string[] }
  > = [];
  const swarmPatches: Array<
    KeyedPatch<SwarmRow> & {
      readonly torrentId: string;
      readonly state: SwarmSet["state"];
      readonly capturedMillis: number;
      readonly maximumRecords: number;
      readonly counts: SwarmSet["counts"];
      readonly order: readonly string[];
    }
  > = [];
  const filePatches: Array<
    KeyedPatch<FileRow> & {
      readonly torrentId: string;
      readonly state: "metadata_pending" | "available" | "torrent_missing";
      readonly filesystemContentBase: string | null;
      readonly order: readonly string[];
    }
  > = [];
  const mediaPatches: Array<
    KeyedPatch<MediaRow> & {
      readonly torrentId: string;
      readonly state: "metadata_pending" | "available" | "torrent_missing";
      readonly totalNonPaddingFiles: number;
      readonly order: readonly string[];
    }
  > = [];
  const trackerPatches: Array<
    KeyedPatch<TrackerRow> & {
      readonly torrentId: string;
      readonly state: "available" | "torrent_missing";
      readonly order: readonly string[];
    }
  > = [];
  for (const [torrentId, nextSet] of Object.entries(next.peersByTorrent)) {
    const previousSet = previous.peersByTorrent[torrentId];
    const upsert = nextSet.order
      .map((id) => nextSet.rows[id])
      .filter((row): row is PeerRow => row !== undefined)
      .filter((row) => !shallowEqual(previousSet?.rows[row.connectionId], row));
    const removed =
      previousSet?.order.filter((id) => nextSet.rows[id] === undefined) ?? [];
    if (
      upsert.length > 0 ||
      removed.length > 0 ||
      !arraysEqual(previousSet?.order ?? [], nextSet.order)
    ) {
      peerPatches.push({ torrentId, upsert, removed, order: nextSet.order });
    }
  }
  for (const [torrentId, previousSet] of Object.entries(previous.peersByTorrent)) {
    if (next.peersByTorrent[torrentId] === undefined) {
      peerPatches.push({ torrentId, upsert: [], removed: previousSet.order, order: [] });
    }
  }
  for (const [torrentId, nextSet] of Object.entries(next.swarmByTorrent)) {
    const previousSet = previous.swarmByTorrent[torrentId];
    const upsert = nextSet.order
      .map((id) => nextSet.rows[id])
      .filter((row): row is SwarmRow => row !== undefined)
      .filter((row) => !shallowEqual(previousSet?.rows[row.recordId], row));
    const removed =
      previousSet?.order.filter((id) => nextSet.rows[id] === undefined) ?? [];
    if (
      upsert.length > 0 ||
      removed.length > 0 ||
      previousSet?.state !== nextSet.state ||
      previousSet?.capturedMillis !== nextSet.capturedMillis ||
      previousSet?.maximumRecords !== nextSet.maximumRecords ||
      !shallowEqual(previousSet?.counts, nextSet.counts) ||
      !arraysEqual(previousSet?.order ?? [], nextSet.order)
    ) {
      swarmPatches.push({
        torrentId,
        state: nextSet.state,
        capturedMillis: nextSet.capturedMillis,
        maximumRecords: nextSet.maximumRecords,
        counts: nextSet.counts,
        upsert,
        removed,
        order: nextSet.order,
      });
    }
  }
  for (const [torrentId, previousSet] of Object.entries(previous.swarmByTorrent)) {
    if (next.swarmByTorrent[torrentId] === undefined) {
      swarmPatches.push({
        torrentId,
        state: "torrent_missing",
        capturedMillis: previousSet.capturedMillis,
        maximumRecords: previousSet.maximumRecords,
        counts: {
          total: 0,
          eligible: 0,
          not_connectable: 0,
          dialing: 0,
          connected: 0,
          backed_off: 0,
          failure_limited: 0,
          banned: 0,
        },
        upsert: [],
        removed: previousSet.order,
        order: [],
      });
    }
  }
  for (const [torrentId, nextSet] of Object.entries(next.filesByTorrent)) {
    const previousSet = previous.filesByTorrent[torrentId];
    const upsert = nextSet.order
      .map((id) => nextSet.rows[id])
      .filter((row): row is FileRow => row !== undefined)
      .filter((row) => !shallowEqual(previousSet?.rows[row.id], row));
    const removed = previousSet?.order.filter((id) => nextSet.rows[id] === undefined) ?? [];
    if (
      upsert.length > 0 ||
      removed.length > 0 ||
      previousSet?.state !== nextSet.state ||
      previousSet?.filesystemContentBase !== nextSet.filesystemContentBase ||
      !arraysEqual(previousSet?.order ?? [], nextSet.order)
    ) {
      filePatches.push({
        torrentId,
        state: nextSet.state,
        filesystemContentBase: nextSet.filesystemContentBase,
        upsert,
        removed,
        order: nextSet.order,
      });
    }
  }
  for (const [torrentId, previousSet] of Object.entries(previous.filesByTorrent)) {
    if (next.filesByTorrent[torrentId] === undefined) {
      filePatches.push({
        torrentId,
        state: "torrent_missing",
        filesystemContentBase: null,
        upsert: [],
        removed: previousSet.order,
        order: [],
      });
    }
  }
  for (const [torrentId, nextSet] of Object.entries(next.mediaByTorrent)) {
    const previousSet = previous.mediaByTorrent[torrentId];
    const upsert = nextSet.order
      .map((id) => nextSet.rows[id])
      .filter((row): row is MediaRow => row !== undefined)
      .filter((row) => !shallowEqual(previousSet?.rows[row.id], row));
    const removed =
      previousSet?.order.filter((id) => nextSet.rows[id] === undefined) ?? [];
    if (
      upsert.length > 0 ||
      removed.length > 0 ||
      previousSet?.state !== nextSet.state ||
      previousSet?.totalNonPaddingFiles !== nextSet.totalNonPaddingFiles ||
      !arraysEqual(previousSet?.order ?? [], nextSet.order)
    ) {
      mediaPatches.push({
        torrentId,
        state: nextSet.state,
        totalNonPaddingFiles: nextSet.totalNonPaddingFiles,
        upsert,
        removed,
        order: nextSet.order,
      });
    }
  }
  for (const [torrentId, previousSet] of Object.entries(previous.mediaByTorrent)) {
    if (next.mediaByTorrent[torrentId] === undefined) {
      mediaPatches.push({
        torrentId,
        state: "torrent_missing",
        totalNonPaddingFiles: 0,
        upsert: [],
        removed: previousSet.order,
        order: [],
      });
    }
  }
  for (const [torrentId, nextSet] of Object.entries(next.trackersByTorrent)) {
    const previousSet = previous.trackersByTorrent[torrentId];
    const upsert = nextSet.order
      .map((id) => nextSet.rows[id])
      .filter((row): row is TrackerRow => row !== undefined)
      .filter((row) => !shallowEqual(previousSet?.rows[row.id], row));
    const removed =
      previousSet?.order.filter((id) => nextSet.rows[id] === undefined) ?? [];
    if (
      upsert.length > 0 ||
      removed.length > 0 ||
      previousSet?.state !== nextSet.state ||
      !arraysEqual(previousSet?.order ?? [], nextSet.order)
    ) {
      trackerPatches.push({
        torrentId,
        state: nextSet.state,
        upsert,
        removed,
        order: nextSet.order,
      });
    }
  }
  for (const [torrentId, previousSet] of Object.entries(
    previous.trackersByTorrent,
  )) {
    if (next.trackersByTorrent[torrentId] === undefined) {
      trackerPatches.push({
        torrentId,
        state: "torrent_missing",
        upsert: [],
        removed: previousSet.order,
        order: [],
      });
    }
  }

  const previousLogIds = new Set(previous.logs.map((row) => row.id));
  const appendedLogs = next.logs.filter((row) => !previousLogIds.has(row.id));
  return {
    type: "patch",
    revision: next.revision,
    durableRevision: next.durableRevision,
    session: next.session,
    clientSettings: next.clientSettings,
    ...(next.demo === null ? {} : { demo: next.demo }),
    ...(torrentUpserts.length === 0 &&
    torrentRemoved.length === 0 &&
    arraysEqual(previous.torrentOrder, next.torrentOrder)
      ? {}
      : {
          torrents: {
            upsert: torrentUpserts,
            removed: torrentRemoved,
            order: next.torrentOrder,
          },
        }),
    ...(peerPatches.length === 0 ? {} : { peers: peerPatches }),
    ...(swarmPatches.length === 0 ? {} : { swarm: swarmPatches }),
    ...(filePatches.length === 0 ? {} : { files: filePatches }),
    ...(mediaPatches.length === 0 ? {} : { media: mediaPatches }),
    ...(trackerPatches.length === 0 ? {} : { trackers: trackerPatches }),
    ...(!samePieceMaps(previous.piecesByTorrent, next.piecesByTorrent)
      ? { pieces: next.piecesByTorrent }
      : {}),
    ...(!sameDisk(previous.disk, next.disk) ? { disk: next.disk } : {}),
    ...(appendedLogs.length === 0
      ? {}
      : {
          logs: {
            append: appendedLogs,
            sourceEvictedCount: next.logLoss.sourceEvictedCount,
            retainedFromSequence: next.logLoss.retainedFromSequence,
            deliveryResetCount: next.logLoss.deliveryResetCount,
            lastDeliveryResetReason: next.logLoss.lastDeliveryResetReason,
          },
        }),
  };
}

function sameDisk(left: DiskSet, right: DiskSet): boolean {
  if (!shallowEqual(left.pipeline, right.pipeline)) return false;
  if (!arraysEqual(left.order, right.order)) return false;
  return right.order.every((id) => {
    const row = right.rows[id];
    return row !== undefined && shallowEqual(left.rows[id], row);
  });
}

function samePieceMaps(
  left: Readonly<Record<string, PieceMapSet>>,
  right: Readonly<Record<string, PieceMapSet>>,
): boolean {
  const ids = Object.keys(right);
  if (ids.length !== Object.keys(left).length) return false;
  return ids.every((id) => {
    const previous = left[id];
    const next = right[id];
    if (
      previous === undefined ||
      next === undefined ||
      previous.pieceCount !== next.pieceCount ||
      previous.revision !== next.revision ||
      previous.active.length !== next.active.length ||
      previous.verified.length !== next.verified.length
    ) {
      return false;
    }
    for (let index = 0; index < next.verified.length; index += 1) {
      if (previous.verified[index] !== next.verified[index]) return false;
    }
    return next.active.every((piece, index) =>
      shallowEqual(previous.active[index], piece),
    );
  });
}

function shallowEqual<T extends object>(left: T | undefined, right: T): boolean {
  if (left === undefined) return false;
  const keys = Object.keys(right);
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  return (
    keys.length === Object.keys(left).length &&
    keys.every((key) => leftRecord[key] === rightRecord[key])
  );
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function accepted(message: string): CommandResult {
  return { accepted: true, message };
}

function rejected(message: string): CommandResult {
  return { accepted: false, message };
}

function encodeMagnetValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
