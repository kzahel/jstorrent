package com.jstorrent.companion.server

import android.util.Log
import com.jstorrent.io.file.FileManager
import com.jstorrent.io.hash.Hasher
import com.jstorrent.io.protocol.Protocol
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.Inet4Address
import java.net.NetworkInterface
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList

private const val TAG = "CompanionHttpServer"

@Serializable
private data class RootsResponse(
    val roots: List<DownloadRoot>
)

@Serializable
private data class StatusRequest(
    val token: String? = null
)

@Serializable
private data class StatusResponse(
    val port: Int,
    val paired: Boolean,
    val extensionId: String? = null,
    val installId: String? = null,
    val version: String? = null,
    val tokenValid: Boolean? = null
)

@Serializable
private data class PairRequest(
    val token: String
)

@Serializable
private data class PairResponse(
    val status: String // "approved", "pending"
)

@Serializable
private data class NetworkInterfaceInfo(
    val name: String,
    val address: String,
    val prefixLength: Int
)

@Serializable
private data class StatsResponse(
    val tcp_sockets: Int,
    val pending_connects: Int,
    val pending_tcp: Int,
    val udp_sockets: Int,
    val tcp_servers: Int,
    val ws_connections: Int,
    val bytes_sent: Long,
    val bytes_received: Long,
    val uptime_secs: Long
)

private val json = Json {
    encodeDefaults = true
    ignoreUnknownKeys = true
}

/**
 * HTTP/WebSocket server for the companion mode.
 *
 * Provides:
 * - HTTP endpoints for status, pairing, roots, file I/O
 * - WebSocket /io endpoint for socket operations
 * - WebSocket /control endpoint for control plane broadcasts
 */
