package com.jstorrent.app.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Monitors network connectivity and type changes.
 * Exposes WiFi connectivity state as a StateFlow for WiFi-only mode.
 */
class NetworkMonitor(context: Context) {

    companion object {
        private const val TAG = "NetworkMonitor"
    }

    private val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE)
        as ConnectivityManager

    private val _isWifiConnected = MutableStateFlow(checkCurrentWifiState())
    val isWifiConnected: StateFlow<Boolean> = _isWifiConnected.asStateFlow()

    private val _isConnected = MutableStateFlow(checkCurrentConnectionState())
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    /**
     * Start monitoring network changes.
     */
    fun start() {
        if (networkCallback != null) {
            Log.w(TAG, "NetworkMonitor already started")
            return
        }

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.d(TAG, "Network available: $network")
                updateNetworkState()
            }

            override fun onLost(network: Network) {
                Log.d(TAG, "Network lost: $network")
                updateNetworkState()
            }

            override fun onCapabilitiesChanged(
                network: Network,
                networkCapabilities: NetworkCapabilities
            ) {
                Log.d(TAG, "Network capabilities changed")
                updateNetworkState()
            }
        }

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        connectivityManager.registerNetworkCallback(request, callback)
        networkCallback = callback

        // Update initial state
        updateNetworkState()
        Log.i(TAG, "NetworkMonitor started, WiFi=${_isWifiConnected.value}")
    }

    /**
     * Stop monitoring network changes.
     */
    fun stop() {
        networkCallback?.let { callback ->
            try {
                connectivityManager.unregisterNetworkCallback(callback)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to unregister network callback", e)
            }
            networkCallback = null
        }
        Log.i(TAG, "NetworkMonitor stopped")
    }

    private fun updateNetworkState() {
        _isWifiConnected.value = checkCurrentWifiState()
        _isConnected.value = checkCurrentConnectionState()
        Log.d(TAG, "Network state updated: wifi=${_isWifiConnected.value}, connected=${_isConnected.value}")
    }

    private fun checkCurrentWifiState(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    private fun checkCurrentConnectionState(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}
