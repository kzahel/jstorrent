import type { DataUnits } from "./appearance";
import { formatBytes } from "./format";
import type { SessionSummary } from "./model";

export const APPLICATION_TITLE = "JSTorrent";
export const TITLE_UPDATE_INTERVAL_MILLIS = 1_000;

export class DocumentTitleThrottle {
  private appliedTitle: string;
  private lastAppliedAt: number | null = null;
  private pendingTitle: string | null = null;
  private timer: ReturnType<typeof globalThis.setTimeout> | null = null;

  constructor(
    private readonly apply: (title: string) => void,
    initialTitle = APPLICATION_TITLE,
  ) {
    this.appliedTitle = initialTitle;
  }

  update(title: string): void {
    if (title === this.appliedTitle) {
      this.clearPending();
      return;
    }
    if (title === this.pendingTitle) return;

    const now = performance.now();
    const elapsed =
      this.lastAppliedAt === null
        ? TITLE_UPDATE_INTERVAL_MILLIS
        : now - this.lastAppliedAt;
    if (elapsed >= TITLE_UPDATE_INTERVAL_MILLIS) {
      this.applyNow(title, now);
      return;
    }

    this.pendingTitle = title;
    if (this.timer === null) {
      this.timer = globalThis.setTimeout(
        () => this.flush(),
        TITLE_UPDATE_INTERVAL_MILLIS - elapsed,
      );
    }
  }

  dispose(resetTitle = APPLICATION_TITLE): void {
    this.clearPending();
    if (this.appliedTitle !== resetTitle) {
      this.apply(resetTitle);
      this.appliedTitle = resetTitle;
    }
  }

  private flush(): void {
    this.timer = null;
    if (this.pendingTitle === null) return;

    const now = performance.now();
    const elapsed = now - (this.lastAppliedAt ?? now);
    if (elapsed < TITLE_UPDATE_INTERVAL_MILLIS) {
      this.timer = globalThis.setTimeout(
        () => this.flush(),
        TITLE_UPDATE_INTERVAL_MILLIS - elapsed,
      );
      return;
    }

    const title = this.pendingTitle;
    this.pendingTitle = null;
    this.applyNow(title, now);
  }

  private applyNow(title: string, now: number): void {
    this.clearPending();
    this.apply(title);
    this.appliedTitle = title;
    this.lastAppliedAt = now;
  }

  private clearPending(): void {
    this.pendingTitle = null;
    if (this.timer !== null) {
      globalThis.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export function documentTitleForSession(
  session: SessionSummary,
  dataUnits: DataUnits,
): string {
  const connection = session.connection.type;
  if (connection !== "connected" && connection !== "demo") {
    return APPLICATION_TITLE;
  }
  const downloadRate = nonnegativeRate(session.downloadRate);
  const uploadRate = nullableNonnegativeRate(session.uploadRate);
  if (downloadRate === 0 && (uploadRate === null || uploadRate === 0)) {
    return APPLICATION_TITLE;
  }
  return (
    `${APPLICATION_TITLE} - ↓${titleRate(downloadRate, dataUnits)}` +
    ` ↑${titleRate(uploadRate, dataUnits)}`
  );
}

function titleRate(value: number | null, dataUnits: DataUnits): string {
  return value === null ? "—" : `${formatBytes(value, dataUnits)}/s`;
}

function nullableNonnegativeRate(value: number | null): number | null {
  return value === null ? null : nonnegativeRate(value);
}

function nonnegativeRate(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
