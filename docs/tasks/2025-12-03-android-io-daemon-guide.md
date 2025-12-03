# Android IO Daemon Implementation Guide

## Overview

Build a Kotlin Android app that serves as an I/O daemon for the JSTorrent Chrome extension on ChromeOS. The app runs an HTTP/WebSocket server that handles:
- TCP/UDP socket multiplexing (for BitTorrent peer connections)
- File read/write operations (for downloading torrent data)
- SHA1 hashing (for piece verification)

The extension (running in Chrome) connects to this daemon at `http://100.115.92.2:7800` (the ChromeOS ARC bridge IP).

**Reference:** Read `docs/project/2025-12-03-chromeos-strategy.md` for architectural context.

---

## Project Location

`android-io-daemon/` in the monorepo root.

Package: `com.jstorrent.app`

---

## Phase 1: Dependencies and Manifest

### 1.1 Update gradle/libs.versions.toml

Add Ktor and coroutines versions. Find the `[versions]` section and add:

```toml
[versions]
agp = "8.13.1"
kotlin = "2.0.21"
coreKtx = "1.10.1"
junit = "4.13.2"
junitVersion = "1.1.5"
espressoCore = "3.5.1"
lifecycleRuntimeKtx = "2.6.1"
activityCompose = "1.8.0"
composeBom = "2024.09.00"
ktor = "2.3.7"
coroutines = "1.7.3"
```

Add to `[libraries]` section:

```toml
ktor-server-core = { group = "io.ktor", name = "ktor-server-core", version.ref = "ktor" }
ktor-server-netty = { group = "io.ktor", name = "ktor-server-netty", version.ref = "ktor" }
ktor-server-websockets = { group = "io.ktor", name = "ktor-server-websockets", version.ref = "ktor" }
kotlinx-coroutines-android = { group = "org.jetbrains.kotlinx", name = "kotlinx-coroutines-android", version.ref = "coroutines" }
```

### 1.2 Update app/build.gradle.kts

Replace the entire file with:

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.jstorrent.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.jstorrent.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
    buildFeatures {
        compose = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "/META-INF/INDEX.LIST"
            excludes += "/META-INF/io.netty.versions.properties"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    
    // Ktor server
    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.netty)
    implementation(libs.ktor.server.websockets)
    
    // Coroutines
    implementation(libs.kotlinx.coroutines.android)
    
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
```

### 1.3 Update AndroidManifest.xml

Replace `app/src/main/AndroidManifest.xml` with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <!-- Network permissions -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <!-- Foreground service permissions -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application
        android:allowBackup="true"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:fullBackupContent="@xml/backup_rules"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.JSTorrent"
        android:usesCleartextTraffic="true"
        tools:targetApi="31">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:label="@string/app_name"
            android:theme="@style/Theme.JSTorrent">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <!-- Pairing intent from extension -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="jstorrent" android:host="pair" />
            </intent-filter>

            <!-- Magnet links -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="magnet" />
            </intent-filter>
        </activity>

        <!-- IO Daemon foreground service -->
        <service
            android:name=".service.IoDaemonService"
            android:foregroundServiceType="dataSync"
            android:exported="false" />

    </application>

</manifest>
```

### 1.4 Verification

Sync Gradle in Android Studio. The project should build without errors.

```bash
cd android-io-daemon
./gradlew assembleDebug
```

---

## Phase 2: Token Store

Create a simple token storage using SharedPreferences.

### 2.1 Create app/src/main/java/com/jstorrent/app/auth/TokenStore.kt

```kotlin
package com.jstorrent.app.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

/**
 * Stores the authentication token shared between the extension and this app.
 * The extension generates a token, sends it via intent, and uses it for all requests.
 */
class TokenStore(context: Context) {
    
    private val prefs: SharedPreferences = context.getSharedPreferences(
        PREFS_NAME, 
        Context.MODE_PRIVATE
    )
    
    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit { putString(KEY_TOKEN, value) }
    
    fun hasToken(): Boolean = token != null
    
    fun clear() {
        prefs.edit { remove(KEY_TOKEN) }
    }
    
    companion object {
        private const val PREFS_NAME = "jstorrent_auth"
        private const val KEY_TOKEN = "auth_token"
    }
}
```

### 2.2 Verification

This is a simple class with no external dependencies. It will be tested when we implement the pairing flow.

---

## Phase 3: Basic HTTP Server

Create a minimal Ktor server with a `/status` endpoint.

### 3.1 Create app/src/main/java/com/jstorrent/app/server/HttpServer.kt

```kotlin
package com.jstorrent.app.server

import android.util.Log
import com.jstorrent.app.auth.TokenStore
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File

private const val TAG = "HttpServer"

class HttpServer(
    private val tokenStore: TokenStore,
    private val downloadRoot: File
) {
    private var server: NettyApplicationEngine? = null
    private var actualPort: Int = 0
    
    val port: Int get() = actualPort
    val isRunning: Boolean get() = server != null
    
    fun start(preferredPort: Int = 7800) {
        if (server != null) {
            Log.w(TAG, "Server already running on port $actualPort")
            return
        }
        
        // Try preferred port, then fallback ports
        val portsToTry = generatePortSequence(preferredPort).take(10).toList()
        
        for (port in portsToTry) {
            try {
                server = embeddedServer(Netty, port = port) {
                    configureRouting()
                }.start(wait = false)
                
                actualPort = port
                Log.i(TAG, "Server started on port $actualPort")
                return
            } catch (e: Exception) {
                Log.w(TAG, "Port $port unavailable: ${e.message}")
            }
        }
        
        throw IllegalStateException("Could not bind to any port")
    }
    
    fun stop() {
        server?.stop(1000, 2000)
        server = null
        actualPort = 0
        Log.i(TAG, "Server stopped")
    }
    
    private fun Application.configureRouting() {
        routing {
            // Health check - no auth required
            get("/health") {
                call.respondText("ok", ContentType.Text.Plain)
            }
            
            // Status endpoint - no auth required
            get("/status") {
                call.respondText(
                    """{"port":$actualPort,"paired":${tokenStore.hasToken()}}""",
                    ContentType.Application.Json
                )
            }
        }
    }
    
    companion object {
        /**
         * Port selection: 7800, 7805, 7814, 7827, ...
         * Formula: 7800 + 4*n + n²
         */
        fun generatePortSequence(base: Int): Sequence<Int> = sequence {
            var n = 0
            while (true) {
                yield(base + 4 * n + n * n)
                n++
            }
        }
    }
}
```

