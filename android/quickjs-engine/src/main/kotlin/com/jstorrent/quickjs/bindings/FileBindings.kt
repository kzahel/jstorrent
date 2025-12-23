package com.jstorrent.quickjs.bindings

import com.jstorrent.quickjs.QuickJsContext
import com.jstorrent.quickjs.file.FileHandleManager

/**
 * File I/O bindings for QuickJS.
 *
 * Implements the following native functions:
 * - __jstorrent_file_open(handleId, rootKey, path, mode) -> boolean
 * - __jstorrent_file_read(handleId, offset, length, position) -> ArrayBuffer
 * - __jstorrent_file_write(handleId, data, position) -> number
 * - __jstorrent_file_truncate(handleId, len) -> boolean
 * - __jstorrent_file_sync(handleId) -> void
 * - __jstorrent_file_close(handleId) -> void
 * - __jstorrent_file_stat(rootKey, path) -> string | null
 * - __jstorrent_file_mkdir(rootKey, path) -> boolean
 * - __jstorrent_file_exists(rootKey, path) -> boolean
 * - __jstorrent_file_readdir(rootKey, path) -> string (JSON array)
 * - __jstorrent_file_delete(rootKey, path) -> boolean
 *
 * All operations are synchronous - they block the JS thread until complete.
 * This is acceptable because file operations on app-private storage are fast.
 */
class FileBindings(
    private val fileManager: FileHandleManager
) {
    /**
     * Register all file bindings on the given context.
     */
    fun register(ctx: QuickJsContext) {
        registerHandleFunctions(ctx)
        registerPathFunctions(ctx)
    }

    /**
     * Register functions that operate on file handles.
     */
    private fun registerHandleFunctions(ctx: QuickJsContext) {
        // __jstorrent_file_open(handleId: number, rootKey: string, path: string, mode: string): boolean
        ctx.setGlobalFunction("__jstorrent_file_open") { args ->
            val handleId = args.getOrNull(0)?.toIntOrNull()
            val rootKey = args.getOrNull(1) ?: ""
            val path = args.getOrNull(2) ?: ""
            val mode = args.getOrNull(3) ?: "r"

            if (handleId == null || path.isEmpty()) {
                "false"
            } else {
                fileManager.open(handleId, rootKey, path, mode).toString()
            }
        }

        // __jstorrent_file_read(handleId: number, offset: number, length: number, position: number): ArrayBuffer
        ctx.setGlobalFunctionReturnsBinary("__jstorrent_file_read") { args, _ ->
            val handleId = args.getOrNull(0)?.toIntOrNull()
            val offset = args.getOrNull(1)?.toLongOrNull() ?: 0L
            val length = args.getOrNull(2)?.toIntOrNull() ?: 0
            val position = args.getOrNull(3)?.toLongOrNull() ?: 0L

            if (handleId == null || length <= 0) {
                ByteArray(0)
            } else {
                fileManager.read(handleId, offset, length, position) ?: ByteArray(0)
            }
        }

        // __jstorrent_file_write(handleId: number, data: ArrayBuffer, position: number): number
        ctx.setGlobalFunctionWithBinary("__jstorrent_file_write", 1) { args, binary ->
            val handleId = args.getOrNull(0)?.toIntOrNull()
            val position = args.getOrNull(2)?.toLongOrNull() ?: 0L

            if (handleId == null || binary == null) {
                "-1"
            } else {
                fileManager.write(handleId, binary, position).toString()
            }
        }

        // __jstorrent_file_truncate(handleId: number, len: number): boolean
        ctx.setGlobalFunction("__jstorrent_file_truncate") { args ->
            val handleId = args.getOrNull(0)?.toIntOrNull()
            val len = args.getOrNull(1)?.toLongOrNull() ?: 0L

            if (handleId == null) {
                "false"
            } else {
                fileManager.truncate(handleId, len).toString()
            }
        }

        // __jstorrent_file_sync(handleId: number): void
        ctx.setGlobalFunction("__jstorrent_file_sync") { args ->
            val handleId = args.getOrNull(0)?.toIntOrNull()
            handleId?.let { fileManager.sync(it) }
            null
        }

        // __jstorrent_file_close(handleId: number): void
        ctx.setGlobalFunction("__jstorrent_file_close") { args ->
            val handleId = args.getOrNull(0)?.toIntOrNull()
            handleId?.let { fileManager.close(it) }
            null
        }
    }

    /**
     * Register functions that operate on paths (no handle required).
     */
    private fun registerPathFunctions(ctx: QuickJsContext) {
        // __jstorrent_file_stat(rootKey: string, path: string): string | null
        ctx.setGlobalFunction("__jstorrent_file_stat") { args ->
            val rootKey = args.getOrNull(0) ?: ""
            val path = args.getOrNull(1) ?: ""

            fileManager.stat(rootKey, path)
        }

        // __jstorrent_file_mkdir(rootKey: string, path: string): boolean
        ctx.setGlobalFunction("__jstorrent_file_mkdir") { args ->
            val rootKey = args.getOrNull(0) ?: ""
            val path = args.getOrNull(1) ?: ""

            fileManager.mkdir(rootKey, path).toString()
        }

        // __jstorrent_file_exists(rootKey: string, path: string): boolean
        ctx.setGlobalFunction("__jstorrent_file_exists") { args ->
            val rootKey = args.getOrNull(0) ?: ""
            val path = args.getOrNull(1) ?: ""

            fileManager.exists(rootKey, path).toString()
        }

        // __jstorrent_file_readdir(rootKey: string, path: string): string (JSON array)
        ctx.setGlobalFunction("__jstorrent_file_readdir") { args ->
            val rootKey = args.getOrNull(0) ?: ""
            val path = args.getOrNull(1) ?: ""

            fileManager.readdir(rootKey, path)
        }

        // __jstorrent_file_delete(rootKey: string, path: string): boolean
        ctx.setGlobalFunction("__jstorrent_file_delete") { args ->
            val rootKey = args.getOrNull(0) ?: ""
            val path = args.getOrNull(1) ?: ""

            fileManager.delete(rootKey, path).toString()
        }
    }
}
