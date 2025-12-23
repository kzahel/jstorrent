package com.jstorrent.quickjs

import androidx.annotation.Keep
import java.io.Closeable

/**
 * A QuickJS JavaScript runtime context.
 *
 * Thread-safety: QuickJS is single-threaded. All calls to a context
 * must happen on the same thread that created it.
 */
class QuickJsContext private constructor(
    private var contextPtr: Long
) : Closeable {

    companion object {
        init {
            System.loadLibrary("quickjs-jni")
        }

        /**
         * Create a new QuickJS context.
         */
        fun create(): QuickJsContext {
            val ptr = nativeCreate()
            if (ptr == 0L) {
                throw QuickJsException("Failed to create QuickJS context")
            }
            return QuickJsContext(ptr)
        }

        @JvmStatic
        private external fun nativeCreate(): Long

        @JvmStatic
        private external fun nativeDestroy(ctxPtr: Long)

        @JvmStatic
        private external fun nativeEvaluate(ctxPtr: Long, script: String, filename: String): Any?

        @JvmStatic
        private external fun nativeSetGlobalFunction(ctxPtr: Long, name: String, callback: JsCallback)

        @JvmStatic
        private external fun nativeExecutePendingJob(ctxPtr: Long): Boolean
    }

    /**
     * Evaluate JavaScript code.
     *
     * @param script The JavaScript code to evaluate
     * @param filename Optional filename for error messages
     * @return The result (Boolean, Int, Double, String, or null)
     */
    fun evaluate(script: String, filename: String = "script.js"): Any? {
        checkNotClosed()
        return nativeEvaluate(contextPtr, script, filename)
    }

    /**
     * Evaluate JavaScript and cast result to expected type.
     */
    inline fun <reified T> evaluateTyped(script: String, filename: String = "script.js"): T {
        return evaluate(script, filename) as T
    }

    /**
     * Register a global function that calls back to Kotlin.
     *
     * @param name The function name in JavaScript
     * @param callback The Kotlin callback to invoke
     */
    fun setGlobalFunction(name: String, callback: (Array<String>) -> String?) {
        checkNotClosed()
        nativeSetGlobalFunction(contextPtr, name, JsCallback(callback))
    }

    /**
     * Execute pending jobs (promises, etc).
     *
     * @return true if there are more jobs pending
     */
    fun executePendingJob(): Boolean {
        checkNotClosed()
        return nativeExecutePendingJob(contextPtr)
    }

    /**
     * Execute all pending jobs.
     */
    fun executeAllPendingJobs() {
        while (executePendingJob()) {
            // Keep executing until no more jobs
        }
    }

    /**
     * Check if context is still open.
     */
    fun isClosed(): Boolean = contextPtr == 0L

    private fun checkNotClosed() {
        if (contextPtr == 0L) {
            throw IllegalStateException("QuickJsContext is closed")
        }
    }

    /**
     * Close the context and release native resources.
     */
    override fun close() {
        if (contextPtr != 0L) {
            nativeDestroy(contextPtr)
            contextPtr = 0L
        }
    }

    @Suppress("removal")
    protected fun finalize() {
        close()
    }
}

/**
 * Callback interface for JS -> Kotlin calls.
 * Keep annotation prevents ProGuard from removing it.
 */
@Keep
internal class JsCallback(
    private val callback: (Array<String>) -> String?
) {
    @Keep
    fun invoke(args: Array<String>): String? = callback(args)
}
