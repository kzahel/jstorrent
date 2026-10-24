// Tactical 352: connection status and stop rules shared by `ViewController`
// and the live application's first attach, without the view-set reducer or
// generated validators.
import {
  ApplicationViewError,
  ContractError,
  ViewSetContinuityError,
} from "./api/errors";

// Why delivery stopped for good: retrying cannot help, only a reload can.
export type ViewStopReason = "signed_out" | "reload_required";

// Times are wall-clock milliseconds. `nextAttemptAt` is null while an
// attempt is in progress.
export type ViewConnectionStatus =
  | { readonly type: "connected" }
  | {
      readonly type: "retrying";
      readonly since: number;
      readonly nextAttemptAt: number | null;
    }
  | { readonly type: "stopped"; readonly reason: ViewStopReason };

export function viewStopReason(error: Error): ViewStopReason | null {
  if (
    error instanceof ContractError ||
    error instanceof ViewSetContinuityError
  ) {
    return "reload_required";
  }
  if (error instanceof ApplicationViewError) {
    if (error.code === "authentication_failed") return "signed_out";
    if (error.code === "invalid_version") return "reload_required";
  }
  return null;
}

export function abortableDelay(
  millis: number,
  ...signals: AbortSignal[]
): Promise<void> {
  return new Promise((resolve) => {
    if (signals.some((signal) => signal.aborted)) {
      resolve();
      return;
    }
    const finish = () => {
      globalThis.clearTimeout(timer);
      for (const signal of signals) signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = globalThis.setTimeout(finish, millis);
    for (const signal of signals) {
      signal.addEventListener("abort", finish, { once: true });
    }
  });
}
