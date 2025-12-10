package com.jstorrent.app.server

import android.util.Log
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*

private const val TAG = "OriginCheck"

/**
 * Validates that requests come from a Chrome extension.
 * Chrome sets Origin header on POST requests (not GET).
 * This blocks local Android apps from hitting the daemon at 127.0.0.1.
 */
suspend fun ApplicationCall.requireExtensionOrigin(): Boolean {
    val origin = request.header(HttpHeaders.Origin)

    Log.d(TAG, "Request to ${request.path()}: Origin=$origin")

    if (origin == null || !origin.startsWith("chrome-extension://")) {
        Log.w(TAG, "Rejected: origin=$origin (expected chrome-extension://)")
        respond(HttpStatusCode.Forbidden, "Invalid origin")
        return false
    }

    return true
}

/**
 * Extracts and validates required extension headers.
 * Returns null if headers are missing (after sending error response).
 */
suspend fun ApplicationCall.getExtensionHeaders(): ExtensionHeaders? {
    val extensionId = request.header("X-JST-ExtensionId")
    val installId = request.header("X-JST-InstallId")

    if (extensionId.isNullOrBlank() || installId.isNullOrBlank()) {
        respond(HttpStatusCode.BadRequest, "Missing X-JST-ExtensionId or X-JST-InstallId headers")
        return null
    }

    return ExtensionHeaders(extensionId, installId)
}

data class ExtensionHeaders(
    val extensionId: String,
    val installId: String
)