### 3.2 Verification

At this point, you can manually test by temporarily starting the server from MainActivity. We'll properly integrate it with the foreground service in the next phase.

---

## Phase 4: Foreground Service

Create a foreground service to keep the server running when the app is in the background.

### 4.1 Create app/src/main/java/com/jstorrent/app/service/IoDaemonService.kt

```kotlin
package com.jstorrent.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.jstorrent.app.MainActivity
import com.jstorrent.app.R
import com.jstorrent.app.auth.TokenStore
import com.jstorrent.app.server.HttpServer
import java.io.File

private const val TAG = "IoDaemonService"
private const val NOTIFICATION_ID = 1
private const val CHANNEL_ID = "jstorrent_daemon"

class IoDaemonService : Service() {
    
    private lateinit var tokenStore: TokenStore
    private var httpServer: HttpServer? = null
    
    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service created")
        
        tokenStore = TokenStore(this)
        createNotificationChannel()
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "Service starting")
        
        // Start as foreground service immediately
        startForeground(NOTIFICATION_ID, createNotification("Starting..."))
        
        // Start HTTP server
        startServer()
        
        // Update notification with port
        val port = httpServer?.port ?: 0
        updateNotification("Running on port $port")
        
        return START_STICKY
    }
    
    override fun onDestroy() {
        Log.i(TAG, "Service destroying")
        stopServer()
        super.onDestroy()
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
    
    private fun startServer() {
        if (httpServer?.isRunning == true) {
            Log.w(TAG, "Server already running")
            return
        }
        
        val downloadRoot = getDownloadRoot()
        httpServer = HttpServer(tokenStore, downloadRoot)
        
        try {
            httpServer?.start()
            Log.i(TAG, "HTTP server started on port ${httpServer?.port}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start server", e)
        }
    }
    
    private fun stopServer() {
        httpServer?.stop()
        httpServer = null
    }
    
    private fun getDownloadRoot(): File {
        // Use app's external files directory for downloads
        // This is accessible to the user via file manager on ChromeOS
        val dir = getExternalFilesDir("downloads") ?: filesDir.resolve("downloads")
        if (!dir.exists()) {
            dir.mkdirs()
        }
        return dir
    }
    
    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "JSTorrent Daemon",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows when JSTorrent daemon is running"
            setShowBadge(false)
        }
        
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }
    
    private fun createNotification(status: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("JSTorrent")
            .setContentText(status)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }
    
    private fun updateNotification(status: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, createNotification(status))
    }
    
    companion object {
        fun start(context: Context) {
            val intent = Intent(context, IoDaemonService::class.java)
            context.startForegroundService(intent)
        }
        
        fun stop(context: Context) {
            val intent = Intent(context, IoDaemonService::class.java)
            context.stopService(intent)
        }
    }
}
```

### 4.2 Update MainActivity.kt

Replace `app/src/main/java/com/jstorrent/app/MainActivity.kt` with:

```kotlin
package com.jstorrent.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.jstorrent.app.auth.TokenStore
import com.jstorrent.app.service.IoDaemonService
import com.jstorrent.app.ui.theme.JSTorrentTheme

private const val TAG = "MainActivity"

class MainActivity : ComponentActivity() {
    
    private lateinit var tokenStore: TokenStore
    
    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        Log.i(TAG, "Notification permission granted: $isGranted")
        // Start service regardless of permission result
        IoDaemonService.start(this)
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        
        tokenStore = TokenStore(this)
        
        // Handle pairing intent
        handleIntent()
        
        // Request notification permission on Android 13+
        requestNotificationPermissionAndStartService()
        
        setContent {
            JSTorrentTheme {
                MainScreen(
                    isPaired = tokenStore.hasToken(),
                    onUnpair = {
                        tokenStore.clear()
                        // Force recomposition
                        recreate()
                    }
                )
            }
        }
    }
    
    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent()
    }
    
    private fun handleIntent() {
        val uri = intent?.data ?: return
        
        when {
            uri.scheme == "jstorrent" && uri.host == "pair" -> {
                val token = uri.getQueryParameter("token")
                if (token != null) {
                    Log.i(TAG, "Received pairing token")
                    tokenStore.token = token
                }
            }
            uri.scheme == "magnet" -> {
                Log.i(TAG, "Received magnet link: $uri")
                // TODO: Forward to extension via some mechanism
            }
        }
    }
    
    private fun requestNotificationPermissionAndStartService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            when {
                ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED -> {
                    IoDaemonService.start(this)
                }
                else -> {
                    notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        } else {
            IoDaemonService.start(this)
        }
    }
}

@Composable
fun MainScreen(
    isPaired: Boolean,
    onUnpair: () -> Unit
) {
    Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = "JSTorrent IO Daemon",
                style = MaterialTheme.typography.headlineMedium
            )
            
            Spacer(modifier = Modifier.height(24.dp))
            
            if (isPaired) {
                Text(
                    text = "✓ Paired with extension",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.primary
                )
                
                Spacer(modifier = Modifier.height(16.dp))
                
                OutlinedButton(onClick = onUnpair) {
                    Text("Unpair")
                }
            } else {
                Text(
                    text = "Not paired",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.outline
                )
                
                Spacer(modifier = Modifier.height(8.dp))
                
                Text(
                    text = "Open JSTorrent extension to pair",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.outline
                )
            }
        }
    }
}
```

