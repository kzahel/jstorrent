import { describe, expect, it } from "vitest";

import type { TorrentRow } from "./model";
import {
  SEED_STOP_VALUE_MAXIMUM,
  durationLabel,
  durationLimitDraft,
  durationParts,
  ratioLimitDraft,
  ratioPercent,
  ratioText,
  sameDurationLimitDraft,
  sameRatioLimitDraft,
  seedLimitReached,
  seedStopSummary,
  validateDurationLimit,
  validateRatioLimit,
} from "./seed-stop";

describe("seeding stop limits", () => {
  it("round-trips ratio text and exact percent", () => {
    for (const percent of [0, 1, 5, 10, 100, 125, 150, 250, 1_001]) {
      expect(ratioPercent(ratioText(percent))).toBe(percent);
    }
    expect(ratioText(250)).toBe("2.5");
    expect(ratioText(205)).toBe("2.05");
    expect(ratioText(200)).toBe("2");
    expect(ratioPercent("2.555")).toBeNull();
    expect(ratioPercent("-1")).toBeNull();
    expect(ratioPercent("")).toBeNull();
    expect(ratioPercent("21474836.47")).toBe(SEED_STOP_VALUE_MAXIMUM);
    expect(ratioPercent("21474836.48")).toBeNull();
  });

  it("opens a stored time in the largest exact unit", () => {
    expect(durationParts(3_600)).toEqual({ value: "1", unit: "hours" });
    expect(durationParts(90_000)).toEqual({ value: "25", unit: "hours" });
    expect(durationParts(604_800)).toEqual({ value: "7", unit: "days" });
    expect(durationParts(5_400)).toEqual({ value: "90", unit: "minutes" });
    expect(durationParts(0)).toEqual({ value: "0", unit: "days" });
    expect(durationParts(3_601)).toEqual({ value: "3601", unit: "seconds" });
  });

  it("validates drafts into contract limits", () => {
    expect(validateRatioLimit({ mode: "off", ratio: "nonsense" })).toEqual({
      limit: { type: "off" },
      error: null,
    });
    expect(validateRatioLimit({ mode: "use_global", ratio: "" }).limit).toEqual({
      type: "use_global",
    });
    expect(validateRatioLimit({ mode: "limited", ratio: "1.5" }).limit).toEqual({
      type: "limited",
      value: 150,
    });
    expect(validateRatioLimit({ mode: "limited", ratio: "1.555" }).error).toMatch(
      /up to two decimals/,
    );
    expect(
      validateDurationLimit({ mode: "limited", value: "0", unit: "minutes" }).limit,
    ).toEqual({ type: "limited", value: 0 });
    expect(
      validateDurationLimit({ mode: "limited", value: "36", unit: "hours" }).limit,
    ).toEqual({ type: "limited", value: 129_600 });
    expect(
      validateDurationLimit({ mode: "limited", value: "1.5", unit: "hours" }).error,
    ).toMatch(/whole number/);
    expect(
      validateDurationLimit({ mode: "limited", value: "24856", unit: "days" }).error,
    ).not.toBeNull();
  });

  it("compares drafts by the limit they would save", () => {
    expect(
      sameDurationLimitDraft(
        { mode: "limited", value: "1", unit: "days" },
        { mode: "limited", value: "24", unit: "hours" },
      ),
    ).toBe(true);
    expect(
      sameDurationLimitDraft(
        { mode: "off", value: "1", unit: "days" },
        { mode: "off", value: "3", unit: "hours" },
      ),
    ).toBe(true);
    expect(
      sameRatioLimitDraft({ mode: "limited", ratio: "2" }, { mode: "limited", ratio: "2.00" }),
    ).toBe(true);
    expect(
      sameRatioLimitDraft({ mode: "limited", ratio: "2" }, { mode: "use_global", ratio: "2" }),
    ).toBe(false);
  });

  it("drafts from stored limits keep a usable custom starting value", () => {
    expect(ratioLimitDraft({ type: "off" })).toEqual({ mode: "off", ratio: "2" });
    expect(durationLimitDraft({ type: "use_global" })).toEqual({
      mode: "use_global",
      value: "1",
      unit: "days",
    });
  });

  it("labels durations plainly", () => {
    expect(durationLabel(3_600)).toBe("1 hour");
    expect(durationLabel(21_600)).toBe("6 hours");
    expect(durationLabel(604_800)).toBe("1 week");
    expect(durationLabel(2_592_000)).toBe("30 days");
    expect(durationLabel(5_400)).toBe("90 minutes");
    expect(durationLabel(0)).toBe("0 minutes");
  });

  it("summarizes effective limits with progress", () => {
    const settings = {
      seed_stop_ratio_percent: { type: "limited" as const, value: 200 },
      seed_stop_time_seconds: { type: "off" as const },
    };
    const base = {
      shareRatioHundredths: "142",
      finishedSeconds: "64800",
      operationalState: "seeding",
    } as TorrentRow;
    expect(seedStopSummary(base, settings)).toEqual([
      "Stops at ratio 2.00 · now 1.42",
    ]);
    expect(
      seedStopSummary(
        {
          ...base,
          seedStop: {
            limits: {
              ratio_percent: { type: "off" },
              time_seconds: { type: "limited", value: 86_400 },
            },
            stopped: false,
          },
        },
        settings,
      ),
    ).toEqual(["Stops after 1 day · seeded 18h 0m"]);
    expect(
      seedStopSummary(base, {
        seed_stop_ratio_percent: { type: "off" },
        seed_stop_time_seconds: { type: "off" },
      }),
    ).toEqual(["No stop limit"]);
  });

  it("reports a limit stop only while the torrent is paused", () => {
    const stop = {
      limits: {
        ratio_percent: { type: "limited" as const, value: 200 },
        time_seconds: { type: "use_global" as const },
      },
      stopped: true,
    };
    expect(
      seedLimitReached({ operationalState: "paused", seedStop: stop } as TorrentRow),
    ).toBe(true);
    expect(
      seedLimitReached({ operationalState: "seeding", seedStop: stop } as TorrentRow),
    ).toBe(false);
    expect(seedLimitReached({ operationalState: "paused" } as TorrentRow)).toBe(false);
  });
});
