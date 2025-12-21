# Release Guide

## System Bridge Release

The system bridge includes binaries for Windows, macOS, and Linux.

### 1. Run the release script

```bash
./scripts/release-system-bridge.sh 0.2.0
```

This will:
- Update version in `system-bridge/Cargo.toml` and `system-bridge/io-daemon/Cargo.toml`
- Regenerate `Cargo.lock`
- Commit and push to main
- Create and push tag `system-bridge-v0.2.0`

### 2. Monitor CI builds

Watch the GitHub Actions workflow at:
https://github.com/kzahel/jstorrent/actions

The `system-bridge-ci.yml` workflow builds installers for all platforms:
- Windows: `.exe` (Inno Setup)
- macOS: `.pkg` (signed and notarized if secrets configured)
- Linux: `.tar.gz`

### 3. Verify the release

Download and test installers from:
https://github.com/kzahel/jstorrent/releases

### 4. Update website download links

After verifying the release works, update the TAG in **both** files:

| File | Line |
|------|------|
| `website/src/App.tsx` | `const TAG = 'v0.2.0'` |
| `website/install.sh` | `TAG="v0.2.0"` |

Push to main - the website auto-deploys via GitHub Pages.

---

## Android Release

Android is versioned **independently** due to Play Store review cycles.

### Version numbers

Edit `android-io-daemon/app/build.gradle.kts`:
- `versionCode`: Integer, must increment for each Play Store upload
- `versionName`: User-facing string (e.g., "1.0.4")

### Release process

```bash
./scripts/release-android.sh 1.0.4
```

This creates tag `android-v1.0.4` and triggers CI to build a signed APK.

The signed APK is uploaded to GitHub Releases. From there, manually upload to Play Store.

---

## Extension Release

The Chrome extension is published manually to the Chrome Web Store.

```bash
./scripts/release-extension.sh 0.0.6
```

This creates tag `extension-v0.0.6`. CI runs tests but does not publish - you must upload the built extension to the Web Store manually.

---

## Website Release

The website auto-deploys from `main` branch pushes (when `website/**` changes).

A tag can also be created for versioning purposes:

```bash
./scripts/release-website.sh 1.0.0
```

---

## Version Locations Summary

| Component | File | Example |
|-----------|------|---------|
| System Bridge | `system-bridge/Cargo.toml` | `version = "0.2.0"` |
| IO Daemon | `system-bridge/io-daemon/Cargo.toml` | `version = "0.2.0"` |
| Website downloads | `website/src/App.tsx` | `const TAG = 'v0.2.0'` |
| Linux installer | `website/install.sh` | `TAG="v0.2.0"` |
| Android | `android-io-daemon/app/build.gradle.kts` | `versionName = "1.0.4"` |
| Extension | `extension/public/manifest.json` | `"version": "0.0.6"` |
