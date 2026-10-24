console.log('isinstalled?', chrome.app.isInstalled)

var link = 'https://chrome.google.com/webstore/detail/anhdpjpojoipgpmfanmedjghaligalgb'

document.getElementById('inline-install').addEventListener('click', function (evt) {
  if (chrome && chrome.webstore && chrome.webstore.install) {
    chrome.webstore.install(
      link,
      function (r) {
        console.log('install success', r)
        document.getElementById('inline-install').style.display = 'none'
      },
      function (r) {
        console.log('install failure')
      },
    )
    evt.preventDefault()
  } else {
    window.location = link
  }
})
