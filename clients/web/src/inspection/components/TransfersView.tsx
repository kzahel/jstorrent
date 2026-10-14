import { message as localizedMessage } from "../../localization/runtime";
import { useMemo, useState } from "react";

import { useInspectionStore } from "../context";
import type { TorrentCategory, TorrentRow } from "../model";
import { torrentMatchesCategory } from "../state";
import { TorrentActions } from "./TorrentActions";
import { TransferTable } from "./TransferTable";
import { TableToolbarSlot } from "./VirtualTable";
import styles from "./TransfersView.module.css";

interface TransfersViewProps {
  readonly showCrostiniStorageHelp: boolean;
  readonly oneCurrentRoot?: boolean;
}

export function TransfersView({
  showCrostiniStorageHelp,
  oneCurrentRoot = false,
}: TransfersViewProps) {
  const order = useInspectionStore((state) => state.torrentOrder);
  const torrents = useInspectionStore((state) => state.torrents);
  const category = useInspectionStore(
    (state) => state.presentation.transfersCategory,
  );
  const layout = useInspectionStore((state) => state.presentation.layout);
  const [tableToolbar, setTableToolbar] = useState<HTMLDivElement | null>(
    null,
  );
  const rows = useMemo(
    () =>
      order
        .map((id) => torrents[id])
        .filter((row): row is TorrentRow => row !== undefined),
    [order, torrents],
  );
  const visibleCount = rows.filter((row) =>
    torrentMatchesCategory(row, category),
  ).length;
  const activeCount = rows.filter(
    (row) =>
      row.operationalState === "starting" ||
      row.operationalState === "downloading",
  ).length;

  return (
    <section className={styles.transfers} aria-labelledby="transfers-heading">
      <div className={styles.heading}>
        <div>
          <p>{categoryLabel(category)}</p>
          <h1 id="transfers-heading">{localizedMessage("inspection.components.transfers.view.transfers")}</h1>
        </div>
        <span>
          {visibleCount.toLocaleString()}{" "}{localizedMessage("inspection.components.transfers.view.shown")}<span aria-hidden="true"> · </span>
          {activeCount.toLocaleString()}{" "}{localizedMessage("inspection.components.transfers.view.active")}</span>
      </div>
      <TorrentActions
        showCrostiniStorageHelp={showCrostiniStorageHelp}
        oneCurrentRoot={oneCurrentRoot}
        tableToolbarRef={setTableToolbar}
      />
      <div className={styles.table}>
        <TableToolbarSlot.Provider
          value={layout === "phone" ? null : tableToolbar}
        >
          <TransferTable />
        </TableToolbarSlot.Provider>
      </div>
    </section>
  );
}

function categoryLabel(category: TorrentCategory): string {
  switch (category) {
    case "all":
      return localizedMessage("inspection.components.transfers.view.all.torrents");
    case "active":
      return localizedMessage("inspection.components.transfers.view.active.9234069");
    case "downloading":
      return localizedMessage("inspection.components.transfers.view.downloading");
    case "completed":
      return localizedMessage("inspection.components.transfers.view.completed");
    case "paused":
      return localizedMessage("inspection.components.transfers.view.paused");
    case "errors":
      return localizedMessage("inspection.components.transfers.view.needs.attention");
    case "archived":
      return localizedMessage("inspection.components.transfers.view.archived");
  }
}
