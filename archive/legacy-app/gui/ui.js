function UI(opts) {
    function intDontShowZero(val) {
        return val?val:''
    }
    function pathFormat(path) {
        // if we had torrent reference we could make this cleaner..
        if (path.length > 1) {
            return path.slice(1,path.length).join('/')
        } else {
            return ''
        }
    }
    function formatClientName(val) {
        return val
    }
    function fracToPercent(val) {
        if (val === undefined || val === null || val == 0 || isNaN(val)) { return '' }
        if (val == 1) {
            return '100%'
        } else if (val < .01) {
            return (val * 100).toFixed(1) + '%';
        } else if (val > 0.99) {
            var rounded = (val * 100).toFixed(1)
            if (rounded == '100.0') {
                return '99.9%'
            } else {
                return rounded + '%';
            }
        } else {
            return (val * 100).toFixed(0) + '%';
        }
    }
    window.fracToPercent = fracToPercent
    function priority(val) {
        return val == 0 ? 'Skip' : ''
    }
    function displayTorrentName(torrent) {
        return torrent.get('name') || torrent._opts.url || torrent.hashhexlower
    }
    function fileAction(val) {
        // this only returns the html, but app.handle_click is adding an event listener
        // set the class action to determine what happens
        var streamable = val.streamable()
        var openable = val.openable()
        var findapps = val.shouldfindapps()
        var is_mkv = val.get_extension() == 'mkv'

        var parts = []
        if (is_mkv && app.webapp) {
            // mkv are not opening inline for some reason. use the stream page instead.
            parts.push('<a class="action-stream" href="#"><span class="glyphicon glyphicon-play"></span>Stream(beta)</a>')
        } else if (val.isComplete()) {
            if (streamable) {
                // detect if chromecast extension?
                parts.push('<a class="action-open" href="#"><span class="glyphicon glyphicon-play"></span>Play</a>')
                //parts.push('<a class="action-open" href="#"><span class="glyphicon glyphicon-file"></span>Open</a>')
                parts.push('<a class="action-cast" href="#"><span class="glyphicon glyphicon-play-circle"></span>Cast</a>')
            } else if (openable) {
                parts.push('<a class="action-open" href="#"><span class="glyphicon glyphicon-file"></span>Open</a>')
            } else if (findapps) {
                parts.push('<a class="action-findapp" href="#"><span class="glyphicon glyphicon-th-large"></span>Get App</a>')
            }
        } else if (streamable && app.webapp) {
            parts.push('<a class="action-stream" href="#"><span class="glyphicon glyphicon-play"></span>Stream(beta)</a>')
        }
        return parts.join(' ')
    }

    this.client = opts.client

    this.detailtable = null
    //var default_tab = 'peers' // TODO -- remember last
    var default_tab = 'files'
    this.detailtype = default_tab

    this.coldefs = {
        'torrent': [
            {id: "name", name: "Name", displayFunc: displayTorrentName, width:400, sortable:true},
            {id: "state", name: "Status", sortable:true},
            {id:'downspeed', name: "Down Speed", width:90, formatVal: byteUnitsSec, type:'number'},
            {id: "complete", name: "Complete", formatVal: fracToPercent, type:'number'},
            {id: "bytes_received", name: "Downloaded", formatVal: byteUnits, width:100, type:'number'},
            {id: "size", name: "Total Size", formatVal: byteUnits, width: 100, sortable:true, type:'number'},
            {id:'eta', name: "ETA", formatVal: formatValETA, width:50, type:'number'},
            {id: "numpeers", formatVal: intDontShowZero, width: 50, name: "Peers", type:'number'},
            {id: "bytes_sent", name: "Uploaded", formatVal: byteUnits, type:'number'},
            {id:'upspeed', name:"Up Speed", formatVal: byteUnitsSec, type:'number'},
            {id: 'downloaded', name:"Saved", formatVal:byteUnits, type:'number'},
            {id: "added", name:"Added On", width:185,sortable:true},
            {id: "numswarm", name: "Swarm", hidden:false, type:'number'}
        ],
        'peers':[
            {id:"socketId", name: "Socket", width:50, type:'number'},
            {name:"Address", id:"address", width:125},
            {name:"Client", id:'peerClientName', formatVal: formatClientName, width:125},
            {id:"state", name: "State", width:90},
            {id:"complete", name: "Complete", formatVal: fracToPercent, type:'number'},
            {id:"bytes_sent", name: "Sent", type:'number', formatVal: byteUnits},
            {id:"bytes_received", name: "Received", type:'number', formatVal: byteUnits},
            {id:'downspeed', name: "Down Speed", width:90, formatVal: byteUnitsSec, type:'number'},
            //{id:'upspeed', formatVal: byteUnitsSec},
            {id:'requests', name:"Req", width:50, type:'number'},
            {id:'responses', name:"Resp", width:50, type:'number'},
            {id:'outstanding', name:"Outstanding", width:50, type:'number'},
//            {id:'limit', name:"Limit", width:50, sortable:false},
            {id:"last_message_sent", name: "Last Sent"},
            {id:"last_message_received", name: "Last Received", width:120},
            {id:'timeouts', name:"Timeouts", type:'number'},
            {id:"amChoked", type:'number'},
            {id:"peerChoked", type:'number'}
        ],
        'swarm':[
            {attr:"host", name:"Host", width:110, sortable:true},
            {attr:"port", name:"Port", sortable:true, type:'number'},
            {id:"connected_ever", name: "Ever Connected", sortable:true, type:'number'},
            {id:'connectionResult', sortable:true, width:300}
        ],
        'trackers':[
            {attr:'url', name:"URL", width:200, sortable:true},
            {id:'announces', name:"Announces", type:'number'},
            {id:'errors', name:"Errors", type:'number'},
            {id:'timeouts', name:"Timeouts", type:'number'},
            {id:'seeders', name:"Seeders", type:'number'},
            {id:'leechers', name:"Leechers", type:'number'},
            {id:'lasterror', width:400}
        ],
        'diskio':[
            {id:'jobId', width:55, type:'number'},
            {id:'type', name:"Type", width:150},
            {id:'state', name:"State", width:120},
            {id:'pieceNum', name:"Piece", width:70, type:'number'},
            {id:'fileNum', name:"File", width:60, type:'number'},
            {id:'size', name:"Size", width:80, type:'number'},
            {id:'progress',name:"Progress", width:75, type:'number'},
            {id:'fileOffset', width:120, type:'number'},
            {id:'pieceOffset', type:'number'},
            {id:'torrent'}
        ],
        'files':[
            {attr:'num', name:"Number", width:60, sortable:true, type:'number'},
            {attr:'name', name:"Name", width:400, sortable:true},
            {attr:'size', name:"Size", formatVal:byteUnits, width:100, sortable:true, type:'number'},
            {id:'complete', name:"Complete", formatVal: fracToPercent, sortable:true, type:'number'},
            {name:"Action" , width:115, displayFunc: fileAction},
            {id:"priority", name:"Priority", formatVal: priority, sortable:true
/*
  ,editor: Slick.Editors.SelectCellEditor,
             options:"Normal,Skip",
             formatVal: function(v) {
                 return (v == 0) ? 'Skip' : ''
             },
             name:'Priority',*/
            },
            {id:'downloaded', name:"Downloaded", formatVal:byteUnits, width:100, type:'number'},
            {attr:'path', name:"Path", formatVal: pathFormat, width:400, sortable:true},
            {id:'streaming', name:"Stream"},
            {id:'leftPiece', type:'number'},
            {id:'rightPiece', type:'number'}
        ],
        'pieces':[
            {attr:'num', name:"Piece", type:'number'},
            {attr:'size', name:"Size", formatVal:byteUnits, type:'number'},
            {attr:'haveData', type:'number'},
            {id:'requests', name:"Req", width:50, type:'number'},
            {id:'responses', name:"Resp", width:50, type:'number'},
            {id:'timeouts', name:"Timeouts", type:'number'},
            {attr:'haveDataPersisted', name:"Saved", width:90, type:'number'},
            {attr:'numChunks', width:75, type:'number'}
        ]
    }

    this.undestroy()

    this.client.on('change',function(item, newval, oldval, attr) {
        if (attr == 'downspeed') {
            if (newval) {
                $('#client-infobar-down').text( 'Down: ' + byteUnitsSec(newval) )
            } else {
                $('#client-infobar-down').text('')
            }
        } else if (attr == 'upspeed') {
            if (newval) {
                $('#client-infobar-up').text( 'Up: ' + byteUnitsSec(newval) )
            } else {
                $('#client-infobar-up').text('')
            }
        }
    })
}

