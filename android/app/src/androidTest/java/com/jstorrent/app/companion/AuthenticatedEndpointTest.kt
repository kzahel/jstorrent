// android/app/src/androidTest/java/com/jstorrent/app/companion/AuthenticatedEndpointTest.kt
package com.jstorrent.app.companion

import android.util.Log
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.security.MessageDigest

private const val TAG = "AuthenticatedEndpointTest"

@RunWith(AndroidJUnit4::class)
class AuthenticatedEndpointTest : CompanionTestBase() {

    // =========================================================================
    // Auth Rejection
    // =========================================================================

    @Test
    fun rootsEndpointRejectsWithoutAuth() {
        val response = get("/roots", extensionHeaders())

        assertEquals("Should reject without auth", 401, response.code)
    }

    @Test
    fun hashEndpointRejectsWithoutAuth() {
        val response = postBytes("/hash/sha1", "test".toByteArray(), extensionHeaders())

        assertEquals("Should reject without auth", 401, response.code)
    }

    // =========================================================================
    // Roots Endpoint
    // =========================================================================

    @Test
    fun rootsEndpointReturnsRootsList() {
        val token = setupAuthToken()

        val response = get("/roots", extensionHeaders(token))

        assertEquals(200, response.code)

        val body = response.body?.string() ?: ""
        Log.i(TAG, "Roots response: $body")

        assertTrue("Should contain roots array", body.contains("roots"))
    }

    // =========================================================================
    // Hash Endpoint
    // =========================================================================

    @Test
    fun hashEndpointComputesSha1() {
        val token = setupAuthToken()
        val testData = "Hello, World!".toByteArray()

        val response = postBytes("/hash/sha1", testData, extensionHeaders(token))

        assertEquals(200, response.code)

        val hashBytes = response.body?.bytes() ?: ByteArray(0)
        assertEquals("SHA1 is 20 bytes", 20, hashBytes.size)

        // Verify against Java's MessageDigest
        val expectedHash = MessageDigest.getInstance("SHA-1").digest(testData)
        assertArrayEquals("Hash should match", expectedHash, hashBytes)
    }

    @Test
    fun hashEndpointHandlesEmptyData() {
        val token = setupAuthToken()

        val response = postBytes("/hash/sha1", ByteArray(0), extensionHeaders(token))

        assertEquals(200, response.code)

        val hashBytes = response.body?.bytes() ?: ByteArray(0)
        assertEquals(20, hashBytes.size)

        // SHA1 of empty is da39a3ee5e6b4b0d3255bfef95601890afd80709
        val expectedHash = MessageDigest.getInstance("SHA-1").digest(ByteArray(0))
        assertArrayEquals(expectedHash, hashBytes)
    }

    @Test
    fun hashEndpointHandlesLargeData() {
        val token = setupAuthToken()
        val largeData = ByteArray(1024 * 1024) { it.toByte() }  // 1MB

        val response = postBytes("/hash/sha1", largeData, extensionHeaders(token))

        assertEquals(200, response.code)
        assertEquals(20, response.body?.bytes()?.size)
    }
}
