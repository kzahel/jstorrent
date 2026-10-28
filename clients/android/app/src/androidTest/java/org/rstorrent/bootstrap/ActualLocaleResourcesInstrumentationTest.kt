package org.rstorrent.bootstrap

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Real packaged resources; the matrix supplies the locale being qualified. */
@RunWith(AndroidJUnit4::class)
class ActualLocaleResourcesInstrumentationTest {
    @Test
    fun actualLocalePreservesDestructiveActionsAndNativeCountFormatting() {
        val tag = InstrumentationRegistry.getArguments().getString("locale") ?: "de"
        val base: Context = ApplicationProvider.getApplicationContext()
        assertTrue("Locale must be advertised and packaged: $tag", tag in ProductAppLanguage.available(base))
        val locale = Locale.forLanguageTag(tag)
        val target = localizedContext(base, locale)
        val english = localizedContext(base, Locale.ENGLISH)
        for (id in listOf(R.string.action_cancel, R.string.action_remove, R.string.action_delete_data, R.string.notification_ready)) {
            assertNotEquals("English fallback in $tag for $id", english.getString(id), target.getString(id))
        }
        assertNotEquals(target.getString(R.string.action_remove), target.getString(R.string.action_delete_data))
        for (count in listOf(0, 1, 2, 3, 4, 5, 11, 21, 101, 1_000_000)) {
            val raw = target.resources.getQuantityString(R.plurals.notification_downloading_torrents, count)
            val rendered = target.resources.getQuantityString(R.plurals.notification_downloading_torrents, count, count)
            val fallback = english.resources.getQuantityString(R.plurals.notification_downloading_torrents, count, count)
            assertEquals("Native formatting in $tag at $count", String.format(locale, raw, count), rendered)
            assertNotEquals("English plural fallback in $tag at $count", fallback, rendered)
            assertTrue("Missing count in $tag at $count", rendered.contains(String.format(locale, "%d", count)))
            assertFalse("Unformatted argument in $tag at $count", rendered.contains("%1\$d"))
        }
    }

    private fun localizedContext(base: Context, locale: Locale): Context {
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocales(LocaleList(locale))
        return base.createConfigurationContext(configuration)
    }
}
