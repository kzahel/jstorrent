package com.jstorrent.quickjs.bindings

import android.content.Context
import android.net.Uri
import com.jstorrent.io.file.FileManager
import com.jstorrent.io.socket.TcpSocketManager
import com.jstorrent.io.socket.TcpSocketService
import com.jstorrent.io.socket.UdpSocketManagerImpl
import com.jstorrent.quickjs.JsThread
import com.jstorrent.quickjs.QuickJsContext
import kotlinx.coroutines.CoroutineScope

/**
 * Native bindings facade for QuickJS.
 *
 * Registers all __jstorrent_* functions on a QuickJsContext, enabling
 * the TypeScript engine to perform I/O operations via the native layer.
 *
 * Includes:
 * - Polyfill bindings (TextEncoder, SHA1, timers, etc.)
 * - TCP socket bindings (client and server)
 * - UDP socket bindings
 * - File I/O bindings (stateless, using FileManager)
 * - Storage bindings
 * - State/error callback bindings
 *
 * Usage:
 * ```
 * val fileManager = FileManagerImpl(context)
 * val bindings = NativeBindings(context, jsThread, scope, fileManager) { rootKey ->
 *     // Resolve rootKey to SAF URI (or null for app-private fallback)
 *     rootStore.resolveKey(rootKey)
 * }
 * bindings.registerAll(ctx)
 *
 * // Set listeners for engine events
 * bindings.stateListener = object : EngineStateListener { ... }
 * bindings.errorListener = object : EngineErrorListener { ... }
 * ```
 */
class NativeBindings(
    context: Context,
    private val jsThread: JsThread,
    scope: CoroutineScope,
    fileManager: FileManager,
    rootResolver: (String) -> Uri? = { null },
) {
    // I/O services
    private val tcpService = TcpSocketService(scope)
    private val udpManager = UdpSocketManagerImpl(scope)

    // Individual binding modules
    private val polyfillBindings = PolyfillBindings(jsThread)
    private val tcpBindings = TcpBindings(jsThread, tcpService)
    private val tcpServerBindings = TcpServerBindings(jsThread, tcpService)
    private val udpBindings = UdpBindings(jsThread, udpManager)
    private val fileBindings = FileBindings(context, fileManager, rootResolver, jsThread)
    private val storageBindings = StorageBindings(context)
    private val networkBindings = NetworkBindings()
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

        // Register TCP bindings (client and server)
        tcpBindings.register(ctx)
        tcpServerBindings.register(ctx)

        // Register UDP bindings
        udpBindings.register(ctx)

        // Register file bindings
        fileBindings.register(ctx)

        // Register storage bindings
        storageBindings.register(ctx)

        // Register network bindings
        networkBindings.register(ctx)

        // Register callback bindings
        callbackBindings.register(ctx)

        // Register the timer dispatcher (used by polyfills)
        registerTimerDispatcher(ctx)

        // Register TCP dispatchers (used by TCP bindings)
        registerTcpDispatchers(ctx)

        // Register UDP dispatchers (used by UDP bindings)
        registerUdpDispatchers(ctx)
    }

    /**
     * Shutdown all I/O services.
     */
    fun shutdown() {
        tcpService.shutdown()
        udpManager.shutdown()
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
                    const id = parseInt(callbackId);
                    const callback = globalThis.__jstorrent_timer_callbacks.get(id);
                    if (callback) {
                        // For setTimeout, remove after dispatch
                        if (callback.once) {
                            globalThis.__jstorrent_timer_callbacks.delete(id);
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
                // Storage for TCP callbacks (client and server)
                globalThis.__jstorrent_tcp_callbacks = {
                    onData: null,
                    onClose: null,
                    onError: null,
                    onConnected: null,
                    onListening: null,
                    onAccept: null
                };

                // Wrap the on_* functions to store callbacks (client)
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

                const origOnSecured = globalThis.__jstorrent_tcp_on_secured;
                globalThis.__jstorrent_tcp_on_secured = function(callback) {
                    globalThis.__jstorrent_tcp_callbacks.onSecured = callback;
                    origOnSecured(callback);
                };

                // Wrap the on_* functions to store callbacks (server)
                const origOnListening = globalThis.__jstorrent_tcp_on_listening;
                globalThis.__jstorrent_tcp_on_listening = function(callback) {
                    globalThis.__jstorrent_tcp_callbacks.onListening = callback;
                    origOnListening(callback);
                };

                const origOnAccept = globalThis.__jstorrent_tcp_on_accept;
                globalThis.__jstorrent_tcp_on_accept = function(callback) {
                    globalThis.__jstorrent_tcp_callbacks.onAccept = callback;
                    origOnAccept(callback);
                };

                // Dispatcher functions called by Kotlin (client)
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

                globalThis.__jstorrent_tcp_dispatch_secured = function(socketId, success) {
                    const callback = globalThis.__jstorrent_tcp_callbacks.onSecured;
                    if (callback) {
                        callback(parseInt(socketId), success === 'true');
                    }
                };

                // Dispatcher functions called by Kotlin (server)
                globalThis.__jstorrent_tcp_dispatch_listening = function(serverId, success, port) {
                    const callback = globalThis.__jstorrent_tcp_callbacks.onListening;
                    if (callback) {
                        callback(parseInt(serverId), success === 'true', parseInt(port));
                    }
                };

                globalThis.__jstorrent_tcp_dispatch_accept = function(serverId, socketId, remoteAddr, remotePort) {
                    const callback = globalThis.__jstorrent_tcp_callbacks.onAccept;
                    if (callback) {
                        callback(parseInt(serverId), parseInt(socketId), remoteAddr, parseInt(remotePort));
                    }
                };
            })();
        """.trimIndent(), "tcp-dispatcher.js")
    }

    /**
     * Register UDP dispatcher functions.
     *
     * These JS functions are called when UDP events occur. They look up and invoke
     * the callbacks that were registered with __jstorrent_udp_on_*.
     */
    private fun registerUdpDispatchers(ctx: QuickJsContext) {
        ctx.evaluate("""
            (function() {
                // Storage for UDP callbacks
                globalThis.__jstorrent_udp_callbacks = {
                    onBound: null,
                    onMessage: null
                };

                // Wrap the on_* functions to store callbacks
                const origOnBound = globalThis.__jstorrent_udp_on_bound;
                globalThis.__jstorrent_udp_on_bound = function(callback) {
                    globalThis.__jstorrent_udp_callbacks.onBound = callback;
                    origOnBound(callback);
                };

                const origOnMessage = globalThis.__jstorrent_udp_on_message;
                globalThis.__jstorrent_udp_on_message = function(callback) {
                    globalThis.__jstorrent_udp_callbacks.onMessage = callback;
                    origOnMessage(callback);
                };

                // Dispatcher functions called by Kotlin
                globalThis.__jstorrent_udp_dispatch_bound = function(socketId, success, port) {
                    const callback = globalThis.__jstorrent_udp_callbacks.onBound;
                    if (callback) {
                        callback(parseInt(socketId), success === 'true', parseInt(port));
                    }
                };

                globalThis.__jstorrent_udp_dispatch_message = function(socketId, addr, port, data) {
                    const callback = globalThis.__jstorrent_udp_callbacks.onMessage;
                    if (callback) {
                        callback(parseInt(socketId), addr, parseInt(port), data);
                    }
                };
            })();
        """.trimIndent(), "udp-dispatcher.js")
    }
}
