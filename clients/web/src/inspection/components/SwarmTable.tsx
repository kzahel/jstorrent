import { formatNumber, message as localizedMessage, useProductLocale  } from "../../localization/runtime";
import { useMemo } from "react";

import { useInspectionStore } from "../context";
import type { DataUnits } from "../appearance";
import { formatExactBytes } from "../format";
import type { SwarmRow, SwarmSet, ViewMaterialization } from "../model";
import { VirtualTable, type VirtualColumn } from "./VirtualTable";
import styles from "./SwarmTable.module.css";

const columns = (dataUnits: DataUnits): readonly VirtualColumn<SwarmRow>[] => [
  {
    id: "state",
    listRole: "trailing",
    label: localizedMessage("inspection.components.swarm.table.state"),
    width: 132,
    sortable: true,
    sortValue: (row) => row.state,
    sortOrder: [
      "connected",
      "dialing",
      "eligible",
      "backed_off",
      "failure_limited",
      "not_connectable",
      "banned",
    ],
    render: (row) => (
      <span className={styles.state} data-state={row.state}>
        <span aria-hidden="true" />
        {formatLabel(row.state)}
      </span>
    ),
  },
  {
    id: "endpoint",
    listRole: "title",
    label: localizedMessage("inspection.components.swarm.table.address"),
    width: 192,
    minimumWidth: 150,
    maximumWidth: 360,
    sortable: true,
    sortValue: (row) => row.endpoint,
    render: (row) => (
      <code className={styles.endpoint} title={row.endpoint}>
        {row.endpoint}
      </code>
    ),
  },
  {
    id: "sources",
    listRole: "subtitle",
    label: localizedMessage("inspection.components.swarm.table.sources"),
    width: 136,
    sortable: true,
    sortValue: (row) => row.sources.join(","),
    render: (row) => (
      <span title={row.sources.map(formatSource).join(", ")}>
        {row.sources.map(shortSource).join(" · ") || "—"}
      </span>
    ),
  },
  {
    id: "lastSeen",
    listRole: "detail",
    label: localizedMessage("inspection.components.swarm.table.last.seen"),
    width: 92,
    align: "right",
    sortable: true,
    sortKind: "number",
    sortValue: (row) => row.lastObservedAgeMs,
    render: (row) => formatDuration(row.lastObservedAgeMs),
  },
  {
    id: "retry",
    label: localizedMessage("inspection.components.swarm.table.retry"),
    width: 82,
    align: "right",
    sortable: true,
    sortKind: "number",
    sortValue: (row) => row.retryInMs,
    render: (row) => formatDuration(row.retryInMs),
  },
  {
    id: "downloaded",
    listRole: "detail",
    label: localizedMessage("inspection.components.swarm.table.downloaded"),
    width: 104,
    align: "right",
    sortable: true,
    sortKind: "decimal",
    sortValue: (row) => row.payloadDownloadedBytes,
    headerHelp: (
      <p>{localizedMessage("inspection.components.swarm.table.file.data.received.from.this.peer")}</p>
    ),
    render: (row) => formatExactBytes(row.payloadDownloadedBytes, dataUnits),
  },
  {
    id: "uploaded",
    listRole: "detail",
    label: localizedMessage("inspection.components.swarm.table.uploaded"),
    width: 104,
    align: "right",
    sortable: true,
    sortKind: "decimal",
    sortValue: (row) => row.payloadUploadedBytes,
    headerHelp: (
      <p>{localizedMessage("inspection.components.swarm.table.file.data.sent.to.this.peer")}</p>
    ),
    render: (row) => formatExactBytes(row.payloadUploadedBytes, dataUnits),
  },
  {
    id: "attempts",
    label: localizedMessage("inspection.components.swarm.table.dials"),
    width: 62,
    align: "right",
    sortable: true,
    sortKind: "number",
    sortValue: (row) => row.dialAttempts,
    render: (row) => formatNumber(row.dialAttempts),
  },
  {
    id: "failures",
    label: localizedMessage("inspection.components.swarm.table.fails"),
    width: 62,
    align: "right",
    sortable: true,
    sortKind: "number",
    sortValue: (row) => row.consecutiveFailures,
    render: (row) => formatNumber(row.consecutiveFailures),
  },
  {
    id: "failure",
    label: localizedMessage("inspection.components.swarm.table.last.failure"),
    width: 112,
    defaultVisible: false,
    sortable: true,
    sortValue: (row) => row.lastFailure,
    render: (row) => (row.lastFailure === null ? "—" : formatLabel(row.lastFailure)),
  },
  {
    id: "firstSeen",
    label: localizedMessage("inspection.components.swarm.table.known.for"),
    width: 92,
    defaultVisible: false,
    align: "right",
    sortable: true,
    sortKind: "number",
    sortValue: (row) => row.firstObservedAgeMs,
    render: (row) => formatDuration(row.firstObservedAgeMs),
  },
  {
    id: "lastDial",
    label: localizedMessage("inspection.components.swarm.table.last.dial"),
    width: 92,
    defaultVisible: false,
    align: "right",
    sortable: true,
    sortKind: "number",
    sortValue: (row) => row.lastDialAgeMs,
    render: (row) => formatDuration(row.lastDialAgeMs),
  },
  {
    id: "trust",
    label: localizedMessage("inspection.components.swarm.table.trust"),
    width: 64,
    align: "right",
    sortable: true,
    sortKind: "number",
    sortValue: (row) => row.trustPoints,
    render: (row) => formatNumber(row.trustPoints),
  },
  {
    id: "parole",
    label: localizedMessage("inspection.components.swarm.table.parole"),
    width: 72,
    sortable: true,
    sortValue: (row) => (row.onParole ? 1 : 0),
    sortKind: "number",
    render: (row) => (row.onParole ? localizedMessage("inspection.components.swarm.table.presentation.yes") : localizedMessage("inspection.components.swarm.table.presentation.no")),
  },
  {
    id: "integrity",
    label: localizedMessage("inspection.components.swarm.table.integrity"),
    width: 110,
    defaultVisible: false,
    sortable: true,
    sortValue: (row) => `${row.onParole}-${row.hashFailures}-${row.validPieces}`,
    render: (row) =>
      row.onParole
        ? localizedMessage("inspection.components.swarm.table.integrity.bad", { count: row.hashFailures })
        : localizedMessage("inspection.components.swarm.table.integrity.valid", { count: row.validPieces }),
  },
];

