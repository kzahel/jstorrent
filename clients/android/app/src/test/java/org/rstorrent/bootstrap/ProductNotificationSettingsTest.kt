package org.rstorrent.bootstrap

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ProductNotificationSettingsTest {
    @Test
    fun preferencesDefaultOnAndMapToTheirOwnedCategories() {
        val preferences = ProductNotificationPreferences()

        assertTrue(preferences.enabled(ProductNotificationCategory.DOWNLOAD_COMPLETE))
        assertTrue(preferences.enabled(ProductNotificationCategory.NEEDS_ATTENTION))
    }

    @Test
    fun successfulPersistencePrecedesTheLiveChange() {
        val current = ProductNotificationPreferences()
        var persistedBeforeReturn = false

        val result =
            persistNotificationPreference(
                current,
                ProductNotificationPreference.DOWNLOAD_COMPLETE,
                false,
            ) { preference, enabled ->
                assertEquals(ProductNotificationPreference.DOWNLOAD_COMPLETE, preference)
                assertFalse(enabled)
                persistedBeforeReturn = true
                true
            }

        assertTrue(persistedBeforeReturn)
        assertEquals(
            ProductNotificationPreferenceResult.Applied(current.copy(downloadComplete = false)),
            result,
        )
    }

    @Test
    fun failedPersistenceRetainsThePriorPolicy() {
        val current = ProductNotificationPreferences()

        val result =
            persistNotificationPreference(
                current,
                ProductNotificationPreference.NEEDS_ATTENTION,
                false,
            ) { _, _ -> false }

        assertSame(ProductNotificationPreferenceResult.Failed, result)
        assertTrue(current.needsAttention)
    }

    @Test
    fun duplicatePreferenceDoesNotWriteAgain() {
        val current = ProductNotificationPreferences(downloadComplete = false)
        var writes = 0

        val result =
            persistNotificationPreference(
                current,
                ProductNotificationPreference.DOWNLOAD_COMPLETE,
                false,
            ) { _, _ ->
                writes += 1
                true
            }

        assertEquals(0, writes)
        assertEquals(ProductNotificationPreferenceResult.Applied(current), result)
    }

    @Test
    fun notificationVisibilityAndInteractionAreIndependent() {
        val visible =
            NotificationEligibility(
                permissionGranted = true,
                appNotificationsEnabled = true,
                backgroundChannelEnabled = true,
                interactionLeaseCount = 0,
            )
        assertTrue(visible.backgroundNotificationVisible)
        assertFalse(visible.shouldStopOwner)

        val interactiveDenied = visible.copy(permissionGranted = false, interactionLeaseCount = 1)
        assertTrue(interactiveDenied.visibleOnly)
        assertFalse(interactiveDenied.shouldStopOwner)

        val unattendedDenied = interactiveDenied.copy(interactionLeaseCount = 0)
        assertTrue(unattendedDenied.shouldStopOwner)
    }

    @Test(expected = IllegalArgumentException::class)
    fun negativeInteractionLeaseCountIsRejected() {
        NotificationEligibility(
            permissionGranted = true,
            appNotificationsEnabled = true,
            backgroundChannelEnabled = true,
            interactionLeaseCount = -1,
        )
    }

    @Test
    fun replacedActivityStoppingAfterItsSuccessorStartsKeepsTheLease() {
        ProductInteractionRegistry.resetForTest()
        val observed = mutableListOf<Set<String>>()
        ProductInteractionRegistry.attach(observed::add)
        val original = Any()
        val relaunched = Any()

        ProductInteractionRegistry.setActivityVisible(original, true)
        ProductInteractionRegistry.setActivityVisible(relaunched, true)
        ProductInteractionRegistry.setActivityVisible(original, false)
        assertEquals(setOf(ProductEngineService.INTERACTION_ACTIVITY), observed.last())

        ProductInteractionRegistry.setActivityVisible(relaunched, false)
        assertEquals(emptySet<String>(), observed.last())
        ProductInteractionRegistry.resetForTest()
    }

    @Test
    fun activityVisibilityConvergesBeforeAndAfterServiceAttachment() {
        ProductInteractionRegistry.resetForTest()
        val observed = mutableListOf<Set<String>>()

        val activity = Any()
        ProductInteractionRegistry.setActivityVisible(activity, true)
        ProductInteractionRegistry.attach(observed::add)
        ProductInteractionRegistry.setLease("picker", true)
        ProductInteractionRegistry.setActivityVisible(activity, false)
        ProductInteractionRegistry.detach()
        ProductInteractionRegistry.setActivityVisible(activity, true)

        assertEquals(
            listOf(
                setOf(ProductEngineService.INTERACTION_ACTIVITY),
                setOf(ProductEngineService.INTERACTION_ACTIVITY, "picker"),
                setOf("picker"),
            ),
            observed,
        )
        ProductInteractionRegistry.resetForTest()
    }
}
