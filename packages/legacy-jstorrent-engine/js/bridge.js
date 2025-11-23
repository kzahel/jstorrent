(function() {

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
    jstorrent.Bridge = Bridge

})();
