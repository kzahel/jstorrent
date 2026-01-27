import { useState, useEffect, useCallback, useRef } from 'react'
import { getBridge } from '../chrome/extension-bridge'
import type { BootstrapState } from '../../../../extension/src/lib/chromeos-bootstrap'

/**
 * Port connection status (UI to Service Worker)
 */
export type PortStatus = 'connected' | 'disconnected' | 'reconnecting'

/**
 * Platform type
 */
export type Platform = 'desktop' | 'chromeos'

/**
 * Connection status (simplified from 8-state IOBridge)
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

/**
 * Download root info
 */
export interface DownloadRoot {
  key: string
  path: string
  display_name: string
  removable: boolean
  last_stat_ok: boolean
  last_checked: number
}

/**
 * Daemon info from bridge
 */
export interface DaemonInfo {
  port: number
  token: string
  version?: number
  roots: DownloadRoot[]
  host?: string
}

/**
 * DaemonBridge state (new simplified state)
 */
export interface DaemonBridgeState {
  status: ConnectionStatus
  platform: Platform
  daemonInfo: DaemonInfo | null
  roots: DownloadRoot[]
  lastError: string | null
}

const INITIAL_STATE: DaemonBridgeState = {
  status: 'connecting',
  platform: 'desktop',
  daemonInfo: null,
  roots: [],
  lastError: null,
}

export interface UseIOBridgeStateConfig {
  /** Callback for native events (TorrentAdded, MagnetAdded) */
  onNativeEvent?: (event: string, payload: unknown) => void
}

/**
 * Stats from the daemon about socket and connection state
 */
export interface DaemonStats {
  tcp_sockets: number
  pending_connects: number
  pending_tcp: number
  udp_sockets: number
  tcp_servers: number
  ws_connections: number
  bytes_sent: number
  bytes_received: number
  uptime_secs: number
}

export interface UseIOBridgeStateResult {
  state: DaemonBridgeState
  isConnected: boolean
  hasEverConnected: boolean
  retry: () => void
  launch: () => void
  cancel: () => void
  /** Fetch daemon stats for debug panel */
  getStats: () => Promise<DaemonStats | null>
  /** ChromeOS bootstrap state (only relevant on ChromeOS) */
  chromeosBootstrapState: BootstrapState | null
  chromeosHasEverConnected: boolean
  /** Port connection status (UI to Service Worker) */
  portStatus: PortStatus
}

/**
 * Hook to subscribe to DaemonBridge state from service worker.
 *
 * Returns current state and action callbacks.
 * Also handles native events (TorrentAdded, MagnetAdded) via the port.
 */
