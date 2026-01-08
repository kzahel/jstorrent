/**
 * Native Controller
 *
 * JSON-based RPC layer between Kotlin/Swift and QuickJS/JSC.
 * Exposes engine functionality via global functions.
 *
 * Three types of functions:
 * - Commands (Kotlin → JS): __jstorrent_cmd_*
 * - Queries (Kotlin → JS): __jstorrent_query_*
 * - Callbacks (JS → Kotlin): __jstorrent_on_*
 */

import type { BtEngine } from '../../core/bt-engine'
import type { Torrent } from '../../core/torrent'
import type { StorageRoot } from '../../storage/types'
import type { ConfigKey } from '../../config'
import { toHex } from '../../utils/buffer'
import type { NativeConfigHub } from './native-config-hub'
import './bindings.d.ts'

/**
 * Helper to calculate total size of a torrent in bytes.
 */
function getTorrentSize(t: Torrent): number {
  if (t.piecesCount === 0) return 0
  return (t.piecesCount - 1) * t.pieceLength + t.lastPieceLength
}

/**
 * Set up the controller commands and queries.
 * Called early during initialization, before engine is ready.
 * Commands will check if engine is ready before executing.
 *
 * @param getEngine - Getter function that returns the engine (or null if not ready)
 * @param isReady - Getter function that returns true when engine is fully initialized
 */