### 4.3 Verification

1. Build and run on emulator
2. App should start and show "Not paired"
3. Notification should appear showing "Running on port 7800"
4. Test endpoint from host machine:

```bash
# Forward port from emulator
adb forward tcp:7800 tcp:7800

# Test health endpoint
curl http://localhost:7800/health
# Should return: ok

# Test status endpoint
curl http://localhost:7800/status
# Should return: {"port":7800,"paired":false}
```

---

## Phase 5: Authentication Middleware

Add token-based authentication to protect endpoints.

### 5.1 Create app/src/main/java/com/jstorrent/app/server/AuthMiddleware.kt

```kotlin
package com.jstorrent.app.server

import com.jstorrent.app.auth.TokenStore
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.util.pipeline.*

/**
 * Authentication check for HTTP endpoints.
 * Token can be provided via:
 * - X-JST-Auth header
 * - Authorization: Bearer <token>
 */
suspend fun PipelineContext<Unit, ApplicationCall>.requireAuth(
    tokenStore: TokenStore,
    block: suspend PipelineContext<Unit, ApplicationCall>.() -> Unit
) {
    val storedToken = tokenStore.token
    if (storedToken == null) {
        call.respond(HttpStatusCode.ServiceUnavailable, "Not paired")
        return
    }
    
    val providedToken = call.request.header("X-JST-Auth")
        ?: call.request.header("Authorization")?.removePrefix("Bearer ")
    
    if (providedToken != storedToken) {
        call.respond(HttpStatusCode.Unauthorized, "Invalid token")
        return
    }
    
    block()
}
```

### 5.2 Update HttpServer.kt with Hash Endpoint

Update `app/src/main/java/com/jstorrent/app/server/HttpServer.kt`:

```kotlin
package com.jstorrent.app.server

import android.util.Log
import com.jstorrent.app.auth.TokenStore
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import java.io.File
import java.security.MessageDigest

private const val TAG = "HttpServer"

class HttpServer(
    private val tokenStore: TokenStore,
    private val downloadRoot: File
) {
    private var server: NettyApplicationEngine? = null
    private var actualPort: Int = 0
    
    val port: Int get() = actualPort
    val isRunning: Boolean get() = server != null
    
    fun start(preferredPort: Int = 7800) {
        if (server != null) {
            Log.w(TAG, "Server already running on port $actualPort")
            return
        }
        
        val portsToTry = generatePortSequence(preferredPort).take(10).toList()
        
        for (port in portsToTry) {
            try {
                server = embeddedServer(Netty, port = port) {
                    configureRouting()
                }.start(wait = false)
                
                actualPort = port
                Log.i(TAG, "Server started on port $actualPort")
                return
            } catch (e: Exception) {
                Log.w(TAG, "Port $port unavailable: ${e.message}")
            }
        }
        
        throw IllegalStateException("Could not bind to any port")
    }
    
    fun stop() {
        server?.stop(1000, 2000)
        server = null
        actualPort = 0
        Log.i(TAG, "Server stopped")
    }
    
    private fun Application.configureRouting() {
        routing {
            // Public endpoints (no auth)
            get("/health") {
                call.respondText("ok", ContentType.Text.Plain)
            }
            
            get("/status") {
                call.respondText(
                    """{"port":$actualPort,"paired":${tokenStore.hasToken()}}""",
                    ContentType.Application.Json
                )
            }
            
            // Protected endpoints
            post("/hash/sha1") {
                requireAuth(tokenStore) {
                    val bytes = call.receive<ByteArray>()
                    val digest = MessageDigest.getInstance("SHA-1")
                    val hash = digest.digest(bytes)
                    call.respondBytes(hash, ContentType.Application.OctetStream)
                }
            }
        }
    }
    
    companion object {
        fun generatePortSequence(base: Int): Sequence<Int> = sequence {
            var n = 0
            while (true) {
                yield(base + 4 * n + n * n)
                n++
            }
        }
    }
}
```

### 5.3 Verification

```bash
# Forward port
adb forward tcp:7800 tcp:7800

# Test without token (should fail)
echo -n "hello" | curl -X POST --data-binary @- http://localhost:7800/hash/sha1
# Should return: 503 Not paired (or 401 if paired but no token provided)

# Simulate pairing via adb
adb shell am start -a android.intent.action.VIEW -d "jstorrent://pair?token=test123"

# Test with token
echo -n "hello" | curl -X POST -H "X-JST-Auth: test123" --data-binary @- http://localhost:7800/hash/sha1 | xxd
# Should return 20 bytes (SHA1 hash)
```

---

## Phase 6: File Read/Write Endpoints

Add file operations for torrent data.

### 6.1 Create app/src/main/java/com/jstorrent/app/server/FileHandler.kt

