package com.jstorrent.quickjs

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.jstorrent.quickjs.bindings.EngineStateListener
import com.jstorrent.quickjs.bindings.NativeBindings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class NativeBindingsTest {

    private lateinit var engine: QuickJsEngine
    private lateinit var bindings: NativeBindings
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Before
    fun setUp() {
        engine = QuickJsEngine()
        bindings = NativeBindings(engine.jsThread, scope)
        engine.postAndWait {
            bindings.registerAll(engine.context)
        }
    }

    @After
    fun tearDown() {
        bindings.shutdown()
        engine.close()
    }

    // ========================================
    // Text Encode/Decode Tests
    // ========================================

    @Test
    fun textEncodeDecodeRoundTrips() {
        val result = engine.evaluate("""
            const encoded = __jstorrent_text_encode("Hello, World!");
            __jstorrent_text_decode(encoded);
        """.trimIndent())

        assertEquals("Hello, World!", result)
    }

    @Test
    fun textEncodeReturnsArrayBuffer() {
        val result = engine.evaluate("""
            const encoded = __jstorrent_text_encode("ABC");
            encoded.constructor.name;
        """.trimIndent())

        assertEquals("ArrayBuffer", result)
    }

    @Test
    fun textEncodeLength() {
        val result = engine.evaluate("""
            const encoded = __jstorrent_text_encode("Hello");
            encoded.byteLength;
        """.trimIndent())

        assertEquals(5, result)
    }

    @Test
    fun textEncodeUnicode() {
        val result = engine.evaluate("""
            const encoded = __jstorrent_text_encode("こんにちは");
            __jstorrent_text_decode(encoded);
        """.trimIndent())

        assertEquals("こんにちは", result)
    }

    // ========================================
    // SHA1 Tests
    // ========================================

    @Test
    fun sha1ReturnsArrayBuffer() {
        val result = engine.evaluate("""
            const data = __jstorrent_text_encode("test");
            const hash = __jstorrent_sha1(data);
            hash.constructor.name;
        """.trimIndent())

        assertEquals("ArrayBuffer", result)
    }

    @Test
    fun sha1Returns20Bytes() {
        val result = engine.evaluate("""
            const data = __jstorrent_text_encode("test");
            const hash = __jstorrent_sha1(data);
            hash.byteLength;
        """.trimIndent())

        assertEquals(20, result)
    }

    @Test
    fun sha1ProducesCorrectHash() {
        // SHA1("test") = a94a8fe5ccb19ba61c4c0873d391e987982fbbd3
        val result = engine.evaluate("""
            const data = __jstorrent_text_encode("test");
            const hash = __jstorrent_sha1(data);
            const view = new Uint8Array(hash);
            Array.from(view).map(b => b.toString(16).padStart(2, '0')).join('');
        """.trimIndent())

        assertEquals("a94a8fe5ccb19ba61c4c0873d391e987982fbbd3", result)
    }

    // ========================================
    // Random Bytes Tests
    // ========================================

    @Test
    fun randomBytesReturnsArrayBuffer() {
        val result = engine.evaluate("""
            const bytes = __jstorrent_random_bytes(16);
            bytes.constructor.name;
        """.trimIndent())

        assertEquals("ArrayBuffer", result)
    }

    @Test
    fun randomBytesReturnsCorrectLength() {
        val result = engine.evaluate("""
            const bytes = __jstorrent_random_bytes(32);
            bytes.byteLength;
        """.trimIndent())

        assertEquals(32, result)
    }

    @Test
    fun randomBytesProducesDifferentValues() {
        val result = engine.evaluate("""
            const bytes1 = __jstorrent_random_bytes(16);
            const bytes2 = __jstorrent_random_bytes(16);
            const view1 = new Uint8Array(bytes1);
            const view2 = new Uint8Array(bytes2);

            // Compare - should be different
            let same = true;
            for (let i = 0; i < 16; i++) {
                if (view1[i] !== view2[i]) {
                    same = false;
                    break;
                }
            }
            same;
        """.trimIndent())

        assertEquals(false, result)
    }

    // ========================================
    // Console Log Tests
    // ========================================

    @Test
    fun consoleLogDoesNotThrow() {
        // Just verify it doesn't throw
        engine.evaluate("""
            __jstorrent_console_log("info", "Test message");
            __jstorrent_console_log("warn", "Warning message");
            __jstorrent_console_log("error", "Error message");
            __jstorrent_console_log("debug", "Debug message");
        """.trimIndent())
    }

    // ========================================
    // Timer Tests
    // ========================================

    @Test
    fun setTimeoutFiresCallback() {
        val latch = CountDownLatch(1)
        var fired = false

        engine.postAndWait {
            engine.context.evaluate("""
                globalThis.timerFired = false;
                __jstorrent_set_timeout(function() {
                    globalThis.timerFired = true;
                }, 50);
            """.trimIndent())
        }

        // Wait for timer to fire
        Thread.sleep(150)

        engine.postAndWait {
            val result = engine.context.evaluate("globalThis.timerFired")
            fired = result == true
            latch.countDown()
        }

        latch.await(1, TimeUnit.SECONDS)
        assertTrue(fired, "Timer should have fired")
    }

    @Test
    fun clearTimeoutCancelsTimer() {
        engine.postAndWait {
            engine.context.evaluate("""
                globalThis.timerFired = false;
                const timerId = __jstorrent_set_timeout(function() {
                    globalThis.timerFired = true;
                }, 100);
                __jstorrent_clear_timeout(timerId);
            """.trimIndent())
        }

        // Wait longer than the timer would have fired
        Thread.sleep(200)

        val result = engine.evaluate("globalThis.timerFired")
        assertEquals(false, result, "Timer should have been cancelled")
    }

    // ========================================
    // Callback Bindings Tests
    // ========================================

    @Test
    fun stateUpdateCallsListener() {
        val latch = CountDownLatch(1)
        var receivedState: String? = null

        bindings.stateListener = object : EngineStateListener {
            override fun onStateUpdate(stateJson: String) {
                receivedState = stateJson
                latch.countDown()
            }
        }

        engine.evaluate("""
            __jstorrent_on_state_update('{"torrents":[],"downloadSpeed":0}');
        """.trimIndent())

        latch.await(1, TimeUnit.SECONDS)
        assertNotNull(receivedState)
        assertTrue(receivedState!!.contains("torrents"))
    }

    // ========================================
    // ArrayBuffer JNI Tests
    // ========================================

    @Test
    fun callGlobalFunctionWithBinaryWorks() {
        // Register a function that echoes binary data
        engine.postAndWait {
            engine.context.setGlobalFunctionReturnsBinary("__test_echo_binary", 0) { _, binary ->
                binary
            }
        }

        val result = engine.evaluate("""
            const input = __jstorrent_text_encode("Hello Binary");
            const output = __test_echo_binary(input);
            __jstorrent_text_decode(output);
        """.trimIndent())

        assertEquals("Hello Binary", result)
    }
}
