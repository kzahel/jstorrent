import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as dgram from 'dgram'
import { startDaemon, DaemonHarness } from './helpers/daemon-harness'
import { DaemonConnection } from '../../src/adapters/daemon/daemon-connection'
import { DaemonSocketFactory } from '../../src/adapters/daemon/daemon-socket-factory'

describe('DaemonSocketFactory UDP', () => {
  let harness: DaemonHarness
  let connection: DaemonConnection
  let factory: DaemonSocketFactory
  let echoServer: dgram.Socket
  let echoPort: number

  beforeAll(async () => {
    // Start daemon
    harness = await startDaemon()
    connection = new DaemonConnection(harness.port, harness.token)
    await connection.connectWebSocket()
    factory = new DaemonSocketFactory(connection)

    // Start a local UDP echo server
    echoServer = dgram.createSocket('udp4')
    echoServer.on('message', (msg, rinfo) => {
      echoServer.send(msg, rinfo.port, rinfo.address)
    })

    await new Promise<void>((resolve) => {
      echoServer.bind(0, '127.0.0.1', () => {
        const addr = echoServer.address()
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

  it('should create UDP socket', async () => {
    const socket = await factory.createUdpSocket()
    expect(socket).toBeDefined()
    expect(typeof socket.send).toBe('function')
  })

  it('should bind to port', async () => {
    const socket = await factory.createUdpSocket('', 0)
    socket.close()
  })

  it('should send and receive UDP packets', async () => {
    const socket = await factory.createUdpSocket('', 0)

    const received: { data: Uint8Array; rinfo: { addr: string; port: number } }[] = []
    socket.onMessage((src, data) => {
      received.push({ data, rinfo: src })
    })

    const testData = new TextEncoder().encode('UDP test!')
    socket.send('127.0.0.1', echoPort, testData)

    // Wait for echo
    await new Promise((r) => setTimeout(r, 100))

    expect(received.length).toBe(1)
    expect(new TextDecoder().decode(received[0].data)).toBe('UDP test!')

    socket.close()
  })
})
