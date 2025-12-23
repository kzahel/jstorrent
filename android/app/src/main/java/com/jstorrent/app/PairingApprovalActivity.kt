package com.jstorrent.app

import android.app.Activity
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.theme.JSTorrentTheme

private const val TAG = "PairingApprovalActivity"

/**
 * Activity that shows pairing approval dialog.
 * Launched by HttpServer when POST /pair is received.
 * Result communicated via companion object callback.
 */
class PairingApprovalActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val token = intent.getStringExtra(EXTRA_TOKEN) ?: run {
            Log.e(TAG, "Missing token")
            finishWithResult(false)
            return
        }
        val installId = intent.getStringExtra(EXTRA_INSTALL_ID) ?: run {
            Log.e(TAG, "Missing installId")
            finishWithResult(false)
            return
        }
        val extensionId = intent.getStringExtra(EXTRA_EXTENSION_ID) ?: run {
            Log.e(TAG, "Missing extensionId")
            finishWithResult(false)
            return
        }
        val isReplace = intent.getBooleanExtra(EXTRA_IS_REPLACE, false)

        setContent {
            JSTorrentTheme {
                PairingApprovalScreen(
                    isReplace = isReplace,
                    onApprove = {
                        Log.i(TAG, "User approved pairing")
                        pendingCallback?.invoke(true, token, installId, extensionId)
                        pendingCallback = null
                        finishWithResult(true)
                    },
                    onDeny = {
                        Log.i(TAG, "User denied pairing")
                        pendingCallback?.invoke(false, null, null, null)
                        pendingCallback = null
                        finishWithResult(false)
                    }
                )
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        // Activity destroyed without explicit action = denial
        if (pendingCallback != null) {
            pendingCallback?.invoke(false, null, null, null)
            pendingCallback = null
        }
    }

    private fun finishWithResult(approved: Boolean) {
        setResult(if (approved) Activity.RESULT_OK else Activity.RESULT_CANCELED)
        finish()
    }

    companion object {
        const val EXTRA_TOKEN = "token"
        const val EXTRA_INSTALL_ID = "install_id"
        const val EXTRA_EXTENSION_ID = "extension_id"
        const val EXTRA_IS_REPLACE = "is_replace"

        var pendingCallback: ((
            approved: Boolean,
            token: String?,
            installId: String?,
            extensionId: String?
        ) -> Unit)? = null
    }
}

@Composable
fun PairingApprovalScreen(
    isReplace: Boolean,
    onApprove: () -> Unit,
    onDeny: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = if (isReplace) "Replace Existing Connection?" else "Allow Connection?",
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = if (isReplace) {
                    "A different JSTorrent extension wants to connect. This will replace the current pairing."
                } else {
                    "JSTorrent Chrome extension wants to connect for file downloads."
                },
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(32.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                OutlinedButton(onClick = onDeny, modifier = Modifier.weight(1f)) {
                    Text("Deny")
                }
                Button(onClick = onApprove, modifier = Modifier.weight(1f)) {
                    Text("Allow")
                }
            }
        }
    }
}
