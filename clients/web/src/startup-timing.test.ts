import { describe, expect, it } from "vitest";

import { markStartup, startupTimings } from "./startup-timing";

function fakePerformance(now: () => number) {
  const marks = new Map<string, PerformanceEntry>();
  return {
    mark(name: string) {
      const entry = { name, startTime: now(), entryType: "mark" } as PerformanceEntry;
      marks.set(name, entry);
      return entry as PerformanceMark;
    },
    getEntriesByName(name: string) {
      const entry = marks.get(name);
      return entry === undefined ? [] : [entry];
    },
  };
}

describe("startup timing", () => {
  it("keeps the first mark of each phase and rounds it", () => {
    let clock = 12.4;
    const target = fakePerformance(() => clock);
    markStartup("entry", target);
    clock = 80.6;
    markStartup("entry", target);
    markStartup("hello", target);
    expect(startupTimings(target)).toEqual({ entry: 12, hello: 81 });
  });

  it("drops phases outside the startup bound", () => {
    const target = fakePerformance(() => 900_000);
    markStartup("first_library", target);
    expect(startupTimings(target)).toEqual({});
  });

  it("tolerates a missing or failing performance API", () => {
    expect(() => markStartup("entry", undefined)).not.toThrow();
    const failing = {
      mark() {
        throw new Error("unavailable");
      },
      getEntriesByName() {
        throw new Error("unavailable");
      },
    };
    expect(() => markStartup("entry", failing)).not.toThrow();
    expect(startupTimings(failing)).toEqual({});
  });
});
