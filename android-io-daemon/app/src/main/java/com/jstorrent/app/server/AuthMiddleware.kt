package com.jstorrent.app.server

import com.jstorrent.app.auth.TokenStore
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.util.pipeline.*

/**
 * Authentication check for HTTP endpoints.
 * Token can be provided via:
 * - X-JST-Auth header
 * - Authorization: Bearer <token>
 */
suspend fun PipelineContext<Unit, ApplicationCall>.requireAuth(
    tokenStore: TokenStore,
    block: suspend PipelineContext<Unit, ApplicationCall>.() -> Unit
) {
    val storedToken = tokenStore.token
    if (storedToken == null) {
        call.respond(HttpStatusCode.ServiceUnavailable, "Not paired")
        return
    }

    val providedToken = call.request.header("X-JST-Auth")
        ?: call.request.header("Authorization")?.removePrefix("Bearer ")

    if (providedToken != storedToken) {
        call.respond(HttpStatusCode.Unauthorized, "Invalid token")
        return
    }

    block()
}
