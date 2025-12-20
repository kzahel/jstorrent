// TODO -- figure out how udp connection re-use is supposed to work
// TODO -- add retry logic
// TODO -- close udp sockets

function onUDPReceive(info) {
    var sockId = info.socketId
    //console.log('udp receive',info)
    if (trackerSockMap[sockId]) {
        trackerSockMap[sockId].onReadUDP(info)

    } else {
        console.warn('unhandled udp receive',info)
    }
    if (window.dhtSockMap && dhtSockMap[sockId]) {
        dhtSockMap[sockId](info)
    }
}
function onUDPReceiveError(info) {
    var sockId = info.socketId
    console.clog(L.TRACKER, 'udp receive error',info, NET_ERRORS_D[info.resultCode])
    if (trackerSockMap[sockId]) {
        trackerSockMap[sockId].onReadUDPError(info)
    } else {
        console.warn('unhandled udp receive',info)
    }
    if (window.dhtpSockMap && dhtSockMap[sockId]) {
        dhtSockMap[sockId](info)
    }
}

var trackerSockMap = {}

chrome.sockets.udp.onReceive.addListener( onUDPReceive )
chrome.sockets.udp.onReceiveError.addListener( onUDPReceiveError )

function Tracker(opts) {
    // TODO -- make sure we are destroying sockets and there aren't
    // double error conditions with timeouts and socket reads
    // returning also
    jstorrent.Item.apply(this, arguments)
    this.torrent = opts.torrent
    this.url = opts.url
    console.assert(this.url)
    this.parsedUrl = parseUri(this.url)
    this.host = this.parsedUrl.host
    this.port = parseInt(this.parsedUrl.port) || 80
    this.state = null;
    this.lasterror = null;
    this.connection = null;

    this.set('errors',0)
    this.set('timeouts',0)
    this.set('announces',0)
    this.responses = 0
    this.timeouts = 0
    this.announcing = false
    this.announce_callback = null
    this.announce_timeout_hit = false
    this.announce_timeout_id = null

    // tracker supplies us with these
    this.announceInterval = null
    this.announceMinInterval = null
}
Tracker.announce_timeout = 20000 // 20 seconds should be enough
jstorrent.Tracker = Tracker;

Tracker.prototype = {
    get_key: function() {
        return this.url
    },
    set_state: function(state) {
        if (state == 'error') {
            //console.error('tracker',this.url,state, this.lasterror);
        } else {
            //console.log('tracker',this.url,state, this.lasterror);
        }
        this.state = state;
    },
    set_error: function(err, details) {
        var errString = ''
        if (err && err.error) {
            errString += err.error
        } else {
            errString += err
        }
        if (details) {
            if (details.error) {
                errString = details.error + ', ' + errString
            } else {
                errString = details + ', ' + errString
            }
        }
        this.set('lasterror', errString)
        if (details == 'chunked encoding') {
            // fake chromexhrsocket does not support chunked encoding responses
            app.createNotification({details:"Tracker error: spoofing not supported for this tracker. Turn of spoofing in the options.",
                                    message:this.torrent.get('name'),
                                    priority:1})
        }
        var callback = this.announce_callback
        if (this.announce_timeout_id) { 
            clearTimeout( this.announce_timeout_id );
            this.announce_timeout_id = null
        }
        this.announce_callback = null
        this.set('errors',this.get('errors')+1)
        this.lasterror = err;
        this.set_state('error')
        if (callback) { callback(null, err) }
    },
    on_announce_timeout: function() {
        if (! this.announce_timeout_id) { return } // success happened

        this.announce_timeout_id = null
        this.announcing = false
        this.timeouts++
        this.set('timeouts',this.get('timeouts')+1)
        this.set_error('timeout')
    }
}
for (var method in jstorrent.Item.prototype) {
    jstorrent.Tracker.prototype[method] = jstorrent.Item.prototype[method]
}

