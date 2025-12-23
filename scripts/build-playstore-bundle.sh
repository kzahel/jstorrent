#!/bin/bash
# Build signed Android App Bundle for Play Store upload
set -e

SCRIPT_DIR="$(dirname "$0")"

# Build and copy web assets first
"$SCRIPT_DIR/update-android-web-assets.sh"

cd "$SCRIPT_DIR/../android"

# Path relative to app/ module (for gradle)
KEYSTORE_PATH="signing/upload.keystore"
KEY_ALIAS="upload"

# Check file exists (path relative to android/)
if [ ! -f "app/$KEYSTORE_PATH" ]; then
    echo "Error: Keystore not found at app/$KEYSTORE_PATH"
    exit 1
fi

# Prompt for password (hidden input)
echo -n "Enter keystore password: "
read -s PASSWORD
echo

# Build the bundle
./gradlew bundleRelease \
    -PUPLOAD_KEYSTORE_PATH="$KEYSTORE_PATH" \
    -PUPLOAD_KEYSTORE_PASSWORD="$PASSWORD" \
    -PUPLOAD_KEY_ALIAS="$KEY_ALIAS" \
    -PUPLOAD_KEY_PASSWORD="$PASSWORD"

OUTPUT="app/build/outputs/bundle/release/app-release.aab"
echo ""
echo "Bundle created at: $(pwd)/$OUTPUT"
echo "Upload this file to Play Console."
