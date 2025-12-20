chrome.runtime.getBackgroundPage( function(bg) {
    
})


$(document).ready( function() {
    $('#send').click( function() {
        console.log("SEND INFO!")
    })
})    


function sendItem(item) {
    console.log('got item!',item)
    console.log('main app window:',window.mainAppWindow)
    populateInfo(item)
}

function getInfo(item) {
    var info = {}
    info['description'] = $('description').text()
    info['torrent-info'] = JSON.stringify(item.getSaveData())

    var trinfo = {}
    for (var i=0; i<item.trackers.items.length; i++) {
        var t = item.trackers.items[i]
        trinfo[t.get_key()] = t._attributes
    }
    info['tracker-info'] = JSON.stringify(trinfo)

    var manifest = chrome.runtime.getManifest()
    var lines = []
    lines.push('Version: ' + manifest.name + ' ' + manifest.version)
    lines.push('User-Agent: ' + navigator.userAgent)
    info['versions'] = lines.join('\n')
    return info
}

function populateInfo(item) {
    console.log('populateInfo!',item)
    window.curItem = item
    var info = getInfo(item)
    //$('#torrent-name').text( item.get('name') )
    //$('#infohash').text( item.hashhexlower )
    $('#prefilled-info').text( info['versions'] )
    $('#torrent-info').text( info['torrent-info'] )

    $('#tracker-info').text( info['tracker-info'] )
}

function sendInfo(item) {
    
}