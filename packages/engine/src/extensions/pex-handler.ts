import { PeerConnection } from '../core/peer-connection'
import { Bencode } from '../utils/bencode'

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
      if (dict.added) {
        this.parsePeers(dict.added)
      }
      if (dict.added6) {
        this.parsePeers(dict.added6)
      }
      // We could also handle 'dropped'
    } catch (_err) {
      // Ignore invalid PEX messages
    }
  }

  private parsePeers(data: Uint8Array) {
    // Parse compact peers
    for (let i = 0; i < data.length; i += 6) {
      if (i + 6 > data.length) break
      const ip = `${data[i]}.${data[i + 1]}.${data[i + 2]}.${data[i + 3]}`
      const port = (data[i + 4] << 8) | data[i + 5]
      // Emit peer found event?
      // PexHandler needs to notify Torrent or PeerManager
      // For now, let's emit on PeerConnection or use a callback
      // But PeerConnection is for ONE peer.
      // We need to bubble this up.
      // Maybe PexHandler should be an EventEmitter or PeerConnection should emit 'pex_peer'.

      // Let's emit 'pex_peer' on PeerConnection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(this.peer as any).emit('pex_peer', { ip, port })
    }
  }
}
