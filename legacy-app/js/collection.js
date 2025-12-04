function BasicCollection(opts) {
    this.event_listeners = {}
    this.items = []
}
jstorrent.BasicCollection = BasicCollection
BasicCollection.prototype = {
    data: function() { return this.items },
    unshift: function(item) {
        item._collections = [this]
        this.items.unshift(item)

        // update key on all items
        for (var i=0; i<this.items.length; i++) {
            this.items[i].key = i
        }
        this.trigger('add')
    },
    indexOf: function(key) {
        return key
    },
    shift: function() {
        this.items.shift()
        this.trigger('remove')
    },
    unon: function(event_type, callback) {
        var idx = this.event_listeners[event_type].indexOf(callback)
        this.event_listeners[event_type].splice(idx,1)
    },
    get_at: function(idx) {
        return this.items[idx]
    },
    addAt: function(item, idx) {
        item._collections = [this]
        console.assert (idx === undefined)
        this.items.push(item)
        for (var i=0; i<this.items.length; i++) {
            this.items[i].key = i
        }
        this.trigger('add',item)
    },
    on: function(event_type, callback) {
        // XXX - if we set a debugger here, UI fucks up
        //console.log('register',event_type)
        if (! this.event_listeners[event_type]) {
            this.event_listeners[event_type] = []
        }
        this.event_listeners[event_type].push(callback)
    },
    trigger: function(event_type, item, newval, oldval, attrName) {
        if (event_type == 'change') {
            if (this.event_listeners && this.event_listeners[event_type]) {
                for (var i=0; i<this.event_listeners[event_type].length; i++) {
                    this.event_listeners[event_type][i](item, newval, oldval, attrName)
                }
            }
        } else {
            if (this.event_listeners && this.event_listeners[event_type]) {
                for (var i=0; i<this.event_listeners[event_type].length; i++) {
                    var args = Array.prototype.slice.call(arguments,1)
                    this.event_listeners[event_type][i].apply(undefined, args)
                }
            }
        }
    }
}


function Collection(opts) {
    // collection of items, good for use with a slickgrid
    this.__name__ = opts.__name__ || arguments.callee.name

    this.opts = opts
    this.parent = opts.parent

    // 
    if (opts.shouldPersist === undefined) {
        this.shouldPersist = false
    } else {
        this.shouldPersist = opts.shouldPersist
    }

    this.itemClass = opts.itemClass
    this.items = []
    this.length = 0
    this.keyeditems = {} // supports lookup by hash key
    this.event_listeners = {}

    this._attributes = {} // collection can have attributes too that
                          // can also be persisted
}

