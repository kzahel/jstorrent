import { useEffect, useRef, useState } from "react";

import type {
  TorrentListImportReport,
  TorrentListImportTarget,
} from "../../api";
import { MAX_TORRENT_LIST_BUNDLE_BYTES } from "../../api/client";
import { message as localizedMessage } from "../../localization/runtime";
import type { DownloadRoot } from "../model";
import { useToast } from "./Toast";
import pickerStyles from "./PresetPicker.module.css";
import styles from "./SettingsDialog.module.css";

export interface TorrentListSettingsSectionProps {
  readonly roots: readonly DownloadRoot[];
  readonly defaultRoot: string | null;
  readonly onExport?: (() => Promise<boolean>) | undefined;
  readonly onImport?:
    | ((
        target: TorrentListImportTarget,
        chooseFile: () => Promise<ArrayBuffer | null>,
      ) => Promise<TorrentListImportReport | null>)
    | undefined;
  /** Keeps Settings open while an import runs. */
  readonly onBusyChange: (busy: boolean) => void;
}

type ImportOutcome =
  | { readonly type: "report"; readonly report: TorrentListImportReport }
  | { readonly type: "error"; readonly message: string };

/**
 * Tactical 348: export the torrent list to one file and import it again,
 * here or on another device. Hidden where the client supports neither.
 */
