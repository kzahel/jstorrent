import { describe, it, expect, beforeEach } from 'vitest'
import { DiskManager } from '../../src/core/disk-manager'
import { MemoryFileSystem } from '../mocks/memory-filesystem'
import { TorrentFile } from '../../src/core/torrent-file'

describe('DiskManager', () => {
  let fs: MemoryFileSystem
  let dm: DiskManager
  const pieceLength = 10

  beforeEach(() => {
    fs = new MemoryFileSystem()
    dm = new DiskManager(fs)
  })

  it('should write and read from a single file', async () => {
    const files: TorrentFile[] = [{ path: 'file1.txt', length: 20, offset: 0 }]
    await dm.open(files, pieceLength)

    const data = new Uint8Array([1, 2, 3, 4, 5])
    await dm.write(0, 0, data)

    const readBack = await dm.read(0, 0, 5)
    expect(readBack).toEqual(data)

    // Check underlying fs
    const fileContent = fs.files.get('file1.txt')
    expect(fileContent?.slice(0, 5)).toEqual(data)
  })

  it('should handle writes spanning multiple files', async () => {
    const files: TorrentFile[] = [
      { path: 'part1', length: 5, offset: 0 },
      { path: 'part2', length: 5, offset: 5 },
    ]
    await dm.open(files, pieceLength)

    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) // 10 bytes
    await dm.write(0, 0, data)

    // Check individual files
    expect(fs.files.get('part1')).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    expect(fs.files.get('part2')).toEqual(new Uint8Array([6, 7, 8, 9, 10]))

    // Read back spanning files
    const readBack = await dm.read(0, 0, 10)
    expect(readBack).toEqual(data)
  })

  it('should handle reads/writes with offsets', async () => {
    const files: TorrentFile[] = [{ path: 'file1', length: 100, offset: 0 }]
    await dm.open(files, 10) // piece length 10

    const data = new Uint8Array([0xaa, 0xbb])
    // Write to piece 1 (offset 10), begin 2 -> total offset 12
    await dm.write(1, 2, data)

    const readBack = await dm.read(1, 2, 2)
    expect(readBack).toEqual(data)

    const fileContent = fs.files.get('file1')
    expect(fileContent?.[12]).toBe(0xaa)
    expect(fileContent?.[13]).toBe(0xbb)
  })
})
