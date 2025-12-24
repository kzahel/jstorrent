# android-env.sh - Source this for Android dev convenience
#
# Usage: source scripts/android-env.sh
#
# Provides:
#   - ANDROID_HOME and PATH setup
#   - Convenience aliases: emu, emu-start, emu-stop, etc.

export ANDROID_HOME="${ANDROID_HOME:-$HOME/.android-sdk}"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

# Find scripts directory (works whether sourced from repo root or scripts/)
_SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
if [[ -d "$(dirname "$_SCRIPT_SOURCE")" ]]; then
    _SCRIPTS_DIR="$(cd "$(dirname "$_SCRIPT_SOURCE")" && pwd)"
else
    _SCRIPTS_DIR="./scripts"
fi

# Aliases
alias emu-start="$_SCRIPTS_DIR/emu-start.sh"
alias emu-stop="$_SCRIPTS_DIR/emu-stop.sh"
alias emu-install="$_SCRIPTS_DIR/emu-install.sh"
alias emu-logs="$_SCRIPTS_DIR/emu-logs.sh"
alias emu-shell="adb shell"
alias emu-test-native="$_SCRIPTS_DIR/emu-test-native.sh"

# Device-specific aliases
alias emu-phone="AVD_NAME=jstorrent-dev $_SCRIPTS_DIR/emu-start.sh"
alias emu-tablet="AVD_NAME=jstorrent-tablet $_SCRIPTS_DIR/emu-start.sh"

# Quick status
alias emu-status="adb devices && adb forward --list 2>/dev/null || echo 'No forwards'"

# Shorthand for common tasks
emu() {
    case "${1:-}" in
        start)       emu-start ;;
        stop)        emu-stop ;;
        install)     shift; emu-install "$@" ;;
        logs)        shift; emu-logs "$@" ;;
        shell)       adb shell ;;
        status)      emu-status ;;
        restart)     emu-stop; sleep 1; emu-start ;;
        phone)       AVD_NAME=jstorrent-dev emu-start ;;
        tablet)      AVD_NAME=jstorrent-tablet emu-start ;;
        test-native) shift; emu-test-native "$@" ;;
        *)
            echo "Usage: emu <command>"
            echo ""
            echo "Commands:"
            echo "  start       - Start emulator (default: phone)"
            echo "  stop        - Stop emulator"
            echo "  install     - Build and install APK"
            echo "  logs        - Show filtered logcat"
            echo "  shell       - ADB shell into device"
            echo "  status      - Show devices and port forwards"
            echo "  restart     - Stop then start"
            echo "  phone       - Start phone emulator (Pixel 6)"
            echo "  tablet      - Start tablet emulator (Pixel Tablet)"
            echo "  test-native - Deploy and test NativeStandaloneActivity with magnet"
            ;;
    esac
}

echo "Android dev environment loaded"
echo "  ANDROID_HOME=$ANDROID_HOME"
echo "  Commands: emu start|stop|install|logs|shell|status|restart|phone|tablet|test-native"
