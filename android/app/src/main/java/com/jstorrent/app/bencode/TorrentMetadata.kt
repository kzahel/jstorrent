package com.jstorrent.app.bencode

/**
 * Extracted metadata from a .torrent file or info dictionary.
 * Contains the fields needed for UI display without running the engine.
 */
data class TorrentMetadata(
    val name: String,
    val totalSize: Long,
    val pieceLength: Int,
    val files: List<TorrentFile>,
    val isPrivate: Boolean = false
) {
    /**
     * Single file within a torrent.
     */
    data class TorrentFile(
        val path: String,
        val size: Long
    )

    val fileCount: Int get() = files.size
    val isSingleFile: Boolean get() = files.size == 1

    companion object {
        /**
         * Parse metadata from a complete .torrent file (has "info" key at root).
         */
        fun fromTorrentFile(data: ByteArray): TorrentMetadata {
            val root = BencodeDecoder.decode(data)
            if (root !is BencodeValue.BDict) {
                throw BencodeException("Torrent file root must be a dictionary")
            }

            val infoDict = root.getDict("info")
                ?: throw BencodeException("Missing 'info' dictionary in torrent file")

            return fromInfoDict(infoDict)
        }

        /**
         * Parse metadata from a base64-encoded .torrent file.
         */
        fun fromTorrentFileBase64(base64: String): TorrentMetadata {
            val data = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
            return fromTorrentFile(data)
        }

        /**
         * Parse metadata from a raw info dictionary (already decoded).
         */
        fun fromInfoDict(infoDict: BencodeValue.BDict): TorrentMetadata {
            val name = infoDict.getString("name")
                ?: throw BencodeException("Missing 'name' in info dictionary")

            val pieceLength = infoDict.getInt("piece length")
                ?: throw BencodeException("Missing 'piece length' in info dictionary")

            val isPrivate = infoDict.getInt("private") == 1

            // Check for multi-file vs single-file mode
            val filesList = infoDict.getList("files")
            val files: List<TorrentFile>
            val totalSize: Long

            if (filesList != null) {
                // Multi-file mode: files is a list of {path: [...], length: n}
                files = filesList.items.mapIndexed { index, item ->
                    val fileDict = item as? BencodeValue.BDict
                        ?: throw BencodeException("File entry $index is not a dictionary")

                    val pathList = fileDict.getList("path")
                        ?: throw BencodeException("Missing 'path' in file entry $index")

                    val pathParts = pathList.items.map { part ->
                        (part as? BencodeValue.BBytes)?.asString()
                            ?: throw BencodeException("Path component is not a string")
                    }
                    val path = pathParts.joinToString("/")

                    val length = fileDict.getLong("length")
                        ?: throw BencodeException("Missing 'length' in file entry $index")

                    TorrentFile(path = path, size = length)
                }
                totalSize = files.sumOf { it.size }
            } else {
                // Single-file mode: length at root level
                val length = infoDict.getLong("length")
                    ?: throw BencodeException("Missing 'length' in single-file torrent")

                files = listOf(TorrentFile(path = name, size = length))
                totalSize = length
            }

            return TorrentMetadata(
                name = name,
                totalSize = totalSize,
                pieceLength = pieceLength,
                files = files,
                isPrivate = isPrivate
            )
        }

        /**
         * Parse metadata from a base64-encoded info dictionary.
         * Used for magnet links where only the info dict is saved (not full .torrent).
         */
        fun fromInfoDictBase64(base64: String): TorrentMetadata {
            val data = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
            val infoDict = BencodeDecoder.decode(data)
            if (infoDict !is BencodeValue.BDict) {
                throw BencodeException("Info dictionary must be a dictionary")
            }
            return fromInfoDict(infoDict)
        }
    }
}
