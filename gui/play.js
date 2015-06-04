document.addEventListener("DOMContentLoaded", onready);

function parse_location_hash() {
    var hash = window.location.hash.slice(1,window.location.hash.length)
    var parts = hash.split('&')
    var args = {}
    for (var i=0; i<parts.length; i++) {
        var kv = parts[i].split('=')
        args[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1])
    }
    console.log(args)
    if (navigator.userAgent.match(/chrome/i)) {
        //document.getElementById('info').innerText = JSON.stringify( args )
    } else {
        //document.getElementById('info').innerText = 'Need Chrome to use JSTorrent';
    }

/*
    if (args.magnet_uri) {
        document.write('<h3>Here is the magnet link:</h3>')
        document.write('<a href="'+args.magnet_uri+'">magnet link</a>')
    }
*/
    return args
}

window.parsed = parse_location_hash()


function onready() {
    window.app = new jstorrent.App;
    app.initialize( onappready )
}

function onfileready(file) {
    document.getElementById('info').innerText = file.name
    file.getPlayableSRCForVideo( function(src) {
        console.log('video src',src)
        var video = document.createElement('video')
        //video.preload = 'none'
        //video.preload = 'metadata'
        video.autoplay = 'true'
        video.controls = 'true'
        video.id = 'video'
        //addevents(video)
        video.src = src
        document.getElementById('container').appendChild(video)
    })
}

function onappready() {
    window.client = app.client
    
    window.torrent = client.torrents.get(parsed.hash)
    torrent.loadMetadata( function() { torrent.initializeFiles()
                                       window.file = torrent.files.get(parsed.file)
                                       console.log('have file ready',file)
                                       onfileready(file)
                                     })

    //window.UI = new UI({client:client})
    //window.minUI = new jstorrent.MinUI({client:client})
    //window.app.set_ui(minUI)
}
