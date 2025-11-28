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

# Link Handler binary and Info.plist - package separately, build .app in postinstall
# This avoids macOS installer filtering out .app bundles from non-/Applications locations
mkdir -p "pkgroot/usr/local/lib/jstorrent-native/link-handler-resources"

# Copy binary
cp target/release/jstorrent-link-handler "pkgroot/usr/local/lib/jstorrent-native/link-handler-resources/jstorrent-link-handler"
chmod 755 "pkgroot/usr/local/lib/jstorrent-native/link-handler-resources/jstorrent-link-handler"

# Copy resources that will be used to build the .app bundle
cp installers/macos/Info.plist "pkgroot/usr/local/lib/jstorrent-native/link-handler-resources/"

# Create PkgInfo file
echo -n "APPL????" > "pkgroot/usr/local/lib/jstorrent-native/link-handler-resources/PkgInfo"

OUTPUT_FILE="jstorrent-native-host-install-macos-x86_64.pkg"
pkgbuild --root pkgroot \
         --identifier com.jstorrent.native \
         --version 0.1.0 \
         --scripts installers/macos/scripts \
         "$OUTPUT_FILE"

echo "Installer created at $OUTPUT_FILE"
