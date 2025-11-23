(function() {
    // TODO -- figure out how udp connection re-use is supposed to work
    // TODO -- add retry logic
    // TODO -- close udp sockets

    jstorrent.trackerSockMap = {}
    var trackerSockMap = jstorrent.trackerSockMap

    function onUDPReceive(info) {
        var sockId = info.socketId
        //console.log('udp receive',info)
        if (trackerSockMap[sockId]) {
            trackerSockMap[sockId].onReadUDP(info)
        } else {
            //console.warn('unhandled udp receive',info)
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

    chrome.sockets.udp.onReceive.addListener( onUDPReceive )
    chrome.sockets.udp.onReceiveError.addListener( onUDPReceiveError )

    function Tracker(opts) {
        // TODO -- make sure we are destroying sockets and there aren't
        // double error conditions with timeouts and socket reads
        // returning also
        jstorrent.Item.apply(this, arguments)
        this.__name__ = arguments.callee.name
        this.torrent = opts.torrent
        this.url = opts.url
        console.assert(this.url)
        this.parsedUrl = parseUri(this.url)
        this.host = this.parsedUrl.hostname
        this.port = parseInt(this.parsedUrl.port) || 80
        this.connection = null;

        this.set('state','idle')
        this.set('errors',0)
        this.set('timeouts',0)
        this.set('disabled',false)
        this.set('announces',0)
        this.set('scrapes',0)
        this.set('next_announce',0)
        this.set('interval',0)
        this.set('min_interval',0)
        this.set('downloaded',0)
        this.set('leechers',0)
        this.set('seeders',0)
        this.set('received',0)
        this.set('lasterror','')

        this.announcedWhen = null
        this.announcing = false
        this.announce_callback = null
        this.announce_timeout_hit = false
        this.announce_timeout_id = null

        this.next_announce_timeout_id = null

        this.announceRequest = null
    }
    Tracker.announce_timeout = 20000 // 20 seconds should be enough
    jstorrent.Tracker = Tracker;

    Tracker.prototype = {
        get_key: function() {
            return this.url
        },
        cleanup: function() {
            if (this.next_announce_timeout_id) {
                clearTimeout( this.next_announce_timeout_id )
            }
        },
        tick: function() {
            // if torrent is active, send a tick every second or so? so we can update the display.
            var now = Date.now()
            if (this.next_announce_timeout_id) {
                var elapsed = (now - this.announcedWhen) / 1000
                this.set('next_announce', formatValETA(this.get('interval') - elapsed))
            }
            if (this.nextRetryWhen && this.retrying && ! this.get('disabled')) {
                this.updateState('retry in ' + Math.floor((this.nextRetryWhen - now)/1000))
            }
        },
        announce: function(event, callback) {
            if (this.next_announce_timeout_id) {
                clearTimeout(this.next_announce_timeout_id)
            }
            this.next_announce_timeout_id = null
            if (jstorrent.options.disable_trackers) {
                if (callback) {callback({error:'disabled'})}
                return
            }
            if (this.announcing) { callback({error:'already announcing'}); return }
            event = event || 'started'
            this.announce_callback = callback
            this.announce_timeout_id = setTimeout( _.bind(this.on_announce_timeout,this), Tracker.announce_timeout )
            this.doannounce(event, callback)
        },
        onAnnounceSuccess: function() {
            console.log(this,'onannouncesuccess',this.announceRequest)
            this.set('announces',this.get('announces')+1)
            clearTimeout( this.announce_timeout_id )
            var callback = this.announce_callback
            this.announce_callback = null
            this.announce_timeout_id = null
            this.announcing = false
            this.announcedWhen = Date.now()
            if (this.announceRequest.event == 'stopped' || this.announceRequest.event == 'complete') {
                // TODO if seeding, still announce on complete
                this.set('next_announce', 0)
            } else {
                this.next_announce_timeout_id = setTimeout( this.announce.bind(this,'none'),
                                                            this.get('interval') * 1000 )
            }
            this.updateState('idle')
            if (callback) {
                callback(resp)
            }
        },
        updateState: function(state) {
            this.set('state',state)
        },
        error: function(info) {
            console.clog(L.TRACKER,'tracker error:',info)
            this.set('lasterror',info)
            this.onError(info)
            this.updateState('error')
        },
        onError: function(info) {
            // does not play too well with UDP reconnect attempt logic
            var callback = this.announce_callback
            if (this.announce_timeout_id) { 
                clearTimeout( this.announce_timeout_id );
                this.announce_timeout_id = null
            }
            this.announce_callback = null
            this.announcing = false
            this.connecting = false
            this.set('errors',this.get('errors')+1)
            if (callback) { callback(info) }
        },
        on_announce_timeout: function() {
            if (! this.announce_timeout_id) { return } // success happened
            this.announce_timeout_id = null
            this.announcing = false
            this.set('timeouts',this.get('timeouts')+1)
            this.error('timeout')
        }
    }
    for (var method in jstorrent.Item.prototype) {
        jstorrent.Tracker.prototype[method] = jstorrent.Item.prototype[method]
    }

    function HTTPTracker() {
        Tracker.apply(this, arguments)
        this.__name__ = arguments.callee.name

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
        handleAnnounceResponse: function(data) {
            this.set('leechers',data.incomplete)
            this.set('seeders',data.complete)
            this.set('downloaded',data.downloaded)
            this.set('interval',data.interval)
            this.set('min_interval',data['min interval'] || data['min_interval'])
            this.set('lasterror','')

            var gotpeers = false
            if (data.peers && typeof data.peers == 'object') {
                this.torrent.addNonCompactPeerBuffer(data.peers)
                //this.set('received',this.get('received')+data.peers.length) // fix this
                gotpeers = true
            } else if (data.peers) {
                this.torrent.addCompactPeerBuffer(data.peers)
                //this.set('received',this.get('received')+data.peers.length) // fix this
                gotpeers = true
            }
            if (data.peers6) {
                this.torrent.addCompactPeerBuffer(data.peers6,'httptracker',{ipv6:true})
                gotpeers = true
            }

            if (this.announceRequest.numwant == 0 && ! gotpeers) {
                // thats ok.
            } else if (! gotpeers) {
                this.error({message:'no peers in response',data:data})
                if (data['failure reason']) {
                    if (this.torrent.isPrivate()) {
                        app.createNotification({details:"HTTP Tracker error, reason given: \"" + data['failure reason'] + '\". If this is a private torrent, please contact the site administrator and ask them if they can unblock JSTorrent',
                                                priority:2})
                    }
                }
                return
            }
            this.onAnnounceSuccess()
        },
        doannounce: function(event, callback) {
            if (this.shouldSpoof()) {
                console.warn('spoofing announce')
                var peeridbytes = this.torrent.client.peeridbytes_spoof
            } else {
                var peeridbytes = this.torrent.client.peeridbytes
            }

            var data = {
                event: event,
                downloaded: this.torrent.get('downloaded'),
                uploaded: this.torrent.get('uploaded'),
                compact: 1,
                supportcrypto: 0,
                peer_id: ui82str(peeridbytes),
                port: this.torrent.client.externalPort(), // some trackers complain when we send 0 and dont give a response
                left: this.torrent.get('size') - this.torrent.get('downloaded')
            }
            this.announceRequest = data
            if (event == 'stopped' || event == 'complete') {
                data.numwant = 0
            }
            var xhr = new WSC.ChromeSocketXMLHttpRequest
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
            xhr.onload = function(evt) {
                this.set('lasterror','')
                clearTimeout( this.announce_timeout_id )
                var strResponse = ui82str(new Uint8Array(evt.target.response))

                if (evt.target.status != 200) {
                    console.clog(L.TRACKER,'tracker error',evt)
                    this.error(evt.target.status)
                } else {
                    try {
                        var data = bdecode(strResponse)
                    } catch(e) {
                        this.error('error decoding tracker response')
                        return
                    }
                    this.handleAnnounceResponse(data)
                }
            }.bind(this)
            xhr.ontimeout = function(evt) {
                this.error('timeout')
                xhr.cancel()
            }.bind(this)
            xhr.onerror = _.bind(function(evt) {
                console.log('http tracker error',evt)
                this.error(evt)
            },this)
            xhr.open("GET", url, true)
            xhr.setRequestHeader('connection','close')
            if (this.shouldSpoof()) {
                xhr.setRequestHeader('User-Agent','uTorrent/330B(30235)(server)(30235)')
            } else {
                var agent = this.torrent.client.getUserAgent()
                xhr.setRequestHeader('User-Agent',agent)
                xhr.setRequestHeader('X-User-Agent',agent)
            }
            xhr.send()
        }
    }

    jstorrent.HTTPTracker = HTTPTracker;
    for (var method in Tracker.prototype) {
        jstorrent.HTTPTracker.prototype[method] = Tracker.prototype[method]
    }


})();
