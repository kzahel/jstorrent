package com.jstorrent.app.server

import android.content.Context
import android.content.Intent
import android.util.Log
import com.jstorrent.app.PairingApprovalActivity
import com.jstorrent.app.auth.TokenStore
import com.jstorrent.app.storage.DownloadRoot
import com.jstorrent.app.storage.RootStore
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.server.websocket.*
import io.ktor.util.pipeline.*
import io.ktor.websocket.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.Inet4Address
import java.net.NetworkInterface
import java.security.MessageDigest
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList

private const val TAG = "HttpServer"

@Serializable
private data class RootsResponse(
    val roots: List<DownloadRoot>
)

@Serializable
private data class StatusResponse(
    val port: Int,
    val paired: Boolean,
    val extensionId: String? = null,
    val installId: String? = null
)

@Serializable
private data class PairRequest(
    val token: String
)

@Serializable
private data class PairResponse(
    val status: String // "approved", "pending"
)

private val json = Json {
    encodeDefaults = true
    ignoreUnknownKeys = true
}

class HttpServer(
    private val tokenStore: TokenStore,
    private val rootStore: RootStore,
    private val appContext: Context
) {
    private var server: NettyApplicationEngine? = null
    private var actualPort: Int = 0

    // Connected WebSocket sessions for control broadcasts
    private val controlSessions = CopyOnWriteArrayList<SocketSession>()

    // Is a pairing dialog currently showing?
    @Volatile
    private var pairingDialogShowing = false

    val port: Int get() = actualPort
    val isRunning: Boolean get() = server != null

    fun start(preferredPort: Int = 7800) {
        if (server != null) {
            Log.w(TAG, "Server already running on port $actualPort")
            return
        }

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

    private fun Application.configureRouting() {
        routing {
            // Health check - no auth required
            get("/health") {
                call.respondText("ok", ContentType.Text.Plain)
            }

            // Network interfaces - returns available network interfaces for UPnP subnet matching
            get("/network/interfaces") {
                val interfaces = mutableListOf<Map<String, Any>>()

                try {
                    val netInterfaces = NetworkInterface.getNetworkInterfaces()
                    while (netInterfaces.hasMoreElements()) {
                        val iface = netInterfaces.nextElement()
                        if (iface.isLoopback || !iface.isUp) continue

                        for (addr in iface.interfaceAddresses) {
                            val inet = addr.address
                            if (inet is Inet4Address) {
                                interfaces.add(mapOf(
                                    "name" to iface.name,
                                    "address" to inet.hostAddress,
                                    "prefixLength" to addr.networkPrefixLength.toInt()
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

                val response = StatusResponse(
                    port = actualPort,
                    paired = tokenStore.hasToken(),
                    extensionId = tokenStore.extensionId,
                    installId = tokenStore.installId
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
                if (tokenStore.isPairedWith(headers.extensionId, headers.installId)) {
                    tokenStore.pair(request.token, headers.installId, headers.extensionId)
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
                pairingDialogShowing = true
                val isReplace = tokenStore.hasToken()

                showPairingDialog(
                    token = request.token,
                    installId = headers.installId,
                    extensionId = headers.extensionId,
                    isReplace = isReplace
                )

                call.respondText(
                    json.encodeToString(PairResponse("pending")),
                    ContentType.Application.Json,
                    HttpStatusCode.Accepted
                )
            }

            // WebSocket endpoint for I/O operations (sockets, files)
            webSocket("/io") {
                Log.i(TAG, "WebSocket /io connected")
                val session = SocketSession(this, tokenStore, this@HttpServer, SessionType.IO)
                session.run()
                Log.i(TAG, "WebSocket /io disconnected")
            }

            // WebSocket endpoint for control plane (roots, events)
            webSocket("/control") {
                Log.i(TAG, "WebSocket /control connected")
                val session = SocketSession(this, tokenStore, this@HttpServer, SessionType.CONTROL)
                session.run()
                Log.i(TAG, "WebSocket /control disconnected")
            }

            // Protected endpoints
            post("/hash/sha1") {
                call.getExtensionHeaders() ?: return@post
                requireAuth(tokenStore) {
                    val bytes = call.receive<ByteArray>()
                    val digest = MessageDigest.getInstance("SHA-1")
                    val hash = digest.digest(bytes)
                    call.respondBytes(hash, ContentType.Application.OctetStream)
                }
            }

            // Roots endpoint - returns available download roots
            get("/roots") {
                call.getExtensionHeaders() ?: return@get
                requireAuth(tokenStore) {
                    val roots = rootStore.refreshAvailability()
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
                requireAuth(tokenStore) {
                    val key = call.parameters["key"]
                    if (key.isNullOrBlank()) {
                        call.respond(HttpStatusCode.BadRequest, "Missing key")
                        return@requireAuth
                    }

                    // Get root before removal (for SAF permission cleanup)
                    val root = rootStore.getRoot(key)
                    val removed = rootStore.removeRoot(key)

                    if (removed) {
                        // Release SAF permission
                        root?.let { r ->
                            try {
                                val uri = android.net.Uri.parse(r.uri)
                                appContext.contentResolver.releasePersistableUriPermission(
                                    uri,
                                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                            Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                                )
                                Log.i(TAG, "Released SAF permission for ${r.displayName}")
                            } catch (e: Exception) {
                                Log.w(TAG, "Failed to release SAF permission: ${e.message}")
                            }
                        }

                        // Broadcast change to connected clients
                        val updatedRoots = rootStore.refreshAvailability()
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
                        // Validate extension headers
                        val headers = call.getExtensionHeaders()
                        if (headers == null) {
                            finish()
                            return@intercept
                        }

                        // Validate token
                        val storedToken = tokenStore.token
                        if (storedToken == null) {
                            call.respond(HttpStatusCode.ServiceUnavailable, "Not paired")
                            finish()
                            return@intercept
                        }

                        val providedToken = call.request.header("X-JST-Auth")
                            ?: call.request.header("Authorization")?.removePrefix("Bearer ")

                        if (providedToken != storedToken) {
                            call.respond(HttpStatusCode.Unauthorized, "Invalid token")
                            finish()
                            return@intercept
                        }
                    }
                }

                fileRoutes(rootStore, appContext)
            }
        }
    }

    // =========================================================================
    // Control Plane
    // =========================================================================

    /**
     * Register a WebSocket session for control broadcasts.
     */
    fun registerControlSession(session: SocketSession) {
        controlSessions.add(session)
        Log.d(TAG, "Control session registered, total: ${controlSessions.size}")
    }

    /**
     * Unregister a WebSocket session.
     */
    fun unregisterControlSession(session: SocketSession) {
        controlSessions.remove(session)
        Log.d(TAG, "Control session unregistered, total: ${controlSessions.size}")
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
     * Show pairing approval dialog. Runs async - result stored when user acts.
     */
    private fun showPairingDialog(
        token: String,
        installId: String,
        extensionId: String,
        isReplace: Boolean
    ) {
        PairingApprovalActivity.pendingCallback = { approved, approvedToken, approvedInstallId, approvedExtensionId ->
            pairingDialogShowing = false
            if (approved && approvedToken != null && approvedInstallId != null && approvedExtensionId != null) {
                tokenStore.pair(approvedToken, approvedInstallId, approvedExtensionId)
                Log.i(TAG, "Pairing approved and stored")
            } else {
                Log.i(TAG, "Pairing denied or dismissed")
            }
        }

        val intent = Intent(appContext, PairingApprovalActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
            putExtra(PairingApprovalActivity.EXTRA_TOKEN, token)
            putExtra(PairingApprovalActivity.EXTRA_INSTALL_ID, installId)
            putExtra(PairingApprovalActivity.EXTRA_EXTENSION_ID, extensionId)
            putExtra(PairingApprovalActivity.EXTRA_IS_REPLACE, isReplace)
        }
        appContext.startActivity(intent)
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
