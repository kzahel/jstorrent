// android/app/src/androidTest/java/com/jstorrent/app/companion/HttpEndpointTest.kt
package com.jstorrent.app.companion

import android.util.Log
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.jstorrent.app.service.IoDaemonService

private const val TAG = "HttpEndpointTest"

@RunWith(AndroidJUnit4::class)
class HttpEndpointTest : CompanionTestBase() {

    private val json = Json { ignoreUnknownKeys = true }

    // =========================================================================
    // Health Check
    // =========================================================================

    @Test
    fun healthEndpointReturnsOk() {
        val response = get("/health")

        assertEquals(200, response.code)
        assertEquals("ok", response.body?.string())
    }

    // =========================================================================
    // Status Endpoint
    // =========================================================================

    @Test
    fun statusEndpointRequiresExtensionOrigin() {
        // No Origin header - should fail
        val response = post("/status", "{}")

        // Should reject without extension origin
        assertNotEquals(200, response.code)
    }

    @Test
    fun statusEndpointReturnsPortAndPairingStatus() {
        val response = post("/status", "{}", extensionHeaders())

        assertEquals(200, response.code)

        val body = response.body?.string() ?: ""
        Log.i(TAG, "Status response: $body")

        val jsonObj = json.parseToJsonElement(body).jsonObject

        assertTrue("Should have port", jsonObj.containsKey("port"))
        assertTrue("Should have paired", jsonObj.containsKey("paired"))

        val port = jsonObj["port"]?.jsonPrimitive?.content?.toInt()
        val paired = jsonObj["paired"]?.jsonPrimitive?.content?.toBoolean()

        assertEquals(IoDaemonService.instance?.port, port)
        assertFalse("Should not be paired initially", paired ?: true)
    }

    @Test
    fun statusEndpointWithTokenValidation() {
        // Set up a valid token
        val token = setupAuthToken()

        // Request status with token in body
        val response = post(
            "/status",
            """{"token": "$token"}""",
            extensionHeaders()
        )

        assertEquals(200, response.code)

        val body = response.body?.string() ?: ""
        val jsonObj = json.parseToJsonElement(body).jsonObject

        val tokenValid = jsonObj["tokenValid"]?.jsonPrimitive?.content?.toBoolean()
        assertTrue("Token should be valid", tokenValid ?: false)
    }

    // =========================================================================
    // Network Interfaces
    // =========================================================================

    @Test
    fun networkInterfacesEndpointReturnsData() {
        val response = get("/network/interfaces")

        assertEquals(200, response.code)

        val body = response.body?.string() ?: ""
        Log.i(TAG, "Network interfaces: $body")

        // Should be a JSON array (even if empty on emulator)
        assertTrue("Should be JSON array", body.startsWith("["))
    }
}
