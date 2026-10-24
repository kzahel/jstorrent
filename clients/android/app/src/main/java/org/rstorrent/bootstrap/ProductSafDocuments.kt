package org.rstorrent.bootstrap

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.os.CancellationSignal
import android.provider.DocumentsContract
import java.security.MessageDigest
import org.rstorrent.bootstrap.uniffi.SafDynamicFileRole
import org.rstorrent.bootstrap.uniffi.SafRemovalPlan
import org.rstorrent.bootstrap.uniffi.SafStorageAccess
import org.rstorrent.bootstrap.uniffi.SafStorageFailureKind
import org.rstorrent.bootstrap.uniffi.SafStorageObjectKind
import org.rstorrent.bootstrap.uniffi.SafStorageObservation
import org.rstorrent.bootstrap.uniffi.SafStorageRequest

class SafStorageRequestException(
    val kind: SafStorageFailureKind,
    message: String,
) : IllegalStateException(message)

object ProductSafDocuments {
    private const val MIME_BINARY = "application/octet-stream"

    fun persistTree(
        context: Context,
        treeUri: Uri,
        repairRootId: String? = null,
    ) = ProductSafRootRegistry.recordSelectionCandidate(context, treeUri, repairRootId)

    fun selectedTree(context: Context): Uri? {
        val state = ProductSafRootRegistry.load(context)
        val encoded =
            state.selectionCandidate
                ?: state.roots.singleOrNull()?.treeUri
                ?: return null
        return Uri.parse(encoded).takeIf { hasGrant(context, it) }
    }

    fun releaseSelectedTreeForTest(context: Context) {
        check(isDebuggable(context)) { "SAF grant release is debug-only" }
        val state = ProductSafRootRegistry.load(context)
        val encoded =
            state.selectionCandidate
                ?: state.roots.singleOrNull()?.treeUri
                ?: error("no unambiguous SAF tree is stored")
        val uri = Uri.parse(encoded)
        context.contentResolver.releasePersistableUriPermission(uri, GRANT_FLAGS)
        check(
            ProductSafRootRegistry.load(context).roots.any { it.treeUri == uri.toString() } ||
                ProductSafRootRegistry.load(context).selectionCandidate == uri.toString(),
        ) {
            "debug grant release must retain stale platform identity"
        }
        check(!hasGrant(context, uri)) { "SAF tree grant survived debug release" }
    }

    fun releaseTreeForTest(
        context: Context,
        rootId: String,
    ) {
        check(isDebuggable(context)) { "SAF grant release is debug-only" }
        val root =
            ProductSafRootRegistry.load(context).roots.singleOrNull { it.rootId == rootId }
                ?: error("SAF root is not registered")
        val uri = Uri.parse(root.treeUri)
        context.contentResolver.releasePersistableUriPermission(uri, GRANT_FLAGS)
        check(
            ProductSafRootRegistry.load(context).roots.any {
                it.rootId == rootId && it.treeUri == uri.toString()
            },
        ) { "debug grant release must retain stale platform identity" }
        check(!hasGrant(context, uri)) { "SAF tree grant survived debug release" }
    }

