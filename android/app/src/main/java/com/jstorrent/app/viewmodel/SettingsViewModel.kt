package com.jstorrent.app.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.jstorrent.app.JSTorrentApplication
import com.jstorrent.app.service.ForegroundNotificationService
import com.jstorrent.app.settings.SettingsStore
import com.jstorrent.app.storage.DownloadRoot
import com.jstorrent.app.storage.RootStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * UI state for the settings screen.
 */
data class SettingsUiState(
    // Storage
    val downloadRoots: List<DownloadRoot> = emptyList(),
    val defaultRootKey: String? = null,
    val showClearConfirmation: Boolean = false,
    // Bandwidth
    val downloadSpeedLimit: Int = 0,
    val uploadSpeedLimit: Int = 0,
    // Behavior
    val whenDownloadsComplete: String = "stop_and_close",
    // Network
    val wifiOnlyEnabled: Boolean = false,
    val dhtEnabled: Boolean = true,
    val pexEnabled: Boolean = true,
    val encryptionPolicy: String = "allow",
    // Power Management
    val backgroundDownloadsEnabled: Boolean = false,
    // Notifications
    val notificationPermissionGranted: Boolean = false,
    val canRequestNotificationPermission: Boolean = true,
    val showNotificationRequiredDialog: Boolean = false
)

/**
 * ViewModel for the settings screen.
 * Manages storage roots and app settings.
 */
