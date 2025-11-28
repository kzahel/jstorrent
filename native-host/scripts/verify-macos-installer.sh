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

# List package contents for debugging
echo "Package contents:"
pkgutil --payload-files "$INSTALLER_PKG" | grep -i "jstorrent" | head -20 || true
echo ""

# Note: This requires sudo and modifies the system.
# In CI, this is fine. Locally, we should warn the user.

if [ "$CI" != "true" ]; then
    echo "WARNING: This script will install the package to your system (requiring sudo)."
    echo "Press Ctrl+C to cancel, or Enter to continue."
    read -r
fi

# Install PKG
echo "Installing PKG..."
sudo installer -pkg "$INSTALLER_PKG" -target /

# Verify files
echo "Verifying installed files..."

# First check what was actually installed
echo "Contents of /usr/local/lib/jstorrent-native/:"
ls -la /usr/local/lib/jstorrent-native/ || echo "Directory not found!"
echo ""

if [ ! -f "/usr/local/lib/jstorrent-native/jstorrent-native-host" ]; then
    echo "Error: Native host binary not found in /usr/local/lib/jstorrent-native/"
    exit 1
fi

if [ ! -f "/usr/local/lib/jstorrent-native/jstorrent-io-daemon" ]; then
    echo "Error: IO Daemon binary not found in /usr/local/lib/jstorrent-native/"
    exit 1
fi

if [ ! -d "/Applications/JSTorrent Link Handler.app" ]; then
    echo "Error: JSTorrent Link Handler app not found in /Applications/"
    echo "Listing /Applications/ contents:"
    ls -la "/Applications/" | head -20
    echo ""
    echo "Checking if app was installed elsewhere:"
    find /usr/local /Library -name "*JSTorrent*" -o -name "*jstorrent*" 2>/dev/null || true
    exit 1
fi

# Verify io-daemon permissions
if [ ! -x "/usr/local/lib/jstorrent-native/jstorrent-io-daemon" ]; then
    echo "Error: io-daemon is not executable in /usr/local/lib/jstorrent-native/"
    exit 1
fi

echo "Install verification passed!"

# Verify Uninstall (if we had an uninstall script for macOS that we could run easily)
# The macOS uninstaller is usually just a script provided in the package or manual removal.
# The CI didn't verify uninstall, but we can check if the uninstall script exists.

UNINSTALL_SCRIPT="/usr/local/lib/jstorrent-native/uninstall.sh"
if [ -f "$UNINSTALL_SCRIPT" ]; then
    echo "Uninstall script found at $UNINSTALL_SCRIPT"
    
    if [ "$CI" != "true" ]; then
        echo "Do you want to run the uninstaller now? (y/N)"
        read -r run_uninstall
        if [[ "$run_uninstall" =~ ^[Yy]$ ]]; then
            echo "Running uninstaller..."
            sudo "$UNINSTALL_SCRIPT"
            
            if [ -f "/usr/local/lib/jstorrent-native/jstorrent-native-host" ]; then
                echo "Error: Native host binary still exists after uninstall"
                exit 1
            fi
             echo "Uninstall verification passed!"
        fi
    fi
else
    echo "Warning: Uninstall script not found at $UNINSTALL_SCRIPT"
fi

echo "macOS verification checks passed."
