function getel(id) {
  return document.getElementById(id)
}

window.nextCheck = null
window.nextCheckCount = 0
function allgood() {
  getel('status').innerText = 'You are all setup! JSTorrent is handling magnet links!'
  getel('loadingIcon').style.display = 'none'
  getel('setupButton').style.display = 'none'
  getel('tips').style.display = ''
}

function startPolling() {
  if (window.nextCheck) {
    clearTimeout(nextCheck)
  }
  nextCheckCount = 0
  checkPollingResult()
}
function checkPollingResult(info) {
  console.log('checkpollingresult', info)
  if (info && info.result) {
    console.log('ALL GOOD NOW!')
    allgood()
  } else {
    console.log('still no good')
    nextCheckCount++
    if (nextCheckCount > 3) {
      getel('status').innerHTML =
        'We couldn\'t set it up! <br />Put <span style="margin-left:1em;margin-right:1em; font-family:monospace">chrome://settings/handlers</span> into the URL bar, and remove the ignore setting for magnet protocol.'
      getel('loadingIcon').style.display = 'none'
    } else {
      nextCheck = setTimeout(function () {
        testMagnetHandler(1000, checkPollingResult)
      }, 1000)
    }
  }
}

function ondom() {
  console.log('dom loaded')

  getel('status').innerText = 'Checking if JSTorrent can handle magnet links...'
  getel('setupButton').addEventListener('click', function (evt) {
    evt.target.blur()
    console.log('setup button click')
    getel('loadingIcon').style.display = ''
    setupMagnetHandler()
    startPolling()
    // start polling to see what they did with the dialog...
  })

  testMagnetHandler(2500, function (info) {
    if (info && info.result) {
      allgood()
    } else {
      getel('status').innerText =
        'JSTorrent is not configured to handle magnet links. You need to set it up.'
      getel('loadingIcon').style.display = 'none'
      getel('setupButton').style.display = ''
    }
  })
}

var handlerPath = '/share/'
var handlerArgument = '#magnet_uri='
var handler
var handlerFullUrl = window.location.origin + handlerPath + handlerArgument
var Protocol = 'magnet'
var ARGS = [
  Protocol,
  handlerFullUrl + '%s', //"http://jstorrent.com/share/#magnet_uri=%s",
  'JSTorrent',
]
navigator.registerProtocolHandler(ARGS[0], ARGS[1], ARGS[2])
//var testmagnet = Protocol+':?xt=urn:btih:3f19b149f53a50e14fc0b79926a391896eabab6f&dn=ubuntu-15.10-desktop-amd64.iso'
//var testmagnet = Protocol+':?xt=urn:btih:3f19b149f53a50e14fc0b79926a391896eabab6f&dn=ubuntu-15.10-desktop-amd64.iso'
var testmagnet =
  Protocol + ':?xt=urn:btih:0000000000000000000000000000000000000000&dn=Test.File.Test.Magnet.Link'
var testmagnet = Protocol + ':?testRegistered'

function testMagnetHandler(timeoutMs, callback) {
  var iframe = document.createElement('iframe')
  var timeout
  iframe.style = 'display:none'
  iframe.src = testmagnet
  function onload(evt) {
    clearTimeout(timeout)
    var iframehref
    try {
      iframehref = iframe.contentWindow.location.href
    } catch (e) {
      callback({ result: false, error: e.name })
      return
    }

    if (handlerFullUrl + encodeURIComponent(testmagnet) == iframehref) {
      callback({ result: true })
    } else {
      callback({ result: false, url: iframehref })
    }
    iframe.parentNode.removeChild(iframe)
  }
  function ontimeout(evt) {
    callback({ result: false, error: 'timeout' })
    iframe.parentNode.removeChild(iframe)
  }
  iframe.onload = onload
  document.body.appendChild(iframe)
  timeout = setTimeout(ontimeout, timeoutMs)
}

function clearSetupMagnetHandler() {
  clearMagnetHandler()
  setupMagnetHandler()
}

function clearMagnetHandler() {
  if (navigator.unregisterProtocolHandler) {
    navigator.unregisterProtocolHandler(ARGS[0], ARGS[1], ARGS[2])
  }
}
function setupMagnetHandler() {
  if (navigator.registerProtocolHandler) {
    navigator.registerProtocolHandler(ARGS[0], ARGS[1], ARGS[2])
  }
}

document.addEventListener('DOMContentLoaded', ondom)
