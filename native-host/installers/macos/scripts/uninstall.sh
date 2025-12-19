#!/bin/bash
# Uninstall script for JSTorrent Native Host

INSTALL_DIR="$HOME/Library/Application Support/JSTorrent"
MANIFEST_DEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.jstorrent.native.json"

echo "Uninstalling JSTorrent Native Host..."

# Kill any running JSTorrent processes
echo "Stopping running processes..."
pkill -f "jstorrent-native-host" 2>/dev/null && echo "Stopped jstorrent-native-host" || true
pkill -f "jstorrent-io-daemon" 2>/dev/null && echo "Stopped jstorrent-io-daemon" || true
pkill -f "jstorrent-link-handler" 2>/dev/null && echo "Stopped jstorrent-link-handler" || true
# Give processes time to exit
sleep 0.5

# Remove manifest
if [ -f "$MANIFEST_DEST" ]; then
    rm "$MANIFEST_DEST"
    echo "Removed manifest: $MANIFEST_DEST"
fi

# Remove installed binaries, scripts, and state
if [ -d "$INSTALL_DIR" ]; then
    rm -f "$INSTALL_DIR/jstorrent-native-host"
    rm -f "$INSTALL_DIR/jstorrent-io-daemon"
    rm -f "$INSTALL_DIR/uninstall.sh"
    rm -f "$INSTALL_DIR/com.jstorrent.native.json.template"
    rm -rf "$INSTALL_DIR/link-handler-resources"
    # Remove state files
    rm -f "$INSTALL_DIR/rpc-info.json"
    rm -f "$INSTALL_DIR"/*.log
    echo "Removed binaries and state from: $INSTALL_DIR"

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
