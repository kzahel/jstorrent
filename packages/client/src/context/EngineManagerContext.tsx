import { createContext, useContext, ReactNode } from 'react'
import type { IEngineManager, StorageRoot, FileOperationResult } from '../engine-manager/types'

const EngineManagerContext = createContext<IEngineManager | null>(null)

interface EngineManagerProviderProps {
  manager: IEngineManager
  children: ReactNode
}

/**
 * Provider for engine manager context.
 * Wrap your app with this to make engine manager available via useEngineManager().
 */
export function EngineManagerProvider({ manager, children }: EngineManagerProviderProps) {
  return <EngineManagerContext.Provider value={manager}>{children}</EngineManagerContext.Provider>
}

/**
 * Get the current engine manager.
 * Must be used within an EngineManagerProvider.
 */
export function useEngineManager(): IEngineManager {
  const ctx = useContext(EngineManagerContext)
  if (!ctx) {
    throw new Error('useEngineManager must be used within EngineManagerProvider')
  }
  return ctx
}

/**
 * Check if running in standalone mode (not Chrome extension).
 * Used to disable extension-only features in the UI.
 */
export function useIsStandalone(): boolean {
  return useEngineManager().isStandalone
}

/**
 * File operations interface for platforms that support it.
 */
export interface FileOperations {
  openFile: (torrentHash: string, filePath: string) => Promise<FileOperationResult>
  revealInFolder: (torrentHash: string, filePath: string) => Promise<FileOperationResult>
  openTorrentFolder: (torrentHash: string) => Promise<FileOperationResult>
  getFilePath: (torrentHash: string, filePath: string) => string | null
  pickDownloadFolder: () => Promise<StorageRoot | null>
  removeDownloadRoot: (key: string) => Promise<boolean>
}

/**
 * Get file operations if supported by the current engine manager.
 * Returns null if file operations are not supported (e.g., Android standalone).
 */
export function useFileOperations(): FileOperations | null {
  const manager = useEngineManager()

  if (!manager.supportsFileOperations) {
    return null
  }

  // All these methods are guaranteed to exist when supportsFileOperations is true
  return {
    openFile: manager.openFile!.bind(manager),
    revealInFolder: manager.revealInFolder!.bind(manager),
    openTorrentFolder: manager.openTorrentFolder!.bind(manager),
    getFilePath: manager.getFilePath!.bind(manager),
    pickDownloadFolder: manager.pickDownloadFolder!.bind(manager),
    removeDownloadRoot: manager.removeDownloadRoot!.bind(manager),
  }
}
