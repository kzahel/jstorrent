package com.jstorrent.io.hash

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class HasherTest {

    // SHA-1 test vectors from RFC 3174
    @Test
    fun `sha1Hex of hello returns correct hash`() {
        val input = "hello".toByteArray()
        val expected = "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"
        assertEquals(expected, Hasher.sha1Hex(input))
    }

    @Test
    fun `sha1Hex of empty data returns correct hash`() {
        val input = ByteArray(0)
        val expected = "da39a3ee5e6b4b0d3255bfef95601890afd80709"
        assertEquals(expected, Hasher.sha1Hex(input))
    }

    @Test
    fun `sha1 returns 20 bytes`() {
        val input = "test".toByteArray()
        val hash = Hasher.sha1(input)
        assertEquals(20, hash.size)
    }

    @Test
    fun `sha1Hex returns 40 lowercase hex characters`() {
        val input = "test".toByteArray()
        val hex = Hasher.sha1Hex(input)
        assertEquals(40, hex.length)
        assertEquals(hex, hex.lowercase())
    }

    @Test
    fun `sha1 and sha1Hex are consistent`() {
        val input = "consistency test".toByteArray()
        val rawHash = Hasher.sha1(input)
        val hexHash = Hasher.sha1Hex(input)
        val reconstructed = rawHash.joinToString("") { "%02x".format(it) }
        assertEquals(hexHash, reconstructed)
    }

    // SHA-256 test vectors
    @Test
    fun `sha256Hex of hello returns correct hash`() {
        val input = "hello".toByteArray()
        val expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        assertEquals(expected, Hasher.sha256Hex(input))
    }

    @Test
    fun `sha256Hex of empty data returns correct hash`() {
        val input = ByteArray(0)
        val expected = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        assertEquals(expected, Hasher.sha256Hex(input))
    }

    @Test
    fun `sha256 returns 32 bytes`() {
        val input = "test".toByteArray()
        val hash = Hasher.sha256(input)
        assertEquals(32, hash.size)
    }

    @Test
    fun `sha256Hex returns 64 lowercase hex characters`() {
        val input = "test".toByteArray()
        val hex = Hasher.sha256Hex(input)
        assertEquals(64, hex.length)
        assertEquals(hex, hex.lowercase())
    }

    @Test
    fun `sha256 and sha256Hex are consistent`() {
        val input = "consistency test".toByteArray()
        val rawHash = Hasher.sha256(input)
        val hexHash = Hasher.sha256Hex(input)
        val reconstructed = rawHash.joinToString("") { "%02x".format(it) }
        assertEquals(hexHash, reconstructed)
    }

    // Binary data tests
    @Test
    fun `sha1 handles binary data correctly`() {
        val input = ByteArray(16 * 1024) { 0xAB.toByte() }
        val hash = Hasher.sha1Hex(input)
        assertEquals(40, hash.length)
        // Verify deterministic
        assertEquals(hash, Hasher.sha1Hex(input))
    }

    @Test
    fun `sha256 handles binary data correctly`() {
        val input = ByteArray(16 * 1024) { 0xCD.toByte() }
        val hash = Hasher.sha256Hex(input)
        assertEquals(64, hash.length)
        // Verify deterministic
        assertEquals(hash, Hasher.sha256Hex(input))
    }
}
