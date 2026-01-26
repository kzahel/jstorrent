#!/usr/bin/env bash
#
# dev-test-native.sh - Deploy and test NativeStandaloneActivity with a test torrent on real devices
#
# Usage:
#   ./dev-test-native.sh <device>                    # 100MB test torrent
#   ./dev-test-native.sh <device> --size 1gb         # 1GB test torrent
#   ./dev-test-native.sh <device> --null             # Null storage (discard writes)
#   ./dev-test-native.sh <device> --no-build         # Skip build
#
# This script:
#   1. Builds the TypeScript engine bundle
#   2. Builds and installs debug APK
#   3. Launches NativeStandaloneActivity with test magnet (kitchen sink peer hints)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MONOREPO_ROOT="$(cd "$PROJECT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/device-config.sh"

PACKAGE="com.jstorrent.app"
ACTIVITY="com.jstorrent.app/.NativeStandaloneActivity"

# Test magnets with kitchen sink peer hints (covers emulator, localhost, LAN IPs)
# Run `pnpm seed-for-test` or `pnpm seed-for-test --size 1gb` to start the seeder
# Kitchen sink hosts: 10.0.2.2, 127.0.0.1, 100.115.92.206, 192.168.1.107, 192.168.1.131, 192.168.1.139
MAGNET_100MB="magnet:?xt=urn:btih:67d01ece1b99c49c257baada0f760b770a7530b9&dn=testdata_100mb.bin&x.pe=10.0.2.2:6881&x.pe=127.0.0.1:6881&x.pe=100.115.92.206:6881&x.pe=192.168.1.107:6881&x.pe=192.168.1.131:6881&x.pe=192.168.1.139:6881"
MAGNET_1GB="magnet:?xt=urn:btih:18a7aacab6d2bc518e336921ccd4b6cc32a9624b&dn=testdata_1gb.bin&x.pe=10.0.2.2:6881&x.pe=127.0.0.1:6881&x.pe=100.115.92.206:6881&x.pe=192.168.1.107:6881&x.pe=192.168.1.131:6881&x.pe=192.168.1.139:6881"

# Defaults
BUILD=true
BUILD_BUNDLE=true
BUILD_TYPE="debug"
STORAGE_MODE=""
CLEAR_STORAGE=false
SIZE="100mb"
DEVICE_NAME=""
MAGNET=""

usage() {
    echo "Usage: $0 <device> [OPTIONS] [magnet:?xt=urn:btih:...]"
    echo ""
    echo "Deploy and launch test torrent on a real device"
    echo ""
    echo "Arguments:"
    echo "  <device>           Device name from ~/.jstorrent-devices"
    echo ""
    echo "Options:"
    echo "  --no-build         Skip gradle build AND engine bundle"
    echo "  --no-bundle        Skip engine bundle build only"
    echo "  --release          Build release APK instead of debug"
    echo "  --clear            Clear app storage before launching"
    echo "  --size SIZE        Test torrent size: 100mb (default) or 1gb"
    echo "  --private          Use private app storage (bypasses SAF)"
    echo "  --null             Discard all writes (performance testing)"
    echo "  -h, --help         Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 pixel7a                     # 100MB test torrent"
    echo "  $0 pixel7a --size 1gb          # 1GB test torrent"
    echo "  $0 pixel7a --null              # Null storage (benchmark mode)"
    echo "  $0 pixel7a --no-build --null   # Skip build, null storage"
    echo "  $0 pixel7a \"magnet:?xt=...\"    # Custom magnet"
    exit 0
}

# Parse args
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
            usage
            ;;
        magnet:*)
            MAGNET="$1"
            shift
            ;;
        -*)
            echo "Error: Unknown option: $1"
            usage
            ;;
        *)
            if [[ -z "$DEVICE_NAME" ]]; then
                DEVICE_NAME="$1"
            else
                echo "Error: Multiple device names specified"
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$DEVICE_NAME" ]]; then
    echo "Error: Device name required"
    echo ""
    usage
fi

