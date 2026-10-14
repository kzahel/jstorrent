import { message as localizedMessage } from "../../localization/runtime";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
  type UIEvent,
} from "react";

import {
  INTERFACE_METRICS,
  type InterfaceSize,
} from "../appearance";
import {
  ActionMenuTrigger,
  AnchoredDialog,
  AnchoredDialogTrigger,
  OverlayButton,
} from "./overlays/AnchoredOverlay";
import styles from "./VirtualTable.module.css";

export interface VirtualColumn<Row> {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly minimumWidth?: number;
  readonly maximumWidth?: number;
  readonly defaultVisible?: boolean;
  readonly align?: "left" | "right" | "center";
  readonly sortable?: boolean;
  readonly sortValue?: (row: Row) => string | number | null;
  readonly sortKind?: "text" | "number" | "decimal";
  readonly sortOrder?: readonly string[];
  readonly headerHelp?: ReactNode;
  readonly headerHelpWidth?: number;
  readonly render: (row: Row) => ReactNode;
}

export interface VirtualTableProps<Row> {
  readonly tableId: string;
  readonly label: string;
  readonly rows: readonly Row[];
  readonly getRowId: (row: Row) => string;
  readonly columns: readonly VirtualColumn<Row>[];
  readonly interfaceSize: InterfaceSize;
  readonly overscan?: number;
  readonly currentRowId?: string | null;
  readonly selection?: VirtualTableSelection<Row>;
  readonly contextMenu?: VirtualTableContextMenu<Row>;
  readonly onActivate?: (row: Row) => void;
  readonly onClearCurrent?: () => void;
  readonly emptyMessage: string;
  /** Names the row count, such as "3 torrents"; defaults to rows. */
  readonly formatCount?: (count: number) => string;
  readonly initialSort?: { readonly columnId: string; readonly direction: "asc" | "desc" };
}

export interface VirtualTableContextMenu<Row> {
  readonly label: string;
  readonly render: (
    row: Row,
    targetIds: readonly string[],
  ) => ReactNode;
}

export interface VirtualTableSelection<Row> {
  readonly selectedIds: ReadonlySet<string>;
  readonly getRowLabel: (row: Row) => string;
  readonly onChange: (
    selectedIds: readonly string[],
    currentRowId: string | null,
  ) => void;
}

interface SortState {
  readonly columnId: string;
  readonly direction: "asc" | "desc";
}

interface HorizontalOverflow {
  readonly left: boolean;
  readonly right: boolean;
}

const TABLE_CONFIG_VERSION = 1;

