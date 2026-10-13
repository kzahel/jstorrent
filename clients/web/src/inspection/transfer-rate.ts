import { message as localizedMessage } from "../localization/runtime";
import type { TransferRateLimit } from "../api";

export const RATE_LIMIT_MINIMUM_BYTES = 1_024;
export const RATE_LIMIT_MAXIMUM_BYTES = 4_294_967_295;
export const RATE_LIMIT_MAXIMUM_KB = Math.floor(RATE_LIMIT_MAXIMUM_BYTES / 1_024);

/** Preset limits in 1024-based KB/s, matching the original JSTorrent picker. */
export const RATE_LIMIT_PRESETS_KB = [100, 500, 1_024, 5_120, 10_240] as const;

export interface RateLimitValidation {
  readonly limit: TransferRateLimit | null;
  readonly error: string | null;
}

/** Draft rate values stay in exact KB/s text; one KB is 1024 bytes. */
export function validateRateLimit(
  unlimited: boolean,
  valueKiB: string,
): RateLimitValidation {
  if (unlimited) return { limit: { type: "unlimited" }, error: null };
  const bytesPerSecond = /^\d+(?:\.\d+)?$/.test(valueKiB)
    ? Number(valueKiB) * 1_024
    : Number.NaN;
  if (
    !Number.isSafeInteger(bytesPerSecond) ||
    bytesPerSecond < RATE_LIMIT_MINIMUM_BYTES ||
    bytesPerSecond > RATE_LIMIT_MAXIMUM_BYTES
  ) {
    return {
      limit: null,
      error: localizedMessage("inspection.transfer.rate.range.error", {
        maximum: RATE_LIMIT_MAXIMUM_KB,
      }),
    };
  }
  return {
    limit: { type: "limited", bytes_per_second: bytesPerSecond },
    error: null,
  };
}

export function rateLimitDraftValue(
  limit: TransferRateLimit,
  fallback: string,
): string {
  return limit.type === "limited"
    ? String(limit.bytes_per_second / 1_024)
    : fallback;
}

export function sameRateLimit(
  left: TransferRateLimit,
  right: TransferRateLimit,
): boolean {
  return (
    left.type === right.type &&
    (left.type === "unlimited" ||
      (right.type === "limited" &&
        left.bytes_per_second === right.bytes_per_second))
  );
}

/** The preset matching an exact draft value, or null for a custom value. */
export function rateLimitPreset(valueKiB: string): number | null {
  return RATE_LIMIT_PRESETS_KB.find((preset) => String(preset) === valueKiB) ?? null;
}

/** A rate in 1024-based KB/s or MB/s, rounded for display. */
export function rateLabel(kilobytesPerSecond: number): string {
  if (kilobytesPerSecond >= 1_024) {
    return localizedMessage("inspection.transfer.rate.megabytes.per.second", {
      value: Math.round((kilobytesPerSecond / 1_024) * 100) / 100,
    });
  }
  return localizedMessage("inspection.transfer.rate.kilobytes.per.second", {
    value: Math.round(kilobytesPerSecond * 100) / 100,
  });
}
