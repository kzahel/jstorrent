package org.rstorrent.bootstrap

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.rstorrent.bootstrap.ui.CatalogRecoveryScreen
import org.rstorrent.bootstrap.ui.ProductThemeMode
import org.rstorrent.bootstrap.ui.RstorrentTheme
import org.rstorrent.session.uniffi.CatalogRecoveryReason
import org.rstorrent.session.uniffi.CatalogRecoveryStatus

/** Tactical 369: the recovery screen's copy, actions and details. */
class CatalogRecoveryScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private fun show(
        reason: CatalogRecoveryReason,
        exportAvailable: Boolean,
        exportState: CatalogRecoveryExportState = CatalogRecoveryExportState.IDLE,
        clicked: MutableList<CatalogRecoveryAction> = mutableListOf(),
    ) {
        compose.setContent {
            RstorrentTheme(mode = ProductThemeMode.LIGHT, dynamicColor = false) {
                CatalogRecoveryScreen(
                    status =
                        CatalogRecoveryStatus(
                            reason = reason,
                            catalogVersion = 26U,
                            supportedVersion = 27U,
                            exportAvailable = exportAvailable,
                            details = "catalog version: 26; supported version: 27; error: injected",
                        ),
                    exportState = exportState,
                    onCheckForUpdates = { clicked += CatalogRecoveryAction.CHECK_FOR_UPDATES },
                    onExportTorrentList = { clicked += CatalogRecoveryAction.EXPORT_TORRENT_LIST },
                    onCopyDetails = { clicked += CatalogRecoveryAction.COPY_DETAILS },
                    onReportProblem = { clicked += CatalogRecoveryAction.REPORT_PROBLEM },
                    onClose = { clicked += CatalogRecoveryAction.CLOSE },
                )
            }
        }
    }

    private fun string(id: Int): String = compose.activity.getString(id)

    @Test
    fun migrationFailureOffersEveryActionAndShowsDetails() {
        val clicked = mutableListOf<CatalogRecoveryAction>()
        show(CatalogRecoveryReason.MIGRATION_FAILED, exportAvailable = true, clicked = clicked)
        compose.onNodeWithText(string(R.string.catalog_recovery_migration_failed_title)).assertExists()
        compose.onNodeWithText(string(R.string.catalog_recovery_migration_failed_body)).assertExists()
        for (action in CatalogRecoveryAction.entries) {
            compose.onNodeWithTag("catalog-recovery-${action.name}").performScrollTo().performClick()
        }
        assertEquals(CatalogRecoveryAction.entries, clicked)
        compose.onNodeWithText(string(R.string.catalog_recovery_details_copied)).assertExists()
        compose.onNodeWithTag("catalog-recovery-details").assertDoesNotExist()
        compose.onNodeWithText(string(R.string.catalog_recovery_show_details)).performScrollTo().performClick()
        compose.onNodeWithTag("catalog-recovery-details").assertExists()
    }

    @Test
    fun lockedCatalogOnlyCopiesDetailsAndCloses() {
        show(CatalogRecoveryReason.LOCKED, exportAvailable = false)
        compose.onNodeWithText(string(R.string.catalog_recovery_locked_title)).assertExists()
        compose.onNodeWithTag("catalog-recovery-CHECK_FOR_UPDATES").assertDoesNotExist()
        compose.onNodeWithTag("catalog-recovery-EXPORT_TORRENT_LIST").assertDoesNotExist()
        compose.onNodeWithTag("catalog-recovery-REPORT_PROBLEM").assertDoesNotExist()
        compose.onNodeWithTag("catalog-recovery-COPY_DETAILS").assertExists()
        compose.onNodeWithTag("catalog-recovery-CLOSE").assertExists()
    }

    @Test
    fun exportInProgressDisablesExportAndReportsProgress() {
        show(
            CatalogRecoveryReason.NEWER_VERSION,
            exportAvailable = true,
            exportState = CatalogRecoveryExportState.EXPORTING,
        )
        compose.onNodeWithTag("catalog-recovery-EXPORT_TORRENT_LIST").assertIsNotEnabled()
        compose.onNodeWithText(string(R.string.torrent_list_exporting)).assertExists()
    }
}