export function VirtualTable<Row>({
  tableId,
  label,
  rows,
  getRowId,
  columns,
  interfaceSize,
  overscan = 8,
  currentRowId = null,
  selection,
  contextMenu,
  onActivate,
  onClearCurrent,
  emptyMessage,
  formatCount,
  initialSort,
}: VirtualTableProps<Row>) {
  const { tableHeaderHeight, tableRowHeight } =
    INTERFACE_METRICS[interfaceSize];
  const tableStyle = {
    "--ui-table-header-height": `${tableHeaderHeight}px`,
    "--ui-table-row-height": `${tableRowHeight}px`,
  } as CSSProperties;
  const viewportRef = useRef<HTMLDivElement>(null);
  const revealedCurrentRowIdRef = useRef<string | null>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportSize, setViewportSize] = useState({ width: 960, height: 360 });
  const [horizontalOverflow, setHorizontalOverflow] =
    useState<HorizontalOverflow>({
      left: false,
      right: false,
    });
  const [focusIndex, setFocusIndex] = useState(0);
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const [liveSort, setLiveSort] = useState(false);
  const [contextOpenRowId, setContextOpenRowId] = useState<string | null>(null);
  const [frozenOrder, setFrozenOrder] = useState<readonly string[] | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(
    () => loadTableConfig(tableId, columns)?.hiddenColumns ?? defaultHiddenColumns(columns),
  );
  const [columnWidths, setColumnWidths] = useState<Readonly<Record<string, number>>>(
    () => loadTableConfig(tableId, columns)?.widths ?? {},
  );
  const resizeRef = useRef<{
    readonly columnId: string;
    readonly pointerId: number;
    readonly startX: number;
    readonly startWidth: number;
  } | null>(null);
  const longPressRef = useRef<{
    readonly pointerId: number;
    readonly rowId: string;
    readonly startX: number;
    readonly startY: number;
    readonly timer: ReturnType<typeof globalThis.setTimeout>;
  } | null>(null);
  const suppressClickRowRef = useRef<string | null>(null);
  const selectionAnchorIdRef = useRef<string | null>(null);
  const contextTargetRef = useRef<{
    readonly rowId: string;
    readonly targetIds: readonly string[];
  } | null>(null);

  useEffect(
    () => () => {
      const press = longPressRef.current;
      if (press !== null) globalThis.clearTimeout(press.timer);
    },
    [],
  );

  useEffect(() => {
    const loaded = loadTableConfig(tableId, columns);
    setHiddenColumns(loaded?.hiddenColumns ?? defaultHiddenColumns(columns));
    setColumnWidths(loaded?.widths ?? {});
    setSort(loaded?.sort ?? initialSort ?? null);
    setLiveSort(loaded?.liveSort ?? false);
    setFrozenOrder(null);
  }, [columns, initialSort, tableId]);

  useEffect(() => {
    saveTableConfig(tableId, {
      hiddenColumns,
      widths: columnWidths,
      sort,
      liveSort,
    });
  }, [columnWidths, hiddenColumns, liveSort, sort, tableId]);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const measure = () => {
      setViewportSize({
        width: element.clientWidth || 960,
        height: element.clientHeight || 360,
      });
      updateHorizontalOverflow(element, setHorizontalOverflow);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const visibleColumns = useMemo(
    () =>
      columns
        .filter((column) => !hiddenColumns.has(column.id))
        .map((column) => ({
          ...column,
          width: columnWidths[column.id] ?? column.width,
        })),
    [columnWidths, columns, hiddenColumns],
  );
  const sortedRows = useMemo(() => {
    if (sort === null) return rows;
    const column = columns.find((candidate) => candidate.id === sort.columnId);
    if (column?.sortValue === undefined) return rows;
    if (liveSort || frozenOrder === null) {
      return sortRows(rows, getRowId, column, sort.direction);
    }
    const byId = new Map(rows.map((row) => [getRowId(row), row]));
    const retained = frozenOrder
      .map((id) => byId.get(id))
      .filter((row): row is Row => row !== undefined);
    const retainedIds = new Set(retained.map(getRowId));
    return [...retained, ...rows.filter((row) => !retainedIds.has(getRowId(row)))];
  }, [columns, frozenOrder, getRowId, liveSort, rows, sort]);

  useEffect(() => {
    const currentIndex =
      currentRowId === null
        ? -1
        : sortedRows.findIndex((row) => getRowId(row) === currentRowId);
    setFocusIndex((current) =>
      currentIndex >= 0
        ? currentIndex
        : Math.max(0, Math.min(sortedRows.length - 1, current)),
    );
  }, [currentRowId, getRowId, sortedRows]);

  useEffect(() => {
    // Refreshes must not undo manual scrolling away from the current row.
    if (currentRowId === revealedCurrentRowIdRef.current) return;
    revealedCurrentRowIdRef.current = null;
    if (currentRowId === null) return;
    const index = sortedRows.findIndex((row) => getRowId(row) === currentRowId);
    const viewport = viewportRef.current;
    if (index < 0 || viewport === null) return;
    revealedCurrentRowIdRef.current = currentRowId;
    const top = tableHeaderHeight + index * tableRowHeight;
    if (top < viewport.scrollTop + tableHeaderHeight) {
      viewport.scrollTop = Math.max(0, top - tableHeaderHeight);
    } else if (top + tableRowHeight > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = top + tableRowHeight - viewport.clientHeight;
    }
  }, [currentRowId, getRowId, sortedRows, tableHeaderHeight, tableRowHeight]);

  useEffect(() => {
    if (sort === null || liveSort || frozenOrder !== null) return;
    const column = columns.find((candidate) => candidate.id === sort.columnId);
    if (column?.sortValue === undefined) return;
    setFrozenOrder(
      sortRows(rows, getRowId, column, sort.direction).map(getRowId),
    );
  }, [columns, frozenOrder, getRowId, liveSort, rows, sort]);

  const bodyScroll = Math.max(0, scrollTop - tableHeaderHeight);
  const firstIndex = Math.max(
    0,
    Math.floor(bodyScroll / tableRowHeight) - overscan,
  );
  const visibleCount =
    Math.ceil(viewportSize.height / tableRowHeight) + overscan * 2;
  const lastIndex = Math.min(sortedRows.length, firstIndex + visibleCount);
  const renderedRows = sortedRows.slice(firstIndex, lastIndex);

  useEffect(() => {
    const target = contextTargetRef.current;
    if (target === null || contextOpenRowId === null) return;
    const originIsRendered = renderedRows.some(
      (row) => getRowId(row) === target.rowId,
    );
    const currentTargetIds =
      selection?.selectedIds.has(target.rowId) === true
        ? [...selection.selectedIds]
        : [target.rowId];
    if (
      !originIsRendered ||
      !sameStringSet(target.targetIds, currentTargetIds)
    ) {
      contextTargetRef.current = null;
      setContextOpenRowId(null);
    }
  }, [contextOpenRowId, getRowId, renderedRows, selection]);
  const selectionAvailable = selection !== undefined;
  const selectionColumnWidth = selectionAvailable ? 44 : 0;
  const gridTemplateColumns = [
    ...(selectionAvailable ? [`${selectionColumnWidth}px`] : []),
    ...visibleColumns.map((column) => `${column.width}px`),
  ].join(" ");
  const minimumWidth =
    selectionColumnWidth +
    visibleColumns.reduce((sum, column) => sum + column.width, 0);
  const gridStyle = {
    gridTemplateColumns,
    minWidth: `${minimumWidth}px`,
  } satisfies CSSProperties;

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    updateHorizontalOverflow(element, setHorizontalOverflow);
  }, [minimumWidth, tableId, viewportSize.width]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    updateHorizontalOverflow(event.currentTarget, setHorizontalOverflow);
    if (longPressRef.current !== null) {
      globalThis.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  };

  const cancelLongPress = (pointerId: number) => {
    const press = longPressRef.current;
    if (press?.pointerId !== pointerId) return;
    globalThis.clearTimeout(press.timer);
    longPressRef.current = null;
  };

  const startLongPress = (
    event: ReactPointerEvent<HTMLDivElement>,
    row: Row,
    rowId: string,
  ) => {
    if (
      selection === undefined ||
      event.pointerType === "mouse" ||
      event.button !== 0
    ) {
      return;
    }
    if (longPressRef.current !== null) {
      globalThis.clearTimeout(longPressRef.current.timer);
    }
    const pointerId = event.pointerId;
    const timer = globalThis.setTimeout(() => {
      const press = longPressRef.current;
      if (press?.pointerId !== pointerId || press.rowId !== rowId) return;
      longPressRef.current = null;
      suppressClickRowRef.current = rowId;
      toggleRowSelection(row, rowId);
    }, 500);
    longPressRef.current = {
      pointerId,
      rowId,
      startX: event.clientX,
      startY: event.clientY,
      timer,
    };
  };

  const continueLongPress = (event: ReactPointerEvent<HTMLDivElement>) => {
    const press = longPressRef.current;
    if (press?.pointerId !== event.pointerId) return;
    if (
      Math.hypot(event.clientX - press.startX, event.clientY - press.startY) >
      10
    ) {
      cancelLongPress(event.pointerId);
    }
  };

  const activateRow = (
    event: ReactMouseEvent<HTMLDivElement>,
    row: Row,
    rowId: string,
  ) => {
    const suppressedRow = suppressClickRowRef.current;
    if (suppressedRow !== null) {
      suppressClickRowRef.current = null;
      if (suppressedRow === rowId) return;
    }
    if (selection !== undefined && event.shiftKey) {
      replaceSelectionRange(row, rowId, true);
      return;
    }
    if (selection !== undefined && (event.metaKey || event.ctrlKey)) {
      toggleRowSelection(row, rowId);
      return;
    }
    selectOnlyRow(row, rowId);
  };

  const selectOnlyRow = (row: Row, rowId: string) => {
    selectionAnchorIdRef.current = rowId;
    selection?.onChange([rowId], rowId);
    onActivate?.(row);
  };

  const toggleRowSelection = (row: Row, rowId: string) => {
    if (selection === undefined) return;
    selectionAnchorIdRef.current = rowId;
    const next = new Set(selection.selectedIds);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    const nextCurrentId = currentAfterToggle(next, rowId);
    selection.onChange([...next], nextCurrentId);
  };

  const currentAfterToggle = (
    selectedIds: ReadonlySet<string>,
    toggledId: string,
  ): string | null => {
    if (currentRowId !== null && selectedIds.has(currentRowId)) {
      return currentRowId;
    }
    if (currentRowId === null && selectedIds.has(toggledId)) return toggledId;
    const toggledIndex = sortedRows.findIndex(
      (candidate) => getRowId(candidate) === toggledId,
    );
    for (let distance = 1; distance < sortedRows.length; distance += 1) {
      const after = sortedRows[toggledIndex + distance];
      if (after !== undefined && selectedIds.has(getRowId(after))) {
        return getRowId(after);
      }
      const before = sortedRows[toggledIndex - distance];
      if (before !== undefined && selectedIds.has(getRowId(before))) {
        return getRowId(before);
      }
    }
    return selectedIds.values().next().value ?? null;
  };

  const replaceSelectionRange = (
    row: Row,
    rowId: string,
    activateEndpoint: boolean,
  ) => {
    if (selection === undefined) return;
    let anchorId = selectionAnchorIdRef.current;
    let anchorIndex =
      anchorId === null
        ? -1
        : sortedRows.findIndex((candidate) => getRowId(candidate) === anchorId);
    if (anchorIndex < 0 && currentRowId !== null) {
      const currentIndex = sortedRows.findIndex(
        (candidate) => getRowId(candidate) === currentRowId,
      );
      if (currentIndex >= 0) {
        anchorIndex = currentIndex;
        anchorId = currentRowId;
      }
    }
    const clickedIndex = sortedRows.findIndex(
      (candidate) => getRowId(candidate) === rowId,
    );
    if (clickedIndex < 0) return;
    if (anchorIndex < 0) {
      anchorIndex = clickedIndex;
      anchorId = rowId;
    }
    selectionAnchorIdRef.current = anchorId;
    const start = Math.min(anchorIndex, clickedIndex);
    const end = Math.max(anchorIndex, clickedIndex);
    selection.onChange(
      sortedRows.slice(start, end + 1).map(getRowId),
      rowId,
    );
    if (activateEndpoint) onActivate?.(row);
  };

  const activateBackground = () => {
    selection?.onChange([], null);
    onClearCurrent?.();
    viewportRef.current?.focus({ preventScroll: true });
  };

  const collapseSelectionToCurrent = () => {
    if (selection === undefined || currentRowId === null) return;
    selectionAnchorIdRef.current = currentRowId;
    selection.onChange([currentRowId], currentRowId);
  };

  const changeSort = (column: VirtualColumn<Row>) => {
    if (column.sortable === false || column.sortValue === undefined) return;
    const next: SortState = {
      columnId: column.id,
      direction:
        sort?.columnId === column.id && sort.direction === "asc"
          ? "desc"
          : "asc",
    };
    setSort(next);
    setFrozenOrder(sortRows(rows, getRowId, column, next.direction).map(getRowId));
  };

  const moveRowFocus = (nextIndex: number, extendSelection: boolean) => {
    if (sortedRows.length === 0) return;
    const clamped = Math.max(0, Math.min(sortedRows.length - 1, nextIndex));
    const row = sortedRows[clamped];
    if (row === undefined) return;
    const rowId = getRowId(row);
    setFocusIndex(clamped);
    if (extendSelection && selection !== undefined) {
      replaceSelectionRange(row, rowId, true);
    } else {
      selectOnlyRow(row, rowId);
    }
    const viewport = viewportRef.current;
    if (viewport !== null) {
      const fixedHeight = tableHeaderHeight;
      const top = fixedHeight + clamped * tableRowHeight;
      if (top < viewport.scrollTop + fixedHeight) {
        viewport.scrollTop = top - fixedHeight;
      } else if (
        top + tableRowHeight >
        viewport.scrollTop + viewport.clientHeight
      ) {
        viewport.scrollTop =
          top + tableRowHeight - viewport.clientHeight;
      }
      requestAnimationFrame(() => {
        viewport
          .querySelector<HTMLElement>(`[data-row-index="${clamped}"]`)
          ?.focus();
      });
    }
  };

  const resizeColumn = (column: VirtualColumn<Row>, width: number) => {
    const next = Math.round(
      Math.min(
        column.maximumWidth ?? 720,
        Math.max(column.minimumWidth ?? 52, width),
      ),
    );
    setColumnWidths((current) => ({ ...current, [column.id]: next }));
  };

  const startResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    column: VirtualColumn<Row>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      columnId: column.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: column.width,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const continueResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    column: VirtualColumn<Row>,
  ) => {
    const resize = resizeRef.current;
    if (resize?.pointerId !== event.pointerId || resize.columnId !== column.id) return;
    resizeColumn(column, resize.startWidth + event.clientX - resize.startX);
  };

  const stopResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeWithKeyboard = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    column: VirtualColumn<Row>,
  ) => {
    const current = columnWidths[column.id] ?? column.width;
    const next =
      event.key === "ArrowLeft"
        ? current - 12
        : event.key === "ArrowRight"
          ? current + 12
          : event.key === "Home"
            ? (column.minimumWidth ?? 52)
            : event.key === "End"
              ? (column.maximumWidth ?? 720)
              : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    resizeColumn(column, next);
  };

  const configuredVisibleCount = columns.filter(
    (column) => !hiddenColumns.has(column.id),
  ).length;
  const selectedVisibleCount =
    selection === undefined
      ? 0
      : sortedRows.filter((row) =>
          selection.selectedIds.has(getRowId(row)),
        ).length;
  const hiddenSelectedCount =
    selection === undefined
      ? 0
      : Math.max(
          0,
          selection.selectedIds.size - selectedVisibleCount,
        );
  const allVisibleSelected =
    sortedRows.length > 0 && selectedVisibleCount === sortedRows.length;
  const showSelectionSummary =
    selection !== undefined &&
    (selection.selectedIds.size > 1 || hiddenSelectedCount > 0);

  const toggleAllVisibleSelection = () => {
    if (selection === undefined) return;
    const next = new Set(selection.selectedIds);
    for (const row of sortedRows) {
      const rowId = getRowId(row);
      if (allVisibleSelected) next.delete(rowId);
      else next.add(rowId);
    }
    const nextCurrentId =
      currentRowId !== null && next.has(currentRowId)
        ? currentRowId
        : sortedRows
            .map(getRowId)
            .find((rowId) => next.has(rowId)) ??
          next.values().next().value ??
          null;
    selectionAnchorIdRef.current = nextCurrentId;
    selection.onChange([...next], nextCurrentId);
  };

  return (
    <div
      className={styles.container}
      style={tableStyle}
      data-overflow-left={horizontalOverflow.left}
      data-overflow-right={horizontalOverflow.right}
    >
      <div className={styles.toolbar}>
        <span>
          {formatCount === undefined
            ? localizedMessage("common.rows.total", { count: sortedRows.length })
            : formatCount(sortedRows.length)}</span>
        {!showSelectionSummary || selection === undefined ? null : (
          <>
            <strong className={styles.selectionStatus} aria-live="polite">
              {localizedMessage("common.rows.selected", {
                count: selection.selectedIds.size,
                hidden: hiddenSelectedCount,
              })}
            </strong>
            <button
              type="button"
              aria-label={`Done selecting rows in ${label}`}
              onClick={collapseSelectionToCurrent}
            >{localizedMessage("inspection.components.virtual.table.done")}</button>
          </>
        )}
        <AnchoredDialogTrigger key={`columns-${tableId}`}>
          <OverlayButton>{localizedMessage("inspection.components.virtual.table.columns")}</OverlayButton>
          <AnchoredDialog
            className={styles.columnMenu!}
            aria-label={localizedMessage("inspection.components.virtual.table.table.column.settings")}
          >
            <strong>{localizedMessage("inspection.components.virtual.table.visible.columns")}</strong>
            {columns.map((column) => {
              const checked = !hiddenColumns.has(column.id);
              return (
                <label key={column.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={checked && configuredVisibleCount === 1}
                    onChange={(event) => {
                      const next = new Set(hiddenColumns);
                      if (event.currentTarget.checked) next.delete(column.id);
                      else next.add(column.id);
                      setHiddenColumns(next);
                    }}
                  />
                  {column.label}
                </label>
              );
            })}
            <label className={styles.liveSort}>
              <input
                type="checkbox"
                checked={liveSort}
                onChange={(event) => {
                  const enabled = event.currentTarget.checked;
                  if (!enabled && sort !== null) {
                    const column = columns.find((candidate) => candidate.id === sort.columnId);
                    if (column?.sortValue !== undefined) {
                      setFrozenOrder(
                        sortRows(rows, getRowId, column, sort.direction).map(getRowId),
                      );
                    }
                  }
                  setLiveSort(enabled);
                }}
              />{localizedMessage("inspection.components.virtual.table.re.sort.live.updates")}</label>
            <button
              type="button"
              onClick={() => {
                setHiddenColumns(
                  new Set(
                    columns
                      .filter((column) => column.defaultVisible === false)
                      .map((column) => column.id),
                  ),
                );
                setColumnWidths({});
                setSort(initialSort ?? null);
                setLiveSort(false);
                setFrozenOrder(null);
              }}
            >{localizedMessage("inspection.components.virtual.table.reset.table")}</button>
          </AnchoredDialog>
        </AnchoredDialogTrigger>
      </div>
      <div
        ref={viewportRef}
        data-table-id={tableId}
        className={styles.viewport}
        role="grid"
        tabIndex={-1}
        aria-label={label}
        aria-rowcount={sortedRows.length + 1}
        aria-colcount={visibleColumns.length + (selectionAvailable ? 1 : 0)}
        aria-multiselectable={selectionAvailable ? true : undefined}
        onScroll={handleScroll}
        onClick={(event) => {
          if (event.target === event.currentTarget) activateBackground();
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            selection !== undefined &&
            selection.selectedIds.size > 1
          ) {
            event.preventDefault();
            collapseSelectionToCurrent();
            return;
          }
          if (
            event.target instanceof HTMLElement &&
            event.target.closest(
              "button, input, select, textarea, [contenteditable]:not([contenteditable='false']), [role='separator'], [role='dialog'], [role='menu'], [role='menuitem']",
            )
          ) {
            return;
          }
          if (
            event.key.toLowerCase() === "a" &&
            (event.metaKey || event.ctrlKey) &&
            !event.altKey &&
            selection !== undefined
          ) {
            event.preventDefault();
            if (sortedRows.length === 0) return;
            const current = sortedRows.find(
              (row) => getRowId(row) === currentRowId,
            );
            const nextCurrentId = getRowId(current ?? sortedRows[0]!);
            selectionAnchorIdRef.current = nextCurrentId;
            selection.onChange(sortedRows.map(getRowId), nextCurrentId);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            moveRowFocus(focusIndex + 1, event.shiftKey);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveRowFocus(focusIndex - 1, event.shiftKey);
          } else if (event.key === "Home") {
            event.preventDefault();
            moveRowFocus(0, event.shiftKey);
          } else if (event.key === "End") {
            event.preventDefault();
            moveRowFocus(sortedRows.length - 1, event.shiftKey);
          } else if (event.key === "Enter") {
            const row = sortedRows[focusIndex];
            if (row !== undefined) {
              event.preventDefault();
              selectionAnchorIdRef.current = getRowId(row);
              onActivate?.(row);
            }
          } else if (event.key === " ") {
            const row = sortedRows[focusIndex];
            if (row === undefined) return;
            if (selection !== undefined) {
              event.preventDefault();
              const rowId = getRowId(row);
              if (event.shiftKey) replaceSelectionRange(row, rowId, true);
              else toggleRowSelection(row, rowId);
            } else if (onActivate !== undefined) {
              event.preventDefault();
              onActivate(row);
            }
          }
        }}
        data-testid="virtual-table"
      >
      <div className={styles.header} role="row" style={gridStyle}>
        {selection === undefined ? null : (
          <div
            className={styles.selectionHeaderCell}
            role="columnheader"
            aria-label={localizedMessage("inspection.components.virtual.table.selection")}
            onClick={(event) => {
              event.stopPropagation();
              if (event.target === event.currentTarget) {
                selectionAnchorIdRef.current =
                  sortedRows.length === 0 ? null : getRowId(sortedRows[0]!);
                toggleAllVisibleSelection();
              }
            }}
          >
            <SelectionCheckbox
              checked={allVisibleSelected}
              indeterminate={
                selectedVisibleCount > 0 && !allVisibleSelected
              }
              label={
                allVisibleSelected
                  ? localizedMessage("inspection.components.virtual.table.deselect.all.rows")
                  : localizedMessage("inspection.components.virtual.table.select.all.rows")
              }
              onChange={() => {
                selectionAnchorIdRef.current =
                  sortedRows.length === 0 ? null : getRowId(sortedRows[0]!);
                toggleAllVisibleSelection();
              }}
            />
          </div>
        )}
        {visibleColumns.map((column) => {
          const sorted = sort?.columnId === column.id;
          return (
            <div
              key={column.id}
              className={styles.headerCell}
              role="columnheader"
              aria-label={column.label}
              aria-sort={
                sorted
                  ? sort.direction === "asc"
                    ? "ascending"
                    : "descending"
                  : undefined
              }
              data-align={column.align ?? "left"}
            >
              <button
                className={styles.sortButton}
                type="button"
                onClick={() => changeSort(column)}
                disabled={column.sortable === false || column.sortValue === undefined}
              >
                <span>{column.label}</span>
                {sorted ? <span aria-hidden="true">{sort.direction === "asc" ? "▲" : "▼"}</span> : null}
              </button>
              {column.headerHelp !== undefined ? (
                <AnchoredDialogTrigger
                  key={`${tableId}-${column.id}-help`}
                >
                  <OverlayButton
                    className={styles.headerHelpButton!}
                    aria-label={`Explain ${column.label}`}
                  >
                    ?
                  </OverlayButton>
                  <AnchoredDialog
                    className={styles.headerHelpPopover!}
                    aria-label={`${column.label} column help`}
                    style={
                      {
                        "--header-help-width": `${column.headerHelpWidth ?? 352}px`,
                      } as CSSProperties
                    }
                  >
                    {column.headerHelp}
                  </AnchoredDialog>
                </AnchoredDialogTrigger>
              ) : null}
              <div
                className={styles.resizeHandle}
                role="separator"
                aria-label={`Resize ${column.label} column`}
                aria-orientation="vertical"
                aria-valuemin={column.minimumWidth ?? 52}
                aria-valuemax={column.maximumWidth ?? 720}
                aria-valuenow={column.width}
                tabIndex={0}
                onPointerDown={(event) => startResize(event, column)}
                onPointerMove={(event) => continueResize(event, column)}
                onPointerUp={stopResize}
                onPointerCancel={stopResize}
                onKeyDown={(event) => resizeWithKeyboard(event, column)}
              />
            </div>
          );
        })}
      </div>
      {sortedRows.length === 0 ? (
        <div className={styles.empty} onClick={activateBackground}>
          {emptyMessage}
        </div>
      ) : (
        <div
          className={styles.canvas}
          style={{
            height: `${sortedRows.length * tableRowHeight}px`,
            minWidth: `${minimumWidth}px`,
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) activateBackground();
          }}
        >
          {renderedRows.map((row, offset) => {
            const index = firstIndex + offset;
            const rowId = getRowId(row);
            const checked = selection?.selectedIds.has(rowId) ?? false;
            const current = rowId === currentRowId;
            const renderedRow = (
              <div
                key={rowId}
                className={styles.row}
                role="row"
                aria-rowindex={index + 2}
                aria-selected={selectionAvailable ? checked : undefined}
                aria-current={current ? "true" : undefined}
                tabIndex={index === focusIndex ? 0 : -1}
                data-row-index={index}
                data-row-id={rowId}
                data-current={current}
                data-selected={checked}
                style={{
                  ...gridStyle,
                  transform: `translateY(${index * tableRowHeight}px)`,
                }}
                onFocus={(event) => {
                  if (event.target !== event.currentTarget) return;
                  setFocusIndex(index);
                  if (currentRowId === null) selectOnlyRow(row, rowId);
                }}
                onPointerDown={(event) => startLongPress(event, row, rowId)}
                onPointerMove={continueLongPress}
                onPointerUp={(event) => cancelLongPress(event.pointerId)}
                onPointerCancel={(event) => {
                  cancelLongPress(event.pointerId);
                  if (suppressClickRowRef.current === rowId) {
                    suppressClickRowRef.current = null;
                  }
                }}
                onPointerLeave={(event) => cancelLongPress(event.pointerId)}
                onClick={(event) => {
                  setFocusIndex(index);
                  activateRow(event, row, rowId);
                }}
                onContextMenu={
                  contextMenu === undefined
                    ? undefined
                    : (event) => {
                        event.preventDefault();
                        contextTargetRef.current = { rowId, targetIds };
                        prepareContextTarget(event.currentTarget);
                        dispatchContextMenu(
                          contextTriggerRef.current,
                          event.clientX,
                          event.clientY,
                        );
                      }
                }
                onKeyDown={
                  contextMenu === undefined
                    ? undefined
                    : (event) => {
                        if (
                          event.key !== "ContextMenu" &&
                          !(event.key === "F10" && event.shiftKey)
                        ) {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        contextTargetRef.current = { rowId, targetIds };
                        prepareContextTarget(event.currentTarget);
                        const bounds = event.currentTarget.getBoundingClientRect();
                        dispatchContextMenu(
                          contextTriggerRef.current,
                          bounds.left + Math.min(bounds.width / 2, 160),
                          bounds.top + bounds.height / 2,
                        );
                      }
                }
              >
                {selection === undefined ? null : (
                  <div
                    className={styles.selectionCell}
                    role="gridcell"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (event.target === event.currentTarget) {
                        if (event.shiftKey) {
                          replaceSelectionRange(row, rowId, true);
                        } else toggleRowSelection(row, rowId);
                      }
                    }}
                  >
                    <SelectionCheckbox
                      checked={checked}
                      indeterminate={false}
                      label={`${checked ? localizedMessage("inspection.components.virtual.table.deselect") : localizedMessage("inspection.components.virtual.table.select")} ${selection.getRowLabel(row)}`}
                      onChange={() => toggleRowSelection(row, rowId)}
                      onShiftChange={() =>
                        replaceSelectionRange(row, rowId, true)
                      }
                    />
                  </div>
                )}
                {visibleColumns.map((column) => (
                  <div
                    key={column.id}
                    className={styles.cell}
                    role="gridcell"
                    data-align={column.align ?? "left"}
                  >
                    {column.render(row)}
                  </div>
                ))}
              </div>
            );
            const targetIds =
              checked && selection !== undefined
                ? [...selection.selectedIds]
                : [rowId];
            const prepareContextTarget = (target: HTMLDivElement) => {
              setFocusIndex(index);
              target.focus();
              if (!checked && selection !== undefined) {
                selectionAnchorIdRef.current = rowId;
                selection.onChange([rowId], rowId);
              }
            };
            return renderedRow;
          })}
        </div>
      )}
      </div>
      {contextMenu === undefined || sortedRows.length === 0 ? null : (
        <ActionMenuTrigger
          trigger="contextMenu"
          isOpen={contextOpenRowId !== null}
          onOpenChange={(open) => {
            const target = contextTargetRef.current;
            setContextOpenRowId(open ? (target?.rowId ?? null) : null);
            if (open) return;
            contextTargetRef.current = null;
            if (target === null) return;
            requestAnimationFrame(() => {
              if (
                document.querySelector(
                  '[role="dialog"][aria-modal="true"]',
                ) === null
              ) {
                focusContextRow(tableId, target.rowId);
              }
            });
          }}
        >
          <OverlayButton
            ref={contextTriggerRef}
            className={styles.contextMenuTrigger!}
            aria-label={contextMenu.label}
            excludeFromTabOrder
          />
          {renderContextMenu(
            contextMenu,
            sortedRows,
            getRowId,
            contextTargetRef.current,
          )}
        </ActionMenuTrigger>
      )}
    </div>
  );
}

