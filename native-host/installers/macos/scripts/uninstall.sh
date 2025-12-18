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
    rm -f "$INSTALL_DIR/jstorrent-link-handler"
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

# Also clean up old system location if it exists
OLD_INSTALL_DIR="/usr/local/lib/jstorrent-native"
if [ -d "$OLD_INSTALL_DIR" ]; then
    echo "Found old system installation at $OLD_INSTALL_DIR"
    echo "Run 'sudo rm -rf $OLD_INSTALL_DIR' to remove it"
fi

OLD_APP_PATH="/Applications/JSTorrent Link Handler.app"
if [ -d "$OLD_APP_PATH" ]; then
    echo "Found old system app at $OLD_APP_PATH"
    echo "Run 'sudo rm -rf \"$OLD_APP_PATH\"' to remove it"
fi

echo "Uninstallation complete."
