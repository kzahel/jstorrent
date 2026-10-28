package org.rstorrent.bootstrap

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FrenchLocalizationInstrumentationTest {
    @Test
    fun frenchResourcesPreservePluralAndDestructiveMeanings() {
        val base: Context = ApplicationProvider.getApplicationContext()
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocales(LocaleList(Locale.FRENCH))
        val french = base.createConfigurationContext(configuration)
        assertEquals("Annuler", french.getString(R.string.action_cancel))
        assertEquals("Retirer", french.getString(R.string.action_remove))
        assertEquals("Supprimer les données", french.getString(R.string.action_delete_data))
        assertNotEquals(french.getString(R.string.action_remove), french.getString(R.string.action_delete_data))
        for (count in listOf(0, 1, 2, 1_000_000)) {
            val noun = if (count <= 1) "torrent" else "torrents"
            assertEquals(
                "Téléchargement de $count $noun",
                french.resources.getQuantityString(R.plurals.notification_downloading_torrents, count, count),
            )
        }
    }
}