function updateHorizontalOverflow(
  element: HTMLElement,
  setOverflow: Dispatch<SetStateAction<HorizontalOverflow>>,
): void {
  const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
  const next = {
    left: element.scrollLeft > 1,
    right: element.scrollLeft < maximum - 1,
  };
  setOverflow((current) =>
    current.left === next.left && current.right === next.right
      ? current
      : next,
  );
}

function dispatchContextMenu(
  trigger: HTMLElement | null,
  clientX: number,
  clientY: number,
): void {
  if (trigger === null) return;
  trigger.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    }),
  );
}

function renderContextMenu<Row>(
  contextMenu: VirtualTableContextMenu<Row>,
  rows: readonly Row[],
  getRowId: (row: Row) => string,
  target: {
    readonly rowId: string;
    readonly targetIds: readonly string[];
  } | null,
): ReactNode {
  const row =
    rows.find((candidate) => getRowId(candidate) === target?.rowId) ?? rows[0];
  if (row === undefined) return null;
  return contextMenu.render(
    row,
    target?.targetIds ?? [getRowId(row)],
  );
}

function focusContextRow(tableId: string, rowId: string): void {
  const table = Array.from(
    document.querySelectorAll<HTMLElement>("[data-table-id]"),
  ).find((candidate) => candidate.dataset.tableId === tableId);
  const row = Array.from(
    table?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [],
  ).find((candidate) => candidate.dataset.rowId === rowId);
  const current = table?.querySelector<HTMLElement>('[data-current="true"]');
  (row ?? current ?? table)?.focus();
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function SelectionCheckbox({
  checked,
  indeterminate,
  label,
  onChange,
  onShiftChange,
}: {
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly label: string;
  readonly onChange: () => void;
  readonly onShiftChange?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current !== null) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);
  return (
    <input
      ref={inputRef}
      className={styles.selectionCheckbox}
      type="checkbox"
      checked={checked}
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        if (
          event.nativeEvent instanceof MouseEvent &&
          event.nativeEvent.shiftKey &&
          onShiftChange !== undefined
        ) {
          onShiftChange();
        } else onChange();
      }}
    />
  );
}

