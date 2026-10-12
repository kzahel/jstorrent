package org.rstorrent.bootstrap

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProductChromeExtensionSetupTest {
    private fun accepts(
        scheme: String = "jstorrent",
        host: String = "chromeos-companion",
        path: String? = "",
        query: String? = null,
        fragment: String? = null,
        port: Int = -1,
        userInfo: String? = null,
    ) = ProductChromeExtensionSetup.acceptsLaunch(scheme, host, path, query, fragment, port, userInfo)

    @Test
    fun productionAndLegacyLinksBothEnterSetup() {
        assertTrue(accepts())
        assertTrue(accepts(scheme = "rstorrent"))
    }

    @Test
    fun externalLinksCannotSmuggleSetupParametersOrAuthority() {
        assertFalse(accepts(scheme = "https"))
        assertFalse(accepts(host = "other"))
        assertFalse(accepts(path = "/pair"))
        assertFalse(accepts(query = "credential=untrusted"))
        assertFalse(accepts(fragment = "token"))
        assertFalse(accepts(port = 3030))
        assertFalse(accepts(userInfo = "user"))
    }

    @Test
    fun browserReturnRequiresTheExistingNotificationEligibility() {
        val state = ProductNotificationState(permissionGranted = true)
        val none = ProductChromeExtensionSetup.NotificationAction.NONE
        val permission = ProductChromeExtensionSetup.NotificationAction.REQUEST_PERMISSION
        val settings = ProductChromeExtensionSetup.NotificationAction.OPEN_SETTINGS
        org.junit.Assert.assertEquals(none, ProductChromeExtensionSetup.notificationAction(state))
        org.junit.Assert.assertEquals(permission, ProductChromeExtensionSetup.notificationAction(state.copy(permissionGranted = false)))
        org.junit.Assert.assertEquals(settings, ProductChromeExtensionSetup.notificationAction(state.copy(appNotificationsEnabled = false)))
        org.junit.Assert.assertEquals(settings, ProductChromeExtensionSetup.notificationAction(state.copy(backgroundChannelEnabled = false)))
    }
}
