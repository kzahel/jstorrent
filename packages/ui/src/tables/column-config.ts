import { uiStorage } from '../storage/UIStorage'
import { ColumnConfig, ColumnDef } from './types'

const STORAGE_PREFIX = 'jstorrent:columns:'
const UI_STATE_KEY = 'jstorrent:uiState'

/**
 * Load column config from storage.
 */
export function loadColumnConfig<T>(
  storageKey: string,
  defaultColumns: ColumnDef<T>[],
): ColumnConfig {
  const allColumnIds = defaultColumns.map((c) => c.id)
  const defaultVisibleIds = defaultColumns.filter((c) => !c.defaultHidden).map((c) => c.id)
  const defaultConfig: ColumnConfig = {
    visible: defaultVisibleIds,
    columnOrder: allColumnIds,
    widths: {},
    sortColumn: null,
    sortDirection: 'asc',
    liveSort: false,
  }

  try {
    const stored = uiStorage.getItem(STORAGE_PREFIX + storageKey)
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

      // Ensure any new columns are added to the order and visibility
      for (const id of allColumnIds) {
        if (!columnOrder.includes(id)) {
          columnOrder.push(id)
          // Add new non-hidden columns to visible list for existing users
          const col = defaultColumns.find((c) => c.id === id)
          if (col && !col.defaultHidden && !visible.includes(id)) {
            visible.push(id)
          }
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
 * Save column config to storage.
 */
export function saveColumnConfig(storageKey: string, config: ColumnConfig): void {
  uiStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(config))
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

/**
 * Clear all UI settings (column configs and UI state).
 * Used for "Reset UI Settings" feature.
 */
export function clearAllUISettings(): void {
  uiStorage.clearByPrefix(STORAGE_PREFIX)
  uiStorage.removeItem(UI_STATE_KEY)
}
