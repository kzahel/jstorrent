import { useState, useEffect, useRef, useCallback } from 'react'
import {
  BtEngine,
  DaemonConnection,
  DaemonSocketFactory,
  DaemonFileSystem,
  StorageRootManager,
  toHex,
  Torrent,
  type TorrentUserState,
} from '@jstorrent/engine'
import { JsBridgeSessionStore } from '@jstorrent/engine/adapters/android'

export interface TorrentState {
  id: string
  infohash: string
  name: string
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  status: 'downloading' | 'seeding' | 'paused' | 'checking' | 'error' | 'queued'
  size: number
  downloaded: number
  uploaded: number
  peers: number
  seeds: number
  eta: number | null
}

interface UseEngineResult {
  addMagnet: (magnet: string) => void
  pauseTorrent: (id: string) => void
  resumeTorrent: (id: string) => void
  removeTorrent: (id: string) => void
  torrents: TorrentState[]
  isReady: boolean
  hasDownloadRoot: boolean
  error: string | null
  engine: BtEngine | null
  connection: DaemonConnection | null
}

function mapUserStateToStatus(
  userState: TorrentUserState,
  progress: number,
  hasMetadata: boolean,
  errorMessage?: string,
): TorrentState['status'] {
  if (errorMessage) return 'error'
  if (userState === 'stopped') return 'paused'
  if (userState === 'queued') return 'queued'
  if (!hasMetadata) return 'downloading' // Fetching metadata
  if (progress >= 1) return 'seeding'
  return 'downloading'
}

function torrentToState(t: Torrent): TorrentState {
  const infohash = toHex(t.infoHash)
  const progress = t.progress
  const downloaded = t.totalDownloaded
  const size = t.files.reduce((sum, f) => sum + f.length, 0)
  const downloadSpeed = t.downloadSpeed
  const uploadSpeed = t.uploadSpeed
  const peers = t.numPeers

  // Calculate ETA
  let eta: number | null = null
  if (downloadSpeed > 0 && progress < 1 && size > 0) {
    const remaining = size * (1 - progress)
    eta = remaining / downloadSpeed
  }

  return {
    id: infohash,
    infohash,
    name: t.name || 'Loading metadata...',
    progress,
    downloadSpeed,
    uploadSpeed,
    status: mapUserStateToStatus(t.userState, progress, t.hasMetadata, t.errorMessage),
    size,
    downloaded,
    uploaded: t.totalUploaded,
    peers,
    seeds: 0, // Not easily available from current API
    eta,
  }
}

export function useEngine(config: { daemonUrl: string }): UseEngineResult {
  const [engine, setEngine] = useState<BtEngine | null>(null)
  const [connection, setConnection] = useState<DaemonConnection | null>(null)
  const [torrents, setTorrents] = useState<TorrentState[]>([])
  const [isReady, setIsReady] = useState(false)
  const [hasDownloadRoot, setHasDownloadRoot] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const engineRef = useRef<BtEngine | null>(null)
  const connectionRef = useRef<DaemonConnection | null>(null)

  useEffect(() => {
    let mounted = true
    let pollInterval: ReturnType<typeof setInterval> | null = null

    async function initEngine() {
      try {
        console.log('[useEngine] Initializing with config:', config)

        // Check for download root
        const rootsAvailable = window.RootsBridge?.hasDownloadRoot() ?? false
        if (mounted) setHasDownloadRoot(rootsAvailable)

        // Parse daemon URL to get port and auth token
        const url = new URL(config.daemonUrl)
        const port = parseInt(url.port) || 8765
        const authToken = url.searchParams.get('token') || ''

        // Connect to daemon
        const conn = await DaemonConnection.connect(port, authToken)
        await conn.connectWebSocket()
        connectionRef.current = conn
        if (mounted) setConnection(conn)

        // Set up storage roots from RootsBridge
        const storageRootManager = new StorageRootManager((root) => {
          return new DaemonFileSystem(conn, root.key)
        })

        // Add roots from bridge
        const rootsJson = window.RootsBridge?.getDownloadRoots()
        const roots: Array<{ key: string; label: string; path: string }> = rootsJson
          ? JSON.parse(rootsJson)
          : []
        for (const root of roots) {
          storageRootManager.addRoot(root)
        }

        // Set default root
        const defaultRootKey = window.RootsBridge?.getDefaultRootKey()
        if (defaultRootKey) {
          storageRootManager.setDefaultRoot(defaultRootKey)
        }

        // Create session store
        const sessionStore = new JsBridgeSessionStore()

        // Create engine
        const eng = new BtEngine({
          socketFactory: new DaemonSocketFactory(conn),
          storageRootManager,
          sessionStore,
          port: 6881,
          startSuspended: true,
        })

        if (mounted) {
          engineRef.current = eng
          setEngine(eng)

          // Restore session
          await eng.restoreSession()
          eng.resume()

          // Enable DHT for peer discovery (don't await - bootstrap can take a while)
          eng.setDHTEnabled(true).catch((err) => {
            console.error('[useEngine] DHT failed to start:', err)
          })

          setIsReady(true)

          // Poll for state updates
          pollInterval = setInterval(() => {
            if (engineRef.current) {
              const states = engineRef.current.torrents.map(torrentToState)
              setTorrents(states)
            }
          }, 500)
        }
      } catch (err) {
        console.error('[useEngine] Failed to initialize:', err)
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to start engine')
        }
      }
    }

    initEngine()

    return () => {
      mounted = false
      if (pollInterval) clearInterval(pollInterval)
      if (engineRef.current) {
        engineRef.current.destroy()
        engineRef.current = null
      }
      if (connectionRef.current) {
        connectionRef.current.close()
        connectionRef.current = null
      }
    }
  }, [config.daemonUrl])

  // Watch for root changes
  useEffect(() => {
    const checkRoots = () => {
      const available = window.RootsBridge?.hasDownloadRoot() ?? false
      setHasDownloadRoot(available)
    }

    // Check periodically in case user adds a root
    const interval = setInterval(checkRoots, 2000)
    return () => clearInterval(interval)
  }, [])

  const addMagnet = useCallback(
    (magnet: string) => {
      if (!engine) return
      engine.addTorrent(magnet).catch((err) => {
        console.error('[useEngine] Failed to add magnet:', err)
      })
    },
    [engine],
  )

  const pauseTorrent = useCallback(
    (id: string) => {
      const torrent = engine?.getTorrent(id)
      if (torrent) {
        torrent.userStop()
      }
    },
    [engine],
  )

  const resumeTorrent = useCallback(
    (id: string) => {
      const torrent = engine?.getTorrent(id)
      if (torrent) {
        torrent.userStart().catch((err) => {
          console.error('[useEngine] Failed to resume torrent:', err)
        })
      }
    },
    [engine],
  )

  const removeTorrent = useCallback(
    (id: string) => {
      if (!engine) return
      engine.removeTorrentByHash(id).catch((err) => {
        console.error('[useEngine] Failed to remove torrent:', err)
      })
    },
    [engine],
  )

  return {
    addMagnet,
    pauseTorrent,
    resumeTorrent,
    removeTorrent,
    torrents,
    isReady,
    hasDownloadRoot,
    error,
    engine,
    connection,
  }
}