# Load device config
if ! load_device_config "$DEVICE_NAME"; then
    echo ""
    echo "Available devices:"
    list_all_devices 2>/dev/null || true
    exit 1
fi

# Select magnet if none specified
if [[ -z "$MAGNET" ]]; then
    case "$SIZE" in
        1gb|1GB)
            MAGNET="$MAGNET_1GB"
            echo ">>> Using 1GB test magnet (testdata_1gb.bin)"
            ;;
        100mb|100MB)
            MAGNET="$MAGNET_100MB"
            echo ">>> Using 100MB test magnet (testdata_100mb.bin)"
            ;;
        *)
            echo "Error: Unknown size '$SIZE'. Use '100mb' or '1gb'."
            exit 1
            ;;
    esac
fi

cd "$PROJECT_DIR"

# --- Step 1: Optionally clear app storage ---
if $CLEAR_STORAGE; then
    echo ""
    echo ">>> Clearing app storage..."
    if run_adb_command "$DEVICE_NAME" shell pm clear "$PACKAGE" 2>/dev/null; then
        echo "    App storage cleared"
    else
        echo "    (App not installed yet, skipping clear)"
    fi
fi

# --- Step 2: Build engine bundle ---
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

# --- Step 3: Build and install APK ---
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
echo ">>> Installing APK to $DEVICE_NAME ($DEVICE_TYPE)..."

case "$DEVICE_TYPE" in
    serial|wifi)
        adb -s "$DEVICE_CONNECTION" install -r -t "$APK_PATH"
        ;;
    ssh)
        SSH_HOST="${DEVICE_CONNECTION%%:*}"
        REMOTE_ADB="${DEVICE_CONNECTION#*:}"
        REMOTE_HOME=$(ssh "$SSH_HOST" 'echo $HOME')
        REMOTE_ADB="${REMOTE_ADB/#\~/$REMOTE_HOME}"
        REMOTE_APK="/tmp/jstorrent-app-$BUILD_TYPE.apk"

        echo "Copying APK to $SSH_HOST:$REMOTE_APK..."
        scp "$APK_PATH" "$SSH_HOST:$REMOTE_APK"

        echo "Installing via remote adb..."
        ssh "$SSH_HOST" "$REMOTE_ADB install -r -t '$REMOTE_APK'"
        ;;
esac

# --- Step 4: Launch NativeStandaloneActivity with magnet URL ---
echo ""
echo ">>> Launching NativeStandaloneActivity with magnet..."

# Base64 encode the magnet (no line wrapping)
if [[ "$(uname)" == "Darwin" ]]; then
    ENCODED_MAGNET=$(echo -n "$MAGNET" | base64)
else
    ENCODED_MAGNET=$(echo -n "$MAGNET" | base64 -w0)
fi

# Build the intent URI
# Always use replace=true to ensure fresh start (removes existing torrent if present)
INTENT_URI="jstorrent://native?magnet_b64=$ENCODED_MAGNET&replace=true"
if [[ -n "$STORAGE_MODE" ]]; then
    INTENT_URI="${INTENT_URI}&storage=$STORAGE_MODE"
    echo ">>> Using storage mode: $STORAGE_MODE"
fi

echo "    Magnet: ${MAGNET:0:80}..."
echo "    Intent URI: ${INTENT_URI:0:80}..."

# Launch the activity with the intent
# Note: & must be escaped for adb shell
ESCAPED_URI="${INTENT_URI//&/\\&}"
run_adb_command "$DEVICE_NAME" shell am start -n "$ACTIVITY" -a android.intent.action.VIEW -d "$ESCAPED_URI"

echo ""
echo "=== Test Started on $DEVICE_NAME ==="
echo ""
echo "Useful commands:"
echo "    ./dev-logs.sh $DEVICE_NAME           # Watch app logs"
echo "    ./dev-reset.sh $DEVICE_NAME          # Clear app data"
echo "    ./dev-shell.sh $DEVICE_NAME          # ADB shell"
echo ""
