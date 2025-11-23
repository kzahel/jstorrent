# JSTorrent Monorepo

This repository contains the source code for JSTorrent, including the Chrome extension, native messaging host, and other related components.

## Repository Structure

- `extension/`: Chrome extension source code.
- `native-host/`: Native messaging host (Rust) source code.
- `apps/`: Mobile applications (React Native, Android, iOS).
- `packages/`: Shared libraries and packages.
- `website/`: Source for the JSTorrent website.
- `infra/`: Infrastructure and API backend.
- `scripts/`: Utility scripts.

### Getting Started
 
 1. **Install dependencies**:
    ```bash
    pnpm install
    ```
 
 2. **Run checks**:
    ```bash
    pnpm checkall
    ```
 
 ### Development Commands
 
 Run these commands from the repository root:
 
 - **`pnpm lint`**: Lint all files (ESLint).
 - **`pnpm format`**: Format all files (Prettier).
 - **`pnpm test`**: Run unit tests for all packages.
 - **`pnpm typecheck`**: Run TypeScript checks for all packages.
 - **`pnpm build`**: Build all packages.
 - **`pnpm checkall`**: Run lint, format check, typecheck, and tests in parallel.
 
 ### Extension
 
 The Chrome extension is located in the `extension/` directory.
 
 #### Build
 
 ```bash
 pnpm build
 # or specifically for extension:
 pnpm --filter extension build
 ```
 
 The build artifacts will be in `extension/dist`.
 
 #### Test
 
 ```bash
 pnpm test
 # or specifically for extension:
 pnpm --filter extension test
 ```
 
 To run end-to-end tests (Playwright):
 
 ```bash
 pnpm --filter extension test:e2e
 ```

### Native Host

The native messaging host is located in the `native-host/` directory.

#### Build

```bash
cd native-host
cargo build --release --workspace
```

The binaries will be located at:
- `native-host/target/release/jstorrent-native-host`
- `native-host/target/release/jstorrent-io-daemon`
- `native-host/target/release/jstorrent-link-handler`

#### Test

```bash
cd native-host
cargo test
```

#### Verification Scripts

There are several Python scripts in `native-host/` to verify the native components in isolation (simulating the browser extension).

To run all verification scripts at once:
```bash
cd native-host
python3 verify_all.py
```

#### Local Installation

To install the native host locally for development (e.g., to test with a local Chrome extension):

**Linux:**
```bash
./native-host/scripts/install-local-linux.sh
```
This builds the release binaries, creates the installer, and installs it to `~/.local/lib/jstorrent-native`. It also kills any running host process.

**macOS:**
```bash
./native-host/scripts/install-local-macos.sh
```
This builds the release binaries, creates the installer package, and installs it (requires `sudo`).

## CI/CD

Continuous Integration is handled via GitHub Actions. Workflows are located in `.github/workflows/`.

- **Extension CI**: Runs on changes to `extension/**` and `packages/**`.
- **Native Host CI**: Runs on changes to `native-host/**` and `packages/**`.