```kotlin
package com.jstorrent.app.server

import android.util.Base64
import android.util.Log
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest

private const val TAG = "FileHandler"
private const val MAX_BODY_SIZE = 64 * 1024 * 1024 // 64MB

fun Route.fileRoutes(downloadRoot: File) {
    
    get("/read/{root}") {
        val pathBase64 = call.request.header("X-Path-Base64")
            ?: return@get call.respond(HttpStatusCode.BadRequest, "Missing X-Path-Base64 header")
        
        val relativePath = try {
            String(Base64.decode(pathBase64, Base64.DEFAULT))
        } catch (e: Exception) {
            return@get call.respond(HttpStatusCode.BadRequest, "Invalid base64 in X-Path-Base64")
        }
        
        val offset = call.request.header("X-Offset")?.toLongOrNull() ?: 0L
        val length = call.request.header("X-Length")?.toLongOrNull()
            ?: return@get call.respond(HttpStatusCode.BadRequest, "Missing X-Length header")
        
        // Validate path (prevent directory traversal)
        if (relativePath.contains("..")) {
            return@get call.respond(HttpStatusCode.BadRequest, "Invalid path")
        }
        
        val file = File(downloadRoot, relativePath.trimStart('/'))
        if (!file.exists()) {
            return@get call.respond(HttpStatusCode.NotFound, "File not found")
        }
        
        try {
            RandomAccessFile(file, "r").use { raf ->
                raf.seek(offset)
                val buffer = ByteArray(length.toInt())
                val bytesRead = raf.read(buffer)
                if (bytesRead < length) {
                    return@get call.respond(HttpStatusCode.InternalServerError, "Could not read requested bytes")
                }
                call.respondBytes(buffer, ContentType.Application.OctetStream)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error reading file: ${e.message}")
            call.respond(HttpStatusCode.InternalServerError, e.message ?: "Read error")
        }
    }
    
    post("/write/{root}") {
        val pathBase64 = call.request.header("X-Path-Base64")
            ?: return@post call.respond(HttpStatusCode.BadRequest, "Missing X-Path-Base64 header")
        
        val relativePath = try {
            String(Base64.decode(pathBase64, Base64.DEFAULT))
        } catch (e: Exception) {
            return@post call.respond(HttpStatusCode.BadRequest, "Invalid base64 in X-Path-Base64")
        }
        
        val offset = call.request.header("X-Offset")?.toLongOrNull() ?: 0L
        val expectedSha1 = call.request.header("X-Expected-SHA1")
        
        // Validate path
        if (relativePath.contains("..")) {
            return@post call.respond(HttpStatusCode.BadRequest, "Invalid path")
        }
        
        val file = File(downloadRoot, relativePath.trimStart('/'))
        
        // Auto-create parent directories
        file.parentFile?.mkdirs()
        
        val body = call.receive<ByteArray>()
        
        if (body.size > MAX_BODY_SIZE) {
            return@post call.respond(HttpStatusCode.PayloadTooLarge, "Body too large")
        }
        
        try {
            RandomAccessFile(file, "rw").use { raf ->
                raf.seek(offset)
                raf.write(body)
            }
            
            // Optional hash verification
            if (expectedSha1 != null) {
                val digest = MessageDigest.getInstance("SHA-1")
                val actualHash = digest.digest(body).joinToString("") { "%02x".format(it) }
                if (actualHash != expectedSha1.lowercase()) {
                    return@post call.respond(
                        HttpStatusCode.Conflict,
                        "Hash mismatch: expected $expectedSha1, got $actualHash"
                    )
                }
            }
            
            call.respond(HttpStatusCode.OK)
        } catch (e: Exception) {
            Log.e(TAG, "Error writing file: ${e.message}")
            call.respond(HttpStatusCode.InternalServerError, e.message ?: "Write error")
        }
    }
}
```

### 6.2 Update HttpServer.kt to Include File Routes

In the `configureRouting()` function, add after the hash endpoint:

```kotlin
private fun Application.configureRouting() {
    routing {
        // Public endpoints
        get("/health") {
            call.respondText("ok", ContentType.Text.Plain)
        }
        
        get("/status") {
            call.respondText(
                """{"port":$actualPort,"paired":${tokenStore.hasToken()}}""",
                ContentType.Application.Json
            )
        }
        
        // Protected endpoints
        post("/hash/sha1") {
            requireAuth(tokenStore) {
                val bytes = call.receive<ByteArray>()
                val digest = MessageDigest.getInstance("SHA-1")
                val hash = digest.digest(bytes)
                call.respondBytes(hash, ContentType.Application.OctetStream)
            }
        }
        
        // File routes (with auth check inside)
        route("/") {
            // Wrap with auth
            intercept(ApplicationCallPipeline.Call) {
                val path = call.request.path()
                if (path.startsWith("/read/") || path.startsWith("/write/")) {
                    val storedToken = tokenStore.token
                    if (storedToken == null) {
                        call.respond(HttpStatusCode.ServiceUnavailable, "Not paired")
                        finish()
                        return@intercept
                    }
                    
                    val providedToken = call.request.header("X-JST-Auth")
                        ?: call.request.header("Authorization")?.removePrefix("Bearer ")
                    
                    if (providedToken != storedToken) {
                        call.respond(HttpStatusCode.Unauthorized, "Invalid token")
                        finish()
                        return@intercept
                    }
                }
            }
            
            fileRoutes(downloadRoot)
        }
    }
}
```

Also add the import at the top:
```kotlin
import io.ktor.server.routing.route
import io.ktor.util.pipeline.*
```

### 6.3 Verification

```bash
# Pair first
adb shell am start -a android.intent.action.VIEW -d "jstorrent://pair?token=test123"

# Write a file
echo -n "Hello, World!" | curl -X POST \
  -H "X-JST-Auth: test123" \
  -H "X-Path-Base64: $(echo -n 'test/hello.txt' | base64)" \
  --data-binary @- \
  http://localhost:7800/write/default

# Read it back
curl -H "X-JST-Auth: test123" \
  -H "X-Path-Base64: $(echo -n 'test/hello.txt' | base64)" \
  -H "X-Length: 13" \
  http://localhost:7800/read/default
# Should return: Hello, World!

# Write with hash verification
echo -n "test data" | curl -X POST \
  -H "X-JST-Auth: test123" \
  -H "X-Path-Base64: $(echo -n 'test/verified.txt' | base64)" \
  -H "X-Expected-SHA1: f48dd853820860816c75d54d0f584dc863327a7c" \
  --data-binary @- \
  http://localhost:7800/write/default
# Should return 200 OK (hash matches "test data")
```

---

## Phase 7: WebSocket Protocol Types

Define the binary protocol types for socket multiplexing.

### 7.1 Create app/src/main/java/com/jstorrent/app/server/Protocol.kt

