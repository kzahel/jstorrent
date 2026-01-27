package com.jstorrent.quickjs.bindings

import android.util.Log
import com.jstorrent.io.hash.Hasher
import com.jstorrent.quickjs.JsThread
import com.jstorrent.quickjs.QuickJsContext
import java.security.SecureRandom

/**
 * Polyfill bindings for QuickJS.
 *
 * Implements missing Web APIs that QuickJS doesn't provide:
 * - TextEncoder/TextDecoder (via text_encode/text_decode)
 * - crypto.getRandomValues (via random_bytes)
 * - SHA-1 hashing
 * - console.log
 * - setTimeout/setInterval
 */
class PolyfillBindings(
    private val jsThread: JsThread
) {
    private val secureRandom = SecureRandom()

    /**
     * Register all polyfill bindings on the given context.
     */
    fun register(ctx: QuickJsContext) {
        registerTextFunctions(ctx)
        registerHashFunctions(ctx)
        registerRandomFunctions(ctx)
        registerConsoleFunctions(ctx)
        registerTimerFunctions(ctx)
    }

    private fun registerTextFunctions(ctx: QuickJsContext) {
        // __jstorrent_text_encode(str: string): ArrayBuffer
        ctx.setGlobalFunctionReturnsBinary("__jstorrent_text_encode") { args, _ ->
            val str = args.getOrNull(0) ?: ""
            str.toByteArray(Charsets.UTF_8)
        }

        // __jstorrent_text_decode(data: ArrayBuffer): string
        ctx.setGlobalFunctionWithBinary("__jstorrent_text_decode", 0) { _, binary ->
            binary?.let { String(it, Charsets.UTF_8) }
        }
    }

    // Hash instrumentation
    private var hashCallCount = 0L
    private var hashTotalBytes = 0L
    private var hashTotalTimeNs = 0L
    private var hashMaxTimeNs = 0L
    private var hashLastLogTime = 0L

    private fun registerHashFunctions(ctx: QuickJsContext) {
        // __jstorrent_sha1(data: ArrayBuffer): ArrayBuffer
        ctx.setGlobalFunctionReturnsBinary("__jstorrent_sha1", 0) { _, binary ->
            binary?.let { data ->
                val startNs = System.nanoTime()
                val result = Hasher.sha1(data)
                val elapsedNs = System.nanoTime() - startNs

                // Track timing
                hashCallCount++
                hashTotalBytes += data.size
                hashTotalTimeNs += elapsedNs
                if (elapsedNs > hashMaxTimeNs) {
                    hashMaxTimeNs = elapsedNs
                }

                // Log every 5 seconds
                val now = System.currentTimeMillis()
                if (now - hashLastLogTime >= 5000 && hashCallCount > 0) {
                    val avgUs = (hashTotalTimeNs / hashCallCount) / 1000.0
                    val maxUs = hashMaxTimeNs / 1000.0
                    val totalMB = hashTotalBytes / 1024.0 / 1024.0
                    val totalSec = hashTotalTimeNs / 1_000_000_000.0
                    val throughputMBps = if (totalSec > 0) totalMB / totalSec else 0.0
                    Log.i("JSTorrent-Hash",
                        "Kotlin: $hashCallCount hashes, ${"%.1f".format(totalMB)}MB, " +
                        "avg ${"%.0f".format(avgUs)}µs, max ${"%.0f".format(maxUs)}µs, " +
                        "throughput ${"%.0f".format(throughputMBps)}MB/s")
                    hashCallCount = 0
                    hashTotalBytes = 0
                    hashTotalTimeNs = 0
                    hashMaxTimeNs = 0
                    hashLastLogTime = now
                }

                result
            }
        }
    }

    private fun registerRandomFunctions(ctx: QuickJsContext) {
        // __jstorrent_random_bytes(length: number): ArrayBuffer
        ctx.setGlobalFunctionReturnsBinary("__jstorrent_random_bytes") { args, _ ->
            val length = args.getOrNull(0)?.toIntOrNull() ?: 0
            if (length <= 0 || length > 65536) {
                ByteArray(0)
            } else {
                ByteArray(length).also { secureRandom.nextBytes(it) }
            }
        }
    }

    private fun registerConsoleFunctions(ctx: QuickJsContext) {
        // __jstorrent_console_log(level: string, message: string): void
        ctx.setGlobalFunction("__jstorrent_console_log") { args ->
            val level = args.getOrNull(0) ?: "info"
            val message = args.getOrNull(1) ?: ""

            when (level) {
                "error" -> Log.e("JSTorrent-JS", message)
                "warn" -> Log.w("JSTorrent-JS", message)
                "debug" -> Log.d("JSTorrent-JS", message)
                else -> Log.i("JSTorrent-JS", message)
            }
            null
        }
    }

    private fun registerTimerFunctions(ctx: QuickJsContext) {
        // We need to store JS callback references for timers.
        // The approach: JS registers callbacks via __jstorrent_set_timeout,
        // we return a timer ID, and when the timer fires, we call a JS function
        // that was previously registered to dispatch the callback.

        // __jstorrent_set_timeout(callbackId: number, ms: number): number
        // Returns timer ID. The callbackId is managed on the JS side.
        ctx.setGlobalFunction("__jstorrent_set_timeout") { args ->
            val callbackId = args.getOrNull(0)?.toIntOrNull() ?: return@setGlobalFunction null
            val ms = args.getOrNull(1)?.toLongOrNull() ?: 0L

            val timerId = jsThread.setTimeout(ms) {
                // Call the JS dispatcher function with the callback ID
                ctx.callGlobalFunction("__jstorrent_timer_dispatch", callbackId.toString())
                // Schedule job processing for the NEXT message to avoid deadlock
                jsThread.scheduleJobPump(ctx)
            }
            timerId.toString()
        }

        // __jstorrent_clear_timeout(timerId: number): void
        ctx.setGlobalFunction("__jstorrent_clear_timeout") { args ->
            val timerId = args.getOrNull(0)?.toIntOrNull()
            timerId?.let { jsThread.clearTimeout(it) }
            null
        }

        // __jstorrent_set_interval(callbackId: number, ms: number): number
        ctx.setGlobalFunction("__jstorrent_set_interval") { args ->
            val callbackId = args.getOrNull(0)?.toIntOrNull() ?: return@setGlobalFunction null
            val ms = args.getOrNull(1)?.toLongOrNull() ?: 0L

            val intervalId = jsThread.setInterval(ms) {
                ctx.callGlobalFunction("__jstorrent_timer_dispatch", callbackId.toString())
                // Schedule job processing for the NEXT message to avoid deadlock
                jsThread.scheduleJobPump(ctx)
            }
            intervalId.toString()
        }

        // __jstorrent_clear_interval(intervalId: number): void
        ctx.setGlobalFunction("__jstorrent_clear_interval") { args ->
            val intervalId = args.getOrNull(0)?.toIntOrNull()
            intervalId?.let { jsThread.clearInterval(it) }
            null
        }
    }
}
