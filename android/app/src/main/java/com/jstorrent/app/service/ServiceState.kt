package com.jstorrent.app.service

/**
 * Service lifecycle states for ForegroundNotificationService.
 */
enum class ServiceState {
    /** Service is not running */
    STOPPED,

    /** Service is running normally */
    RUNNING,

    /** Service is paused due to WiFi-only mode (cellular detected) */
    PAUSED_WIFI
}
