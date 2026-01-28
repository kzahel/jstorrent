package com.jstorrent.quickjs

import android.util.Log
import java.io.Closeable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine

private const val TAG = "QuickJsEngine"

/**
 * High-level QuickJS engine wrapper.
 *
 * Owns a dedicated JS thread and QuickJS context, ensuring all JS execution
 * happens on the correct thread. Native I/O callbacks can safely post work
 * to this engine's thread.
 *
 * Usage:
 * ```
 * val engine = QuickJsEngine()
 * engine.evaluate("console.log('Hello')")
 * engine.close()
 * ```
 */
class QuickJsEngine : Closeable {
    val jsThread = JsThread()
    lateinit var context: QuickJsContext
        private set

    private val contextReady = CountDownLatch(1)

    // Promise await support
    private val nextPromiseCallbackId = AtomicInteger(1)
    private val pendingPromiseCallbacks = ConcurrentHashMap<Int, CancellableContinuation<String?>>()
    @Volatile
    private var closed = false

    init {
        jsThread.start()
        jsThread.waitUntilReady()

        // Create context on the JS thread
        jsThread.post {
            context = QuickJsContext.create()
            contextReady.countDown()
        }
        contextReady.await()
    }

    /**
     * Evaluate JavaScript code on the JS thread.
     *
     * Blocks until evaluation completes and returns the result.
     *
     * @param script The JavaScript code to evaluate
     * @param filename Optional filename for error messages
     * @return The result (Boolean, Int, Double, String, ByteArray, or null)
     */
    fun evaluate(script: String, filename: String = "script.js"): Any? {
        val result = AtomicReference<Any?>()
        val error = AtomicReference<Throwable?>()
        val latch = CountDownLatch(1)

        jsThread.post {
            try {
                result.set(context.evaluate(script, filename))
            } catch (e: Throwable) {
                error.set(e)
            } finally {
                latch.countDown()
            }
        }

        latch.await()
        error.get()?.let { throw it }
        return result.get()
    }

    /**
     * Evaluate JavaScript and cast result to expected type.
     */
    inline fun <reified T> evaluateTyped(script: String, filename: String = "script.js"): T {
        return evaluate(script, filename) as T
    }

    /**
     * Register a global function that calls back to Kotlin.
     * The callback will be invoked on the JS thread.
     *
     * @param name The function name in JavaScript
     * @param callback The Kotlin callback to invoke
     */
    fun setGlobalFunction(name: String, callback: (Array<String>) -> String?) {
        val latch = CountDownLatch(1)
        jsThread.post {
            context.setGlobalFunction(name, callback)
            latch.countDown()
        }
        latch.await()
    }

    /**
     * Register a global function that receives binary data.
     * The callback will be invoked on the JS thread.
     */
    fun setGlobalFunctionWithBinary(
        name: String,
        binaryArgIndex: Int,
        callback: (args: Array<String>, binary: ByteArray?) -> String?
    ) {
        val latch = CountDownLatch(1)
        jsThread.post {
            context.setGlobalFunctionWithBinary(name, binaryArgIndex, callback)
            latch.countDown()
        }
        latch.await()
    }

    /**
     * Register a global function that receives and returns binary data.
     * The callback will be invoked on the JS thread.
     */
    fun setGlobalFunctionReturnsBinary(
        name: String,
        binaryArgIndex: Int = -1,
        callback: (args: Array<String>, binary: ByteArray?) -> ByteArray?
    ) {
        val latch = CountDownLatch(1)
        jsThread.post {
            context.setGlobalFunctionReturnsBinary(name, binaryArgIndex, callback)
            latch.countDown()
        }
        latch.await()
    }

