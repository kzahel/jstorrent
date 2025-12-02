import { ColumnConfig, ColumnDef } from './types'

const STORAGE_PREFIX = 'jstorrent:columns:'

/**
 * Load column config from sessionStorage.
 */
export function loadColumnConfig<T>(
  storageKey: string,
  defaultColumns: ColumnDef<T>[],
): ColumnConfig {
  const allColumnIds = defaultColumns.map((c) => c.id)
  const defaultConfig: ColumnConfig = {
    visible: allColumnIds,
    columnOrder: allColumnIds,
    widths: {},
    sortColumn: null,
    sortDirection: 'asc',
    liveSort: false,
  }

  try {
    const stored = sessionStorage.getItem(STORAGE_PREFIX + storageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ColumnConfig>

      // Get visible columns, defaulting to all
      const visible = parsed.visible ?? defaultConfig.visible

      // For columnOrder, use parsed value or derive from visible + hidden columns
      // This handles backward compatibility with old configs that don't have columnOrder
      let columnOrder = parsed.columnOrder
      if (!columnOrder) {
        // Derive order: visible columns first (in their order), then hidden columns in original order
        const hiddenIds = allColumnIds.filter((id) => !visible.includes(id))
        columnOrder = [...visible, ...hiddenIds]
      }

      // Ensure any new columns are added to the order
      for (const id of allColumnIds) {
        if (!columnOrder.includes(id)) {
          columnOrder.push(id)
        }
      }

      return {
        visible,
        columnOrder,
        widths: parsed.widths ?? {},
        sortColumn: parsed.sortColumn ?? null,
        sortDirection: parsed.sortDirection ?? 'asc',
        liveSort: parsed.liveSort ?? false,
      }
    }
  } catch {
    // Ignore parse errors
  }

  return defaultConfig
}

/**
 * Save column config to sessionStorage.
 */
export function saveColumnConfig(storageKey: string, config: ColumnConfig): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(config))
  } catch {
    // Ignore storage errors (quota, etc.)
  }
}

/**
 * Get effective width for a column.
 */
export function getColumnWidth<T>(column: ColumnDef<T>, config: ColumnConfig): number {
  return config.widths[column.id] ?? column.width
}

/**
 * Compare function for sorting rows by a column.
 * Includes tiebreaker on key to prevent jitter when values oscillate.
 */
export function createCompareFunction<T>(
  column: ColumnDef<T>,
  direction: 'asc' | 'desc',
  getKey: (row: T) => string,
): (a: T, b: T) => number {
  return (a: T, b: T) => {
    const aVal = column.getValue(a)
    const bVal = column.getValue(b)

    let result: number
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      result = aVal - bVal
    } else {
      result = String(aVal).localeCompare(String(bVal))
    }

    // Apply direction
    result = direction === 'asc' ? result : -result

    // Tiebreaker: use stable key to prevent jitter
    if (result === 0) {
      result = getKey(a).localeCompare(getKey(b))
    }

    return result
  }
}
