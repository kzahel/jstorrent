# IO-Daemon Integration Test Suite Plan

## Overview

Create a dedicated integration test suite for testing io-daemon functionality directly from Node.js, without browser/Playwright overhead. These tests spawn the real io-daemon binary and exercise its HTTP and WebSocket APIs.

## Current State

- `packages/engine/test/integration/daemon-filesystem.spec.ts` - Exists, tests file operations via HTTP
- `extension/e2e/io-daemon.spec.ts` - Playwright test trying to test sockets, wrong environment

## Goal

1. Move daemon integration tests to a dedicated location
2. Add comprehensive tests for io-daemon functionality:
   - HTTP file API (already exists)
   - WebSocket connection
   - TCP socket proxy
   - UDP socket proxy
3. Simplify extension e2e tests to only test extension-specific concerns

## Task 1: Create Integration Test Infrastructure

### 1.1 Create shared daemon test helper

**Create file**: `packages/engine/test/integration/helpers/daemon-harness.ts`

```typescript
import { spawn, ChildProcess } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

export interface DaemonHarness {
  port: number
  token: string
  installId: string
  configDir: string
  dataDir: string
  process: ChildProcess
  cleanup: () => Promise<void>
}

export interface DaemonConfig {
  roots?: Array<{
    token: string
    path: string
    displayName: string
  }>
}

const DAEMON_BIN = path.resolve(
  __dirname,
  '../../../../../native-host/target/debug/jstorrent-io-daemon'
)

export async function startDaemon(config: DaemonConfig = {}): Promise<DaemonHarness> {
  // Create temp directories
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jstorrent-daemon-test-'))
  const configDir = path.join(tmpDir, 'config')
  const dataDir = path.join(tmpDir, 'data')

  await fs.mkdir(configDir, { recursive: true })
  await fs.mkdir(dataDir, { recursive: true })

  const token = 'test-token-' + Math.random().toString(36).slice(2)
  const installId = 'test-install-' + Math.random().toString(36).slice(2)

  // Build download_roots from config
  const roots = config.roots ?? [
    { token: 'default', path: dataDir, displayName: 'Test Data' }
  ]

  // Ensure root directories exist
  for (const root of roots) {
    await fs.mkdir(root.path, { recursive: true })
  }

  // Create rpc-info.json
  const rpcInfo = {
    version: 1,
    profiles: [
      {
        install_id: installId,
        extension_id: 'test-extension',
        salt: 'test-salt',
        pid: process.pid,
        port: 0,
        token: 'host-token',
        started: Date.now(),
        last_used: Date.now(),
        browser: { name: 'test', binary: 'test', extension_id: 'test' },
        download_roots: roots.map(r => ({
          token: r.token,
          path: r.path,
          display_name: r.displayName,
          removable: false,
          last_stat_ok: true,
          last_checked: Date.now(),
        })),
      },
    ],
  }

  const nativeHostDir = path.join(configDir, 'jstorrent-native')
  await fs.mkdir(nativeHostDir, { recursive: true })
  await fs.writeFile(
    path.join(nativeHostDir, 'rpc-info.json'),
    JSON.stringify(rpcInfo)
  )

  // Spawn daemon
  const port = await new Promise<number>((resolve, reject) => {
    const daemonProcess = spawn(
      DAEMON_BIN,
      ['--port', '0', '--token', token, '--install-id', installId],
      {
        env: { ...process.env, JSTORRENT_CONFIG_DIR: configDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    let output = ''
    let resolved = false

    daemonProcess.stdout?.on('data', (data) => {
      output += data.toString()
      // Daemon prints port to stdout
      const match = output.match(/(\d+)\n/)
      if (match && !resolved) {
        resolved = true
        const port = parseInt(match[1], 10)
        
        // Store process for cleanup
        ;(daemonProcess as any)._resolvedPort = port
        resolve(port)
      }
    })

    daemonProcess.stderr?.on('data', (data) => {
      console.error(`Daemon stderr: ${data}`)
    })

    daemonProcess.on('error', (err) => {
      if (!resolved) reject(err)
    })

    daemonProcess.on('exit', (code) => {
      if (!resolved && code !== 0) {
        reject(new Error(`Daemon exited with code ${code}`))
      }
    })

    // Store for later
    ;(daemonProcess as any)._tmpDir = tmpDir
    ;(daemonProcess as any)._harness = { configDir, dataDir, token, installId }
  })

  // Get the process reference (a bit awkward but works)
  const processes = (spawn as any)._processes || []
  const daemonProcess = processes[processes.length - 1] || 
    // Alternative: we need to restructure to return process from promise
    await new Promise<ChildProcess>((resolve) => {
      const proc = spawn(
        DAEMON_BIN,
        ['--port', String(port), '--token', token, '--install-id', installId],
        {
          env: { ...process.env, JSTORRENT_CONFIG_DIR: configDir },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      )
      // This won't work because port 0 gives random port...
      // We need to refactor this
    })

  // TODO: Refactor to properly capture process reference
  // For now, simplified version:
  
  return {
    port,
    token,
    installId,
    configDir,
    dataDir,
    process: null as any, // Will fix in implementation
    cleanup: async () => {
      // Kill daemon
      // daemonProcess.kill()
      // Clean temp dir
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  }
}
```

