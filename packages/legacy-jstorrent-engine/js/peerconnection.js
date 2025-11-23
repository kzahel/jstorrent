var peerSockMap = {}

function onTCPReceive(info) {
    var sockId = info.socketId
    if (peerSockMap[sockId]) {
        peerSockMap[sockId].onReadTCP(info)
    } else if (window.WSC && WSC.peerSockMap[sockId]) {
    } else {
        console.clog(L.PEER, 'tcp.onReceive untracked socket',info,info.data.byteLength)
    }
}
function onTCPReceiveError(info) {
    var sockId = info.socketId
    if (peerSockMap[sockId]) {
        peerSockMap[sockId].onReadTCPError(info)
    } else if (window.WSC && WSC.peerSockMap[sockId]) {
    } else {
        // might be from WSC... need to clean that up
        console.clog(L.PEER, 'tcp.onReceiveError untracked socket',info, NET_ERRORS_D[info.resultCode])
    }
}

chrome.sockets.tcp.onReceive.addListener( onTCPReceive )
chrome.sockets.tcp.onReceiveError.addListener( onTCPReceiveError )


function PeerConnection(opts) {
    jstorrent.Item.apply(this, arguments)
    this.__name__ = arguments.callee.name // cant trust itemClass (initializing jstorrent.Peer randomly without it)

    this.peer = opts.peer
    this.torrent = opts.peer.torrent
    this.client = opts.client || opts.peer.torrent.client
    this.amInterested = false
    this.amChoked = true
    this.readThrottled = false
    this._cancel_connect = false
    this.peerInterested = false
    this.peerChoked = true
    this.set('peerChoked',true)
    this.set('amChoked',true)

    this.sentHandshake = false
    this.sentExtensionHandshake = false
    this.sentBitfield = false

    this.connectedWhen = null

    this.peerHandshake = null
    this.peerExtensionHandshake = null
    this.peerExtensionHandshakeCodes = {}
    this.peerPort = null
    this.peerBitfield = null

    this.lastReadTime = null
    this.lastWriteTime = null

	this.pieceRequestQueue = []

    this.set('address', this.peer.get_key())
    this.set('bytes_sent', 0)
    this.set('bytes_received', 0)
    this.set('upspeed', 0)
    this.set('downspeed', 0)
    this.rings = { sent: new jstorrent.RingBuffer(8),
                   received: new jstorrent.RingBuffer(8) }
    this.set('requests',0)
    this.set('responses',0)
    this.set('timeouts',0)
    this.set('outstanding',0)
    this.set('limit',2)
    this.set('complete',0)
    this.set('incoming',false)

    // TODO -- if we have a peer that we keep sending "HAVE" messages
    // to and even those tiny messages don't get flushed out of the
    // buffer, then that peer SUCKS and we should disconnect (if there
    // are potentially healthier peers in the swarm.

    // this may also be the cause of the dreaded 99.9%, we have a peer that we sent chunk requests to, and for some reason we haven't timed them out correctly... ?

    // piece/chunk requests
    this.pieceChunkRequests = {} // XXX not being stored here? wtf. we need that data!!!

    this.outstandingPieceChunkRequestCount = 0// "outstanding"

    // inefficient that we create this for everybody in the
    // swarm... (not actual peer objects) but whatever, good enough
    // for now
    this.registeredRequests = {}
    this.infodictResponses = []
    this.handleAfterInfodict = []

    // connect state
    if (jstorrent.device.platform == 'Android') {
        this.connect_timeout_delay = 1000 // BUG THIS BLOCKS MAIN THREAD
    } else {
        //this.connect_timeout_delay = 10000
        //this.connect_timeout_delay = 3000 // maybe too short
        this.connect_timeout_delay = 6000
    }
    this.connect_timeout_callback = null
    this.connecting = false
    this.closing = false
    this.connected = false
    this.connect_timeouts = 0

    // read/write buffer stuff
    this.writing = false
    this.writing_length = 0
    if (opts.stream) {
        this.readBuffer = opts.stream.readBuffer // adopt from existing stream
    } else {
        this.readBuffer = new jstorrent.Buffer
    }
    this.writeBuffer = new jstorrent.Buffer

    if (opts.sockInfo) {
        this.sockInfo = {socketId: opts.sockInfo.clientSocketId}
        if (opts.paused === undefined || opts.paused) {
            chrome.sockets.tcp.setPaused(this.sockInfo.socketId, false, function(){})
        }
        peerSockMap[this.sockInfo.socketId] = this
        this.set('socketId',this.sockInfo.socketId)
        this.set('incoming',true)
        this.state = 'incoming'
        this.connected = true
    } else {
        this.state = 'outgoing'
    }
    if (opts.stream) {
        this.checkBuffer()
    }
}

jstorrent.PeerConnection = PeerConnection;

