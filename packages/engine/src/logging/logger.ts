import { EventEmitter } from 'events'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, ...args: any[]): void
}

export interface EngineLoggingConfig {
  level: LogLevel
  includeComponents?: string[] // e.g. ["torrent", "pcmgr"]
  excludeComponents?: string[]
  includeInstanceValues?: string[] // compare against instanceValue
  excludeInstanceValues?: string[]
  includePeerIds?: string[]
  excludePeerIds?: string[]
}

export type ShouldLogFn = (level: LogLevel, context: any) => boolean

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

    const cls = this.constructor as any
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
    return this.instanceLogName ?? (this.constructor as any).logName
  }

  getStaticLogName(): string {
    return (this.constructor as any).logName
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

export function buildInjectedContext(component: ILoggableComponent, userCtx?: object): object {
  const ctx: any = {
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
    if (!passesLevel(level, cfg.level)) return false

    const comp = ctx.component
    const inst = ctx.instanceValue
    const pid = ctx.peerId

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

export function withScopeAndFiltering(
  base: Logger,
  component: ILoggableComponent,
  shouldLog: ShouldLogFn,
): Logger {
  const getLogger = (level: LogLevel) => {
    const ctx = buildInjectedContext(component)
    if (!shouldLog(level, ctx)) return NOOP

    const prefix = formatPrefix(ctx)

    /**
     * BIND TRICK FOR CALL SITE VISIBILITY
     *
     * Goal: We want the browser DevTools to show the original call site (e.g. torrent.ts:123)
     * instead of pointing to this logger wrapper (logger.ts:160).
     *
     * Solution: We return a bound function of the base logger (usually console).
     * `(console.info).bind(console, prefix)` creates a new function that, when called,
     * executes `console.info(prefix, ...args)`.
     *
     * Why it works:
     * 1. `bind` returns a native bound function. Browsers often treat these transparently
     *    or attribute the call to the invoker of the bound function.
     * 2. We are returning the function to the caller (via the getter), so the actual invocation
     *    happens in the caller's stack frame (e.g. `this.logger.info(...)` in torrent.ts).
     *
     * Alternatives considered:
     * 1. Wrapper function: `log(msg) { console.log(prefix, msg) }`
     *    - Problem: DevTools shows logger.ts as the source.
     * 2. Error.captureStackTrace:
     *    - Problem: Expensive, brittle, and only affects the stack trace object,
     *      not the "source" link in the console UI.
     * 3. Async logging:
     *    - Problem: Loses stack context completely and can be confusing.
     */
    return (base[level] as Function).bind(base, prefix)
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

function formatPrefix(ctx: any): string {
  const parts: string[] = []

  if (ctx.clientId) {
    parts.push(`Client[${ctx.clientId.slice(0, 4)}]`)
  }

  if (ctx.name && ctx.name !== ctx.component) {
    parts.push(ctx.name)
  } else if (ctx.component) {
    let compStr = ctx.component
    // Capitalize component name
    compStr = compStr.charAt(0).toUpperCase() + compStr.slice(1)

    if (ctx.instanceValue) {
      let valStr = ''
      if (ctx.instanceValue instanceof Uint8Array) {
        valStr = Buffer.from(ctx.instanceValue).toString('hex').slice(0, 4)
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

export function defaultLogger(): Logger {
  return basicLogger()
}

export function randomClientId(): string {
  return Math.random().toString(36).substring(2, 15)
}
