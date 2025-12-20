// maybe don't use this anymore... use one of our fancier classes

function TorrentSettings(opts) {
    this.torrent = opts.torrent
    this.key = 'tsettings-' + this.torrent.hashhexlower
    this.data = null
}

jstorrent.TorrentSettings = TorrentSettings

TorrentSettings.prototype = {
    fetch: function(callback) {
        chrome.storage.local.get(this.key, _.bind(function(d) {
            this.data = d
            callback(d[this.key])
        },this))
        
    },
    get: function(k) {
        return this.data[k]
    },
    set: function(k,v, callback) {
        this.data[k] = v
        var obj = {}
        obj[this.key] = this.data
        chrome.storage.local.set( obj, callback )
    }
}