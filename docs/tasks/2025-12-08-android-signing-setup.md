# Android Signing Setup - Agent Guide

## Overview

Set up Android app signing with:
- Debug keystore checked into repo (for local dev and contributors)
- Upload keystore via CI environment variables (for Play Store releases)
- Fallback behavior so `assembleRelease` works locally without upload key

## Phase 1: Create and Commit Debug Keystore

### 1.1 Generate debug keystore

```bash
cd android-io-daemon

keytool -genkey -v -keystore debug.keystore \
  -alias androiddebugkey \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass android -keypass android \
  -dname "CN=Debug, O=JSTorrent, C=US"
```

### 1.2 Ensure debug.keystore is NOT in .gitignore

Check `android-io-daemon/.gitignore` - make sure `debug.keystore` is not ignored. It should be committed.

The `upload.keystore` SHOULD remain in .gitignore (or add it if missing).

### 1.3 Commit debug.keystore

```bash
git add debug.keystore
git commit -m "Add debug keystore for local development"
```

## Phase 2: Configure Gradle Signing

### 2.1 Update app/build.gradle.kts

Find the `android { }` block and add/update signing configuration:

```kotlin
android {
    // ... existing config (namespace, compileSdk, etc.)

    signingConfigs {
        create("debug") {
            storeFile = file("../debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }

        create("release") {
            val uploadKeystorePath = System.getenv("UPLOAD_KEYSTORE_PATH")
            if (uploadKeystorePath != null) {
                storeFile = file(uploadKeystorePath)
                storePassword = System.getenv("UPLOAD_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("UPLOAD_KEY_ALIAS")
                keyPassword = System.getenv("UPLOAD_KEY_PASSWORD")
            } else {
                // Fall back to debug key for local release builds
                storeFile = file("../debug.keystore")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    // ... rest of existing config
}
```

Note: Adjust `file("../debug.keystore")` path if the keystore is in a different location relative to the app module's build.gradle.kts.

## Phase 3: GitHub Actions Workflow

### 3.1 Create `.github/workflows/android.yml`

```yaml
name: Android Build

on:
  push:
    tags:
      - 'android-v*'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
      
      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v3
      
      - name: Decode upload keystore
        env:
          UPLOAD_KEYSTORE_BASE64: ${{ secrets.UPLOAD_KEYSTORE_BASE64 }}
        run: |
          echo "$UPLOAD_KEYSTORE_BASE64" | base64 -d > android-io-daemon/upload.keystore
      
      - name: Build Release APK
        working-directory: android-io-daemon
        env:
          UPLOAD_KEYSTORE_PATH: ${{ github.workspace }}/android-io-daemon/upload.keystore
          UPLOAD_KEYSTORE_PASSWORD: ${{ secrets.UPLOAD_KEYSTORE_PASSWORD }}
          UPLOAD_KEY_ALIAS: upload
          UPLOAD_KEY_PASSWORD: ${{ secrets.UPLOAD_KEY_PASSWORD }}
        run: ./gradlew assembleRelease
      
      - name: Upload APK artifact
        uses: actions/upload-artifact@v4
        with:
          name: release-apk
          path: android-io-daemon/app/build/outputs/apk/release/*.apk
      
      - name: Upload to GitHub Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v1
        with:
          files: android-io-daemon/app/build/outputs/apk/release/*.apk
```

## Verification

### Test debug build
```bash
cd android-io-daemon
./gradlew assembleDebug
# Should succeed, APK at app/build/outputs/apk/debug/
```

### Test release build (local, falls back to debug key)
```bash
cd android-io-daemon
./gradlew assembleRelease
# Should succeed using debug keystore
```

### Verify APK is signed
```bash
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

---

## MANUAL STEP FOR KYLE: GitHub Secrets Setup

After the agent completes the above, you need to add these secrets in GitHub:

**Go to:** Repository → Settings → Secrets and variables → Actions → New repository secret

Add these 3 secrets:

| Secret Name | Value |
|-------------|-------|
| `UPLOAD_KEYSTORE_BASE64` | Run `base64 -w 0 upload.keystore` and paste output |
| `UPLOAD_KEYSTORE_PASSWORD` | Your upload keystore password |
| `UPLOAD_KEY_PASSWORD` | Same as above (you used the same for both) |

The key alias is hardcoded as `upload` in the workflow, matching what you created.

### To generate the base64 value:
```bash
cd android-io-daemon
base64 -w 0 upload.keystore
# Copy the entire output (it's one long line)
```
