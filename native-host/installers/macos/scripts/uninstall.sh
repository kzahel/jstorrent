#!/bin/bash
# Uninstall script for JSTorrent Native Host

INSTALL_DIR="$HOME/Library/Application Support/JSTorrent"
MANIFEST_DEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.jstorrent.native.json"

echo "Uninstalling JSTorrent Native Host..."

# Remove manifest
if [ -f "$MANIFEST_DEST" ]; then
    rm "$MANIFEST_DEST"
    echo "Removed manifest: $MANIFEST_DEST"
fi

# Remove installed binaries and scripts
if [ -d "$INSTALL_DIR" ]; then
    rm -f "$INSTALL_DIR/jstorrent-native-host"
    rm -f "$INSTALL_DIR/jstorrent-io-daemon"
    rm -f "$INSTALL_DIR/uninstall.sh"
    rm -f "$INSTALL_DIR/com.jstorrent.native.json.template"
    rm -rf "$INSTALL_DIR/link-handler-resources"
    echo "Removed binaries from: $INSTALL_DIR"

    # Only remove directory if empty
    if [ -z "$(ls -A "$INSTALL_DIR")" ]; then
        rmdir "$INSTALL_DIR"
        echo "Removed empty installation directory: $INSTALL_DIR"
    else
        echo "Preserving installation directory (contains other files): $INSTALL_DIR"
    fi
fi

# Remove Link Handler app from ~/Applications
APP_PATH="$HOME/Applications/JSTorrent Link Handler.app"
if [ -d "$APP_PATH" ]; then
    rm -rf "$APP_PATH"
    echo "Removed app: $APP_PATH"
fi

echo "Uninstallation complete."
