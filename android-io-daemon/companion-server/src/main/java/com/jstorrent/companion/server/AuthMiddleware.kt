package com.jstorrent.companion.server

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
 *
 * Accepts both extension pairing token and standalone token.
 */
suspend fun PipelineContext<Unit, ApplicationCall>.requireAuth(
    tokenStore: TokenStoreProvider,
    block: suspend PipelineContext<Unit, ApplicationCall>.() -> Unit
) {
    val providedToken = call.request.header("X-JST-Auth")
        ?: call.request.header("Authorization")?.removePrefix("Bearer ")

    if (providedToken == null || !tokenStore.isTokenValid(providedToken)) {
        call.respond(HttpStatusCode.Unauthorized, "Invalid token")
        return
    }

    block()
}
