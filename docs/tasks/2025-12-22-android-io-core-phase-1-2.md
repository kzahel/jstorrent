# Android IO Core Extraction - Phase 1+2

**Parent Task:** `2025-12-22-android-io-core-extraction-super-task.md`
**Status:** Complete
**Risk:** Low
**Effort:** Small

---

## Overview

This phase creates the module structure for the io-core extraction:

1. **Phase 1:** Create empty `io-core` and `companion-server` Gradle modules
2. **Phase 2:** Move `Protocol.kt` to io-core (first real code move)

After this phase, we have the module scaffolding in place and have proven the dependency wiring works with a simple code migration.

---

## Phase 1: Module Scaffolding

### 1.1 Add android-library plugin to version catalog

Edit `gradle/libs.versions.toml`:

```toml
[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
android-library = { id = "com.android.library", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
```

### 1.2 Update settings.gradle.kts

Replace contents of `settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "JSTorrent"
include(":io-core")
include(":companion-server")
include(":app")
```

### 1.3 Create io-core module structure

Create directory structure:
```
io-core/
├── build.gradle.kts
└── src/main/
    ├── AndroidManifest.xml
    └── java/com/jstorrent/io/
        └── .gitkeep
```

Create `io-core/build.gradle.kts`:

```kotlin
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.jstorrent.io"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
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
}

dependencies {
    // Coroutines for async socket/file operations
    implementation(libs.kotlinx.coroutines.android)
    
    // DocumentFile for SAF operations (will be needed for FileManager)
    implementation(libs.androidx.documentfile)
    
    testImplementation(libs.junit)
}
```

Create `io-core/src/main/AndroidManifest.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- Library module - no application element needed -->
</manifest>
```

Create empty placeholder `io-core/src/main/java/com/jstorrent/io/.gitkeep` (or just the directory).

Create `io-core/proguard-rules.pro`:
```
# Add project specific ProGuard rules here.
```

Create `io-core/consumer-rules.pro`:
```
# Consumer rules for io-core library
```

### 1.4 Create companion-server module structure

Create directory structure:
```
companion-server/
├── build.gradle.kts
└── src/main/
    ├── AndroidManifest.xml
    └── java/com/jstorrent/companion/
        └── .gitkeep
```

Create `companion-server/build.gradle.kts`:

```kotlin
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.jstorrent.companion"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
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
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "/META-INF/INDEX.LIST"
            excludes += "/META-INF/io.netty.versions.properties"
        }
    }
}

dependencies {
    // Depend on io-core
    implementation(project(":io-core"))
    
    // Ktor server (HTTP/WebSocket)
    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.netty)
    implementation(libs.ktor.server.websockets)
    
    // Coroutines
    implementation(libs.kotlinx.coroutines.android)
    
    // JSON serialization
    implementation(libs.kotlinx.serialization.json)
    
    testImplementation(libs.junit)
}
```

Create `companion-server/src/main/AndroidManifest.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- Library module - no application element needed -->
</manifest>
```

Create empty placeholder `companion-server/src/main/java/com/jstorrent/companion/.gitkeep`.

Create `companion-server/proguard-rules.pro`:
```
# Add project specific ProGuard rules here.
```

Create `companion-server/consumer-rules.pro`:
```
# Consumer rules for companion-server library
```

### 1.5 Update app module dependencies

Edit `app/build.gradle.kts` dependencies section:

```kotlin
dependencies {
    // New: depend on our library modules
    implementation(project(":io-core"))
    implementation(project(":companion-server"))
    
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)

    // Ktor server - KEEP for now, will move to companion-server later
    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.netty)
    implementation(libs.ktor.server.websockets)

    // Coroutines
    implementation(libs.kotlinx.coroutines.android)

    // Serialization
    implementation(libs.kotlinx.serialization.json)

    // SAF DocumentFile support
    implementation(libs.androidx.documentfile)

    // AppCompat (needed for AddRootActivity)
    implementation(libs.androidx.appcompat)

    // WebKit (for WebViewAssetLoader)
    implementation(libs.androidx.webkit)

    testImplementation(libs.junit)
    testImplementation(libs.java.websocket)
    testImplementation(libs.kotlinx.serialization.json)
    testImplementation("org.mockito.kotlin:mockito-kotlin:5.2.1")
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
```

### 1.6 Verify build

```bash
cd android-io-daemon
./gradlew clean
./gradlew assembleDebug
```

Expected: Build succeeds with empty library modules.

---

## Phase 2: Move Protocol.kt

### 2.1 Create protocol package in io-core

