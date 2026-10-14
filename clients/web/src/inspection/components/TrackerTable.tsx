import { message as localizedMessage } from "../../localization/runtime";
import { useEffect, useMemo, useState } from "react";

import { useInspectionStore } from "../context";
import type {
  TrackerRow,
  TrackerSet,
  ViewMaterialization,
} from "../model";
import {
  peerSourceSummaries,
  type PeerSourceKind,
  type PeerSourceStatus,
} from "../peer-sources";
import { VirtualTable, type VirtualColumn } from "./VirtualTable";
import styles from "./TrackerTable.module.css";

export function TrackerTable({ torrentId }: { readonly torrentId: string }) {
  const trackerSet = useInspectionStore(
    (state) => state.trackersByTorrent[torrentId],
  );
  const materialization = useInspectionStore(
    (state) => state.viewStatus.trackers,
  );
  const interfaceSize = useInspectionStore(
    (state) => state.presentation.interfaceSize,
  );
  const [nowMs, setNowMs] = useState(() => performance.now());

  useEffect(() => {
    setNowMs(performance.now());
    const timer = globalThis.setInterval(() => setNowMs(performance.now()), 1_000);
    return () => globalThis.clearInterval(timer);
  }, []);

  const rows = useMemo(
    () =>
      (trackerSet?.order ?? [])
        .map((id) => trackerSet?.rows[id])
        .filter((row): row is TrackerRow => row !== undefined),
    [trackerSet],
  );
  const columns = useMemo(
    () => trackerColumns(Math.max(nowMs, performance.now())),
    [nowMs, trackerSet],
  );

  return (
    <div className={styles.trackerPanel}>
      <PeerSourceList
        torrentId={torrentId}
        trackers={trackerSet === undefined ? undefined : rows}
      />
      <VirtualTable
        formatCount={(count) => localizedMessage("common.count.trackers", { count })}
        tableId="trackers"
        label={localizedMessage("inspection.components.tracker.table.torrent.trackers")}
        rows={rows}
        getRowId={(row) => row.id}
        columns={columns}
        interfaceSize={interfaceSize}
        emptyMessage={trackerEmptyMessage(materialization, trackerSet?.state)}
        initialSort={{ columnId: "tier", direction: "asc" }}
      />
    </div>
  );
}

