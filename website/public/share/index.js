var jstorrent_id = 'anhdpjpojoipgpmfanmedjghaligalgb'
var jstorrent_lite_id = 'abmohcnlldaiaodkpacnldcdnjjgldfh'

function parse_magnet(url) {
  var uri = url.slice(url.indexOf(':') + 2)
  var parts = uri.split('&')
  var kv, k, v
  var d = {}
  for (var i = 0; i < parts.length; i++) {
    kv = parts[i].split('=')
    k = decodeURIComponent(kv[0])
    v = decodeURIComponent(kv[1])
    if (!d[k]) d[k] = []
    d[k].push(v)
  }
  if (!d.xt) {
    return
  }
  var xt = d.xt[0].split(':')
  var hash = xt[xt.length - 1]

  // need to make this recognize base32, etc(?)
  /*
    if (hash.length == 32) {
        hash = base32tohex(hash)
    }

    d['hashhexlower'] = hash.toLowerCase()
*/
  return d
}

function parse_location_hash() {
  var hash = window.location.hash.slice(1, window.location.hash.length)
  if (hash.length == 0) {
    return {}
  }
  var parts = hash.split('&')
  var args = {}

  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=')
    args[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1])
  }
  console.log('location hash args', args)
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

function notify(msg) {
  console.log('notify:', msg)
  var p = document.createElement('p')
  var s = document.getElementById('status')
  p.innerText = msg
  s.insertBefore(p, s.firstChild)
}
function getel(id) {
  return document.getElementById(id)
}

function navigateBackMaybe() {
  var delay = 5
  var countdown = delay
  getel('status-done').style.display = ''
  getel('loadingIcon').style.display = 'none'
  if (history.length > 1) {
    getel('status-done').innerText = 'Navigating back in ' + delay + ' s'

    setInterval(function () {
      countdown--
      if (countdown >= 0) {
        getel('status-done').innerText = 'Navigating back in ' + countdown + ' s'
      }
    }, 1000)

    setTimeout(function () {
      notify('Navigating back...')
      history.back()
    }, delay * 1000)
  } else {
    notify('All done! Check the JSTorrent window for progress.')
  }
}

function oninstallsuccess(result) {
  clearInterval(window.checkInstalledInterval)
  console.log('oninstallsuccess', result)
  ga('send', 'event', 'oninstall-success')
  document.getElementById('install-status-text').innerText = 'Install complete'
  setTimeout(function () {
    document.getElementById('install-status').style.display = 'none'
    document.getElementById('install-div').style.display = 'none'
    tryadd()
  }, 1000)
}
function oninstallfail(result) {
  console.log('oninstallfail', result)
  ga('send', 'event', 'oninstall-fail')
  // return everything back to beginning
  resetthings()
}

function resetthings() {
  document.getElementById('install-status').style.display = 'none'
  document.getElementById('install-div').style.display = 'block'
}

function showInstallButton() {
  //notify('showInstallButton')
  document.getElementById('install-div').style.display = 'block'
}

function onaddresponse(result) {
  notify('Torrent Added')
  console.log('onaddresponse', result)
  if (result.handled) {
    ga('send', 'event', 'onaddresponse-handled')
    navigateBackMaybe()
  }
}

function doadd(result) {
  if (!parsed.magnet_uri) {
    parsed.magnet_uri = 'magnet:?xt=urn:btih:' + parsed.hash
  }

  var msg = {
    command: 'add-url',
    url: parsed.magnet_uri,
    pageUrl: window.location.href,
  }

  if (result.full) {
    ga('send', 'event', 'doadd-full')
    notify('Sending Torrent to JSTorrent')
    // simply add to full i guess...
    // and then navigate back?
    chrome.runtime.sendMessage(jstorrent_id, msg, onaddresponse)
  } else if (result.lite) {
    ga('send', 'event', 'doadd-lite')
    notify('Sending Torrent to JSTorrent Lite')
    chrome.runtime.sendMessage(jstorrent_lite_id, msg, onaddresponse)
    // simply add to lite i guess
  } else {
    notify('error?')
  }
}

