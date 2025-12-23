#!/bin/bash
set -e

# This script is for macOS only
if [[ "$(uname)" != "Darwin" ]]; then
    echo "Error: This script is for macOS only. Detected: $(uname)"
    exit 1
fi

# Ensure we are in the system-bridge directory
if [ ! -f "Cargo.toml" ]; then
    echo "Error: This script must be run from the system-bridge directory."
    exit 1
fi

echo "Building macOS installer..."
./scripts/build-macos-installer.sh

INSTALLER_PKG="jstorrent-system-bridge-install-macos-x86_64.pkg"

if [ ! -f "$INSTALLER_PKG" ]; then
    echo "Error: Installer PKG $INSTALLER_PKG not found."
    exit 1
fi

echo "Installing locally (user-domain, no sudo required)..."
installer -pkg "$INSTALLER_PKG" -target CurrentUserHomeDirectory

echo "Local installation complete."
echo "Installed to: $HOME/Library/Application Support/JSTorrent"
echo "Link handler: $HOME/Applications/JSTorrent.app"
