package com.jstorrent.app.debug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.jstorrent.app.JSTorrentApplication
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

private const val TAG = "JSTorrent-Debug"

/**
 * Debug broadcast receiver for inspecting engine state via adb.
 *
 * Usage:
 * ```bash
 * # Get basic status
 * adb shell am broadcast -a com.jstorrent.DEBUG --es cmd status
 *
 * # Evaluate arbitrary JavaScript
 * adb shell am broadcast -a com.jstorrent.DEBUG --es cmd eval --es expr "globalThis.jstorrent?.torrents?.length"
 *
 * # Get swarm debug info for a torrent
 * adb shell am broadcast -a com.jstorrent.DEBUG --es cmd swarm --es hash "abc123..."
 *
 * # Get DHT stats
 * adb shell am broadcast -a com.jstorrent.DEBUG --es cmd dht
 *
 * # List all torrents with details
 * adb shell am broadcast -a com.jstorrent.DEBUG --es cmd torrents
 *
 * # Set log level (debug, info, warn, error)
 * adb shell am broadcast -a com.jstorrent.DEBUG --es cmd loglevel --es level debug
 *
 * # Get peers for a torrent
 * adb shell am broadcast -a com.jstorrent.DEBUG --es cmd peers --es hash "abc123..."
 * ```
 *
 * Results are logged to logcat with tag "JSTorrent-Debug".
 * Filter with: adb logcat -s JSTorrent-Debug
 */
