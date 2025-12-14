export interface DownloadRoot {
  key: string
  path: string
  display_name: string
  removable: boolean
  last_stat_ok: boolean
  last_checked: number
}

export interface DaemonInfo {
  port: number
  token: string
  version?: string
  roots: DownloadRoot[]
  /** Host address for daemon connection. Defaults to 127.0.0.1 on desktop, but differs on ChromeOS. */
  host?: string
}

// Response types from native host
export interface NativeResponse {
  id: string
  ok: boolean
  error?: string
  type?: string
  payload?: unknown
}

export interface RootAddedResponse extends NativeResponse {
  type: 'RootAdded'
  payload: {
    root: DownloadRoot
  }
}

export interface INativeHostConnection {
  connect(): Promise<void>
  send(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): void
  onDisconnect(cb: () => void): void
  isConnected(): boolean
  isDisconnected(): boolean
}

// Singleton enforcement
let singletonInstance: NativeHostConnection | null = null
let singletonCreated = false

/**
 * Get the singleton NativeHostConnection instance.
 * Creates the instance on first call.
 */
export function getNativeConnection(): NativeHostConnection {
  if (!singletonInstance) {
    singletonInstance = new NativeHostConnection()
  }
  return singletonInstance
}

/**
 * Reset the singleton for testing purposes only.
 * @internal
 */
export function resetNativeConnection(): void {
  singletonInstance = null
  singletonCreated = false
}

export class NativeHostConnection implements INativeHostConnection {
  private port: chrome.runtime.Port | null = null
  private connected = false
  private disconnected = false
  private disconnectCallbacks: Array<() => void> = []

  constructor() {
    if (singletonCreated) {
      throw new Error(
        'NativeHostConnection is a singleton. Use getNativeConnection() instead of new NativeHostConnection()',
      )
    }
    singletonCreated = true
  }

  /**
   * Reset internal state to allow reconnection.
   * Called automatically by connect() if previous connection died.
   */
  private resetState(): void {
    this.port = null
    this.connected = false
    this.disconnected = false
    // Clear callbacks - probe() will register fresh ones
    this.disconnectCallbacks = []
  }

  async connect(): Promise<void> {
    // Allow reconnection if previous connection died
    if (this.disconnected) {
      console.log('[NativeHostConnection] Reconnecting after previous disconnect')
      this.resetState()
    }

    return new Promise((resolve, reject) => {
      try {
        this.port = chrome.runtime.connectNative('com.jstorrent.native')

        // Set up disconnect handler FIRST to catch immediate failures
        // Chrome sets lastError asynchronously, so we need to listen for disconnect
        const disconnectHandler = () => {
          const error = chrome.runtime.lastError?.message || 'Native host disconnected'
          console.error('[NativeHostConnection] Connection failed:', error)
          this.disconnected = true
          this.connected = false
          reject(new Error(error))
        }

        this.port.onDisconnect.addListener(disconnectHandler)

        // Wait a tick to see if connection fails immediately
        // Chrome sets lastError asynchronously
        setTimeout(() => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
          } else if (this.port && !this.disconnected) {
            // Remove the reject-on-disconnect handler, will re-add for normal operation
            this.port.onDisconnect.removeListener(disconnectHandler)
            this.connected = true

            // Set up permanent disconnect handler
            this.port.onDisconnect.addListener(() => {
              console.log('[NativeHostConnection] Native host disconnected')
              this.disconnected = true
              this.connected = false
              for (const callback of this.disconnectCallbacks) {
                try {
                  callback()
                } catch (e) {
                  console.error('[NativeHostConnection] Disconnect callback error:', e)
                }
              }
            })

            resolve()
          }
        }, 50)
      } catch (e) {
        reject(e)
      }
    })
  }

  send(msg: unknown) {
    this.port?.postMessage(msg)
  }

  onMessage(cb: (msg: unknown) => void) {
    if (!this.port) {
      console.error('[NativeHostConnection] onMessage called but port is null!')
      return
    }
    // Wrap callback to log all messages
    this.port.onMessage.addListener((msg: unknown) => {
      console.log('[NativeHostConnection] Received message:', JSON.stringify(msg))
      cb(msg)
    })
  }

  onDisconnect(cb: () => void) {
    this.disconnectCallbacks.push(cb)
  }

  isConnected(): boolean {
    return this.connected && this.port !== null && !this.disconnected
  }

  isDisconnected(): boolean {
    return this.disconnected
  }
}
