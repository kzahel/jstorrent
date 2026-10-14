import { message as localizedMessage } from "../../localization/runtime";
import { useMemo } from "react";

import { useInspectionStore } from "../context";
import type { DataUnits } from "../appearance";
import {
  etaAccessibleLabel,
  etaSortValue,
  formatBytes,
  formatEta,
  formatRate,
  torrentRemovalActive,
} from "../format";
import type { TorrentRow, ViewMaterialization } from "../model";
import { torrentMatchesCategory } from "../state";
import { TorrentStatus } from "./TorrentStatus";
import {
  ShowAllTorrentsButton,
  categoryHidesTorrents,
  torrentCategoryEmptyMessage,
} from "./TorrentCategoryEmpty";
import { TorrentContextMenu } from "./TorrentContextMenu";
import {
  TorrentProgress,
  torrentProgressSortValue,
} from "./TorrentProgress";
import { VirtualTable, type VirtualColumn } from "./VirtualTable";
import styles from "./TorrentTable.module.css";

const columns = (
  dataUnits: DataUnits,
): readonly VirtualColumn<TorrentRow>[] => [
  {
    id: "name",
    label: localizedMessage("inspection.components.torrent.table.name"),
    width: 330,
    sortable: true,
    sortValue: (row) => row.name,
    render: (row) => (
      <span
        className={styles.name}
        title={row.name}
        data-removing={torrentRemovalActive(row) || undefined}
      >
        <span
          className={styles.stateDot}
          data-status={row.status}
          aria-hidden="true"
        />
        <span>{row.name}</span>
      </span>
    ),
  },
  {
    id: "size",
    label: localizedMessage("inspection.components.torrent.table.size"),
    width: 92,
    align: "right",
    sortable: true,
    sortValue: (row) => row.sizeBytes,
    render: (row) => formatBytes(row.sizeBytes, dataUnits),
  },
  {
    id: "progress",
    label: localizedMessage("inspection.components.torrent.table.done"),
    width: 190,
    align: "right",
    sortable: true,
    sortValue: torrentProgressSortValue,
    render: (row) => <TorrentProgress row={row} />,
  },
  {
    id: "status",
    label: localizedMessage("inspection.components.torrent.table.status"),
    width: 112,
    sortable: true,
    sortValue: (row) => row.status,
    render: (row) => <TorrentStatus row={row} />,
  },
  {
    id: "down",
    label: localizedMessage("inspection.components.torrent.table.down"),
    width: 100,
    align: "right",
    sortable: true,
    sortValue: (row) => row.downloadRate,
    render: (row) => formatRate(row.downloadRate, dataUnits),
  },
  {
    id: "up",
    label: localizedMessage("inspection.components.torrent.table.up"),
    width: 92,
    align: "right",
    sortable: true,
    sortValue: (row) => row.uploadRate,
    render: (row) => formatRate(row.uploadRate, dataUnits),
  },
  {
    id: "peers",
    label: localizedMessage("inspection.components.torrent.table.peers"),
    width: 72,
    align: "right",
    sortable: true,
    sortValue: (row) => row.peersConnected,
    render: (row) =>
      row.peersKnown === null
        ? row.peersConnected.toLocaleString()
        : `${row.peersConnected}/${row.peersKnown}`,
  },
  {
    id: "eta",
    label: localizedMessage("inspection.components.torrent.table.eta"),
    width: 84,
    align: "right",
    sortable: true,
    sortKind: "decimal",
    sortValue: (row) => etaSortValue(row.eta),
    render: (row) => {
      const label = etaAccessibleLabel(row.eta);
      return (
        <span aria-label={label} title={label}>
          {formatEta(row.eta)}
        </span>
      );
    },
  },
];

export function TorrentTable() {
  const order = useInspectionStore((state) => state.torrentOrder);
  const torrents = useInspectionStore((state) => state.torrents);
  const category = useInspectionStore(
    (state) => state.presentation.workbenchCategory,
  );
  const selectedTorrentIds = useInspectionStore(
    (state) => state.presentation.selectedTorrentIds,
  );
  const currentTorrentId = useInspectionStore(
    (state) => state.presentation.currentTorrentId,
  );
  const setTorrentSelection = useInspectionStore(
    (state) => state.setTorrentSelection,
  );
  const openTorrentDetail = useInspectionStore(
    (state) => state.openTorrentDetail,
  );
  const demo = useInspectionStore((state) => state.demo);
  const materialization = useInspectionStore(
    (state) => state.viewStatus.library,
  );
  const interfaceSize = useInspectionStore(
    (state) => state.presentation.interfaceSize,
  );
  const dataUnits = useInspectionStore((state) => state.presentation.dataUnits);
  const displayColumns = useMemo(() => columns(dataUnits), [dataUnits]);
  const rows = useMemo(
    () =>
      order
        .map((id) => torrents[id])
        .filter((row): row is TorrentRow => row !== undefined)
        .filter((row) => torrentMatchesCategory(row, category)),
    [category, order, torrents],
  );
  const selectedIdSet = useMemo(
    () => new Set(selectedTorrentIds),
    [selectedTorrentIds],
  );

  return (
    <VirtualTable
      formatCount={(count) => localizedMessage("common.count.torrents", { count })}
      tableId="torrents"
      label={localizedMessage("inspection.components.torrent.table.torrent.library")}
      rows={rows}
      getRowId={(row) => row.id}
      columns={displayColumns}
      interfaceSize={interfaceSize}
      currentRowId={currentTorrentId}
      selection={{
        selectedIds: selectedIdSet,
        getRowLabel: (row) => row.name,
        onChange: setTorrentSelection,
      }}
      contextMenu={{
        label: localizedMessage("inspection.components.torrent.table.torrent.actions"),
        render: (row, targetIds) => (
          <TorrentContextMenu
            row={row}
            tableId="torrents"
            targetIds={targetIds}
          />
        ),
      }}
      onActivate={(row) => openTorrentDetail(row.id)}
      emptyMessage={
        materialization.status !== "ready"
          ? materializationMessage(materialization)
          : category === "all" && demo === null
            ? localizedMessage("inspection.components.torrent.table.no.torrents.yet")
            : category === "all"
              ? localizedMessage("inspection.components.torrent.table.no.torrents.yet.add.a.generated.demo")
              : torrentCategoryEmptyMessage(category)
      }
      emptyAction={
        materialization.status === "ready" &&
        categoryHidesTorrents(category, torrents) ? (
          <ShowAllTorrentsButton />
        ) : undefined
      }
      initialSort={{ columnId: "name", direction: "asc" }}
    />
  );
}

function materializationMessage(materialization: ViewMaterialization): string {
  switch (materialization.status) {
    case "not_requested":
      return localizedMessage("inspection.components.torrent.table.loading");
    case "loading":
      return localizedMessage("inspection.components.torrent.table.loading.torrent.library");
    case "unavailable":
    case "unsupported":
    case "stale":
      return materialization.reason;
    case "ready":
      return localizedMessage("inspection.components.torrent.table.no.torrents.in.this.view");
  }
}
