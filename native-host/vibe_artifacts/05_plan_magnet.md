# Implementation Plan - Magnet Handler

This plan outlines the implementation of magnet link handling via a local RPC server and a protocol handler stub, as defined in `magnet-handler-design.md`.

## User Review Required

> [!IMPORTANT]
> This change introduces a local HTTP server on `127.0.0.1` (ephemeral port) and a new binary `jstorrent-magnet-stub`.
> It also modifies the installers to register the `magnet:` protocol handler.

## Proposed Changes

### Dependencies
- Add `axum` or `warp` (or `hyper` directly) for the HTTP server in `jstorrent-native-host`.
- Add `reqwest` (blocking or async) for the RPC client in `jstorrent-magnet-stub`.
- Add `sysinfo` for PID validation.

### Component: Native Host (`jstorrent-native-host`)

#### [MODIFY] [Cargo.toml](file:///home/kgraehl/code/jstorrent-host/Cargo.toml)
- Add `axum`, `tokio` (ensure full features), `uuid`, `sysinfo`.

#### [NEW] [src/rpc.rs](file:///home/kgraehl/code/jstorrent-host/src/rpc.rs)
- Struct `RpcInfo` (serialization).
- Function `start_server(state: Arc<State>) -> (u16, String)`: Starts server, returns port and token.
- Function `write_discovery_file(info: RpcInfo)`.
- Handlers for `/health` and `/add-magnet`.

#### [MODIFY] [src/main.rs](file:///home/kgraehl/code/jstorrent-host/src/main.rs)
- Initialize RPC server on startup.
- Write discovery file.
- Handle `AddMagnet` events from RPC in the main loop.

### Component: Protocol Stub (`jstorrent-magnet-stub`)

#### [NEW] [stub/Cargo.toml](file:///home/kgraehl/code/jstorrent-host/stub/Cargo.toml)
- New workspace member or separate binary in same Cargo.toml? -> **Same Cargo.toml, multiple binaries.**

#### [NEW] [src/bin/stub.rs](file:///home/kgraehl/code/jstorrent-host/src/bin/stub.rs)
- Main entry point.
- Parse args (magnet link).
- Discovery logic:
    - Scan config dirs for `rpc-info-*.json`.
    - Validate PID.
    - Call `/health`.
- RPC Client:
    - POST `/add-magnet`.
- Fallback:
    - Launch browser with `chrome-extension://...`.

### Component: Installers

#### [MODIFY] [installers/windows/jstorrent.iss](file:///home/kgraehl/code/jstorrent-host/installers/windows/jstorrent.iss)
- Install `jstorrent-magnet-stub.exe`.
- Register `magnet:` protocol in Registry.

#### [MODIFY] [installers/macos/scripts/postinstall.sh](file:///home/kgraehl/code/jstorrent-host/installers/macos/scripts/postinstall.sh)
- Register URL handler (might need `Info.plist` changes in a bundled `.app` structure, or `lsregister`). *Note: macOS protocol handlers usually require an `.app` bundle.*

#### [MODIFY] [installers/linux/install.sh](file:///home/kgraehl/code/jstorrent-host/installers/linux/install.sh)
- Install `jstorrent-magnet-stub`.
- Create `jstorrent-magnet.desktop`.
- Run `xdg-mime default ...`.

### Component: CI

#### [MODIFY] [.github/workflows/build-and-package.yml](file:///home/kgraehl/code/jstorrent-host/.github/workflows/build-and-package.yml)
- Build `stub` binary.
- Include `stub` in artifacts.

## Verification Plan

### Automated Tests
- Unit tests for `RpcInfo` serialization/deserialization.
- Integration test: Start host, write discovery file, run stub against it.

### Manual Verification
- Run host.
- Run `jstorrent-magnet-stub "magnet:?xt=urn:btih:..."`.
- Verify host receives the magnet.
- Kill host.
- Run stub again.
- Verify browser launches.
