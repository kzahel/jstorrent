package com.jstorrent.app.e2e

/**
 * Configuration for E2E tests that interact with an external seeder.
 *
 * The seeder is expected to be running on the host machine with the Python
 * seeder script (packages/engine/integration/python/seed_for_test.py).
 *
 * For Android emulator, use 10.0.2.2 which maps to the host's loopback.
 * For physical devices, use the host's actual IP address.
 */
object E2ETestConfig {
    /**
     * Host IP address for the seeder.
     * - 10.0.2.2: Android emulator -> host loopback
     * - 127.0.0.1: When using ADB reverse port forwarding
     * - Custom IP: For physical device testing
     *
     * Can be overridden via instrumentation argument: seeder_host
     */
    const val DEFAULT_SEEDER_HOST = "10.0.2.2"

    /**
     * Default port for the Python seeder.
     * Matches the default in seed_for_test.py (6881).
     *
     * Can be overridden via instrumentation argument: seeder_port
     */
    const val DEFAULT_SEEDER_PORT = 6881

    /**
     * Timeout for waiting for the engine to load (milliseconds).
     */
    const val ENGINE_LOAD_TIMEOUT_MS = 30_000L

    /**
     * Timeout for waiting for torrent to start downloading (milliseconds).
     */
    const val DOWNLOAD_START_TIMEOUT_MS = 30_000L

    /**
     * Timeout for download progress checks (milliseconds).
     * This is how long to wait for progress to increase.
     */
    const val DOWNLOAD_PROGRESS_TIMEOUT_MS = 60_000L

    /**
     * Polling interval for checking engine/torrent state (milliseconds).
     */
    const val POLL_INTERVAL_MS = 500L

    /**
     * Get the seeder host from instrumentation arguments or use default.
     */
    fun getSeederHost(arguments: android.os.Bundle): String {
        return arguments.getString("seeder_host") ?: DEFAULT_SEEDER_HOST
    }

    /**
     * Get the seeder port from instrumentation arguments or use default.
     */
    fun getSeederPort(arguments: android.os.Bundle): Int {
        val portStr = arguments.getString("seeder_port")
        return portStr?.toIntOrNull() ?: DEFAULT_SEEDER_PORT
    }
}
