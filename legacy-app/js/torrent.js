function Bridge(opts) {
    this.id = Bridge.ctr++
    this.start = opts.start
    this.startPiece = Math.floor( opts.start / opts.torrent.pieceLength )
    console.clog(L.STREAM,this.id,'new bridge with startpiece',this.startPiece)
    this.end = opts.end
    this.handler = opts.handler
    this.file = opts.file
    this.file.set('streaming','init'+this.startPiece)
    this.torrent = opts.torrent
    this.ondata = null
}
Bridge.ctr = 0
var Bridgeproto = {
    notneeded: function() {
        console.clog(L.STREAM,'bridge.notneeded')
        this.handler.request.connection.stream.onclose = null
        delete this.torrent.bridges[this.id]
    },
    onhandlerclose: function() {
        console.clog(L.STREAM,'bridge.onhandlerclose')
        this.file.set('streaming',false)
        console.warn("REMOVE BRIDGE",this.id)
        // called when the handler connection is closed
        //debugger
        delete this.torrent.bridges[this.id]
    },
    requestfinished: function() {
        console.clog(L.STREAM,'bridge.requestfinished')
        this.file.set('streaming',false)
        console.warn("REMOVE BRIDGE",this.id)
        this.handler.request.connection.stream.onclose = null // only if current?
        delete this.torrent.bridges[this.id]
        // remove "onclose"
    },
    newPiece: function(pieceNum) {
        this.file.set('streaming','now'+pieceNum)
        // a new piece is available
        this.ondata()
    }
}
_.extend(Bridge.prototype, Bridgeproto)

function Torrent(opts) {
    jstorrent.Item.apply(this, arguments)
    this.__name__ = arguments.callee.name
    this.client = opts.client || opts.parent.parent
    this.thinkIntervalTime = 250
    this.thinkCtr = 0
    this.tickTime = Date.now() // a cached call to Date.now() (for better performance?)
    console.assert(this.client)
    this.hashhexlower = null
    this.hashbytes = null
    this.bridges = {}
    this.magnet_info = null
    this.session_start_time = null
    this.initializedFromEntry = null
    this.initializedFromBuffer = null
    // the idea behind endgame is that when we are very near to
    // torrent completion, requests made to slow peers prevent us from
    // making the same requests to peers who would actually complete
    // the requests. so in endgame mode, ignore the fact that there
    // are outstanding requests to chunks to other peers. make up to
    // (say, 3) requests to each chunk, as long as we aren't the one
    // who made the request.
    this.isEndgame = false
    this.set('bytes_sent', this._attributes.bytes_sent || 0)
    this.set('bytes_received', this._attributes.bytes_received || 0)
    this.set('downspeed',0)
    this.set('upspeed',0)
    this.set('numpeers',0)
    this.set('numswarm',0)
    this.set('eta',0)
    if (! this.get('downloaded')) {
        this.set('downloaded', 0)
    }
    if (! this.get('uploaded')) {
        this.set('uploaded', 0)
    }
    this.invalidDisk = false
    this.invalid = false;
    this.started = false; // get('state') ? 
    this.starting = false
    this.stopinfo = null
    this.paused = false
    this.autostart = null

    this.metadata = {}
    this.infodict = null
    this.infodict_buffer = null
    this.unflushedPieceDataSize = 0
    this.updatePieceDataSizeLimit()
    this.pieceLength = null
    this.multifile = null
    this.fileOffsets = null
    this.size = null
    this.numPieces = null
    this.numFiles = null
    // this._attributes.bitfield = null // use _attributes.bitfield for convenience for now...
    this.bitfieldFirstMissing = null // first index where a piece is missing
    this.numPiecesDownloaded = 0

    this.settings = new jstorrent.TorrentSettings({torrent:this})

    // want to persist trackers too as torrent attribute...
    this.trackers = new jstorrent.Collection({torrent:this, itemClass:jstorrent.Tracker})
    this.swarm = new jstorrent.Collection({torrent:this, itemClass:jstorrent.Peer})
    this.swarm.on('add', function() {
        this.set('numswarm',this.swarm.items.length)
    }.bind(this))
    this.peers = new jstorrent.PeerConnections({torrent:this, itemClass:jstorrent.PeerConnection})
    this.pieces = new jstorrent.Collection({torrent:this, itemClass:jstorrent.Piece})
    this.files = new jstorrent.Collection({torrent:this, itemClass:jstorrent.File})
    this.pieceCache = new jstorrent.PieceCache({torrent:this})

    this.rings = { sent: new jstorrent.RingBuffer(8),
                   received: new jstorrent.RingBuffer(8) }

    this.connectionsServingInfodict = [] // maybe use a collection class for this instead
    this.connectionsServingInfodictLimit = 3 // only request concurrently infodict from 3 peers

    // XXX duplicate looking events!
    this.peers.on('connect_timeout', _.bind(this.on_peer_close,this))
    this.peers.on('error', _.bind(this.on_peer_close,this))
    this.peers.on('close', _.bind(this.on_peer_close,this))
    this.peers.on('disconnect', _.bind(this.on_peer_close,this))
    this.peers.on('add', _.bind(this.on_peer_add,this))

    this.on('started', _.bind(this.onStarted,this))
    this.on('complete', _.bind(this.onComplete,this))
    this.on('stopped', _.bind(this.onStopped,this))

    this.on('needRecalculatePieceBlacklist', _.debounce(_.bind(function() {
        this.recalculatePieceBlacklist()
    },this), 1000))

    this.think_interval = null
    this.pieceBlacklist = {}

    if (opts.autostart === false) {
        this.autostart = false
    }
    
    if (opts.url) {
        this.initializeFromWeb(opts.url, opts.callback) 
    } else if (opts.id) {
        this.hashhexlower = opts.id
	this.updateHashBytes()
    } else if (opts.entry) {
        // initialize from filesystem entry!
        console.assert(opts.callback)
        this.initializeFromEntry(opts.entry, opts.callback, {needSave:false})
    } else {
        console.error('unsupported torrent initializer', opts)
        this.invalid = true
        return
    }

    if (opts.entry || (opts.url && ! this.magnet_info)) {
        console.clog(L.TORRENT,'inited torrent without hash known yet!')
    } else {
        console.assert(this.hashhexlower)
	console.assert(this.hashbytes)
        //console.log('inited torrent',this.hashhexlower)
    }
}
jstorrent.Torrent = Torrent

//Torrent.persistAttributes = ['bitfield']
Torrent.attributeSerializers = {
    bitfield: {
        serialize: function(v) {
            return v.join('')
        },
        deserialize: function(v) {
            if (! v) { return null }
            var arr = [], len = v.length
            for (var i=0; i<len; i++) {
                arr.push(parseInt(v[i]))
            }
            return arr
        }
    },
    added: {
        serialize: function(v) {
            return v.getTime()
        },
        deserialize: function(v) {
            return new Date(v)
        }
    }
}

