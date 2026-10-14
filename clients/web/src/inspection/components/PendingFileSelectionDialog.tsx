import { message as localizedMessage } from "../../localization/runtime";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type UIEvent } from "react";

import { formatExactBytes } from "../format";
import type { DataUnits } from "../appearance";
import type { FileRow, FileSet, TorrentRow } from "../model";
import styles from "./AddTorrentDialog.module.css";

const MAX_OVERRIDES = 4_096;
const MAX_CACHED_PAGES = 3;
const FILE_ROW_HEIGHT_PX = 52;
const VIEWPORT_OVERSCAN_ROWS = 6;

interface DraftOverride {
  readonly selected: boolean;
  readonly initialSelected: boolean;
  readonly lengthBytes: string;
}

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
  /** Downloads every file without waiting for the file list. */
  readonly onDownloadAll: (disableFuture: boolean) => Promise<void>;
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
  onCancel,
}: PendingFileSelectionDialogProps) {
  const [base, setBase] = useState<"current" | "all" | "none">("current");
  const [overrides, setOverrides] = useState<ReadonlyMap<number, DraftOverride>>(
    new Map(),
  );
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
    () => draftSummary(torrent, base, overrides),
    [base, overrides, torrent],
  );
  const busy = pending !== null;
  const metadataReady = torrent.fileCatalogId != null && files?.state === "available";

  const selectedFor = (row: FileRow) =>
    overrides.get(row.index)?.selected ??
    (base === "all"
      ? true
      : base === "none"
        ? false
        : row.selection !== "skipped");

  const toggle = (row: FileRow) => {
    const nextSelected = !selectedFor(row);
    const baseSelected =
      base === "all"
        ? true
        : base === "none"
          ? false
          : row.selection !== "skipped";
    setOverrides((current) => {
      const next = new Map(current);
      if (nextSelected === baseSelected) {
        next.delete(row.index);
      } else {
        if (!next.has(row.index) && next.size >= MAX_OVERRIDES) {
          setError(
            `This selection is too fragmented. Use All or None, then change at most ${MAX_OVERRIDES.toLocaleString()} files.`,
          );
          return current;
        }
        next.set(row.index, {
          selected: nextSelected,
          initialSelected: row.selection !== "skipped",
          lengthBytes: row.lengthBytes,
        });
      }
      setError("");
      return next;
    });
  };

  const chooseBase = (next: "all" | "none") => {
    setBase(next);
    setOverrides(new Map());
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
        await onConfirm(base, compactOverrides(overrides), disableFuture);
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
            <span>{localizedMessage("inspection.components.pending.file.selection.dialog.you.can.download.all.files.without.waiting")}</span>
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
                    checked={selectedFor(row)}
                    disabled={busy}
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
            disabled={busy}
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

function draftSummary(
  torrent: TorrentRow,
  base: "current" | "all" | "none",
  overrides: ReadonlyMap<number, DraftOverride>,
): { count: number; bytes: bigint } {
  let count =
    base === "all"
      ? (torrent.selectableFileCount ?? 0)
      : base === "none"
        ? 0
        : (torrent.selectedFileCount ?? 0);
  let bytes = BigInt(
    base === "all"
      ? (torrent.selectableFileBytes ?? "0")
      : base === "none"
        ? "0"
        : (torrent.selectedFileBytes ?? "0"),
  );
  for (const entry of overrides.values()) {
    const baseline =
      base === "all" ? true : base === "none" ? false : entry.initialSelected;
    if (entry.selected === baseline) continue;
    const length = BigInt(entry.lengthBytes);
    count += entry.selected ? 1 : -1;
    bytes += entry.selected ? length : -length;
  }
  return { count, bytes };
}

function compactOverrides(
  overrides: ReadonlyMap<number, DraftOverride>,
): readonly {
  readonly start: number;
  readonly endExclusive: number;
  readonly selected: boolean;
}[] {
  const sorted = [...overrides.entries()].sort(([left], [right]) => left - right);
  const ranges: { start: number; endExclusive: number; selected: boolean }[] = [];
  for (const [index, entry] of sorted) {
    const previous = ranges.at(-1);
    if (previous !== undefined && previous.endExclusive === index && previous.selected === entry.selected) {
      previous.endExclusive += 1;
    } else {
      ranges.push({ start: index, endExclusive: index + 1, selected: entry.selected });
    }
  }
  return ranges;
}
