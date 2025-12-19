#!/bin/bash
# Wrapper script for signed macOS builds
# Usage: ./scripts/build-signed.sh [--notarize]

set -e

cd "$(dirname "$0")/.."

# Signing identities (from your keychain)
export CODESIGN_IDENTITY="Developer ID Application: Kyle Graehl (VD7BYQ6ABM)"
export INSTALLER_IDENTITY="Developer ID Installer: Kyle Graehl (VD7BYQ6ABM)"

# Notarization credentials (keychain profile name from xcrun notarytool store-credentials)
export NOTARIZE_PROFILE="AC_PASSWORD"

# Run the build
if [[ "$1" == "--notarize" ]]; then
    ./scripts/build-macos-installer.sh --notarize
else
    ./scripts/build-macos-installer.sh --sign
fi
