document.addEventListener('DOMContentLoaded', function (event) {
  onload()
})

function ondownloadclick() {}

function onload() {
  var elts = document.querySelectorAll('.js-download')
  if (elts) {
    for (var i = 0; i < elts.length; i++) {
      elts[i].addEventListener('click', function (evt) {
        var _this = this
        ga('send', 'event', 'Clicks', 'Download', {
          hitCallback: function () {
            console.log('sent clicks download event', evt, _this)
            window.location = _this.href
          },
        })
        evt.preventDefault()
        return false
      })
    }
  }

  if (navigator.registerProtocolHandler) {
    navigator.registerProtocolHandler(
      'magnet',
      'http://jstorrent.com/add/#magnet_uri=%s',
      'JSTorrent',
    )
  }
}
