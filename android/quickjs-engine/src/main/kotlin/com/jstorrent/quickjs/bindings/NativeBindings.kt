package com.jstorrent.quickjs.bindings

import com.jstorrent.io.socket.TcpSocketManager
import com.jstorrent.io.socket.TcpSocketService
import com.jstorrent.quickjs.JsThread
import com.jstorrent.quickjs.QuickJsContext
import kotlinx.coroutines.CoroutineScope

/**
 * Native bindings facade for QuickJS.
 *
 * Registers all __jstorrent_* functions on a QuickJsContext, enabling
 * the TypeScript engine to perform I/O operations via the native layer.
 *
 * Phase 3b includes:
 * - Polyfill bindings (TextEncoder, SHA1, timers, etc.)
 * - TCP socket bindings
 * - State/error callback bindings
 *
 * Usage:
 * ```
 * val bindings = NativeBindings(jsThread, scope)
 * bindings.registerAll(ctx)
 *
 * // Set listeners for engine events
 * bindings.stateListener = object : EngineStateListener { ... }
 * bindings.errorListener = object : EngineErrorListener { ... }
 * ```
 */
class NativeBindings(
    private val jsThread: JsThread,
    scope: CoroutineScope
) {
    // I/O services
    private val tcpService = TcpSocketService(scope)

    // Individual binding modules
    private val polyfillBindings = PolyfillBindings(jsThread)
    private val tcpBindings = TcpBindings(jsThread, tcpService)
    private val callbackBindings = CallbackBindings()

    /**
     * State listener for engine state updates.
     */
    var stateListener: EngineStateListener?
        get() = callbackBindings.stateListener
        set(value) { callbackBindings.stateListener = value }

    /**
     * Error listener for engine errors.
     */
    var errorListener: EngineErrorListener?
        get() = callbackBindings.errorListener
        set(value) { callbackBindings.errorListener = value }

    /**
     * The TCP socket manager used by TCP bindings.
     * Exposed for testing or advanced configuration.
     */
    val tcpManager: TcpSocketManager
        get() = tcpService

    /**
     * Register all native bindings on the given context.
     *
     * This registers all __jstorrent_* global functions.
     * Must be called on the JS thread.
     */
    fun registerAll(ctx: QuickJsContext) {
        // Register polyfills first (no dependencies)
        polyfillBindings.register(ctx)

        // Register TCP bindings
        tcpBindings.register(ctx)

        // Register callback bindings
        callbackBindings.register(ctx)

        // Register the timer dispatcher (used by polyfills)
        registerTimerDispatcher(ctx)

        // Register TCP dispatchers (used by TCP bindings)
        registerTcpDispatchers(ctx)
    }

    /**
     * Shutdown all I/O services.
     */
    fun shutdown() {
        tcpService.shutdown()
    }

    /**
     * Register the timer dispatcher function.
     *
     * This JS function is called when a timer fires. It looks up and invokes
     * the callback that was registered with setTimeout/setInterval.
     */
    private fun registerTimerDispatcher(ctx: QuickJsContext) {
        // Initialize JS-side timer callback storage and dispatcher
        ctx.evaluate("""
            (function() {
                globalThis.__jstorrent_timer_callbacks = new Map();
                globalThis.__jstorrent_timer_next_id = 1;

                globalThis.__jstorrent_timer_dispatch = function(callbackId) {
                    const callback = globalThis.__jstorrent_timer_callbacks.get(callbackId);
                    if (callback) {
                        // For setTimeout, remove after dispatch
                        if (callback.once) {
                            globalThis.__jstorrent_timer_callbacks.delete(callbackId);
                        }
                        callback.fn();
                    }
                };

                // Wrap setTimeout to store callback on JS side
                const origSetTimeout = globalThis.__jstorrent_set_timeout;
                globalThis.__jstorrent_set_timeout = function(callback, ms) {
                    const callbackId = globalThis.__jstorrent_timer_next_id++;
                    globalThis.__jstorrent_timer_callbacks.set(callbackId, { fn: callback, once: true });
                    return origSetTimeout(callbackId, ms);
                };

                // Wrap clearTimeout to clean up callback
                const origClearTimeout = globalThis.__jstorrent_clear_timeout;
                globalThis.__jstorrent_clear_timeout = function(timerId) {
                    // Timer ID and callback ID are the same due to our implementation
                    globalThis.__jstorrent_timer_callbacks.delete(timerId);
                    origClearTimeout(timerId);
                };

                // Wrap setInterval to store callback on JS side
                const origSetInterval = globalThis.__jstorrent_set_interval;
                globalThis.__jstorrent_set_interval = function(callback, ms) {
                    const callbackId = globalThis.__jstorrent_timer_next_id++;
                    globalThis.__jstorrent_timer_callbacks.set(callbackId, { fn: callback, once: false });
                    return origSetInterval(callbackId, ms);
                };

                // Wrap clearInterval to clean up callback
                const origClearInterval = globalThis.__jstorrent_clear_interval;
                globalThis.__jstorrent_clear_interval = function(intervalId) {
                    globalThis.__jstorrent_timer_callbacks.delete(intervalId);
                    origClearInterval(intervalId);
                };
            })();
        """.trimIndent(), "timer-dispatcher.js")
    }

    /**
     * Register TCP dispatcher functions.
     *
     * These JS functions are called when TCP events occur. They look up and invoke
     * the callbacks that were registered with __jstorrent_tcp_on_*.
     */
    private fun registerTcpDispatchers(ctx: QuickJsContext) {
        ctx.evaluate("""
            (function() {
                // Storage for TCP callbacks
                globalThis.__jstorrent_tcp_callbacks = {
                    onData: null,
                    onClose: null,
                    onError: null,
                    onConnected: null
                };

                // Wrap the on_* functions to store callbacks
                const origOnData = globalThis.__jstorrent_tcp_on_data;
                globalThis.__jstorrent_tcp_on_data = function(callback) {
                    globalThis.__jstorrent_tcp_callbacks.onData = callback;
                    origOnData(callback);
                };

                const origOnClose = globalThis.__jstorrent_tcp_on_close;
                globalThis.__jstorrent_tcp_on_close = function(callback) {
                    globalThis.__jstorrent_tcp_callbacks.onClose = callback;
                    origOnClose(callback);
                };

                const origOnError = globalThis.__jstorrent_tcp_on_error;
                globalThis.__jstorrent_tcp_on_error = function(callback) {
                    globalThis.__jstorrent_tcp_callbacks.onError = callback;
                    origOnError(callback);
                };

                const origOnConnected = globalThis.__jstorrent_tcp_on_connected;
                globalThis.__jstorrent_tcp_on_connected = function(callback) {
                    globalThis.__jstorrent_tcp_callbacks.onConnected = callback;
                    origOnConnected(callback);
                };

                // Dispatcher functions called by Kotlin
                globalThis.__jstorrent_tcp_dispatch_connected = function(socketId, success, errorMessage) {
                    const callback = globalThis.__jstorrent_tcp_callbacks.onConnected;
                    if (callback) {
                        callback(parseInt(socketId), success === 'true', errorMessage);
                    }
                };

                globalThis.__jstorrent_tcp_dispatch_data = function(socketId, data) {
                    const callback = globalThis.__jstorrent_tcp_callbacks.onData;
                    if (callback) {
                        callback(parseInt(socketId), data);
                    }
                };

                globalThis.__jstorrent_tcp_dispatch_close = function(socketId, hadError) {
                    const callback = globalThis.__jstorrent_tcp_callbacks.onClose;
                    if (callback) {
                        callback(parseInt(socketId), hadError === 'true');
                    }
                };

                globalThis.__jstorrent_tcp_dispatch_error = function(socketId, message) {
                    const callback = globalThis.__jstorrent_tcp_callbacks.onError;
                    if (callback) {
                        callback(parseInt(socketId), message);
                    }
                };
            })();
        """.trimIndent(), "tcp-dispatcher.js")
    }
}
