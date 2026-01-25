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
#   2. Optionally clears app storage (if --clear flag is used)
#   3. Builds the TypeScript engine bundle
#   4. Builds and installs debug APK
#   5. Launches NativeStandaloneActivity with base64-encoded magnet URL
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MONOREPO_ROOT="$(cd "$PROJECT_DIR/.." && pwd)"
SDK_ROOT="${ANDROID_HOME:-$HOME/.android-sdk}"
AVD_NAME="${AVD_NAME:-jstorrent-dev}"
PACKAGE="com.jstorrent.app"
ACTIVITY="com.jstorrent.app/.NativeStandaloneActivity"

# Ensure tools are in PATH
export PATH="$SDK_ROOT/cmdline-tools/latest/bin:$SDK_ROOT/platform-tools:$SDK_ROOT/emulator:$PATH"

# Test magnets (deterministic test data from libtorrent seeder)
# Run `pnpm seed-for-test` or `pnpm seed-for-test --size 1gb` to start the seeder
# Peer hints: 10.0.2.2 (emulator->host), 127.0.0.1 (desktop/extension)
# Uses v1 infohash (SHA1 of full info dict), not truncated v2 hash
MAGNET_100MB="magnet:?xt=urn:btih:67d01ece1b99c49c257baada0f760b770a7530b9&dn=testdata_100mb.bin&x.pe=10.0.2.2:6881&x.pe=127.0.0.1:6881"
MAGNET_1GB="magnet:?xt=urn:btih:18a7aacab6d2bc518e336921ccd4b6cc32a9624b&dn=testdata_1gb.bin&x.pe=10.0.2.2:6881&x.pe=127.0.0.1:6881"
DEFAULT_MAGNET="$MAGNET_100MB"

# Parse arguments
BUILD=true
BUILD_BUNDLE=true
BUILD_TYPE="debug"
MAGNET=""
STORAGE_MODE=""
CLEAR_STORAGE=false
SIZE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-build)
            BUILD=false
            BUILD_BUNDLE=false
            shift
            ;;
        --no-bundle)
            BUILD_BUNDLE=false
            shift
            ;;
        --release)
            BUILD_TYPE="release"
            shift
            ;;
        --private|--test)
            if [[ "$STORAGE_MODE" == "null" ]]; then
                echo "Error: --private and --null are mutually exclusive"
                exit 1
            fi
            STORAGE_MODE="private"
            shift
            ;;
        --null)
            if [[ "$STORAGE_MODE" == "private" ]]; then
                echo "Error: --null and --private are mutually exclusive"
                exit 1
            fi
            STORAGE_MODE="null"
            shift
            ;;
        --clear)
            CLEAR_STORAGE=true
            shift
            ;;
        --size)
            SIZE="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--no-build] [--no-bundle] [--release] [--clear] [--size SIZE] [--private|--null] [\"magnet:?xt=urn:btih:...\"]"
            echo ""
            echo "Options:"
            echo "  --no-build    Skip gradle build AND engine bundle (use existing APK)"
            echo "  --no-bundle   Skip engine bundle build only (gradle still runs)"
            echo "  --release     Build and install release APK instead of debug"
            echo "  --clear       Clear app storage before launching (removes SAF root)"
            echo "  --size SIZE   Use test torrent of given size (100mb or 1gb, default: 100mb)"
            echo "  --private     Use private app storage (bypasses SAF folder picker)"
            echo "  --null        Discard all writes (performance testing, bypasses SAF)"
            echo "  -h, --help    Show this help"
            echo ""
            echo "Storage modes (mutually exclusive, both bypass SAF dialog):"
            echo "  --private     Writes to app's private storage directory"
            echo "  --null        Discards all writes (for testing download speed)"
            echo ""
            echo "If no magnet is specified, uses default test torrent with peer hints."
            echo ""
            echo "Example:"
            echo "  $0                          # Use default test magnet (100mb, debug build)"
            echo "  $0 --size 1gb               # Use 1GB test torrent"
            echo "  $0 --release                # Release build"
            echo "  $0 --null                   # Null storage (discards writes)"
            echo "  $0 --private                # Private app storage"
            echo "  $0 --no-bundle --null       # Skip bundle build, null storage"
            echo "  $0 \"magnet:?xt=urn:btih:...\" # Use custom magnet"
            exit 0
            ;;
        magnet:*)
            MAGNET="$1"
            shift
            ;;
        *)
            echo "Error: Unknown option: $1"
            echo "Usage: $0 [--no-build] [--no-bundle] [--release] [--clear] [--private|--null] [\"magnet:?xt=urn:btih:...\"]"
            exit 1
            ;;
    esac
