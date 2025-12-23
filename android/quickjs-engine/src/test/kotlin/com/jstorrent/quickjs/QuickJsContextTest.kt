package com.jstorrent.quickjs

import org.junit.Test
import kotlin.test.assertEquals

/**
 * Unit tests that can run on JVM.
 * Note: These won't actually execute QuickJS (native code).
 * Use androidTest for real integration tests.
 */
class QuickJsContextTest {

    @Test
    fun `placeholder test`() {
        // Real tests need to be in androidTest since they require native code
        assertEquals(1 + 1, 2)
    }
}
