function ondom(evt) {
  console.log('dom loaded', evt)
  document.getElementById('setupMagnetHandler').addEventListener('click', setupMagnetHandler)
  document.getElementById('clearMagnetHandler').addEventListener('click', clearMagnetHandler)
  document
    .getElementById('clearSetupMagnetHandler')
    .addEventListener('click', clearSetupMagnetHandler)
  document.getElementById('testMagnetHandler').addEventListener('click', testMagnetHandler)
  document.getElementById('testMagnetHandler2').addEventListener('click', testMagnetHandler2)
  document.getElementById('postAMessage').addEventListener('click', postAMessage)
}
document.addEventListener('DOMContentLoaded', ondom)

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
var testmagnet =
  Protocol +
  ':?xt=urn:btih:3f19b149f53a50e14fc0b79926a391896eabab6f&dn=ubuntu-15.10-desktop-amd64.iso'
var testmagnet = Protocol + ':?testRegistered'

function postAMessage() {
  window.postMessage('Hello from magnet.js!', window.location.origin)
}

window.addEventListener('message', onMessage, false)
function onMessage(evt) {
  if (evt.source == window) {
    return
  }
  console.log('got a postMessage from an iframe', evt)
}
//window.postMessage("I run magnet.js", window.location.origin)
//window.postMessage("I run magnet.js", '*')
ctr = 0
function status(msg) {
  ctr++
  console.log('STATUS', ctr, msg)
  document.getElementById('status').innerText = ctr + ' ' + msg
}

function testMagnetHandler() {
  var iframe = document.createElement('iframe')
  var timeout
  //iframe.width=1
  //iframe.height=1
  //iframe.style="border:0px"
  //iframe.style="display:none"
  iframe.src = testmagnet
  function onload(evt) {
    clearTimeout(timeout)
    var iframehref
    try {
      iframehref = iframe.contentWindow.location.href
    } catch (e) {
      status('NO!!! (exception)', e.name)
      console.log('magnet is setup, but ...', e.name, e.message)
      return
    }

    if (handlerFullUrl + encodeURIComponent(testmagnet) == iframehref) {
      status('YES! MAGNET HANDLER SETUP!')
    } else {
      status('NO!!!!!! NOT SETUP!')
    }
    //iframe.parentNode.removeChild(iframe)
  }
  function ontimeout(evt) {
    status('NO! (timeout) NOT SETUP!')
    //iframe.parentNode.removeChild(iframe)
  }
  iframe.onload = onload
  document.body.appendChild(iframe)
  //console.log('checking iframe has parent',iframe.contentWindow.parent.location.href == window.location.href)
  timeout = setTimeout(ontimeout, 1000)
  //console.log('checking iframe has loaded about:blank',iframe.contentWindow.parent.location.href == 'about:blank')
}

function testMagnetHandler2() {
  return
  var iframe = document.createElement('iframe')
  window.iframe = iframe
  iframe.width = 300
  iframe.height = 300
  iframe.style.border = '1px solid black'

  function onload(evt) {
    console.log('iframe onload', evt, 'domloaded?', iframe.contentWindow.domloaded)
    console.log('iframe location is:', iframe.contentWindow.location)
    //iframe.contentWindow.addEventListener('DOMContentLoaded', function(){console.log('iframe dom loaded')})
    //iframe.contentWindow.postMessage("message to share.js from magnet.js. hi!",'*')
  }
  function onerror(evt) {
    console.log('iframe onerror', evt)
  }
  function ontimeout(evt) {
    console.log('iframe ontimeout', evt)
  }
  function onreadystatechange(evt) {
    console.log('iframe ready state change', evt)
  }
  iframe.onload = onload
  iframe.onerror = onerror
  iframe.ontimeout = ontimeout
  iframe.onreadystatechange = onreadystatechange
  //iframe.src = window.location.origin + '/magnet/'
  iframe.src = testmagnet
  document.body.appendChild(iframe)
  console.log('iframe parent is this:', iframe.contentWindow.parent.location.href)

  iframe.contentWindow.addEventListener('message', function (evt) {
    console.log('message from iframe content window', evt)
  })
  console.log('iframe contentwindow:', iframe.contentWindow)
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
