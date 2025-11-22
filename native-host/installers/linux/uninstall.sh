#!/bin/bash
# Uninstall script for JSTorrent Native Host

INSTALL_DIR="$HOME/.local/lib/jstorrent-native"
MANIFEST_DEST="$HOME/.config/google-chrome/NativeMessagingHosts/com.jstorrent.native.json"

echo "Uninstalling JSTorrent Native Host..."

# Remove manifest
if [ -f "$MANIFEST_DEST" ]; then
    rm "$MANIFEST_DEST"
    echo "Removed manifest: $MANIFEST_DEST"
fi

# Remove install directory
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    echo "Removed installation directory: $INSTALL_DIR"
fi

echo "Uninstallation complete."
