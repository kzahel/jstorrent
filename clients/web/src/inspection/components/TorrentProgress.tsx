import {
  checkingStatusLabel,
  formatProgress,
  torrentProgressSortValue,
  torrentRemovalActive,
  torrentRemovalLabel,
  torrentVisibleProgress,
} from "../format";
import type { TorrentRow } from "../model";
import styles from "./TorrentTable.module.css";

export { torrentProgressSortValue };

export function TorrentProgress({ row }: { readonly row: TorrentRow }) {
  if (torrentRemovalActive(row)) {
    const label = torrentRemovalLabel(row)!;
    return (
      <span className={styles.progressCell}>
        <span className={styles.progressLabel} />
        <span
          className={styles.progressTrack}
          data-indeterminate
          role="progressbar"
          aria-label={`${row.name}: ${label}`}
        />
      </span>
    );
  }
  const checking = row.status === "checking";
  const progress = torrentVisibleProgress(row);
  if (!checking && progress === null) return <span>—</span>;
  const label = checking ? checkingStatusLabel(row) : formatProgress(row.progress);
  const indeterminate = checking && progress === null;

  return (
    <span className={styles.progressCell}>
      <span className={styles.progressLabel}>{label}</span>
      <span
        className={styles.progressTrack}
        data-indeterminate={indeterminate || undefined}
        role="progressbar"
        aria-label={
          checking
            ? `${row.name} checking progress: ${label}`
            : `${row.name} download progress: ${label}`
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
      >
        {progress === null ? null : (
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        )}
      </span>
    </span>
  );
}
