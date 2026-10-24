package org.rstorrent.bootstrap

import android.content.Context
import android.net.Uri
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.util.Base64

internal data class ProductSafRootGrant(
    val rootId: String,
    val label: String,
    val treeUri: String,
    val generation: Long,
)

internal enum class ProductSafRootOperationKind {
    ADD,
    REPAIR,
    SET_DEFAULT,
    REMOVE,
    // Stops using a root. The engine keeps a root torrents still use, so the
    // registry keeps its identity for repair and only the grant is released.
    DETACH,
}

internal data class ProductSafRootOperation(
    val kind: ProductSafRootOperationKind,
    val rootId: String,
    val label: String,
    val treeUri: String,
    val makeDefault: Boolean,
    val previous: ProductSafRootGrant? = null,
)

internal data class ProductSafRootRegistryState(
    val roots: List<ProductSafRootGrant> = emptyList(),
    val pending: ProductSafRootOperation? = null,
    val selectionCandidate: String? = null,
    val selectionRepairRootId: String? = null,
)

internal object ProductSafRootRegistryCodec {
    private const val VERSION = 1

    fun encode(state: ProductSafRootRegistryState): String {
        ProductSafRootRegistry.validate(state)
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { output ->
            output.writeInt(VERSION)
            output.writeInt(state.roots.size)
            state.roots.sortedBy(ProductSafRootGrant::rootId).forEach { output.writeGrant(it) }
            output.writeBoolean(state.pending != null)
            state.pending?.let { pending ->
                output.writeUTF(pending.kind.name)
                output.writeUTF(pending.rootId)
                output.writeUTF(pending.label)
                output.writeUTF(pending.treeUri)
                output.writeBoolean(pending.makeDefault)
                output.writeBoolean(pending.previous != null)
                pending.previous?.let { output.writeGrant(it) }
            }
            output.writeBoolean(state.selectionCandidate != null)
            state.selectionCandidate?.let(output::writeUTF)
            output.writeBoolean(state.selectionRepairRootId != null)
            state.selectionRepairRootId?.let(output::writeUTF)
        }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes.toByteArray())
    }

    fun decode(encoded: String): ProductSafRootRegistryState {
        require(encoded.length <= ProductSafRootRegistry.MAX_ENCODED_BYTES) {
            "SAF root registry exceeds its encoded bound"
        }
        val decoded = Base64.getUrlDecoder().decode(encoded)
        require(decoded.size <= ProductSafRootRegistry.MAX_ENCODED_BYTES) {
            "SAF root registry exceeds its decoded bound"
        }
        val state =
            DataInputStream(ByteArrayInputStream(decoded)).use { input ->
                require(input.readInt() == VERSION) { "unsupported SAF root registry version" }
                val count = input.readInt()
                require(count in 0..ProductSafRootRegistry.MAX_ROOTS) {
                    "invalid SAF root count"
                }
                val roots = List(count) { input.readGrant() }
                val pending =
                    if (input.readBoolean()) {
                        ProductSafRootOperation(
                            kind = ProductSafRootOperationKind.valueOf(input.readUTF()),
                            rootId = input.readUTF(),
                            label = input.readUTF(),
                            treeUri = input.readUTF(),
                            makeDefault = input.readBoolean(),
                            previous = if (input.readBoolean()) input.readGrant() else null,
                        )
                    } else {
                        null
                    }
                val candidate = if (input.readBoolean()) input.readUTF() else null
                val repairRootId = if (input.readBoolean()) input.readUTF() else null
                require(input.read() == -1) { "SAF root registry contains trailing data" }
                ProductSafRootRegistryState(roots, pending, candidate, repairRootId)
            }
        ProductSafRootRegistry.validate(state)
        return state
    }

    private fun DataOutputStream.writeGrant(grant: ProductSafRootGrant) {
        writeUTF(grant.rootId)
        writeUTF(grant.label)
        writeUTF(grant.treeUri)
        writeLong(grant.generation)
    }

    private fun DataInputStream.readGrant(): ProductSafRootGrant =
        ProductSafRootGrant(
            rootId = readUTF(),
            label = readUTF(),
            treeUri = readUTF(),
            generation = readLong(),
        )
}

internal object ProductSafRootRegistry {
    const val LEGACY_ROOT_ID = "downloads"
    const val MAX_ROOTS = 32
    const val MAX_ENCODED_BYTES = 256 * 1024
    private const val MAX_ROOT_ID_LENGTH = 128
    private const val MAX_LABEL_LENGTH = 256
    private const val MAX_URI_LENGTH = 16 * 1024
    private const val PREFERENCES = "product-saf"
    private const val REGISTRY = "root-registry-v1"
    private const val LEGACY_TREE_URI = "tree-uri"

