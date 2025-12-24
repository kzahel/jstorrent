package com.jstorrent.quickjs

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.jstorrent.io.file.FileManagerImpl
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
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val fileManager = FileManagerImpl(context)
        engine = QuickJsEngine()
        bindings = NativeBindings(context, engine.jsThread, scope, fileManager)
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
        var fired = false
        var attempts = 0

        engine.postAndWait {
            engine.context.evaluate("""
                globalThis.timerFired = false;
                __jstorrent_set_timeout(function() {
                    globalThis.timerFired = true;
                }, 50);
            """.trimIndent())
        }

        // Poll for result with timeout (timer + dispatch may take time)
        while (attempts < 20 && !fired) {
            Thread.sleep(50)
            attempts++

            engine.postAndWait {
                val result = engine.context.evaluate("globalThis.timerFired")
                fired = result == true
            }
        }

        assertTrue(fired, "Timer should have fired (attempts: $attempts)")
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

    // ========================================
    // UDP Binding Tests (Phase 3c)
    // ========================================

    @Test
    fun udpBindFiresCallback() {
        var boundSuccess = false
        var boundPort = 0
        var attempts = 0

        engine.postAndWait {
            engine.context.evaluate("""
                globalThis.udpBoundResult = null;
                __jstorrent_udp_on_bound(function(socketId, success, port) {
                    globalThis.udpBoundResult = { socketId, success, port };
                });
                __jstorrent_udp_bind(100, "", 0);
            """.trimIndent())
        }

        // Poll for result with timeout (async callback may take time)
        while (attempts < 20 && !boundSuccess) {
            Thread.sleep(100)
            attempts++

            engine.postAndWait {
                val result = engine.context.evaluate("globalThis.udpBoundResult")
                if (result != null) {
                    val success = engine.context.evaluate("globalThis.udpBoundResult.success")
                    val port = engine.context.evaluate("globalThis.udpBoundResult.port")
                    boundSuccess = success == true
                    boundPort = (port as? Number)?.toInt() ?: 0
                }
            }
        }

        assertTrue(boundSuccess, "UDP bind should succeed (attempts: $attempts)")
        assertTrue(boundPort > 0, "UDP should bind to a port > 0, got $boundPort")
    }

    @Test
    fun udpCloseDoesNotThrow() {
        // Bind then close - should not throw
        engine.postAndWait {
            engine.context.evaluate("""
                __jstorrent_udp_on_bound(function() {});
                __jstorrent_udp_bind(2, "", 0);
            """.trimIndent())
        }

        Thread.sleep(100)

        engine.evaluate("__jstorrent_udp_close(2)")
        // If we get here without exception, test passes
    }

    // ========================================
    // File I/O Binding Tests (Stateless API)
    // ========================================

    @Test
    fun fileWriteReadRoundTrip() {
        val testData = "Hello, JSTorrent File System!"

        val result = engine.evaluate("""
            // Write data (stateless - creates file automatically)
            const data = __jstorrent_text_encode("$testData");
            const written = __jstorrent_file_write("default", "test_roundtrip.txt", 0, data);

            if (written < 0) {
                throw new Error("Failed to write file: " + written);
            }

            // Read data back (stateless)
            const readData = __jstorrent_file_read("default", "test_roundtrip.txt", 0, ${testData.length});

            // Decode and return
            __jstorrent_text_decode(readData);
        """.trimIndent())

        assertEquals(testData, result)
    }

    @Test
    fun fileExistsWorks() {
        // Create a file using stateless write
        engine.evaluate("""
            const data = __jstorrent_text_encode("test");
            __jstorrent_file_write("default", "exists_test.txt", 0, data);
        """.trimIndent())

        val exists = engine.evaluate("""
            __jstorrent_file_exists("default", "exists_test.txt");
        """.trimIndent())

        assertEquals("true", exists)
    }

    @Test
    fun fileStatReturnsSize() {
        val testContent = "12345678901234567890" // 20 bytes

        engine.evaluate("""
            const data = __jstorrent_text_encode("$testContent");
            __jstorrent_file_write("default", "stat_test.txt", 0, data);
        """.trimIndent())

        val stat = engine.evaluate("""
            const statJson = __jstorrent_file_stat("default", "stat_test.txt");
            JSON.parse(statJson).size;
        """.trimIndent())

        assertEquals(20, stat)
    }

    @Test
    fun fileMkdirWorks() {
        val result = engine.evaluate("""
            __jstorrent_file_mkdir("default", "test_subdir");
        """.trimIndent())

        assertEquals("true", result)

        val exists = engine.evaluate("""
            __jstorrent_file_exists("default", "test_subdir");
        """.trimIndent())

        assertEquals("true", exists)
    }

    @Test
    fun fileDeleteWorks() {
        // Create then delete using stateless API
        engine.evaluate("""
            const data = __jstorrent_text_encode("delete me");
            __jstorrent_file_write("default", "delete_test.txt", 0, data);
        """.trimIndent())

        val deleted = engine.evaluate("""
            __jstorrent_file_delete("default", "delete_test.txt");
        """.trimIndent())

        assertEquals("true", deleted)

        val existsAfter = engine.evaluate("""
            __jstorrent_file_exists("default", "delete_test.txt");
        """.trimIndent())

        assertEquals("false", existsAfter)
    }

    // ========================================
    // Storage Binding Tests (Phase 3c)
    // ========================================

    @Test
    fun storageSetGetWorks() {
        engine.evaluate("""
            __jstorrent_storage_set("test_key_1", "test_value_1");
        """.trimIndent())

        val result = engine.evaluate("""
            __jstorrent_storage_get("test_key_1");
        """.trimIndent())

        assertEquals("test_value_1", result)
    }

    @Test
    fun storageGetReturnsNullForMissing() {
        val result = engine.evaluate("""
            __jstorrent_storage_get("nonexistent_key_xyz");
        """.trimIndent())

        assertEquals(null, result)
    }

    @Test
    fun storageDeleteWorks() {
        engine.evaluate("""
            __jstorrent_storage_set("delete_me_key", "some_value");
            __jstorrent_storage_delete("delete_me_key");
        """.trimIndent())

        val result = engine.evaluate("""
            __jstorrent_storage_get("delete_me_key");
        """.trimIndent())

        assertEquals(null, result)
    }

    @Test
    fun storageKeysWithPrefix() {
        engine.evaluate("""
            __jstorrent_storage_set("prefix_a", "1");
            __jstorrent_storage_set("prefix_b", "2");
            __jstorrent_storage_set("other_c", "3");
        """.trimIndent())

        val result = engine.evaluate("""
            const keys = JSON.parse(__jstorrent_storage_keys("prefix_"));
            keys.filter(k => k.startsWith("prefix_")).length;
        """.trimIndent())

        assertTrue((result as Number).toInt() >= 2, "Should find at least 2 keys with prefix_")
    }
}
