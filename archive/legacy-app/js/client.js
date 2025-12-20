// torrent client !

function Client(opts) {
    jstorrent.Item.apply(this, arguments)
    /* 
       initializing the client does several async things
       - fetch several local storage items)
       - calls retainEntry for each disk

       want a callback for when all that is done
    */

    this.ready = false
    this.app = opts.app
    this.id = opts.id

    this.activeTorrents = new jstorrent.Collection({__name__: 'Torrents', 
                                                    parent:this, 
                                                    client:this, 
                                                    shouldPersist: false,
                                                    itemClass: jstorrent.Torrent})

    this.torrents = new jstorrent.Collection({__name__: 'Torrents', 
                                              parent:this, 
                                              client:this, 
                                              shouldPersist: true,
                                              itemClass: jstorrent.Torrent})
    this.torrents.on('add', _.bind(this.onTorrentAdd, this))

    this.rings = { sent: new jstorrent.RingBuffer(8),
                   received: new jstorrent.RingBuffer(8) }

    this.packageEntry = null
    this.packageDisk = null
    if (chrome.runtime.getPackageDirectoryEntry) {
        chrome.runtime.getPackageDirectoryEntry( function(entry) { 
            this.packageEntry = entry
            this.packageDisk = new jstorrent.Disk({entry:entry, 
                                                   client:this,
                                                  })
            this.packageDisk.key = 'package'
        }.bind(this) )
    }

    this.disks = new jstorrent.Collection({__name__: 'Disks', 
                                           parent:this, 
                                           client:this, 
                                           shouldPersist: true,
                                           itemClass: jstorrent.Disk})
    this.disks.numLoaded = 0
    this.set('activeTorrents',{})
    this.set('numActiveTorrents',0)
    this.set('bytes_sent',0) // todo - persist these?
    this.set('bytes_received',0)
    this.on('change', _.bind(this.onChange, this))
    this.on('activeTorrentsChange', this.onActiveTorrentsChange.bind(this))

    var _loadedTorrents = false
    var loadTorrents =  function() {
        if (! _loadedTorrents) {
            this.torrents.fetch(_.bind(function() {
                this.ready = true
                this.trigger('ready')
            },this))
            _loadedTorrents = true
        }
    }.bind(this)

    var onDiskReady = function() {
        this.disks.numLoaded++
        console.clog(L.INIT,'onDiskReady',this.disks.numLoaded, this.disks.length)
        if (this.disks.numLoaded == this.disks.length) {
            loadTorrents()
        }
    }.bind(this)

    if (jstorrent.device.platform == 'Chrome') {
        this.disks.on('ready', onDiskReady)
        this.disks.on('error', onDiskReady)
        this.disks.fetch(_.bind(function() {
            if (this.disks.items.length == 0) {
                console.log('disks length == 0')
                this.app.notifyNeedDownloadDirectory()
                loadTorrents()
            }
            // XXX - install a timeout ??
        },this))
    } else {
        // probably need to guard behind document.addEventListener('deviceready', callback, false)
        // phonegap/cordova port, we use HTML5 filesystem since it is not sandboxed :-)
        var disk = new jstorrent.Disk({key:'HTML5:persistent', client:this})
        this.disks.add(disk)

        this.disks.on('ready',_.bind(function(){
            onDiskReady()
        },this))
    }

    // workerthread is used for SHA1 hashing data chunks so that it
    // doesn't cause the UI to be laggy. If UI is already in its own
    // thread, we probably still want to do this anyway, because it is
    // more paralellizable (though it is causing lots of ArrayBuffer
    // copies... hmm). Perhaps do some performance tests on this.
    this.workerthread = new jstorrent.WorkerThread({client:this});

    this.setPeerIdBytes()

    this.on('error', _.bind(this.onError, this))
    this.on('ready', _.bind(this.onReady, this))

    this.ports = {}
    this.portCtr = 0
}

