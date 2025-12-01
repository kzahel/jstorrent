import { useState, useEffect, useCallback } from 'react'
import { Torrent } from '@jstorrent/engine'
import { useAdapter } from '../context/EngineContext'

/**
 * Hook for reactive engine state updates.
 * Uses direct heap access + event subscriptions instead of polling.
 */
export function useEngineState() {
  const adapter = useAdapter()
  const [, forceUpdate] = useState({})

  // Force re-render on engine events
  const refresh = useCallback(() => {
    forceUpdate({})
  }, [])

  useEffect(() => {
    // Subscribe to engine events that affect UI
    const engineEvents = ['torrent', 'torrent-complete', 'torrent-removed', 'error']

    for (const event of engineEvents) {
      adapter.on(event, refresh)
    }

    // Also refresh periodically for stats (download/upload rates)
    const interval = setInterval(refresh, 1000)

    return () => {
      for (const event of engineEvents) {
        adapter.off(event, refresh)
      }
      clearInterval(interval)
    }
  }, [adapter, refresh])

  // Compute global stats by summing from all torrents
  const torrents = adapter.torrents
  let totalDownloadRate = 0
  let totalUploadRate = 0
  for (const t of torrents) {
    totalDownloadRate += t.downloadSpeed
    totalUploadRate += t.uploadSpeed
  }

  return {
    adapter,
    torrents,
    numConnections: adapter.numConnections,
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
export function useTorrentState(infoHash: string): Torrent | null {
  const adapter = useAdapter()
  const [, forceUpdate] = useState({})

  useEffect(() => {
    const refresh = () => forceUpdate({})

    // Subscribe to events for this specific torrent
    const handler = (torrent: Torrent) => {
      const torrentInfoHash = Array.from(torrent.infoHash)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      if (torrentInfoHash === infoHash) {
        refresh()
      }
    }

    adapter.on('torrent', handler as (...args: unknown[]) => void)
    adapter.on('torrent-complete', handler as (...args: unknown[]) => void)

    const interval = setInterval(refresh, 1000)

    return () => {
      adapter.off('torrent', handler as (...args: unknown[]) => void)
      adapter.off('torrent-complete', handler as (...args: unknown[]) => void)
      clearInterval(interval)
    }
  }, [adapter, infoHash])

  return adapter.getTorrent(infoHash) ?? null
}
