#!/bin/bash
# Build website and copy standalone assets to Android
set -e

cd "$(dirname "$0")/.."

WEBSITE_DIR="website"
ANDROID_ASSETS="android-io-daemon/app/src/main/assets"

echo "Building website..."
cd "$WEBSITE_DIR"
pnpm build

echo "Copying assets to Android..."
cd ..

# Remove old assets
rm -rf "$ANDROID_ASSETS/standalone" "$ANDROID_ASSETS/standalone_full" "$ANDROID_ASSETS/assets"

# Copy new assets
cp -r "$WEBSITE_DIR/dist/standalone" "$ANDROID_ASSETS/"
cp -r "$WEBSITE_DIR/dist/standalone_full" "$ANDROID_ASSETS/"
cp -r "$WEBSITE_DIR/dist/assets" "$ANDROID_ASSETS/"

echo "Done. Assets copied to $ANDROID_ASSETS/"
echo ""
echo "Directories updated:"
ls -la "$ANDROID_ASSETS/"
