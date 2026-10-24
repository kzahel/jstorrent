import { message as localizedMessage } from "../localization/runtime";
import type { DataUnits } from "./appearance";
import type {
  TorrentCheckingProgress,
  TorrentEta,
  TorrentRow,
} from "./model";

const UNIT_SYSTEMS = {
  decimal: { base: 1000, suffixes: ["B", "kB", "MB", "GB", "TB", "PB"] },
  binary: { base: 1024, suffixes: ["B", "KB", "MB", "GB", "TB", "PB"] },
} as const satisfies Record<
  DataUnits,
  { readonly base: number; readonly suffixes: readonly string[] }
>;

export function formatBytes(
  value: number | null,
  dataUnits: DataUnits,
): string {
  if (value === null) return "—";
  if (value === 0) return "0 B";
  const { base, suffixes } = UNIT_SYSTEMS[dataUnits];
  const exponent = Math.min(
    Math.floor(Math.log(Math.abs(value)) / Math.log(base)),
    suffixes.length - 1,
  );
  const scaled = value / base ** exponent;
  return `${scaled >= 100 || exponent === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${suffixes[exponent]}`;
}

export function formatExactBytes(
  value: string | null,
  dataUnits: DataUnits,
): string {
  if (value === null) return "—";
  let bytes: bigint;
  try {
    bytes = BigInt(value);
  } catch {
    return "—";
  }
  if (bytes <= 0n) return "0 B";
  const { base, suffixes } = UNIT_SYSTEMS[dataUnits];
  const bigintBase = BigInt(base);
  let exponent = 0;
  let divisor = 1n;
  while (exponent < suffixes.length - 1 && bytes >= divisor * bigintBase) {
    exponent += 1;
    divisor *= bigintBase;
  }
  const whole = bytes / divisor;
  if (exponent === 0 || whole >= 100n) {
    return `${whole.toString()} ${suffixes[exponent]}`;
  }
  const tenth = ((bytes * 10n) / divisor) % 10n;
  return `${whole.toString()}.${tenth.toString()} ${suffixes[exponent]}`;
}

export function formatShareRatio(hundredths: string | null): string {
  if (hundredths === null) return "—";
  try {
    const value = BigInt(hundredths);
    if (value < 0n) return "—";
    return `${(value / 100n).toString()}.${(value % 100n).toString().padStart(2, "0")}`;
  } catch {
    return "—";
  }
}

export function formatElapsedSeconds(value: string): string {
  let seconds: bigint;
  try {
    seconds = BigInt(value);
  } catch {
    return "—";
  }
  if (seconds < 0n) return "—";
  const days = seconds / 86_400n;
  const hours = (seconds % 86_400n) / 3_600n;
  const minutes = (seconds % 3_600n) / 60n;
  const tail = seconds % 60n;
  if (days > 0n) return `${days.toString()}d ${hours.toString()}h`;
  if (hours > 0n) return `${hours.toString()}h ${minutes.toString()}m`;
  if (minutes > 0n) return `${minutes.toString()}m ${tail.toString()}s`;
  return `${tail.toString()}s`;
}

export function formatDecimalProgress(done: string, length: string): string {
  try {
    const doneBytes = BigInt(done);
    const lengthBytes = BigInt(length);
    if (lengthBytes === 0n) return "100%";
    const tenths = (doneBytes * 1_000n) / lengthBytes;
    return tenths >= 999n
      ? "100%"
      : `${(tenths / 10n).toString()}.${(tenths % 10n).toString()}%`;
  } catch {
    return "—";
  }
}

export function formatRate(value: number | null, dataUnits: DataUnits): string {
  return value === null || value <= 0
    ? "—"
    : `${formatBytes(value, dataUnits)}/s`;
}

export function formatProgress(value: number | null): string {
  if (value === null) return localizedMessage("inspection.format.getting.info");
  return `${(value * 100).toFixed(value >= 0.9995 ? 0 : 1)}%`;
}

