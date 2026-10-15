package org.rstorrent.bootstrap

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.io.File
import java.io.FileNotFoundException
import java.io.OutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.rstorrent.bootstrap.uniffi.AndroidClientException
import org.rstorrent.bootstrap.uniffi.exportTorrentListReadOnly
import org.rstorrent.session.uniffi.CatalogRecoveryReason
import org.rstorrent.session.uniffi.CatalogRecoveryStatus

/*
 * Tactical 369: when the torrent catalog does not open, the activity shows a
 * recovery screen instead of the library. Nothing here opens the catalog for
 * writing or offers to discard it.
 */

/**
 * The native client did not open the profile in [profile]. Keeps the cause's
 * message so the generic error text is unchanged.
 */
internal class ProductCatalogOpenException(
    val profile: File,
    cause: Throwable,
) : Exception(cause.message, cause) {
    /** The open error, for classification and the details text. */
    val detail: String = catalogOpenFailureDetail(cause)
}

/** The native error's own text, without the binding's `detail=` wrapper. */
internal fun catalogOpenFailureDetail(cause: Throwable): String =
    (cause as? AndroidClientException.Failure)?.detail?.takeIf(String::isNotBlank)
        ?: cause.message?.takeIf(String::isNotBlank)
        ?: cause.javaClass.simpleName

/** Actions on the recovery screen, in display order. None resets or clears data. */
enum class CatalogRecoveryAction {
    CHECK_FOR_UPDATES,
    EXPORT_TORRENT_LIST,
    COPY_DETAILS,
    REPORT_PROBLEM,
    CLOSE,
}

internal data class CatalogRecoveryCopy(
    @StringRes val title: Int,
    @StringRes val body: Int,
)

internal fun catalogRecoveryCopy(reason: CatalogRecoveryReason): CatalogRecoveryCopy =
    when (reason) {
        CatalogRecoveryReason.MIGRATION_FAILED ->
            CatalogRecoveryCopy(
                R.string.catalog_recovery_migration_failed_title,
                R.string.catalog_recovery_migration_failed_body,
            )
        CatalogRecoveryReason.NEWER_VERSION ->
            CatalogRecoveryCopy(
                R.string.catalog_recovery_newer_version_title,
                R.string.catalog_recovery_newer_version_body,
            )
        CatalogRecoveryReason.RETIRED_VERSION ->
            CatalogRecoveryCopy(
                R.string.catalog_recovery_retired_version_title,
                R.string.catalog_recovery_retired_version_body,
            )
        CatalogRecoveryReason.LOCKED ->
            CatalogRecoveryCopy(
                R.string.catalog_recovery_locked_title,
                R.string.catalog_recovery_locked_body,
            )
        CatalogRecoveryReason.UNREADABLE ->
            CatalogRecoveryCopy(
                R.string.catalog_recovery_unreadable_title,
                R.string.catalog_recovery_unreadable_body,
            )
    }

/**
 * A locked catalog only needs the other copy closed, so it offers neither an
 * update nor a report. Export appears only when the catalog can be read.
 */
internal fun catalogRecoveryActions(status: CatalogRecoveryStatus): List<CatalogRecoveryAction> {
    val locked = status.reason == CatalogRecoveryReason.LOCKED
    return buildList {
        if (!locked) add(CatalogRecoveryAction.CHECK_FOR_UPDATES)
        if (status.exportAvailable) add(CatalogRecoveryAction.EXPORT_TORRENT_LIST)
        add(CatalogRecoveryAction.COPY_DETAILS)
        if (!locked) add(CatalogRecoveryAction.REPORT_PROBLEM)
        add(CatalogRecoveryAction.CLOSE)
    }
}

/** The Play listing for this app, the store app first and the web page as fallback. */
internal fun catalogRecoveryStoreUris(packageName: String): List<String> =
    listOf(
        "market://details?id=$packageName",
        "https://play.google.com/store/apps/details?id=$packageName",
    )

enum class CatalogRecoveryExportState {
    IDLE,
    EXPORTING,
    SAVED,
    READ_FAILED,
    WRITE_FAILED,
}

/**
 * Reads the bundle, then writes it to the document the user created. A
 * document that did not receive a whole bundle is deleted.
 */
internal fun writeCatalogRecoveryExport(
    readBundle: () -> ByteArray,
    openOutput: () -> OutputStream?,
    deletePartial: () -> Unit,
    onFailure: (CatalogRecoveryExportState, Throwable) -> Unit = { _, _ -> },
): CatalogRecoveryExportState {
    val bundle =
        try {
            readBundle()
        } catch (error: Exception) {
            onFailure(CatalogRecoveryExportState.READ_FAILED, error)
            runCatching(deletePartial)
            return CatalogRecoveryExportState.READ_FAILED
        }
    try {
        val output = openOutput() ?: throw FileNotFoundException("document output is unavailable")
        output.use { it.write(bundle) }
    } catch (error: Exception) {
        onFailure(CatalogRecoveryExportState.WRITE_FAILED, error)
        runCatching(deletePartial)
        return CatalogRecoveryExportState.WRITE_FAILED
    }
    return CatalogRecoveryExportState.SAVED
}

/**
 * Owns recovery mode for one activity, across configuration changes. Once
 * entered, the activity stops starting the engine service until it is
 * recreated from scratch, so returning from the file picker or the store
 * does not reopen the catalog.
 */
class CatalogRecoveryModel : ViewModel() {
    private val mutableStatus = MutableStateFlow<CatalogRecoveryStatus?>(null)
    val status: StateFlow<CatalogRecoveryStatus?> = mutableStatus.asStateFlow()

    private val mutableExport = MutableStateFlow(CatalogRecoveryExportState.IDLE)
    val export: StateFlow<CatalogRecoveryExportState> = mutableExport.asStateFlow()

    val active: Boolean
        get() = mutableStatus.value != null

    fun enter(status: CatalogRecoveryStatus) {
        mutableStatus.value = status
    }

    /**
     * Exports from a private copy of the catalog; the engine client is never
     * opened. The blocking work is not interrupted by cancellation, so a
     * started export finishes or removes its document.
     */
    fun export(
        contentResolver: ContentResolver,
        destination: Uri,
        profilePath: String,
    ) {
        val deletePartial = {
            DocumentsContract.deleteDocument(contentResolver, destination)
            Unit
        }
        if (mutableExport.value == CatalogRecoveryExportState.EXPORTING) {
            runCatching(deletePartial)
            return
        }
        mutableExport.value = CatalogRecoveryExportState.EXPORTING
        viewModelScope.launch {
            val result =
                withContext(Dispatchers.IO) {
                    writeCatalogRecoveryExport(
                        readBundle = { exportTorrentListReadOnly(profilePath) },
                        openOutput = { contentResolver.openOutputStream(destination, "w") },
                        deletePartial = deletePartial,
                        onFailure = { state, error ->
                            Log.w(TAG, "catalog_recovery_export_failed state=${state.name}", error)
                        },
                    )
                }
            if (result == CatalogRecoveryExportState.SAVED) Log.i(TAG, "catalog_recovery_exported")
            mutableExport.value = result
        }
    }

    private companion object {
        const val TAG = "RSTorrentProduct"
    }
}
