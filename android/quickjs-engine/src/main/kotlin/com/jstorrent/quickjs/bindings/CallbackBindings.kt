package com.jstorrent.quickjs.bindings

import com.jstorrent.quickjs.QuickJsContext

/**
 * Listener interface for engine state updates.
 */
interface EngineStateListener {
    /**
     * Called when the JS engine pushes a state update.
     *
     * @param stateJson JSON string containing the current engine state
     */
    fun onStateUpdate(stateJson: String)
}

/**
 * Listener interface for engine errors.
 */
interface EngineErrorListener {
    /**
     * Called when the JS engine reports an error.
     *
     * @param errorJson JSON string containing error details
     */
    fun onError(errorJson: String)
}

/**
 * Callback bindings for JS → Native communication.
 *
 * Implements:
 * - __jstorrent_on_state_update(state: string): void
 * - __jstorrent_on_error(json: string): void
 *
 * These functions are called BY the JS engine to push state/errors to Kotlin.
 */
class CallbackBindings {
    var stateListener: EngineStateListener? = null
    var errorListener: EngineErrorListener? = null

    /**
     * Register callback bindings on the given context.
     */
    fun register(ctx: QuickJsContext) {
        // __jstorrent_on_state_update(state: string): void
        // Called by JS engine to push state updates to native layer
        ctx.setGlobalFunction("__jstorrent_on_state_update") { args ->
            val stateJson = args.getOrNull(0)
            stateJson?.let { stateListener?.onStateUpdate(it) }
            null
        }

        // __jstorrent_on_error(json: string): void
        // Called by JS engine to report errors to native layer
        ctx.setGlobalFunction("__jstorrent_on_error") { args ->
            val errorJson = args.getOrNull(0)
            errorJson?.let { errorListener?.onError(it) }
            null
        }
    }
}
