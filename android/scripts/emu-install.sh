#!/usr/bin/env bash
#
# emu-install.sh - Build and install APK to running emulator
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SDK_ROOT="${ANDROID_HOME:-$HOME/.android-sdk}"

# Ensure adb is in PATH
export PATH="$SDK_ROOT/platform-tools:$PATH"

# Check emulator is running
if ! adb devices 2>/dev/null | grep -q "emulator-"; then
    echo "Error: No emulator running. Start one with: ./emu-start.sh"
    exit 1
fi

cd "$PROJECT_DIR"

# Parse args
BUILD=true
LAUNCH=true
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-build) BUILD=false; shift ;;
        --no-launch) LAUNCH=false; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Build APK
if $BUILD; then
    echo ">>> Building debug APK..."
    ./gradlew assembleDebug --quiet
fi

# Find APK
APK_PATH="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$APK_PATH" ]]; then
    echo "Error: APK not found at $APK_PATH"
    echo "Run ./gradlew assembleDebug first"
    exit 1
fi

# Install
echo ">>> Installing APK..."
adb install -r "$APK_PATH"

# Set up port forwarding for dev server (secure context requires 127.0.0.1)
echo ">>> Setting up adb reverse for dev server..."
adb reverse tcp:3000 tcp:3000

# Launch app
if $LAUNCH; then
    echo ">>> Launching app..."
    adb shell am start -n "com.jstorrent.app/.MainActivity"
fi

echo ""
echo "=== Installed ==="
echo ""
echo "Useful commands:"
echo "    ./emu-logs.sh              # Watch app logs"
echo "    adb shell am force-stop com.jstorrent.app  # Force stop"
echo "    adb shell pm clear com.jstorrent.app       # Clear data"
echo ""