PeerConnection.prototype = {
    debugInfo: function() {
        chrome.sockets.tcp.getInfo(this.sockInfo.socketId, function(res) {
            console.log(this.sockInfo.socketId, 'peer connection debug socket info',res)
        }.bind(this))
        window.debugSocket = this
    },
    registerPieceChunkRequest: function(pieceNum, chunkNum) {
        this.pieceChunkRequests[pieceNum + '/' + chunkNum] = true
    },
    requestedPieceChunk: function(pieceNum, chunkNum) {
        return this.pieceChunkRequests[pieceNum + '/' + chunkNum]
    },
    registerPieceChunkTimeout: function(pieceNum, chunkNum) {
        if (! this.torrent.isComplete()) { return } // todo properly cleanup when torrent stops
        this.outstandingPieceChunkRequestCount--
        this.set('outstanding',this.get('outstanding')-1)
        var hadRequest = this.pieceChunkRequests[pieceNum + '/' + chunkNum]
        delete this.pieceChunkRequests[pieceNum + '/' + chunkNum]
        this.set('timeouts', this.get('timeouts')+1)
        this.newStateThink() // make sure to do this! or we get stuck doin nothin'
    },
    cleanup: function() {
        this.readBuffer.clear()
        this.writeBuffer.clear()
    },
    cleanupRequests: function() {
        // when does this get called?
        if (! this.torrent) { return }
        var idx = this.torrent.connectionsServingInfodict.indexOf(this)
        if (idx != -1) {
            console.log('removing self from connections serving infodicts')
            this.torrent.connectionsServingInfodict.splice(idx, 1)
        }

        var parts, pieceNum, chunkNum, piece, chunkRequests, chunkRequest
        for (var key in this.pieceChunkRequests) {
            parts = key.split('/')
            pieceNum = parts[0]
            chunkNum = parts[1]
            if (this.torrent.pieces.containsKey(pieceNum)) {
                piece = this.torrent.pieces.get(pieceNum)
                chunkRequests = piece.chunkRequests[chunkNum]
                if (chunkRequests && chunkRequests.length > 0) {

                    for (var i=0; i<chunkRequests.length; i++) {
                        chunkRequest = chunkRequests[i]
                        if (chunkRequest.peerconn == this) {
                            // DELETE this fucker!
                            //console.log('peer disconnected that had outstanding chunk request and we deleted it. yay')
                            // delete chunkRequests[i] // delete dont work cuz .length still set, gotta do splice
                            chunkRequests.splice(i,1) // XXX - it removes the entry, but requests still not being made!
                            break
                        }
                    }

                }
            }
        }
    },
    updatePercentComplete: function() {
        var count = 0
        for (var i=0; i<this.torrent.numPieces; i++) {
            count += this.peerBitfield[i]
        }
        var val = count / this.torrent.numPieces
        this.set('complete',val)
    },
    get_key: function() {
        return this.peer.host + ':' + this.peer.port
    },
    on_connect_timeout: function() {
        this.connecting = false;
        this.connect_timeouts++;
        this.peer.set('connectionResult', 'timeout')
        this.peer.set('timeouts',this.peer.get('timeouts')+1)
        if (! peerSockMap[this.sockInfo.socketId]) { debugger }
        this.close('connect_timeout')
    },
    drop: function(reason) {
        // called by torrent.maybeDropShittyConnection
        // console.clog(L.DEV, 'dropping',reason,'received:',byteUnits(this._attributes.bytes_received), this._attributes)
        this.close(reason)
    },
    close: function(reason, forcelog) {
        // update peer (swarm) object with our stats ?
        this.peer.updateAttributes(this._attributes)

        if (forcelog === undefined) { forcelog = DEVMODE }
        if (this.closing) { return }
        this.closing = true
        if (forcelog) {
            //console.trace()
            if (this._attributes.incoming) {
                console.clog(L.SEED, 'disconnect',reason,this._attributes)
            }
        }
        if (this.get('downspeed') > 1024 * 50) {
            console.clog(L.DEV, 'a good connection is closing',byteUnits(this._attributes.bytes_received), reason)
        }
        this.set('state','closing')
        this.connected = false
        this.maybeClearConnectTimeout()
        if (! this.sockInfo) {
            // connection was closed while we were creating the socket
            this._cancel_connect = true
        } else {
            chrome.sockets.tcp.close(this.sockInfo.socketId, this.onClose.bind(this,reason))
        }
    },
    maybeClearConnectTimeout: function() {
        if (this.connect_timeout_callback) {
            clearTimeout( this.connect_timeout_callback )
            this.connect_timeout_callback = null
            this.connecting = false
        }
    },
    onDisconnect: function(result) {
        var lasterr = chrome.runtime.lastError
        if (lasterr) {
            console.warn('ondisconnect lasterror',lasterr)
        } else {
            console.log('ondisconnect')
        }
    },
    onClose: function(reason, result) {
        this.set('state','closed')
        var sockid = this.sockInfo.socketId
        delete peerSockMap[this.sockInfo.socketId]
        this.trigger('close')
        this.cleanup()
        this.cleanupRequests()
        var lasterr = chrome.runtime.lastError
        if (lasterr) {
            console.clog(L.DEV,'onClose:',(reason.message||reason),'lasterror',lasterr,'result',result) // TODO -- "Socket not found" ?
            // double close, not a big deal. :-\
        } else {
            //console.log('onClose',reason,'result',result,sockid)
        }
    },
    connect: function() {
        console.assert( ! this.connecting )
        this.connecting = true;
        this.set('state','connecting')
        chrome.sockets.tcp.create({}, _.bind(this.oncreate, this))
    },
    oncreate: function(sockInfo) {
        this.sockInfo = sockInfo
        this.set('socketId',sockInfo.socketId)
        peerSockMap[this.sockInfo.socketId] = this
        if (this._cancel_connect) {
            this.close('cancelled connect')
        } else {
            //this.log('peer oncreate')
            this.connect_timeout_callback = setTimeout( _.bind(this.on_connect_timeout, this), this.connect_timeout_delay )
            chrome.sockets.tcp.connect( sockInfo.socketId, this.peer.host, this.peer.port, _.bind(this.onconnect, this) )
        }
    },
    onconnect: function(connectInfo) {
        this.maybeClearConnectTimeout()
        var lasterr = chrome.runtime.lastError
        if (lasterr) {
            this.peer.set('connectionResult', lasterr.message)
            this.close('connect_error'+lasterr.message)
            return
        }
        if (connectInfo < 0) {
            this.peer.set('connectionResult', connectInfo)
            this.close('connect_error'+connectInfo)
            return
        }
        this.connectedWhen = new Date()
        this.connected = true
        this.set('state','connected')
        this.peer.set('connected_ever',true)
        this.torrent.maybePropagatePEX({added: this.peer.serialize()})
        this.sendHandshake()
        this.sendExtensionHandshake()
        this.sendPort()
        if (this.torrent.has_infodict()) {
            this.sendBitfield()
        }
    },
    sendExtensionHandshake: function() {
        this.sentExtensionHandshake = true
        if (this.peerHandshake &&
            (this.peerHandshake.reserved[5] & 0x10) == 0) {
            // will not send extension handshake to people that don't have 0x10 in 6th byte...
            return
        }
        var data = {v: jstorrent.protocol.reportedClientName,
//                    p: 6666, // our listening port
                    m: jstorrent.protocol.extensionMessages}
        if (this.torrent.has_infodict()) {
            data.metadata_size = this.torrent.infodict_buffer.byteLength
        }
        var arr = new Uint8Array(bencode( data )).buffer;
        this.sendMessage('UTORRENT_MSG', [new Uint8Array([0]).buffer, arr])
    },
    sendPort: function() {
        var ext_port = this.client.externalPort()
        var a = new Uint8Array(2)
        var v = new DataView(a.buffer)
        v.setUint16(0, ext_port)
        this.sendMessage("PORT", [a.buffer])
    },
    sendMessage: function(type, payloads) {
        this.set('last_message_sent',type)
        switch (type) {
        case "INTERESTED":
            this.amInterested = true
            break
        case "NOT_INTERESTED":
            this.amInterested = false
            break
        case "CHOKE":
            this.peerChoked = true
            this.set('peerChoked',true)
            break
        case "UNCHOKE":
            this.peerChoked = false
            this.set('peerChoked',false)
            break
        }
        if (! payloads) { payloads = [] }
        console.clog(L.PEER,'Sending Message',type)
        console.assert(jstorrent.protocol.messageNames[type] !== undefined)
        var payloadsz = 0
        for (var i=0; i<payloads.length; i++) {
            console.assert(payloads[i] instanceof ArrayBuffer)
            payloadsz += payloads[i].byteLength
        }
        var b = new Uint8Array(payloadsz + 5)
        var v = new DataView(b.buffer, 0, 5)
        v.setUint32(0, payloadsz + 1) // this plus one is important :-)
        v.setUint8(4, jstorrent.protocol.messageNames[type])
        var idx = 5
        for (var i=0; i<payloads.length; i++) {
            b.set( new Uint8Array(payloads[i]), idx )
            idx += payloads[i].byteLength
        }
        //console.log('sending message', new Uint8Array(b))
        this.write(b.buffer)
    },
    sendHandshake: function() {
        this.sentHandshake = true
        var bytes = []
        bytes.push( jstorrent.protocol.protocolName.length )
        for (var i=0; i<jstorrent.protocol.protocolName.length; i++) {
            bytes.push( jstorrent.protocol.protocolName.charCodeAt(i) )
        }
        bytes = bytes.concat( jstorrent.protocol.handshakeFlags )
        bytes = bytes.concat( this.torrent.hashbytes )
        bytes = bytes.concat( this.torrent.client.peeridbytes )
        console.assert( bytes.length == jstorrent.protocol.handshakeLength )
        var payload = new Uint8Array( bytes ).buffer
        //console.log('Sending Handshake',['HANDSHAKE',payload])
        this.write( payload )
    },
    write: function(data) {
        console.assert( this.connected )
        console.assert(data.byteLength > 0)
        console.assert(data instanceof ArrayBuffer)
        this.writeBuffer.add(data)
        if (! this.writing) {
            this.writeFromBuffer()
        }
    },
    writeFromBuffer: function() {
        console.assert(! this.writing)
        var data = this.writeBuffer.consume_any_max(jstorrent.protocol.socketWriteBufferMax)
        //this.log('write',data.byteLength)
        this.writing = true
        this.writing_length = data.byteLength
        this.lastWriteTime = this.torrent.tickTime
        chrome.sockets.tcp.send( this.sockInfo.socketId, data, _.bind(this.onWrite,this) )
    },
    onWrite: function(writeResult) {
        var lastError = chrome.runtime.lastError
        if (lastError) {
            //console.warn('lasterror on tcp.send',this,chrome.runtime.lastError,writeResult)
            this.close('writeerr'+(lastError.message||lastError) )
            return
        }

        //this.log('onWrite', writeResult)
        // probably only need to worry about partial writes with really large buffers
        if (writeResult.resultCode < 0) {
            //console.warn('sock onwrite resultcode',writeResult.resultCode)
            this.close('negative onwrite')
        } else if (writeResult.bytesSent != this.writing_length) {
            if (writeResult.bytesSent == 0) {
                this.close('bytesSent==0, closed connection')
            } else if (writeResult.bytesSent < 0) {
                this.close('negative bytesSent',writeResult.bytesSent)
            } else {
                debugger
                console.error('bytes written does not match!, was',writeResult.bytesSent,'should be',this.writing_length)
/*
                chrome.socket.getInfo( this.sockInfo.socketId, function(socketStatus) {
                    console.log('socket info -',socketStatus)
                })
*/
                this.close('did not write everything')
            }

        } else {
            //this.set('bytes_sent', this.get('bytes_sent') + this.writing_length)
            this.countBytes('sent', this.writing_length)
            //this.torrent.set('uploaded', this.torrent.get('uploaded') + this.writing_length) // cheating? what is "uploaded" supposed to be, anyway
            this.writing = false
            this.writing_length = 0
            // continue writing out write buffer
            if (this.writeBuffer.size() > 0) {
                this.writeFromBuffer()
            } else {
                this.newStateThink()
            }
        }
    },
    couldRequestPieces: function() {
        // XXX -- in endgame mode, make sure all the fastest effective players get everything
        //if (app.options.get('debug_dht')) { return }

        if (this.outstandingPieceChunkRequestCount > this._attributes.limit) {
            return
        }

        var dl_limit = this.client.app.options.get('download_rate_limit')
        if (dl_limit && this.torrent.get('downspeed') > (dl_limit * 1024)) {
            //console.clog(L.DEV,'not requesting pieces, dl limit reached')
            return
        }

        if (this.torrent.unflushedPieceDataSize > this.torrent.unflushedPieceDataSizeLimit) {
            console.clog(L.DEV,'not requesting more pieces -- need disk io to write out more first')
            return
        }

        var curPiece, payloads
        var allPayloads = []

        var bridgekeys = _.keys(this.torrent.bridges)
        if (bridgekeys.length > 0) {
            var bridgeidx = Math.floor(Math.random() * bridgekeys.length) 
            var curbridge = this.torrent.bridges[ bridgekeys[bridgeidx] ]
            var startAtPiece = curbridge.startPiece // TODO -- update startpiece as we go along

            // TODO -- we can make an educated guess that the bridge
            // is at the end of the file (say in the last 2%, which
            // means that it is to complete the metadata, and so
            // temporarily turn on endgame for these bridge pieces...
        } else {
            var startAtPiece = this.torrent.bitfieldFirstMissing
        }


        for (var pieceNum=startAtPiece; pieceNum<this.torrent.numPieces; pieceNum++) {
            if (this.peerBitfield[pieceNum] && ! this.torrent.havePieceData(pieceNum)) {
                if (this.torrent.pieceBlacklist[pieceNum]) { continue }
                curPiece = this.torrent.getPiece(pieceNum)
                if (curPiece.haveData) { continue } // we have the data for this piece, we just havent hashed and persisted it yet

                while (this.outstandingPieceChunkRequestCount < this._attributes.limit) {
                    //console.log('getting chunk requests for peer')

                    // what's ideal batch number?
                    payloads = curPiece.getChunkRequestsForPeer(2, this)
                    if (payloads.length == 0) {
                        break
                    } else {
                        this.outstandingPieceChunkRequestCount += payloads.length
                        this.set('outstanding',this.get('outstanding')+payloads.length)
                        allPayloads = allPayloads.concat(payloads)
                    }
                }
            }

            if (this.outstandingPieceChunkRequestCount >= this._attributes.limit) {
                break
            }
        }

        if (allPayloads.length > 0) {
            for (var i=0; i<allPayloads.length; i++) {
                this.set('requests',this.get('requests')+1)
                this.sendMessage("REQUEST", [allPayloads[i]])
            }
        } else {
            // nothing to do now, but maybe in a second we will have something to do... (bridge race condition)
            setTimeout( function() {
                this.newStateThink()
            }.bind(this), 1000 )
        }
    },
    registerExpectResponse: function(type, key, info) {
        // used for non-PIECE type messages
        if (! this.registeredRequests[type]) {
            this.registeredRequests[type] = {}
        }
        this.registeredRequests[type][key] = info
    },
    cancelAnyRequestsForPiece: function(piece) {
        
    },
    newStateThink: function() {
        if (! this.connected || this.closing) {
            return
        }
        if (! this.readThrottled) {
            while (this.checkBuffer()) {}
        }

        if (this.torrent.isComplete()) { 

            if (this.get('complete') == 1) {
                if (! this.peerInterested) {
                    if (this.torrent.canSeed()) {
                        // dont close connection
                    } else {
                        this.close('both complete and peer not interested',true)
                    }
                }
            }

            return 
        }
        // thintk about the next thing we might want to write to the socket :-)
        if (this.torrent.has_infodict()) {

            // we have valid infodict
            if (this.handleAfterInfodict.length > 0) {
                //console.log('processing afterinfodict:',this.handleAfterInfodict)
                var msg = this.handleAfterInfodict.shift()
                //setTimeout( _.bind(function(){this.handleMessage(msg)},this), 1 )
                this.handleMessage(msg)
            } else {
                if (this.torrent.started) {
                    if (! this.amInterested) {
                        this.sendMessage("INTERESTED")
                    } else {
                        if (! this.amChoked) {
                            if (this.peerBitfield) {
                                this.couldRequestPieces()
                            }
                        }
                    }
                }
            }
        } else {
            if (this.peerExtensionHandshake && 
                this.peerExtensionHandshake.m && 
                this.peerExtensionHandshake.m.ut_metadata &&
                this.peerExtensionHandshake.metadata_size &&
                this.torrent.connectionsServingInfodict.length < this.torrent.connectionsServingInfodictLimit)
            {
                // we have no infodict and this peer does!
                if (! this.registeredRequests['infodictRequest']) { // dont do this again lol
                    this.torrent.connectionsServingInfodict.push( this )
                    this.requestInfodict()
                }
            }
        }
    },
    requestInfodict: function() {
        // TODO -- add timeout handling
        var infodictBytes = this.peerExtensionHandshake.metadata_size
        var d
        var numChunks = Math.ceil( infodictBytes / jstorrent.protocol.pieceSize )
        //console.log('requestinfodict determines # chunks',numChunks)

        this.infodictResponses = []
        for (var i=0; i<numChunks; i++) {
            this.infodictResponses.push(null)
        }

        for (var i=0; i<numChunks; i++) {
            d = {
                piece: i,
                msg_type: jstorrent.protocol.infodictExtensionMessageNames.REQUEST,
                total_size: infodictBytes // do we need to send this?
            }
            var code = this.peerExtensionHandshake.m.ut_metadata
            var info = {}
            this.registerExpectResponse('infodictRequest', i, info)
            //console.log(this.get('address'),'requested infodict',d)
            this.sendMessage('UTORRENT_MSG', [new Uint8Array([code]).buffer, new Uint8Array(bencode(d)).buffer])
        }
    },
    log: function() {
        var args = [this.sockInfo.socketId, this.peer.get_key()]
        for (var i=0; i<arguments.length; i++) {
            args.push(arguments[i])
        }
        console.log.apply(console, args)
    },
    shouldThrottleRead: function() {
        // TODO need to use sockets.tcp.setPaused
        return false
        // if byte upload rate too high?
        if (this.peer.host == '127.0.0.1') { return true }
    },
    checkShouldUnthrottleRead: function() {
        if (true) { // throttling just means a delay for now
            if (this.connected) {
                this.readThrottled = false
                this.checkBuffer()
            }
        }
    },
    onReadTCP: function(readResult) {
        if (this.torrent) {
            this.lastReadTime = this.torrent.tickTime
        }
        this.onRead(readResult)
    },
    onReadTCPError: function(readResult) {
        this.onReadError(readResult)
    },
    onReadError: function(info) {
        if (info.resultCode == -100 || info.resultCode == -101) {
            // conn closed or reset
        } else {
            console.clog(L.SEED, 'onReceiveError',info, NET_ERRORS_D[info.resultCode])
        }
        this.close('readerr'+info.resultCode)
    },
    calculate_speeds: function() {
        var sent = this.get('bytes_sent')
        var received = this.get('bytes_received')

        this.rings.sent.add( sent )
        this.rings.received.add( received )

        // calculate rate based on last 4 seconds
        var prev = this.rings.sent.get(-4)
        if (prev !== null) {
            this.set('upspeed', (sent - prev) / 4)
        }
        var prev = this.rings.received.get(-4)
        if (prev !== null) {
            var downSpeed = (received - prev)/4
            this.set('downspeed', downSpeed)
        }
    },
    countBytes: function(type, val) {
        // bubble up to client
        if (this.torrent) {
            this.torrent.countBytes(type, val)
        }
        if (type == 'received') {
            this.set('bytes_received', this.get('bytes_received') + val)
        } else {
            this.set('bytes_sent', this.get('bytes_sent') + val)
        }
    },
    onRead: function(readResult) {
        if (this._attributes.incoming && ! this.peerHandshake) {
            //console.log('read with incoming peer connection')
            // parse infohash, bittorrent protocol, etc
            this.countBytes('received', readResult.data.byteLength)
            this.readBuffer.add(readResult.data)
            this.checkBuffer()
            return
        }
        //console.log('onread',readResult,readResult.data.byteLength, [ui82str(new Uint8Array(readResult.data))])
        if (this.torrent && ! (this.torrent.started || this.torrent.canSeed())) {
            this.close('torrent stopped')
            return
        }

        if (readResult.data.byteLength == 0) {
            this.close('peer closed socket (read 0 bytes)')
            return
        } else {
            //this.set('bytes_received', this.get('bytes_received') + readResult.data.byteLength)
            this.countBytes('received', readResult.data.byteLength)
            //this.log('onRead',readResult.data.byteLength)
            this.readBuffer.add( readResult.data )

            if (this.shouldThrottleRead()) {
                this.readThrottled = true
                setTimeout( _.bind(this.checkShouldUnthrottleRead,this), 10000 )
            } else {
                this.checkBuffer()
            }
        }
        //this.close('no real reason')
    },
    checkBuffer: function() {
        if (! this.connected || this.closing) {
            return
        }
        //console.log('checkBuffer, len', this.readBuffer.deque.length, 'sz', this.readBuffer._size)
        // checks if there are messages
        if (! this.peerHandshake) {
            if (this.readBuffer.size() >= jstorrent.protocol.handshakeLength) {
                var buf = this.readBuffer.consume(jstorrent.protocol.handshakeLength)
                this.handleMessage({type:'HANDSHAKE',payloadSize: buf.byteLength, payload:buf})
                //this.peerHandshake = 
                //if (! this.peerHandshake) {
                //    this.close('invalid handshake')
                //}
                //this.checkBuffer()
            }
        } else {
            // have peer handshake!
            var curbufsz = this.readBuffer.size()
            if (curbufsz >= 4) {
                var msgsize = new DataView(this.readBuffer.consume(4,true)).getUint32(0)
                if (msgsize > jstorrent.protocol.maxPacketSize) {
                    console.error('protocol message too large',msgsize)
                    this.close('message too large')
                } else {
                    if (curbufsz >= msgsize + 4) {
                        var msgbuf = this.readBuffer.consume(msgsize + 4)
                        this.parseMessage(msgbuf)
                        return true
                    }
                }
            }
        }
    },
    parseMessage: function(buf) {
        var data = {}
        //console.clog(L.PEER,'handling bittorrent message', new Uint8Array(buf))
        var msgsz = new DataView(buf, 0, 4).getUint32(0)
        if (msgsz == 0) {
            data.type = 'KEEPALIVE'
            // keepalive message
        } else {
            data.code = new Uint8Array(buf, 4, 1)[0]
            var messageString = jstorrent.protocol.messageCodes[data.code]
            data.type = messageString
            data.payload = buf
            data.payloadLength = buf.byteLength
        }

        //console.log('Received message',data.type)

        this.handleMessage(data)
    },
    handleMessage: function(msgData) {
        //console.clog(L.SEED, 'handling message',msgData)
        var method = this['handle_' + msgData.type]
        if (msgData.type != "KEEPALIVE") {
            this.set('last_message_received',msgData.type) // TODO - get a more specific message for piece number
        }
        if (! method) {
            this.unhandledMessage(msgData)
        } else {
            method.apply(this,[msgData])
        }
        // once a message is handled, there is new state, so check if
        // we want to write something
        this.newStateThink()
    },
    handle_REQUEST: function(msg) {
        if (this.peerChoked) { 
            console.clog(L.PEER,'wont handle request, peer is choked')
            // silently dont handle PIECE requests from choked peers.
            return 
        }
        var ul_limit = this.client.app.options.get('upload_rate_limit')
		
        // TODO -- if write buffer is pretty full, don't create diskio
        //job yet, since we want to do it more lazily, not too
        //eagerly.  :-) todo -- make this work better haha

        // parse message
        var header = new DataView(msg.payload, 5, 12)
        var pieceNum = header.getUint32(0)
        var offset = header.getUint32(4)
        var size = header.getUint32(8)
        if (this.torrent.has_infodict() && this.torrent.havePieceData(pieceNum)) {
			if (ul_limit && this.torrent.get('upspeed') > (ul_limit * 1024)) {
				// put this in a queue
				this.pieceRequestQueue.push(msg)
			} else {
				this.torrent.registerPieceRequested(this, pieceNum, offset, size)
			}
        } else {
            // my bitfield may be one off...
            this.sendMessage("REJECT_REQUEST", msg.payload) 
        }

    },
    handle_SUGGEST_PIECE: function(msg) {
        var pieceNum = new DataView(msg.payload, 5, 4).getUint32(0)
        var bit = this.torrent.havePieceData(pieceNum)
        console.log('why are they suggesting piece?',pieceNum,'our bitmask says', bit)
        if (bit == 1) {
            var payload = new Uint8Array(4)
            var v = new DataView(payload.buffer)
            v.setUint32(0,pieceNum)
            this.sendMessage("HAVE", [payload.buffer])
        }
    },
    handle_PIECE: function(msg) {
        this.set('responses',this.get('responses')+1)
        var v = new DataView(msg.payload, 5, 12) // TODO catch error with erroneous size payload (out of bounds)
        var pieceNum = v.getUint32(0)
        var chunkOffset = v.getUint32(4)
        // does not send size, inherent in message. could be smaller than chunk size though!
        var data = new Uint8Array(msg.payload, 5+8)
        console.assert(data.length <= jstorrent.protocol.chunkSize)
        if (! this.torrent.pieces.containsKey(pieceNum)) {
            // we didn't ask for this piece
            //console.log('handle piece, but piece not extant') // happens after a timeout and the piece finishes from another peer
        } else {
            this.torrent.getPiece(pieceNum).registerChunkResponseFromPeer(this, chunkOffset, data)
        }
    },
    handle_UNCHOKE: function() {
        this.set('amChoked',false)
        this.amChoked = false
    },
    handle_ALLOWED_FAST: function(msg) {
        // http://www.bittorrent.org/beps/bep_0006.html
        // Allowed Fast: <len=0x0005><op=0x11><index>* (can download even when choked)
        // ?
    },
    handle_CANCEL: function() {
        // ignore this message
    },
    handle_CHOKE: function() {
        this.set('amChoked',true)
        this.amChoked = true
    },
    handle_INTERESTED: function() {
        this.peerInterested = true
        if (this.torrent.isPrivate()) {
            this.sendMessage('UNCHOKE')
        } else if (app.options.get('seed_public') || this.peer.host == '127.0.0.1') {
            if (this.torrent.isComplete()) { // disk io queue getting full with piece requests
                this.sendMessage('UNCHOKE')
            }
        }
    },
    handle_NOT_INTERESTED: function() {
        this.peerInterested = false
    },
    handle_PORT: function(msg) {
        // peer's listening port (DHT)?
        this.peerPort = new DataView(msg.payload, 5, 2).getUint16(0)
        //console.log('got port msg',this.peerPort)
        if (this.client.app.options.get('enable_dht')) {
            this.client.dht.ping(this.peer.host, this.peerPort)
        }
    },
    handle_HANDSHAKE: function(msg) {
        var buf = msg.payload
        this.peerHandshake = jstorrent.protocol.parseHandshake(buf)
        if (! this.peerHandshake) {
            //console.clog(L.SEED,'invalid handshake (probably RC4 encrypted')
            // see http://wiki.vuze.com/w/Message_Stream_Encryption
            this.close('invalid handshake')
        } else if (this._attributes.incoming) {
            if (ui82str(this.client.peeridbytes) == ui82str(this.peerHandshake.peerid)) {
                this.close('connected to self')
                return
            }
            //console.log('incoming connection peer handshake',this.peerHandshake)
            var hashhexlower = bytesToHashhex(this.peerHandshake.infohash).toLowerCase()
            if (this.client.torrents.containsKey(hashhexlower)) {
                // have this torrent! yay!
                var torrent = this.client.torrents.get(hashhexlower)
                //console.log('incoming connection: '+torrent._attributes.name)
                if (torrent.isPrivate()) {
                    // always allow private incoming connections, no limit :-)
                } else {
                    if (! (torrent.started)) {
                        this.close('torrent not active: '+torrent._attributes.name)
                        return
                    }
                    if (torrent.canSeed() && torrent.peers.items.length >= this.client.app.options.get('torrent_upload_slots')) {
                        this.close('too many uploads already')
                        return
                    }
                    if (torrent.peers.items.length >= this.client.app.options.get('maxconns')*2) { // allow some extra incoming peers
                        this.close('too many peers already')
                        return
                    }
                    if (torrent.isComplete() && ! torrent.canSeed()) {
                        this.close('not seeding')
                        return
                    }
                }
                this.torrent = torrent
                this.peer.torrent = torrent
                this.torrent.peers.add(this)
                if (! this.torrent.swarm.contains(this.peer)) {
                    this.torrent.swarm.add(this.peer)
                } else {
                    this.peer = this.torrent.swarm.get(this.peer.get_key())
                }
                console.clog(L.SEED, "established new incoming connection",this)
                this.sendHandshake()
                this.sendExtensionHandshake()
                this.sendPort()
                this.torrent.ensureLoaded( function() {
                    this.sendBitfield()
                }.bind(this))
            } else {
                this.close('dont have this torrent: ' + hashhexlower)
            }
        }
    },
    handle_KEEPALIVE: function() {
        // do nothin... 
    },
    handle_UTORRENT_MSG: function(msg) {
        // extension message!
        var extType = new DataView(msg.payload, 5, 1).getUint8(0)

        if (extType == jstorrent.protocol.extensionMessageHandshakeCode) {
            // bencoded extension message handshake follows
            this.peerExtensionHandshake = bdecode(ui82str(new Uint8Array(msg.payload, 6)))
            if (this.peerExtensionHandshake.v) {
                this.set('peerClientName',jstorrent.protocol.tweakPeerClientName(this.peerExtensionHandshake.v))
            }
            if (this.peerExtensionHandshake.m) {
                for (var key in this.peerExtensionHandshake.m) {
                    this.peerExtensionHandshakeCodes[this.peerExtensionHandshake.m[key]] = key
                }
            }
        } else if (jstorrent.protocol.extensionMessageCodes[extType]) {
            var extMsgType = jstorrent.protocol.extensionMessageCodes[extType]

            if (extMsgType == 'ut_metadata') {
                this.handle_UTORRENT_MSG_ut_metadata(msg)
            } else if (extMsgType == 'ut_pex') {
                this.handle_UTORRENT_MSG_ut_pex(msg)
            } else {
                //debugger
            }
        } else {
            //debugger
        }        
    },
    handle_UTORRENT_MSG_ut_pex: function(msg) {
        var data = bdecode(ui82str(new Uint8Array(msg.payload, 6)))
        //console.log('ut_pex data', data)
        var idx, host, port, peer
        if (data.added) {
            this.torrent.addCompactPeerBuffer(data.added,'pex')
        }
        if (data.added6) {
            this.torrent.addCompactPeerBuffer(data.added6,'pex',{ipv6:true})
        }
        // handle dropped/dropped6
        // added.f added6.f always seem to be empty
        this.torrent.maybePropagatePEX(data)
    },
    handle_UTORRENT_MSG_ut_metadata: function(msg) {
        var extMessageBencodedData = bdecode(ui82str(new Uint8Array(msg.payload),6))
        //console.log(this.get('address'),'ut_metadata',extMessageBencodedData)
        var infodictCode = extMessageBencodedData.msg_type
        var infodictMsgType = jstorrent.protocol.infodictExtensionMessageCodes[infodictCode]

        if (infodictMsgType == 'DATA') {
            if (this.torrent.infodict_buffer) {
                //console.log('ignoring it, we already received one.')
                return
            }

            // looks like response to metadata request! yay

            var dataStartIdx = bencode(extMessageBencodedData).length;
            var infodictDataChunk = new Uint8Array(msg.payload, 6 + dataStartIdx)
            var infodictChunkNum = extMessageBencodedData.piece

            this.set('last_message_received', 'UT_METADATA '+infodictChunkNum)

            if (this.registeredRequests['infodictRequest'][infodictChunkNum]) {

                this.registeredRequests['infodictRequest'][infodictChunkNum].received = true
                this.infodictResponses[infodictChunkNum] = infodictDataChunk

                var ismissing = false // check if we received everything
                for (var i=0; i<this.infodictResponses.length; i++) {
                    if (this.infodictResponses[i] === null) {
                        //console.log(this.get('address'),'infodict responses was missing chunk',i,'total',this.infodictResponses.length)
                        ismissing = true
                        break
                    }
                }
                if (! ismissing) {
                    // we have everything now! make sure it matches torrent hash
                    this.processCompleteInfodictResponses()
                }
            } else {
                console.error("was not expecting this torrent metadata piece")
            }
        } else if (infodictMsgType == 'REQUEST') {
            if (! this.torrent.infodict_buffer) {
                //console.warn('dont have infodict buffer!')
                return
            } // cant handle this!

            var code = this.peerExtensionHandshake.m.ut_metadata

            var pieceRequested = extMessageBencodedData.piece

            var d = { msg_type: jstorrent.protocol.infodictExtensionMessageNames.DATA,
                      total_size: this.torrent.infodict_buffer.byteLength, // do we need to send this?
                      piece: pieceRequested }

            var slicea = jstorrent.protocol.chunkSize * pieceRequested
            var slicelen = Math.min( d.total_size - slicea,
                                     jstorrent.protocol.chunkSize )
            // TODO -- assert pieceRequested/slicea in bounds
            if (slicea => 0 && slicea < this.torrent.infodict_buffer.byteLength) {
                if (slicelen < 0) {
                    return // weird, some peers sending bad infodict message requests
                }
                var slicebuf = new Uint8Array(this.torrent.infodict_buffer, slicea, slicelen)
                var newbuf = new Uint8Array(slicelen)
                newbuf.set( slicebuf )
                //console.log('sending metadata payload', code, d)
                this.sendMessage("UTORRENT_MSG",
                                 [new Uint8Array([code]).buffer,
                                  new Uint8Array(bencode(d)).buffer,
                                  newbuf.buffer])
            } else {
                //console.log('problem serving metadata')
            }
        } else {
            //debugger
        }
    },
    maybeSendKeepalive: function() {
        // TODO only if no activity on socket for a long time
        if (this.lastWriteTime && this.lastReadTime) {
            if (this.torrent.tickTime - this.lastWriteTime > 120000 ||
                this.torrent.tickTime - this.lastReadTime > 120000) {
                this.sendKeepalive()
            }
        }
    },
    sendKeepalive: function() {
        this.set('last_message_sent','KEEPALIVE')
        // TODO -- send a keepalive message
        // send empty 4 bytes
        var msg = new Uint8Array(4)
        this.write(msg.buffer)
    },
    sendPEX: function(data) {
        if (this.peerExtensionHandshake) {
            var code = this.peerExtensionHandshake.m.ut_pex
            this.sendMessage("UTORRENT_MSG",
                             [new Uint8Array([code]).buffer,
                              new Uint8Array(bencode(data)).buffer])
            console.log('sent PEX to', this.get('address'))
        }
    },
    processCompleteInfodictResponses: function() {
        var b = new Uint8Array(this.peerExtensionHandshake.metadata_size)
        var idx = 0
        for (var i=0; i<this.infodictResponses.length; i++) {
            b.set( this.infodictResponses[i], idx )
            idx += this.infodictResponses[i].byteLength
        }
        console.assert(idx == this.peerExtensionHandshake.metadata_size)

        // XXX -- not happening in background thread??
        // better to have bdecode that works on arraybuffers?
        var infodict = bdecode(ui82str(b),{utf8:true})
        //var infodict = bdecode(ui82str(b))
        var digest = new Digest.SHA1()
        digest.update(b)
        var receivedInfodictHash = new Uint8Array(digest.finalize())

        if (ui82str(receivedInfodictHash) == ui82str(this.torrent.hashbytes)) {
            console.log("%c Received valid infodict!", 'background:#3f3; color:#fff')
            this.torrent.infodict_buffer = b.buffer
            this.torrent.infodict = infodict
            this.torrent.metadata.info = infodict
            this.torrent.metadataPresentInitialize()
        } else {
            console.error('received metadata does not have correct infohash! bad!')
            this.close('bad_metadata')
        }
    },
    doAfterInfodict: function(msg) {
        //console.warn('Deferring message until have infodict',msg.type)
        this.handleAfterInfodict.push( msg )
    },
    handle_HAVE_NONE: function(msg) {
        // copied from handle_HAVE_ALL
        if (! this.torrent.has_infodict()) {
            this.doAfterInfodict(msg)
        } else {
            if (! this.peerBitfield) {
                var arr = []
                for (var i=0; i<this.torrent.numPieces; i++) {
                    arr.push(0)
                }
                this.peerBitfield = new Uint8Array(arr)
            } else {
                for (var i=0; i<this.torrent.numPieces; i++) {
                    this.peerBitfield[i] = 0
                }
            }
        }
        this.updatePercentComplete()
    },
    handle_REJECT_REQUEST: function(msg) {
        console.clog(L.PEER,'todo: handle reject request')
    },
    handle_HAVE_ALL: function(msg) {
        // TODO if they were interested and unchoked, choke them.
        if (! this.torrent.has_infodict()) {
            this.doAfterInfodict(msg)
        } else {
            //console.log('handling HAVE_ALL')
            if (! this.peerBitfield) {
                var arr = []
                for (var i=0; i<this.torrent.numPieces; i++) {
                    arr.push(1)
                }
                // it would be cool to use an actual bitmask and save
                // some space. but that's silly :-)
                this.peerBitfield = new Uint8Array(arr)
            } else {
                for (var i=0; i<this.torrent.numPieces; i++) { // SHITTY
                    this.peerBitfield[i] = 1
                }
            }
        }
        this.updatePercentComplete()
    },
    sendBitfield: function() {
        // XXX this may have some errors... seems to be off by one?
        this.sentBitfield = true
        var maxi = Math.ceil(this.torrent.numPieces/8)
        var arr = []
        var curByte
        var idx

        for (var i=0; i<maxi; i++) {
            curByte = 0
            idx = 8*i
            for (var j=7; j>=0; j--) {
                if (idx < this.torrent.numPieces) {
                    curByte = (curByte | (this.torrent.havePieceData(idx) << j))
                }
                idx++
            }
            //console.assert(curByte >= 0 && curByte < 256)
            arr.push(curByte)
        }
        this.sendMessage('BITFIELD',[new Uint8Array(arr).buffer])
    },
    handle_BITFIELD: function(msg) {
        if (! this.torrent.has_infodict()) {
            this.doAfterInfodict(msg)
        } else {
            var bitfield = new Uint8Array(msg.payload, 5)
            var arr = jstorrent.protocol.parseBitfield(bitfield, this.torrent.numPieces)
            // it would be cool to use an actual bitmask and save
            // some space. but that's silly :-)
            this.peerBitfield = new Uint8Array(arr)
            //console.log('set peer bitfield', Torrent.attributeSerializers.bitfield.serialize(ui82arr(this.peerBitfield)))
            console.assert(this.peerBitfield.length == this.torrent.numPieces)
        }
        this.updatePercentComplete()
    },
    handle_HAVE: function(msg) {
        if (! this.torrent.has_infodict()) {
            this.doAfterInfodict(msg)
        } else {
            var idx = new DataView(msg.payload,5,4).getUint32(0)
            if (! this.peerBitfield) {
                // not sure why clients would do this...
                this.peerBitfield = new Uint8Array(this.torrent.numPieces)
            }
            this.peerBitfield[idx] = 1
        }
        this.updatePercentComplete()
    },
    unhandledMessage: function(msg) {
        console.error('unhandled message',msg.type)
        //debugger
    }
}

jstorrent.peerSockMap = peerSockMap

for (var method in jstorrent.Item.prototype) {
    jstorrent.PeerConnection.prototype[method] = jstorrent.Item.prototype[method]
}
