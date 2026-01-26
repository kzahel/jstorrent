package com.jstorrent.app.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * Common menu items shared across overflow menus in the app.
 * This ensures consistent menu options between TorrentListScreen and TorrentDetailScreen.
 */
object SharedMenuItems {

    /**
     * Speed graph menu item - shows speed history with graphs.
     */
    @Composable
    fun SpeedMenuItem(
        onClick: () -> Unit,
        onDismiss: () -> Unit
    ) {
        DropdownMenuItem(
            text = { Text("Speed") },
            leadingIcon = {
                Icon(
                    imageVector = Icons.Default.Speed,
                    contentDescription = null
                )
            },
            onClick = {
                onDismiss()
                onClick()
            }
        )
    }

    /**
     * DHT Info menu item - shows DHT network statistics.
     */
    @Composable
    fun DhtInfoMenuItem(
        onClick: () -> Unit,
        onDismiss: () -> Unit
    ) {
        DropdownMenuItem(
            text = { Text("DHT Info") },
            leadingIcon = {
                Icon(
                    imageVector = Icons.Default.Hub,
                    contentDescription = null
                )
            },
            onClick = {
                onDismiss()
                onClick()
            }
        )
    }

    /**
     * Settings menu item - navigates to settings screen.
     */
    @Composable
    fun SettingsMenuItem(
        onClick: () -> Unit,
        onDismiss: () -> Unit
    ) {
        DropdownMenuItem(
            text = { Text("Settings") },
            leadingIcon = {
                Icon(
                    imageVector = Icons.Default.Settings,
                    contentDescription = null
                )
            },
            onClick = {
                onDismiss()
                onClick()
            }
        )
    }

    /**
     * Shutdown menu item - shuts down the app/engine.
     */
    @Composable
    fun ShutdownMenuItem(
        onClick: () -> Unit,
        onDismiss: () -> Unit
    ) {
        DropdownMenuItem(
            text = { Text("Shutdown") },
            leadingIcon = {
                Icon(
                    imageVector = Icons.Default.PowerSettingsNew,
                    contentDescription = null
                )
            },
            onClick = {
                onDismiss()
                onClick()
            }
        )
    }
}
