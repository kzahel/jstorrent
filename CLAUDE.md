# Claude Instructions

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

After editing TypeScript files, run the following checks in order:

1. `pnpm run typecheck` - Verify type correctness
2. `pnpm run test` - Run unit tests
3. `pnpm run lint` - Check lint rules

**IMPORTANT**: Only after all edits are complete and tests pass, run as the final step:

3. `pnpm format:fix` - Fix formatting issues

Run `format:fix` last because fixing type errors or tests may introduce formatting issues that need to be cleaned up at the very end.

## Extension Debugging (MCP)

Use the `ext-debug` MCP server for extension debugging:

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
```

Default extension ID is `dbokmlpefliilbjldladbimlcfgbolhk` (unpacked from extension/dist/).

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

## Running Android Tests in Claude Code (Sandboxed Environment)

Claude Code's sandboxed environment has network restrictions that require special handling for Gradle/Maven:

### The Problem
- Java's HttpURLConnection doesn't properly authenticate with the HTTP proxy (returns 401 for HTTPS tunneling)
- No DNS resolution (`/etc/resolv.conf` is empty)
- Network access only works through the proxy

### The Solution
Run the setup script at the start of each session:

```bash
./scripts/setup-android-test-env.sh
```

This script:
1. Starts a local Python proxy (127.0.0.1:18080) that handles authentication
2. Installs Android SDK to /opt/android-sdk
3. Installs Gradle 8.13
4. Configures gradle.properties with proxy settings

### Running Tests

```bash
cd android
/root/.gradle/wrapper/dists/gradle-8.13-bin/anydir/gradle-8.13/bin/gradle testDebugUnitTest
```

### Cleanup Before Committing

The setup script modifies gradle.properties with proxy settings. Always revert before committing:

```bash
git checkout android/gradle.properties
```
