import { message as localizedMessage } from "../../localization/runtime";
import { useInspectionStore } from "../context";
import { torrentRemovalActive, torrentRemovalLabel } from "../format";
import type { TorrentRow } from "../model";
import styles from "./TorrentTable.module.css";

export function TorrentStatus({
  row,
  label = row.status,
}: {
  readonly row: TorrentRow;
  readonly label?: string;
}) {
  const openTorrentErrorDetail = useInspectionStore(
    (state) => state.openTorrentErrorDetail,
  );
  const removalLabel = torrentRemovalLabel(row);
  const statusLabel =
    removalLabel ??
    (row.archived === true
      ? localizedMessage("inspection.components.torrent.status.archived")
      : row.progressReason === "waiting for storage"
        ? localizedMessage("inspection.components.torrent.status.storage.unavailable")
        : label);
  const status = torrentRemovalActive(row)
    ? "removing"
    : row.removalState === "failed"
      ? "error"
      : row.status;

  if (row.error === null) {
    return (
      <span className={styles.status} data-status={status}>
        {statusLabel}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`${styles.status} ${styles.statusButton}`}
      data-status={status}
      title={`${row.error}\nOpen General details.`}
      aria-label={`${statusLabel}: ${row.error}. Open General details`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        openTorrentErrorDetail(row.id);
      }}
    >
      <span>{statusLabel}</span>
      <span aria-hidden="true">↗</span>
    </button>
  );
}
