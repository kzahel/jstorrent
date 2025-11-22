#!/bin/bash
# Postinstall script for JSTorrent Native Host

INSTALL_DIR="/usr/local/lib/jstorrent-native"
MANIFEST_TEMPLATE="$INSTALL_DIR/com.jstorrent.native.json.template"
MANIFEST_DEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.jstorrent.native.json"
BINARY_PATH="$INSTALL_DIR/jstorrent-native-host"

# Ensure binary is executable
chmod 755 "$BINARY_PATH"
chmod 755 "$INSTALL_DIR/uninstall.sh"

# Create Chrome NativeMessagingHosts directory if it doesn't exist
mkdir -p "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

# Generate manifest
# Replace HOST_PATH_PLACEHOLDER with actual path
sed "s|HOST_PATH_PLACEHOLDER|$BINARY_PATH|g" "$MANIFEST_TEMPLATE" > "$MANIFEST_DEST"

# Set permissions for manifest
chmod 644 "$MANIFEST_DEST"

# Register the magnet handler app
APP_PATH="/Applications/JSTorrentMagnetHandler.app"
if [ -d "$APP_PATH" ]; then
    # Ensure binary is executable
    chmod 755 "$APP_PATH/Contents/MacOS/jstorrent-link-handler"
    
    # Force registration with LaunchServices
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_PATH"
fi

exit 0
