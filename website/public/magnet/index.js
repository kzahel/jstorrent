function getel(id) {
  return document.getElementById(id)
}
function ondom() {
  console.log('dom loaded')
  Array.prototype.forEach.call(document.querySelectorAll('a.magnet'), function (elt) {
    elt.addEventListener('click', function (evt) {
      setTimeout(checkClickDidAnything, 1)
    })
  })

  if (window.name) {
    var result = JSON.parse(window.name)
    console.log('got window.name result', result)
    if (result && result.jstwn == 'tml') {
      console.log('it looks setup.')
      window.name = ''
      //getel('setup').classList.add('fadeOut')
      getel('setup').style.visibility = 'hidden'
      getel('allgood').style.display = 'block'
      //getel('allgood').classList.add('fadeIn')
      return
    }
  }

  if (false && !navigator.userAgent.match('CrOS')) {
    // on windows, .click() doesnt do anything. on mac, seems to work. on chromeos, if protocol ignored system wide, opens blank tab with url
    // so doesnt work
    tryAutotest()
  }
  setTimeout(function () {
    getel('setup').style.visibility = 'visible'
  }, 1)
}
registerHandler()

function tryAutotest() {
  getel('magnet1').click()
}

function checkClickDidAnything() {
  console.log('check if it did anything...')
  // we use two set timeouts to prevent the bubble (remove isTrusted event from click)
  setTimeout(registerHandler, 1)
}

function registerHandler() {
  var handlerPath = '/add/'
  var handlerArgument = '#magnet_uri='
  var handler
  var handlerFullUrl = window.location.origin + handlerPath + handlerArgument
  var Protocol = 'magnet'
  var ARGS = [Protocol, handlerFullUrl + '%s', 'JSTorrent']
  console.log('request register handler', ARGS)
  navigator.registerProtocolHandler(ARGS[0], ARGS[1], ARGS[2])
}

document.addEventListener('DOMContentLoaded', ondom)
