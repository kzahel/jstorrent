// we need to emulate XHR object because it doesn't let us set "unsafe" User-Agent header

function ChromeSocketXMLHttpRequest() {
    this.onload = null
    this.onerror = null
    this.opts = null

    this.timedOut = false
    this.timeout = 0
    this.timeoutId = null

    this.readBuffer = new jstorrent.Buffer
    this.writeBuffer = new jstorrent.Buffer

    this.connecting = false
    this.reading = false
    this.writing = false
    this.haderror = false
    this.closed = false

    this.sockInfo = null

    this.extraHeaders = {}

    this.headersReceived = false
    this.responseHeaders = null
    this.responseBody = null
}

ChromeSocketXMLHttpRequest.prototype = {
    open: function(method, url, async) {
        this.opts = { method:method,
                      url:url,
                      async:true }
        this.uri = parseUri(this.opts.url)
        console.assert(this.uri.protocol == 'http') // https not supported for chrome.socket yet
    },
    setRequestHeader: function(key, val) {
        this.extraHeaders[key] = val
    },
    send: function(data) {
        console.assert( ! data ) // do not support sending request body yet
        chrome.sockets.tcp.create({}, _.bind(this.onCreate, this))
        if (this.timeout !== 0) {
            this.timeoutId = setTimeout( _.bind(this.checkTimeout, this), this.timeout )
        }
    },
    createRequestHeaders: function() {
        var lines = []
        var headers = {'Connection': 'close',
                       'Accept-Encoding': 'identity', // servers will send us chunked encoding even if we dont want it, bastards
//                       'User-Agent': 'uTorrent/330B(30235)(server)(30235)', // setRequestHeader /extra header is doing this
                       'Host': this.uri.host}
        _.extend(headers, this.extraHeaders)
        if (this.opts.method == 'GET') {
            headers['Content-Length'] == '0'
        } else {
            this.error('unsupported method')
        }

        lines.push(this.opts.method + ' ' + this.uri.relative + ' HTTP/1.1')
        for (var key in headers) {
            lines.push( key + ': ' + headers[key] )
        }
        return lines.join('\r\n') + '\r\n\r\n'
    },
    checkTimeout: function() {
        if (! this.responseBody) {
            this.error({error:'timeout'})
        }
    },
    error: function(data) {
        this.haderror = true
        if (! this.closed) {
            this.close()
        }
        if (this.onerror) {
            this.onerror(data)
        }
    },
    onCreate: function(sockInfo) {
        if (this.closed) { return }
        this.sockInfo = sockInfo
        peerSockMap[sockInfo.socketId] = this
        this.connecting = true
        chrome.sockets.tcp.connect( sockInfo.socketId, this.getHost(), this.getPort(), _.bind(this.onConnect, this) )
    },
    onConnect: function(result) {
        if (this.closed) { return }
        this.connecting = false
        if (this.timedOut) {
            return
        } else if (result < 0) {
            this.error({error:'connection error',
                        code:result})
        } else {
            var headers = this.createRequestHeaders()
            this.writeBuffer.add( str2ab(headers) )
            this.writeFromBuffer()
            this.doRead()
        }
    },
    getHost: function() {
        return this.uri.host
    },
    getPort: function() {
        return parseInt(this.uri.port) || 80
    },
    writeFromBuffer: function() {
        if (this.closed) { return }
        console.assert(! this.writing)
        this.writing = true
        var data = this.writeBuffer.consume_any_max(jstorrent.protocol.socketWriteBufferMax)
        //console.log('writing data',ui82str(data))
        chrome.sockets.tcp.send( this.sockInfo.socketId, data, _.bind(this.onWrite,this) )
    },
    onWrite: function(result) {
        this.writing = false
        //console.log('write to socket',result)
    },
    doRead: function() {
        if (this.closed) { return }
        console.assert(! this.reading)
        //chrome.sockets.tcp.read( this.sockInfo.socketId, jstorrent.protocol.socketReadBufferMax, _.bind(this.onRead,this) ) // new api dont work this way
    },
    close: function() {
        this.closed = true
        if (this.sockInfo) {
            chrome.sockets.tcp.disconnect(this.sockInfo.socketId)
            chrome.sockets.tcp.close(this.sockInfo.socketId)
            delete peerSockMap[this.sockInfo.socketId]
            this.sockInfo = null
        }
    },
    onRead: function(result) {
        console.log('onread',result.data.byteLength, [ui82str(new Uint8Array(result.data))])
        if (this.closed) { return }
        this.reading = false
        if (result.data.byteLength == 0) {
            console.warn('remote closed connection! readbuf',buf)
            this.close()
            // remote closed connection
        } else {
            this.readBuffer.add( result.data )
            this.tryParseResponse()
        }
    },
    tryParseResponse: function() {
        if (! this.headersReceived) {
            var data = this.readBuffer.flatten()
            var idx = ui8IndexOf(new Uint8Array(data),_.map('\r\n\r\n', function(c){return c.charCodeAt(0)}))
            if (idx != -1) {
                // not sure what encoding for headers is exactly, latin1 or something? whatever.
                var headers = ui82str(new Uint8Array(data, 0, idx + 4))
                console.log('found http tracker response headers', headers)
                this.headersReceived = true
                this.responseHeaders = headers
                this.readBuffer.consume(idx+4)

                var response = parseHeaders(this.responseHeaders)
                console.log('parsed http tracker response',response)
                if (response.headers['transfer-encoding'] &&
                    response.headers['transfer-encoding'] == 'chunked') {
                    console.warn('this will break!')
                    this.error('chunked encoding')
                } else {
                    this.tryParseBody()
                }
            } else {
                this.doRead()
            }
        } else {
            this.tryParseBody()
        }
    },
    tryParseBody: function() {
        var data = this.readBuffer.flatten()
        try {
            var s = ui82str(new Uint8Array(data))
            var decoded = bdecode(s)
            this.responseBody = s
            var evt = {target:{response:data}}
            this.onload(evt)
        } catch(e) {
            //console.log('unable to bdecode body. trying to read more')
            this.doRead()
        }
    }
}

function parseHeaders(s) {
    var lines = s.split('\r\n')
    var firstLine = lines[0].split(/ +/)
    var proto = firstLine[0]
    var code = firstLine[1]
    var status = firstLine[2]
    var headers = {}

    for (var i=1; i<lines.length; i++) {
        var line = lines[i]
        if (line) {
            var j = line.indexOf(':')
            var key = line.slice(0,j).toLowerCase()
            headers[key] = line.slice(j+1,line.length).trim()
        }
    }
    return {code: code,
            status: status,
            proto: proto,
            headers: headers}
}