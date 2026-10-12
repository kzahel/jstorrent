import { describe, expect, it } from "vitest";

import {
  checkingStatusLabel,
  etaAccessibleLabel,
  etaSortValue,
  formatBytes,
  formatEta,
  formatExactBytes,
  formatRate,
  torrentRemovalActive,
  torrentRemovalLabel,
  torrentVisibleProgress,
} from "./format";
import type { TorrentCheckingPhase, TorrentRow } from "./model";

describe("byte formatting", () => {
  it.each([
    [0, "0 B", "0 B"],
    [999, "999 B", "999 B"],
    [1_000, "1.0 kB", "1.0 kB"],
    [999_999, "1000 kB", "999 kB"],
    [1_000_000, "1.0 MB", "1.0 MB"],
    [1_000_000_000, "1.0 GB", "1.0 GB"],
    [1_000_000_000_000, "1.0 TB", "1.0 TB"],
    [1_000_000_000_000_000, "1.0 PB", "1.0 PB"],
  ])("formats %s bytes in decimal units", (value, numberText, exactText) => {
    expect(formatBytes(value, "decimal")).toBe(numberText);
    expect(formatExactBytes(String(value), "decimal")).toBe(exactText);
  });

  it.each([
    [0, "0 B", "0 B"],
    [1_023, "1023 B", "1023 B"],
    [1_024, "1.0 KiB", "1.0 KiB"],
    [1_048_575, "1024 KiB", "1023 KiB"],
    [1_048_576, "1.0 MiB", "1.0 MiB"],
    [1_073_741_824, "1.0 GiB", "1.0 GiB"],
    [1_099_511_627_776, "1.0 TiB", "1.0 TiB"],
    [1_125_899_906_842_624, "1.0 PiB", "1.0 PiB"],
  ])("formats %s bytes in binary units", (value, numberText, exactText) => {
    expect(formatBytes(value, "binary")).toBe(numberText);
    expect(formatExactBytes(String(value), "binary")).toBe(exactText);
  });

  it("retains unavailable and rate policy", () => {
    expect(formatBytes(null, "decimal")).toBe("—");
    expect(formatExactBytes("not-an-integer", "binary")).toBe("—");
    expect(formatRate(0, "decimal")).toBe("—");
    expect(formatRate(null, "binary")).toBe("—");
    expect(formatRate(1_000, "decimal")).toBe("1.0 kB/s");
    expect(formatRate(1_024, "binary")).toBe("1.0 KiB/s");
  });

  it("keeps exact integer inputs precise above Number.MAX_SAFE_INTEGER", () => {
    expect(formatExactBytes("9007199254740993", "decimal")).toBe("9.0 PB");
    expect(formatExactBytes("9007199254740993", "binary")).toBe("8.0 PiB");
    expect(formatExactBytes("999999999999999999999999", "decimal")).toBe(
      "999999999 PB",
    );
    expect(formatExactBytes("999999999999999999999999", "binary")).toBe(
      "888178419 PiB",
    );
  });
});

describe("ETA formatting", () => {
  it("formats every typed state with accessible meaning", () => {
    expect(formatEta({ state: "estimate", seconds: "252" })).toBe("4m 12s");
    expect(
      etaAccessibleLabel({ state: "estimate", seconds: "252" }),
    ).toBe("Estimated time remaining: 4m 12s");
    expect(formatEta({ state: "warming_up" })).toBe("—");
    expect(etaAccessibleLabel({ state: "warming_up" })).toBe(
      "Calculating ETA",
    );
    expect(formatEta({ state: "stalled" })).toBe("∞");
    expect(etaAccessibleLabel({ state: "stalled" })).toBe(
      "Transfer stalled",
    );
    expect(formatEta({ state: "unavailable" })).toBe("—");
    expect(etaAccessibleLabel({ state: "unavailable" })).toBe(
      "ETA unavailable",
    );
  });

  it("retains exact large durations for display and decimal sorting", () => {
    const eta = { state: "estimate", seconds: "9007199254740993" } as const;
    expect(formatEta({ state: "estimate", seconds: "90061" })).toBe("1d 1h");
    expect(formatEta(eta)).toBe("104249991374d 7h");
    expect(etaSortValue(eta)).toBe("9007199254740993");
    expect(etaSortValue({ state: "stalled" })).toBeNull();
    expect(formatEta({ state: "estimate", seconds: "invalid" })).toBe("—");
  });
});

describe("checker formatting", () => {
  const row = (phase: TorrentCheckingPhase): TorrentRow =>
    ({
      status: "checking",
      progress: 0.75,
      checking: {
        generation: "3",
        phase,
        piecesTotal: 8,
        piecesProcessed: 2,
        piecesMatched: 1,
        piecesAbsent: 1,
        piecesMismatched: 0,
        bytesHashed: "16384",
        activeHashJobs: phase === "hashing" ? 1 : 0,
        queuedHashJobs: 6,
        elapsedMs: 1_200,
        lastAdvanceAgeMs: 200,
        oldestActiveJobAgeMs: phase === "hashing" ? 600 : null,
      },
    }) as TorrentRow;

  it.each([
    ["queued", "Queued for checking"],
    ["preparing", "Preparing check"],
    ["reconciling_storage", "Updating file selection"],
    ["paused", "Checking paused"],
    ["finalizing", "Finalizing check"],
  ] as const)("keeps %s indeterminate and truthful", (phase, label) => {
    expect(checkingStatusLabel(row(phase))).toBe(label);
    expect(torrentVisibleProgress(row(phase))).toBeNull();
  });

  it("uses exact checker counters only while hashing", () => {
    expect(checkingStatusLabel(row("hashing"))).toBe("Checked 25.0%");
    expect(torrentVisibleProgress(row("hashing"))).toBe(0.25);
  });
});

describe("removal formatting", () => {
  const row = (removalState: TorrentRow["removalState"]): TorrentRow =>
    ({ status: "downloading", removalState }) as TorrentRow;

  it.each([
    ["pending", true, "Removing…"],
    ["awaiting_platform", true, "Removing…"],
    ["failed", false, "Removal failed"],
    [null, false, null],
  ] as const)("labels %s removals", (state, active, label) => {
    expect(torrentRemovalActive(row(state))).toBe(active);
    expect(torrentRemovalLabel(row(state))).toBe(label);
  });
});