export function checkingProgressRatio(
  checking: TorrentCheckingProgress | null,
): number | null {
  if (checking === null || checking.piecesTotal === 0) return null;
  return Math.min(1, checking.piecesProcessed / checking.piecesTotal);
}

export function torrentProgressSortValue(row: TorrentRow): number | null {
  return row.status === "checking"
    ? checkingProgressRatio(row.checking)
    : row.progress;
}

/** Removal is committed and still running in the engine or platform. */
export function torrentRemovalActive(row: TorrentRow): boolean {
  return row.removalState === "pending" || row.removalState === "awaiting_platform";
}

/** Status that replaces the transfer state while a torrent is being removed. */
export function torrentRemovalLabel(row: TorrentRow): string | null {
  if (torrentRemovalActive(row)) return localizedMessage("inspection.format.removing");
  if (row.removalState === "failed") return localizedMessage("inspection.format.removal.failed");
  return null;
}

export function torrentVisibleProgress(row: TorrentRow): number | null {
  return row.status === "checking" && row.checking?.phase !== "hashing"
    ? null
    : torrentProgressSortValue(row);
}

export function checkingStatusLabel(row: TorrentRow): string {
  if (row.status !== "checking") return formatProgress(row.progress);
  const checking = row.checking;
  if (checking === null) return localizedMessage("inspection.format.queued.for.checking");
  if (checking.phase === "hashing") {
    const ratio = checkingProgressRatio(checking);
    return ratio === null ? "Checking content" : `Checked ${formatProgress(ratio)}`;
  }
  switch (checking.phase) {
    case "queued":
      return localizedMessage("inspection.format.queued.for.checking");
    case "preparing":
      return localizedMessage("inspection.format.preparing.check");
    case "reconciling_storage":
      return localizedMessage("inspection.format.updating.file.selection");
    case "paused":
      return localizedMessage("inspection.format.checking.paused");
    case "finalizing":
      return localizedMessage("inspection.format.finalizing.check");
  }
}

export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "0 ms";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) {
    return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
  }
  return `${Math.floor(milliseconds / 60_000)}m ${Math.floor((milliseconds % 60_000) / 1_000)}s`;
}

export function formatEta(eta: TorrentEta): string {
  if (eta.state === "stalled") return "∞";
  const seconds = estimateSeconds(eta);
  if (seconds === null) return "—";
  if (seconds < 60n) return `${seconds.toString()}s`;
  if (seconds < 3_600n) {
    return `${(seconds / 60n).toString()}m ${(seconds % 60n).toString()}s`;
  }
  if (seconds < 86_400n) {
    return `${(seconds / 3_600n).toString()}h ${((seconds % 3_600n) / 60n).toString()}m`;
  }
  return `${(seconds / 86_400n).toString()}d ${((seconds % 86_400n) / 3_600n).toString()}h`;
}

export function etaAccessibleLabel(eta: TorrentEta): string {
  switch (eta.state) {
    case "estimate":
      return estimateSeconds(eta) === null
        ? "ETA unavailable"
        : `Estimated time remaining: ${formatEta(eta)}`;
    case "warming_up":
      return localizedMessage("inspection.format.calculating.eta");
    case "stalled":
      return localizedMessage("inspection.format.transfer.stalled");
    case "unavailable":
      return localizedMessage("inspection.format.eta.unavailable");
  }
}

export function etaSortValue(eta: TorrentEta): string | null {
  return estimateSeconds(eta) === null || eta.state !== "estimate"
    ? null
    : eta.seconds;
}

function estimateSeconds(eta: TorrentEta): bigint | null {
  if (eta.state !== "estimate") return null;
  try {
    const seconds = BigInt(eta.seconds);
    return seconds > 0n ? seconds : null;
  } catch {
    return null;
  }
}

export function formatClock(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatTime(milliseconds: number): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(milliseconds));
}
