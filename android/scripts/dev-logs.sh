#!/usr/bin/env bash
#
# dev-logs.sh - Filtered logcat for JSTorrent on real devices
#
# Usage:
#   ./dev-logs.sh <device>           # Default JSTorrent logs
#   ./dev-logs.sh <device> --all     # All logs
#   ./dev-logs.sh <device> --http    # Network logs
#   ./dev-logs.sh <device> --crash   # Crashes only
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/device-config.sh"

DEVICE_NAME=""
FILTER="JSTorrent:V Ktor:V OkHttp:V AndroidRuntime:E *:S"
FILTER_DESC="JSTorrent logs (use --all for everything, --http for network, --crash for errors)"

usage() {
    echo "Usage: $0 <device> [OPTIONS]"
    echo ""
    echo "Watch logcat from a named device"
    echo ""
    echo "Arguments:"
    echo "  <device>       Device name from ~/.jstorrent-devices"
    echo ""
    echo "Options:"
    echo "  --all          Show all logs (unfiltered)"
    echo "  --http         Show HTTP/network logs only"
    echo "  --crash        Show crashes/errors only"
    echo "  -h, --help     Show this help message"
    exit 0
}

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --all)
            FILTER=""
            FILTER_DESC="all logs (unfiltered)"
            shift
            ;;
        --http)
            FILTER="JSTorrent:V Ktor:V OkHttp:V *:S"
            FILTER_DESC="HTTP-related logs"
            shift
            ;;
        --crash)
            FILTER="AndroidRuntime:E *:S"
            FILTER_DESC="crashes only"
            shift
            ;;
        -h|--help) usage ;;
        -*)
            echo "Unknown option: $1"
            exit 1
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

echo "Showing $FILTER_DESC from $DEVICE_NAME..."
echo "Press Ctrl+C to stop"
echo "---"

case "$DEVICE_TYPE" in
    serial|wifi)
        # Clear existing logs and start fresh
        adb -s "$DEVICE_CONNECTION" logcat -c
        # shellcheck disable=SC2086
        adb -s "$DEVICE_CONNECTION" logcat $FILTER
        ;;
    ssh)
        SSH_HOST="${DEVICE_CONNECTION%%:*}"
        REMOTE_ADB="${DEVICE_CONNECTION#*:}"
        REMOTE_HOME=$(ssh "$SSH_HOST" 'echo $HOME')
        REMOTE_ADB="${REMOTE_ADB/#\~/$REMOTE_HOME}"

        # Clear and stream logs
        ssh "$SSH_HOST" "$REMOTE_ADB logcat -c"
        ssh "$SSH_HOST" "$REMOTE_ADB logcat $FILTER"
        ;;
esac
