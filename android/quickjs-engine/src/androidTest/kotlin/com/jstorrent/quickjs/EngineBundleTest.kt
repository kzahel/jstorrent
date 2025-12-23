package com.jstorrent.quickjs

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.assertEquals

/**
 * Instrumented tests for loading the JSTorrent engine bundle.
 *
 * These tests verify that the TypeScript engine bundle (engine.bundle.js)
 * loads correctly in QuickJS and exposes the expected API.
 */
@RunWith(AndroidJUnit4::class)
class EngineBundleTest {

    private lateinit var ctx: QuickJsContext
    private lateinit var bundleContent: String

    @Before
    fun setUp() {
        ctx = QuickJsContext.create()

        // Load engine bundle from assets
        val context = InstrumentationRegistry.getInstrumentation().context
        bundleContent = context.assets.open("engine.bundle.js").bufferedReader().use { it.readText() }
    }

    @After
    fun tearDown() {
        ctx.close()
    }

    @Test
    fun bundleLoadsWithoutError() {
        // Evaluate the bundle - should not throw
        ctx.evaluate(bundleContent, "engine.bundle.js")
    }

    @Test
    fun jstorrentGlobalIsObject() {
        ctx.evaluate(bundleContent, "engine.bundle.js")

        val result = ctx.evaluate("typeof jstorrent")
        assertEquals("object", result, "jstorrent should be an object")
    }

    @Test
    fun jstorrentInitIsFunction() {
        ctx.evaluate(bundleContent, "engine.bundle.js")

        val result = ctx.evaluate("typeof jstorrent.init")
        assertEquals("function", result, "jstorrent.init should be a function")
    }

    @Test
    fun jstorrentIsInitializedIsFunction() {
        ctx.evaluate(bundleContent, "engine.bundle.js")

        val result = ctx.evaluate("typeof jstorrent.isInitialized")
        assertEquals("function", result, "jstorrent.isInitialized should be a function")
    }

    @Test
    fun jstorrentShutdownIsFunction() {
        ctx.evaluate(bundleContent, "engine.bundle.js")

        val result = ctx.evaluate("typeof jstorrent.shutdown")
        assertEquals("function", result, "jstorrent.shutdown should be a function")
    }

    @Test
    fun jstorrentGetEngineIsFunction() {
        ctx.evaluate(bundleContent, "engine.bundle.js")

        val result = ctx.evaluate("typeof jstorrent.getEngine")
        assertEquals("function", result, "jstorrent.getEngine should be a function")
    }

    @Test
    fun isInitializedReturnsFalseBeforeInit() {
        ctx.evaluate(bundleContent, "engine.bundle.js")

        val result = ctx.evaluate("jstorrent.isInitialized()")
        assertEquals(false, result, "isInitialized() should return false before init")
    }

    @Test
    fun getEngineReturnsNullBeforeInit() {
        ctx.evaluate(bundleContent, "engine.bundle.js")

        val result = ctx.evaluate("jstorrent.getEngine()")
        assertEquals(null, result, "getEngine() should return null before init")
    }
}
