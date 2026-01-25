package com.jstorrent.quickjs.bindings

import com.jstorrent.quickjs.QuickJsContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * Network bindings for QuickJS.
 *
 * Implements the following native functions:
 * - __jstorrent_get_network_interfaces() -> string (JSON array)
 *
 * Returns network interface information needed for UPnP port mapping.
 */
class NetworkBindings {

    /**
     * Register all network bindings on the given context.
     */
    fun register(ctx: QuickJsContext) {
        // __jstorrent_get_network_interfaces(): string (JSON array)
        ctx.setGlobalFunction("__jstorrent_get_network_interfaces") { _ ->
            val interfaces = JSONArray()

            try {
                val netInterfaces = NetworkInterface.getNetworkInterfaces()
                while (netInterfaces.hasMoreElements()) {
                    val iface = netInterfaces.nextElement()
                    if (iface.isLoopback || !iface.isUp) continue

                    for (addr in iface.interfaceAddresses) {
                        val inet = addr.address
                        // Only include IPv4 addresses for UPnP
                        if (inet is Inet4Address) {
                            val obj = JSONObject().apply {
                                put("name", iface.name)
                                put("address", inet.hostAddress)
                                put("prefixLength", addr.networkPrefixLength.toInt())
                            }
                            interfaces.put(obj)
                        }
                    }
                }
            } catch (e: Exception) {
                // Return empty array on error
            }

            interfaces.toString()
        }
    }
}
