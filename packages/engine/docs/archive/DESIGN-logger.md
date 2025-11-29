# JSTorrent Engine

## Logging System Design Document

### Overview

The logging subsystem provides structured, scoped, per-engine logging for all components inside `packages/engine`, including BtEngine, Torrent, Peer, PieceManager, and other internal modules.

The goals are:

* Stable, minification-safe component identifiers
* Automatic multi-level scoping (engine → torrent → peer)
* Structured log context
* Configurable, context-based filtering
* Multiple BtEngine instances in the same process
* No globals, no manual logger plumbing
* Optional per-instance short names (Torrent)
* Pluggable backends (`console`, `json`, `event`, etc.)

All logging is performed via a uniform interface and routed through BtEngine’s scoped logger factory.

---

# 1. Logging Interface

Each backend implements:

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, context?: object): void;
  info(message: string, context?: object): void;
  warn(message: string, context?: object): void;
  error(message: string, context?: object): void;
}
```

`message` is human-readable.
`context` is structured diagnostic data.

---

# 2. Root Logging Entry Point (BtEngine)

BtEngine owns the “root” logger instance and a unique client identifier.

```ts
class BtEngine extends EventEmitter {
  readonly clientId: string;
  private rootLogger: Logger;
  private filterFn: ShouldLogFn;

  constructor(opts: { logger?: Logger; clientId?: string; logging?: EngineLoggingConfig }) {
    super();

    this.rootLogger = opts.logger ?? defaultLogger();
    this.clientId = opts.clientId ?? randomClientId();
    this.filterFn = createFilter(opts.logging ?? { level: "info" });
  }

  scopedLoggerFor(component: EngineComponent): Logger {
    const scope = buildComponentScope(component);
    const base = this.rootLogger;
    return withScopeAndFiltering(base, scope, this.filterFn);
  }
}
```

---

# 3. EngineComponent Base Class

All engine components extend `EngineComponent`.
Components never receive a logger directly; they hold a reference to their engine.

```ts
export class EngineComponent {
  protected engine: BtEngine;

  // Required: stable identifier for each component class
  static logName: string = "component";

  // Optional per-instance override (Torrent)
  protected instanceLogName?: string;

  constructor(engine: BtEngine) {
    this.engine = engine;

    const cls = this.constructor as any;
    if (!cls.logName) {
      const name = cls.name || "<unknown>";
      throw new Error(`EngineComponent subclass missing static logName: ${name}`);
    }
  }

  protected get logger(): Logger {
    return this.engine.scopedLoggerFor(this);
  }

