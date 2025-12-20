function Item(opts) {
    //this.__name__ = arguments.callee.name
    this.parent = opts.parent
    this.itemClass = opts.itemClass
    this._opts = opts
    this._attributes = (opts && opts.attributes) ||  {}
    if (opts.initializedBy == 'collection.fetch') {
        if (opts.itemClass.attributeSerializers) {
            for (var key in this._attributes) {
                if (opts.itemClass.attributeSerializers[key]) {
                    this._attributes[key] = opts.itemClass.attributeSerializers[key].deserialize(this._attributes[key])
                }
            }
        }
        var key
        if (opts.itemClass.persistAttributes) {
            for (var i=0; i<opts.itemClass.persistAttributes.length; i++) {
                key = opts.itemClass.persistAttributes[i]
                if (this._attributes[key]) {
                    // TODO -- combine with attribute serializer
                    this[key] = this._attributes[key]
                    delete this._attributes[key]
                }
            }
        }
    }
    this._collections = []
    this._event_listeners = {}
    this._subcollections = []
    this._savequeued = false
    this._savequeue = []
}

jstorrent.Item = Item

Item.prototype = {
    simpleSerializer: function() {
        // for the log window
        var myKey = this.id || (this.opts && this.opts.id) || this.get_key()
        return this.__name__ + ':' + myKey
    },
    getParentIdList: function() {
        var myKey = this.id || (this.opts && this.opts.id) || this.get_key()
        console.assert(myKey)
        var parent = (this.opts && this.opts.parent) || this.parent
        if (parent) {
            return parent.getParentIdList().concat([myKey])
        } else {
            return [myKey]
        }
    },
    getStoreKey: function() {
        return this.getParentIdList().join('/')
    },
    getCollection: function() {
        console.assert(this._collections.length == 1)
        return this._collections[0]
    },
    trigger: function(k,attrName,newval,oldval) {
        //console.log('item trigger',k,newval,oldval)
        if (this._event_listeners[k]) {
            if (k == 'change') {
                if (newval === oldval) {

                } else {
                    for (var i=0; i<this._event_listeners[k].length; i++) {
                        this._event_listeners[k][i](this, newval, oldval, attrName)
                    }
                }
            } else {
                for (var i=0; i<this._event_listeners[k].length; i++) {
                    this._event_listeners[k][i].apply(this, arguments)
                }
            }
        }
        if (this._collections.length > 0) {
            if (k == 'change') {
                for (var i=0; i<this._collections.length; i++) {
                    this._collections[i].trigger(k, this, newval, oldval, attrName)
                }
            } else {
                for (var i=0; i<this._collections.length; i++) {
                    var args = [arguments[0],this]
                    for (var j=1;j<arguments.length; j++) {
                        args.push(arguments[j])
                    }
                    this._collections[i].trigger.apply(this._collections[i], args)
                }
            }
        }
    },
    getSaveData: function() {
        // if we have item attribute serializers, use those
        var attrs, key

        if (this.itemClass.persistAttributes) {
            attrs = _.clone(this._attributes)
            for (var i=0; i<this.itemClass.persistAttributes.length; i++) {
                key = this.itemClass.persistAttributes[i]
                // TODO work in tandem with serializer...
                attrs[key] = this[key]
            }
        }

        if (this.itemClass.attributeSerializers) {
            if (! attrs) {
                attrs = _.clone(this._attributes)
            }
            for (var key in this._attributes) {
                if (this._attributes[key]) { // don't save null entries of attributes, i guess...
                    if (this.itemClass.attributeSerializers[key]) {
                        attrs[key] = this.itemClass.attributeSerializers[key].serialize( attrs[key] )
                    }
                }
            }
        }

        if (! attrs) {
            attrs = this._attributes
        }

        return attrs
    },
    save: function(callback) {
        //if (this.itemClass == jstorrent.Torrent && this.get('state') == 'loading') { debugger } // XXX dont save in "loading" state.. cuz thats weird
        // this function is dubiously error free?

        //console.log(this.get_key(),'.save()')
        if (this._saving) { 
            if (this._savequeued) {
                //console.warn(this.get_key(),'.save() doubly in progress')
            } else {
                //console.warn(this.get_key(),'.save() in progress'); 
            }
            this._savequeued = true
            if (callback) {
                //console.log('queueing post .save() callback')
                this._savequeue.push( callback )
            }
            return 
        }
        this._saving = true
        var obj = {}
        var key = this.getStoreKey()
        obj[key] = this.getSaveData()
        //console.log('saving item',obj)
        chrome.storage.local.set(obj, _.bind(function(){
            this._saving = false
            if (this._savequeued) {
                this._savequeued = false
                //console.warn(this.get_key(),'executing queued .save()')
                _.defer( _.bind(this.save, this) ) // save again ;-)
            } else {
                if (this._savequeue.length > 0) {
                    while (this._savequeue.length > 0) {
                        var cb = this._savequeue.shift()
                        console.log('executing queued .save() callback')
                        _.defer( cb )
                    }
                }
            }
            if (callback) { callback() }
        },this))
    },
    on: function(event_name, callback) {
        if (! this._event_listeners[event_name]) {
            this._event_listeners[event_name] = []
        }
        this._event_listeners[event_name].push(callback)
    },
    unset: function(k) {
        var oldval = this._attributes[k]
        delete this._attributes[k]
        this.trigger('change',k,undefined,oldval)
    },
    set: function(k,v, shouldTrigger) {
        if (shouldTrigger === undefined) { shouldTrigger = true }
        var oldval = this._attributes[k]
        if (oldval === v) { return }
        this._attributes[k] = v
        if (shouldTrigger) {
            this.trigger('change',k,v,oldval)
        }
    },
    get: function(k) {
        return this._attributes[k]
    }
}
