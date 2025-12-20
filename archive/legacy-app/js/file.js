function File(opts) {
    jstorrent.Item.apply(this, arguments)
    console.assert(typeof opts.num == 'number')
    this.torrent = opts.torrent
    this.num = opts.num

    if (this.torrent.multifile) {
        // should we prepend torrent name? Yes.
        var path = [this.torrent.get('name')].concat( this.torrent.infodict.files[this.num].path )
        this.path = path
        this.name = path[path.length-1]

        if (this.num == this.torrent.numFiles - 1) {
            this.size = this.torrent.size - this.torrent.fileOffsets[this.num]
        } else {
            this.size = this.torrent.fileOffsets[this.num+1] - this.torrent.fileOffsets[this.num]
        }
    } else {
        this.path = [this.torrent.infodict.name]
        this.name = this.torrent.infodict.name
        this.size = this.torrent.size
    }
    console.assert(!isNaN(this.size) && typeof this.size == 'number')

    this.startByte = this.torrent.fileOffsets[this.num]
    if (this.num == this.torrent.numFiles - 1) {
        this.endByte = this.torrent.size - 1
    } else {
        this.endByte = this.torrent.fileOffsets[this.num + 1] - 1
    }

    this.set('downloaded',this.getDownloaded()) // not zero! need to get our spanning pieces and add up the components...
    this.set('complete',this.get('downloaded')/this.size)
    this.set('priority',this.getPriority())
    this.set('leftPiece', Math.floor(this.startByte / this.torrent.pieceLength))
    this.set('rightPiece', Math.ceil(this.endByte / this.torrent.pieceLength))
    this.set('name',this.name)
    this.set('size',this.size)
    this.set('path',this.path.join('/'))

    this.on('complete', _.bind(this.onComplete,this))
    
    //this.on('change', _.bind(this.priorityChanged,this)) // NO, we use contextmenu now
}
File.getStoragePath = function(torrent) {
    if (torrent.multifile) {
        return torrent.get('name')
    } else {
        return torrent.infodict.name
    }
}
jstorrent.File = File
File.prototype = {
    openBlobInTab: function() {
        // show warning for xvid, wmv, etc
        this.getEntryFile2(function(file) {
            if (! file || file.error) {
                app.createNotification({message:"Could not open file",
                                        contextMessage:(file && file.error),
                                        details:this.get('name')})
                return
            }
            if (! this.streamable()) {
                var url = (window.URL || window.webkitURL).createObjectURL(file)
                var msg = {command:'openWindow',url:url}
                chrome.runtime.sendMessage(msg)
                return
            }
            chrome.mediaGalleries.getMetadata( file, {}, function(metadata) {
                // we lose window.onerror handling here
                console.log('got file media metadata',metadata)
                if (metadata.mimeType.startsWith('video') && metadata.rawTags.length == 0) {
                    // show error, this wont work
                    app.createNotification({message:"Chrome can't play this \"" + this.get_extension() + "\" file.",
                                            details:"Look instead for mp4 files with x264 encoding"})
                } else {
                    app.createNotification({message:chrome.i18n.getMessage("PlayFileWarningTitle"),
                                            id:'play-file-warning',
                                            details:chrome.i18n.getMessage("PlayFileWarningDetails")})

                    var url = (window.URL || window.webkitURL).createObjectURL(file)
                    var msg = {command:'openWindow',url:url}
                    chrome.runtime.sendMessage(msg)
                }
            }.bind(this))
        }.bind(this))
    },
    onComplete: function() {
        console.log('file complete event',this)
        var UI = this.torrent.client.app.UI
        if (UI.detailtype == 'files' && UI.detailtable) {
            UI.detailtable.on_change(this,null,null,'Action') // update action on this
        }
        reportFileDownload(this)
        //this.trigger('change','actions')
    },
    intersectsPiece: function(piece) {
        var intersection = intersect(piece.startByte,
                                     piece.endByte,
                                     this.startByte,
                                     this.endByte)
        return intersection
    },
    getCompleteRanges: function() {
        // returns all the filled in ranges for this file.
        var intervals = []
        var infos = this.getSpanningPiecesInfo()

        var start = null
        var end = null

        for (var i=0; i<infos.length; i++) {
            var info = infos[i]
            if (this.torrent._attributes.bitfield[info.pieceNum]) {
                if (start === null) {
                    start = info.fileOffset
                }
                end = info.fileOffset + this.torrent.getPieceSize(info.pieceNum) - 1
            } else {
                // piece is dead, and we had market a beginning
                if (start !== null) {
                    intervals.push( [start, end] )
                    start = null
                    end = null
                }
            }
        }
        if (start !== null && end !== null) {
            intervals.push( [start, end ] )
        }
        return intervals
    },
    isComplete: function() {
        return this.get('complete') == 1
    },
    priorityChanged: function(file,newVal,oldVal,attrName) {
        if (oldVal === undefined) { oldVal = 1 } // default value is "1" - Normal priority
        if (attrName != 'priority') { return }
        var priority
        if (newVal == 'Skip') {
            priority = 0
        } else {
            priority = 1
        }
        this.torrent.setFilePriority(this.num,priority,oldVal)
    },
    get_extension: function() {
        var i = this.name.lastIndexOf('.')
        if (i == -1) {
            return ''
        } else {
            return this.name.slice(i+1,this.name.length).toLowerCase()
        }
    },
    shouldfindapps: function() {
        var ext = this.get_extension()
        if (_.contains(['epub'], ext)) {
            return true
        }
    },
    streamable: function() {
        var ext = this.name.toLowerCase()
        if (window.WSC && WSC.MIMECATEGORIES) {
            for (var i=0; i<WSC.MIMECATEGORIES.video.length; i++) {
                if (ext.endsWith('.' + WSC.MIMECATEGORIES.video[i]) ) {
                    return {type:'video'}
                }
            }
            for (var i=0; i<WSC.MIMECATEGORIES.audio.length; i++) {
                if (ext.endsWith('.' + WSC.MIMECATEGORIES.audio[i])) {
                    return {type:'audio'}
                }
            }
        } else {
            return ext.endsWith('.mp4') ||
                ext.endsWith('.mp3') ||
                ext.endsWith('.mkv') ||
                ext.endsWith('.mov') ||
                ext.endsWith('.m4v')
        }
    },
    openable: function() {
        var ext = this.name.toLowerCase()
            return ext.endsWith('.jpeg') ||
                ext.endsWith('.jpg') ||
                ext.endsWith('.pdf') ||
                ext.endsWith('.txt') ||
                ext.endsWith('.png')
    },
    readBytes: function(start, size, callback, opts) {
        var storage = this.torrent.getStorage()
        if (! storage.ready) { callback({error:'disk missing'}); return }
        console.assert(size > 0)
        storage.diskio.getContentRange({file:this,
                                        fileNum:this.num,
                                        fileOffset:start,
                                        size:size,
                                        torrent:this.torrent.hashhexlower
                                       },
                                       callback, opts)
    },
    getSpanningPiecesInfo: function(startByte, endByte) { // similar to piece.getSpanningFilesInfo
        if (startByte === undefined) { startByte = this.startByte }
        if (endByte === undefined) { endByte = this.endByte }

        var leftPiece = Math.floor(startByte / this.torrent.pieceLength)
        var rightPiece = Math.min(Math.floor(endByte / this.torrent.pieceLength), // XXX changed from ceil to floor
                                  this.torrent.numPieces - 1)

        var allInfos = []
        var curInfos

        var curPiece
        for (var i=leftPiece; i<=rightPiece; i++) {
            //curPiece = this.torrent.getPiece(i)
            // also takes piece offset and piece size parameters
            var fileOffset = startByte
            var fileSize = endByte - startByte + 1
            // XXX no way to pass in exact ranges and get offsets etc
            curInfos = jstorrent.Piece.getSpanningFilesInfo(this.torrent, i, this.torrent.getPieceSize(i))
            console.assert(curInfos.length > 0)

            for (var j=0; j<curInfos.length; j++) {
                if (curInfos[j].fileNum == this.num) {
                    curInfos[j].pieceNum = i
                    allInfos.push(curInfos[j])
                }
            }
        }
        return allInfos
    },
    getPriority: function() {
        var arr = this.torrent.get('filePriority')
        if (! arr) {
            return 1
        } else {
            return arr[this.num]
        }
    },
    getDownloaded: function() {
        var pieceSpans = this.getSpanningPiecesInfo()
        var pieceSpan
        var downloaded = 0
        for (var i=0; i<pieceSpans.length; i++) {
            pieceSpan = pieceSpans[i]
            if (this.torrent._attributes.bitfield[pieceSpan.pieceNum]) {
                downloaded += pieceSpan.size
            }
        }
        return downloaded
    },
    get_key: function() {
        return this.num
    },
    getCachedData: function(offset, size) {
        // if data is in piece cache, return it
        var pieceinfos = this.getSpanningPiecesInfo(this.startByte + offset, this.startByte + offset + size - 1)
        console.assert(pieceinfos.length > 0)

        var haveAllCached = true
        for (var i=0; i<pieceinfos.length; i++) {
            var cacheData = this.torrent.pieceCache.get(pieceinfos[i].pieceNum)
            if (! cacheData) {
                haveAllCached = false
                break
            }
        }
        
        if (haveAllCached) {
            var szLeft = size
            var consumed = 0

            var toret = new Uint8Array(size)

            for (var i=0; i<pieceinfos.length; i++) {
                var pieceinfo = pieceinfos[i]
                if (i == 0) {
                    var a = offset - pieceinfo.fileOffset
                } else {
                    var a = 0
                }
                var curSz = Math.min( pieceinfo.size - a,
                                      szLeft )
                var b = a + curSz
                var cacheData = this.torrent.pieceCache.get(pieceinfo.pieceNum).data
                console.assert(a >= 0)
                console.assert(b <= cacheData.byteLength)
                szLeft -= curSz
                var buf = cacheData.slice(a,b)
                toret.set( buf, consumed)
                consumed += curSz
            }
            return toret.buffer
        }

    },
    getCachedEntry: function() {
        return this.torrent.client.app.entryCache.getByFile(this)
    },
    getCachedMetadata: function() {
        return this.torrent.client.app.fileMetadataCache.getByFile(this)
    },
    getEntryFile2: function(callback) {
        this.getEntry( function(entry) {
            if (entry.error) {
                callback(entry)
            } else {
                function onfile(file) {
                    callback(file)
                }
                entry.file( onfile, onfile )
            }
        }.bind(this), {create:false} )
    },
    getEntryFile: function(callback) {
        console.assert(false) // dont call this
        // XXX -- cache this for read events and have it get wiped out after a write event
        var fd = {}
        var filesystem = this.torrent.getStorage().entry
        var path = this.path.slice()
        recursiveGetEntry(filesystem, path, function(entry) {
            fd.metadata = { fullPath:entry.fullPath,
                            name:entry.name }
            entry.file( function(f) {
                //console.log('collected file',fileNum,f)
                fd.metadata.lastModifiedDate = f.lastModifiedDate
                fd.metadata.size = f.size
                fd.metadata.type = f.type
                fd.file = f
                callback(fd)
            })
        })
        
    },
    getStreamURL: function() {
        return 'http://127.0.0.1:' + this.torrent.client.app.webapp.port + '/stream' + '?hash=' + this.torrent.hashhexlower + '&file=' + this.num
    },
    getBlobURL: function(callback) {
        this.getEntry( function(entry) {
            if (entry.error) {
                this.torrent.error("File Missing: " + this.name)
                callback(entry)
            } else {
                chrome.runtime.getBackgroundPage( function(bg) {
                    bg.getBlobURL(entry, callback)
                })
            }
        })
    },
    getPlayableSRCForVideo: function(callback) {
        this.getEntry( function(entry) {
            if (entry.error) {
                this.torrent.error("File Missing: " + this.name)
                callback(entry)
                return
            }
            function onfile(file) {
                console.log('playable file',file)
                var url = (window.URL || window.webkitURL).createObjectURL(file)
                callback(url)
            }
            entry.file(onfile)
        }.bind(this), {create:false})
    },
    getPlayerURL: function() {
        // this version uses window.open to open a chrome-extension:// URL
        var url = 'gui/play.html#hash=' + this.torrent.hashhexlower
        url += '&file=' + this.num
        return url
    },
    getEntry: function(callback, opts) {
        // XXX this is not calling callback in some cases!
        // gets file entry, recursively creating directories as needed...
        var storage = this.torrent.getStorage()
        if (storage.ready) { 
            var filesystem = storage.entry
            var path = this.path.slice()
            recursiveGetEntry(filesystem, path, callback, opts)
        } else {
            callback({error:'disk missing'})
        }
    }
}
for (var method in jstorrent.Item.prototype) {
    jstorrent.File.prototype[method] = jstorrent.Item.prototype[method]
}

function recursiveGetEntry(filesystem, path, callback, opts) {
    if (opts === undefined) {
        opts = {create:true}
    }
    function recurse(e) {
        if (path.length == 0) {
            if (e.isFile) {
                callback(e)
            } else if (e.name == "NotFoundError") {
                callback({error:e.name, message:e.message})
            } else {
                callback({error:'file exists'})
            }
        } else if (e.isDirectory) {
            if (path.length > 1) {
                // this is not calling error callback, simply timing out!!!
                e.getDirectory(path.shift(), opts, recurse, recurse)
            } else {
                e.getFile(path.shift(), opts, recurse, recurse)
            }
        } else if (e.name == 'NotFoundError') {
            callback({error:e.name, message:e.message})
        } else {
            callback({error:'file exists'})
        }
    }
    recurse(filesystem)
}
