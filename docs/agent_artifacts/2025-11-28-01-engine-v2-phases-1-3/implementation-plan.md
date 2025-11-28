# Phase 3: Implement StorageRootManager

## Goal Description
The goal is to implement `StorageRootManager` to handle multiple storage locations (roots) cleanly. This replaces the temporary `StorageResolver` and allows the engine to manage downloads across different filesystems or paths.

## User Review Required
None.

## Proposed Changes

### Engine Package

#### [NEW] Storage
- `packages/engine/src/storage/types.ts`: Define `StorageRoot` interface.
- `packages/engine/src/storage/storage-root-manager.ts`: Implement `StorageRootManager` class.

#### [MODIFY] Core
- `packages/engine/src/core/bt-engine.ts`:
    - Add `storageRootManager` to `BtEngineOptions`.
    - Remove/Deprecate `fileSystem` and `downloadPath` options (or map them to a default root).
    - Remove `StorageResolver`.
- `packages/engine/src/core/torrent.ts`:
    - Update to resolve filesystem and path via `StorageRootManager` using `storagePath` (token).

## Verification Plan

### Automated Tests
- Run `pnpm typecheck`.
- Run `pnpm lint`.
- Create unit tests for `StorageRootManager` in `packages/engine/tests/unit/storage-root-manager.spec.ts`.
- Run `pnpm test`.
- Run `pnpm run test:python` from repo root.
