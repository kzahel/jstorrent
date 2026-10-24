package org.rstorrent.bootstrap

import org.junit.Assert.assertEquals
import org.junit.Test
import org.rstorrent.bootstrap.ui.formatShareRatio
import org.rstorrent.bootstrap.ui.productFailureDetail

class ProductFormattingTest {
    @Test
    fun visibleErrorsPreserveMessagesWithoutLeakingTechnicalFallbacks() {
        val fallback = "Localized operation failure"
        val messageLess = object : Throwable() {
            override fun toString() = "org.rstorrent.bootstrap.InternalFailure"
        }
        assertEquals(fallback, productFailureDetail(messageLess, fallback))
        assertEquals(fallback, productFailureDetail(Throwable("  \t"), fallback))
        assertEquals("Provider unavailable", productFailureDetail(Throwable("Provider unavailable"), fallback))
        assertEquals("  Meaningful message  ", productFailureDetail(Throwable("  Meaningful message  "), fallback))
    }

    @Test
    fun shareRatioFormattingPreservesValuesBeyondUnsignedLong() {
        assertEquals("0.00", formatShareRatio("0"))
        assertEquals("1.23", formatShareRatio("123"))
        assertEquals(
            "18446744073709551616.15",
            formatShareRatio("1844674407370955161615"),
        )
        assertEquals("—", formatShareRatio("-1"))
        assertEquals("—", formatShareRatio("not-a-number"))
    }
}
