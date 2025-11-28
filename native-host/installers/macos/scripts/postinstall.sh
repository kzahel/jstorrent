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

# Build Link Handler app in /Applications from resources
# We don't package the .app bundle directly because macOS installer filters them out
RESOURCES_DIR="$INSTALL_DIR/link-handler-resources"
APP_PATH="/Applications/JSTorrent Link Handler.app"

if [ -d "$RESOURCES_DIR" ]; then
    # Remove old version if it exists
    rm -rf "$APP_PATH"

    # Create .app bundle structure
    mkdir -p "$APP_PATH/Contents/MacOS"
    mkdir -p "$APP_PATH/Contents/Resources"

    # Copy binary
    cp "$RESOURCES_DIR/jstorrent-link-handler" "$APP_PATH/Contents/MacOS/jstorrent-link-handler"
    chmod 755 "$APP_PATH/Contents/MacOS/jstorrent-link-handler"

    # Copy Info.plist
    cp "$RESOURCES_DIR/Info.plist" "$APP_PATH/Contents/"

    # Copy PkgInfo
    cp "$RESOURCES_DIR/PkgInfo" "$APP_PATH/Contents/"

    # Force registration with LaunchServices
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_PATH"

    echo "JSTorrent Link Handler app installed to $APP_PATH"
else
    echo "Warning: Link Handler resources not found at: $RESOURCES_DIR"
    echo "Contents of $INSTALL_DIR:"
    ls -la "$INSTALL_DIR" || true
fi

exit 0
