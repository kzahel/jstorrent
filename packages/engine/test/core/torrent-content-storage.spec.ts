import { describe, it, expect, beforeEach } from 'vitest'
import { TorrentContentStorage } from '../../src/core/torrent-content-storage'
import { InMemoryFileSystem } from '../../src/io/memory/memory-filesystem'
import { TorrentFile } from '../../src/core/torrent-file'
import { MockEngine } from '../utils/mock-engine'

describe('TorrentContentStorage', () => {
  let fileSystem: InMemoryFileSystem
  let contentStorage: TorrentContentStorage
  const pieceLength = 10
  const mockEngine = new MockEngine()

  beforeEach(() => {
    fileSystem = new InMemoryFileSystem()
    const mockStorageHandle = {
      id: 'test',
      name: 'test',
      getFileSystem: () => fileSystem,
    }
    contentStorage = new TorrentContentStorage(mockEngine, mockStorageHandle)
  })

  it('should write and read from a single file', async () => {
    await contentStorage.open([{ path: 'file1.txt', length: 10, offset: 0 }], pieceLength)
    const data = new Uint8Array([1, 2, 3, 4, 5])
    await contentStorage.write(0, 0, data)

    const read = await contentStorage.read(0, 0, 5)
    expect(read).toEqual(data)

    // Verify file system
    const stat = await fileSystem.stat('file1.txt')
    expect(stat.size).toBe(5)
  })

  it('should handle writes spanning multiple files', async () => {
    const files: TorrentFile[] = [
      { path: 'part1', length: 5, offset: 0 },
      { path: 'part2', length: 5, offset: 5 },
    ]
    await contentStorage.open(files, pieceLength)

    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    await contentStorage.write(0, 0, data)

    const part1Stat = await fileSystem.stat('part1')
    const part2Stat = await fileSystem.stat('part2')

    expect(part1Stat.size).toBe(5)
    expect(part2Stat.size).toBe(5)

    const read = await contentStorage.read(0, 0, 10)
    expect(read).toEqual(data)
  })

  it('should handle reads/writes with offsets', async () => {
    const files: TorrentFile[] = [{ path: 'file1', length: 20, offset: 0 }]
    await contentStorage.open(files, pieceLength)

    const data = new Uint8Array([1, 2])
    // Write to piece 1 (offset 10), begin 2 -> total offset 12
    await contentStorage.write(1, 2, data)

    const read = await contentStorage.read(1, 2, 2)
    expect(read).toEqual(data)

    const stat = await fileSystem.stat('file1')
    expect(stat.size).toBe(14) // 12 padding + 2 bytes
  })
})
