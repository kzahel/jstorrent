#!/bin/bash
set -e

# Ensure we are in the native-host directory
if [ ! -f "Cargo.toml" ]; then
    echo "Error: This script must be run from the native-host directory."
    exit 1
fi

INSTALLER_TAR="dist/jstorrent-native-host-install-linux-x86_64.tar.gz"

if [ ! -f "$INSTALLER_TAR" ]; then
    echo "Error: Installer tarball $INSTALLER_TAR not found. Run build-linux-installer.sh first."
    exit 1
fi

echo "Verifying Linux Installer..."

# Create a temporary directory for verification
TEST_DIR=$(mktemp -d)
echo "Created temp dir: $TEST_DIR"

# Cleanup on exit
cleanup() {
    echo "Cleaning up..."
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# Extract installer
tar -xzf "$INSTALLER_TAR" -C "$TEST_DIR"
cd "$TEST_DIR"

# Mock Chrome config dir to avoid messing with actual user config if possible, 
# BUT the install.sh uses $HOME. 
# To test safely locally without affecting the user's actual environment, we should probably mock HOME?
# However, the user said "verify the linux installer script by actually running it".
# If we mock HOME, we test the script logic but not the actual paths.
# Given this is a dev environment, let's use a mocked HOME to be safe and clean.

MOCK_HOME="$TEST_DIR/mock_home"
mkdir -p "$MOCK_HOME"
export HOME="$MOCK_HOME"

echo "Using mocked HOME: $HOME"

# Mock Chrome config dir
mkdir -p "$HOME/.config/google-chrome/NativeMessagingHosts"
mkdir -p "$HOME/.config/chromium/NativeMessagingHosts"

# Run install
echo "Running install.sh..."
./install.sh

# Verify files
echo "Verifying installed files..."
if [ ! -f "$HOME/.local/lib/jstorrent-native/jstorrent-native-host" ]; then
    echo "Error: Native host binary not found after install"
    exit 1
fi

if [ ! -f "$HOME/.config/google-chrome/NativeMessagingHosts/com.jstorrent.native.json" ]; then
    echo "Error: Chrome manifest not found after install"
    exit 1
fi

if [ ! -f "$HOME/.config/chromium/NativeMessagingHosts/com.jstorrent.native.json" ]; then
    echo "Error: Chromium manifest not found after install"
    exit 1
fi

echo "Install verification passed!"

# Verify Uninstall
echo "Running uninstall.sh..."
./uninstall.sh

echo "Verifying uninstallation..."
if [ -f "$HOME/.local/lib/jstorrent-native/jstorrent-native-host" ]; then
    echo "Error: Native host binary still exists after uninstall"
    exit 1
fi

if [ -f "$HOME/.config/google-chrome/NativeMessagingHosts/com.jstorrent.native.json" ]; then
    echo "Error: Chrome manifest still exists after uninstall"
    exit 1
fi

if [ -d "$HOME/.local/lib/jstorrent-native" ]; then
     # Check if directory is empty or removed. uninstall.sh might remove the dir.
     # If it's not empty, that's fine, but if it contains our files, that's bad.
     if [ "$(ls -A $HOME/.local/lib/jstorrent-native)" ]; then
         echo "Warning: jstorrent-native directory not empty after uninstall"
     else
         echo "jstorrent-native directory is empty (good)."
     fi
else
    echo "jstorrent-native directory removed (good)."
fi

echo "Uninstall verification passed!"
echo "All Linux verification checks passed."
