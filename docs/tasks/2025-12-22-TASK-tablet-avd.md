# Add Tablet AVD Support

## Overview

Add a second Android Virtual Device (tablet) to the emulator scripts. Users can switch between phone and tablet via `AVD_NAME` env var.

## Files to Modify

All files are in `android-io-daemon/scripts/`.

---

## 1. Update setup-emulator.sh

### 1.1 Add tablet AVD creation after phone AVD

Find this block (around line 85-95):

```bash
# Create AVD if it doesn't exist
echo ""
if "$AVDMANAGER" list avd -c | grep -q "^${AVD_NAME}$"; then
    echo ">>> AVD '$AVD_NAME' already exists"
else
```

Add a new variable near the top of the file, after `AVD_NAME="jstorrent-dev"` (around line 10):

```bash
AVD_NAME="jstorrent-dev"
AVD_NAME_TABLET="jstorrent-tablet"
```

### 1.2 Add tablet AVD creation

After the phone AVD creation block ends (after the `fi` that closes the phone AVD creation, around line 105), add:

```bash
# Create tablet AVD if it doesn't exist
echo ""
if "$AVDMANAGER" list avd -c | grep -q "^${AVD_NAME_TABLET}$"; then
    echo ">>> AVD '$AVD_NAME_TABLET' already exists"
else
    echo ">>> Creating AVD '$AVD_NAME_TABLET' (tablet)..."
    echo "no" | "$AVDMANAGER" create avd \
        --name "$AVD_NAME_TABLET" \
        --package "system-images;android-$API_LEVEL;google_apis;$SYSTEM_IMAGE" \
        --device "pixel_tablet"
    
    # Configure tablet AVD for performance
    AVD_CONFIG_TABLET="$HOME/.android/avd/${AVD_NAME_TABLET}.avd/config.ini"
    if [[ -f "$AVD_CONFIG_TABLET" ]]; then
        cat >> "$AVD_CONFIG_TABLET" << 'EOF'
hw.ramSize=2048
disk.dataPartition.size=4G
hw.keyboard=yes
hw.gpu.enabled=yes
hw.gpu.mode=auto
EOF
        echo "    Configured with 2GB RAM, 4GB storage"
    fi
fi
```

### 1.3 Update the completion message

Find the "Quick start" section at the end (around line 115-125) and update it to:

```bash
echo "Quick start:"
echo "    ./emu-start.sh                    # Start phone emulator"
echo "    AVD_NAME=jstorrent-tablet ./emu-start.sh  # Start tablet emulator"
echo "    ./emu-install.sh                  # Build and install APK"
echo "    ./emu-logs.sh                     # View filtered logs"
echo "    ./emu-stop.sh                     # Stop emulator"
echo ""
echo "AVDs created:"
echo "    jstorrent-dev    (Pixel 6 - phone)"
echo "    jstorrent-tablet (Pixel Tablet)"
echo ""
```

---

## 2. Update android-env.sh

### 2.1 Add tablet aliases

Find the `# Aliases` section (around line 18-22) and add tablet aliases:

```bash
# Aliases
alias emu-start="$_SCRIPTS_DIR/emu-start.sh"
alias emu-stop="$_SCRIPTS_DIR/emu-stop.sh"
alias emu-install="$_SCRIPTS_DIR/emu-install.sh"
alias emu-logs="$_SCRIPTS_DIR/emu-logs.sh"
alias emu-shell="adb shell"

# Device-specific aliases
alias emu-phone="AVD_NAME=jstorrent-dev $_SCRIPTS_DIR/emu-start.sh"
alias emu-tablet="AVD_NAME=jstorrent-tablet $_SCRIPTS_DIR/emu-start.sh"
```

### 2.2 Update the emu function

Find the `emu()` function and update the case statement to include phone/tablet:

```bash
emu() {
    case "${1:-}" in
        start)   emu-start ;;
        stop)    emu-stop ;;
        install) shift; emu-install "$@" ;;
        logs)    shift; emu-logs "$@" ;;
        shell)   adb shell ;;
        status)  emu-status ;;
        restart) emu-stop; sleep 1; emu-start ;;
        phone)   AVD_NAME=jstorrent-dev emu-start ;;
        tablet)  AVD_NAME=jstorrent-tablet emu-start ;;
        *)
            echo "Usage: emu <command>"
            echo ""
            echo "Commands:"
            echo "  start    - Start emulator (default: phone)"
            echo "  stop     - Stop emulator"
            echo "  install  - Build and install APK"
            echo "  logs     - Show filtered logcat"
            echo "  shell    - ADB shell into device"
            echo "  status   - Show devices and port forwards"
            echo "  restart  - Stop then start"
            echo "  phone    - Start phone emulator (Pixel 6)"
            echo "  tablet   - Start tablet emulator (Pixel Tablet)"
            ;;
    esac
}
```

### 2.3 Update the loaded message

Find the final `echo` statements and update to:

```bash
echo "Android dev environment loaded"
echo "  ANDROID_HOME=$ANDROID_HOME"
echo "  Commands: emu start|stop|install|logs|shell|status|restart|phone|tablet"
```

---

## 3. Update README.md

### 3.1 Update Quick Start section

Find the Quick Start code block and update:

```bash
# One-time setup (downloads SDK, creates phone + tablet AVDs)
./scripts/setup-emulator.sh

# Add to ~/.zshrc (setup script prints the exact lines)
export ANDROID_HOME="$HOME/.android-sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

# Start phone emulator (default)
./scripts/emu-start.sh

# Or start tablet emulator
AVD_NAME=jstorrent-tablet ./scripts/emu-start.sh

# Build and install APK
./scripts/emu-install.sh

# Watch logs
./scripts/emu-logs.sh
```

### 3.2 Add new section after "Shell Integration"

Add a new section:

```markdown
## Phone vs Tablet

Two AVDs are created by setup:

| AVD Name | Device | Use Case |
|----------|--------|----------|
| `jstorrent-dev` | Pixel 6 (phone) | Default, quick iteration |
| `jstorrent-tablet` | Pixel Tablet | ChromeOS-like form factor |

Switch between them:

```bash
# Using env var
AVD_NAME=jstorrent-tablet ./scripts/emu-start.sh

# Or with shell integration (source android-env.sh first)
emu phone    # Start phone
emu tablet   # Start tablet
```

Only one emulator runs at a time. `emu-stop.sh` stops whichever is running.
```

### 3.3 Update Disk Usage section

Find the "Disk Usage" section and update:

```markdown
## Disk Usage

Approximate sizes:
- Command-line tools: ~150MB
- Platform tools: ~50MB
- Emulator: ~400MB
- System image: ~1.2GB
- AVD phone (created): ~2-4GB
- AVD tablet (created): ~2-4GB

Total: ~6-10GB
```

---

## Verification

```bash
# Re-run setup (idempotent - will skip existing AVDs)
./scripts/setup-emulator.sh

# Should see both AVDs listed
avdmanager list avd

# Test phone
./scripts/emu-start.sh
./scripts/emu-stop.sh

# Test tablet
AVD_NAME=jstorrent-tablet ./scripts/emu-start.sh
./scripts/emu-stop.sh

# Test shell integration
source scripts/android-env.sh
emu tablet
emu stop
```
