import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BtEngine } from '../../src/core/bt-engine'
import { ISocketFactory, IUdpSocket, ITcpSocket, ITcpServer } from '../../src/interfaces/socket'
import { MemorySessionStore } from '../../src/adapters/memory/memory-session-store'
import { StorageRootManager } from '../../src/storage/storage-root-manager'
import { IFileSystem } from '../../src/interfaces/filesystem'
import { MemoryConfigHub } from '../../src/config/memory-config-hub'

// Mock UDP socket for DHT
class MockUdpSocket implements IUdpSocket {
  onMessageCallback: ((src: { addr: string; port: number }, data: Uint8Array) => void) | null = null
  closed = false

  send(_addr: string, _port: number, _data: Uint8Array): void {}
  onMessage(cb: (src: { addr: string; port: number }, data: Uint8Array) => void): void {
    this.onMessageCallback = cb
  }
  close(): void {
    this.closed = true
  }
  joinMulticast(_group: string): Promise<void> {
    return Promise.resolve()
  }
  leaveMulticast(_group: string): Promise<void> {
    return Promise.resolve()
  }
}

// Mock TCP socket
class MockTcpSocket implements ITcpSocket {
  remoteAddress = '127.0.0.1'
  remotePort = 12345
  connected = false
  closed = false
  private onDataCb: ((data: Uint8Array) => void) | null = null
  private onCloseCb: ((hadError: boolean) => void) | null = null
  private onErrorCb: ((err: Error) => void) | null = null

  connect(_port: number, _host: string): Promise<void> {
    this.connected = true
    return Promise.resolve()
  }
  send(_data: Uint8Array): void {}
  close(): void {
    this.closed = true
    this.onCloseCb?.(false)
  }
  onData(cb: (data: Uint8Array) => void): void {
    this.onDataCb = cb
  }
  onClose(cb: (hadError: boolean) => void): void {
    this.onCloseCb = cb
  }
  onError(cb: (err: Error) => void): void {
    this.onErrorCb = cb
  }
}

// Mock TCP server
class MockTcpServer implements ITcpServer {
  private onConnectionCb: ((socket: ITcpSocket) => void) | null = null
  private listening = false

  listen(_port: number, cb?: () => void): void {
    this.listening = true
    cb?.()
  }
  on(event: string, cb: (socket: ITcpSocket) => void): void {
    if (event === 'connection') {
      this.onConnectionCb = cb
    }
  }
  address(): { port: number } | null {
    return this.listening ? { port: 6881 } : null
  }
  close(): void {
    this.listening = false
  }
}

// Mock socket factory
function createMockSocketFactory(): ISocketFactory {
  return {
    createTcpSocket: () => Promise.resolve(new MockTcpSocket()),
    createTcpServer: () => new MockTcpServer(),
    wrapTcpSocket: () => new MockTcpSocket(),
    createUdpSocket: async () => new MockUdpSocket(),
  }
}

// Mock file system
function createMockFileSystem(): IFileSystem {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    open: () => Promise.resolve({} as any),
    exists: () => Promise.resolve(false),
    mkdir: () => Promise.resolve(),
    readdir: () => Promise.resolve([]),
    stat: () => Promise.resolve({ size: 0, mtime: new Date(), isDirectory: false, isFile: true }),
    delete: () => Promise.resolve(),
  }
}

