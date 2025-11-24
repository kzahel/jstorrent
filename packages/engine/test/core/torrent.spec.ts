/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { Torrent } from '../../src/core/torrent'
import { PieceManager } from '../../src/core/piece-manager'
import { TorrentContentStorage } from '../../src/core/torrent-content-storage'
import { MemoryFileSystem } from '../mocks/memory-filesystem'
import { BitField } from '../../src/utils/bitfield'
import { PeerConnection } from '../../src/core/peer-connection'
import { ITcpSocket } from '../../src/interfaces/socket'
import { PeerWireProtocol } from '../../src/protocol/wire-protocol'

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
  close() {}
  emitData(data: Uint8Array) {
    if (this.onDataCb) this.onDataCb(data)
  }
}

describe('Torrent', () => {
  let torrent: Torrent
  let pm: PieceManager
  let dm: TorrentContentStorage
  let fs: MemoryFileSystem
  const infoHash = new Uint8Array(20).fill(1)

  beforeEach(async () => {
    fs = new MemoryFileSystem()
    const mockStorageHandle = {
      id: 'test',
      name: 'test',
      getFileSystem: () => fs,
    }
    dm = new TorrentContentStorage(mockStorageHandle)
    await dm.open([{ path: 'test', length: 100, offset: 0 }], 10)
    pm = new PieceManager(10, 10, 10)
    torrent = new Torrent(infoHash, pm, dm, new BitField(10))
  })

  it('should handle piece from peer', async () => {
    const socket = new MockSocket()
    const peer = new PeerConnection(socket)
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
          const readBack = await dm.read(0, 0, 10)
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
