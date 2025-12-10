# Remove Salt from Storage Root Key Generation

**Date:** 2025-12-10  
**Status:** Ready for implementation

## Overview

Storage root keys are generated using `sha256(salt + path/uri)`. The salt is randomly generated per installation and persisted locally. When the native app is reinstalled or data is cleared, the salt regenerates, causing all existing storage root keys to become invalid. This breaks torrent session restoration since torrents reference storage roots by key.

**Solution:** Remove the salt entirely. Use `sha256(path/uri)` directly. The salt provides no meaningful security benefit since paths/URIs aren't secret, and the key is only used as an internal identifier.

## Files to Modify

### Android (Kotlin)

| File | Changes |
|------|---------|
| `android-io-daemon/app/src/main/java/com/jstorrent/app/storage/RootStore.kt` | Remove salt from key generation |
| `android-io-daemon/app/src/test/java/com/jstorrent/app/storage/RootStoreTest.kt` | Update tests |

### Desktop (Rust)

| File | Changes |
|------|---------|
| `native-host/src/lib.rs` | Remove `salt` field from `ProfileEntry` |
| `native-host/src/rpc.rs` | Remove `salt` field from `RpcInfo`, simplify `write_discovery_file` |
| `native-host/src/main.rs` | Remove salt generation and handling |
| `native-host/src/folder_picker.rs` | Remove salt from key generation |

---

## Phase 1: Android Changes

### 1.1 Update RootStore.kt

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/storage/RootStore.kt`

Remove salt from key generation. The key should be deterministic based solely on the URI.

**Find this (lines 23-27):**
```kotlin
    @Serializable
    private data class RootConfig(
        val salt: String,
        val roots: List<DownloadRoot>
    )
```

**Replace with:**
```kotlin
    @Serializable
    private data class RootConfig(
        val roots: List<DownloadRoot>
    )
```

**Find this (lines 147-161):**
```kotlin
    private fun loadOrCreate(): RootConfig {
        if (!configFile.exists()) {
            return RootConfig(
                salt = generateSalt(),
                roots = emptyList()
            )
        }

        return try {
            json.decodeFromString<RootConfig>(configFile.readText())
        } catch (e: Exception) {
            // Corrupted file, start fresh but log warning
            android.util.Log.w(TAG, "Failed to load roots config, starting fresh", e)
            RootConfig(salt = generateSalt(), roots = emptyList())
        }
    }
```

**Replace with:**
```kotlin
    private fun loadOrCreate(): RootConfig {
        if (!configFile.exists()) {
            return RootConfig(roots = emptyList())
        }

        return try {
            json.decodeFromString<RootConfig>(configFile.readText())
        } catch (e: Exception) {
            // Corrupted file, start fresh but log warning
            android.util.Log.w(TAG, "Failed to load roots config, starting fresh", e)
            RootConfig(roots = emptyList())
        }
    }
```

**Find and delete this function (lines 168-172):**
```kotlin
    private fun generateSalt(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
```

**Find this (lines 174-180):**
```kotlin
    private fun generateKey(uri: Uri): String {
        val input = config.salt + uri.toString()
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(input.toByteArray())
        // Return first 16 hex chars (64 bits) - enough for uniqueness
        return hash.take(8).joinToString("") { "%02x".format(it) }
    }
```

**Replace with:**
```kotlin
    private fun generateKey(uri: Uri): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(uri.toString().toByteArray())
        // Return first 16 hex chars (64 bits) - enough for uniqueness
        return hash.take(8).joinToString("") { "%02x".format(it) }
    }
```

**Find and delete this import (line 11):**
```kotlin
import java.security.SecureRandom
```

### 1.2 Update RootStoreTest.kt

**File:** `android-io-daemon/app/src/test/java/com/jstorrent/app/storage/RootStoreTest.kt`

Update tests to reflect salt-free key generation.

**Find this test (lines 18-27):**
```kotlin
    @Test
    fun `key generation is deterministic`() {
        val salt = "abc123"
        val uri = "content://com.android.externalstorage.documents/tree/primary%3ADownload"

        val key1 = generateTestKey(salt, uri)
        val key2 = generateTestKey(salt, uri)

        assertEquals(key1, key2)
    }
```

**Replace with:**
```kotlin
    @Test
    fun `key generation is deterministic`() {
        val uri = "content://com.android.externalstorage.documents/tree/primary%3ADownload"

        val key1 = generateTestKey(uri)
        val key2 = generateTestKey(uri)

        assertEquals(key1, key2)
    }
```

**Find this test (lines 29-39):**
```kotlin
    @Test
    fun `key generation produces different keys for different URIs`() {
        val salt = "abc123"
        val uri1 = "content://documents/tree/primary%3ADownload"
        val uri2 = "content://documents/tree/primary%3AMovies"

        val key1 = generateTestKey(salt, uri1)
        val key2 = generateTestKey(salt, uri2)

        assertNotEquals(key1, key2)
    }
