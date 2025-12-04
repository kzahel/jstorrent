
function Options(opts) {
    // TODO -- refactor this to be a collection and each option an item...
    this.data = null
    this.app = opts && opts.app

    this.app_options = {
        'sync_torrents': {
            'default': false,
            'enabled':false,
            'type':'bool',
            'description': 'your list of torrents will be synchronized across your devices'
        },
        'show_progress_notifications': {
            'default':true,
            'name':'Show notifications for download progress',
            'type':'bool',
            'visible':false,
        },
        'show_extension_notification': {
            'description': 'Whether to display a link to install the JSTorrent Helper Extension when adding a torrent',
            'default': true,
            'enabled': false,
            'type': 'bool',
        },
        'prevent_sleep': {
            'default': true,
            'type': 'bool',
            'name': 'Prevent system standby when downloading'
        },

/*
// this is set as an attribute of the disks collection instead
        'default_download_location': {
            'default':null,
            'type':'JSON',
            'description':'where torrents download to'
        },
*/
        'new_torrent_show_dialog': {
            'default': false,
            'enabled': false,
            'type':'bool',
            'description':'whether to show a dialog when adding a new torrent'
        },
        'exit_on_download_complete': {
            'default': false,
            'enabled': false,
            'type':'bool',
            'description':'whether to exit when downloads have completed'
        },
        'active_torrents_limit': {
            'name': 'Active torrents limit',
            'help': 'Limit the number of active torrents. Additional torrents will be queued',
            'default': 2,
            'minval':1,
            'maxval':5,
            'type':'int'
        },
        'maxconns': {
            'name': 'Connections Per Torrent',
            'help': 'The maximum number of peers to download from. Higher numbers can potentially result in faster downloads, but use more system resources',
            'default': 25,
            'minval':1,
            'maxval':200,
            'type':'int'
        },
        'new_torrents_auto_start': {
            'name': 'Automatically start downloading new torrents',
            'default': true,
            'type': 'bool'
        },
        'report_anonymous_usage': {
            'default': true,
            'type': 'bool',
            'editable': false
        },
        'report_to_trackers_override': {
            'default': false,
            'name': 'Spoofing - report to private trackers as uTorrent',
            'type': 'bool'
//            'children': [ 'report_to_trackers_override_as' ]
        },
        'report_to_trackers_override_as': {
            'default': 'uTorrent/330B(30235)(server)(30235)',
            'type': 'string',
            'visible': false
        },
        'auto_add_public_trackers': {
            'default':true,
            'name':'Add public trackers automatically',
            'help':'If no peers are found, automatically add some public trackers to look for more peers.',
            'visible':true,
            'type':'bool'
        },
        'report_usage_statistics': {
            'default':true,
            'name':'Report usage statistics',
            'help':'To help improve the program, send usage anonymous usage statistics',
            'visible': true,
            'type':'bool'
        },
        'restart_torrent_on_error': {
            'default':false,
            'name':'Restart Torrent if an error occurs',
            'visible': false,
            'type':'bool'
        },
        'seed_public': {
            'default':false,
            'name':'Enable seeding public torrents (BETA)',
            'type':'bool',
            'visible':false
        },
        'max_unflushed_piece_data': {
            'editable': false,
            'default': 64, // needs to be much larger, or else we will get "stuck" a lot...
            // i.e. store up to 4 complete pieces in RAM
            // this actually needs to be a multiple of each piece chunk size..
            'type': 'int'
        },
        'socks5_proxy': {
            'visible': false,
            'default':'192.168.43.1:8080',
            'type':'string',
            'name':'SOCKS5 Proxy server address'
        },
        'socks5_proxy_enabled': {
            'visible': false,
            'default': false,
            'type': 'bool',
            'name': 'Use SOCKS5 proxy server'
        },
        'web_server_enable': {
            'default': true,
            'visible':true,
            'help':'This option lets you stream files before they are complete by clicking \'Stream\' in the Files tab',
            'type': 'bool',
            'name': 'Enable web server'
        },
        'debug_dht': {
            'visible': false,
            'default': false,
            'type': 'bool',
            'name': 'debugging dht'
        }
        
    }


}

jstorrent.Options = Options

Options.prototype = {
    get: function(k) {
        // gets from cached copy, so synchronous
        var val = this.data[k]
        if (val === undefined && this.app_options[k] && this.app_options[k]['default']) {
            return this.app_options[k]['default']
        } else {
            return val
        }
    },
    keys: function() {
        var data
        var a = []
        for (var key in this.app_options) {
            data = this.app_options[key]
            if (data.enabled === false || data.editable === false) {
                // dont show this option
            } else {
                a.push(key)
            }
        }
        a.sort()
        return a
    },
    getStorageKey: function() {
        var id = this.app.id
        return id + '/' + 'Options'
    },
    set: function(k,v) {
        // dont want to store these globally, but in the client namespace...

        this.data[k] = v
        var obj = {}

        var gobj = {}
        gobj[this.getStorageKey()] = this.data

        console.log('persisted option',k,v)
        chrome.storage.local.set(gobj)

        if (k == 'prevent_sleep' && v == false) {
            chrome.power.releaseKeepAwake()
        }
        if (k == 'active_torrents_limit') {
            this.app.client.onActiveTorrentsChange()
        }
    },
    load: function(callback) {
        chrome.storage.local.get(this.getStorageKey(), _.bind(this.options_loaded, this, callback))
    },
    options_loaded: function(callback, data) {
        //console.log('options loaded',data);
        this.data = data[this.getStorageKey()] || {}
        callback()
    },
    on_choose_download_directory: function(entry) {
        //var retain_string = chrome.fileSystem.retainEntry(entry);
        //console.log('user choose download directory',entry, 'retain string:',retain_string)
        /*
          this.set('default_download_location',
          {retainEntryId: retain_string,
          name: entry.name,
          fullPath: entry.fullPath}
          )
        */
        if (this.app) {
            this.app.set_default_download_location(entry)
        } else {
            //mainAppWindow.app.download_location = entry
            mainAppWindow.app.set_default_download_location(entry);
        }
    }
}


