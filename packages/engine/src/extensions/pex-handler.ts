import { PeerConnection } from '../core/peer-connection'
import { Bencode } from '../utils/bencode'
import { parseCompactPeers, PeerAddress } from '../core/swarm'

const EXT_HANDSHAKE_ID = 0

export class PexHandler {
  private _pexId: number | null = null

  constructor(private peer: PeerConnection) {
    this.peer.on('handshake', (_infoHash, _peerId, extensions) => {
      if (extensions) {
        this.sendExtendedHandshake()
      }
    })

    this.peer.on('extended', (id, payload) => {
      if (id === EXT_HANDSHAKE_ID) {
        this.handleExtendedHandshake(payload)
      } else if (id === this._pexId) {
        this.handlePexMessage(payload)
      }
    })
  }

  private sendExtendedHandshake() {
    const payload = {
      m: { ut_pex: 1 }, // We support PEX with ID 1
      v: 'JSTorrent 0.0.1',
    }
    const encoded = Bencode.encode(payload)
    this.peer.sendExtendedMessage(EXT_HANDSHAKE_ID, encoded)
  }

  private handleExtendedHandshake(payload: Uint8Array) {
    try {
      const dict = Bencode.decode(payload)
      if (dict && dict.m && dict.m['ut_pex']) {
        this._pexId = dict.m['ut_pex']
      }
    } catch (_err) {
      // Ignore invalid extended handshake
    }
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
