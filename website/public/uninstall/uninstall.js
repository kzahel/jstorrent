function getel(id) {
  return document.getElementById(id)
}
var banner_h = 75
function ondom() {
  console.log('dom ready')
  window.addEventListener('resize', onresize)
  getel('iframe').style.height = window.innerHeight - banner_h + 'px'
  getel('iframe').onload = onresize
}
function onresize(evt) {
  getel('iframe').style.height = window.innerHeight - banner_h + 'px'
}
document.addEventListener('DOMContentLoaded', ondom)
