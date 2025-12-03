# JSTorrent Development Workflow

## Design → Execute Pattern

Strategic design happens in Claude web conversations. Execution happens via agents with task docs.

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  Claude Web Chat    │     │   docs/tasks/       │     │   Agent Execution   │
│  (strategic)        │ ──► │   *.md              │ ──► │   (tactical)        │
│                     │     │                     │     │                     │
│  - Architecture     │     │  Detailed plans     │     │  - Follows plan     │
│  - Tradeoffs        │     │  with exact code    │     │  - Looks at local   │
│  - Roadmap          │     │  and file paths     │     │    READMEs          │
│  - Design docs      │     │                     │     │  - Minimal context  │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
                                     │
                                     ▼ (when done)
                            ┌─────────────────────┐
                            │ docs/tasks/archive/ │
                            └─────────────────────┘
```

**Why this split:**
- Strategic conversations benefit from rich context (history, tradeoffs)
- Agents work better with focused, specific instructions
- Task docs serve as the contract between design and implementation

## Task Doc Format

Task docs in `docs/tasks/` are execution plans for agents. They include:

1. **Overview** - What and why (brief)
2. **File changes** - Exact paths, often with full code blocks
3. **Verification** - How to test it worked

Example structure:
```markdown
# Feature Name - Agent Guide

## Overview
One paragraph on what this does.

## Phase 1: Do X

### 1.1 Update path/to/file.ts

Find this:
```typescript
// existing code
```

Replace with:
```typescript
// new code
```

## Verification
```bash
pnpm test
```
```

## Testing Layers

### 1. Unit Tests (Vitest)

Fast, in-memory, no external dependencies.

```bash
# From monorepo root - runs ALL package tests
pnpm test

# Or from specific package directory
cd packages/engine && pnpm test
cd packages/ui && pnpm test
```

Location: `packages/*/test/`

### 2. Python Integration Tests

Test engine against real libtorrent. Catches protocol bugs.

```bash
cd packages/engine/integration/python
python run_tests.py           # All tests
python test_download.py       # Single test
```

**Skip list pattern:** Tests that are known broken go in `SKIP_TESTS` dict in `run_tests.py` with a reason. Remove from skip list when fixed.

### 3. E2E Tests (Playwright)

Test full extension with native host.

```bash
cd extension
pnpm test:e2e
```

Requires native host installed locally.

### 4. Native Host Tests (Python)

Test Rust binaries directly.

```bash
cd native-host
cargo build
python verify_host.py
python verify_torrent.py
```

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm
- Rust toolchain
- Python 3.10+ with libtorrent (system package + `pip install libtorrent` bindings)
- Chrome

### Dev Mode

1. Add to `/etc/hosts`:
   ```
   127.0.0.1 local.jstorrent.com
   ```

2. Set up env file (copy example and edit):
   ```bash
   cp ~/.config/jstorrent-native/jstorrent-native.env.example \
      ~/.config/jstorrent-native/jstorrent-native.env
   # Edit to add: DEV_ORIGINS=http://local.jstorrent.com:3001
   ```

3. Install native host (builds and installs):
   ```bash
   cd native-host
   ./scripts/install-local-linux.sh
   ```

4. Start dev server (from monorepo root):
   ```bash
   pnpm dev
   ```
   This builds extension in watch mode AND serves the local website.

5. Load extension in Chrome from `extension/dist/`

6. Open `http://local.jstorrent.com:3001` for HMR dev experience

## Git Conventions

- Main branch: `main`
- Commits attributed to actual user (see `CLAUDE.md` for identity management)
- Releases tagged via scripts in `scripts/` folder, built on GitHub Actions

## Release Process

(See RELEASE-STATUS.md for current blockers)

Releases are built on GitHub Actions (see `.github/workflows/`). The `scripts/` folder has scripts for tagging releases.

```bash
# Local build for testing
pnpm build                           # Extension
cd native-host && cargo build --workspace --release   # Native
```
