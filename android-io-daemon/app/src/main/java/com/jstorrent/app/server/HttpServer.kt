package com.jstorrent.app.server

import android.util.Log
import com.jstorrent.app.auth.TokenStore
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
import java.io.File
import java.security.MessageDigest
import java.time.Duration

private const val TAG = "HttpServer"

class HttpServer(
    private val tokenStore: TokenStore,
    private val downloadRoot: File
) {
    private var server: NettyApplicationEngine? = null
    private var actualPort: Int = 0

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
                val session = SocketSession(this, tokenStore)
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

                fileRoutes(downloadRoot)
            }
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
