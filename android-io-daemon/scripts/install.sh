#!/bin/bash
# Install android-io-daemon APK to ChromeOS Android container
#
# Usage:
#   ./scripts/install.sh          # Install debug APK
#   ./scripts/install.sh release  # Install release APK
#
# If you get signature mismatch errors, use:
#   ./scripts/install.sh --reinstall
#
# Prerequisites:
#   - adb must be in PATH (should be set in ~/.bashrc before interactive check)
#   - Android container must be running on ChromeOS

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

BUILD_TYPE="${1:-debug}"
REINSTALL=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --reinstall)
            REINSTALL=true
            shift
            ;;
        release)
            BUILD_TYPE="release"
            shift
            ;;
        debug)
            BUILD_TYPE="debug"
            shift
            ;;
    esac
done

APK_PATH="$PROJECT_DIR/app/build/outputs/apk/$BUILD_TYPE/app-$BUILD_TYPE.apk"
PACKAGE_NAME="com.jstorrent.app"

if [ ! -f "$APK_PATH" ]; then
    echo "Error: APK not found at $APK_PATH"
    echo "Run './gradlew assemble${BUILD_TYPE^}' first"
    exit 1
fi

echo "Installing $BUILD_TYPE APK..."

# Check if adb can see the device
if ! adb devices | grep -q "device$"; then
    echo "Error: No Android device found. Make sure Android container is running."
    adb devices
    exit 1
fi

if [ "$REINSTALL" = true ]; then
    echo "Uninstalling existing app..."
    adb uninstall "$PACKAGE_NAME" 2>/dev/null || true
fi

# -r: replace existing, -t: allow test APKs (debug builds)
if adb install -r -t "$APK_PATH"; then
    echo "✓ Successfully installed $BUILD_TYPE APK"
else
    echo ""
    echo "Installation failed. If you see INSTALL_FAILED_UPDATE_INCOMPATIBLE,"
    echo "the app was signed with a different key. Run:"
    echo "  ./scripts/install.sh --reinstall"
    exit 1
fi