function installChecked(result) {
  if (!result.full && !result.lite) {
    notify('JSTorrent is not installed!')
    getel('loadingIcon').style.display = 'none'
    // possibly just old version, because we only get here if sendMessage was present...
    showInstallButton()
  } else {
    notify('Starting JSTorrent')
    var delay = 1
    setTimeout(doadd.bind(this, result), delay * 1000)
  }
}

function showmag() {
  var mag = document.getElementById('magnet-link')
  var magdiv = document.getElementById('magnet-div')
  mag.href = parsed.magnet_uri
  magdiv.style.display = ''
}

function checkInstalled() {
  // check out-of-band install
  //console.log('installed ?')
  if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
    clearInterval(window.checkInstalledInterval)
    notify('App Installed')
    oninstallsuccess()
  }
  // check if installed from another tab...
}

function tryadd() {
  if (!window.parsed_magnet) {
    getel('loadingIcon').style.display = 'none'
    notify('No magnet link found in URL')
    return
  }
  if (!window.chrome) {
    // not chrome, no chance of working
    notify('You need the chrome browser for this to work. But here is the magnet link anyway')
    showmag()
  } else if (chrome.runtime && chrome.runtime.sendMessage) {
    showmag()
    notify('Looking for JSTorrent')

    chrome.runtime.sendMessage(jstorrent_id, { command: 'checkInstalled' }, function (response) {
      console.log('checkInstalled result from jstorrent', response)
      if (response === undefined) {
        // not installed
        chrome.runtime.sendMessage(
          jstorrent_lite_id,
          { command: 'checkInstalled' },
          function (response2) {
            console.log('checkInstalled result from jstorrent lite', response2)
            if (response2 === undefined) {
              installChecked({ lite: false, full: false })
            } else {
              installChecked({ lite: true, full: false })
            }
          },
        )
      } else {
        installChecked({ full: true })
      }
    })
    // try to send message to JSTorrent, or JSTorrent Lite
  } else {
    // app is not installed, but could be
    showInstallButton()
  }
}

window.parsed_magnet = null
function dothings() {
  if (parsed.magnet_uri) {
    parsed_magnet = parse_magnet(parsed.magnet_uri)

    if (parsed_magnet && parsed_magnet.jstwn) {
      window.name = parsed_magnet.jstwn
      history.back()
      return
    }

    if (parsed_magnet && parsed_magnet.dn) {
      document.title = parsed_magnet.dn + ' torrent download'
      console.log('file name:', parsed_magnet.dn)
      document.getElementById('file-name').innerText = parsed_magnet.dn[0]
    }
  } else {
    parsed_magnet = null
  }

  if (!parsed_magnet) {
    getel('loadingIcon').style.display = 'none'
    notify('No magnet link found in URL')
    return
  }

  if (window.chrome && chrome.webstore && chrome.webstore.onInstallStageChanged) {
    chrome.webstore.onInstallStageChanged.addListener(function (evt) {
      console.log('onInstallStageChanged', evt)
      document.getElementById('install-status-text').innerText = evt
    })
  }
  if (window.chrome && chrome.webstore && chrome.webstore.onDownloadProgress) {
    chrome.webstore.onDownloadProgress.addListener(function (evt) {
      //console.log('onDownloadProgress',evt)
      document.getElementById('install-status-width').style.width = evt * 100 + '%'
    })
  }

  document.getElementById('click-install').addEventListener('click', function (evt) {
    ga('send', 'event', 'clickInstall')
    var url = 'https://chrome.google.com/webstore/detail/' + jstorrent_lite_id
    console.log('webstore url', url)
    chrome.webstore.install(url, oninstallsuccess, oninstallfail)
    // start polling to see if they installed in the other tab ...

    document.getElementById('install-status').style.display = 'block'
    document.getElementById('install-div').style.display = 'none'
    evt.preventDefault()

    document.getElementById('install-status-text').innerText = 'Click "Add" in the Popup dialog'
  })

  if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
  } else {
    window.checkInstalledInterval = setInterval(checkInstalled, 200)
  }

  tryadd()
}

var domloaded = false
function ondom() {
  domloaded = true

  window.parsed = parse_location_hash()
  if (parsed && parsed.magnet_uri == 'magnet:?testRegistered') {
    return // we detect iframe location from another frame
  }

  dothings()
}

document.addEventListener('DOMContentLoaded', ondom)
