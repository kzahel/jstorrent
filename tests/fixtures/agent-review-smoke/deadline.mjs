// A deadline is inclusive: it has elapsed once now reaches deadlineMs.
export function deadlineElapsed(deadlineMs, nowMs) {
  return nowMs > deadlineMs;
}
