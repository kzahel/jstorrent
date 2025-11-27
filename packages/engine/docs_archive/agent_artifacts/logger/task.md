# Logger Implementation

- [x] Create `packages/engine/src/logging/logger.ts` <!-- id: 0 -->
- [x] Create tests for logger in `packages/engine/test/logging/logger.spec.ts` <!-- id: 1 -->
- [x] Refactor `BtEngine` to implement `ILoggingEngine` <!-- id: 2 -->
- [x] Refactor `PeerConnection` to extend `EngineComponent`
    - [x] Update `PeerConnection` constructor to accept `ILoggingEngine`
    - [x] Replace `console.log` with `this.logger` calls
    - [x] Update `PeerConnection` usages in `BtEngine` and `Torrent`
- [x] Refactor `PieceManager` to extend `EngineComponent`
    - [x] Update `PieceManager` constructor to accept `ILoggingEngine`
    - [x] Update `PieceManager` usages in `BtEngine` and `Torrent`
- [x] Verify all tests pass
    - [x] Run `pnpm test` and fix any regressions
- [x] Run `pnpm typecheck`
