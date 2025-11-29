# Phase 6: Implement DaemonFileSystem

## Goal
Implement `DaemonFileSystem` that communicates with `io-daemon` via HTTP.
Update `io-daemon` to support necessary filesystem operations.

## User Review Required
- Modifying `io-daemon` (Rust) to add `stat`, `list`, `delete`, `truncate` endpoints.

## Proposed Changes

### native-host/io-daemon

#### [MODIFY] [files.rs](file:///home/kgraehl/code/jstorrent-monorepo/native-host/io-daemon/src/files.rs)
- Add `stat_file` handler (`GET /ops/stat`).
- Add `list_dir` handler (`GET /ops/list`).
- Add `delete_file` handler (`POST /ops/delete`).
- Add `truncate_file` handler (`POST /ops/truncate`).
- Update `routes()` to include these new endpoints.

### packages/engine

#### [NEW] [daemon-connection.ts](file:///home/kgraehl/code/jstorrent-monorepo/packages/engine/src/adapters/daemon/daemon-connection.ts)
- Implement `DaemonConnection` class.
- Handles HTTP requests to `io-daemon`.
- Manages authentication token.

#### [NEW] [daemon-filesystem.ts](file:///home/kgraehl/code/jstorrent-monorepo/packages/engine/src/adapters/daemon/daemon-filesystem.ts)
- Implement `DaemonFileSystem` class implementing `IFileSystem`.
- Uses `DaemonConnection` for operations.

#### [NEW] [daemon-file-handle.ts](file:///home/kgraehl/code/jstorrent-monorepo/packages/engine/src/adapters/daemon/daemon-file-handle.ts)
- Implement `DaemonFileHandle` class implementing `IFileHandle`.
- Stateless handle storing path and offset.

#### [NEW] [daemon-filesystem.spec.ts](file:///home/kgraehl/code/jstorrent-monorepo/packages/engine/test/integration/daemon-filesystem.spec.ts)
- Integration test that:
  - Sets `JSTORRENT_CONFIG_DIR` to a temp dir.
  - Creates a mock `rpc-info.json` in that dir with **multiple download roots**.
  - Spawns `io-daemon` process pointing to that config.
  - Creates `DaemonFileSystem`.
  - Verifies file operations (write, read, stat, list, delete) across **different roots**.

## Verification Plan

### Automated Tests
- Run `pnpm --filter @jstorrent/engine test test/integration/daemon-filesystem.spec.ts`.
