package org.rstorrent.bootstrap

import java.util.Locale

/** The website page that opens shared magnets (Tactical 347). */
internal const val SHARE_PAGE_URL = "https://jstorrent.com/share/"

private const val MAGNET_PREFIX = "magnet:?"

/**
 * Builds a share link whose fragment is the magnet's own query string, so the
 * page rebuilds the magnet as `magnet:?` plus the fragment. The fragment is
 * never sent to the server. Port of the web client's `share-link.ts`.
 *
 * @throws IllegalArgumentException when [magnet] is not a magnet link.
 */
internal fun shareLinkFromMagnet(magnet: String): String {
    require(magnet.take(MAGNET_PREFIX.length).lowercase(Locale.ROOT) == MAGNET_PREFIX) {
        "Not a magnet link"
    }
    return SHARE_PAGE_URL + "#" + fragmentSafe(magnet.substring(MAGNET_PREFIX.length))
}

// RFC 3986 fragment characters, plus `%` when it starts a valid escape.
private fun fragmentSafe(value: String): String {
    val out = StringBuilder(value.length)
    var index = 0
    while (index < value.length) {
        val codePoint = value.codePointAt(index)
        val width = Character.charCount(codePoint)
        when {
            codePoint == '%'.code -> {
                val escape =
                    index + 2 < value.length &&
                        value[index + 1].isAsciiHexDigit() &&
                        value[index + 2].isAsciiHexDigit()
                out.append(if (escape) "%" else "%25")
            }
            codePoint < 0x80 && codePoint.toChar().isFragmentChar() -> out.appendCodePoint(codePoint)
            else -> {
                // encodeURIComponent rejects a lone surrogate the same way.
                require(width == 2 || !Character.isSurrogate(value[index])) {
                    "Magnet link contains an unpaired surrogate"
                }
                for (byte in String(Character.toChars(codePoint)).toByteArray(Charsets.UTF_8)) {
                    out.append('%')
                    out.append(HEX[(byte.toInt() shr 4) and 0xF])
                    out.append(HEX[byte.toInt() and 0xF])
                }
            }
        }
        index += width
    }
    return out.toString()
}

private const val HEX = "0123456789ABCDEF"

private fun Char.isAsciiHexDigit(): Boolean = this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'

private fun Char.isFragmentChar(): Boolean =
    this in 'A'..'Z' || this in 'a'..'z' || this in '0'..'9' || this in "-._~!$&'()*+,;=:@/?"
