(function(){
    function EntryCache() {}
    jstorrent.EntryCache = EntryCache
    function FileMetadataCache() {}
    jstorrent.FileMetadataCache = FileMetadataCache


    function maybeTimeout(fn, t) {
        if (jstorrent.options.slow_diskio) {
            setTimeout(fn, t)
        } else {
            fn()
        }
    }

    function DiskIO(opts) {
        this.disk = opts.disk
        jstorrent.BasicCollection.apply(this, arguments)
    }
    var DiskIOProto = {
        getWholeContents: function(opts, callback) {
            
        }
    }

    _.extend(DiskIO.prototype, 
             DiskIOProto,
             jstorrent.BasicCollection.prototype)


    jstorrent.DiskIO = DiskIO

    
})();
