#!/bin/bash
# Postinstall script for JSTorrent Native Host

INSTALL_DIR="/usr/local/lib/jstorrent-native"
MANIFEST_TEMPLATE="$INSTALL_DIR/com.jstorrent.native.json.template"
MANIFEST_DEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.jstorrent.native.json"
BINARY_PATH="$INSTALL_DIR/jstorrent-native-host"

# Ensure binary is executable
chmod 755 "$BINARY_PATH"
chmod 755 "$INSTALL_DIR/jstorrent-io-daemon"
chmod 755 "$INSTALL_DIR/uninstall.sh"

# Create Chrome NativeMessagingHosts directory if it doesn't exist
mkdir -p "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

# Generate manifest
# Replace HOST_PATH_PLACEHOLDER with actual path
sed "s|HOST_PATH_PLACEHOLDER|$BINARY_PATH|g" "$MANIFEST_TEMPLATE" > "$MANIFEST_DEST"

# Set permissions for manifest
chmod 644 "$MANIFEST_DEST"

# Move Link Handler app from staging to /Applications
STAGING_APP="$INSTALL_DIR/JSTorrent Link Handler.app"
APP_PATH="/Applications/JSTorrent Link Handler.app"

if [ -d "$STAGING_APP" ]; then
    # Remove old version if it exists
    rm -rf "$APP_PATH"

    # Move app to /Applications
    mv "$STAGING_APP" "$APP_PATH"

    # Ensure binary is executable
    chmod 755 "$APP_PATH/Contents/MacOS/jstorrent-link-handler"

    # Force registration with LaunchServices
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_PATH"

    echo "JSTorrent Link Handler app installed to $APP_PATH"
else
    echo "Warning: Link Handler app not found in staging location: $STAGING_APP"
fi

exit 0
