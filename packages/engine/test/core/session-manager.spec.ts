/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionManager } from '../../src/core/session-manager'
import { Client } from '../../src/core/client'
import { InMemoryFileSystem } from '../../src/io/memory/memory-filesystem'
import { Torrent } from '../../src/core/torrent'

// Mock Torrent
vi.mock('../../src/core/torrent', () => {
  return {
    Torrent: class MockTorrent {
      public infoHash: Uint8Array
      public on = vi.fn()
      constructor(infoHash: Uint8Array) {
        this.infoHash = infoHash
      }
    },
  }
})

describe('SessionManager', () => {
  let client: Client
  let fileSystem: InMemoryFileSystem
  let sessionManager: SessionManager

  beforeEach(() => {
    fileSystem = new InMemoryFileSystem()
    client = new Client({
      downloadPath: '/downloads',
      socketFactory: {
        createTcpServer: vi.fn().mockReturnValue({
          on: vi.fn(),
          listen: vi.fn(),
          address: vi.fn().mockReturnValue({ port: 0 }),
        }),
      } as any,
      fileSystem: fileSystem,
    })

    const mockStorageHandle = {
      id: 'session',
      name: 'session',
      getFileSystem: () => fileSystem,
    }

    const mockStorageManager = {
      register: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
    }

    // @ts-expect-error Mocking interfaces
    sessionManager = new SessionManager(client, mockStorageHandle, mockStorageManager, {
      profile: 'default',
    })
  })

  it('should save session state', async () => {
    const infoHash = new Uint8Array(20).fill(0xab)
    const torrent = new Torrent(infoHash, {} as any, {} as any, {} as any)
    client.addTorrentInstance(torrent)

    await sessionManager.save()

    const stat = await fileSystem.stat('session.json')
    const handle = await fileSystem.open('session.json', 'r')
    const data = new Uint8Array(stat.size)
    await handle.read(data, 0, stat.size, 0)

    const json = new TextDecoder().decode(data)
    const state = JSON.parse(json)

    expect(state.torrents).toHaveLength(1)
    expect(state.torrents[0].infoHash).toBe(Buffer.from(infoHash).toString('hex'))
  })

  it('should load session state', async () => {
    const state = {
      torrents: [
        {
          infoHash: 'abababababababababababababababababababab',
          savePath: '/downloads',
          paused: false,
        },
      ],
    }

    const data = new TextEncoder().encode(JSON.stringify(state))
    const handle = await fileSystem.open('session.json', 'w')
    await handle.write(data, 0, data.length, 0)
    await handle.close()

    // Spy on console.error to verify resume
    const logSpy = vi.spyOn(console, 'error')

    await sessionManager.load()

    expect(logSpy).toHaveBeenCalledWith(
      'Resuming torrent',
      'abababababababababababababababababababab',
    )
  })

  it('should handle missing session file gracefully', async () => {
    const logSpy = vi.spyOn(console, 'error')
    await sessionManager.load()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No session file found'))
  })
})
