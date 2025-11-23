import { INativeHostConnection, DaemonInfo } from './native-connection'
import { IDaemonConnection, DaemonConnection } from './daemon-connection'
import { ISockets, Sockets } from './sockets'

export class Client {
  private native: INativeHostConnection
  private daemon: IDaemonConnection | null = null
  private sockets: ISockets | null = null
  private ready = false

  constructor(native: INativeHostConnection) {
    this.native = native
  }

  async ensureDaemonReady(): Promise<ISockets> {
    if (this.ready) return this.sockets!

    await this.native.connect()

    // Send handshake to get DaemonInfo
    this.native.send({
      op: 'handshake',
      extensionId: chrome.runtime.id,
      id: crypto.randomUUID(),
    })

    const daemonInfo = await this.waitForDaemonInfo()
    console.log('Received DaemonInfo:', daemonInfo)

    this.daemon = new DaemonConnection()
    await this.daemon.connect(daemonInfo)
    console.log('Connected to Daemon WebSocket')

    this.sockets = new Sockets(this.daemon)
    this.ready = true

    return this.sockets
  }

  private waitForDaemonInfo(): Promise<DaemonInfo> {
    return new Promise((resolve) => {
      const handler = (msg: any) => {
        if (msg.type === 'DaemonInfo') {
          // this.native.onMessage.removeListener(handler) // Ideally remove listener
          resolve(msg.payload as DaemonInfo)
        }
      }
      this.native.onMessage(handler)
    })
  }

  shutdown() {
    this.daemon?.close()
    this.ready = false
  }
}
