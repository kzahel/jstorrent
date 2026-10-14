import { message as localizedMessage } from "../../localization/runtime";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from "react";

import type { DataUnits, InterfaceSize } from "../appearance";
import { useInspectionStore } from "../context";
import {
  checkingStatusLabel,
  formatBytes,
  formatProgress,
  torrentRemovalLabel,
  torrentVisibleProgress,
} from "../format";
import type {
  LibraryCategory,
  TorrentRow,
  ViewMaterialization,
} from "../model";
import { torrentMatchesLibraryCategory } from "../state";
import { LibraryDetailView, waterLevel } from "./LibraryDetailView";
import styles from "./LibraryView.module.css";

const GRID_METRICS: Readonly<
  Record<
    InterfaceSize,
    {
      readonly minimumCardWidth: number;
      readonly rowHeight: number;
      readonly gap: number;
    }
  >
> = {
  compact: { minimumCardWidth: 176, rowHeight: 224, gap: 10 },
  standard: { minimumCardWidth: 206, rowHeight: 258, gap: 14 },
  spacious: { minimumCardWidth: 232, rowHeight: 294, gap: 16 },
};

const OVERSCAN_ROWS = 2;

export function LibraryView() {
  const dataUnits = useInspectionStore((state) => state.presentation.dataUnits);
  const order = useInspectionStore((state) => state.torrentOrder);
  const torrents = useInspectionStore((state) => state.torrents);
  const category = useInspectionStore(
    (state) => state.presentation.libraryCategory,
  );
  const currentTorrentId = useInspectionStore(
    (state) => state.presentation.currentTorrentId,
  );
  const detailOpen = useInspectionStore(
    (state) => state.presentation.libraryDetailOpen,
  );
  const detailMode = useInspectionStore(
    (state) => state.presentation.libraryDetailMode,
  );
  const layout = useInspectionStore((state) => state.presentation.layout);
  const interfaceSize = useInspectionStore(
    (state) => state.presentation.interfaceSize,
  );
  const openLibraryTorrentDetail = useInspectionStore(
    (state) => state.openLibraryTorrentDetail,
  );
  const closeLibraryTorrentDetail = useInspectionStore(
    (state) => state.closeLibraryTorrentDetail,
  );
  const selectLibraryDetailMode = useInspectionStore(
    (state) => state.selectLibraryDetailMode,
  );
  const selectDestination = useInspectionStore(
    (state) => state.selectDestination,
  );
  const selectLibraryCategory = useInspectionStore(
    (state) => state.selectLibraryCategory,
  );
  const materialization = useInspectionStore(
    (state) => state.viewStatus.library,
  );
  const allRows = useMemo(
    () =>
      order
        .map((id) => torrents[id])
        .filter((row): row is TorrentRow => row !== undefined),
    [order, torrents],
  );
  const newestAddedAtMs = useMemo(
    () =>
      allRows.reduce<number | null>(
        (latest, row) =>
          row.addedAtMs !== null && (latest === null || row.addedAtMs > latest)
            ? row.addedAtMs
            : latest,
        null,
      ),
    [allRows],
  );
  const rows = useMemo(
    () =>
      allRows.filter((row) =>
        torrentMatchesLibraryCategory(row, category, newestAddedAtMs),
      ),
    [allRows, category, newestAddedAtMs],
  );
  const current = allRows.find((row) => row.id === currentTorrentId);
  const [collectionScrollTop, setCollectionScrollTop] = useState(0);
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const route = libraryHistoryRoute(event.state);
      if (route === null) {
        closeLibraryTorrentDetail();
        return;
      }
      selectDestination("library");
      selectLibraryCategory(route.category);
      if (route.torrentId === null || torrents[route.torrentId] === undefined) {
        closeLibraryTorrentDetail();
        return;
      }
      setReturnFocusId(route.torrentId);
      openLibraryTorrentDetail(route.torrentId);
      selectLibraryDetailMode(route.mode);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [
    closeLibraryTorrentDetail,
    openLibraryTorrentDetail,
    selectDestination,
    selectLibraryCategory,
    selectLibraryDetailMode,
    torrents,
  ]);

  useEffect(() => {
    if (!detailOpen || currentTorrentId === null) return;
    const route = libraryHistoryRoute(window.history.state);
    if (route?.torrentId !== currentTorrentId || route.mode === detailMode) return;
    window.history.replaceState(
      withLibraryHistory(window.history.state, {
        torrentId: currentTorrentId,
        category,
        mode: detailMode,
      }),
      "",
    );
  }, [category, currentTorrentId, detailMode, detailOpen]);

  const openDetail = (torrentId: string) => {
    setReturnFocusId(torrentId);
    window.history.replaceState(
      withLibraryHistory(window.history.state, {
        torrentId: null,
        category,
        mode: "media",
      }),
      "",
    );
    window.history.pushState(
      withLibraryHistory(window.history.state, {
        torrentId,
        category,
        mode: "media",
      }),
      "",
    );
    openLibraryTorrentDetail(torrentId);
  };

  const closeDetail = () => {
    const route = libraryHistoryRoute(window.history.state);
    if (route?.torrentId === currentTorrentId) window.history.back();
    else closeLibraryTorrentDetail();
  };

  useEffect(() => {
    if (!detailOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeDetail();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  if (detailOpen && current !== undefined) {
    return <LibraryDetailView torrent={current} onBack={closeDetail} />;
  }

  return (
    <section className={styles.library} aria-labelledby="library-heading">
      <div className={styles.heading}>
        <div>
          <h1 id="library-heading">{categoryLabel(category)}</h1>
          <p>
            {rows.length.toLocaleString()}{" "}{localizedMessage("inspection.components.library.view.torrent.backed.content")}{" "}
            {rows.length === 1 ? localizedMessage("inspection.components.library.view.source") : localizedMessage("inspection.components.library.view.sources")}
          </p>
        </div>
      </div>
      {materialization.status !== "ready" ? (
        <LibraryEmpty message={materializationMessage(materialization)} />
      ) : rows.length === 0 ? (
        <LibraryEmpty message={emptyMessage(category)} />
      ) : (
        <VirtualLibraryGrid
          rows={rows}
          currentId={currentTorrentId}
          interfaceSize={interfaceSize}
          layout={layout}
          dataUnits={dataUnits}
          initialScrollTop={collectionScrollTop}
          returnFocusId={returnFocusId}
          onScrollTop={setCollectionScrollTop}
          onActivate={openDetail}
        />
      )}
    </section>
  );
}

function VirtualLibraryGrid({
  rows,
  currentId,
  interfaceSize,
  layout,
  dataUnits,
  initialScrollTop,
  returnFocusId,
  onScrollTop,
  onActivate,
}: {
  readonly rows: readonly TorrentRow[];
  readonly currentId: string | null;
  readonly interfaceSize: InterfaceSize;
  readonly layout: "wide" | "compact" | "phone";
  readonly dataUnits: DataUnits;
  readonly initialScrollTop: number;
  readonly returnFocusId: string | null;
  readonly onScrollTop: (scrollTop: number) => void;
  readonly onActivate: (torrentId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(initialScrollTop);
  const [viewportSize, setViewportSize] = useState({ width: 960, height: 640 });
  const metrics =
    layout === "phone"
      ? { minimumCardWidth: 280, rowHeight: 108, gap: 8 }
      : GRID_METRICS[interfaceSize];
  const focusButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const measure = () => {
      setViewportSize({
        width: element.clientWidth || 960,
        height: element.clientHeight || 640,
      });
    };
    measure();
    element.scrollTop = initialScrollTop;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [initialScrollTop]);

  useEffect(() => {
    focusButtonRef.current?.focus();
  }, [returnFocusId]);

  const columnCount = Math.max(
    1,
    Math.floor(
      (viewportSize.width + metrics.gap) /
        (metrics.minimumCardWidth + metrics.gap),
    ),
  );
  const logicalRowCount = Math.ceil(rows.length / columnCount);
  const firstRow = Math.max(
    0,
    Math.floor(scrollTop / metrics.rowHeight) - OVERSCAN_ROWS,
  );
  const visibleRowCount =
    Math.ceil(viewportSize.height / metrics.rowHeight) + OVERSCAN_ROWS * 2;
  const lastRow = Math.min(logicalRowCount, firstRow + visibleRowCount);
  const rowStyle = {
    "--library-columns": columnCount,
    "--library-grid-gap": `${metrics.gap}px`,
    "--library-row-height": `${metrics.rowHeight}px`,
  } as CSSProperties;

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    onScrollTop(event.currentTarget.scrollTop);
  };

  return (
    <div
      ref={viewportRef}
      className={styles.viewport}
      data-layout={layout}
      role="list"
      aria-label={localizedMessage("inspection.components.library.view.torrent.backed.content.b57b1e1")}
      onScroll={onScroll}
    >
      <div
        className={styles.canvas}
        style={{ height: `${logicalRowCount * metrics.rowHeight}px` }}
      >
        {Array.from({ length: lastRow - firstRow }, (_, offset) => {
          const logicalRow = firstRow + offset;
          const firstItem = logicalRow * columnCount;
          return (
            <div
              key={logicalRow}
              className={styles.gridRow}
              style={{
                ...rowStyle,
                transform: `translateY(${logicalRow * metrics.rowHeight}px)`,
              }}
            >
              {rows
                .slice(firstItem, firstItem + columnCount)
                .map((row, column) => {
                  const position = firstItem + column;
                  const visibleProgress = torrentVisibleProgress(row);
                  const checkingIndeterminate =
                    row.status === "checking" && visibleProgress === null;
                  return (
                    <article
                      key={row.id}
                      className={styles.card}
                      role="listitem"
                      aria-posinset={position + 1}
                      aria-setsize={rows.length}
                      data-current={row.id === currentId}
                    >
                      <button
                        type="button"
                        aria-label={`Open details for ${row.name}`}
                        aria-pressed={row.id === currentId}
                        onClick={() => onActivate(row.id)}
                        data-library-torrent-id={row.id}
                        ref={row.id === returnFocusId ? focusButtonRef : undefined}
                      >
                        <span
                          className={styles.art}
                          data-indeterminate={checkingIndeterminate || undefined}
                          data-full={visibleProgress !== null && visibleProgress >= 1 ? true : undefined}
                          style={waterLevel(visibleProgress)}
                          aria-hidden="true"
                        >
                          <span>{initials(row.name)}</span>
                        </span>
                        <span className={styles.cardBody}>
                          <strong title={row.name}>{row.name}</strong>
                          <span>{availabilityLabel(row)}</span>
                          <span>{formatBytes(row.sizeBytes, dataUnits)}</span>
                        </span>
                        {row.progress === null && row.status !== "checking" ? null : (
                          <span
                            className={styles.progress}
                            data-indeterminate={checkingIndeterminate || undefined}
                            role="progressbar"
                            aria-label={
                              row.status === "checking"
                                ? `${row.name} checking progress: ${checkingStatusLabel(row)}`
                                : `${row.name} download progress`
                            }
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={
                              visibleProgress === null
                                ? undefined
                                : Math.round(visibleProgress * 100)
                            }
                          >
                            {visibleProgress === null ? null : (
                              <span
                                style={{
                                  width: `${Math.round(visibleProgress * 100)}%`,
                                }}
                              />
                            )}
                          </span>
                        )}
                      </button>
                    </article>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface LibraryHistoryRoute {
  readonly torrentId: string | null;
  readonly category: LibraryCategory;
  readonly mode: "media" | "files";
}

function libraryHistoryRoute(state: unknown): LibraryHistoryRoute | null {
  if (typeof state !== "object" || state === null) return null;
  const value = (state as { rstorrentLibrary?: unknown }).rstorrentLibrary;
  if (typeof value !== "object" || value === null) return null;
  const route = value as Partial<LibraryHistoryRoute>;
  if (
    (route.torrentId !== null && typeof route.torrentId !== "string") ||
    !isLibraryCategory(route.category) ||
    (route.mode !== "media" && route.mode !== "files")
  ) {
    return null;
  }
  return route as LibraryHistoryRoute;
}

function withLibraryHistory(
  state: unknown,
  route: LibraryHistoryRoute,
): Record<string, unknown> {
  return {
    ...(typeof state === "object" && state !== null
      ? (state as Record<string, unknown>)
      : {}),
    rstorrentLibrary: route,
  };
}

function isLibraryCategory(value: unknown): value is LibraryCategory {
  return ["all", "recent", "available", "downloading", "archived"].includes(
    String(value),
  );
}

function LibraryEmpty({ message }: { readonly message: string }) {
  return (
    <div className={styles.empty}>
      <span aria-hidden="true">◇</span>
      <strong>{message}</strong>
    </div>
  );
}

function categoryLabel(category: LibraryCategory): string {
  switch (category) {
    case "all":
      return localizedMessage("inspection.components.library.view.all.content");
    case "recent":
      return localizedMessage("inspection.components.library.view.recently.added");
    case "available":
      return localizedMessage("inspection.components.library.view.available.offline");
    case "downloading":
      return localizedMessage("inspection.components.library.view.downloading");
    case "archived":
      return localizedMessage("inspection.components.library.view.archived");
  }
}

function availabilityLabel(row: TorrentRow): string {
  const removal = torrentRemovalLabel(row);
  if (removal !== null) return removal;
  switch (row.status) {
    case "metadata":
      return localizedMessage("inspection.components.library.view.finding.content.details");
    case "downloading":
      return `${formatProgress(row.progress)} downloaded`;
    case "complete":
      return localizedMessage("inspection.components.library.view.available.offline");
    case "paused":
      return `${formatProgress(row.progress)} downloaded · Paused`;
    case "checking":
      return checkingStatusLabel(row);
    case "error":
      return localizedMessage("inspection.components.library.view.content.needs.attention");
  }
}

function emptyMessage(category: LibraryCategory): string {
  switch (category) {
    case "all":
      return localizedMessage("inspection.components.library.view.no.content.sources.yet");
    case "recent":
      return localizedMessage("inspection.components.library.view.no.recently.added.content");
    case "available":
      return localizedMessage("inspection.components.library.view.no.content.is.available.offline");
    case "downloading":
      return localizedMessage("inspection.components.library.view.no.content.is.downloading");
    case "archived":
      return localizedMessage("inspection.components.library.view.no.archived.content");
  }
}

function materializationMessage(materialization: ViewMaterialization): string {
  switch (materialization.status) {
    case "not_requested":
      return localizedMessage("inspection.components.library.view.loading");
    case "loading":
      return localizedMessage("inspection.components.library.view.loading.library.content");
    case "unavailable":
    case "unsupported":
      return materialization.reason;
    case "stale":
    case "ready":
      return localizedMessage("inspection.components.library.view.no.content.sources.yet");
  }
}

function initials(name: string): string {
  const value = name
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
  return value === "" ? "RS" : value;
}

