package org.rstorrent.bootstrap

import android.app.Notification
import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.Locale
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalizationInstrumentationTest {
    @Test
    fun pseudoLocalesExpandAndMirrorPackagedResources() {
        val english = localizedContext("en")
        val expanded = localizedContext("en-XA")
        val mirrored = localizedContext("ar-XB")

        val englishMessage = english.getString(R.string.file_selection_explanation)
        val expandedMessage = expanded.getString(R.string.file_selection_explanation)
        val mirroredMessage = mirrored.getString(R.string.file_selection_explanation)

        assertNotEquals(englishMessage, expandedMessage)
        assertNotEquals(englishMessage, mirroredMessage)
        assertTrue(expandedMessage.length > englishMessage.length)
        assertEquals(android.util.LayoutDirection.RTL, mirrored.resources.configuration.layoutDirection)
        assertFalse(expandedMessage.contains("file_selection_explanation"))
        assertFalse(mirroredMessage.contains("file_selection_explanation"))
    }

    @Test
    fun pluralsAndNotificationCopyUseTheCurrentConfiguration() {
        val english = localizedContext("en")
        val expanded = localizedContext("en-XA")
        val englishOne =
            english.resources.getQuantityString(
                R.plurals.notification_downloading_torrents,
                1,
                1,
            )
        val englishMany =
            english.resources.getQuantityString(
                R.plurals.notification_downloading_torrents,
                3,
                3,
            )
        assertNotEquals(englishOne, englishMany)

        val coordinator =
            AndroidNotificationCoordinator(
                expanded,
                MutableStateFlow(ProductState()),
            )
        val rates = expanded.productOngoingNotificationRates(ProductOngoingNotificationRates(2048UL, 0UL))
        val withRates = coordinator.ongoingNotification(expandedMany(expanded), rates)
        assertEquals(expandedMany(expanded), withRates.extras.getCharSequence(Notification.EXTRA_TITLE))
        assertEquals(rates, withRates.extras.getCharSequence(Notification.EXTRA_TEXT))

        val notification = coordinator.ongoingNotification(expanded.getString(R.string.notification_ready))
        assertEquals(
            expanded.getString(R.string.app_name),
            notification.extras.getCharSequence(Notification.EXTRA_TITLE),
        )
        assertEquals(
            expanded.getString(R.string.notification_ready),
            notification.extras.getCharSequence(Notification.EXTRA_TEXT),
        )
        assertNotEquals(
            english.getString(R.string.notification_ready),
            notification.extras.getCharSequence(Notification.EXTRA_TEXT),
        )
    }

    private fun expandedMany(context: Context): String =
        context.resources.getQuantityString(R.plurals.notification_downloading_torrents, 3, 3)

    private fun localizedContext(languageTag: String): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocales(LocaleList(Locale.forLanguageTag(languageTag)))
        return base.createConfigurationContext(configuration)
    }
}
