import { EventEmitter } from 'events'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(message: string, context?: object): void
  info(message: string, context?: object): void
  warn(message: string, context?: object): void
  error(message: string, context?: object): void
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

export interface ILoggingEngine {
  clientId: string
  scopedLoggerFor(component: EngineComponent): Logger
}

export class EngineComponent extends EventEmitter {
  protected engine: ILoggingEngine

  public get engineInstance(): ILoggingEngine {
    return this.engine
  }

  // Required: stable identifier for each component class
  static logName: string = 'component'

  // Optional per-instance override (Torrent)
  protected instanceLogName?: string
  private _logger?: Logger

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

export function buildComponentScope(component: EngineComponent): string {
  const name = component.getLogName()
  const cid = component.engineInstance.clientId
  const anyComp = component as any

  if (anyComp.infoHash && anyComp.peerId)
    return `${name}:${cid}:${anyComp.infoHash}:${anyComp.peerId} `

  if (anyComp.infoHash) return `${name}:${cid}:${anyComp.infoHash} `

  return `${name}:${cid} `
}

export function buildInjectedContext(component: EngineComponent, userCtx?: object): object {
  const ctx: any = {
    component: component.getStaticLogName(),
    clientId: component.engineInstance.clientId,
    ...userCtx,
  }

  const anyComp = component as any

  if (anyComp.infoHash) {
    ctx.instanceKey = 'infoHash'
    ctx.instanceValue = anyComp.infoHash
  }

  if (anyComp.peerId) {
    ctx.peerId = anyComp.peerId
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

export function withScopeAndFiltering(
  base: Logger,
  component: EngineComponent,
  shouldLog: ShouldLogFn,
): Logger {
  const scope = buildComponentScope(component)
  return {
    debug(msg, ctx) {
      const fullCtx = { ...buildInjectedContext(component, ctx), scope }
      if (shouldLog('debug', fullCtx)) base.debug(msg, fullCtx)
    },
    info(msg, ctx) {
      const fullCtx = { ...buildInjectedContext(component, ctx), scope }
      if (shouldLog('info', fullCtx)) base.info(msg, fullCtx)
    },
    warn(msg, ctx) {
      const fullCtx = { ...buildInjectedContext(component, ctx), scope }
      if (shouldLog('warn', fullCtx)) base.warn(msg, fullCtx)
    },
    error(msg, ctx) {
      const fullCtx = { ...buildInjectedContext(component, ctx), scope }
      if (shouldLog('error', fullCtx)) base.error(msg, fullCtx)
    },
  }
}

export function defaultLogger(): Logger {
  return {
    debug: (msg, ctx) => console.debug(msg, ctx),
    info: (msg, ctx) => console.info(msg, ctx),
    warn: (msg, ctx) => console.warn(msg, ctx),
    error: (msg, ctx) => console.error(msg, ctx),
  }
}

export function randomClientId(): string {
  return Math.random().toString(36).substring(2, 15)
}
