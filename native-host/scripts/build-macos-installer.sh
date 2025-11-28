#!/bin/bash
set -e

# Ensure we are in the native-host directory
if [ ! -f "Cargo.toml" ]; then
    echo "Error: This script must be run from the native-host directory."
    exit 1
fi

echo "Building release binaries..."
cargo build --release --workspace

echo "Creating macOS installer package..."
rm -rf pkgroot
# Native Host
mkdir -p pkgroot/usr/local/lib/jstorrent-native
cp target/release/jstorrent-host pkgroot/usr/local/lib/jstorrent-native/jstorrent-native-host
cp target/release/jstorrent-io-daemon pkgroot/usr/local/lib/jstorrent-native/jstorrent-io-daemon
cp installers/macos/scripts/uninstall.sh pkgroot/usr/local/lib/jstorrent-native/
cp manifests/com.jstorrent.native.json.template pkgroot/usr/local/lib/jstorrent-native/

# Link Handler App - Install to staging location first
# We'll move it to /Applications in postinstall to avoid pkgbuild issues
mkdir -p "pkgroot/usr/local/lib/jstorrent-native/JSTorrent Link Handler.app/Contents/MacOS"
mkdir -p "pkgroot/usr/local/lib/jstorrent-native/JSTorrent Link Handler.app/Contents/Resources"

# Copy and set executable
cp target/release/jstorrent-link-handler "pkgroot/usr/local/lib/jstorrent-native/JSTorrent Link Handler.app/Contents/MacOS/jstorrent-link-handler"
chmod 755 "pkgroot/usr/local/lib/jstorrent-native/JSTorrent Link Handler.app/Contents/MacOS/jstorrent-link-handler"

# Copy Info.plist
cp installers/macos/Info.plist "pkgroot/usr/local/lib/jstorrent-native/JSTorrent Link Handler.app/Contents/"

# Create PkgInfo file (contains package type and signature)
echo -n "APPL????" > "pkgroot/usr/local/lib/jstorrent-native/JSTorrent Link Handler.app/Contents/PkgInfo"

OUTPUT_FILE="jstorrent-native-host-install-macos-x86_64.pkg"
pkgbuild --root pkgroot \
         --identifier com.jstorrent.native \
         --version 0.1.0 \
         --scripts installers/macos/scripts \
         "$OUTPUT_FILE"

echo "Installer created at $OUTPUT_FILE"