```

**Replace with:**
```kotlin
    @Test
    fun `key generation produces different keys for different URIs`() {
        val uri1 = "content://documents/tree/primary%3ADownload"
        val uri2 = "content://documents/tree/primary%3AMovies"

        val key1 = generateTestKey(uri1)
        val key2 = generateTestKey(uri2)

        assertNotEquals(key1, key2)
    }
```

**Find and delete this test entirely (lines 41-49):**
```kotlin
    @Test
    fun `key generation produces different keys for different salts`() {
        val uri = "content://documents/tree/primary%3ADownload"

        val key1 = generateTestKey("salt1", uri)
        val key2 = generateTestKey("salt2", uri)

        assertNotEquals(key1, key2)
    }
```

**Find this test (lines 51-57):**
```kotlin
    @Test
    fun `key is 16 hex characters`() {
        val key = generateTestKey("salt", "content://test")

        assertEquals(16, key.length)
        assertTrue(key.all { it in '0'..'9' || it in 'a'..'f' })
    }
```

**Replace with:**
```kotlin
    @Test
    fun `key is 16 hex characters`() {
        val key = generateTestKey("content://test")

        assertEquals(16, key.length)
        assertTrue(key.all { it in '0'..'9' || it in 'a'..'f' })
    }
```

**Find this helper (lines 186-191):**
```kotlin
    private fun generateTestKey(salt: String, uri: String): String {
        val input = salt + uri
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(input.toByteArray())
        return hash.take(8).joinToString("") { "%02x".format(it) }
    }
```

**Replace with:**
```kotlin
    private fun generateTestKey(uri: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(uri.toByteArray())
        return hash.take(8).joinToString("") { "%02x".format(it) }
    }
```

---

## Phase 2: Desktop (Rust) Changes

### 2.1 Update lib.rs

**File:** `native-host/src/lib.rs`

Remove `salt` field from `ProfileEntry`.

**Find this (lines 10-23):**
```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProfileEntry {
    // Removed profile_dir as requested
    pub extension_id: Option<String>,
    pub install_id: Option<String>,
    pub salt: String,
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub started: u64,
    pub last_used: u64,
    pub browser: BrowserInfo,
    pub download_roots: Vec<DownloadRoot>,
}
```

**Replace with:**
```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProfileEntry {
    pub extension_id: Option<String>,
    pub install_id: Option<String>,
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub started: u64,
    pub last_used: u64,
    pub browser: BrowserInfo,
    pub download_roots: Vec<DownloadRoot>,
}
```

### 2.2 Update rpc.rs

**File:** `native-host/src/rpc.rs`

Remove `salt` field from `RpcInfo` and simplify `write_discovery_file`.

**Find this (lines 18-34):**
```rust
// Legacy struct used by main.rs, updated to carry necessary info
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RpcInfo {
    // version is now file-level, but we keep it here for compatibility or remove it?
    // main.rs sets it to 1.
    pub version: u32, 
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub started: u64,
    pub last_used: u64,
    pub browser: BrowserInfo,
    // New fields
    pub salt: String,
    pub download_roots: Vec<DownloadRoot>,
    pub install_id: Option<String>,
}
```

**Replace with:**
```rust
// Legacy struct used by main.rs, updated to carry necessary info
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RpcInfo {
    pub version: u32, 
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub started: u64,
    pub last_used: u64,
    pub browser: BrowserInfo,
    pub download_roots: Vec<DownloadRoot>,
    pub install_id: Option<String>,
}
```

**Find the `write_discovery_file` function signature (line 158):**
```rust
pub fn write_discovery_file(info: RpcInfo) -> anyhow::Result<(Vec<DownloadRoot>, String)> {
```

**Replace with:**
```rust
pub fn write_discovery_file(info: RpcInfo) -> anyhow::Result<Vec<DownloadRoot>> {
```

**Find this block (lines 214-215):**
```rust
    let active_roots;
    let active_salt;
```

**Replace with:**
```rust
    let active_roots;
```

**Find this block (lines 232-242):**
```rust
        // Check if we have the correct salt (meaning we are the owner/have loaded state)
        if entry.salt == info.salt {
            // We have the correct salt, so we trust our roots
            entry.download_roots = info.download_roots.clone();
        } else {
            // Salt mismatch (likely startup), preserve disk roots
        }
        
        active_roots = entry.download_roots.clone();
        active_salt = entry.salt.clone();
```

**Replace with:**
```rust
        // Update roots from info
        entry.download_roots = info.download_roots.clone();
        
        active_roots = entry.download_roots.clone();
```

**Find this block (lines 256-272):**
```rust
    } else {
        // New entry
        let new_entry = ProfileEntry {
            // Removed profile_dir
            extension_id: info.browser.extension_id.clone(),
            install_id: info.install_id.clone(),
            salt: info.salt.clone(),
            pid: info.pid,
            port: info.port,
            token: info.token.clone(),
            started: info.started,
            last_used: info.last_used,
            browser: info.browser.clone(),
            download_roots: info.download_roots.clone(),
        };
        active_roots = new_entry.download_roots.clone();
        active_salt = new_entry.salt.clone();
        unified_info.profiles.push(new_entry);
    }
```

**Replace with:**
```rust
    } else {
        // New entry
        let new_entry = ProfileEntry {
            extension_id: info.browser.extension_id.clone(),
            install_id: info.install_id.clone(),
            pid: info.pid,
            port: info.port,
            token: info.token.clone(),
            started: info.started,
            last_used: info.last_used,
            browser: info.browser.clone(),
            download_roots: info.download_roots.clone(),
        };
        active_roots = new_entry.download_roots.clone();
        unified_info.profiles.push(new_entry);
    }
