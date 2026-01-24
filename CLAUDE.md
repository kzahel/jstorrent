# Claude Instructions

## Environment Setup

Before running commands that require Java, Rust, or other development tools, source the shell profile:

```bash
source ~/.profile
```

This loads PATH entries for:
- Java (required for Android/Gradle builds)
- Rust/Cargo
- Other development tools

## Git Configuration and Commit Attribution

### User Identity Management

**CRITICAL**: When using Claude Code research preview (claude.ai/code), proper git commit attribution is required.

#### Before ANY git push operations:

1. **Check current git configuration**:
   ```bash
   git config user.name
   git config user.email
   ```

2. **If the email is `noreply@anthropic.com` or name is just `Claude`**:
   - **STOP** - Do not proceed with the push
   - Ask the user which identity should be used for commits
   - Configure git with the correct user details before pushing

3. **Never push commits** with these default values:
   - Name: `Claude`
   - Email: `noreply@anthropic.com`

#### Authorized Users

| Name | Email |
|------|-------|
| Kyle Graehl | kgraehl@gmail.com |
| Graehl Arts | graehlarts@gmail.com |

#### Setting Git Config

When the user confirms their identity, set git config:

```bash
git config user.name "User Name"
git config user.email "user@email.com"
```

#### Workflow

1. At the start of any session involving commits/pushes, verify git config
2. If using placeholder values, ask: "Which user are you? (Kyle Graehl or Graehl Arts?)"
3. Configure git with the appropriate credentials
4. Proceed with commits and pushes

This ensures proper commit history attribution across all work.

## Python Workflow

