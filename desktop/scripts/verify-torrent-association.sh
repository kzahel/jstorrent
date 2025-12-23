#!/bin/bash
set -e

# Ensure we are in the system-bridge directory
if [ ! -f "Cargo.toml" ]; then
    echo "Error: This script must be run from the system-bridge directory."
    exit 1
fi

echo "Verifying Torrent File Association..."

# Create a dummy torrent file
TEST_TORRENT="test.torrent"
echo "d8:announce35:udp://tracker.openbittorrent.com:8013:creation datei1323387950e4:infod6:lengthi12345e4:name10:test.file12:piece lengthi65536e6:pieces20:01234567890123456789ee" > "$TEST_TORRENT"

# Cleanup on exit
cleanup() {
    rm -f "$TEST_TORRENT"
    # Clean up config file created for test
    rm -f "$HOME/.config/jstorrent-native/jstorrent-native.env"
    rm -f "$HOME/.config/jstorrent-native/rpc-info-Mock.json"
    rm -f "$HOME/.config/jstorrent-native/mock_browser"
}
trap cleanup EXIT

# Setup configuration for headless testing
mkdir -p "$HOME/.config/jstorrent-native"
echo "LOGFILE=true" > "$HOME/.config/jstorrent-native/jstorrent-native.env"
echo "LAUNCH_URL=http://local.jstorrent.com:3000/launch/index.html" >> "$HOME/.config/jstorrent-native/jstorrent-native.env"

# Create a mock browser script that runs chrome headless
MOCK_BROWSER="$HOME/.config/jstorrent-native/mock_browser"
cat > "$MOCK_BROWSER" <<EOF
#!/bin/bash
echo "Mock browser launched with args: \$@" >> "$HOME/.config/jstorrent-native/mock_browser.log"
# We can try to run actual chrome headless if available, or just exit success.
# The user wants to verify that the browser is launched.
# If we just log it, we can verify the log.
# But if we want to be "end to end", maybe we should actually run chrome?
# The user said: "i noticed a real browser window opened. please be sure to use headless new"
# This implies they want the real browser to run, but headless.
# Let's try to find chrome/chromium and run it headless.

BROWSER_BIN=""
if command -v google-chrome >/dev/null; then BROWSER_BIN="google-chrome"; fi
if [ -z "\$BROWSER_BIN" ] && command -v chromium >/dev/null; then BROWSER_BIN="chromium"; fi
if [ -z "\$BROWSER_BIN" ] && command -v google-chrome-stable >/dev/null; then BROWSER_BIN="google-chrome-stable"; fi

if [ -n "\$BROWSER_BIN" ]; then
    "\$BROWSER_BIN" --headless=new "\$@" &
else
    echo "No browser found to run headless."
fi
EOF
chmod +x "$MOCK_BROWSER"

# Create fake rpc-info to point to mock browser
cat > "$HOME/.config/jstorrent-native/rpc-info-Mock.json" <<EOF
{
  "version": 1,
  "browser": {
    "name": "MockBrowser",
    "binary": "$MOCK_BROWSER",
    "profile_id": "Mock",
    "profile_path": null,
    "extension_id": null
  },
  "port": 0,
  "token": "mock",
  "pid": 0,
  "started": 0,
  "last_used": 9999999999
}
EOF

# 1. Verify MIME type detection
MIME_TYPE=$(xdg-mime query filetype "$TEST_TORRENT")
echo "MIME type for $TEST_TORRENT: $MIME_TYPE"

if [[ "$MIME_TYPE" != "application/x-bittorrent" ]]; then
    echo "Warning: MIME type is not application/x-bittorrent (got $MIME_TYPE). This might be due to missing shared-mime-info database updates in this environment."
    # We might not be able to fix this easily in a minimal env, but let's proceed to check the default app registration.
fi

# 2. Verify Default Application
DEFAULT_APP=$(xdg-mime query default application/x-bittorrent)
echo "Default app for application/x-bittorrent: $DEFAULT_APP"

if [[ "$DEFAULT_APP" != "jstorrent-magnet.desktop" ]]; then
    echo "Error: Default app is not jstorrent-magnet.desktop (got $DEFAULT_APP)"
    exit 1
fi

echo "Association verification passed!"

# 3. Verify Handler Invocation
# We'll invoke the handler directly with the file path to ensure it handles it, 
# simulating what xdg-open would do.
# We can also try xdg-open if we want to be thorough, but direct invocation is a safer test of the binary itself.

HANDLER_BIN="$HOME/.local/lib/jstorrent-native/jstorrent-link-handler"
LOG_FILE="$HOME/.local/lib/jstorrent-native/jstorrent-log-handler.log"

# Clear log file
echo "" > "$LOG_FILE"

echo "Invoking handler with $TEST_TORRENT..."
"$HANDLER_BIN" "$(pwd)/$TEST_TORRENT"

# Check log for success
if grep -q "Link Handler finished successfully" "$LOG_FILE"; then
    echo "Handler successfully processed the file."
else
    echo "Error: Handler did not finish successfully. Check log:"
    cat "$LOG_FILE"
    exit 1
fi

# Check log for file path
if grep -q "$(pwd)/$TEST_TORRENT" "$LOG_FILE"; then
    echo "Handler received correct file path."
else
    echo "Error: Handler did not log the correct file path."
    exit 1
fi

# Check mock browser log for custom URL
MOCK_LOG="$HOME/.config/jstorrent-native/mock_browser.log"
if grep -q "http://local.jstorrent.com:3000/launch/index.html" "$MOCK_LOG"; then
    echo "Mock browser received custom LAUNCH_URL."
else
    echo "Error: Mock browser did not receive custom LAUNCH_URL. Log content:"
    cat "$MOCK_LOG"
    exit 1
fi

echo "Torrent file verification passed!"
