#!/bin/bash
set -e

# Ensure we are in the native-host directory
if [ ! -f "Cargo.toml" ]; then
    echo "Error: This script must be run from the native-host directory."
    exit 1
fi

echo "Building macOS installer..."
./scripts/build-macos-installer.sh

INSTALLER_PKG="jstorrent-native-host-install-macos-x86_64.pkg"

if [ ! -f "$INSTALLER_PKG" ]; then
    echo "Error: Installer PKG $INSTALLER_PKG not found."
    exit 1
fi

echo "Installing locally (requires sudo)..."
sudo installer -pkg "$INSTALLER_PKG" -target /

echo "Local installation complete."
