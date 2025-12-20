// analytics
// https://support.google.com/analytics/answer/1033068


/*


Category: The primary divisions of the types of Events you have on
your site. Categories are at the root of Event tracking, and should
function as a first way to sort Events in your reports. Videos and
Downloads are good examples of categories, though you can be as
specific or broad as your content requires.

Action: A descriptor for a particular Event Category. You can use any
string to define an Action, so you can be as specific as
necessary. For example, you could define Play or Pause as Actions for
a Video. You could also be more specific, and create an Action called
Video almost finished to trigger when the play-back slider on a video
reaches the 90% mark.

Label: An optional descriptor that you can use to provide further
granularity. You can specify any string for a label.

Value: A numerical variable. You can use explicit values, like 30, or
inferred values based variables you define elsewhere, like
downloadTime.

Implicit Count: A count of the number of interactions with an Event
Category. Implicit Count does not appear in the standard Google
Analytics reports, but you can access this data via API.

*/



function Analytics(opts) {
    // Initialize the Analytics service object with the name of your app.




    // Get a Tracker using your Google Analytics app Tracking ID.
    this.app = opts.app
    var id, service
    if (jstorrent.device.platform == 'Android') {

    } else if (DEVMODE) {
        service = 'JSTorrent DEV'
        id = "UA-35025483-6"
    } else if (chrome.runtime.id == jstorrent.constants.cws_jstorrent) {
        service = 'JSTorrentApp'
        id = "UA-35025483-2"
    } else if (chrome.runtime.id == jstorrent.constants.cws_jstorrent_lite) {
        service = 'JSTorrent Lite'
        id = "UA-35025483-4"
    } else {
        service = 'JSTorrent-Unpacked'
        id = "UA-35025483-5"
    }
    this.service = service
    this.id = id

    var report_usage = this.app.options.get('report_usage_statistics')
    
    if (! id || ! report_usage) {
        function FakeTracker() {}
        FakeTracker.prototype = {
            sendAppView: function(){},
            sendEvent: function(){},
            send: function(){}
        }
        this.tracker = new FakeTracker
    } else {
        console.clog(L.EVENT,"Setup analytics",this.service)
        this.service = analytics.getService(service);
        this.service.getConfig().addCallback(_.bind(this.initAnalyticsConfig,this));
        this.tracker = this.service.getTracker(id);
    }

    // Record an "appView" each time the user launches your app or goes to a new
    // screen within the app.
    // tracker.sendAppView('MainView');
}

jstorrent.Analytics = Analytics

Analytics.prototype = {
    sendEvent: function(a,b,c,d) {
        console.clog(L.EVENT,a||'',b||'',c||'',d||'')
        try {
            this.tracker.sendEvent(a,b,c,d)
        } catch(e){console.warn('GA sendEvent fail')}
    },
    sendAppView: function(s) {
        console.clog(L.EVENT,'AppView',s||'')
        try {
            this.tracker.sendAppView(s)
        } catch(e){console.warn("GA sendAppView fail")}
    },
    initAnalyticsConfig: function(evt) {
        //console.log('analytics initialized')
        //console.log('init analytics config',evt)
    }
}
