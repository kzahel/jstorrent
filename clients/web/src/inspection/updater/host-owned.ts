import { installPolicy } from "./policy";
import type { HostUpdateRequest, HostUpdateSnapshot } from "../../api";
import type { CheckReason, DesktopReleaseInfo, DesktopUpdater, DesktopUpdaterSnapshot, UpdateChannel, UpdaterState } from "./types";

type Request = (request: HostUpdateRequest) => Promise<HostUpdateSnapshot>;

/** A view of the host updater; never schedules a check, download or restart. */
export class HostOwnedUpdater implements DesktopUpdater {
  private snapshot: DesktopUpdaterSnapshot;
  private listeners = new Set<() => void>();
  private closed = false;
  private manualCheck = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  constructor(private readonly request: Request, info: DesktopReleaseInfo, private readonly onClose?: () => void) {
    this.snapshot = { info, state: { phase: "idle" } };
    void this.poll();
  }
  setInfo(info: DesktopReleaseInfo): void {
    if (this.closed) return;
    if (info.version !== this.snapshot.info.version) this.manualCheck = false;
    this.snapshot = { ...this.snapshot, info: { ...info, bundleType: this.snapshot.info.bundleType } };
    for (const listener of this.listeners) listener();
  }
  async check(reason: CheckReason = "manual"): Promise<void> {
    this.manualCheck = reason === "manual";
    this.snapshot = { ...this.snapshot, state: { phase: "checking", reason } };
    for (const listener of this.listeners) listener();
    await this.send({ action: "check" }, false);
  }
  async install(): Promise<void> { await this.send({ action: "install" }); }
  async selectChannel(channel: UpdateChannel): Promise<void> { await this.send({ action: "select_channel", channel }); }
  async setAutomaticUpdates(enabled: boolean): Promise<void> { await this.send({ action: "set_automatic", enabled }); }
  dismiss(): void { void this.send({ action: "snooze" }).catch(() => {}); }
  close(): void { if (this.closed) return; this.closed = true; clearTimeout(this.timer); this.onClose?.(); this.listeners.clear(); }

  private async send(request: HostUpdateRequest, accept = true): Promise<void> {
    try {
      const result = await this.request(request);
      if (!this.closed && accept) this.accept(result);
    } catch (error) {
      if (request.action === "status" || request.action === "activity") throw error;
      if (this.closed) return;
      this.snapshot = { ...this.snapshot, state: { phase: "error", operation: "install", message: error instanceof Error ? error.message : "Update request failed" } };
      for (const listener of this.listeners) listener();
    }
  }
  private async poll(): Promise<void> {
    try { await this.send({ action: "status" }); } catch { /* Existing connection UI owns reconnect; keep last authoritative state. */ }
    if (!this.closed) this.timer = setTimeout(() => void this.poll(), 1000);
  }
  private accept(result: HostUpdateSnapshot): void {
    const version = result.version ?? "";
    const bundleType = ["app", "nsis", "appimage", "msi", "deb", "rpm"].includes(result.package) ? result.package as DesktopReleaseInfo["bundleType"] : "unknown";
    let state: UpdaterState;
    switch (result.phase) {
      case "manual-install": state = { phase: "manual-install", packageLabel: installPolicy(bundleType).packageLabel }; break;
      case "checking": state = { phase: "checking", reason: this.manualCheck ? "manual" : "periodic" }; break;
      case "up-to-date": state = this.manualCheck ? { phase: "up-to-date", reason: "manual" } : { phase: "idle", lastReason: "periodic" }; break;
      case "waiting-for-stable": state = { phase: "waiting-for-stable" }; break;
      case "available": state = { phase: "available", version, reason: this.manualCheck ? "manual" : "periodic", ...(result.notes === null ? {} : { notes: result.notes }) }; break;
      case "downloading": state = { phase: "downloading", version, downloadedBytes: result.downloadedBytes, ...(result.totalBytes === null ? {} : { totalBytes: result.totalBytes }) }; break;
      case "installing": state = { phase: "installing", version }; break;
      case "incompatible":
      case "error": state = { phase: "error", operation: "install", message: result.message ?? "Update failed", ...(version ? { version } : {}) }; break;
      default: state = { phase: "idle" };
    }
    this.snapshot = { ...this.snapshot, info: { ...this.snapshot.info, bundleType }, state, channel: result.channel === "latest" ? "latest" : "stable", automaticUpdates: result.automaticInstall, automaticAvailable: result.automaticAvailable, updateMessage: result.message ?? undefined, lastOutcome: result.lastOutcome ?? undefined, restartInSeconds: result.restartInSeconds ?? undefined };
    for (const listener of this.listeners) listener();
    if (["available", "up-to-date", "error", "incompatible", "waiting-for-stable"].includes(result.phase)) this.manualCheck = false;
  }
}

/** Coarse activity only; no input content or machine-wide idle observation. */
export function reportUpdateActivity(request: Request): (() => void) & { refresh(): void } {
  let interacted = false;
  let inFlight = false;
  let closed = false;
  let lastInputReport = Number.NEGATIVE_INFINITY;
  let pending = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (closed || flushTimer !== undefined) return;
    flushTimer = setTimeout(() => { flushTimer = undefined; void send(); }, Math.max(0, 1000 - (performance.now() - lastInputReport)));
  };
  let lastBlocked = false;
  const send = async () => {
    if (closed) return;
    if (inFlight) { pending = true; return; }
    inFlight = true;
    pending = false;
    const input = interacted;
    if (input) lastInputReport = performance.now();
    interacted = false;
    const blocked = document.querySelector('[role="dialog"]:not([data-update-safe]), [data-update-blocker]') !== null;
    lastBlocked = blocked;
    try { await request({ action: "activity", interacted: input, blocked }); }
    catch { interacted ||= input; }
    finally { inFlight = false; if (pending) schedule(); }
  };
  const input = () => {
    interacted = true;
    schedule();
  };
  const events = ["pointerdown", "keydown", "wheel", "focus"] as const;
  for (const event of events) window.addEventListener(event, input, true);
  const timer = setInterval(() => void send(), 15_000);
  const observer = new MutationObserver(() => {
    const blocked = document.querySelector('[role="dialog"]:not([data-update-safe]), [data-update-blocker]') !== null;
    if (blocked !== lastBlocked) void send();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role", "data-update-blocker", "data-update-safe"] });
  void send();
  const close = () => { closed = true; clearInterval(timer); clearTimeout(flushTimer); observer.disconnect(); for (const event of events) window.removeEventListener(event, input, true); };
  return Object.assign(close, { refresh: () => { void send(); } });
}
