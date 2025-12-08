# ChromeOS Deploy Workflow - Setup Guide

## Overview

Set up a workflow where agents on the dev laptop can build and deploy the extension to a Chromebook for testing. The extension lives in a shared folder accessible to ChromeOS Chrome.

**Target path on Chromebook:** `~/Downloads/crostini-shared/jstorrent-extension/`

**Why this path:**
- `~/Downloads/crostini-shared/` is a dedicated shared folder (not all of Downloads)
- Survives Chrome restarts (unlike Crostini-hosted paths which can unmount)
- Accessible to ChromeOS Chrome for "Load unpacked"

## Prerequisites (Human Setup)

Before agents can use this workflow:

1. **SSH access to Chromebook** - Password or key-based auth working
2. **CDP tunnel** - `ssh -L 9222:127.0.0.1:9222 chromebook` (or add to SSH config with LocalForward)
3. **Extension loaded once** - Manually load unpacked from `~/Downloads/crostini-shared/jstorrent-extension/` in `chrome://extensions`
4. **Shared folder exists** - Create `~/Downloads/crostini-shared/` on Chromebook

## Phase 1: Create Deploy Script

### 1.1 Create `scripts/deploy-chromebook.sh`

```bash
#!/bin/bash
#
# Deploy extension to Chromebook for testing.
# Run from dev laptop, not from Crostini.
#
# Prerequisites:
#   - SSH access: ssh chromebook works
#   - CDP tunnel active: ssh -L 9222:127.0.0.1:9222 chromebook
#   - Extension loaded once from ~/Downloads/crostini-shared/jstorrent-extension/
#
# Usage:
#   ./scripts/deploy-chromebook.sh
#
set -e
cd "$(dirname "$0")/.."

CHROMEBOOK_HOST="${CHROMEBOOK_HOST:-chromebook}"
REMOTE_PATH="Downloads/crostini-shared/jstorrent-extension"

# Warn if running from Crostini
if [[ -f /etc/apt/sources.list.d/cros.list ]]; then
    echo "⚠️  Warning: Running from Crostini. This script is meant for external dev machines."
    echo "   Press Ctrl+C to cancel, or wait 3s to continue anyway..."
    sleep 3
fi

echo "📦 Building extension..."
pnpm build

echo "🚀 Deploying to $CHROMEBOOK_HOST:~/$REMOTE_PATH/"
rsync -av --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    extension/dist/ \
    "$CHROMEBOOK_HOST:$REMOTE_PATH/"

echo "🔄 Reloading extension..."
if python extension/tools/reload-extension.py 2>/dev/null; then
    echo "✅ Done! Extension reloaded."
else
    echo "⚠️  Build deployed but reload failed."
    echo "   Is the CDP tunnel active? ssh -L 9222:127.0.0.1:9222 $CHROMEBOOK_HOST"
fi
```

### 1.2 Make executable

```bash
chmod +x scripts/deploy-chromebook.sh
```

## Phase 2: SSH Configuration

### 2.1 Add to `~/.ssh/config` on dev laptop

```
Host chromebook
    HostName <chromebook-ip-or-hostname>
    User chronos
    # Uncomment to auto-establish CDP tunnel:
    # LocalForward 9222 127.0.0.1:9222
```

**Note:** The `LocalForward` line is optional. If included, every `ssh chromebook` establishes the CDP tunnel. Otherwise, run the tunnel manually in a separate terminal.

### 2.2 Test SSH access

```bash
ssh chromebook "ls ~/Downloads/"
```

Should work without password prompts (set up SSH keys if needed).

## Phase 3: Chromebook Setup (One-Time)

### 3.1 Create shared folder

```bash
ssh chromebook "mkdir -p ~/Downloads/crostini-shared/jstorrent-extension"
```

### 3.2 Initial deploy

```bash
./scripts/deploy-chromebook.sh
```

### 3.3 Load extension in Chrome (manual)

On Chromebook:
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Navigate to `Downloads/crostini-shared/jstorrent-extension/`
5. Note the extension ID (should be `dbokmlpefliilbjldladbimlcfgbolhk` if manifest key matches)

After this, subsequent deploys just need `./scripts/deploy-chromebook.sh` - the extension auto-reloads.

## Phase 4: Documentation Updates

### 4.1 Update `CLAUDE.md`

Add this section:

```markdown
## ChromeOS Development

When testing on ChromeOS, the extension runs on a Chromebook. The agent runs on the dev laptop.

### Build & Deploy

**Do NOT just run `pnpm build` for ChromeOS testing.** Use the deploy script:

```bash
./scripts/deploy-chromebook.sh
```

This:
1. Builds the extension locally
2. Rsyncs to Chromebook (`~/Downloads/crostini-shared/jstorrent-extension/`)
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
3. Click "Load unpacked" again → `Downloads/crostini-shared/jstorrent-extension/`
```

### 4.2 Update `extension/tools/README.md`

Add note in the Prerequisites section:

```markdown
### ChromeOS Remote Development

If developing on a laptop with Chromebook as test device:

1. Run CDP tunnel: `ssh -L 9222:127.0.0.1:9222 chromebook`
2. Use `./scripts/deploy-chromebook.sh` instead of `pnpm build`
3. All tools in this folder work via the tunnel (localhost:9222 forwards to Chromebook)
```

## Verification

### Test 1: Deploy works

```bash
# From dev laptop
./scripts/deploy-chromebook.sh
```

Should output build, rsync progress, and "Extension reloaded".

### Test 2: CDP tunnel works

```bash
# Terminal 1: tunnel (if not in SSH config)
ssh -L 9222:127.0.0.1:9222 chromebook

# Terminal 2: test
curl http://localhost:9222/json | head
```

Should return JSON array of Chrome targets.

### Test 3: MCP tools work

```
ext_status
```

Should show CDP reachable, extension found.

## Files Changed

| File | Action |
|------|--------|
| `scripts/deploy-chromebook.sh` | Create |
| `CLAUDE.md` | Add ChromeOS section |
| `extension/tools/README.md` | Add remote dev note |

## Notes

- Extension ID remains stable as long as the manifest `key` field is set
- If Chromebook IP changes, update `~/.ssh/config`
- The deploy script is idempotent - safe to run repeatedly
- Agent should always use deploy script for ChromeOS work, never raw `pnpm build`
