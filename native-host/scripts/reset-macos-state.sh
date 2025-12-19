#!/bin/bash
# Reset JSTorrent state on macOS for testing
# This removes saved preferences, download roots, and optionally TCC permissions

set -e

APP_SUPPORT_DIR="$HOME/Library/Application Support/JSTorrent"
JSTORRENT_LOWER="$HOME/Library/Application Support/jstorrent"

echo "=== JSTorrent macOS State Reset ==="
echo

# Kill any running JSTorrent processes
echo "Stopping running processes..."
pkill -f "jstorrent-native-host" 2>/dev/null && echo "Stopped jstorrent-native-host" || true
pkill -f "jstorrent-io-daemon" 2>/dev/null && echo "Stopped jstorrent-io-daemon" || true
pkill -f "jstorrent-link-handler" 2>/dev/null && echo "Stopped jstorrent-link-handler" || true
sleep 0.5
echo

# Remove app state (rpc-info.json contains download roots, etc.)
echo "Removing app state..."

if [ -f "$APP_SUPPORT_DIR/rpc-info.json" ]; then
    rm -v "$APP_SUPPORT_DIR/rpc-info.json"
fi

if [ -f "$JSTORRENT_LOWER/rpc-info.json" ]; then
    rm -v "$JSTORRENT_LOWER/rpc-info.json"
fi

# Remove any other state files
for dir in "$APP_SUPPORT_DIR" "$JSTORRENT_LOWER"; do
    if [ -d "$dir" ]; then
        # Remove log files
        rm -fv "$dir"/*.log 2>/dev/null || true
        # Remove any cached data
        rm -fv "$dir"/*.cache 2>/dev/null || true
    fi
done

echo
echo "App state cleared."
echo

# Reset TCC permissions
echo "Resetting TCC (folder access) permissions..."
echo "Note: This may require sudo and might prompt for password."
echo

# Reset Downloads folder access
tccutil reset SystemPolicyDownloadsFolder 2>/dev/null && echo "Reset Downloads folder permissions" || echo "Could not reset Downloads permissions (may need sudo)"

# Reset Documents folder access
tccutil reset SystemPolicyDocumentsFolder 2>/dev/null && echo "Reset Documents folder permissions" || echo "Could not reset Documents permissions (may need sudo)"

# Reset Desktop folder access
tccutil reset SystemPolicyDesktopFolder 2>/dev/null && echo "Reset Desktop folder permissions" || echo "Could not reset Desktop permissions (may need sudo)"

echo
echo "=== Reset Complete ==="
echo
echo "The next time you use the folder picker:"
echo "  - It will start at your home directory"
echo "  - No saved download roots will be remembered"
echo "  - macOS may ask for folder access permissions again"
echo
