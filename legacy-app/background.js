console.log('background.js')
var reload = chrome.runtime.reload
var MAINWIN = 'mainWindow2'
var _update_available = false
// the browser extension that adds a context menu
var extensionId = "bnceafpojmnimbnhamaeedgomdcgnbjk"


function app() {
    if (chrome.app && chrome.app.window.get) {
        var mw
        
        if (true) {
            var mw = chrome.app.window.get(MAINWIN)
        } else {
            var mw = chrome.app.window.getAll().filter( function(w) { return w.id == MAINWIN } )
            if (mw.length > 0)
                mw = mw[0]
        }

        if (mw && mw.contentWindow) {
            return mw.contentWindow.app
        }
    }
}

function getMainWindow() {
    return chrome.app.window.get && chrome.app.window.get(MAINWIN)
}


function WindowManager() {
    // TODO -- if we add "id" to this, then chrome.app.window.create
    // won't create it twice.  plus, then its size and positioning
    // will be remembered. so put it in.
    this.creatingMainWindow = false
    this.createMainWindowCallbacks = []
    this.mainWindow = chrome.app.window.get(MAINWIN)
}

WindowManager.prototype = {
    getMainWindow: function(callback) {
        // gets main window or creates if needed
        if (this.mainWindow) {
            callback(this.mainWindow)
        } else {
            this.createMainWindow( function() {
                callback(this.mainWindow)
            }.bind(this))
        }
    },
    createMainWindow: function(callback) {
        if (this.mainWindow) { 
            console.log('not creating main window, it already exists')
            return
        }

        if (this.creatingMainWindow) {
            // this can happen when we select multiple "torrent" files
            // in the files app and launch with JSTorrent.
            this.createMainWindowCallbacks.push(callback)
            return
        }
        this.creatingMainWindow = true
        var page = 'gui/index.html'
        //var page = 'polymer-ui/index.html'
        var opts ={
            outerBounds: { width: 865,
                           height: 610,
                           minWidth: 780,
                           minHeight: 200 },
            frame:{type:'chrome',
                   color:'#2191ed',
                   activeColor:'#2191ed',
                   inactiveColor: '#82c9ff'
                  },
            resizable: true,
            id: MAINWIN
        }
        console.log('creating main window',opts)
        chrome.app.window.create(page,
                                 opts,
                                 function(mainWindow) {
                                     ensureAlive()
                                     this.mainWindow = mainWindow
                                     this.creatingMainWindow = false
                                     mainWindow.onMinimized.addListener( this.onMinimizedMainWindow.bind(this) )
                                     mainWindow.onRestored.addListener( this.onRestoredMainWindow.bind(this) )
                                     
                                     mainWindow.onClosed.addListener( function() {
                                         this.onClosedMainWindow()
                                     }.bind(this))

                                     if (callback) { callback() }

                                     var cb
                                     while (this.createMainWindowCallbacks.length > 0) {
                                         cb = this.createMainWindowCallbacks.pop()
                                         cb()
                                     }

                                 }.bind(this)
			        );
    },
    onRestoredMainWindow: function() {
        console.log('main window restored. re-create UI')
        var app = this.mainWindow.contentWindow.app
        app.UI.undestroy()
        // restore the UI
    },
    onMinimizedMainWindow: function() {
        console.log('main window minimized. destroy UI')
        var app = this.mainWindow.contentWindow.app
        app.UI.destroy()
        // destroy the UI completely to free up memory
    },
    onClosedMainWindow: function() {
        console.log('onClosedMainWindow')

        if (_update_available) {
            chrome.runtime.reload()
        }
        
        this.mainWindow = null

        chrome.notifications.getAll( function(nots) {
            for (var key in nots) {
                chrome.notifications.clear(key)
            }
        })
        var opts = chrome.app.window.get('options')
        if (opts) { opts.close() }
        var help = chrome.app.window.get('help')
        if (help) { help.close() }
        
        if (window.mediaPort) {
            console.log('disconnecting media port')
            // send notification to media page that it's about to break.
            mediaPort.postMessage({error:"window closed"})
            mediaPort.disconnect()
        }
    }
}

var windowManager = new WindowManager
// if background page reloads, we lose reference to windowmanager main window...
//window.ctr = 0
function ensureAlive() {
    return
    // attempt to make this page not suspend, because that causes our retained directoryentry to become invalid
    if (! window.ensureAliveTimeout) {
        if (getMainWindow()) { // only when the page is alive
            window.ensureAliveTimeout = setTimeout( function() {
                window.ensureAliveTimeout = null;
                //window.ctr++
                //console.log('ensured alive')
                ensureAlive()
            }, 1000 )
        }
    }
}


