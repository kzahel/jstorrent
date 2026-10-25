import { formatNumber, message as localizedMessage, useProductLocale } from "../../localization/runtime";
import { useMemo } from "react";

import { useInspectionStore } from "../context";
import type { DataUnits } from "../appearance";
import { formatBytes, formatProgress, formatRate } from "../format";
import type { PeerRow, ViewMaterialization } from "../model";
import {
  describePeerFlags,
  formatPeerFlags,
  PEER_FLAG_DEFINITIONS,
  PEER_FLAG_ORDER,
  type PeerFlagGroup,
} from "../peerFlags";
import { VirtualTable, type VirtualColumn } from "./VirtualTable";
import styles from "./PeerTable.module.css";

const columns = (dataUnits: DataUnits): readonly VirtualColumn<PeerRow>[] => [
  {
    id: "state",
    listRole: "trailing",
    label: localizedMessage("inspection.components.peer.table.state"),
    width: 104,
    sortable: true,
    sortValue: (row) => row.state,
    sortOrder: [
      "connected",
      "choked",
      "stalled",
      "handshaking",
      "connecting",
      "disconnecting",
    ],
    render: (row) => (
      <span className={styles.state} data-state={row.state}>
        <span aria-hidden="true" />
        {row.state}
      </span>
    ),
  },
  {
    id: "endpoint",
    listRole: "subtitle",
    label: localizedMessage("inspection.components.peer.table.address"),
    width: 188,
    sortable: true,
    sortValue: (row) => row.endpoint,
    render: (row) => <span title={row.endpoint}>{row.endpoint}</span>,
  },
  {
    id: "client",
    listRole: "title",
    label: localizedMessage("inspection.components.peer.table.client"),
    width: 154,
    sortable: true,
    sortValue: (row) => row.client,
    render: (row) => (
      <span title={row.client ?? undefined}>{row.client ?? "—"}</span>
    ),
  },
  {
    id: "source",
    label: localizedMessage("inspection.components.peer.table.source"),
    width: 74,
    sortable: true,
    sortValue: (row) => row.source,
    render: (row) => row.source.toUpperCase(),
  },
  {
    id: "progress",
    listRole: "detail",
    listLabel: null,
    label: "%",
    width: 64,
    align: "right",
    sortable: true,
    sortValue: (row) => row.progress,
    sortKind: "number",
    render: (row) =>
      row.progress === null ? "—" : formatProgress(row.progress),
  },
  {
    id: "down",
    listRole: "detail",
    label: localizedMessage("inspection.components.peer.table.down"),
    width: 96,
    align: "right",
    sortable: true,
    sortValue: (row) => row.downloadRate,
    sortKind: "number",
    render: (row) => formatRate(row.downloadRate, dataUnits),
  },
  {
    id: "up",
    listRole: "detail",
    label: localizedMessage("inspection.components.peer.table.up"),
    width: 96,
    align: "right",
    sortable: true,
    sortValue: (row) => row.uploadRate,
    sortKind: "number",
    render: (row) => formatRate(row.uploadRate, dataUnits),
  },
  {
    id: "downloaded",
    label: localizedMessage("inspection.components.peer.table.downloaded"),
    width: 104,
    align: "right",
    sortable: true,
    sortValue: (row) => row.downloadedBytes,
    sortKind: "number",
    render: (row) => formatBytes(row.downloadedBytes, dataUnits),
  },
  {
    id: "uploaded",
    label: localizedMessage("inspection.components.peer.table.uploaded"),
    width: 104,
    align: "right",
    sortable: true,
    sortValue: (row) => row.uploadedBytes,
    sortKind: "number",
    render: (row) => formatBytes(row.uploadedBytes, dataUnits),
  },
  {
    id: "requests",
    label: localizedMessage("inspection.components.peer.table.reqs"),
    width: 62,
    align: "right",
    sortable: true,
    sortValue: (row) => row.requestsPending,
    sortKind: "number",
    render: (row) => row.requestsPending ?? "—",
  },
  {
    id: "age",
    label: localizedMessage("inspection.components.peer.table.oldest"),
    width: 78,
    align: "right",
    sortable: true,
    sortValue: (row) => row.oldestRequestMs,
    sortKind: "number",
    render: (row) =>
      row.oldestRequestMs === null
        ? "—"
        : row.oldestRequestMs >= 1000
          ? `${formatNumber(row.oldestRequestMs / 1000, { useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 })}s`
          : `${row.oldestRequestMs}ms`,
  },
  {
    id: "connected",
    label: localizedMessage("inspection.components.peer.table.connected"),
    width: 88,
    align: "right",
    sortable: true,
    sortValue: (row) => row.connectedAgeMs,
    sortKind: "number",
    render: (row) => formatDuration(row.connectedAgeMs),
  },
  {
    id: "lastPayload",
    label: localizedMessage("inspection.components.peer.table.last.data"),
    width: 104,
    align: "right",
    sortable: true,
    sortValue: (row) => row.lastPayloadAgeMs,
    sortKind: "number",
    render: (row) => formatAge(row.lastPayloadAgeMs),
  },
  {
    id: "flags",
    label: localizedMessage("inspection.components.peer.table.flags"),
    width: 96,
    align: "center",
    sortable: true,
    sortValue: (row) => formatPeerFlags(row.flags),
    headerHelp: <PeerFlagLegend />,
    headerHelpWidth: 260,
    render: (row) => {
      const glyphs = formatPeerFlags(row.flags);
      const description = describePeerFlags(row.flags, row.mseMethod);
      return (
        <code
          className={styles.flags}
          aria-label={description}
          title={description}
        >
          {glyphs || "—"}
        </code>
      );
    },
  },
];

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  if (milliseconds < 60_000) return `${formatNumber(milliseconds / 1_000, { useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 })}s`;
  if (milliseconds < 3_600_000)
    return `${Math.round(milliseconds / 60_000)}m`;
  return `${formatNumber(milliseconds / 3_600_000, { useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`;
}

