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
}

export class NativeHostConnection implements INativeHostConnection {
  private port: chrome.runtime.Port | null = null

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.port = chrome.runtime.connectNative('com.jstorrent.native')
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve()
        }
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
    this.port?.onDisconnect.addListener(cb)
  }
}
