document.getElementById("OK").addEventListener('click', function(evt) {
    var val = document.getElementById("text").value
    chrome.app.window.get(MAINWIN).contentWindow.app.addTracker(val)
    chrome.app.window.current().close()
})

document.getElementById("Cancel").addEventListener('click', function(evt) {
    chrome.app.window.current().close()
})
