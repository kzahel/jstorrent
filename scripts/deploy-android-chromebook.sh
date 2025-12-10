#!/bin/bash
# Deploy android-io-daemon APK to Chromebook
#
# Usage:
#   ./scripts/deploy-android-chromebook.sh           # Deploy debug APK
#   ./scripts/deploy-android-chromebook.sh release   # Deploy release APK

set -e

CHROMEBOOK_HOST="${CHROMEBOOK_HOST:-chromebook}"
BUILD_TYPE="${1:-debug}"

# Get remote home directory for path expansion
REMOTE_HOME=$(ssh "$CHROMEBOOK_HOST" 'echo $HOME')
# Use same project path structure on Chromebook crostini
REMOTE_PROJECT_DIR="${REMOTE_PROJECT_DIR:-$REMOTE_HOME/code/jstorrent-monorepo/android-io-daemon}"
# Full path to adb (needed for non-interactive SSH since .bashrc exits early)
REMOTE_ADB="${REMOTE_ADB:-$REMOTE_HOME/android-sdk/platform-tools/adb}"

cd "$(dirname "$0")/../android-io-daemon"

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