jstorrent.Collection = Collection
var CollectionProto = {
    getAttribute: function(k) {
        return this._attributes[k]
    },
    setAttribute: function(k,v) {
        var oldval = this._attributes[k]
        if (oldval === v) { return }
        this._attributes[k] = v
        this.trigger('change',k,v,oldval)
    },
    sort: function(sortCol, sortAsc) {
        if (sortCol.attr) {
            var getAttr = function(item) {
                return item[sortCol.attr]
            }
        } else {
            var getAttr = function(item) {
                return item._attributes[sortCol.id]
            }
        }
        if (sortAsc) {
            this.items.sort( function(a,b) {
                if (getAttr(a) == getAttr(b)) { return 0 }
                if (getAttr(a) === undefined) { return 1 }
                if (getAttr(b) === undefined) { return -1 }
                return (getAttr(a) < getAttr(b)) ? 1 : -1
            })
        } else {
            this.items.sort( function(a,b) {
                if (getAttr(a) == getAttr(b)) { return 0 }
                if (getAttr(a) === undefined) { return -1 }
                if (getAttr(b) === undefined) { return 1 }
                return (getAttr(a) < getAttr(b)) ? -1 : 1
            })
        }
        for (var i=0; i<this.items.length; i++) {
            this.keyeditems[this.items[i].get_key()] = i
        }
        // now update keyeditems
    },
    indexOf: function(key) {
        // quick lookup of item
        return this.keyeditems[key]
    },
    clear: function() {
        var items = _.clone(this.items) // crashing?
        
        for (var i=0;i<items.length;i++) {
            this.remove(items[i])
        }
    },
    add: function(v) {
        //if (this.itemClass == jstorrent.Peer) { debugger }
        console.assert(! this.contains(v))
        this.setItem(v.get_key(), v)
    },
    setItem: function(k,v) {
        console.assert( ! this.keyeditems[k] )
        v._collections.push(this)
        this.items.push(v)
        this.keyeditems[k] = this.length
        this.length++
        this.trigger('add',v)
    },
    containsKey: function(k) {
        // xXX - we had a typo "key" here instead of k but didnt get referenceerror. check why window.key is set to "ut_pex"
        return this.keyeditems[k] !== undefined
    },
    contains: function(v) {
        var key = v.get_key()
        var idx = this.keyeditems[key]
        if (idx === undefined) { return false }
        return true
    },
    remove: function(v) {
        var key = v.get_key()
        var idx = this.keyeditems[key]
        console.assert(idx >= 0)
        //console.log('removing',v,key,idx)
        //console.log('items now',this.items)
        // update all the indicies on the other items!        
        for (var k in this.keyeditems) {
            if (this.keyeditems[k] > idx) {
                this.keyeditems[k] = this.keyeditems[k] - 1
            }
        }
        delete this.keyeditems[key]
        this.items.splice(idx, 1) // why was this commented out?

        //console.log('items now',this.items)
        //console.log('keyeditems now', this.keyeditems)
        this.length--
        console.assert(this.length>=0)
        if (this.shouldPersist) {
            this.save()
        }
        this.trigger('remove')
    },
    get: function(k) {
        return this.items[this.keyeditems[k]]
    },
    getParent: function() {
        return this.client || this.opts.client || this.opts.parent
    },
    getParentId: function() {
        if (this.client) {
            return this.client.id
        } else if (this.opts && this.opts.client) {
            return this.opts.client.id
        } else if (this.opts && this.opts.parent) {
            return this.opts.parent.id
        }
    },
    save: function() {
        // save lets you put in objects and it JSON stringifys them
        // for you, but this is dangerous, because if it turns out to
        // have a uint8array in it, then it corrupts your storage.
        var data = this.getSaveData()
        var obj = {}
        obj[data[0]] = data[1]
        chrome.storage.local.set(obj)
/*
        if (typeof data[i] == 'string') {
            chrome.storage.local.set(obj)
        } else {
            var jsonified = JSON.stringify(obj)
            console.assert(jsonified.length < chrome.storage.local.QUOTA_BYTES)
            console.log('cannot save non string types', obj, 'pct of possible size', Math.floor(100 * jsonified.length / chrome.storage.local.QUOTA_BYTES))
        }
*/
    },
    getStoreKey: function() {
        var parentList = this.getParentIdList()
        var key = parentList.join('/')
        return key
    },
    getParentIdList: function() {
        var myKey = [this.id || (this.opts && this.opts.id) || this.__name__]
        var parent = (this.opts && this.opts.parent) || this.parent
        if (parent) {
            return parent.getParentIdList().concat(myKey)
        } else {
            return myKey
        }
    },
    getSaveData: function() {
        // recursively get parent collections or parent items
        var key = this.getStoreKey()
        if (key == "Collection") { debugger }
        var items = []
        for (var i=0; i<this.items.length; i++) {
            items.push(this.items[i].get_key())
        }
        var toStore = {attributes:this._attributes, items:items}
        return [key, toStore]
    },
    fetch: function(callback) {

        console.clog(L.INIT,'collection.fetch',this.itemClass.__name__)
        var collectionKey = this.getStoreKey()
        chrome.storage.local.get( collectionKey, _.bind(function(result) {
            if (! result || ! result[collectionKey] || ! result[collectionKey].items) {
                console.warn('could not restore collection, no data stored with key',collectionKey)
                if (callback){callback()}
            } else {
                var fullItemKeys = []
                var itemKeys = []

                for (var i=0; i<result[collectionKey].items.length; i++) {
                    var itemKey = result[collectionKey].items[i]
                    if (itemKey) {
                        itemKeys.push(itemKey)
                        fullItemKeys.push(collectionKey + '/' + itemKey)
                    }
                }
                //console.log('collection.restore items',fullItemKeys)

                // have a list of all the items we need to now fetch from storage
                var item, itemData

                this._attributes = result[collectionKey].attributes
                chrome.storage.local.get(fullItemKeys, _.bind(function(itemsResult) {

                    // need to split this into separate function that we can call independently.
                    for (var i=0; i<itemKeys.length; i++) {
                        itemData = itemsResult[ fullItemKeys[i] ]
/*
                        if (! itemData) {
                            //console.log('fetch itemData for key',fullItemKeys[i],'was empty. did you .save() it?')
                        }
*/
                        item = new this.itemClass({id: itemKeys[i],
                                                   parent: this,
                                                   itemClass: this.itemClass,
                                                   initializedBy: 'collection.fetch',
                                                   attributes:itemData})

                        if (item.onRestore) { _.defer(item.onRestore.bind(item)) }
                        console.assert(item.get_key() == itemKeys[i])
                        this.add(item, 'collection.fetch')
                    }
                    if (callback) { callback() }
                },this))
            }
        },this))
    },
    each: function(iterfunc) {
        var items = []

        for (var i=0; i<this.items.length; i++) {
            // if we calliterfunc here, it might modify this.items...
            items.push(this.items[i])
        }

        for (var i=0; i<items.length; i++) {
            iterfunc(items[i])
        }

/*        for (var key in this.keyeditems) {
            iterfunc( key, this.items[this.keyeditems[key]] )
        }*/
    }
}

_.extend(Collection.prototype, BasicCollection.prototype, CollectionProto)
