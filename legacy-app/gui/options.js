document.addEventListener("DOMContentLoaded", onready);
var options = null
var app = null

function bind_events() {
    $('[data-toggle="tooltip"]').tooltip({'delay': { show: 50, hide: 200 }})
    $//('#button-choose-download').prop('disabled',false)
    $//('#button-setup-magnet').prop('disabled',false)
    $('#button-setup-magnet').click( function(evt) {
        chrome.browser.openTab({url:'http://jstorrent.com/magnet/'})
        evt.preventDefault()
    })
    
    $('#button-choose-download').click( function(evt) {
        var opts = {'type':'openDirectory'}

        chrome.fileSystem.chooseEntry(opts,
                                      function(entry){
                                          options.on_choose_download_directory(entry)
                                          updateLocation()
                                          if (pulsateInterval) {
                                              clearInterval(pulsateInterval)
                                          }
                                      }
                                     )
        evt.preventDefault()
        evt.stopPropagation()
    })

    $('#request-identity').click( function(evt) {
        console.log(chrome.runtime.lastError)
        chrome.permissions.request({permissions:['identity']},
                                   function(result){console.log('grant result',result)
                                                    console.log(chrome.runtime.lastError)
                                                    chrome.identity.getAuthToken({interactive:true}, function(idresult) {
                                                        console.log('id result',idresult)
                                                    })
                                                   })
        console.log(chrome.runtime.lastError)
        
    })
}

function OptionDisplay(opts) {
    this.opts = opts
}
OptionDisplay.prototype = {
    getHTML: function() {
        if (this.opts.meta.enabled === false) { return }
        if (this.opts.meta.visible === false) { return }

        var s = 'Unsupported Option Type: ' + this.opts.meta.type + ' - ' + this.opts.key
        if (this.opts.meta.type == 'bool') {
            s = '<div class="checkbox">'
            if (this.opts.meta.help) {
                s+='<label data-toggle="tooltip" title="'+this.opts.meta.help+'">'
            } else {
                s+='<label>'
            }
            s+=
                '<input type="checkbox" ' + (this.opts.val ? 'checked="checked"' : '') + '>' + this.getName() +
                '</label>' + 
                '</div>';
        } else if (this.opts.meta.type == 'int') {
            s = '<div class="input"><label><input id="'+this.opts.key+'" size="3" type="number" min="'+this.opts.meta.minval+'" max="'+this.opts.meta.maxval+'" value="'+this.opts.val+'"></input><span data-toggle="tooltip" title="'+this.opts.meta.help+'"> ' + this.getName() + '</span></label></div>'
        } else {
            debugger
        }

        if (this.opts.meta.children) {
            s += '<div>... children</div>'
        }

        if (this.opts.meta.help) {
            //s+='<style="display:none" div class="tooltip"><div class="tooltip-inner">'+escape(this.opts.meta.help)+'</div><div class="tooltip-arrow"></div></div>'
            //s+='<div style="display:none" class="mytooltip">'+this.opts.meta.help+'</div>'
            // fix this later...
        }
        return s
        //var el = $(s)
        //return el
    },
    getName: function() {
        return this.opts.meta.name || this.opts.key
    },
    onInput: function(evt) {
        var rawval = evt.target.value
        var val = parseInt(rawval)
        console.log(this.opts.key, 'got new intval',val,'from',rawval)
        if (! isNaN(val)) {
            this.opts.options.set(this.opts.key, val)
            var resetval = null
            if (val < 1) {
                resetval = 1
            }
            if (val > 200) {
                resetval = 200
            }
            if (resetval) {
                evt.target.value = resetval
                this.opts.options.set(this.opts.key, resetval)
            }
        } else {
        }
    },
    inputChanged: function(evt) {
        console.log('input changed',evt)
        if (this.opts.meta.type == 'bool') {

            if ($('input',this.el).is(':checked')) {
                this.opts.options.set(this.opts.key, true)
            } else {
                this.opts.options.set(this.opts.key, false)
            }
        } else if (this.opts.meta.type == 'int') {
            var val = parseInt( evt.target.value )
            if (! isNaN(val)) {
                this.opts.options.set(this.opts.key, val)
            } else {
                evt.target.value = this.opts.meta['default']
                this.opts.options.set(this.opts.key, this.opts.meta['default'])
            }
        } else {
            console.log('unsupported set option', evt.target.value)
        }

        //evt.preventDefault()
        //evt.stopPropagation()
    }
}

