#!/bin/bash
# Uninstall script for JSTorrent Native Host

INSTALL_DIR="$HOME/.local/lib/jstorrent-native"
# List of browser config directories to remove manifest from
BROWSERS=(
    "$HOME/.config/google-chrome"
    "$HOME/.config/chromium"
    "$HOME/.config/BraveSoftware/Brave-Browser"
    "$HOME/.config/microsoft-edge"
)

for BROWSER_DIR in "${BROWSERS[@]}"; do
    MANIFEST_DEST="$BROWSER_DIR/NativeMessagingHosts/com.jstorrent.native.json"
    if [ -f "$MANIFEST_DEST" ]; then
        rm "$MANIFEST_DEST"
        echo "Removed manifest: $MANIFEST_DEST"
    fi
done



# Remove desktop entry
DESKTOP_FILE="$HOME/.local/share/applications/jstorrent-magnet.desktop"
if [ -f "$DESKTOP_FILE" ]; then
    # Try to update mime database
    xdg-mime uninstall "$DESKTOP_FILE" || true
    
    rm "$DESKTOP_FILE"
    echo "Removed desktop entry: $DESKTOP_FILE"
fi

# Remove installed binaries and scripts
if [ -d "$INSTALL_DIR" ]; then
    rm -f "$INSTALL_DIR/jstorrent-native-host"
    rm -f "$INSTALL_DIR/jstorrent-link-handler"
    rm -f "$INSTALL_DIR/jstorrent-io-daemon"
    rm -f "$INSTALL_DIR/uninstall.sh"
    echo "Removed binaries from: $INSTALL_DIR"

    # Only remove directory if empty
    if [ -z "$(ls -A "$INSTALL_DIR")" ]; then
        rmdir "$INSTALL_DIR"
        echo "Removed empty installation directory: $INSTALL_DIR"
    else
        echo "Preserving installation directory (contains other files): $INSTALL_DIR"
    fi
fi

echo "Uninstallation complete."
