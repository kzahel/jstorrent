#!/bin/bash
set -e

# Ensure we are in the native-host directory
if [ ! -f "Cargo.toml" ]; then
    echo "Error: This script must be run from the native-host directory."
    exit 1
fi

echo "Building release binaries..."
cargo build --release --workspace

echo "Creating macOS installer package..."
rm -rf pkgroot

# Files go at pkgroot root - install-location specifies where they end up
# For user-domain install to ~/Library/Application Support/JSTorrent
mkdir -p "pkgroot"
cp target/release/jstorrent-host "pkgroot/jstorrent-native-host"
cp target/release/jstorrent-io-daemon "pkgroot/jstorrent-io-daemon"
cp installers/macos/scripts/uninstall.sh "pkgroot/"
cp manifests/com.jstorrent.native.json.template "pkgroot/"

# Link Handler - uses AppleScript wrapper to receive Apple Events on macOS
# The AppleScript "droplet" receives URLs/files and passes them to the actual binary
mkdir -p "pkgroot/link-handler-resources"

# Compile AppleScript to get the droplet executable and script resources
echo "Compiling AppleScript wrapper..."
rm -rf /tmp/LinkHandlerTemp.app
osacompile -o /tmp/LinkHandlerTemp.app installers/macos/link-handler.applescript

# Copy the droplet executable (AppleScript runner)
cp /tmp/LinkHandlerTemp.app/Contents/MacOS/droplet "pkgroot/link-handler-resources/droplet"
chmod 755 "pkgroot/link-handler-resources/droplet"

# Copy the compiled script (the droplet looks for this at runtime)
mkdir -p "pkgroot/link-handler-resources/Scripts"
cp /tmp/LinkHandlerTemp.app/Contents/Resources/Scripts/main.scpt "pkgroot/link-handler-resources/Scripts/"

# Copy the actual binary (renamed to -bin so AppleScript can call it)
cp target/release/jstorrent-link-handler "pkgroot/link-handler-resources/jstorrent-link-handler-bin"
chmod 755 "pkgroot/link-handler-resources/jstorrent-link-handler-bin"

# Copy resources that will be used to build the .app bundle
cp installers/macos/Info.plist "pkgroot/link-handler-resources/"

# Create PkgInfo file
echo -n "APPL????" > "pkgroot/link-handler-resources/PkgInfo"

# Generate .icns file from PNG icons
echo "Generating app icon..."
ICONS_SRC="../extension/public/icons"
ICONSET_DIR="/tmp/AppIcon.iconset"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

# Copy icons with proper naming for iconutil
# Standard resolution
cp "$ICONS_SRC/js-16.png" "$ICONSET_DIR/icon_16x16.png"
cp "$ICONS_SRC/js-32.png" "$ICONSET_DIR/icon_32x32.png"
cp "$ICONS_SRC/js-128.png" "$ICONSET_DIR/icon_128x128.png"
cp "$ICONS_SRC/js-256.png" "$ICONSET_DIR/icon_256x256.png"
cp "$ICONS_SRC/js-512.png" "$ICONSET_DIR/icon_512x512.png"

# Retina (@2x) - use next size up
cp "$ICONS_SRC/js-32.png" "$ICONSET_DIR/icon_16x16@2x.png"
sips -z 64 64 "$ICONS_SRC/js-128.png" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
cp "$ICONS_SRC/js-256.png" "$ICONSET_DIR/icon_128x128@2x.png"
cp "$ICONS_SRC/js-512.png" "$ICONSET_DIR/icon_256x256@2x.png"

# Convert iconset to icns
iconutil -c icns "$ICONSET_DIR" -o "pkgroot/link-handler-resources/AppIcon.icns"
rm -rf "$ICONSET_DIR"

# Build component package
COMPONENT_PKG="jstorrent-component.pkg"
pkgbuild --root pkgroot \
         --identifier com.jstorrent.native \
         --version 0.1.0 \
         --install-location "/Library/Application Support/JSTorrent" \
         --scripts installers/macos/scripts \
         "$COMPONENT_PKG"

# Create distribution.xml for user-domain installation (no admin required)
cat > distribution.xml << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
    <title>JSTorrent Native Host</title>
    <options customize="never" require-scripts="false" hostArchitectures="x86_64,arm64"/>
    <domains enable_localSystem="false" enable_currentUserHome="true"/>
    <choices-outline>
        <line choice="default"/>
    </choices-outline>
    <choice id="default" title="JSTorrent Native Host">
        <pkg-ref id="com.jstorrent.native"/>
    </choice>
    <pkg-ref id="com.jstorrent.native" version="0.1.0" onConclusion="none">jstorrent-component.pkg</pkg-ref>
</installer-gui-script>
EOF

# Build final product package with user-domain distribution
OUTPUT_FILE="jstorrent-native-host-install-macos-x86_64.pkg"
productbuild --distribution distribution.xml \
             --package-path . \
             "$OUTPUT_FILE"

# Clean up intermediate files
rm -f "$COMPONENT_PKG"
rm -f distribution.xml

echo "Installer created at $OUTPUT_FILE"