**Note to agent**: The above is a sketch. The actual implementation needs to properly capture the ChildProcess reference. Look at how `daemon-filesystem.spec.ts` does it in beforeAll - that pattern works, just needs to be extracted into a reusable helper.

### 1.2 Refactor daemon-filesystem.spec.ts to use helper

After creating the helper, refactor `daemon-filesystem.spec.ts` to use it:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startDaemon, DaemonHarness } from './helpers/daemon-harness'
import { DaemonFileSystem } from '../../src/adapters/daemon/daemon-filesystem'
import { DaemonConnection } from '../../src/adapters/daemon/daemon-connection'

describe('DaemonFileSystem Integration', () => {
  let harness: DaemonHarness
  let connection: DaemonConnection
  let fs: DaemonFileSystem

  beforeAll(async () => {
    harness = await startDaemon()
    connection = new DaemonConnection(harness.port, harness.token)
    fs = new DaemonFileSystem(connection, 'default')
  })

  afterAll(async () => {
    await harness.cleanup()
  })

  // ... existing tests
})
```

## Task 2: Add WebSocket Connection Tests

**Create file**: `packages/engine/test/integration/daemon-websocket.spec.ts`

```typescript
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
    expect(connection.isWebSocketConnected()).toBe(true)
  })

  it('should handle WebSocket reconnection', async () => {
    await connection.connectWebSocket()
    // Force close
    connection.closeWebSocket?.()
    // Reconnect
    await connection.connectWebSocket()
    expect(connection.isWebSocketConnected()).toBe(true)
  })
})
```

## Task 3: Add TCP Socket Proxy Tests

**Create file**: `packages/engine/test/integration/daemon-tcp-socket.spec.ts`

```typescript
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

  it('should create TCP socket', () => {
    const socket = factory.createTcpSocket()
    expect(socket).toBeDefined()
    expect(typeof socket.connect).toBe('function')
  })

  it('should connect to local server', async () => {
    const socket = factory.createTcpSocket()
    await socket.connect('127.0.0.1', echoPort)
    socket.close()
  })

  it('should send and receive data', async () => {
    const socket = factory.createTcpSocket()
    await socket.connect('127.0.0.1', echoPort)

    const received: Uint8Array[] = []
    socket.onData((data) => {
      received.push(data)
    })

    const testData = new TextEncoder().encode('Hello, daemon!')
    await socket.send(testData)

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
    const socket = factory.createTcpSocket()
    
    let errorReceived = false
    socket.onError(() => {
      errorReceived = true
    })

    // Try to connect to a port that's not listening
    await expect(socket.connect('127.0.0.1', 59999)).rejects.toThrow()
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

    const socket = factory.createTcpSocket()
    let closed = false
    socket.onClose(() => {
      closed = true
    })

    await socket.connect('127.0.0.1', closePort)
    
    // Wait for close event
    await new Promise((r) => setTimeout(r, 200))
    expect(closed).toBe(true)

    closeServer.close()
  })
})
```

## Task 4: Add UDP Socket Proxy Tests

**Create file**: `packages/engine/test/integration/daemon-udp-socket.spec.ts`

```typescript
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

  it('should create UDP socket', () => {
    const socket = factory.createUdpSocket()
    expect(socket).toBeDefined()
    expect(typeof socket.send).toBe('function')
  })

  it('should bind to port', async () => {
    const socket = factory.createUdpSocket()
    await socket.bind(0) // Random port
    socket.close()
  })

  it('should send and receive UDP packets', async () => {
    const socket = factory.createUdpSocket()
    await socket.bind(0)

    const received: { data: Uint8Array; rinfo: { address: string; port: number } }[] = []
    socket.onMessage((data, rinfo) => {
      received.push({ data, rinfo })
    })

    const testData = new TextEncoder().encode('UDP test!')
    await socket.send(testData, '127.0.0.1', echoPort)

    // Wait for echo
    await new Promise((r) => setTimeout(r, 100))

    expect(received.length).toBe(1)
    expect(new TextDecoder().decode(received[0].data)).toBe('UDP test!')

    socket.close()
  })
})
```

## Task 5: Simplify Extension E2E Tests

### 5.1 Simplify io-daemon.spec.ts

**Replace**: `extension/e2e/io-daemon.spec.ts`

```typescript
import { test, expect } from './fixtures'

