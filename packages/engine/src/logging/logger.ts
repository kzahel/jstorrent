import { EventEmitter } from '../utils/event-emitter'
import { toHex } from '../utils/buffer'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// Logger interface uses `unknown[]` for variadic args - callers can pass anything
export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface EngineLoggingConfig {
  level: LogLevel
  /** Per-component log level overrides. Key is component name (e.g. "peer", "torrent"). */
  componentLevels?: Record<string, LogLevel>
  includeComponents?: string[] // e.g. ["torrent", "pcmgr"]
  excludeComponents?: string[]
  includeInstanceValues?: string[] // compare against instanceValue
  excludeInstanceValues?: string[]
  includePeerIds?: string[]
  excludePeerIds?: string[]
}

// Context passed to filtering functions
export interface LogContext {
  component: string
  name: string
  clientId: string
  instanceKey?: string
  instanceValue?: string | Uint8Array
  peerId?: string | Uint8Array
}

export type ShouldLogFn = (level: LogLevel, context: LogContext) => boolean

export interface ILoggableComponent {
  getLogName(): string
  getStaticLogName(): string
  engineInstance: ILoggingEngine
  infoHash?: string | Uint8Array
  peerId?: string | Uint8Array
}

export interface ILoggingEngine {
  clientId: string
  scopedLoggerFor(component: ILoggableComponent): Logger
  /** Current listening port for incoming peer connections */
  listeningPort: number
  /**
   * When true, PeerConnection processes incoming data immediately instead of
   * waiting for the tick loop to call drainBuffer(). Useful for tests.
   * Default: false (production uses tick-aligned processing)
   */
  autoDrainBuffers?: boolean
}

export class EngineComponent extends EventEmitter implements ILoggableComponent {
  protected engine: ILoggingEngine

  public get engineInstance(): ILoggingEngine {
    return this.engine
  }

  // Required: stable identifier for each component class
  static logName: string = 'component'

  // Optional per-instance override (Torrent)
  protected instanceLogName?: string
  private _logger?: Logger

  // Optional properties for ILoggableComponent
  public infoHash?: string | Uint8Array
  public peerId?: string | Uint8Array

  constructor(engine: ILoggingEngine) {
    super()
    this.engine = engine

    const cls = this.constructor as { logName?: string; name?: string }
    if (!cls.logName) {
      const name = cls.name || '<unknown>'
      throw new Error(`EngineComponent subclass missing static logName: ${name} `)
    }
  }

  protected get logger(): Logger {
    if (!this._logger) {
      this._logger = this.engine.scopedLoggerFor(this)
    }
    return this._logger
  }

  getLogName(): string {
    return this.instanceLogName ?? (this.constructor as unknown as { logName: string }).logName
  }

  getStaticLogName(): string {
    return (this.constructor as unknown as { logName: string }).logName
  }
}

export function buildComponentScope(component: ILoggableComponent): string {
  const name = component.getLogName()
  const cid = component.engineInstance.clientId

  if (component.infoHash && component.peerId)
    return `${name}:${cid}:${component.infoHash}:${component.peerId} `

  if (component.infoHash) return `${name}:${cid}:${component.infoHash} `

  return `${name}:${cid} `
}

