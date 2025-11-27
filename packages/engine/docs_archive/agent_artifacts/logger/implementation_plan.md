# Logger Implementation Plan

## Goal Description
Implement a specialized logging system for the JSTorrent engine to provide structured, scoped, and performant logging. This system will allow for better debugging and monitoring of the engine's internal state, with support for component-based filtering and multiple backends.

## Proposed Changes

### Logging Infrastructure
#### [NEW] [logger.ts](file:///home/kgraehl/code/jstorrent-monorepo/packages/engine/src/logging/logger.ts)
- Define `Logger`, `LogLevel`, `EngineLoggingConfig` interfaces.
- Implement `EngineComponent` base class with cached logger access.
- Implement `BtEngine` as `ILoggingEngine`.
- Implement filtering and scoping logic.

### Component Refactoring
#### [MODIFY] [bt-engine.ts](file:///home/kgraehl/code/jstorrent-monorepo/packages/engine/src/core/bt-engine.ts)
- Implement `ILoggingEngine`.
- Initialize root logger and filter.
- Pass `this` (engine) to components.

#### [MODIFY] [torrent.ts](file:///home/kgraehl/code/jstorrent-monorepo/packages/engine/src/core/torrent.ts)
- Extend `EngineComponent`.
- Use `this.logger` instead of `console`.
- Update constructor to accept `engine`.

#### [MODIFY] [peer-connection.ts](file:///home/kgraehl/code/jstorrent-monorepo/packages/engine/src/core/peer-connection.ts)
- Extend `EngineComponent`.
- Use `this.logger`.

#### [MODIFY] [piece-manager.ts](file:///home/kgraehl/code/jstorrent-monorepo/packages/engine/src/core/piece-manager.ts)
- Extend `EngineComponent`.
- Use `this.logger`.

## Verification Plan

### Automated Tests
- Run `pnpm test` to verify all unit tests pass.
- Run `pnpm typecheck` to ensure no type errors.
- Verify logger tests in `logger.spec.ts`.

### Manual Verification
- Check logs during a test run to ensure correct scoping and filtering.
