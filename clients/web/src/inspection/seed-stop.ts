import { formatNumber, message as localizedMessage } from "../localization/runtime";
import type {
  ClientSettings,
  SeedStopLimit,
  TorrentSeedStopLimit,
  TorrentSeedStopLimits,
} from "../api";
import { formatElapsedSeconds, formatShareRatio } from "./format";
import type { TorrentRow } from "./model";

/** Largest stored ratio (percent) or time (seconds) the contract accepts. */
export const SEED_STOP_VALUE_MAXIMUM = 2_147_483_647;

/** Ratio presets in percent: 1.0, 1.5, 2.0, 3.0 and 5.0. */
export const RATIO_PRESETS_PERCENT = [100, 150, 200, 300, 500] as const;

/** Duration presets: 1 hour, 6 hours, 1 day, 3 days, 1 week and 30 days. */
export const DURATION_PRESETS_SECONDS = [
  3_600, 21_600, 86_400, 259_200, 604_800, 2_592_000,
] as const;

export type DurationUnit = "seconds" | "minutes" | "hours" | "days";

export const DURATION_UNIT_SECONDS: Readonly<Record<DurationUnit, number>> = {
  seconds: 1,
  minutes: 60,
  hours: 3_600,
  days: 86_400,
};

/** Use global exists only per torrent; goals have no Off. */
export type SeedStopMode = TorrentSeedStopLimit["type"];

/** A ratio limit edited as decimal ratio text, such as "2" or "2.5". */
export interface RatioLimitDraft {
  readonly mode: SeedStopMode;
  readonly ratio: string;
}

/** A duration edited as whole-number text in one unit. */
export interface DurationLimitDraft {
  readonly mode: SeedStopMode;
  readonly value: string;
  readonly unit: DurationUnit;
}

export interface SeedStopValidation {
  readonly limit: TorrentSeedStopLimit | null;
  readonly error: string | null;
}

const DEFAULT_RATIO_TEXT = "2";
const DEFAULT_DURATION_SECONDS = 86_400;

/** The ratio text for a stored percent: 250 is "2.5", 200 is "2". */
export function ratioText(percent: number): string {
  const whole = Math.floor(percent / 100);
  const fraction = percent % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

/** Exact percent for ratio text with up to two decimals, or null. */
export function ratioPercent(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (match === null) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const percent = whole * 100 + fraction;
  return Number.isSafeInteger(percent) && percent <= SEED_STOP_VALUE_MAXIMUM
    ? percent
    : null;
}

/** Whole seconds for a duration draft, or null when it is not valid. */
export function durationSeconds(value: string, unit: DurationUnit): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const seconds = Number(value.trim()) * DURATION_UNIT_SECONDS[unit];
  return Number.isSafeInteger(seconds) && seconds <= SEED_STOP_VALUE_MAXIMUM
    ? seconds
    : null;
}

/** The largest unit that divides the value exactly; seconds only as a fallback. */
export function durationParts(seconds: number): {
  readonly value: string;
  readonly unit: DurationUnit;
} {
  for (const unit of ["days", "hours", "minutes"] as const) {
    const size = DURATION_UNIT_SECONDS[unit];
    if (seconds % size === 0) return { value: String(seconds / size), unit };
  }
  return { value: String(seconds), unit: "seconds" };
}

export function ratioLimitDraft(limit: TorrentSeedStopLimit): RatioLimitDraft {
  return {
    mode: limit.type,
    ratio: limit.type === "limited" ? ratioText(limit.value) : DEFAULT_RATIO_TEXT,
  };
}

export function durationLimitDraft(limit: TorrentSeedStopLimit): DurationLimitDraft {
  return {
    mode: limit.type,
    ...durationParts(
      limit.type === "limited" ? limit.value : DEFAULT_DURATION_SECONDS,
    ),
  };
}

export function validateRatioLimit(draft: RatioLimitDraft): SeedStopValidation {
  if (draft.mode !== "limited") return { limit: { type: draft.mode }, error: null };
  const percent = ratioPercent(draft.ratio);
  return percent === null
    ? {
        limit: null,
        error: localizedMessage("inspection.seed.stop.ratio.range.error", {
          maximum: formatNumber(Math.floor(SEED_STOP_VALUE_MAXIMUM / 100)),
        }),
      }
    : { limit: { type: "limited", value: percent }, error: null };
}

export function validateDurationLimit(draft: DurationLimitDraft): SeedStopValidation {
  if (draft.mode !== "limited") return { limit: { type: draft.mode }, error: null };
  const seconds = durationSeconds(draft.value, draft.unit);
  return seconds === null
    ? {
        limit: null,
        error: localizedMessage("inspection.seed.stop.duration.range.error", {
          maximum: formatNumber(
            Math.floor(SEED_STOP_VALUE_MAXIMUM / DURATION_UNIT_SECONDS[draft.unit]),
          ),
        }),
      }
    : { limit: { type: "limited", value: seconds }, error: null };
}