export function buildInjectedContext(component: ILoggableComponent, userCtx?: object): LogContext {
  const ctx: LogContext = {
    component: component.getStaticLogName(),
    name: component.getLogName(),
    clientId: component.engineInstance.clientId,
    ...userCtx,
  }

  if (component.infoHash) {
    ctx.instanceKey = 'infoHash'
    ctx.instanceValue = component.infoHash
  }

  if (component.peerId) {
    ctx.peerId = component.peerId
  }

  return ctx
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function passesLevel(msgLevel: LogLevel, configLevel: LogLevel): boolean {
  return LEVEL_PRIORITY[msgLevel] >= LEVEL_PRIORITY[configLevel]
}

export function createFilter(cfg: EngineLoggingConfig): ShouldLogFn {
  return (level, ctx) => {
    const comp = ctx.component

    // Check level: use component-specific level if set, otherwise global
    const effectiveLevel = cfg.componentLevels?.[comp] ?? cfg.level
    if (!passesLevel(level, effectiveLevel)) return false

    const inst = typeof ctx.instanceValue === 'string' ? ctx.instanceValue : undefined
    const pid = typeof ctx.peerId === 'string' ? ctx.peerId : undefined

    if (cfg.excludeComponents?.includes(comp)) return false
    if (cfg.includeComponents && !cfg.includeComponents.includes(comp)) return false

    if (inst) {
      if (cfg.excludeInstanceValues?.includes(inst)) return false
      if (cfg.includeInstanceValues && !cfg.includeInstanceValues.includes(inst)) return false
    }

    if (pid) {
      if (cfg.excludePeerIds?.includes(pid)) return false
      if (cfg.includePeerIds && !cfg.includePeerIds.includes(pid)) return false
    }

    return true
  }
}

const NOOP = () => {}

/**
 * Creates a scoped logger with filtering and optional callbacks.
 *
 * CALL SITE VISIBILITY:
 * This file (logger.ts) is in the x_google_ignoreList in source maps.
 * DevTools will skip over this file when showing the call site for console logs,
 * displaying the actual caller (e.g., torrent.ts:308) instead of this wrapper.
 *
 * All logging side-effects (onLog callback, log capturing) happen here so that
 * there are no intermediate wrapper files in the call stack that aren't ignored.
 */
export function withScopeAndFiltering(
  component: ILoggableComponent,
  shouldLog: ShouldLogFn,
  callbacks?: LogCallbacks,
): Logger {
  const getLogger = (level: LogLevel) => {
    const ctx = buildInjectedContext(component)
    if (!shouldLog(level, ctx)) return NOOP

    const prefix = formatPrefix(ctx)

    // Return a wrapper that does ALL side effects, then calls console directly.
    // This wrapper is in logger.ts which is in the ignore list, so DevTools
    // will skip it and show the actual caller.
    return (msg: string, ...args: unknown[]) => {
      if (callbacks?.onLog || callbacks?.onCapture) {
        const entry: LogEntry = { timestamp: Date.now(), level, message: `${prefix} ${msg}`, args }
        callbacks.onLog?.(entry)
        callbacks.onCapture?.(entry)
      }
      ;(console[level] as (...a: unknown[]) => void)(prefix, msg, ...args)
    }
  }

  return {
    get debug() {
      return getLogger('debug')
    },
    get info() {
      return getLogger('info')
    },
    get warn() {
      return getLogger('warn')
    },
    get error() {
      return getLogger('error')
    },
  }
}

export function basicLogger(): Logger {
  return console as unknown as Logger
}

function formatPrefix(ctx: LogContext): string {
  const parts: string[] = []

  if (ctx.clientId) {
    parts.push(`Client[${ctx.clientId.slice(0, 4)}]`)
  }

  if (ctx.name && ctx.name !== ctx.component) {
    parts.push(ctx.name)
  } else if (ctx.component) {
    let compStr: string = ctx.component
    // Capitalize component name
    compStr = compStr.charAt(0).toUpperCase() + compStr.slice(1)

    if (ctx.instanceValue) {
      let valStr = ''
      if (ctx.instanceValue instanceof Uint8Array) {
        valStr = toHex(ctx.instanceValue).slice(0, 4)
      } else if (typeof ctx.instanceValue === 'string') {
        valStr = ctx.instanceValue.slice(0, 4)
      } else {
        valStr = String(ctx.instanceValue).slice(0, 4)
      }
      parts.push(`${compStr}[${valStr}]`)
    } else {
      parts.push(compStr)
    }
  }

  return parts.length > 0 ? `[${parts.join(':')}]` : ''
}

export interface LogEntry {
  id?: number
  timestamp: number
  level: LogLevel
  message: string
  args: unknown[]
}

/**
 * Callbacks for logging side-effects.
 * These are called from within logger.ts (which is in x_google_ignoreList)
 * so that DevTools shows the actual call site, not intermediate wrappers.
 */
export interface LogCallbacks {
  onLog?: (entry: LogEntry) => void
  onCapture?: (entry: LogEntry) => void
}

type LogListener = (entry: LogEntry) => void

export class LogStore {
  private logs: LogEntry[] = []
  private maxLogs: number = 1000
  private nextId: number = 0
  private listeners: Set<LogListener> = new Set()

  add(level: LogLevel, message: string, args: unknown[]): void {
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: Date.now(),
      level,
      message,
      args,
    }
    this.logs.push(entry)

    // Bulk truncate when 50% over capacity
    if (this.logs.length > this.maxLogs * 1.5) {
      this.logs = this.logs.slice(-this.maxLogs)
    }

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(entry)
      } catch (e) {
        console.error('Log listener error:', e)
      }
    }
  }

  getEntries(): LogEntry[] {
    return this.logs
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clear(): void {
    this.logs = []
    // Note: don't reset nextId to keep keys unique
  }

  get size(): number {
    return this.logs.length
  }
}

export const globalLogStore = new LogStore()

export function capturingLogger(base: Logger = basicLogger()): Logger {
  return {
    debug: (msg, ...args) => {
      globalLogStore.add('debug', msg, args)
      base.debug(msg, ...args)
    },
    info: (msg, ...args) => {
      globalLogStore.add('info', msg, args)
      base.info(msg, ...args)
    },
    warn: (msg, ...args) => {
      globalLogStore.add('warn', msg, args)
      base.warn(msg, ...args)
    },
    error: (msg, ...args) => {
      globalLogStore.add('error', msg, args)
      base.error(msg, ...args)
    },
  }
}

export function defaultLogger(): Logger {
  return capturingLogger(basicLogger())
}

export function randomClientId(): string {
  return Math.random().toString(36).substring(2, 15)
}
