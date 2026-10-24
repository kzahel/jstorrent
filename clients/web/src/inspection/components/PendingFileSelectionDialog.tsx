import { message as localizedMessage } from "../../localization/runtime";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type UIEvent } from "react";

import { formatExactBytes } from "../format";
import type { DataUnits } from "../appearance";
import type { FileRow, FileSet, TorrentRow } from "../model";
import styles from "./AddTorrentDialog.module.css";

import { PendingSelectionDraft } from "../pending-file-selection-draft";
const MAX_CACHED_PAGES = 3;
const FILE_ROW_HEIGHT_PX = 52;
const VIEWPORT_OVERSCAN_ROWS = 6;

interface CachedPage {
  readonly offset: number;
  readonly limit: number;
  readonly nextOffset: number | null;
  readonly rows: ReadonlyMap<number, FileRow>;
}

export interface PendingFileSelectionDialogProps {
  readonly torrent: TorrentRow;
  readonly files: FileSet | undefined;
  readonly rootLabel: string;
  readonly queuedCount: number;
  readonly dataUnits: DataUnits;
  readonly onPage: (offset: number) => void;
  readonly onConfirm: (
    base: "current" | "all" | "none",
    overrides: readonly {
      readonly start: number;
      readonly endExclusive: number;
      readonly selected: boolean;
    }[],
    disableFuture: boolean,
  ) => Promise<void>;
  /** Selects all files subject to safety settings, without waiting for metadata. */
  readonly onDownloadAll: (disableFuture: boolean) => Promise<void>;
  /** The host can download all files only once the file list loads. */
  readonly waitForFileList?: boolean;
  readonly supportsFileSelectionBitmaps?: boolean;
  readonly onCancel: () => Promise<void>;
}

/**
 * The add queue presents one torrent at a time in the same place, so the
 * draft is keyed by torrent: a confirmed torrent's pending state, choices and
 * cached pages never carry over to the next queued torrent.
 */
export function PendingFileSelectionDialog(props: PendingFileSelectionDialogProps) {
  return <PendingFileSelectionDraft key={props.torrent.id} {...props} />;
}

