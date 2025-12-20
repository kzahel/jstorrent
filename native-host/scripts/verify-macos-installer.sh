#!/bin/bash
set -e

# Ensure we are in the native-host directory
if [ ! -f "Cargo.toml" ]; then
    echo "Error: This script must be run from the native-host directory."
    exit 1
fi

INSTALLER_PKG="jstorrent-native-host-install-macos-x86_64.pkg"

if [ ! -f "$INSTALLER_PKG" ]; then
    echo "Error: Installer PKG $INSTALLER_PKG not found. Run build-macos-installer.sh first."
    exit 1
fi

echo "Verifying macOS Installer..."

# Create temp directory for extraction (pkgutil will create it, so just define the path)
EXTRACT_DIR="/tmp/jstorrent-verify-$$-$(date +%s)"
rm -rf "$EXTRACT_DIR" 2>/dev/null || true
trap 'rm -rf "$EXTRACT_DIR"' EXIT

# Extract PKG contents without installing
echo "Extracting PKG contents for verification..."
pkgutil --expand "$INSTALLER_PKG" "$EXTRACT_DIR"

# Find the main package (not Distribution)
MAIN_PKG=$(find "$EXTRACT_DIR" -name "*.pkg" -type d | grep -v "Distribution" | head -n 1)
if [ -z "$MAIN_PKG" ]; then
    echo "Error: Could not find main package component"
    exit 1
fi

# Extract the payload
echo "Extracting payload..."
PAYLOAD_DIR="$EXTRACT_DIR/payload"
mkdir -p "$PAYLOAD_DIR"
(cd "$PAYLOAD_DIR" && cat "$MAIN_PKG/Payload" | gunzip -dc | cpio -i 2>/dev/null)

# Debug: Show what was actually extracted
echo "Extracted payload structure:"
find "$PAYLOAD_DIR" -type f -o -type d | head -20

# The payload contains files as they exist in pkgroot/ (flat structure).
# The --install-location in pkgbuild specifies where they get installed,
# but the extracted payload just has the raw source files at the root.
# So we check for files directly in $PAYLOAD_DIR, not in subdirectories.

echo "Verifying package structure..."

# Verify binaries exist
if [ ! -f "$PAYLOAD_DIR/jstorrent-native-host" ]; then
    echo "Error: Native host binary not found in payload"
    ls -la "$PAYLOAD_DIR" || echo "Payload directory not found"
    exit 1
fi
echo "✓ Found jstorrent-native-host"

if [ ! -f "$PAYLOAD_DIR/jstorrent-io-daemon" ]; then
    echo "Error: IO Daemon binary not found in payload"
    ls -la "$PAYLOAD_DIR" || echo "Payload directory not found"
    exit 1
fi
echo "✓ Found jstorrent-io-daemon"

# Verify binaries are executable
if [ ! -x "$PAYLOAD_DIR/jstorrent-native-host" ]; then
    echo "Error: native-host is not executable in payload"
    exit 1
fi
echo "✓ jstorrent-native-host is executable"

if [ ! -x "$PAYLOAD_DIR/jstorrent-io-daemon" ]; then
    echo "Error: io-daemon is not executable in payload"
    exit 1
fi
echo "✓ jstorrent-io-daemon is executable"

# Verify Link Handler app (in payload root, will be installed to ~/Applications by postinstall)
APPS_DIR="$PAYLOAD_DIR/JSTorrent Link Handler.app"
if [ ! -d "$APPS_DIR" ]; then
    echo "Error: JSTorrent Link Handler app not found in payload"
    ls -la "$PAYLOAD_DIR" || echo "Payload directory not found"
    exit 1
fi
echo "✓ Found JSTorrent Link Handler.app"

# Verify link handler app structure
if [ ! -x "$APPS_DIR/Contents/MacOS/droplet" ]; then
    echo "Error: Link handler droplet not found or not executable"
    ls -la "$APPS_DIR/Contents/MacOS/" || echo "MacOS directory not found"
    exit 1
fi
echo "✓ Link handler droplet is executable"

if [ ! -x "$APPS_DIR/Contents/MacOS/jstorrent-link-handler-bin" ]; then
    echo "Error: Link handler binary not found or not executable"
    exit 1
fi
echo "✓ Link handler binary is executable"

# Verify manifest template exists (postinstall generates the actual manifest)
if [ ! -f "$PAYLOAD_DIR/com.jstorrent.native.json.template" ]; then
    echo "Error: Chrome manifest template not found in payload"
    ls -la "$PAYLOAD_DIR" || echo "Payload directory not found"
    exit 1
fi
echo "✓ Found Chrome manifest template"

# Verify uninstall script
if [ ! -f "$PAYLOAD_DIR/uninstall.sh" ]; then
    echo "Error: Uninstall script not found in payload"
    exit 1
fi
echo "✓ Found uninstall script"

if [ ! -x "$PAYLOAD_DIR/uninstall.sh" ]; then
    echo "Error: Uninstall script is not executable"
    exit 1
fi
echo "✓ Uninstall script is executable"

echo ""
echo "Package structure verification passed!"
echo ""
echo "Note: This is a basic path verification. The actual installer"
echo "is not executed in CI due to limitations with the 'installer' command."
echo "Manual testing of the installer is still recommended."

echo "macOS verification checks passed."
