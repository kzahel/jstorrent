var jstorrent_id = 'anhdpjpojoipgpmfanmedjghaligalgb'
var jstorrent_lite_id = 'abmohcnlldaiaodkpacnldcdnjjgldfh'
var jstorrent_extension_id = 'dbokmlpefliilbjldladbimlcfgbolhk'
var EXTENSION_CWS_URL =
  'https://chromewebstore.google.com/detail/jstorrent/' + jstorrent_extension_id

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

function getMagnetUri() {
  if (!parsed.magnet_uri) {
    parsed.magnet_uri = 'magnet:?xt=urn:btih:' + parsed.hash
  }
  return parsed.magnet_uri
}

function addViaExtension() {
  var magnet = getMagnetUri()
  notify('Sending torrent to JSTorrent')
  chrome.runtime.sendMessage(
    jstorrent_extension_id,
    { type: 'launch-ping', magnet: magnet },
    function (response) {
      console.log('launch-ping response', response)
      if (chrome.runtime.lastError) {
        console.error('launch-ping error', chrome.runtime.lastError)
        notify('Error sending to extension')
        return
      }
      notify('Torrent Added')
      navigateBackMaybe()
    },
  )
}

function addViaLegacy(result) {
  var magnet = getMagnetUri()
  var msg = {
    command: 'add-url',
    url: magnet,
    pageUrl: window.location.href,
  }

  if (result.full) {
    notify('Sending torrent to JSTorrent (legacy)')
    chrome.runtime.sendMessage(jstorrent_id, msg, function (response) {
      console.log('legacy add response', response)
      notify('Torrent Added')
      if (response && response.handled) {
        navigateBackMaybe()
      }
    })
  } else if (result.lite) {
    notify('Sending torrent to JSTorrent Lite (legacy)')
    chrome.runtime.sendMessage(jstorrent_lite_id, msg, function (response) {
      console.log('legacy lite add response', response)
      notify('Torrent Added')
      if (response && response.handled) {
        navigateBackMaybe()
      }
    })
  }
}

function showMigrationBanner(legacyResult) {
  getel('loadingIcon').style.display = 'none'
  getel('migration-banner').style.display = 'block'

  getel('migration-install').addEventListener('click', function (evt) {
    evt.preventDefault()
    window.open(EXTENSION_CWS_URL, '_blank')
  })

  getel('migration-use-legacy').addEventListener('click', function (evt) {
    evt.preventDefault()
    getel('migration-banner').style.display = 'none'
    addViaLegacy(legacyResult)
  })
}

function showInstallSection() {
  getel('loadingIcon').style.display = 'none'
  getel('install-div').style.display = 'block'

  getel('legacy-toggle').addEventListener('click', function (evt) {
    evt.preventDefault()
    var section = getel('legacy-links')
    if (section.style.display === 'none') {
      section.style.display = 'block'
      this.innerText = 'Hide legacy versions'
    } else {
      section.style.display = 'none'
      this.innerText = 'Looking for the legacy Chrome App?'
    }
  })
}

function showmag() {
  var mag = document.getElementById('magnet-link')
  var magdiv = document.getElementById('magnet-div')
  mag.href = parsed.magnet_uri
  magdiv.style.display = ''
}

function tryLegacyApps() {
  // Try full app first, then lite
  chrome.runtime.sendMessage(jstorrent_id, { command: 'checkInstalled' }, function (response) {
    console.log('checkInstalled result from jstorrent', response)
    if (response !== undefined) {
      // Legacy full app found — show migration banner
      showMigrationBanner({ full: true })
      return
    }
    chrome.runtime.sendMessage(
      jstorrent_lite_id,
      { command: 'checkInstalled' },
      function (response2) {
        console.log('checkInstalled result from jstorrent lite', response2)
        if (response2 !== undefined) {
          // Legacy lite app found — show migration banner
          showMigrationBanner({ lite: true })
        } else {
          // Nothing found at all
          notify('JSTorrent is not installed')
          showInstallSection()
        }
      },
    )
  })
}

function tryadd() {
  if (!window.parsed_magnet) {
    getel('loadingIcon').style.display = 'none'
    notify('No magnet link found in URL')
    return
  }
  if (!window.chrome) {
    notify('You need the Chrome browser for this to work. But here is the magnet link anyway')
    showmag()
    return
  }
  if (!(chrome.runtime && chrome.runtime.sendMessage)) {
    showInstallSection()
    return
  }

  showmag()
  notify('Looking for JSTorrent')

  // Try new extension first
  chrome.runtime.sendMessage(jstorrent_extension_id, { type: 'ping' }, function (response) {
    console.log('ping result from new extension', response)
    if (chrome.runtime.lastError) {
      console.log('new extension not found:', chrome.runtime.lastError.message)
    }
    if (response && response.installed) {
      // New extension found — send magnet directly
      addViaExtension()
    } else {
      // New extension not found — try legacy apps
      tryLegacyApps()
    }
  })
}

window.parsed_magnet = null
function dothings() {
  if (parsed.magnet_uri) {
    parsed_magnet = parse_magnet(parsed.magnet_uri)

    if (parsed_magnet && parsed_magnet.jstwn) {
      var a = document.createElement('a')
      a.href = document.referrer
      var result = {}
      if (a.origin == window.location.origin) {
        result.success = true
        result.jstwn = parsed_magnet.jstwn
      } else {
        result.error = true
      }
      window.name = JSON.stringify(result)
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
