package com.jstorrent.quickjs.bindings

import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * Unit tests for FileBindings batch unpacking.
 * These tests can run on JVM since unpackVerifiedWriteBatch is pure Kotlin.
 */
class FileBindingsTest {

    /**
     * Pack a batch of writes for testing (mirrors JS packVerifiedWriteBatch).
     * All multi-byte integers are little-endian.
     */
    private fun packTestBatch(writes: List<TestWriteRequest>): ByteArray {
        var totalSize = 4 // count
        val encoded = writes.map { w ->
            val rootKey = w.rootKey.toByteArray(Charsets.UTF_8)
            val path = w.path.toByteArray(Charsets.UTF_8)
            val hashHex = w.hashHex.toByteArray(Charsets.UTF_8)
            val callbackId = w.callbackId.toByteArray(Charsets.UTF_8)
            totalSize += 1 + rootKey.size  // rootKeyLen + rootKey
            totalSize += 2 + path.size     // pathLen + path
            totalSize += 8                  // position
            totalSize += 4 + w.data.size   // dataLen + data
            totalSize += 40                 // hashHex (fixed)
            totalSize += 1 + callbackId.size // callbackIdLen + callbackId
            EncodedWrite(rootKey, path, w.position, w.data, hashHex, callbackId)
        }

        val buffer = ByteBuffer.allocate(totalSize).order(ByteOrder.LITTLE_ENDIAN)
        buffer.putInt(writes.size)

        for (e in encoded) {
            // rootKeyLen + rootKey
            buffer.put(e.rootKey.size.toByte())
            buffer.put(e.rootKey)

            // pathLen + path
            buffer.putShort(e.path.size.toShort())
            buffer.put(e.path)

            // position (u64 LE as two u32)
            buffer.putInt((e.position and 0xFFFFFFFFL).toInt())
            buffer.putInt((e.position shr 32).toInt())

            // dataLen + data
            buffer.putInt(e.data.size)
            buffer.put(e.data)

            // hashHex (40 bytes)
            buffer.put(e.hashHex)

            // callbackIdLen + callbackId
            buffer.put(e.callbackId.size.toByte())
            buffer.put(e.callbackId)
        }

        return buffer.array()
    }

    private data class TestWriteRequest(
        val rootKey: String,
        val path: String,
        val position: Long,
        val data: ByteArray,
        val hashHex: String,
        val callbackId: String,
    )

    private data class EncodedWrite(
        val rootKey: ByteArray,
        val path: ByteArray,
        val position: Long,
        val data: ByteArray,
        val hashHex: ByteArray,
        val callbackId: ByteArray,
    )

    @Test
    fun `unpack single write correctly`() {
        val writes = listOf(
            TestWriteRequest(
                rootKey = "root1",
                path = "path/to/file.txt",
                position = 12345,
                data = byteArrayOf(1, 2, 3, 4, 5),
                hashHex = "a".repeat(40),
                callbackId = "vw_1",
            )
        )

        val packed = packTestBatch(writes)
        val result = unpackVerifiedWriteBatch(packed)

        assertEquals(1, result.size)
        val r = result[0]
        assertEquals("root1", r.rootKey)
        assertEquals("path/to/file.txt", r.path)
        assertEquals(12345L, r.position)
        assertEquals(listOf<Byte>(1, 2, 3, 4, 5), r.data.toList())
        assertEquals("a".repeat(40), r.expectedHashHex)
        assertEquals("vw_1", r.callbackId)
    }

    @Test
    fun `unpack multiple writes correctly`() {
        val writes = listOf(
            TestWriteRequest(
                rootKey = "r1",
                path = "a.txt",
                position = 100,
                data = byteArrayOf(1),
                hashHex = "0".repeat(40),
                callbackId = "vw_1",
            ),
            TestWriteRequest(
                rootKey = "r2",
                path = "b.txt",
                position = 200,
                data = byteArrayOf(2, 3),
                hashHex = "1".repeat(40),
                callbackId = "vw_2",
            ),
        )

        val packed = packTestBatch(writes)
        val result = unpackVerifiedWriteBatch(packed)

        assertEquals(2, result.size)

        assertEquals("r1", result[0].rootKey)
        assertEquals("a.txt", result[0].path)
        assertEquals(100L, result[0].position)
        assertEquals(listOf<Byte>(1), result[0].data.toList())
        assertEquals("vw_1", result[0].callbackId)

        assertEquals("r2", result[1].rootKey)
        assertEquals("b.txt", result[1].path)
        assertEquals(200L, result[1].position)
        assertEquals(listOf<Byte>(2, 3), result[1].data.toList())
        assertEquals("vw_2", result[1].callbackId)
    }

    @Test
    fun `handle large positions (greater than 32 bits)`() {
        val largePosition = 0x1_0000_0001L // 4294967297 (requires > 32 bits)

        val writes = listOf(
            TestWriteRequest(
                rootKey = "r",
                path = "f",
                position = largePosition,
                data = byteArrayOf(),
                hashHex = "f".repeat(40),
                callbackId = "c",
            )
        )

        val packed = packTestBatch(writes)
        val result = unpackVerifiedWriteBatch(packed)

        assertEquals(1, result.size)
        assertEquals(largePosition, result[0].position)
    }

    @Test
    fun `handle empty data`() {
        val writes = listOf(
            TestWriteRequest(
                rootKey = "r",
                path = "f",
                position = 0,
                data = byteArrayOf(),
                hashHex = "0".repeat(40),
                callbackId = "c",
            )
        )

        val packed = packTestBatch(writes)
        val result = unpackVerifiedWriteBatch(packed)

        assertEquals(1, result.size)
        assertEquals(0, result[0].data.size)
    }

    @Test
    fun `handle unicode paths`() {
        val writes = listOf(
            TestWriteRequest(
                rootKey = "root",
                path = "文件/テスト.txt", // Chinese and Japanese characters
                position = 0,
                data = byteArrayOf(),
                hashHex = "0".repeat(40),
                callbackId = "vw_1",
            )
        )

        val packed = packTestBatch(writes)
        val result = unpackVerifiedWriteBatch(packed)

        assertEquals(1, result.size)
        assertEquals("文件/テスト.txt", result[0].path)
    }

    @Test
    fun `handle empty batch`() {
        val writes = emptyList<TestWriteRequest>()
        val packed = packTestBatch(writes)
        val result = unpackVerifiedWriteBatch(packed)

        assertEquals(0, result.size)
    }

    @Test
    fun `reject invalid batch count`() {
        // Create a buffer with negative count
        val buffer = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN)
        buffer.putInt(-1)

        assertFailsWith<IllegalArgumentException> {
            unpackVerifiedWriteBatch(buffer.array())
        }
    }

    @Test
    fun `handle large data payload`() {
        val largeData = ByteArray(1024 * 256) { it.toByte() } // 256KB

        val writes = listOf(
            TestWriteRequest(
                rootKey = "root",
                path = "large.bin",
                position = 0,
                data = largeData,
                hashHex = "a".repeat(40),
                callbackId = "vw_1",
            )
        )

        val packed = packTestBatch(writes)
        val result = unpackVerifiedWriteBatch(packed)

        assertEquals(1, result.size)
        assertEquals(largeData.size, result[0].data.size)
        assertEquals(largeData.toList(), result[0].data.toList())
    }
}
