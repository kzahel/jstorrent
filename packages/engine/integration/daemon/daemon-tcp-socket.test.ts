import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as net from 'net'
import { startDaemon, DaemonHarness } from './helpers/daemon-harness'
import { DaemonConnection } from '../../src/adapters/daemon/daemon-connection'
import { DaemonSocketFactory } from '../../src/adapters/daemon/daemon-socket-factory'

describe('DaemonSocketFactory TCP', () => {
  let harness: DaemonHarness
  let connection: DaemonConnection
  let factory: DaemonSocketFactory
  let echoServer: net.Server
  let echoPort: number

  beforeAll(async () => {
    // Start daemon
    harness = await startDaemon()
    connection = new DaemonConnection(harness.port, harness.token)
    await connection.connectWebSocket()
    factory = new DaemonSocketFactory(connection)

    // Start a local echo server for testing
    echoServer = net.createServer((socket) => {
      socket.on('data', (data) => {
        socket.write(data) // Echo back
      })
    })

    await new Promise<void>((resolve) => {
      echoServer.listen(0, '127.0.0.1', () => {
        const addr = echoServer.address() as net.AddressInfo
        echoPort = addr.port
        resolve()
      })
    })
  })

  afterAll(async () => {
    echoServer?.close()
    connection.close?.()
    await harness.cleanup()
  })

  it('should create TCP socket', async () => {
    const socket = await factory.createTcpSocket()
    expect(socket).toBeDefined()
    expect(typeof socket.connect).toBe('function')
  })

  it('should connect to local server', async () => {
    const socket = await factory.createTcpSocket()
    await socket.connect!(echoPort, '127.0.0.1')
    socket.close()
  })

  it('should send and receive data', async () => {
    const socket = await factory.createTcpSocket()
    await socket.connect!(echoPort, '127.0.0.1')

    const received: Uint8Array[] = []
    socket.onData((data) => {
      received.push(data)
    })

    const testData = new TextEncoder().encode('Hello, daemon!')
    socket.send(testData)

    // Wait for echo
    await new Promise((r) => setTimeout(r, 100))

    expect(received.length).toBeGreaterThan(0)
    const combined = new Uint8Array(received.reduce((acc, arr) => acc + arr.length, 0))
    let offset = 0
    for (const arr of received) {
      combined.set(arr, offset)
      offset += arr.length
    }
    expect(new TextDecoder().decode(combined)).toBe('Hello, daemon!')

    socket.close()
  })

  it('should handle connection errors', async () => {
    const socket = await factory.createTcpSocket()

    // Try to connect to a port that's not listening
    await expect(socket.connect!(59999, '127.0.0.1')).rejects.toThrow()
  })

  it('should handle remote close', async () => {
    // Create a server that closes immediately
    const closeServer = net.createServer((socket) => {
      socket.end()
    })

    const closePort = await new Promise<number>((resolve) => {
      closeServer.listen(0, '127.0.0.1', () => {
        resolve((closeServer.address() as net.AddressInfo).port)
      })
    })

    const socket = await factory.createTcpSocket()
    let closed = false
    socket.onClose(() => {
      closed = true
    })

    await socket.connect!(closePort, '127.0.0.1')

    // Wait for close event
    await new Promise((r) => setTimeout(r, 200))
    expect(closed).toBe(true)

    closeServer.close()
  })
})
