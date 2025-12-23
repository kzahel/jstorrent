package com.jstorrent.quickjs

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class QuickJsInstrumentedTest {

    private lateinit var ctx: QuickJsContext

    @Before
    fun setUp() {
        ctx = QuickJsContext.create()
    }

    @After
    fun tearDown() {
        ctx.close()
    }

    @Test
    fun evaluateInteger() {
        val result = ctx.evaluate("1 + 2")
        assertEquals(3, result)
    }

    @Test
    fun evaluateDouble() {
        val result = ctx.evaluate("3.14 * 2")
        assertTrue(result is Double)
        assertEquals(6.28, result as Double, 0.001)
    }

    @Test
    fun evaluateString() {
        val result = ctx.evaluate("'hello' + ' world'")
        assertEquals("hello world", result)
    }

    @Test
    fun evaluateBoolean() {
        assertEquals(true, ctx.evaluate("true"))
        assertEquals(false, ctx.evaluate("false"))
    }

    @Test
    fun evaluateNull() {
        assertNull(ctx.evaluate("null"))
    }

    @Test
    fun evaluateUndefined() {
        assertNull(ctx.evaluate("undefined"))
    }

    @Test
    fun evaluateFunction() {
        ctx.evaluate("function add(a, b) { return a + b; }")
        val result = ctx.evaluate("add(5, 7)")
        assertEquals(12, result)
    }

    @Test
    fun globalFunctionCallback() {
        var capturedArgs: Array<String>? = null

        ctx.setGlobalFunction("myCallback") { args ->
            capturedArgs = args
            "result from kotlin"
        }

        val result = ctx.evaluate("myCallback('arg1', 'arg2')")

        assertEquals("result from kotlin", result)
        assertEquals(listOf("arg1", "arg2"), capturedArgs?.toList())
    }

    @Test
    fun multipleContexts() {
        val ctx2 = QuickJsContext.create()
        try {
            ctx.evaluate("var x = 1")
            ctx2.evaluate("var x = 2")

            assertEquals(1, ctx.evaluate("x"))
            assertEquals(2, ctx2.evaluate("x"))
        } finally {
            ctx2.close()
        }
    }
}
