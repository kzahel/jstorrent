import { ColumnConfig, ColumnDef } from './types'

const STORAGE_PREFIX = 'jstorrent:columns:'

/**
 * Load column config from sessionStorage.
 */
export function loadColumnConfig<T>(
  storageKey: string,
  defaultColumns: ColumnDef<T>[],
): ColumnConfig {
  try {
    const stored = sessionStorage.getItem(STORAGE_PREFIX + storageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ColumnConfig>
      return {
        visible: parsed.visible ?? defaultColumns.map((c) => c.id),
        widths: parsed.widths ?? {},
      }
    }
  } catch {
    // Ignore parse errors
  }

  return {
    visible: defaultColumns.map((c) => c.id),
    widths: {},
  }
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
