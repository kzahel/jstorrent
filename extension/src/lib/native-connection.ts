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
  version?: number
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

export class NativeHostConnection implements INativeHostConnection {
  private port: chrome.runtime.Port | null = null
  private connected = false
  private disconnected = false
  private disconnectCallbacks: Array<() => void> = []

  async connect(): Promise<void> {
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
    this.port?.onMessage.addListener(cb)
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
