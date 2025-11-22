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

# Remove install directory
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    echo "Removed installation directory: $INSTALL_DIR"
fi

echo "Uninstallation complete."
