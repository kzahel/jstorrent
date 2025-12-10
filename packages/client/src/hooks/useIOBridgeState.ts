import { useState, useEffect, useCallback, useRef } from 'react'
import { getBridge } from '../chrome/extension-bridge'

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

export interface UseIOBridgeStateResult {
  state: DaemonBridgeState
  isConnected: boolean
  hasEverConnected: boolean
  retry: () => void
  launch: () => void
  cancel: () => void
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
  const onNativeEventRef = useRef(onNativeEvent)

  // Keep ref updated
  useEffect(() => {
    onNativeEventRef.current = onNativeEvent
  }, [onNativeEvent])

  // Connect to SW and subscribe to state changes
  useEffect(() => {
    const bridge = getBridge()
    let swPort: chrome.runtime.Port | null = null

    // Fetch initial state
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
    try {
      if (bridge.isDevMode && bridge.extensionId) {
        swPort = chrome.runtime.connect(bridge.extensionId, { name: 'ui' })
      } else {
        swPort = chrome.runtime.connect({ name: 'ui' })
      }

      swPort.onMessage.addListener(
        (msg: {
          type?: string
          event?: string
          payload?: unknown
          state?: DaemonBridgeState
          hasEverConnected?: boolean
        }) => {
          // Handle DaemonBridge state changes
          if (msg.type === 'BRIDGE_STATE_CHANGED' && msg.state) {
            setState(msg.state)
            if (msg.hasEverConnected !== undefined) {
              setHasEverConnected(msg.hasEverConnected)
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
        },
      )

      swPort.onDisconnect.addListener(() => {
        console.log('[useIOBridgeState] Port disconnected')
      })
    } catch (e) {
      console.error('[useIOBridgeState] Failed to connect port:', e)
    }

    return () => {
      swPort?.disconnect()
    }
  }, [])

  // Action callbacks
  const retry = useCallback(() => {
    getBridge().postMessage({ type: 'RETRY_CONNECTION' })
  }, [])

  const launch = useCallback(() => {
    getBridge().postMessage({ type: 'TRIGGER_LAUNCH' })
  }, [])

  const cancel = useCallback(() => {
    // Cancel is no longer used in simplified bridge, but keep for API compatibility
    console.log('[useIOBridgeState] cancel() called - no-op in simplified bridge')
  }, [])

  return {
    state,
    isConnected: state.status === 'connected',
    hasEverConnected,
    retry,
    launch,
    cancel,
  }
}
