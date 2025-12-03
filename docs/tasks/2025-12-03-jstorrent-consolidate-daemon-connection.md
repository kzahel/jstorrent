# Consolidate DaemonConnection Files

## Overview

There are two `daemon-connection.ts` files:
- `packages/engine/src/adapters/daemon/daemon-connection.ts` - Full implementation, actively used
- `extension/src/lib/daemon-connection.ts` - Contains `IDaemonConnection` interface + unused class

The extension version is mostly dead code. Only the `IDaemonConnection` interface is imported by `extension/src/lib/sockets.ts`. The class itself is never instantiated.

**Goal:** Consolidate to a single file in packages/engine, delete the extension duplicate.

---

## Phase 1: Add Interface to Engine

### 1.1 Update packages/engine/src/adapters/daemon/daemon-connection.ts

Add the `IDaemonConnection` interface at the top of the file, before the class:

```ts
export interface IDaemonConnection {
  connect(info: { port: number; token: string }): Promise<void>
  sendFrame(frame: ArrayBuffer): void
  onFrame(cb: (frame: ArrayBuffer) => void): void
  close(): void
  readonly ready: boolean
}
```

Note: The interface uses `info: { port: number; token: string }` to match the extension's `DaemonInfo` type pattern.

### 1.2 Update packages/engine/src/index.ts

Add the interface export alongside the existing class export:

```ts
export { DaemonConnection, IDaemonConnection } from './adapters/daemon/daemon-connection'
```

---

## Phase 2: Update Extension Imports

### 2.1 Update extension/src/lib/sockets.ts

Change the import from:

```ts
import { IDaemonConnection } from './daemon-connection'
```

To:

```ts
import { IDaemonConnection } from '@jstorrent/engine'
```

---

## Phase 3: Delete Extension File

### 3.1 Delete extension/src/lib/daemon-connection.ts

```bash
rm extension/src/lib/daemon-connection.ts
```

---

## Phase 4: Verify

### 4.1 Type check

```bash
cd packages/engine && pnpm typecheck
cd extension && pnpm typecheck
```

### 4.2 Check for any remaining references

```bash
grep -r "lib/daemon-connection" --include="*.ts" --include="*.tsx" extension/
```

Should return no results.

---

## Checklist

- [ ] Add `IDaemonConnection` interface to `packages/engine/src/adapters/daemon/daemon-connection.ts`
- [ ] Export `IDaemonConnection` from `packages/engine/src/index.ts`
- [ ] Update import in `extension/src/lib/sockets.ts` to use `@jstorrent/engine`
- [ ] Delete `extension/src/lib/daemon-connection.ts`
- [ ] Verify type checking passes in both packages