function sortRows<Row>(
  rows: readonly Row[],
  getRowId: (row: Row) => string,
  column: VirtualColumn<Row>,
  direction: "asc" | "desc",
): Row[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = column.sortValue?.(left) ?? null;
    const rightValue = column.sortValue?.(right) ?? null;
    if (leftValue === null && rightValue === null) {
      return stableIdCompare(getRowId(left), getRowId(right));
    }
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    const compared = comparePresent(leftValue, rightValue, column);
    return compared === 0
      ? stableIdCompare(getRowId(left), getRowId(right))
      : compared * multiplier;
  });
}

function comparePresent<Row>(
  left: string | number,
  right: string | number,
  column: VirtualColumn<Row>,
): number {
  if (column.sortOrder !== undefined) {
    const leftRank = column.sortOrder.indexOf(String(left));
    const rightRank = column.sortOrder.indexOf(String(right));
    if (leftRank !== rightRank) {
      return (leftRank < 0 ? Number.MAX_SAFE_INTEGER : leftRank) -
        (rightRank < 0 ? Number.MAX_SAFE_INTEGER : rightRank);
    }
  }
  if (column.sortKind === "decimal") {
    const leftBigInt = canonicalBigInt(left);
    const rightBigInt = canonicalBigInt(right);
    return leftBigInt < rightBigInt ? -1 : leftBigInt > rightBigInt ? 1 : 0;
  }
  if (column.sortKind === "number" || (typeof left === "number" && typeof right === "number")) {
    return Number(left) - Number(right);
  }
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function canonicalBigInt(value: string | number): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function stableIdCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function defaultHiddenColumns<Row>(
  columns: readonly VirtualColumn<Row>[],
): ReadonlySet<string> {
  return new Set(
    columns
      .filter((column) => column.defaultVisible === false)
      .map((column) => column.id),
  );
}

interface PersistedTableConfig {
  readonly hiddenColumns: ReadonlySet<string>;
  readonly widths: Readonly<Record<string, number>>;
  readonly sort: SortState | null;
  readonly liveSort: boolean;
}

function loadTableConfig<Row>(
  tableId: string,
  columns: readonly VirtualColumn<Row>[],
): PersistedTableConfig | null {
  try {
    const source = globalThis.localStorage?.getItem(`rstorrent.table.${tableId}`);
    if (source === null || source === undefined) return null;
    const value = JSON.parse(source) as {
      version?: number;
      hiddenColumns?: unknown;
      widths?: unknown;
      sort?: unknown;
      liveSort?: unknown;
    };
    if (value.version !== TABLE_CONFIG_VERSION) return null;
    const knownColumns = new Map(columns.map((column) => [column.id, column]));
    let hiddenColumns = Array.isArray(value.hiddenColumns)
      ? new Set(
          value.hiddenColumns.filter(
            (item): item is string =>
              typeof item === "string" && knownColumns.has(item),
          ),
        )
      : new Set<string>();
    if (hiddenColumns.size >= columns.length && columns[0] !== undefined) {
      hiddenColumns = new Set(hiddenColumns);
      hiddenColumns.delete(columns[0].id);
    }
    const rawWidths =
      typeof value.widths === "object" && value.widths !== null
        ? Object.fromEntries(
            Object.entries(value.widths).filter(
              ([id, width]) =>
                knownColumns.has(id) &&
                typeof width === "number" &&
                Number.isFinite(width),
            ),
          )
        : {};
    const widths = Object.fromEntries(
      Object.entries(rawWidths).map(([id, width]) => {
        const column = knownColumns.get(id)!;
        return [
          id,
          Math.round(
            Math.min(
              column.maximumWidth ?? 720,
              Math.max(column.minimumWidth ?? 52, width),
            ),
          ),
        ];
      }),
    );
    const candidateSort: SortState | null =
      typeof value.sort === "object" &&
      value.sort !== null &&
      "columnId" in value.sort &&
      typeof value.sort.columnId === "string" &&
      "direction" in value.sort &&
      (value.sort.direction === "asc" || value.sort.direction === "desc")
        ? { columnId: value.sort.columnId, direction: value.sort.direction }
        : null;
    const sortColumn =
      candidateSort === null ? undefined : knownColumns.get(candidateSort.columnId);
    const sort =
      sortColumn?.sortValue !== undefined && sortColumn.sortable !== false
        ? candidateSort
        : null;
    return {
      hiddenColumns,
      widths,
      sort,
      liveSort: value.liveSort === true,
    };
  } catch {
    return null;
  }
}

function saveTableConfig(tableId: string, config: PersistedTableConfig): void {
  try {
    globalThis.localStorage?.setItem(
      `rstorrent.table.${tableId}`,
      JSON.stringify({
        version: TABLE_CONFIG_VERSION,
        hiddenColumns: [...config.hiddenColumns],
        widths: config.widths,
        sort: config.sort,
        liveSort: config.liveSort,
      }),
    );
  } catch {
    // Storage is optional in private/sandboxed browsing contexts.
  }
}
