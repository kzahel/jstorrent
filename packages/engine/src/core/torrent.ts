import { EventEmitter } from 'events'
import { PeerConnection } from './peer-connection'
import { PieceManager } from './piece-manager'
import { DiskManager } from './disk-manager'
import { BitField } from '../utils/bitfield'
import { MessageType, WireMessage } from '../protocol/wire-protocol'

export class Torrent extends EventEmitter {
  private peers: PeerConnection[] = []

  constructor(
    public infoHash: Uint8Array,
    public pieceManager: PieceManager,
    public diskManager: DiskManager,
    public bitfield: BitField,
  ) {
    super()
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
      console.error(`Torrent: Have received ${_index}`)
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
      console.error(`Torrent: Peer error: ${err.message}`)
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
      const block = await this.diskManager.read(index, begin, length)
      peer.sendPiece(index, begin, block)
    } catch (err) {
      console.error(
        `Torrent: Error handling request: ${err instanceof Error ? err.message : String(err)}`,
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
    // console.error(`Torrent: Missing pieces: ${missing.length}`)
    for (const index of missing) {
      if (peer.bitfield?.get(index)) {
        const neededBlocks = this.pieceManager.getNeededBlocks(index)
        if (neededBlocks.length > 0) {
          // console.error(`Torrent: Requesting blocks for piece ${index}, needed: ${neededBlocks.length}`)
          for (const block of neededBlocks) {
            // TODO: Check if already requested from other peers (PieceManager tracks this now)
            // But we need to be careful not to request same block from multiple peers unless needed (endgame)
            // For now, PieceManager.addRequested marks it as requested globally.
            // We should probably track *who* we requested it from to handle timeouts/disconnects.
            // But for this phase (single peer download), global tracking is enough.

            peer.sendRequest(index, block.begin, block.length)
            this.pieceManager.addRequested(index, block.begin)

            // Limit requests per peer?
            // if (peer.requestsPending > 10) break
          }
          // Break after requesting one piece's blocks to avoid flooding?
          // break
        }
      }
    }
  }

  private async handlePiece(peer: PeerConnection, msg: WireMessage) {
    if (msg.index !== undefined && msg.begin !== undefined && msg.block) {
      // console.error(`Torrent: Received piece ${msg.index} begin ${msg.begin}`)
      await this.diskManager.write(msg.index, msg.begin, msg.block)

      this.pieceManager.addReceived(msg.index, msg.begin)

      if (this.pieceManager.isPieceComplete(msg.index)) {
        console.error(`Torrent: Piece ${msg.index} complete`)
        this.emit('piece', msg.index)
        // Send HAVE message to all peers
        for (const p of this.peers) {
          if (p.handshakeReceived) {
            p.sendHave(msg.index)
          }
        }
      }

      // Continue requesting
      this.requestPieces(peer)
    }
  }
  async stop() {
    console.error('Torrent: Stopping')
    this.peers.forEach((peer) => peer.close())
    this.peers = []
    await this.diskManager.close()
    this.emit('stopped')
  }
}
