import { message as localizedMessage } from "../../localization/runtime";
import {
  createContext,
  isValidElement,
  useContext,
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
import { useNarrowViewport } from "../layout";
import { createPortal } from "react-dom";
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
  /**
   * Where the column appears when a narrow viewport renders the table as a
   * list. Columns without a role are left out of the list; the first column
   * is the title unless another column claims it.
   */
  readonly listRole?: VirtualListRole;
  /** Detail label in the list; null shows the value alone. */
  readonly listLabel?: string | null;
  readonly render: (row: Row) => ReactNode;
}

/**
 * List item lines: the title with an optional trailing value, a subtitle,
 * a full-width line such as a progress bar, and labelled details.
 */
export type VirtualListRole = "title" | "trailing" | "subtitle" | "wide" | "detail";

export interface VirtualTableProps<Row> {
  readonly tableId: string;
  readonly label: string;
  readonly rows: readonly Row[];
  readonly getRowId: (row: Row) => string;
  readonly columns: readonly VirtualColumn<Row>[];
  readonly interfaceSize: InterfaceSize;
  readonly overscan?: number;
  /** Reserve fixed virtual-row space when a column renders multiple list lines. */
  readonly additionalListLines?: number;
  readonly currentRowId?: string | null;
  readonly selection?: VirtualTableSelection<Row>;
  readonly contextMenu?: VirtualTableContextMenu<Row>;
  readonly onActivate?: (row: Row) => void;
  readonly onClearCurrent?: () => void;
  readonly emptyMessage: string;
  /**
   * The rows have not arrived yet (Tactical 352): placeholder rows stand in
   * for them, and the empty message is announced only to assistive
   * technology. Ignored once there are rows.
   */
  readonly loading?: boolean;
  /** Optional control under the empty message, such as clearing a filter. */
  readonly emptyAction?: ReactNode;
  /** Names the row count, such as "3 torrents"; defaults to rows. */
  readonly formatCount?: (count: number) => string;
  readonly initialSort?: { readonly columnId: string; readonly direction: "asc" | "desc" };
  /**
   * The caller sorts the rows, as for one page of a host-sorted result:
   * headers report the chosen sort and the table keeps the given order.
   * Sortable columns still declare a sortValue.
   */
  readonly externalSort?: {
    readonly sort: { readonly columnId: string; readonly direction: "asc" | "desc" } | null;
    readonly onChange: (
      sort: { readonly columnId: string; readonly direction: "asc" | "desc" } | null,
    ) => void;
  };
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

/**
 * Where a surrounding bar wants the table's count, selection and column
 * or sort controls, so they share its row instead of adding one. Bars too
 * narrow to hold them provide null.
 */
export const TableToolbarSlot = createContext<HTMLElement | null>(null);

/**
 * Stored layouts of any version are read field by field, and a layout is
 * written only after the user changes it, keeping columns and fields this
 * version does not know (Tactical 358's preference-store rule).
 */
const TABLE_CONFIG_VERSION = 1;
/** How long rows keep their order after the user last touched the table. */
const ORDER_HOLD_MS = 2000;

export function VirtualTable<Row>({
  tableId,
  label,
  rows,
  getRowId,
  columns,
  interfaceSize,
  overscan = 8,
  additionalListLines = 0,
  currentRowId = null,
  selection,
  contextMenu,
  onActivate,
  onClearCurrent,
  emptyMessage,
  loading = false,
  emptyAction,
  formatCount,
  initialSort,
  externalSort,
}: VirtualTableProps<Row>) {
  const metrics = INTERFACE_METRICS[interfaceSize];
  const list = useNarrowViewport();
  const toolbarSlot = useContext(TableToolbarSlot);
  const listLayout = useMemo(() => listLayoutFor(columns), [columns]);
  // A list has no header row, and each item stacks its lines in one row.
  const tableHeaderHeight = list ? 0 : metrics.tableHeaderHeight;
  const tableRowHeight = list
    ? listRowHeight(listLayout, metrics.tableRowHeight, additionalListLines)
    : metrics.tableRowHeight;
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
  const [internalSort, setInternalSort] = useState<SortState | null>(initialSort ?? null);
  const sort = externalSort === undefined ? internalSort : externalSort.sort;
  const setSort = (next: SortState | null) => {
    if (externalSort === undefined) setInternalSort(next);
    else externalSort.onChange(next);
  };
  const [contextOpenRowId, setContextOpenRowId] = useState<string | null>(null);
  // Live updates re-sort the rows, except while the user is interacting with
  // the table, so a row does not move out from under a pending click.
  const [recentActivity, setRecentActivity] = useState(false);
  const activityTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [heldOrder, setHeldOrder] = useState<readonly string[] | null>(null);
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
      if (activityTimerRef.current !== null) {
        globalThis.clearTimeout(activityTimerRef.current);
      }
    },
    [],
  );

  // Callers pass initialSort inline, so depend on its values rather than its
  // identity; otherwise every live update would reload the configuration.
  const initialSortColumnId = initialSort?.columnId;
  const initialSortDirection = initialSort?.direction;
  // The layout as last loaded or saved; only a different layout is written.
  const persistedLayoutRef = useRef<string | null>(null);
  useEffect(() => {
    const loaded = loadTableConfig(tableId, columns);
    const layout: PersistedTableConfig = {
      hiddenColumns: loaded?.hiddenColumns ?? defaultHiddenColumns(columns),
      widths: loaded?.widths ?? {},
      sort:
        loaded?.sort ??
        (initialSortColumnId === undefined || initialSortDirection === undefined
          ? null
          : { columnId: initialSortColumnId, direction: initialSortDirection }),
    };
    persistedLayoutRef.current = layoutKey(tableId, layout);
    setHiddenColumns(layout.hiddenColumns);
    setColumnWidths(layout.widths);
    setInternalSort(layout.sort);
    setHeldOrder(null);
  }, [columns, initialSortColumnId, initialSortDirection, tableId]);

  useEffect(() => {
    const layout: PersistedTableConfig = {
      hiddenColumns,
      widths: columnWidths,
      sort: internalSort,
    };
    const key = layoutKey(tableId, layout);
    if (persistedLayoutRef.current === null || key === persistedLayoutRef.current) return;
    persistedLayoutRef.current = key;
    saveTableConfig(tableId, columns, layout);
  }, [columnWidths, columns, hiddenColumns, internalSort, tableId]);

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
  const externallySorted = externalSort !== undefined;
  const { sortedRows, orderHeld } = useMemo(() => {
    if (sort === null || externallySorted) return { sortedRows: rows, orderHeld: false };
    const column = columns.find((candidate) => candidate.id === sort.columnId);
    if (column?.sortValue === undefined) {
      return { sortedRows: rows, orderHeld: false };
    }
    const liveRows = sortRows(rows, getRowId, column, sort.direction);
    if (heldOrder === null) return { sortedRows: liveRows, orderHeld: false };
    const byId = new Map(rows.map((row) => [getRowId(row), row]));
    const retained = heldOrder
      .map((id) => byId.get(id))
      .filter((row): row is Row => row !== undefined);
    const retainedIds = new Set(retained.map(getRowId));
    const held = [
      ...retained,
      ...liveRows.filter((row) => !retainedIds.has(getRowId(row))),
    ];
    return {
      sortedRows: held,
      orderHeld: held.some((row, index) => row !== liveRows[index]),
    };
  }, [columns, externallySorted, getRowId, heldOrder, rows, sort]);

  const holdingOrder = recentActivity || contextOpenRowId !== null;
  useEffect(() => {
    if (!holdingOrder) setHeldOrder(null);
    else if (heldOrder === null) setHeldOrder(sortedRows.map(getRowId));
  }, [getRowId, heldOrder, holdingOrder, sortedRows]);

  const noteActivity = () => {
    setRecentActivity(true);
    if (activityTimerRef.current !== null) {
      globalThis.clearTimeout(activityTimerRef.current);
    }
    activityTimerRef.current = globalThis.setTimeout(() => {
      activityTimerRef.current = null;
      setRecentActivity(false);
    }, ORDER_HOLD_MS);
  };

  const endActivity = () => {
    if (activityTimerRef.current !== null) {
      globalThis.clearTimeout(activityTimerRef.current);
      activityTimerRef.current = null;
    }
    setRecentActivity(false);
  };

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
  // A list shows checkboxes only while several rows are selected; a tap
  // then toggles rows rather than opening one.
  const listSelecting =
    list && selection !== undefined && selection.selectedIds.size > 1;
  const showSelectionColumn = list ? listSelecting : selectionAvailable;
  const gridTemplateColumns = list
    ? showSelectionColumn
      ? `${selectionColumnWidth}px minmax(0, 1fr)`
      : "minmax(0, 1fr)"
    : [
        ...(selectionAvailable ? [`${selectionColumnWidth}px`] : []),
        ...visibleColumns.map((column) => `${column.width}px`),
      ].join(" ");
  const minimumWidth = list
    ? 0
    : selectionColumnWidth +
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
    noteActivity();
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
    if (
      selection !== undefined &&
      (event.metaKey || event.ctrlKey || listSelecting)
    ) {
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
    // A requested sort applies at once, even while the order is held.
    setHeldOrder(null);
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

  const placeholders = loading && sortedRows.length === 0;
  const toolbar = (
    <div className={styles.toolbar} data-slotted={toolbarSlot !== null}>
      <span>
        {placeholders
          ? null
          : formatCount === undefined
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
      {list ? (
        <ListSortControl
          columns={columns}
          sort={sort}
          onChange={(next) => {
            setSort(next);
            setHeldOrder(null);
          }}
        />
      ) : (
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
                setHeldOrder(null);
              }}
            >{localizedMessage("inspection.components.virtual.table.reset.table")}</button>
          </AnchoredDialog>
        </AnchoredDialogTrigger>
      )}
    </div>
  );

  return (
    <div
      className={styles.container}
      style={tableStyle}
      data-overflow-left={horizontalOverflow.left}
      data-overflow-right={horizontalOverflow.right}
      data-toolbar-slotted={toolbarSlot !== null}
    >
      {toolbarSlot === null ? toolbar : createPortal(toolbar, toolbarSlot)}
      <div
        ref={viewportRef}
        data-table-id={tableId}
        className={styles.viewport}
        role="grid"
        tabIndex={-1}
        aria-label={label}
        aria-busy={placeholders || undefined}
        aria-rowcount={sortedRows.length + (list ? 0 : 1)}
        aria-colcount={
          (list ? 1 : visibleColumns.length) + (showSelectionColumn ? 1 : 0)
        }
        data-list={list}
        aria-multiselectable={selectionAvailable ? true : undefined}
        onScroll={handleScroll}
        onPointerMove={noteActivity}
        onPointerDown={noteActivity}
        onPointerLeave={(event) => {
          // A touch leaves before its click lands, so only a mouse that
          // moves away releases the order immediately.
          if (event.pointerType === "mouse") endActivity();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) activateBackground();
        }}
        onKeyDown={(event) => {
          noteActivity();
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
      {list ? null : (
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
                  {sorted ? (
                    <span
                      className={styles.sortIndicator}
                      aria-hidden="true"
                      data-held={orderHeld}
                    >
                      {sort.direction === "asc" ? "▲" : "▼"}
                    </span>
                  ) : null}
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
      )}
      {placeholders ? (
        <PlaceholderRows
          count={Math.max(
            3,
            Math.min(12, Math.ceil(viewportSize.height / tableRowHeight)),
          )}
          list={list}
          gridStyle={gridStyle}
          columns={visibleColumns}
          selectionColumn={selection !== undefined && showSelectionColumn}
          status={emptyMessage}
        />
      ) : sortedRows.length === 0 ? (
        <div className={styles.empty} onClick={activateBackground}>
          <div className={styles.emptyContent}>
            <span>{emptyMessage}</span>
            {emptyAction}
          </div>
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
                aria-rowindex={index + (list ? 1 : 2)}
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
                {selection === undefined || !showSelectionColumn ? null : (
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
                {list ? (
                  <ListItem layout={listLayout} row={row} />
                ) : (
                  visibleColumns.map((column) => (
                    <div
                      key={column.id}
                      className={styles.cell}
                      role="gridcell"
                      data-align={column.align ?? "left"}
                    >
                      {column.render(row)}
                    </div>
                  ))
                )}
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

// Varied, fixed bar widths so placeholder rows read as rows of text.
const PLACEHOLDER_WIDTHS = [72, 54, 86, 61, 78, 47, 68, 58];

function PlaceholderRows<Row>({
  count,
  list,
  gridStyle,
  columns,
  selectionColumn,
  status,
}: {
  readonly count: number;
  readonly list: boolean;
  readonly gridStyle: CSSProperties;
  readonly columns: readonly VirtualColumn<Row>[];
  readonly selectionColumn: boolean;
  readonly status: string;
}) {
  const width = (row: number, column: number) =>
    `${PLACEHOLDER_WIDTHS[(row * 3 + column) % PLACEHOLDER_WIDTHS.length]}%`;
  return (
    <div className={styles.placeholders} data-testid="table-placeholders">
      <span className={styles.srOnly} role="status">{status}</span>
      {Array.from({ length: count }, (_, row) => (
        <div
          key={row}
          className={styles.placeholderRow}
          style={list ? undefined : gridStyle}
          aria-hidden="true"
        >
          {list ? (
            <div className={styles.listCell}>
              <span className={styles.placeholderBar} style={{ width: width(row, 0) }} />
              <span
                className={styles.placeholderBar}
                data-secondary="true"
                style={{ width: width(row, 5) }}
              />
            </div>
          ) : (
            <>
              {selectionColumn ? <div className={styles.cell} /> : null}
              {columns.map((column, index) => (
                <div
                  key={column.id}
                  className={styles.cell}
                  data-align={column.align ?? "left"}
                >
                  <span
                    className={styles.placeholderBar}
                    style={{ width: width(row, index) }}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

interface ListLayout<Row> {
  readonly title: VirtualColumn<Row> | undefined;
  readonly trailing: readonly VirtualColumn<Row>[];
  readonly subtitle: readonly VirtualColumn<Row>[];
  readonly wide: readonly VirtualColumn<Row>[];
  readonly detail: readonly VirtualColumn<Row>[];
}

function listLayoutFor<Row>(
  columns: readonly VirtualColumn<Row>[],
): ListLayout<Row> {
  const withRole = (role: VirtualListRole) =>
    columns.filter((column) => column.listRole === role);
  return {
    title: withRole("title")[0] ?? columns[0],
    trailing: withRole("trailing"),
    subtitle: withRole("subtitle"),
    wide: withRole("wide"),
    detail: withRole("detail"),
  };
}

/** One list item: padding plus a line for each role the table uses. */
function listRowHeight<Row>(
  layout: ListLayout<Row>,
  tableRowHeight: number,
  additionalLines: number,
): number {
  const line = Math.round(tableRowHeight * 0.56);
  const lines =
    1 +
    (layout.subtitle.length > 0 || layout.wide.length > 0 ? 1 : 0) +
    (layout.detail.length > 0 ? 1 : 0);
  return (lines + additionalLines) * line + Math.round(tableRowHeight * 0.5);
}

function ListItem<Row>({
  layout,
  row,
}: {
  readonly layout: ListLayout<Row>;
  readonly row: Row;
}) {
  const details = present(layout.detail, row);
  const subtitle = present(layout.subtitle, row);
  return (
    <div className={styles.listCell} role="gridcell">
      <div className={styles.listTitleLine}>
        <span className={styles.listTitle}>{layout.title?.render(row)}</span>
        {layout.trailing.map((column) => (
          <span key={column.id} className={styles.listTrailing}>
            {column.render(row)}
          </span>
        ))}
      </div>
      {subtitle.length === 0 && layout.wide.length === 0 ? null : (
        <div className={styles.listSubtitleLine}>
          {subtitle.length === 0 ? null : (
            <div className={styles.listLine}>
              {subtitle.map(({ column, value }) => (
                <span key={column.id}>{value}</span>
              ))}
            </div>
          )}
          {layout.wide.map((column) => (
            <div key={column.id} className={styles.listWide}>
              {column.render(row)}
            </div>
          ))}
        </div>
      )}
      {layout.detail.length === 0 ? null : (
        <div className={styles.listLine}>
          {details.map(({ column, value }) => {
            const detailLabel =
              column.listLabel === undefined ? column.label : column.listLabel;
            return (
              <span key={column.id}>
                {detailLabel === null ? null : (
                  <span className={styles.listDetailLabel}>{detailLabel} </span>
                )}
                {value}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Absent values are dropped from a list item rather than shown as "—". */
function present<Row>(
  columns: readonly VirtualColumn<Row>[],
  row: Row,
): readonly { readonly column: VirtualColumn<Row>; readonly value: ReactNode }[] {
  return columns
    .map((column) => ({ column, value: column.render(row) }))
    .filter(({ value }) => !absent(value));
}

function absent(value: ReactNode): boolean {
  if (value === null || value === undefined || value === "" || value === "—") {
    return true;
  }
  // A labelled placeholder such as <span aria-label="ETA unavailable">—</span>.
  return (
    isValidElement<{ readonly children?: ReactNode }>(value) &&
    absent(value.props.children)
  );
}

/** Lists have no column headers, so sorting moves to the toolbar. */
function ListSortControl<Row>({
  columns,
  sort,
  onChange,
}: {
  readonly columns: readonly VirtualColumn<Row>[];
  readonly sort: SortState | null;
  readonly onChange: (sort: SortState | null) => void;
}) {
  const sortable = columns.filter(
    (column) => column.sortable !== false && column.sortValue !== undefined,
  );
  if (sortable.length === 0) return null;
  const direction = sort?.direction ?? "asc";
  return (
    <span className={styles.listSort}>
      <select
        aria-label={localizedMessage("inspection.components.virtual.table.sort.by")}
        value={sort?.columnId ?? ""}
        onChange={(event) => {
          const columnId = event.currentTarget.value;
          onChange(columnId === "" ? null : { columnId, direction });
        }}
      >
        <option value="">{localizedMessage("inspection.components.virtual.table.unsorted")}</option>
        {sortable.map((column) => (
          <option key={column.id} value={column.id}>
            {column.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={sort === null}
        aria-label={
          direction === "asc"
            ? localizedMessage("inspection.components.virtual.table.sorted.ascending")
            : localizedMessage("inspection.components.virtual.table.sorted.descending")
        }
        onClick={() =>
          sort === null
            ? undefined
            : onChange({
                columnId: sort.columnId,
                direction: direction === "asc" ? "desc" : "asc",
              })
        }
      >
        {direction === "asc" ? "▲" : "▼"}
      </button>
    </span>
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
    } | null;
    // Any version is read field by field; fields that do not fit are skipped.
    if (typeof value !== "object" || value === null) return null;
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
    return { hiddenColumns, widths, sort };
  } catch {
    return null;
  }
}

function layoutKey(tableId: string, config: PersistedTableConfig): string {
  return JSON.stringify([
    tableId,
    [...config.hiddenColumns].sort(),
    Object.entries(config.widths).sort(([left], [right]) => left.localeCompare(right)),
    config.sort,
  ]);
}

/**
 * Writes the layout, keeping what this version does not own: hidden state and
 * widths of unknown columns (a newer version's), other top-level fields, and
 * a newer version number.
 */
function saveTableConfig<Row>(
  tableId: string,
  columns: readonly VirtualColumn<Row>[],
  config: PersistedTableConfig,
): void {
  try {
    const key = `rstorrent.table.${tableId}`;
    let stored: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(globalThis.localStorage?.getItem(key) ?? "null") as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        stored = parsed as Record<string, unknown>;
      }
    } catch {
      // An unreadable layout has nothing worth keeping.
    }
    const known = new Set(columns.map((column) => column.id));
    const unknownHidden = Array.isArray(stored.hiddenColumns)
      ? stored.hiddenColumns.filter(
          (id): id is string => typeof id === "string" && !known.has(id),
        )
      : [];
    const unknownWidths =
      typeof stored.widths === "object" && stored.widths !== null
        ? Object.fromEntries(
            Object.entries(stored.widths).filter(
              ([id, width]) => !known.has(id) && typeof width === "number",
            ),
          )
        : {};
    const storedVersion =
      typeof stored.version === "number" && Number.isInteger(stored.version)
        ? stored.version
        : 0;
    globalThis.localStorage?.setItem(
      key,
      JSON.stringify({
        ...stored,
        version: Math.max(storedVersion, TABLE_CONFIG_VERSION),
        hiddenColumns: [...config.hiddenColumns, ...unknownHidden],
        widths: { ...unknownWidths, ...config.widths },
        sort: config.sort,
      }),
    );
  } catch {
    // Storage is optional in private/sandboxed browsing contexts.
  }
}
