package org.rstorrent.bootstrap

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.ServiceTestRule
import java.util.concurrent.TimeUnit
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LanguageActivityRecreationTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val serviceRule = ServiceTestRule.withTimeout(30, TimeUnit.SECONDS)
    @get:Rule val rules: RuleChain =
        RuleChain.outerRule(NotificationPermissionRule()).around(serviceRule).around(compose)

    @Test
    fun pickerRetainsNavigationAndLiveServiceAcrossLocaleRecreation() {
        val context: Context = ApplicationProvider.getApplicationContext()
        val originalLanguage = ProductAppLanguage.selected(context)
        val targetLocale = InstrumentationRegistry.getArguments().getString("locale") ?: "de"
        val targetName = Locale.forLanguageTag(targetLocale).let { it.getDisplayName(it) }
        val firstActivity = compose.activity
        compose.runOnUiThread { assertTrue(ProductAppLanguage.set(firstActivity, "en")) }
        val service = (serviceRule.bindService(Intent(context, ProductEngineService::class.java)) as ProductEngineService.LocalBinder).service
        var restoreBackground = false
        try {
            compose.waitUntil(30_000) { service.state.value.ready && service.state.value.productSummary != null }
            restoreBackground = service.state.value.lifecycle.backgroundDownloadsEnabled
            service.setBackgroundDownloadsEnabled(false)
            if (service.state.value.productSummary?.disclosureVersion == 0U) {
                service.acknowledgeProductDisclosure(false)
            }
            compose.waitUntil(10_000) {
                !service.state.value.lifecycle.backgroundDownloadsEnabled &&
                    (service.state.value.productSummary?.disclosureVersion ?: 0U) >= 1U
            }
            compose.onNodeWithContentDescription(context.getString(R.string.a11y_more_options)).performClick()
            compose.onNodeWithText(context.getString(R.string.settings_title)).performClick()
            compose.onNodeWithText(context.getString(R.string.settings_language)).performScrollTo().performClick()
            compose.onNodeWithText("English").performClick()
            val beforeChange = compose.activity
            compose.onNodeWithText(targetName).performClick()
            compose.waitUntil(10_000) {
                compose.activity !== beforeChange && ProductAppLanguage.selected(context) == targetLocale
            }
            compose.onNodeWithText(targetName).assertIsDisplayed()
            // Recreate again to distinguish a remembered override from a
            // one-off resource mutation, and verify the language page remains.
            compose.activityRule.scenario.recreate()
            compose.onNodeWithText(targetName).assertIsDisplayed()
            assertEquals(targetLocale, compose.activity.resources.configuration.locales[0].language)

            val afterRecreation = SystemClock.elapsedRealtime()
            compose.waitUntil(5_000) {
                SystemClock.elapsedRealtime() - afterRecreation > PRODUCT_LIFETIME_SETTLE_MILLIS + 100
            }
            assertTrue(service.state.value.ready)
            assertFalse(service.resourceSnapshotForTest().shutdownComplete)
            assertFalse(service.state.value.lifecycle.backgroundDownloadsEnabled)
        } finally {
            if (restoreBackground) service.setBackgroundDownloadsEnabled(true)
            val activity = compose.activity
            compose.runOnUiThread { ProductAppLanguage.set(activity, originalLanguage) }
        }
    }
}