chrome.app.runtime.onLaunched.addListener(function(launchData) {
    console.log('onLaunched with launchdata',launchData)
    var info = {type:'onLaunched',
                launchData: launchData}
    onAppLaunchMessage(info)
});

function launch() {
    onAppLaunchMessage({type:'debugger'})
}

function onAppLaunchMessage(launchData) {
    // launchData, request, sender, sendRepsonse

//    chrome.app.window.create("dummy.html", function(win) {
//        window.open('gui/index.html')
//        setTimeout(function() {
//            win && win.contentWindow.close()
//        }, 1e3)
//    })

    function onMainWindow(mainWindow) {
        mainWindow.contentWindow.app.registerLaunchData(launchData)
    }
    function onMainWindowSpecial(mainWindow) {
        // the app object has not been initialized
        if (! mainWindow.contentWindow.jstorrent_launchData) {
            mainWindow.contentWindow.jstorrent_launchData = []
        }
        mainWindow.contentWindow.jstorrent_launchData.push( launchData )
    }

    windowManager.getMainWindow( function(mainWindow) {
        // if window already existed...
        if (mainWindow.focus) {
            mainWindow.focus()
        } else {
            // WTF chrome.app.window.get doesnt even exist at this point
            // crash
            chrome.runtime.reload()
        }

        if (mainWindow.contentWindow.app) {
            onMainWindow(mainWindow)
        } else {
            onMainWindowSpecial(mainWindow)
        }
    })
}
/*
var BLOBS = []
function getBlobURL(entry, callback) {
    function onfile(file) {
        console.log('playable file',file)
        var url = (window.URL || window.webkitURL).createObjectURL(file)
        BLOBS.push(url) // when to destroy object url?
        callback(url)
    }
    entry.file(onfile,onfile)
}*/

function setup_uninstall() {
    try {
        chrome.runtime.setUninstallURL('https://new.jstorrent.com/comingsoon.html?ref=uninstall',
        // chrome.runtime.setUninstallURL('http://jstorrent.com/uninstall/?id=' + encodeURIComponent(chrome.runtime.id),
                                       function(result) {
                                           var lasterr = chrome.runtime.lastError
                                           if (lasterr) {
                                               console.warn('set uninstall url with result',result,'lasterr',lasterr)
                                           }
                                       }
                                      )
    } catch(e) {
        console.warn('error setting uninstall url',e)
    }
}

