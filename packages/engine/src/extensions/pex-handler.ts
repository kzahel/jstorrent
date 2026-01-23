import { PeerConnection } from '../core/peer-connection'
import { Bencode } from '../utils/bencode'
import { parseCompactPeers, PeerAddress } from '../core/swarm'

const EXT_HANDSHAKE_ID = 0

export class PexHandler {
  // The peer's ut_pex ID (used when we send PEX messages TO them)
  private _peerPexId: number | null = null

  constructor(private peer: PeerConnection) {
    // Listen for extended messages
    // - ID 0 = extended handshake (extract peer's ut_pex ID)
    // - ID = peer.myPexId = incoming PEX message (peer uses OUR ID when sending to us)
    this.peer.on('extended', (id, payload) => {
      if (id === EXT_HANDSHAKE_ID) {
        this.handleExtendedHandshake(payload)
      } else if (id === this.peer.myPexId) {
        this.handlePexMessage(payload)
      }
    })
  }

  private handleExtendedHandshake(payload: Uint8Array) {
    try {
      const dict = Bencode.decode(payload)
      if (dict && dict.m && dict.m['ut_pex']) {
        // Store peer's PEX ID for when we want to send PEX messages to them
        this._peerPexId = dict.m['ut_pex']
      }
    } catch (_err) {
      // Ignore invalid extended handshake
    }
  }

  /** Returns whether the peer supports PEX */
  get peerSupportsPex(): boolean {
    return this._peerPexId !== null
  }

  private handlePexMessage(payload: Uint8Array) {
    try {
      const dict = Bencode.decode(payload)
      const allPeers: PeerAddress[] = []

      // IPv4 peers (6 bytes each: 4 IP + 2 port)
      if (dict.added && dict.added instanceof Uint8Array) {
        const ipv4Peers = parseCompactPeers(dict.added, 'ipv4')
        allPeers.push(...ipv4Peers)
      }

      // IPv6 peers (18 bytes each: 16 IP + 2 port)
      // FIXED: Previously used IPv4 parser (6 bytes) which was wrong
      if (dict.added6 && dict.added6 instanceof Uint8Array) {
        const ipv6Peers = parseCompactPeers(dict.added6, 'ipv6')
        allPeers.push(...ipv6Peers)
      }

      // Emit all discovered peers in a single event
      if (allPeers.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(this.peer as any).emit('pex_peers', allPeers)
      }

      // We could also handle 'dropped' / 'dropped6' to mark peers as gone
    } catch (_err) {
      // Ignore invalid PEX messages
    }
  }
}