test('Extension connects to IO Daemon', async ({ context, extensionId }) => {
  // Wait for service worker
  let worker = context.serviceWorkers()[0]
  if (!worker) {
    await context.waitForEvent('serviceworker')
    worker = context.serviceWorkers()[0]
  }

  // Open extension page to trigger initialization
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)

  const sw = context.serviceWorkers()[0]
  expect(sw).toBeTruthy()

  // Verify client initializes and connects to daemon
  const result = await sw.evaluate(async () => {
    // @ts-expect-error -- client is exposed on self
    const client = self.client

    // Give it time to initialize
    if (!client.ready) {
      await new Promise((r) => setTimeout(r, 2000))
    }

    // Try explicit init if still not ready
    if (!client.ready) {
      try {
        await client.ensureDaemonReady()
      } catch (e) {
        return { ready: false, error: String(e) }
      }
    }

    return {
      ready: client.ready,
      hasDaemonInfo: !!client.daemonInfo,
      hasEngine: !!client.engine,
    }
  })

  expect(result.ready).toBe(true)
  expect(result.hasEngine).toBe(true)
})
```

### 5.2 Update daemon-engine.spec.ts

Keep it focused on BtEngine initialization, not socket testing:

```typescript
import { test, expect } from './fixtures'

test('Extension initializes Daemon Engine', async ({ context, extensionId }) => {
  let worker = context.serviceWorkers()[0]
  if (!worker) {
    await context.waitForEvent('serviceworker')
    worker = context.serviceWorkers()[0]
  }

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)

  const sw = context.serviceWorkers()[0]
  expect(sw).toBeTruthy()

  const engineState = await sw.evaluate(async () => {
    // @ts-expect-error -- client is exposed on self
    const client = self.client

    if (!client.ready) {
      await client.ensureDaemonReady()
    }

    const engine = client.engine
    return {
      hasEngine: !!engine,
      hasPeerId: !!engine?.peerId,
      hasStorageManager: !!engine?.storageRootManager,
      hasSocketFactory: !!engine?.socketFactory,
      torrentCount: engine?.torrents?.length ?? 0,
    }
  })

  expect(engineState.hasEngine).toBe(true)
  expect(engineState.hasPeerId).toBe(true)
  expect(engineState.hasStorageManager).toBe(true)
  expect(engineState.hasSocketFactory).toBe(true)
  expect(engineState.torrentCount).toBe(0)
})
```

## Task 6: Configure Test Separation

### 6.1 Update vitest.config.ts in packages/engine

Exclude daemon integration tests from regular test runs:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/test/integration/daemon-*.spec.ts', // Requires io-daemon binary
    ],
  },
})
```

### 6.2 Create vitest.integration.config.ts

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/test/integration/daemon-*.spec.ts'],
    testTimeout: 30000, // Daemon tests may be slower
  },
})
```

### 6.3 Add npm scripts to packages/engine/package.json

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:all": "vitest run --config vitest.all.config.ts"
  }
}
```

## Verification

After completing all tasks:

```bash
# Regular tests (fast, no daemon needed)
cd packages/engine
pnpm test

# Integration tests (requires io-daemon binary)
pnpm test:integration

# Extension e2e (requires full stack)
cd ../extension
pnpm test:e2e
```

## Summary

1. Extract daemon harness helper for reuse
2. Refactor existing daemon-filesystem test to use helper
3. Add WebSocket connection tests
4. Add TCP socket proxy tests  
5. Add UDP socket proxy tests
6. Simplify extension e2e tests to focus on extension concerns
7. Configure test separation (unit vs integration)

The TCP/UDP socket proxy tests will exercise the full flow: Node → DaemonSocketFactory → WebSocket → io-daemon → real network, without Playwright complexity.