class CompanionHttpServer(
    private val deps: CompanionServerDeps,
    private val fileManager: FileManager
) {
    private var server: NettyApplicationEngine? = null
    private var actualPort: Int = 0

    // Connected WebSocket sessions for control broadcasts
    private val controlSessions = CopyOnWriteArrayList<ControlWebSocketHandler>()

    // Is a pairing dialog currently showing?
    @Volatile
    private var pairingDialogShowing = false

    val port: Int get() = if (actualPort > 0) actualPort else 7800
    val isRunning: Boolean get() = server != null && actualPort > 0

    fun start(preferredPort: Int = 7800) {
        if (server != null) {
            Log.w(TAG, "Server already running on port $actualPort")
            return
        }

        // Reset stats when server starts
        DaemonStats.reset()

        // Try preferred port, then fallback ports
        val portsToTry = generatePortSequence(preferredPort).take(10).toList()

        for (port in portsToTry) {
            try {
                server = embeddedServer(Netty, port = port) {
                    install(WebSockets) {
                        pingPeriod = Duration.ofSeconds(30)
                        timeout = Duration.ofSeconds(60)
                        maxFrameSize = Long.MAX_VALUE
                        masking = false
                    }
                    configureCors()
                    configureRouting()
                }.start(wait = false)

                actualPort = port
                Log.i(TAG, "Server started on port $actualPort")
                return
            } catch (e: Exception) {
                Log.w(TAG, "Port $port unavailable: ${e.message}")
            }
        }

        throw IllegalStateException("Could not bind to any port")
    }

    fun stop() {
        server?.stop(1000, 2000)
        server = null
        actualPort = 0
        Log.i(TAG, "Server stopped")
    }

    /**
     * Configure CORS at Application level to catch all requests including OPTIONS preflight.
     */
    private fun Application.configureCors() {
        intercept(ApplicationCallPipeline.Plugins) {
            val origin = call.request.header(HttpHeaders.Origin)
            // Allow localhost origins (standalone WebView in dev mode) and WebViewAssetLoader (production)
            val allowedOrigin = when {
                origin == null -> null
                origin.startsWith("http://127.0.0.1") -> origin
                origin.startsWith("http://localhost") -> origin
                origin.startsWith("https://appassets.androidplatform.net") -> origin
                origin == "null" -> "*" // file:// URLs send "null" as origin
                else -> null
            }

            if (allowedOrigin != null) {
                call.response.header(HttpHeaders.AccessControlAllowOrigin, allowedOrigin)
                call.response.header(HttpHeaders.AccessControlAllowMethods, "GET, POST, PUT, DELETE, OPTIONS")
                call.response.header(HttpHeaders.AccessControlAllowHeaders,
                    "Content-Type, Authorization, X-Requested-With, " +
                    "X-JST-Auth, X-JST-ExtensionId, X-JST-InstallId, " +
                    "X-Path-Base64, X-Offset, X-Length, X-Expected-SHA1")
                call.response.header(HttpHeaders.AccessControlAllowCredentials, "true")
            }

            // Handle preflight OPTIONS requests
            if (call.request.httpMethod == HttpMethod.Options) {
                call.respond(HttpStatusCode.OK)
                return@intercept finish()
            }
        }
    }

    private fun Application.configureRouting() {
        routing {
            // Health check - no auth required
            get("/health") {
                call.respondText("ok", ContentType.Text.Plain)
            }

            // Benchmark endpoint - no auth, returns N MB of zeros
            // Usage: GET /benchmark?mb=10 (default 10MB)
            get("/benchmark") {
                val mb = call.request.queryParameters["mb"]?.toIntOrNull() ?: 10
                val bytes = mb.coerceIn(1, 100) * 1024 * 1024
                val chunk = ByteArray(64 * 1024) // 64KB chunks
                val startTime = System.currentTimeMillis()

                call.respondOutputStream(ContentType.Application.OctetStream) {
                    var remaining = bytes
                    while (remaining > 0) {
                        val toWrite = minOf(remaining, chunk.size)
                        write(chunk, 0, toWrite)
                        remaining -= toWrite
                    }
                }

                val elapsed = System.currentTimeMillis() - startTime
                val speedMBps = bytes.toDouble() / 1024 / 1024 / (elapsed / 1000.0)
                Log.i(TAG, "Benchmark: sent ${bytes / 1024 / 1024}MB in ${elapsed}ms = ${String.format("%.1f", speedMBps)} MB/s")
            }

            // Stats endpoint - returns daemon statistics
            // Only requires auth token, not extension headers (consistent with desktop daemon)
            get("/stats") {
                Log.d(TAG, "GET /stats received")
                requireAuth(deps.tokenStore) {
                    Log.d(TAG, "GET /stats auth passed")
                    val response = StatsResponse(
                        tcp_sockets = DaemonStats.tcpSockets.get(),
                        pending_connects = DaemonStats.pendingConnects.get(),
                        pending_tcp = DaemonStats.pendingTcp.get(),
                        udp_sockets = DaemonStats.udpSockets.get(),
                        tcp_servers = DaemonStats.tcpServers.get(),
                        ws_connections = DaemonStats.wsConnections.get(),
                        bytes_sent = DaemonStats.bytesSent.get(),
                        bytes_received = DaemonStats.bytesReceived.get(),
                        uptime_secs = DaemonStats.uptimeSecs()
                    )
                    call.respondText(
                        json.encodeToString(response),
                        ContentType.Application.Json
                    )
                }
            }

            // Network interfaces - returns available network interfaces for UPnP subnet matching
            get("/network/interfaces") {
                val interfaces = mutableListOf<NetworkInterfaceInfo>()

                try {
                    val netInterfaces = NetworkInterface.getNetworkInterfaces()
                    while (netInterfaces.hasMoreElements()) {
                        val iface = netInterfaces.nextElement()
                        if (iface.isLoopback || !iface.isUp) continue

                        for (addr in iface.interfaceAddresses) {
                            val inet = addr.address
                            if (inet is Inet4Address) {
                                interfaces.add(NetworkInterfaceInfo(
                                    name = iface.name,
                                    address = inet.hostAddress ?: "",
                                    prefixLength = addr.networkPrefixLength.toInt()
                                ))
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to get network interfaces: ${e.message}")
                }

                call.respondText(
                    json.encodeToString(interfaces),
                    ContentType.Application.Json
                )
            }

            // Status endpoint - POST for Origin header, origin check, no token auth
            post("/status") {
                if (!call.requireExtensionOrigin()) return@post
                val headers = call.getExtensionHeaders() ?: return@post

                // Parse optional request body
                val request = try {
                    val body = call.receiveText()
                    if (body.isNotBlank()) {
                        json.decodeFromString<StatusRequest>(body)
                    } else {
                        StatusRequest()
                    }
                } catch (e: Exception) {
                    StatusRequest()
                }

                // Check token validity if provided
                val tokenValid = request.token?.let { deps.tokenStore.isTokenValid(it) }

                val response = StatusResponse(
                    port = actualPort,
                    paired = deps.tokenStore.hasToken(),
                    extensionId = deps.tokenStore.extensionId,
                    installId = deps.tokenStore.installId,
                    version = deps.versionName,
                    tokenValid = tokenValid
                )
                call.respondText(
                    json.encodeToString(response),
                    ContentType.Application.Json
                )
            }

            // Pairing endpoint - origin check, no token auth
            post("/pair") {
                if (!call.requireExtensionOrigin()) return@post
                val headers = call.getExtensionHeaders() ?: return@post

                val request = try {
                    json.decodeFromString<PairRequest>(call.receiveText())
                } catch (e: Exception) {
                    call.respond(HttpStatusCode.BadRequest, "Invalid request body")
                    return@post
                }

                // Same extensionId AND installId = silent re-pair (token refresh)
                if (deps.tokenStore.isPairedWith(headers.extensionId, headers.installId)) {
                    deps.tokenStore.pair(request.token, headers.installId, headers.extensionId)
                    Log.i(TAG, "Silent re-pair: same extensionId and installId")
                    call.respondText(
                        json.encodeToString(PairResponse("approved")),
                        ContentType.Application.Json
                    )
                    return@post
                }

                // Dialog already showing? Return 409
                if (pairingDialogShowing) {
                    Log.w(TAG, "Pairing dialog already showing, rejecting")
                    call.respond(HttpStatusCode.Conflict, "Pairing dialog already showing")
                    return@post
                }

                // Show dialog (async) and return 202
                val isReplace = deps.tokenStore.hasToken()

                try {
                    pairingDialogShowing = true
                    deps.showPairingDialog(
                        token = request.token,
                        installId = headers.installId,
                        extensionId = headers.extensionId,
                        isReplace = isReplace
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to show pairing dialog: ${e.message}")
                    pairingDialogShowing = false
                    call.respond(HttpStatusCode.InternalServerError, "Failed to show pairing dialog")
                    return@post
                }

                call.respondText(
                    json.encodeToString(PairResponse("pending")),
                    ContentType.Application.Json,
                    HttpStatusCode.Accepted
                )
            }

            // WebSocket endpoint for I/O operations (sockets)
            webSocket("/io") {
                Log.i(TAG, "WebSocket /io connected")
                val handler = IoWebSocketHandler(this, deps)
                handler.run()
                Log.i(TAG, "WebSocket /io disconnected")
            }

            // WebSocket endpoint for control plane (roots, events)
            webSocket("/control") {
                Log.i(TAG, "WebSocket /control connected")
                val handler = ControlWebSocketHandler(
                    this,
                    deps,
                    onSessionRegistered = { session -> registerControlSession(session) },
                    onSessionUnregistered = { session -> unregisterControlSession(session) }
                )
                handler.run()
                Log.i(TAG, "WebSocket /control disconnected")
            }

            // Protected endpoints
            post("/hash/sha1") {
                call.getExtensionHeaders() ?: return@post
                requireAuth(deps.tokenStore) {
                    val bytes = call.receive<ByteArray>()
                    val hash = Hasher.sha1(bytes)
                    call.respondBytes(hash, ContentType.Application.OctetStream)
                }
            }

            // Roots endpoint - returns available download roots
            get("/roots") {
                call.getExtensionHeaders() ?: return@get
                requireAuth(deps.tokenStore) {
                    val roots = deps.rootStore.refreshAvailability()
                    val response = RootsResponse(roots = roots)
                    call.respondText(
                        json.encodeToString(response),
                        ContentType.Application.Json
                    )
                }
            }

            // Delete root endpoint - removes a download root
            delete("/roots/{key}") {
                call.getExtensionHeaders() ?: return@delete
                requireAuth(deps.tokenStore) {
                    val key = call.parameters["key"]
                    if (key.isNullOrBlank()) {
                        call.respond(HttpStatusCode.BadRequest, "Missing key")
                        return@requireAuth
                    }

                    // Get root before removal (for SAF permission cleanup)
                    val root = deps.rootStore.getRoot(key)
                    val removed = deps.rootStore.removeRoot(key)

                    if (removed) {
                        // Release SAF permission
                        root?.let { r ->
                            deps.releaseSafPermission(r.uri)
                        }

                        // Broadcast change to connected clients
                        val updatedRoots = deps.rootStore.refreshAvailability()
                        broadcastRootsChanged(updatedRoots)

                        call.respondText(
                            json.encodeToString(mapOf("removed" to key)),
                            ContentType.Application.Json
                        )
                    } else {
                        call.respond(HttpStatusCode.NotFound, "Root not found")
                    }
                }
            }

            // File routes with auth
            route("/") {
                intercept(ApplicationCallPipeline.Call) {
                    val path = call.request.path()
                    if (path.startsWith("/read/") || path.startsWith("/write/")) {
                        // Validate extension headers (or allow standalone mode)
                        val headers = call.getExtensionHeaders()
                        if (headers == null) {
                            finish()
                            return@intercept
                        }

                        // Validate token (accepts both extension token and standalone token)
                        val providedToken = call.request.header("X-JST-Auth")
                            ?: call.request.header("Authorization")?.removePrefix("Bearer ")

                        if (providedToken == null || !deps.tokenStore.isTokenValid(providedToken)) {
                            call.respond(HttpStatusCode.Unauthorized, "Invalid token")
                            finish()
                            return@intercept
                        }
                    }
                }

                fileRoutes(deps.rootStore, fileManager)
            }
        }
    }

    // =========================================================================
    // Control Plane
    // =========================================================================

    private fun registerControlSession(session: ControlWebSocketHandler) {
        controlSessions.add(session)
        Log.d(TAG, "Control session registered, total: ${controlSessions.size}")
    }

    private fun unregisterControlSession(session: ControlWebSocketHandler) {
        controlSessions.remove(session)
        Log.d(TAG, "Control session unregistered, total: ${controlSessions.size}")
    }

    /**
     * Check if any authenticated control session is connected.
     */
    fun hasActiveControlConnection(): Boolean = controlSessions.isNotEmpty()

    /**
     * Close all connected WebSocket sessions.
     * Called when user unpairs to disconnect the extension.
     */
    suspend fun closeAllSessions() {
        Log.i(TAG, "Closing all ${controlSessions.size} WebSocket sessions")
        val sessionsToClose = controlSessions.toList()
        for (session in sessionsToClose) {
            try {
                session.webSocketSession.close(CloseReason(CloseReason.Codes.GOING_AWAY, "Unpaired"))
            } catch (e: Exception) {
                Log.w(TAG, "Failed to close session: ${e.message}")
            }
        }
        controlSessions.clear()
    }

    /**
     * Broadcast ROOTS_CHANGED to all authenticated sessions.
     */
    fun broadcastRootsChanged(roots: List<DownloadRoot>) {
        val jsonPayload = json.encodeToString(roots).toByteArray()
        val frame = Protocol.createMessage(Protocol.OP_CTRL_ROOTS_CHANGED, 0, jsonPayload)

        controlSessions.forEach { session ->
            session.sendControl(frame)
        }
    }

    /**
     * Broadcast generic event to all authenticated sessions.
     */
    fun broadcastEvent(event: String, payload: JsonElement?) {
        val eventObj = buildJsonObject {
            put("event", event)
            if (payload != null) {
                put("payload", payload)
            }
        }
        val jsonPayload = eventObj.toString().toByteArray()
        val frame = Protocol.createMessage(Protocol.OP_CTRL_EVENT, 0, jsonPayload)

        controlSessions.forEach { session ->
            session.sendControl(frame)
        }
    }

    /**
     * Mark pairing dialog as closed.
     * Called from app after pairing dialog result.
     */
    fun onPairingDialogClosed() {
        pairingDialogShowing = false
    }

    companion object {
        /**
         * Port selection: 7800, 7805, 7814, 7827, ...
         * Formula: 7800 + 4*n + n²
         */
        fun generatePortSequence(base: Int): Sequence<Int> = sequence {
            var n = 0
            while (true) {
                yield(base + 4 * n + n * n)
                n++
            }
        }
    }
}
