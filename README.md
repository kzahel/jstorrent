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

## Getting Started

### Prerequisites

- **Node.js**: v20 or later
- **Rust**: Stable toolchain
- **pnpm**: Recommended for package management (optional but good for monorepos)

### Extension

The Chrome extension is located in the `extension/` directory.

#### Build

```bash
cd extension
npm install
npm run build
```

The build artifacts will be in `extension/dist`.

#### Test

To run unit tests and checks:

```bash
cd extension
npm run check_fast
```

To run end-to-end tests (Playwright):

```bash
cd extension
npm run test:e2e
```

### Native Host

The native messaging host is located in the `native-host/` directory.

#### Build

```bash
cd native-host
cargo build --release
```

The binary will be located at `native-host/target/release/jstorrent-host`.

#### Test

```bash
cd native-host
cargo test
```

## CI/CD

Continuous Integration is handled via GitHub Actions. Workflows are located in `.github/workflows/`.

- **Extension CI**: Runs on changes to `extension/**` and `packages/**`.
- **Native Host CI**: Runs on changes to `native-host/**` and `packages/**`.