done

# Use default magnet if none specified
if [[ -z "$MAGNET" ]]; then
    case "$SIZE" in
        1gb|1GB)
            MAGNET="$MAGNET_1GB"
            echo ">>> Using 1GB test magnet (testdata_1gb.bin)"
            ;;
        100mb|100MB|"")
            MAGNET="$MAGNET_100MB"
            echo ">>> Using 100MB test magnet (testdata_100mb.bin)"
            ;;
        *)
            echo "Error: Unknown size '$SIZE'. Use '100mb' or '1gb'."
            exit 1
            ;;
    esac
fi

# --- Step 1: Ensure emulator is running ---
echo ">>> Checking emulator status..."
EMU_SERIAL=$(adb devices 2>/dev/null | grep -o 'emulator-[0-9]*' | head -1)
if [[ -n "$EMU_SERIAL" ]]; then
    echo "    Emulator already running ($EMU_SERIAL)"
else
    echo ">>> Starting emulator '$AVD_NAME'..."
    "$SCRIPT_DIR/emu-start.sh"
    # Re-detect after starting
    EMU_SERIAL=$(adb devices 2>/dev/null | grep -o 'emulator-[0-9]*' | head -1)
fi

# Use emulator-specific adb command
adb_emu() {
    adb -s "$EMU_SERIAL" "$@"
}

# --- Step 2: Optionally clear app storage ---
if $CLEAR_STORAGE; then
    echo ""
    echo ">>> Clearing app storage..."
    if adb_emu shell pm clear "$PACKAGE" 2>/dev/null; then
        echo "    App storage cleared"
    else
        echo "    (App not installed yet, skipping clear)"
    fi
fi

# --- Step 3: Build engine bundle ---
if $BUILD_BUNDLE; then
    echo ""
    echo ">>> Building TypeScript engine bundle..."
    cd "$MONOREPO_ROOT/packages/engine"
    pnpm bundle:native

    # Copy bundle to Android assets
    mkdir -p "$PROJECT_DIR/quickjs-engine/src/main/assets"
    cp dist/engine.native.js "$PROJECT_DIR/quickjs-engine/src/main/assets/engine.bundle.js"
    echo "    Bundle copied to Android assets"
fi

# --- Step 4: Build and install APK ---
cd "$PROJECT_DIR"

if $BUILD; then
    echo ""
    echo ">>> Building $BUILD_TYPE APK..."
    if [[ "$BUILD_TYPE" == "release" ]]; then
        ./gradlew assembleRelease --quiet
    else
        ./gradlew assembleDebug --quiet
    fi
fi

APK_PATH="$PROJECT_DIR/app/build/outputs/apk/$BUILD_TYPE/app-$BUILD_TYPE.apk"
if [[ ! -f "$APK_PATH" ]]; then
    echo "Error: APK not found at $APK_PATH"
    echo "Run ./gradlew assemble${BUILD_TYPE^} first or remove --no-build flag"
    exit 1
fi

echo ""
echo ">>> Installing APK to $EMU_SERIAL..."
adb_emu install -r "$APK_PATH"

# --- Step 5: Set up port forwarding ---
echo ""
echo ">>> Setting up adb reverse for dev server..."
adb_emu reverse tcp:3000 tcp:3000

# --- Step 6: Launch NativeStandaloneActivity with magnet URL ---
echo ""
echo ">>> Launching NativeStandaloneActivity with magnet..."

# Base64 encode the magnet (no line wrapping)
ENCODED_MAGNET=$(echo -n "$MAGNET" | base64 -w0)

# Build the intent URI
# Always use replace=true to ensure fresh start (removes existing torrent if present)
INTENT_URI="jstorrent://native?magnet_b64=$ENCODED_MAGNET&replace=true"
if [[ -n "$STORAGE_MODE" ]]; then
    INTENT_URI="${INTENT_URI}&storage=$STORAGE_MODE"
    echo ">>> Using storage mode: $STORAGE_MODE"
fi

echo "    Magnet: $MAGNET"
echo "    Base64: $ENCODED_MAGNET"
echo "    Intent URI: $INTENT_URI"

# Launch the activity with the intent
# Note: & must be escaped for adb shell (double escape: \& -> & in remote shell)
ESCAPED_URI="${INTENT_URI//&/\\&}"
adb_emu shell am start -n "$ACTIVITY" -a android.intent.action.VIEW -d "$ESCAPED_URI"

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
