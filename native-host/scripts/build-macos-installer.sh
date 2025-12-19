#!/bin/bash
set -e

# Ensure we are in the native-host directory
if [ ! -f "Cargo.toml" ]; then
    echo "Error: This script must be run from the native-host directory."
    exit 1
fi

# Parse command-line arguments
SIGN=false
NOTARIZE=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --sign)
            SIGN=true
            shift
            ;;
        --notarize)
            NOTARIZE=true
            SIGN=true  # Notarization requires signing
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--sign] [--notarize]"
            exit 1
            ;;
    esac
done

# Validate environment variables for signing
if $SIGN; then
    if [ -z "$CODESIGN_IDENTITY" ]; then
        echo "Error: CODESIGN_IDENTITY environment variable is required for signing"
        echo "Example: export CODESIGN_IDENTITY=\"Developer ID Application: Your Name (TEAMID)\""
        exit 1
    fi
    if [ -z "$INSTALLER_IDENTITY" ]; then
        echo "Error: INSTALLER_IDENTITY environment variable is required for signing"
        echo "Example: export INSTALLER_IDENTITY=\"Developer ID Installer: Your Name (TEAMID)\""
        exit 1
    fi
    # Verify the identities exist in the keychain
    if ! security find-identity -v -p codesigning | grep -q "$CODESIGN_IDENTITY"; then
        echo "Error: Codesign identity not found: $CODESIGN_IDENTITY"
        echo "Available identities:"
        security find-identity -v -p codesigning
        exit 1
    fi
    echo "Using codesign identity: $CODESIGN_IDENTITY"
    echo "Using installer identity: $INSTALLER_IDENTITY"
fi

# Validate environment variables for notarization
if $NOTARIZE; then
    if [ -z "$NOTARIZE_PROFILE" ]; then
        echo "Error: NOTARIZE_PROFILE environment variable is required for notarization"
        echo "This should be the keychain profile name from: xcrun notarytool store-credentials"
        exit 1
    fi
    echo "Notarization enabled with keychain profile: $NOTARIZE_PROFILE"
fi

echo "Building release binaries..."
cargo build --release --workspace

# Sign binaries if requested
if $SIGN; then
    echo "Signing binaries..."
    codesign --sign "$CODESIGN_IDENTITY" --options runtime --timestamp --force \
        target/release/jstorrent-host
    codesign --sign "$CODESIGN_IDENTITY" --options runtime --timestamp --force \
        target/release/jstorrent-io-daemon
    codesign --sign "$CODESIGN_IDENTITY" --options runtime --timestamp --force \
        target/release/jstorrent-link-handler

    echo "Verifying binary signatures..."
    codesign --verify --verbose target/release/jstorrent-host
    codesign --verify --verbose target/release/jstorrent-io-daemon
    codesign --verify --verbose target/release/jstorrent-link-handler
fi

echo "Creating macOS installer package..."
rm -rf pkgroot

# Files go at pkgroot root - install-location specifies where they end up
# For user-domain install to ~/Library/Application Support/JSTorrent
mkdir -p "pkgroot"
cp target/release/jstorrent-host "pkgroot/jstorrent-native-host"
cp target/release/jstorrent-io-daemon "pkgroot/jstorrent-io-daemon"
cp installers/macos/scripts/uninstall.sh "pkgroot/"
cp manifests/com.jstorrent.native.json.template "pkgroot/"

# Link Handler - build complete app bundle that will be copied to ~/Applications
# The AppleScript "droplet" receives URLs/files and passes them to the actual binary
echo "Building Link Handler app bundle..."

# Compile AppleScript to create base app bundle
rm -rf /tmp/LinkHandlerTemp.app
osacompile -o /tmp/LinkHandlerTemp.app installers/macos/link-handler.applescript

# Create the final app bundle structure in pkgroot
APP_BUNDLE="pkgroot/JSTorrent Link Handler.app"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# Copy the droplet executable
cp /tmp/LinkHandlerTemp.app/Contents/MacOS/droplet "$APP_BUNDLE/Contents/MacOS/droplet"
chmod 755 "$APP_BUNDLE/Contents/MacOS/droplet"

# Copy the compiled AppleScript
mkdir -p "$APP_BUNDLE/Contents/Resources/Scripts"
cp /tmp/LinkHandlerTemp.app/Contents/Resources/Scripts/main.scpt "$APP_BUNDLE/Contents/Resources/Scripts/"

# Copy our actual binary into the app bundle
cp target/release/jstorrent-link-handler "$APP_BUNDLE/Contents/MacOS/jstorrent-link-handler-bin"
chmod 755 "$APP_BUNDLE/Contents/MacOS/jstorrent-link-handler-bin"

# Copy Info.plist
cp installers/macos/Info.plist "$APP_BUNDLE/Contents/"

# Create PkgInfo file
echo -n "APPL????" > "$APP_BUNDLE/Contents/PkgInfo"

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

# Convert iconset to icns and put in app bundle
iconutil -c icns "$ICONSET_DIR" -o "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET_DIR"

# Sign the complete app bundle
if $SIGN; then
    echo "Signing Link Handler app bundle..."
    # Sign the nested binary first
    codesign --sign "$CODESIGN_IDENTITY" --options runtime --timestamp --force \
        "$APP_BUNDLE/Contents/MacOS/jstorrent-link-handler-bin"
    # Sign the app bundle (this will sign the droplet and the bundle itself)
    codesign --sign "$CODESIGN_IDENTITY" --options runtime --timestamp --force --deep \
        "$APP_BUNDLE"
    codesign --verify --deep --strict --verbose "$APP_BUNDLE"
fi

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

if $SIGN; then
    # Build unsigned first, then sign with productsign
    UNSIGNED_FILE="unsigned-$OUTPUT_FILE"
    productbuild --distribution distribution.xml \
                 --package-path . \
                 "$UNSIGNED_FILE"

    echo "Signing installer package..."
    productsign --sign "$INSTALLER_IDENTITY" "$UNSIGNED_FILE" "$OUTPUT_FILE"
    rm -f "$UNSIGNED_FILE"
else
    productbuild --distribution distribution.xml \
                 --package-path . \
                 "$OUTPUT_FILE"
fi

# Clean up intermediate files
rm -f "$COMPONENT_PKG"
rm -f distribution.xml

# Notarize if requested
if $NOTARIZE; then
    echo "Submitting for notarization (this may take a few minutes)..."
    xcrun notarytool submit "$OUTPUT_FILE" \
        --keychain-profile "$NOTARIZE_PROFILE" \
        --wait

    echo "Stapling notarization ticket..."
    xcrun stapler staple "$OUTPUT_FILE"
fi

# Verify final package signature
if $SIGN; then
    echo "Verifying package signature..."
    pkgutil --check-signature "$OUTPUT_FILE"
fi

echo "Installer created at $OUTPUT_FILE"
if $SIGN; then
    echo "Package is signed with: $INSTALLER_IDENTITY"
fi
if $NOTARIZE; then
    echo "Package is notarized and stapled"
fi