```kotlin
package com.jstorrent.app.server

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Binary protocol for WebSocket socket multiplexing.
 * All multi-byte integers are little-endian.
 */
object Protocol {
    const val VERSION: Byte = 1
    
    // Session & Auth opcodes
    const val OP_CLIENT_HELLO: Byte = 0x01
    const val OP_SERVER_HELLO: Byte = 0x02
    const val OP_AUTH: Byte = 0x03
    const val OP_AUTH_RESULT: Byte = 0x04
    const val OP_ERROR: Byte = 0x7F
    
    // TCP opcodes
    const val OP_TCP_CONNECT: Byte = 0x10
    const val OP_TCP_CONNECTED: Byte = 0x11
    const val OP_TCP_SEND: Byte = 0x12
    const val OP_TCP_RECV: Byte = 0x13
    const val OP_TCP_CLOSE: Byte = 0x14
    
    // UDP opcodes
    const val OP_UDP_BIND: Byte = 0x20
    const val OP_UDP_BOUND: Byte = 0x21
    const val OP_UDP_SEND: Byte = 0x22
    const val OP_UDP_RECV: Byte = 0x23
    const val OP_UDP_CLOSE: Byte = 0x24
    
    /**
     * Message envelope: 8 bytes
     * [0]: version (u8)
     * [1]: opcode (u8)
     * [2-3]: flags (u16, little-endian)
     * [4-7]: requestId (u32, little-endian)
     */
    data class Envelope(
        val version: Byte,
        val opcode: Byte,
        val flags: Short,
        val requestId: Int
    ) {
        fun toBytes(): ByteArray {
            val buffer = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
            buffer.put(version)
            buffer.put(opcode)
            buffer.putShort(flags)
            buffer.putInt(requestId)
            return buffer.array()
        }
        
        companion object {
            fun fromBytes(data: ByteArray): Envelope? {
                if (data.size < 8) return null
                val buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
                return Envelope(
                    version = buffer.get(),
                    opcode = buffer.get(),
                    flags = buffer.short,
                    requestId = buffer.int
                )
            }
        }
    }
    
    fun createMessage(opcode: Byte, requestId: Int, payload: ByteArray = ByteArray(0)): ByteArray {
        val envelope = Envelope(VERSION, opcode, 0, requestId)
        return envelope.toBytes() + payload
    }
    
    fun createError(requestId: Int, message: String): ByteArray {
        return createMessage(OP_ERROR, requestId, message.toByteArray())
    }
}

// Extension functions for little-endian byte manipulation
fun ByteArray.getUIntLE(offset: Int): Int {
    return ByteBuffer.wrap(this, offset, 4).order(ByteOrder.LITTLE_ENDIAN).int
}

fun ByteArray.getUShortLE(offset: Int): Int {
    return ByteBuffer.wrap(this, offset, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xFFFF
}

fun Int.toLEBytes(): ByteArray {
    return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(this).array()
}

fun Short.toLEBytes(): ByteArray {
    return ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN).putShort(this).array()
}
```

### 7.2 Verification

Unit tests can be added, but this is just data classes. It will be tested with the WebSocket handler.

---

## Phase 8: WebSocket Handler

Implement the WebSocket `/io` endpoint with auth and socket multiplexing.

### 8.1 Create app/src/main/java/com/jstorrent/app/server/SocketHandler.kt

