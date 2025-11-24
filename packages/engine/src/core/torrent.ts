import { EventEmitter } from 'events'
import { PeerConnection } from './peer-connection'
import { PieceManager } from './piece-manager'
import { TorrentContentStorage } from './torrent-content-storage'
import { BitField } from '../utils/bitfield'
import { MessageType, WireMessage } from '../protocol/wire-protocol'

export class Torrent extends EventEmitter {
  private peers: PeerConnection[] = []
  public infoHash: Uint8Array
  public pieceManager: PieceManager
  public contentStorage: TorrentContentStorage
  public bitfield: BitField

  constructor(
    infoHash: Uint8Array,
    pieceManager: PieceManager,
    contentStorage: TorrentContentStorage,
    bitfield: BitField,
  ) {
    super()
    this.infoHash = infoHash
    this.pieceManager = pieceManager
    this.contentStorage = contentStorage
    this.bitfield = bitfield
  }

  get infoHashStr(): string {
    return Buffer.from(this.infoHash).toString('hex')
  }

  get numPeers(): number {
    return this.peers.length
  }

  addPeer(peer: PeerConnection) {
    this.peers.push(peer)
    peer.bitfield = new BitField(this.pieceManager.getPieceCount())
    this.setupPeerListeners(peer)

    // Send handshake
    // In a real scenario, we might wait for connection or it might be already connected
    // For now, assume we trigger handshake
    // peer.sendHandshake(this.infoHash, this.peerId); // We need a local peerId
  }

  private setupPeerListeners(peer: PeerConnection) {
    peer.on('handshake', (_infoHash, _peerId) => {
      console.error('Torrent: Handshake received')
      // Verify infoHash matches
      // Send BitField
      peer.sendMessage(MessageType.BITFIELD, this.bitfield.toBuffer())
    })

    peer.on('bitfield', (_bf) => {
      console.error('Torrent: Bitfield received')
      // Update interest
      this.updateInterest(peer)
    })

    peer.on('have', (_index) => {
      console.error(`Torrent: Have received ${_index} `)
      this.updateInterest(peer)
    })

    peer.on('unchoke', () => {
      console.error('Torrent: Unchoke received')
      this.requestPieces(peer)
    })

    peer.on('interested', () => {
      console.error('Torrent: Interested received')
      this.handleInterested(peer)
    })

    peer.on('message', (msg) => {
      if (msg.type === MessageType.PIECE) {
        this.handlePiece(peer, msg)
      }
    })

    peer.on('request', (index, begin, length) => {
      this.handleRequest(peer, index, begin, length)
    })

    peer.on('error', (err) => {
      console.error(`Torrent: Peer error: ${err.message} `)
      this.removePeer(peer)
    })

    peer.on('close', () => {
      console.error('Torrent: Peer closed')
      this.removePeer(peer)
    })
  }

  private removePeer(peer: PeerConnection) {
    const index = this.peers.indexOf(peer)
    if (index !== -1) {
      this.peers.splice(index, 1)
    }
  }

  private async handleRequest(peer: PeerConnection, index: number, begin: number, length: number) {
    if (peer.amChoking) {
      // We are choking the peer, ignore request
      return
    }

    if (!this.bitfield.get(index)) {
      // We don't have this piece
      return
    }

    try {
      const block = await this.contentStorage.read(index, begin, length)
      peer.sendPiece(index, begin, block)
    } catch (err) {
      console.error(
        `Torrent: Error handling request: ${err instanceof Error ? err.message : String(err)} `,
      )
    }
  }

  private handleInterested(peer: PeerConnection) {
    peer.peerInterested = true
    // Simple unchoke strategy: always unchoke interested peers
    if (peer.amChoking) {
      console.error('Torrent: Unchoking peer')
      peer.amChoking = false
      peer.sendMessage(MessageType.UNCHOKE)
    }
  }

  private updateInterest(peer: PeerConnection) {
    if (peer.bitfield) {
      // Check if peer has any piece we are missing
      // For now, just set interested if they have anything (naive)
      // Better: check intersection of peer.bitfield and ~this.bitfield
      const interested = true // Placeholder for logic
      if (interested && !peer.amInterested) {
        console.error('Torrent: Sending INTERESTED')
        peer.sendMessage(MessageType.INTERESTED)
        peer.amInterested = true
      }

      // If we are interested and unchoked, try to request
      if (interested && !peer.peerChoking) {
        this.requestPieces(peer)
      }
    }
  }

