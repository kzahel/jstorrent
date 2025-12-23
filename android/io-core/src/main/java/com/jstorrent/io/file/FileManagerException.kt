package com.jstorrent.io.file

/**
 * Exceptions thrown by FileManager operations.
 * Each subclass maps to a specific error condition that callers can handle.
 */
sealed class FileManagerException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /**
     * File does not exist at the specified path.
     */
    class FileNotFound(val path: String) : FileManagerException("File not found: $path")

    /**
     * Unable to create file at the specified path.
     * May indicate permission issues or invalid path.
     */
    class CannotCreateFile(val path: String) : FileManagerException("Cannot create file: $path")

    /**
     * Unable to open file for read/write operations.
     */
    class CannotOpenFile(val path: String) : FileManagerException("Cannot open file: $path")

    /**
     * Error occurred during read operation.
     */
    class ReadError(val path: String, cause: Throwable) :
        FileManagerException("Read error: $path: ${cause.message}", cause)

    /**
     * Error occurred during write operation.
     */
    class WriteError(val path: String, cause: Throwable) :
        FileManagerException("Write error: $path: ${cause.message}", cause)

    /**
     * Disk is full, cannot write data.
     */
    class DiskFull(val path: String) : FileManagerException("Disk full: $path")

    /**
     * Could not read the requested number of bytes.
     */
    class InsufficientData(val path: String, val requested: Int, val actual: Int) :
        FileManagerException("Could not read requested bytes from $path (got $actual, wanted $requested)")
}
