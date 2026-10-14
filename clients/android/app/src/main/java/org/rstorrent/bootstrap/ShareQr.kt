package org.rstorrent.bootstrap

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.WriterException
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/** The light border scanners need around a QR code, in modules. */
internal const val QR_QUIET_ZONE_MODULES = 4

/**
 * The modules of a QR code for [text], one per matrix cell, with a
 * [QR_QUIET_ZONE_MODULES] quiet zone. Medium error correction when the text
 * fits, low otherwise; null when it does not fit at all. Share links are
 * ASCII, so no character set is declared.
 */
internal fun shareQrMatrix(text: String): BitMatrix? {
    val writer = QRCodeWriter()
    for (level in listOf(ErrorCorrectionLevel.M, ErrorCorrectionLevel.L)) {
        val hints =
            mapOf(
                EncodeHintType.ERROR_CORRECTION to level,
                EncodeHintType.MARGIN to QR_QUIET_ZONE_MODULES,
            )
        try {
            return writer.encode(text, BarcodeFormat.QR_CODE, 0, 0, hints)
        } catch (_: WriterException) {
            // Too long at this level; try the next.
        }
    }
    return null
}
