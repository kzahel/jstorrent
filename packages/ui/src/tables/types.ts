/**
 * Column definition for virtualized tables.
 */
export interface ColumnDef<T> {
  /** Unique identifier for this column */
  id: string
  /** Header text */
  header: string
  /** Extract display value from row data */
  getValue: (row: T) => string | number
  /** Initial width in pixels */
  width: number
  /** Minimum width when resizing */
  minWidth?: number
  /** Text alignment */
  align?: 'left' | 'center' | 'right'
  /** If false, column cannot be hidden. Default true. */
  hideable?: boolean
  /** If false, cannot sort by this column. Default true. */
  sortable?: boolean
}

/**
 * Column visibility, width, order, and sort configuration.
 * Persisted to sessionStorage.
 */
export interface ColumnConfig {
  /** Ordered list of visible column IDs */
  visible: string[]
  /** Full column order (visible and hidden) for settings menu display */
  columnOrder: string[]
  /** Column widths (overrides defaults) */
  widths: Record<string, number>
  /** Current sort column ID (null = no sort) */
  sortColumn: string | null
  /** Sort direction */
  sortDirection: 'asc' | 'desc'
  /** Whether live sort is enabled */
  liveSort: boolean
}

/**
 * Props for table mount wrapper (React -> Solid bridge)
 */
export interface TableMountProps<T> {
  /** Function to get current row data */
  getRows: () => T[]
  /** Extract unique key from row */
  getRowKey: (row: T) => string
  /** Column definitions */
  columns: ColumnDef<T>[]
  /** Storage key for column config persistence */
  storageKey: string
  /** Get currently selected row keys (getter to avoid closure issues) */
  getSelectedKeys?: () => Set<string>
  /** Selection change handler */
  onSelectionChange?: (keys: Set<string>) => void
  /** Row click handler */
  onRowClick?: (row: T) => void
  /** Row double-click handler */
  onRowDoubleClick?: (row: T) => void
  /** Row right-click handler - receives row and mouse position */
  onRowContextMenu?: (row: T, x: number, y: number) => void
  /** Row height in pixels */
  rowHeight?: number
  /** Estimated total rows (for virtualization) */
  estimatedRowCount?: number
}
