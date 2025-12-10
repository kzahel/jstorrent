package com.jstorrent.app.server

import android.content.Context
import android.util.Log
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
import java.security.MessageDigest
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList

private const val TAG = "HttpServer"

@Serializable
private data class RootsResponse(
    val roots: List<DownloadRoot>
)

private val json = Json {
    encodeDefaults = true
    ignoreUnknownKeys = true
}

class HttpServer(
    private val tokenStore: TokenStore,
    private val rootStore: RootStore,
    private val context: Context
) {
    private var server: NettyApplicationEngine? = null
    private var actualPort: Int = 0

    // Connected WebSocket sessions for control broadcasts
    private val controlSessions = CopyOnWriteArrayList<SocketSession>()

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

            // Status endpoint - no auth required
            get("/status") {
                call.respondText(
                    """{"port":$actualPort,"paired":${tokenStore.hasToken()}}""",
                    ContentType.Application.Json
                )
            }

            // WebSocket endpoint (auth handled inside protocol)
            webSocket("/io") {
                Log.i(TAG, "WebSocket connected")
                val session = SocketSession(this, tokenStore, this@HttpServer)
                session.run()
                Log.i(TAG, "WebSocket disconnected")
            }

            // Protected endpoints
            post("/hash/sha1") {
                requireAuth(tokenStore) {
                    val bytes = call.receive<ByteArray>()
                    val digest = MessageDigest.getInstance("SHA-1")
                    val hash = digest.digest(bytes)
                    call.respondBytes(hash, ContentType.Application.OctetStream)
                }
            }

            // Roots endpoint - returns available download roots
            get("/roots") {
                requireAuth(tokenStore) {
                    val roots = rootStore.refreshAvailability()
                    val response = RootsResponse(roots = roots)
                    call.respondText(
                        json.encodeToString(response),
                        ContentType.Application.Json
                    )
                }
            }

            // File routes with auth
            route("/") {
                intercept(ApplicationCallPipeline.Call) {
                    val path = call.request.path()
                    if (path.startsWith("/read/") || path.startsWith("/write/")) {
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

                fileRoutes(rootStore, context)
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
        val eventObj = mapOf("event" to event, "payload" to payload)
        val jsonPayload = json.encodeToString(eventObj).toByteArray()
        val frame = Protocol.createMessage(Protocol.OP_CTRL_EVENT, 0, jsonPayload)

        controlSessions.forEach { session ->
            session.sendControl(frame)
        }
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
