(function() {

    function RingBuffer(sz) {
        this.sz = sz
        this.filled = 0
        this.totalrecorded = 0
        this.buf = []
        for (var i=0; i<sz; i++) {
            this.buf.push(null)
        }
        this.idx = 0
    }

    var RingBufferproto = {
        add: function(val) {
            this.totalrecorded++
            this.idx = (this.idx + 1) % this.sz
            this.buf[this.idx] = val
            if (this.filled < this.sz) {
                this.filled++
            }
        },
        get: function(relidx) {
            // get values relative to current index
            var realidx = (this.idx + relidx) % this.sz
            if (realidx < 0) {
                realidx += this.sz
            }
            return this.buf[realidx]
        }
    }

    _.extend(RingBuffer.prototype, RingBufferproto)
    jstorrent.RingBuffer = RingBuffer


})()
