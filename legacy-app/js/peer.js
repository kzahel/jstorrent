function Peer(opts) {
    jstorrent.Item.apply(this, arguments)
    this.torrent = opts.torrent
    console.assert(this.torrent)
    this.host = opts.host
    this.port = opts.port
}
jstorrent.Peer = Peer
Peer.prototype = {
    get_key: function() {
        return this.host + ':' + this.port
    },
    serialize: function() {
        var hostparts = this.host.split('.')
        var parts = [String.fromCharCode(hostparts[0]),
                     String.fromCharCode(hostparts[1]),
                     String.fromCharCode(hostparts[2]),
                     String.fromCharCode(hostparts[3]),
                     String.fromCharCode(this.port >> 8),
                     String.fromCharCode(this.port & 0xff)]
        return parts.join('')
    }
}
for (var method in jstorrent.Item.prototype) {
    jstorrent.Peer.prototype[method] = jstorrent.Item.prototype[method]
}


function PeerConnections(opts) {
    jstorrent.Collection.apply(this, arguments)
}
jstorrent.PeerConnections = PeerConnections
PeerConnections.prototype = {
}
for (var method in jstorrent.Collection.prototype) {
    jstorrent.PeerConnections.prototype[method] = jstorrent.Collection.prototype[method]
}