function PendingFileSelectionDraft({
  torrent,
  files,
  rootLabel,
  queuedCount,
  dataUnits,
  onPage,
  onConfirm,
  onDownloadAll,
  waitForFileList = false,
  supportsFileSelectionBitmaps = true,
  onCancel,
}: PendingFileSelectionDialogProps) {
  const [draft, setDraft] = useState(() => new PendingSelectionDraft());
  const [pages, setPages] = useState<ReadonlyMap<number, CachedPage>>(
    new Map(),
  );
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 400 });
  const [disableFuture, setDisableFuture] = useState(false);
  const [pending, setPending] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const lastRequestedOffset = useRef<number | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (files === undefined || files.state !== "available") return;
    setPages((current) => {
      const pageRows = new Map<number, FileRow>();
      for (const id of files.order) {
        const row = files.rows[id];
        if (row !== undefined && !row.padding) pageRows.set(row.index, row);
      }
      const next = new Map(current);
      next.set(files.page.offset, {
        offset: files.page.offset,
        limit: files.page.limit,
        nextOffset: files.page.nextOffset,
        rows: pageRows,
      });
      return new Map(
        [...next.entries()]
          .sort(
            ([left], [right]) =>
              Math.abs(left - files.page.offset) - Math.abs(right - files.page.offset),
          )
          .slice(0, MAX_CACHED_PAGES),
      );
    });
    lastRequestedOffset.current = null;
  }, [files]);

  const totalRows = files?.state === "available" ? files.page.total : 0;
  const firstVisibleIndex = Math.max(
    0,
    Math.floor(viewport.scrollTop / FILE_ROW_HEIGHT_PX) - VIEWPORT_OVERSCAN_ROWS,
  );
  const lastVisibleIndex = Math.min(
    Math.max(0, totalRows - 1),
    Math.ceil((viewport.scrollTop + viewport.height) / FILE_ROW_HEIGHT_PX) +
      VIEWPORT_OVERSCAN_ROWS,
  );
  const visibleRows = useMemo(
    () =>
      [...pages.values()]
        .flatMap((page) => [...page.rows.values()])
        .filter((row) => row.index >= firstVisibleIndex && row.index <= lastVisibleIndex)
        .sort((left, right) => left.index - right.index),
    [firstVisibleIndex, lastVisibleIndex, pages],
  );
  const summary = useMemo(
    () => draft.summary(torrent),
    [draft, torrent],
  );
  const busy = pending !== null;
  const metadataReady = torrent.fileCatalogId != null && files?.state === "available";

  const selectedFor = (row: FileRow) => draft.selected(row);
  const toggle = (row: FileRow) => {
    const next = draft.toggle(row, supportsFileSelectionBitmaps ? 374_998 : 4_096);
    if (next === null) setError(supportsFileSelectionBitmaps ? localizedMessage("safety.selection.fragmented") : localizedMessage("safety.selection.older.host"));
    else { setDraft(next); setError(""); }
  };
  const chooseBase = (next: "all" | "none") => {
    setDraft(new PendingSelectionDraft(next));
    setError("");
  };

  const loadVisiblePage = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const height = target.clientHeight > 0 ? target.clientHeight : viewport.height;
    setViewport({ scrollTop: target.scrollTop, height });
    const first = Math.max(0, Math.floor(target.scrollTop / FILE_ROW_HEIGHT_PX));
    const last = Math.max(first, Math.ceil((target.scrollTop + height) / FILE_ROW_HEIGHT_PX));
    const coveringPage = [...pages.values()].find((page) => {
      const end = page.nextOffset ?? Math.min(totalRows, page.offset + page.limit);
      return first >= page.offset && first < end;
    });
    let requestedOffset: number | null = null;
    if (coveringPage === undefined) {
      const limit = Math.max(1, files?.page.limit ?? 1_024);
      requestedOffset = Math.floor(first / limit) * limit;
    } else if (
      coveringPage.nextOffset !== null &&
      last >= coveringPage.nextOffset - VIEWPORT_OVERSCAN_ROWS
    ) {
      requestedOffset = coveringPage.nextOffset;
    } else if (
      first <= coveringPage.offset + VIEWPORT_OVERSCAN_ROWS &&
      coveringPage.offset > 0
    ) {
      requestedOffset = Math.max(0, coveringPage.offset - coveringPage.limit);
    }
    if (
      requestedOffset === null ||
      requestedOffset >= totalRows ||
      pages.has(requestedOffset) ||
      lastRequestedOffset.current === requestedOffset
    ) {
      return;
    }
    lastRequestedOffset.current = requestedOffset;
    onPage(requestedOffset);
  };

  const confirm = async () => {
    setPending("confirm");
    setError("");
    try {
      if (metadataReady) {
        await onConfirm(draft.base, draft.compactOverrides(), disableFuture);
      } else {
        await onDownloadAll(disableFuture);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setPending(null);
    }
  };

  const cancel = async () => {
    setPending("cancel");
    setError("");
    try {
      await onCancel();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setPending(null);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") event.preventDefault();
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable === undefined || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialogRef}
        className={`${styles.dialog} ${styles.selectionDialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-selection-title"
        aria-describedby="pending-selection-description"
        onKeyDown={handleKeyDown}
      >
        <header>
          <h2 id="pending-selection-title">{torrent.name}</h2>
        </header>
        <p>{localizedMessage("safety.files.selection.note")}</p>
        <p id="pending-selection-description" className={styles.description}>{localizedMessage("inspection.components.pending.file.selection.dialog.choose.the.files.you.want.to.download")}</p>
        <div className={styles.selectionMeta}>
          <span>{localizedMessage("inspection.components.pending.file.selection.dialog.download.folder")}{" "}<strong>{rootLabel}</strong></span>
          {queuedCount === 0 ? null : (
            <span>{localizedMessage("common.files.pending", { count: queuedCount })}</span>
          )}
        </div>
        {!metadataReady ? (
          <div className={styles.metadataWait} role="status">
            <strong>{localizedMessage("inspection.components.pending.file.selection.dialog.loading.file.list")}</strong>
            <span>
              {waitForFileList
                ? localizedMessage("inspection.components.pending.file.selection.dialog.download.after.file.list.loads")
                : localizedMessage("inspection.components.pending.file.selection.dialog.you.can.download.all.files.without.waiting")}
            </span>
          </div>
        ) : (
          <>
            <div className={styles.selectionToolbar}>
              <button type="button" disabled={busy} onClick={() => chooseBase("all")}>{localizedMessage("inspection.components.pending.file.selection.dialog.all")}</button>
              <button type="button" disabled={busy} onClick={() => chooseBase("none")}>{localizedMessage("inspection.components.pending.file.selection.dialog.none")}</button>
              <span>
                {localizedMessage("common.files.selected", {
                  selected: summary.count,
                  total: torrent.selectableFileCount ?? 0,
                })}{" · "}{formatExactBytes(summary.bytes.toString(), dataUnits)}
              </span>
            </div>
            <div
              className={styles.selectionList}
              role="list"
              aria-label={localizedMessage("inspection.components.pending.file.selection.dialog.torrent.files")}
              data-cached-page-count={pages.size}
              onScroll={loadVisiblePage}
            >
              <div
                className={styles.selectionListExtent}
                style={{ height: `${totalRows * FILE_ROW_HEIGHT_PX}px` }}
              >
              {visibleRows.map((row) => (
                <label
                  key={row.id}
                  className={styles.selectionRow}
                  role="listitem"
                  style={{ top: `${row.index * FILE_ROW_HEIGHT_PX}px` }}
                >
                  <input
                    type="checkbox"
                    aria-description={row.safety?.blocked ? localizedMessage("safety.files.blocked", { extension: row.safety.matched_extension, preset: localizedMessage(row.safety.preset === "custom" ? "safety.preset.custom" : row.safety.preset === "archives" ? "safety.preset.archives" : "safety.preset.recommended") }) : undefined}
                    checked={row.safety?.blocked === true ? false : selectedFor(row)}
                    disabled={busy || row.safety?.blocked === true}
                    onChange={() => toggle(row)}
                  />
                  <span>
                    <strong title={row.path.join("/")}>{row.path.join("/")}</strong>
                    <small>{formatExactBytes(row.lengthBytes, dataUnits)}</small>
                  </span>
                </label>
              ))}
              </div>
            </div>
          </>
        )}
        <label className={styles.preference}>
          <input
            type="checkbox"
            checked={disableFuture}
            disabled={busy}
            onChange={(event) => setDisableFuture(event.currentTarget.checked)}
          />{localizedMessage("inspection.components.pending.file.selection.dialog.don.t.show.file.selection.again")}</label>
        {error === "" ? null : <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button ref={cancelRef} type="button" disabled={busy} onClick={() => void cancel()}>
            {localizedMessage("inspection.components.pending.file.selection.dialog.cancel")}
          </button>
          <button
            className={styles.confirm}
            type="button"
            disabled={busy || (waitForFileList && !metadataReady)}
            aria-busy={pending === "confirm"}
            onClick={() => void confirm()}
          >
            {localizedMessage("inspection.components.pending.file.selection.dialog.download")}
          </button>
        </div>
      </div>
    </div>
  );
}