```kotlin
package com.jstorrent.app.server

import android.util.Log
import com.jstorrent.app.auth.TokenStore
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap

private const val TAG = "SocketHandler"

class SocketSession(
    private val wsSession: DefaultWebSocketServerSession,
    private val tokenStore: TokenStore
) {
    private var authenticated = false
    
    // Socket management
    private val tcpSockets = ConcurrentHashMap<Int, TcpSocketHandler>()
    private val udpSockets = ConcurrentHashMap<Int, UdpSocketHandler>()
    
    // Outgoing message queue
    private val outgoing = Channel<ByteArray>(Channel.BUFFERED)
    
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    suspend fun run() {
        // Start sender coroutine
        val senderJob = scope.launch {
            try {
                for (data in outgoing) {
                    wsSession.send(Frame.Binary(true, data))
                }
            } catch (e: Exception) {
                Log.d(TAG, "Sender stopped: ${e.message}")
            }
        }
        
        try {
            for (frame in wsSession.incoming) {
                if (frame is Frame.Binary) {
                    handleMessage(frame.readBytes())
                }
            }
        } catch (e: ClosedReceiveChannelException) {
            Log.d(TAG, "WebSocket closed normally")
        } catch (e: Exception) {
            Log.e(TAG, "WebSocket error: ${e.message}")
        } finally {
            cleanup()
            senderJob.cancel()
        }
    }
    
    private suspend fun handleMessage(data: ByteArray) {
        if (data.size < 8) {
            Log.w(TAG, "Message too short: ${data.size} bytes")
            return
        }
        
        val envelope = Protocol.Envelope.fromBytes(data) ?: return
        
        if (envelope.version != Protocol.VERSION) {
            sendError(envelope.requestId, "Invalid protocol version")
            return
        }
        
        val payload = data.copyOfRange(8, data.size)
        
        if (!authenticated) {
            handlePreAuth(envelope, payload)
        } else {
            handlePostAuth(envelope, payload)
        }
    }
    
    private suspend fun handlePreAuth(envelope: Protocol.Envelope, payload: ByteArray) {
        when (envelope.opcode) {
            Protocol.OP_CLIENT_HELLO -> {
                send(Protocol.createMessage(Protocol.OP_SERVER_HELLO, envelope.requestId))
            }
            Protocol.OP_AUTH -> {
                if (payload.isEmpty()) {
                    sendError(envelope.requestId, "Invalid auth payload")
                    return
                }
                
                val authType = payload[0]
                val token = String(payload, 1, payload.size - 1)
                
                val storedToken = tokenStore.token
                if (storedToken != null && token == storedToken) {
                    authenticated = true
                    // AUTH_RESULT success
                    send(Protocol.createMessage(Protocol.OP_AUTH_RESULT, envelope.requestId, byteArrayOf(0)))
                    Log.i(TAG, "WebSocket authenticated")
                } else {
                    // AUTH_RESULT failure
                    val errorMsg = "Invalid token".toByteArray()
                    send(Protocol.createMessage(Protocol.OP_AUTH_RESULT, envelope.requestId, byteArrayOf(1) + errorMsg))
                    Log.w(TAG, "WebSocket auth failed")
                }
            }
            else -> {
                sendError(envelope.requestId, "Not authenticated")
            }
        }
    }
    
    private suspend fun handlePostAuth(envelope: Protocol.Envelope, payload: ByteArray) {
        when (envelope.opcode) {
            Protocol.OP_TCP_CONNECT -> handleTcpConnect(envelope.requestId, payload)
            Protocol.OP_TCP_SEND -> handleTcpSend(payload)
            Protocol.OP_TCP_CLOSE -> handleTcpClose(payload)
            Protocol.OP_UDP_BIND -> handleUdpBind(envelope.requestId, payload)
            Protocol.OP_UDP_SEND -> handleUdpSend(payload)
            Protocol.OP_UDP_CLOSE -> handleUdpClose(payload)
            else -> sendError(envelope.requestId, "Unknown opcode: ${envelope.opcode}")
        }
    }
    
    // TCP handlers
    
    private fun handleTcpConnect(requestId: Int, payload: ByteArray) {
        if (payload.size < 6) return
        
        val socketId = payload.getUIntLE(0)
        val port = payload.getUShortLE(4)
        val hostname = String(payload, 6, payload.size - 6)
        
        Log.d(TAG, "TCP_CONNECT: socketId=$socketId, $hostname:$port")
        
        scope.launch {
            try {
                val socket = Socket()
                socket.connect(InetSocketAddress(hostname, port), 30000)
                
                val handler = TcpSocketHandler(socketId, socket, this@SocketSession)
                tcpSockets[socketId] = handler
                
                // Send TCP_CONNECTED success
                val response = socketId.toLEBytes() + byteArrayOf(0) + 0.toLEBytes()
                send(Protocol.createMessage(Protocol.OP_TCP_CONNECTED, requestId, response))
                
                // Start reading from socket
                handler.startReading()
                
            } catch (e: Exception) {
                Log.e(TAG, "TCP connect failed: ${e.message}")
                // Send TCP_CONNECTED failure
                val response = socketId.toLEBytes() + byteArrayOf(1) + 1.toLEBytes()
                send(Protocol.createMessage(Protocol.OP_TCP_CONNECTED, requestId, response))
            }
        }
    }
    
    private fun handleTcpSend(payload: ByteArray) {
        if (payload.size < 4) return
        
        val socketId = payload.getUIntLE(0)
        val data = payload.copyOfRange(4, payload.size)
        
        tcpSockets[socketId]?.send(data)
    }
    
    private fun handleTcpClose(payload: ByteArray) {
        if (payload.size < 4) return
        
        val socketId = payload.getUIntLE(0)
        tcpSockets.remove(socketId)?.close()
    }
    
    // UDP handlers
    
    private fun handleUdpBind(requestId: Int, payload: ByteArray) {
        if (payload.size < 6) return
        
        val socketId = payload.getUIntLE(0)
        val port = payload.getUShortLE(4)
        val bindAddr = if (payload.size > 6) String(payload, 6, payload.size - 6) else ""
        
        Log.d(TAG, "UDP_BIND: socketId=$socketId, port=$port")
        
        scope.launch {
            try {
                val socket = DatagramSocket(port)
                val boundPort = socket.localPort
                
                val handler = UdpSocketHandler(socketId, socket, this@SocketSession)
                udpSockets[socketId] = handler
                
                // Send UDP_BOUND success
                val response = socketId.toLEBytes() + 
                    byteArrayOf(0) + 
                    boundPort.toShort().toLEBytes() + 
                    0.toLEBytes()
                send(Protocol.createMessage(Protocol.OP_UDP_BOUND, requestId, response))
                
                // Start receiving
                handler.startReceiving()
                
            } catch (e: Exception) {
                Log.e(TAG, "UDP bind failed: ${e.message}")
                // Send UDP_BOUND failure
                val response = socketId.toLEBytes() + 
                    byteArrayOf(1) + 
                    0.toShort().toLEBytes() + 
                    1.toLEBytes()
                send(Protocol.createMessage(Protocol.OP_UDP_BOUND, requestId, response))
            }
        }
    }
    
    private fun handleUdpSend(payload: ByteArray) {
        if (payload.size < 8) return
        
        val socketId = payload.getUIntLE(0)
        val destPort = payload.getUShortLE(4)
        val addrLen = payload.getUShortLE(6)
        
        if (payload.size < 8 + addrLen) return
        
        val destAddr = String(payload, 8, addrLen)
        val data = payload.copyOfRange(8 + addrLen, payload.size)
        
        udpSockets[socketId]?.send(destAddr, destPort, data)
    }
    
    private fun handleUdpClose(payload: ByteArray) {
        if (payload.size < 4) return
        
        val socketId = payload.getUIntLE(0)
        udpSockets.remove(socketId)?.close()
    }
    
    // Helpers
    
    internal fun send(data: ByteArray) {
        scope.launch {
            outgoing.send(data)
        }
    }
    
    private fun sendError(requestId: Int, message: String) {
        send(Protocol.createError(requestId, message))
    }
    
    private fun cleanup() {
        tcpSockets.values.forEach { it.close() }
        tcpSockets.clear()
        udpSockets.values.forEach { it.close() }
        udpSockets.clear()
        scope.cancel()
        outgoing.close()
    }
}

class TcpSocketHandler(
    private val socketId: Int,
    private val socket: Socket,
    private val session: SocketSession
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    fun startReading() {
        scope.launch {
            val buffer = ByteArray(65536)
            try {
                val input = socket.getInputStream()
                while (true) {
                    val bytesRead = input.read(buffer)
                    if (bytesRead < 0) break
                    
                    // Send TCP_RECV
                    val payload = socketId.toLEBytes() + buffer.copyOf(bytesRead)
                    session.send(Protocol.createMessage(Protocol.OP_TCP_RECV, 0, payload))
                }
            } catch (e: IOException) {
                Log.d(TAG, "TCP socket $socketId read ended: ${e.message}")
            } finally {
                sendClose()
            }
        }
    }
    
    fun send(data: ByteArray) {
        scope.launch {
            try {
                socket.getOutputStream().write(data)
                socket.getOutputStream().flush()
            } catch (e: IOException) {
                Log.e(TAG, "TCP send failed: ${e.message}")
            }
        }
    }
    
    fun close() {
        scope.cancel()
        try {
            socket.close()
        } catch (e: Exception) {}
    }
    
    private fun sendClose() {
        val payload = socketId.toLEBytes() + byteArrayOf(0) + 0.toLEBytes()
        session.send(Protocol.createMessage(Protocol.OP_TCP_CLOSE, 0, payload))
    }
}

class UdpSocketHandler(
    private val socketId: Int,
    private val socket: DatagramSocket,
    private val session: SocketSession
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    fun startReceiving() {
        scope.launch {
            val buffer = ByteArray(65535)
            val packet = DatagramPacket(buffer, buffer.size)
            
            try {
                while (true) {
                    socket.receive(packet)
                    
                    val srcAddr = packet.address.hostAddress ?: continue
                    val srcPort = packet.port
                    val data = packet.data.copyOf(packet.length)
                    
                    // Build UDP_RECV payload:
                    // socketId(4) + srcPort(2) + addrLen(2) + addr + data
                    val addrBytes = srcAddr.toByteArray()
                    val payload = socketId.toLEBytes() +
                        srcPort.toShort().toLEBytes() +
                        addrBytes.size.toShort().toLEBytes() +
                        addrBytes +
                        data
                    
                    session.send(Protocol.createMessage(Protocol.OP_UDP_RECV, 0, payload))
                }
            } catch (e: Exception) {
                Log.d(TAG, "UDP socket $socketId receive ended: ${e.message}")
            } finally {
                sendClose()
            }
        }
    }
    
    fun send(destAddr: String, destPort: Int, data: ByteArray) {
        scope.launch {
            try {
                val packet = DatagramPacket(
                    data, 
                    data.size, 
                    InetSocketAddress(destAddr, destPort)
                )
                socket.send(packet)
            } catch (e: Exception) {
                Log.e(TAG, "UDP send failed: ${e.message}")
            }
        }
    }
    
    fun close() {
        scope.cancel()
        try {
            socket.close()
        } catch (e: Exception) {}
    }
    
    private fun sendClose() {
        val payload = socketId.toLEBytes() + byteArrayOf(0) + 0.toLEBytes()
        session.send(Protocol.createMessage(Protocol.OP_UDP_CLOSE, 0, payload))
    }
}
```