UI.prototype = {
    destroy: function() {
        this.torrenttable.destroy()
        if (this.detailtable) {
            this.detailtable.destroy()
        }
        $('#ui-wrapper').hide()
    },
    undestroy: function() {
        $('#ui-wrapper').show()
        this.torrenttable = new SlickCollectionTable( { collection: this.client.torrents,
                                                        domid: 'torrentGrid',
                                                        columns: this.coldefs.torrent
                                                      } )
        this.torrenttable.grid.onSelectedRowsChanged.subscribe( _.bind(this.handle_torrent_selection_change,this))
    },
    get_selected_files: function() {
        var rows = this.detailtable.grid.getSelectedRows()
        var files = []
        var file
        for (var i=0; i<rows.length; i++) {
            file = this.detailtable.grid.getData()[rows[i]]
            files.push( file )
        }
        return files
    },
    get_selected_torrents: function() {
        var rows = this.torrenttable.grid.getSelectedRows()
        var torrents = []
        var torrent
        for (var i=0; i<rows.length; i++) {
            torrent = this.client.torrents.get_at(rows[i])
            torrents.push( torrent )
        }
        return torrents
    },
    handle_torrent_selection_change: function(evt, data) {
        var selected = data.rows;
	//console.log('selection change',selected);

        if (selected.length > 0) {
            var torrent = this.client.torrents.get_at(selected[0])
            this.set_detail(this.detailtype, torrent)
        } else {
            if (this.detailtable) {
                this.detailtable.destroy()
                this.detailtable = null
            }
        }
        
    },
    get_selected_torrent: function() {
        var idx = this.torrenttable.grid.getSelectedRows()[0]
        var torrent = this.client.torrents.get_at(idx)
        return torrent
    },
    set_detail_webserver: function() {
        this.detailtype = 'diskio'
        if (this.detailtable) {
            this.detailtable.destroy()
            this.detailtable = null
        }
        var domid = 'detailGrid'

        this.detailtable = new SlickCollectionTable({collection: app.client.packageDisk.diskio,
                                                     domid: domid,
                                                     columns: this.coldefs['diskio']
                                                    });

    },
    set_detail: function(type, torrent) {
        // fix to not redraw messages pane.
        //console.clog(L.UI,'set detail',type,torrent)
        //if (! torrent && type != 'messages') { return }

        if (this.detailtype == 'messages' && type == 'messages') {return} // dont need to redraw
        
        this.detailtype = type

        if (this.detailtable) {
            this.detailtable.destroy()
            this.detailtable = null
        }

        var domid = 'detailGrid'
        if (! torrent && type != 'messages') {
            // maybe render "this is broken"
            if (app.client.torrents.items.length == 0) {
                $('#' + domid).html('<div style="padding:1em"><p>'+
                                    chrome.i18n.getMessage("noTorrentSelected")+ '</p><p> ' +
                                    chrome.i18n.getMessage("showHelpStart")+
                                    "</p></div>")
            } else {
                $('#' + domid).html('<p style="padding:1em">No torrent selected.</p>')
            }
            return

        }

        if (type == 'diskio') {
            var storage = torrent.getStorage()
            if (storage && storage.ready) {
                this.detailtable = new SlickCollectionTable({collection: torrent.getStorage().diskio,
                                                             domid: domid,
                                                             columns: this.coldefs[type]
                                                            });
            } else {
                $('#' + domid).html('<p style="padding:1em">Disk not attached.</p>')
            }
        } else if (type == 'messages') {
            // logger pane
            this.detailtable = new MessagesView({domid:domid})
            
        } else if (type == 'info') {
            // general info pane

            if (! torrent.infodict && torrent.get('metadata')) {
                torrent.loadMetadata(function(){})
            }

            this.detailtable = new GeneralInfoView({
                domid: domid,
                torrent: torrent,
            })
        } else {
            if (! torrent[type] || ! this.coldefs[type]) {
                console.warn('invalid table definition for type',type)
            } else {
                this.detailtable = new SlickCollectionTable({collection: torrent[type],
                                                             domid: domid,
                                                             columns: this.coldefs[type]
                                                            });

                if (this.detailtype == 'files') {
                    //console.clog(L.UI, 'set torrent detail view')
                    if (torrent.get('metadata') && ! torrent.infodict) {
                        torrent.loadMetadata(function(result){
                            console.clog(L.UI, 'initailized torrent metadata',result)
                            if (result.error && this.detailtable) {
                                this.detailtable.showError(result.error)
                            }
                        }.bind(this)) // this should initialize the files
                    } else if (torrent.infodict) {
                        torrent.initializeFiles()
                    } else {
                        // XXX TODO -- make torrent list refresh once metadata is completed...
                        this.detailtable.grid.setData([])
                    }
                    this.detailtable.grid.onClick.subscribe( _.bind(app.handle_click, app, 'files', torrent[type]) )
                } else if (this.detailtype == 'peers') {
                    this.detailtable.grid.onDblClick.subscribe( _.bind(app.handle_dblclick, app, 'peers', torrent[type]) )
                } else if (this.detailtype == 'swarm') {
                    this.detailtable.grid.onDblClick.subscribe( _.bind(app.handle_dblclick, app, 'swarm', torrent[type]) )
                }
            }
        }
    }
}