Client.prototype = {
    onActiveTorrentsChange: function() {
        // a torrent stopped, completed, or started... (or settings changed)
        var numactive = _.keys(this.get('activeTorrents')).length
        this.set('numActiveTorrents', numactive)
        if (numactive < this.app.options.get('active_torrents_limit')) {
            this.tryStartQueuedTorrent()
        }
    },
    tryStartQueuedTorrent: function() {
        for (var i=0; i<this.torrents.items.length; i++) {
            var t = this.torrents.items[i]
            if (t.get('state') == 'queued') {
                t.start()
                break
            }
        }
    },
    countBytes: function(type, val) {
        var k = 'bytes_' + type
        this.set(k, this.get(k) + val)
    },
    notifyPiecePersisted: function(piece) {
        var portinfo 
        for (var key in this.ports) {
            portinfo = this.ports[key]
            var file = portinfo.file
            if (portinfo.torrenthash == piece.torrent.hashhexlower) {
                // make sure to only send this to ports with the correct torrent

                if (portinfo.file.intersectsPiece(piece)) {
                    portinfo.port.postMessage({
                        type:'newfilerange',
                        hash:file.torrent.hashhexlower,
                        file:file._attributes,
                        newfilerange:[
                            piece.startByte - file.startByte,
                            piece.endByte - file.startByte
                        ]
                    })
                }
            }
        }
    },
    handleExternalMessage: function(msg,port) {
        // todo -- validate token
        //console.log('handle external message',msg,msg.command,'with token',msg.token)
        var portId = this.portCtr++

        if (msg.command == 'requestfileinfo') {
            var torrent = this.torrents.get(msg.hash)
            torrent.ensureLoaded( function(result) {
                if (result.error) {
                    port.postMessage(result)
                    return
                }
                var file = torrent.getFile(parseInt(msg.file))

                this.ports[portId] = { port: port,
                                       torrenthash: file.torrent.hashhexlower,
                                       file: file }
                port.onDisconnect.addListener( _.bind(function(portId,evt) {
                    delete this.ports[portId]
                },this,portId) )

                data = {
                    type:msg.command,
                    torrent:torrent._attributes,
                    fileranges:file.getCompleteRanges(),
                    file:file._attributes}
                port.postMessage(data)
            }.bind(this))
        } else if (msg.type == "playerevent") {
            app.analytics.sendEvent("Player","Event",msg.event)
        } else {
            console.warn('unhandled message', msg)
        }
    },
    setPeerIdBytes: function(spoofing) {
        this.peeridbytes = []
        this.peeridbytes_spoof = []

        this.peeridbytes_spoof = _.map('-UT3320-'.split(''), function(v){return v.charCodeAt(0)})

        var verstr = chrome.runtime.getManifest().version.split('.').join('')
        if (verstr.length < 4) {
            verstr = verstr + '0'
        }
        this.version = chrome.runtime.getManifest().version
        this.verstr = verstr
        console.assert(verstr.length == 4)
        var beginstr = '-JS' + verstr + '-'
        this.peeridbytes_begin = beginstr
        this.peeridbytes = _.map(beginstr.split(''), function(v){return v.charCodeAt(0)})
        
        for (var i=this.peeridbytes.length; i<20; i++) {
            var val = Math.floor(Math.random() * 256)
            this.peeridbytes.push( val )
            this.peeridbytes_spoof.push( val )
        }
    },
    getUserAgent: function() {
        return 'JSTorrent/' + this.verstr
    },
    onChange: function(item,newval,oldval,attr) { 
        if (attr == 'numActiveTorrents') {

            if (this.app.options.get('prevent_sleep')) {
                console.clog(L.POWER,'number of active torrents now', newval)
                if (newval == 0) {
                    this.set('downspeed',0)
                    this.set('upspeed',0)
                    if (this.thinkInterval) {
                        clearInterval(this.thinkInterval)
                        this.thinkInterval = null
                    }
                    console.clog(L.POWER,'release keep awake')
                    chrome.power.releaseKeepAwake()
                } else if (newval > 0 && oldval == 0) {
                    if (! this.thinkInterval) {
                        this.thinkInterval = setInterval( _.bind(this.frame,this), 1000 )
                    }
                    console.clog(L.POWER,'requesting system keep awake')
                    chrome.power.requestKeepAwake('system')
                }
            }
        }
        // console.log('client change',newval,attr) 
    },
    onBatchTimeout: function(keys) {
        // TODO -- implement
        console.log('onBatchTimeout',keys)
    },
    onTorrentAdd: function(torrent) {
        if (torrent._opts.initializedBy != 'collection.fetch') {
            console.clog(L.TORRENT, 'Torrent added',torrent)
        }
        // cant do this, because metadata has not been saved yet... (when loading torrent from launch entry)
        if (torrent.autostart === false) { return }

        if (torrent._opts.initializedBy != 'collection.fetch') {
            if (this.app.options.get('new_torrents_auto_start')) {
                torrent.start()
            }
            torrent.session_start_time = Date.now()
        }
    },
    onReady: function() {
        var item
        if (window.jstorrent_launchData) {
            while (true) {
                item = window.jstorrent_launchData.pop()
                if (! item) { break }
                this.handleLaunchData(item)
            }
        }
    },
    handleLaunchData: function(launchData) {
        if (! this.app.canDownload()) {
            this.app.notifyNoDownloadsLeft()
            return
        }

        var item
        //console.log('handle launch data',launchData)
        if (launchData.type == 'onMessageExternal') {
            app.analytics.sendEvent('launchData','onMessageExternal')
            // track website it came from
            var request = launchData.request
            this.add_from_url(request.url, null, {pageUrl:request.pageUrl})
        } else if (launchData.type == 'onLaunched') {
            if (launchData.launchData && launchData.launchData.items && launchData.launchData.items.length > 0) {
                for (var i=0; i<launchData.launchData.items.length; i++) {
                    item = launchData.launchData.items[i]
                    console.log('APP HANDLE LAUNCH ENTRY',item)
                    this.handleLaunchWithItem(item)
                }
            }
        } else if (launchData.type == 'drop') {
            this.handleLaunchWithItem(item)
        } else if (launchData.type == 'debugger') {
            
        } else {
            debugger
        }
    },
    addTorrentFromEntry: function(entry, callback) {
        // XXX - this is not saving the torrent file to the downloads directory, so on next load, it cannot load the metadata
        if (callback === undefined) { callback = function(){} }
        var t = new jstorrent.Torrent({entry:entry,
                                       itemClass:jstorrent.Torrent,
                                       parent:this.torrents,
                                       attributes: {added: new Date()},
                                       callback: _.bind(function(result) {
                                           if (result.torrent) {
                                               if (! this.torrents.containsKey(result.torrent.hashhexlower)) {
                                                   result.torrent.saveMetadata( function() {
                                                       this.torrents.add(result.torrent)
                                                       this.app.highlightTorrent(result.torrent.hashhexlower)
                                                       result.torrent.save()
                                                       this.torrents.save()
                                                       callback()
                                                   }.bind(this))
                                               } else {
                                                   this.app.highlightTorrent(result.torrent.hashhexlower)
                                                   this.trigger('error','already had this torrent',result.torrent.hashhexlower)
                                                   callback()
                                               }
                                           } else {
                                               // bdecode error
                                               this.trigger('error',result)
                                               callback()
                                           }
                                       },this)
                                      })
    },
    handleLaunchWithItem: function(item) {
        var entry = item.entry
        if (item.type == "application/x-bittorrent") { // item.type is sometimes octet-stream, so look at file extension, too.
            console.log('have a bittorrent file... do handleLaunchWithItem',entry)
            this.addTorrentFromEntry(entry)
        } else if (entry.name.toLowerCase().endsWith('.torrent')) {
            console.log('have a .torrent file... do handleLaunchWithItem',entry)
            this.addTorrentFromEntry(entry)
        }
    },
    error: function(msg) {
        this.trigger('error',msg)
    },
    onError: function(e, msg) {
        console.error('client error',e, msg)
        //this.app.createNotification(e)
        // app binds to our error and shows notification
    },
    set_ui: function(ui) {
        this.ui = ui
    },
    add_from_url_response: function(callback, opts, data) {
        if (data.torrent) {
            if (! this.torrents.containsKey(data.torrent.hashhexlower)) {
                this.torrents.add( data.torrent )
                this.app.highlightTorrent(data.torrent.hashhexlower)
                if (opts && opts.pageUrl) {
                    data.torrent.set('sourcePageUrl',opts.pageUrl)
                }
                this.torrents.save()
                if (callback) { callback(data) }
            }
        } else {
            app.notify('Invalid torrent file. Try a different URL')
            console.error('add url response',data)
        }
    },
    add_from_id: function(id, cb, opts) {
        var torrentopts = {id:id,
                           itemClass: jstorrent.Torrent,
                           attributes:{added:new Date()},
                           callback: _.bind(this.add_from_id_response,this,cb,opts),
                           parent:this.torrents}
        console.log('client add by id',id)
        var torrent = new jstorrent.Torrent(torrentopts)
        this.torrents.add( torrent )
        this.torrents.save()
    },
    add_from_id_response: function(cb,opts,result) {
        console.log('add from id response',result)
        if (cb) {
            cb(result)
        }
    },
    add_from_url: function(url, cb, opts) {
        // adds a torrent from a text input url
        app.analytics.sendEvent("Torrent", "Add", "URL")
        // parse url
        console.clog(L.APP,'client add by url',url)

        // valid url?
        var torrent = new jstorrent.Torrent({url:url,
                                             itemClass: jstorrent.Torrent,
                                             attributes:{added:new Date()},
                                             callback: _.bind(this.add_from_url_response,this,cb,opts),
                                             parent:this.torrents})

        if (torrent.invalid) {
            app.notify('torrent url invalid');
            if (cb) { cb({error:'torrent url invalid'}) }
        } else if (! torrent.magnet_info) {
            //app.notify("Downloading Torrent...")
            // this is the async thingie, downloading the torrent
        } else if (this.torrents.contains(torrent)) {
            console.warn('already have this torrent!')
            this.app.highlightTorrent(torrent.hashhexlower)
            // we already had this torrent, maybe add the trackers to it...
        } else {
            debugger
            this.torrents.add( torrent )
            this.torrents.save()
            //torrent.save()
        }
    },
    frame: function() {
        // TODO -- only do a frame when there is at least one started torrent

        // triggered every second

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

    }
}

jstorrent.Client = Client

for (var method in jstorrent.Item.prototype) {
    jstorrent.Client.prototype[method] = jstorrent.Item.prototype[method]
}
