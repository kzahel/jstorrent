package org.rstorrent.bootstrap

import android.app.LocaleManager
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import android.os.LocaleList
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.Locale
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LanguageSelectionInstrumentationTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val targetLocale = InstrumentationRegistry.getArguments().getString("locale") ?: "de"

    @Test
    fun overrideAndSystemResetReachApplicationAndNotificationResources() {
        val original = ProductAppLanguage.selected(context)
        val coordinator = AndroidNotificationCoordinator(context, MutableStateFlow(ProductState()))
        try {
            select("en")
            await { context.getString(R.string.action_cancel) == "Cancel" }
            coordinator.initialize(0)
            val english = context.getString(R.string.notification_ready)

            select(targetLocale)
            val translated = resourcesFor(targetLocale)
            await { context.getString(R.string.notification_ready) == translated.getString(R.string.notification_ready) }
            assertEquals(targetLocale, ProductAppLanguage.selected(context))
            val requested = Locale.forLanguageTag(targetLocale)
            assertEquals(requested.language, Locale.getDefault().language)
            if (requested.country.isNotEmpty()) assertEquals(requested.country, Locale.getDefault().country)
            if (requested.script.isNotEmpty()) assertEquals(requested.script, Locale.getDefault().script)
            assertFalse(english == context.getString(R.string.notification_ready))
            // The existing coordinator must see the new locale, not a cached
            // application/service context selected when it was constructed.
            val notification = coordinator.ongoingNotification(context.getString(R.string.notification_ready))
            assertEquals(translated.getString(R.string.notification_ready), notification.extras.getString(Notification.EXTRA_TEXT))
            assertEquals(translated.getString(R.string.action_stop), notification.actions.single().title)
            coordinator.onLocaleChanged()
            val channel = context.getSystemService(NotificationManager::class.java)
                .getNotificationChannel(AndroidNotificationContract.BACKGROUND_CHANNEL_ID)
            assertEquals(translated.getString(R.string.notification_channel_background), channel.name)

            select("")
            assertEquals("", ProductAppLanguage.selected(context))
            val system = resourcesFor(Resources.getSystem().configuration.locales[0].toLanguageTag())
            await { context.getString(R.string.notification_ready) == system.getString(R.string.notification_ready) }
            assertEquals(Resources.getSystem().configuration.locales[0].language, Locale.getDefault().language)
        } finally {
            select(original)
            coordinator.onLocaleChanged()
        }
    }

    @Test
    @androidx.test.filters.SdkSuppress(minSdkVersion = 33)
    fun androidSystemAppLanguageAndPickerUseTheSameOwner() {
        assumeTrue(Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
        PlatformLanguageChecks(context, ::select, ::await).androidSystemAppLanguageAndPickerUseTheSameOwner(targetLocale)
    }

    @Test
    @androidx.test.filters.SdkSuppress(minSdkVersion = 33)
    fun legacyPreferenceHandsOffOnceWithoutReplacingPlatformSelection() {
        assumeTrue(Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
        PlatformLanguageChecks(context, ::select, ::await).legacyPreferenceHandsOffOnceWithoutReplacingPlatformSelection()
    }

    private fun select(tag: String) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            assertTrue(ProductAppLanguage.set(context, tag))
        }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
    }

    private fun resourcesFor(tag: String): Resources {
        val configuration = Configuration(context.resources.configuration)
        configuration.setLocales(LocaleList.forLanguageTags(tag))
        return context.createConfigurationContext(configuration).resources
    }

    private fun await(condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 5_000
        while (!condition() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(25)
        assertTrue("locale configuration did not converge", condition())
    }
}

/** Keep API-33 types out of methods JUnit reflects while discovering API-28 tests. */
@androidx.annotation.RequiresApi(33)
private class PlatformLanguageChecks(
    private val context: Context,
    private val select: (String) -> Unit,
    private val await: (() -> Boolean) -> Unit,
) {
    fun androidSystemAppLanguageAndPickerUseTheSameOwner(targetLocale: String) {
        val manager = context.getSystemService(LocaleManager::class.java)
        val original = manager.applicationLocales
        try {
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                manager.applicationLocales = LocaleList.forLanguageTags(targetLocale)
            }
            await { ProductAppLanguage.selected(context) == targetLocale }
            select("en")
            assertEquals("en", manager.applicationLocales[0].language)
            select("")
            assertTrue(manager.applicationLocales.isEmpty)
            // Clearing System must also clear an override no longer offered by
            // this build, rather than comparing only its displayed fallback.
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                manager.applicationLocales = LocaleList.forLanguageTags("zz")
            }
            select("")
            assertTrue(manager.applicationLocales.isEmpty)
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                manager.applicationLocales = original
            }
        }
    }

    fun legacyPreferenceHandsOffOnceWithoutReplacingPlatformSelection() {
        val manager = context.getSystemService(LocaleManager::class.java)
        val preferences = context.getSharedPreferences("product_appearance", Context.MODE_PRIVATE)
        val originalLocales = manager.applicationLocales
        val originalLegacy = preferences.getString("language_tag", null)
        try {
            assertTrue(preferences.edit().putString("language_tag", "de").putBoolean("unrelated_handoff_test", true).commit())
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                manager.applicationLocales = LocaleList.getEmptyLocaleList()
                assertTrue(ProductAppLanguage.handoffLegacyPreference(context))
            }
            assertEquals("de", manager.applicationLocales[0].language)
            assertFalse(preferences.contains("language_tag"))
            assertTrue(preferences.getBoolean("unrelated_handoff_test", false))

            select("")
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                assertTrue(ProductAppLanguage.handoffLegacyPreference(context))
            }
            assertTrue(manager.applicationLocales.isEmpty)

            assertTrue(preferences.edit().putString("language_tag", "de").commit())
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                manager.applicationLocales = LocaleList.forLanguageTags("en")
                assertTrue(ProductAppLanguage.handoffLegacyPreference(context))
            }
            assertEquals("en", manager.applicationLocales[0].language)
            assertFalse(preferences.contains("language_tag"))
        } finally {
            val editor = preferences.edit().remove("unrelated_handoff_test")
            if (originalLegacy == null) editor.remove("language_tag") else editor.putString("language_tag", originalLegacy)
            assertTrue(editor.commit())
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                manager.applicationLocales = originalLocales
            }
        }
    }

}
