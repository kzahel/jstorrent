package org.rstorrent.bootstrap

import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.rule.ServiceTestRule
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith
import org.rstorrent.session.uniffi.ListenerPolicy
import org.rstorrent.session.uniffi.PortMappingPolicy

@RunWith(AndroidJUnit4::class)
class ProductDataResetInstrumentationTest {
    private val permissionRule = NotificationPermissionRule()
    private val serviceRule = ServiceTestRule.withTimeout(30, TimeUnit.SECONDS)

    @get:Rule
    val rules: TestRule = RuleChain.outerRule(permissionRule).around(serviceRule)

    @Test
    fun resetPreservesProfileAndClearKeepRestartsFreshApplication() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val appearance = context.getSharedPreferences("product_ui", Context.MODE_PRIVATE)
        val sentinel = File(context.filesDir, "data-reset-unrelated-sentinel")
        prepareFreshFixture(context, appearance, sentinel)
        ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, true)
        context.startForegroundService(Intent(context, ProductEngineService::class.java))
        val binder: IBinder =
            serviceRule.bindService(Intent(context, ProductEngineService::class.java))
        val service = (binder as ProductEngineService.LocalBinder).service

        try {
            withTimeout(30_000L) {
                service.state.first {
                    it.ready && it.clientSettings != null && it.storage?.roots?.isEmpty() == true
                }
            }
            service.setShowFileSelection(false)
            withTimeout(10_000L) {
                service.state.first { it.storage?.showFileSelection == false }
            }

            service.updateClientSettings(
                clientSettingsPatch(
                    listener = ListenerPolicy.Disabled,
                    portMapping = PortMappingPolicy.DISABLED,
                    dhtEnabled = false,
                    peerExchangeEnabled = false,
                ),
            )
            withTimeout(30_000L) {
                service.state.first {
                    val configured = it.clientSettings?.configured
                    configured?.listener == ListenerPolicy.Disabled &&
                        configured.portMapping == PortMappingPolicy.DISABLED &&
                        !configured.dhtEnabled &&
                        !configured.peerExchangeEnabled
                }
            }

            service.resetClientSettings()
            val reset =
                withTimeout(30_000L) {
                    service.state.first {
                        val settings = it.clientSettings
                        settings != null &&
                            settings.configured.listener ==
                            ListenerPolicy.AutomaticLocalNetwork &&
                            settings.configured.portMapping == PortMappingPolicy.UPNP &&
                            settings.configured.dhtEnabled &&
                            settings.configured.peerExchangeEnabled
                    }
                }
            assertTrue(reset.torrents.isEmpty())
            assertTrue(reset.storage?.roots?.isEmpty() == true)
            assertEquals(false, reset.storage?.showFileSelection)
            assertEquals("dark", appearance.getString("theme_mode", null))
            assertFalse(appearance.getBoolean("dynamic_color", true))

            installNonDefaultProductPreferences(context)
            service.clearAllData(deleteDownloadedFiles = false)
            val complete =
                withTimeout(60_000L) {
                    service.state.first { it.dataReset?.complete == true }
                }
            assertFalse(requireNotNull(complete.dataReset).deleteDataRequested)
            assertFalse(complete.dataReset.downgradedToKeep)
            assertTrue(complete.ready)
            assertTrue(complete.torrents.isEmpty())
            assertTrue(requireNotNull(complete.storage).roots.isEmpty())
            assertNull(complete.storage.defaultRoot)
            assertTrue(complete.storage.showAddOptions)
            assertTrue(complete.storage.showFileSelection)
            assertNull(ProductDataResetJournalStore.load(context))
            assertTrue(ProductSafRootRegistry.load(context).roots.isEmpty())
            assertEquals(ProductLifecyclePreferences(), ProductLifecyclePreferenceStore(context).read())
            assertFalse(ProductNetworkPreference.read(context))
            assertTrue(ProductPowerPreference.read(context))
            assertEquals(SharePeerHintChoice.ASK, SharePeerHintPreference.read(context))
            assertFalse(ProductCompanionPreference.read(context))
            assertFalse(ProductDataSyncQuotaFence.isExhausted(context))
            assertEquals(ProductNotificationPreferences(), ProductNotificationPreferenceStore(context).read())
            assertEquals("dark", appearance.getString("theme_mode", null))
            assertFalse(appearance.getBoolean("dynamic_color", true))
            assertEquals("preserve", sentinel.readText())
            assertTrue(File(context.filesDir, ProductPrivateProfileReset.PROFILE_DIRECTORY).isDirectory)
        } finally {
            ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, false)
            service.shutdownFromUi()
            awaitShutdown(service)
            context.stopService(Intent(context, ProductEngineService::class.java))
            ProductInteractionRegistry.resetForTest()
            ProductDataResetJournalStore.clear(context)
            ProductSafRootRegistry.clearForTest(context)
            ProductPrivateProfileReset.reset(context.filesDir)
            sentinel.delete()
            appearance.edit().clear().commit()
        }
    }

    @Test
    fun startupResumesPersistedProfileResetBeforeOpeningApplication() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val appearance = context.getSharedPreferences("product_ui", Context.MODE_PRIVATE)
        val sentinel = File(context.filesDir, "data-reset-recovery-sentinel")
        prepareFreshFixture(context, appearance, sentinel)
        installNonDefaultProductPreferences(context)
        val profile = File(context.filesDir, ProductPrivateProfileReset.PROFILE_DIRECTORY)
        assertTrue(profile.mkdirs() || profile.isDirectory)
        val staleProfileFile = File(profile, "stale-profile-state")
        staleProfileFile.writeText("remove")
        val journal =
            ProductDataResetJournal.capture(
                deleteData = false,
                torrentIds = emptyList(),
                roots = emptyList(),
            ).copy(phase = ProductDataResetPhase.RESETTING_PROFILE)
        ProductDataResetJournalStore.persist(context, journal)
        ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, true)
        context.startForegroundService(Intent(context, ProductEngineService::class.java))
        val binder: IBinder =
            serviceRule.bindService(Intent(context, ProductEngineService::class.java))
        val service = (binder as ProductEngineService.LocalBinder).service

        try {
            val complete =
                withTimeout(60_000L) {
                    service.state.first { it.dataReset?.complete == true }
                }
            assertTrue(complete.ready)
            assertTrue(complete.torrents.isEmpty())
            assertTrue(requireNotNull(complete.storage).roots.isEmpty())
            assertFalse(staleProfileFile.exists())
            assertNull(ProductDataResetJournalStore.load(context))
            assertEquals(ProductLifecyclePreferences(), ProductLifecyclePreferenceStore(context).read())
            assertFalse(ProductNetworkPreference.read(context))
            assertTrue(ProductPowerPreference.read(context))
            assertEquals(SharePeerHintChoice.ASK, SharePeerHintPreference.read(context))
            assertFalse(ProductCompanionPreference.read(context))
            assertFalse(ProductDataSyncQuotaFence.isExhausted(context))
            assertEquals(ProductNotificationPreferences(), ProductNotificationPreferenceStore(context).read())
            assertEquals("dark", appearance.getString("theme_mode", null))
            assertFalse(appearance.getBoolean("dynamic_color", true))
            assertEquals("preserve", sentinel.readText())
        } finally {
            ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, false)
            service.shutdownFromUi()
            awaitShutdown(service)
            context.stopService(Intent(context, ProductEngineService::class.java))
            ProductInteractionRegistry.resetForTest()
            ProductDataResetJournalStore.clear(context)
            ProductSafRootRegistry.clearForTest(context)
            ProductPrivateProfileReset.reset(context.filesDir)
            sentinel.delete()
            appearance.edit().clear().commit()
        }
    }

    private fun prepareFreshFixture(
        context: Context,
        appearance: android.content.SharedPreferences,
        sentinel: File,
    ) {
        context.stopService(Intent(context, ProductEngineService::class.java))
        ProductInteractionRegistry.resetForTest()
        ProductDataResetJournalStore.clear(context)
        ProductPrivateProfileReset.reset(context.filesDir)
        ProductSafRootRegistry.clearForTest(context)
        ProductLifecyclePreferenceStore(context).reset()
        ProductNetworkPreference.reset(context)
        ProductPowerPreference.reset(context)
        SharePeerHintPreference.reset(context)
        ProductCompanionPreference.reset(context)
        ProductNotificationPreferenceStore(context).reset()
        ProductDataSyncQuotaFence.clearForUserVisibleStart(context)
        appearance.edit().putString("theme_mode", "dark").putBoolean("dynamic_color", false).commit()
        sentinel.writeText("preserve")
    }

    private fun installNonDefaultProductPreferences(context: Context) {
        assertTrue(
            ProductLifecyclePreferenceStore(context).write(
                ProductLifecyclePreferences(
                    backgroundDownloadsEnabled = true,
                    completionPolicy = ProductBackgroundCompletionPolicy.KEEP_SEEDING,
                ),
            ),
        )
        assertTrue(ProductNetworkPreference.persist(context, true))
        assertTrue(ProductPowerPreference.persist(context, false))
        assertTrue(SharePeerHintPreference.persist(context, SharePeerHintChoice.INCLUDE))
        ProductCompanionPreference.enable(context)
        assertTrue(
            ProductNotificationPreferenceStore(context).write(
                ProductNotificationPreference.DOWNLOAD_COMPLETE,
                false,
            ),
        )
        assertTrue(
            ProductNotificationPreferenceStore(context).write(
                ProductNotificationPreference.NEEDS_ATTENTION,
                false,
            ),
        )
        assertTrue(ProductDataSyncQuotaFence.markExhausted(context))
    }

    private fun awaitShutdown(service: ProductEngineService) {
        val deadline = SystemClock.elapsedRealtime() + 30_000L
        while (
            !service.resourceSnapshotForTest().shutdownComplete &&
                SystemClock.elapsedRealtime() < deadline
        ) {
            SystemClock.sleep(25L)
        }
        assertTrue(service.resourceSnapshotForTest().shutdownComplete)
    }
}