    /**
     * Call a global JavaScript function.
     * Blocks until the call completes and returns the result.
     *
     * Note: This does NOT wait for async Promise jobs to complete. Async work
     * will continue processing via callback delivery (onTcpData, onTcpClose, etc.).
     * Each callback runs executeAllPendingJobs() to process resulting microtasks.
     *
     * This avoids a deadlock where executeAllPendingJobs() blocks waiting for
     * Promise jobs that are waiting for callbacks that are queued in the Handler.
     */
    fun callGlobalFunction(funcName: String, vararg args: String?): Any? {
        val result = AtomicReference<Any?>()
        val error = AtomicReference<Throwable?>()
        val latch = CountDownLatch(1)

        jsThread.post {
            try {
                result.set(context.callGlobalFunction(funcName, *args))
                // DON'T call executeAllPendingJobs() here - it can deadlock!
                // Jobs will process when their callbacks are delivered via Handler.
                // See: https://github.com/anthropics/claude-code/issues/XXX
            } catch (e: Throwable) {
                error.set(e)
            } finally {
                latch.countDown()
            }
        }

        latch.await()
        error.get()?.let { throw it }
        return result.get()
    }

    /**
     * Call a global JavaScript function with binary data.
     *
     * Note: This does NOT wait for async Promise jobs to complete.
     * See callGlobalFunction() for details.
     */
    fun callGlobalFunctionWithBinary(
        funcName: String,
        binaryArg: ByteArray,
        binaryArgIndex: Int,
        vararg args: String?
    ): Any? {
        val result = AtomicReference<Any?>()
        val error = AtomicReference<Throwable?>()
        val latch = CountDownLatch(1)

        jsThread.post {
            try {
                result.set(context.callGlobalFunctionWithBinary(funcName, binaryArg, binaryArgIndex, *args))
                // DON'T call executeAllPendingJobs() here - it can deadlock!
            } catch (e: Throwable) {
                error.set(e)
            } finally {
                latch.countDown()
            }
        }

        latch.await()
        error.get()?.let { throw it }
        return result.get()
    }

    /**
     * Execute all pending jobs (promises, etc).
     */
    fun executeAllPendingJobs() {
        val latch = CountDownLatch(1)
        jsThread.post {
            context.executeAllPendingJobs()
            latch.countDown()
        }
        latch.await()
    }

    /**
     * Schedule a timeout (setTimeout equivalent).
     * The callback runs on the JS thread.
     */
    fun setTimeout(delayMs: Long, callback: () -> Unit): Int {
        return jsThread.setTimeout(delayMs, callback)
    }

    /**
     * Cancel a scheduled timeout.
     */
    fun clearTimeout(timerId: Int) {
        jsThread.clearTimeout(timerId)
    }

    /**
     * Schedule an interval (setInterval equivalent).
     * The callback runs on the JS thread.
     */
    fun setInterval(intervalMs: Long, callback: () -> Unit): Int {
        return jsThread.setInterval(intervalMs, callback)
    }

    /**
     * Cancel a scheduled interval.
     */
    fun clearInterval(intervalId: Int) {
        jsThread.clearInterval(intervalId)
    }

    /**
     * Post work to execute on the JS thread.
     */
    fun post(block: () -> Unit) {
        jsThread.post(block)
    }

    /**
     * Post work and wait for completion.
     */
    fun postAndWait(block: () -> Unit) {
        val latch = CountDownLatch(1)
        jsThread.post {
            block()
            latch.countDown()
        }
        latch.await()
    }

    /**
     * Close the engine and release resources.
     */
    override fun close() {
        closed = true

        // Cancel all pending promise callbacks
        val pendingCount = pendingPromiseCallbacks.size
        if (pendingCount > 0) {
            Log.i(TAG, "Cancelling $pendingCount pending promise callbacks")
        }
        pendingPromiseCallbacks.forEach { (id, cont) ->
            try {
                cont.resumeWithException(QuickJsException("Engine closed while awaiting promise"))
            } catch (e: IllegalStateException) {
                // Already resumed, ignore
            }
        }
        pendingPromiseCallbacks.clear()

        // Clear all timers first to prevent callbacks from firing after context is closed
        jsThread.clearAllTimers()
        jsThread.post {
            context.close()
        }
        jsThread.quitSafely()
        jsThread.join(1000)
    }

