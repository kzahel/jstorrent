// XXX/todo this is not closing udp sockets on errors/timeouts etc
(function() {
    function UDPTracker() {
        jstorrent.Tracker.apply(this, arguments)
        this.__name__ = arguments.callee.name

        this.udpSockId = null

        this.connecting = false
        this.retrying = false
        this.nextRetryWhen = null
        this.connect_attempts = 0
        this.connect_attempts_limit = 3
        this.connect_callback = null
        this.connRequest = null
        this.connection = null
        this.connectedWhen = null
        this.connect_timeout = 2000
        this.connect_timeout_id

        this.announce_timeout = 20000
        this.announceRequest = null
        this.announce_callback = null
        this.announce_timeout_id
        this.announcedWhen = null

        this.next_announce_timeout_id = null
    }

    UDPTracker.prototype = {
        onConnectTimeout: function() {
            this.connect_attempts++
            this.retrying = true
            this.set('timeouts',this.get('timeouts')+1)
            this.connect_timeout_id = null
            if (! this.torrent.started) {
                this.updateState('stopped')
            } else if (this.connect_attempts > this.connect_attempts_limit) {
                this.updateState('could not connect')
                this.retrying = false
                this.set('disabled',true)
            } else {
                var step = 5 // 15
                var reconnect_in = this.connect_attempts * step
                this.nextRetryWhen = Date.now() + reconnect_in*1000
                this.updateState('retry in '+Math.floor(reconnect_in))
                this.connect_timeout_id = setTimeout( this.onConnectTimeout.bind(this), reconnect_in*1000 + this.connect_timeout )
                setTimeout( this.sendConnectPayload.bind(this),
                            reconnect_in*1000 )
            }
        },
        handleConnectionResponse: function(conn) {
            var cb = this.connect_callback
            this.connection = conn
            this.connect_callback = null
            this.connecting = false
            this.connect_attempts = 0
            this.connectedWhen = Date.now()
            if (this.connect_timeout_id) {
                clearTimeout(this.connect_timeout_id)
                this.connect_timeout_id = null
            }
            cb(conn)
        },
        handleAnnounceResponse: function(resp) {
            this.set('interval', resp.interval)
            this.set('leechers',resp.leechers)
            this.set('seeders',resp.seeders)
            this.set('lasterror','')
            for (var i=0; i<resp.peerList.length; i++) {
                var p = resp.peerList[i]
                var peer = new jstorrent.Peer({torrent: this.torrent, host:p[0], port:p[1]})
                if (! this.torrent.swarm.contains( peer )) {
                    this.torrent.swarm.add( peer )
                }
            }
            this.torrent.set('numswarm',this.torrent.swarm.items.length)
            this.onAnnounceSuccess()
            setTimeout( this.expireConnection.bind(this), 30 )
        },
        parseAnnounceResponse: function(readResponse) {
            if (readResponse.data.byteLength < 20) {
                return {error:'response too short'}
            }
            var v = new DataView(readResponse.data);
            var resp = v.getUint32(4*0)
            var respTransactionId = v.getUint32(4*1);
            var respInterval = v.getUint32(4*2);
            var leechers = v.getUint32(4*3);
            var seeders = v.getUint32(4*4);

            if( respTransactionId != this.announceRequest.transactionId ) {
                return {error:'bad txid'}
            }

            var countPeers = (readResponse.data.byteLength - 20)/6
            if (Math.floor(countPeers) != countPeers) {
                // maybe another packet is coming?
                return {error:'need another packet?'}
            }
            this.set('received',this.get('received')+countPeers)
            var peerList = []
            for (var i=0; i<countPeers; i++) {
                var ipbytes = [v.getUint8( 20 + (i*6) ),
                               v.getUint8( 20 + (i*6) + 1),
                               v.getUint8( 20 + (i*6) + 2),
                               v.getUint8( 20 + (i*6) + 3)]
                var port = v.getUint16( 20 + (i*6) + 4 )
                var ip = ipbytes.join('.')
                peerList.push( [ip,port] )
            }
            return {
                peerList: peerList,
                interval: respInterval,
                leechers: leechers,
                seeders: seeders
            }
        },
        scrape: function() {
            // TODO : http://www.bittorrent.org/beps/bep_0015.html
            // http://www.rasterbar.com/products/libtorrent/udp_tracker_protocol.html
        },
        doannounce: function(event, callback) {
            // look at http://www.bittorrent.org/beps/bep_0015.html
            // do retry when connect timeout, or announce timeout
            this.updateState('get_connection')
            this.getConnection( this.onConnection.bind(this,event) )
        },
        onConnection: function(event, connection) {
            if (connection.error) {
                this.error(connection.error);
                return
            }
            this.announceRequest = this.get_announce_payload( connection.connectionId, event );
            this.updateState('send announce')
            this.announcing = true
            chrome.sockets.udp.send( this.udpSockId, this.announceRequest.payload, this.host, this.port, function(writeResult) {
                var lasterr = chrome.runtime.lastError
                if (lasterr) {
                    console.clog(L.TRACKER, 'udp send fail', lastError)
                    // callback with error ...
                    this.error(lasterr.message || lasterr)
                } else {
                    this.updateState('await announce response')
                }
            }.bind(this))
        },
        onReadUDPError: function(info) {
            console.log('onreadudp_err',info)
            chrome.sockets.udp.close(this.udpSockId)
            this.error(info)
        },
        onReadUDP: function(readInfo) {
            if (this.connecting) {
                var conn  = this.parseConnectionResponse(readInfo)
                if (! conn) {
                    this.error('error parsing connection')
                } else if (conn.error) {
                    this.error(conn.error)
                    // it will still retry to connect? or bail out? hmm...
                } else {
                    this.handleConnectionResponse(conn)
                }
            } else if (this.announcing) {
                var resp = this.parseAnnounceResponse(readInfo)
                if (resp.error) {
                    this.error(resp.error)
                } else {
                    this.handleAnnounceResponse(resp)
                }
            } else {
                console.log(this.url,'receiving data why?',this)
                debugger
            }
        },
        parseConnectionResponse: function(sockReadResult) {
            if (sockReadResult.data.byteLength >= 16) {
                var resp = new DataView( sockReadResult.data );
                var respAction = resp.getUint32(0);
                var respTransactionId = resp.getUint32(4)
                var connectionId = [resp.getUint32(8), resp.getUint32(12)]

                if (this.connRequest.transaction_id == respTransactionId ) {
                    var parsed = { connectionId: connectionId,
                                   respAction: respAction,
                                   respTransactionId: respTransactionId }
                    return parsed
                } else {
                    return {error:'txn id mismatch'}
                }
            }
        },
        expireConnection: function() {
            this.connection = null
            this.connectedWhen = null
            chrome.sockets.udp.close(this.udpSockId)
            this.udpSockId = null
        },
        reconnect: function() {
            this.connecting = true
            this.connect_timeout_id = setTimeout( this.onConnectTimeout.bind(this), this.connect_timeout )
            chrome.sockets.udp.create({}, this.onCreate.bind(this))
        },
        getConnection: function(callback) {
            if (this.connecting) {
                callback({error:'already connecting'})
            } else {
                this.connect_callback = callback
                if (this.connection) {
                    if (Date.now() - this.connectedWhen < 60 * 2) {
                        callback(this.connection)
                        return
                    } else {
                        this.expireConnection()
                    }
                }
                this.reconnect()
            }
        },
        onCreate: function(sockInfo) {
            var sockId = sockInfo.socketId
            jstorrent.trackerSockMap[sockId] = this
            this.udpSockId = sockId
            chrome.sockets.udp.bind( this.udpSockId, "0.0.0.0", 0, this.onBind.bind(this))
        },
        onBind: function(sockConnectResult) {
            this.sendConnectPayload()
        },
        sendConnectPayload: function() {
            this.nextRetryWhen = null
            this.connRequest = this.get_connection_data();
            this.updateState('connecting')
            chrome.sockets.udp.send( this.udpSockId, this.connRequest.payload, this.host, this.port, this.onSend.bind(this))
        },
        onSend: function(sockWriteResult) {
            var lasterr = chrome.runtime.lastError
            if (lasterr) {
                console.clog(L.TRACKER, 'udp send fail',lasterr,sockWriteResult)
                this.error(lasterr.message || lasterr)
            }
        },
        get_announce_payload: function(connectionId, event) {
            var doExtension = true
            var addNoCrypto = true
            var addIPV6 = this.torrent.client.app.options.get('enable_ipv6')
            var transactionId = Math.floor(Math.random() * Math.pow(2,32))
            var ACTIONS = {announce:1,
                           scrape:2}
            if (doExtension) {
                var search = this.parsedUrl.search
                if (addNoCrypto) {
                    if (search.length == 0) {
                        search = '?supportcrypto=0'
                    } else {
                        search += '&supportcrypto=0'
                    }
                }
                var ext_data = stringToUint8ArrayWS(this.parsedUrl.pathname + search)
                // split up into chunks of sz < 255
                var numchunks = Math.ceil(ext_data.length / 255)
                var chunks = []
                for (var i=0; i<numchunks; i++) {
                    var a = i*255
                    var b = Math.min(a + 255, ext_data.length)
                    chunks.push( ext_data.slice(a,b) )
                }
                var payload = new Uint8Array(98 + 1 + numchunks + ext_data.length + 1)
            } else {
                var payload = new Uint8Array(98)
            }
            var v = new DataView( payload.buffer );
            var i = 0
            v.setUint32( i, connectionId[0] ); i+=4
            v.setUint32( i, connectionId[1] ); i+=4
            v.setUint32( i, ACTIONS.announce ); i+=4
            v.setUint32( i, transactionId ); i+=4
            for (var j=0; j<20; j++) {
                v.setInt8(i+j, this.torrent.hashbytes[j])
            }
            i+=20
            for (var j=0; j<20; j++) {
                v.setInt8(i+j, this.torrent.client.peeridbytes[j])
            }
            i+=20
            // check not larger than Number.MAX_SAFE_INTEGER (8192 TB)
            // 32 bit (current with setUint32) max is 4GB
            v.setUint32(i+4, this.torrent.get('downloaded')); i+=8
            v.setUint32(i+4, this.torrent.get('size') - this.torrent.get('downloaded')); i+=8
            v.setUint32(i+4, this.torrent.get('uploaded')); i+= 8
            var eventmap = { 'started': 2,
                             'complete': 1,
                             'stopped': 3,
                             'none': 0 }
            if (eventmap[event]) {
                v.setUint32(i, eventmap[event])
            }
            i+=4
            /*
              var ext_ip = this.torrent.client.externalIP()
              if (ext_ip) {
              var nums = ext_ip.split('.').map( function(v) { parseInt(v) } )
              for (var j=0;j<4;j++) {
              v.setUint8(j, nums[j])
              }
              }
            */
            "ip";i+=4 // not sending IP is OK, tracker will figure it out.
            "key";i+=4
            if (event == 'stopped' || event == 'complete') {
                var numwant = 0
            } else {
                var numwant = -1
            }
            v.setInt32(i,numwant); i+=4 // numwant
            var ext_port = this.torrent.client.externalPort()
            v.setUint16(i, ext_port); i+=2
            // tracker extension protocol
            console.assert(i==98)
            if (doExtension) {
                v.setUint8(i++, 0x2)
                for (var j=0; j<chunks.length; j++) {
                    v.setUint8(i++, chunks[j].length)
                    for (var k=0; k<chunks[j].length; k++) {
                        v.setUint8(i++, chunks[j][k])
                    }
                }
                v.setUint8(i++,0)
            }
            //console.log('udp tracker payload',new Uint8Array(payload.buffer))
            return {payload: payload.buffer, transactionId: transactionId, event:event, connectionId:connectionId};
        },
        get_connection_data: function() {
	    // bittorrent udp protocol connection header info
            var payload = new Uint8Array([0, 0, 4, 23, 39, 16, 25, 128, /* hard coded protocol id */
                                          0,0,0,0, /* action */
                                          0,0,0,0 /* transaction id */
                                         ]);
            var action = 0
            var transaction_id = Math.floor(Math.random() * Math.pow(2,32))
            var v = new DataView(payload.buffer)
            v.setUint32(8, action);
            v.setUint32(12, transaction_id)
            return {payload:payload.buffer, transaction_id:transaction_id}
        }
    }
    for (var method in jstorrent.Tracker.prototype) {
        UDPTracker.prototype[method] = jstorrent.Tracker.prototype[method]
    }
    jstorrent.UDPTracker = UDPTracker;
})()
