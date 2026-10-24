import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopUpdaterController, UPDATE_CHECK_TIMEOUT_MS } from "./controller";
import {
  LATEST_CHECK_INTERVAL_MS,
  PERIODIC_CHECK_INTERVAL_MS,
  STARTUP_CHECK_DELAY_MS,
} from "./schedule";
import type {
  CheckReason,
  DesktopReleaseInfo,
  DesktopUpdateBackend,
  UpdateCandidate,
  UpdateDownloadEvent,
} from "./types";

const info: DesktopReleaseInfo = {
  version: "0.1.0",
  buildId: "abcdef1234567890",
  target: "aarch64-apple-darwin",
  arch: "aarch64",
  bundleType: "app",
};

const controllers: DesktopUpdaterController[] = [];

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.close();
  vi.useRealTimers();
});

describe("desktop updater controller", () => {
  it("schedules startup and daily checks and stops with the product", async () => {
    vi.useFakeTimers();
    const backend = new RecordingBackend();
    const controller = createController(backend);

    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    expect(backend.checks).toEqual([
      { reason: "startup", timeoutMs: UPDATE_CHECK_TIMEOUT_MS },
    ]);
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_INTERVAL_MS);
    expect(backend.checks.at(-1)?.reason).toBe("periodic");

    controller.close();
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_INTERVAL_MS);
    expect(backend.checks).toHaveLength(2);
  });

  it("deduplicates concurrent checks", async () => {
    let finish: ((value: UpdateCandidate | null) => void) | undefined;
    const backend = new RecordingBackend(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = createController(backend);
    const first = controller.check("manual");
    const second = controller.check("periodic");
    expect(backend.checks).toHaveLength(1);
    finish?.(null);
    await Promise.all([first, second]);
    expect(controller.getSnapshot().state.phase).toBe("up-to-date");
  });

  it("downloads, installs, and relaunches only after success", async () => {
    const candidate = new RecordingCandidate("0.1.1", "A useful beta update.");
    const backend = new RecordingBackend(async () => candidate);
    const controller = createController(backend);

    await controller.check("manual");
    expect(controller.getSnapshot().state).toEqual({
      phase: "available",
      version: "0.1.1",
      notes: "A useful beta update.",
      reason: "manual",
    });
    await controller.install();
    expect(candidate.installs).toBe(1);
    expect(backend.relaunches).toBe(1);
    expect(controller.getSnapshot().state).toEqual({
      phase: "installing",
      version: "0.1.1",
    });
  });

  it("shows package-channel guidance instead of self-replacing MSI", async () => {
    const backend = new RecordingBackend();
    const controller = createController(backend, { ...info, bundleType: "msi" });
    await controller.check("manual");
    expect(controller.getSnapshot().state).toEqual({
      phase: "manual-install",
      packageLabel: "Windows MSI",
    });
    expect(backend.checks).toHaveLength(0);
  });

  it.each([
    ["msi", "Windows MSI"],
    ["deb", "Linux DEB package"],
    ["rpm", "Linux RPM package"],
    ["unknown", "development build"],
  ] as const)("%s starts and stays managed without timers or backend calls", async (bundleType, packageLabel) => {
    vi.useFakeTimers();
    const backend = new RecordingBackend();
    const channel = vi.spyOn(backend, "selectChannel");
    const controller = createController(backend, { ...info, bundleType });
    const state = { phase: "manual-install", packageLabel };
    expect(controller.getSnapshot().state).toEqual(state);
    expect(vi.getTimerCount()).toBe(0);
    controller.dismiss();
    await controller.selectChannel("latest");
    await controller.check("startup");
    await controller.check("manual");
    await controller.install();
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_INTERVAL_MS);
    expect(controller.getSnapshot().state).toEqual(state);
    expect(backend.checks).toHaveLength(0);
    expect(channel).not.toHaveBeenCalled();
    expect(backend.relaunches).toBe(0);
    controller.close();
    controller.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps automatic failures quiet and exposes manual failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const backend = new RecordingBackend(async () => {
      throw new Error("update service unavailable");
    });
    const controller = createController(backend);

    await controller.check("startup");
    expect(controller.getSnapshot().state.phase).toBe("idle");
    expect(error).toHaveBeenCalledOnce();
    await controller.check("manual");
    expect(controller.getSnapshot().state).toEqual({
      phase: "error",
      operation: "check",
      message: "update service unavailable",
    });
    error.mockRestore();
  });

  it("invalidates an in-flight Stable candidate when Latest is selected", async () => {
    let finishStable: ((value: UpdateCandidate | null) => void) | undefined;
    const stale = new RecordingCandidate("0.1.5");
    const latest = new RecordingCandidate("0.2.101");
    const backend: DesktopUpdateBackend = {
      check: vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { finishStable = resolve; }))
        .mockResolvedValueOnce(latest),
      selectChannel: vi.fn(async () => undefined),
      relaunch: vi.fn(async () => undefined),
    };
    const controller = createController(backend);
    const pending = controller.check("manual");
    await controller.selectChannel("latest");
    finishStable?.(stale);
    await pending;
    expect(stale.closes).toBe(1);
    expect(controller.getSnapshot().channel).toBe("latest");
    expect(controller.getSnapshot().state).toMatchObject({ phase: "available", version: "0.2.101" });
  });

  it("reports waiting for Stable without offering a downgrade", async () => {
    const backend: DesktopUpdateBackend = {
      check: vi.fn().mockResolvedValue({ waitingForStable: true }),
      selectChannel: vi.fn(async () => undefined),
      relaunch: vi.fn(async () => undefined),
    };
    const controller = createController(backend);
    await controller.selectChannel("latest");
    await controller.selectChannel("stable");
    expect(controller.getSnapshot().state.phase).toBe("waiting-for-stable");
    await controller.install();
    expect(backend.relaunch).not.toHaveBeenCalled();
  });

  it("uses the shorter automatic check interval after selecting Latest", async () => {
    vi.useFakeTimers();
    const backend = new RecordingBackend();
    const controller = createController(backend);
    await controller.selectChannel("latest");
    const before = backend.checks.length;
    await vi.advanceTimersByTimeAsync(LATEST_CHECK_INTERVAL_MS);
    expect(backend.checks.slice(before).some((check) => check.reason === "periodic")).toBe(true);
  });
});

function createController(
  backend: DesktopUpdateBackend,
  releaseInfo: DesktopReleaseInfo = info,
): DesktopUpdaterController {
  const controller = new DesktopUpdaterController(backend, releaseInfo);
  controllers.push(controller);
  return controller;
}

class RecordingBackend implements DesktopUpdateBackend {
  readonly checks: { reason: CheckReason; timeoutMs: number }[] = [];
  relaunches = 0;

  constructor(
    private readonly result: () => Promise<UpdateCandidate | null> = async () => null,
  ) {}

  async check(reason: CheckReason, timeoutMs: number) {
    this.checks.push({ reason, timeoutMs });
    return this.result();
  }

  async relaunch() {
    this.relaunches += 1;
  }

  async selectChannel() {
    return;
  }
}

class RecordingCandidate implements UpdateCandidate {
  installs = 0;
  closes = 0;
  readonly notes?: string;

  constructor(
    readonly version: string,
    notes?: string,
  ) {
    if (notes !== undefined) this.notes = notes;
  }

  async downloadAndInstall(
    onEvent: (event: UpdateDownloadEvent) => void,
  ) {
    this.installs += 1;
    onEvent({ type: "started", contentLength: 100 });
    onEvent({ type: "progress", chunkLength: 100 });
    onEvent({ type: "finished" });
  }

  async close() {
    this.closes += 1;
  }
}