    @Synchronized
    fun load(context: Context): ProductSafRootRegistryState {
        val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        val encoded = preferences.getString(REGISTRY, null)
        if (encoded != null) return ProductSafRootRegistryCodec.decode(encoded)
        val migrated = initialState(null, preferences.getString(LEGACY_TREE_URI, null))
        persist(context, migrated)
        return migrated
    }

    @Synchronized
    fun restoreLegacyBindings(context: Context, bindings: List<ProductSafRootGrant>) {
        val current = load(context)
        val merged = current.roots.toMutableList()
        for (binding in bindings) {
            // Current bindings and repairs always win. Grant health is checked by
            // the ordinary broker; a missing grant remains visible and repairable.
            if (merged.none { it.rootId == binding.rootId || it.treeUri == binding.treeUri } && merged.size < MAX_ROOTS) {
                merged.add(binding)
            }
        }
        persist(context, current.copy(roots = merged))
    }

    internal fun initialState(
        encodedRegistry: String?,
        legacyTreeUri: String?,
    ): ProductSafRootRegistryState =
        encodedRegistry?.let(ProductSafRootRegistryCodec::decode)
            ?: legacyTreeUri?.let { legacyUri ->
                ProductSafRootRegistryState(
                    roots =
                        listOf(
                            ProductSafRootGrant(
                                rootId = LEGACY_ROOT_ID,
                                label = "Downloads",
                                treeUri = legacyUri,
                                generation = 1,
                            ),
                        ),
                )
            } ?: ProductSafRootRegistryState()

    @Synchronized
    fun recordSelectionCandidate(
        context: Context,
        treeUri: Uri,
        repairRootId: String? = null,
    ) {
        require(ProductSafDocuments.hasGrant(context, treeUri)) {
            "selected SAF tree has no persisted read/write grant"
        }
        val current = load(context)
        repairRootId?.let { rootId ->
            require(current.roots.any { it.rootId == rootId }) { "SAF repair root is not registered" }
        }
        persist(
            context,
            current.copy(
                selectionCandidate = treeUri.toString(),
                selectionRepairRootId = repairRootId,
            ),
        )
    }

    fun selectionCandidate(context: Context): Uri? =
        load(context).selectionCandidate?.let(Uri::parse)

    @Synchronized
    fun beginSelection(
        context: Context,
        allocatedRootId: String,
        label: String,
    ): ProductSafRootOperation {
        val state = load(context)
        check(state.pending == null) { "another SAF root operation is pending" }
        check(state.selectionRepairRootId == null) { "SAF selection is a repair" }
        val treeUri = requireNotNull(state.selectionCandidate) { "no SAF selection is pending" }
        val selected = Uri.parse(treeUri)
        require(ProductSafDocuments.hasGrant(context, selected)) {
            "selected SAF tree grant is unavailable"
        }
        val existing = state.roots.singleOrNull { it.treeUri == treeUri }
        val operation =
            if (existing != null) {
                ProductSafRootOperation(
                    kind = ProductSafRootOperationKind.SET_DEFAULT,
                    rootId = existing.rootId,
                    label = existing.label,
                    treeUri = existing.treeUri,
                    makeDefault = true,
                )
            } else {
                check(state.roots.size < MAX_ROOTS) { "SAF root count exceeds $MAX_ROOTS" }
                val grant = ProductSafRootGrant(allocatedRootId, label, treeUri, generation = 1)
                val operation =
                    ProductSafRootOperation(
                        kind = ProductSafRootOperationKind.ADD,
                        rootId = grant.rootId,
                        label = grant.label,
                        treeUri = grant.treeUri,
                        makeDefault = true,
                    )
                persist(context, state.copy(roots = state.roots + grant, pending = operation))
                return operation
            }
        persist(context, state.copy(pending = operation))
        return operation
    }

