import { IFileHandle } from '../../interfaces/filesystem'
import { DaemonConnection } from './daemon-connection'

export class DaemonFileHandle implements IFileHandle {
  constructor(
    private connection: DaemonConnection,
    private path: string,
    private rootToken: string,
  ) {}

  async read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }> {
    const data = await this.connection.requestBinary('GET', `/files/${this.path}`, {
      offset: position,
      length,
      root_token: this.rootToken,
    })

    if (data.length !== length) {
      throw new Error(
        `Short read from daemon: requested ${length} bytes at position ${position}, got ${data.length}`,
      )
    }

    buffer.set(data, offset)
    return { bytesRead: data.length }
  }

  async write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }> {
    const data = buffer.subarray(offset, offset + length)

    await this.connection.requestBinary(
      'POST',
      `/files/${this.path}`,
      {
        offset: position,
        root_token: this.rootToken,
      },
      data,
    )

    return { bytesWritten: length }
  }

  async truncate(len: number): Promise<void> {
    await this.connection.request('POST', '/ops/truncate', undefined, {
      path: this.path,
      root_token: this.rootToken,
      length: len,
    })
  }

  async sync(): Promise<void> {
    // io-daemon doesn't expose explicit sync yet, but writes are likely flushed or OS-managed.
    // We can treat this as a no-op or add a sync endpoint later.
  }

  async close(): Promise<void> {
    // Stateless handle, nothing to close on the daemon side.
  }
}