This project uses [uv](https://docs.astral.sh/uv/) for Python package management.

When working with Python projects:
1. Use `uv sync` to install dependencies
2. Use `uv run python script.py` to run scripts
3. Each Python project has its own `pyproject.toml` and `uv.lock`

Python projects in this repo:
- `desktop/` - Native host verification tests
- `packages/engine/integration/python/` - Engine integration tests
- `extension/tools/` - Extension debugging tools
- `chromeos-testbed/chromeos-mcp/` - ChromeOS MCP server

## TypeScript Editing Workflow

The `pnpm` scripts are for TypeScript packages (extension, engine, etc.).

After editing TypeScript files, run the following checks in order:

1. `pnpm run typecheck` - Verify type correctness
2. `pnpm run test` - Run unit tests
3. `pnpm run lint` - Check lint rules

**IMPORTANT**: Only after all edits are complete and tests pass, run as the final step:

3. `pnpm format:fix` - Fix formatting issues

Run `format:fix` last because fixing type errors or tests may introduce formatting issues that need to be cleaned up at the very end.

## Android/Kotlin Editing Workflow

After editing Kotlin/Java files in `android/`:

1. `./gradlew :app:compileDebugKotlin` - Compile Kotlin (validates types)
2. `./gradlew testDebugUnitTest` - Run unit tests
3. `./gradlew lint` - Run Android lint

For larger changes, test on emulator:

```bash
source android/scripts/android-env.sh   # Load emu/dev commands
emu start                               # Start emulator

# Instrumented tests (fast, no external deps)
./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.notClass=com.jstorrent.app.e2e.DownloadE2ETest

# E2E tests (requires Python seeder)
pnpm seed-for-test &  # Auto-kills any existing seeder on port 6881
./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.e2e.DownloadE2ETest

# Manual E2E testing
emu test-native                         # Install app, launch with test magnet
```

See `android/scripts/` for more: `emu-logs.sh`, `emu-install.sh`, `dev` commands for real devices.

## MCP Servers

This project has two MCP servers for debugging and controlling Chrome/ChromeOS.

### Setup

To enable MCP tools, create `.mcp.json` in the project root (gitignored). Copy from the example and update paths:

```bash
cp .mcp.json.example .mcp.json
# Edit .mcp.json to use your actual paths (find uv path with: which uv)
```

**Important:** Use absolute paths and the full path to `uv` (the SDK spawns processes without a shell, so PATH isn't available).

Also add to your global Claude settings (`~/.claude/settings.json`):

```json
{
  "enableAllProjectMcpServers": true
}
```

Restart Claude Code session after setup.

### ext-debug - Extension Debugging (CDP)

**Location:** `extension/tools/mcp_extension_debug.py`

Debug Chrome extensions via Chrome DevTools Protocol. Supports multiple connections (local Chrome, Chromebook via SSH tunnel).

**Tools:**
- `ext_status` - Check CDP connectivity and extension state
- `ext_reload` - Reload extension via `chrome.runtime.reload()`
- `ext_evaluate` - Run JavaScript in service worker or extension page
- `ext_get_storage` - Read from `chrome.storage` (local/sync/session)
- `ext_start_logs` / `ext_get_logs` - Collect and filter console logs
- `ext_screenshot` - Capture extension page screenshot with OCR
- `ext_list_connections` - List configured connections
- `ext_list_targets` - List debuggable targets

**Configuration:** `~/.config/ext-debug/config.json` or `./ext-debug.json`

```json
{
  "connections": {
    "local": { "port": 9223, "extension_id": "dbokmlpefliilbjldladbimlcfgbolhk" },
    "chromebook": { "port": 9222, "extension_id": "dbokmlpefliilbjldladbimlcfgbolhk" }
  },
  "default": "local"
}
```

**Usage:**

```
# Always start with status check
ext_status

# After code changes:
cd extension && pnpm build
ext_reload

# Check logs for errors
ext_get_logs level="error"

# Inspect engine state
ext_evaluate expression="globalThis.engine?.torrents?.length"
ext_evaluate expression="ioBridge.getState()"

# Check storage
ext_get_storage keys=["settings", "torrents"]

# Screenshot extension page
ext_screenshot
```

Default extension ID is `dbokmlpefliilbjldladbimlcfgbolhk` (unpacked from extension/dist/).

### chromeos - ChromeOS Device Control

**Location:** `chromeos-testbed/chromeos-mcp/mcp_chromeos.py`

Control ChromeOS devices via SSH. Raw touchscreen and keyboard input via evdev.

**Tools:**
- `screenshot` - Capture full ChromeOS screen
- `tap` - Tap at raw touchscreen coordinates
- `swipe` - Swipe between raw touchscreen coordinates
- `type_text` - Type text (keyboard layout-aware, handles Dvorak)
- `press_keys` - Press key combination by Linux keycodes
- `shortcut` - Keyboard shortcut with modifier remapping (handles Ctrl↔Search swap)
- `chromeos_info` - Get touchscreen range, keyboard layout, modifier remappings
- `reload_keyboard_config` - Reload keyboard settings if changed

**Prerequisites:**
1. SSH access to Chromebook configured (host: `chromeroot`)
2. Client auto-deploys to `/mnt/stateful_partition/c2/client.py`

**Coordinate System - Visual Percentage Estimation:**

Use visual estimation to tap on UI elements. This approach is more reliable than pixel calculations.

1. Take a `screenshot` to see the current UI
2. Visually estimate the target element's position as a percentage:
   - X: 0% = left edge, 100% = right edge
   - Y: 0% = top edge, 100% = bottom edge
3. Get `touch_max` from `chromeos_info`: [max_x, max_y]
4. Convert percentages to touch coordinates:
   - `touch_x = percent_x * max_x / 100`
   - `touch_y = percent_y * max_y / 100`
5. Call `tap(touch_x, touch_y)`

**Usage:**

```
chromeos_info   # Get touch_max (e.g., [3492, 1968])
screenshot      # View the UI

# Example: Button appears at roughly 75% across, 85% down
# touch_x = 75 * 3492 / 100 = 2619
# touch_y = 85 * 1968 / 100 = 1673
tap x=2619 y=1673

type_text text="hello world"
shortcut key="t" modifiers=["ctrl"]  # Handles modifier remapping
press_keys keys=[29, 20]  # Raw keycodes (no remapping)
```

## ChromeOS Development

When testing on ChromeOS, the extension runs on a Chromebook. The agent runs on the dev laptop.

### Build & Deploy

**Do NOT just run `pnpm build` for ChromeOS testing.** Use the deploy script:

```bash
./scripts/deploy-chromebook.sh
```

This:
1. Builds the extension locally
2. Rsyncs to Chromebook (`/mnt/chromeos/MyFiles/Downloads/crostini-shared/jstorrent-extension/`)
3. Triggers `chrome.runtime.reload()` via CDP

### Prerequisites (set up by human)

- SSH tunnel for CDP: `ssh -L 9222:127.0.0.1:9222 chromebook`
- Extension loaded once from the deploy path

### Debugging

With CDP tunnel active, use MCP tools:
- `ext_status` - Check connectivity
- `ext_get_logs` - View SW console output
- `ext_evaluate` - Inspect state

### If extension disappears

Sometimes Chrome unloads the extension. Re-load manually:
1. `chrome://extensions` on Chromebook
2. The extension may show as "errors" or be missing
3. Click "Load unpacked" again -> `Downloads/crostini-shared/jstorrent-extension/`

### Android App Deployment

Deploy the Android app to ChromeOS:

```bash
./scripts/deploy-android-chromebook.sh              # Debug build
./scripts/deploy-android-chromebook.sh release      # Release build
./scripts/deploy-android-chromebook.sh --forward    # Debug + dev server forwarding
./scripts/deploy-android-chromebook.sh release -f   # Release + dev server forwarding
```

This builds the APK locally, copies to Chromebook (at `~/code/jstorrent-monorepo/android/`), and installs via ADB.

**Dev server port forwarding (`--forward` or `-f`):**
For debug builds that load from `localhost:3000`, use `--forward` to set up:
1. SSH reverse tunnel: Your dev server → Chromebook's localhost:3000
2. ADB reverse: Chromebook localhost:3000 → Android's localhost:3000

The SSH tunnel runs in the background. To stop it: `pkill -f 'ssh.*-R 3000.*chromebook'`

**Environment variables:**
- `CHROMEBOOK_HOST` - SSH host (default: `chromebook`)
- `REMOTE_PROJECT_DIR` - Path on Chromebook (default: `/home/graehlarts/code/jstorrent-monorepo/android`)
- `DEV_SERVER_PORT` - Port to forward for dev server (default: `3000`)
- `REMOTE_ADB` - Full path to adb on Chromebook (default: `/home/graehlarts/android-sdk/platform-tools/adb`)

**ADB path on Chromebook:** `/home/graehlarts/android-sdk/platform-tools/adb`

**Troubleshooting:**
- Signature mismatch: `ssh chromebook "/home/graehlarts/android-sdk/platform-tools/adb uninstall com.jstorrent.app"` then redeploy
- ADB not available: Enable "Linux development environment" and "Android apps" in ChromeOS settings

### Real Device Testing (dev command)

The `dev` command provides unified deployment to real devices (phones and Chromebook).

**Setup:**
```bash
# Create device config (see android/scripts/devices.example)
cat >> ~/.jstorrent-devices << 'EOF'
pixel9=serial:XXXXXXXXX
motog=wifi:192.168.1.50:5555
chromebook=ssh:chromebook:~/android-sdk/platform-tools/adb
EOF

# Load shell environment (provides both emu and dev commands)
source android/scripts/android-env.sh
```

**Device config format:**
- `serial` - USB-connected device (use serial from `adb devices`)
- `wifi` - WiFi ADB device (ip:port)
- `ssh` - Remote ADB over SSH (host:adb_path)

**Commands:**
```bash
dev list                      # List configured devices and status
dev install pixel9            # Build and install debug APK
dev install pixel9 --release  # Release build
dev install pixel9 --forward  # Debug + port forwarding for dev server
dev logs pixel9               # Watch logcat
dev shell pixel9              # ADB shell
dev reset pixel9              # Clear app data
dev connect motog             # Connect WiFi ADB device
```

**Aliases:** Per-device aliases are auto-generated from your config:
```bash
dev-pixel9        # Shortcut for: dev install pixel9
dev-chromebook    # Shortcut for: dev install chromebook
```

## Viewing QuickJS JavaScript Logs

The QuickJS engine routes `console.log` to Android's logcat with tag `JSTorrent-JS`.

**Important:** Tag-based filtering (`-s JSTorrent-JS:*`) is unreliable because the logcat buffer is shared across all apps. Use PID-based filtering instead:

```bash
# Most reliable: filter by app PID
adb logcat --pid=$(adb shell pidof com.jstorrent.app) -t 100

# Real-time streaming by PID
adb logcat --pid=$(adb shell pidof com.jstorrent.app)

# Using emu/dev helpers (recommended)
source android/scripts/android-env.sh
emu logs --js          # Emulator: QuickJS logs only (PID-filtered)
dev logs pixel9 --js   # Real device: QuickJS logs only (PID-filtered)
```

**Log levels:**
- `console.log()` → `Log.i` (INFO) - tag: `JSTorrent-JS`
- `console.debug()` → `Log.d` (DEBUG)
- `console.warn()` → `Log.w` (WARN)
- `console.error()` → `Log.e` (ERROR)

**Related Kotlin tags for debugging:**
- `EngineController` - Kotlin engine wrapper
- `QuickJsContext` - JS execution and job scheduling
- `TcpBindings`, `UdpBindings`, `FileBindings` - Native I/O

## Android SDK Setup

The Android SDK is at `~/Android/Sdk`. Gradle needs to know the SDK location via one of:
- `local.properties` with `sdk.dir` (recommended)
- `ANDROID_HOME` environment variable
- `ANDROID_SDK_ROOT` environment variable

To create `local.properties`:

```bash
echo "sdk.dir=$HOME/Android/Sdk" > android/local.properties
```

Note: `local.properties` is gitignored - each machine needs its own.

**First-time emulator setup:**
```bash
android/scripts/setup-emulator.sh
```
This creates AVDs: `jstorrent-dev`, `jstorrent-tablet`, `jstorrent-playstore`