function MessagesView(opts) {
    this.opts = opts
    this.elt = $('#'+this.opts.domid)
    this.render()
    window.LOGLISTENER = this.onNewLog.bind(this)
    $('#detailGrid')[0].style.overflow = 'auto'
    $('#detailGrid')[0].style.padding = '4px'
    $('#detailGrid')[0].style['-webkit-user-select'] = 'initial'

    var obj = $('#detailGrid')[0]
    obj.scrollTop = obj.scrollHeight + 1000


    
}
MessagesView.prototype = {
    // XXX how many methods must we define?
    showError: function(){},
    resizeCanvas: function(){},
    destroy: function() {
        this.elt.html('')
        window.LOGLISTENER = null
        $('#detailGrid')[0].style.overflow = 'hidden'
        $('#detailGrid')[0].style.padding = '0px'
    },
    stringifyArg: function(arg) {
        if (arg === undefined) {
            return 'undefined'
        } else if (arg === null) {
            return arg
        } else if (typeof arg == 'string') {
            return arg
        } else if (arg instanceof Array) {
            return '[' + arg.map(function(e) { this.stringifyArg(e) }.bind(this)).join(',') + ']'
        } else if (arg.simpleSerializer) {
            return arg.simpleSerializer()
        } else {
            if (DEVMODE) {
                try {
                    var s = JSON.stringify(arg)
                    if (s.length < 1000) {
                        return s
                    } else {
                        return arg
                    }
                } catch(e) {
                    return arg
                }
            } else {
                // dont json serialize in prod
                return arg
            }
       }
    },
    stringifyArgs: function(args) {
        return args.map( function(arg) { return this.stringifyArg(arg) }.bind(this) ).join(' ')
    },
    onNewLog: function(args) {
        var div = document.createElement('div')
        div.style['border-top'] = '1px solid #eee'
        if (args.length > 0 && typeof args[0] == 'string' && args[0].startsWith('%c')) {
            var span = document.createElement('span')
            span.setAttribute('style',args[1])
            span.innerText = args[0].slice(2,args[0].length)
            div.appendChild(span)
            var span2 = document.createElement('span')
            span2.style['padding-left'] = '1em'
            span2.innerText = this.stringifyArgs( args.slice(2,args.length) )
            div.appendChild(span2)
        } else {
            div.innerText = this.stringifyArgs( args )
        }
        this.elt[0].appendChild(div)
        var obj = $('#detailGrid')[0]
        //ORIGINALCONSOLE.log.call(console, obj.scrollTop, obj.scrollHeight - obj.offsetHeight)
        if( (obj.scrollHeight - obj.offsetHeight) - obj.scrollTop < 50) {
            obj.scrollTop = obj.scrollHeight + 1000
        }
    },
    render: function() {
        this.elt.show()
        if (window.LOGHISTORY) {
            var unshown = LOGHISTORY.totalrecorded - LOGHISTORY.filled
            if (unshown > 0) {
                this.onNewLog(['%cWarn','color:orange',unshown + ' previous messages not shown'])
            }
            
            for (var i=0; i<LOGHISTORY.filled; i++) {
                var line = LOGHISTORY.get(-LOGHISTORY.filled+1+i)
                this.onNewLog(line)
            }
        }
    }
}