export function useIOBridgeState(config: UseIOBridgeStateConfig = {}): UseIOBridgeStateResult {
  const { onNativeEvent } = config
  const [state, setState] = useState<DaemonBridgeState>(INITIAL_STATE)
  const [hasEverConnected, setHasEverConnected] = useState(false)
  const [chromeosBootstrapState, setChromeosBootstrapState] = useState<BootstrapState | null>(null)
  const [chromeosHasEverConnected, setChromeosHasEverConnected] = useState(false)
  const [portStatus, setPortStatus] = useState<PortStatus>('reconnecting')
  const onNativeEventRef = useRef(onNativeEvent)

  // Refs for port management (to allow reconnection without re-running effect)
  const swPortRef = useRef<chrome.runtime.Port | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep ref updated
  useEffect(() => {
    onNativeEventRef.current = onNativeEvent
  }, [onNativeEvent])

  // Connect to SW and subscribe to state changes
  useEffect(() => {
    const bridge = getBridge()

    // Message handler (reused across reconnections)
    const handleMessage = (msg: {
      type?: string
      event?: string
      payload?: unknown
      state?: DaemonBridgeState | BootstrapState
      hasEverConnected?: boolean
    }) => {
      // Handle DaemonBridge state changes
      if (msg.type === 'BRIDGE_STATE_CHANGED' && msg.state) {
        setState(msg.state as DaemonBridgeState)
        if (msg.hasEverConnected !== undefined) {
          setHasEverConnected(msg.hasEverConnected)
        }
      }
      // Handle ChromeOS bootstrap state changes
      else if (msg.type === 'CHROMEOS_BOOTSTRAP_STATE' && msg.state) {
        const bootstrapState = msg.state as BootstrapState
        console.log(
          `[useIOBridgeState] ChromeOS bootstrap state: ${bootstrapState.phase}, problem: ${bootstrapState.problem}`,
        )
        setChromeosBootstrapState(bootstrapState)
        if (bootstrapState.phase === 'connected') {
          setChromeosHasEverConnected(true)
        }
      }
      // Handle CLOSE message (single UI enforcement)
      else if (msg.type === 'CLOSE') {
        console.log('[useIOBridgeState] Received CLOSE, closing window')
        window.close()
      }
      // Handle native events (TorrentAdded, MagnetAdded)
      else if (msg.event && onNativeEventRef.current) {
        onNativeEventRef.current(msg.event, msg.payload)
      }
    }

    // Connect port to service worker
    const connectPort = (): boolean => {
      // Clean up any pending reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      try {
        setPortStatus('reconnecting')
        let port: chrome.runtime.Port
        if (bridge.isDevMode && bridge.extensionId) {
          port = chrome.runtime.connect(bridge.extensionId, { name: 'ui' })
        } else {
          port = chrome.runtime.connect({ name: 'ui' })
        }

        port.onMessage.addListener(handleMessage)

        port.onDisconnect.addListener(() => {
          console.log('[useIOBridgeState] Port disconnected')
          swPortRef.current = null
          setPortStatus('disconnected')

          // If tab is visible, reconnect immediately
          // Otherwise, wait for visibility change
          if (document.visibilityState === 'visible') {
            console.log('[useIOBridgeState] Tab visible, scheduling reconnect')
            reconnectTimeoutRef.current = setTimeout(() => {
              connectPort()
            }, 100)
          } else {
            console.log('[useIOBridgeState] Tab hidden, will reconnect when visible')
          }
        })

        swPortRef.current = port
        setPortStatus('connected')
        console.log('[useIOBridgeState] Port connected')
        return true
      } catch (e) {
        console.error('[useIOBridgeState] Failed to connect port:', e)
        setPortStatus('disconnected')
        return false
      }
    }

    // Handle visibility change - reconnect when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !swPortRef.current) {
        console.log('[useIOBridgeState] Tab became visible, reconnecting port')
        connectPort()
      }
    }

    // Fetch initial state via sendMessage (works even if port fails)
    bridge
      .sendMessage<{ ok: boolean; state?: DaemonBridgeState; hasEverConnected?: boolean }>({
        type: 'GET_BRIDGE_STATE',
      })
      .then((response) => {
        if (response.ok && response.state) {
          setState(response.state)
          if (response.hasEverConnected !== undefined) {
            setHasEverConnected(response.hasEverConnected)
          }
        }
      })
      .catch((e) => {
        console.error('[useIOBridgeState] Failed to get initial state:', e)
      })

    // Connect port for real-time updates
    connectPort()

    // Listen for visibility changes to reconnect when foregrounded
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      swPortRef.current?.disconnect()
      swPortRef.current = null
    }
  }, [])

  // Reconnect port (used by retry and exposed for manual reconnection)
  const reconnectPort = useCallback(() => {
    const bridge = getBridge()

    // Message handler (duplicated here to avoid closure issues)
    const handleMessage = (msg: {
      type?: string
      event?: string
      payload?: unknown
      state?: DaemonBridgeState | BootstrapState
      hasEverConnected?: boolean
    }) => {
      if (msg.type === 'BRIDGE_STATE_CHANGED' && msg.state) {
        setState(msg.state as DaemonBridgeState)
        if (msg.hasEverConnected !== undefined) {
          setHasEverConnected(msg.hasEverConnected)
        }
      } else if (msg.type === 'CHROMEOS_BOOTSTRAP_STATE' && msg.state) {
        const bootstrapState = msg.state as BootstrapState
        setChromeosBootstrapState(bootstrapState)
        if (bootstrapState.phase === 'connected') {
          setChromeosHasEverConnected(true)
        }
      } else if (msg.type === 'CLOSE') {
        window.close()
      } else if (msg.event && onNativeEventRef.current) {
        onNativeEventRef.current(msg.event, msg.payload)
      }
    }

    // Clean up existing port
    if (swPortRef.current) {
      swPortRef.current.disconnect()
      swPortRef.current = null
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    try {
      setPortStatus('reconnecting')
      let port: chrome.runtime.Port
      if (bridge.isDevMode && bridge.extensionId) {
        port = chrome.runtime.connect(bridge.extensionId, { name: 'ui' })
      } else {
        port = chrome.runtime.connect({ name: 'ui' })
      }

      port.onMessage.addListener(handleMessage)

      port.onDisconnect.addListener(() => {
        console.log('[useIOBridgeState] Port disconnected (from retry)')
        swPortRef.current = null
        setPortStatus('disconnected')
      })

      swPortRef.current = port
      setPortStatus('connected')
      console.log('[useIOBridgeState] Port reconnected via retry')
      return true
    } catch (e) {
      console.error('[useIOBridgeState] Failed to reconnect port:', e)
      setPortStatus('disconnected')
      return false
    }
  }, [])

  // Action callbacks
  const retry = useCallback(() => {
    // Reconnect port first (this wakes SW and gets fresh state)
    reconnectPort()
    // Also tell SW to retry daemon connection
    getBridge().postMessage({ type: 'RETRY_CONNECTION' })
  }, [reconnectPort])

  const launch = useCallback(() => {
    getBridge().postMessage({ type: 'TRIGGER_LAUNCH' })
  }, [])

  const cancel = useCallback(() => {
    // Cancel is no longer used in simplified bridge, but keep for API compatibility
    console.log('[useIOBridgeState] cancel() called - no-op in simplified bridge')
  }, [])

  const getStats = useCallback(async (): Promise<DaemonStats | null> => {
    try {
      const response = await getBridge().sendMessage<{ ok: boolean; stats?: DaemonStats }>({
        type: 'GET_DAEMON_STATS',
      })
      if (response.ok && response.stats) {
        return response.stats
      }
      return null
    } catch (e) {
      console.error('[useIOBridgeState] Failed to get stats:', e)
      return null
    }
  }, [])

  return {
    state,
    isConnected: state.status === 'connected',
    hasEverConnected,
    retry,
    launch,
    cancel,
    getStats,
    chromeosBootstrapState,
    chromeosHasEverConnected,
    portStatus,
  }
}
