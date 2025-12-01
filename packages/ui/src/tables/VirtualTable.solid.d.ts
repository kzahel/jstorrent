import type { ColumnDef } from './types'

export interface VirtualTableProps<T> {
  getRows: () => T[]
  getRowKey: (row: T) => string
  columns: ColumnDef<T>[]
  storageKey: string
  selectedKeys?: Set<string>
  onSelectionChange?: (keys: Set<string>) => void
  onRowClick?: (row: T) => void
  onRowDoubleClick?: (row: T) => void
  rowHeight?: number
}

export function VirtualTable<T>(props: VirtualTableProps<T>): unknown
