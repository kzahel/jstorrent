import { installPolicy } from "./policy";
import { scheduleAutomaticChecks, type UpdaterTimers } from "./schedule";
import type {
  CheckReason,
  DesktopReleaseInfo,
  DesktopUpdateBackend,
  DesktopUpdater,
  DesktopUpdaterSnapshot,
  UpdateChannel,
  UpdateCandidate,
  UpdaterState,
} from "./types";

export const UPDATE_CHECK_TIMEOUT_MS = 20_000;
const MAX_RELEASE_NOTES_CHARS = 16_384;

export class DesktopUpdaterController implements DesktopUpdater {
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private snapshot: DesktopUpdaterSnapshot;
  private readonly listeners = new Set<() => void>();
  private candidate: UpdateCandidate | null = null;
  private activeCheck: Promise<void> | null = null;
  private disposeSchedule: () => void;
  private generation = 0;
  private closed = false;

  constructor(
    private readonly backend: DesktopUpdateBackend,
    info: DesktopReleaseInfo,
    private readonly timers: UpdaterTimers = globalThis,
    channel: UpdateChannel = "stable",
  ) {
    this.snapshot = { info, state: restingState(info), channel, selectingChannel: false };
    this.disposeSchedule = installPolicy(info.bundleType).canCheck ? scheduleAutomaticChecks(
      (reason) => void this.check(reason),
      timers,
      channel,
    ) : () => undefined;
  }

  async check(reason: CheckReason = "manual"): Promise<void> {
    if (this.closed || this.snapshot.selectingChannel || this.isInstalling()) return;
    if (this.activeCheck !== null) {
      await this.activeCheck;
      return;
    }
    const request = this.performCheck(reason);
    this.activeCheck = request;
    try {
      await request;
    } finally {
      if (this.activeCheck === request) this.activeCheck = null;
    }
  }

  async install(): Promise<void> {
    const candidate = this.candidate;
    if (this.closed) return;
    if (candidate === null) {
      await this.check("manual");
      return;
    }
    if (candidate.manualApply !== undefined) return;

    const version = candidate.version;
    let downloadedBytes = 0;
    let totalBytes: number | undefined;
    this.setState({ phase: "downloading", version, downloadedBytes });
    try {
      await candidate.downloadAndInstall((event) => {
        if (event.type === "started") {
          downloadedBytes = 0;
          totalBytes = event.contentLength;
          this.setState({
            phase: "downloading",
            version,
            downloadedBytes,
            ...(totalBytes === undefined ? {} : { totalBytes }),
          });
        } else if (event.type === "progress") {
          downloadedBytes += event.chunkLength;
          this.setState({
            phase: "downloading",
            version,
            downloadedBytes,
            ...(totalBytes === undefined ? {} : { totalBytes }),
          });
        } else {
          this.setState({ phase: "installing", version });
        }
      });
      this.setState({ phase: "installing", version });
      await this.backend.relaunch();
    } catch (error) {
      this.setState({
        phase: "error",
        operation: "install",
        message: errorMessage(error),
        version,
      });
    }
  }

  dismiss(): void {
    if (this.closed || this.isInstalling()) return;
    this.generation += 1;
    this.activeCheck = null;
    this.closeCandidate();
    this.setState(restingState(this.snapshot.info));
  }

  async selectChannel(channel: UpdateChannel): Promise<void> {
    if (!installPolicy(this.snapshot.info.bundleType).canCheck) return;
    if (this.closed || this.isInstalling() || this.snapshot.selectingChannel || !this.backend.selectChannel || channel === this.snapshot.channel) return;
    const generation = ++this.generation;
    this.activeCheck = null;
    this.closeCandidate();
    this.snapshot = { ...this.snapshot, selectingChannel: true, state: { phase: "idle" } };
    this.emit();
    try {
      await this.backend.selectChannel(channel);
      if (this.closed || generation !== this.generation) return;
      this.disposeSchedule();
      this.disposeSchedule = scheduleAutomaticChecks((reason) => void this.check(reason), this.timers, channel);
      this.snapshot = { ...this.snapshot, channel, selectingChannel: false };
      this.emit();
      await this.check("manual");
    } catch (error) {
      if (this.closed || generation !== this.generation) return;
      this.snapshot = { ...this.snapshot, selectingChannel: false };
      this.setState({ phase: "error", operation: "check", message: errorMessage(error) });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    this.disposeSchedule();
    this.closeCandidate();
    this.listeners.clear();
  }

  private async performCheck(reason: CheckReason): Promise<void> {
    const generation = ++this.generation;
    const policy = installPolicy(this.snapshot.info.bundleType);
    if (!policy.canCheck) {
      if (reason === "manual") {
        this.setState({
          phase: "manual-install",
          packageLabel: policy.packageLabel,
        });
      }
      return;
    }
    if (reason !== "manual" && this.candidate !== null) return;
    if (reason === "manual") this.setState({ phase: "checking", reason });

    try {
      if (reason === "manual") this.closeCandidate();
      const candidate = await this.backend.check(
        reason,
        UPDATE_CHECK_TIMEOUT_MS,
      );
      if (this.closed || generation !== this.generation) {
        if (candidate !== null && !("waitingForStable" in candidate)) void candidate.close().catch(console.error);
        return;
      }
      if (candidate !== null && "waitingForStable" in candidate) {
        this.setState({ phase: "waiting-for-stable" });
        return;
      }
      if (candidate === null) {
        this.setState(
          reason === "manual"
            ? { phase: "up-to-date", reason }
            : { phase: "idle", lastReason: reason },
        );
        return;
      }
      this.candidate = candidate;
      this.setState({
        phase: "available",
        version: candidate.version,
        ...(candidate.notes === undefined
          ? {}
          : { notes: boundedReleaseNotes(candidate.notes) }),
        ...(candidate.manualApply === undefined
          ? {}
          : { manualApply: candidate.manualApply }),
        reason,
      });
    } catch (error) {
      if (this.closed || generation !== this.generation) return;
      if (reason === "manual") {
        this.setState({
          phase: "error",
          operation: "check",
          message: errorMessage(error),
        });
      } else {
        console.error(`Automatic ${reason} update check failed:`, error);
      }
    }
  }

  private closeCandidate(): void {
    const candidate = this.candidate;
    this.candidate = null;
    if (candidate !== null) void candidate.close().catch(console.error);
  }

  private setState(state: UpdaterState): void {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, state };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private isInstalling(): boolean {
    return this.snapshot.state.phase === "downloading" || this.snapshot.state.phase === "installing";
  }
}

function restingState(info: DesktopReleaseInfo): UpdaterState {
  const policy = installPolicy(info.bundleType);
  return policy.canCheck
    ? { phase: "idle" }
    : { phase: "manual-install", packageLabel: policy.packageLabel };
}

export function progressPercent(state: UpdaterState): number | undefined {
  if (
    state.phase !== "downloading" ||
    state.totalBytes === undefined ||
    state.totalBytes <= 0
  ) {
    return undefined;
  }
  return Math.min(
    100,
    Math.round((state.downloadedBytes / state.totalBytes) * 100),
  );
}

function boundedReleaseNotes(notes: string): string {
  return notes.length <= MAX_RELEASE_NOTES_CHARS
    ? notes
    : `${notes.slice(0, MAX_RELEASE_NOTES_CHARS)}\n…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