    @Synchronized
    fun beginRepair(
        context: Context,
        rootId: String,
        treeUri: Uri,
        label: String,
    ): ProductSafRootOperation {
        require(ProductSafDocuments.hasGrant(context, treeUri)) {
            "selected SAF tree has no persisted read/write grant"
        }
        val state = load(context)
        check(state.pending == null) { "another SAF root operation is pending" }
        val previous = requireNotNull(state.roots.singleOrNull { it.rootId == rootId }) {
            "SAF root is not registered"
        }
        check(state.roots.none { it.rootId != rootId && it.treeUri == treeUri.toString() }) {
            "selected SAF tree is already registered"
        }
        val replacement =
            ProductSafRootGrant(
                rootId = rootId,
                label = label,
                treeUri = treeUri.toString(),
                generation = previous.generation + 1,
            )
        val operation =
            ProductSafRootOperation(
                kind = ProductSafRootOperationKind.REPAIR,
                rootId = rootId,
                label = label,
                treeUri = treeUri.toString(),
                makeDefault = false,
                previous = previous,
            )
        persist(
            context,
            state.copy(
                roots = state.roots.map { if (it.rootId == rootId) replacement else it },
                pending = operation,
                selectionCandidate = treeUri.toString(),
                selectionRepairRootId = rootId,
            ),
        )
        return operation
    }

    @Synchronized
    fun beginSetDefault(
        context: Context,
        rootId: String,
    ): ProductSafRootOperation {
        val state = load(context)
        check(state.pending == null) { "another SAF root operation is pending" }
        val root = requireNotNull(state.roots.singleOrNull { it.rootId == rootId }) {
            "SAF root is not registered"
        }
        val operation =
            ProductSafRootOperation(
                kind = ProductSafRootOperationKind.SET_DEFAULT,
                rootId = root.rootId,
                label = root.label,
                treeUri = root.treeUri,
                makeDefault = true,
            )
        persist(context, state.copy(pending = operation))
        return operation
    }

    @Synchronized
    fun beginRemoval(
        context: Context,
        rootId: String,
    ): ProductSafRootOperation {
        val state = load(context)
        check(state.pending == null) { "another SAF root operation is pending" }
        val root = requireNotNull(state.roots.singleOrNull { it.rootId == rootId }) {
            "SAF root is not registered"
        }
        val operation =
            ProductSafRootOperation(
                kind = ProductSafRootOperationKind.REMOVE,
                rootId = root.rootId,
                label = root.label,
                treeUri = root.treeUri,
                makeDefault = false,
                previous = root,
            )
        persist(context, state.copy(pending = operation))
        return operation
    }

    @Synchronized
    fun beginDetach(
        context: Context,
        rootId: String,
    ): ProductSafRootOperation {
        val state = load(context)
        check(state.pending == null) { "another SAF root operation is pending" }
        val root = requireNotNull(state.roots.singleOrNull { it.rootId == rootId }) {
            "SAF root is not registered"
        }
        val operation =
            ProductSafRootOperation(
                kind = ProductSafRootOperationKind.DETACH,
                rootId = root.rootId,
                label = root.label,
                treeUri = root.treeUri,
                makeDefault = false,
                previous = root,
            )
        persist(context, state.copy(pending = operation))
        return operation
    }

    /** Completes a detach, dropping the root's identity only when [removed]. */
    @Synchronized
    fun completeDetach(
        context: Context,
        removed: Boolean,
    ) {
        val state = load(context)
        val pending = requireNotNull(state.pending) { "no SAF operation is pending" }
        check(pending.kind == ProductSafRootOperationKind.DETACH) {
            "pending SAF operation is not a detach"
        }
        persist(
            context,
            state.copy(
                roots = if (removed) state.roots.filterNot { it.rootId == pending.rootId } else state.roots,
                pending = null,
            ),
        )
    }

    @Synchronized
    fun completePending(context: Context) {
        val state = load(context)
        val retainedRoots =
            if (state.pending?.kind == ProductSafRootOperationKind.REMOVE) {
                state.roots.filterNot { it.rootId == state.pending.rootId }
            } else {
                state.roots
            }
        persist(
            context,
            state.copy(
                roots = retainedRoots,
                pending = null,
                selectionCandidate = null,
                selectionRepairRootId = null,
            ),
        )
    }

    @Synchronized
    fun rollbackRepair(context: Context) {
        val state = load(context)
        val pending = requireNotNull(state.pending) { "no SAF operation is pending" }
        check(pending.kind == ProductSafRootOperationKind.REPAIR) {
            "pending SAF operation is not a repair"
        }
        val previous = requireNotNull(pending.previous) { "repair has no previous grant" }
        persist(
            context,
            state.copy(
                roots = state.roots.map { if (it.rootId == previous.rootId) previous else it },
                pending = null,
                selectionCandidate = null,
                selectionRepairRootId = null,
            ),
        )
    }

