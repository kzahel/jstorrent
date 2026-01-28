package com.jstorrent.app.bencode

import org.junit.Assert.*
import org.junit.Test

class BencodeDecoderTest {

    // =========================================================================
    // Integer tests
    // =========================================================================

    @Test
    fun `decode positive integer`() {
        val result = BencodeDecoder.decode("i42e".toByteArray())
        assertEquals(BencodeValue.BInt(42), result)
    }

    @Test
    fun `decode zero`() {
        val result = BencodeDecoder.decode("i0e".toByteArray())
        assertEquals(BencodeValue.BInt(0), result)
    }

    @Test
    fun `decode negative integer`() {
        val result = BencodeDecoder.decode("i-42e".toByteArray())
        assertEquals(BencodeValue.BInt(-42), result)
    }

    @Test
    fun `decode large integer`() {
        val result = BencodeDecoder.decode("i9223372036854775807e".toByteArray())
        assertEquals(BencodeValue.BInt(Long.MAX_VALUE), result)
    }

    @Test(expected = BencodeException::class)
    fun `reject leading zero in integer`() {
        BencodeDecoder.decode("i03e".toByteArray())
    }

    @Test(expected = BencodeException::class)
    fun `reject negative zero`() {
        BencodeDecoder.decode("i-0e".toByteArray())
    }

    // =========================================================================
    // Byte string tests
    // =========================================================================

    @Test
    fun `decode simple string`() {
        val result = BencodeDecoder.decode("4:spam".toByteArray())
        assertTrue(result is BencodeValue.BBytes)
        assertEquals("spam", (result as BencodeValue.BBytes).asString())
    }

    @Test
    fun `decode empty string`() {
        val result = BencodeDecoder.decode("0:".toByteArray())
        assertTrue(result is BencodeValue.BBytes)
        assertEquals("", (result as BencodeValue.BBytes).asString())
    }

    @Test
    fun `decode string with binary data`() {
        // String containing null bytes
        val data = byteArrayOf('3'.code.toByte(), ':'.code.toByte(), 0, 1, 2)
        val result = BencodeDecoder.decode(data)
        assertTrue(result is BencodeValue.BBytes)
        assertArrayEquals(byteArrayOf(0, 1, 2), (result as BencodeValue.BBytes).bytes)
    }

    // =========================================================================
    // List tests
    // =========================================================================

    @Test
    fun `decode empty list`() {
        val result = BencodeDecoder.decode("le".toByteArray())
        assertTrue(result is BencodeValue.BList)
        assertEquals(0, (result as BencodeValue.BList).size)
    }

    @Test
    fun `decode list with integers`() {
        val result = BencodeDecoder.decode("li1ei2ei3ee".toByteArray())
        assertTrue(result is BencodeValue.BList)
        val list = result as BencodeValue.BList
        assertEquals(3, list.size)
        assertEquals(1L, (list[0] as BencodeValue.BInt).value)
        assertEquals(2L, (list[1] as BencodeValue.BInt).value)
        assertEquals(3L, (list[2] as BencodeValue.BInt).value)
    }

    @Test
    fun `decode list with mixed types`() {
        val result = BencodeDecoder.decode("l4:spami42ee".toByteArray())
        assertTrue(result is BencodeValue.BList)
        val list = result as BencodeValue.BList
        assertEquals(2, list.size)
        assertEquals("spam", (list[0] as BencodeValue.BBytes).asString())
        assertEquals(42L, (list[1] as BencodeValue.BInt).value)
    }

    @Test
    fun `decode nested list`() {
        val result = BencodeDecoder.decode("lli1eeli2eee".toByteArray())
        assertTrue(result is BencodeValue.BList)
        val outer = result as BencodeValue.BList
        assertEquals(2, outer.size)
        assertTrue(outer[0] is BencodeValue.BList)
        assertTrue(outer[1] is BencodeValue.BList)
    }

    // =========================================================================
    // Dictionary tests
    // =========================================================================

    @Test
    fun `decode empty dictionary`() {
        val result = BencodeDecoder.decode("de".toByteArray())
        assertTrue(result is BencodeValue.BDict)
        assertEquals(0, (result as BencodeValue.BDict).keys.size)
    }

    @Test
    fun `decode simple dictionary`() {
        val result = BencodeDecoder.decode("d3:bar4:spam3:fooi42ee".toByteArray())
        assertTrue(result is BencodeValue.BDict)
        val dict = result as BencodeValue.BDict
        assertEquals("spam", dict.getString("bar"))
        assertEquals(42, dict.getInt("foo"))
    }

    @Test
    fun `decode dictionary with list value`() {
        val result = BencodeDecoder.decode("d4:listli1ei2ei3eee".toByteArray())
        assertTrue(result is BencodeValue.BDict)
        val dict = result as BencodeValue.BDict
        val list = dict.getList("list")
        assertNotNull(list)
        assertEquals(3, list!!.size)
    }

    @Test
    fun `decode nested dictionary`() {
        val result = BencodeDecoder.decode("d5:innerd3:fooi1eee".toByteArray())
        assertTrue(result is BencodeValue.BDict)
        val outer = result as BencodeValue.BDict
        val inner = outer.getDict("inner")
        assertNotNull(inner)
        assertEquals(1, inner!!.getInt("foo"))
    }

    // =========================================================================
    // Error cases
    // =========================================================================

    @Test(expected = BencodeException::class)
    fun `reject truncated integer`() {
        BencodeDecoder.decode("i42".toByteArray())
    }

    @Test(expected = BencodeException::class)
    fun `reject truncated string`() {
        BencodeDecoder.decode("10:short".toByteArray())
    }

    @Test(expected = BencodeException::class)
    fun `reject unterminated list`() {
        BencodeDecoder.decode("li1ei2e".toByteArray())
    }

    @Test(expected = BencodeException::class)
    fun `reject unterminated dictionary`() {
        BencodeDecoder.decode("d3:fooi1e".toByteArray())
    }

    @Test(expected = BencodeException::class)
    fun `reject trailing data`() {
        BencodeDecoder.decode("i42eextra".toByteArray())
    }

    @Test(expected = BencodeException::class)
    fun `reject invalid type marker`() {
        BencodeDecoder.decode("x".toByteArray())
    }
}
