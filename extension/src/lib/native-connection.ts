export interface DaemonInfo {
  port: number
  token: string
  version?: number
}

export interface INativeHostConnection {
  connect(): Promise<void>
  send(msg: any): void
  onMessage(cb: (msg: any) => void): void
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

  send(msg: any) {
    this.port?.postMessage(msg)
  }

  onMessage(cb: (msg: any) => void) {
    this.port?.onMessage.addListener(cb)
  }

  onDisconnect(cb: () => void) {
    this.port?.onDisconnect.addListener(cb)
  }
}
