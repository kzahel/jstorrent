package com.jstorrent.io.file

import android.net.Uri
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Stress tests for FileManagerImpl to verify no resource leaks under heavy load.
 *
 * These tests simulate torrent download behavior where many pieces are written
 * in rapid succession. Previously, a resource leak in the SAF write path caused
 * file descriptor exhaustion and crashes during fast downloads.
 */
@RunWith(AndroidJUnit4::class)
class FileManagerStressTest {

    companion object {
        private const val TAG = "FileManagerStressTest"
    }

    private lateinit var fileManager: FileManagerImpl
    private lateinit var testDir: File
    private lateinit var rootUri: Uri

    @Before
    fun setUp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        fileManager = FileManagerImpl(context)

        // Create test directory in app's private storage
        testDir = File(context.filesDir, "stress_test_${System.currentTimeMillis()}")
        testDir.mkdirs()
        rootUri = Uri.parse("file://${testDir.absolutePath}")

        Log.i(TAG, "Test directory: ${testDir.absolutePath}")
    }

    @After
    fun tearDown() {
        testDir.deleteRecursively()
    }

    /**
     * Simulate torrent piece writes - many small writes in rapid succession.
     *
     * A 100MB torrent with 256KB pieces = ~400 pieces.
     * A 1GB torrent with 256KB pieces = ~4000 pieces.
     *
     * This test does 1000 rapid writes to stress test resource management.
     */
    @Test
    fun rapidWrites_noResourceLeak() {
        val testFile = "stress_test.bin"
        val chunkSize = 16 * 1024  // 16KB chunks (like BitTorrent blocks)
        val numWrites = 1000

        Log.i(TAG, "Starting rapid write test: $numWrites writes of ${chunkSize}B each")

        val startTime = System.currentTimeMillis()
        val testData = ByteArray(chunkSize) { it.toByte() }

        for (i in 0 until numWrites) {
            val offset = i.toLong() * chunkSize
            fileManager.write(rootUri, testFile, offset, testData)

            // Log progress every 100 writes
            if (i > 0 && i % 100 == 0) {
                val elapsed = System.currentTimeMillis() - startTime
                val rate = i * 1000L / elapsed
                Log.i(TAG, "Progress: $i/$numWrites writes ($rate writes/sec)")
            }
        }

        val elapsed = System.currentTimeMillis() - startTime
        val totalBytes = numWrites.toLong() * chunkSize
        val mbPerSec = totalBytes / 1024.0 / 1024.0 / (elapsed / 1000.0)

        Log.i(TAG, "Completed $numWrites writes in ${elapsed}ms (${String.format("%.1f", mbPerSec)} MB/s)")

        // Verify file size
        val file = File(testDir, testFile)
        assertTrue("File should exist", file.exists())
        assertEquals("File size should match", totalBytes, file.length())
    }

    /**
     * Rapid read/write interleaved - simulates piece verification during download.
     */
    @Test
    fun rapidReadWrite_noResourceLeak() {
        val testFile = "rw_stress.bin"
        val chunkSize = 16 * 1024
        val numOperations = 500

        Log.i(TAG, "Starting read/write stress test: $numOperations operations")

        val startTime = System.currentTimeMillis()
        val testData = ByteArray(chunkSize) { (it % 256).toByte() }

        // First, write all chunks
        for (i in 0 until numOperations) {
            val offset = i.toLong() * chunkSize
            fileManager.write(rootUri, testFile, offset, testData)
        }

        // Now read them all back
        for (i in 0 until numOperations) {
            val offset = i.toLong() * chunkSize
            val readData = fileManager.read(rootUri, testFile, offset, chunkSize)
            assertEquals("Read data size should match", chunkSize, readData.size)
        }

        val elapsed = System.currentTimeMillis() - startTime
        Log.i(TAG, "Completed ${numOperations * 2} read/write ops in ${elapsed}ms")
    }

    /**
     * Multiple concurrent files - simulates multi-file torrent download.
     */
    @Test
    fun multipleFiles_noResourceLeak() {
        val numFiles = 10
        val chunksPerFile = 100
        val chunkSize = 16 * 1024

        Log.i(TAG, "Starting multi-file stress test: $numFiles files, $chunksPerFile chunks each")

        val startTime = System.currentTimeMillis()
        val testData = ByteArray(chunkSize) { it.toByte() }

        for (fileNum in 0 until numFiles) {
            val fileName = "file_$fileNum.bin"
            for (chunk in 0 until chunksPerFile) {
                val offset = chunk.toLong() * chunkSize
                fileManager.write(rootUri, fileName, offset, testData)
            }
        }

        val elapsed = System.currentTimeMillis() - startTime
        val totalOps = numFiles * chunksPerFile
        Log.i(TAG, "Completed $totalOps writes across $numFiles files in ${elapsed}ms")

        // Verify all files
        for (fileNum in 0 until numFiles) {
            val file = File(testDir, "file_$fileNum.bin")
            assertTrue("File $fileNum should exist", file.exists())
            assertEquals("File $fileNum size", chunksPerFile.toLong() * chunkSize, file.length())
        }
    }
}