    fun openDynamic(
        context: Context,
        treeUri: Uri,
        request: SafStorageRequest,
        cancellation: CancellationSignal,
    ): ParcelFileDescriptor {
        require(hasGrant(context, treeUri)) {
            "persisted SAF grant is unavailable"
        }
        require(request.path.isNotEmpty()) { "SAF request path is empty" }
        request.path.forEach(::requireValidComponent)
        val create = request.access == SafStorageAccess.READ_WRITE_CREATE
        var parent = documentUri(treeUri)
        for (component in request.path.dropLast(1)) {
            parent =
                findUniqueChild(context, parent, component)
                    ?: if (create) {
                        synchronized(this) {
                            findUniqueChild(context, parent, component)
                                ?: createDocument(
                                    context,
                                    parent,
                                    DocumentsContract.Document.MIME_TYPE_DIR,
                                    component,
                                )
                        }
                    } else {
                        throw SafStorageRequestException(
                            SafStorageFailureKind.MISSING,
                            "SAF content parent is absent",
                        )
                    }
        }
        val name = request.path.last()
        val document =
            findUniqueChild(context, parent, name)
                ?: if (create) {
                    synchronized(this) {
                        findUniqueChild(context, parent, name)
                            ?: createDocument(context, parent, MIME_BINARY, name)
                    }
                } else {
                    throw SafStorageRequestException(
                        SafStorageFailureKind.MISSING,
                        "SAF content file is absent",
                    )
                }
        val mode =
            when (request.access) {
                SafStorageAccess.READ_EXISTING -> "r"
                SafStorageAccess.READ_WRITE_EXISTING,
                SafStorageAccess.READ_WRITE_CREATE,
                -> "rw"
            }
        return requireNotNull(
            context.contentResolver.openFileDescriptor(document, mode, cancellation),
        ) { "provider refused a SAF descriptor" }
    }

    fun deleteDynamic(
        context: Context,
        treeUri: Uri,
        request: SafStorageRequest,
    ) {
        require(hasGrant(context, treeUri)) { "persisted SAF grant is unavailable" }
        require(request.role == SafDynamicFileRole.PART) {
            "only the boundary part file may be deleted dynamically"
        }
        require(request.path.isNotEmpty()) { "SAF request path is empty" }
        request.path.forEach(::requireValidComponent)
        var current = documentUri(treeUri)
        for (component in request.path) {
            current = findUniqueChild(context, current, component) ?: return
        }
        check(DocumentsContract.deleteDocument(context.contentResolver, current)) {
            "provider refused SAF part-file deletion"
        }
    }

    fun observeDynamic(
        context: Context,
        treeUri: Uri,
        request: SafStorageRequest,
    ): SafStorageObservation {
        require(hasGrant(context, treeUri)) { "persisted SAF grant is unavailable" }
        request.path.forEach(::requireValidComponent)
        var current = documentUri(treeUri)
        for (component in request.path) {
            current =
                findUniqueChild(context, current, component)
                    ?: return SafStorageObservation(false, null, null, null)
        }
        return observeDocument(context, current)
    }

    fun deleteData(
        context: Context,
        treeUri: Uri,
        plan: SafRemovalPlan,
    ) {
        require(hasGrant(context, treeUri)) { "persisted SAF grant is unavailable" }
        val root = documentUri(treeUri)
        deleteDataArtifacts(
            name = plan.name,
            torrentId = plan.torrentId,
            tree = plan.tree,
            files = plan.files.map { it.components },
            directories = plan.directories.map { it.components },
            root = root,
            find = { parent, name -> findUniqueChild(context, parent, name) },
            kind = { document -> observeDocument(context, document).kind!! },
            isEmptyDirectory = { document -> isEmptyDirectory(context, document) },
            delete = { document ->
                DocumentsContract.deleteDocument(context.contentResolver, document)
            },
        )
    }

    fun contentDocument(
        context: Context,
        treeUri: Uri,
        path: List<String>,
    ): Uri? {
        require(hasGrant(context, treeUri)) { "persisted SAF grant is unavailable" }
        require(path.isNotEmpty()) { "content path is empty" }
        path.forEach(::requireValidComponent)
        var current = documentUri(treeUri)
        for (component in path) {
            current = findUniqueChild(context, current, component) ?: return null
        }
        return current
    }

    /** The folder that holds [filePath]; the tree itself for a top-level file. */
    fun containingFolder(
        context: Context,
        treeUri: Uri,
        filePath: List<String>,
    ): Uri? {
        require(filePath.isNotEmpty()) { "content path is empty" }
        val parent = filePath.dropLast(1)
        if (parent.isEmpty()) {
            require(hasGrant(context, treeUri)) { "persisted SAF grant is unavailable" }
            return documentUri(treeUri)
        }
        return contentDocument(context, treeUri, parent)
    }

