import { INativeHostConnection, DaemonInfo } from './native-connection'
import { ISockets } from './sockets'
import {
  DaemonConnection,
  DaemonSocketFactory,
  DaemonFileSystem,
  BtEngine,
  StorageRootManager,
  MemorySessionStore,
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
    const factory = new DaemonSocketFactory(conn)
    const store = new MemorySessionStore()

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
      // Set first root as default (TODO: load user preference)
      srm.setDefaultRoot(daemonInfo.roots[0].token)
      console.log('Registered', daemonInfo.roots.length, 'download roots')
    } else {
      console.warn('No download roots configured! Downloads will fail.')
    }

    console.log('Components created', factory, srm, store)

    // Try to instantiate BtEngine
    this.engine = new BtEngine({
      socketFactory: factory,
      storageRootManager: srm,
      sessionStore: store,
      onLog: (entry: LogEntry) => {
        this.logBuffer.add(entry)
      },
    })

    console.log('Daemon Engine initialized')

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
}
