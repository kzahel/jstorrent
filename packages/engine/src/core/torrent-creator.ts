import { IStorageHandle } from '../io/storage-handle'
import { Bencode } from '../utils/bencode'
import { IFileHandle, IFileSystem } from '../interfaces/filesystem'
import { IHasher } from '../interfaces/hasher'
import * as path from '../utils/path'

export interface TorrentCreationOptions {
  pieceLength?: number
  forceMultiFile?: boolean
  name?: string
  createdBy?: string
  comment?: string
  announceList?: string[][]
  urlList?: string[]
  private?: boolean
}

interface FileInfo {
  path: string
  length: number
  relativePath: string
}

export class TorrentCreator {
  private static readonly DEFAULT_PIECE_LENGTH = 256 * 1024 // 256KB
  private static readonly MIN_PIECE_LENGTH = 16 * 1024 // 16KB
  private static readonly MAX_PIECE_LENGTH = 16 * 1024 * 1024 // 16MB

  static async create(
    storage: IStorageHandle,
    rootPath: string,
    hasher: IHasher,
    options: TorrentCreationOptions = {},
  ): Promise<Uint8Array> {
    const fs = storage.getFileSystem()
    const rootStat = await fs.stat(rootPath)

    let files: FileInfo[] = []
    let totalSize = 0
    const isMultiFile = options.forceMultiFile || rootStat.isDirectory

    if (rootStat.isDirectory) {
      files = await this.discoverFiles(fs, rootPath, rootPath)
    } else {
      files = [
        {
          path: rootPath,
          length: rootStat.size,
          relativePath: path.basename(rootPath),
        },
      ]
    }

    totalSize = files.reduce((acc, f) => acc + f.length, 0)

    const pieceLength = options.pieceLength || this.calculatePieceLength(totalSize)
    const pieces = await this.hashFiles(fs, files, pieceLength, hasher)

    const info: Record<string, unknown> = {
      'piece length': pieceLength,
      pieces: pieces,
      name: options.name || path.basename(rootPath),
      'name.utf-8': options.name || path.basename(rootPath),
    }

    if (options.private) {
      info.private = 1
    }

    if (isMultiFile) {
      info.files = files.map((f) => {
        const pathSegments = f.relativePath.split(path.sep)
        return {
          length: f.length,
          path: pathSegments,
          'path.utf-8': pathSegments,
        }
      })
    } else {
      info.length = files[0].length
    }

    const dict: Record<string, unknown> = {
      info: info,
      encoding: 'UTF-8',
    }

    if (options.announceList && options.announceList.length > 0) {
      dict['announce-list'] = options.announceList
      dict.announce = options.announceList[0][0]
    }

    if (options.urlList && options.urlList.length > 0) {
      dict['url-list'] = options.urlList
    }

    if (options.comment) {
      dict.comment = options.comment
    }

    if (options.createdBy) {
      dict['created by'] = options.createdBy
    }

    dict['creation date'] = Math.floor(Date.now() / 1000)

    return Bencode.encode(dict)
  }

  private static async discoverFiles(
    fs: IFileSystem,
    currentPath: string,
    rootPath: string,
  ): Promise<FileInfo[]> {
    const entries = await fs.readdir(currentPath)
    let files: FileInfo[] = []

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry)
      const stat = await fs.stat(fullPath)

      if (stat.isDirectory) {
        files = files.concat(await this.discoverFiles(fs, fullPath, rootPath))
      } else {
        files.push({
          path: fullPath,
          length: stat.size,
          relativePath: path.relative(rootPath, fullPath),
        })
      }
    }
    return files
  }

  private static calculatePieceLength(totalSize: number): number {
    // Target around 1000-2000 pieces
    let pieceLength = this.DEFAULT_PIECE_LENGTH

    // Simple heuristic: power of 2 closest to totalSize / 1500
    const target = totalSize / 1500
    pieceLength = 1 << Math.ceil(Math.log2(target))

    if (pieceLength < this.MIN_PIECE_LENGTH) pieceLength = this.MIN_PIECE_LENGTH
    if (pieceLength > this.MAX_PIECE_LENGTH) pieceLength = this.MAX_PIECE_LENGTH

    return pieceLength
  }

  private static async hashFiles(
    fs: IFileSystem,
    files: FileInfo[],
    pieceLength: number,
    hasher: IHasher,
  ): Promise<Uint8Array> {
    const pieceHashes: Uint8Array[] = []
    const buffer = new Uint8Array(pieceLength)
    let bufferOffset = 0

    for (const file of files) {
      const handle: IFileHandle = await fs.open(file.path, 'r')
      let fileOffset = 0
      let remaining = file.length

      try {
        while (remaining > 0) {
          const bytesToRead = Math.min(remaining, pieceLength - bufferOffset)
          const { bytesRead } = await handle.read(buffer, bufferOffset, bytesToRead, fileOffset)

          if (bytesRead === 0) break // Should not happen if size is correct

          bufferOffset += bytesRead
          fileOffset += bytesRead
          remaining -= bytesRead

          if (bufferOffset === pieceLength) {
            pieceHashes.push(await hasher.sha1(buffer))
            bufferOffset = 0
          }
        }
      } finally {
        await handle.close()
      }
    }

    // Hash last partial piece
    if (bufferOffset > 0) {
      pieceHashes.push(await hasher.sha1(buffer.slice(0, bufferOffset)))
    }

    // Concatenate all hashes
    const result = new Uint8Array(pieceHashes.length * 20)
    for (let i = 0; i < pieceHashes.length; i++) {
      result.set(pieceHashes[i], i * 20)
    }

    return result
  }
}
