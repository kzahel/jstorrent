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

        @JvmStatic
        private external fun nativeSetGlobalFunctionWithBinary(
            ctxPtr: Long,
            name: String,
            callback: Any,
            binaryArgIndex: Int,
            returnsBinary: Boolean
        )

        @JvmStatic
        private external fun nativeCallGlobalFunction(
            ctxPtr: Long,
            funcName: String,
            args: Array<String?>?,
            binaryArg: ByteArray?,
            binaryArgIndex: Int
        ): Any?
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
     * Register a global function that receives binary data (ArrayBuffer) at a specific argument position.
     *
     * @param name The function name in JavaScript
     * @param binaryArgIndex Which argument is an ArrayBuffer (0-indexed)
     * @param callback Receives string args array and the binary data; returns String
     */
    fun setGlobalFunctionWithBinary(
        name: String,
        binaryArgIndex: Int,
        callback: (args: Array<String>, binary: ByteArray?) -> String?
    ) {
        checkNotClosed()
        nativeSetGlobalFunctionWithBinary(
            contextPtr,
            name,
            JsBinaryCallback(callback),
            binaryArgIndex,
            false
        )
    }

    /**
     * Register a global function that receives binary data and returns binary data.
     *
     * @param name The function name in JavaScript
     * @param binaryArgIndex Which argument is an ArrayBuffer (-1 for none)
     * @param callback Receives string args array and the binary data; returns ByteArray
     */
    fun setGlobalFunctionReturnsBinary(
        name: String,
        binaryArgIndex: Int = -1,
        callback: (args: Array<String>, binary: ByteArray?) -> ByteArray?
    ) {
        checkNotClosed()
        nativeSetGlobalFunctionWithBinary(
            contextPtr,
            name,
            JsBinaryReturnCallback(callback),
            binaryArgIndex,
            true
        )
    }

    /**
     * Call a global JavaScript function from Kotlin.
     *
     * @param funcName The name of the global function to call
     * @param args String arguments to pass
     * @return The result (Boolean, Int, Double, String, ByteArray, or null)
     */
    fun callGlobalFunction(funcName: String, vararg args: String?): Any? {
        checkNotClosed()
        return nativeCallGlobalFunction(
            contextPtr,
            funcName,
            if (args.isEmpty()) null else args.toList().toTypedArray(),
            null,
            -1
        )
    }

    /**
     * Call a global JavaScript function with a binary argument.
     *
     * @param funcName The name of the global function to call
     * @param binaryArg The binary data to pass
     * @param binaryArgIndex Position of the binary argument
     * @param args String arguments (binary position will be null)
     * @return The result (Boolean, Int, Double, String, ByteArray, or null)
     */
    fun callGlobalFunctionWithBinary(
        funcName: String,
        binaryArg: ByteArray,
        binaryArgIndex: Int,
        vararg args: String?
    ): Any? {
        checkNotClosed()
        return nativeCallGlobalFunction(
            contextPtr,
            funcName,
            if (args.isEmpty()) null else args.toList().toTypedArray(),
            binaryArg,
            binaryArgIndex
        )
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

/**
 * Callback for JS -> Kotlin calls with binary data, returning String.
 */
@Keep
internal class JsBinaryCallback(
    private val callback: (Array<String>, ByteArray?) -> String?
) {
    @Keep
    fun invoke(args: Array<String>, binary: ByteArray?): String? = callback(args, binary)
}

/**
 * Callback for JS -> Kotlin calls with binary data, returning ByteArray.
 */
@Keep
internal class JsBinaryReturnCallback(
    private val callback: (Array<String>, ByteArray?) -> ByteArray?
) {
    @Keep
    fun invoke(args: Array<String>, binary: ByteArray?): ByteArray? = callback(args, binary)
}
