# Task: Complete Phase 1 - Reorganize File Structure

- [x] Create missing adapter directories <!-- id: 0 -->
    - [x] `packages/engine/src/adapters/daemon` <!-- id: 1 -->
    - [x] `packages/engine/src/adapters/browser` <!-- id: 2 -->
- [x] Create presets directory <!-- id: 3 -->
    - [x] `packages/engine/src/presets` <!-- id: 4 -->
- [x] Verify and update imports <!-- id: 5 -->
    - [x] Check for any remaining imports from `node-env` or old memory files <!-- id: 6 -->
- [x] Run typecheck to ensure no broken imports <!-- id: 7 -->

# Task: Phase 2 - Define ISessionStore Interface

- [x] Create `ISessionStore` interface <!-- id: 8 -->
    - [x] `packages/engine/src/interfaces/session-store.ts` <!-- id: 9 -->
- [x] Implement `MemorySessionStore` <!-- id: 10 -->
    - [x] `packages/engine/src/adapters/memory/memory-session-store.ts` <!-- id: 11 -->
    - [x] Export from `packages/engine/src/adapters/memory/index.ts` <!-- id: 12 -->
- [x] Implement `JsonFileSessionStore` (for Node testing) <!-- id: 24 -->
    - [x] `packages/engine/src/adapters/node/json-file-session-store.ts` <!-- id: 25 -->
    - [x] Export from `packages/engine/src/adapters/node/index.ts` <!-- id: 26 -->
- [x] Create stubs for IndexedDB <!-- id: 13 -->
    - [x] `packages/engine/src/adapters/browser/indexeddb-session-store.ts` (Stub) <!-- id: 14 -->
- [x] Implement `ChromeStorageSessionStore` <!-- id: 15 -->
    - [x] `packages/engine/src/adapters/browser/chrome-storage-session-store.ts` <!-- id: 16 -->
    - [x] Export from `packages/engine/src/adapters/browser/index.ts` <!-- id: 17 -->
- [x] Integrate with `BtEngine` <!-- id: 18 -->
    - [x] Update `BtEngineOptions` in `packages/engine/src/core/bt-engine.ts` <!-- id: 19 -->
    - [x] Deprecate/Remove old storage mechanisms if applicable <!-- id: 20 -->
- [x] Verify changes <!-- id: 21 -->
    - [x] Run typecheck <!-- id: 22 -->
    - [x] Run lint <!-- id: 28 -->
    - [x] Run tests <!-- id: 23 -->

# Task: Phase 3 - Implement StorageRootManager

- [x] Create `StorageRoot` type <!-- id: 29 -->
    - [x] `packages/engine/src/storage/types.ts` <!-- id: 30 -->
- [x] Implement `StorageRootManager` <!-- id: 31 -->
    - [x] `packages/engine/src/storage/storage-root-manager.ts` <!-- id: 32 -->
- [x] Integrate into `BtEngine` <!-- id: 33 -->
    - [x] Update `BtEngineOptions` and `BtEngine` class <!-- id: 34 -->
    - [x] Update `Torrent` class to use `StorageRootManager` <!-- id: 35 -->
    - [x] Deprecate/Remove `StorageResolver` <!-- id: 36 -->
- [x] Verify changes <!-- id: 37 -->
    - [x] Run typecheck <!-- id: 38 -->
    - [x] Run lint <!-- id: 39 -->
    - [x] Add unit tests for `StorageRootManager` <!-- id: 40 -->
    - [x] Run tests <!-- id: 41 -->
    - [x] Run `pnpm run test:python` <!-- id: 42 -->