function GeneralInfoView(opts) {
    this.opts = opts
    this.torrent = opts.torrent
    this.render()
    $('#detailGrid')[0].style['-webkit-user-select'] = 'initial'
}
GeneralInfoView.prototype = {
    render: function() {
        //$('#'+this.opts.domid).css('opacity',1)
        //$('#'+this.opts.domid).stop()
        $('#'+this.opts.domid).show()

        if (! this.torrent) {
                $('#'+this.opts.domid).html("<p>No Torrent selected</p>")

/*        } else if (! this.torrent.infodict && this.torrent.get('metadata')) {
            $('#'+this.opts.domid).html("Loading...")
            //$('#'+this.opts.domid).fadeOut()
*/
        } else {
            var s = '<div style="-webkit-user-select: text; overflow:scroll"><ul>'
            var excludes = ['info', 'announce','announce-list']
            var magnet = this.torrent.getMagnetLink()
            s += '<label>Links</label>'
            s += ('<li>magnet link: <a target="_blank" href="'+magnet+'">' + _.escape(magnet) +  '</a></li>')
            s += ('<li>share link: <a target="_blank" href="'+this.torrent.getShareLink()+'">JSTorrent.com web link for sharing</a></li>')
            if (app.options.get('web_server_enable') && app.webapp && ! this.torrent.multifile && this.torrent.metadata) {
                var streamUrl = this.torrent.getStreamPlayerPageURL()
                if (streamUrl) {
                    s += ('<li>Stream Page: <a target="_blank" href="'+streamUrl+'">Video Player</a></li>') // now in files tab
                }
            }

            //var attr_includes = ['added']
            var attr_includes = this.torrent._attributes
            var attr_excludes = ['bitfield','filePriority']

            var haveExtraMeta = false
            if (this.torrent.metadata) {
                for (var key in this.torrent.metadata) {
                    if (! _.contains(excludes, key)) {
                        if (! haveExtraMeta) {
                            s += '<label style="margin-top:0.5em">Extra Metadata</label>'
                            haveExtraMeta = true
                        }
                        s += ('<li>' + _.escape(key) + ': ' + this.renderValue(this.torrent.metadata[key]) + '</li>')
                    }
                }
            } else {
                s += '<li>Metadata not present (magnet only)</li>'
            }

            s += '<label style="margin-top:0.5em">Attributes</label>'
            for (var key in attr_includes) {
                if (! _.contains(attr_excludes, key)) {
                    s += ('<li>' + _.escape(key) + ': ' + this.renderValue(this.torrent._attributes[key]) + '</li>')
                }
            }
            s += ('<li>' + _.escape('unflushed pieces') + ': ' + this.renderValue(byteUnits(this.torrent.unflushedPieceDataSize)) + '</li>')
            s += ('<li>' + _.escape('unflushed pieces limit') + ': ' + this.renderValue(byteUnits(this.torrent.unflushedPieceDataSizeLimit)) + '</li>')
            s += ('<li>' + _.escape('multifile') + ': ' + this.renderValue(this.torrent.multifile) + '</li>')
            s += ('<li>' + _.escape('private') + ': ' + this.renderValue(this.torrent.isPrivate()) + '</li>')
            if (this.torrent.getStorage()) {
            s += ('<li>' + _.escape('storage') + ': ' + 
                  this.renderValue(this.torrent.getStorage().key + ', ' +
//                                   (this.torrent.getStorage().entry ? this.torrent.getStorage().entry.name : 'noentry') +
                                   (this.torrent.getStorage().get('entrydisplaypath') ? this.torrent.getStorage().get('entrydisplaypath') : '')) +
                  '</li>')
            } else {
                s += ('<li>storage: null</li>')
            }
            s += ('<li>' + _.escape('lasterror') + ': ' + this.renderValue(this.torrent.lasterror) + '</li>')

            s += '</ul></div>'
            $('#'+this.opts.domid).html(s)
        }
        this.resizeCanvas()
    },

    renderValue: function(v) {
        if (typeof v == 'string' &&
            (v.toLowerCase().match('^http:') || 
             v.toLowerCase().match('^https:'))
           ) {
            return '<a target="_blank" href="'+v+'">'+_.escape(v)+'</a>'
        } else {
            return _.escape(v)
        }
    },
    destroy: function() {
        $('#'+this.opts.domid).html("")
    },
    resizeCanvas: function() {
        //console.log('info view - resize my canvas')
        $('#'+this.opts.domid).children().height( $('#'+this.opts.domid).height() )
    }
}