chrome.runtime.onInstalled.addListener(function(details) {
    console.log('onInstalled',details)
    var sk = 'onInstalledInfo'
    chrome.storage.sync.get('sk', function(syncresp) {
    chrome.storage.local.get(sk, function(resp) {
        var showUpdateNotification = false
        console.log('got previous install info',resp)

        var previous_updates = resp[sk]
        var changed = false
        var most_recent_update = null
        if (previous_updates && previous_updates.length > 0) {
            most_recent_update = previous_updates[previous_updates.length-1]
        }

        details.date = new Date().getTime()
        details.cur = chrome.runtime.getManifest().version

        if (syncresp['sk'] !== undefined) {
            showUpdateNotification = true
            chrome.storage.sync.remove("sk")
        }
        
        if (! previous_updates) {
            console.log('initializing install info')
            resp[sk] = [details]
            changed = true
        } else if (most_recent_update && most_recent_update.cur == details.cur) {
            // previousVersion missing?
        } else if (details.previousVersion == details.cur) {
            // happend because of chrome.runtime.reload probably
        } else {
            console.log('adding new install info',details)
            resp[sk].push(details)
            changed = true
            showUpdateNotification = true
        }

        if (resp[sk].length > 15) {
            // purge really old entries
            changed = true
            resp[sk].splice(0,1)
        }
        if (changed) {
            chrome.storage.local.set(resp, function(){console.log('persisted onInstalled info')})
        }

        if (showUpdateNotification) {
            doShowUpdateNotification(details, resp)
        }
    })
    })
    //details.reason // install, update, chrome_update
    //details.previousVersion // only if update
})
function fetchVersion() {
    var url = 'http://jstorrent.com/data/version.txt'
    function onload(evt) {
        console.log('fetch version response',evt)
        if (evt.target.status == 200) {
            var remoteversion = evt.target.response.trim()
            var curver = chrome.runtime.getManifest().version
            console.log('comparing server version',remoteversion,'to my version',curver)
            if (compareVersion(curver, remoteversion) < 0) {
                doShowUpdateAvailableDEV()
            }
        }
    }
    var xhr = new XMLHttpRequest
    xhr.onload = xhr.ontimeout = xhr.onerror = onload
    xhr.open("GET",url)
    xhr.send()
}
function compareVersion(version1, version2) {
    var a1 = version1.split('.').map(function(s){return parseInt(s)})
    var a2 = version2.split('.').map(function(s){return parseInt(s)})
    var n = Math.max(a1.length,a2.length)
    a1 = a1.concat( new Array(n-a1.length).fill(0) )
    a2 = a2.concat( new Array(n-a2.length).fill(0) )
    for (var i=0; i<n; i++) {
        if (a1[i] > a2[i]) {
            return 1
        } else if (a1[i] < a2[i]) {
            return -1
        }
    }
    return 0
}
function doShowUpdateAvailableDEV(details) {
    var msg = "Your version of " + chrome.i18n.getMessage("extName") + " is older than the one available in the Chrome Web Store. Install it there or manually update."
    chrome.notifications.create('update-available',
                                { title:chrome.i18n.getMessage("extName") + " Version Warning",
                                  type:"basic",
                                  priority:2,
                                  iconUrl: "js-128.png",
                                  message:msg,
                                  buttons:[
                                      {title:"Install", iconUrl:"cws_32.png"},
                                      {title:"Not now"}
                                  ]
                                }, function(id) {
                                    console.log('created notification with id',id,chrome.runtime.lastError)
                                })
    function onButtonClick(id, idx) {
        chrome.notifications.onButtonClicked.removeListener( onButtonClick )
        if (id == 'update-available') {
            if (idx == 0) {
                chrome.browser.openTab( { url: "https://chrome.google.com/webstore/detail/jstorrent/anhdpjpojoipgpmfanmedjghaligalgb" } )
            } else if (idx == 1) {
                // nothing
            }
        }
        chrome.notifications.clear('update-available')
    }
    chrome.notifications.onButtonClicked.addListener( onButtonClick )
}
function doShowUpdateAvailable(details) {
    // even though priority 2 it's not showing up in foreground on CrOS (maybe because created in background page?)
    var msg = "An update is available and will be installed the next time you restart " + chrome.i18n.getMessage("extName")
    chrome.notifications.create('update-available',
                                { title:chrome.i18n.getMessage("extName") + " Update",
                                  type:"basic",
                                  priority:2,
                                  iconUrl: "js-128.png",
                                  message:msg,
                                  buttons:[
                                      {title:"Install Now", iconUrl:"cws_32.png"},
                                      {title:"Later", iconUrl:"cws_32.png"}
                                  ]
                                }, function(id) {
                                    console.log('created notification with id',id,chrome.runtime.lastError)

                                })
    function onButtonClick(id, idx) {
        chrome.notifications.onButtonClicked.removeListener( onButtonClick )
        if (id == 'update-available') {
            if (idx == 0) {
                chrome.runtime.reload()
            }
        }
        chrome.notifications.clear('update-available')
    }
    chrome.notifications.onButtonClicked.addListener( onButtonClick )
}

function doShowUpdateNotification(details, history) {
    var currentVersion = details.cur
    var msg = chrome.i18n.getMessage("extName") + " has updated to version " + currentVersion

    chrome.notifications.create('update-installed',
                                { title:chrome.i18n.getMessage("extName") + " Updated",
                                  type:"basic",
                                  priority:2,
                                  iconUrl: "js-128.png",
                                  message:msg,
                                  buttons:[
                                      {title:"View changes", iconUrl:"cws_32.png"}
                                  ]
                                }, function(id) {
                                    console.log('created notification with id',id,chrome.runtime.lastError)

                                })
    function onButtonClick(id, idx) {
        chrome.notifications.onButtonClicked.removeListener( onButtonClick )
        if (id == 'update-installed') {
            var url = 'http://jstorrent.com/#changeLog'
            chrome.browser.openTab({url:url})
        }
        chrome.notifications.clear('update-installed')
    }
    chrome.notifications.onButtonClicked.addListener( onButtonClick )
}

chrome.runtime.onUpdateAvailable.addListener( function(details) {
    // notify that there's a new version? click to restart? nah...
    console.log('a new version is available:',details.version,details)
    _update_available = true
    if (DEVMODE) {
        doShowUpdateAvailableDEV(details)
    } else {
        doShowUpdateAvailable(details)
    }
})