/**
 * Drafts compare by the limit they would save, so "1 day" and "24 hours" are
 * the same, and invalid text compares as typed.
 */
export function sameRatioLimitDraft(left: RatioLimitDraft, right: RatioLimitDraft): boolean {
  if (left.mode !== right.mode) return false;
  if (left.mode !== "limited") return true;
  const leftPercent = ratioPercent(left.ratio);
  return leftPercent === null
    ? left.ratio === right.ratio
    : leftPercent === ratioPercent(right.ratio);
}

export function sameDurationLimitDraft(
  left: DurationLimitDraft,
  right: DurationLimitDraft,
): boolean {
  if (left.mode !== right.mode) return false;
  if (left.mode !== "limited") return true;
  const leftSeconds = durationSeconds(left.value, left.unit);
  return leftSeconds === null
    ? left.value === right.value && left.unit === right.unit
    : leftSeconds === durationSeconds(right.value, right.unit);
}

/** The session form never offers Use global, so it cannot reach this mapping. */
export function sessionSeedStopLimit(limit: TorrentSeedStopLimit): SeedStopLimit {
  return limit.type === "use_global" ? { type: "off" } : limit;
}

/** A preset label such as "2.0" or "1.5". */
export function ratioLabel(percent: number): string {
  return formatNumber(percent / 100, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
}

/** A readable duration such as "6 hours", "1 week" or "30 days". */
export function durationLabel(seconds: number): string {
  if (seconds > 0 && seconds % 604_800 === 0) {
    return localizedMessage("inspection.seed.stop.duration.weeks", {
      count: seconds / 604_800,
    });
  }
  if (seconds > 0 && seconds % 86_400 === 0) {
    return localizedMessage("inspection.seed.stop.duration.days", {
      count: seconds / 86_400,
    });
  }
  if (seconds > 0 && seconds % 3_600 === 0) {
    return localizedMessage("inspection.seed.stop.duration.hours", {
      count: seconds / 3_600,
    });
  }
  if (seconds % 60 === 0) {
    return localizedMessage("inspection.seed.stop.duration.minutes", {
      count: seconds / 60,
    });
  }
  return formatElapsedSeconds(String(seconds));
}

/** The session limit as one short label for "Use global (…)". */
/** The session limit as a torrent's "Use global" choice shows it. A session
 * limit that is off reads "No limit", like a torrent's own off choice. */
export function sessionRatioLabel(limit: SeedStopLimit): string {
  return limit.type === "off"
    ? localizedMessage("inspection.components.torrent.settings.dialog.no.limit")
    : ratioLabel(limit.value);
}

export function sessionDurationLabel(limit: SeedStopLimit): string {
  return limit.type === "off"
    ? localizedMessage("inspection.components.torrent.settings.dialog.no.limit")
    : durationLabel(limit.value);
}

const SESSION_LIMITS: TorrentSeedStopLimits = {
  ratio_percent: { type: "use_global" },
  time_seconds: { type: "use_global" },
};

/** A torrent's own limits; an absent stop view means both use the session limits. */
export function torrentSeedStopLimits(row: TorrentRow): TorrentSeedStopLimits {
  return row.seedStop?.limits ?? SESSION_LIMITS;
}

/** True when the torrent was paused because it reached a stop limit. */
export function seedLimitReached(row: TorrentRow): boolean {
  return row.seedStop?.stopped === true && row.operationalState === "paused";
}

export function effectiveSeedStopLimit(
  own: TorrentSeedStopLimit,
  session: SeedStopLimit,
): SeedStopLimit {
  return own.type === "use_global" ? session : own;
}

/**
 * One line per limit that applies, with progress, or one "No stop limit"
 * line when neither applies.
 */
export function seedStopSummary(
  row: TorrentRow,
  settings: Pick<ClientSettings, "seed_stop_ratio_percent" | "seed_stop_time_seconds">,
): readonly string[] {
  const own = torrentSeedStopLimits(row);
  const ratio = effectiveSeedStopLimit(own.ratio_percent, settings.seed_stop_ratio_percent);
  const time = effectiveSeedStopLimit(own.time_seconds, settings.seed_stop_time_seconds);
  const lines: string[] = [];
  if (ratio.type === "limited") {
    lines.push(
      localizedMessage("inspection.seed.stop.summary.ratio", {
        limit: formatShareRatio(String(ratio.value)),
        current: formatShareRatio(row.shareRatioHundredths),
      }),
    );
  }
  if (time.type === "limited") {
    lines.push(
      localizedMessage("inspection.seed.stop.summary.time", {
        limit: durationLabel(time.value),
        seeded: formatElapsedSeconds(row.finishedSeconds),
      }),
    );
  }
  return lines.length === 0
    ? [localizedMessage("inspection.seed.stop.summary.none")]
    : lines;
}