function HTTPTracker() {
    Tracker.apply(this, arguments)
    this.response = null
}

HTTPTracker.prototype = {
    paramEncode: function(param) {
        if (typeof param == 'number') {
            param = param.toString()
        }
        var res = ''
        for (var i=0; i<param.length; i++) {
            if (encodeURIComponent(param[i]) == param[i]) {
                res += param[i]
            } else {
                res += '%' + pad( param.charCodeAt(i).toString(16), '0', 2)
            }
        }
        return res
    },
    shouldSpoof: function() {
        return app.options.get('report_to_trackers_override') && this.torrent.isPrivate()
    },
    announce: function(event, callback) {
        if (jstorrent.options.disable_trackers) { return }
        if (this.shouldSpoof()) {
            console.warn('spoofing announce')
            var peeridbytes = this.torrent.client.peeridbytes_spoof
        } else {
            var peeridbytes = this.torrent.client.peeridbytes
        }

        event = event || 'started'
        this.set('announces',this.get('announces')+1)
        var data = {
            event: event,
            downloaded: this.torrent.get('downloaded'),
            uploaded: this.torrent.get('uploaded'),
            compact: 1,
            peer_id: ui82str(peeridbytes),
            port: 6666, // some trackers complain when we send 0 and dont give a response
            left: this.torrent.get('size') - this.torrent.get('downloaded')
        }
        //console.log('http tracker announce data',data)

        if (this.shouldSpoof()) {
            var xhr = new ChromeSocketXMLHttpRequest; // havent coded in chunked encoding ugh...
        } else {
            var xhr = new XMLHttpRequest;
        }

        var url
        if (this.url.indexOf('?') == -1) {
            url = this.url + '?'
        } else {
            url = this.url + '&'
        }
        this.torrent.updateHashBytes() // prevent race condition
        url = url + 'info_hash=' + this.paramEncode(ui82str(this.torrent.hashbytes))
        for (var key in data) {
            url = url + '&' + key + '=' + this.paramEncode(data[key]) // is this the right format?
        }
        xhr.responseType = 'arraybuffer'
        xhr.timeout = Tracker.announce_timeout
        xhr.onload = _.bind(function(evt) {
            this.set('lasterror','')
            clearTimeout( this.announce_timeout_id )
            var strResponse = ui82str(new Uint8Array(evt.target.response))

            if (evt.target.status != 200) {
                this.set_error('error','code ' + evt.target.status + ', ' + strResponse)
            } else {
                try {
                    var data = bdecode(strResponse)
                } catch(e) {
                    this.set_error('error','error decoding tracker response')
                    return
                }
                
                //console.log('http tracker response',data)
                this.response = data

                this.set('leechers',data.incomplete)
                this.set('seeders',data.complete)
                this.set('lasterror','')

                if (data.peers && typeof data.peers == 'object') {
                    this.torrent.addNonCompactPeerBuffer(data.peers)
                } else if (data.peers) {
                    this.torrent.addCompactPeerBuffer(data.peers)
                } else {
                    this.set_error('no peers in response',data,evt)
                    if (data['failure reason']) {
                        if (this.torrent.isPrivate()) {
                            app.createNotification({details:"HTTP Tracker error, reason given: \"" + data['failure reason'] + '\". If this is a private torrent, please contact the site administrator and ask them if they can unblock JSTorrent',
                                                    priority:2})
                        }
                    }
                }
            }

        },this)
        xhr.onerror = _.bind(function(evt) {
            console.log('http tracker error',evt)
            this.set_error('xhr error', evt)
        },this)
        xhr.open("GET", url, true)
        if (this.shouldSpoof()) {
            xhr.setRequestHeader('User-Agent','uTorrent/330B(30235)(server)(30235)')
        } else {
            //console.log('setting x-user-agent','JSTorrent/'+this.torrent.client.verstr)
            xhr.setRequestHeader('X-User-Agent',this.torrent.client.getUserAgent())
        }
        xhr.send()
    }
}

