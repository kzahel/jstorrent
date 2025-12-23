/**
 * Bundle Entry Point
 *
 * This is the entry point for the native engine bundle.
 * It imports polyfills, creates the engine, and sets up the controller.
 */

// Import polyfills first
import './polyfills'

// Import preset and controller
import { createNativeEngine, NativeEngineConfig } from '../../presets/native'
import { setupController, startStatePushLoop } from './controller'
import type { BtEngine } from '../../core/bt-engine'
import type { StorageRoot } from '../../storage/storage-root-manager'

// Global engine instance
let engine: BtEngine | null = null
let stopStatePush: (() => void) | null = null

/**
 * API exposed to native layer via globalThis.jstorrent
 */
const jstorrentApi = {
  /**
   * Initialize the engine with configuration.
   * Must be called before any other methods.
   *
   * Note: This is async but we expose it synchronously to native.
   * The engine will be functional immediately, session restore happens in background.
   */
  init(config: {
    contentRoots: Array<{
      key: string
      label: string
      path?: string
    }>
    defaultContentRoot?: string
    port?: number
  }): void {
    if (engine) {
      throw new Error('Engine already initialized')
    }

    const nativeConfig: NativeEngineConfig = {
      contentRoots: config.contentRoots.map(
        (r): StorageRoot => ({
          key: r.key,
          label: r.label,
          path: r.path ?? '',
        }),
      ),
      defaultContentRoot: config.defaultContentRoot,
      port: config.port,
      startSuspended: true, // Start suspended to restore session first
      onLog: (entry) => {
        // Forward logs to console (which is polyfilled to native)
        const level = entry.level || 'info'
        const message = `[engine] ${entry.message}`
        if (level === 'error') {
          console.error(message)
        } else if (level === 'warn') {
          console.warn(message)
        } else {
          console.log(message)
        }
      },
    }

    engine = createNativeEngine(nativeConfig)
    setupController(engine)

    // Restore session, resume engine, then start state push
    // This ensures proper startup sequence:
    // 1. Engine created in suspended state
    // 2. Session restored (torrents re-added)
    // 3. Engine resumed (networking starts)
    // 4. State push begins (UI reflects correct state)
    ;(async () => {
      try {
        const restored = await engine!.restoreSession()
        if (restored > 0) {
          console.log(`JSTorrent: Restored ${restored} torrents from session`)
        }
      } catch (e) {
        console.error('JSTorrent: Failed to restore session:', e)
      }

      // Resume engine after restoration
      engine!.resume()

      // Start state push AFTER restoration and resume
      stopStatePush = startStatePushLoop(engine!)

      console.log('JSTorrent engine initialized')
    })()
  },

  /**
   * Get the engine instance (for advanced use).
   */
  getEngine(): BtEngine | null {
    return engine
  },

  /**
   * Check if the engine is initialized.
   */
  isInitialized(): boolean {
    return engine !== null
  },

  /**
   * Shutdown the engine.
   */
  async shutdown(): Promise<void> {
    if (stopStatePush) {
      stopStatePush()
      stopStatePush = null
    }

    if (engine) {
      await engine.destroy()
      engine = null
    }

    console.log('JSTorrent engine shut down')
  },
}

// Expose to global scope for native layer
;(globalThis as Record<string, unknown>).jstorrent = jstorrentApi

// Also export for potential module usage
export { jstorrentApi }
export type { NativeEngineConfig }
