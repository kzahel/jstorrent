#!/bin/bash
set -e

# Ensure we are in the native-host directory
if [ ! -f "Cargo.toml" ]; then
    echo "Error: This script must be run from the native-host directory."
    exit 1
fi

echo "Building release binaries..."
cargo build --release

echo "Creating Linux installer tarball..."
STAGING_DIR="build_staging"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

cp target/release/jstorrent-host "$STAGING_DIR/jstorrent-native-host"
cp target/release/jstorrent-link-handler "$STAGING_DIR/jstorrent-link-handler"
cp target/release/jstorrent-io-daemon "$STAGING_DIR/jstorrent-io-daemon"
cp installers/linux/install.sh "$STAGING_DIR/"
cp installers/linux/uninstall.sh "$STAGING_DIR/"
mkdir -p "$STAGING_DIR/manifests"
cp manifests/com.jstorrent.native.json.template "$STAGING_DIR/manifests/"

# Create dist directory
mkdir -p dist

OUTPUT_FILE="dist/jstorrent-native-host-install-linux-x86_64.tar.gz"
tar -czvf "$OUTPUT_FILE" -C "$STAGING_DIR" .

# Cleanup staging
rm -rf "$STAGING_DIR"

echo "Installer created at $OUTPUT_FILE"
