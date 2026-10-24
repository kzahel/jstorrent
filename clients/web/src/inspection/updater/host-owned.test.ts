// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { HostOwnedUpdater, reportUpdateActivity } from "./host-owned";
import type { HostUpdateSnapshot } from "../../api";

const status: HostUpdateSnapshot = { phase: "available", version: "0.3.2", notes: null, message: "Downloaded; waiting until you're away", lastOutcome: null, downloadedBytes: 4, totalBytes: 4, restartInSeconds: 60, automaticInstall: true, automaticAvailable: true, channel: "stable", canInstall: true, package: "app" };
let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; document.body.innerHTML = ""; vi.useRealTimers(); });

it("presents native progress/countdown without scheduling checks and closes its poll", async () => {
  vi.useFakeTimers();
  const request = vi.fn(async (_request: import("../../api").HostUpdateRequest) => status);
  const updater = new HostOwnedUpdater(request, { version: "0.3.1", buildId: "build", target: "darwin", arch: "aarch64", bundleType: "app" });
  stop = () => updater.close();
  await vi.advanceTimersByTimeAsync(5000);
  expect(request.mock.calls.every(([call]) => call.action === "status")).toBe(true);
  expect(updater.getSnapshot()).toMatchObject({ restartInSeconds: 60, automaticUpdates: true, state: { phase: "available", version: "0.3.2" } });
  updater.close();
  const count = request.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(count);
});

it("routes manual install, opt-out, channel changes and Later to the same host owner", async () => {
  vi.useFakeTimers();
  const request = vi.fn(async (_request: unknown) => status);
  const updater = new HostOwnedUpdater(request, { version: "0.3.1", buildId: "build", target: "darwin", arch: "aarch64", bundleType: "app" });
  stop = () => updater.close();
  await updater.install();
  await updater.setAutomaticUpdates(false);
  await updater.selectChannel("latest");
  updater.dismiss();
  expect(request.mock.calls.map(([call]) => call)).toEqual([{ action: "status" }, { action: "install" }, { action: "set_automatic", enabled: false }, { action: "select_channel", channel: "latest" }, { action: "snooze" }]);
});

it("sends coarse interaction and blockers without sending input contents", async () => {
  vi.useFakeTimers();
  const request = vi.fn(async (_request: unknown) => status);
  stop = reportUpdateActivity(request);
  await vi.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "private text" }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(request.mock.calls.at(-1)?.[0]).toEqual({ action: "activity", interacted: true, blocked: false });
  document.body.innerHTML = '<div role="dialog">unfinished settings</div>';
  await vi.advanceTimersByTimeAsync(0);
  expect(request.mock.calls.at(-1)?.[0]).toEqual({ action: "activity", interacted: false, blocked: true });
  const count = request.mock.calls.length;
  stop();
  window.dispatchEvent(new KeyboardEvent("keydown"));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(request).toHaveBeenCalledTimes(count);
});

it("keeps background checks from opening the manual-update settings flow", async () => {
  vi.useFakeTimers();
  let phase = "checking";
  const updater = new HostOwnedUpdater(async () => ({ ...status, phase }), { version: "0.3.1", buildId: "build", target: "darwin", arch: "aarch64", bundleType: "app" });
  stop = () => updater.close();
  await vi.advanceTimersByTimeAsync(0);
  expect(updater.getSnapshot().state).toEqual({ phase: "checking", reason: "periodic" });
  phase = "up-to-date";
  await vi.advanceTimersByTimeAsync(1000);
  expect(updater.getSnapshot().state).toEqual({ phase: "idle", lastReason: "periodic" });
});

it("reports the first input immediately even just after an idle heartbeat", async () => {
  vi.useFakeTimers();
  const request = vi.fn(async (_request: unknown) => status);
  stop = reportUpdateActivity(request);
  await vi.advanceTimersByTimeAsync(15_000);
  window.dispatchEvent(new KeyboardEvent("keydown"));
  await vi.advanceTimersByTimeAsync(0);
  expect(request.mock.calls.at(-1)?.[0]).toEqual({ action: "activity", interacted: true, blocked: false });
});

it("allows clean About while retaining nested unfinished dialogs as blockers", async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<section role="dialog" data-update-safe="true">About</section>';
  const request = vi.fn(async (_request: unknown) => status);
  stop = reportUpdateActivity(request);
  await vi.advanceTimersByTimeAsync(0);
  expect(request.mock.calls.at(-1)?.[0]).toEqual({ action: "activity", interacted: false, blocked: false });
  document.querySelector("section")!.innerHTML = '<div role="dialog">Draft</div>';
  await vi.advanceTimersByTimeAsync(0);
  expect(request.mock.calls.at(-1)?.[0]).toEqual({ action: "activity", interacted: false, blocked: true });
});

it("does not delay interaction after the client wall clock moves backwards", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  const request = vi.fn(async (_request: unknown) => status);
  stop = reportUpdateActivity(request);
  window.dispatchEvent(new KeyboardEvent("keydown"));
  await vi.advanceTimersByTimeAsync(0);
  expect(request.mock.calls.at(-1)?.[0]).toEqual({ action: "activity", interacted: true, blocked: false });
  const count = request.mock.calls.length;
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  window.dispatchEvent(new KeyboardEvent("keydown"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(request.mock.calls.length).toBeGreaterThan(count);
  expect(request.mock.calls.at(-1)?.[0]).toEqual({ action: "activity", interacted: true, blocked: false });
});

it("replaces host version facts after reconnect without scheduling a check", async () => {
  vi.useFakeTimers();
  const request = vi.fn(async () => status);
  const updater = new HostOwnedUpdater(request, { version: "0.3.1", buildId: "a", target: "darwin", arch: "aarch64", bundleType: "app" });
  stop = () => updater.close();
  await vi.advanceTimersByTimeAsync(0);
  updater.setInfo({ version: "0.3.2", buildId: "b", target: "darwin", arch: "aarch64", bundleType: "unknown" });
  expect(updater.getSnapshot().info).toMatchObject({ version: "0.3.2", buildId: "b", bundleType: "app" });
  expect(request).toHaveBeenCalledTimes(1);
});
