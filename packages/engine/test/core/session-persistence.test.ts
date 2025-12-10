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
      // Manually add a torrent to engine for testing
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
