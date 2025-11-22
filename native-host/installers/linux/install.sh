#!/bin/bash
# Install script for JSTorrent Native Host

INSTALL_DIR="$HOME/.local/lib/jstorrent-native"
MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
MANIFEST_TEMPLATE="manifests/com.jstorrent.native.json.template"
BINARY_NAME="jstorrent-native-host"

# Create install directory
mkdir -p "$INSTALL_DIR"

# Install binaries
cp "target/release/jstorrent-host" "$INSTALL_DIR/jstorrent-native-host"
cp "target/release/jstorrent-link-handler" "$INSTALL_DIR/"
chmod 755 "$INSTALL_DIR/jstorrent-native-host"
chmod 755 "$INSTALL_DIR/jstorrent-link-handler"

# Install uninstall script
cp "installers/linux/uninstall.sh" "$INSTALL_DIR/"
chmod 755 "$INSTALL_DIR/uninstall.sh"

# Create manifest
sed "s|HOST_PATH_PLACEHOLDER|$INSTALL_DIR/jstorrent-native-host|g" "manifests/com.jstorrent.native.json.template" > "$MANIFEST_DIR/com.jstorrent.native.json"
chmod 644 "$MANIFEST_DIR/com.jstorrent.native.json"

# Create Desktop Entry for Magnet Handler
DESKTOP_FILE="$HOME/.local/share/applications/jstorrent-magnet.desktop"
mkdir -p "$HOME/.local/share/applications"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=JSTorrent Magnet Handler
Exec=$INSTALL_DIR/jstorrent-magnet-stub %u
Type=Application
MimeType=x-scheme-handler/magnet;
NoDisplay=true
EOF

# Register mime type
xdg-mime default jstorrent-magnet.desktop x-scheme-handler/magnet

echo "Installation complete."
