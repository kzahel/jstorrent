package org.rstorrent.bootstrap

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.rstorrent.bootstrap.ui.customRateText
import org.rstorrent.bootstrap.ui.parseRateLimit
import org.rstorrent.session.uniffi.TransferRateLimit

class RateLimitLocalizationTest {
    @Test
    fun acceptsCommaAndPeriodButRejectsGroupingAndMixedInput() {
        assertEquals(TransferRateLimit.Limited(1536U), parseRateLimit("1,5"))
        assertEquals(TransferRateLimit.Limited(1536U), parseRateLimit("1.5"))
        listOf("1.024,5", "1,024.5", "1,000,000", "1 024", "1a5", "1,,5", "1..5").forEach {
            assertNull(it, parseRateLimit(it))
        }
    }

    @Test
    fun localizedCustomTextKeepsExactByteGeometry() {
        assertEquals("1,5", customRateText(TransferRateLimit.Limited(1536U), Locale.GERMANY))
        assertEquals("1.5", customRateText(TransferRateLimit.Limited(1536U), Locale.US))
        listOf(1024U, 1025U, 1536U, 1_048_575U, UInt.MAX_VALUE).forEach { bytes ->
            listOf(Locale.GERMANY, Locale.US, Locale.forLanguageTag("ar")).forEach { locale ->
                val limit = TransferRateLimit.Limited(bytes)
                assertEquals(limit, parseRateLimit(customRateText(limit, locale), locale))
            }
        }
    }
}