    // =========================================================================
    // Suspend (async) variants - safe to call from Main thread
    // =========================================================================

    /**
     * Evaluate JavaScript code on the JS thread (suspend version).
     *
     * Suspends until evaluation completes. Safe to call from any thread including Main.
     */
    suspend fun evaluateAsync(script: String, filename: String = "script.js"): Any? {
        return suspendCancellableCoroutine { cont ->
            jsThread.post {
                try {
                    val result = context.evaluate(script, filename)
                    cont.resume(result)
                } catch (e: Throwable) {
                    cont.resumeWithException(e)
                }
            }
        }
    }

    /**
     * Register a global function (suspend version).
     */
    suspend fun setGlobalFunctionAsync(name: String, callback: (Array<String>) -> String?) {
        return suspendCancellableCoroutine { cont ->
            jsThread.post {
                try {
                    context.setGlobalFunction(name, callback)
                    cont.resume(Unit)
                } catch (e: Throwable) {
                    cont.resumeWithException(e)
                }
            }
        }
    }

    /**
     * Register a global function with binary data (suspend version).
     */
    suspend fun setGlobalFunctionWithBinaryAsync(
        name: String,
        binaryArgIndex: Int,
        callback: (args: Array<String>, binary: ByteArray?) -> String?
    ) {
        return suspendCancellableCoroutine { cont ->
            jsThread.post {
                try {
                    context.setGlobalFunctionWithBinary(name, binaryArgIndex, callback)
                    cont.resume(Unit)
                } catch (e: Throwable) {
                    cont.resumeWithException(e)
                }
            }
        }
    }

    /**
     * Register a global function that returns binary (suspend version).
     */
    suspend fun setGlobalFunctionReturnsBinaryAsync(
        name: String,
        binaryArgIndex: Int = -1,
        callback: (args: Array<String>, binary: ByteArray?) -> ByteArray?
    ) {
        return suspendCancellableCoroutine { cont ->
            jsThread.post {
                try {
                    context.setGlobalFunctionReturnsBinary(name, binaryArgIndex, callback)
                    cont.resume(Unit)
                } catch (e: Throwable) {
                    cont.resumeWithException(e)
                }
            }
        }
    }

    /**
     * Call a global JavaScript function (suspend version).
     *
     * Note: This does NOT wait for async Promise jobs to complete.
     * See callGlobalFunction() for details.
     */
    suspend fun callGlobalFunctionAsync(funcName: String, vararg args: String?): Any? {
        return suspendCancellableCoroutine { cont ->
            jsThread.post {
                try {
                    val result = context.callGlobalFunction(funcName, *args)
                    // DON'T call executeAllPendingJobs() here - it can deadlock!
                    cont.resume(result)
                } catch (e: Throwable) {
                    cont.resumeWithException(e)
                }
            }
        }
    }

