package org.rstorrent.bootstrap

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.rstorrent.session.uniffi.CatalogRecoveryReason
import org.rstorrent.session.uniffi.CatalogRecoveryStatus

class CatalogRecoveryTest {
    private fun status(
        reason: CatalogRecoveryReason,
        exportAvailable: Boolean = true,
    ) = CatalogRecoveryStatus(
        reason = reason,
        catalogVersion = 26U,
        supportedVersion = 27U,
        exportAvailable = exportAvailable,
        details = "catalog version: 26; supported version: 27; error: test",
    )

    @Test
    fun everyReasonHasItsOwnTitleAndBody() {
        val copies = CatalogRecoveryReason.entries.map(::catalogRecoveryCopy)
        assertEquals(copies.size, copies.map { it.title }.toSet().size)
        assertEquals(copies.size, copies.map { it.body }.toSet().size)
        assertEquals(
            CatalogRecoveryCopy(
                R.string.catalog_recovery_migration_failed_title,
                R.string.catalog_recovery_migration_failed_body,
            ),
            catalogRecoveryCopy(CatalogRecoveryReason.MIGRATION_FAILED),
        )
        assertEquals(
            CatalogRecoveryCopy(R.string.catalog_recovery_locked_title, R.string.catalog_recovery_locked_body),
            catalogRecoveryCopy(CatalogRecoveryReason.LOCKED),
        )
    }

    @Test
    fun readableCatalogOffersEveryActionInOrder() {
        for (reason in CatalogRecoveryReason.entries - CatalogRecoveryReason.LOCKED) {
            assertEquals(
                listOf(
                    CatalogRecoveryAction.CHECK_FOR_UPDATES,
                    CatalogRecoveryAction.EXPORT_TORRENT_LIST,
                    CatalogRecoveryAction.COPY_DETAILS,
                    CatalogRecoveryAction.REPORT_PROBLEM,
                    CatalogRecoveryAction.CLOSE,
                ),
                catalogRecoveryActions(status(reason)),
            )
        }
    }

    @Test
    fun exportAppearsOnlyWhenTheCatalogCanBeRead() {
        val actions = catalogRecoveryActions(status(CatalogRecoveryReason.UNREADABLE, exportAvailable = false))
        assertFalse(CatalogRecoveryAction.EXPORT_TORRENT_LIST in actions)
        assertEquals(
            listOf(
                CatalogRecoveryAction.CHECK_FOR_UPDATES,
                CatalogRecoveryAction.COPY_DETAILS,
                CatalogRecoveryAction.REPORT_PROBLEM,
                CatalogRecoveryAction.CLOSE,
            ),
            actions,
        )
    }

    @Test
    fun lockedCatalogOffersNeitherUpdateNorReport() {
        assertEquals(
            listOf(CatalogRecoveryAction.COPY_DETAILS, CatalogRecoveryAction.CLOSE),
            catalogRecoveryActions(status(CatalogRecoveryReason.LOCKED, exportAvailable = false)),
        )
    }

    @Test
    fun noReasonOffersToDiscardData() {
        val offered =
            CatalogRecoveryReason.entries.flatMap { reason ->
                listOf(true, false).flatMap { catalogRecoveryActions(status(reason, it)) }
            }.toSet()
        assertEquals(CatalogRecoveryAction.entries.toSet(), offered)
        assertEquals(
            setOf("CHECK_FOR_UPDATES", "EXPORT_TORRENT_LIST", "COPY_DETAILS", "REPORT_PROBLEM", "CLOSE"),
            CatalogRecoveryAction.entries.map { it.name }.toSet(),
        )
    }

    @Test
    fun storeListingTriesTheStoreAppThenTheWebPage() {
        assertEquals(
            listOf(
                "market://details?id=com.jstorrent.app",
                "https://play.google.com/store/apps/details?id=com.jstorrent.app",
            ),
            catalogRecoveryStoreUris("com.jstorrent.app"),
        )
    }

    @Test
    fun openFailureKeepsTheNativeMessage() {
        val failure = ProductCatalogOpenException(java.io.File("/profile"), IllegalStateException("database is locked"))
        assertEquals("database is locked", failure.message)
        assertEquals("database is locked", failure.detail)
        assertEquals("IllegalStateException", catalogOpenFailureDetail(IllegalStateException()))
        val native = org.rstorrent.bootstrap.uniffi.AndroidClientException.Failure("catalog version 30 is newer")
        assertEquals("catalog version 30 is newer", ProductCatalogOpenException(java.io.File("/p"), native).detail)
    }

    @Test
    fun exportWritesTheWholeBundle() {
        val output = ByteArrayOutputStream()
        var deleted = false
        val result =
            writeCatalogRecoveryExport(
                readBundle = { byteArrayOf(1, 2, 3) },
                openOutput = { output },
                deletePartial = { deleted = true },
            )
        assertEquals(CatalogRecoveryExportState.SAVED, result)
        assertArrayEquals(byteArrayOf(1, 2, 3), output.toByteArray())
        assertFalse(deleted)
    }

    @Test
    fun readFailureDeletesTheCreatedDocumentWithoutOpeningIt() {
        var opened = false
        var deleted = false
        val failures = mutableListOf<CatalogRecoveryExportState>()
        val result =
            writeCatalogRecoveryExport(
                readBundle = { throw IOException("catalog is too old") },
                openOutput = {
                    opened = true
                    ByteArrayOutputStream()
                },
                deletePartial = { deleted = true },
                onFailure = { state, _ -> failures += state },
            )
        assertEquals(CatalogRecoveryExportState.READ_FAILED, result)
        assertFalse(opened)
        assertTrue(deleted)
        assertEquals(listOf(CatalogRecoveryExportState.READ_FAILED), failures)
    }

    @Test
    fun writeFailureDeletesThePartialDocument() {
        var deleted = false
        val failing =
            object : OutputStream() {
                override fun write(b: Int) = throw IOException("disk full")
            }
        assertEquals(
            CatalogRecoveryExportState.WRITE_FAILED,
            writeCatalogRecoveryExport(
                readBundle = { byteArrayOf(1) },
                openOutput = { failing },
                deletePartial = { deleted = true },
            ),
        )
        assertTrue(deleted)

        deleted = false
        assertEquals(
            CatalogRecoveryExportState.WRITE_FAILED,
            writeCatalogRecoveryExport(
                readBundle = { byteArrayOf(1) },
                openOutput = { null },
                deletePartial = { deleted = true },
            ),
        )
        assertTrue(deleted)
    }

    @Test
    fun aFailedDeleteDoesNotHideTheResult() {
        assertEquals(
            CatalogRecoveryExportState.READ_FAILED,
            writeCatalogRecoveryExport(
                readBundle = { throw IOException() },
                openOutput = { ByteArrayOutputStream() },
                deletePartial = { throw SecurityException("revoked") },
            ),
        )
    }
}
