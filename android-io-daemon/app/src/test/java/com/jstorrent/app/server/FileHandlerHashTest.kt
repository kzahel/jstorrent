package com.jstorrent.app.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest

/**
 * Unit tests for SHA1 hash verification in FileHandler.
 * Tests the hash computation logic used for X-Expected-SHA1 verification.
 */
class FileHandlerHashTest {

    /**
     * Compute SHA1 hash the same way as FileHandler does.
     */
    private fun computeSha1Hex(data: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-1")
        return digest.digest(data).joinToString("") { "%02x".format(it) }
    }

    @Test
    fun `SHA1 hash computation matches known test vector`() {
        // Known test vector: SHA1("hello") = aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
        val hash = computeSha1Hex("hello".toByteArray())
        assertEquals("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d", hash)
    }

    @Test
    fun `SHA1 hash of empty data`() {
        // SHA1("") = da39a3ee5e6b4b0d3255bfef95601890afd80709
        val hash = computeSha1Hex(ByteArray(0))
        assertEquals("da39a3ee5e6b4b0d3255bfef95601890afd80709", hash)
    }

    @Test
    fun `SHA1 hash of binary data produces 40 hex chars`() {
        // Test with binary data (16KB of 0xAB bytes)
        val data = ByteArray(16384) { 0xAB.toByte() }
        val hash = computeSha1Hex(data)
        assertEquals(40, hash.length)
        assertTrue(hash.all { it.isDigit() || it in 'a'..'f' })
    }

    @Test
    fun `hash comparison is case-insensitive`() {
        // The Android implementation uses equals(ignoreCase = true)
        val hash = computeSha1Hex("test".toByteArray())
        val upperHash = hash.uppercase()

        // Verify case-insensitive comparison works
        assertTrue(hash.equals(upperHash, ignoreCase = true))
        assertTrue(upperHash.equals(hash, ignoreCase = true))
    }

    @Test
    fun `different data produces different hash`() {
        val hash1 = computeSha1Hex("hello".toByteArray())
        val hash2 = computeSha1Hex("world".toByteArray())
        assertNotEquals(hash1, hash2)
    }

    @Test
    fun `hash output is lowercase hex`() {
        val hash = computeSha1Hex("test".toByteArray())
        assertEquals(hash, hash.lowercase())
    }
}
