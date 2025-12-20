import { describe, it, expect, beforeEach } from 'vitest'
import { SessionPersistence } from '../../src/core/session-persistence'
import {
  MemorySessionStore,
  MemorySocketFactory,
  InMemoryFileSystem,
} from '../../src/adapters/memory'
import { BtEngine } from '../../src/core/bt-engine'
import { StorageRootManager } from '../../src/storage/storage-root-manager'
import { toHex, fromHex } from '../../src/utils/buffer'
import { BitField } from '../../src/utils/bitfield'

function createTestEngine(sessionStore: MemorySessionStore): BtEngine {
  const fs = new InMemoryFileSystem()
  const srm = new StorageRootManager(() => fs)
  srm.addRoot({ key: 'default', label: 'Default', path: '/downloads' })
  srm.setDefaultRoot('default')

  return new BtEngine({
    socketFactory: new MemorySocketFactory(),
    storageRootManager: srm,
    sessionStore,
    startSuspended: true,
  })
}

describe('SessionPersistence', () => {
  let store: MemorySessionStore
  let engine: BtEngine
  let persistence: SessionPersistence

  beforeEach(() => {
    store = new MemorySessionStore()
    engine = createTestEngine(store)
    persistence = engine.sessionPersistence
  })

  describe('saveTorrentList / loadTorrentList', () => {
    it('should save and load empty list', async () => {
      await persistence.saveTorrentList()
      const entries = await persistence.loadTorrentList()
      expect(entries).toEqual([])
    })

    it('should save and load file-source entries', async () => {
      const infoHash = new Uint8Array(20).fill(0xab)
      const mockTorrent = {
        infoHash,
        magnetLink: undefined,
        addedAt: 1702300000000,
        userState: 'active',
      }
      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)

      await persistence.saveTorrentList()
      const entries = await persistence.loadTorrentList()

      expect(entries).toHaveLength(1)
      expect(entries[0].source).toBe('file')
      expect(entries[0].infoHash).toBe(toHex(infoHash))
      expect(entries[0].addedAt).toBe(1702300000000)
      expect(entries[0].magnetUri).toBeUndefined()
    })

    it('should save and load magnet-source entries', async () => {
      const infoHash = new Uint8Array(20).fill(0xcd)
      const magnetUri = 'magnet:?xt=urn:btih:cdcdcdcd&dn=Test'
      const mockTorrent = {
        infoHash,
        magnetLink: magnetUri,
        addedAt: 1702300001000,
        userState: 'stopped',
      }
      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)

      await persistence.saveTorrentList()
      const entries = await persistence.loadTorrentList()

      expect(entries).toHaveLength(1)
      expect(entries[0].source).toBe('magnet')
      expect(entries[0].magnetUri).toBe(magnetUri)
    })

    it('should store JSON directly (not base64 encoded)', async () => {
      const infoHash = new Uint8Array(20).fill(0xab)
      const mockTorrent = {
        infoHash,
        magnetLink: undefined,
        addedAt: 1702300000000,
        userState: 'active',
      }
      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)

      await persistence.saveTorrentList()

      // Verify the data is stored as JSON, not binary
      const rawValue = await store.getJson('torrents')
      expect(rawValue).not.toBeNull()
      expect(typeof rawValue).toBe('object')
      // @ts-expect-error - we know it's an object
      expect(rawValue.version).toBe(2)
    })
  })

  describe('saveTorrentState / loadTorrentState', () => {
    it('should save and load state with bitfield', async () => {
      const infoHash = 'abababababababababababababababababababab'
      const mockTorrent = {
        infoHash: fromHex(infoHash),
        userState: 'active' as const,
        queuePosition: 1,
        bitfield: { toHex: () => 'ff00ff' },
        totalUploaded: 1000,
        totalDownloaded: 5000,
      }
      // @ts-expect-error - partial mock
      await persistence.saveTorrentState(mockTorrent)

      const state = await persistence.loadTorrentState(infoHash)

      expect(state).not.toBeNull()
      expect(state!.userState).toBe('active')
      expect(state!.bitfield).toBe('ff00ff')
      expect(state!.uploaded).toBe(1000)
      expect(state!.downloaded).toBe(5000)
    })

    it('should save and load state without bitfield', async () => {
      const infoHash = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'
      const mockTorrent = {
        infoHash: fromHex(infoHash),
        userState: 'stopped' as const,
        queuePosition: undefined,
        bitfield: undefined,
        totalUploaded: 0,
        totalDownloaded: 0,
      }
      // @ts-expect-error - partial mock
      await persistence.saveTorrentState(mockTorrent)

      const state = await persistence.loadTorrentState(infoHash)

      expect(state).not.toBeNull()
      expect(state!.bitfield).toBeUndefined()
    })

    it('should return null for unknown torrent', async () => {
      const state = await persistence.loadTorrentState('0000000000000000000000000000000000000000')
      expect(state).toBeNull()
    })

    it('should store state as JSON directly', async () => {
      const infoHash = 'abababababababababababababababababababab'
      const mockTorrent = {
        infoHash: fromHex(infoHash),
        userState: 'active' as const,
        queuePosition: 1,
        bitfield: { toHex: () => 'ff00' },
        totalUploaded: 100,
        totalDownloaded: 200,
      }
      // @ts-expect-error - partial mock
      await persistence.saveTorrentState(mockTorrent)

      // Verify the data is stored as JSON
      const rawValue = await store.getJson(`torrent:${infoHash}:state`)
      expect(rawValue).not.toBeNull()
      expect(typeof rawValue).toBe('object')
      // @ts-expect-error - we know it's an object
      expect(rawValue.userState).toBe('active')
    })
  })

  describe('saveTorrentFile / loadTorrentFile', () => {
    it('should save and load torrent file bytes', async () => {
      const infoHash = 'abababababababababababababababababababab'
      const torrentFile = new Uint8Array([
        0x64, 0x38, 0x3a, 0x61, 0x6e, 0x6e, 0x6f, 0x75, 0x6e, 0x63, 0x65,
      ])

      await persistence.saveTorrentFile(infoHash, torrentFile)
      const loaded = await persistence.loadTorrentFile(infoHash)

      expect(loaded).not.toBeNull()
      expect(loaded).toEqual(torrentFile)
    })

    it('should return null for unknown torrent', async () => {
      const loaded = await persistence.loadTorrentFile('0000000000000000000000000000000000000000')
      expect(loaded).toBeNull()
    })
  })

  describe('saveInfoDict / loadInfoDict', () => {
    it('should save and load info dict bytes', async () => {
      const infoHash = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'
      const infoDict = new Uint8Array([0x64, 0x34, 0x3a, 0x6e, 0x61, 0x6d, 0x65])

      await persistence.saveInfoDict(infoHash, infoDict)
      const loaded = await persistence.loadInfoDict(infoHash)

      expect(loaded).not.toBeNull()
      expect(loaded).toEqual(infoDict)
    })

    it('should return null for unknown torrent', async () => {
      const loaded = await persistence.loadInfoDict('0000000000000000000000000000000000000000')
      expect(loaded).toBeNull()
    })
  })

  describe('removeTorrentData', () => {
    it('should delete all keys for a torrent', async () => {
      const infoHash = 'abababababababababababababababababababab'
      const torrentFile = new Uint8Array([1, 2, 3])
      const infoDict = new Uint8Array([4, 5, 6])

      await persistence.saveTorrentFile(infoHash, torrentFile)
      await persistence.saveInfoDict(infoHash, infoDict)

      const mockTorrent = {
        infoHash: fromHex(infoHash),
        userState: 'active' as const,
        bitfield: { toHex: () => 'ff' },
        totalUploaded: 0,
        totalDownloaded: 0,
      }
      // @ts-expect-error - partial mock
      await persistence.saveTorrentState(mockTorrent)

      // Verify data exists
      expect(await persistence.loadTorrentFile(infoHash)).not.toBeNull()
      expect(await persistence.loadInfoDict(infoHash)).not.toBeNull()
      expect(await persistence.loadTorrentState(infoHash)).not.toBeNull()

      // Remove all
      await persistence.removeTorrentData(infoHash)

      // Verify all gone
      expect(await persistence.loadTorrentFile(infoHash)).toBeNull()
      expect(await persistence.loadInfoDict(infoHash)).toBeNull()
      expect(await persistence.loadTorrentState(infoHash)).toBeNull()
    })
  })
})

