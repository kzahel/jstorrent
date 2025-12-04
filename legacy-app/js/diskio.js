(function() {
/*
// XXX -- createWriter has second argument error callback
// XXX FileEntry.file() error callback, what is signature?
  we were using diskiosync.js but realized there is no FileWriterSync


  instead we are going to keep using the async interfaces, but be strict and require that all disk access goes through the DiskIO object.

*/

/*

  maybe instead create a shim around the api to make sure we dont get deadlocks...

*/

    function maybeTimeout(fn, t) {
        if (jstorrent.options.slow_diskio) {
            setTimeout(fn, t)
        } else {
            fn()
        }
    }

    function FileMetadataCache() {
        // store file sizes and stuff so we dont have to constantly call .getMetadata()
        this.cache = {}
    }
    var FileMetadataCacheprototype = {
        updateEntryManual: function(root, path, meta) {
            if (! jstorrent.options.use_metadata_cache) { return }
            var cacheKey = root.filesystem.name + root.fullPath + '/' + path.join('/')
            this.cache[cacheKey] = meta
        },
        updateEntry: function(entry, metadata) {
            if (! jstorrent.options.use_metadata_cache) { return }
            var cacheKey = entry.filesystem.name + entry.fullPath
            this.cache[cacheKey] = { size: metadata.size,
                                     modificationTime: metadata.modificationTime }
        },
        updateSizeExact: function(entry, newsz) {
            this.updateSize(entry, newsz, true)
        },
        invalidate: function(entry) {
            var cacheKey = entry.filesystem.name + entry.fullPath
            delete this.cache[cacheKey]
        },
        updateSize: function(entry, newsz, is_exact) {
            if (! jstorrent.options.use_metadata_cache) { return }
            var cacheKey = entry.filesystem.name + entry.fullPath
            var cacheEntry = this.cache[cacheKey]

            if (cacheEntry) {
                var oldsz = cacheEntry.size
                if (is_exact) {
                    cacheEntry.size = newsz
                } else {
                    cacheEntry.size = Math.max(newsz, cacheEntry.size)
                }
                cacheEntry.modificationTime = new Date
                //console.log('updated sz',oldsz,newsz)
            } else {
                if (is_exact) {
                    this.cache[cacheKey] = { size: newsz,
                                             modificationTime: new Date }
                } else {
                    // not a bad cache state actually
                    // getmetadata returns {exists:false, size:0}
                    console.error("bad cache state!")
                    debugger
                }
            }
        },
        getByFile: function(file) {
            var entry = file.torrent.getStorage().entry
            var cacheKey = entry.filesystem.name + entry.fullPath + '/' + file.path.join('/')
            return this.cache[cacheKey]
        },
        get: function(entry) {
            if (! jstorrent.options.use_metadata_cache) { return }
            var cacheKey = entry.filesystem.name + entry.fullPath
            var cacheEntry = this.cache[cacheKey]
            if (cacheEntry) { return cacheEntry }
        }
    }
    _.extend(FileMetadataCache.prototype, FileMetadataCacheprototype)
    jstorrent.FileMetadataCache = FileMetadataCache


    function EntryCache() {
        this.cache = {}
    }

    var EntryCacheprototype = {
        clearTorrent: function() {
            // todo
        },
        clearKey: function(skey) {
            var todelete = []
            for (var key in this.cache) {
                if (key.startsWith(skey)) {
                    todelete.push(key)
                }
            }
            for (var i=0; i<todelete.length; i++) {
                delete this.cache[todelete[i]]
            }
        },
        clear: function() {
            this.cache = {}
        },
        unset: function(k) {
            delete this.cache[k]
        },
        set: function(k,v) {
            if (! jstorrent.options.use_fileentry_cache) { return }
            this.cache[k] = v
        },
        get: function(k) {
            if (! jstorrent.options.use_fileentry_cache) { return }
            return this.cache[k]
        },
        getByFile: function(file) {
            if (! jstorrent.options.use_fileentry_cache) { return }
            debugger
            var disk = file.torrent.getStorage()
            var cacheKey = disk.key + '/' + file.path.join('/')
            return this.get(cacheKey)
        }
    }
    _.extend(EntryCache.prototype, EntryCacheprototype)
    jstorrent.EntryCache = EntryCache


    zeroCache = {} // store a cache of "zero" arrays, see if it improves speed
    for (var i=14; i<=14; i++) {
        zeroCache[ Math.pow(2,i) ] = new Uint8Array(Math.pow(2,i))
    }
    zeroCache[ Math.pow(2,22) ] = new Uint8Array(Math.pow(2,i))

    function recursiveGetEntryReadOnly(disk, inpath, callback) {
        var cacheKey = disk.key + '/' + inpath.join('/')
        var inCache = app.entryCache && app.entryCache.get(cacheKey)
        if (inCache) { 
            //console.log('cachehit',cacheKey)
            callback(inCache); 
            return
        } else {
            //console.log('cachemiss',cacheKey)
        }
        var filesystem = disk.entry

    // XXX - this looks messy, refactor it
    var state = {e:filesystem}
    var path = inpath.slice()

    function recurse(e) {
        if (! e) {
            callback({error:"Disk missing"})
        } else if (path.length == 0) {
            if (e.name == 'TypeMismatchError') {
                state.e.getDirectory(state.path, {create:false}, recurse, recurse)
            } else if (e.name == 'NotFoundError') {
                callback({error:e})
            } else if (e.isFile) {
                app.entryCache.set(cacheKey, e)
                callback(e)
            } else if (e.isDirectory) {
                callback(e)
            } else {
                callback({error:'path not found'})
            }
        } else if (e.isDirectory) {
            if (path.length > 1) {
                // this is not calling error callback, simply timing out!!!
                e.getDirectory(path.shift(), {create:false}, recurse, recurse)
            } else {
                state.e = e
                state.path = path.slice()
                e.getFile(path.shift(), {create:false}, recurse, recurse)
            }
        } else {
            if (e.name == 'NotFoundError') {
                callback({error:e})
            } else {
                callback({error:e,mymsg:'file exists'})
            }
        }
    }
    recurse(filesystem)
}

    function recursiveGetEntryWrite(disk, inpath, callback) {
        var cacheKey = disk.key + '/' + inpath.join('/')
        var inCache = app.entryCache.get(cacheKey)
        if (inCache) { callback(inCache); return }

        var filesystem = disk.entry
        console.assert(filesystem)

        var path = inpath.slice()
        var oncallback = callback
/*
        var state = {callback:callback,
                     returned:false,
                     timeoutHit:false}

        var oncallback = function() {
            if (state.timeoutHit) {
                console.warn('timed out getentry, but it returned later')
            } else {
                if (state.timeoutId) {
                    clearTimeout(state.timeoutId)
                }
                state.returned=true
                debugger
                callback.apply(this,arguments)
            }
        }
 // we have a global job timeout now
        state.timeoutId = setTimeout( function() {
            state.timeoutHit=true
            console.assert(! state.returned)
            console.error("timeout with getentrywrite")
            callback({error:'timeout'})
        }, DiskIO.getentrytimeout )
*/

        function recurse(e) {
            if (! e) {
                debugger // #1 exception
                oncallback({error:'empty input'}) // e.isDirectory was dying...
            } else if (path.length == 0) {
                if (e.name && e.message) {
                    oncallback({error:e})
                } else if (e.isFile) {
                    app.entryCache.set(cacheKey, e)
                    oncallback(e)
                } else {
                    oncallback({error:'file exists'})
                }
            } else if (e.isDirectory) {
                if (path.length > 1) {
                    // this is not calling error callback, simply timing out!!!
                    e.getDirectory(path.shift(), {create:true}, recurse, recurse)
                } else {
                    e.getFile(path.shift(), {create:true}, recurse, recurse)
                }
            } else {
                oncallback({error:'file exists'})
            }
        }
        recurse(filesystem)
    }

    function BasicJob(opts) {
        jstorrent.Item.apply(this, arguments)
        this.opts = opts

        this.set('state','idle')
        this.set('type',opts.type)
        this.set('jobId', DiskIO.jobctr++)

        for (var key in opts) {
            this.set(key, opts[key])
        }
    }

    BasicJobProto = {
        get_key: function() { return this.key }
    }
    _.extend(BasicJob.prototype, BasicJobProto, jstorrent.Item.prototype)

    function PieceReadJob(opts, callback) {
        this.piece = opts.piece
        jstorrent.Item.apply(this, arguments)
        this.onfinished = callback

        this.readData = {}
        this.opts = opts
        this.set('type','PieceReadJob')
        this.set('state','idle')
        this.set('size', opts.size)
        this.set('pieceOffset', opts.pieceOffset)
        this.set('pieceNum', opts.piece.num)
        this.set('torrent',opts.piece.torrent.hashhexlower)
        this.set('jobId', (DiskIO.jobctr++)%10000000)
        this._subjobs = []
        this.filesSpanInfo = opts.piece.getSpanningFilesInfo(opts.pieceOffset, opts.size)
    }
    var PieceReadJobProto = {
        assembleReadData: function() {
            var fileKeys = _.keys(this.readData)
            _.map(fileKeys, function(d){ return parseInt(d,10) })
            fileKeys.sort()
            var toret = []
            for (var i=0; i<fileKeys.length; i++) {
                toret.push( this.readData[fileKeys[i]] )
            }
            return toret
        },
        get_key: function() { return this.key },
        subjobcallback: function(job) {
            this._subjobs.push(job)
        },
        getSubjobs: function() {
            var jobs = []
            for (var i=0; i<this.filesSpanInfo.length; i++) {
                var info = this.filesSpanInfo[i]
                console.assert(info.size > 0)
                var cur = new BasicJob({type:'doGetContentRange',
                                        readJob: this,
                                        size:info.size,
                                        fileNum: info.fileNum,
                                        fileOffset:info.fileOffset,
                                        pieceOffset:info.pieceOffset,
                                        pieceNum:this.piece.num,
                                        piece: this.piece,
                                        torrent: this.piece.torrent.hashhexlower})
                cur.opts.callback = _.bind(this.subjobcallback,this,cur)
                jobs.push( cur )
            }
            return jobs
        }
    }
    _.extend(PieceReadJob.prototype, 
             PieceReadJobProto,
             jstorrent.Item.prototype)

    function PieceWriteJob(opts, callback) {
        var piece = opts.piece
        this.piece = piece
        jstorrent.Item.apply(this, arguments)
        this.opts = opts
        this.onfinished = callback
        this.oncollected = null
        this.set('type','PieceWriteJob')
        this.set('state','idle')
        this.set('pieceNum', piece.num)
        this.set('torrent',piece.torrent.hashhexlower)
        this.set('jobId', (DiskIO.jobctr++)%10000000)
        this.filesSpanInfo = piece.getSpanningFilesInfo()
        this._stallCheckId = null
        this._subjobs = []

        this.filesMetadataLength = 0
        this.filesMetadata = {}
        this.filesZeroInfo = {}
    }
    var PieceWriteJobProto = {
        subjobcallback: function(job) {
            this._subjobs.push(job)
        },
        get_key: function() { return this.key },
        getSubjobs: function() {
            // 1. return all "collect metadata" jobs
            // check if have more jobs after this
            var jobs = []
            for (var i=0; i<this.filesSpanInfo.length; i++) {
                var info = this.filesSpanInfo[i]
                var cur = new BasicJob({type:'doGetMetadata', 
                                        writeJob: this,
                                        fileNum: info.fileNum,
                                        pieceNum:this.piece.num,
                                        piece: this.piece,
                                        torrent: this.piece.torrent.hashhexlower,
                                        callback:_.bind(this.onFileMetadata, this, info.fileNum)})
                jobs.push( cur )
            }
            return jobs
        },
        onFileMetadata: function(fileNum, result) {
            this.filesMetadata[fileNum] = result
            this.filesMetadataLength++
            if (this.filesMetadataLength == this.filesSpanInfo.length) {
                this.set('state','collected')
                this.oncollected()
            }
        },
        wroteFileZeroes: function(fileNum, iter, total) {
        }
    }
    _.extend(PieceWriteJob.prototype, 
             PieceWriteJobProto,
             jstorrent.Item.prototype)

    function DiskIO(opts) {
        this.disk = opts.disk
        jstorrent.BasicCollection.apply(this, arguments)
    }
    DiskIO.jobctr = 0
    DiskIO.debugtimeout = 1000
    DiskIO.allowedJobTimeShort = 2000 // most jobs dont need much time
    //DiskIO.debugtimeout = 4000
    //DiskIO.allowedJobTimeShort = 8000 // most jobs dont need much time

    DiskIO.allowedJobTime = 60000 * 5 // 30 seconds should be enough... ? // 5 minutes
    // writes after large truncates can take a long time, though.
    //DiskIO.getentrytimeout = 5000

    var DiskIOProto = {
        checkStalled: function() {
            console.clog(L.DISKIO,'check for stalled jobs')
            // check if the current job has been there for the past few cycles...
            if (this.items.length > 0) {
                var job = this.get_at(0)
                var newId = job.get('jobId')
                if (this._stallCheckId) {
                    if (this._stallCheckId == newId) {
                        console.clog(L.DISKIO,'job looks stalled somehow. try to kill it')
                        job.set('state','error')
                        if (job.onfinished) { job.onfinished({error:'stalled?', job:job}) }
                        //if (job._opts.callback) { job._opts.callback({error:'stalled?'}) }
                        this.shift()
                        this.queueActive = false
                        this.doQueue()
                    }
                }
                this._stallCheckId = newId

            } else {
                this._stallCheckId = null
            }
        },
        doQueue: function() {
            if (this.queueActive || this.items.length == 0) {
                return
            }
            //console.log('doQueue')
            this.queueActive = true

            if (this.items.length > 2) {
                // see if we should maybe re-order to minimize zero writes
            }

            var job = this.get_at(0)

            if (job instanceof PieceWriteJob) {
                var haderror = []
                for (var i=0; i<job._subjobs.length; i++) {
                    var err = job._subjobs[i].get('error')
                    if (err) {
                        haderror.push(err)
                    }
                }
                if (haderror.length>0) {
                    // report job error here, too?
                    job.set('state','error')
                    job.onfinished({error:haderror.join(','), job:job})

                    _.defer( function() { this.reportJobError({error:true,metajob:true}, job, null) }.bind(this) )

                } else {
                    job.set('state','done')
                    job.onfinished({piece:job.piece})
                }
                this.shift()
                this.queueActive = false
                this.doQueue()
            } else if (job instanceof PieceReadJob) {
                var haderror = []
                for (var i=0; i<job._subjobs.length; i++) {
                    var err = job._subjobs[i].get('error')
                    if (err) {
                        haderror.push(err)
                    }
                }
                if (haderror.length>0) {
                    // report job error here, too?
                    job.set('state','error')
                    job.onfinished({error:haderror.join(','), job:job})

                    _.defer( function() { this.reportJobError({error:true,metajob:true}, job, null) }.bind(this) )

                } else {
                    job.set('state','done')
                    job.onfinished({data:job.assembleReadData()})
                }
                this.shift()
                this.queueActive = false
                this.doQueue()
            } else {
                var type = job.opts.type
                var args = [job.opts, job.opts.callback, job]
                //Array.prototype.push.call(args, job)
                job.set('state','starting')
                this[type].apply(this, args)
            }
        },
        addToQueue: function(_type, _args, qopts) {
            var opts = arguments[1][0]
            opts.type = arguments[0]
            if (opts.piece) {
                opts.pieceNum = opts.piece.num
                opts.torrent = opts.piece.torrent.hashhexlower
            }
            if (arguments[1][1]) {
                opts.callback = arguments[1][1]
            }

            var job = new BasicJob(opts)
            if (false && qopts && qopts.priority == 'high') {
                this.unshift(job)
            } else {
                this.addAt(job)
            }
            this.doQueue()
        },
        getFileEntryWriteable: function(disk, path, callback) {
            recursiveGetEntryWrite(disk, path, function(entry) {
                console.assert(entry)
                if (entry.error) {
                    callback(entry)
                } else {
                    callback(entry)
                }
            })
        },
        getMetadata: function() {
            this.addToQueue('doGetMetadata',arguments)
        },
        doGetMetadata: function(opts, callback, job) {
            if (this.checkShouldBail(job)) return
            var file = opts.file || opts.piece.torrent.getFile(opts.fileNum)
            var path = file.path.slice()
            var oncallback = this.createWrapCallback(callback,job)
            job.set('state','getentry') // XXX getting stuck here, even though sometimes
            recursiveGetEntryReadOnly(this.disk, path, function(entry) {
                if (this.checkShouldBail(job)) return
                job.set('state','gotentry')
                if (entry.error) {
                    if (entry.error.name == 'NotFoundError') {
                        app.fileMetadataCache.updateEntryManual(this.disk.entry, path, {size:0})
                        oncallback({size:0,exists:false})
                    } else {
                        oncallback(entry)
                        debugger
                    }
                } else {
                    function onMetadata(result) {
                        job.set('state','gotmetadata')
                        if (result.err) { // XXX correct signature?
                            app.fileMetadataCache.invalidate(entry)
                            oncallback({error:result.err})
                            debugger
                        } else {
                            // check matches
                            var cachedMetadata = app.fileMetadataCache.get(entry)
                            if (cachedMetadata) {
                                console.assert(cachedMetadata.size == result.size)
                            }

                            app.fileMetadataCache.updateEntry(entry, result)
                            oncallback(result)
                        }
                    }
                    job.set('state','getmetadata')

                    var cachedMetadata = app.fileMetadataCache.get(entry)
                    if (cachedMetadata) {
                        onMetadata(cachedMetadata)
                    } else {
                        entry.getMetadata(onMetadata, onMetadata)
                    }
                }
            }.bind(this))
        },
        writeWholeContents: function() {
            this.addToQueue('doWriteWholeContents',arguments)
        },
        getContentRange: function(args, callback, opts) {
            this.addToQueue('doGetContentRange',arguments, opts)
        },
        doWriteWholeContents: function(opts, callback, job) {
            if (this.checkShouldBail(job)) return
            var oncallback = this.createWrapCallback(callback,job)
            var path = opts.path.slice()
            job.set('state','getentry')

            this.getFileEntryWriteable( this.disk, path, function(entry) {
                if (this.checkShouldBail(job)) return

                if (entry.error) {
                    job.set('state','entrygeterror')
                    console.error(entry)
                    //debugger // TODO -- report FileError message or number here better
                    oncallback({error:'entrygeterror',evt:entry})
                    return
                }

                job.set('state','createwriter')
                var oncreatewritererr = function(evt) {
                    job.set('state','createwritererr')
                    console.error('oncreatewritererr',evt)
                    oncallback({error:'createwritererr',evt:evt})
                }
                entry.createWriter( function(writer) {
                    //console.log('got writer',writer)
                    if (this.checkShouldBail(job)) { writer.abort(); return }
                    writer.onwrite = function(evt) {
                        app.fileMetadataCache.updateSizeExact(entry, 0)
                        if (this.checkShouldBail(job)) return
                        job.set('state','createwriter2')

                        var oncreatewriter2err = function(evt) {
                            job.set('state','createwriter2err')
                            console.error('oncreatewriter2err',evt)
                            oncallback({error:'createwriter2err',evt:evt})
                        }

                        entry.createWriter( function(writer2) {
                            //console.log('got writer2',writer2)
                            if (this.checkShouldBail(job)) { writer2.abort(); return }
                            writer2.onwrite = function(evt2) {
                                app.fileMetadataCache.updateSize(entry, opts.data.byteLength)
                                oncallback(evt2)
                            }
                            writer2.onerror = function(evt2) {
                                app.fileMetadataCache.invalidate(entry)
                                job.set('state','writer2.onerror')
                                job.set('error',evt2.target.error.name)
                                console.error('writer error',evt2)
                                oncallback({error:evt2})
                            }
                            writer2.onprogress = function(evt2) {
                                //console.log('progress',evt)
                                var pct = Math.floor( 50 * evt2.loaded / evt2.total )
                                job.set('progress',50+pct)
                            }
                            job.set('state','writing')
                            maybeTimeout( function() {
//                            writer2.seek(0) // need to do this?

                                writer2.write(new Blob([opts.data]))
                            }, DiskIO.debugtimeout)
                        }.bind(this), oncreatewriter2err)
                    }.bind(this)
                    writer.onprogress = function(evt) {
                        //console.log('progress',evt)
                        var pct = Math.floor( 50 * evt.loaded / evt.total )
                        job.set('progress',pct)
                    }
                    writer.onerror = function(evt) {
                        app.fileMetadataCache.invalidate(entry)
                        console.error('truncate error',evt)
                        job.set('state','write.truncate.error')
                        job.set('error',evt.target.error.name)
                        oncallback({error:evt})
                    }
                    //console.log('writer.Write')
                    job.set('state','truncating')
                    maybeTimeout( function() {
                        writer.truncate(0)
                    }, DiskIO.debugtimeout )
                }.bind(this),oncreatewritererr)
            }.bind(this))

        },
        getWholeContents: function() {
            this.addToQueue('doGetWholeContents',arguments)
        },
        reportJobError: function(err, evt, state) {
            if (err.metajob) {
                // subjob reports us
            } else {

                if (evt instanceof BasicJob) {

                    if (err.error && err.error.name) {
                        console.log('report job err',err.error.name)
                        app.analytics.sendEvent('DiskIO','JobError',err.error.name)
                    } else {
                        console.log('report basic job error',err,evt)
                        var job = evt
                        var errattr = evt.get('error')
                        if (errattr.name) {
                            errattr = errattr.name
                        }
                        var data = {
                            type: evt.get('type'),
                            error: errattr,
                            state: evt.get('state')
                        }
                        var keys = _.keys(data)
                        keys.sort()
                        var report = []
                        for (var i=0; i<keys.length; i++) {
                            report.push( keys[i] + '=' + data[keys[i]] )
                        }
                        var reportstr = report.join(',')
                        app.analytics.sendEvent('DiskIO','JobError',reportstr, evt.get('size'))
                    }
                } else {
                    console.log('report job error',err,evt)
                    app.analytics.sendEvent('DiskIO','JobError',JSON.stringify(err))
                }
                //console.log("Report job error:",err, evt)
            }
        },
        createWrapCallback: function(callback, job) {
            console.assert(callback)
            console.assert(job)

            var state = {
                returned:false,
                timedout:false
            }
            var theoncallback = _.bind(this.wrapCallback, this, callback, job, state)
            
            var allowedTime = DiskIO.allowedJobTime
            if (_.contains(['doWriteWholeContents','doGetWholeContents'],
                           job.get('type'))) {
                allowedTime = DiskIO.allowedJobTimeShort
            }

            state.timeoutId = setTimeout( function() {
                if (state.returned) {
                    console.assert(false)
                }
                state.timeoutId = null
                state.timedout = true
                theoncallback({error:'timeout',triggered:true})
            }.bind(this), DiskIO.allowedJobTime )
            // if no return in 30 seconds, 
            return theoncallback
        },
        wrapCallback: function(callback, job, state) {
            if (state.timeoutId) {
                clearTimeout(state.timeoutId)
                state.timeoutId = null
            }
            if (state.returned) {
                return
            }

            var cargs = Array.prototype.slice.call(arguments,3)
            if (cargs[0] && cargs[0].error) { // double triggering?
                //job.set('state','error')
                job.set('error',cargs[0].error)
                job._error_all = cargs
                _.defer( function() { this.reportJobError(cargs[0], job, state) }.bind(this) )

                //job.set('haderror',true)
            } else {
                job.set('state','done')
            }

            state.returned = true
            maybeTimeout( function() {
                this.shift()
                if (callback){callback.apply(this,cargs)}
                this.queueActive = false
                this.doQueue()
            }.bind(this), DiskIO.debugtimeout )
        },
        doGetContentRange: function(opts, callback, job) {
            // this is specific to a FILE

            console.assert(opts.size > 0)
            if (this.checkShouldBail(job, opts)) return
            var oncallback = this.createWrapCallback(callback,job)
            var file = opts.file || opts.piece.torrent.getFile(opts.fileNum)
            console.assert(opts.fileOffset + opts.size <= file.size)
            var path = file.path.slice()
            job.set('state','getentry')

            if (jstorrent.options.use_piece_cache) {
                var cacheData = file.getCachedData(opts.fileOffset, opts.size)
                if (cacheData) {
                    console.assert(cacheData.byteLength == opts.size)
                    oncallback(cacheData)
                    return
                }
            }

            // XXX - BROKEN - this needs to get split into subjobs
            recursiveGetEntryReadOnly(this.disk, path, function(entry) {
                if (this.checkShouldBail(job)) return
                if (entry.error) {
                    oncallback({error:entry.error.name,evt:entry})
                } else {
                    var onFile = function(result) {
                        job.set('state','gotfile')
                        if (this.checkShouldBail(job)) return
                        if (result.err || // also no
                            result.type == 'error' || // doesnt happen this way i dont think
                            result.code !== undefined && result.name && result.message
                           ) {
                            oncallback({error:result,evt:result})
                        } else {
                            var file = result
                            function onRead(evt) {
                                if (evt.target.result) {
                                    if (evt.target.result.byteLength == opts.size) {

                                        // if part of multi job...
                                        if (job.opts.readJob) {
                                            job.opts.readJob.readData[opts.fileNum] = evt.target.result
                                        }
                                        oncallback(evt.target.result)
                                    } else {
                                        debugger
                                        oncallback({error:'data too small!', evt:evt})
                                    }
                                } else {
                                    console.error('reader error',evt)
                                    debugger
                                    oncallback({error:'error on read',evt:evt})
                                }
                            }
                            var fr = new FileReader
                            fr.onload = onRead
                            fr.onerror = onRead // TODO make better

                            var cachedMeta = app.fileMetadataCache.get(entry)
                            if (cachedMeta) {
                                console.assert(cachedMeta.size == file.size)
                            }

                            var blobSlice = file.slice(opts.fileOffset, opts.fileOffset + opts.size)
                            job.set('state','reading')
                            maybeTimeout( function() {
                                fr.readAsArrayBuffer(blobSlice)
                            }, DiskIO.debugtimeout)
                        }
                    }.bind(this)
                    job.set('state','getfile')
                    entry.file(onFile, onFile)
                }
            }.bind(this))
        },
        doGetWholeContents: function(opts, callback, job) {
            if (this.checkShouldBail(job)) return
            // gets whole contents for a file
            var oncallback = this.createWrapCallback(callback,job)
            var path = opts.path
            job.set('state','getentry')
            recursiveGetEntryReadOnly(this.disk, path, function(entry) {
                if (this.checkShouldBail(job)) return
                if (entry.isDirectory) {
                    oncallback({error:"entry is a directory"})
                } else if (entry.error) {
                    oncallback(entry)
                } else {
                    var onFile = function(result) {
                        job.set('state','gotfile')
                        if (this.checkShouldBail(job)) return
                        if (result.err || // also no
                            result.type == 'error' || // doesnt happen this way i dont think
                            result.code !== undefined && result.name && result.message
                           ) {
                            oncallback({error:result,evt:result})
                        } else {
                            var fr = new FileReader
                            fr.onload = function(evt) {
                                oncallback(evt.target.result)
                            }
                            fr.onprogress = function(evt) {
                                //console.log('progress',evt)
                                var pct = Math.floor( 100 * evt.loaded / evt.total )
                                job.set('progress',pct)
                            }
                            fr.onloadend = function(evt) {
                                job.set('state','onloadend')
                            }
                            fr.onerror = function(evt) {
                                job.set('state','onreaderror')
                                job.set('error',evt.target.error.name)
                                console.error('reader error',evt, evt.target.error.name)
                                oncallback({error:evt.target.error.name,evt:evt})
                            }

                            job.set('state','reading')
                            maybeTimeout( function() {
                                fr.readAsArrayBuffer(result)
                            }, DiskIO.debugtimeout)
                        }
                    }.bind(this)
                    job.set('state','getfile')
                    entry.file(onFile, onFile)
                }
            }.bind(this))
        },
        writePiece: function() {
            // find a better place to insert this
            var others = _.filter(this.items, function(v) { return v.get('type') == 'doWritePiece' })
            if (others.length > 0) {
                //console.warn('do smarter insert to reduce zerowrite/truncate...')
                // find the right place to insert it.
            }
            var thisPieceNum = arguments[0].piece.num
            this.addToQueue('doWritePiece',arguments)
        },
        readPiece: function() {
            // reads piece data from disk
            this.addToQueue('doReadPiece',arguments)
        },
        checkShouldBail: function(job) {
            if (job.opts.type == 'doGetWholeContents') {
                // getting torrent metadata
                return false
            }
            if (job.opts.file && job.opts.file.isComplete()) {
                return false
            }
            var shouldBail = this.checkTorrentStopped(job) || this.checkJobTimeout(job)
            //var shouldBail = this.checkJobTimeout(job)
            if (shouldBail) { console.warn('shouldbail!') } // what about our callback?
            return shouldBail
        },
        checkJobTimeout: function(job) {
            if (job.get('error')) {
                return true
            }
            return false
        },
        checkTorrentStopped: function(job) {
            var ctor = app.client.torrents.get(job.opts.torrent)
            if (ctor && ctor.get('state') == 'stopped') {
                if (! ctor.isComplete()) {
                    return true
                }
            }
            return false
        },
        doTruncate: function(opts, callback, job) {
            if (this.checkShouldBail(job)) return
            var oncallback = this.createWrapCallback(callback,job)
            var piece = opts.piece
            var writeJob = opts.writeJob
            var fileNum = opts.fileNum
            var size = opts.size
            var path = piece.torrent.getFile(opts.fileNum).path.slice()
            job.set('state','getentry')
            this.getFileEntryWriteable( this.disk, path, function(entry) {
                if (this.checkShouldBail(job)) return

                if (entry.error) {
                    job.set('state','entrygeterror')
                    console.error(entry)
                    oncallback({error:'entrygeterror',evt:entry})
                    return
                }
                job.set('state','createwriter')

                var oncreatewritererr = function(evt) {
                    job.set('state','createwritererr')
                    console.error('oncreatewritererr',evt)
                    oncallback({error:'createwritererr',evt:evt})
                }

                entry.createWriter( function(writer) {
                    if (this.checkShouldBail(job)) { writer.abort(); return }
                    writer.onwrite = function(evt) {
                        // VERIFY it
                        //app.fileMetadataCache.updateSize(entry, )

                        entry.getMetadata( function(meta) {
                            if (meta.size == opts.size) {
                                app.fileMetadataCache.updateSize(entry, opts.size)
                                oncallback(evt)
                            } else {
                                debugger
                                oncallback({error:'truncate did not work',evt:evt,meta:meta})
                            }
                        }, function(err) {
                            oncallback({error:'couldnt get metadata',evt:evt})
                        })

                    }
                    writer.onprogress = function(evt) {
                        console.log('truncate progress',evt)
                        var pct = Math.floor( 100 * evt.loaded / evt.total )
                        job.set('progress',pct)
                    }
                    writer.onerror = function(evt) {
                        app.fileMetadataCache.invalidate(entry)
                        console.error('truncate writer error, wanted',opts.size, evt.target.error.name,evt)
                        job.set('state','truncate.writer.error')
                        job.set('error',evt.target.error.name)
                        oncallback({error:evt.target.error.name,evt:evt})
                    }
                    //console.log('writer.Write')
                    job.set('state','truncating')
                    maybeTimeout( function() {
                        console.clog(L.DISKIO,"TRUNCATE!")
                        writer.truncate(opts.size)
                    }, DiskIO.debugtimeout)
                }.bind(this), oncreatewritererr)
            }.bind(this))
        },

        doWriteZeroes: function(opts, callback, job) {
            if (this.checkShouldBail(job)) return
            job.set('state','preparebuffer')
            var writeJob = opts.writeJob
            var fileNum = opts.fileNum
            var offset = opts.fileOffset
            var size = opts.size

            var oncallback = this.createWrapCallback(callback,job)

            // do we have cached entry ready?
            if (zeroCache[size]) {
                var buftowrite = zeroCache[size]
            } else {
                var buftowrite = new Uint8Array(size)
            }
            var path = writeJob.piece.torrent.getFile(fileNum).path.slice()
            job.set('state','getentry')
            this.getFileEntryWriteable( this.disk, path, function(entry) {
                if (this.checkShouldBail(job)) return

                if (entry.error) {
                    job.set('state','entrygeterror')
                    console.error(entry)
                    oncallback({error:'entrygeterror',evt:entry})
                    return
                }

                job.set('state','createwriter')

                var oncreatewritererr = function(evt) {
                    job.set('state','createwritererr')
                    console.error('oncreatewritererr',evt)
                    oncallback({error:'createwritererr',evt:evt})
                }

                entry.createWriter( function(writer) {
                    if (this.checkShouldBail(job)) { writer.abort(); return }
                    writer.onwrite = function(evt) {
                        app.fileMetadataCache.updateSize(entry, offset + buftowrite.byteLength)
                        oncallback(evt)
                    }
                    writer.onprogress = function(evt) {
                        //console.log('progress',evt)
                        var pct = Math.floor( 100 * evt.loaded / evt.total )
                        job.set('progress',pct)
                    }
                    writer.onwriteend = function(evt) {
                        job.set('state','onwriteend')
                    }
                    writer.onerror = function(evt) {
                        app.fileMetadataCache.invalidate(entry)
                        job.set('state','onzerowriteerror')
                        job.set('error',evt.target.error.name)
                        console.error('zerowriter error',evt, evt.target.error.name)
                        oncallback({error:evt.target.error.name,evt:evt})
                    }
                    writer.seek(offset)
                    job.set('state','writing')
                    maybeTimeout( function() {
                        writer.write(new Blob([buftowrite]))
                    }, DiskIO.debugtimeout)
                }.bind(this), oncreatewritererr)
            }.bind(this))
        },

        doReadPiece: function(opts, callback, job) {
            if (this.checkShouldBail(job)) return
            var piece = opts.piece
            console.assert(callback)
            var readJob = new PieceReadJob(opts, callback)
            var subjobs = readJob.getSubjobs()
            this.shift()
            var subjobs = readJob.getSubjobs()
            var cur
            this.unshift(readJob)
            while( cur = subjobs.pop() ) {
                this.unshift(cur)
            }
            this.queueActive = false
            this.doQueue()
        },
        doWritePiece: function(opts, callback, job) {
            if (this.checkShouldBail(job)) return
            var piece = opts.piece
            // 1. collect metadat info for all the files (sizes etc)
            // 2. create all the jobs, including zero pad jobs
            // 3. put this job after all those jobs
            var writeJob = new PieceWriteJob({piece:piece,
                                              torrent:piece.torrent.hashhexlower
                                             }, 
                                             callback)
            writeJob.oncollected = _.bind(this.onWritePieceCollected, this, writeJob)
            this.shift() // remove the "basic job"
            // move this to the end
            var subjobs = writeJob.getSubjobs()
            var cur
            this.unshift(writeJob)
            while( cur = subjobs.pop() ) {
                this.unshift(cur)
            }

            //this.items = subjobs.concat(this.items)
/*            for (var i=0; i<subjobs.length; i++) {
                this.addAt(subjobs[i])
            }*/
            //this.addAt(writeJob)

            this.queueActive = false
            this.doQueue()
        },
        doWriteFileData: function(opts, callback, job) {
            if (this.checkShouldBail(job)) return
            job.set('state','preparebuffer')
            var writeJob = opts.writeJob
            var fileNum = opts.fileNum
            var fileOffset = opts.fileOffset
            var pieceOffset = opts.pieceOffset
            var size = opts.size

            var oncallback = this.createWrapCallback(callback,job)
            var piece = writeJob.piece
            if (! piece.data) {
                oncallback({error:'piece data missing'})
                return
            }
            var bufslice = new Uint8Array(piece.data, pieceOffset, size)

            if (pieceOffset == 0 && size == piece.data.byteLength) {
                // TODO -- more efficient if piece fully contained in this file (dont have to do this copy)
                var buftowrite = bufslice
            } else {
                var buftowrite = new Uint8Array(size)
                buftowrite.set(bufslice, 0)
            }

            var path = piece.torrent.getFile(fileNum).path.slice()
            job.set('state','getentry')
            this.getFileEntryWriteable( this.disk, path, function(entry) {
                if (this.checkShouldBail(job)) return

                if (entry.error) {
                    job.set('state','entrygeterror')
                    console.error(entry)
                    oncallback({error:'entrygeterror',evt:entry})
                    return
                }
                job.set('state','createwriter')
                var oncreatewritererr = function(evt) {
                    job.set('state','createwritererr')
                    console.error('oncreatewritererr',evt)
                    oncallback({error:'createwritererr',evt:evt})
                }

                entry.createWriter( function(writer) {
                    //console.log('got writer',writer)
                    job.set('state','gotwriter')
                    if (this.checkShouldBail(job)) { writer.abort(); return }
                    writer.onwrite = function(evt) {
                        app.fileMetadataCache.updateSize(entry, fileOffset + buftowrite.byteLength)
                        job.set('state','onwrite')
                        oncallback(evt)
                    }
                    writer.onprogress = function(evt) {
                        //console.log('progress',evt)
                        var pct = Math.floor( 100 * evt.loaded / evt.total )
                        job.set('progress',pct)
                    }
                    writer.onwriteend = function(evt) {
                        job.set('state','onwriteend')
                    }
                    writer.onerror = function(evt) {
                        app.fileMetadataCache.invalidate(entry)
                        job.set('state','onwriteerror')
                        job.set('error',evt.target.error.name)
                        console.error('writer error',evt, evt.target.error)
                        oncallback({error:evt.target.error.name,evt:evt})
                    }
                    writer.seek(fileOffset)
                    job.set('state','writing') // hangs in this state too!
                    maybeTimeout( function() {
                        writer.write(new Blob([buftowrite]))
                    }, DiskIO.debugtimeout )
                }.bind(this), oncreatewritererr)
            }.bind(this))
        },
        onWritePieceCollected: function(writeJob) {
            if (this.checkShouldBail(writeJob)) return
            // create a bunch of zero pad jobs if needed
            // and then create a bunch of small file write jobs
            var newjobs = []

            for (var i=0; i<writeJob.filesSpanInfo.length; i++) {

                var job = writeJob.filesSpanInfo[i]
                var metaData = writeJob.filesMetadata[job.fileNum]
                if (metaData.exists === false) {
                    //debugger
                }

                if (job.fileOffset > metaData.size) {
                    var useTruncate = true // XXX if NOT use truncate, zero write does not update entry.getFile in time
                    if (useTruncate) {
                        //console.log("TRUNCATE JOB")
                        // truncate is faster than writezeroes!
                        var doWriteFileJob = new BasicJob({type:'doTruncate',
                                                           writeJob:writeJob,
                                                           piece:writeJob.piece,
                                                           pieceNum:writeJob.piece.num,
                                                           torrent:writeJob.piece.torrent.hashhexlower,
                                                           fileNum:job.fileNum,
                                                           size:job.fileOffset,
                                                           callback:writeJob.subjobcallback})
                        doWriteFileJob.opts.callback = _.bind(writeJob.subjobcallback,writeJob,doWriteFileJob)
                        newjobs.push(doWriteFileJob)
                    } else {
                        // create a bunch of extra small pad jobs
                        var numZeroes = job.fileOffset - metaData.size

                        var writtenSoFar = 0
                        //var limitPerStep = 1048576 // only allow writing a certain number of zeros at a time
                        var limitPerStep = Math.pow(2,22)
                        //var limitPerStep = Math.pow(2,15)

                        var zeroJobData = []
                        while (writtenSoFar < numZeroes) {
                            var curZeroes = Math.min(limitPerStep, (numZeroes - writtenSoFar))
                            zeroJobData.push( {type:'doWriteZeroes',
                                               writeJob:writeJob,
                                               torrent:writeJob.piece.torrent.hashhexlower,
                                               pieceNum:writeJob.piece.num,
                                               fileNum:job.fileNum,
                                               fileOffset:metaData.size + writtenSoFar,
                                               size:curZeroes} )
                            writtenSoFar += curZeroes
                        }


                        writeJob.filesZeroInfo[job.fileNum] = { done:0,
                                                                total:zeroJobData.length }

                        for (var j=0; j<zeroJobData.length; j++) {
                            var zeroJob = zeroJobData[j]
                            /*                        var cb = _.bind(writeJob.wroteFileZeroes,
                                                      writeJob,
                                                      job.fileNum,
                                                      j,
                                                      zeroJobData.length) 
                                                      zeroJob.callback = cb
                            */
                            var zeroJobObj = new BasicJob(zeroJob)
                            zeroJobObj.opts.callback = _.bind(writeJob.subjobcallback,writeJob,zeroJobObj)
                            newjobs.push(zeroJobObj)
                        }
                    }
                }
                // at this point we added the zero pad jobs to newjobs, so we can proceed to write the piece data
                var doWriteFileJob = new BasicJob({type:'doWriteFileData',
                                                   writeJob:writeJob,
                                                   pieceNum:writeJob.piece.num,
                                                   torrent:writeJob.piece.torrent.hashhexlower,
                                                   fileNum:job.fileNum,
                                                   fileOffset:job.fileOffset,
                                                   pieceOffset:job.pieceOffset,
                                                   size:job.size,
                                                   callback:null}) // this can time out
                doWriteFileJob.opts.callback = _.bind(writeJob.subjobcallback,writeJob,doWriteFileJob)
                // if this "subjob" times out, we want to trigger the callback on the parent writejob...
                newjobs.push(doWriteFileJob)
            }
            // newjobs all finished
            var cur
            while( cur = newjobs.pop() ) {
                this.unshift(cur)
            }

            //this.items = newjobs.concat( this.items )
            this.doQueue()
        },
        cancelTorrentJobs: function(torrent, callback) {
            console.warn('cancelTorrentJobs')
            // cancel all active jobs for a give torrent
            var toremove = []
            for (var i=0; i<this.items.length; i++) {
                var job = this.items[i]
                if (job.opts.torrent) {
                    if (job.opts.torrent == torrent.hashhexlower) {
                        if (job.get('state') == 'idle') {
                            toremove.push(job)
                        }
                    }
                }
            }

            var cur
            while (cur = toremove.pop()) {
                this.items.splice(this.items.indexOf(cur),1)
            }
            this.trigger('remove')
        },
    }

    _.extend(DiskIO.prototype, 
             DiskIOProto,
             jstorrent.BasicCollection.prototype)


    jstorrent.DiskIO = DiskIO

})()
