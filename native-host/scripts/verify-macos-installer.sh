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

# User-domain installation paths (no sudo required)
INSTALL_DIR="$HOME/Library/Application Support/JSTorrent"
APP_PATH="$HOME/Applications/JSTorrent Link Handler.app"
MANIFEST_PATH="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.jstorrent.native.json"

if [ "$CI" != "true" ]; then
    echo "This script will install the package to your user directory."
    echo "Install location: $INSTALL_DIR"
    echo "Press Ctrl+C to cancel, or Enter to continue."
    read -r
fi

# Install PKG (user-domain, no sudo required)
echo "Installing PKG..."
# Remove quarantine attribute to avoid Gatekeeper prompts in CI
if [ "$CI" = "true" ]; then
    xattr -d com.apple.quarantine "$INSTALLER_PKG" 2>/dev/null || true
    installer -pkg "$INSTALLER_PKG" -target CurrentUserHomeDirectory -verbose
else
    installer -pkg "$INSTALLER_PKG" -target CurrentUserHomeDirectory
fi

# Verify files
echo "Verifying installed files..."

if [ ! -f "$INSTALL_DIR/jstorrent-native-host" ]; then
    echo "Error: Native host binary not found in $INSTALL_DIR/"
    exit 1
fi

if [ ! -f "$INSTALL_DIR/jstorrent-io-daemon" ]; then
    echo "Error: IO Daemon binary not found in $INSTALL_DIR/"
    exit 1
fi

if [ ! -d "$APP_PATH" ]; then
    echo "Error: JSTorrent Link Handler app not found at $APP_PATH"
    exit 1
fi

# Verify binary permissions
if [ ! -x "$INSTALL_DIR/jstorrent-native-host" ]; then
    echo "Error: native-host is not executable"
    exit 1
fi

if [ ! -x "$INSTALL_DIR/jstorrent-io-daemon" ]; then
    echo "Error: io-daemon is not executable"
    exit 1
fi

# Verify Chrome manifest was created
if [ ! -f "$MANIFEST_PATH" ]; then
    echo "Warning: Chrome manifest not found at $MANIFEST_PATH"
    echo "(This is expected if Chrome is not installed)"
else
    echo "Chrome manifest found at $MANIFEST_PATH"
fi

# Verify link handler app structure
if [ ! -x "$APP_PATH/Contents/MacOS/droplet" ]; then
    echo "Error: Link handler droplet not executable"
    exit 1
fi

if [ ! -x "$APP_PATH/Contents/MacOS/jstorrent-link-handler-bin" ]; then
    echo "Error: Link handler binary not executable"
    exit 1
fi

echo "Install verification passed!"

# Verify Uninstall
UNINSTALL_SCRIPT="$INSTALL_DIR/uninstall.sh"
if [ -f "$UNINSTALL_SCRIPT" ]; then
    echo "Uninstall script found at $UNINSTALL_SCRIPT"

    if [ "$CI" != "true" ]; then
        echo "Do you want to run the uninstaller now? (y/N)"
        read -r run_uninstall
        if [[ "$run_uninstall" =~ ^[Yy]$ ]]; then
            echo "Running uninstaller..."
            "$UNINSTALL_SCRIPT"

            # Verify uninstall removed files
            if [ -f "$INSTALL_DIR/jstorrent-native-host" ]; then
                echo "Error: Native host binary still exists after uninstall"
                exit 1
            fi

            if [ -d "$APP_PATH" ]; then
                echo "Error: Link handler app still exists after uninstall"
                exit 1
            fi

            if [ -f "$MANIFEST_PATH" ]; then
                echo "Error: Chrome manifest still exists after uninstall"
                exit 1
            fi

            echo "Uninstall verification passed!"
        fi
    else
        # In CI, always run uninstall verification
        echo "Running uninstaller (CI mode)..."
        "$UNINSTALL_SCRIPT"

        if [ -f "$INSTALL_DIR/jstorrent-native-host" ]; then
            echo "Error: Native host binary still exists after uninstall"
            exit 1
        fi

        if [ -d "$APP_PATH" ]; then
            echo "Error: Link handler app still exists after uninstall"
            exit 1
        fi

        echo "Uninstall verification passed!"
    fi
else
    echo "Error: Uninstall script not found at $UNINSTALL_SCRIPT"
    exit 1
fi

echo "macOS verification checks passed."
