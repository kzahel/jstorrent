(function() {

    function PieceCache(opts) {
        this.torrent = opts.torrent
        this.cache = {}
        this.size = 0
    }

    var PieceCacheprototype = {
        add: function(piece) {
            // adds valid piece data to cache
            console.assert(piece.data)
            this.cache[piece.num] = {data:piece.data}
            this.size = _.keys(this.cache).length
        },
        get: function(num) {
            return this.cache[num]
        },
        remove: function(num) {
            delete this.cache[num]
            this.size = _.keys(this.cache).length
        }
    }
    
    _.extend(PieceCache.prototype, PieceCacheprototype)

    jstorrent.PieceCache = PieceCache

})()