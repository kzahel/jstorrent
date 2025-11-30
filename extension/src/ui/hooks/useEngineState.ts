import { useState, useEffect, useCallback } from 'react'
import { Torrent } from '@jstorrent/engine'
import { useEngine } from '../context/EngineContext'

/**
 * Hook for reactive engine state updates.
 * Uses direct heap access + event subscriptions instead of polling.
 */
export function useEngineState() {
  const { engine, loading, error } = useEngine()
  const [, forceUpdate] = useState({})

  // Force re-render on engine events
  const refresh = useCallback(() => {
    forceUpdate({})
  }, [])

  useEffect(() => {
    if (!engine) return

    // Subscribe to engine events that affect UI
    // Actual BtEngine events: 'torrent', 'torrent-complete', 'torrent-removed', 'error'
    const engineEvents = ['torrent', 'torrent-complete', 'torrent-removed', 'error'] as const

    for (const event of engineEvents) {
      engine.on(event, refresh)
    }

    // Also refresh periodically for stats (download/upload rates)
    const interval = setInterval(refresh, 1000)

    return () => {
      for (const event of engineEvents) {
        engine.off(event, refresh)
      }
      clearInterval(interval)
    }
  }, [engine, refresh])

  // Compute global stats by summing from all torrents
  const torrents = engine?.torrents ?? []
  let totalDownloadRate = 0
  let totalUploadRate = 0
  for (const t of torrents) {
    totalDownloadRate += t.downloadSpeed
    totalUploadRate += t.uploadSpeed
  }

  return {
    engine,
    loading,
    error,
    // Direct access to engine data - no serialization!
    torrents,
    globalStats: {
      totalDownloadRate,
      totalUploadRate,
    },
  }
}

/**
 * Hook for a single torrent's state.
 * More efficient for detail views.
 */
export function useTorrentState(infoHash: string) {
  const { engine } = useEngine()
  const [, forceUpdate] = useState({})

  useEffect(() => {
    if (!engine) return

    const refresh = () => forceUpdate({})

    // Subscribe to events for this specific torrent
    const handler = (torrent: Torrent) => {
      // Torrent infoHash is Uint8Array, convert to hex for comparison
      const torrentInfoHash = Array.from(torrent.infoHash)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      if (torrentInfoHash === infoHash) {
        refresh()
      }
    }

    // Torrent events: 'piece', 'progress', 'download', 'upload', 'done', 'stopped'
    engine.on('torrent', handler)
    engine.on('torrent-complete', handler)

    const interval = setInterval(refresh, 1000)

    return () => {
      engine.off('torrent', handler)
      engine.off('torrent-complete', handler)
      clearInterval(interval)
    }
  }, [engine, infoHash])

  return engine?.getTorrent(infoHash) ?? null
}
