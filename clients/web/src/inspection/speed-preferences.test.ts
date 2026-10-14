import { describe, expect, it } from "vitest";

import {
  DEFAULT_SPEED_METRICS,
  DEFAULT_SPEED_RANGE,
  isDefaultSpeedPreferences,
  loadSpeedPreferences,
  saveSpeedPreferences,
} from "./speed-preferences";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("speed presentation preferences", () => {
  it("round-trips a bounded range and series selection", () => {
    const storage = new MemoryStorage();
    saveSpeedPreferences(
      { range: "days30", metrics: ["payload_uploaded", "dht_received"] },
      storage,
    );
    expect(loadSpeedPreferences(storage)).toEqual({
      range: "days30",
      metrics: ["payload_uploaded", "dht_received"],
    });
  });

  it("defaults to download and upload, replacing version 1 selections", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "rstorrent.presentation.speed",
      JSON.stringify({
        version: 1,
        range: "minutes2",
        metrics: ["payload_received", "staged_write", "payload_verified"],
      }),
    );
    const loaded = loadSpeedPreferences(storage);
    expect(loaded).toEqual({
      range: "seconds30",
      metrics: ["payload_received", "payload_uploaded"],
    });
    expect(isDefaultSpeedPreferences(loaded)).toBe(true);
    expect(
      isDefaultSpeedPreferences({ ...loaded, range: "minutes2" }),
    ).toBe(false);
    expect(
      isDefaultSpeedPreferences({ ...loaded, metrics: ["payload_received"] }),
    ).toBe(false);
  });

  it("falls back when stored selections are unavailable or oversized", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "rstorrent.presentation.speed",
      JSON.stringify({
        version: 2,
        range: "forever",
        metrics: [
          "payload_received",
          "staged_write",
          "payload_verified",
          "peer_wire_received",
          "peer_wire_sent",
          "peer_protocol_received",
          "peer_protocol_sent",
          "dht_received",
          "dht_sent",
        ],
      }),
    );
    expect(loadSpeedPreferences(storage)).toEqual({
      range: DEFAULT_SPEED_RANGE,
      metrics: DEFAULT_SPEED_METRICS,
    });
  });
});
