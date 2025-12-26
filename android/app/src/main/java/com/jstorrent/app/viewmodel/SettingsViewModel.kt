package com.jstorrent.app.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.jstorrent.app.storage.DownloadRoot
import com.jstorrent.app.storage.RootStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * UI state for the settings screen.
 */
data class SettingsUiState(
    val downloadRoots: List<DownloadRoot> = emptyList(),
    val showClearConfirmation: Boolean = false
)

/**
 * ViewModel for the settings screen.
 * Manages storage roots and app settings.
 */
class SettingsViewModel(
    private val rootStore: RootStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        refreshRoots()
    }

    /**
     * Refresh the list of download roots from storage.
     */
    fun refreshRoots() {
        val roots = rootStore.refreshAvailability()
        _uiState.value = _uiState.value.copy(downloadRoots = roots)
    }

    /**
     * Remove a download root by key.
     */
    fun removeRoot(key: String) {
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
        refreshRoots()
        dismissClearConfirmation()
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
                return SettingsViewModel(RootStore(context)) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