export function TorrentListSettingsSection({
  roots,
  defaultRoot,
  onExport,
  onImport,
  onBusyChange,
}: TorrentListSettingsSectionProps) {
  const toast = useToast();
  const availableRoots = roots.filter((root) => root.availability === "available");
  const [chosenRoot, setChosenRoot] = useState<string | null>(null);
  const storageRoot =
    availableRoots.find((root) => root.id === chosenRoot)?.id ??
    availableRoots.find((root) => root.id === defaultRoot)?.id ??
    availableRoots[0]?.id ??
    null;
  const [keepLocations, setKeepLocations] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chooserRef = useRef<((file: File | null) => void) | null>(null);
  const importRunRef = useRef(0);

  const importSupported = onImport !== undefined;
  useEffect(() => {
    const input = fileInputRef.current;
    if (input === null) return;
    // The chooser reports Cancel as its own event, not as a change.
    const cancel = () => chooserRef.current?.(null);
    input.addEventListener("cancel", cancel);
    return () => input.removeEventListener("cancel", cancel);
  }, [importSupported]);
  useEffect(() => () => chooserRef.current?.(null), []);

  if (onExport === undefined && onImport === undefined) return null;

  const runExport = async () => {
    if (onExport === undefined || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      if (await onExport()) {
        toast.show({ message: localizedMessage("inspection.components.torrent.list.exported") });
      }
    } catch (cause) {
      setExportError(
        localizedMessage("inspection.components.torrent.list.export.failed", {
          error: errorText(cause),
        }),
      );
    } finally {
      setExporting(false);
    }
  };

  /** Opens the browser's file chooser; desktop clients use their own. */
  const chooseFile = () =>
    new Promise<ArrayBuffer | null>((resolve, reject) => {
      const input = fileInputRef.current;
      if (input === null) {
        resolve(null);
        return;
      }
      chooserRef.current?.(null);
      chooserRef.current = (file) => {
        chooserRef.current = null;
        if (file === null) {
          resolve(null);
        } else if (file.size === 0 || file.size > MAX_TORRENT_LIST_BUNDLE_BYTES) {
          reject(new Error(localizedMessage("inspection.components.torrent.list.file.size")));
        } else {
          file.arrayBuffer().then(resolve, reject);
        }
      };
      input.value = "";
      input.click();
    });

  const runImport = async () => {
    if (onImport === undefined || storageRoot === null || importing) return;
    const run = ++importRunRef.current;
    let locked = false;
    setImporting(true);
    setOutcome(null);
    try {
      const report = await onImport(
        { storage_root: storageRoot, keep_matching_locations: keepLocations },
        async () => {
          const bytes = await chooseFile();
          if (bytes !== null && run === importRunRef.current) {
            locked = true;
            onBusyChange(true);
          }
          return bytes;
        },
      );
      if (run === importRunRef.current && report !== null) {
        setOutcome({ type: "report", report });
      }
    } catch (cause) {
      if (run === importRunRef.current) {
        setOutcome({
          type: "error",
          message: localizedMessage("inspection.components.torrent.list.import.failed", {
            error: errorText(cause),
          }),
        });
      }
    } finally {
      if (locked) onBusyChange(false);
      if (run === importRunRef.current) setImporting(false);
    }
  };

  const saveToId = "torrent-list-save-to";
  return (
    <div className={styles.rows}>
      <section>
        <h4>{localizedMessage("inspection.components.torrent.list.title")}</h4>
        <p>{localizedMessage("inspection.components.torrent.list.description")}</p>
        {onExport === undefined ? null : (
          <button type="button" disabled={exporting} aria-busy={exporting} onClick={() => void runExport()}>
            {exporting
              ? localizedMessage("inspection.components.torrent.list.exporting")
              : localizedMessage("inspection.components.torrent.list.export")}
          </button>
        )}
      </section>
      {exportError === null ? null : (
        <p role="alert" className={styles.errorStatus}>{exportError}</p>
      )}
      {onImport === undefined ? null : (
        <>
          <div className={pickerStyles.field}>
            <label htmlFor={saveToId}>
              <strong>{localizedMessage("inspection.components.torrent.list.save.to")}</strong>
              {storageRoot === null ? (
                <small>{localizedMessage("inspection.components.torrent.list.no.folders")}</small>
              ) : null}
            </label>
            <div className={pickerStyles.controls}>
              <select
                id={saveToId}
                value={storageRoot ?? ""}
                disabled={importing || storageRoot === null}
                onChange={(event) => setChosenRoot(event.currentTarget.value)}
              >
                {availableRoots.map((root) => (
                  <option key={root.id} value={root.id}>{root.label}</option>
                ))}
              </select>
            </div>
          </div>
          <label className={styles.preference}>
            <input
              type="checkbox"
              checked={keepLocations}
              disabled={importing}
              onChange={(event) => setKeepLocations(event.currentTarget.checked)}
            />
            <span>
              <strong>{localizedMessage("inspection.components.torrent.list.keep.locations")}</strong>
            </span>
          </label>
          <section>
            <p>{localizedMessage("inspection.components.torrent.list.import.description")}</p>
            <button
              type="button"
              disabled={importing || storageRoot === null}
              aria-busy={importing}
              onClick={() => void runImport()}
            >
              {importing
                ? localizedMessage("inspection.components.torrent.list.importing")
                : localizedMessage("inspection.components.torrent.list.import")}
            </button>
            <input
              ref={fileInputRef}
              hidden
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => chooserRef.current?.(event.currentTarget.files?.[0] ?? null)}
            />
          </section>
          {outcome === null ? null : outcome.type === "error" ? (
            <p role="alert" className={styles.errorStatus}>{outcome.message}</p>
          ) : (
            <ImportReport report={outcome.report} />
          )}
        </>
      )}
    </div>
  );
}

function ImportReport({ report }: { readonly report: TorrentListImportReport }) {
  return (
    <div role="status" className={styles.importReport}>
      <p>
        {localizedMessage("feedback.add.batch.result", {
          added: report.added,
          alreadyPresent: report.already_present,
        })}
      </p>
      {report.failed.length === 0 ? null : (
        <>
          <p>
            {localizedMessage("inspection.components.torrent.list.failed", {
              count: report.failed.length,
            })}
          </p>
          <ul>
            {report.failed.map((failure, index) => (
              <li key={index}>
                {localizedMessage("inspection.components.torrent.list.failure", {
                  name: failure.name,
                  reason: failure.reason,
                })}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