  private requestPieces(peer: PeerConnection) {
    if (peer.peerChoking) {
      return
    }

    // Simple strategy: request missing blocks from pieces that peer has
    const missing = this.pieceManager.getMissingPieces()
    // console.error(`Torrent: Missing pieces: ${ missing.length } `)

    // Count pending requests for this peer
    // We need to track this on the peer object or calculate it.
    // For now, let's just limit the loop iterations if we assume we call this frequently.
    // But we don't track pending requests per peer yet.
    // Let's add a simple counter to PeerConnection?
    // Or just rely on the fact that we only call this on unchoke and piece receive.

    // Pipelining: Keep a certain number of requests in flight.
    // We need to know how many are already in flight.
    // Since we don't track per-peer requests yet, let's just limit the *new* requests we send in this batch.
    // But if we already have 100 pending, we shouldn't send more.
    // We need to add `requestsPending` to PeerConnection.

    const MAX_PIPELINE = 200

    for (const index of missing) {
      if (peer.requestsPending >= MAX_PIPELINE) break

      if (peer.bitfield?.get(index)) {
        const neededBlocks = this.pieceManager.getNeededBlocks(index)
        if (neededBlocks.length > 0) {
          for (const block of neededBlocks) {
            if (peer.requestsPending >= MAX_PIPELINE) break

            // Check if already requested (global check)
            // This is a bit weak for multi-peer but okay for single peer.
            // Ideally we check if *anyone* requested it.
            // pieceManager.getNeededBlocks already filters out requested blocks?
            // No, getNeededBlocks returns blocks that are not received.
            // We need to check if they are requested.
            // pieceManager.addRequested marks them.
            // We should check isRequested inside getNeededBlocks or here.
            // pieceManager.getNeededBlocks DOES NOT check requested status in current implementation?
            // Let's check PieceManager.

            // Assuming getNeededBlocks returns un-requested blocks or we need to check.
            // Let's assume we need to check.
            if (this.pieceManager.isBlockRequested(index, block.begin)) continue

            peer.sendRequest(index, block.begin, block.length)
            peer.requestsPending++
            this.pieceManager.addRequested(index, block.begin)
          }
        }
      }
    }
  }

  private async handlePiece(peer: PeerConnection, msg: WireMessage) {
    if (msg.index !== undefined && msg.begin !== undefined && msg.block) {
      // console.error(`Torrent: Received piece ${ msg.index } begin ${ msg.begin } `)
      if (peer.requestsPending > 0) peer.requestsPending--

      await this.contentStorage.write(msg.index, msg.begin, msg.block)

      this.pieceManager.addReceived(msg.index, msg.begin)

      if (this.pieceManager.isPieceComplete(msg.index)) {
        // Verify hash
        const isValid = await this.verifyPiece(msg.index)
        if (isValid) {
          console.error(`Torrent: Piece ${msg.index} verified and complete`)
          this.pieceManager.markVerified(msg.index)
          this.emit('piece', msg.index)

          // Emit verified event for persistence
          this.emit('verified', {
            bitfield: this.bitfield.toHex(),
          })

          // Send HAVE message to all peers
          for (const p of this.peers) {
            if (p.handshakeReceived) {
              p.sendHave(msg.index)
            }
          }
        } else {
          console.error(`Torrent: Piece ${msg.index} failed hash check`)
          this.pieceManager.resetPiece(msg.index)
        }
      }

      // Continue requesting
      this.requestPieces(peer)
    }
  }

  private async verifyPiece(index: number): Promise<boolean> {
    const expectedHash = this.pieceManager.getPieceHash(index)
    if (!expectedHash) {
      // If no hashes provided (e.g. Phase 1), assume valid
      return true
    }

    // Read full piece from disk
    const pieceLength = this.pieceManager.getPieceLength(index)
    const data = await this.contentStorage.read(index, 0, pieceLength)

    // Calculate SHA1
    const crypto = await import('crypto')
    const hash = crypto.createHash('sha1').update(data).digest()

    // Compare
    return Buffer.compare(hash, expectedHash) === 0
  }
  async stop() {
    console.error('Torrent: Stopping')
    this.peers.forEach((peer) => peer.close())
    this.peers = []
    await this.contentStorage.close()
    this.emit('stopped')
  }

  async recheckData() {
    console.error(`Torrent: Rechecking data for ${this.infoHashStr}`)
    // TODO: Pause peers?

    // We iterate through all pieces and verify them.
    // We don't clear the bitfield upfront because we want to keep what we have if it's valid.
    // But if we find an invalid piece that was marked valid, we must reset it.

    const piecesCount = this.pieceManager.getPieceCount()
    for (let i = 0; i < piecesCount; i++) {
      try {
        const isValid = await this.verifyPiece(i)
        if (isValid) {
          if (!this.pieceManager.hasPiece(i)) {
            console.error(`Torrent: Piece ${i} found valid during recheck`)
            this.pieceManager.markVerified(i)
          }
        } else {
          if (this.pieceManager.hasPiece(i)) {
            console.error(`Torrent: Piece ${i} found invalid during recheck`)
            this.pieceManager.resetPiece(i)
          }
        }
      } catch (err) {
        // Read error or other issue
        if (this.pieceManager.hasPiece(i)) {
          console.error(`Torrent: Piece ${i} error during recheck:`, err)
          this.pieceManager.resetPiece(i)
        }
      }

      // Emit progress?
      if (i % 10 === 0) {
        // console.error(`Torrent: Recheck progress ${i}/${piecesCount}`)
      }
    }

    // Trigger save of resume data
    this.emit('verified', { bitfield: this.bitfield.toHex() })
    this.emit('checked')
    console.error(`Torrent: Recheck complete for ${this.infoHashStr}`)
  }
}
