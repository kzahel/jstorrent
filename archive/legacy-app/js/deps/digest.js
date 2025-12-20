/* ***** BEGIN LICENSE BLOCK *****
 *
 * Copyright 2011-2012 Jean-Christophe Sirot <sirot@chelonix.com>
 *
 * This file is part of digest.js
 *
 * digest.js is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * digest.js is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * digest.js. If not, see http://www.gnu.org/licenses/.
 *
 * ***** END LICENSE BLOCK *****  */

/*jslint bitwise: true, browser: true, plusplus: true, maxerr: 50, indent: 4 */

var Digest = (function () {
    "use strict";
    var utils = {
        add: function (x, y) {
            return (x + y) & 0xFFFFFFFF;
        },

        add3: function (a, b, c) {
            return (a + b + c) & 0xFFFFFFFF;
        },

        add4: function (a, b, c, d) {
            return (a + b + c + d) & 0xFFFFFFFF;
        },

        add5: function (a, b, c, d, e) {
            return (a + b + c + d + e) & 0xFFFFFFFF;
        },

        leftrot: function (x, n) {
            return ((x << n) | (x >>> (32 - n))) & 0xFFFFFFFF;
        },

        rightrot: function (x, n) {
            return ((x >>> n) | (x << (32 - n))) & 0xFFFFFFFF;
        }
    };

    /* MD5 */

    function md5Engine() {}

    md5Engine.prototype.processBlock = function (input) {
        var LR = utils.leftrot;
        var ADD = utils.add;
        var ADD4 = utils.add4;

        var data = new DataView(input.buffer, 0, input.length);
        var A = this.current[0];
        var B = this.current[1];
        var C = this.current[2];
        var D = this.current[3];

        var W0 = data.getUint32(0, true);
        A = ADD(B, LR(ADD4(A, W0, 0xD76AA478, (B & C) | (~B & D)), 7));
        var W1 = data.getUint32(4, true);
        D = ADD(A, LR(ADD4(D, W1, 0xE8C7B756, (A & B) | (~A & C)), 12));
        var W2 = data.getUint32(8, true);
        C = ADD(D, LR(ADD4(C, W2, 0x242070DB, (D & A) | (~D & B)), 17));
        var W3 = data.getUint32(12, true);
        B = ADD(C, LR(ADD4(B, W3, 0xC1BDCEEE, (C & D) | (~C & A)), 22));
        var W4 = data.getUint32(16, true);
        A = ADD(B, LR(ADD4(A, W4, 0xF57C0FAF, (B & C) | (~B & D)), 7));
        var W5 = data.getUint32(20, true);
        D = ADD(A, LR(ADD4(D, W5, 0x4787C62A, (A & B) | (~A & C)), 12));
        var W6 = data.getUint32(24, true);
        C = ADD(D, LR(ADD4(C, W6, 0xA8304613, (D & A) | (~D & B)), 17));
        var W7 = data.getUint32(28, true);
        B = ADD(C, LR(ADD4(B, W7, 0xFD469501, (C & D) | (~C & A)), 22));
        var W8 = data.getUint32(32, true);
        A = ADD(B, LR(ADD4(A, W8, 0x698098D8, (B & C) | (~B & D)), 7));
        var W9 = data.getUint32(36, true);
        D = ADD(A, LR(ADD4(D, W9, 0x8B44F7AF, (A & B) | (~A & C)), 12));
        var Wa = data.getUint32(40, true);
        C = ADD(D, LR(ADD4(C, Wa, 0xFFFF5BB1, (D & A) | (~D & B)), 17));
        var Wb = data.getUint32(44, true);
        B = ADD(C, LR(ADD4(B, Wb, 0x895CD7BE, (C & D) | (~C & A)), 22));
        var Wc = data.getUint32(48, true);
        A = ADD(B, LR(ADD4(A, Wc, 0x6B901122, (B & C) | (~B & D)), 7));
        var Wd = data.getUint32(52, true);
        D = ADD(A, LR(ADD4(D, Wd, 0xFD987193, (A & B) | (~A & C)), 12));
        var We = data.getUint32(56, true);
        C = ADD(D, LR(ADD4(C, We, 0xA679438E, (D & A) | (~D & B)), 17));
        var Wf = data.getUint32(60, true);
        B = ADD(C, LR(ADD4(B, Wf, 0x49B40821, (C & D) | (~C & A)), 22));

        A = ADD(B, LR(ADD4(A, W1, 0xF61E2562, (D & B) | (~D & C)), 5));
        D = ADD(A, LR(ADD4(D, W6, 0xC040B340, (C & A) | (~C & B)), 9));
        C = ADD(D, LR(ADD4(C, Wb, 0x265E5A51, (B & D) | (~B & A)), 14));
        B = ADD(C, LR(ADD4(B, W0, 0xE9B6C7AA, (A & C) | (~A & D)), 20));
        A = ADD(B, LR(ADD4(A, W5, 0xD62F105D, (D & B) | (~D & C)), 5));
        D = ADD(A, LR(ADD4(D, Wa,  0x2441453, (C & A) | (~C & B)), 9));
        C = ADD(D, LR(ADD4(C, Wf, 0xD8A1E681, (B & D) | (~B & A)), 14));
        B = ADD(C, LR(ADD4(B, W4, 0xE7D3FBC8, (A & C) | (~A & D)), 20));
        A = ADD(B, LR(ADD4(A, W9, 0x21E1CDE6, (D & B) | (~D & C)), 5));
        D = ADD(A, LR(ADD4(D, We, 0xC33707D6, (C & A) | (~C & B)), 9));
        C = ADD(D, LR(ADD4(C, W3, 0xF4D50D87, (B & D) | (~B & A)), 14));
        B = ADD(C, LR(ADD4(B, W8, 0x455A14ED, (A & C) | (~A & D)), 20));
        A = ADD(B, LR(ADD4(A, Wd, 0xA9E3E905, (D & B) | (~D & C)), 5));
        D = ADD(A, LR(ADD4(D, W2, 0xFCEFA3F8, (C & A) | (~C & B)), 9));
        C = ADD(D, LR(ADD4(C, W7, 0x676F02D9, (B & D) | (~B & A)), 14));
        B = ADD(C, LR(ADD4(B, Wc, 0x8D2A4C8A, (A & C) | (~A & D)), 20));

        A = ADD(B, LR(ADD4(A, W5, 0xFFFA3942, B ^ C ^ D), 4));
        D = ADD(A, LR(ADD4(D, W8, 0x8771F681, A ^ B ^ C), 11));
        C = ADD(D, LR(ADD4(C, Wb, 0x6D9D6122, D ^ A ^ B), 16));
        B = ADD(C, LR(ADD4(B, We, 0xFDE5380C, C ^ D ^ A), 23));
        A = ADD(B, LR(ADD4(A, W1, 0xA4BEEA44, B ^ C ^ D), 4));
        D = ADD(A, LR(ADD4(D, W4, 0x4BDECFA9, A ^ B ^ C), 11));
        C = ADD(D, LR(ADD4(C, W7, 0xF6BB4B60, D ^ A ^ B), 16));
        B = ADD(C, LR(ADD4(B, Wa, 0xBEBFBC70, C ^ D ^ A), 23));
        A = ADD(B, LR(ADD4(A, Wd, 0x289B7EC6, B ^ C ^ D), 4));
        D = ADD(A, LR(ADD4(D, W0, 0xEAA127FA, A ^ B ^ C), 11));
        C = ADD(D, LR(ADD4(C, W3, 0xD4EF3085, D ^ A ^ B), 16));
        B = ADD(C, LR(ADD4(B, W6,  0x4881D05, C ^ D ^ A), 23));
        A = ADD(B, LR(ADD4(A, W9, 0xD9D4D039, B ^ C ^ D), 4));
        D = ADD(A, LR(ADD4(D, Wc, 0xE6DB99E5, A ^ B ^ C), 11));
        C = ADD(D, LR(ADD4(C, Wf, 0x1FA27CF8, D ^ A ^ B), 16));
        B = ADD(C, LR(ADD4(B, W2, 0xC4AC5665, C ^ D ^ A), 23));

        A = ADD(B, LR(ADD4(A, W0, 0xf4292244, C ^ (B | ~D)), 6));
        D = ADD(A, LR(ADD4(D, W7, 0x432aff97, B ^ (A | ~C)), 10));
        C = ADD(D, LR(ADD4(C, We, 0xab9423a7, A ^ (D | ~B)), 15));
        B = ADD(C, LR(ADD4(B, W5, 0xfc93a039, D ^ (C | ~A)), 21));
        A = ADD(B, LR(ADD4(A, Wc, 0x655b59c3, C ^ (B | ~D)), 6));
        D = ADD(A, LR(ADD4(D, W3, 0x8f0ccc92, B ^ (A | ~C)), 10));
        C = ADD(D, LR(ADD4(C, Wa, 0xffeff47d, A ^ (D | ~B)), 15));
        B = ADD(C, LR(ADD4(B, W1, 0x85845dd1, D ^ (C | ~A)), 21));
        A = ADD(B, LR(ADD4(A, W8, 0x6fa87e4f, C ^ (B | ~D)), 6));
        D = ADD(A, LR(ADD4(D, Wf, 0xfe2ce6e0, B ^ (A | ~C)), 10));
        C = ADD(D, LR(ADD4(C, W6, 0xa3014314, A ^ (D | ~B)), 15));
        B = ADD(C, LR(ADD4(B, Wd, 0x4e0811a1, D ^ (C | ~A)), 21));
        A = ADD(B, LR(ADD4(A, W4, 0xf7537e82, C ^ (B | ~D)), 6));
        D = ADD(A, LR(ADD4(D, Wb, 0xbd3af235, B ^ (A | ~C)), 10));
        C = ADD(D, LR(ADD4(C, W2, 0x2ad7d2bb, A ^ (D | ~B)), 15));
        B = ADD(C, LR(ADD4(B, W9, 0xeb86d391, D ^ (C | ~A)), 21));

        this.current[0] += A;
        this.current[1] += B;
        this.current[2] += C;
        this.current[3] += D;
        this.currentLen += 64;
    };

    md5Engine.prototype.doPadding = function () {
        var datalen = (this.inLen + this.currentLen) * 8;
        var msw = 0; // FIXME
        var lsw = datalen & 0xFFFFFFFF;
        var zeros = this.inLen <= 55 ? 55 - this.inLen : 119 - this.inLen;
        var pad = new Uint8Array(new ArrayBuffer(zeros + 1 + 8));
        pad[0] = 0x80;
        pad[pad.length - 8] = lsw & 0xFF;
        pad[pad.length - 7] = (lsw >>> 8) & 0xFF;
        pad[pad.length - 6] = (lsw >>> 16) & 0xFF;
        pad[pad.length - 5] = (lsw >>> 24) & 0xFF;
        pad[pad.length - 4] = msw & 0xFF;
        pad[pad.length - 3] = (msw >>> 8) & 0xFF;
        pad[pad.length - 2] = (msw >>> 16) & 0xFF;
        pad[pad.length - 1] = (msw >>> 24) & 0xFF;
        return pad;
    };

    md5Engine.prototype.getDigest = function () {
        var rv = new Uint8Array(new ArrayBuffer(16));
        rv[0] = this.current[0] & 0xFF;
        rv[1] = (this.current[0] >>> 8) & 0xFF;
        rv[2] = (this.current[0] >>> 16) & 0xFF;
        rv[3] = (this.current[0] >>> 24) & 0xFF;
        rv[4] = this.current[1] & 0xFF;
        rv[5] = (this.current[1] >>> 8) & 0xFF;
        rv[6] = (this.current[1] >>> 16) & 0xFF;
        rv[7] = (this.current[1] >>> 24) & 0xFF;
        rv[8] = this.current[2] & 0xFF;
        rv[9] = (this.current[2] >>> 8) & 0xFF;
        rv[10] = (this.current[2] >>> 16) & 0xFF;
        rv[11] = (this.current[2] >>> 24) & 0xFF;
        rv[12] = this.current[3] & 0xFF;
        rv[13] = (this.current[3] >>> 8) & 0xFF;
        rv[14] = (this.current[3] >>> 16) & 0xFF;
        rv[15] = (this.current[3] >>> 24) & 0xFF;
        return rv.buffer;
    };

    md5Engine.prototype.reset = function () {
        this.currentLen = 0;
        this.current = new Uint32Array(new ArrayBuffer(16));
        this.current[0] = 0x67452301;
        this.current[1] = 0xEFCDAB89;
        this.current[2] = 0x98BADCFE;
        this.current[3] = 0x10325476;
    };

    md5Engine.prototype.blockLen = 64;
    md5Engine.prototype.digestLen = 16;

    /* SHA-1 */

    function sha1Engine() {}

    sha1Engine.prototype.processBlock = function (input) {
        var LR = utils.leftrot;
        var ADD = utils.add5;

        var data = new DataView(input.buffer, 0, input.length);
        var A = this.current[0];
        var B = this.current[1];
        var C = this.current[2];
        var D = this.current[3];
        var E = this.current[4];

        var W0 = data.getUint32(0);
        E = ADD(LR(A, 5), W0, 0x5A827999, ((B & C) | (~B & D)), E);
        B = LR(B, 30);
        var W1 = data.getUint32(4);
        D = ADD(LR(E, 5), W1, 0x5A827999, ((A & B) | (~A & C)), D);
        A = LR(A, 30);
        var W2 = data.getUint32(8);
        C = ADD(LR(D, 5), W2, 0x5A827999, ((E & A) | (~E & B)), C);
        E = LR(E, 30);
        var W3 = data.getUint32(12);
        B = ADD(LR(C, 5), W3, 0x5A827999, ((D & E) | (~D & A)), B);
        D = LR(D, 30);
        var W4 = data.getUint32(16);
        A = ADD(LR(B, 5), W4, 0x5A827999, ((C & D) | (~C & E)), A);
        C = LR(C, 30);
        var W5 = data.getUint32(20);
        E = ADD(LR(A, 5), W5, 0x5A827999, ((B & C) | (~B & D)), E);
        B = LR(B, 30);
        var W6 = data.getUint32(24);
        D = ADD(LR(E, 5), W6, 0x5A827999, ((A & B) | (~A & C)), D);
        A = LR(A, 30);
        var W7 = data.getUint32(28);
        C = ADD(LR(D, 5), W7, 0x5A827999, ((E & A) | (~E & B)), C);
        E = LR(E, 30);
        var W8 = data.getUint32(32);
        B = ADD(LR(C, 5), W8, 0x5A827999, ((D & E) | (~D & A)), B);
        D = LR(D, 30);
        var W9 = data.getUint32(36);
        A = ADD(LR(B, 5), W9, 0x5A827999, ((C & D) | (~C & E)), A);
        C = LR(C, 30);
        var Wa = data.getUint32(40);
        E = ADD(LR(A, 5), Wa, 0x5A827999, ((B & C) | (~B & D)), E);
        B = LR(B, 30);
        var Wb = data.getUint32(44);
        D = ADD(LR(E, 5), Wb, 0x5A827999, ((A & B) | (~A & C)), D);
        A = LR(A, 30);
        var Wc = data.getUint32(48);
        C = ADD(LR(D, 5), Wc, 0x5A827999, ((E & A) | (~E & B)), C);
        E = LR(E, 30);
        var Wd = data.getUint32(52);
        B = ADD(LR(C, 5), Wd, 0x5A827999, ((D & E) | (~D & A)), B);
        D = LR(D, 30);
        var We = data.getUint32(56);
        A = ADD(LR(B, 5), We, 0x5A827999, ((C & D) | (~C & E)), A);
        C = LR(C, 30);
        var Wf = data.getUint32(60);
        E = ADD(LR(A, 5), Wf, 0x5A827999, ((B & C) | (~B & D)), E);
        B = LR(B, 30);
        W0 = LR(Wd ^ W8 ^ W2 ^ W0, 1);
        D = ADD(LR(E, 5), W0, 0x5A827999, ((A & B) | (~A & C)), D);
        A = LR(A, 30);
        W1 = LR(We ^ W9 ^ W3 ^ W1, 1);
        C = ADD(LR(D, 5), W1, 0x5A827999, ((E & A) | (~E & B)), C);
        E = LR(E, 30);
        W2 = LR(Wf ^ Wa ^ W4 ^ W2, 1);
        B = ADD(LR(C, 5), W2, 0x5A827999, ((D & E) | (~D & A)), B);
        D = LR(D, 30);
        W3 = LR(W0 ^ Wb ^ W5 ^ W3, 1);
        A = ADD(LR(B, 5), W3, 0x5A827999, ((C & D) | (~C & E)), A);
        C = LR(C, 30);

        W4 = LR(W1 ^ Wc ^ W6 ^ W4, 1);
        E = ADD(LR(A, 5), W4, 0x6ED9EBA1, (B ^ C ^ D), E);
        B = LR(B, 30);
        W5 = LR(W2 ^ Wd ^ W7 ^ W5, 1);
        D = ADD(LR(E, 5), W5, 0x6ED9EBA1, (A ^ B ^ C), D);
        A = LR(A, 30);
        W6 = LR(W3 ^ We ^ W8 ^ W6, 1);
        C = ADD(LR(D, 5), W6, 0x6ED9EBA1, (E ^ A ^ B), C);
        E = LR(E, 30);
        W7 = LR(W4 ^ Wf ^ W9 ^ W7, 1);
        B = ADD(LR(C, 5), W7, 0x6ED9EBA1, (D ^ E ^ A), B);
        D = LR(D, 30);
        W8 = LR(W5 ^ W0 ^ Wa ^ W8, 1);
        A = ADD(LR(B, 5), W8, 0x6ED9EBA1, (C ^ D ^ E), A);
        C = LR(C, 30);
        W9 = LR(W6 ^ W1 ^ Wb ^ W9, 1);
        E = ADD(LR(A, 5), W9, 0x6ED9EBA1, (B ^ C ^ D), E);
        B = LR(B, 30);
        Wa = LR(W7 ^ W2 ^ Wc ^ Wa, 1);
        D = ADD(LR(E, 5), Wa, 0x6ED9EBA1, (A ^ B ^ C), D);
        A = LR(A, 30);
        Wb = LR(W8 ^ W3 ^ Wd ^ Wb, 1);
        C = ADD(LR(D, 5), Wb, 0x6ED9EBA1, (E ^ A ^ B), C);
        E = LR(E, 30);
        Wc = LR(W9 ^ W4 ^ We ^ Wc, 1);
        B = ADD(LR(C, 5), Wc, 0x6ED9EBA1, (D ^ E ^ A), B);
        D = LR(D, 30);
        Wd = LR(Wa ^ W5 ^ Wf ^ Wd, 1);
        A = ADD(LR(B, 5), Wd, 0x6ED9EBA1, (C ^ D ^ E), A);
        C = LR(C, 30);
        We = LR(Wb ^ W6 ^ W0 ^ We, 1);
        E = ADD(LR(A, 5), We, 0x6ED9EBA1, (B ^ C ^ D), E);
        B = LR(B, 30);
        Wf = LR(Wc ^ W7 ^ W1 ^ Wf, 1);
        D = ADD(LR(E, 5), Wf, 0x6ED9EBA1, (A ^ B ^ C), D);
        A = LR(A, 30);
        W0 = LR(Wd ^ W8 ^ W2 ^ W0, 1);
        C = ADD(LR(D, 5), W0, 0x6ED9EBA1, (E ^ A ^ B), C);
        E = LR(E, 30);
        W1 = LR(We ^ W9 ^ W3 ^ W1, 1);
        B = ADD(LR(C, 5), W1, 0x6ED9EBA1, (D ^ E ^ A), B);
        D = LR(D, 30);
        W2 = LR(Wf ^ Wa ^ W4 ^ W2, 1);
        A = ADD(LR(B, 5), W2, 0x6ED9EBA1, (C ^ D ^ E), A);
        C = LR(C, 30);
        W3 = LR(W0 ^ Wb ^ W5 ^ W3, 1);
        E = ADD(LR(A, 5), W3, 0x6ED9EBA1, (B ^ C ^ D), E);
        B = LR(B, 30);
        W4 = LR(W1 ^ Wc ^ W6 ^ W4, 1);
        D = ADD(LR(E, 5), W4, 0x6ED9EBA1, (A ^ B ^ C), D);
        A = LR(A, 30);
        W5 = LR(W2 ^ Wd ^ W7 ^ W5, 1);
        C = ADD(LR(D, 5), W5, 0x6ED9EBA1, (E ^ A ^ B), C);
        E = LR(E, 30);
        W6 = LR(W3 ^ We ^ W8 ^ W6, 1);
        B = ADD(LR(C, 5), W6, 0x6ED9EBA1, (D ^ E ^ A), B);
        D = LR(D, 30);
        W7 = LR(W4 ^ Wf ^ W9 ^ W7, 1);
        A = ADD(LR(B, 5), W7, 0x6ED9EBA1, (C ^ D ^ E), A);
        C = LR(C, 30);

        W8 = LR(W5 ^ W0 ^ Wa ^ W8, 1);
        E = ADD(LR(A, 5), W8, 0x8F1BBCDC, ((B & C) | (B & D) | (C & D)), E);
        B = LR(B, 30);
        W9 = LR(W6 ^ W1 ^ Wb ^ W9, 1);
        D = ADD(LR(E, 5), W9, 0x8F1BBCDC, ((A & B) | (A & C) | (B & C)), D);
        A = LR(A, 30);
        Wa = LR(W7 ^ W2 ^ Wc ^ Wa, 1);
        C = ADD(LR(D, 5), Wa, 0x8F1BBCDC, ((E & A) | (E & B) | (A & B)), C);
        E = LR(E, 30);
        Wb = LR(W8 ^ W3 ^ Wd ^ Wb, 1);
        B = ADD(LR(C, 5), Wb, 0x8F1BBCDC, ((D & E) | (D & A) | (E & A)), B);
        D = LR(D, 30);
        Wc = LR(W9 ^ W4 ^ We ^ Wc, 1);
        A = ADD(LR(B, 5), Wc, 0x8F1BBCDC, ((C & D) | (C & E) | (D & E)), A);
        C = LR(C, 30);
        Wd = LR(Wa ^ W5 ^ Wf ^ Wd, 1);
        E = ADD(LR(A, 5), Wd, 0x8F1BBCDC, ((B & C) | (B & D) | (C & D)), E);
        B = LR(B, 30);
        We = LR(Wb ^ W6 ^ W0 ^ We, 1);
        D = ADD(LR(E, 5), We, 0x8F1BBCDC, ((A & B) | (A & C) | (B & C)), D);
        A = LR(A, 30);
        Wf = LR(Wc ^ W7 ^ W1 ^ Wf, 1);
        C = ADD(LR(D, 5), Wf, 0x8F1BBCDC, ((E & A) | (E & B) | (A & B)), C);
        E = LR(E, 30);
        W0 = LR(Wd ^ W8 ^ W2 ^ W0, 1);
        B = ADD(LR(C, 5), W0, 0x8F1BBCDC, ((D & E) | (D & A) | (E & A)), B);
        D = LR(D, 30);
        W1 = LR(We ^ W9 ^ W3 ^ W1, 1);
        A = ADD(LR(B, 5), W1, 0x8F1BBCDC, ((C & D) | (C & E) | (D & E)), A);
        C = LR(C, 30);
        W2 = LR(Wf ^ Wa ^ W4 ^ W2, 1);
        E = ADD(LR(A, 5), W2, 0x8F1BBCDC, ((B & C) | (B & D) | (C & D)), E);
        B = LR(B, 30);
        W3 = LR(W0 ^ Wb ^ W5 ^ W3, 1);
        D = ADD(LR(E, 5), W3, 0x8F1BBCDC, ((A & B) | (A & C) | (B & C)), D);
        A = LR(A, 30);
        W4 = LR(W1 ^ Wc ^ W6 ^ W4, 1);
        C = ADD(LR(D, 5), W4, 0x8F1BBCDC, ((E & A) | (E & B) | (A & B)), C);
        E = LR(E, 30);
        W5 = LR(W2 ^ Wd ^ W7 ^ W5, 1);
        B = ADD(LR(C, 5), W5, 0x8F1BBCDC, ((D & E) | (D & A) | (E & A)), B);
        D = LR(D, 30);
        W6 = LR(W3 ^ We ^ W8 ^ W6, 1);
        A = ADD(LR(B, 5), W6, 0x8F1BBCDC, ((C & D) | (C & E) | (D & E)), A);
        C = LR(C, 30);
        W7 = LR(W4 ^ Wf ^ W9 ^ W7, 1);
        E = ADD(LR(A, 5), W7, 0x8F1BBCDC, ((B & C) | (B & D) | (C & D)), E);
        B = LR(B, 30);
        W8 = LR(W5 ^ W0 ^ Wa ^ W8, 1);
        D = ADD(LR(E, 5), W8, 0x8F1BBCDC, ((A & B) | (A & C) | (B & C)), D);
        A = LR(A, 30);
        W9 = LR(W6 ^ W1 ^ Wb ^ W9, 1);
        C = ADD(LR(D, 5), W9, 0x8F1BBCDC, ((E & A) | (E & B) | (A & B)), C);
        E = LR(E, 30);
        Wa = LR(W7 ^ W2 ^ Wc ^ Wa, 1);
        B = ADD(LR(C, 5), Wa, 0x8F1BBCDC, ((D & E) | (D & A) | (E & A)), B);
        D = LR(D, 30);
        Wb = LR(W8 ^ W3 ^ Wd ^ Wb, 1);
        A = ADD(LR(B, 5), Wb, 0x8F1BBCDC, ((C & D) | (C & E) | (D & E)), A);
        C = LR(C, 30);

        Wc = LR(W9 ^ W4 ^ We ^ Wc, 1);
        E = ADD(LR(A, 5), Wc, 0xCA62C1D6, (B ^ C ^ D), E);
        B = LR(B, 30);
        Wd = LR(Wa ^ W5 ^ Wf ^ Wd, 1);
        D = ADD(LR(E, 5), Wd, 0xCA62C1D6, (A ^ B ^ C), D);
        A = LR(A, 30);
        We = LR(Wb ^ W6 ^ W0 ^ We, 1);
        C = ADD(LR(D, 5), We, 0xCA62C1D6, (E ^ A ^ B), C);
        E = LR(E, 30);
        Wf = LR(Wc ^ W7 ^ W1 ^ Wf, 1);
        B = ADD(LR(C, 5), Wf, 0xCA62C1D6, (D ^ E ^ A), B);
        D = LR(D, 30);
        W0 = LR(Wd ^ W8 ^ W2 ^ W0, 1);
        A = ADD(LR(B, 5), W0, 0xCA62C1D6, (C ^ D ^ E), A);
        C = LR(C, 30);
        W1 = LR(We ^ W9 ^ W3 ^ W1, 1);
        E = ADD(LR(A, 5), W1, 0xCA62C1D6, (B ^ C ^ D), E);
        B = LR(B, 30);
        W2 = LR(Wf ^ Wa ^ W4 ^ W2, 1);
        D = ADD(LR(E, 5), W2, 0xCA62C1D6, (A ^ B ^ C), D);
        A = LR(A, 30);
        W3 = LR(W0 ^ Wb ^ W5 ^ W3, 1);
        C = ADD(LR(D, 5), W3, 0xCA62C1D6, (E ^ A ^ B), C);
        E = LR(E, 30);
        W4 = LR(W1 ^ Wc ^ W6 ^ W4, 1);
        B = ADD(LR(C, 5), W4, 0xCA62C1D6, (D ^ E ^ A), B);
        D = LR(D, 30);
        W5 = LR(W2 ^ Wd ^ W7 ^ W5, 1);
        A = ADD(LR(B, 5), W5, 0xCA62C1D6, (C ^ D ^ E), A);
        C = LR(C, 30);
        W6 = LR(W3 ^ We ^ W8 ^ W6, 1);
        E = ADD(LR(A, 5), W6, 0xCA62C1D6, (B ^ C ^ D), E);
        B = LR(B, 30);
        W7 = LR(W4 ^ Wf ^ W9 ^ W7, 1);
        D = ADD(LR(E, 5), W7, 0xCA62C1D6, (A ^ B ^ C), D);
        A = LR(A, 30);
        W8 = LR(W5 ^ W0 ^ Wa ^ W8, 1);
        C = ADD(LR(D, 5), W8, 0xCA62C1D6, (E ^ A ^ B), C);
        E = LR(E, 30);
        W9 = LR(W6 ^ W1 ^ Wb ^ W9, 1);
        B = ADD(LR(C, 5), W9, 0xCA62C1D6, (D ^ E ^ A), B);
        D = LR(D, 30);
        Wa = LR(W7 ^ W2 ^ Wc ^ Wa, 1);
        A = ADD(LR(B, 5), Wa, 0xCA62C1D6, (C ^ D ^ E), A);
        C = LR(C, 30);
        Wb = LR(W8 ^ W3 ^ Wd ^ Wb, 1);
        E = ADD(LR(A, 5), Wb, 0xCA62C1D6, (B ^ C ^ D), E);
        B = LR(B, 30);
        Wc = LR(W9 ^ W4 ^ We ^ Wc, 1);
        D = ADD(LR(E, 5), Wc, 0xCA62C1D6, (A ^ B ^ C), D);
        A = LR(A, 30);
        Wd = LR(Wa ^ W5 ^ Wf ^ Wd, 1);
        C = ADD(LR(D, 5), Wd, 0xCA62C1D6, (E ^ A ^ B), C);
        E = LR(E, 30);
        We = LR(Wb ^ W6 ^ W0 ^ We, 1);
        B = ADD(LR(C, 5), We, 0xCA62C1D6, (D ^ E ^ A), B);
        D = LR(D, 30);
        Wf = LR(Wc ^ W7 ^ W1 ^ Wf, 1);
        A = ADD(LR(B, 5), Wf, 0xCA62C1D6, (C ^ D ^ E), A);
        C = LR(C, 30);

        this.current[0] += A;
        this.current[1] += B;
        this.current[2] += C;
        this.current[3] += D;
        this.current[4] += E;
        this.currentLen += 64;
    };

    sha1Engine.prototype.doPadding = function () {
        var datalen = (this.inLen + this.currentLen) * 8;
        var msw = 0; // FIXME
        var lsw = datalen & 0xFFFFFFFF;
        var zeros = this.inLen <= 55 ? 55 - this.inLen : 119 - this.inLen;
        var pad = new Uint8Array(new ArrayBuffer(zeros + 1 + 8));
        pad[0] = 0x80;
        pad[pad.length - 1] = lsw & 0xFF;
        pad[pad.length - 2] = (lsw >>> 8) & 0xFF;
        pad[pad.length - 3] = (lsw >>> 16) & 0xFF;
        pad[pad.length - 4] = (lsw >>> 24) & 0xFF;
        pad[pad.length - 5] = msw & 0xFF;
        pad[pad.length - 6] = (msw >>> 8) & 0xFF;
        pad[pad.length - 7] = (msw >>> 16) & 0xFF;
        pad[pad.length - 8] = (msw >>> 24) & 0xFF;
        return pad;
    };

    sha1Engine.prototype.getDigest = function () {
        var rv = new Uint8Array(new ArrayBuffer(20));
        rv[3] = this.current[0] & 0xFF;
        rv[2] = (this.current[0] >>> 8) & 0xFF;
        rv[1] = (this.current[0] >>> 16) & 0xFF;
        rv[0] = (this.current[0] >>> 24) & 0xFF;
        rv[7] = this.current[1] & 0xFF;
        rv[6] = (this.current[1] >>> 8) & 0xFF;
        rv[5] = (this.current[1] >>> 16) & 0xFF;
        rv[4] = (this.current[1] >>> 24) & 0xFF;
        rv[11] = this.current[2] & 0xFF;
        rv[10] = (this.current[2] >>> 8) & 0xFF;
        rv[9] = (this.current[2] >>> 16) & 0xFF;
        rv[8] = (this.current[2] >>> 24) & 0xFF;
        rv[15] = this.current[3] & 0xFF;
        rv[14] = (this.current[3] >>> 8) & 0xFF;
        rv[13] = (this.current[3] >>> 16) & 0xFF;
        rv[12] = (this.current[3] >>> 24) & 0xFF;
        rv[19] = this.current[4] & 0xFF;
        rv[18] = (this.current[4] >>> 8) & 0xFF;
        rv[17] = (this.current[4] >>> 16) & 0xFF;
        rv[16] = (this.current[4] >>> 24) & 0xFF;
        return rv.buffer;
    };

    sha1Engine.prototype.reset = function () {
        this.currentLen = 0;
        this.current = new Uint32Array(new ArrayBuffer(20));
        this.current[0] = 0x67452301;
        this.current[1] = 0xEFCDAB89;
        this.current[2] = 0x98BADCFE;
        this.current[3] = 0x10325476;
        this.current[4] = 0xC3D2E1F0;
    };

    sha1Engine.prototype.blockLen = 64;
    sha1Engine.prototype.digestLen = 20;

    /* SHA-256 */

    function sha256Engine() {}

    sha256Engine.prototype.processBlock = function (input) {
        var RR = utils.rightrot;
        var ADD = utils.add;
        var ADD3 = utils.add3;
        var ADD4 = utils.add4;
        var ADD5 = utils.add5;

        var data = new DataView(input.buffer, 0, input.length);
        var A = this.current[0];
        var B = this.current[1];
        var C = this.current[2];
        var D = this.current[3];
        var E = this.current[4];
        var F = this.current[5];
        var G = this.current[6];
        var H = this.current[7];
        var T1;
        var W0, W1, W2, W3, W4, W5, W6, W7;
        var W8, W9, Wa, Wb, Wc, Wd, We, Wf;

        W0 = data.getUint32(0);
        T1 = ADD5(H, RR(E, 6) ^ RR(E, 11) ^ RR(E, 25), (E & F) ^ (~E & G), 0x428A2F98, W0);
        H = ADD3(T1, RR(A, 2) ^ RR(A, 13) ^ RR(A, 22), (A & B) ^ (B & C) ^ (A & C));
        D = ADD(D, T1);
        W1 = data.getUint32(4);
        T1 = ADD5(G, RR(D, 6) ^ RR(D, 11) ^ RR(D, 25), (D & E) ^ (~D & F), 0x71374491, W1);
        G = ADD3(T1, RR(H, 2) ^ RR(H, 13) ^ RR(H, 22), (H & A) ^ (A & B) ^ (H & B));
        C = ADD(C, T1);
        W2 = data.getUint32(8);
        T1 = ADD5(F, RR(C, 6) ^ RR(C, 11) ^ RR(C, 25), (C & D) ^ (~C & E), 0xB5C0FBCF, W2);
        F = ADD3(T1, RR(G, 2) ^ RR(G, 13) ^ RR(G, 22), (G & H) ^ (H & A) ^ (G & A));
        B = ADD(B, T1);
        W3 = data.getUint32(12);
        T1 = ADD5(E, RR(B, 6) ^ RR(B, 11) ^ RR(B, 25), (B & C) ^ (~B & D), 0xE9B5DBA5, W3);
        E = ADD3(T1, RR(F, 2) ^ RR(F, 13) ^ RR(F, 22), (F & G) ^ (G & H) ^ (F & H));
        A = ADD(A, T1);
        W4 = data.getUint32(16);
        T1 = ADD5(D, RR(A, 6) ^ RR(A, 11) ^ RR(A, 25), (A & B) ^ (~A & C), 0x3956C25B, W4);
        D = ADD3(T1, RR(E, 2) ^ RR(E, 13) ^ RR(E, 22), (E & F) ^ (F & G) ^ (E & G));
        H = ADD(H, T1);
        W5 = data.getUint32(20);
        T1 = ADD5(C, RR(H, 6) ^ RR(H, 11) ^ RR(H, 25), (H & A) ^ (~H & B), 0x59F111F1, W5);
        C = ADD3(T1, RR(D, 2) ^ RR(D, 13) ^ RR(D, 22), (D & E) ^ (E & F) ^ (D & F));
        G = ADD(G, T1);
        W6 = data.getUint32(24);
        T1 = ADD5(B, RR(G, 6) ^ RR(G, 11) ^ RR(G, 25), (G & H) ^ (~G & A), 0x923F82A4, W6);
        B = ADD3(T1, RR(C, 2) ^ RR(C, 13) ^ RR(C, 22), (C & D) ^ (D & E) ^ (C & E));
        F = ADD(F, T1);
        W7 = data.getUint32(28);
        T1 = ADD5(A, RR(F, 6) ^ RR(F, 11) ^ RR(F, 25), (F & G) ^ (~F & H), 0xAB1C5ED5, W7);
        A = ADD3(T1, RR(B, 2) ^ RR(B, 13) ^ RR(B, 22), (B & C) ^ (C & D) ^ (B & D));
        E = ADD(E, T1);
        W8 = data.getUint32(32);
        T1 = ADD5(H, RR(E, 6) ^ RR(E, 11) ^ RR(E, 25), (E & F) ^ (~E & G), 0xD807AA98, W8);
        H = ADD3(T1, RR(A, 2) ^ RR(A, 13) ^ RR(A, 22), (A & B) ^ (B & C) ^ (A & C));
        D = ADD(D, T1);
        W9 = data.getUint32(36);
        T1 = ADD5(G, RR(D, 6) ^ RR(D, 11) ^ RR(D, 25), (D & E) ^ (~D & F), 0x12835B01, W9);
        G = ADD3(T1, RR(H, 2) ^ RR(H, 13) ^ RR(H, 22), (H & A) ^ (A & B) ^ (H & B));
        C = ADD(C, T1);
        Wa = data.getUint32(40);
        T1 = ADD5(F, RR(C, 6) ^ RR(C, 11) ^ RR(C, 25), (C & D) ^ (~C & E), 0x243185BE, Wa);
        F = ADD3(T1, RR(G, 2) ^ RR(G, 13) ^ RR(G, 22), (G & H) ^ (H & A) ^ (G & A));
        B = ADD(B, T1);
        Wb = data.getUint32(44);
        T1 = ADD5(E, RR(B, 6) ^ RR(B, 11) ^ RR(B, 25), (B & C) ^ (~B & D), 0x550C7DC3, Wb);
        E = ADD3(T1, RR(F, 2) ^ RR(F, 13) ^ RR(F, 22), (F & G) ^ (G & H) ^ (F & H));
        A = ADD(A, T1);
        Wc = data.getUint32(48);
        T1 = ADD5(D, RR(A, 6) ^ RR(A, 11) ^ RR(A, 25), (A & B) ^ (~A & C), 0x72BE5D74, Wc);
        D = ADD3(T1, RR(E, 2) ^ RR(E, 13) ^ RR(E, 22), (E & F) ^ (F & G) ^ (E & G));
        H = ADD(H, T1);
        Wd = data.getUint32(52);
        T1 = ADD5(C, RR(H, 6) ^ RR(H, 11) ^ RR(H, 25), (H & A) ^ (~H & B), 0x80DEB1FE, Wd);
        C = ADD3(T1, RR(D, 2) ^ RR(D, 13) ^ RR(D, 22), (D & E) ^ (E & F) ^ (D & F));
        G = ADD(G, T1);
        We = data.getUint32(56);
        T1 = ADD5(B, RR(G, 6) ^ RR(G, 11) ^ RR(G, 25), (G & H) ^ (~G & A), 0x9BDC06A7, We);
        B = ADD3(T1, RR(C, 2) ^ RR(C, 13) ^ RR(C, 22), (C & D) ^ (D & E) ^ (C & E));
        F = ADD(F, T1);
        Wf = data.getUint32(60);
        T1 = ADD5(A, RR(F, 6) ^ RR(F, 11) ^ RR(F, 25), (F & G) ^ (~F & H), 0xC19BF174, Wf);
        A = ADD3(T1, RR(B, 2) ^ RR(B, 13) ^ RR(B, 22), (B & C) ^ (C & D) ^ (B & D));
        E = ADD(E, T1);
        W0 = ADD4(RR(We, 17) ^ RR(We, 19) ^ (We >>> 10), W9, RR(W1, 7) ^ RR(W1, 18) ^ (W1 >>> 3), W0);
        T1 = ADD5(H, RR(E, 6) ^ RR(E, 11) ^ RR(E, 25), (E & F) ^ (~E & G), 0xE49B69C1, W0);
        H = ADD3(T1, RR(A, 2) ^ RR(A, 13) ^ RR(A, 22), (A & B) ^ (B & C) ^ (A & C));
        D = ADD(D, T1);
        W1 = ADD4(RR(Wf, 17) ^ RR(Wf, 19) ^ (Wf >>> 10), Wa, RR(W2, 7) ^ RR(W2, 18) ^ (W2 >>> 3), W1);
        T1 = ADD5(G, RR(D, 6) ^ RR(D, 11) ^ RR(D, 25), (D & E) ^ (~D & F), 0xEFBE4786, W1);
        G = ADD3(T1, RR(H, 2) ^ RR(H, 13) ^ RR(H, 22), (H & A) ^ (A & B) ^ (H & B));
        C = ADD(C, T1);
        W2 = ADD4(RR(W0, 17) ^ RR(W0, 19) ^ (W0 >>> 10), Wb, RR(W3, 7) ^ RR(W3, 18) ^ (W3 >>> 3), W2);
        T1 = ADD5(F, RR(C, 6) ^ RR(C, 11) ^ RR(C, 25), (C & D) ^ (~C & E), 0x0FC19DC6, W2);
        F = ADD3(T1, RR(G, 2) ^ RR(G, 13) ^ RR(G, 22), (G & H) ^ (H & A) ^ (G & A));
        B = ADD(B, T1);
        W3 = ADD4(RR(W1, 17) ^ RR(W1, 19) ^ (W1 >>> 10), Wc, RR(W4, 7) ^ RR(W4, 18) ^ (W4 >>> 3), W3);
        T1 = ADD5(E, RR(B, 6) ^ RR(B, 11) ^ RR(B, 25), (B & C) ^ (~B & D), 0x240CA1CC, W3);
        E = ADD3(T1, RR(F, 2) ^ RR(F, 13) ^ RR(F, 22), (F & G) ^ (G & H) ^ (F & H));
        A = ADD(A, T1);
        W4 = ADD4(RR(W2, 17) ^ RR(W2, 19) ^ (W2 >>> 10), Wd, RR(W5, 7) ^ RR(W5, 18) ^ (W5 >>> 3), W4);
        T1 = ADD5(D, RR(A, 6) ^ RR(A, 11) ^ RR(A, 25), (A & B) ^ (~A & C), 0x2DE92C6F, W4);
        D = ADD3(T1, RR(E, 2) ^ RR(E, 13) ^ RR(E, 22), (E & F) ^ (F & G) ^ (E & G));
        H = ADD(H, T1);
        W5 = ADD4(RR(W3, 17) ^ RR(W3, 19) ^ (W3 >>> 10), We, RR(W6, 7) ^ RR(W6, 18) ^ (W6 >>> 3), W5);
        T1 = ADD5(C, RR(H, 6) ^ RR(H, 11) ^ RR(H, 25), (H & A) ^ (~H & B), 0x4A7484AA, W5);
        C = ADD3(T1, RR(D, 2) ^ RR(D, 13) ^ RR(D, 22), (D & E) ^ (E & F) ^ (D & F));
        G = ADD(G, T1);
        W6 = ADD4(RR(W4, 17) ^ RR(W4, 19) ^ (W4 >>> 10), Wf, RR(W7, 7) ^ RR(W7, 18) ^ (W7 >>> 3), W6);
        T1 = ADD5(B, RR(G, 6) ^ RR(G, 11) ^ RR(G, 25), (G & H) ^ (~G & A), 0x5CB0A9DC, W6);
        B = ADD3(T1, RR(C, 2) ^ RR(C, 13) ^ RR(C, 22), (C & D) ^ (D & E) ^ (C & E));
        F = ADD(F, T1);
        W7 = ADD4(RR(W5, 17) ^ RR(W5, 19) ^ (W5 >>> 10), W0, RR(W8, 7) ^ RR(W8, 18) ^ (W8 >>> 3), W7);
        T1 = ADD5(A, RR(F, 6) ^ RR(F, 11) ^ RR(F, 25), (F & G) ^ (~F & H), 0x76F988DA, W7);
        A = ADD3(T1, RR(B, 2) ^ RR(B, 13) ^ RR(B, 22), (B & C) ^ (C & D) ^ (B & D));
        E = ADD(E, T1);
        W8 = ADD4(RR(W6, 17) ^ RR(W6, 19) ^ (W6 >>> 10), W1, RR(W9, 7) ^ RR(W9, 18) ^ (W9 >>> 3), W8);
        T1 = ADD5(H, RR(E, 6) ^ RR(E, 11) ^ RR(E, 25), (E & F) ^ (~E & G), 0x983E5152, W8);
        H = ADD3(T1, RR(A, 2) ^ RR(A, 13) ^ RR(A, 22), (A & B) ^ (B & C) ^ (A & C));
        D = ADD(D, T1);
        W9 = ADD4(RR(W7, 17) ^ RR(W7, 19) ^ (W7 >>> 10), W2, RR(Wa, 7) ^ RR(Wa, 18) ^ (Wa >>> 3), W9);
        T1 = ADD5(G, RR(D, 6) ^ RR(D, 11) ^ RR(D, 25), (D & E) ^ (~D & F), 0xA831C66D, W9);
        G = ADD3(T1, RR(H, 2) ^ RR(H, 13) ^ RR(H, 22), (H & A) ^ (A & B) ^ (H & B));
        C = ADD(C, T1);
        Wa = ADD4(RR(W8, 17) ^ RR(W8, 19) ^ (W8 >>> 10), W3, RR(Wb, 7) ^ RR(Wb, 18) ^ (Wb >>> 3), Wa);
        T1 = ADD5(F, RR(C, 6) ^ RR(C, 11) ^ RR(C, 25), (C & D) ^ (~C & E), 0xB00327C8, Wa);
        F = ADD3(T1, RR(G, 2) ^ RR(G, 13) ^ RR(G, 22), (G & H) ^ (H & A) ^ (G & A));
        B = ADD(B, T1);
        Wb = ADD4(RR(W9, 17) ^ RR(W9, 19) ^ (W9 >>> 10), W4, RR(Wc, 7) ^ RR(Wc, 18) ^ (Wc >>> 3), Wb);
        T1 = ADD5(E, RR(B, 6) ^ RR(B, 11) ^ RR(B, 25), (B & C) ^ (~B & D), 0xBF597FC7, Wb);
        E = ADD3(T1, RR(F, 2) ^ RR(F, 13) ^ RR(F, 22), (F & G) ^ (G & H) ^ (F & H));
        A = ADD(A, T1);
        Wc = ADD4(RR(Wa, 17) ^ RR(Wa, 19) ^ (Wa >>> 10), W5, RR(Wd, 7) ^ RR(Wd, 18) ^ (Wd >>> 3), Wc);
        T1 = ADD5(D, RR(A, 6) ^ RR(A, 11) ^ RR(A, 25), (A & B) ^ (~A & C), 0xC6E00BF3, Wc);
        D = ADD3(T1, RR(E, 2) ^ RR(E, 13) ^ RR(E, 22), (E & F) ^ (F & G) ^ (E & G));
        H = ADD(H, T1);
        Wd = ADD4(RR(Wb, 17) ^ RR(Wb, 19) ^ (Wb >>> 10), W6, RR(We, 7) ^ RR(We, 18) ^ (We >>> 3), Wd);
        T1 = ADD5(C, RR(H, 6) ^ RR(H, 11) ^ RR(H, 25), (H & A) ^ (~H & B), 0xD5A79147, Wd);
        C = ADD3(T1, RR(D, 2) ^ RR(D, 13) ^ RR(D, 22), (D & E) ^ (E & F) ^ (D & F));
        G = ADD(G, T1);
        We = ADD4(RR(Wc, 17) ^ RR(Wc, 19) ^ (Wc >>> 10), W7, RR(Wf, 7) ^ RR(Wf, 18) ^ (Wf >>> 3), We);
        T1 = ADD5(B, RR(G, 6) ^ RR(G, 11) ^ RR(G, 25), (G & H) ^ (~G & A), 0x06CA6351, We);
        B = ADD3(T1, RR(C, 2) ^ RR(C, 13) ^ RR(C, 22), (C & D) ^ (D & E) ^ (C & E));
        F = ADD(F, T1);
        Wf = ADD4(RR(Wd, 17) ^ RR(Wd, 19) ^ (Wd >>> 10), W8, RR(W0, 7) ^ RR(W0, 18) ^ (W0 >>> 3), Wf);
        T1 = ADD5(A, RR(F, 6) ^ RR(F, 11) ^ RR(F, 25), (F & G) ^ (~F & H), 0x14292967, Wf);
        A = ADD3(T1, RR(B, 2) ^ RR(B, 13) ^ RR(B, 22), (B & C) ^ (C & D) ^ (B & D));
        E = ADD(E, T1);
        W0 = ADD4(RR(We, 17) ^ RR(We, 19) ^ (We >>> 10), W9, RR(W1, 7) ^ RR(W1, 18) ^ (W1 >>> 3), W0);
        T1 = ADD5(H, RR(E, 6) ^ RR(E, 11) ^ RR(E, 25), (E & F) ^ (~E & G), 0x27B70A85, W0);
        H = ADD3(T1, RR(A, 2) ^ RR(A, 13) ^ RR(A, 22), (A & B) ^ (B & C) ^ (A & C));
        D = ADD(D, T1);
        W1 = ADD4(RR(Wf, 17) ^ RR(Wf, 19) ^ (Wf >>> 10), Wa, RR(W2, 7) ^ RR(W2, 18) ^ (W2 >>> 3), W1);
        T1 = ADD5(G, RR(D, 6) ^ RR(D, 11) ^ RR(D, 25), (D & E) ^ (~D & F), 0x2E1B2138, W1);
        G = ADD3(T1, RR(H, 2) ^ RR(H, 13) ^ RR(H, 22), (H & A) ^ (A & B) ^ (H & B));
        C = ADD(C, T1);
        W2 = ADD4(RR(W0, 17) ^ RR(W0, 19) ^ (W0 >>> 10), Wb, RR(W3, 7) ^ RR(W3, 18) ^ (W3 >>> 3), W2);
        T1 = ADD5(F, RR(C, 6) ^ RR(C, 11) ^ RR(C, 25), (C & D) ^ (~C & E), 0x4D2C6DFC, W2);
        F = ADD3(T1, RR(G, 2) ^ RR(G, 13) ^ RR(G, 22), (G & H) ^ (H & A) ^ (G & A));
        B = ADD(B, T1);
        W3 = ADD4(RR(W1, 17) ^ RR(W1, 19) ^ (W1 >>> 10), Wc, RR(W4, 7) ^ RR(W4, 18) ^ (W4 >>> 3), W3);
        T1 = ADD5(E, RR(B, 6) ^ RR(B, 11) ^ RR(B, 25), (B & C) ^ (~B & D), 0x53380D13, W3);
        E = ADD3(T1, RR(F, 2) ^ RR(F, 13) ^ RR(F, 22), (F & G) ^ (G & H) ^ (F & H));
        A = ADD(A, T1);
        W4 = ADD4(RR(W2, 17) ^ RR(W2, 19) ^ (W2 >>> 10), Wd, RR(W5, 7) ^ RR(W5, 18) ^ (W5 >>> 3), W4);
        T1 = ADD5(D, RR(A, 6) ^ RR(A, 11) ^ RR(A, 25), (A & B) ^ (~A & C), 0x650A7354, W4);
        D = ADD3(T1, RR(E, 2) ^ RR(E, 13) ^ RR(E, 22), (E & F) ^ (F & G) ^ (E & G));
        H = ADD(H, T1);
        W5 = ADD4(RR(W3, 17) ^ RR(W3, 19) ^ (W3 >>> 10), We, RR(W6, 7) ^ RR(W6, 18) ^ (W6 >>> 3), W5);
        T1 = ADD5(C, RR(H, 6) ^ RR(H, 11) ^ RR(H, 25), (H & A) ^ (~H & B), 0x766A0ABB, W5);
        C = ADD3(T1, RR(D, 2) ^ RR(D, 13) ^ RR(D, 22), (D & E) ^ (E & F) ^ (D & F));
        G = ADD(G, T1);
        W6 = ADD4(RR(W4, 17) ^ RR(W4, 19) ^ (W4 >>> 10), Wf, RR(W7, 7) ^ RR(W7, 18) ^ (W7 >>> 3), W6);
        T1 = ADD5(B, RR(G, 6) ^ RR(G, 11) ^ RR(G, 25), (G & H) ^ (~G & A), 0x81C2C92E, W6);
        B = ADD3(T1, RR(C, 2) ^ RR(C, 13) ^ RR(C, 22), (C & D) ^ (D & E) ^ (C & E));
        F = ADD(F, T1);
        W7 = ADD4(RR(W5, 17) ^ RR(W5, 19) ^ (W5 >>> 10), W0, RR(W8, 7) ^ RR(W8, 18) ^ (W8 >>> 3), W7);
        T1 = ADD5(A, RR(F, 6) ^ RR(F, 11) ^ RR(F, 25), (F & G) ^ (~F & H), 0x92722C85, W7);
        A = ADD3(T1, RR(B, 2) ^ RR(B, 13) ^ RR(B, 22), (B & C) ^ (C & D) ^ (B & D));
        E = ADD(E, T1);
        W8 = ADD4(RR(W6, 17) ^ RR(W6, 19) ^ (W6 >>> 10), W1, RR(W9, 7) ^ RR(W9, 18) ^ (W9 >>> 3), W8);
        T1 = ADD5(H, RR(E, 6) ^ RR(E, 11) ^ RR(E, 25), (E & F) ^ (~E & G), 0xA2BFE8A1, W8);
        H = ADD3(T1, RR(A, 2) ^ RR(A, 13) ^ RR(A, 22), (A & B) ^ (B & C) ^ (A & C));
        D = ADD(D, T1);
        W9 = ADD4(RR(W7, 17) ^ RR(W7, 19) ^ (W7 >>> 10), W2, RR(Wa, 7) ^ RR(Wa, 18) ^ (Wa >>> 3), W9);
        T1 = ADD5(G, RR(D, 6) ^ RR(D, 11) ^ RR(D, 25), (D & E) ^ (~D & F), 0xA81A664B, W9);
        G = ADD3(T1, RR(H, 2) ^ RR(H, 13) ^ RR(H, 22), (H & A) ^ (A & B) ^ (H & B));
        C = ADD(C, T1);
        Wa = ADD4(RR(W8, 17) ^ RR(W8, 19) ^ (W8 >>> 10), W3, RR(Wb, 7) ^ RR(Wb, 18) ^ (Wb >>> 3), Wa);
        T1 = ADD5(F, RR(C, 6) ^ RR(C, 11) ^ RR(C, 25), (C & D) ^ (~C & E), 0xC24B8B70, Wa);
        F = ADD3(T1, RR(G, 2) ^ RR(G, 13) ^ RR(G, 22), (G & H) ^ (H & A) ^ (G & A));
        B = ADD(B, T1);
        Wb = ADD4(RR(W9, 17) ^ RR(W9, 19) ^ (W9 >>> 10), W4, RR(Wc, 7) ^ RR(Wc, 18) ^ (Wc >>> 3), Wb);
        T1 = ADD5(E, RR(B, 6) ^ RR(B, 11) ^ RR(B, 25), (B & C) ^ (~B & D), 0xC76C51A3, Wb);
        E = ADD3(T1, RR(F, 2) ^ RR(F, 13) ^ RR(F, 22), (F & G) ^ (G & H) ^ (F & H));
        A = ADD(A, T1);
        Wc = ADD4(RR(Wa, 17) ^ RR(Wa, 19) ^ (Wa >>> 10), W5, RR(Wd, 7) ^ RR(Wd, 18) ^ (Wd >>> 3), Wc);
        T1 = ADD5(D, RR(A, 6) ^ RR(A, 11) ^ RR(A, 25), (A & B) ^ (~A & C), 0xD192E819, Wc);
        D = ADD3(T1, RR(E, 2) ^ RR(E, 13) ^ RR(E, 22), (E & F) ^ (F & G) ^ (E & G));
        H = ADD(H, T1);
        Wd = ADD4(RR(Wb, 17) ^ RR(Wb, 19) ^ (Wb >>> 10), W6, RR(We, 7) ^ RR(We, 18) ^ (We >>> 3), Wd);
        T1 = ADD5(C, RR(H, 6) ^ RR(H, 11) ^ RR(H, 25), (H & A) ^ (~H & B), 0xD6990624, Wd);
        C = ADD3(T1, RR(D, 2) ^ RR(D, 13) ^ RR(D, 22), (D & E) ^ (E & F) ^ (D & F));
        G = ADD(G, T1);
        We = ADD4(RR(Wc, 17) ^ RR(Wc, 19) ^ (Wc >>> 10), W7, RR(Wf, 7) ^ RR(Wf, 18) ^ (Wf >>> 3), We);
        T1 = ADD5(B, RR(G, 6) ^ RR(G, 11) ^ RR(G, 25), (G & H) ^ (~G & A), 0xF40E3585, We);
        B = ADD3(T1, RR(C, 2) ^ RR(C, 13) ^ RR(C, 22), (C & D) ^ (D & E) ^ (C & E));
        F = ADD(F, T1);
        Wf = ADD4(RR(Wd, 17) ^ RR(Wd, 19) ^ (Wd >>> 10), W8, RR(W0, 7) ^ RR(W0, 18) ^ (W0 >>> 3), Wf);
        T1 = ADD5(A, RR(F, 6) ^ RR(F, 11) ^ RR(F, 25), (F & G) ^ (~F & H), 0x106AA070, Wf);
        A = ADD3(T1, RR(B, 2) ^ RR(B, 13) ^ RR(B, 22), (B & C) ^ (C & D) ^ (B & D));
        E = ADD(E, T1);
        W0 = ADD4(RR(We, 17) ^ RR(We, 19) ^ (We >>> 10), W9, RR(W1, 7) ^ RR(W1, 18) ^ (W1 >>> 3), W0);
        T1 = ADD5(H, RR(E, 6) ^ RR(E, 11) ^ RR(E, 25), (E & F) ^ (~E & G), 0x19A4C116, W0);
        H = ADD3(T1, RR(A, 2) ^ RR(A, 13) ^ RR(A, 22), (A & B) ^ (B & C) ^ (A & C));
        D = ADD(D, T1);
        W1 = ADD4(RR(Wf, 17) ^ RR(Wf, 19) ^ (Wf >>> 10), Wa, RR(W2, 7) ^ RR(W2, 18) ^ (W2 >>> 3), W1);
        T1 = ADD5(G, RR(D, 6) ^ RR(D, 11) ^ RR(D, 25), (D & E) ^ (~D & F), 0x1E376C08, W1);
        G = ADD3(T1, RR(H, 2) ^ RR(H, 13) ^ RR(H, 22), (H & A) ^ (A & B) ^ (H & B));
        C = ADD(C, T1);
        W2 = ADD4(RR(W0, 17) ^ RR(W0, 19) ^ (W0 >>> 10), Wb, RR(W3, 7) ^ RR(W3, 18) ^ (W3 >>> 3), W2);
        T1 = ADD5(F, RR(C, 6) ^ RR(C, 11) ^ RR(C, 25), (C & D) ^ (~C & E), 0x2748774C, W2);
        F = ADD3(T1, RR(G, 2) ^ RR(G, 13) ^ RR(G, 22), (G & H) ^ (H & A) ^ (G & A));
        B = ADD(B, T1);
        W3 = ADD4(RR(W1, 17) ^ RR(W1, 19) ^ (W1 >>> 10), Wc, RR(W4, 7) ^ RR(W4, 18) ^ (W4 >>> 3), W3);
        T1 = ADD5(E, RR(B, 6) ^ RR(B, 11) ^ RR(B, 25), (B & C) ^ (~B & D), 0x34B0BCB5, W3);
        E = ADD3(T1, RR(F, 2) ^ RR(F, 13) ^ RR(F, 22), (F & G) ^ (G & H) ^ (F & H));
        A = ADD(A, T1);
        W4 = ADD4(RR(W2, 17) ^ RR(W2, 19) ^ (W2 >>> 10), Wd, RR(W5, 7) ^ RR(W5, 18) ^ (W5 >>> 3), W4);
        T1 = ADD5(D, RR(A, 6) ^ RR(A, 11) ^ RR(A, 25), (A & B) ^ (~A & C), 0x391C0CB3, W4);
        D = ADD3(T1, RR(E, 2) ^ RR(E, 13) ^ RR(E, 22), (E & F) ^ (F & G) ^ (E & G));
        H = ADD(H, T1);
        W5 = ADD4(RR(W3, 17) ^ RR(W3, 19) ^ (W3 >>> 10), We, RR(W6, 7) ^ RR(W6, 18) ^ (W6 >>> 3), W5);
        T1 = ADD5(C, RR(H, 6) ^ RR(H, 11) ^ RR(H, 25), (H & A) ^ (~H & B), 0x4ED8AA4A, W5);
        C = ADD3(T1, RR(D, 2) ^ RR(D, 13) ^ RR(D, 22), (D & E) ^ (E & F) ^ (D & F));
        G = ADD(G, T1);
        W6 = ADD4(RR(W4, 17) ^ RR(W4, 19) ^ (W4 >>> 10), Wf, RR(W7, 7) ^ RR(W7, 18) ^ (W7 >>> 3), W6);
        T1 = ADD5(B, RR(G, 6) ^ RR(G, 11) ^ RR(G, 25), (G & H) ^ (~G & A), 0x5B9CCA4F, W6);
        B = ADD3(T1, RR(C, 2) ^ RR(C, 13) ^ RR(C, 22), (C & D) ^ (D & E) ^ (C & E));
        F = ADD(F, T1);
        W7 = ADD4(RR(W5, 17) ^ RR(W5, 19) ^ (W5 >>> 10), W0, RR(W8, 7) ^ RR(W8, 18) ^ (W8 >>> 3), W7);
        T1 = ADD5(A, RR(F, 6) ^ RR(F, 11) ^ RR(F, 25), (F & G) ^ (~F & H), 0x682E6FF3, W7);
        A = ADD3(T1, RR(B, 2) ^ RR(B, 13) ^ RR(B, 22), (B & C) ^ (C & D) ^ (B & D));
        E = ADD(E, T1);
        W8 = ADD4(RR(W6, 17) ^ RR(W6, 19) ^ (W6 >>> 10), W1, RR(W9, 7) ^ RR(W9, 18) ^ (W9 >>> 3), W8);
        T1 = ADD5(H, RR(E, 6) ^ RR(E, 11) ^ RR(E, 25), (E & F) ^ (~E & G), 0x748F82EE, W8);
        H = ADD3(T1, RR(A, 2) ^ RR(A, 13) ^ RR(A, 22), (A & B) ^ (B & C) ^ (A & C));
        D = ADD(D, T1);
        W9 = ADD4(RR(W7, 17) ^ RR(W7, 19) ^ (W7 >>> 10), W2, RR(Wa, 7) ^ RR(Wa, 18) ^ (Wa >>> 3), W9);
        T1 = ADD5(G, RR(D, 6) ^ RR(D, 11) ^ RR(D, 25), (D & E) ^ (~D & F), 0x78A5636F, W9);
        G = ADD3(T1, RR(H, 2) ^ RR(H, 13) ^ RR(H, 22), (H & A) ^ (A & B) ^ (H & B));
        C = ADD(C, T1);
        Wa = ADD4(RR(W8, 17) ^ RR(W8, 19) ^ (W8 >>> 10), W3, RR(Wb, 7) ^ RR(Wb, 18) ^ (Wb >>> 3), Wa);
        T1 = ADD5(F, RR(C, 6) ^ RR(C, 11) ^ RR(C, 25), (C & D) ^ (~C & E), 0x84C87814, Wa);
        F = ADD3(T1, RR(G, 2) ^ RR(G, 13) ^ RR(G, 22), (G & H) ^ (H & A) ^ (G & A));
        B = ADD(B, T1);
        Wb = ADD4(RR(W9, 17) ^ RR(W9, 19) ^ (W9 >>> 10), W4, RR(Wc, 7) ^ RR(Wc, 18) ^ (Wc >>> 3), Wb);
        T1 = ADD5(E, RR(B, 6) ^ RR(B, 11) ^ RR(B, 25), (B & C) ^ (~B & D), 0x8CC70208, Wb);
        E = ADD3(T1, RR(F, 2) ^ RR(F, 13) ^ RR(F, 22), (F & G) ^ (G & H) ^ (F & H));
        A = ADD(A, T1);
        Wc = ADD4(RR(Wa, 17) ^ RR(Wa, 19) ^ (Wa >>> 10), W5, RR(Wd, 7) ^ RR(Wd, 18) ^ (Wd >>> 3), Wc);
        T1 = ADD5(D, RR(A, 6) ^ RR(A, 11) ^ RR(A, 25), (A & B) ^ (~A & C), 0x90BEFFFA, Wc);
        D = ADD3(T1, RR(E, 2) ^ RR(E, 13) ^ RR(E, 22), (E & F) ^ (F & G) ^ (E & G));
        H = ADD(H, T1);
        Wd = ADD4(RR(Wb, 17) ^ RR(Wb, 19) ^ (Wb >>> 10), W6, RR(We, 7) ^ RR(We, 18) ^ (We >>> 3), Wd);
        T1 = ADD5(C, RR(H, 6) ^ RR(H, 11) ^ RR(H, 25), (H & A) ^ (~H & B), 0xA4506CEB, Wd);
        C = ADD3(T1, RR(D, 2) ^ RR(D, 13) ^ RR(D, 22), (D & E) ^ (E & F) ^ (D & F));
        G = ADD(G, T1);
        We = ADD4(RR(Wc, 17) ^ RR(Wc, 19) ^ (Wc >>> 10), W7, RR(Wf, 7) ^ RR(Wf, 18) ^ (Wf >>> 3), We);
        T1 = ADD5(B, RR(G, 6) ^ RR(G, 11) ^ RR(G, 25), (G & H) ^ (~G & A), 0xBEF9A3F7, We);
        B = ADD3(T1, RR(C, 2) ^ RR(C, 13) ^ RR(C, 22), (C & D) ^ (D & E) ^ (C & E));
        F = ADD(F, T1);
        Wf = ADD4(RR(Wd, 17) ^ RR(Wd, 19) ^ (Wd >>> 10), W8, RR(W0, 7) ^ RR(W0, 18) ^ (W0 >>> 3), Wf);
        T1 = ADD5(A, RR(F, 6) ^ RR(F, 11) ^ RR(F, 25), (F & G) ^ (~F & H), 0xC67178F2, Wf);
        A = ADD3(T1, RR(B, 2) ^ RR(B, 13) ^ RR(B, 22), (B & C) ^ (C & D) ^ (B & D));
        E = ADD(E, T1);

        this.current[0] += A;
        this.current[1] += B;
        this.current[2] += C;
        this.current[3] += D;
        this.current[4] += E;
        this.current[5] += F;
        this.current[6] += G;
        this.current[7] += H;
        this.currentLen += 64;
    };

    sha256Engine.prototype.doPadding = function () {
        var datalen = (this.inLen + this.currentLen) * 8;
        var msw = 0; // FIXME
        var lsw = datalen & 0xFFFFFFFF;
        var zeros = this.inLen <= 55 ? 55 - this.inLen : 119 - this.inLen;
        var pad = new Uint8Array(new ArrayBuffer(zeros + 1 + 8));
        pad[0] = 0x80;
        pad[pad.length - 1] = lsw & 0xFF;
        pad[pad.length - 2] = (lsw >>> 8) & 0xFF;
        pad[pad.length - 3] = (lsw >>> 16) & 0xFF;
        pad[pad.length - 4] = (lsw >>> 24) & 0xFF;
        pad[pad.length - 5] = msw & 0xFF;
        pad[pad.length - 6] = (msw >>> 8) & 0xFF;
        pad[pad.length - 7] = (msw >>> 16) & 0xFF;
        pad[pad.length - 8] = (msw >>> 24) & 0xFF;
        return pad;
    };

    sha256Engine.prototype.getDigest = function () {
        var rv = new Uint8Array(new ArrayBuffer(32));
        rv[3] = this.current[0] & 0xFF;
        rv[2] = (this.current[0] >>> 8) & 0xFF;
        rv[1] = (this.current[0] >>> 16) & 0xFF;
        rv[0] = (this.current[0] >>> 24) & 0xFF;
        rv[7] = this.current[1] & 0xFF;
        rv[6] = (this.current[1] >>> 8) & 0xFF;
        rv[5] = (this.current[1] >>> 16) & 0xFF;
        rv[4] = (this.current[1] >>> 24) & 0xFF;
        rv[11] = this.current[2] & 0xFF;
        rv[10] = (this.current[2] >>> 8) & 0xFF;
        rv[9] = (this.current[2] >>> 16) & 0xFF;
        rv[8] = (this.current[2] >>> 24) & 0xFF;
        rv[15] = this.current[3] & 0xFF;
        rv[14] = (this.current[3] >>> 8) & 0xFF;
        rv[13] = (this.current[3] >>> 16) & 0xFF;
        rv[12] = (this.current[3] >>> 24) & 0xFF;
        rv[19] = this.current[4] & 0xFF;
        rv[18] = (this.current[4] >>> 8) & 0xFF;
        rv[17] = (this.current[4] >>> 16) & 0xFF;
        rv[16] = (this.current[4] >>> 24) & 0xFF;
        rv[23] = this.current[5] & 0xFF;
        rv[22] = (this.current[5] >>> 8) & 0xFF;
        rv[21] = (this.current[5] >>> 16) & 0xFF;
        rv[20] = (this.current[5] >>> 24) & 0xFF;
        rv[27] = this.current[6] & 0xFF;
        rv[26] = (this.current[6] >>> 8) & 0xFF;
        rv[25] = (this.current[6] >>> 16) & 0xFF;
        rv[24] = (this.current[6] >>> 24) & 0xFF;
        rv[31] = this.current[7] & 0xFF;
        rv[30] = (this.current[7] >>> 8) & 0xFF;
        rv[29] = (this.current[7] >>> 16) & 0xFF;
        rv[28] = (this.current[7] >>> 24) & 0xFF;
        return rv.buffer;
    };

    sha256Engine.prototype.reset = function () {
        this.currentLen = 0;
        this.current = new Uint32Array(new ArrayBuffer(32));
        this.current[0] = 0x6A09E667;
        this.current[1] = 0xBB67AE85;
        this.current[2] = 0x3C6EF372;
        this.current[3] = 0xA54FF53A;
        this.current[4] = 0x510E527F;
        this.current[5] = 0x9B05688C;
        this.current[6] = 0x1F83D9AB;
        this.current[7] = 0x5BE0CD19;
    };

    sha256Engine.prototype.blockLen = 64;
    sha256Engine.prototype.digestLen = 32;

    /* Input utility functions */

    var fromASCII = function (s) {
        var buffer = new ArrayBuffer(s.length);
        var b = new Uint8Array(buffer);
        var i;
        for (i = 0; i < s.length; i++) {
            b[i] = s.charCodeAt(i);
        }
        return b;
    };

    var fromInteger = function (v) {
        var buffer = new ArrayBuffer(1);
        var b = new Uint8Array(buffer);
        b[0] = v;
        return b;
    };

    var convertToUint8Array = function (input) {
        if (input.constructor === Uint8Array) {
            return input;
        } else if (input.constructor === ArrayBuffer) {
            return new Uint8Array(input);
        } else if (input.constructor === String) {
            return fromASCII(input);
        } else if (input.constructor === Number) {
            if (input > 0xFF) {
                throw "For more than one byte, use an array buffer";
            }
            return fromInteger(input);
        } else {
            throw "Unsupported type";
        }
    }

    /* Digest implementation */
    var dg = function (Constructor) {
        var update = function (input) {
            var len = input.length;
            var offset = 0;
            while (len > 0) {
                var copyLen = this.blockLen - this.inLen;
                if (copyLen > len) {
                    copyLen = len;
                }
                var tmpInput = input.subarray(offset, offset + copyLen);
                this.inbuf.set(tmpInput, this.inLen);
                offset += copyLen;
                len -= copyLen;
                this.inLen += copyLen;
                if (this.inLen === this.blockLen) {
                    this.processBlock(this.inbuf);
                    this.inLen = 0;
                }
            }
        };

        var finalize = function () {
            var padding = this.doPadding();
            this.update(padding);
            var result = this.getDigest();
            this.reset();
            return result;
        };

        var engine = (function () {
            if (!Constructor) {
                throw "Unsupported algorithm: " + Constructor.toString();
            }
            Constructor.prototype.update = update;
            Constructor.prototype.finalize = finalize;
            var engine = new Constructor();
            engine.inbuf = new Uint8Array(new ArrayBuffer(engine.blockLen));
            engine.inLen = 0;
            engine.reset();
            return engine;
        }());

        return {
            update: function (input) {
                engine.update(convertToUint8Array(input));
            },

            finalize: function () {
                return engine.finalize();
            },

            digest: function (input) {
                this.update(input);
                return engine.finalize();
            },

            reset: function () {
                engine.reset();
            },

            digestLength: function() {
                return engine.digestLen;
            }
        };
    };

    /* HMAC implementation */
    var hmac = function (digest) {
        var initialized = false;
        var key, ipad, opad;
        var init = function () {
            var i, kbuf;
            if (initialized) {
                return;
            }
            if (key === undefined) {
                throw "MAC key is not defined";
            }
            if (key.byteLength > 64) { /* B = 64 */
                kbuf = new Uint8Array(digest.digest(key));
            } else {
                kbuf = new Uint8Array(key);
            }
            ipad = new Uint8Array(new ArrayBuffer(64));
            for (i = 0; i < kbuf.length; i++) {
                ipad[i] = 0x36 ^ kbuf[i];
            }
            for (i = kbuf.length; i < 64; i++) {
                ipad[i] = 0x36;
            }
            opad = new Uint8Array(new ArrayBuffer(64));
            for (i = 0; i < kbuf.length; i++) {
                opad[i] = 0x5c ^ kbuf[i];
            }
            for (i = kbuf.length; i < 64; i++) {
                opad[i] = 0x5c;
            }
            initialized = true;
            digest.update(ipad.buffer);
        };

        var resetMac = function () {
            key = undefined;
            ipad = undefined;
            opad = undefined;
            digest.reset();
        };

        var finalizeMac = function () {
            var result = digest.finalize();
            digest.reset();
            digest.update(opad.buffer);
            digest.update(result);
            result = digest.finalize();
            resetMac();
            return result;
        };

        var setKeyMac = function (k) {
            key = k;
        };

        return {
            setKey: function (key) {
                setKeyMac(convertToUint8Array(key));
            },

            update: function (input) {
                init();
                digest.update(input);
            },

            finalize: function () {
                return finalizeMac();
            },

            mac: function (input) {
                this.update(input);
                return this.finalize();
            },

            reset: function () {
                resetMac();
            }
        };
    };

    /* PBKDF1 Implementation */
    var pbkdf1 = function(digest, salt, iterationCount) {

        var derive = function (password, len) {
            var key;
            var tmpBuf;
            if (len > digest.digestLength()) {
                throw "Key length larger than digest length";
            }
            digest.reset();
            digest.update(password);
            digest.update(salt);
            tmpBuf = digest.finalize();
            for (var i = 1; i < iterationCount; i++) {
                tmpBuf = digest.digest(tmpBuf);
            }
            return tmpBuf.slice(0, len);
        }

        return {
            deriveKey: function(password, len) {
                return derive(convertToUint8Array(password), len);
            }
        };
    }

    return {
        SHA1: function () {
            return dg(sha1Engine);
        },

        MD5: function () {
            return dg(md5Engine);
        },

        SHA256: function () {
            return dg(sha256Engine);
        },

        HMAC_SHA1: function () {
            return hmac(dg(sha1Engine));
        },

        HMAC_MD5: function () {
            return hmac(dg(md5Engine));
        },

        HMAC_SHA256: function () {
            return hmac(dg(sha256Engine));
        },

        PBKDF1_SHA1: function(salt, iterationCount) {
            return pbkdf1(dg(sha1Engine), salt, iterationCount);
        },

        PBKDF1_MD5: function(salt, iterationCount) {
            return pbkdf1(dg(md5Engine), salt, iterationCount);
        }
    };
}());