    fun treeLabel(
        context: Context,
        treeUri: Uri,
    ): String {
        require(hasGrant(context, treeUri)) { "persisted SAF grant is unavailable" }
        val document = documentUri(treeUri)
        return context.contentResolver
            .query(
                document,
                arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
                null,
                null,
                null,
            )?.use { cursor ->
                if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getString(0) else null
            }?.takeIf(String::isNotBlank)
            ?: "Download folder"
    }

    internal fun hasGrant(
        context: Context,
        treeUri: Uri,
    ): Boolean =
        context.contentResolver.persistedUriPermissions.any {
            it.uri == treeUri && it.isReadPermission && it.isWritePermission
        }

    /** Releases a tree grant whose registry identity is kept for repair. */
    internal fun releaseGrant(
        context: Context,
        treeUri: Uri,
    ): Boolean {
        if (!hasGrant(context, treeUri)) return false
        context.contentResolver.releasePersistableUriPermission(treeUri, GRANT_FLAGS)
        return true
    }

    internal fun releaseGrantIfUnregistered(
        context: Context,
        treeUri: Uri,
    ): Boolean {
        if (ProductSafRootRegistry.load(context).roots.any { it.treeUri == treeUri.toString() }) {
            return false
        }
        if (!hasGrant(context, treeUri)) return false
        context.contentResolver.releasePersistableUriPermission(treeUri, GRANT_FLAGS)
        return true
    }

    private fun requireValidComponent(component: String) {
        require(
            component.isNotEmpty() &&
                component != "." &&
                component != ".." &&
                component.length <= 255 &&
                component.none { it == '/' || it == '\\' || it == '\u0000' },
        ) { "invalid SAF path component" }
    }

    private fun createDocument(
        context: Context,
        parent: Uri,
        mime: String,
        name: String,
    ): Uri =
        requireNotNull(
            DocumentsContract.createDocument(
                context.contentResolver,
                parent,
                mime,
                name,
            ),
        ) { "provider refused SAF document $name" }

    private fun findUniqueChild(
        context: Context,
        parent: Uri,
        name: String,
    ): Uri? {
        val parentId = DocumentsContract.getDocumentId(parent)
        val children =
            DocumentsContract.buildChildDocumentsUriUsingTree(parent, parentId)
        var match: Uri? = null
        context.contentResolver
            .query(
                children,
                arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                ),
                null,
                null,
                null,
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    if (cursor.getString(1) != name) continue
                    if (match != null) {
                        throw SafStorageRequestException(
                            SafStorageFailureKind.NAME_COLLISION,
                            "provider returned duplicate child $name",
                        )
                    }
                    match =
                        DocumentsContract.buildDocumentUriUsingTree(
                            parent,
                            cursor.getString(0),
                        )
                }
            }
        return match
    }

    private fun observeDocument(
        context: Context,
        document: Uri,
    ): SafStorageObservation {
        val projection =
            arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            )
        return context.contentResolver.query(document, projection, null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) {
                return@use SafStorageObservation(false, null, null, null)
            }
            check(!cursor.moveToNext()) { "provider returned duplicate document observation" }
            cursor.moveToFirst()
            val documentId = cursor.getString(0)
            val mime = cursor.getString(1)
            val kind =
                when {
                    mime == DocumentsContract.Document.MIME_TYPE_DIR ->
                        SafStorageObjectKind.DIRECTORY
                    mime != null -> SafStorageObjectKind.FILE
                    else -> SafStorageObjectKind.OTHER
                }
            val length =
                if (kind == SafStorageObjectKind.FILE && !cursor.isNull(2)) {
                    cursor.getLong(2).takeIf { it >= 0 }?.toULong()
                } else {
                    null
                }
            val modified = if (cursor.isNull(3)) null else cursor.getLong(3)
            val tokenMaterial =
                listOf(
                    "saf-observation-v1",
                    documentId,
                    mime ?: "unknown",
                    length?.toString() ?: "unknown",
                    modified?.toString() ?: "unknown",
                ).joinToString("\u0000")
            val token =
                MessageDigest
                    .getInstance("SHA-256")
                    .digest(tokenMaterial.toByteArray(Charsets.UTF_8))
                    .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
            SafStorageObservation(true, kind, length, "saf-v1:$token")
        } ?: throw SafStorageRequestException(
            SafStorageFailureKind.PROVIDER_REFUSED,
            "provider refused SAF document observation",
        )
    }

    private fun isEmptyDirectory(
        context: Context,
        document: Uri,
    ): Boolean {
        val documentId = DocumentsContract.getDocumentId(document)
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(document, documentId)
        return context.contentResolver
            .query(
                children,
                arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID),
                null,
                null,
                null,
            )?.use { cursor -> !cursor.moveToFirst() }
            ?: throw SafStorageRequestException(
                SafStorageFailureKind.PROVIDER_REFUSED,
                "provider refused SAF directory enumeration",
            )
    }

    private fun documentUri(treeUri: Uri): Uri =
        DocumentsContract.buildDocumentUriUsingTree(
            treeUri,
            DocumentsContract.getTreeDocumentId(treeUri),
        )

    val GRANT_FLAGS: Int =
        Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    fun isDebuggable(context: Context): Boolean =
        context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

}

