# Claude Instructions

## Project Overview

This is a **pnpm monorepo** for JSTorrent, a BitTorrent client. Key components:

| Package | Location | Description |
|---------|----------|-------------|
| Extension | `extension/` | Chrome MV3 extension (React/TypeScript/Vite) |
| Engine | `packages/engine/` | Core BitTorrent engine (TypeScript) |
| Native Host | `native-host/` | Rust native messaging host and IO daemon |
| Website | `website/` | JSTorrent website (React/Vite) |

## Testing

### Quick Reference

| Command | What it runs |
|---------|--------------|
| `pnpm test` | All Vitest unit tests (recursive) |
| `pnpm test:python` | Python integration tests for engine |
| `pnpm checkall` | All tests + lint + format + typecheck |

### Unit Tests (Vitest)

```bash
# All unit tests
pnpm test

# Extension tests only
pnpm --filter extension test

# Engine tests only
pnpm --filter @jstorrent/engine test
```

**Test locations:**
- `extension/test/` - Extension unit tests
- `packages/engine/tests/unit/` - Engine unit tests
- `packages/engine/test/` - Additional engine tests

### Integration Tests

**Engine + IO Daemon integration:**
```bash
# Requires native-host to be built first!
cd native-host && cargo build --workspace
pnpm --filter @jstorrent/engine test:integration
```

### Python Integration Tests

These test the engine against libtorrent for compatibility. Requires Python setup:

```bash
cd packages/engine/tests/python
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
pytest
```

Or from root:
```bash
pnpm test:python
```

**Debugging Node.js in Python tests:**
```bash
NODE_INSPECT=9229 pytest test_recheck.py -v  # Fixed port
NODE_INSPECT_BRK=9229 pytest test_recheck.py -v  # Pause on first line
```

### E2E Tests (Playwright)

```bash
# Extension E2E tests - requires native host installed
pnpm --filter extension test:e2e
```

### Native Host Tests (Rust)

```bash
cd native-host
cargo test --workspace
```

## Building

### When You Need to Build

| Scenario | Required Build |
|----------|----------------|
| Running integration tests | Native host must be built first |
| Loading extension in Chrome | Extension must be built (`pnpm --filter extension build`) |
| Running Python tests | Engine and native host must be built |
| After changing TypeScript | Run `pnpm typecheck` to verify |

### Build Commands

```bash
# Build everything (TypeScript packages + Vite builds)
pnpm build

# Extension only (output: extension/dist/)
pnpm --filter extension build

# Engine only (TypeScript compilation)
pnpm --filter @jstorrent/engine build

# Native host (Rust - required for integration tests!)
cd native-host && cargo build --release --workspace
```

**Native host binaries location:** `native-host/target/release/`
- `jstorrent-native-host`
- `jstorrent-io-daemon`
- `jstorrent-link-handler`

### Installing Native Host Locally

For testing the extension with native messaging:

```bash
# Linux
./native-host/scripts/install-local-linux.sh

# macOS (requires sudo)
./native-host/scripts/install-local-macos.sh
```

## Code Quality

```bash
# All static checks (run before committing)
pnpm check:static

# Individual checks
pnpm lint          # ESLint
pnpm lint:fix      # ESLint with auto-fix
pnpm format        # Prettier check
pnpm format:fix    # Prettier auto-fix
pnpm typecheck     # TypeScript type checking

# Everything (static + tests)
pnpm checkall
```

## Development

```bash
# Dev mode for all packages
pnpm dev

# Extension dev (hot reload)
pnpm --filter extension dev
```

## Prerequisites

- **Node.js 20+** (see `.nvmrc`)
- **pnpm 9+** (`corepack enable`)
- **Rust/Cargo** for native host (`brew install rust` on macOS, `sudo apt install cargo` on Linux)
- **libgtk-3-dev** on Linux for native host (`sudo apt install libgtk-3-dev`)

---

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
