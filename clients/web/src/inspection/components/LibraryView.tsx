import { formatNumber, message as localizedMessage  } from "../../localization/runtime";
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
import type { LayoutMode } from "../layout";
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
import { seedLimitReached } from "../seed-stop";
import { torrentMatchesLibraryCategory } from "../state";
import { Icon } from "./Icon";
import { LibraryDetailView, waterLevel } from "./LibraryDetailView";
import { LibraryMediaView } from "./LibraryMediaView";
import styles from "./LibraryView.module.css";

// Varied, fixed title widths so placeholder cards read as content.
const PLACEHOLDER_WIDTHS = [78, 56, 88, 64, 72, 50];

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
  const materialization = useInspectionStore(
    (state) => state.viewStatus.library,
  );
  // Hosts without the cross-torrent projection keep the torrent cards.
  const mediaLibrary = useInspectionStore(
    (state) => state.viewStatus.libraryMedia.status !== "unsupported",
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
  const [returnFocusItemId, setReturnFocusItemId] = useState<string | null>(null);

  // The route owner may reopen a detail from history; focus returns there.
  useEffect(() => {
    if (detailOpen && currentTorrentId !== null) setReturnFocusId(currentTorrentId);
  }, [currentTorrentId, detailOpen]);

  const openDetail = (torrentId: string) => {
    setReturnFocusId(torrentId);
    openLibraryTorrentDetail(torrentId);
  };

  const closeDetail = closeLibraryTorrentDetail;

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
  if (mediaLibrary) {
    return (
      <LibraryMediaView
        returnFocusItemId={returnFocusItemId}
        onOpenTorrent={(torrentId, itemId) => {
          setReturnFocusItemId(itemId);
          openDetail(torrentId);
        }}
      />
    );
  }

  return (
    <section className={styles.library} aria-labelledby="library-heading">
      <div className={styles.heading}>
        <div>
          <h1 id="library-heading">{categoryLabel(category)}</h1>
          <p>
            {materialization.status === "loading" ? (
              materializationMessage(materialization)
            ) : (
              <>
                {formatNumber(rows.length)}{" "}{localizedMessage("inspection.components.library.view.torrent.backed.content")}{" "}
                {rows.length === 1 ? localizedMessage("inspection.components.library.view.source") : localizedMessage("inspection.components.library.view.sources")}
              </>
            )}
          </p>
        </div>
      </div>
      {materialization.status === "loading" ? (
        <VirtualLibraryGrid
          placeholders
          rows={[]}
          currentId={null}
          interfaceSize={interfaceSize}
          layout={layout}
          dataUnits={dataUnits}
          initialScrollTop={0}
          returnFocusId={null}
          onScrollTop={() => {}}
          onActivate={() => {}}
        />
      ) : materialization.status !== "ready" ? (
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
  placeholders = false,
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
  /** Fill the viewport with placeholder cards until rows arrive (Tactical 352). */
  readonly placeholders?: boolean;
  readonly rows: readonly TorrentRow[];
  readonly currentId: string | null;
  readonly interfaceSize: InterfaceSize;
  readonly layout: LayoutMode;
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
  const visibleGridRows = Math.max(1, Math.ceil(viewportSize.height / metrics.rowHeight));
  const logicalRowCount = placeholders
    ? visibleGridRows
    : Math.ceil(rows.length / columnCount);
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
      aria-busy={placeholders || undefined}
      onScroll={onScroll}
      data-testid={placeholders ? "library-placeholders" : undefined}
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
              {placeholders
                ? Array.from({ length: columnCount }, (_, column) => (
                    <div
                      key={column}
                      className={styles.card}
                      aria-hidden="true"
                    >
                      <div className={styles.placeholderCard}>
                        <span className={styles.art} />
                        <span className={styles.cardBody}>
                          <span
                            className={styles.placeholderBar}
                            style={{ width: `${PLACEHOLDER_WIDTHS[(firstItem + column) % PLACEHOLDER_WIDTHS.length]}%` }}
                          />
                          <span
                            className={styles.placeholderBar}
                            data-secondary="true"
                          />
                        </span>
                      </div>
                    </div>
                  ))
                : rows
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

function LibraryEmpty({ message }: { readonly message: string }) {
  return (
    <div className={styles.empty}>
      <Icon name="library" />
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
      return seedLimitReached(row)
        ? localizedMessage("inspection.components.library.view.available.seed.limit.reached")
        : `${formatProgress(row.progress)} downloaded · Paused`;
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