describe('DHT Engine Integration', () => {
  let engine: BtEngine
  let sessionStore: MemorySessionStore
  let socketFactory: ISocketFactory
  let storageRootManager: StorageRootManager
  let config: MemoryConfigHub

  beforeEach(async () => {
    // Use real timers for integration tests since DHT involves network timeouts
    sessionStore = new MemorySessionStore()
    socketFactory = createMockSocketFactory()

    const fileSystem = createMockFileSystem()
    storageRootManager = new StorageRootManager(() => fileSystem)
    storageRootManager.addRoot({
      key: 'default',
      label: 'Default',
      path: '/downloads',
    })
    storageRootManager.setDefaultRoot('default')

    // Create ConfigHub for tests
    config = new MemoryConfigHub()
    await config.init()
  })

  afterEach(async () => {
    if (engine) {
      await engine.destroy()
    }
  })

  describe('DHT lifecycle', () => {
    it('starts with DHT disabled by default when dhtEnabled=false', async () => {
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        dhtEnabled: false,
        _skipDHTBootstrap: true,
      })

      expect(engine.dhtEnabled).toBe(false)
      expect(engine.dhtNode).toBeUndefined()
    })

    it('can enable DHT after creation via ConfigHub', async () => {
      config.set('dhtEnabled', false)
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        config,
        _skipDHTBootstrap: true,
      })

      expect(engine.dhtEnabled).toBe(false)

      config.set('dhtEnabled', true)
      // Wait for async enableDHT to complete
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(engine.dhtEnabled).toBe(true)
      expect(engine.dhtNode).toBeDefined()
      expect(engine.dhtNode?.ready).toBe(true)
    })

    it('can disable DHT after enabling via ConfigHub', async () => {
      config.set('dhtEnabled', false)
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        config,
        _skipDHTBootstrap: true,
      })

      config.set('dhtEnabled', true)
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(engine.dhtNode).toBeDefined()

      config.set('dhtEnabled', false)
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(engine.dhtEnabled).toBe(false)
      expect(engine.dhtNode).toBeUndefined()
    })

    it('saves DHT state on disable', async () => {
      config.set('dhtEnabled', false)
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        config,
        _skipDHTBootstrap: true,
      })

      config.set('dhtEnabled', true)
      await new Promise((resolve) => setTimeout(resolve, 10))
      const nodeId = engine.dhtNode?.nodeIdHex

      config.set('dhtEnabled', false)
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Check that state was saved
      const savedState = await sessionStore.getJson<{ nodeId: string }>('dht:state')
      expect(savedState).not.toBeNull()
      expect(savedState?.nodeId).toBe(nodeId)
    })

    it('restores DHT node ID from persisted state', async () => {
      // First engine - enable DHT and save state
      config.set('dhtEnabled', false)
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        config,
        _skipDHTBootstrap: true,
      })

      config.set('dhtEnabled', true)
      await new Promise((resolve) => setTimeout(resolve, 10))
      const originalNodeId = engine.dhtNode?.nodeIdHex
      config.set('dhtEnabled', false)
      await new Promise((resolve) => setTimeout(resolve, 10))
      await engine.destroy()

      // Create new config for second engine
      const config2 = new MemoryConfigHub()
      await config2.init()
      config2.set('dhtEnabled', false)

      // Second engine - should restore the same node ID
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        config: config2,
        _skipDHTBootstrap: true,
      })

      config2.set('dhtEnabled', true)
      await new Promise((resolve) => setTimeout(resolve, 10))
      const restoredNodeId = engine.dhtNode?.nodeIdHex

      expect(restoredNodeId).toBe(originalNodeId)
    })

    it('stops DHT on engine destroy', async () => {
      config.set('dhtEnabled', false)
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        config,
        _skipDHTBootstrap: true,
      })

      config.set('dhtEnabled', true)
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(engine.dhtNode).toBeDefined()

      await engine.destroy()

      // DHT should be stopped
      expect(engine.dhtEnabled).toBe(false)
    })
  })

  describe('DHT settings', () => {
    it('respects dhtEnabled option in constructor', async () => {
      // Engine with DHT disabled
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        dhtEnabled: false,
        _skipDHTBootstrap: true,
      })

      expect(engine.dhtEnabled).toBe(false)
    })

    it('defaults dhtEnabled to true', async () => {
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        _skipDHTBootstrap: true,
      })

      expect(engine.dhtEnabled).toBe(true)
    })
  })
})