function OptionsView(opts) {
    this.opts = opts
    this.options = opts.options
    this.elid = opts.elid
    this.el = document.getElementById(this.elid)

    var keys = this.options.keys() // sort ?

    // move maxconns to be the first option
    keys.splice(keys.indexOf('maxconns'),1)
    keys = ['maxconns'].concat(keys)
    
    var cur, curdom

    for (var i=0; i<keys.length; i++) {
        console.log('opt',keys[i], this.options.get(keys[i]))

        cur = new OptionDisplay( { key: keys[i],
                                   options: this.options,
                                   meta: this.options.app_options[keys[i]],
                                   val: this.options.get(keys[i]) } )
        curdom = cur.getHTML()
        if (curdom) {
            var span = document.createElement('span')
            span.innerHTML = curdom
            this.el.appendChild(span)
            var $el = $(span)
            cur.el = $el
            $el.hover( function(h) {
                // fix this later
                if (h.type == 'mouseenter') {
                    $('.mytooltip',$el).show()
                } else {
                    $('.mytooltip',$el).hide()
                }
            })

            //$('input', el).change( _.bind(this.inputChanged, this) )
            if (cur.opts.meta.type == 'int') {
                document.getElementById(cur.opts.key).addEventListener('input', cur.onInput.bind(cur) )
            } else {
                $('input[type=checkbox]', $el).change( cur.inputChanged.bind(cur) )
            }
        }
    }
}

var pulsateInterval = null

function onready() {
    console.log("This is Options window(onready)")

    if (chrome.runtime.id == jstorrent.constants.jstorrent_lite) {
        $("#full_version_upsell").show()
    }

    function pulse() {
        $('#button-choose-download').twinkle(
            { effect:'drop-css', 
              effectOptions: {radius:150},
              callback: function(){}
            }
        )
    }

    getBackgroundAndApp( function(bg, app, tries) {
        window.app = app
        console.log('got bg and app',bg, app, 'after',tries,'tries')
        setTimeout( function() {
            bg.checkForUpdateMaybe()
        }, 2000 )
        window.options = app.options

        if (app.client.disks.items.length == 0) {
            pulsateInterval = setInterval( pulse, 2000)
            pulse()
        } else {
            updateLocation()
        }

        window.optionsDisplay = new OptionsView({elid: 'auto_options',
                                                 options: window.app.options,
                                                 app: window.app})
                                                 
        bind_events()
    })
}

function getBackgroundAndApp(callback) {
    var timeout
    var tries = 0
    chrome.runtime.getBackgroundPage(function(bg){

        function dotry() {
            tries++
            var app
            try {
                app = bg.app()
            } catch(e){
                console.warn(e)
            }

            if (app) {
                callback(bg, app, tries)
            } else {
                console.log('still no app ...',tries)
                timeout = setTimeout(dotry, 100)
            }
        }

        dotry()
    })
}

function updateLocation() {
    var defaultLocation = app.client.disks.getAttribute('default')
    var parts = defaultLocation.split(':')
    parts.shift()
    var disk = app.client.disks.get(defaultLocation)
    if (disk) {
        var displaypath = disk.get('entrydisplaypath')
    } else {
        var displaypath = '(Missing)'
    }
    if (displaypath) {
        $("#current-location").text('Current Location: ' + displaypath)
    } else {
        $("#current-location").text('Current Location: ' + parts.join(':'))
    }


}
