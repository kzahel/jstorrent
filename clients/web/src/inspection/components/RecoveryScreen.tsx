import { useState, useSyncExternalStore } from "react";

import jstorrentIcon from "../../assets/jstorrent.png";
import type { CatalogRecoveryReason } from "../../api";
import { message as localizedMessage, useProductLocale } from "../../localization/runtime";
import type { DesktopRecovery } from "../../tauri-recovery";
import { FEEDBACK_PAGE_URL } from "../support/report-links";
import type { DesktopUpdater, DesktopUpdaterSnapshot } from "../updater/types";
import styles from "./RecoveryScreen.module.css";

export interface RecoveryScreenProps {
  readonly recovery: DesktopRecovery;
  readonly updater?: DesktopUpdater | undefined;
  readonly openExternalUrl?: ((url: string) => Promise<void>) | undefined;
}

type ExportState = "idle" | "working" | "saved" | { readonly error: string };

/**
 * Shown instead of the app when the torrent list will not open (Tactical
 * 369). It never offers to discard data: the catalog is unchanged, an update
 * may fix it, and the torrent list can be exported meanwhile.
 */
export function RecoveryScreen({ recovery, updater, openExternalUrl }: RecoveryScreenProps) {
  useProductLocale();
  const { status } = recovery;
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [copied, setCopied] = useState(false);
  const locked = status.reason === "locked";
  const exportTorrents = async () => {
    setExportState("working");
    try {
      setExportState((await recovery.exportTorrentList()) ? "saved" : "idle");
    } catch (error) {
      setExportState({ error: error instanceof Error ? error.message : String(error) });
    }
  };
  const copyDetails = async () => {
    await navigator.clipboard.writeText(status.details);
    setCopied(true);
  };
  return (
    <div className={styles.page}>
      <section className={styles.card} aria-labelledby="recovery-title">
        <img className={styles.brand} src={jstorrentIcon} width="40" height="40" alt="" />
        <h1 id="recovery-title">{title(status.reason)}</h1>
        <p>{body(status.reason)}</p>
        {locked ? null : <UpdateControls updater={updater} />}
        <div className={styles.actions}>
          {status.export_available ? (
            <button
              type="button"
              disabled={exportState === "working"}
              onClick={() => void exportTorrents()}
            >
              {localizedMessage("inspection.recovery.export")}
            </button>
          ) : null}
          <button type="button" onClick={() => void copyDetails()}>
            {copied
              ? localizedMessage("inspection.recovery.details.copied")
              : localizedMessage("inspection.recovery.details.copy")}
          </button>
          {openExternalUrl === undefined || locked ? null : (
            <button type="button" onClick={() => void openExternalUrl(FEEDBACK_PAGE_URL)}>
              {localizedMessage("inspection.recovery.report")}
            </button>
          )}
          <button type="button" onClick={() => void recovery.quit()}>
            {localizedMessage("inspection.recovery.quit")}
          </button>
        </div>
        {exportState === "saved" ? (
          <p className={styles.status} role="status">
            {localizedMessage("inspection.recovery.export.saved")}
          </p>
        ) : typeof exportState === "object" ? (
          <p className={`${styles.status} ${styles.error}`} role="alert">
            {localizedMessage("inspection.recovery.export.failed", { detail: exportState.error })}
          </p>
        ) : null}
        <details className={styles.details}>
          <summary>{localizedMessage("inspection.recovery.details")}</summary>
          <pre>{status.details}</pre>
        </details>
      </section>
    </div>
  );
}

function UpdateControls({ updater }: { readonly updater?: DesktopUpdater | undefined }) {
  const snapshot = useSyncExternalStore(
    updater?.subscribe ?? noSubscription,
    updater?.getSnapshot ?? noSnapshot,
  );
  if (updater === undefined || snapshot === undefined) return null;
  const state = snapshot.state;
  return (
    <>
      <div className={styles.actions}>
        {state.phase === "available" ? (
          <button type="button" className={styles.primary} onClick={() => void updater.install()}>
            {localizedMessage("inspection.recovery.update.install", { version: state.version })}
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            disabled={
              state.phase === "checking" ||
              state.phase === "downloading" ||
              state.phase === "installing"
            }
            onClick={() => void updater.check("manual")}
          >
            {localizedMessage("inspection.recovery.update.check")}
          </button>
        )}
      </div>
      <UpdateStatus snapshot={snapshot} />
    </>
  );
}

function UpdateStatus({ snapshot }: { readonly snapshot: DesktopUpdaterSnapshot }) {
  const state = snapshot.state;
  switch (state.phase) {
    case "checking":
      return <p className={styles.status} role="status">{localizedMessage("inspection.recovery.update.checking")}</p>;
    case "up-to-date":
      return <p className={styles.status} role="status">{localizedMessage("inspection.recovery.update.current")}</p>;
    case "downloading":
    case "installing":
      return <p className={styles.status} role="status">{localizedMessage("inspection.recovery.update.installing", { version: state.version })}</p>;
    case "error":
      return (
        <p className={`${styles.status} ${styles.error}`} role="alert">
          {localizedMessage("inspection.recovery.update.failed", { detail: state.message })}
        </p>
      );
    default:
      return null;
  }
}

function noSubscription(): () => void {
  return () => undefined;
}

function noSnapshot(): undefined {
  return undefined;
}

function title(reason: CatalogRecoveryReason): string {
  switch (reason) {
    case "migration_failed":
      return localizedMessage("inspection.recovery.title.migration");
    case "newer_version":
      return localizedMessage("inspection.recovery.title.newer");
    case "retired_version":
      return localizedMessage("inspection.recovery.title.retired");
    case "locked":
      return localizedMessage("inspection.recovery.title.locked");
    case "unreadable":
      return localizedMessage("inspection.recovery.title.unreadable");
  }
}

function body(reason: CatalogRecoveryReason): string {
  switch (reason) {
    case "migration_failed":
      return localizedMessage("inspection.recovery.body.migration");
    case "newer_version":
      return localizedMessage("inspection.recovery.body.newer");
    case "retired_version":
      return localizedMessage("inspection.recovery.body.retired");
    case "locked":
      return localizedMessage("inspection.recovery.body.locked");
    case "unreadable":
      return localizedMessage("inspection.recovery.body.unreadable");
  }
}
