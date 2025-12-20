// test
function successHandler(d) { console.log('buy success',d) }
function failureHandler(d) { console.log('buy failure',d) }

function purchase() {
    google.payments.inapp.buy({
        parameters: {env:'prod'},
        'jwt':'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJhdWQiOiAiR29vZ2xlIiwgImlzcyI6ICIxMzcxNDI5MzY1OTA4OTU0NDU4MCIsICJyZXF1ZXN0IjogeyJjdXJyZW5jeUNvZGUiOiAiVVNEIiwgInByaWNlIjogIjEwLjAwIiwgInNlbGxlckRhdGEiOiAidXNlcl9pZDoxMjI0MjQ1LG9mZmVyX2NvZGU6MzA5ODU3Njk4NyxhZmZpbGlhdGU6YWtzZGZib3Z1OWoiLCAibmFtZSI6ICJQaWVjZSBvZiBDYWtlIiwgImRlc2NyaXB0aW9uIjogIlZpcnR1YWwgY2hvY29sYXRlIGNha2UgdG8gZmlsbCB5b3VyIHZpcnR1YWwgdHVtbXkifSwgImV4cCI6ICIxNDg5NjY1MDk0IiwgImlhdCI6ICIxMzg5NjY1MDk0IiwgInR5cCI6ICJnb29nbGUvcGF5bWVudHMvaW5hcHAvaXRlbS92MSJ9.k1NE7f8N7YA5blXJav96ezbFxYykjhi7p7q7wvjhv7s',
        'success' : successHandler,
        'failure' : failureHandler
    });
}

$(document).ready( function() {
    console.log('help page ready')
    // TODO - send analytics event
    //document.getElementById('sponsor').addEventListener('click', purchase)

    chrome.runtime.getBackgroundPage( function(bg) {
        bg.window.windowManager.getMainWindow(function(window){
            document.getElementById('version').innerText = window.contentWindow.client.version
            document.getElementById('user-agent').innerText = navigator.userAgent;
            document.getElementById('x-user-agent').innerText = window.contentWindow.client.getUserAgent();
            document.getElementById('peerid').innerText = window.contentWindow.client.peeridbytes_begin;
        })
    })

})