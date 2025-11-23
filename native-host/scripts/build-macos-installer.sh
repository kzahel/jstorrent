#!/bin/bash
set -e

# Ensure we are in the native-host directory
if [ ! -f "Cargo.toml" ]; then
    echo "Error: This script must be run from the native-host directory."
    exit 1
fi

echo "Building release binaries..."
cargo build --release

echo "Creating macOS installer package..."
rm -rf pkgroot
# Native Host
mkdir -p pkgroot/usr/local/lib/jstorrent-native
cp target/release/jstorrent-host pkgroot/usr/local/lib/jstorrent-native/jstorrent-native-host
cp target/release/jstorrent-io-daemon pkgroot/usr/local/lib/jstorrent-native/jstorrent-io-daemon
cp installers/macos/scripts/uninstall.sh pkgroot/usr/local/lib/jstorrent-native/
cp manifests/com.jstorrent.native.json.template pkgroot/usr/local/lib/jstorrent-native/

# Magnet Handler App
mkdir -p "pkgroot/Applications/JSTorrent Link Handler.app/Contents/MacOS"
cp target/release/jstorrent-link-handler "pkgroot/Applications/JSTorrent Link Handler.app/Contents/MacOS/jstorrent-link-handler"
cp installers/macos/Info.plist "pkgroot/Applications/JSTorrent Link Handler.app/Contents/"

OUTPUT_FILE="jstorrent-native-host-install-macos-x86_64.pkg"
pkgbuild --root pkgroot \
         --identifier com.jstorrent.native \
         --version 0.1.0 \
         --scripts installers/macos/scripts \
         "$OUTPUT_FILE"

echo "Installer created at $OUTPUT_FILE"
