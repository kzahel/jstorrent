import type { SpeedMetric, SpeedRange } from "../api";
import type { AppearanceStorage } from "./appearance";

export interface SpeedPreferences {
  readonly range: SpeedRange;
  readonly metrics: readonly SpeedMetric[];
}

export const DEFAULT_SPEED_RANGE: SpeedRange = "seconds30";
export const DEFAULT_SPEED_METRICS: readonly SpeedMetric[] = [
  "payload_received",
  "payload_uploaded",
];

const STORAGE_KEY = "rstorrent.presentation.speed";
// Version 2 moved the defaults from received/staged/verified to
// download/upload; older saved selections fall back to the new defaults.
const VERSION = 2;
const RANGES: readonly SpeedRange[] = [
  "seconds30",
  "minutes2",
  "minutes10",
  "hour1",
  "hours24",
  "days30",
  "years2",
];
const METRICS: readonly SpeedMetric[] = [
  "payload_received",
  "staged_write",
  "payload_verified",
  "peer_wire_received",
  "peer_wire_sent",
  "peer_protocol_received",
  "peer_protocol_sent",
  "metadata_payload_received",
  "metadata_payload_sent",
  "peer_unclassified_received",
  "peer_unclassified_sent",
  "dht_received",
  "dht_sent",
  "tracker_received",
  "tracker_sent",
  "logical_hash_read",
  "payload_redundant",
  "payload_hash_failed",
  "payload_uploaded",
];

export function loadSpeedPreferences(
  storage: AppearanceStorage | null = browserStorage(),
): SpeedPreferences {
  if (storage === null) return defaults();
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as {
      readonly version?: unknown;
      readonly range?: unknown;
      readonly metrics?: unknown;
    } | null;
    if (parsed?.version !== VERSION) return defaults();
    const range = RANGES.find((candidate) => candidate === parsed.range);
    const metrics = Array.isArray(parsed.metrics)
      ? [...new Set(parsed.metrics)].filter(
          (metric): metric is SpeedMetric =>
            typeof metric === "string" && METRICS.includes(metric as SpeedMetric),
        )
      : [];
    return {
      range: range ?? DEFAULT_SPEED_RANGE,
      metrics:
        metrics.length === 0 || metrics.length > 8
          ? DEFAULT_SPEED_METRICS
          : metrics,
    };
  } catch {
    return defaults();
  }
}

export function saveSpeedPreferences(
  preferences: SpeedPreferences,
  storage: AppearanceStorage | null = browserStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: VERSION, ...preferences }),
    );
  } catch {
    // Browser-local chart preferences are optional in sandboxed contexts.
  }
}

export function isDefaultSpeedPreferences(
  preferences: SpeedPreferences,
): boolean {
  return (
    preferences.range === DEFAULT_SPEED_RANGE &&
    preferences.metrics.length === DEFAULT_SPEED_METRICS.length &&
    DEFAULT_SPEED_METRICS.every((metric) => preferences.metrics.includes(metric))
  );
}

function defaults(): SpeedPreferences {
  return { range: DEFAULT_SPEED_RANGE, metrics: DEFAULT_SPEED_METRICS };
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
