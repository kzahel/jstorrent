import { describe, expect, it } from "vitest";

import {
  SHARE_PREFERENCES_STORAGE_KEY,
  loadPeerHintPreference,
  savePeerHintPreference,
} from "./share-preferences";

class MemoryStorage {
  readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota");
    this.values.set(key, value);
  }
}

describe("peer hint preference", () => {
  it("asks by default and round-trips each choice", () => {
    const storage = new MemoryStorage();
    expect(loadPeerHintPreference(storage)).toBe("ask");
    for (const choice of ["include", "omit", "ask"] as const) {
      savePeerHintPreference(choice, storage);
      expect(loadPeerHintPreference(storage)).toBe(choice);
    }
    expect(
      JSON.parse(storage.values.get(SHARE_PREFERENCES_STORAGE_KEY)!),
    ).toEqual({ version: 1, peerHint: "ask" });
  });

  it("reads unknown, newer or malformed records as ask without rewriting them", () => {
    const storage = new MemoryStorage();
    for (const record of [
      JSON.stringify({ version: 1, peerHint: "always" }),
      JSON.stringify({ version: 2, peerHint: "include" }),
      "{not json",
    ]) {
      storage.values.set(SHARE_PREFERENCES_STORAGE_KEY, record);
      expect(loadPeerHintPreference(storage)).toBe("ask");
      expect(storage.values.get(SHARE_PREFERENCES_STORAGE_KEY)).toBe(record);
    }
  });

  it("tolerates missing or failing storage", () => {
    expect(loadPeerHintPreference(null)).toBe("ask");
    expect(() => savePeerHintPreference("include", null)).not.toThrow();
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(() => savePeerHintPreference("include", storage)).not.toThrow();
    expect(loadPeerHintPreference(storage)).toBe("ask");
  });
});
