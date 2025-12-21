#!/usr/bin/env bash
#
# emu-logs.sh - Filtered logcat for JSTorrent Android daemon
#
set -euo pipefail

SDK_ROOT="${ANDROID_HOME:-$HOME/.android-sdk}"
export PATH="$SDK_ROOT/platform-tools:$PATH"

# Check emulator is running
if ! adb devices 2>/dev/null | grep -q "emulator-"; then
    echo "Error: No emulator running. Start one with: ./emu-start.sh"
    exit 1
fi

# Default: filter to JSTorrent + Ktor + common errors
# Override with: ./emu-logs.sh --all
FILTER="JSTorrent:V Ktor:V OkHttp:V AndroidRuntime:E *:S"

if [[ "${1:-}" == "--all" ]]; then
    FILTER=""
    echo "Showing all logs (unfiltered)..."
elif [[ "${1:-}" == "--http" ]]; then
    FILTER="JSTorrent:V Ktor:V OkHttp:V *:S"
    echo "Showing HTTP-related logs..."
elif [[ "${1:-}" == "--crash" ]]; then
    FILTER="AndroidRuntime:E *:S"
    echo "Showing crashes only..."
else
    echo "Showing JSTorrent logs (use --all for everything, --http for network, --crash for errors)..."
fi

echo "Press Ctrl+C to stop"
echo "---"

# Clear existing logs and start fresh
adb logcat -c
adb logcat $FILTER