internal fun <T> deleteDataArtifacts(
    name: String,
    torrentId: String,
    tree: Boolean,
    files: List<List<String>>,
    directories: List<List<String>>,
    root: T,
    find: (T, String) -> T?,
    kind: (T) -> SafStorageObjectKind,
    isEmptyDirectory: (T) -> Boolean,
    delete: (T) -> Boolean,
) {
    val partName = ".$torrentId.rstorrent-parts"
    val content = find(root, name)
    val part = find(root, partName)
    part?.let {
        check(kind(it) == SafStorageObjectKind.FILE) {
            "SAF part artifact is not a file"
        }
    }
    content?.let {
        val expected = if (tree) SafStorageObjectKind.DIRECTORY else SafStorageObjectKind.FILE
        check(kind(it) == expected) { "SAF content has an unexpected type" }
    }

    fun resolve(contentRoot: T, components: List<String>): T? {
        var current = contentRoot
        for ((index, component) in components.withIndex()) {
            current = find(current, component) ?: return null
            if (index + 1 < components.size) {
                check(kind(current) == SafStorageObjectKind.DIRECTORY) {
                    "SAF content parent has an unexpected type"
                }
            }
        }
        return current
    }

    val payloadFiles =
        if (tree) {
            content?.let { contentRoot ->
                files.mapNotNull { components ->
                    resolve(contentRoot, components)?.also { document ->
                        check(kind(document) == SafStorageObjectKind.FILE) {
                            "SAF content leaf has an unexpected type"
                        }
                    }
                }
            }.orEmpty()
        } else {
            listOfNotNull(content)
        }
    val payloadDirectories =
        if (tree) {
            content?.let { contentRoot ->
                directories.mapNotNull { components ->
                    resolve(contentRoot, components)?.also { document ->
                        check(kind(document) == SafStorageObjectKind.DIRECTORY) {
                            "SAF content directory has an unexpected type"
                        }
                    }
                }
            }.orEmpty()
        } else {
            emptyList()
        }
    for (document in payloadFiles) {
        check(delete(document)) { "provider refused SAF content deletion" }
    }
    if (part != null) {
        check(delete(part)) { "provider refused SAF part-file deletion" }
    }
    for (directory in payloadDirectories) {
        if (isEmptyDirectory(directory)) {
            check(delete(directory)) { "provider refused empty SAF directory deletion" }
        }
    }
}
