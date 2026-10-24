import { message as localizedMessage } from "../../localization/runtime";
import { useInspectionStore } from "../context";
import { torrentRemovalActive, torrentRemovalLabel } from "../format";
import type { TorrentRow, TorrentStatus as Status } from "../model";
import { seedLimitReached } from "../seed-stop";
import styles from "./TorrentTable.module.css";

const STATUS_LABELS: Record<Status, () => string> = {
  metadata: () => localizedMessage("inspection.components.torrent.status.getting.info"),
  downloading: () => localizedMessage("inspection.components.torrent.status.downloading"),
  paused: () => localizedMessage("inspection.components.torrent.status.paused"),
  complete: () => localizedMessage("inspection.components.torrent.status.complete"),
  checking: () => localizedMessage("inspection.components.torrent.status.checking"),
  error: () => localizedMessage("inspection.components.torrent.status.error"),
};

export function TorrentStatus({
  row,
  label = STATUS_LABELS[row.status](),
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
        : seedLimitReached(row)
          ? localizedMessage("inspection.components.torrent.status.seed.limit.reached")
          : label);
  const status = torrentRemovalActive(row)
    ? "removing"
    : row.removalState === "failed"
      ? "error"
      : row.status;

  if (row.error === null) {
    return (
      <span className={styles.status} data-status={status} title={statusLabel}>
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
