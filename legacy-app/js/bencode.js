(function(){

    // simple but inefficient utf8 trickery from stack overflow
    // seems to not work very well?
    var td = new TextDecoder('utf-8')
    var te = new TextEncoder('utf-8')

    window.utf8 = {}
    utf8.toByteArray = function(str) {
        var byteArray = [];
        for (var i = 0; i < str.length; i++)
            if (str.charCodeAt(i) <= 0x7F)
                byteArray.push(str.charCodeAt(i));
        else {
            var h = encodeURIComponent(str.charAt(i)).substr(1).split('%');
            for (var j = 0; j < h.length; j++)
                byteArray.push(parseInt(h[j], 16));
        }
        return byteArray;
    };
    utf8.parse = function(byteArray) {
        var str = '';
        for (var i = 0; i < byteArray.length; i++)
            str +=  byteArray[i] <= 0x7F?
            byteArray[i] === 0x25 ? "%25" : // %
            String.fromCharCode(byteArray[i]) :
        "%" + byteArray[i].toString(16).toUpperCase();
        return decodeURIComponent(str);
    };

    // bencoding functions translated from original Bram's bencode.py
    function python_int(s) {
        var n = parseInt(s,10);
        if (isNaN(n)) { throw Error('ValueError'); }
        return n;
    }

    function decode_int(x,f) {
        f++;
        
        var newf = x.indexOf('e',f);;
        var n = python_int(x.slice(f,newf));

        if (x[f] == '-') {
            if (x[f+1] == '0') {
                throw Error('ValueError');
            }
        } else if (x[f] == '0' && newf != f+1) {
            throw Error('ValueError');
        }

        return [n, newf+1];
    }

    function decode_string(x,f, opts, key) {
        var colon = x.indexOf(':',f);
        var n = python_int(x.slice(f,colon));
        if (x[f] == '0' && colon != f+1) {
            throw Error('ValueError');
        }
        colon++;
        var raw = x.slice(colon,colon+n);
        if (opts && opts.utf8 && key != 'pieces') {
            var decoded = td.decode(stringToUint8ArrayWS(raw))
            //var decoded = utf8.parse(stringToUint8Array(raw))
        } else {
            var decoded = raw;
            if (key == 'pieces') {
                console.assert(Math.floor(raw.length/20) == raw.length/20)
            }
        }
        toret = [decoded, colon+n];
        return toret;
    }

    function decode_list(x,f, opts) {
        var data;
        var v;

        var r = [];
        f++;
        while (x[f] != 'e') {
            data = decode_func[x[f]](x,f, opts);
            v = data[0];
            f = data[1];
            r.push(v);
        }
        return [r, f+1];
    }

    function decode_dict(x, f, opts) {
        var data;
        var data2;
        var k;

        var r = {};
        f++;
        while (x[f] != 'e') {
            data = decode_string(x, f, opts);
            k = data[0];
            f = data[1];

            data2 = decode_func[ x[f] ](x,f, opts, k)
            r[k] = data2[0];
            f = data2[1];
        }
        return [r, f+1];
    }

    var decode_func = {};
    decode_func['l'] = decode_list;
    decode_func['d'] = decode_dict;
    decode_func['i'] = decode_int;
    for (var i=0; i<10; i++) {
        decode_func[i.toString()] = decode_string;
    }

    window.bdecode = function(x, opts) {
        var data = decode_func[x[0]](x, 0, opts); /// maybe have this check if decode_func[x[0]] exists? // most of the time object has no method "<" (html tag?)
        var r = data[0];
        var l = data[1];
        return r;
    }

    function isArray(obj) {
        return Object.prototype.toString.call(obj) === '[object Array]';
    }

    function gettype(val) {
        if (typeof val == 'number' && val.toString() == parseInt(val.toString(),10)) {
            return 'integer';
        } else if (isArray(val)) {
            return 'array';
        } else {
            return typeof val;
        }
    }

    function encode_int(x, r) {
        r.push('i'.charCodeAt(0));
        var s = x.toString();
        for (var i=0; i<s.length; i++) {
            r.push( s[i].charCodeAt(0) ); 
        }
        r.push('e'.charCodeAt(0));
    }
    function encode_string(x, r, stack, cb, opts) {
        var isPieces = stack && stack.length > 0 && stack[stack.length-1] == 'pieces';
        if (opts && opts.utf8 && ! (isPieces) ) {
            //var bytes = utf8.toByteArray(x);
            var bytes = te.encode(x);
        } else {
            var bytes = [];
            for (var i=0; i<x.length; i++) {
                bytes.push(x.charCodeAt(i));
            }
            if (isPieces) { console.assert(Math.floor(bytes.length/20) == bytes.length/20) }
        }
        var s = bytes.length.toString();
        for (var i=0; i<s.length; i++) {
            r.push( s[i].charCodeAt(0) );
        }
        r.push(':'.charCodeAt(0))
        for (var i=0; i<bytes.length; i++) {
            r.push(bytes[i]);
        }
    }
    function encode_array(x, r, stack, cb, opts) {
        r.push( 'l'.charCodeAt(0) );
        for (var i=0; i<x.length; i++) {
            encode_func[gettype(x[i])](x[i], r, stack, cb, opts);
        }
        r.push('e'.charCodeAt(0));
    }
    function encode_object(x ,r, stack, stack_callback, opts) {
        r.push('d'.charCodeAt(0));
        var keys = [];
        for (var key in x) {
            keys.push(key);
        }
        keys.sort()
        for (var j=0; j<keys.length; j++) {
            var key = keys[j];

            var bytes = utf8.toByteArray(key);

            var s = bytes.length.toString();

            for (var i=0; i<s.length; i++) {
                r.push( s[i].charCodeAt(0) );
            }
            r.push(':'.charCodeAt(0));
            for (var i=0; i<bytes.length; i++) {
                r.push( bytes[i] );
            }
            stack.push(key);
            if (stack_callback) { stack_callback(stack, r); }
            encode_func[gettype(x[key])]( x[key], r, stack, stack_callback, opts );
            stack.pop();
        }
        r.push('e'.charCodeAt(0));
    }

    var encode_func = {};
    encode_func['integer'] = encode_int;
    encode_func['string'] = encode_string;
    encode_func['array'] = encode_array;
    encode_func['object'] = encode_object;

    window.bencode = function(x, stack_callback, opts) {
        opts = opts || {utf8:true}
        var r = [];
        var stack = [];
        encode_func[gettype(x)](x ,r, stack, stack_callback, opts);
        return r;
    }
})()