class SettingsViewModel(
    private val app: JSTorrentApplication,
    private val rootStore: RootStore,
    private val settingsStore: SettingsStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        refreshAllSettings()
    }

    /**
     * Refresh all settings from stores.
     */
    fun refreshAllSettings() {
        val roots = rootStore.refreshAvailability()
        _uiState.value = _uiState.value.copy(
            downloadRoots = roots,
            defaultRootKey = settingsStore.defaultRootKey,
            downloadSpeedLimit = settingsStore.downloadSpeedLimit,
            uploadSpeedLimit = settingsStore.uploadSpeedLimit,
            whenDownloadsComplete = settingsStore.whenDownloadsComplete,
            wifiOnlyEnabled = settingsStore.wifiOnlyEnabled,
            dhtEnabled = settingsStore.dhtEnabled,
            pexEnabled = settingsStore.pexEnabled,
            encryptionPolicy = settingsStore.encryptionPolicy,
            backgroundDownloadsEnabled = settingsStore.backgroundDownloadsEnabled
        )
    }

    /**
     * Refresh the list of download roots from storage.
     */
    fun refreshRoots() {
        val roots = rootStore.refreshAvailability()
        _uiState.value = _uiState.value.copy(
            downloadRoots = roots,
            defaultRootKey = settingsStore.defaultRootKey
        )
    }

    // =========================================================================
    // Storage Settings
    // =========================================================================

    /**
     * Set the default download folder.
     */
    fun setDefaultRoot(key: String) {
        settingsStore.defaultRootKey = key
        _uiState.value = _uiState.value.copy(defaultRootKey = key)
    }

    /**
     * Remove a download root by key.
     */
    fun removeRoot(key: String) {
        // If removing the default, clear the default
        if (settingsStore.defaultRootKey == key) {
            val remainingRoots = rootStore.listRoots().filter { it.key != key }
            settingsStore.defaultRootKey = remainingRoots.firstOrNull()?.key
        }
        rootStore.removeRoot(key)
        refreshRoots()
    }

    /**
     * Show the clear all settings confirmation dialog.
     */
    fun showClearConfirmation() {
        _uiState.value = _uiState.value.copy(showClearConfirmation = true)
    }

    /**
     * Dismiss the clear all settings confirmation dialog.
     */
    fun dismissClearConfirmation() {
        _uiState.value = _uiState.value.copy(showClearConfirmation = false)
    }

    /**
     * Clear all download roots.
     */
    fun clearAllRoots() {
        val roots = rootStore.listRoots()
        for (root in roots) {
            rootStore.removeRoot(root.key)
        }
        settingsStore.defaultRootKey = null
        refreshRoots()
        dismissClearConfirmation()
    }

    // =========================================================================
    // Bandwidth Settings
    // =========================================================================

    /**
     * Set download speed limit.
     */
    fun setDownloadSpeedLimit(bytesPerSec: Int) {
        settingsStore.downloadSpeedLimit = bytesPerSec
        app.engineController?.getConfigBridge()?.setDownloadSpeedLimit(bytesPerSec)
        _uiState.value = _uiState.value.copy(downloadSpeedLimit = bytesPerSec)
    }

    /**
     * Set upload speed limit.
     */
    fun setUploadSpeedLimit(bytesPerSec: Int) {
        settingsStore.uploadSpeedLimit = bytesPerSec
        app.engineController?.getConfigBridge()?.setUploadSpeedLimit(bytesPerSec)
        _uiState.value = _uiState.value.copy(uploadSpeedLimit = bytesPerSec)
    }

    // =========================================================================
    // Behavior Settings
    // =========================================================================

    /**
     * Set behavior when downloads complete.
     */
    fun setWhenDownloadsComplete(mode: String) {
        settingsStore.whenDownloadsComplete = mode
        _uiState.value = _uiState.value.copy(whenDownloadsComplete = mode)
    }

    // =========================================================================
    // Network Settings
    // =========================================================================

    /**
     * Set WiFi-only mode.
     * Persists the setting and also notifies running service to start/stop WiFi monitoring.
     */
    fun setWifiOnly(enabled: Boolean) {
        settingsStore.wifiOnlyEnabled = enabled
        // WiFi monitoring is handled by ForegroundNotificationService, notify it if running
        ForegroundNotificationService.instance?.setWifiOnlyEnabled(enabled)
        _uiState.value = _uiState.value.copy(wifiOnlyEnabled = enabled)
    }

    /**
     * Set DHT enabled state.
     */
    fun setDhtEnabled(enabled: Boolean) {
        settingsStore.dhtEnabled = enabled
        app.engineController?.getConfigBridge()?.setDhtEnabled(enabled)
        _uiState.value = _uiState.value.copy(dhtEnabled = enabled)
    }

    /**
     * Set PEX enabled state.
     */
    fun setPexEnabled(enabled: Boolean) {
        settingsStore.pexEnabled = enabled
        app.engineController?.getConfigBridge()?.setPexEnabled(enabled)
        _uiState.value = _uiState.value.copy(pexEnabled = enabled)
    }

    /**
     * Set encryption policy.
     */
    fun setEncryptionPolicy(policy: String) {
        settingsStore.encryptionPolicy = policy
        app.engineController?.getConfigBridge()?.setEncryptionPolicy(policy)
        _uiState.value = _uiState.value.copy(encryptionPolicy = policy)
    }

    // =========================================================================
    // Power Management Settings
    // =========================================================================

    /**
     * Set background downloads enabled.
     * Requires notification permission - if not granted, shows the permission required dialog.
     */
    fun setBackgroundDownloadsEnabled(enabled: Boolean) {
        if (enabled && !_uiState.value.notificationPermissionGranted) {
            // Can't enable without notification permission - show dialog
            _uiState.value = _uiState.value.copy(showNotificationRequiredDialog = true)
            return
        }

        settingsStore.backgroundDownloadsEnabled = enabled
        _uiState.value = _uiState.value.copy(backgroundDownloadsEnabled = enabled)
    }

    /**
     * Dismiss the notification required dialog.
     */
    fun dismissNotificationRequiredDialog() {
        _uiState.value = _uiState.value.copy(showNotificationRequiredDialog = false)
    }

    // =========================================================================
    // Notification Settings
    // =========================================================================

    /**
     * Update notification permission state.
     * Also disables background downloads if permission is revoked.
     */
    fun updateNotificationPermissionState(granted: Boolean, canRequest: Boolean) {
        // If permission was revoked and background downloads was enabled, disable it
        val backgroundEnabled = if (!granted && settingsStore.backgroundDownloadsEnabled) {
            settingsStore.backgroundDownloadsEnabled = false
            false
        } else {
            settingsStore.backgroundDownloadsEnabled
        }

        _uiState.value = _uiState.value.copy(
            notificationPermissionGranted = granted,
            canRequestNotificationPermission = canRequest,
            backgroundDownloadsEnabled = backgroundEnabled
        )
    }

    /**
     * Factory for creating SettingsViewModel with dependencies.
     */
    class Factory(
        private val context: Context
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(SettingsViewModel::class.java)) {
                val app = context.applicationContext as JSTorrentApplication
                return SettingsViewModel(
                    app,
                    RootStore(context),
                    SettingsStore(context)
                ) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
