#!/bin/bash
# Postinstall script for JSTorrent Native Host

echo "=== JSTorrent postinstall script started ==="

INSTALL_DIR="/usr/local/lib/jstorrent-native"
MANIFEST_TEMPLATE="$INSTALL_DIR/com.jstorrent.native.json.template"
BINARY_PATH="$INSTALL_DIR/jstorrent-native-host"

# Ensure binary is executable
chmod 755 "$BINARY_PATH"
chmod 755 "$INSTALL_DIR/jstorrent-io-daemon"
chmod 755 "$INSTALL_DIR/uninstall.sh"

# Install Chrome manifest (best effort - may fail if run as root)
# The manifest will need to be installed by the user later if this fails
MANIFEST_DEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.jstorrent.native.json"
if mkdir -p "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" 2>/dev/null; then
    if sed "s|HOST_PATH_PLACEHOLDER|$BINARY_PATH|g" "$MANIFEST_TEMPLATE" > "$MANIFEST_DEST" 2>/dev/null; then
        chmod 644 "$MANIFEST_DEST"
        echo "Chrome manifest installed to $MANIFEST_DEST"
    else
        echo "Warning: Could not install Chrome manifest (install will need to be done manually)"
    fi
else
    echo "Warning: Could not create Chrome NativeMessagingHosts directory (install will need to be done manually)"
fi

# Build Link Handler app in /Applications from resources
# We don't package the .app bundle directly because macOS installer filters them out
echo "=== Building Link Handler app ==="
RESOURCES_DIR="$INSTALL_DIR/link-handler-resources"
APP_PATH="/Applications/JSTorrent Link Handler.app"

echo "Checking for resources at: $RESOURCES_DIR"
if [ -d "$RESOURCES_DIR" ]; then
    echo "Resources found, building app..."

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
    echo "ERROR: Link Handler resources not found at: $RESOURCES_DIR"
    echo "Contents of $INSTALL_DIR:"
    ls -la "$INSTALL_DIR" || true
fi

echo "=== JSTorrent postinstall script completed ==="
exit 0
