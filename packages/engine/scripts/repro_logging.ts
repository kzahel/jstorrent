/* eslint-disable @typescript-eslint/no-explicit-any */
import { BtEngine } from './src/core/bt-engine'
import { InMemoryFileSystem } from './src/io/memory/memory-filesystem'

// Mock SocketFactory if needed, or use a simple one
const mockSocketFactory = {
  createTcpSocket: async () => {
    throw new Error('Not implemented')
  },
  createUdpSocket: async () => {
    throw new Error('Not implemented')
  },
  createTcpServer: () =>
    ({
      listen: (_port: number, cb: () => void) => {
        setTimeout(cb, 10) // Simulate async listen
      },
      on: () => {},
      address: () => ({ port: 12345 }),
      close: () => {},
    }) as any,
  wrapTcpSocket: (socket: any) => socket,
}

async function run() {
  console.log('--- Starting Reproduction ---')
  const engine = new BtEngine({
    downloadPath: '/tmp',
    fileSystem: new InMemoryFileSystem(),
    socketFactory: mockSocketFactory,
    logging: { level: 'debug' }, // Enable debug logs
  })

  // Wait for server start log
  await new Promise((resolve) => setTimeout(resolve, 100))

  engine.destroy()
  console.log('--- Finished Reproduction ---')
}

run().catch(console.error)