Torrent.prototype = {
    updatePieceDataSizeLimit: function() {
        this.unflushedPieceDataSizeLimit = this.client.app.options.get('max_unflushed_piece_data') * Math.max(this.pieceLength,
                                                                                                              jstorrent.protocol.chunkSize * 128)
    },
    updateHashBytes: function() {
        this.hashbytes = []
        for (var i=0; i<20; i++) {
            this.hashbytes.push(
                parseInt(this.hashhexlower.slice(i*2, i*2 + 2), 16)
            )
        }
    },
    resetState: function() {
        console.clog(L.TORRENT,this.get_key(),'resetState')
        var url = this.get('url')
        var client = this.client
        if (url) {
            this.remove( function() {
                console.clog(L.TORRENT,'removed, adding')
                client.add_from_url(url)
            }, {dontannounce:true})
        } else {
            // this torrent was created by dropping in a .torrent file. so unless we have the entry handy... we cant reset state.
            // but the entry should be stored in our downloads folder!
            if (this._opts.id) {
                var id = this._opts.id
                this.remove( function() {
                    console.clog(L.TORRENT,'removed, adding')
                    this.client.add_from_id(id, null) // might want to include optional metadata like the name.
                }.bind(this), {dontannounce:true})
            } else {
                this.client.app.createNotification({details:"Sorry. Unable to reset state for this torrent. Please remove the torrent and re-add it",
                                                    priority:2})
            }
        }
    },
    reportIssue: function() {
        // serializes a bunch of this torrent's state and uploads it to jstorrent.com

        
    },
    resetStateOld: function() {
        console.clog(L.TORRENT,'reset torrent state')
        if (this.started) { return }
        // resets torrent to 0% and, if unable to load metadata, clears that, too.
        //this.stop()
        this.bitfieldFirstMissing = 0
        this.isEndgame = false
        var url = this.get('url')
        if (url) {
            // this is messy. perhaps reset state should actually just
            // fucking delete this torrent and create a new one from
            // scratch with brand new attributes...
            this.numPieces = null
            this.numFiles = null
            this.metadata = null
            this.infodict = null
            this.infodict_buffer = null
            this.bitfieldFirstMissing = null
            this.unset('metadata')
            this.unset('bitfield')
            this.unset('disk')
            this.unset('complete')
            this.unset('filePriority')
            this.save( _.bind( function() {
                this.initializeFromWeb(url)
            },this))
            //this.initializeTrackers() // trackers are missing now :-(

        } else {
            // unsupported...
            this.error('Missing Disk')
            app.createNotification({details:"Disk missing where .torrent file was stored. Please remove the torrent and add it again",
                                    priority:2})

        }
    },
    bytesToHashhex: function(arr) {
        console.assert(arr.length == 20)
        var s = ''
        for (var i=0; i<arr.length; i++) {
            s += pad(arr[i].toString(16), '0', 2)
        }
        console.assert(s.length == 40)
        return s
    },
    addNonCompactPeerBuffer: function(added) {
        for (var i=0; i<added.length; i++) {
            var host = added[i].ip
            var port = added[i].port
            // also contains .peer_id, but we dont care
            peer = new jstorrent.Peer({host:host, port:port, torrent:this})
            if (! this.swarm.contains(peer)) {
                //console.log('peer buffer added new peer',host,port)
                this.swarm.add(peer)
            }
        }
    },
    addCompactPeerBuffer: function(added) {
        var numPeers = added.length/6
        for (var i=0; i<numPeers; i++) {
            idx = 6*i
            host = [added.charCodeAt( idx ),
                    added.charCodeAt( idx+1 ),
                    added.charCodeAt( idx+2 ),
                    added.charCodeAt( idx+3 )].join('.')
            port = added.charCodeAt( idx+4 ) * 256 + added.charCodeAt( idx+5 )
            peer = new jstorrent.Peer({host:host, port:port, torrent:this})
            if (! this.swarm.contains(peer)) {
                //console.log('peer buffer added new peer',host,port)
                this.swarm.add(peer)
            }
        }

    },
    initializeFromWeb: function(url, callback, opts) {
        console.clog(L.TORRENT,'torrent initialize from web',url)

        if (url.length == 40) {
            // initialize from info infohash!
            url = 'magnet:?xt=urn:btih:' + url + '&dn=' + url

            for (var i=0; i<Math.max(jstorrent.constants.publicTrackers.length,4); i++) {
                url = url + '&tr=' + encodeURIComponent(jstorrent.constants.publicTrackers[i])
            }
        }


        if (url.toLowerCase().match('^magnet:')) {
            app.analytics.sendEvent("Torrent", "Add", "Magnet")

            // initialize torrent from a URL...
            // parse trackers
            this.magnet_info = parse_magnet(url);
            if (! this.magnet_info) {
                this.invalid = true;
                return
            }

            if (this.magnet_info.dn) {
                this.set('name', this.magnet_info.dn[0].replace(/\+/g,' ')) // what kind of encoding is dn?
            }

            if (! this.magnet_info.tr) {
                this.magnet_info.tr = jstorrent.constants.publicTrackers
            }

            if (this.magnet_info.tr) {
                // initialize my trackers
                this.initializeTrackers()
            }

            if (this.magnet_info.start && this.magnet_info.start == '0') {
                this.autostart = false
            }

            this.set('url',url)
            this.hashhexlower = this.magnet_info.hashhexlower
	    this.updateHashBytes()
            this.save()
            if (callback) { callback({torrent:this}) }
        } else {
            app.analytics.sendEvent("Torrent", "Add", "XHR")
            var xhr = new XMLHttpRequest;
            xhr.open("GET", url, true)
            xhr.responseType = 'arraybuffer'
            xhr.onload = _.bind(function(evt) {
                var headers = xhr.getAllResponseHeaders()
                console.clog(L.TORRENT,'loaded url',url, headers)
                this.initializeFromBuffer(evt.target.response, callback, opts)
            },this)
            xhr.onerror = function(evt) {
                console.error('unable to load torrent url',evt)
                app.notify("Unable to load Torrent. Was the URL valid? If the site requires authentication, you must download it and drag it in.")
            }
            xhr.send() // can throw exception "A network error has occured" NetworkError
        }
    },
    initializeFromBuffer: function(buffer, callback, opts) {
        //console.log('initializefrombuffer')
        this.initializedFromBuffer = buffer
        var _this = this
        function onHashResult(result) {
            var hash = result.hash
            if (hash) {
                //console.log('hashed input torrent file to',hash)
                _this.hashbytes = ui82arr(hash)
                _this.hashhexlower = _this.bytesToHashhex(_this.hashbytes).toLowerCase()
                //console.assert( _this.hashhexlower == '0cd80358a182edd5a74d1e967d98822212d2f744' ) // Tomorrow's Modern Boxes
                _this.initializeTrackers()
                _this.metadataPresentInitialize(opts)
                console.assert(_this.hashhexlower.length == 40)
                if (callback) { callback({torrent:_this}) }
            } else {
                callback({error:'hasher error'})
            }
        }
        try {
            if (buffer.byteLength > Math.pow(2,25)) { // 32 megs 
                callback({error:"Torrent file too large: " + buffer.byteLength})
                return
            }
            this.metadata = bdecode(ui82str(new Uint8Array(buffer)))
            this.metadata_isutf8 = false
            // always assume .torrent file is utf-8 (this is how transmission behaves...)
            if (true || this.metadata.encoding) {
                if (true || this.metadata.encoding.toLowerCase() == 'utf-8' ||
                    this.metadata.encoding.toLowerCase() == 'utf8') {
                    this.metadata_isutf8 = true
                    this.metadata = bdecode(ui82str(new Uint8Array(buffer)),{utf8:true})
                    //console.clog(L.TORRENT,'utf-8 torrent', this.metadata)
                }
            }
        } catch(e) {
            callback({error:"Invalid torrent file",info:e})
            return
        }
        this.infodict = this.metadata.info
        this.infodict_buffer = new Uint8Array(bencode(this.metadata.info)).buffer // need to do utf-8 encoding?
        // computer SHA1 hash of infodict to get torrent hash
        var chunkData = this.infodict_buffer // turn off transferable
        this.client.workerthread.send( { command: 'hashChunks',
                                         chunks: [new Uint8Array(chunkData)] }, onHashResult, {transferable:false} )
    },
    initializeFromEntry: function(entry, callback, opts) {
        // XXX this is not going through diskio. Maybe disable all disk io and wait for inactive and then do this read...

        // should we save this as a "disk" ? no... that would be kind of silly. just read out the metadata.

        this.initializedFromEntry = entry // not restored upon restart. we want this for resetState
        
        var _this = this
        var reader = new FileReader;
        reader.onload = _.bind(function(evt) {
            //console.log('read torrent data',evt)

            if (evt.target.result.byteLength == 0) {
                callback({error:"read 0 bytes"})
                return
            }
            this.initializeFromBuffer(evt.target.result, callback, opts)

        },this)
        reader.onerror = _.bind(function(evt) {
            // TODO -- maybe cause a notification, with level
            console.error('error reading handleLaunchWithItem',evt)
            callback({error:'FileReader error'})
        },this)
        entry.file( function(file) {
            reader.readAsArrayBuffer(file)
        })
    },
    onRestore: function() {
        // called when item is loaded on app restart

/* done in initializer now
        if (this.parent) {
            this.client = this.parent.parent
        }
*/

        //this.set('complete',this.getPercentComplete()) // wont work unless metadata loaded
        if (this.get('url') && ! this.get('metadata')) {
            this.magnet_info = parse_magnet(this.get('url'))
            this.initializeTrackers()
        }

        if (this.get('state' ) == 'started') {
            this.start()
        }
    },
    getPiece: function(num) {
        console.assert(num < this.numPieces)
        var piece = this.pieces.get(num)
        if (! piece) {
            piece = new jstorrent.Piece({torrent:this, shouldPersist:false, num:num})
            this.pieces.add(piece)
        }
        return piece
    },
    registerRangeRequest: function(range, handler) {
        var bridge = new Bridge({start:range[0],end:range[1],handler:handler,torrent:this,file:handler.file})
        this.bridges[bridge.id] = bridge
        console.clog(L.STREAM,'bridges now',this.bridges)
        if (this.get('state') == 'stopped') { this.start() }
        return bridge
    },
    getCompleteDataWindow: function(byteStart, byteEnd) {
        // returns first complete subset window that's complete starting at byteStart
        console.assert(byteStart < byteEnd)
        console.assert(byteEnd < this.size)
        var pieceLeft = Math.floor(  byteStart / this.pieceLength )
        var pieceRight = Math.ceil( byteEnd / this.pieceLength)
        console.assert(this.havePieceData(pieceLeft))
        var start = null
        var end = null
        start = byteStart
        end = Math.min((pieceLeft+1) * this.pieceLength-1, byteEnd)

        for (var i=pieceLeft; i<=pieceRight; i++) {
            if (this.havePieceData(i)) {
                end = Math.min(this.pieceLength * (i+1)-1, byteEnd)
                if (end == byteEnd) { break }
            } else {
                break
            }
        }
        console.assert(start < end)
        console.assert((end - start) <= (byteEnd - byteStart))
        console.assert(end < this.size)
        console.assert(end <= byteEnd)
        return [start,end]
    },
    havePieceData: function(pieceNum) {
        return this._attributes.bitfield[pieceNum] || this.pieceCache.get(pieceNum)
    },
    haveAnyDataAt: function(byteStart) {
        var pieceNum = Math.floor( byteStart / this.pieceLength )
        if (this.havePieceData(pieceNum)) {
            return true
        }
    },
    getFile: function(num) {
        if (num >= this.numFiles) { return }
        var file = this.files.get(num)
        if (! file) {
            file = new jstorrent.File({itemClass:jstorrent.File,torrent:this, shouldPersist:false, num:num})
            this.files.add(file)
        }
        return file
    },
    notifySecretPiecePersisted: function(pieceNum) {
        var d
        if (! this._attributes['rawPieceStore']) {
            d = {}
            this.set('rawPieceStore', d)
        } else {
            d = this.get('rawPieceStore')
        }
        d[pieceNum] = 1
        this.set('rawPieceStore', d)
        this.save()
    },
    setFilePriority: function(fileNum, priority, oldPriority) {
        // 0 - skip, 1 - normal

        //console.log('set file priority',fileNum,priority)
        var d
        // would be really nice to do a compact encoding, but lets just use an array for now
        if (! this._attributes['filePriority']) {
            //var arr = _.map(_.range(100), function(v){return 1})
            d = {}
            this.set('filePriority', d)
        } else {
            d = this.get('filePriority')
        }
        d[fileNum] = priority
        this.set('filePriority', d)
        this.getFile(fileNum).set('priority',priority)

        if (oldPriority == jstorrent.constants.PRIO_SKIP) {

            // we're changing a file from skipped to not skipped

            // there's a chance we had to persist some of those tricky
            // little stupid hidden pieces because the file was
            // skipped
            
            var file = this.getFile(fileNum)
            var info = file.getSpanningPiecesInfo()
            var toMakeIncomplete = []
            // mark beginning and end of our span as incomplete
            if (info.length == 1) {
                toMakeIncomplete.push(info[0])
            } else {
                toMakeIncomplete.push(info[0])
                toMakeIncomplete.push( info[ info.length-1 ] )
            }

            for (var i=0; i<toMakeIncomplete.length; i++) {
                this.getPiece(toMakeIncomplete[i].pieceNum).markAsIncomplete()
            }
        }


        //this.recalculatePieceBlacklist() // debounce this...

        this.trigger('needRecalculatePieceBlacklist')

        this.save()
    },
    recalculatePieceBlacklist: function() {
        // when we set "skip"/"unskip" on files, need to update a
        // table for speedy incomplete piece lookup
        var fp = this.get('filePriority')
        if (! fp) { 
            this.pieceBlacklist = {}
            return
        }
        console.clog(L.TORRENT,'recalculatePieceBlacklist')
        var needPiece

        for (var i=0; i<this.numPieces; i++) {
            needPiece = false
            var info = jstorrent.Piece.getSpanningFilesInfo(this, i, this.getPieceSize(i))
            for (var j=0; j<info.length; j++) {
                if (fp[info[j].fileNum] != jstorrent.constants.PRIO_SKIP) {
                    // priority is not "0", so need this piece!
                    needPiece = true
                }
            }

            if (needPiece) {
                if (this.pieceBlacklist[i]) {
                    delete this.pieceBlacklist[i]
                }
            } else {
                this.pieceBlacklist[i] = true
            }
        }
    },
    getPieceSize: function(num) {
        console.assert(num < this.numPieces)
        if (num == this.numPieces - 1) {
            return this.size - this.pieceLength * num
        } else {
            return this.pieceLength
            //return this.infodict['piece length']
        }
    },
    metadataPresentInitialize: function(opts) { // i.e. postMetadataReceived
        // call this when infodict is newly available
        this.connectionsServingInfodict = []

        this.numPieces = this.infodict.pieces.length/20
        console.assert( Math.floor(this.numPieces) == this.numPieces )
        if (! this._attributes.bitfield) {
            this._attributes.bitfield = ui82arr(new Uint8Array(this.numPieces))
        } else {
            console.assert( this._attributes.bitfield.length == this.numPieces )
        }
        this.bitfieldFirstMissing = 0 // should fix this/set this correctly, but itll fix itself (when a piece is saved)
        this.pieceLength = this.infodict['piece length']
        this.updatePieceDataSizeLimit()
        if (this.infodict.files) {
            this.fileOffsets = []
            this.multifile = true
            this.numFiles = this.infodict.files.length
            this.size = 0
            for (var i=0; i<this.numFiles; i++) {
                this.fileOffsets.push(this.size)
                this.size += this.infodict.files[i].length
            }
        } else {
            this.fileOffsets = [0]
            this.numFiles = 1
            this.multifile = false
            this.size = this.infodict.length
        }
        this.set('name', this.infodict.name)
        this.set('size',this.size)

        this.peers.each(function(peer){
            // send new extension handshake to everybody, because now it has ut_metadata...
            if (peer.connected) {
                peer.sendExtensionHandshake()
                peer.newStateThink() // in case we dont send them extension handshake because they dont advertise the bit
            }
        })

        var onsaved = function() {
            this.set('metadata',true)
            this.set('complete', this.getPercentComplete())
            this.save()
            this.recalculatePieceBlacklist()
            this.trigger('havemetadata')
        }.bind(this)

        if (! opts || opts.needSave !== false) {
            // XXX use savemetadata callback, it can take a while if its queued...
            this.saveMetadata(onsaved) // trackers maybe not initialized so they arent being saved...
        } else {
            onsaved()
        }
        //this.recheckData() // only do this under what conditions?
    },
    getMetadataFilename: function() {
        return this.get('name') + '.torrent'
    },
    ensureLoaded: function(callback) {
        if (this.infodict) { 
            callback({torrent:this}) 
        } else {
            this.loadMetadata(callback)
        }
    },
    loadMetadata: function(callback) {
        // TODO -- better yet, have this use disk i/o queue

        // need to do have a timeout, because sometimes this dont work!!!
        //this.loadMetadataTimeout = setTimeout( function() {
        //},1000)
        
        var opts = {needSave:false}
        
        // xxx this is failing when disk is not attached!
        var _this = this
        if (this.get('metadata')) {
            if (this.infodict && false) { // force load again for fun (helps checking bad torrent storage)
                callback({torrent:this})
            } else {
                var storage = this.getStorage()
                if (storage && storage.ready) {
                    storage.diskio.getWholeContents( {torrent:this.hashhexlower, path:[this.getMetadataFilename()]}, function(result) {
                        if (result.error) {
                            console.warn(result)
                            callback({error:"Cannot load torrent - " + (result.error.name ? result.error.name : result.error)})
                        } else {
                            _this.initializeFromBuffer(result, callback, opts)
                        }
                    })
                } else {
                    callback({error:'disk missing'})
                }
            }
        } else {
            callback({error:'have no metadata'})
        }
    },
    saveMetadata: function(callback) {
        console.clog(L.TORRENT,'saving torrent metadata',this)
        var filename = this.getMetadataFilename()
        // save metadata (i.e. .torrent file) to disk
        var storage = this.getStorage()
        var _this = this
        if (! storage || ! storage.ready) {
            this.error('disk missing')
            if (callback) {
                callback({error:'disk missing'})
            }
        } else {
            if (true || this.metadata.encoding &&
                (this.metadata.encoding.toLowerCase() == 'utf-8' ||
                 this.metadata.encoding.toLowerCase() == 'utf8')) {
                var s = bencode(this.metadata)
                var data = new Uint8Array(s)
                // assert infohash still matches
                var digest = new Digest.SHA1()
                var s2 = bencode(this.metadata.info)
                digest.update(arrayBufferToStringWS(s2))
                var savedInfo = new Uint8Array(digest.finalize())
                for (var i=0; i<savedInfo.length ;i++ ) {
                    if (savedInfo[i] != this.hashbytes[i]) {
                        console.error("HASH MISMATCH!")
                        debugger
                    }
                }

                
            } else {
                var data = new Uint8Array(bencode(this.metadata))
            }
            storage.diskio.writeWholeContents({path:[filename],
                                               data:data},
                                              callback)
        }
    },
    getDownloaded: function() {
        //if (! this.has_infodict() ) { return 0 } // error condition with reset
        if (! this.get('metadata')) { return 0 }
        var count = 0
        for (var i=0; i<this.numPieces; i++) {
            count += this._attributes.bitfield[i] * this.getPieceSize(i)
        }
        return count
    },
    getPercentComplete: function() {
        var pct = this.getDownloaded() / this.size
        return pct
    },
    pieceDoneUpdateFileComplete: function(piece) {
        // a piece is finished, so recalculate "complete" on any files
        // affected by this.

        var filesSpan = piece.getSpanningFilesInfo()
        var fileSpan, file
        for (var i=0; i<filesSpan.length; i++) {
            fileSpan = filesSpan[i]
            file = this.getFile(fileSpan.fileNum)
            file.set('downloaded',file.get('downloaded')+fileSpan.size)
            var pct = file.get('downloaded') / file.size
            file.set('complete', pct )
            if (pct == 1) {
                file.trigger('complete')
            }
        }
    },
    canEnterEndgame: function() {
        // if diskio queue is rather large, dont enter endgame
        var storage = this.getStorage()
        if (storage && storage.ready && storage.diskio.items.length < 4) {
            return true
        }
        return false
    },
    isComplete: function() {
        return this.get('complete') == 1
    },
    maybeSendKeepalives: function() {
        this.peers.items.forEach( function(peer) {
            if (peer.connected) {
                peer.maybeSendKeepalive()
            }
        })
    },
    maybeDropShittyConnection: function() {
        // TODO only call every few seconds, as we drop too aggressively
        if (! this.infodict) { return }
        if (this.get('complete') == 1) { return }

        var now = new Date()
        // looks at our current connections and sees if we maybe want to disconnect from somebody.
        if (this.started) {
            if (this.swarm.items.length > this.peers.items.length) {
                var connected = _.filter( this.peers.items, function(p) { return p.get('state') == 'connected' })

                if (connected.length > this.getMaxConns() * 0.7
                    ||
                    (this.swarm.items.length > this.getMaxConns() * 5 && connected.length > this.getMaxConns() * 0.6)
                   ) { // 70% of connections are connected
                    // OR, if we have a much larger swarm than our current maxconns and say, 60% connected...

                    var chokers = _.filter( connected, function(p) { 
                        return (p.amChoked &&
                                p.peer.host != '127.0.0.1' &&
                                p.get('bytes_received') < 1048576 && // dont drop a connection that sent us nice stuff!
                                now - p.connectedWhen > 10000)
                    } )

                    if (chokers.length > 0) {
                        chokers.sort( function(a,b) { return a.connectedWhen < b.connectedWhen } )
                        //console.clog(L.PEER,'closing choker',chokers[0])
                        chokers[0].drop('oldest choked connection')
                    }


                    var timeOuters = _.filter( connected, function(p) { 
                        return (p.get('timeouts') >= p.pieceChunkRequestPipelineLimit * 2 &&
                                p.get('timeouts') / p.get('requests') > 0.6)
                    } )

                    if (timeOuters.length > 0) {
                        timeOuters.sort( function(a,b) { return 
                                                         a.get('timeouts') / a.get('requests') <
                                                         b.get('timeouts') / b.get('requests') } )
                        console.clog(L.PEER,'closing timeouter',timeOuters[0], timeOuters[0].get('timeouts'))
                        timeOuters[0].drop('timeouty connection')
                    }

                }
            }
        }
    },
    getFirstUnrequestedPiece: function() {
	// returns the first piece which has no pending requests
        // if every piece has requests pending, then we return null

        var piece

        for (var pieceNum=this.bitfieldFirstMissing; pieceNum<this.numPieces; pieceNum++) {
            if (this._attributes.bitfield[pieceNum]) {
            } else if (this.pieces.containsKey(pieceNum)) {
                // piece has been initialized...
                piece = this.pieces.get(pieceNum)
                if (piece.get('requests') == 0) {
                    return pieceNum
                }
            } else {
                return pieceNum
            }
        }
        return null
    },
    persistPieceLater: function(piece) {
        console.clog(L.TORRENT,'persistPieceLater',piece.num)
        this.pieceCache.add(piece)
        var pieceNum = piece.num
        piece.destroy()

        _.defer( function() { 
            for (var key in this.bridges) {
                this.bridges[key].newPiece(pieceNum)
            }
        }.bind(this))

    },
    updateUnflushedPieceSize: function() {
        // periodically call this to check that we tabulated this.unflushedPieceDataSize correctly.
        var sz = 0
        var piece
        var imax = this.pieces.items.length
        for (var i=0; i<imax; i++) {
            piece = this.pieces.items[i]
            if (piece.data) { sz += piece.data.byteLength }
        }
        this.unflushedPieceDataSize = sz
    },
    persistPieceResult: function(result) {
        var foundmissing = true
        if (result.error) {
            //console.error('persist piece result',result)
            if (result.error == 'QuotaExceededError' || result.error.indexOf('QuotaExceededError') != -1) {
                this.error("Hard disk is full. Free up disk space by removing some files", result.job)
            } else {
                this.error('error persisting piece: ' + result.error, result.job)
            }
            //console.log('report bad job',result.job)
        } else {
            // clean up all registered chunk requests
            this.client.notifyPiecePersisted(result.piece)
            result.piece.notifyPiecePersisted() // this will insert into the piece cache for a little while
            // warning - this needs to come before .newPiece is called
            this.pieceDoneUpdateFileComplete(result.piece)
            //console.log('persisted piece!')
            this.maybePersistPieceCache()
            this._attributes.bitfield[result.piece.num] = 1

            _.defer( function() { 
                for (var key in this.bridges) {
                    this.bridges[key].newPiece(result.piece.num)
                }
            }.bind(this))

            // TODO -- move below into checkDone() method
            foundmissing = false
            for (var i=this.bitfieldFirstMissing; i<this._attributes.bitfield.length; i++) {
                if (this._attributes.bitfield[i] == 0) {
                    this.bitfieldFirstMissing = i
                    foundmissing = true
                    break
                }
            }
            // send HAVE message to all connected peers
            payload = new Uint8Array(4)
            var v = new DataView(payload.buffer)
            v.setUint32(0,result.piece.num)

            this.peers.each( function(peer) {
                if (peer.peerHandshake && peer.connected) {
                    peer.sendMessage("HAVE", [payload.buffer])
                }
            });
        }
        
        if (! foundmissing) {
            this.set('state','complete')

            // TODO -- turn this into progress notification type
            //this.client.app.createNotification({details:"Torrent finished! " + this.get('name')})
            this.trigger('complete')

            // send everybody NOT_INTERESTED!
            this.peers.each( function(peer) {
                if (peer.connected) {
                    peer.sendMessage("NOT_INTERESTED")
                }
            });

        }

        var dld = this.getDownloaded()
        var pct = dld / this.size
        this.set('downloaded', dld)
        this.set('complete', pct)
        this.trigger('progress')
        this.save()
    },
    countBytes: function(type, val) {
        // bubble up to client
        this.client.countBytes(type, val)
        if (type == 'received') {
            this.set('bytes_received', this.get('bytes_received') + val)
        } else {
            this.set('bytes_sent', this.get('bytes_sent') + val)
        }
    },
    notifyInvalidPiece: function(piece) {
        // when a piece comes back invalid, we delete the piece, and now need to clean up the peers too... ?
        this.peers.each( function(peerconn) {
            for (var key in peerconn.pieceChunkRequests) {
                if (key.split('/')[0] == piece.num) {
                    // TODO -- make more accurate
                    peerconn.close('contributed to invalid piece')
                    break
                }
            }
        })
    },
    checkPieceChunkTimeouts: function(pieceNum, chunkNums) {
        if (! this._attributes.bitfield) { return } // torrent was "reset" manually by user

        // XXX this timeout will get called even if this torrent was removed and its data .reset()'d
        //console.log('checkPieceChunkTimeouts',pieceNum,chunkNums)
        if (this._attributes.bitfield[pieceNum]) { return }
        if (this.pieces.containsKey(pieceNum)) {
            this.getPiece(pieceNum).checkChunkTimeouts(chunkNums)
        }
    },
    isPrivate: function() {
        return this.infodict && this.infodict.private
    },
    maybePersistPieceCache: function() {
        // check if it makes sense now to persist a piece
        for (var key in this.pieceCache.cache) {
            var pieceNum = parseInt(key)
            if (! this._attributes.bitfield[pieceNum]) {
                var piece = this.getPiece(pieceNum)
                // only works cuz diskio only does one job at a time, otherwise this would have race condition
                this.shouldPersistPiece(piece, function(shouldPersist) {
                    if (shouldPersist) {
                        piece.data = this.pieceCache.get(pieceNum).data
                        this.persistPiece(piece)
                        _.defer( function() { this.pieceCache.remove(pieceNum) }.bind(this) )
                    }
                }.bind(this))
            }
        }
    },
    maybePersistPiece: function(piece) {
        this.shouldPersistPiece(piece, function(shouldPersist) {
            if (shouldPersist) {
                this.persistPiece(piece)
            } else {
                this.persistPieceLater(piece)
            }
        }.bind(this))
    },
    shouldPersistPiece: function(piece, callback) {
        // if this piece is way at the end of the file, e.g. it would
        // require writing tons of zeros using a truncate call, which
        // would be very expensive, simply don't persist it. This is
        // an important edge case that's worth handling separately,
        // even though it adds complexity.

        if (! jstorrent.options.use_piece_cache) {
            callback(true) // not working so well
            return
        }

        if (this.pieceCache.size > 20) { // dont store too much shit in cache
            callback(true)
            return
        }

        var filesinfo = piece.getSpanningFilesInfo()
        var files = []
        for (var i=0; i<filesinfo.length; i++) {
            files.push( this.getFile(filesinfo[i].fileNum) )
        }
        this.getStorage().ensureFilesMetadata(files, function() {

            var persistNow = true

            for (var i=0; i<files.length; i++) {
                var file = files[i]
                var meta = file.getCachedMetadata()
                //console.log('maybepersistpiece, meta',file.num,meta)
                if (files[i].size / filesinfo[i].fileOffset > 0.9 &&
                    _.keys(this.bridges).length > 0 && // using a bridge!
                    filesinfo[i].fileOffset - meta.size > Math.pow(2,25)) {
                    // 32 megs need to be written, plus fileoffset is 90% at the end of the file
                    // plus we have a bridge
                    persistNow = false
                    console.warn("DONT persist piece! because of file",filesinfo[i],file,meta)
                    break
                }
            }
            if (persistNow) {
                callback(true)
            } else {
                callback(false)
            }
        }.bind(this))
    },
    persistPiece: function(piece) {
        if (! piece.data) {
            this.error("Piece data missing")
        }
        //console.log('persistPiece (now)',piece.num)
        // saves this piece to disk, and update our bitfield.
        var storage = this.getStorage()
        if (storage && storage.ready) {
            storage.diskio.writePiece({piece:piece}, _.bind(this.persistPieceResult,this))
        } else {
            this.error('Storage missing')
        }
    },
    getStorage: function() {
        var disk = this.get('disk')
        if (! disk) {
            disk = this.client.disks.getAttribute('default')
        }
        if (jstorrent.device.platform == 'Android') {
            disk = 'HTML5:persistent'
        }

        var storage = this.client.disks.get(disk)
        if (storage && storage.ready) { // only save disk if it's ready
            if (! this.get('disk')) {
                this.set('disk',storage.get_key())
                this.save()
            }
            return storage
        }
    },
    printComplete: function() {
        return this._attributes.bitfield.join('')
    },
    recheckData: function() {
        // checks registered or default torrent download location for
        // torrent data
        // this.set('complete',0)

        // XXX this needs to clear pieces when done hashing them.
        // XXX this should not read more quickly than it can hash...

        console.log('Re-check data')
        return // too buggy
        if (this.started) {
            this.error('cannot check while started')
            return
        }
        this.set('state','checking')
        if (this.get('metadata')) {
            this.loadMetadata( _.bind(function(result) {

                var results = {}
                var resultsCollected = {num:0, total:this.numPieces}
                console.assert(this.numPieces)
                function recordResult(i,result) {
                    console.log('record result', resultsCollected, i,result)
                    results[i] = [result,'fuckme']
                    resultsCollected.num++
                    if (resultsCollected.num == resultsCollected.total) {
                        console.log('done checking',results)
                        debugger
                    }
                }


                if (result.error) {
                    this.error('no metadata')
                } else {
                    _.range(0,this.numPieces).forEach( _.bind(function(i) {

                        var piece
                        // this is a horribly fucked nightmare mess

                        if (this._attributes.bitfield[i]) {
                            piece = this.getPiece(i)
                            piece.getData(undefined, undefined, function(pieceDataResult) {
                                if (pieceDataResult.error) {
                                    recordResult(i,false)
                                } else {
                                    var s = 0

                                    for (var i=0; i<pieceDataResult.length; i++) {
                                        s += pieceDataResult[i].byteLength
                                    }

                                    if (piece.size != s) {
                                        console.error('sizes dont add up bro!',s,'should be',piece.size)
                                        recordResult(i,false)
                                    } else {
                                        piece.checkPieceHashMatch(pieceDataResult, _.bind(function(i,matched) {
                                            if (matched) {
                                                recordResult(i, true)
                                            } else {
                                                recordResult(i, false)
                                            }
                                        },this,i))
                                    }
                                }
                            })
                        } else {
                            resultsCollected.num++
                            console.log('0 bitmask',i,'increment collected',resultsCollected.num)
                        }
                    },this) )
                }
            },this))
        } else {
            console.error('cannot re-check, dont have metadata')
        }
    },
    initializeFiles: function() {
        // TODO -- this blocks the UI cuz it requires so much
        // computation. split it into several computation steps...
        if (this.infodict) {

            for (var i=0; i<this.numFiles; i++) {
                if (! this.files.containsKey(i)) {
                    file = this.getFile(i)
                }
            }

        }
    },
    registerPieceRequested: function(peerconn, pieceNum, offset, size) {
        // first off, can this torrent even handle doing more disk i/o right now?
        // if so...
        var piece = this.getPiece(pieceNum)
        piece.getData(offset, size, _.bind(function(result) {
            if (result.error) {
                console.error('error getting piece data',result)
                if (result.error == 'NotFoundError' || result.error == 'timeout') {
                    this.error('Error seeding',result.error,true)
                }
                return
            }
            // what if peer disconnects before we even get around to starting this disk i/o job?
            // dont want to waste cycles reading...
            var header = new Uint8Array(8)
            var v = new DataView(header.buffer)
            v.setUint32(0, pieceNum)
            v.setUint32(4, offset)

            this.set('uploaded', this.get('uploaded') + size) // cheating? what is "uploaded" supposed to be, anyway

            peerconn.sendMessage('PIECE', [header.buffer].concat(result))
        },this))
    },
    has_infodict: function() {
        return this.infodict ? true : false
    },
    error: function(msg, detail, opt) {
        this.stop({reason:'error'})
        this.trigger('error',msg,detail,opt)
        this.starting = false
        this.set('state','error')
        this.lasterror = msg
        console.error('torrent error:',[msg,detail,opt])

        if (false) {
            if (msg == 'read 0 bytes') {
                this.client.app.onClientError(msg, 'Torrent file invalid. Click "Reset state" from the "More Actions" toolbar.')
                /*
                  } else if (msg == 'Disk Missing') {
                  this.client.app.createNotification({details:'The disk this torrent was saving to cannot be found. Either "reset" this torrent (More Actions in the toolbar) or re-insert the disk'})
                */
            } else {
                if (this.client.disks.items.length == 0) {
                    // need a more generic error...
                    this.client.app.notifyNeedDownloadDirectory()
                } else {
                    this.client.app.notify(msg)
                    //this.client.app.notifyStorageError() // NO!
                }
            }
        }

        this.started = false
        this.starting = false
        this.save()
    },
    on_peer_add: function(peer) {
        this.set('numpeers',this.peers.items.length)
    },
    on_peer_close: function(peer) {
        // called by .close()
        // later onWrites may call on_peer_error, also
        //console.log('peer disconnect...')

        // XXX - for some reason .close() on the peer is not triggering this?

        if (!this.peers.contains(peer)) {
            //console.warn('peer wasnt in list')
        } else {
            this.peers.remove(peer)
            this.set('numpeers',this.peers.items.length)
        }
    },
    initializeTrackers: function() {
        var url, tracker
        var announce_list = [], urls = []
        if (this.magnet_info && this.magnet_info.tr) {
            for (var i=0; i<this.magnet_info.tr.length; i++) {
                url = this.magnet_info.tr[i];
                if (url.toLowerCase().match('^udp')) {
                    tracker = new jstorrent.UDPTracker( {url:url, torrent: this} )
                } else {
                    tracker = new jstorrent.HTTPTracker( {url:url, torrent: this} )
                }
                announce_list.push( url )
                if (! this.trackers.contains(tracker)) {
                    this.trackers.add( tracker )
                }
            }
            // trackers are stored in "tiers", whatever. magnet links
            // dont support that. put all in first tier.
            this.metadata['announce-list'] = [announce_list]
        } else {

            if (this.metadata) {
                if (this.metadata.announce) {
                    url = this.metadata.announce
                    urls.push(url)
                }
                if (this.metadata['announce-list']) {
                    for (var tier in this.metadata['announce-list']) {
                        for (var i=0; i<this.metadata['announce-list'][tier].length; i++) {
                            urls.push( this.metadata['announce-list'][tier][i] )
                        }
                    }
                }

                for (var i=0; i<urls.length; i++) {
                    url = urls[i]
                    if (url.toLowerCase().match('^udp')) {
                        tracker = new jstorrent.UDPTracker( {url:url, torrent: this} )
                    } else {
                        tracker = new jstorrent.HTTPTracker( {url:url, torrent: this} )
                    }
                    if (! this.trackers.contains(tracker)) {
                        this.trackers.add( tracker )
                    }
                }
            }
        }
    },
    addTrackerByURL: function(url) {
        if (url.toLowerCase().match('^udp')) {
            tracker = new jstorrent.UDPTracker( {url:url, torrent: this} )
        } else {
            tracker = new jstorrent.HTTPTracker( {url:url, torrent: this} )
        }
        if (! this.trackers.contains(tracker)) {
            this.trackers.add( tracker )
        }
    },
    addPublicTrackers: function() {
        if (this.isPrivate()) { return }
        for (var i=0; i<jstorrent.constants.publicTrackers.length; i++) {
            var url = jstorrent.constants.publicTrackers[i]
            if (url.toLowerCase().match('^udp')) {
                tracker = new jstorrent.UDPTracker( {url:url, torrent: this} )
            } else {
                tracker = new jstorrent.HTTPTracker( {url:url, torrent: this} )
            }
            if (! this.trackers.contains(tracker)) {
                this.trackers.add( tracker )
            }
        }
    },
    start: function(reallyStart, opts) {
        //if (reallyStart === undefined) { return }
        if (this.started || this.starting) { return } // some kind of edge case where starting is true... and everything locked up. hmm
        if (this.isComplete()) {
            this.set('state','complete')
            this.save()
            return
        }
        
        if (this.client.get('numActiveTorrents') >= this.client.app.options.get('active_torrents_limit')) {
            this.set('state','queued')
            this.save()
            return
        }

        this.set('state','starting')
        this.addToActives()
        app.analytics.sendEvent("Torrent", "Start")

        this.starting = true
        this.think_interval = setInterval( _.bind(this.newStateThink, this), this.thinkIntervalTime )
        var storage = this.getStorage()
        if (! storage || ! storage.ready ) {
            this.error('Disk Missing')
            return
        }

        if (this.get('metadata')) {
            this.set('state','loading')
            this.loadMetadata( _.bind(function(result) {
                if (result.error) {
                    this.error(result.error)
                } else {
                    this.readyToStart()
                }
            },this))
        } else {
            // dont do this immediately, because .start() could be called before the constructor had a chance to finish
            _.defer(_.bind(function(){
                this.readyToStart()
            },this))
        }
    },
    readyToStart: function() {
        if (this.autostart === false) {
            return
        }
        if (! this.getStorage().ready) {
            // redundant. checking on .start()
            this.error("Storage not attached. Change your Default Directory in the options.")
            return
        }
        
        
        this.set('state','started')
        this.trigger('started')
        this.set('complete', this.getPercentComplete())
        this.recalculatePieceBlacklist()
        this.started = true
        this.starting = false
        this.save()

        // todo // check if should re-announce, etc etc
        //this.trackers.get_at(4).announce(); 
        //return;

        if (jstorrent.options.always_add_special_peer) {
            for (var i=0; i<jstorrent.options.always_add_special_peer.length; i++) {
                var host = jstorrent.options.always_add_special_peer[i]
                var peer = new jstorrent.Peer({torrent: this, host:host.split(':')[0], port:parseInt(host.split(':')[1])})
                if (! this.swarm.contains(peer)) {
                    this.swarm.add(peer)
                }
            }
        }

        setTimeout( _.bind(function(){
            // HACK delay this a little so manual peers kick in first, before frame
            //this.trigger('started')
        },this), 1000)
        if (jstorrent.options.manual_peer_connect_on_start) {
            var hosts = jstorrent.options.manual_peer_connect_on_start[this.hashhexlower]
            if (hosts) {
                for (var i=0; i<hosts.length; i++) {
                    var host = hosts[i]
                    var peer = new jstorrent.Peer({torrent: this, host:host.split(':')[0], port:parseInt(host.split(':')[1])})
                    if (! this.swarm.contains(peer)) {
                        this.swarm.add(peer)
                    }
                    var peerconn = new jstorrent.PeerConnection({peer:peer})
                    //console.log('should add peer!', idx, peer)
                    if (! this.peers.contains(peerconn)) {
                        this.peers.add( peerconn )
                        //this.set('numpeers',this.peers.items.length)
                        peerconn.connect()
                    }
                }
            }
        }
        this.newStateThink()
    },
    addToActives: function() {
        var a = this.client.get('activeTorrents')
        a[this.hashhexlower] = true
        this.client.activeTorrents.add(this)
        this.client.set('activeTorrents', a)
        this.client.trigger('activeTorrentsChange', this)
    },
    removeFromActives: function() {
        var a = this.client.get('activeTorrents')
        if (this.client.activeTorrents.contains(this)) {
            this.client.activeTorrents.remove(this)
        }
        delete a[this.hashhexlower]
        this.client.set('activeTorrents', a)
        this.client.trigger('activeTorrentsChange', this)
    },
    onStarted: function() {
        app.analytics.sendEvent("Torrent", "onStarted")
        //console.log('torrent.onStarted')

        if (this.getStorage().isGoogleDrive()) {
            app.warnGoogleDrive()
        }

        if (! jstorrent.options.disable_trackers) {
            if (this.trackers.length == 0) {
                // if we start a torrent and there are no trackers, then it has no chance...
                this.addPublicTrackers()
            }
            //app.analytics.sendEvent("Torrent", "Tracker","Announce",this.trackers.length)
            for (var i=0; i<this.trackers.length; i++) {
                this.trackers.get_at(i).announce('started')
            }
        }
        setTimeout( this.afterTrackerAnnounceResponses.bind(this), jstorrent.Tracker.announce_timeout + 1000 )
    },
    forceAnnounce: function() {
        for (var i=0; i<this.trackers.length; i++) {
            this.trackers.get_at(i).announce('started')
        }
    },
    haveNoSeeders: function() {
        if (this.swarm.length == 0) {
            return true
        }

        var countseeds = 0
        for (var i=0; i<this.trackers.items.length; i++) {
            var tracker = this.trackers.items[i]
            if (tracker.get('seeders')) {
                countseeds += tracker.get('seeders')
            }
        }
        if (countseeds == 0) {
            return true
        }

        return false;
    },
    afterTrackerAnnounceResponses: function() {
        // bucketize this
        if (false) {
            var arr = jstorrent.constants.announceSizeBuckets
            var bucket = arr[ bisect_left(arr, this.swarm.length) ]
            var tstr = this.isPrivate() ? 'TrackerPrivate' : 'TrackerPublic'
            if (bucket === undefined) {
                app.analytics.sendEvent("Torrent", tstr,"SwarmSize(>"+arr[arr.length-1]+")")
            } else {
                app.analytics.sendEvent("Torrent", tstr,"SwarmSize(<="+bucket+")")
            }
        }
        // called after all tracker announce responses
        if (! this.isPrivate() && this.haveNoSeeders() && ! jstorrent.options.disable_trackers) {
            //this.error("No peers were received from any trackers. Unable to download. Try a more popular torrent or a different torrent site")
            app.notifyWantToAddPublicTrackers(this)
            //this.addPublicTrackers()
            //this.forceAnnounce()
        }
    },
    onComplete: function() {
        //console.log('torrent.onComplete')
        this.set('downspeed',0)
        this.set('eta',0)

        this.peers.items.forEach( function(peer) {
            if (peer.connected) {
                // TODO make sure piece cache gets cleared out!
                //peer.sendMessage("UNCHOKE")
            }
        })
        this.removeFromActives()

        for (var i=0; i<this.trackers.length; i++) {
            this.trackers.get_at(i).announce('complete')
        }
    },
    onStopped: function() {
        //console.log('torrent.onStopped') // could be previously "complete"
        this.removeFromActives()

        if (this.stopinfo && this.stopinfo.dontannounce) {
            return
        }
        for (var i=0; i<this.trackers.length; i++) {
            this.trackers.get_at(i).announce('stopped')
        }
    },
    maybePropagatePEX: function(data) {
        // TODO -- if private torrent, do not do this
        if (this.isPrivate()) { return false }
        return
        this.peers.each( function(peer) {
            if (peer.connected && peer.peer.host == '127.0.0.1') {
                // definitely send it
                peer.sendPEX(data)
            }
        })
    },
    stop: function(info) {
        this.session_start_time = null
        this.stopinfo = info
        this.starting = false
        this.isEndgame = false
        if (this.get('state') == 'stopped') { return }
        this.trigger('stopped')
        app.analytics.sendEvent("Torrent", "Stopping")
        this.set('state','stopped')
        this.set('downspeed',0)
        this.set('upspeed',0)
        this.set('eta',0)
        this.started = false

        if (this.think_interval) { 
            clearInterval(this.think_interval)
            this.think_interval = null
        }
        // prevent newStateThink from reconnecting us

        this.peers.each( function(peer) {
            // this is not closing all the connections because it modifies .items...
            // need to iterate better...
            peer.close('torrent stopped')
        })

        for (var i=0; i<this.pieces.items.length; i++) {
            this.pieces.items[i].resetData()
        }
        // TODO -- move these into some kind of resetState function?


        // TODO - stop all disk i/o jobs for this torrent...
        if (this.getStorage()) {
            this.getStorage().cancelTorrentJobs(this)
        }

        this.pieces.clear()
        if (app.entryCache) app.entryCache.clearTorrent(this)
        this.unflushedPieceDataSize = 0
        this.save()
    },
    remove: function(callback, opts) {
        var _this = this
        this.stop(opts)
        this.set('state','removing')

        // maybe do some other async stuff? clean socket shutdown? what?

        //this.removeFiles: // TODO need option to remove files from disk
        setTimeout( _.bind(function(){
            this.set('state','stopped')
            // TODO -- clear the entry from storage? nah, just put it in a trash bin
            this.save( function() {
                console.clog(L.TORRENT,'torrent.remove().timeout(200).save(...')
                setTimeout( function() {
                    if (callback) { callback() }
                }, 200)
                _this.client.torrents.remove(_this)
            })
        },this), 200)
    },
    newStateThink: function() {
        this.tickTime = Date.now()
        
        // misnomer, this is actually a regular interval triggered function
        this.thinkCtr = (this.thinkCtr + 1) % 40320

        /* 

           how does piece requesting work? good question...  each peer
           connection calls newStateThink() whenever some state
           changes.

           the trouble is, it makes sense to store information
           regarding requests for piece chunks on the piece
           object. however, the piece object itself has requests to a
           set of peer connections.

           when a peer disconnects, we need to update the state for
           each piece that has data registered for that peer..

           when a piece is complete, we need to notify each peer
           connection that we no longer need their data.

           so really i should think about all the different use cases
           that need to be satisfied and then determine where it makes
           most sense to store the states.

           hmmm.

        */


        /*

          it seems there are three main cases

          - peer disconnect
          - peer chokes us (more nuanced)
          - piece completed

         */

        if (! this.started) { return }
        //console.log('torrent frame!')

        //if (! this.isEndgame && this.get('complete') > 0.97) {  // this works really crappy for large torrents
        if (! this.isEndgame && this.infodict && this.getFirstUnrequestedPiece() === null && ! this.isComplete() && this.canEnterEndgame()) {
            this.isEndgame = true
            console.clog(L.TORRENT,"ENDGAME ON")
        }


        if (this.thinkCtr % 4800 == 0) {
            // every 5 minute
            var storage = this.getStorage()
            if (storage && storage.ready) { storage.diskio.checkStalled() }
        }
        
        if (this.thinkCtr % 80 == 0) {
            // every 20 seconds
            this.updateUnflushedPieceSize()
        }

        if (this.thinkCtr % 40 == 0) {
            // every 10 seconds
            this.maybeSendKeepalives()
        }
        
        if (this.thinkCtr % 4 == 0) {
            // only update these stats every second
            this.calculate_speeds()
        }

        if (this.thinkCtr % 12 == 0) {
            // every 3 seconds see if we wanna drop some conns
            this.maybeDropShittyConnection()
        }

        if (this.thinkCtr % 2 == 0) {
            // add new peers every 1/2 second
            // TODO add more, faster.
            var tries = 0
            var idx, peer, peerconn
            if (this.should_add_peers() && this.swarm.items.length > 0) {
                while (tries < 3) {
                    tries++
                    idx = Math.floor( Math.random() * this.swarm.items.length )
                    peer = this.swarm.get_at(idx)
                    if (peer.get('connectionResult') == 'net::ERR_CONNECTION_REFUSED') {
                        // TODO keep a list of valid peers separate from all peers
                        //console.log('skipping peer that refused connection')
                        continue
                    }
                    peerconn = new jstorrent.PeerConnection({peer:peer})
                    //console.log('should add peer!', idx, peer)
                    if (! this.peers.contains(peerconn)) {
                        if (peer.get('only_connect_once')) { return }
                        this.peers.add( peerconn )
                        //this.set('numpeers',this.peers.items.length)
                        peerconn.connect()
                    }
                }
                // peer.set('only_connect_once',true) // huh?
            }
        }
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
            var bytesRemain = (1-this.get('complete')) * this.size
            this.set('eta', bytesRemain / downSpeed)
        }

        for (var i=0; i<this.peers.items.length; i++) {
            this.peers.items[i].calculate_speeds()
        }
    },
    getMaxConns: function() {
        return this.get('maxconns') || this.client.app.options.get('maxconns')
    },
    getStreamPlayerPageURL: function(filenum, streamable) {
        if (! this.metadata) { return }
        if (this.metadata && ! this.multifile && filenum === undefined) {
            filenum = 0
        }
        if (! this.client.app.webapp) { debugger; return }
        var token = ''
        /*
        var s = 'abcdefghijklmnopqrstuvwxyz'
        for (var i=0; i<20; i++) {
            token += s[Math.floor(Math.random() * s.length)]
        }
        this.client.app.webapp.token = token */
        //var url = 'http://127.0.0.1:' + this.client.app.webapp.port + '/package/gui/media.html?hash=' + this.hashhexlower + '&token=' + token + '&id=' + chrome.runtime.id
        var url = jstorrent.constants.jstorrent_media_url + '#hash=' + encodeURIComponent(this.hashhexlower) + '&id=' + encodeURIComponent(chrome.runtime.id)
        if (token) {
            url += '&token=' + encodeURIComponent(token)
        }
        if (filenum !== undefined) {
            url += '&file=' + encodeURIComponent(filenum)
        }
        if (streamable && streamable.type) {
            url += '&type=' + encodeURIComponent(streamable.type)
        }
        return url
    },
    getProxyURL: function() {
        return 'http://127.0.0.1:' + this.client.app.webapp.port + '/proxy?hash=' + this.hashhexlower
    },
    getShareLink: function() {
        var url = jstorrent.constants.jstorrent_share_base + '/share/#hash=' + this.hashhexlower + '&dn=' + encodeURIComponent(this.get('name')) + '&magnet_uri=' + encodeURIComponent(this.getMagnetLink())
        return url
    },
    getMagnetLink: function() {
        url = 'magnet:?xt=urn:btih:' + this.hashhexlower + '&dn=' + this.get('name') // encode this?
        return url
    },
    should_add_peers: function() {
        if (this.paused) { return }
        if (! navigator.onLine) { return }
        if (this.started) {
            if (this.isComplete()) {
                return false // TODO -- how to seed?
            }

            var maxconns = this.getMaxConns()
            if (this.peers.length < maxconns) {
                return true
            }
        }
    },
    get_key: function() {
        return this.hashhexlower
    }
}

for (var method in jstorrent.Item.prototype) {
    jstorrent.Torrent.prototype[method] = jstorrent.Item.prototype[method]
}
