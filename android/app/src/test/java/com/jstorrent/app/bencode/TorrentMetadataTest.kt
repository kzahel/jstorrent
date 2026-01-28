package com.jstorrent.app.bencode

import org.junit.Assert.*
import org.junit.Test

class TorrentMetadataTest {

    // =========================================================================
    // Single-file torrent tests
    // =========================================================================

    @Test
    fun `parse single file torrent`() {
        // Minimal single-file torrent info dict:
        // d4:name8:test.txt6:lengthi1024e12:piece lengthi16384e6:pieces0:e
        val bencode = "d4:name8:test.txt6:lengthi1024e12:piece lengthi16384e6:pieces0:e"
        val infoDict = BencodeDecoder.decode(bencode.toByteArray()) as BencodeValue.BDict

        val metadata = TorrentMetadata.fromInfoDict(infoDict)

        assertEquals("test.txt", metadata.name)
        assertEquals(1024L, metadata.totalSize)
        assertEquals(16384, metadata.pieceLength)
        assertEquals(1, metadata.fileCount)
        assertTrue(metadata.isSingleFile)
        assertFalse(metadata.isPrivate)

        assertEquals("test.txt", metadata.files[0].path)
        assertEquals(1024L, metadata.files[0].size)
    }

    @Test
    fun `parse private torrent`() {
        // Info dict with private flag
        val bencode = "d4:name8:test.txt6:lengthi1024e12:piece lengthi16384e6:pieces0:7:privatei1ee"
        val infoDict = BencodeDecoder.decode(bencode.toByteArray()) as BencodeValue.BDict

        val metadata = TorrentMetadata.fromInfoDict(infoDict)

        assertTrue(metadata.isPrivate)
    }

    // =========================================================================
    // Multi-file torrent tests
    // =========================================================================

    @Test
    fun `parse multi file torrent`() {
        // Multi-file torrent info dict:
        // d
        //   4:name 11:test folder
        //   12:piece length i16384e
        //   6:pieces 0:
        //   5:files l
        //     d 6:length i100e 4:path l 5:file1 e e
        //     d 6:length i200e 4:path l 6:subdir 5:file2 e e
        //   e
        // e
        val bencode = buildString {
            append("d")
            append("5:filesl")
            append("d6:lengthi100e4:pathl5:file1ee")
            append("d6:lengthi200e4:pathl6:subdir5:file2ee")
            append("e")
            append("4:name11:test folder")
            append("12:piece lengthi16384e")
            append("6:pieces0:")
            append("e")
        }
        val infoDict = BencodeDecoder.decode(bencode.toByteArray()) as BencodeValue.BDict

        val metadata = TorrentMetadata.fromInfoDict(infoDict)

        assertEquals("test folder", metadata.name)
        assertEquals(300L, metadata.totalSize)
        assertEquals(16384, metadata.pieceLength)
        assertEquals(2, metadata.fileCount)
        assertFalse(metadata.isSingleFile)

        assertEquals("file1", metadata.files[0].path)
        assertEquals(100L, metadata.files[0].size)

        assertEquals("subdir/file2", metadata.files[1].path)
        assertEquals(200L, metadata.files[1].size)
    }

    // =========================================================================
    // Full .torrent file tests
    // =========================================================================

    @Test
    fun `parse full torrent file`() {
        // Complete .torrent file with announce and info dict
        // Using a single string to avoid buildString complexity
        val bencode = "d8:announce20:http://example.com/a4:infod6:lengthi1024e4:name8:test.txt12:piece lengthi16384e6:pieces0:ee"

        val metadata = TorrentMetadata.fromTorrentFile(bencode.toByteArray())

        assertEquals("test.txt", metadata.name)
        assertEquals(1024L, metadata.totalSize)
    }

    // =========================================================================
    // Error cases
    // =========================================================================

    @Test(expected = BencodeException::class)
    fun `reject torrent file without info dict`() {
        val bencode = "d8:announce27:http://tracker.example.come"
        TorrentMetadata.fromTorrentFile(bencode.toByteArray())
    }

    @Test(expected = BencodeException::class)
    fun `reject info dict without name`() {
        val bencode = "d6:lengthi1024e12:piece lengthi16384e6:pieces0:e"
        val infoDict = BencodeDecoder.decode(bencode.toByteArray()) as BencodeValue.BDict
        TorrentMetadata.fromInfoDict(infoDict)
    }

    @Test(expected = BencodeException::class)
    fun `reject info dict without piece length`() {
        val bencode = "d4:name8:test.txt6:lengthi1024e6:pieces0:e"
        val infoDict = BencodeDecoder.decode(bencode.toByteArray()) as BencodeValue.BDict
        TorrentMetadata.fromInfoDict(infoDict)
    }

    @Test(expected = BencodeException::class)
    fun `reject single file torrent without length`() {
        val bencode = "d4:name8:test.txt12:piece lengthi16384e6:pieces0:e"
        val infoDict = BencodeDecoder.decode(bencode.toByteArray()) as BencodeValue.BDict
        TorrentMetadata.fromInfoDict(infoDict)
    }
}
