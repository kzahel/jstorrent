package com.jstorrent.app.companion

import android.util.Base64
import android.util.Log
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File

private const val TAG = "FileIOTest"

@RunWith(AndroidJUnit4::class)
class FileIOTest : CompanionTestBase() {

    private lateinit var testRootKey: String
    private lateinit var token: String
    private lateinit var testDir: File

    @Before
    override fun setUp() {
        super.setUp()
        token = setupAuthToken()

        // Create a test directory in app's private storage
        testDir = File(context.filesDir, "test_downloads_${System.currentTimeMillis()}")
        testDir.mkdirs()

        // Add root using file:// URI - FileManagerImpl handles these natively
        val result = rootStore.addTestRoot(
            uri = "file://${testDir.absolutePath}",
            displayName = "Test Downloads"
        )
        testRootKey = result.key

        Log.i(TAG, "Test root key: $testRootKey, path: ${testDir.absolutePath}")

        // Trigger server's RootStore to reload from disk (refreshAvailability reloads)
        get("/roots", extensionHeaders(token))
    }

    // =========================================================================
    // Write Tests
    // =========================================================================

    @Test
    fun writeCreatesNewFile() {
        val testPath = "test_file_${System.currentTimeMillis()}.txt"
        val testData = "Hello, JSTorrent!".toByteArray()
        val pathBase64 = Base64.encodeToString(testPath.toByteArray(), Base64.NO_WRAP)

        val headers = extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64
        )

        val response = postBytes("/write/$testRootKey", testData, headers)

        assertEquals("Write should succeed", 200, response.code)

        // Verify file exists on disk
        val file = File(testDir, testPath)
        assertTrue("File should exist", file.exists())
        assertEquals("Content should match", "Hello, JSTorrent!", file.readText())
    }

    @Test
    fun writeWithOffsetWorks() {
        val testPath = "test_offset_${System.currentTimeMillis()}.bin"
        val pathBase64 = Base64.encodeToString(testPath.toByteArray(), Base64.NO_WRAP)

        // First write
        val data1 = "AAAA".toByteArray()
        postBytes("/write/$testRootKey", data1, extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64
        ))

        // Write at offset 2
        val data2 = "BB".toByteArray()
        val response = postBytes("/write/$testRootKey", data2, extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64,
            "X-Offset" to "2"
        ))

        assertEquals(200, response.code)

        // Read back and verify: should be "AABB"
        val readResponse = get("/read/$testRootKey", extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64,
            "X-Offset" to "0",
            "X-Length" to "4"
        ))

        assertEquals(200, readResponse.code)
        assertEquals("AABB", readResponse.body?.string())
    }

    @Test
    fun writeCreatesParentDirectories() {
        val testPath = "subdir/nested/file_${System.currentTimeMillis()}.txt"
        val testData = "Nested content".toByteArray()
        val pathBase64 = Base64.encodeToString(testPath.toByteArray(), Base64.NO_WRAP)

        val response = postBytes("/write/$testRootKey", testData, extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64
        ))

        assertEquals("Write should succeed", 200, response.code)

        // Verify nested file exists
        val file = File(testDir, testPath)
        assertTrue("Nested file should exist", file.exists())
    }

    // =========================================================================
    // Read Tests
    // =========================================================================

    @Test
    fun readExistingFile() {
        // First write a file
        val testPath = "read_test_${System.currentTimeMillis()}.txt"
        val testData = "Test content for reading"
        val pathBase64 = Base64.encodeToString(testPath.toByteArray(), Base64.NO_WRAP)

        postBytes("/write/$testRootKey", testData.toByteArray(), extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64
        ))

        // Now read it back
        val response = get("/read/$testRootKey", extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64,
            "X-Offset" to "0",
            "X-Length" to testData.length.toString()
        ))

        assertEquals(200, response.code)
        assertEquals(testData, response.body?.string())
    }

    @Test
    fun readWithOffsetAndLength() {
        val testPath = "partial_read_${System.currentTimeMillis()}.txt"
        val testData = "0123456789"
        val pathBase64 = Base64.encodeToString(testPath.toByteArray(), Base64.NO_WRAP)

        postBytes("/write/$testRootKey", testData.toByteArray(), extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64
        ))

        // Read bytes 3-6 (should be "3456")
        val response = get("/read/$testRootKey", extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64,
            "X-Offset" to "3",
            "X-Length" to "4"
        ))

        assertEquals(200, response.code)
        assertEquals("3456", response.body?.string())
    }

    @Test
    fun readNonexistentFileReturns404() {
        val pathBase64 = Base64.encodeToString("nonexistent_file.txt".toByteArray(), Base64.NO_WRAP)

        val response = get("/read/$testRootKey", extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64,
            "X-Offset" to "0",
            "X-Length" to "100"
        ))

        assertEquals(404, response.code)
    }

    @Test
    fun readInvalidRootKeyReturns404() {
        val pathBase64 = Base64.encodeToString("test.txt".toByteArray(), Base64.NO_WRAP)

        val response = get("/read/invalid_root_key", extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64,
            "X-Offset" to "0",
            "X-Length" to "100"
        ))

        // Invalid root key should return 403 (Forbidden) per FileRoutes.kt
        assertEquals("Should reject invalid root", 403, response.code)
    }
}
