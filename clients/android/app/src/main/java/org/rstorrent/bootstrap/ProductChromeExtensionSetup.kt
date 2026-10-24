package org.rstorrent.bootstrap

/** Navigation coordinates setup; it never transports pairing authority. */
object ProductChromeExtensionSetup {
    const val HANDOFF_URL = "https://jstorrent.com/chrome-extension.html"

    enum class NotificationAction { NONE, REQUEST_PERMISSION, OPEN_SETTINGS }

    fun notificationAction(state: ProductNotificationState): NotificationAction =
        when {
            !state.permissionGranted -> NotificationAction.REQUEST_PERMISSION
            !state.eligibility.backgroundNotificationVisible -> NotificationAction.OPEN_SETTINGS
            else -> NotificationAction.NONE
        }

    fun acceptsLaunch(
        scheme: String?,
        host: String?,
        path: String?,
        query: String?,
        fragment: String?,
        port: Int,
        userInfo: String?,
    ): Boolean =
        scheme in setOf("jstorrent", "rstorrent") &&
            host == "chromeos-companion" &&
            path.isNullOrEmpty() && query == null && fragment == null &&
            port == -1 && userInfo == null
}
