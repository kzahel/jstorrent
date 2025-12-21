#!/bin/bash
set -xe

# Update this AND src/App.tsx TAG when releasing a new native version
TAG="v0.1.7"

# Detect OS
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Error: This script is for Linux only."
  echo "For Windows and macOS, please download the installer from:"
  echo "https://github.com/kzahel/jstorrent/releases"
  exit 1
fi

# Detect Arch
ARCH="$(uname -m)"
if [[ "$ARCH" != "x86_64" ]]; then
  echo "Error: Unsupported architecture: $ARCH"
  echo "Currently only x86_64 is supported."
  exit 1
fi

echo "Downloading JSTorrent System Bridge..."
TMP_DIR=$(mktemp -d)
cd "$TMP_DIR"

ASSET_URL="https://github.com/kzahel/jstorrent/releases/download/system-bridge-${TAG}/jstorrent-system-bridge-install-linux-x86_64.tar.gz"

if ! curl -fsSL "$ASSET_URL" -o jstorrent.tar.gz; then
  echo "Error: Failed to download release."
  echo "Please check your internet connection or try again later."
  exit 1
fi

echo "Installing..."
tar -xzf jstorrent.tar.gz
if [ -f "./install.sh" ]; then
    ./install.sh
else
    # Handle case where tarball structure might be different (e.g. inside a folder)
    # But our CI creates it flat in dist/
    echo "Error: install.sh not found in the downloaded archive."
    exit 1
fi

# Cleanup
cd ..
rm -rf "$TMP_DIR"

echo "Done!"
