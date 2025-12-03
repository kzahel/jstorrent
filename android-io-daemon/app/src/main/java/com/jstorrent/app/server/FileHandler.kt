package com.jstorrent.app.server

import android.util.Base64
import android.util.Log
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest

private const val TAG = "FileHandler"
private const val MAX_BODY_SIZE = 64 * 1024 * 1024 // 64MB

fun Route.fileRoutes(downloadRoot: File) {

    get("/read/{root}") {
        val pathBase64 = call.request.header("X-Path-Base64")
            ?: return@get call.respond(HttpStatusCode.BadRequest, "Missing X-Path-Base64 header")

        val relativePath = try {
            String(Base64.decode(pathBase64, Base64.DEFAULT))
        } catch (e: Exception) {
            return@get call.respond(HttpStatusCode.BadRequest, "Invalid base64 in X-Path-Base64")
        }

        val offset = call.request.header("X-Offset")?.toLongOrNull() ?: 0L
        val length = call.request.header("X-Length")?.toLongOrNull()
            ?: return@get call.respond(HttpStatusCode.BadRequest, "Missing X-Length header")

        // Validate path (prevent directory traversal)
        if (relativePath.contains("..")) {
            return@get call.respond(HttpStatusCode.BadRequest, "Invalid path")
        }

        val file = File(downloadRoot, relativePath.trimStart('/'))
        if (!file.exists()) {
            return@get call.respond(HttpStatusCode.NotFound, "File not found")
        }

        try {
            RandomAccessFile(file, "r").use { raf ->
                raf.seek(offset)
                val buffer = ByteArray(length.toInt())
                val bytesRead = raf.read(buffer)
                if (bytesRead < length) {
                    return@get call.respond(HttpStatusCode.InternalServerError, "Could not read requested bytes")
                }
                call.respondBytes(buffer, ContentType.Application.OctetStream)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error reading file: ${e.message}")
            call.respond(HttpStatusCode.InternalServerError, e.message ?: "Read error")
        }
    }

    post("/write/{root}") {
        val pathBase64 = call.request.header("X-Path-Base64")
            ?: return@post call.respond(HttpStatusCode.BadRequest, "Missing X-Path-Base64 header")

        val relativePath = try {
            String(Base64.decode(pathBase64, Base64.DEFAULT))
        } catch (e: Exception) {
            return@post call.respond(HttpStatusCode.BadRequest, "Invalid base64 in X-Path-Base64")
        }

        val offset = call.request.header("X-Offset")?.toLongOrNull() ?: 0L
        val expectedSha1 = call.request.header("X-Expected-SHA1")

        // Validate path
        if (relativePath.contains("..")) {
            return@post call.respond(HttpStatusCode.BadRequest, "Invalid path")
        }

        val file = File(downloadRoot, relativePath.trimStart('/'))

        // Auto-create parent directories
        file.parentFile?.mkdirs()

        val body = call.receive<ByteArray>()

        if (body.size > MAX_BODY_SIZE) {
            return@post call.respond(HttpStatusCode.PayloadTooLarge, "Body too large")
        }

        try {
            RandomAccessFile(file, "rw").use { raf ->
                raf.seek(offset)
                raf.write(body)
            }

            // Optional hash verification
            if (expectedSha1 != null) {
                val digest = MessageDigest.getInstance("SHA-1")
                val actualHash = digest.digest(body).joinToString("") { "%02x".format(it) }
                if (actualHash != expectedSha1.lowercase()) {
                    return@post call.respond(
                        HttpStatusCode.Conflict,
                        "Hash mismatch: expected $expectedSha1, got $actualHash"
                    )
                }
            }

            call.respond(HttpStatusCode.OK)
        } catch (e: Exception) {
            Log.e(TAG, "Error writing file: ${e.message}")
            call.respond(HttpStatusCode.InternalServerError, e.message ?: "Write error")
        }
    }
}
