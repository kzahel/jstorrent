package com.jstorrent.quickjs

import java.io.Closeable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

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
