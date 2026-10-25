import { formatDate, formatNumber, message as localizedMessage  } from "../../localization/runtime";
import { useEffect, useMemo, useRef, useState } from "react";

import type { DiagnosticSubject, DiagnosticValue } from "../../api";
import { useInspectionStore } from "../context";
import type { LogRow, ViewMaterialization } from "../model";
import styles from "./LogConsole.module.css";

const COLLAPSED_HEIGHT = 34;
const LOSS_MARKER_HEIGHT = 38;
const OVERSCAN_ROWS = 8;
const BOTTOM_THRESHOLD = 28;
const SEVERITY_ORDER: Readonly<Record<LogRow["severity"], number>> = {
  trace: 0,
  debug: 1,
  info: 2,
  warning: 3,
  error: 4,
};
const formatLogClock = (value: number) => formatDate(value, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function LogConsole() {
  const logs = useInspectionStore((state) => state.logs);
  const loss = useInspectionStore((state) => state.logLoss);
  const torrents = useInspectionStore((state) => state.torrents);
  const currentTorrentId = useInspectionStore(
    (state) => state.presentation.currentTorrentId,
  );
  const materialization = useInspectionStore((state) => state.viewStatus.logs);
  const presentation = useInspectionStore((state) => state.presentation);
  const setCaptureProfile = useInspectionStore(
    (state) => state.setLogCaptureProfile,
  );
  const setCaptureTorrent = useInspectionStore(
    (state) => state.setLogCaptureTorrent,
  );
  const setMinimumSeverity = useInspectionStore(
    (state) => state.setLogMinimumSeverity,
  );
  const setCategoryPrefix = useInspectionStore(
    (state) => state.setLogCategoryPrefix,
  );
  const setSearch = useInspectionStore((state) => state.setLogSearch);
  const setDisplayScope = useInspectionStore(
    (state) => state.setLogDisplayScope,
  );
  const toggleExpanded = useInspectionStore(
    (state) => state.toggleLogExpanded,
  );
  const clearVisible = useInspectionStore((state) => state.clearVisibleLogs);
  const setFollowing = useInspectionStore((state) => state.setLogFollowing);
  const filtered = useMemo(
    () =>
      filterLogRows(logs, {
        minimumSeverity: presentation.logMinimumSeverity,
        categoryPrefix: presentation.logCategoryPrefix,
        search: presentation.logSearch,
        displayTorrentId:
          presentation.logDisplayScope === "current"
            ? currentTorrentId
            : null,
        clearThroughSequence: presentation.logClearThroughSequence,
        torrents,
      }),
    [
      logs,
      presentation.logMinimumSeverity,
      presentation.logCategoryPrefix,
      presentation.logSearch,
      presentation.logDisplayScope,
      presentation.logClearThroughSequence,
      currentTorrentId,
      torrents,
    ],
  );
  const expanded = useMemo(
    () => new Set(presentation.logExpandedIds),
    [presentation.logExpandedIds],
  );
  const hasLoss =
    loss.sourceEvictedCount > 0 ||
    loss.localEvictedCount > 0 ||
    loss.deliveryResetCount > 0;
  const layout = useMemo(
    () => layoutLogRows(filtered, expanded, hasLoss),
    [filtered, expanded, hasLoss],
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousLastId = useRef<string | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 320 });
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (viewportElement === null) return;
    const observer = new ResizeObserver(() => {
      setViewport((current) => ({
        top: viewportElement.scrollTop,
        height: viewportElement.clientHeight,
      }));
    });
    observer.observe(viewportElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const lastId = logs.at(-1)?.id ?? null;
    const previous = previousLastId.current;
    previousLastId.current = lastId;
    if (lastId === null || lastId === previous) return;
    if (previous === null) {
      if (!presentation.logFollowing) return;
      const frame = requestAnimationFrame(() => scrollToBottom(viewportRef.current));
      return () => cancelAnimationFrame(frame);
    }
    if (presentation.logFollowing) {
      const frame = requestAnimationFrame(() => scrollToBottom(viewportRef.current));
      setNewCount(0);
      return () => cancelAnimationFrame(frame);
    }
    const added = logs.filter((row) => sequenceAfter(row.id, previous)).length;
    setNewCount((current) => current + added);
  }, [logs, presentation.logFollowing]);

  const visible = visibleLayoutRange(layout, viewport.top, viewport.height);
  const captureTorrentId = presentation.logCaptureTorrentId;
  const pinnedCaptureName =
    captureTorrentId === null
      ? null
      : (torrents[captureTorrentId]?.name ?? `Missing ${captureTorrentId.slice(0, 8)}`);

  return (
    <section className={styles.console} aria-label={localizedMessage("inspection.components.log.console.diagnostic.console")}>
      <div className={styles.captureBar}>
        <span className={styles.toolbarLabel}>{localizedMessage("inspection.components.log.console.capture")}</span>
        <label>
          <span>{localizedMessage("inspection.components.log.console.detail")}</span>
          <select
            aria-label={localizedMessage("inspection.components.log.console.log.detail.level")}
            value={presentation.logCaptureProfile}
            onChange={(event) =>
              setCaptureProfile(
                event.currentTarget.value as typeof presentation.logCaptureProfile,
              )
            }
          >
            <option value="normal">{localizedMessage("inspection.components.log.console.normal")}</option>
            <option value="detailed">{localizedMessage("inspection.components.log.console.detailed")}</option>
            <option value="trace">{localizedMessage("inspection.components.log.console.trace.high.volume")}</option>
          </select>
        </label>
        <label>
          <span>{localizedMessage("inspection.components.log.console.scope")}</span>
          <select
            aria-label={localizedMessage("inspection.components.log.console.torrents.to.log")}
            value={captureTorrentId ?? ""}
            onChange={(event) =>
              setCaptureTorrent(event.currentTarget.value || null)
            }
          >
            <option value="">{localizedMessage("inspection.components.log.console.all.torrents")}</option>
            {captureTorrentId === null ? null : (
              <option value={captureTorrentId}>{pinnedCaptureName}</option>
            )}
            {currentTorrentId === null || currentTorrentId === captureTorrentId ? null : (
              <option value={currentTorrentId}>{localizedMessage("inspection.components.log.console.current")}{" "}{torrents[currentTorrentId]?.name ?? currentTorrentId.slice(0, 8)}
              </option>
            )}
          </select>
        </label>
        {presentation.logCaptureProfile === "trace" ? (
          <span className={styles.traceNotice}>{localizedMessage("inspection.components.log.console.high.volume.producer.capture")}</span>
        ) : null}
        <span className={styles.captureCount}>
          {formatNumber(logs.length)}{" "}{localizedMessage("inspection.components.log.console.kept")}</span>
      </div>
      <div className={styles.filterBar}>
        <span className={styles.toolbarLabel}>{localizedMessage("inspection.components.log.console.display")}</span>
        <label className={styles.searchLabel}>
          <span className={styles.srOnly}>{localizedMessage("inspection.components.log.console.search.diagnostics")}</span>
          <input
            type="search"
            value={presentation.logSearch}
            placeholder={localizedMessage("inspection.components.log.console.search.logs")}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <label>
          <span className={styles.srOnly}>{localizedMessage("inspection.components.log.console.minimum.severity")}</span>
          <select
            aria-label={localizedMessage("inspection.components.log.console.minimum.displayed.severity")}
            value={presentation.logMinimumSeverity}
            onChange={(event) =>
              setMinimumSeverity(
                event.currentTarget.value as LogRow["severity"],
              )
            }
          >
            <option value="trace">{localizedMessage("inspection.components.log.console.trace.and.above")}</option>
            <option value="debug">{localizedMessage("inspection.components.log.console.debug.and.above")}</option>
            <option value="info">{localizedMessage("inspection.components.log.console.info.and.above")}</option>
            <option value="warning">{localizedMessage("inspection.components.log.console.warnings.and.errors")}</option>
            <option value="error">{localizedMessage("inspection.components.log.console.errors.only")}</option>
          </select>
        </label>
        <label className={styles.categoryLabel}>
          <span className={styles.srOnly}>{localizedMessage("inspection.components.log.console.category.prefix")}</span>
          <input
            value={presentation.logCategoryPrefix}
            placeholder={localizedMessage("inspection.components.log.console.category.prefix")}
            onChange={(event) => setCategoryPrefix(event.currentTarget.value)}
          />
        </label>
        <label>
          <span className={styles.srOnly}>{localizedMessage("inspection.components.log.console.torrent.display.scope")}</span>
          <select
            aria-label={localizedMessage("inspection.components.log.console.displayed.torrent.scope")}
            value={presentation.logDisplayScope}
            onChange={(event) =>
              setDisplayScope(event.currentTarget.value as "all" | "current")
            }
          >
            <option value="all">{localizedMessage("inspection.components.log.console.all.torrents")}</option>
            <option value="current" disabled={currentTorrentId === null}>{localizedMessage("inspection.components.log.console.current.session")}</option>
          </select>
        </label>
        <button type="button" onClick={clearVisible} disabled={logs.length === 0}>{localizedMessage("inspection.components.log.console.clear")}</button>
        <span className={styles.shownCount}>{formatNumber(filtered.length)}{" "}{localizedMessage("inspection.components.log.console.shown")}</span>
      </div>
      <div
        ref={viewportRef}
        className={styles.viewport}
        role="log"
        aria-label={localizedMessage("inspection.components.log.console.chronological.diagnostic.events")}
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          const following = atBottom(element);
          if (following !== presentation.logFollowing) setFollowing(following);
          if (following) setNewCount(0);
          setViewport({ top: element.scrollTop, height: element.clientHeight });
        }}
      >
        <div className={styles.canvas} style={{ height: layout.totalHeight }}>
          {hasLoss ? <LogLossMarker /> : null}
          {visible.rows.map(({ row, top, height }) => (
            <LogEntry
              key={row.id}
              row={row}
              torrentName={
                row.torrentId === null ? null : (torrents[row.torrentId]?.name ?? null)
              }
              top={top}
              height={height}
              expanded={expanded.has(row.id)}
              onToggle={() => toggleExpanded(row.id)}
            />
          ))}
          {filtered.length === 0 ? (
            <div className={styles.empty}>{emptyMessage(materialization, presentation.logCaptureProfile)}</div>
          ) : null}
        </div>
      </div>
      {!presentation.logFollowing && newCount > 0 ? (
        <button
          type="button"
          className={styles.newEvents}
          onClick={() => {
            setFollowing(true);
            setNewCount(0);
            scrollToBottom(viewportRef.current);
          }}
        >
          {formatNumber(newCount)}{" "}{localizedMessage("inspection.components.log.console.new")}{" "}{newCount === 1 ? localizedMessage("inspection.components.log.console.event") : localizedMessage("inspection.components.log.console.events")} ↓
        </button>
      ) : null}
    </section>
  );
}

