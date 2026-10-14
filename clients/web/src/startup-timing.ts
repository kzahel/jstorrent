// Tactical 352 startup phases, recorded once each as `performance` marks so
// browser tooling and support diagnostics read the same timings.
export const STARTUP_PHASES = [
  "boot",
  "entry",
  "app_loaded",
  "auth_checked",
  "shell_rendered",
  "client_loaded",
  "hello",
  "view_set_open",
  "first_library",
  "adapters_ready",
] as const;

export type StartupPhase = (typeof STARTUP_PHASES)[number];

/** Milliseconds since navigation start, per recorded phase. */
export type StartupTimings = Partial<Record<StartupPhase, number>>;

const MARK_PREFIX = "jstorrent:startup:";
// Anything later is not startup; it also bounds the diagnostics value.
const MAX_STARTUP_MS = 600_000;

type MarkPerformance = Pick<Performance, "mark" | "getEntriesByName">;

export function markStartup(
  phase: StartupPhase,
  target: MarkPerformance | undefined = globalThis.performance,
): void {
  if (target === undefined) return;
  const name = MARK_PREFIX + phase;
  try {
    if (target.getEntriesByName(name, "mark").length > 0) return;
    target.mark(name);
  } catch {
    // Timing is diagnostic only and never blocks startup.
  }
}

export function startupTimings(
  target: MarkPerformance | undefined = globalThis.performance,
): StartupTimings {
  const timings: StartupTimings = {};
  if (target === undefined) return timings;
  for (const phase of STARTUP_PHASES) {
    let entries: readonly PerformanceEntry[];
    try {
      entries = target.getEntriesByName(MARK_PREFIX + phase, "mark");
    } catch {
      continue;
    }
    const startTime = entries[0]?.startTime;
    if (
      typeof startTime !== "number" ||
      !Number.isFinite(startTime) ||
      startTime < 0 ||
      startTime > MAX_STARTUP_MS
    ) {
      continue;
    }
    timings[phase] = Math.round(startTime);
  }
  return timings;
}
