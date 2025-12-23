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
import { toHex } from '../../utils/buffer'
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
 * Call this after creating the engine.
 */
export function setupController(engine: BtEngine): void {
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
    const torrent = engine.getTorrent(infoHash)
    torrent?.stop()
  }

  /**
   * Resume a torrent.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_resume = (infoHash: string): void => {
    const torrent = engine.getTorrent(infoHash)
    torrent?.start()
  }

  /**
   * Remove a torrent.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_remove = (
    infoHash: string,
    deleteFiles: boolean,
  ): void => {
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

  /**
   * Add test torrent with local peer hint for debugging.
   * Hardcoded magnet link pointing to local qBittorrent seeder.
   */
  ;(globalThis as Record<string, unknown>).__jstorrent_cmd_add_test_torrent = (): string => {
    const testMagnet =
      'magnet:?xt=urn:btih:68e52e19f423308ba4f330d5a9b7fb68cec36355&dn=remy%20reads%20a%20book.mp4&x.pe=192.168.1.112:6082'
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
    return JSON.stringify({
      torrents: engine.torrents.map((t) => ({
        infoHash: toHex(t.infoHash),
        name: t.name,
        progress: t.progress,
        downloadSpeed: t.downloadSpeed,
        uploadSpeed: t.uploadSpeed,
        status: t.userState,
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
          status: t.userState,
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
