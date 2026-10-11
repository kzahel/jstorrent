// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStore } from "zustand";

import type { TrackerRow } from "../model";
import { createInspectionStore, type InspectionStore } from "../state";
import { TrackerTable } from "./TrackerTable";

const store = createInspectionStore(null);
vi.mock("../context", () => ({
  useInspectionStore: <T,>(selector: (state: InspectionStore) => T) => useStore(store, selector),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("counts down on a monotonic clock through refreshes, wall-clock jumps and expiry", () => {
  vi.useFakeTimers();
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const row: TrackerRow = {
    id: "000000:000000", torrentId: "fixture", url: "udp://tracker.example:6969",
    transport: "udp", security: "unencrypted", source: "magnet", tier: 0,
    status: "retry_wait", announceEvent: null, totalAttempts: 1, consecutiveFailures: 1,
    lastConnectionFamily: null, lastPeerCount: null, seeders: null, leechers: null,
    intervalSeconds: null, nextAction: "retry", nextActionAtMs: 17_000,
    lastSuccessAtMs: null, lastFailureAtMs: 0, error: "temporary timeout",
  };
  const setRow = (value: TrackerRow) => store.setState({
    trackersByTorrent: { fixture: {
      state: "available", page: { offset: 0, limit: 1024, total: 1, nextOffset: null },
      order: [value.id], rows: { [value.id]: value },
    } },
  });
  setRow(row);
  render(<TrackerTable torrentId="fixture" />);
  expect(screen.getByText("Retry in 17s")).toBeInTheDocument();
  clock.mockReturnValue(5000);
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByText("Retry in 12s")).toBeInTheDocument();
  vi.setSystemTime(new Date("2050-01-01"));
  act(() => setRow({ ...row }));
  expect(screen.getByText("Retry in 12s")).toBeInTheDocument();
  clock.mockReturnValue(20_000);
  act(() => vi.advanceTimersByTime(15_000));
  expect(screen.getByText("Retry in 0s")).toBeInTheDocument();
  act(() => setRow({ ...row, status: "announcing", nextAction: null, nextActionAtMs: null }));
  expect(screen.getByText("Now")).toBeInTheDocument();
  act(() => setRow({ ...row, status: "inactive", nextAction: null, nextActionAtMs: null }));
  expect(screen.queryByText(/Retry in/)).not.toBeInTheDocument();
});