export function SwarmTable({ torrentId }: { readonly torrentId: string }) {
  const dataUnits = useInspectionStore((state) => state.presentation.dataUnits);
  const locale = useProductLocale();
  const displayColumns = useMemo(() => columns(dataUnits), [locale, dataUnits]);
  const swarm = useInspectionStore((state) => state.swarmByTorrent[torrentId]);
  const materialization = useInspectionStore((state) => state.viewStatus.swarm);
  const interfaceSize = useInspectionStore(
    (state) => state.presentation.interfaceSize,
  );
  const rows = useMemo(
    () =>
      (swarm?.order ?? [])
        .map((id) => swarm?.rows[id])
        .filter((row): row is SwarmRow => row !== undefined),
    [swarm],
  );

  return (
    <div className={styles.panel}>
      <SwarmSummary swarm={swarm} />
      <VirtualTable
        formatCount={(count) => localizedMessage("common.count.peers", { count })}
        tableId="swarm"
        label={localizedMessage("inspection.components.swarm.table.known.swarm.peers")}
        rows={rows}
        getRowId={(row) => row.recordId}
        columns={displayColumns}
        interfaceSize={interfaceSize}
        emptyMessage={swarmEmptyMessage(materialization, swarm?.state)}
        initialSort={{ columnId: "state", direction: "asc" }}
      />
    </div>
  );
}

function SwarmSummary({ swarm }: { readonly swarm: SwarmSet | undefined }) {
  const counts = swarm?.counts;
  const total = counts?.total ?? 0;
  const capacity = swarm?.maximumRecords ?? 1_000;
  return (
    <div
      className={styles.summary}
      aria-label={localizedMessage("inspection.components.swarm.table.swarm.registry.summary")}
      tabIndex={0}
    >
      <strong>{formatNumber(total)}</strong>
      <span>{localizedMessage("inspection.components.swarm.table.known")}</span>
      <span className={styles.separator} aria-hidden="true" />
      <SummaryCount label={localizedMessage("inspection.components.swarm.table.eligible")} value={counts?.eligible ?? 0} tone="ready" />
      <SummaryCount
        label={localizedMessage("inspection.components.swarm.table.not.connectable")}
        value={counts?.not_connectable ?? 0}
        tone="blocked"
      />
      <SummaryCount label={localizedMessage("inspection.components.swarm.table.dialing")} value={counts?.dialing ?? 0} tone="waiting" />
      <SummaryCount label={localizedMessage("inspection.components.swarm.table.connected")} value={counts?.connected ?? 0} tone="connected" />
      <SummaryCount label={localizedMessage("inspection.components.swarm.table.backed.off")} value={counts?.backed_off ?? 0} tone="waiting" />
      <SummaryCount
        label={localizedMessage("inspection.components.swarm.table.failure.limited")}
        value={counts?.failure_limited ?? 0}
        tone="limited"
      />
      <SummaryCount label={localizedMessage("inspection.components.swarm.table.banned")} value={counts?.banned ?? 0} tone="limited" />
      <span className={styles.capacity}>{formatNumber(total)} / {formatNumber(capacity)}</span>
    </div>
  );
}