class DebugReceiver : BroadcastReceiver() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != "com.jstorrent.DEBUG") return

        val cmd = intent.getStringExtra("cmd") ?: run {
            logHelp()
            return
        }

        val app = context.applicationContext as? JSTorrentApplication ?: run {
            Log.e(TAG, "Application not available")
            return
        }

        val controller = app.engineController
        if (controller == null) {
            Log.e(TAG, "Engine controller not initialized")
            return
        }

        when (cmd.lowercase()) {
            "status" -> handleStatus(controller, app)
            "eval" -> handleEval(controller, intent.getStringExtra("expr"))
            "swarm" -> handleSwarm(controller, intent.getStringExtra("hash"))
            "dht" -> handleDht(controller)
            "torrents" -> handleTorrents(controller)
            "loglevel" -> handleLogLevel(controller, intent.getStringExtra("level"))
            "peers" -> handlePeers(controller, intent.getStringExtra("hash"))
            "help" -> logHelp()
            else -> {
                Log.w(TAG, "Unknown command: $cmd")
                logHelp()
            }
        }
    }

    private fun handleStatus(controller: com.jstorrent.quickjs.EngineController, app: JSTorrentApplication) {
        scope.launch {
            try {
                val isLoaded = controller.isLoaded.value
                val state = controller.state.value
                val lastError = controller.lastError.value
                val torrents = state?.torrents ?: emptyList()

                Log.i(TAG, "=== ENGINE STATUS ===")
                Log.i(TAG, "Engine loaded: $isLoaded")
                Log.i(TAG, "Last error: ${lastError ?: "none"}")
                Log.i(TAG, "Torrent count: ${torrents.size}")

                if (torrents.isNotEmpty()) {
                    val downloading = torrents.count { it.status == "downloading" }
                    val seeding = torrents.count { it.status == "seeding" }
                    val stopped = torrents.count { it.status == "stopped" }
                    val metadata = torrents.count { it.status == "downloading_metadata" }
                    Log.i(TAG, "  downloading: $downloading, seeding: $seeding, stopped: $stopped, metadata: $metadata")
                }

                // Try to get JS thread responsiveness
                val start = System.currentTimeMillis()
                val result = controller.evaluateAsync("Date.now()")
                val elapsed = System.currentTimeMillis() - start
                val maxLatency = controller.getMaxJsThreadLatencyMs()
                Log.i(TAG, "JS thread latency: ${elapsed}ms (max observed: ${maxLatency}ms)")

                Log.i(TAG, "=== END STATUS ===")
            } catch (e: Exception) {
                Log.e(TAG, "Status failed: ${e.message}", e)
            }
        }
    }

    private fun handleEval(controller: com.jstorrent.quickjs.EngineController, expr: String?) {
        if (expr.isNullOrBlank()) {
            Log.e(TAG, "eval requires --es expr \"expression\"")
            return
        }

        scope.launch {
            try {
                Log.i(TAG, "=== EVAL ===")
                Log.i(TAG, "Expression: $expr")
                val start = System.currentTimeMillis()
                val result = controller.evaluateAsync(expr)
                val elapsed = System.currentTimeMillis() - start
                Log.i(TAG, "Result (${elapsed}ms): $result")
                Log.i(TAG, "=== END EVAL ===")
            } catch (e: Exception) {
                Log.e(TAG, "Eval failed: ${e.message}", e)
            }
        }
    }

    private fun handleSwarm(controller: com.jstorrent.quickjs.EngineController, hash: String?) {
        scope.launch {
            try {
                Log.i(TAG, "=== SWARM DEBUG ===")

                // If no hash provided, use the first torrent
                val infoHash = hash ?: run {
                    val torrents = controller.getTorrentListAsync()
                    if (torrents.isEmpty()) {
                        Log.w(TAG, "No torrents to inspect")
                        return@launch
                    }
                    torrents.first().infoHash.also {
                        Log.i(TAG, "Using first torrent: $it")
                    }
                }

                Log.i(TAG, "InfoHash: $infoHash")
                val debug = controller.getSwarmDebug(infoHash)

                // Log in chunks since logcat has line limits
                debug.chunked(800).forEach { chunk ->
                    Log.i(TAG, chunk)
                }

                Log.i(TAG, "=== END SWARM DEBUG ===")
            } catch (e: Exception) {
                Log.e(TAG, "Swarm debug failed: ${e.message}", e)
            }
        }
    }

    private fun handleDht(controller: com.jstorrent.quickjs.EngineController) {
        scope.launch {
            try {
                Log.i(TAG, "=== DHT STATS ===")
                val stats = controller.getDhtStatsAsync()
                if (stats == null) {
                    Log.w(TAG, "DHT stats not available")
                    return@launch
                }

                Log.i(TAG, "Enabled: ${stats.enabled}, Ready: ${stats.ready}")
                Log.i(TAG, "Node ID: ${stats.nodeId}")
                Log.i(TAG, "Nodes: ${stats.nodeCount}, Buckets: ${stats.bucketCount}")
                Log.i(TAG, "Traffic: sent=${stats.bytesSent}, recv=${stats.bytesReceived}")
                Log.i(TAG, "Pings: sent=${stats.pingsSent}, success=${stats.pingsSucceeded}, recv=${stats.pingsReceived}")
                Log.i(TAG, "FindNodes: sent=${stats.findNodesSent}, success=${stats.findNodesSucceeded}, recv=${stats.findNodesReceived}")
                Log.i(TAG, "GetPeers: sent=${stats.getPeersSent}, success=${stats.getPeersSucceeded}, recv=${stats.getPeersReceived}")
                Log.i(TAG, "Announces: sent=${stats.announcesSent}, success=${stats.announcesSucceeded}, recv=${stats.announcesReceived}")
                Log.i(TAG, "Errors: timeouts=${stats.timeouts}, errors=${stats.errors}")
                Log.i(TAG, "Peers discovered: ${stats.peersDiscovered}")
                Log.i(TAG, "=== END DHT STATS ===")
            } catch (e: Exception) {
                Log.e(TAG, "DHT stats failed: ${e.message}", e)
            }
        }
    }

    private fun handleTorrents(controller: com.jstorrent.quickjs.EngineController) {
        scope.launch {
            try {
                Log.i(TAG, "=== TORRENTS ===")
                val torrents = controller.getTorrentListAsync()

                if (torrents.isEmpty()) {
                    Log.i(TAG, "No torrents")
                    return@launch
                }

                for (t in torrents) {
                    Log.i(TAG, "---")
                    Log.i(TAG, "Name: ${t.name}")
                    Log.i(TAG, "Hash: ${t.infoHash}")
                    Log.i(TAG, "Status: ${t.status}")
                    Log.i(TAG, "Progress: ${(t.progress * 100).toInt()}%")
                    Log.i(TAG, "Size: ${t.size} bytes")
                    Log.i(TAG, "Downloaded: ${t.downloaded}, Uploaded: ${t.uploaded}")
                    Log.i(TAG, "Speed: down=${t.downloadSpeed}/s, up=${t.uploadSpeed}/s")
                    Log.i(TAG, "Peers connected: ${t.peersConnected}")
                }
                Log.i(TAG, "=== END TORRENTS ===")
            } catch (e: Exception) {
                Log.e(TAG, "Torrents list failed: ${e.message}", e)
            }
        }
    }

    private fun handleLogLevel(controller: com.jstorrent.quickjs.EngineController, level: String?) {
        if (level.isNullOrBlank()) {
            Log.e(TAG, "loglevel requires --es level \"debug|info|warn|error\"")
            return
        }

        scope.launch {
            try {
                controller.setLogLevel(level)
                Log.i(TAG, "Log level set to: $level")
            } catch (e: Exception) {
                Log.e(TAG, "Set log level failed: ${e.message}", e)
            }
        }
    }

    private fun handlePeers(controller: com.jstorrent.quickjs.EngineController, hash: String?) {
        scope.launch {
            try {
                Log.i(TAG, "=== PEERS ===")

                // If no hash provided, use the first torrent
                val infoHash = hash ?: run {
                    val torrents = controller.getTorrentListAsync()
                    if (torrents.isEmpty()) {
                        Log.w(TAG, "No torrents to inspect")
                        return@launch
                    }
                    torrents.first().infoHash.also {
                        Log.i(TAG, "Using first torrent: $it")
                    }
                }

                Log.i(TAG, "InfoHash: $infoHash")
                val peers = controller.getPeersAsync(infoHash)

                if (peers.isEmpty()) {
                    Log.i(TAG, "No connected peers")
                    return@launch
                }

                Log.i(TAG, "Connected peers: ${peers.size}")
                for (p in peers) {
                    Log.i(TAG, "  ${p.ip}:${p.port} - down=${p.downloadSpeed}/s up=${p.uploadSpeed}/s client=${p.clientName ?: "unknown"}")
                }
                Log.i(TAG, "=== END PEERS ===")
            } catch (e: Exception) {
                Log.e(TAG, "Peers list failed: ${e.message}", e)
            }
        }
    }

    private fun logHelp() {
        Log.i(TAG, "=== DEBUG COMMANDS ===")
        Log.i(TAG, "adb shell am broadcast -a com.jstorrent.DEBUG --es cmd <command> [args]")
        Log.i(TAG, "")
        Log.i(TAG, "Commands:")
        Log.i(TAG, "  status              - Engine status and JS thread latency")
        Log.i(TAG, "  eval --es expr X    - Evaluate JavaScript expression")
        Log.i(TAG, "  swarm [--es hash X] - Swarm debug info (default: first torrent)")
        Log.i(TAG, "  dht                 - DHT statistics")
        Log.i(TAG, "  torrents            - List all torrents with details")
        Log.i(TAG, "  peers [--es hash X] - List connected peers")
        Log.i(TAG, "  loglevel --es level X - Set log level (debug/info/warn/error)")
        Log.i(TAG, "  help                - Show this help")
        Log.i(TAG, "")
        Log.i(TAG, "Filter output: adb logcat -s JSTorrent-Debug")
        Log.i(TAG, "=== END HELP ===")
    }
}
