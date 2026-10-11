package org.rstorrent.bootstrap

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import java.util.Locale
import org.junit.Assert.assertNotEquals
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.rstorrent.bootstrap.ui.AddTorrentDialog
import org.rstorrent.bootstrap.ui.ProductApp
import org.rstorrent.bootstrap.ui.ProductThemeMode

class LocalizationComposeTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var originalConfiguration: Configuration

    @Before
    fun rememberActivityConfiguration() {
        originalConfiguration = Configuration(compose.activity.resources.configuration)
    }

    @After
    @Suppress("DEPRECATION")
    fun restoreActivityConfiguration() {
        val resources = compose.activity.resources
        resources.updateConfiguration(originalConfiguration, resources.displayMetrics)
    }

    @Test
    fun expandedPseudoLocaleReachesLibraryAndDialogWithoutRawKeys() {
        val englishContext = localizedContext("en")
        val context = applyActivityLocale("en-XA")
        val title = context.getString(R.string.add_torrent_title)
        val browse = context.getString(R.string.action_browse_torrent)
        assertNotEquals(englishContext.getString(R.string.add_torrent_title), title)
        assertNotEquals(englishContext.getString(R.string.action_browse_torrent), browse)
        compose.setContent {
            localized(context) {
                AddTorrentDialog(
                    enabled = true,
                    onDismiss = {},
                    onAddMagnet = { _, _ -> },
                    onBrowse = {},
                )
            }
        }
        compose.onNodeWithText(title).assertExists()
        compose.onNodeWithText(browse).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("a11y_add_torrent").assertDoesNotExist()
    }

    @Test
    fun mirroredPseudoLocaleReachesDirectionAwareLibraryControls() {
        val context = applyActivityLocale("ar-XB")
        compose.setContent { localized(context) { product() } }

        compose
            .onNodeWithContentDescription(context.getString(R.string.a11y_more_options))
            .assertIsDisplayed()
        compose.onNodeWithText("a11y_more_options").assertDoesNotExist()
    }

    @androidx.compose.runtime.Composable
    private fun localized(
        context: Context,
        content: @androidx.compose.runtime.Composable () -> Unit,
    ) {
        CompositionLocalProvider(
            LocalContext provides context,
            LocalConfiguration provides context.resources.configuration,
        ) {
            content()
        }
    }

    @androidx.compose.runtime.Composable
    private fun product() {
        ProductApp(
            service = null,
            onSelectStorage = {},
            onBrowseTorrent = {},
            notificationsGranted = true,
            onRequestNotifications = {},
            onOpenNotificationSettings = {},
            themeMode = ProductThemeMode.LIGHT,
            dynamicColor = false,
            onThemeMode = {},
            onDynamicColor = {},
        )
    }

    private fun localizedContext(languageTag: String): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocales(LocaleList(Locale.forLanguageTag(languageTag)))
        return base.createConfigurationContext(configuration)
    }

    @Suppress("DEPRECATION")
    private fun applyActivityLocale(languageTag: String): Context {
        val resources = compose.activity.resources
        val configuration = Configuration(resources.configuration)
        configuration.setLocales(LocaleList(Locale.forLanguageTag(languageTag)))
        resources.updateConfiguration(configuration, resources.displayMetrics)
        return compose.activity
    }
}
