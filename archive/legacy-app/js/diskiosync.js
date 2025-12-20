// https://bugs.chromium.org/p/chromium/issues/detail?id=242373
// 1) there is no way to pass FileEntry to worker
// 2) worker has no chrome.* permissions
// 3) entry.createWriterSync can never be called on user directory

function EntryCache() {}
jstorrent.EntryCache = EntryCache
function FileMetadataCache() {}
jstorrent.FileMetadataCache = FileMetadataCache

function DiskIO(opts) {
    this.disk = opts.disk
    this.worker = new Worker('../js/diskiosync_worker.js')
    this.worker.addEventListener('message',this.onMessage.bind(this))
    this.worker.addEventListener('error',this.onError.bind(this))
    // https://bugs.chromium.org/p/chromium/issues/detail?id=148788
    this.worker.postMessage({url:this.disk.entry.toURL()})
}
DiskIO.prototype = {
    onMessage: function(evt) {
        console.log('got msg',evt.data)
    },
    onError: function(evt) {
        console.log('got error msg',evt.data)
    },
    getWholeContents: function(opts, callback) {
    }
}
jstorrent.DiskIO = DiskIO