  getLogName(): string {
    return this.instanceLogName ?? (this.constructor as any).logName;
  }
}
```

---

# 4. Component Declaration Rules

Every component:

1. Extends `EngineComponent`
2. Defines a static `logName`
3. Defines relevant instance identifiers (`infoHash`, `peerId`, etc.)

Example:

```ts
class PieceManager extends EngineComponent {
  static logName = "pcmgr";
  constructor(engine: BtEngine, infoHash: string) {
    super(engine);
    this.infoHash = infoHash;
  }
}
```

---

# 5. Scope Formatting

Scopes are human-oriented strings, separate from filtering.

```ts
function buildComponentScope(component: EngineComponent): string {
  const name = component.getLogName();
  const cid = component.engine.clientId;
  const anyComp = component as any;

  if (anyComp.infoHash && anyComp.peerId)
    return `${name}:${cid}:${anyComp.infoHash}:${anyComp.peerId}`;

  if (anyComp.infoHash)
    return `${name}:${cid}:${anyComp.infoHash}`;

  return `${name}:${cid}`;
}
```

Example scopes:

* `torrent:clientA:deadbeef`
* `t:dead12:clientA:deadbeefcafef00d`
* `peer:clientB:deadbeefcafef00d:peerXY`

---

# 6. Automatic Structured Context Injection

Every scoped logger automatically injects component metadata into the context object:

```ts
{
  component: <logName>,            // e.g. "torrent"
  clientId:  <clientId>,           // unique per engine
  instanceKey?:   <string>,        // e.g. "infoHash"
  instanceValue?: <string>,        // e.g. hash
  peerId?:        <string>         // if applicable
  ... user-provided fields
}
```

Injection logic:

```ts
function buildInjectedContext(component: EngineComponent, userCtx?: object): object {
  const ctx: any = {
    component: component.getLogName(),
    clientId: component.engine.clientId,
    ...userCtx
  };

  const anyComp = component as any;

  if (anyComp.infoHash) {
    ctx.instanceKey = "infoHash";
    ctx.instanceValue = anyComp.infoHash;
  }

  if (anyComp.peerId) {
    ctx.peerId = anyComp.peerId;
  }

  return ctx;
}
```

---

# 7. Scoped Logger With Filtering

```ts
function withScopeAndFiltering(
  base: Logger,
  scope: string,
  shouldLog: ShouldLogFn
): Logger {
  return {
    debug(msg, ctx) {
      const fullCtx = { ...buildInjectedContext(thisComponent, ctx), scope };
      if (shouldLog("debug", fullCtx)) base.debug(msg, fullCtx);
    },
    info(msg, ctx) {
      const fullCtx = { ...buildInjectedContext(thisComponent, ctx), scope };
      if (shouldLog("info", fullCtx)) base.info(msg, fullCtx);
    },
    warn(msg, ctx) {
      const fullCtx = { ...buildInjectedContext(thisComponent, ctx), scope };
      if (shouldLog("warn", fullCtx)) base.warn(msg, fullCtx);
    },
    error(msg, ctx) {
      const fullCtx = { ...buildInjectedContext(thisComponent, ctx), scope };
      if (shouldLog("error", fullCtx)) base.error(msg, fullCtx);
    }
  };
}
```

`thisComponent` is captured when constructing the scoped logger.

---

# 8. Logging Configuration

```ts
interface EngineLoggingConfig {
  level: LogLevel;
  includeComponents?: string[];       // e.g. ["torrent", "pcmgr"]
  excludeComponents?: string[];
  includeInstanceValues?: string[];   // compare against instanceValue
  excludeInstanceValues?: string[];
  includePeerIds?: string[];
  excludePeerIds?: string[];
}
```

The engine constructs a filter at startup:

```ts
this.filterFn = createFilter(config);
```

---

# 9. Filtering Logic (context-based)

Filtering no longer parses scopes.
Everything looks at the injected context:

```ts
function createFilter(cfg: EngineLoggingConfig): ShouldLogFn {
  return (level, ctx) => {
    if (!passesLevel(level, cfg.level)) return false;

    const comp = ctx.component;
    const inst = ctx.instanceValue;
    const pid  = ctx.peerId;

    if (cfg.excludeComponents?.includes(comp)) return false;
    if (cfg.includeComponents && !cfg.includeComponents.includes(comp)) return false;

    if (inst) {
      if (cfg.excludeInstanceValues?.includes(inst)) return false;
      if (cfg.includeInstanceValues && !cfg.includeInstanceValues.includes(inst)) return false;
    }

    if (pid) {
      if (cfg.excludePeerIds?.includes(pid)) return false;
      if (cfg.includePeerIds && !cfg.includePeerIds.includes(pid)) return false;
    }

    return true;
  };
}
```

Example filters:

* Suppress all peer logs
* Only show logs for one torrent
* Allow only one specific peer
* Raise global level to “warn”

---

# 10. Torrent: Instance-Level Override

Torrent defines a customized short per-instance `logName`:

```ts
class Torrent extends EngineComponent {
  static logName = "torrent";
  infoHash: string;

  constructor(engine: BtEngine, meta) {
    super(engine);
    this.infoHash = meta.infoHash;

    // short form for scope
    this.instanceLogName = `t:${meta.infoHash.slice(0, 6)}`;
  }

  start() {
    this.logger.info("starting");
  }
}
```

This changes only the human-readable scope, not the structured context.

---

# 11. Logger Backends

The logger system is backend-agnostic. Each backend receives fully filtered, structured messages.

Supported backends:

* `consoleLogger(level)`
* `jsonFileLogger(path)`
* `eventLogger(emitter)`
* `multiLogger([a, b, ...])`
* `noopLogger()`

Backends must preserve the incoming context.

---

# 12. Usage Pattern

Engine:

```ts
addTorrent(meta) {
  const t = new Torrent(this, meta);
  this.torrents.set(meta.infoHash, t);
  this.logger.info("torrent created", { infoHash: meta.infoHash });
}
```

Component:

```ts
this.logger.warn("piece timeout", { index, timeoutMs });
```

Result example:

```json
{
  "level": "warn",
  "message": "piece timeout",
  "component": "torrent",
  "clientId": "clientA",
  "instanceKey": "infoHash",
  "instanceValue": "deadbeefcafef00d",
  "scope": "t:deadbeef:clientA:deadbeefcafef00d",
  "index": 251,
  "timeoutMs": 5000
}
```

---

# 13. Summary

This design delivers:

* Stable, explicit log naming (`logName`)
* Optional instance-level overrides
* Automatic structured context injection
* Scope generation separated from filtering
* Context-based filtering (robust, minification-safe)
* Multiple engine instances supported
* Zero global state
* Minimal boilerplate in components
* Compatible with any backend logger

The result is a clean, powerful, highly inspectable logging system ideal for complex BitTorrent engine debugging and production telemetry.
