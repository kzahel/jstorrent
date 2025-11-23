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
      // Verify infoHash matches
      // Send BitField
      peer.sendMessage(MessageType.BITFIELD, this.bitfield.toBuffer())
    })

    peer.on('bitfield', (_bf) => {
      // Update interest
      this.updateInterest(peer)
    })

    peer.on('have', (_index) => {
      this.updateInterest(peer)
    })

    peer.on('unchoke', () => {
      this.requestPieces(peer)
    })

    peer.on('message', (msg) => {
      if (msg.type === MessageType.PIECE) {
        this.handlePiece(peer, msg)
      }
    })
  }

  private updateInterest(peer: PeerConnection) {
    if (peer.bitfield) {
      // Check if peer has any piece we are missing
      // For now, just set interested if they have anything (naive)
      // Better: check intersection of peer.bitfield and ~this.bitfield
      const interested = true // Placeholder for logic
      if (interested && !peer.amInterested) {
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

    // Simple strategy: request first missing piece that peer has
    const missing = this.pieceManager.getMissingPieces()
    for (const index of missing) {
      if (peer.bitfield?.get(index)) {
        // Request whole piece (simplified, usually blocks)
        // We need piece length here. Assume we know it or request blocks.
        // For this phase, let's assume 1 piece = 1 block for simplicity of the test,
        // or just request a block.
        peer.sendRequest(index, 0, 16384) // Request first block
        break // One at a time for now
      } else {
        // Peer does not have piece
      }
    }
  }

  private async handlePiece(peer: PeerConnection, msg: WireMessage) {
    if (msg.index !== undefined && msg.begin !== undefined && msg.block) {
      await this.diskManager.write(msg.index, msg.begin, msg.block)

      // Update piece manager (simplified: assume 1 block = 1 piece or we track blocks)
      // Real implementation needs BlockManager.
      // For now, mark piece as done if we got a block (TESTING ONLY)
      this.pieceManager.setPiece(msg.index, true)
      this.emit('piece', msg.index)

      // Continue requesting
      this.requestPieces(peer)
    }
  }
  stop() {
    this.peers.forEach((peer) => peer.close())
    this.peers = []
    this.diskManager.close()
    this.emit('stopped')
  }
}
