chrome.i18n.getAcceptLanguages( function(l) {
    document.getElementById('territory').innerText = window.navigator.language + ': ' + l.join(', ')
})