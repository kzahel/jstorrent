jstorrent.protocol = {
    protocolName: 'BitTorrent protocol',
    reportedClientName: 'JSTorrent ' + chrome.runtime.getManifest().version, // update with version
    handshakeClientName: 'JS',
    pieceSize: 16384,
    chunkSize: 16384,
    socketReadBufferMax: 4096, // doesn't really belong in this file, but whatever
//    socketReadBufferMax: 32, // doesn't really belong in this file, but whatever
    socketWriteBufferMax: 4096, // doesn't really belong in this file, but whatever
    maxPacketSize: 32768,
    handshakeLength: 68,
    handshakeFlags: [0,0,0,0,0,
                     0x10, // have to set this bit, or we wont get ut_metadata
                     0,
                     1 // DHT
                    ],
    extensionMessages: { ut_metadata: 2,
                         ut_pex: 3},
    extensionMessageHandshakeCode: 0,
    infodictExtensionMessages: ['REQUEST','DATA','REJECT'],
    infodictExtensionMessageNames: {}, // populated just below
    infodictExtensionMessageCodes: {}, // populated just below
    extensionMessageCodes: {}, // populated just below
    messages: [
        'CHOKE',
        'UNCHOKE',
        'INTERESTED',
        'NOT_INTERESTED',
        'HAVE',
        'BITFIELD',
        'REQUEST',
        'PIECE',
        'CANCEL',
        'PORT',
        'WANT_METAINFO',
        'METAINFO',
        'SUSPECT_PIECE',
        'SUGGEST_PIECE',
        'HAVE_ALL',
        'HAVE_NONE',
        'REJECT_REQUEST',
        'ALLOWED_FAST',
        'HOLE_PUNCH',
        '-',
        'UTORRENT_MSG'
    ],
    messageNames: {}, // populated just below
    messageCodes: {} // populated just below
}
for (var i=0; i<jstorrent.protocol.infodictExtensionMessages.length; i++) {
    jstorrent.protocol.infodictExtensionMessageCodes[i] = jstorrent.protocol.infodictExtensionMessages[i]
    jstorrent.protocol.infodictExtensionMessageNames[jstorrent.protocol.infodictExtensionMessages[i]] = i
}
for (var i=0; i<jstorrent.protocol.messages.length; i++) {
    jstorrent.protocol.messageCodes[i] = jstorrent.protocol.messages[i]
    jstorrent.protocol.messageNames[jstorrent.protocol.messages[i]] = i
}
for (var key in jstorrent.protocol.extensionMessages) {
    jstorrent.protocol.extensionMessageCodes[jstorrent.protocol.extensionMessages[key]] = key
}
var utf8decoder = new TextDecoder('utf-8')
jstorrent.protocol.tweakPeerClientName = function(s) {

    
    if (false && s.charCodeAt(0) == 194 && s.charCodeAt(1) == 181) {
        return s.slice(1)
    } else {
        try {
            return utf8decoder.decode(stringToUint8ArrayWS(s))
        } catch(e) {
            return s
        }
    }
}
jstorrent.protocol.parseHandshake = function(buf) {
    var toret = {}
    sofar = 0;
    var v = new DataView(buf, 0, 1)
    sofar += 1
    if (v.getUint8(0) == jstorrent.protocol.protocolName.length) {
        if (ui82str( new Uint8Array(buf, 1, jstorrent.protocol.protocolName.length) ) == jstorrent.protocol.protocolName) {

            sofar += jstorrent.protocol.protocolName.length

            toret.reserved = new Uint8Array(buf,sofar,8) // reserved bytes
            sofar += 8
            toret.infohash = new Uint8Array(buf,sofar,20) // infohash
            sofar += 20
            toret.peerid = new Uint8Array(buf,sofar,20) // peer id
            //console.log('parse peerid', ui82str(toret.peerid))

            return toret
        }
    }
}


function test_handshake() {
    var resp = new Uint8Array([19, 66, 105, 116, 84, 111, 114, 114, 101, 110, 116, 32, 112, 114, 111, 116, 111, 99, 111, 108, 0, 0, 0, 0, 0, 16, 0, 5, 185, 30, 192, 102, 102, 143, 44, 232, 17, 19, 73, 174, 134, 204, 129, 148, 28, 228, 140, 105, 45, 85, 84, 51, 51, 48, 48, 45, 185, 115, 26, 147, 25, 81, 77, 51, 69, 214, 85, 90]).buffer
    var parsed = jstorrent.protocol.parseHandshake(resp)
    console.assert(parsed.peerid && parsed.infohash)
}

jstorrent.protocol.parseBitfield = function(bitfield, numTorrentPieces) {
    var arr = []
    var bit
    for (var i=0; i<bitfield.length; i++) {
        for (var j=0; j<8; j++) {
            bit = Math.pow(2,7-j) & bitfield[i]
            arr.push(bit ? 1 : 0)
            if (arr.length == numTorrentPieces) {
                break
            }
        }
    }
    return arr
}

function test_parseBitfield() {
    var bf = []
    for (var i=0; i<70; i++) {
        bf.push(255)
    }
    //bf[60]=254
    //bf[30]=64
    var bitfield = new Uint8Array(bf)
    var arr = jstorrent.protocol.parseBitfield(bitfield)
    // console.assert something...

}


if (jstorrent.options.run_unit_tests) {
    test_handshake()
    test_parseBitfield()
}
