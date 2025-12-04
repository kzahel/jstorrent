(function() {
    if (! (window.WSC && WSC.BaseHandler && WSC.WebApplication)) { // if web-server-chrome available
        return
    }
    function PackageHandler() {
        this.disk = app.client.packageDisk
        WSC.BaseHandler.prototype.constructor.call(this)
    }
    var PackageHandlerprototype = {
        get: function() {
            var parts = this.request.path.split('/')
            var path = parts.slice(2,parts.length)

            this.disk.diskio.getWholeContents({
                path:path,
                timeout:200,
            }, this.onResult.bind(this))
        },
        onResult: function(evt) {
            if (evt.error) {
                this.write('Error:' + evt.error + ', ' + evt.error.message)
            } else {
                this.write(evt)
            }
        }

    }
    _.extend(PackageHandler.prototype,
             PackageHandlerprototype,
             WSC.BaseHandler.prototype
            )
    jstorrent.PackageHandler = PackageHandler

    function StreamHandler() {
        this.fileNum = null
        this.torrent = null
        this.file = null
        this.fileOffset = null
        this.bodyWritten = 0
        this.rangeStart = null
        this.rangeEnd = null
        //this.chunkSz = Math.pow(2,21) // read up to two meg at a time
        this.chunkSz = Math.pow(2,19) // read up to half meg at a time GOOD tradeoff
        //this.chunkSz = 666666 // random size for testing
        this.responseLength = null

        WSC.BaseHandler.prototype.constructor.call(this)
    }
    var StreamHandlerprototype = {
        get: function() {
            this.setHeader('accept-ranges','bytes')
            this.setHeader('connection','keep-alive')
            var hash = this.request.arguments['hash']
            var file = this.request.arguments['file']
            if (hash && file) {
                var torrent = app.client.torrents.get(hash.toLowerCase())
                this.fileNum = parseInt(file)
                this.torrent = torrent
                if (torrent && typeof this.fileNum == 'number') {
                    app.analytics.sendEvent('Torrent','Stream','WantStart')
                    //console.log('got torrent and file...')
                    this.torrent.ensureLoaded( this.torrentLoaded.bind(this) )
                    return
                }
            }
            this.write('unable to handle request')
        },
        torrentLoaded: function(result) {
            if (result.error) {
                this.write(result.error)
            } else {
                //console.log('torrent loaded...')
                this.file = this.torrent.getFile(this.fileNum)
                if (! this.file) {
                    this.write('unable to get file')
                } else {
                    this.fileReady()
                }
            }
        },
        onWriteBufferEmpty: function() {
            if (this.bodyWritten >= this.responseLength) {
                this.request.connection.stream.onWriteBufferEmpty = null
                this.finish()
                console.log('streamhandler.onwritebufferempty.request finished!')
                return
            } else {
                if (this.request.connection.stream.remoteclosed) {
                    this.request.connection.close()
                    // still read?
                } else if (! this.request.connection.stream.closed) {
                    this.doReadChunk()
                }
            }
        },
        doReadChunk: function() {
            // this gets called any time we have new data
            var fileOffset = this.rangeStart + this.bodyWritten
            console.assert(this.bodyWritten < this.responseLength) // XXX why is this happening
            // check if window is completely filled, and in that case delete the bridge

            // also it seems to keep writing streaming data even when we close the connection?

            // torrent bytes range
            var havedata = this.torrent.haveAnyDataAt(this.file.startByte + fileOffset)
            if (havedata) {
                var window = this.torrent.getCompleteDataWindow(this.file.startByte + fileOffset, 
                                                                this.file.startByte + this.rangeEnd)

                // CHECK IF ENTIRE WINDOW IS FULL, and delete a bridge if any
                if (this.file.startByte + fileOffset == window[0] &&
                    this.file.startByte + this.rangeEnd == window[1] &&
                    this.bridge) {
                    this.bridge.notneeded()
                    this.bridge = null
                    // no longer need this bridge!
                }

                //console.log('complete data window for this file:',window)

                var bytesToRead = Math.min(window[1] - window[0] + 1,
                                           this.chunkSz
                                          )
                console.assert(bytesToRead > 0)
                //console.log('readbytes',this.fileOffset, this.fileOffset + bytesToRead - 1)
                console.assert(this.file.startByte + fileOffset + bytesToRead <= this.torrent.size) // confirmed <=
                this.file.readBytes(fileOffset, bytesToRead, this.onReadChunk.bind(this), {priority:'high'})
            } else {
                //console.log('dont have data at',this.file.startByte + fileOffset)
                //console.log('streamhandler.await')
                if (! this.bridge) {
                    app.analytics.sendEvent('Torrent','Stream','NewBridge')
                    var rangeRequest = [this.file.startByte + fileOffset,
                                        this.rangeEnd]
                    // initialize the bridge for the first time
                    //console.log('creating bridge')
                    this.bridge = this.file.torrent.registerRangeRequest(rangeRequest, this)
                    //console.assert(! this.request.connection.stream.onclose) // why are we asserting this?

                    this.request.connection.stream.onclose = this.bridge.onhandlerclose.bind(this.bridge)
                    this.bridge.ondata = this.doReadChunk.bind(this)
                }
            }
        },
        beforefinish: function() {
            console.log('streamhandler.beforefinish()')
            if (this.bridge) { 
                this.bridge.requestfinished()
            }
        },
        onReadChunk: function(result) {
            if (result.error) {
                console.error('error reading',result)
                this.request.connection.close()
            } else {
                this.bodyWritten += result.byteLength
                this.fileOffset += result.byteLength
                //console.log('readChunk -- writing at',this.fileOffset)
                console.log('streamhandler.writeChunk')
                //console.log(this.bodyWritten, this.fileOffset)
                if (! this.request.connection.closed) {
                    this.request.connection.write(result)
                } else {
                    console.warn('no write more chunk, conn closed')
                }
            }
        },
        parseRange: function() {
            this.request.connection.stream.onWriteBufferEmpty = this.onWriteBufferEmpty.bind(this)
            console.log(this.request.connection.stream.sockId,'RANGE',this.request.headers['range'])
            if (this.request.headers['range']) {
                var range = this.request.headers['range'].split('=')[1].trim()
                var rparts = range.split('-')
                if (! rparts[1]) {
                    this.rangeStart = parseInt(rparts[0])
                    this.rangeEnd = this.file.size - 1
                    this.responseLength = this.file.size - this.rangeStart;
                    this.setHeader('content-range','bytes '+this.rangeStart+'-'+(this.file.size-1)+'/'+this.file.size)
                    if (this.rangeStart == 0) {
                        this.writeHeaders(200)
                    } else {
                        this.writeHeaders(206)
                    }
                } else {
                    this.rangeStart = parseInt(rparts[0])
                    this.rangeEnd = parseInt(rparts[1],10)
                    console.assert(this.rangeEnd.toString() == rparts[1])

                    this.responseLength = this.rangeEnd - this.rangeStart + 1
                    this.setHeader('content-range','bytes '+this.rangeStart+'-'+(this.file.size-1)+'/'+this.file.size)    
                    this.writeHeaders(206)
                }
            } else {
                this.rangeStart = 0
                this.rangeEnd = this.file.size - 1
                this.responseLength = this.file.size
                this.writeHeaders(200)
            }
            this.fileOffset = this.rangeStart

        },
        setMimeType: function() {
            var p = this.file.get('name').split('.')
            if (p.length > 1 && ! this.isDirectoryListing) {
                var ext = p[p.length-1].toLowerCase()
                var type = WSC.MIMETYPES[ext]
                if (type) {
                    this.setHeader('content-type',type)
                }
            }
        },
        fileReady: function() {
            app.analytics.sendEvent('Torrent','Stream','Starting')
            if (! this.file.isComplete()) {
                this.file.torrent.start(undefined,{reason:'streaming'}) // start it ahead of time
            }

            //console.log('file ready...')
            //this.write('have file!' + JSON.stringify(this.file._attributes))
            this.setMimeType()
            this.parseRange()
        }
    }
    _.extend(StreamHandler.prototype,
             StreamHandlerprototype,
             WSC.BaseHandler.prototype
            )
    jstorrent.StreamHandler = StreamHandler




    function FavIconHandler() {
        this.disk = app.client.packageDisk
        WSC.BaseHandler.prototype.constructor.call(this)
    }
    var FavIconHandlerprototype = {
        get: function() {
            this.disk.diskio.getWholeContents({
                path:['favicon.ico']
            }, this.onResult.bind(this))
        },
        onResult: function(evt) {
            if (evt.error) {
                this.write('disk access error, perhaps restart JSTorrent')
            } else {
                this.write(evt)
            }
        }
    }
    _.extend(FavIconHandler.prototype,
             FavIconHandlerprototype,
             WSC.BaseHandler.prototype
            )
    jstorrent.FavIconHandler = FavIconHandler

    function WebHandler() {
        WSC.BaseHandler.prototype.constructor.call(this)
    }

    var WebHandlerprototype = {
        get: function() {
            console.log("GET",this.request.path)
            if (this.request.path == '') {
                this.renderDisks()
            } else {
                var parts = this.request.path.split('/')
                if (parts.length > 2 && parts[1] == 'disks') {
                    var diskId = parts[2]
                    var disk = app.client.disks.get(diskId)

                    if (disk) {
                        if (parts.length == 3) {
                            this.renderDisk(disk)
                        } else if (parts[2].length > 0) {
                            this.write('serve file: '+parts.slice(3,parts.length).join('/'))
                            console.log("SERVE FILE:",parts.slice(3,parts.length))
                        }
                    } else {
                        this.write('disk not found')
                    }
                } else {
                    this.write('invalid url')
                }
            }
            this.finish()
        },
        renderDisk: function(disk) {
            this.entry = disk.entry
            var reader = this.entry.createReader()

            function onreaderr(evt) {
                entryCache.unset(this.entry.filesystem.name + this.entry.fullPath)
                console.error('error reading dir',evt)
                this.request.connection.close()
            }
            console.log('readentries')
            reader.readEntries( function(results) {
                this.renderDirectoryListing(results)
            }.bind(this), onreaderr.bind(this))

        },
        renderDirectoryListing: function(results) {
            var html = ['<html>']
            html.push('<style>li.directory {background:#aab}</style>')
            html.push('<a href="..">parent</a>')
            html.push('<ul>')

            for (var i=0; i<results.length; i++) {
                if (results[i].isDirectory) {
                    html.push('<li class="directory"><a href="' + results[i].name + '/">' + results[i].name + '</a></li>')
                } else {
                    html.push('<li><a href="' + results[i].name + '">' + results[i].name + '</a></li>')
                }
            }
            html.push('</ul></html>')
            this.write(html.join('\n'))
        },
        renderDisks: function() {
            var out = ["<html><body><ul>"]
            var disks = app.client.disks.items
            for (var i=0; i<disks.length; i++) {
                var disk = app.client.disks.get_at(i)
                out.push('<li><a href="/disks/'+encodeURI(disk.key)+'/">'+_.escape(disk.get('entrydisplaypath'))+'</a>')
            }
            out.push("</ul></body></html>")
            this.write(out.join('\n'))
        }
    }

    _.extend(WebHandler.prototype,
             WebHandlerprototype,
             WSC.BaseHandler.prototype
            )


    jstorrent.WebHandler = WebHandler
})()