export function setupController(getEngine: () => BtEngine | null, isReady: () => boolean): void {
  /**
   * Helper to get engine, logging error if not ready.
   */
  const requireEngine = (caller: string): BtEngine | null => {
    if (!isReady()) {
      console.warn(`[controller] ${caller}: Engine not ready yet`)
      return null
    }
    const engine = getEngine()
    if (!engine) {
      console.warn(`[controller] ${caller}: Engine is null`)
      return null
    }
    return engine
  }

  // ============================================================
  // COMMANDS (Native → JS)
  // ============================================================

  /**
   * Add a torrent from magnet link or base64-encoded .torrent data.
   * Returns a JSON result asynchronously via callback.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_add_torrent = (
    magnetOrBase64: string,
  ): string => {
    const engine = requireEngine('addTorrent')
    if (!engine) {
      return JSON.stringify({ ok: false, error: 'Engine not ready' })
    }

    console.log(
      `[controller] addTorrent called: ${magnetOrBase64.startsWith('magnet:') ? 'magnet link' : 'base64 data'}`,
    )

    // Start async operation
    ;(async () => {
      try {
        let result: { torrent: Torrent | null; isDuplicate: boolean }

        if (magnetOrBase64.startsWith('magnet:')) {
          console.log('[controller] Adding magnet link...')
          result = await engine.addTorrent(magnetOrBase64)
        } else {
          // Assume base64-encoded .torrent file
          console.log('[controller] Adding base64 torrent file...')
          const binary = atob(magnetOrBase64)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
          }
          result = await engine.addTorrent(bytes)
        }

        if (result.torrent) {
          console.log(
            `[controller] Torrent added: ${result.torrent.name || 'unnamed'}, isDuplicate=${result.isDuplicate}`,
          )
        } else {
          console.log('[controller] Torrent was null (duplicate or error)')
        }
      } catch (e) {
        console.error('[controller] addTorrent error:', e)
        __jstorrent_on_error(JSON.stringify({ error: String(e) }))
      }
    })()

    // Return immediately - actual result comes via state push
    return JSON.stringify({ ok: true, pending: true })
  }

  /**
   * Pause a torrent.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_pause = (infoHash: string): void => {
    const engine = requireEngine('pause')
    if (!engine) return
    const torrent = engine.getTorrent(infoHash)
    if (torrent) {
      torrent.userStop() // Use userStop() to update userState and persist
    }
  }

  /**
   * Resume a torrent.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_resume = (infoHash: string): void => {
    const engine = requireEngine('resume')
    if (!engine) return
    const torrent = engine.getTorrent(infoHash)
    torrent?.userStart() // Use userStart() to update userState and persist
  }

  /**
   * Remove a torrent.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_remove = (
    infoHash: string,
    deleteFiles: boolean,
  ): void => {
    const engine = requireEngine('remove')
    if (!engine) return
    const torrent = engine.getTorrent(infoHash)
    if (torrent) {
      if (deleteFiles) {
        engine.removeTorrentWithData(torrent).catch((e) => {
          __jstorrent_on_error(JSON.stringify({ error: String(e) }))
        })
      } else {
        engine.removeTorrent(torrent).catch((e) => {
          __jstorrent_on_error(JSON.stringify({ error: String(e) }))
        })
      }
    }
  }

  // ============================================================
  // ROOT MANAGEMENT (Native → JS)
  // ============================================================

  /**
   * Add a storage root at runtime.
   * Call this when user selects a new SAF folder.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_add_root = (
    key: string,
    label: string,
    path: string,
  ): void => {
    const engine = requireEngine('add_root')
    if (!engine) return
    engine.storageRootManager.addRoot({ key, label, path })
    console.log(`[controller] Added root: ${key} -> ${label}`)
  }

  /**
   * Set the default storage root.
   * New torrents will use this root unless explicitly assigned.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_set_default_root = (
    key: string,
  ): void => {
    const engine = requireEngine('set_default_root')
    if (!engine) return
    try {
      engine.storageRootManager.setDefaultRoot(key)
      console.log(`[controller] Set default root: ${key}`)
    } catch (e) {
      console.error(`[controller] Failed to set default root: ${e}`)
    }
  }

  /**
   * Remove a storage root.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_remove_root = (key: string): void => {
    const engine = requireEngine('remove_root')
    if (!engine) return
    engine.storageRootManager.removeRoot(key)
    console.log(`[controller] Removed root: ${key}`)
  }

  // ============================================================
  // CONFIG MANAGEMENT (Native → JS)
  // ============================================================

  /**
   * Set a config value from native layer.
   * Called by Kotlin ConfigBridge.
   *
   * @param key - Config key (e.g., "downloadSpeedLimit")
   * @param valueJson - JSON-encoded value
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_config_set = (
    key: string,
    valueJson: string,
  ): void => {
    const engine = requireEngine('config_set')
    if (!engine) return
    if (!engine.config) {
      console.warn('[controller] config_set called but no ConfigHub configured')
      return
    }
    try {
      const value = JSON.parse(valueJson)
      engine.config.set(key as ConfigKey, value)
      console.log(`[controller] Config set: ${key} = ${valueJson}`)
    } catch (e) {
      console.error(`[controller] Failed to set config ${key}:`, e)
    }
  }

  /**
   * Batch set multiple config values at once.
   * Called by Kotlin ConfigBridge.
   *
   * @param updatesJson - JSON object of key-value pairs
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_config_batch = (
    updatesJson: string,
  ): void => {
    const engine = requireEngine('config_batch')
    if (!engine) return
    if (!engine.config) {
      console.warn('[controller] config_batch called but no ConfigHub configured')
      return
    }
    try {
      const updates = JSON.parse(updatesJson)
      engine.config.batch(updates)
      console.log(`[controller] Config batch update: ${Object.keys(updates).length} keys`)
    } catch (e) {
      console.error('[controller] Failed to batch update config:', e)
    }
  }

  /**
   * Push storage roots from Kotlin (RootStore is source of truth).
   * Called when roots change on native side.
   *
   * @param rootsJson - JSON array of StorageRoot objects
   * @param defaultKey - Default root key (or null/empty)
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_config_set_roots = (
    rootsJson: string,
    defaultKey: string | null,
  ): void => {
    const engine = requireEngine('config_set_roots')
    if (!engine) return
    if (!engine.config) {
      console.warn('[controller] config_set_roots called but no ConfigHub configured')
      return
    }
    try {
      const roots = JSON.parse(rootsJson) as StorageRoot[]
      const nativeConfig = engine.config as NativeConfigHub
      nativeConfig.setRuntime('storageRoots', roots)
      if (defaultKey) {
        nativeConfig.setRuntime('defaultRootKey', defaultKey)
      }
      console.log(
        `[controller] Storage roots updated: ${roots.length} roots, default=${defaultKey}`,
      )
    } catch (e) {
      console.error('[controller] Failed to set storage roots:', e)
    }
  }

  /**
   * Set logging level for debugging.
   * Valid levels: 'debug' | 'info' | 'warn' | 'error'
   * Optionally filter by components or include specific hashes.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_set_log_level = (
    level: string,
    componentsJson?: string,
  ): void => {
    const engine = requireEngine('set_log_level')
    if (!engine) return

    const validLevels = ['debug', 'info', 'warn', 'error']
    if (!validLevels.includes(level)) {
      console.warn(`[controller] Invalid log level: ${level}`)
      return
    }

    let components: string[] | undefined
    if (componentsJson) {
      try {
        components = JSON.parse(componentsJson)
      } catch {
        console.warn(`[controller] Invalid components JSON: ${componentsJson}`)
      }
    }

    engine.setLoggingConfig({
      level: level as 'debug' | 'info' | 'warn' | 'error',
      includeComponents: components,
    })
    console.log(`[controller] Log level set to: ${level}${components ? `, components: ${components.join(',')}` : ''}`)
  }

  /**
   * Add test torrent with local peer hints for debugging.
   * 1GB deterministic test data - run `pnpm seed-for-test` on host to seed.
   * Peer hints: 10.0.2.2 (emulator->host), 127.0.0.1 (desktop/extension).
   * Uses v1 infohash (SHA1 of full info dict), not truncated v2 hash.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_add_test_torrent = (): string => {
    const engine = requireEngine('add_test_torrent')
    if (!engine) {
      return JSON.stringify({ ok: false, error: 'Engine not ready' })
    }

    const testMagnet =
      'magnet:?xt=urn:btih:18a7aacab6d2bc518e336921ccd4b6cc32a9624b&dn=testdata_1gb.bin&x.pe=10.0.2.2:6881&x.pe=127.0.0.1:6881'
    console.log('[controller] Adding test torrent with peer hint...')
    ;(async () => {
      try {
        const result = await engine.addTorrent(testMagnet)
        if (result.torrent) {
          console.log(`[controller] Test torrent added: ${result.torrent.name || 'unnamed'}`)
        }
      } catch (e) {
        console.error('[controller] addTestTorrent error:', e)
        __jstorrent_on_error(JSON.stringify({ error: String(e) }))
      }
    })()
    return JSON.stringify({ ok: true, pending: true })
  }

  // ============================================================
  // QUERIES (Native → JS) - Returns JSON
  // ============================================================

  /**
   * Get the list of all torrents with summary info.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_query_torrent_list = (): string => {
    const engine = requireEngine('query_torrent_list')
    if (!engine) {
      return JSON.stringify({ torrents: [] })
    }
    return JSON.stringify({
      torrents: engine.torrents.map((t) => ({
        infoHash: toHex(t.infoHash),
        name: t.name,
        progress: t.progress,
        downloadSpeed: t.downloadSpeed,
        uploadSpeed: t.uploadSpeed,
        status: t.activityState,
        size: getTorrentSize(t),
        downloaded: t.totalDownloaded,
        uploaded: t.totalUploaded,
        peersConnected: t.peers.length,
      })),
    })
  }

  /**
   * Get the file list for a specific torrent.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_query_files = (infoHash: string): string => {
    const engine = requireEngine('query_files')
    if (!engine) {
      return JSON.stringify({ files: [] })
    }
    const torrent = engine.getTorrent(infoHash)
    if (!torrent || !torrent.files) {
      return JSON.stringify({ files: [] })
    }

    return JSON.stringify({
      files: torrent.files.map((f, index) => ({
        index,
        path: f.path,
        size: f.length,
        downloaded: f.downloaded,
        progress: f.length > 0 ? f.downloaded / f.length : 0,
      })),
    })
  }

  /**
   * Get the tracker list for a specific torrent.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_query_trackers = (infoHash: string): string => {
    const engine = requireEngine('query_trackers')
    if (!engine) {
      return JSON.stringify({ trackers: [] })
    }
    const torrent = engine.getTorrent(infoHash)
    if (!torrent) {
      return JSON.stringify({ trackers: [] })
    }

    const stats = torrent.getTrackerStats()
    return JSON.stringify({
      trackers: stats.map((t) => ({
        url: t.url,
        type: t.type,
        status: t.status, // 'idle' | 'announcing' | 'ok' | 'error'
        seeders: t.seeders,
        leechers: t.leechers,
        lastError: t.lastError,
      })),
    })
  }

  /**
   * Get the peer list for a specific torrent.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_query_peers = (infoHash: string): string => {
    const engine = requireEngine('query_peers')
    if (!engine) {
      return JSON.stringify({ peers: [] })
    }
    const torrent = engine.getTorrent(infoHash)
    if (!torrent) {
      return JSON.stringify({ peers: [] })
    }

    const displayPeers = torrent.getDisplayPeers()
    return JSON.stringify({
      peers: displayPeers.map((p) => ({
        key: p.key,
        ip: p.ip,
        port: p.port,
        state: p.state,
        downloadSpeed: p.connection?.downloadSpeed ?? 0,
        uploadSpeed: p.connection?.uploadSpeed ?? 0,
        progress: p.connection?.bitfield
          ? p.connection.bitfield.count() / p.connection.bitfield.size
          : 0,
        isEncrypted: p.connection?.isEncrypted ?? false,
        clientName: p.swarmPeer?.clientName ?? null,
      })),
    })
  }

  /**
   * Get detailed swarm stats for debugging peer connection issues.
   * Shows all peers in swarm with their connection state and history.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_query_swarm_debug = (infoHash: string): string => {
    const engine = requireEngine('query_swarm_debug')
    if (!engine) {
      return JSON.stringify({ error: 'Engine not ready' })
    }
    const torrent = engine.getTorrent(infoHash)
    if (!torrent) {
      return JSON.stringify({ error: 'Torrent not found' })
    }

    const swarmStats = torrent.swarm
    const allPeers = torrent.swarmPeersArray

    return JSON.stringify({
      stats: swarmStats,
      peers: allPeers.map((p: import('../../core/swarm').SwarmPeer) => ({
        key: `${p.ip}:${p.port}`,
        ip: p.ip,
        port: p.port,
        family: p.family,
        source: p.source,
        state: p.state,
        connectAttempts: p.connectAttempts,
        connectFailures: p.connectFailures,
        lastConnectAttempt: p.lastConnectAttempt,
        lastConnectSuccess: p.lastConnectSuccess,
        lastConnectError: p.lastConnectError,
        quickDisconnects: p.quickDisconnects,
        banReason: p.banReason,
        suspiciousPort: p.suspiciousPort,
        countryCode: p.countryCode,
        totalDownloaded: p.totalDownloaded,
      })),
    })
  }
}

/**
 * Start the state push loop.
 * Pushes compact state to native layer every 500ms (only if changed).
 */
export function startStatePushLoop(engine: BtEngine): () => void {
  let lastPushedState = ''

  const pushState = (): void => {
    try {
      const state = JSON.stringify({
        torrents: engine.torrents.map((t) => ({
          infoHash: toHex(t.infoHash),
          name: t.name,
          progress: t.progress,
          downloadSpeed: t.downloadSpeed,
          uploadSpeed: t.uploadSpeed,
          status: t.activityState,
        })),
      })

      // Only push if changed
      if (state !== lastPushedState) {
        __jstorrent_on_state_update(state)
        lastPushedState = state
      }
    } catch (e) {
      // Push error to native layer
      __jstorrent_on_error(JSON.stringify({ error: String(e) }))
    }
  }

  // Push every 500ms
  const intervalId = setInterval(pushState, 500)

  // Also push immediately on torrent events
  const handleTorrentAdded = (): void => pushState()
  const handleTorrentRemoved = (): void => pushState()

  engine.on('torrentAdded', handleTorrentAdded)
  engine.on('torrentRemoved', handleTorrentRemoved)

  // Initial push
  pushState()

  // Return cleanup function
  return () => {
    clearInterval(intervalId)
    engine.off('torrentAdded', handleTorrentAdded)
    engine.off('torrentRemoved', handleTorrentRemoved)
  }
}
