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
import { generateMagnet } from '../../utils/magnet'
import type { InfoHashHex } from '../../utils/infohash'
import type { NativeConfigHub } from './native-config-hub'
import type { TrafficCategory } from '../../core/bandwidth-tracker'
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
   * Returns a Promise that resolves when the torrent is added.
   *
   * Can be awaited from Kotlin using callGlobalFunctionAwaitPromise().
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_add_torrent = async (
    magnetOrBase64: string,
  ): Promise<{
    ok: boolean
    infoHash?: string
    name?: string
    isDuplicate?: boolean
    error?: string
  }> => {
    const engine = requireEngine('addTorrent')
    if (!engine) {
      return { ok: false, error: 'Engine not ready' }
    }

    console.log(
      `[controller] addTorrent called: ${magnetOrBase64.startsWith('magnet:') ? 'magnet link' : 'base64 data'}`,
    )

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
        return {
          ok: true,
          infoHash: toHex(result.torrent.infoHash),
          name: result.torrent.name,
          isDuplicate: result.isDuplicate,
        }
      } else {
        console.log('[controller] Torrent was null (duplicate or error)')
        return { ok: true, isDuplicate: true }
      }
    } catch (e) {
      console.error('[controller] addTorrent error:', e)
      __jstorrent_on_error(JSON.stringify({ error: String(e) }))
      return { ok: false, error: String(e) }
    }
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
   * Returns a Promise that resolves when the torrent is fully removed.
   *
   * Can be awaited from Kotlin using callGlobalFunctionAwaitPromise().
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_remove = async (
    infoHash: string,
    deleteFiles: boolean,
  ): Promise<{ ok: boolean; error?: string }> => {
    const engine = requireEngine('remove')
    if (!engine) {
      return { ok: false, error: 'Engine not ready' }
    }

    const torrent = engine.getTorrent(infoHash)
    if (!torrent) {
      // Torrent not found - consider this success (idempotent)
      console.log(`[controller] remove: Torrent not found: ${infoHash}`)
      return { ok: true }
    }

    try {
      if (deleteFiles) {
        await engine.removeTorrentWithData(torrent)
      } else {
        await engine.removeTorrent(torrent)
      }
      console.log(`[controller] Torrent removed: ${infoHash}`)
      return { ok: true }
    } catch (e) {
      console.error('[controller] remove error:', e)
      __jstorrent_on_error(JSON.stringify({ error: String(e) }))
      return { ok: false, error: String(e) }
    }
  }

  /**
   * Set file priorities for a torrent.
   * @param infoHash - The torrent's info hash
   * @param prioritiesJson - JSON object mapping file index (string) to priority (0=Normal, 1=Skip, 2=High)
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_set_file_priorities = (
    infoHash: string,
    prioritiesJson: string,
  ): void => {
    const engine = requireEngine('set_file_priorities')
    if (!engine) return
    const torrent = engine.getTorrent(infoHash)
    if (!torrent) {
      console.warn(`[controller] set_file_priorities: Torrent not found: ${infoHash}`)
      return
    }

    try {
      const priorities = JSON.parse(prioritiesJson) as Record<string, number>
      let applied = 0
      for (const [indexStr, priority] of Object.entries(priorities)) {
        const fileIndex = parseInt(indexStr, 10)
        if (!isNaN(fileIndex) && torrent.setFilePriority(fileIndex, priority)) {
          applied++
        }
      }
      console.log(
        `[controller] set_file_priorities: Applied ${applied}/${Object.keys(priorities).length} priorities for ${infoHash}`,
      )
    } catch (e) {
      console.error('[controller] set_file_priorities error:', e)
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
    console.log(
      `[controller] Log level set to: ${level}${components ? `, components: ${components.join(',')}` : ''}`,
    )
  }

  // ============================================================
  // TICK CONTROL (for host-driven tick mode)
  // ============================================================

  /**
   * Execute one engine tick.
   * Called by Kotlin in host-driven tick mode.
   * Returns timing info for instrumentation.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_engine_tick = (): void => {
    const engine = getEngine()
    if (!engine) return
    engine.tick()
  }

  /**
   * Set tick loop mode.
   * - 'host': Kotlin drives the tick loop (recommended for Android)
   * - 'js': JS owns the tick loop via setInterval (default)
   *
   * In host mode, Kotlin calls __jstorrent_engine_tick() at regular intervals
   * and can measure total time including job pump.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_set_tick_mode = (
    mode: 'js' | 'host',
  ): void => {
    const engine = getEngine()
    if (!engine) {
      console.warn('[controller] set_tick_mode: Engine not ready')
      return
    }
    engine.setTickMode(mode)
  }

  /**
   * Shutdown the engine gracefully.
   * Saves DHT state and stops all torrents before returning.
   * Must be called before closing the JS context.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_shutdown = async (): Promise<void> => {
    const engine = getEngine()
    if (!engine) {
      console.log('[controller] shutdown: Engine already null')
      return
    }
    console.log('[controller] Shutting down engine...')
    await engine.destroy()
    console.log('[controller] Engine shutdown complete')
  }

  /**
   * Add test torrent with local peer hints for debugging.
   * 100MB deterministic test data - run `pnpm seed-for-test` on host to seed.
   * Peer hints: 10.0.2.2 (emulator->host), 127.0.0.1 (desktop/extension).
   * Uses v1 infohash (SHA1 of full info dict), not truncated v2 hash.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_add_test_torrent = (): string => {
    const engine = requireEngine('add_test_torrent')
    if (!engine) {
      return JSON.stringify({ ok: false, error: 'Engine not ready' })
    }

    const testMagnet =
      'magnet:?xt=urn:btih:67d01ece1b99c49c257baada0f760b770a7530b9&dn=testdata_100mb.bin&x.pe=10.0.2.2:6881&x.pe=127.0.0.1:6881'
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
        priority: torrent.filePriorities[index] ?? 0,
      })),
    })
  }

  /**
   * Get the tracker list for a specific torrent.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_query_trackers = (
    infoHash: string,
  ): string => {
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
        lastPeersReceived: t.lastPeersReceived,
        uniquePeersDiscovered: t.uniquePeersDiscovered,
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
        progress:
          p.connection?.bitfield && torrent.piecesCount > 0
            ? p.connection.bitfield.count() / torrent.piecesCount
            : 0,
        isEncrypted: p.connection?.isEncrypted ?? false,
        isIncoming: p.connection?.isIncoming ?? false,
        clientName: p.swarmPeer?.clientName ?? null,
        // Choking/interested states for flag display
        amInterested: p.connection?.amInterested ?? false,
        peerChoking: p.connection?.peerChoking ?? true,
        peerInterested: p.connection?.peerInterested ?? false,
        amChoking: p.connection?.amChoking ?? true,
      })),
    })
  }

  /**
   * Get piece info for a specific torrent.
   * Returns bitfield as hex string for efficient transfer.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_query_pieces = (
    infoHash: string,
  ): string => {
    const engine = requireEngine('query_pieces')
    if (!engine) {
      return JSON.stringify({ error: 'Engine not ready' })
    }
    const torrent = engine.getTorrent(infoHash)
    if (!torrent) {
      return JSON.stringify({ error: 'Torrent not found' })
    }

    return JSON.stringify({
      piecesTotal: torrent.piecesCount,
      piecesCompleted: torrent.completedPiecesCount,
      pieceSize: torrent.pieceLength,
      lastPieceSize: torrent.lastPieceLength,
      bitfield: torrent.bitfield?.toHex() ?? '',
    })
  }

  /**
   * Get detailed torrent metadata for the Details tab.
   * Returns timestamps, size info, and magnet URL.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_query_details = (
    infoHash: string,
  ): string => {
    const engine = requireEngine('query_details')
    if (!engine) {
      return JSON.stringify({ error: 'Engine not ready' })
    }
    const torrent = engine.getTorrent(infoHash)
    if (!torrent) {
      return JSON.stringify({ error: 'Torrent not found' })
    }

    // Generate magnet URL (use stored one if available, otherwise generate)
    const magnetUrl =
      torrent.magnetLink ||
      generateMagnet({
        infoHash: toHex(torrent.infoHash) as InfoHashHex,
        name: torrent.name,
        announce: torrent.announce,
      })

    // Get storage root key for this torrent
    const storageRoot = engine.storageRootManager.getRootForTorrent(infoHash)
    const rootKey = storageRoot?.key ?? null

    return JSON.stringify({
      infoHash: toHex(torrent.infoHash),
      addedAt: torrent.addedAt,
      completedAt: torrent.completedAt ?? null,
      totalSize: getTorrentSize(torrent),
      pieceSize: torrent.pieceLength,
      pieceCount: torrent.piecesCount,
      magnetUrl,
      rootKey,
    })
  }

  /**
   * Get DHT statistics for debugging.
   * Returns null if DHT is not initialized.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_query_dht_stats = (): string => {
    const engine = requireEngine('query_dht_stats')
    if (!engine) {
      return JSON.stringify(null)
    }
    const stats = engine.dhtNode?.getStats() ?? null
    return JSON.stringify(stats)
  }

  /**
   * Get aggregated engine statistics for health monitoring.
   * Includes tick duration, active pieces, and connected peers.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_query_engine_stats = (): string => {
    const engine = requireEngine('query_engine_stats')
    if (!engine) {
      return JSON.stringify({
        tickCount: 0,
        tickTotalMs: 0,
        tickMaxMs: 0,
        tickAvgMs: 0,
        activePieces: 0,
        connectedPeers: 0,
        activeTorrents: 0,
      })
    }
    return JSON.stringify(engine.getEngineStats())
  }

  /**
   * Get UPnP status information.
   * Returns status, external IP if mapped, and the listening port.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_query_upnp_status = (): string => {
    const engine = requireEngine('query_upnp_status')
    if (!engine) {
      return JSON.stringify({
        status: 'disabled',
        externalIP: null,
        port: 0,
        hasReceivedIncomingConnection: false,
      })
    }
    return JSON.stringify({
      status: engine.upnpStatus,
      externalIP: engine.upnpExternalIP,
      port: engine.listeningPort,
      hasReceivedIncomingConnection: engine.hasReceivedIncomingConnection,
    })
  }

  /**
   * Get detailed swarm stats for debugging peer connection issues.
   * Shows all peers in swarm with their connection state and history.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_query_swarm_debug = (
    infoHash: string,
  ): string => {
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

  /**
   * Get speed samples from the bandwidth tracker for graphing.
   * Returns samples with metadata about bucket size.
   *
   * @param direction - 'down' or 'up'
   * @param categoriesJson - JSON array of categories (e.g., '["peer:protocol"]') or "all"
   * @param fromTime - Start timestamp (ms since epoch)
   * @param toTime - End timestamp (ms since epoch)
   * @param maxPoints - Maximum number of data points to return (default 300)
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_query_speed_samples = (
    direction: string,
    categoriesJson: string,
    fromTime: number,
    toTime: number,
    maxPoints: number = 300,
  ): string => {
    const engine = requireEngine('query_speed_samples')
    if (!engine) {
      return JSON.stringify({
        samples: [],
        bucketMs: 1000,
        latestBucketTime: 0,
      })
    }

    // Parse categories
    let categories: TrafficCategory[] | 'all'
    if (categoriesJson === 'all' || categoriesJson === '"all"') {
      categories = 'all'
    } else {
      try {
        categories = JSON.parse(categoriesJson) as TrafficCategory[]
      } catch {
        console.warn(`[controller] query_speed_samples: Invalid categories JSON: ${categoriesJson}`)
        categories = 'all'
      }
    }

    // Validate direction
    const dir = direction === 'up' ? 'up' : 'down'

    const result = engine.bandwidthTracker.getSamplesWithMeta(
      dir,
      categories,
      fromTime,
      toTime,
      maxPoints,
    )

    return JSON.stringify({
      samples: result.samples,
      bucketMs: result.bucketMs,
      latestBucketTime: result.latestBucketTime,
    })
  }
}

/**
 * Start the state push loop.
 * Pushes compact state to native layer every 500ms (only if changed).
 * Tracks piece completions and sends diffs.
 */
