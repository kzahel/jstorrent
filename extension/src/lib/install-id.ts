const STORAGE_KEY = 'installId'

// Singleton promise to prevent race conditions when multiple callers
// invoke getOrCreateInstallId() before storage is populated
let installIdPromise: Promise<string> | null = null

export function getOrCreateInstallId(): Promise<string> {
  if (!installIdPromise) {
    installIdPromise = (async () => {
      const result = await chrome.storage.local.get(STORAGE_KEY)
      if (result[STORAGE_KEY]) {
        return result[STORAGE_KEY] as string
      }
      const newId = crypto.randomUUID()
      await chrome.storage.local.set({ [STORAGE_KEY]: newId })
      return newId
    })()
  }
  return installIdPromise
}
