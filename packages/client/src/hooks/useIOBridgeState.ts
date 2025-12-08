import { useState, useEffect, useCallback, useRef } from 'react'
import { getBridge } from '../chrome/extension-bridge'

/**
 * IOBridge state names (mirrored from extension/src/lib/io-bridge/types.ts)
 */
export type IOBridgeStateName =
  | 'INITIALIZING'
  | 'PROBING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'INSTALL_PROMPT'
  | 'LAUNCH_PROMPT'
  | 'AWAITING_LAUNCH'
  | 'LAUNCH_FAILED'

/**
 * Minimal IOBridge state for UI consumption.
 * Full state type is in extension; we only need what the UI uses.
 */
export interface IOBridgeState {
  name: IOBridgeStateName
  platform?: 'desktop' | 'chromeos'
  daemonInfo?: {
    port: number
    token: string
    version?: number
    roots: Array<{
      key: string
      path: string
      display_name: string
      removable: boolean
      last_stat_ok: boolean
      last_checked: number
    }>
    host?: string
  }
  history?: {
    attempts: number
    lastAttempt: number | null
    lastError: string | null
  }
  wasHealthy?: boolean
}

const INITIAL_STATE: IOBridgeState = { name: 'INITIALIZING' }

export interface UseIOBridgeStateConfig {
  /** Callback for native events (TorrentAdded, MagnetAdded) */
  onNativeEvent?: (event: string, payload: unknown) => void
}

export interface UseIOBridgeStateResult {
  state: IOBridgeState
  isConnected: boolean
  hasEverConnected: boolean
  retry: () => void
  launch: () => void
  cancel: () => void
}

/**
 * Hook to subscribe to IOBridge state from service worker.
 *
 * Returns current state and action callbacks.
 * Also handles native events (TorrentAdded, MagnetAdded) via the port.
 */
export function useIOBridgeState(config: UseIOBridgeStateConfig = {}): UseIOBridgeStateResult {
  const { onNativeEvent } = config
  const [state, setState] = useState<IOBridgeState>(INITIAL_STATE)
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
      .sendMessage<{ ok: boolean; state?: IOBridgeState; hasEverConnected?: boolean }>({
        type: 'GET_IOBRIDGE_STATE',
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
          state?: IOBridgeState
          hasEverConnected?: boolean
        }) => {
          // Handle IOBridge state changes
          if (msg.type === 'IOBRIDGE_STATE_CHANGED' && msg.state) {
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
    getBridge().postMessage({ type: 'IOBRIDGE_RETRY' })
  }, [])

  const launch = useCallback(() => {
    getBridge().postMessage({ type: 'IOBRIDGE_LAUNCH' })
  }, [])

  const cancel = useCallback(() => {
    getBridge().postMessage({ type: 'IOBRIDGE_CANCEL' })
  }, [])

  return {
    state,
    isConnected: state.name === 'CONNECTED',
    hasEverConnected,
    retry,
    launch,
    cancel,
  }
}
