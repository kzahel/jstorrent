package com.jstorrent.io.hash

import java.security.MessageDigest

/**
 * Centralized hashing utilities for io-core.
 * Supports SHA-1 and SHA-256 with both raw byte and hex string outputs.
 */
object Hasher {
    /**
     * Compute SHA-1 hash of data.
     * @return Raw 20-byte hash
     */
    fun sha1(data: ByteArray): ByteArray {
        return MessageDigest.getInstance("SHA-1").digest(data)
    }

    /**
     * Compute SHA-1 hash of data as lowercase hex string.
     * @return 40-character hex string
     */
    fun sha1Hex(data: ByteArray): String {
        return sha1(data).joinToString("") { "%02x".format(it) }
    }

    /**
     * Compute SHA-256 hash of data.
     * @return Raw 32-byte hash
     */
    fun sha256(data: ByteArray): ByteArray {
        return MessageDigest.getInstance("SHA-256").digest(data)
    }

    /**
     * Compute SHA-256 hash of data as lowercase hex string.
     * @return 64-character hex string
     */
    fun sha256Hex(data: ByteArray): String {
        return sha256(data).joinToString("") { "%02x".format(it) }
    }
}
