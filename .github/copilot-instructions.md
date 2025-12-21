# JSTorrent Monorepo AI Coding Guide

## Architecture Overview

JSTorrent is a multi-platform BitTorrent client with a **Chrome MV3 extension** frontend and **Rust native components** for privileged I/O operations. The monorepo is organized into distinct components that communicate via native messaging and HTTP/WebSocket protocols.

### Component Boundaries

```
extension/          Chrome MV3 extension (TypeScript + React + Vite)
├─ Service worker orchestrates torrent engine + native communication
├─ UI components use React with no HMR (MV3 CSP constraints)
└─ Connects to system-bridge via chrome.runtime.connectNative

system-bridge/      Rust workspace with 4 packages
├─ common/              Shared library (jstorrent_common)
├─ host/                Chrome native messaging coordinator (jstorrent-host)
├─ io-daemon/           HTTP/WebSocket server for file/socket I/O
└─ link-handler/        OS magnet://.torrent protocol handler

packages/engine/    Core BitTorrent engine (TypeScript, no dynamic imports)
packages/shared-ts/ Shared TypeScript types and utilities
packages/proto/     Protocol definitions (future)
```

**Critical architectural invariants:**
- Extension contains torrent logic; native components only do I/O
- Native-host spawns io-daemon as a child process (shares lifecycle)
- IO daemon never writes config; only native-host manages `rpc-info.json`
- Link handler cannot start native-host directly (only via browser LAUNCH_URL)

## Build & Development Commands

**From monorepo root (pnpm workspace):**
```bash
pnpm install                    # Install all workspace dependencies
pnpm checkall                   # Parallel: lint, format, typecheck, test
pnpm build                      # Build all packages
pnpm --filter extension build   # Build specific package
pnpm --filter extension test:e2e  # Run Playwright tests
```

**Extension-specific (in extension/):**
```bash
pnpm dev            # Watch mode (vite build --watch, no HMR)
pnpm check_fast     # Fast checks: lint, format, typecheck, unit tests
pnpm test:e2e       # Playwright integration tests (requires native-host)
```

**System Bridge (in system-bridge/):**
```bash
cargo build --release --workspace           # Build all binaries
cargo test --workspace                      # Run Rust tests
python3 verify_all.py                       # Integration tests (simulates extension)
./scripts/install-local-linux.sh            # Install for local testing
./scripts/install-local-macos.sh            # macOS equivalent (requires sudo)
```

**Load extension in Chrome:** Build first (`pnpm build`), then load `extension/dist/` as unpacked extension.

## Testing Strategy

1. **Unit tests**: Vitest with happy-dom + React Testing Library
   - Mock chrome.* APIs via `test/mocks/mock-chrome.ts`
   - Run with `pnpm test` (in extension/)

2. **Integration tests**: Playwright in "new headless" mode
   - Load extension via `--load-extension=dist --disable-extensions-except=dist`
   - Requires native-host installed locally
   - Run with `pnpm test:e2e`

3. **Native verification scripts**: Python scripts that simulate extension behavior
   - `verify_all.py` runs all `verify_*.py` scripts
   - Tests native components in isolation without browser

4. **DO NOT** run `jupyter notebook` or browser-based commands for testing

## Project-Specific Conventions

### TypeScript
- **Strict mode enabled**: No implicit any, unused locals/params flagged
- **No dynamic imports in `packages/engine/`** (ESLint enforces this)
- Use `tsx` for running REPL: `pnpm --filter @jstorrent/engine repl`

### Linting & Formatting
- ESLint config at root (`eslint.config.js`) uses flat config format
- Prettier must come **last** in ESLint config to override formatting rules
- WebExtensions globals pre-configured (`chrome.*` available without imports)
- Unused variables with `_` prefix are allowed: `const _unused = foo()`

### Native Messaging & RPC
- Extension talks to native-host via `chrome.runtime.connectNative('com.jstorrent.native')`
- Native-host returns io-daemon port + auth token via structured JSON messages
- IO daemon uses **download root tokens** (opaque SHA1-based) instead of raw paths
- All daemon requests include `root_token` + `relative_path` for security