function LogEntry({
  row,
  torrentName,
  top,
  height,
  expanded,
  onToggle,
}: {
  readonly row: LogRow;
  readonly torrentName: string | null;
  readonly top: number;
  readonly height: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const hasDetails = row.subjects.length > 0 || row.fields.length > 0;
  return (
    <article
      className={styles.entry}
      data-severity={row.severity}
      data-expanded={expanded || undefined}
      style={{ transform: `translateY(${top}px)`, height }}
    >
      <div className={styles.entryLine}>
        <button
          type="button"
          className={styles.disclosure}
          aria-label={`${expanded ? localizedMessage("inspection.components.log.console.collapse") : localizedMessage("inspection.components.log.console.expand")} ${row.code}`}
          aria-expanded={expanded}
          onClick={onToggle}
          disabled={!hasDetails}
        >
          {hasDetails ? (expanded ? "▾" : "▸") : "·"}
        </button>
        <time dateTime={new Date(row.timestampMs).toISOString()}>
          {formatLogTime(row.timestampMs)}
        </time>
        <span className={styles.severity} data-severity={row.severity}>
          {severitySymbol(row.severity)} {row.severity}
        </span>
        <code className={styles.category}>{row.category}</code>
        {row.torrentId === null ? (
          <span className={styles.subjectChip}>{localizedMessage("inspection.components.log.console.session")}</span>
        ) : (
          <span className={styles.subjectChip} title={row.torrentId}>
            {torrentName ?? row.torrentId.slice(0, 8)}
          </span>
        )}
        <span className={styles.message} title={row.message}>{row.message}</span>
      </div>
      {expanded ? (
        <div className={styles.details}>
          <dl>
            <div><dt>{localizedMessage("inspection.components.log.console.code")}</dt><dd><code>{row.code}</code></dd></div>
            <div><dt>{localizedMessage("inspection.components.log.console.sequence")}</dt><dd>{row.id}</dd></div>
            {row.subjects.map((subject, index) => (
              <div key={`subject-${index}`}>
                <dt>{subject.type.replaceAll("_", " ")}</dt>
                <dd>{formatSubject(subject)}</dd>
              </div>
            ))}
            {row.fields.map((field) => (
              <div key={field.key}>
                <dt>{field.key.replaceAll("_", " ")}</dt>
                <dd>{formatDiagnosticValue(field.value)}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.entryActions}>
            <button type="button" onClick={() => void copyText(row.message)}>{localizedMessage("inspection.components.log.console.copy.message")}</button>
            <button type="button" onClick={() => void copyText(JSON.stringify(row, null, 2))}>{localizedMessage("inspection.components.log.console.copy.structured.record")}</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function LogLossMarker() {
  const loss = useInspectionStore((state) => state.logLoss);
  const parts = [
    loss.sourceEvictedCount > 0
      ? `${formatNumber(loss.sourceEvictedCount)} evicted at source`
      : null,
    loss.deliveryResetCount > 0
      ? `${formatNumber(loss.deliveryResetCount)} delivery resync${loss.lastDeliveryResetReason === null ? "" : ` · ${loss.lastDeliveryResetReason.replaceAll("_", " ")}`}`
      : null,
    loss.localEvictedCount > 0
      ? `${formatNumber(loss.localEvictedCount)} evicted locally`
      : null,
  ].filter((part): part is string => part !== null);
  return (
    <div className={styles.lossMarker} role="status">
      <strong>{localizedMessage("inspection.components.log.console.history.boundary")}</strong>
      <span>{parts.join(" · ")}</span>
    </div>
  );
}

export interface LogDisplayFilter {
  readonly minimumSeverity: LogRow["severity"];
  readonly categoryPrefix: string;
  readonly search: string;
  readonly displayTorrentId: string | null;
  readonly clearThroughSequence: string | null;
  readonly torrents: Readonly<Record<string, { readonly name: string }>>;
}

export function filterLogRows(
  rows: readonly LogRow[],
  filter: LogDisplayFilter,
): readonly LogRow[] {
  const category = filter.categoryPrefix.trim().toLocaleLowerCase();
  const needle = filter.search.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (
      filter.clearThroughSequence !== null &&
      !sequenceAfter(row.id, filter.clearThroughSequence)
    ) {
      return false;
    }
    if (SEVERITY_ORDER[row.severity] < SEVERITY_ORDER[filter.minimumSeverity]) {
      return false;
    }
    if (
      category !== "" &&
      row.category !== category &&
      !row.category.startsWith(`${category}.`)
    ) {
      return false;
    }
    if (
      filter.displayTorrentId !== null &&
      row.torrentId !== null &&
      row.torrentId !== filter.displayTorrentId
    ) {
      return false;
    }
    if (needle === "") return true;
    const torrentName =
      row.torrentId === null ? "session" : (filter.torrents[row.torrentId]?.name ?? "");
    return [
      row.message,
      row.code,
      row.category,
      row.severity,
      row.torrentId ?? "session",
      torrentName,
      ...row.subjects.map(formatSubject),
      ...row.fields.flatMap((field) => [field.key, formatDiagnosticValue(field.value)]),
    ].some((value) => value.toLocaleLowerCase().includes(needle));
  });
}

interface LaidOutRow {
  readonly row: LogRow;
  readonly top: number;
  readonly height: number;
}

interface LogLayout {
  readonly rows: readonly LaidOutRow[];
  readonly totalHeight: number;
}

export function layoutLogRows(
  rows: readonly LogRow[],
  expanded: ReadonlySet<string>,
  hasLoss: boolean,
): LogLayout {
  let top = hasLoss ? LOSS_MARKER_HEIGHT : 0;
  const layout = rows.map((row) => {
    const detailRows = Math.ceil(
      (2 + row.subjects.length + row.fields.length) / 3,
    );
    const height = expanded.has(row.id)
      ? Math.min(190, Math.max(116, 76 + detailRows * 24))
      : COLLAPSED_HEIGHT;
    const value = { row, top, height };
    top += height;
    return value;
  });
  return { rows: layout, totalHeight: Math.max(top, 120) };
}

function visibleLayoutRange(
  layout: LogLayout,
  scrollTop: number,
  viewportHeight: number,
): { readonly rows: readonly LaidOutRow[] } {
  const minimum = Math.max(0, scrollTop - OVERSCAN_ROWS * COLLAPSED_HEIGHT);
  const maximum = scrollTop + viewportHeight + OVERSCAN_ROWS * COLLAPSED_HEIGHT;
  return {
    rows: layout.rows.filter(
      (row) => row.top + row.height >= minimum && row.top <= maximum,
    ),
  };
}

function formatDiagnosticValue(value: DiagnosticValue): string {
  if (value.type === "boolean") return value.value ? "true" : "false";
  if (value.type === "bytes") return `${value.value} B`;
  if (value.type === "duration_millis") return `${value.value} ms`;
  return value.value;
}

function formatSubject(subject: DiagnosticSubject): string {
  switch (subject.type) {
    case "peer_connection":
      return subject.connection_id;
    case "tracker":
      return subject.tracker_id;
    case "piece":
      return `piece ${subject.piece_index}${subject.attempt === null ? "" : ` · attempt ${subject.attempt}`}`;
    case "file":
      return `file ${subject.file_index}`;
    case "task":
      return `${subject.kind} · ${subject.generation}`;
  }
}

function formatLogTime(timestampMs: number): string {
  return `${formatLogClock(timestampMs)}.${String(timestampMs % 1_000).padStart(3, "0")}`;
}

function severitySymbol(severity: LogRow["severity"]): string {
  switch (severity) {
    case "trace": return "·";
    case "debug": return "◇";
    case "info": return "ⓘ";
    case "warning": return "⚠";
    case "error": return "⨯";
  }
}

function sequenceAfter(value: string, boundary: string): boolean {
  try {
    return BigInt(value) > BigInt(boundary);
  } catch {
    return value > boundary;
  }
}

function atBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= BOTTOM_THRESHOLD;
}

function scrollToBottom(element: HTMLElement | null): void {
  element?.scrollTo?.({ top: element.scrollHeight });
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard?.writeText(value);
}

function emptyMessage(
  materialization: ViewMaterialization,
  profile: "normal" | "detailed" | "trace",
): string {
  switch (materialization.status) {
    case "not_requested": return localizedMessage("inspection.components.log.console.diagnostics.are.not.requested");
    case "loading": return localizedMessage("inspection.components.log.console.loading.diagnostic.history");
    case "unavailable":
    case "unsupported": return materialization.reason;
    case "stale":
    case "ready":
      return profile === "normal"
        ? "No logs match these filters. Raise the detail level to capture more."
        : "No logs match these filters.";
  }
}
