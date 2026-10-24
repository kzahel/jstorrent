import { useEffect, useRef, useState } from "react";

import { message as localizedMessage } from "../../localization/runtime";
import type { SessionConnection } from "../model";
import styles from "./ConnectionOverlay.module.css";

// Brief drops (sleep/wake, an engine restart) recover inside this window
// without covering the page.
export const CONNECTION_INTERRUPTED_AFTER_MS = 3_000;

export function connectionInterrupted(
  connection: SessionConnection,
  nowMs: number,
): boolean {
  switch (connection.type) {
    case "stopped":
      return true;
    case "reconnecting":
      return nowMs - connection.since >= CONNECTION_INTERRUPTED_AFTER_MS;
    default:
      return false;
  }
}

// Wall-clock time that ticks only while `active`.
export function useConnectionClock(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNowMs(Date.now());
    const timer = globalThis.setInterval(() => setNowMs(Date.now()), 500);
    return () => globalThis.clearInterval(timer);
  }, [active]);
  return nowMs;
}

export interface ConnectionOverlayProps {
  readonly connection: SessionConnection;
  readonly nowMs: number;
  readonly onRetry: () => void;
  readonly onReload: () => void;
}

export function ConnectionOverlay({
  connection,
  nowMs,
  onRetry,
  onReload,
}: ConnectionOverlayProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const retrying = connection.type === "reconnecting";

  useEffect(() => {
    primaryRef.current?.focus();
  }, [connection.type]);

  let title: string;
  let detail: string;
  if (connection.type === "stopped" && connection.reason === "signed_out") {
    title = localizedMessage("inspection.components.connection.overlay.signed.out.title");
    detail = localizedMessage("inspection.components.connection.overlay.signed.out.detail");
  } else if (connection.type === "stopped") {
    title = localizedMessage("inspection.components.connection.overlay.reload.title");
    detail = localizedMessage("inspection.components.connection.overlay.reload.detail");
  } else {
    title = localizedMessage("inspection.components.connection.overlay.interrupted.title");
    detail = localizedMessage("inspection.components.connection.overlay.interrupted.detail");
  }
  const status =
    connection.type !== "reconnecting"
      ? null
      : connection.nextAttemptAt === null
        ? localizedMessage("inspection.components.connection.overlay.reconnecting")
        : localizedMessage("inspection.components.connection.overlay.retrying.in", {
            seconds: Math.max(1, Math.ceil((connection.nextAttemptAt - nowMs) / 1_000)),
          });

  return (
    <section
      className={styles.backdrop}
      data-connection-overlay={connection.type}
    >
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="connection-overlay-title"
        aria-describedby="connection-overlay-detail"
      >
        <h2 id="connection-overlay-title">{title}</h2>
        <p id="connection-overlay-detail">{detail}</p>
        {status === null ? null : (
          <p className={styles.status} role="status">
            {status}
          </p>
        )}
        <div className={styles.actions}>
          {retrying ? (
            <>
              <button type="button" onClick={onReload}>
                {localizedMessage("inspection.components.connection.overlay.reload.page")}
              </button>
              <button
                ref={primaryRef}
                className={styles.primary}
                type="button"
                onClick={onRetry}
              >
                {localizedMessage("inspection.components.connection.overlay.retry.now")}
              </button>
            </>
          ) : (
            <button
              ref={primaryRef}
              className={styles.primary}
              type="button"
              onClick={onReload}
            >
              {connection.type === "stopped" && connection.reason === "signed_out"
                ? localizedMessage("inspection.components.connection.overlay.sign.in")
                : localizedMessage("inspection.components.connection.overlay.reload")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
