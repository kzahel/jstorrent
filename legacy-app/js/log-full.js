// add this file to your "blackbox" e.g. blackboxing, making devtools not show logs as coming from here
// TODO in production mode, dont log anything unless it's clog
/*
console.log = function() {
    var context = "%cLOG";
    var context2 = 'color:white;background:green'
    //dolog(Array.prototype.slice.apply(arguments))
    
    return Function.prototype.bind.call(console.log, console, context, context2);
}()
*/

(function() {
    window.ORIGINALCONSOLE = {log:console.log, warn:console.warn, error:console.error}
    window.LOGHISTORY = new jstorrent.RingBuffer(100)
    window.LOGLISTENER = null
/*
    console.log = function() {
        var args = Array.prototype.slice.apply(arguments)
        //dolog.apply(null, [args])
        consolelog.apply(console,arguments)
        //Function.prototype.bind.call(consolelog, console).apply(console,args)
    }
*/

    function wrappedlog(method) {
        var wrapped = function() {
            var args = Array.prototype.slice.call(arguments)
            ORIGINALCONSOLE[method].apply(console,args)

            if (method == 'error') {
                args = ['%cError','color:red'].concat(args)
            } else if (method == 'warn') {
                args = ['%cWarn','color:orange'].concat(args)
            }

            LOGHISTORY.add(args)
            if (LOGLISTENER) {
                LOGLISTENER(args)
            }
        }
        return wrapped
    }
    
    console.log = wrappedlog('log')
    console.warn = wrappedlog('warn')
    console.error = wrappedlog('error')
    
    console.clog = function() {
        // category specific logging
        var tolog = arguments[0]
        if (tolog === undefined) {
            var args = Array.prototype.slice.call(arguments,1,arguments.length)
            args = ['%c' + 'UNDEF', 'color:#ac0'].concat(args)
            consolelog.apply(console,args)
        } else if (tolog.show) {
            var args = Array.prototype.slice.call(arguments,1,arguments.length)
            if (tolog.color) {
                args = ['%c' + tolog.name, 'color:'+tolog.color].concat(args)
            }
            LOGHISTORY.add( args )
            if (LOGLISTENER) {
                LOGLISTENER(args)
            }
            ORIGINALCONSOLE.log.apply(console,args)
        }
    }
})()