    /**
     * Call a global JavaScript function and await its Promise result.
     *
     * Unlike [callGlobalFunctionAsync], this waits for the JS function's async work
     * to complete. The JS function should return a Promise (or be async).
     *
     * @param funcName The name of the global function to call
     * @param args String arguments to pass (will be JSON-escaped)
     * @return The resolved value as a JSON string, or null
     * @throws QuickJsException if the Promise rejects or engine is closed
     */
    suspend fun callGlobalFunctionAwaitPromise(funcName: String, vararg args: String?): String? {
        if (closed) {
            throw QuickJsException("Engine is closed")
        }

        return suspendCancellableCoroutine { cont ->
            val callbackId = nextPromiseCallbackId.getAndIncrement()
            val resolveName = "__promise_resolve_$callbackId"
            val rejectName = "__promise_reject_$callbackId"

            // Track for cleanup on engine close
            pendingPromiseCallbacks[callbackId] = cont

            // Cleanup helper
            fun cleanup() {
                pendingPromiseCallbacks.remove(callbackId)
                // Remove global functions (fire and forget, on JS thread)
                jsThread.post {
                    try {
                        context.evaluate("delete globalThis.$resolveName; delete globalThis.$rejectName")
                    } catch (e: Exception) {
                        // Context may be closed, ignore
                    }
                }
            }

            cont.invokeOnCancellation {
                cleanup()
            }

            jsThread.post {
                try {
                    // Register resolve callback
                    context.setGlobalFunction(resolveName) { resolveArgs ->
                        cleanup()
                        try {
                            cont.resume(resolveArgs.firstOrNull())
                        } catch (e: IllegalStateException) {
                            // Already resumed (e.g., cancelled), ignore
                        }
                        null
                    }

                    // Register reject callback
                    context.setGlobalFunction(rejectName) { rejectArgs ->
                        cleanup()
                        try {
                            cont.resumeWithException(
                                QuickJsException(rejectArgs.firstOrNull() ?: "Promise rejected")
                            )
                        } catch (e: IllegalStateException) {
                            // Already resumed, ignore
                        }
                        null
                    }

                    // Build JS code to call function and handle promise
                    // Args are JSON-escaped to handle special characters (e.g., magnet URIs)
                    val escapedArgs = args.joinToString(", ") { arg ->
                        if (arg == null) "null" else "JSON.parse(${escapeForJs(toJson(arg))})"
                    }

                    val js = """
                        (async () => {
                            try {
                                const result = await $funcName($escapedArgs);
                                $resolveName(result === undefined ? null : JSON.stringify(result));
                            } catch (e) {
                                $rejectName(String(e));
                            }
                        })()
                    """.trimIndent()

                    context.evaluate(js, "promise-await-$callbackId.js")

                    // Pump jobs to allow promise to make progress
                    jsThread.scheduleJobPump(context)
                } catch (e: Throwable) {
                    cleanup()
                    try {
                        cont.resumeWithException(e)
                    } catch (ex: IllegalStateException) {
                        // Already resumed, ignore
                    }
                }
            }
        }
    }

    /**
     * Escape a string for use in JavaScript code.
     */
    private fun escapeForJs(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> sb.append(c)
            }
        }
        sb.append("\"")
        return sb.toString()
    }

    /**
     * Convert a string to JSON (just wraps in quotes with escaping).
     */
    private fun toJson(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                else -> if (c.code < 32) {
                    sb.append("\\u${c.code.toString(16).padStart(4, '0')}")
                } else {
                    sb.append(c)
                }
            }
        }
        sb.append("\"")
        return sb.toString()
    }

    /**
     * Call a global JavaScript function with binary data (suspend version).
     *
     * Note: This does NOT wait for async Promise jobs to complete.
     * See callGlobalFunction() for details.
     */
    suspend fun callGlobalFunctionWithBinaryAsync(
        funcName: String,
        binaryArg: ByteArray,
        binaryArgIndex: Int,
        vararg args: String?
    ): Any? {
        return suspendCancellableCoroutine { cont ->
            jsThread.post {
                try {
                    val result = context.callGlobalFunctionWithBinary(funcName, binaryArg, binaryArgIndex, *args)
                    // DON'T call executeAllPendingJobs() here - it can deadlock!
                    cont.resume(result)
                } catch (e: Throwable) {
                    cont.resumeWithException(e)
                }
            }
        }
    }

    /**
     * Execute all pending jobs (suspend version).
     */
    suspend fun executeAllPendingJobsAsync() {
        return suspendCancellableCoroutine { cont ->
            jsThread.post {
                try {
                    context.executeAllPendingJobs()
                    cont.resume(Unit)
                } catch (e: Throwable) {
                    cont.resumeWithException(e)
                }
            }
        }
    }

    /**
     * Post work and wait for completion (suspend version).
     */
    suspend fun postAndWaitAsync(block: () -> Unit) {
        return suspendCancellableCoroutine { cont ->
            jsThread.post {
                try {
                    block()
                    cont.resume(Unit)
                } catch (e: Throwable) {
                    cont.resumeWithException(e)
                }
            }
        }
    }
}
