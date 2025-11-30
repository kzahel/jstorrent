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

 ### Dev Mode Setup

 Running `pnpm dev` starts three processes in parallel:

 | Server | URL | Purpose |
 |--------|-----|---------|
 | website | http://localhost:3000 | Landing page, protocol handler |
 | extension dev:web | http://local.jstorrent.com:3001 | App UI with HMR |
 | extension dev:extension | - | Build watch for chrome://extensions |

 #### Prerequisites

 1. **Add local.jstorrent.com to /etc/hosts**:
    ```bash
    echo "127.0.0.1 local.jstorrent.com" | sudo tee -a /etc/hosts
    ```

 2. **Configure DEV_ORIGINS for CORS** (after installing native host):
    ```bash
    mkdir -p ~/.config/jstorrent-native
    echo "DEV_ORIGINS=http://local.jstorrent.com:3001" >> ~/.config/jstorrent-native/jstorrent-native.env
    ```
    Then restart the native host (close and reopen the extension).

 3. **Load extension in Chrome**:
    - Build once: `pnpm build`
    - Go to `chrome://extensions`, enable Developer mode
    - Click "Load unpacked" and select `extension/dist`

 #### Running Dev Mode

 ```bash
 pnpm dev
 ```

 This starts:
 - **Extension build watch**: Rebuilds on file changes (reload extension in Chrome to see changes)
 - **Web dev server with HMR**: Open http://local.jstorrent.com:3001/src/ui/app.html for hot-reloading UI development

 The web dev server communicates with the extension via `chrome.runtime.sendMessage` (using `externally_connectable`), so the extension must be installed and running.

 ### Extension
 
 The Chrome extension is located in the `extension/` directory.
 
 #### Build
 
 ```bash
 pnpm build
 # or specifically for extension:
 pnpm --filter extension build
 ```
 
 The build artifacts will be in `extension/dist`.

 Load as an unpacked extension in chrome://extensions from the extension/dist folder.

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

#### Prerequisites

To build the Rust components, you need to have Rust and Cargo installed.

**macOS:**
```bash
brew install rust
```

**Linux:**
```bash
sudo apt install cargo
```

On ubuntu you may need `libgtk-3-dev` installed with apt

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
cargo test --workspace
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
