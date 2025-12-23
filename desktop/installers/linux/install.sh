#!/bin/bash
set -e  # Exit on error
# Install script for JSTorrent Native Host

INSTALL_DIR="$HOME/.local/lib/jstorrent-native"
MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
MANIFEST_TEMPLATE="manifests/com.jstorrent.native.json.template"
BINARY_NAME="jstorrent-native-host"

# Kill running processes if they exist (prevents "Text file busy" error)
pkill -f jstorrent-io-daemon 2>/dev/null || true
pkill -f jstorrent-native-host 2>/dev/null || true
sleep 1.5  # io-daemon polls parent every 1s

# Create install directory
mkdir -p "$INSTALL_DIR"

# Install binaries
# Assume we are running from the extracted tarball root
cp "jstorrent-native-host" "$INSTALL_DIR/"
cp "jstorrent-link-handler" "$INSTALL_DIR/"
cp "jstorrent-io-daemon" "$INSTALL_DIR/"
chmod 755 "$INSTALL_DIR/jstorrent-native-host"
chmod 755 "$INSTALL_DIR/jstorrent-link-handler"
chmod 755 "$INSTALL_DIR/jstorrent-io-daemon"

# Install uninstall script
# Install uninstall script
cp "uninstall.sh" "$INSTALL_DIR/"
chmod 755 "$INSTALL_DIR/uninstall.sh"

# Create manifest
# Ensure manifests directory exists in tarball or use template directly if flat
if [ -f "manifests/com.jstorrent.native.json.template" ]; then
    TEMPLATE="manifests/com.jstorrent.native.json.template"
else
    # Fallback if flat
    TEMPLATE="com.jstorrent.native.json.template"
fi

# List of browser config directories to install manifest to
BROWSERS=(
    "$HOME/.config/google-chrome"
    "$HOME/.config/chromium"
    "$HOME/.config/BraveSoftware/Brave-Browser"
    "$HOME/.config/microsoft-edge"
)

for BROWSER_DIR in "${BROWSERS[@]}"; do
    # If the browser config directory exists (or we just want to force support), 
    # create the NativeMessagingHosts directory.
    # For now, let's just create it.
    MANIFEST_DIR="$BROWSER_DIR/NativeMessagingHosts"
    mkdir -p "$MANIFEST_DIR"
    
    sed "s|HOST_PATH_PLACEHOLDER|$INSTALL_DIR/jstorrent-native-host|g" "$TEMPLATE" > "$MANIFEST_DIR/com.jstorrent.native.json"
    chmod 644 "$MANIFEST_DIR/com.jstorrent.native.json"
    echo "Installed manifest to $MANIFEST_DIR"
done

# Create Desktop Entry for Link Handler
DESKTOP_FILE="$HOME/.local/share/applications/jstorrent-magnet.desktop"
mkdir -p "$HOME/.local/share/applications"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=JSTorrent Link Handler
Exec="$INSTALL_DIR/jstorrent-link-handler" %u
Type=Application
MimeType=x-scheme-handler/magnet;application/x-bittorrent;
NoDisplay=true
EOF

# Register mime type
xdg-mime default jstorrent-magnet.desktop x-scheme-handler/magnet
xdg-mime default jstorrent-magnet.desktop application/x-bittorrent

echo "Installation complete."