describe('Session Persistence Integration', () => {
  /**
   * Test the full lifecycle: add torrent, make progress, stop, reload, resume.
   * This catches the bug where userStop() was calling saveTorrentList() instead of saveTorrentState().
   */
  describe('stop → reload → resume lifecycle', () => {
    it('should preserve progress when stopping a torrent', async () => {
      const store = new MemorySessionStore()

      // Engine 1: Add torrent, make progress, stop
      const engine1 = createTestEngine(store)
      const infoHash = new Uint8Array(20).fill(0xab)
      const bitfield = new BitField(100) // 100 pieces
      bitfield.set(0, true)
      bitfield.set(1, true)
      bitfield.set(5, true) // 3 pieces complete

      const mockTorrent = {
        infoHash,
        magnetLink: 'magnet:?xt=urn:btih:abababababababababababababababababababab',
        addedAt: Date.now(),
        userState: 'active' as 'active' | 'stopped',
        bitfield,
        totalUploaded: 1000,
        totalDownloaded: 5000,
        queuePosition: 0,
        hasMetadata: true,
        restoreBitfieldFromHex: function (hex: string) {
          this.bitfield.restoreFromHex(hex)
        },
      }

      // @ts-expect-error - partial mock
      engine1.torrents.push(mockTorrent)

      // Save initial state (simulates piece verification)
      await engine1.sessionPersistence.saveTorrentList()
      await engine1.sessionPersistence.saveTorrentState(mockTorrent as never)

      // User stops the torrent - this should save state
      mockTorrent.userState = 'stopped'
      await engine1.sessionPersistence.saveTorrentState(mockTorrent as never)

      // Engine 2: Fresh load from storage
      const engine2 = createTestEngine(store)

      // Load torrent list
      const entries = await engine2.sessionPersistence.loadTorrentList()
      expect(entries).toHaveLength(1)

      // Load torrent state
      const state = await engine2.sessionPersistence.loadTorrentState(entries[0].infoHash)
      expect(state).not.toBeNull()
      expect(state!.userState).toBe('stopped')
      expect(state!.bitfield).toBeDefined()

      // Restore bitfield and verify progress
      const restoredBitfield = BitField.fromHex(state!.bitfield!, 100)
      expect(restoredBitfield.get(0)).toBe(true)
      expect(restoredBitfield.get(1)).toBe(true)
      expect(restoredBitfield.get(5)).toBe(true)
      expect(restoredBitfield.get(2)).toBe(false)
      expect(restoredBitfield.count()).toBe(3)
    })

    it('should preserve progress through immediate save (no debounce race)', async () => {
      const store = new MemorySessionStore()
      const engine = createTestEngine(store)

      const infoHash = new Uint8Array(20).fill(0xcd)
      const bitfield = new BitField(50)

      const mockTorrent = {
        infoHash,
        magnetLink: 'magnet:?xt=urn:btih:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
        addedAt: Date.now(),
        userState: 'active' as 'active' | 'stopped',
        bitfield,
        totalUploaded: 0,
        totalDownloaded: 0,
        queuePosition: 0,
      }

      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)
      await engine.sessionPersistence.saveTorrentList()

      // Simulate piece verification → immediate save (not debounced anymore)
      bitfield.set(10, true)
      await engine.sessionPersistence.saveTorrentState(mockTorrent as never)

      // Immediately stop (with old debounce, this could race)
      mockTorrent.userState = 'stopped'
      await engine.sessionPersistence.saveTorrentState(mockTorrent as never)

      // Verify state was saved correctly
      const state = await engine.sessionPersistence.loadTorrentState(toHex(infoHash))
      expect(state).not.toBeNull()
      expect(state!.userState).toBe('stopped')

      const restoredBitfield = BitField.fromHex(state!.bitfield!, 50)
      expect(restoredBitfield.get(10)).toBe(true)
    })

    it('should handle userStart saving state', async () => {
      const store = new MemorySessionStore()
      const engine = createTestEngine(store)

      const infoHash = new Uint8Array(20).fill(0xef)
      const bitfield = new BitField(20)
      bitfield.set(0, true)

      const mockTorrent = {
        infoHash,
        magnetLink: 'magnet:?xt=urn:btih:efefefefefefefefefefefefefefefefefefefef',
        addedAt: Date.now(),
        userState: 'stopped' as 'active' | 'stopped',
        bitfield,
        totalUploaded: 500,
        totalDownloaded: 1500,
        queuePosition: 0,
      }

      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)
      await engine.sessionPersistence.saveTorrentList()
      await engine.sessionPersistence.saveTorrentState(mockTorrent as never)

      // User starts the torrent
      mockTorrent.userState = 'active'
      await engine.sessionPersistence.saveTorrentState(mockTorrent as never)

      // Verify state shows active
      const state = await engine.sessionPersistence.loadTorrentState(toHex(infoHash))
      expect(state!.userState).toBe('active')
      expect(state!.bitfield).toBeDefined()
    })
  })

  describe('JSON storage format', () => {
    it('should store torrent list as readable JSON', async () => {
      const store = new MemorySessionStore()
      const engine = createTestEngine(store)

      const mockTorrent = {
        infoHash: new Uint8Array(20).fill(0x12),
        magnetLink: 'magnet:?xt=urn:btih:test',
        addedAt: 1702300000000,
        userState: 'active' as const,
      }

      // @ts-expect-error - partial mock
      engine.torrents.push(mockTorrent)
      await engine.sessionPersistence.saveTorrentList()

      // Verify JSON is stored directly
      const stored = await store.getJson<{ version: number; torrents: unknown[] }>('torrents')
      expect(stored).not.toBeNull()
      expect(stored!.version).toBe(2)
      expect(stored!.torrents).toHaveLength(1)
    })

    it('should store torrent state as readable JSON', async () => {
      const store = new MemorySessionStore()
      const engine = createTestEngine(store)

      const infoHash = 'abababababababababababababababababababab'
      const mockTorrent = {
        infoHash: fromHex(infoHash),
        userState: 'active' as const,
        bitfield: { toHex: () => 'ffff' },
        totalUploaded: 100,
        totalDownloaded: 200,
        queuePosition: 0,
      }

      // @ts-expect-error - partial mock
      await engine.sessionPersistence.saveTorrentState(mockTorrent)

      // Verify JSON is stored directly
      const stored = await store.getJson<{ userState: string; bitfield: string }>(
        `torrent:${infoHash}:state`,
      )
      expect(stored).not.toBeNull()
      expect(stored!.userState).toBe('active')
      expect(stored!.bitfield).toBe('ffff')
    })
  })
})
