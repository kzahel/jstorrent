package org.rstorrent.bootstrap

import android.content.Context
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.rstorrent.bootstrap.ui.ProductThemeMode
import org.rstorrent.bootstrap.ui.RateLimitSetting
import org.rstorrent.bootstrap.ui.RstorrentTheme
import org.rstorrent.session.uniffi.TransferRateLimit

class SettingsDraftRestorationTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun customRateDialogAndUnappliedDecimalSurviveStateRestoration() {
        val context: Context = ApplicationProvider.getApplicationContext()
        val restoration = StateRestorationTester(compose)
        var applied: TransferRateLimit? = null
        restoration.setContent {
            RstorrentTheme(ProductThemeMode.LIGHT, dynamicColor = false) {
                RateLimitSetting(
                    title = context.getString(R.string.setting_download),
                    configured = TransferRateLimit.Limited(1536U),
                    effective = null,
                    application = null,
                    onValue = { applied = it },
                )
            }
        }
        compose.onNodeWithText(context.getString(R.string.setting_download)).performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("7,5")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("7,5").assertExists()
        assertEquals(null, applied)
        compose.onNodeWithText(context.getString(R.string.action_apply)).performClick()
        assertEquals(TransferRateLimit.Limited(7680U), applied)
    }
}
