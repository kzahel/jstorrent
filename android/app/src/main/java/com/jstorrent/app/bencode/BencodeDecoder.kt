package com.jstorrent.app.bencode

import java.nio.charset.Charset

/**
 * Bencode decoder for parsing .torrent files and info dictionaries.
 *
 * Bencode format:
 * - Integers: i<number>e (e.g., i42e)
 * - Byte strings: <length>:<bytes> (e.g., 4:spam)
 * - Lists: l<items>e (e.g., l4:spami42ee)
 * - Dictionaries: d<key-value>e (e.g., d3:bar4:spam3:fooi42ee)
 *
 * Keys in dictionaries are always byte strings (interpreted as UTF-8 for comparison).
 */
class BencodeDecoder(private val data: ByteArray) {
    private var position = 0

    /**
     * Decode the entire input as a single bencoded value.
     */
    fun decode(): BencodeValue {
        val result = decodeValue()
        if (position != data.size) {
            throw BencodeException("Unexpected data after end of value at position $position")
        }
        return result
    }

    /**
     * Decode the next bencoded value at the current position.
     */
    private fun decodeValue(): BencodeValue {
        if (position >= data.size) {
            throw BencodeException("Unexpected end of data")
        }

        return when (val b = data[position].toInt().toChar()) {
            'i' -> decodeInteger()
            'l' -> decodeList()
            'd' -> decodeDictionary()
            in '0'..'9' -> decodeByteString()
            else -> throw BencodeException("Invalid bencode type marker '$b' at position $position")
        }
    }

    /**
     * Decode an integer: i<number>e
     */
    private fun decodeInteger(): BencodeValue.BInt {
        position++ // skip 'i'

        val start = position
        while (position < data.size && data[position].toInt().toChar() != 'e') {
            position++
        }

        if (position >= data.size) {
            throw BencodeException("Unterminated integer starting at position $start")
        }

        val numStr = String(data, start, position - start, Charsets.US_ASCII)
        position++ // skip 'e'

        // Validate: no leading zeros (except for 0 itself), no negative zero
        if (numStr.length > 1 && numStr[0] == '0') {
            throw BencodeException("Invalid integer with leading zero: $numStr")
        }
        if (numStr == "-0") {
            throw BencodeException("Invalid negative zero")
        }

        val value = numStr.toLongOrNull()
            ?: throw BencodeException("Invalid integer: $numStr")

        return BencodeValue.BInt(value)
    }

    /**
     * Decode a byte string: <length>:<bytes>
     */
    private fun decodeByteString(): BencodeValue.BBytes {
        val start = position
        while (position < data.size && data[position].toInt().toChar() != ':') {
            position++
        }

        if (position >= data.size) {
            throw BencodeException("Unterminated string length starting at position $start")
        }

        val lengthStr = String(data, start, position - start, Charsets.US_ASCII)
        val length = lengthStr.toIntOrNull()
            ?: throw BencodeException("Invalid string length: $lengthStr")

        position++ // skip ':'

        if (position + length > data.size) {
            throw BencodeException("String length $length exceeds remaining data")
        }

        val bytes = data.copyOfRange(position, position + length)
        position += length

        return BencodeValue.BBytes(bytes)
    }

    /**
     * Decode a list: l<items>e
     */
    private fun decodeList(): BencodeValue.BList {
        position++ // skip 'l'

        val items = mutableListOf<BencodeValue>()
        while (position < data.size && data[position].toInt().toChar() != 'e') {
            items.add(decodeValue())
        }

        if (position >= data.size) {
            throw BencodeException("Unterminated list")
        }

        position++ // skip 'e'
        return BencodeValue.BList(items)
    }

    /**
     * Decode a dictionary: d<key-value>e
     */
    private fun decodeDictionary(): BencodeValue.BDict {
        position++ // skip 'd'

        val entries = mutableMapOf<String, BencodeValue>()
        while (position < data.size && data[position].toInt().toChar() != 'e') {
            // Keys must be byte strings
            val keyValue = decodeValue()
            if (keyValue !is BencodeValue.BBytes) {
                throw BencodeException("Dictionary key must be a byte string")
            }
            val key = keyValue.asString()
            val value = decodeValue()
            entries[key] = value
        }

        if (position >= data.size) {
            throw BencodeException("Unterminated dictionary")
        }

        position++ // skip 'e'
        return BencodeValue.BDict(entries)
    }

    companion object {
        /**
         * Decode a bencoded byte array.
         */
        fun decode(data: ByteArray): BencodeValue {
            return BencodeDecoder(data).decode()
        }

        /**
         * Decode a base64-encoded bencoded value.
         */
        fun decodeBase64(base64: String): BencodeValue {
            val data = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
            return decode(data)
        }
    }
}

/**
 * Represents a decoded bencode value.
 */
sealed class BencodeValue {
    /**
     * Bencode integer.
     */
    data class BInt(val value: Long) : BencodeValue() {
        fun toInt(): Int = value.toInt()
    }

    /**
     * Bencode byte string.
     * Can be interpreted as UTF-8 text or raw bytes.
     */
    data class BBytes(val bytes: ByteArray) : BencodeValue() {
        /**
         * Interpret as UTF-8 string.
         */
        fun asString(charset: Charset = Charsets.UTF_8): String = String(bytes, charset)

        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is BBytes) return false
            return bytes.contentEquals(other.bytes)
        }

        override fun hashCode(): Int = bytes.contentHashCode()

        override fun toString(): String = "BBytes(${bytes.size} bytes)"
    }

    /**
     * Bencode list.
     */
    data class BList(val items: List<BencodeValue>) : BencodeValue() {
        operator fun get(index: Int): BencodeValue = items[index]
        val size: Int get() = items.size
    }

    /**
     * Bencode dictionary.
     */
    data class BDict(val entries: Map<String, BencodeValue>) : BencodeValue() {
        operator fun get(key: String): BencodeValue? = entries[key]

        fun getString(key: String): String? = (entries[key] as? BBytes)?.asString()
        fun getInt(key: String): Int? = (entries[key] as? BInt)?.toInt()
        fun getLong(key: String): Long? = (entries[key] as? BInt)?.value
        fun getList(key: String): BList? = entries[key] as? BList
        fun getDict(key: String): BDict? = entries[key] as? BDict
        fun getBytes(key: String): ByteArray? = (entries[key] as? BBytes)?.bytes

        val keys: Set<String> get() = entries.keys
    }
}

/**
 * Exception thrown when bencode parsing fails.
 */
class BencodeException(message: String) : Exception(message)