function SummaryCount({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone: string;
}) {
  return (
    <span className={styles.summaryCount} data-tone={tone}>
      <span aria-hidden="true" />
      {formatNumber(value)} {label}
    </span>
  );
}

function swarmEmptyMessage(
  materialization: ViewMaterialization,
  state: SwarmSet["state"] | undefined,
): string {
  switch (materialization.status) {
    case "not_requested":
      return localizedMessage("inspection.components.swarm.table.nothing.to.show");
    case "loading":
      // Blank, like the peer table: a loading label only flickers.
      return "";
    case "unavailable":
    case "unsupported":
      return materialization.reason;
    case "stale":
    case "ready":
      return state === "inactive"
        ? localizedMessage("inspection.components.swarm.table.presentation.inactive")
        : state === "torrent_missing"
          ? localizedMessage("inspection.components.swarm.table.presentation.missing")
          : localizedMessage("inspection.components.swarm.table.presentation.empty");
  }
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  if (milliseconds < 60_000) return `${formatNumber(milliseconds / 1_000, { useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 })}s`;
  if (milliseconds < 3_600_000) return `${Math.round(milliseconds / 60_000)}m`;
  return `${formatNumber(milliseconds / 3_600_000, { useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`;
}

function formatLabel(value: string): string {
  switch (value) {
    case "eligible": return localizedMessage("inspection.components.swarm.table.value.eligible");
    case "not_connectable": return localizedMessage("inspection.components.swarm.table.value.not.connectable");
    case "dialing": return localizedMessage("inspection.components.swarm.table.value.dialing");
    case "connected": return localizedMessage("inspection.components.swarm.table.value.connected");
    case "backed_off": return localizedMessage("inspection.components.swarm.table.value.backed.off");
    case "failure_limited": return localizedMessage("inspection.components.swarm.table.value.failure.limited");
    case "banned": return localizedMessage("inspection.components.swarm.table.value.banned");
    case "connect": return localizedMessage("inspection.components.swarm.table.value.connect");
    case "handshake": return localizedMessage("inspection.components.swarm.table.value.handshake");
    case "self_connection": return localizedMessage("inspection.components.swarm.table.value.self.connection");
    case "duplicate_peer_id": return localizedMessage("inspection.components.swarm.table.value.duplicate.peer.id");
    case "protocol": return localizedMessage("inspection.components.swarm.table.value.protocol");
    case "remote_closed": return localizedMessage("inspection.components.swarm.table.value.remote.closed");
    case "tracker": return localizedMessage("inspection.components.swarm.table.value.tracker");
    case "peer_exchange": return localizedMessage("inspection.components.swarm.table.value.peer.exchange");
    case "dht": return localizedMessage("inspection.components.swarm.table.value.dht");
    case "local_discovery": return localizedMessage("inspection.components.swarm.table.value.local.discovery");
    case "incoming": return localizedMessage("inspection.components.swarm.table.value.incoming");
    case "manual": return localizedMessage("inspection.components.swarm.table.value.manual");
    case "magnet_hint": return localizedMessage("inspection.components.swarm.table.value.magnet.hint");
    case "cache": return localizedMessage("inspection.components.swarm.table.value.cache");
    default: return value.replaceAll("_", " ");
  }
}

function shortSource(source: SwarmRow["sources"][number]): string {
  switch (source) {
    case "peer_exchange":
      return localizedMessage("inspection.components.swarm.table.pex");
    case "local_discovery":
      return localizedMessage("inspection.components.swarm.table.lsd");
    case "magnet_hint":
      return localizedMessage("inspection.components.swarm.table.magnet");
    default:
      return source.toUpperCase();
  }
}

function formatSource(source: SwarmRow["sources"][number]): string {
  return formatLabel(source);
}