/*
// detect if extension is installed... -- moved to js/app.js
chrome.runtime.sendMessage(extensionId, {running:true}, function(response) {
    console.log('got msg from extension',response, chrome.runtime.lastError)
})
*/

if (chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        console.log('chrome runtime message',request,sender)
        if (request && request.command == 'openWindow') {
            chrome.browser.openTab({url:request.url})
        }
    })
}

function checkForUpdateMaybe() {
    function docheck() {
        console.log('check for update')
        chrome.storage.local.set({'lastUpdateCheck':Date.now()})
        if (DEVMODE) {
            fetchVersion()
        } else {
            chrome.runtime.requestUpdateCheck(function(result){
                console.log('update check:', result)
            })
        }
    }
    chrome.storage.local.get('lastUpdateCheck', function(d) {
        var lastcheck = d['lastUpdateCheck']
        var willcheck = false
        if (lastcheck) {
            if (Date.now() - lastcheck > 1000 * 60 * 20) {
                willcheck = true
            }
        } else {
            willcheck = true
        }
        if (willcheck) {
            docheck()
        } else {
            console.log('will not check for update')
        }
    })
}

if (chrome.runtime.onMessageExternal) {
chrome.runtime.onMessageExternal.addListener(function(request, sender, sendResponse) {
    console.log('onMessageExternal',request,sender)
    if (request && request.command == 'checkInstalled') {
        sendResponse( {handled:true,
                       installed: true,
                       id: chrome.runtime.id,
                       version: chrome.runtime.getManifest().version})
        return
    } else if (request && request.command == 'add-url') {
        // External messages come from a browser Extension that adds a right click
        // context menu so that this App can handle magnet links.
        var info = {type:'onMessageExternal',
                    request: request,
                    sender: sender,
                    sendResponse: sendResponse}
        onAppLaunchMessage(info)

        sendResponse({ handled: true, 
                       id: chrome.runtime.id, 
                       version: chrome.runtime.getManifest().version
                     })
    } else if (request && request.command == 'getStatus') {
        var resp = { version: chrome.runtime.getManifest().version
                   }
        var a = app()
        if (a && a.webapp) {
            resp.webapp = a.webapp.get_info()
        }
        sendResponse(resp)
    } else {
        sendResponse({ handled: false,
                       id: chrome.runtime.id, 
                       version: chrome.runtime.getManifest().version,
                       message: 'unknown command' })
    }
});
}


if (chrome.runtime.onConnectExternal) {
    chrome.runtime.onConnectExternal.addListener( function(port) {
        var authorized = true
        if (authorized) {
            console.log('received authorized port',port)
            try{
                if (window.mediaPort) {
                    // disconnect the other port
                    mediaPort.postMessage({error:"another port is opening"}) // might already be disconnected.
                    mediaPort.disconnect()
                }
            }catch(e){
                console.warn("port was already disconnected")
            }
            window.mediaPort = port
            port.onMessage.addListener( function(msg) {
                var a = app()
                if (a) {
                    a.client.handleExternalMessage(msg, port)
                } else {
                    port.postMessage({error:"no app"})
                    console.warn('no app, could not handle external message')
                }
            })
            port.onDisconnect.addListener( function(msg) {
                console.log('external ondisconnect',msg)
                window.mediaPort = null
            })
            port.postMessage({text:"OK"})
        } else {
            console.error('unauthorized port',port)
            port.disconnect()
        }
    })
}

chrome.runtime.onStartup.addListener( function(evt) {
    console.log('onStartup',evt)
})
chrome.runtime.onSuspend.addListener( function(evt) {
    var a = app()
    if (a) {
        a.runtimeMessage('onSuspend')
    }
    console.log('onSuspend',evt)
    // maybe try to stop it?
    // triggerKeepAwake()
})

function triggerKeepAwake() {
    // creating a notification also works?
    // HACK: make an XHR to cause onSuspendCanceled event
    console.log('triggerKeepAwake')
    if (false) {
        var xhr = new XMLHttpRequest
        xhr.open("GET","http://127.0.0.1:8000" + '/dummyUrlPing')
        function onload(evt) {
            console.log('triggerKeepAwake XHR loaded',evt)
        }
        xhr.onerror = onload
        xhr.onload = onload
        xhr.send()
    } else {
        // this keeps it alive consistently as long as you down close the notification (chromeos)
        chrome.notifications.create('keepawake',{priority:2,title:"jstorrent",message:"keepawake!",iconUrl:'/js-128.png',type:'basic'})
    }
}