function formatAge(milliseconds: number | null): string {
  return milliseconds === null ? "—" : localizedMessage("inspection.components.peer.table.age", { duration: formatDuration(milliseconds) });
}

const PEER_FLAG_GROUPS: readonly PeerFlagGroup[] = [
  "Connection",
  "Transfer",
  "Protocol",
  "Scheduler / integrity",
];

function PeerFlagLegend() {
  return (
    <div className={styles.legend}>
      {PEER_FLAG_GROUPS.map((group) => (
        <section key={group}>
          <h3>{peerFlagGroupLabel(group)}</h3>
          <dl>
            {PEER_FLAG_ORDER.filter(
              (flag) => PEER_FLAG_DEFINITIONS[flag].group === group,
            ).map((flag) => {
              const definition = PEER_FLAG_DEFINITIONS[flag];
              return (
                <div key={flag} className={styles.legendRow}>
                  <dt>
                    <code>{definition.glyph}</code>
                  </dt>
                  <dd>{definition.label}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

export function PeerTable({ torrentId }: { readonly torrentId: string }) {
  const dataUnits = useInspectionStore((state) => state.presentation.dataUnits);
  const locale = useProductLocale();
  const displayColumns = useMemo(() => columns(dataUnits), [locale, dataUnits]);
  const peerSet = useInspectionStore(
    (state) => state.peersByTorrent[torrentId],
  );
  const currentPeerId = useInspectionStore(
    (state) => state.presentation.currentPeerId,
  );
  const setCurrentPeer = useInspectionStore((state) => state.setCurrentPeer);
  const materialization = useInspectionStore((state) => state.viewStatus.peers);
  const interfaceSize = useInspectionStore(
    (state) => state.presentation.interfaceSize,
  );
  const rows = useMemo(
    () =>
      (peerSet?.order ?? [])
        .map((id) => peerSet?.rows[id])
        .filter((row): row is PeerRow => row !== undefined),
    [peerSet],
  );

  return (
    <VirtualTable
      formatCount={(count) => localizedMessage("common.count.peers", { count })}
      tableId="peers"
      label={localizedMessage("inspection.components.peer.table.active.peer.connections")}
      rows={rows}
      getRowId={(row) => row.connectionId}
      columns={displayColumns}
      interfaceSize={interfaceSize}
      currentRowId={currentPeerId}
      onActivate={(row) => setCurrentPeer(row.connectionId)}
      emptyMessage={peerEmptyMessage(materialization)}
    />
  );
}

function peerEmptyMessage(materialization: ViewMaterialization): string {
  switch (materialization.status) {
    case "not_requested":
      return localizedMessage("inspection.components.peer.table.nothing.to.show");
    case "loading":
      // Peer state usually arrives within a frame of switching torrents;
      // a loading label there only reads as flicker.
      return "";
    case "unavailable":
    case "unsupported":
      return materialization.reason;
    case "stale":
    case "ready":
      return localizedMessage("inspection.components.peer.table.no.peers.connected");
  }
}

function peerFlagGroupLabel(group: PeerFlagGroup): string {
  switch (group) {
    case "Connection": return localizedMessage("inspection.components.peer.table.flag.group.connection");
    case "Transfer": return localizedMessage("inspection.components.peer.table.flag.group.transfer");
    case "Protocol": return localizedMessage("inspection.components.peer.table.flag.group.protocol");
    case "Scheduler / integrity": return localizedMessage("inspection.components.peer.table.flag.group.integrity");
  }
}
