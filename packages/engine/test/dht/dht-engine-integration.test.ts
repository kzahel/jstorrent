import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BtEngine } from '../../src/core/bt-engine'
import { ISocketFactory, IUdpSocket, ITcpSocket, ITcpServer } from '../../src/interfaces/socket'
import { MemorySessionStore } from '../../src/adapters/memory/memory-session-store'
import { StorageRootManager } from '../../src/storage/storage-root-manager'
import { IFileSystem } from '../../src/interfaces/filesystem'

// Mock UDP socket for DHT
class MockUdpSocket implements IUdpSocket {
  onMessageCallback: ((src: { addr: string; port: number }, data: Uint8Array) => void) | null = null
  onErrorCallback: ((err: Error) => void) | null = null
  closed = false

  send(_addr: string, _port: number, _data: Uint8Array): void {}
  onMessage(cb: (src: { addr: string; port: number }, data: Uint8Array) => void): void {
    this.onMessageCallback = cb
  }
  onError(cb: (err: Error) => void): void {
    this.onErrorCallback = cb
  }
  close(): void {
    this.closed = true
  }
  address(): { port: number } {
    return { port: 6881 }
  }
}

// Mock TCP socket
class MockTcpSocket implements ITcpSocket {
  remoteAddress = '127.0.0.1'
  remotePort = 12345
  connected = false
  closed = false
  private onDataCb: ((data: Uint8Array) => void) | null = null
  private onCloseCb: (() => void) | null = null
  private onErrorCb: ((err: Error) => void) | null = null

  connect(_host: string, _port: number): Promise<void> {
    this.connected = true
    return Promise.resolve()
  }
  write(_data: Uint8Array): void {}
  close(): void {
    this.closed = true
    this.onCloseCb?.()
  }
  onData(cb: (data: Uint8Array) => void): void {
    this.onDataCb = cb
  }
  onClose(cb: () => void): void {
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
    readFile: () => Promise.resolve(new Uint8Array()),
    writeFile: () => Promise.resolve(),
    exists: () => Promise.resolve(false),
    mkdir: () => Promise.resolve(),
    readdir: () => Promise.resolve([]),
    stat: () => Promise.resolve({ size: 0, isDirectory: false }),
    remove: () => Promise.resolve(),
  }
}

describe('DHT Engine Integration', () => {
  let engine: BtEngine
  let sessionStore: MemorySessionStore
  let socketFactory: ISocketFactory
  let storageRootManager: StorageRootManager

  beforeEach(() => {
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

    it('can enable DHT after creation', async () => {
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        dhtEnabled: false,
        _skipDHTBootstrap: true,
      })

      expect(engine.dhtEnabled).toBe(false)

      await engine.setDHTEnabled(true)

      expect(engine.dhtEnabled).toBe(true)
      expect(engine.dhtNode).toBeDefined()
      expect(engine.dhtNode?.ready).toBe(true)
    })

    it('can disable DHT after enabling', async () => {
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        dhtEnabled: false,
        _skipDHTBootstrap: true,
      })

      await engine.setDHTEnabled(true)
      expect(engine.dhtNode).toBeDefined()

      await engine.setDHTEnabled(false)

      expect(engine.dhtEnabled).toBe(false)
      expect(engine.dhtNode).toBeUndefined()
    })

    it('saves DHT state on disable', async () => {
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        dhtEnabled: false,
        _skipDHTBootstrap: true,
      })

      await engine.setDHTEnabled(true)
      const nodeId = engine.dhtNode?.nodeIdHex

      await engine.setDHTEnabled(false)

      // Check that state was saved
      const savedState = await sessionStore.getJson<{ nodeId: string }>('dht:state')
      expect(savedState).not.toBeNull()
      expect(savedState?.nodeId).toBe(nodeId)
    })

    it('restores DHT node ID from persisted state', async () => {
      // First engine - enable DHT and save state
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        dhtEnabled: false,
        _skipDHTBootstrap: true,
      })

      await engine.setDHTEnabled(true)
      const originalNodeId = engine.dhtNode?.nodeIdHex
      await engine.setDHTEnabled(false)
      await engine.destroy()

      // Second engine - should restore the same node ID
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        dhtEnabled: false,
        _skipDHTBootstrap: true,
      })

      await engine.setDHTEnabled(true)
      const restoredNodeId = engine.dhtNode?.nodeIdHex

      expect(restoredNodeId).toBe(originalNodeId)
    })

    it('stops DHT on engine destroy', async () => {
      engine = new BtEngine({
        socketFactory,
        storageRootManager,
        sessionStore,
        dhtEnabled: false,
        _skipDHTBootstrap: true,
      })

      await engine.setDHTEnabled(true)
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
