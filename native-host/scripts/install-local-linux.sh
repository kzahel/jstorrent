#!/bin/bash
set -e

# Ensure we are in the native-host directory
if [ ! -f "Cargo.toml" ]; then
    echo "Error: This script must be run from the native-host directory."
    exit 1
fi

echo "Building Linux installer..."
./scripts/build-linux-installer.sh

INSTALLER_TAR="dist/jstorrent-native-host-install-linux-x86_64.tar.gz"

if [ ! -f "$INSTALLER_TAR" ]; then
    echo "Error: Installer tarball $INSTALLER_TAR not found."
    exit 1
fi

echo "Installing locally..."

# Kill running host if exists
pkill -f jstorrent-native-host || true

# Create a temporary directory for extraction
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

tar -xzf "$INSTALLER_TAR" -C "$TEMP_DIR"

cd "$TEMP_DIR"
./install.sh

echo "Local installation complete."