Create `io-core/src/main/java/com/jstorrent/io/protocol/Protocol.kt`:

```kotlin
package com.jstorrent.io.protocol

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

    // TCP Server opcodes
    const val OP_TCP_LISTEN: Byte = 0x15
    const val OP_TCP_LISTEN_RESULT: Byte = 0x16
    const val OP_TCP_ACCEPT: Byte = 0x17
    const val OP_TCP_STOP_LISTEN: Byte = 0x18

    // TLS upgrade opcodes
    const val OP_TCP_SECURE: Byte = 0x19
    const val OP_TCP_SECURED: Byte = 0x1A

    // UDP opcodes
    const val OP_UDP_BIND: Byte = 0x20
    const val OP_UDP_BOUND: Byte = 0x21
    const val OP_UDP_SEND: Byte = 0x22
    const val OP_UDP_RECV: Byte = 0x23
    const val OP_UDP_CLOSE: Byte = 0x24
    const val OP_UDP_JOIN_MULTICAST: Byte = 0x25
    const val OP_UDP_LEAVE_MULTICAST: Byte = 0x26

    // Control plane opcodes (0xE0-0xEF)
    const val OP_CTRL_ROOTS_CHANGED: Byte = 0xE0.toByte()
    const val OP_CTRL_EVENT: Byte = 0xE1.toByte()
    const val OP_CTRL_OPEN_FOLDER_PICKER: Byte = 0xE2.toByte()

    // Opcode sets for route validation
    val HANDSHAKE_OPCODES = setOf(
        OP_CLIENT_HELLO, OP_SERVER_HELLO, OP_AUTH, OP_AUTH_RESULT, OP_ERROR
    )

    val IO_OPCODES = HANDSHAKE_OPCODES + setOf(
        OP_TCP_CONNECT, OP_TCP_CONNECTED, OP_TCP_SEND, OP_TCP_RECV, OP_TCP_CLOSE,
        OP_TCP_LISTEN, OP_TCP_LISTEN_RESULT, OP_TCP_ACCEPT, OP_TCP_STOP_LISTEN,
        OP_TCP_SECURE, OP_TCP_SECURED,
        OP_UDP_BIND, OP_UDP_BOUND, OP_UDP_SEND, OP_UDP_RECV, OP_UDP_CLOSE,
        OP_UDP_JOIN_MULTICAST, OP_UDP_LEAVE_MULTICAST
    )

    val CONTROL_OPCODES = HANDSHAKE_OPCODES + setOf(
        OP_CTRL_ROOTS_CHANGED, OP_CTRL_EVENT, OP_CTRL_OPEN_FOLDER_PICKER
    )

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

### 2.2 Delete old Protocol.kt

Delete `app/src/main/java/com/jstorrent/app/server/Protocol.kt`

### 2.3 Update imports in app module

Files that import Protocol need their imports updated.

**Find files to update:**
```bash
grep -r "com.jstorrent.app.server.Protocol" app/src/main/java/
grep -r "import.*Protocol" app/src/main/java/
grep -r "getUIntLE\|getUShortLE\|toLEBytes" app/src/main/java/
```

**Expected files needing updates:**
- `app/src/main/java/com/jstorrent/app/server/SocketHandler.kt`
- `app/src/main/java/com/jstorrent/app/server/HttpServer.kt`

**Update pattern:**

Replace:
```kotlin
import com.jstorrent.app.server.Protocol
import com.jstorrent.app.server.getUIntLE
import com.jstorrent.app.server.getUShortLE
import com.jstorrent.app.server.toLEBytes
```

With:
```kotlin
import com.jstorrent.io.protocol.Protocol
import com.jstorrent.io.protocol.getUIntLE
import com.jstorrent.io.protocol.getUShortLE
import com.jstorrent.io.protocol.toLEBytes
```

### 2.4 Verify build and tests

```bash
cd android-io-daemon
./gradlew clean
./gradlew assembleDebug
./gradlew test
```

Expected: All pass.

---

## Verification Checklist

- [x] `./gradlew assembleDebug` succeeds
- [x] `./gradlew test` passes
- [x] `io-core` module exists with Protocol.kt
- [x] `companion-server` module exists (empty except for build config)
- [x] `app` module depends on both library modules
- [x] No `com.jstorrent.app.server.Protocol` imports remain in app module
- [ ] Install APK on device and verify extension still connects (optional but recommended)

---

## Next Phase

After this phase completes, proceed to **Phase 3: Extract Hasher** - creates `Hasher` class in io-core with SHA-1/SHA-256 operations, currently inline in FileHandler.kt.