chrome.runtime.onSuspendCanceled.addListener( function(evt) {
    var a = app()
    if (a) {
        a.runtimeMessage('onSuspendCanceled')
    }
    console.log('onSuspendCanceled',evt)
})
/* // this will cause the background page to wake up every time it changes. not necessary
if (chrome.idle && chrome.idle.onStateChanged) {
    chrome.idle.onStateChanged.addListener( function(evt) {
        console.log('idle state changed',evt)
    })
}*/
chrome.app.runtime.onRestarted.addListener( function(evt) {
    console.log('app onRestarted',evt)
})

if (chrome.runtime.setUninstallURL && ! DEVMODE) {
    setup_uninstall()
}



// =============================================================================
// Migration Notice (December 2025)
// Chrome Apps are being retired. Notify users about the new version.
// =============================================================================

const COMING_SOON_URL = 'https://new.jstorrent.com/comingsoon.html'
const EXTENSION_CWS_URL = 'https://chromewebstore.google.com/detail/jstorrent-helper-extensio/bnceafpojmnimbnhamaeedgomdcgnbjk'

// Feature flag - set to true when extension passes review
const EXTENSION_AVAILABLE = false

chrome.runtime.onInstalled.addListener(function(details) {
    if (details.reason === 'update') {
        chrome.storage.local.set({ migrationNoticePending: true })
    }
})

chrome.runtime.onStartup.addListener(function() {
    maybeShowMigrationNotice()
})

chrome.app.runtime.onLaunched.addListener(function() {
    maybeShowMigrationNotice()
})

function maybeShowMigrationNotice() {
    chrome.storage.local.get(['migrationNoticePending', 'migrationNoticeDismissed'], function(result) {
        if (!result.migrationNoticePending) return
        if (result.migrationNoticeDismissed) return
        
        chrome.runtime.getPlatformInfo(function(info) {
            var message
            if (info.os === 'cros') {
                message = 'Chrome Apps are being retired. JSTorrent will stop working in a future Chrome update.'
            } else {
                message = 'Chrome Apps no longer work on this platform.'
            }
            
            if (EXTENSION_AVAILABLE) {
                message += ' Join the waitlist or install our extension to get notified when the new version is ready.'
            } else {
                message += ' Join the waitlist to get notified when the new version is ready.'
            }
            
            var buttons = [{ title: 'Join Waitlist' }]
            if (EXTENSION_AVAILABLE) {
                buttons.push({ title: 'Get Extension (No Email)' })
            }
            buttons.push({ title: 'Remind Me Later' })
            
            chrome.notifications.create('migration-notice', {
                type: 'basic',
                iconUrl: 'js-128.png',
                title: 'JSTorrent is Moving',
                message: message,
                priority: 2,
                requireInteraction: true,
                buttons: buttons
            })
        })
    })
}

chrome.notifications.onButtonClicked.addListener(function(id, buttonIndex) {
    if (id !== 'migration-notice') return
    
    if (EXTENSION_AVAILABLE) {
        // Three buttons: Waitlist, Extension, Remind
        if (buttonIndex === 0) {
            chrome.browser.openTab({ url: COMING_SOON_URL + '?ref=app-notification' })
            setMigrationDismissed()
        } else if (buttonIndex === 1) {
            chrome.browser.openTab({ url: EXTENSION_CWS_URL })
            setMigrationDismissed()
        }
        // buttonIndex === 2 is "Remind Me Later" - do nothing, will show again
    } else {
        // Two buttons: Waitlist, Remind
        if (buttonIndex === 0) {
            chrome.browser.openTab({ url: COMING_SOON_URL + '?ref=app-notification' })
            setMigrationDismissed()
        }
        // buttonIndex === 1 is "Remind Me Later" - do nothing, will show again
    }
    
    chrome.notifications.clear(id)
})

chrome.notifications.onClicked.addListener(function(id) {
    if (id !== 'migration-notice') return
    
    // Clicked notification body - treat as "Join Waitlist"
    chrome.browser.openTab({ url: COMING_SOON_URL + '?ref=app-notification' })
    setMigrationDismissed()
    chrome.notifications.clear(id)
})

function setMigrationDismissed() {
    chrome.storage.local.set({ 
        migrationNoticePending: false,
        migrationNoticeDismissed: true 
    })
}