```

**Find this (line 281):**
```rust
    Ok((active_roots, active_salt))
```

**Replace with:**
```rust
    Ok(active_roots)
```

### 2.3 Update main.rs

**File:** `native-host/src/main.rs`

Remove salt generation and update callers of `write_discovery_file`.

**Find this block (lines 117-132):**
```rust
    // Write discovery file
    let info = rpc::RpcInfo {
        version: 1,
        pid: std::process::id(),
        port,
        token,
        started: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        last_used: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        browser: rpc::BrowserInfo {
            name: browser_name,
            binary: browser_binary,
            extension_id: extension_id.clone(),
        },
        salt: uuid::Uuid::new_v4().to_string(),
        download_roots: Vec::new(),
        install_id: None,
    };
```

**Replace with:**
```rust
    // Write discovery file
    let info = rpc::RpcInfo {
        version: 1,
        pid: std::process::id(),
        port,
        token,
        started: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        last_used: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        browser: rpc::BrowserInfo {
            name: browser_name,
            binary: browser_binary,
            extension_id: extension_id.clone(),
        },
        download_roots: Vec::new(),
        install_id: None,
    };
```

**Find this block (lines 139-150):**
```rust
    match rpc::write_discovery_file(info) {
        Ok((roots, salt)) => {
            // Update roots and salt in state
            if let Ok(mut info_guard) = state.rpc_info.lock() {
                if let Some(info) = info_guard.as_mut() {
                    info.download_roots = roots;
                    info.salt = salt;
                }
            }
        },
        Err(e) => eprintln!("Failed to write discovery file: {}", e),
    }
```

**Replace with:**
```rust
    match rpc::write_discovery_file(info) {
        Ok(roots) => {
            // Update roots in state
            if let Ok(mut info_guard) = state.rpc_info.lock() {
                if let Some(info) = info_guard.as_mut() {
                    info.download_roots = roots;
                }
            }
        },
        Err(e) => eprintln!("Failed to write discovery file: {}", e),
    }
```

**Find this block (lines 251-255):**
```rust
                        Ok((roots, salt)) => {
                            info.download_roots = roots;
                            info.salt = salt;
                            success = true;
                        },
```

**Replace with:**
```rust
                        Ok(roots) => {
                            info.download_roots = roots;
                            success = true;
                        },
```

### 2.4 Update folder_picker.rs

**File:** `native-host/src/folder_picker.rs`

Remove salt from key generation.

**Find this block (lines 27-38):**
```rust
            // Get salt from rpc_info to generate stable key
            let salt = if let Ok(info_guard) = state.rpc_info.lock() {
                info_guard.as_ref().map(|i| i.salt.clone()).unwrap_or_default()
            } else {
                String::new()
            };

            // Generate stable key: sha256(salt + path)
            let mut hasher = Sha256::new();
            hasher.update(salt.as_bytes());
            hasher.update(path_str.as_bytes());
            let key = hex::encode(hasher.finalize());
```

**Replace with:**
```rust
            // Generate stable key: sha256(path)
            let mut hasher = Sha256::new();
            hasher.update(path_str.as_bytes());
            let hash = hasher.finalize();
            // Use first 16 hex chars (64 bits) for consistency with Android
            let key = hex::encode(&hash[..8]);
```

---

## Verification

### Android

```bash
cd android-io-daemon
./gradlew test --tests "com.jstorrent.app.storage.RootStoreTest"
```

Expected: All tests pass (4 tests after removing the salt-specific test).

### Desktop

```bash
cd native-host
cargo build --workspace
cargo test --workspace
```

Expected: Build succeeds with no warnings about unused fields.

### Manual Testing

1. Start the app, add a storage root
2. Note the key assigned (visible in logs or roots.json/rpc-info.json)
3. Clear app data / reinstall
4. Re-add the same folder
5. Verify the key is identical to step 2

---

## Notes

- No migration needed since there are no external users yet
- The key length is truncated to 16 hex chars (64 bits) which provides ample uniqueness for folder identification
- SHA-256 is used for consistency and availability (already a dependency in both codebases)