export function startStatePushLoop(engine: BtEngine): () => void {
  let lastPushedState = ''

  // Track pending piece changes per torrent (cleared after each push)
  const pendingPieceChanges = new Map<string, Set<number>>()

  // Track piece listeners per torrent for cleanup
  const pieceListeners = new Map<string, (index: number) => void>()

  const setupPieceTracking = (torrent: Torrent): void => {
    const infoHash = toHex(torrent.infoHash)
    if (pieceListeners.has(infoHash)) return

    const listener = (pieceIndex: number): void => {
      let changes = pendingPieceChanges.get(infoHash)
      if (!changes) {
        changes = new Set()
        pendingPieceChanges.set(infoHash, changes)
      }
      changes.add(pieceIndex)
    }

    torrent.on('piece', listener)
    pieceListeners.set(infoHash, listener)
  }

  const cleanupPieceTracking = (torrent: Torrent): void => {
    const infoHash = toHex(torrent.infoHash)
    const listener = pieceListeners.get(infoHash)
    if (listener) {
      torrent.off('piece', listener)
      pieceListeners.delete(infoHash)
    }
    pendingPieceChanges.delete(infoHash)
  }

  const pushState = (): void => {
    try {
      // Collect piece changes and clear pending
      const pieceChanges: Record<string, number[]> = {}
      for (const [infoHash, changes] of pendingPieceChanges) {
        if (changes.size > 0) {
          pieceChanges[infoHash] = Array.from(changes).sort((a, b) => a - b)
          changes.clear()
        }
      }

      const state = JSON.stringify({
        torrents: engine.torrents.map((t) => ({
          infoHash: toHex(t.infoHash),
          name: t.name,
          progress: t.progress,
          downloadSpeed: t.downloadSpeed,
          uploadSpeed: t.uploadSpeed,
          status: t.activityState,
          numPeers: t.numPeers,
          swarmPeers: t.swarm.total,
          skippedFilesCount: t.filePriorities.filter((p) => p === 1).length,
        })),
        pieceChanges: Object.keys(pieceChanges).length > 0 ? pieceChanges : undefined,
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

  // Setup tracking for existing torrents
  for (const torrent of engine.torrents) {
    setupPieceTracking(torrent)
  }

  // Track new torrents
  const handleTorrentAdded = (torrent: Torrent): void => {
    setupPieceTracking(torrent)
    pushState()
  }
  const handleTorrentRemoved = (torrent: Torrent): void => {
    cleanupPieceTracking(torrent)
    pushState()
  }

  engine.on('torrent', handleTorrentAdded)
  engine.on('torrent-removed', handleTorrentRemoved)

  // Initial push
  pushState()

  // Return cleanup function
  return () => {
    clearInterval(intervalId)
    engine.off('torrent', handleTorrentAdded)
    engine.off('torrent-removed', handleTorrentRemoved)
    // Cleanup all piece listeners
    for (const torrent of engine.torrents) {
      cleanupPieceTracking(torrent)
    }
  }
}
