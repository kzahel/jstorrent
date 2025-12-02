import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startDaemon, DaemonHarness } from './helpers/daemon-harness'
import { DaemonConnection } from '../../src/adapters/daemon/daemon-connection'

describe('DaemonConnection WebSocket', () => {
  let harness: DaemonHarness
  let connection: DaemonConnection

  beforeAll(async () => {
    harness = await startDaemon()
    connection = new DaemonConnection(harness.port, harness.token)
  })

  afterAll(async () => {
    connection.close?.()
    await harness.cleanup()
  })

  it('should connect via HTTP', async () => {
    // DaemonConnection.connect does HTTP request
    const conn = await DaemonConnection.connect(harness.port, harness.token)
    expect(conn).toBeDefined()
  })

  it('should establish WebSocket connection', async () => {
    await connection.connectWebSocket()
    expect(connection.ready).toBe(true)
  })

  it('should handle WebSocket reconnection', async () => {
    await connection.connectWebSocket()
    // Force close
    connection.close()
    connection.ready = false // Reset ready state manually for test
    // Reconnect
    await connection.connectWebSocket()
    expect(connection.ready).toBe(true)
  })
})
