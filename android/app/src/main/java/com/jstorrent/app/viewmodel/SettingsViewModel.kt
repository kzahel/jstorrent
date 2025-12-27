package com.jstorrent.app.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.jstorrent.app.service.EngineService
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
    // Notifications
    val notificationPermissionGranted: Boolean = false,
    val canRequestNotificationPermission: Boolean = true
)

/**
 * ViewModel for the settings screen.
 * Manages storage roots and app settings.
 */
class SettingsViewModel(
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
            encryptionPolicy = settingsStore.encryptionPolicy
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
        EngineService.instance?.setDownloadSpeedLimit(bytesPerSec)
            ?: run { settingsStore.downloadSpeedLimit = bytesPerSec }
        _uiState.value = _uiState.value.copy(downloadSpeedLimit = bytesPerSec)
    }

    /**
     * Set upload speed limit.
     */
    fun setUploadSpeedLimit(bytesPerSec: Int) {
        EngineService.instance?.setUploadSpeedLimit(bytesPerSec)
            ?: run { settingsStore.uploadSpeedLimit = bytesPerSec }
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
     */
    fun setWifiOnly(enabled: Boolean) {
        settingsStore.wifiOnlyEnabled = enabled
        _uiState.value = _uiState.value.copy(wifiOnlyEnabled = enabled)
    }

    /**
     * Set DHT enabled state.
     */
    fun setDhtEnabled(enabled: Boolean) {
        EngineService.instance?.setDhtEnabled(enabled)
            ?: run { settingsStore.dhtEnabled = enabled }
        _uiState.value = _uiState.value.copy(dhtEnabled = enabled)
    }

    /**
     * Set PEX enabled state.
     */
    fun setPexEnabled(enabled: Boolean) {
        EngineService.instance?.setPexEnabled(enabled)
            ?: run { settingsStore.pexEnabled = enabled }
        _uiState.value = _uiState.value.copy(pexEnabled = enabled)
    }

    /**
     * Set encryption policy.
     */
    fun setEncryptionPolicy(policy: String) {
        EngineService.instance?.setEncryptionPolicy(policy)
            ?: run { settingsStore.encryptionPolicy = policy }
        _uiState.value = _uiState.value.copy(encryptionPolicy = policy)
    }

    // =========================================================================
    // Notification Settings
    // =========================================================================

    /**
     * Update notification permission state.
     */
    fun updateNotificationPermissionState(granted: Boolean, canRequest: Boolean) {
        _uiState.value = _uiState.value.copy(
            notificationPermissionGranted = granted,
            canRequestNotificationPermission = canRequest
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
                return SettingsViewModel(
                    RootStore(context),
                    SettingsStore(context)
                ) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
