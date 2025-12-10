package com.jstorrent.app.server

import android.content.Context
import android.net.Uri
import android.util.Base64
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import com.jstorrent.app.storage.RootStore
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest

private const val TAG = "FileHandler"
private const val MAX_BODY_SIZE = 64 * 1024 * 1024 // 64MB

fun Route.fileRoutes(rootStore: RootStore, context: Context) {

    get("/read/{root_key}") {
        val rootKey = call.parameters["root_key"]
            ?: return@get call.respond(HttpStatusCode.BadRequest, "Missing root_key")

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

        // Resolve root key to SAF URI
        val rootUri = rootStore.resolveKey(rootKey)
            ?: return@get call.respond(HttpStatusCode.Forbidden, "Invalid root key")

        try {
            val file = resolveFile(context, rootUri, relativePath)
                ?: return@get call.respond(HttpStatusCode.NotFound, "File not found")

            // Use ParcelFileDescriptor for random access reads
            context.contentResolver.openFileDescriptor(file.uri, "r")?.use { pfd ->
                val channel = FileInputStream(pfd.fileDescriptor).channel
                channel.position(offset)

                val buffer = ByteBuffer.allocate(length.toInt())
                var totalRead = 0
                while (buffer.hasRemaining()) {
                    val read = channel.read(buffer)
                    if (read == -1) break
                    totalRead += read
                }

                if (totalRead < length) {
                    return@get call.respond(
                        HttpStatusCode.InternalServerError,
                        "Could not read requested bytes (got $totalRead, wanted $length)"
                    )
                }

                buffer.flip()
                val bytes = ByteArray(buffer.remaining())
                buffer.get(bytes)
                call.respondBytes(bytes, ContentType.Application.OctetStream)
            } ?: return@get call.respond(HttpStatusCode.InternalServerError, "Cannot open file")
        } catch (e: Exception) {
            Log.e(TAG, "Error reading file: ${e.message}", e)
            call.respond(HttpStatusCode.InternalServerError, e.message ?: "Read error")
        }
    }

    post("/write/{root_key}") {
        val rootKey = call.parameters["root_key"]
            ?: return@post call.respond(HttpStatusCode.BadRequest, "Missing root_key")

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

        // Resolve root key to SAF URI
        val rootUri = rootStore.resolveKey(rootKey)
            ?: return@post call.respond(HttpStatusCode.Forbidden, "Invalid root key")

        val body = call.receive<ByteArray>()

        if (body.size > MAX_BODY_SIZE) {
            return@post call.respond(HttpStatusCode.PayloadTooLarge, "Body too large")
        }

        try {
            // Get or create file (creates parent directories as needed)
            val file = getOrCreateFile(context, rootUri, relativePath)
                ?: return@post call.respond(
                    HttpStatusCode.InternalServerError,
                    "Cannot create file"
                )

            // Use ParcelFileDescriptor for true random access writes
            // This is O(write_size), not O(file_size) like the stream approach
            context.contentResolver.openFileDescriptor(file.uri, "rw")?.use { pfd ->
                val channel = FileOutputStream(pfd.fileDescriptor).channel
                channel.position(offset)
                channel.write(ByteBuffer.wrap(body))
            } ?: return@post call.respond(
                HttpStatusCode.InternalServerError,
                "Cannot open file for writing"
            )

            // Optional hash verification (verifies what we wrote)
            if (expectedSha1 != null) {
                val digest = MessageDigest.getInstance("SHA-1")
                val actualHash = digest.digest(body).joinToString("") { "%02x".format(it) }
                if (!actualHash.equals(expectedSha1, ignoreCase = true)) {
                    return@post call.respond(
                        HttpStatusCode.Conflict,
                        "Hash mismatch: expected $expectedSha1, got $actualHash"
                    )
                }
            }

            call.respond(HttpStatusCode.OK)
        } catch (e: Exception) {
            Log.e(TAG, "Error writing file: ${e.message}", e)
            when {
                e.message?.contains("ENOSPC") == true ||
                        e.message?.contains("No space") == true -> {
                    call.respond(HttpStatusCode.InsufficientStorage, "Disk full")
                }

                else -> {
                    call.respond(HttpStatusCode.InternalServerError, e.message ?: "Write error")
                }
            }
        }
    }
}

/**
 * Resolve a relative path under a SAF tree URI to a DocumentFile.
 * Returns null if file doesn't exist.
 */
private fun resolveFile(context: Context, rootUri: Uri, relativePath: String): DocumentFile? {
    var current = DocumentFile.fromTreeUri(context, rootUri) ?: return null

    val segments = relativePath.trimStart('/').split('/')
    for (segment in segments) {
        current = current.findFile(segment) ?: return null
    }

    return if (current.isFile) current else null
}

/**
 * Get or create a file at the given path under a SAF tree.
 * Creates parent directories as needed.
 */
private fun getOrCreateFile(context: Context, rootUri: Uri, relativePath: String): DocumentFile? {
    var current = DocumentFile.fromTreeUri(context, rootUri) ?: return null

    val segments = relativePath.trimStart('/').split('/')
    val fileName = segments.lastOrNull() ?: return null
    val dirSegments = segments.dropLast(1)

    // Create/navigate directories
    for (segment in dirSegments) {
        val existing = current.findFile(segment)
        current = if (existing != null && existing.isDirectory) {
            existing
        } else {
            current.createDirectory(segment) ?: return null
        }
    }

    // Get or create file
    val existingFile = current.findFile(fileName)
    return if (existingFile != null && existingFile.isFile) {
        existingFile
    } else {
        // Guess MIME type from extension
        val mimeType = when {
            fileName.endsWith(".mp4") -> "video/mp4"
            fileName.endsWith(".mkv") -> "video/x-matroska"
            fileName.endsWith(".avi") -> "video/x-msvideo"
            fileName.endsWith(".mp3") -> "audio/mpeg"
            fileName.endsWith(".flac") -> "audio/flac"
            fileName.endsWith(".zip") -> "application/zip"
            fileName.endsWith(".rar") -> "application/x-rar-compressed"
            fileName.endsWith(".torrent") -> "application/x-bittorrent"
            else -> "application/octet-stream"
        }
        current.createFile(mimeType, fileName)
    }
}
