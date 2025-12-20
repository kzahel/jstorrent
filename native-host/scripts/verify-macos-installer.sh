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

# Create temp directory for extraction
EXTRACT_DIR=$(mktemp -d -t jstorrent-verify.XXXXXX)
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

# Expected paths in the payload (relative to home directory)
LIBRARY_DIR="$PAYLOAD_DIR/Library/Application Support/JSTorrent"
APPS_DIR="$PAYLOAD_DIR/Applications/JSTorrent Link Handler.app"
CHROME_DIR="$PAYLOAD_DIR/Library/Application Support/Google/Chrome/NativeMessagingHosts"

echo "Verifying package structure..."

# Verify binaries exist
if [ ! -f "$LIBRARY_DIR/jstorrent-native-host" ]; then
    echo "Error: Native host binary not found in payload"
    ls -la "$LIBRARY_DIR" || echo "Directory not found: $LIBRARY_DIR"
    exit 1
fi
echo "✓ Found jstorrent-native-host"

if [ ! -f "$LIBRARY_DIR/jstorrent-io-daemon" ]; then
    echo "Error: IO Daemon binary not found in payload"
    ls -la "$LIBRARY_DIR" || echo "Directory not found: $LIBRARY_DIR"
    exit 1
fi
echo "✓ Found jstorrent-io-daemon"

# Verify binaries are executable
if [ ! -x "$LIBRARY_DIR/jstorrent-native-host" ]; then
    echo "Error: native-host is not executable in payload"
    exit 1
fi
echo "✓ jstorrent-native-host is executable"

if [ ! -x "$LIBRARY_DIR/jstorrent-io-daemon" ]; then
    echo "Error: io-daemon is not executable in payload"
    exit 1
fi
echo "✓ jstorrent-io-daemon is executable"

# Verify Link Handler app
if [ ! -d "$APPS_DIR" ]; then
    echo "Error: JSTorrent Link Handler app not found in payload"
    ls -la "$PAYLOAD_DIR/Applications" || echo "Applications directory not found"
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

# Verify Chrome manifest directory exists
if [ ! -d "$CHROME_DIR" ]; then
    echo "Error: Chrome NativeMessagingHosts directory not found in payload"
    exit 1
fi
echo "✓ Found Chrome NativeMessagingHosts directory"

# Verify Chrome manifest exists
if [ ! -f "$CHROME_DIR/com.jstorrent.native.json" ]; then
    echo "Error: Chrome manifest not found in payload"
    ls -la "$CHROME_DIR" || echo "Directory empty"
    exit 1
fi
echo "✓ Found Chrome manifest"

# Verify uninstall script
if [ ! -f "$LIBRARY_DIR/uninstall.sh" ]; then
    echo "Error: Uninstall script not found in payload"
    exit 1
fi
echo "✓ Found uninstall script"

if [ ! -x "$LIBRARY_DIR/uninstall.sh" ]; then
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
