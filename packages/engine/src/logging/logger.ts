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

export function withScopeAndFiltering(
    base: Logger,
    component: ILoggableComponent,
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

export function basicLogger(): Logger {
    return {
        debug: (msg, ctx) => console.debug(msg, ctx),
        info: (msg, ctx) => console.info(msg, ctx),
        warn: (msg, ctx) => console.warn(msg, ctx),
        error: (msg, ctx) => console.error(msg, ctx),
    }
}

function formatPrefix(ctx: any): string {
    const parts: string[] = []

    if (ctx.clientId) {
        parts.push(`Client[${ctx.clientId.slice(0, 4)}]`)
    }

    if (ctx.component) {
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

    return parts.join(':')
}

function formatContext(ctx: any): object | undefined {
    const { clientId, component, instanceKey, instanceValue, scope, ...rest } = ctx
    if (Object.keys(rest).length === 0) return undefined
    return rest
}

export function defaultLogger(): Logger {
    const log = (level: keyof Console, msg: string, ctx?: object) => {
        if (!ctx) {
            (console[level] as Function)(msg)
            return
        }
        const prefix = formatPrefix(ctx)
        const cleanCtx = formatContext(ctx)
        const finalMsg = prefix ? `${prefix} ${msg}` : msg

        if (cleanCtx) {
            (console[level] as Function)(finalMsg, cleanCtx)
        } else {
            (console[level] as Function)(finalMsg)
        }
    }

    return {
        debug: (msg, ctx) => log('debug', msg, ctx),
        info: (msg, ctx) => log('info', msg, ctx),
        warn: (msg, ctx) => log('warn', msg, ctx),
        error: (msg, ctx) => log('error', msg, ctx),
    }
}

export function randomClientId(): string {
    return Math.random().toString(36).substring(2, 15)
}