### File Paths & Discovery
- **Config dir** (Linux): `~/.config/jstorrent-native/`
- **macOS**: `~/Library/Application Support/jstorrent-native/`
- **Windows**: `%LOCALAPPDATA%\jstorrent-native\`
- **RPC info file**: `rpc-info.json` (written only by native-host, read by daemon/link-handler)

### Vite Build
- Multi-entry build for MV3 pages: `src/sw.ts`, `src/ui/app.html`, etc.
- **No HMR or dev server** (MV3 CSP incompatible)
- Sourcemaps enabled, non-minified output for debugging
- Build outputs to `extension/dist/`

## CI/CD Pipeline

- **Extension CI** (`.github/workflows/extension-ci.yml`):
  - Triggers on `extension/**` or `packages/**` changes
  - Builds extension, installs native-host, runs Playwright tests

- **Native CI** (`.github/workflows/native-ci.yml`):
  - Separate jobs for Windows/macOS/Linux
  - Builds installers, uploads artifacts, verifies installation
  - Releases on tags like `system-bridge-v1.0.0`, `extension-v1.0.0`

- **Path filters**: Each workflow only runs when relevant files change

## AI Assistant Guidelines

**Before creating pull requests or pushing commits:**

1. **Always run `pnpm run checkall`** from the monorepo root to verify:
   - Linting passes (`pnpm lint`)
   - TypeScript type checking passes (`pnpm typecheck`)
   - Prettier formatting passes (`pnpm format`)
   - All tests pass (`pnpm test`)

2. Fix any errors or warnings before proceeding with commits

3. If working in a specific package, use `pnpm --filter <package> <command>` for targeted checks

**Example workflow:**
```bash
# Make changes
pnpm run checkall          # Verify all checks pass
git add .
git commit -m "..."
git push
```

This ensures CI will pass and prevents wasted pipeline cycles.

## Common Gotchas

1. **Extension service worker lifecycle**: Native-host dies when SW unloads. IO daemon is a child process and terminates too.

2. **Chrome profile isolation**: Different Chrome profiles have separate `install_id` and download roots. Native-host uses `install_id` (random UUID stored in `chrome.storage.local`) to identify profiles.

3. **Link handler cannot spawn native-host**: Must launch browser with LAUNCH_URL (has `externally_connectable` permissions), which then connects to extension.

4. **Download root tokens are stable**: Generated from `sha1(resolved_path + salt)`. Do not pass raw paths to daemon.

5. **pnpm workspace**: Use `pnpm --filter <package>` to run commands in specific packages. Filter names match `package.json` "name" field.

6. **Rust workspace**: `system-bridge/` is workspace root with members: `common/`, `host/`, `io-daemon/`, `link-handler/`. Use `--workspace` flag to build/test all.

## Code Reading Entry Points

- Extension architecture: `extension/DESIGN.md`, `extension/DESIGN.md`
- System bridge components: `system-bridge/DESIGN.md`, `design_docs/native-components.md`
- Monorepo migration: `design_docs/monorepo-migration.md`
- Engine package: `packages/engine/` (core BitTorrent logic, no browser/node deps)

## Key Design Documents

- `system-bridge/DESIGN.md`: Complete native stack architecture (lifecycle, auth, download roots)
- `extension/DESIGN.md`: Build system, test framework, MV3 constraints
- `design_docs/io-daemon-websocket-detail.md`: WebSocket protocol for socket operations
- `packages/engine/docs/ARCHITECTURE-current.md`: BitTorrent engine architecture and roadmap

When making changes, check relevant design docs for architectural constraints before implementation.

When editing Python files, ensure that the resulting file passes python3 -m py_compile and uses consistent 4-space indentation.

Before making any changes, please confirm the plan with the user to ensure it aligns with their expectations and requirements, and to give them an opportunity to provide additional context or constraints.