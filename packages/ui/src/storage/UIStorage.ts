/**
 * Simple storage interface for UI persistence.
 * Can be swapped for chrome.storage or other backends later.
 */
export interface UIStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Default implementation using localStorage */
class LocalStorageAdapter implements UIStorage {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      // Ignore quota errors
    }
  }

  removeItem(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      // Ignore errors
    }
  }
}

/** The active storage instance - swap this to change backends */
export const uiStorage: UIStorage = new LocalStorageAdapter()
