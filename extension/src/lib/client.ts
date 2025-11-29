import { INativeHostConnection, DaemonInfo, DownloadRoot } from './native-connection'
import { ISockets } from './sockets'
import {
  DaemonConnection,
  DaemonSocketFactory,
  DaemonFileSystem,
  BtEngine,
  StorageRootManager,
  ChromeStorageSessionStore,
  RingBufferLogger,
  LogEntry,
} from '@jstorrent/engine'

export class Client {
  private native: INativeHostConnection
  private sockets: ISockets | null = null
  public engine: BtEngine | undefined
  public ready = false
  public daemonInfo: DaemonInfo | undefined
  public logBuffer: RingBufferLogger = new RingBufferLogger(500)

  constructor(native: INativeHostConnection) {
    this.native = native
  }

  async ensureDaemonReady(): Promise<ISockets> {
    if (this.ready && this.sockets) return this.sockets

    console.log('Ensuring daemon is ready...')
    await this.native.connect()

    const installId = await this.getInstallId()

    // Send handshake to get DaemonInfo
    this.native.send({
      op: 'handshake',
      extensionId: chrome.runtime.id,
      installId,
      id: crypto.randomUUID(),
    })

    const daemonInfo = await this.waitForDaemonInfo()
    console.log('Received DaemonInfo:', daemonInfo)
    this.daemonInfo = daemonInfo

    const conn = new DaemonConnection(daemonInfo.port, daemonInfo.token)
    await conn.connectWebSocket()
    const factory = new DaemonSocketFactory(conn)
    const store = new ChromeStorageSessionStore(chrome.storage.local, 'session:')

    // Create StorageRootManager with factory that creates DaemonFileSystem per root
    const srm = new StorageRootManager((root) => new DaemonFileSystem(conn, root.token))

    // Register download roots from daemon handshake
    if (daemonInfo.roots && daemonInfo.roots.length > 0) {
      for (const root of daemonInfo.roots) {
        srm.addRoot({
          token: root.token,
          label: root.display_name,
          path: root.path,
        })
      }
      // Load saved default, or use first root
      const savedDefault = await chrome.storage.local.get('defaultRootToken')
      const defaultToken = savedDefault.defaultRootToken

      // Verify saved default still exists
      const validDefault = daemonInfo.roots.some((r) => r.token === defaultToken)

      if (validDefault && typeof defaultToken === 'string') {
        srm.setDefaultRoot(defaultToken)
      } else if (daemonInfo.roots.length > 0) {
        srm.setDefaultRoot(daemonInfo.roots[0].token)
      }
      console.log('Registered', daemonInfo.roots.length, 'download roots')
    } else {
      console.warn('No download roots configured! Downloads will fail.')
    }

    console.log('Components created', factory, srm, store)

    // Create engine in suspended state so we can restore session before starting
    this.engine = new BtEngine({
      socketFactory: factory,
      storageRootManager: srm,
      sessionStore: store,
      startSuspended: true, // Don't start networking until session is restored
      onLog: (entry: LogEntry) => {
        this.logBuffer.add(entry)
      },
    })

    console.log('Daemon Engine initialized (suspended)')

    // Restore session BEFORE resuming
    const restored = await this.engine.restoreSession()
    console.log(`Restored ${restored} torrents from session`)

    // NOW resume - torrents with userState 'active' will start
    this.engine.resume()
    console.log('Engine resumed')

    // Adapt engine socket factory to ISockets interface
    this.sockets = this.engine.socketFactory as unknown as ISockets
    this.ready = true

    return this.sockets! // Force non-null for test
  }

  private waitForDaemonInfo(): Promise<DaemonInfo> {
    return new Promise((resolve) => {
      const handler = (msg: unknown) => {
        if (
          typeof msg === 'object' &&
          msg !== null &&
          'type' in msg &&
          (msg as { type: string }).type === 'DaemonInfo'
        ) {
          // this.native.onMessage.removeListener(handler) // Ideally remove listener
          resolve((msg as unknown as { payload: DaemonInfo }).payload)
        }
      }
      this.native.onMessage(handler)
    })
  }

  shutdown() {
    this.engine?.destroy()
    this.engine = undefined
    this.sockets = null
    this.ready = false
  }

  private async getInstallId(): Promise<string> {
    const result = await chrome.storage.local.get('installId')
    if (result.installId) {
      return result.installId as string
    }
    // Fallback if onInstalled didn't run or storage was cleared
    const newId = crypto.randomUUID()
    await chrome.storage.local.set({ installId: newId })
    return newId
  }

  /**
   * Open OS folder picker to add a new download root.
   * Returns the newly added root, or null if cancelled.
   */
  async pickDownloadFolder(): Promise<DownloadRoot | null> {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID()

      const handler = (msg: unknown) => {
        if (typeof msg !== 'object' || msg === null) return
        const response = msg as {
          id?: string
          ok?: boolean
          type?: string
          payload?: { root?: DownloadRoot }
          error?: string
        }

        if (response.id !== requestId) return

        if (response.ok && response.type === 'RootAdded' && response.payload?.root) {
          const root = response.payload.root
          // Register with StorageRootManager
          if (this.engine) {
            this.engine.storageRootManager.addRoot({
              token: root.token,
              label: root.display_name,
              path: root.path,
            })
            console.log('Added new download root:', root)
          }
          resolve(root)
        } else {
          console.log('Folder picker cancelled or failed:', response.error)
          resolve(null)
        }
      }

      this.native.onMessage(handler)
      this.native.send({
        op: 'pickDownloadDirectory',
        id: requestId,
      })
    })
  }

  /**
   * Get current download roots.
   */
  getRoots(): Array<{ token: string; label: string; path: string }> {
    if (!this.engine) return []
    return this.engine.storageRootManager.getRoots()
  }

  /**
   * Get the current default root token.
   */
  async getDefaultRootToken(): Promise<string | null> {
    const result = await chrome.storage.local.get('defaultRootToken')
    return (result.defaultRootToken as string) || null
  }

  /**
   * Set the default download root.
   */
  async setDefaultRoot(token: string): Promise<void> {
    if (!this.engine) {
      throw new Error('Engine not initialized')
    }
    this.engine.storageRootManager.setDefaultRoot(token)
    await chrome.storage.local.set({ defaultRootToken: token })
  }

  /**
   * Start a torrent (set userState to 'active').
   */
  startTorrent(infoHash: string): void {
    const torrent = this.engine?.getTorrent(infoHash)
    if (torrent) {
      torrent.userStart()
    }
  }

  /**
   * Stop a torrent (set userState to 'stopped').
   */
  stopTorrent(infoHash: string): void {
    const torrent = this.engine?.getTorrent(infoHash)
    if (torrent) {
      torrent.userStop()
    }
  }

  /**
   * Pause all torrents (suspend engine).
   */
  pauseAll(): void {
    this.engine?.suspend()
  }

  /**
   * Resume all torrents (resume engine).
   */
  resumeAll(): void {
    this.engine?.resume()
  }
}