jstorrent.HTTPTracker = HTTPTracker;
for (var method in Tracker.prototype) {
    jstorrent.HTTPTracker.prototype[method] = Tracker.prototype[method]
}

function UDPTracker() {
    Tracker.apply(this, arguments)
    this.udpSockId = null
}

UDPTracker.prototype = {
    on_announce_response: function(connectionInfo, announceRequest, readResponse) {
        clearTimeout( this.announce_timeout_id )
        var callback = this.announce_callback
        this.announce_callback = null
        this.announce_timeout_id = null
        this.announcing = false
        this.responses++

        this.set_state('on_announce_response')
        var v = new DataView(readResponse.data);
        var resp = v.getUint32(4*0)
        var respTransactionId = v.getUint32(4*1);
        var respInterval = v.getUint32(4*2);
        var leechers = v.getUint32(4*3);
        var seeders = v.getUint32(4*4);
        this.set('leechers',leechers)
        this.set('seeders',seeders)
        this.set('lasterror','')

        console.assert( respTransactionId == announceRequest.transactionId )

        var countPeers = (readResponse.data.byteLength - 20)/6
        //console.log(this.url,'leechers',leechers,'seeders',seeders,'interval',respInterval, 'peers',countPeers)

        for (var i=0; i<countPeers; i++) {
            var ipbytes = [v.getUint8( 20 + (i*6) ),
                      v.getUint8( 20 + (i*6) + 1),
                      v.getUint8( 20 + (i*6) + 2),
                      v.getUint8( 20 + (i*6) + 3)]
            var port = v.getUint16( 20 + (i*6) + 4 )
            var ip = ipbytes.join('.')
            //console.log('got peer',ip,port)
            //this.torrent.swarm.add_peer( { ip:ip, port:port } )
            var peer = new jstorrent.Peer({torrent: this.torrent, host:ip, port:port})
            if (! this.torrent.swarm.contains( peer )) {
                this.torrent.swarm.add( peer )
            }
        }
        this.torrent.set('numswarm', this.torrent.swarm.items.length )

        if (callback) { callback(countPeers) }
    },
    announce: function(event, callback) {
        if (jstorrent.options.disable_trackers) { return }
        if (this.announcing) { return }
        event = event || 'started'
        this.set('announces',this.get('announces')+1)
        this.lasterror = null
        this.announce_callback = callback
        this.announce_timeout_id = setTimeout( _.bind(this.on_announce_timeout,this), Tracker.announce_timeout )

	if (! this.connection) {
            this.set_state('get_connection')
	    this.get_connection( _.bind(function(connectionInfo, err) {
                if (err) {
                    this.set_error(err); return
                }
                // this.connection = connectionInfo // dont re-use connection, whatevs
                //console.log('tracker got connection',connectionInfo.connectionId)

                var announceRequest = this.get_announce_payload( connectionInfo.connectionId, event );
                this.set_state('write_announce')
                chrome.sockets.udp.send( connectionInfo.socketId, announceRequest.payload, this.host, this.port, _.bind( function(writeResult) {
                    var lastError = chrome.runtime.lastError
                    if (lastError) {
                        console.clog(L.TRACKER, 'udp send fail', lastError)
                        // callback with error ...
                        this.set_error({lastError:lastError,error:writeResult})
                        return
                    }
                    this.set_state('read_announce')
                    // check error condition?
                    this.readUDP( connectionInfo.socketId, _.bind(this.on_announce_response, this, connectionInfo, announceRequest ) )
                }, this))
	    },this) );
	} else {
            this.set_error('re-using tracker udp connection not yet supported')
        }
    },
    get_announce_payload: function(connectionId, event) {
        var transactionId = Math.floor(Math.random() * Math.pow(2,32))
        var payload = new Uint8Array([
            0,0,0,0, 0,0,0,0, /* connection id */
            0,0,0,1, /* action */
            0,0,0,0, /* transaction id */
            0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0, /* infohash */
            0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0, /* peer id */
            0,0,0,0,0,0,0,0, /* downloaded */
            0,0,0,0,0,0,0,0, /* left */
            0,0,0,0,0,0,0,0, /* uploaded */
            0,0,0,0, /* event */
            0,0,0,0, /* ip */
            0,0,0,0, /* key */
            255,255,255,255, /* numwant */
            2,0, /* port, sending something random cuz we dont even listen yet */
            0,0, /* extensions */
        ]);

        var v = new DataView( payload.buffer );
        v.setUint32( 0, connectionId[0] )
        v.setUint32( 4, connectionId[1] )
        v.setUint32( 12, transactionId )
        for (var i=0; i<20; i++) {
            v.setInt8(16+i, this.torrent.hashbytes[i])
        }
        for (var i=0; i<20; i++) {
            v.setInt8(36+i, this.torrent.client.peeridbytes[i])
        }

        v.setUint32(56, this.torrent.get('downloaded'))
        v.setUint32(56+4, this.torrent.get('size') - this.torrent.get('downloaded'))
        v.setUint32(56+4*2, this.torrent.get('uploaded'))
        var eventmap = { 'started': 2,
                         'completed': 1,
                         'stopped': 3,
                         'none': 0 }
        if (eventmap[event]) {
            v.setUint32(56+4*3, eventmap[event])
        }

        return {payload: payload.buffer, transactionId: transactionId};
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
    },
    readUDP: function(sockId, callback) {
        this._read_udp_callback = callback
        trackerSockMap[sockId] = this
    },
    onReadUDPError: function(info) {
        this.set_error({error:info})
    },
    onReadUDP: function(info) {
	//console.log('onReadUDP',info)
        this._read_udp_callback(info)
    },
    get_connection: function(callback) {
        chrome.sockets.udp.create({}, _.bind(function(sockInfo) {
            var sockId = sockInfo.socketId
            this.udpSockId = sockId
            chrome.sockets.udp.bind( sockId, "0.0.0.0", 0, _.bind( function(sockConnectResult) {
                //console.log('udp connected', sockConnectResult)
                var connRequest = this.get_connection_data();
                chrome.sockets.udp.send( sockId, connRequest.payload, this.host, this.port, _.bind( function(sockWriteResult) {
                    var lastError = chrome.runtime.lastError
                    if (lastError) {
                        console.clog(L.TRACKER, 'udp send fail',lastError,sockWriteResult)
                        callback( null, {error:sockWriteResult, lastError:lastError} )
                        return
                    }
                    //console.log('udp wrote', sockWriteResult)
                    this.readUDP( sockId, _.bind( function(sockReadResult) {
                        //console.log('udp read get connection response',sockReadResult)
                        if (sockReadResult.data === undefined) {
                            // cordova bug?
                            callback( null, {error:'error udp connection response', result: sockReadResult } )
                        } else if (sockReadResult.data.byteLength < 16) {
                            //console.log('tracker udp sock read bytelength',sockReadResult.data.byteLength)
                            callback( null, {error:'error udp connection response', result: sockReadResult } )
                        } else {
                            var resp = new DataView( sockReadResult.data );
                            var respAction = resp.getUint32(0);
                            var respTransactionId = resp.getUint32(4)
                            var connectionId = [resp.getUint32(8), resp.getUint32(12)]

                            console.assert( connRequest.transaction_id == respTransactionId );
                            callback( {connectionId:connectionId, socketId:sockInfo.socketId}, null )
                        }

                    }, this));

                }, this));

            }, this));
        },this));
    }
}

jstorrent.UDPTracker = UDPTracker;
for (var method in Tracker.prototype) {
    jstorrent.UDPTracker.prototype[method] = Tracker.prototype[method]
}

