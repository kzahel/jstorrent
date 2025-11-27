/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { Torrent } from '../../src/core/torrent'
import { PieceManager } from '../../src/core/piece-manager'
import { TorrentContentStorage } from '../../src/core/torrent-content-storage'
import { InMemoryFileSystem } from '../../src/io/memory/memory-filesystem'
import { BitField } from '../../src/utils/bitfield'
import { PeerConnection } from '../../src/core/peer-connection'
import { ITcpSocket } from '../../src/interfaces/socket'
import { PeerWireProtocol } from '../../src/protocol/wire-protocol'
import { MockEngine } from '../utils/mock-engine'

// Mock Socket
class MockSocket implements ITcpSocket {
  public sentData: Uint8Array[] = []
  public onDataCb: ((data: Uint8Array) => void) | null = null
  public onCloseCb: ((hadError: boolean) => void) | null = null
  public onErrorCb: ((err: Error) => void) | null = null

  send(data: Uint8Array) {
    this.sentData.push(data)
  }
  onData(cb: any) {
    this.onDataCb = cb
  }
  onClose(cb: any) {
    this.onCloseCb = cb
  }
  onError(cb: any) {
    this.onErrorCb = cb
  }
  close() { }
  emitData(data: Uint8Array) {
    if (this.onDataCb) this.onDataCb(data)
  }
}

describe('Torrent', () => {
  let torrent: Torrent
  let pm: PieceManager
  let fileSystem: InMemoryFileSystem
  let contentStorage: TorrentContentStorage
  let engine: MockEngine
  const infoHash = new Uint8Array(20).fill(1)

  beforeEach(async () => {
    engine = new MockEngine()
    fileSystem = new InMemoryFileSystem()
    const mockStorageHandle = {
      id: 'test',
      name: 'test',
      getFileSystem: () => fileSystem,
    }
    contentStorage = new TorrentContentStorage(mockStorageHandle)
    await contentStorage.open([{ path: 'test', length: 100, offset: 0 }], 10)
    pm = new PieceManager(engine, 10, 10, 10)

    const peerId = new Uint8Array(20).fill(0)
    const socketFactory = { createTcpSocket: () => { }, createTcpServer: () => { } } as any
    const port = 0

    torrent = new Torrent(
      engine,
      infoHash,
      peerId,
      socketFactory,
      port,
      pm,
      contentStorage,
      new BitField(10)
    )
  })

  it.skip('should handle piece from peer', async () => {
    const socket = new MockSocket()
    const peer = new PeerConnection(engine, socket)
    torrent.addPeer(peer)

    // Simulate handshake to setup state
    // peer.emit('handshake', ...);

    // Simulate receiving a piece
    const block = new Uint8Array(10).fill(9)

    // We need to trigger the message event on peer
    // Since PeerConnection parses data, we feed data to socket

    return new Promise<void>((resolve, reject) => {
      torrent.on('piece', async (_index) => {
        try {
          // Verify disk has data
          const readBack = await contentStorage.read(0, 0, 10)
          expect(readBack).toEqual(block)

          // Verify piece manager updated
          expect(pm.hasPiece(0)).toBe(true)
          resolve()
        } catch (e) {
          reject(e)
        }
      })

      // Simulate handshake first
      const handshake = PeerWireProtocol.createHandshake(infoHash, new Uint8Array(20).fill(2))
      socket.emitData(handshake)

      // Now send piece
      const pieceMsg = PeerWireProtocol.createPiece(0, 0, block)
      socket.emitData(pieceMsg)
    })
  })
})