/** One line per way this torrent finds peers, trackers first, as qBittorrent lists them. */
function PeerSourceList({
  torrentId,
  trackers,
}: {
  readonly torrentId: string;
  readonly trackers: readonly TrackerRow[] | undefined;
}) {
  const torrent = useInspectionStore((state) => state.torrents[torrentId]);
  const swarm = useInspectionStore((state) => state.swarmByTorrent[torrentId]);
  const dht = useInspectionStore((state) => state.dht);
  const settings = useInspectionStore((state) => state.clientSettings);
  const sources = useMemo(
    () => peerSourceSummaries(torrent, trackers, swarm, dht, settings),
    [dht, settings, swarm, torrent, trackers],
  );
  return (
    <div className={styles.sourcesPanel}>
      <table
        className={styles.sources}
        aria-label={localizedMessage("inspection.components.tracker.table.peer.sources")}
      >
        <tbody>
          {sources.map((source) => (
            <tr key={source.kind}>
              <th scope="row">{sourceLabel(source.kind)}</th>
              <td>
                <span className={styles.sourceStatus} data-status={source.status.type}>
                  <span aria-hidden="true" />
                  {sourceStatusLabel(source.status)}
                </span>
              </td>
              <td>
                {source.known === null
                  ? "—"
                  : localizedMessage("inspection.components.tracker.table.known.count", { count: source.known })}
              </td>
              <td>
                {source.connected === null
                  ? "—"
                  : localizedMessage("inspection.components.tracker.table.connected.count", { count: source.connected })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sourceLabel(kind: PeerSourceKind): string {
  switch (kind) {
    case "tracker": return localizedMessage("inspection.components.tracker.table.source.trackers");
    case "dht": return localizedMessage("inspection.components.tracker.table.source.dht");
    case "peer_exchange": return localizedMessage("inspection.components.tracker.table.source.peer.exchange");
    case "incoming": return localizedMessage("inspection.components.tracker.table.source.incoming");
    case "local_discovery": return localizedMessage("inspection.components.tracker.table.source.local.network");
  }
}

function sourceStatusLabel(status: PeerSourceStatus): string {
  switch (status.type) {
    case "unknown": return "—";
    case "none": return localizedMessage("inspection.components.tracker.table.source.status.none");
    case "off": return localizedMessage("inspection.components.tracker.table.source.status.off");
    case "offline": return localizedMessage("inspection.components.tracker.table.source.status.not.available");
    case "starting": return localizedMessage("inspection.components.tracker.table.source.status.starting");
    case "idle": return localizedMessage("inspection.components.tracker.table.source.status.idle");
    case "on": return localizedMessage("inspection.components.tracker.table.source.status.on");
    case "listening":
      return localizedMessage("inspection.components.tracker.table.source.status.listening", { port: String(status.port) });
    case "searching":
      return localizedMessage("inspection.components.tracker.table.source.status.searching", { found: status.found });
    case "announcing": return localizedMessage("inspection.components.tracker.table.source.status.announcing");
    case "failing": return localizedMessage("inspection.components.tracker.table.source.status.not.responding");
    case "working":
      return localizedMessage("inspection.components.tracker.table.source.status.working", {
        working: status.working,
        total: status.total,
      });
  }
}

function trackerColumns(nowMs: number): readonly VirtualColumn<TrackerRow>[] {
  return [
    {
      id: "url",
      listRole: "title",
      label: localizedMessage("inspection.components.tracker.table.url"),
      width: 220,
      minimumWidth: 170,
      maximumWidth: 760,
      sortValue: (row) => row.url,
      render: (row) => (
        <span className={styles.url} title={row.url}>
          {row.url}
        </span>
      ),
    },
    {
      id: "status",
      listRole: "subtitle",
      label: localizedMessage("inspection.components.tracker.table.status"),
      width: 170,
      sortValue: (row) => row.status,
      sortOrder: [
        "announcing",
        "retry_wait",
        "reannounce_wait",
        "idle",
        "inactive",
      ],
      render: (row) => (
        <span className={styles.status} data-status={row.status}>
          <span aria-hidden="true" />
          {formatStatus(row.status)}
        </span>
      ),
    },
    {
      id: "tier",
      label: localizedMessage("inspection.components.tracker.table.tier"),
      width: 58,
      align: "right",
      sortKind: "number",
      sortValue: (row) => row.tier,
      render: (row) => row.tier.toLocaleString(),
    },
    {
      id: "peers",
      listRole: "detail",
      label: localizedMessage("inspection.components.tracker.table.peers"),
      width: 70,
      align: "right",
      sortKind: "number",
      sortValue: (row) => row.lastPeerCount,
      render: (row) => formatCount(row.lastPeerCount),
    },
    {
      id: "seeds",
      listRole: "detail",
      label: localizedMessage("inspection.components.tracker.table.seeds"),
      width: 70,
      align: "right",
      sortKind: "number",
      sortValue: (row) => row.seeders,
      render: (row) => formatCount(row.seeders),
    },
    {
      id: "leeches",
      listRole: "detail",
      label: localizedMessage("inspection.components.tracker.table.leeches"),
      width: 76,
      align: "right",
      sortKind: "number",
      sortValue: (row) => row.leechers,
      render: (row) => formatCount(row.leechers),
    },
    {
      id: "next",
      listRole: "detail",
      label: localizedMessage("inspection.components.tracker.table.next.announce"),
      width: 132,
      sortKind: "number",
      sortValue: (row) => row.nextActionAtMs,
      render: (row) => formatNextAction(row, nowMs),
    },
    {
      id: "error",
      label: localizedMessage("inspection.components.tracker.table.error"),
      width: 300,
      minimumWidth: 140,
      maximumWidth: 700,
      sortValue: (row) => row.error,
      render: (row) => (
        <span className={styles.error} title={row.error ?? undefined}>
          {row.error ?? "—"}
        </span>
      ),
    },
    {
      id: "transport",
      label: localizedMessage("inspection.components.tracker.table.type"),
      width: 68,
      defaultVisible: false,
      sortValue: (row) => row.transport,
      render: (row) => (
        <span
          title={
            row.security === "encrypted_unauthenticated"
              ? localizedMessage("inspection.components.tracker.table.encrypted.certificate.and.hostname.not.validated")
              : localizedMessage("inspection.components.tracker.table.not.encrypted")
          }
        >
          {row.transport.toUpperCase()}
        </span>
      ),
    },
    {
      id: "family",
      label: localizedMessage("inspection.components.tracker.table.family"),
      width: 74,
      defaultVisible: false,
      sortValue: (row) => row.lastConnectionFamily,
      render: (row) =>
        row.lastConnectionFamily === null
          ? "—"
          : row.lastConnectionFamily === "ipv4"
            ? "IPv4"
            : "IPv6",
    },
    {
      id: "source",
      label: localizedMessage("inspection.components.tracker.table.source"),
      width: 82,
      defaultVisible: false,
      sortValue: (row) => row.source,
      render: (row) => formatStatus(row.source),
    },
    {
      id: "event",
      label: localizedMessage("inspection.components.tracker.table.event"),
      width: 84,
      defaultVisible: false,
      sortValue: (row) => row.announceEvent,
      render: (row) => row.announceEvent ?? "—",
    },
    {
      id: "attempts",
      label: localizedMessage("inspection.components.tracker.table.attempts"),
      width: 84,
      align: "right",
      defaultVisible: false,
      sortKind: "number",
      sortValue: (row) => row.totalAttempts,
      render: (row) => row.totalAttempts.toLocaleString(),
    },
    {
      id: "failures",
      label: localizedMessage("inspection.components.tracker.table.failures"),
      width: 80,
      align: "right",
      defaultVisible: false,
      sortKind: "number",
      sortValue: (row) => row.consecutiveFailures,
      render: (row) => row.consecutiveFailures.toLocaleString(),
    },
    {
      id: "interval",
      label: localizedMessage("inspection.components.tracker.table.interval"),
      width: 90,
      align: "right",
      defaultVisible: false,
      sortKind: "number",
      sortValue: (row) => row.intervalSeconds,
      render: (row) => formatDuration(row.intervalSeconds === null ? null : row.intervalSeconds * 1_000),
    },
    {
      id: "lastSuccess",
      label: localizedMessage("inspection.components.tracker.table.last.success"),
      width: 106,
      align: "right",
      defaultVisible: false,
      sortKind: "number",
      sortValue: (row) => row.lastSuccessAtMs === null ? null : -row.lastSuccessAtMs,
      render: (row) => ageLabel(row.lastSuccessAtMs, nowMs),
    },
    {
      id: "lastFailure",
      label: localizedMessage("inspection.components.tracker.table.last.failure"),
      width: 106,
      align: "right",
      defaultVisible: false,
      sortKind: "number",
      sortValue: (row) => row.lastFailureAtMs === null ? null : -row.lastFailureAtMs,
      render: (row) => ageLabel(row.lastFailureAtMs, nowMs),
    },
  ];
}

function formatNextAction(row: TrackerRow, nowMs: number): string {
  if (row.status === "announcing") return localizedMessage("inspection.components.tracker.table.now");
  const deadline = row.nextActionAtMs;
  if (deadline === null || row.nextAction === null) return "—";
  const action = row.nextAction === "retry" ? "Retry" : "Announce";
  return `${action} in ${formatDuration(Math.max(0, deadline - nowMs))}`;
}

function ageLabel(
  atMs: number | null,
  nowMs: number,
): string {
  return atMs === null
    ? "—"
    : `${formatDuration(Math.max(0, nowMs - atMs))} ago`;
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatStatus(value: string): string {
  return value.replaceAll("_", " ");
}

function formatCount(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

function trackerEmptyMessage(
  materialization: ViewMaterialization,
  catalogState: TrackerSet["state"] | undefined,
): string {
  switch (materialization.status) {
    case "not_requested":
      return localizedMessage("inspection.components.tracker.table.nothing.to.show");
    case "loading":
      // Blank, like the peer table: a loading label only flickers.
      return "";
    case "unavailable":
    case "unsupported":
      return materialization.reason;
    case "stale":
    case "ready":
      return catalogState === "torrent_missing"
        ? "The torrent is no longer present."
        : "This torrent has no configured trackers.";
  }
}
