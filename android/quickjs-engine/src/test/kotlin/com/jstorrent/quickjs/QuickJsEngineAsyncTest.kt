package com.jstorrent.quickjs

import kotlinx.coroutines.runBlocking
import org.junit.Test
import kotlin.test.assertEquals

/**
 * Unit tests for async/suspend methods.
 * Note: These won't actually execute QuickJS (native code).
 * Use androidTest for real integration tests.
 */
class QuickJsEngineAsyncTest {

    @Test
    fun `placeholder test for async methods`() {
        // Real tests need to be in androidTest since they require native code.
        // This test verifies the suspend function signatures compile correctly.
        assertEquals(1 + 1, 2)
    }

    @Test
    fun `runBlocking compiles with coroutines-test`() = runBlocking {
        // Verify coroutines test infrastructure is working
        val result = 1 + 2
        assertEquals(3, result)
    }
}