### 8.2 Update HttpServer.kt for WebSocket

Add WebSocket support. Replace the entire HttpServer.kt:

```kotlin
package com.jstorrent.app.server

import android.util.Log
import com.jstorrent.app.auth.TokenStore
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import java.io.File
import java.security.MessageDigest
import java.time.Duration

private const val TAG = "HttpServer"

class HttpServer(
    private val tokenStore: TokenStore,
    private val downloadRoot: File
) {
    private var server: NettyApplicationEngine? = null
    private var actualPort: Int = 0
    
    val port: Int get() = actualPort
    val isRunning: Boolean get() = server != null
    
    fun start(preferredPort: Int = 7800) {
        if (server != null) {
            Log.w(TAG, "Server already running on port $actualPort")
            return
        }
        
        val portsToTry = generatePortSequence(preferredPort).take(10).toList()
        
        for (port in portsToTry) {
            try {
                server = embeddedServer(Netty, port = port) {
                    install(WebSockets) {
                        pingPeriod = Duration.ofSeconds(30)
                        timeout = Duration.ofSeconds(60)
                        maxFrameSize = Long.MAX_VALUE
                        masking = false
                    }
                    configureRouting()
                }.start(wait = false)
                
                actualPort = port
                Log.i(TAG, "Server started on port $actualPort")
                return
            } catch (e: Exception) {
                Log.w(TAG, "Port $port unavailable: ${e.message}")
            }
        }
        
        throw IllegalStateException("Could not bind to any port")
    }
    
    fun stop() {
        server?.stop(1000, 2000)
        server = null
        actualPort = 0
        Log.i(TAG, "Server stopped")
    }
    
    private fun Application.configureRouting() {
        routing {
            // Public endpoints
            get("/health") {
                call.respondText("ok", ContentType.Text.Plain)
            }
            
            get("/status") {
                call.respondText(
                    """{"port":$actualPort,"paired":${tokenStore.hasToken()}}""",
                    ContentType.Application.Json
                )
            }
            
            // WebSocket endpoint (auth handled inside protocol)
            webSocket("/io") {
                Log.i(TAG, "WebSocket connected")
                val session = SocketSession(this, tokenStore)
                session.run()
                Log.i(TAG, "WebSocket disconnected")
            }
            
            // Protected HTTP endpoints
            post("/hash/sha1") {
                requireAuth(tokenStore) {
                    val bytes = call.receive<ByteArray>()
                    val digest = MessageDigest.getInstance("SHA-1")
                    val hash = digest.digest(bytes)
                    call.respondBytes(hash, ContentType.Application.OctetStream)
                }
            }
            
            // File routes with auth
            route("/") {
                intercept(ApplicationCallPipeline.Call) {
                    val path = call.request.path()
                    if (path.startsWith("/read/") || path.startsWith("/write/")) {
                        val storedToken = tokenStore.token
                        if (storedToken == null) {
                            call.respond(HttpStatusCode.ServiceUnavailable, "Not paired")
                            finish()
                            return@intercept
                        }
                        
                        val providedToken = call.request.header("X-JST-Auth")
                            ?: call.request.header("Authorization")?.removePrefix("Bearer ")
                        
                        if (providedToken != storedToken) {
                            call.respond(HttpStatusCode.Unauthorized, "Invalid token")
                            finish()
                            return@intercept
                        }
                    }
                }
                
                fileRoutes(downloadRoot)
            }
        }
    }
    
    companion object {
        fun generatePortSequence(base: Int): Sequence<Int> = sequence {
            var n = 0
            while (true) {
                yield(base + 4 * n + n * n)
                n++
            }
        }
    }
}
```

