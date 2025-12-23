#!/bin/bash
# Deploy Android APK to Chromebook
#
# Usage:
#   ./scripts/deploy-android-chromebook.sh           # Deploy debug APK
#   ./scripts/deploy-android-chromebook.sh release   # Deploy release APK
#   ./scripts/deploy-android-chromebook.sh --forward # Deploy debug + port forwarding
#   ./scripts/deploy-android-chromebook.sh release --forward
#
# Port forwarding sets up SSH reverse tunnel + ADB reverse so Android app
# can reach localhost:3000 dev server running on this machine.

set -e

CHROMEBOOK_HOST="${CHROMEBOOK_HOST:-chromebook}"
DEV_SERVER_PORT="${DEV_SERVER_PORT:-3000}"
BUILD_TYPE="debug"
SETUP_FORWARD=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --forward|-f)
            SETUP_FORWARD=true
            ;;
        release)
            BUILD_TYPE="release"
            ;;
        debug)
            BUILD_TYPE="debug"
            ;;
    esac
done

# Get remote home directory for path expansion
REMOTE_HOME=$(ssh "$CHROMEBOOK_HOST" 'echo $HOME')
# Use same project path structure on Chromebook crostini
REMOTE_PROJECT_DIR="${REMOTE_PROJECT_DIR:-$REMOTE_HOME/code/jstorrent-monorepo/android}"
# Full path to adb (needed for non-interactive SSH since .bashrc exits early)
REMOTE_ADB="${REMOTE_ADB:-$REMOTE_HOME/android-sdk/platform-tools/adb}"

cd "$(dirname "$0")/../android"

# Build APK
echo "Building $BUILD_TYPE APK..."
if [ "$BUILD_TYPE" = "release" ]; then
    ./gradlew assembleRelease
    APK_SUBPATH="app/build/outputs/apk/release/app-release.apk"
else
    ./gradlew assembleDebug
    APK_SUBPATH="app/build/outputs/apk/debug/app-debug.apk"
fi

# Create output directory on Chromebook and copy APK
APK_DIR=$(dirname "$APK_SUBPATH")
echo "Copying APK to $CHROMEBOOK_HOST:$REMOTE_PROJECT_DIR/$APK_SUBPATH..."
ssh "$CHROMEBOOK_HOST" "mkdir -p \"$REMOTE_PROJECT_DIR/$APK_DIR\""
scp "$APK_SUBPATH" "$CHROMEBOOK_HOST:$REMOTE_PROJECT_DIR/$APK_SUBPATH"

# Install via adb on Chromebook
echo "Installing APK on Chromebook..."
ssh "$CHROMEBOOK_HOST" "$REMOTE_ADB install -r -t \"$REMOTE_PROJECT_DIR/$APK_SUBPATH\""

echo "Done! Android app deployed and installed."

# Set up port forwarding if requested
if [ "$SETUP_FORWARD" = true ]; then
    echo ""
    echo "Setting up port forwarding for dev server (port $DEV_SERVER_PORT)..."

    # Set up ADB reverse on Chromebook (Android localhost -> Chromebook localhost)
    echo "Setting up ADB reverse tcp:$DEV_SERVER_PORT..."
    ssh "$CHROMEBOOK_HOST" "$REMOTE_ADB reverse tcp:$DEV_SERVER_PORT tcp:$DEV_SERVER_PORT"

    # Check if SSH tunnel already exists
    if pgrep -f "ssh.*-R $DEV_SERVER_PORT:localhost:$DEV_SERVER_PORT.*$CHROMEBOOK_HOST" > /dev/null; then
        echo "SSH reverse tunnel already running."
    else
        echo "Starting SSH reverse tunnel (local :$DEV_SERVER_PORT -> Chromebook :$DEV_SERVER_PORT)..."
        # -f: background, -N: no command, -R: reverse tunnel
        ssh -f -N -R "$DEV_SERVER_PORT:localhost:$DEV_SERVER_PORT" "$CHROMEBOOK_HOST"
        echo "SSH tunnel started in background."
    fi

    echo ""
    echo "Port forwarding active! Android app can now reach localhost:$DEV_SERVER_PORT"
    echo "To stop the SSH tunnel later: pkill -f 'ssh.*-R $DEV_SERVER_PORT.*$CHROMEBOOK_HOST'"
fi