    @Synchronized
    fun rollbackAdd(context: Context) {
        val state = load(context)
        val pending = requireNotNull(state.pending) { "no SAF operation is pending" }
        check(pending.kind == ProductSafRootOperationKind.ADD) {
            "pending SAF operation is not an add"
        }
        persist(
            context,
            state.copy(
                roots = state.roots.filterNot { it.rootId == pending.rootId },
                pending = null,
                selectionCandidate = null,
                selectionRepairRootId = null,
            ),
        )
    }

    @Synchronized
    fun abandonPendingDefault(context: Context) {
        val state = load(context)
        check(state.pending?.kind == ProductSafRootOperationKind.SET_DEFAULT) {
            "pending SAF operation is not a default selection"
        }
        persist(
            context,
            state.copy(
                pending = null,
                selectionCandidate = null,
                selectionRepairRootId = null,
            ),
        )
    }

    @Synchronized
    fun abandonPendingRemoval(context: Context) {
        val state = load(context)
        check(
            state.pending?.kind == ProductSafRootOperationKind.REMOVE ||
                state.pending?.kind == ProductSafRootOperationKind.DETACH,
        ) {
            "pending SAF operation is not a removal"
        }
        persist(context, state.copy(pending = null))
    }

    fun treeForRoot(
        context: Context,
        rootId: String,
    ): Uri? =
        load(context)
            .roots
            .singleOrNull { it.rootId == rootId }
            ?.treeUri
            ?.let(Uri::parse)
            ?.takeIf { ProductSafDocuments.hasGrant(context, it) }

    @Synchronized
    fun clearForTest(context: Context) {
        check(ProductSafDocuments.isDebuggable(context)) { "SAF registry clearing is debug-only" }
        persist(context, ProductSafRootRegistryState())
    }

    @Synchronized
    fun clearCaptured(
        context: Context,
        captured: List<ProductSafRootGrant>,
    ) {
        val state = load(context)
        check(state.pending == null) { "cannot clear a pending SAF root operation" }
        check(state.selectionCandidate == null && state.selectionRepairRootId == null) {
            "cannot clear a pending SAF root selection"
        }
        check(state.roots.sortedBy(ProductSafRootGrant::rootId) == captured.sortedBy(ProductSafRootGrant::rootId)) {
            "captured SAF root registry differs from current state"
        }
        persist(context, ProductSafRootRegistryState())
    }

    internal fun validate(state: ProductSafRootRegistryState) {
        require(state.roots.size <= MAX_ROOTS) { "SAF root count exceeds $MAX_ROOTS" }
        require(state.roots.map(ProductSafRootGrant::rootId).distinct().size == state.roots.size) {
            "SAF root IDs are duplicated"
        }
        require(state.roots.map(ProductSafRootGrant::treeUri).distinct().size == state.roots.size) {
            "SAF tree URIs are duplicated"
        }
        state.roots.forEach(::validateGrant)
        state.pending?.let { pending ->
            validateRootId(pending.rootId)
            validateLabel(pending.label)
            validateUri(pending.treeUri)
            pending.previous?.let(::validateGrant)
            require(state.roots.any { it.rootId == pending.rootId }) {
                "pending SAF root is absent from the registry"
            }
        }
        state.selectionCandidate?.let(::validateUri)
        state.selectionRepairRootId?.let { rootId ->
            validateRootId(rootId)
            require(state.selectionCandidate != null) { "SAF repair selection has no candidate" }
            require(state.roots.any { it.rootId == rootId }) {
                "SAF repair selection root is absent"
            }
        }
    }

    private fun validateGrant(grant: ProductSafRootGrant) {
        validateRootId(grant.rootId)
        validateLabel(grant.label)
        validateUri(grant.treeUri)
        require(grant.generation > 0) { "SAF root generation must be positive" }
    }

    private fun validateRootId(rootId: String) {
        require(rootId.isNotBlank() && rootId.length <= MAX_ROOT_ID_LENGTH) {
            "invalid SAF root ID"
        }
    }

    private fun validateLabel(label: String) {
        require(label.isNotBlank() && label.length <= MAX_LABEL_LENGTH) {
            "invalid SAF root label"
        }
    }

    private fun validateUri(uri: String) {
        require(uri.isNotBlank() && uri.length <= MAX_URI_LENGTH && !uri.contains('\u0000')) {
            "invalid SAF tree URI"
        }
    }

    private fun persist(
        context: Context,
        state: ProductSafRootRegistryState,
    ) {
        check(
            context
                .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .putString(REGISTRY, ProductSafRootRegistryCodec.encode(state))
                .remove(LEGACY_TREE_URI)
                .commit(),
        ) { "could not synchronously persist the SAF root registry" }
    }
}