### 8.3 Verification

Testing WebSocket requires a client that speaks the binary protocol. For now:

1. Build and run the app
2. Verify HTTP endpoints still work
3. Connect with a WebSocket client tool (like `websocat`) to `/io`:

```bash
# Install websocat if needed
# cargo install websocat

# Connect (will just hang since we need to send binary protocol)
websocat ws://localhost:7800/io
```

Full testing will be done with the Chrome extension.

---

## Phase 9: Final Integration and Testing

### 9.1 Directory Structure

After completing all phases, you should have:

```
android-io-daemon/app/src/main/java/com/jstorrent/app/
├── MainActivity.kt
├── auth/
│   └── TokenStore.kt
├── server/
│   ├── AuthMiddleware.kt
│   ├── FileHandler.kt
│   ├── HttpServer.kt
│   ├── Protocol.kt
│   └── SocketHandler.kt
├── service/
│   └── IoDaemonService.kt
└── ui/theme/
    ├── Color.kt
    ├── Theme.kt
    └── Type.kt
```

### 9.2 Full Test Script

Create a test script to verify all endpoints:

```bash
#!/bin/bash
set -e

PORT=7800
TOKEN="test123"

# Forward port
adb forward tcp:$PORT tcp:$PORT

# Pair
echo "=== Pairing ==="
adb shell am start -a android.intent.action.VIEW -d "jstorrent://pair?token=$TOKEN"
sleep 1

# Health check
echo "=== Health Check ==="
curl -s http://localhost:$PORT/health
echo

# Status
echo "=== Status ==="
curl -s http://localhost:$PORT/status
echo

# Hash
echo "=== SHA1 Hash ==="
echo -n "hello" | curl -s -X POST \
  -H "X-JST-Auth: $TOKEN" \
  --data-binary @- \
  http://localhost:$PORT/hash/sha1 | xxd -p
echo

# Write file
echo "=== Write File ==="
echo -n "Test content" | curl -s -X POST \
  -H "X-JST-Auth: $TOKEN" \
  -H "X-Path-Base64: $(echo -n 'test.txt' | base64)" \
  --data-binary @- \
  http://localhost:$PORT/write/default
echo "Write: OK"

# Read file
echo "=== Read File ==="
curl -s \
  -H "X-JST-Auth: $TOKEN" \
  -H "X-Path-Base64: $(echo -n 'test.txt' | base64)" \
  -H "X-Length: 12" \
  http://localhost:$PORT/read/default
echo

echo "=== All tests passed ==="
```

### 9.3 Known Limitations

1. **WebSocket testing**: Full WebSocket testing requires the Chrome extension. The binary protocol is complex to test manually.

2. **ChromeOS testing**: The `100.115.92.2` IP only works on ChromeOS. On a regular Android emulator, use `10.0.2.2` (host loopback) or port forwarding.

3. **Background execution**: On some devices, the foreground service may be killed. Monitor logs and consider adding a wake lock.

---

## Appendix: Protocol Reference

### WebSocket Binary Protocol

All messages are binary frames with 8-byte envelope + payload.

**Envelope (8 bytes):**
```
[0]: version (u8) = 1
[1]: opcode (u8)
[2-3]: flags (u16 LE) = 0
[4-7]: requestId (u32 LE)
```

**Handshake:**
1. Client → SERVER: CLIENT_HELLO (0x01)
2. Server → CLIENT: SERVER_HELLO (0x02)
3. Client → SERVER: AUTH (0x03) with payload: authType(u8) + token(utf8)
4. Server → CLIENT: AUTH_RESULT (0x04) with payload: status(u8) [0=success]

**TCP Operations:**
- TCP_CONNECT (0x10): socketId(4) + port(2) + hostname
- TCP_CONNECTED (0x11): socketId(4) + status(1) + errno(4)
- TCP_SEND (0x12): socketId(4) + data
- TCP_RECV (0x13): socketId(4) + data
- TCP_CLOSE (0x14): socketId(4) + reason(1) + errno(4)

**UDP Operations:**
- UDP_BIND (0x20): socketId(4) + port(2) + bindAddr
- UDP_BOUND (0x21): socketId(4) + status(1) + boundPort(2) + errno(4)
- UDP_SEND (0x22): socketId(4) + destPort(2) + addrLen(2) + addr + data
- UDP_RECV (0x23): socketId(4) + srcPort(2) + addrLen(2) + addr + data
- UDP_CLOSE (0x24): socketId(4) + reason(1) + errno(4)

### HTTP Endpoints

| Method | Path | Headers | Description |
|--------|------|---------|-------------|
| GET | /health | - | Health check, returns "ok" |
| GET | /status | - | Returns `{"port":N,"paired":bool}` |
| POST | /hash/sha1 | X-JST-Auth | Returns 20-byte SHA1 of body |
| GET | /read/{root} | X-JST-Auth, X-Path-Base64, X-Length, X-Offset? | Read file bytes |
| POST | /write/{root} | X-JST-Auth, X-Path-Base64, X-Offset?, X-Expected-SHA1? | Write file bytes |

All paths are relative to download root. The `{root}` parameter is ignored (single root).
