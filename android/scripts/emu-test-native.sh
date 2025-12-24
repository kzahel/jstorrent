#!/usr/bin/env bash
#
# emu-test-native.sh - Deploy and test NativeStandaloneActivity with a magnet link
#
# Usage:
#   ./emu-test-native.sh "magnet:?xt=urn:btih:..."
#   ./emu-test-native.sh --no-build "magnet:?xt=urn:btih:..."
#
# This script:
#   1. Checks if emulator is running, starts phone emulator if not
#   2. Clears app storage entirely
#   3. Builds and installs debug APK
#   4. Launches NativeStandaloneActivity with base64-encoded magnet URL
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SDK_ROOT="${ANDROID_HOME:-$HOME/.android-sdk}"
AVD_NAME="${AVD_NAME:-jstorrent-dev}"
PACKAGE="com.jstorrent.app"
ACTIVITY="com.jstorrent.app/.NativeStandaloneActivity"

# Ensure tools are in PATH
export PATH="$SDK_ROOT/cmdline-tools/latest/bin:$SDK_ROOT/platform-tools:$SDK_ROOT/emulator:$PATH"

# Default test magnet (remy reads a book.mp4) with peer hints for local testing
# Peer hints: localhost, emulator->host (10.0.2.2), and local network IP
DEFAULT_MAGNET="magnet:?xt=urn:btih:68e52e19f423308ba4f330d5a9b7fb68cec36355&xt=urn:btmh:1220d501d9530fb0563cb8113adb85a69df2cf5997f59b1927d302fc807e407dc0ee&dn=remy%20reads%20a%20book.mp4&x.pe=127.0.0.1:6082&x.pe=10.0.2.2:6082&x.pe=192.168.1.112:6082"

# Parse arguments
BUILD=true
MAGNET=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-build)
            BUILD=false
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--no-build] [\"magnet:?xt=urn:btih:...\"]"
            echo ""
            echo "Options:"
            echo "  --no-build    Skip gradle build (use existing APK)"
            echo "  -h, --help    Show this help"
            echo ""
            echo "If no magnet is specified, uses default test torrent with peer hints."
            echo ""
            echo "Example:"
            echo "  $0                          # Use default test magnet"
            echo "  $0 --no-build               # Use default, skip build"
            echo "  $0 \"magnet:?xt=urn:btih:...\" # Use custom magnet"
            exit 0
            ;;
        magnet:*)
            MAGNET="$1"
            shift
            ;;
        *)
            echo "Error: Unknown option: $1"
            echo "Usage: $0 [--no-build] [\"magnet:?xt=urn:btih:...\"]"
            exit 1
            ;;
    esac
done

# Use default magnet if none specified
if [[ -z "$MAGNET" ]]; then
    MAGNET="$DEFAULT_MAGNET"
    echo ">>> Using default test magnet (remy reads a book.mp4)"
fi

# --- Step 1: Ensure emulator is running ---
echo ">>> Checking emulator status..."
if adb devices 2>/dev/null | grep -q "emulator-"; then
    echo "    Emulator already running"
else
    echo ">>> Starting emulator '$AVD_NAME'..."
    "$SCRIPT_DIR/emu-start.sh"
fi

# --- Step 2: Clear app storage ---
echo ""
echo ">>> Clearing app storage..."
if adb shell pm clear "$PACKAGE" 2>/dev/null; then
    echo "    App storage cleared"
else
    echo "    (App not installed yet, skipping clear)"
fi

# --- Step 3: Build and install debug APK ---
cd "$PROJECT_DIR"

if $BUILD; then
    echo ""
    echo ">>> Building debug APK..."
    ./gradlew assembleDebug --quiet
fi

APK_PATH="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$APK_PATH" ]]; then
    echo "Error: APK not found at $APK_PATH"
    echo "Run ./gradlew assembleDebug first or remove --no-build flag"
    exit 1
fi

echo ""
echo ">>> Installing APK..."
adb install -r "$APK_PATH"

# --- Step 4: Set up port forwarding ---
echo ""
echo ">>> Setting up adb reverse for dev server..."
adb reverse tcp:3000 tcp:3000

# --- Step 5: Launch NativeStandaloneActivity with magnet URL ---
echo ""
echo ">>> Launching NativeStandaloneActivity with magnet..."

# Base64 encode the magnet (no line wrapping)
ENCODED_MAGNET=$(echo -n "$MAGNET" | base64 -w0)

# Build the intent URI
INTENT_URI="jstorrent://native?magnet_b64=$ENCODED_MAGNET"

echo "    Magnet: $MAGNET"
echo "    Base64: $ENCODED_MAGNET"

# Launch the activity with the intent
adb shell am start -n "$ACTIVITY" -a android.intent.action.VIEW -d "$INTENT_URI"

echo ""
echo "=== Test Started ==="
echo ""
echo "The NativeStandaloneActivity should now be loading with the magnet link."
echo ""
echo "Useful commands:"
echo "    ./emu-logs.sh                              # Watch app logs"
echo "    adb shell am force-stop $PACKAGE           # Force stop"
echo "    adb shell pm clear $PACKAGE                # Clear data again"
echo ""
