import { EventEmitter } from '../utils/event-emitter'
import { toHex } from '../utils/buffer'
export class EngineComponent extends EventEmitter {
  get engineInstance() {
    return this.engine
  }
  constructor(engine) {
    super()
    this.engine = engine
    const cls = this.constructor
    if (!cls.logName) {
      const name = cls.name || '<unknown>'
      throw new Error(`EngineComponent subclass missing static logName: ${name} `)
    }
  }
  get logger() {
    if (!this._logger) {
      this._logger = this.engine.scopedLoggerFor(this)
    }
    return this._logger
  }
  getLogName() {
    return this.instanceLogName ?? this.constructor.logName
  }
  getStaticLogName() {
    return this.constructor.logName
  }
}
// Required: stable identifier for each component class
EngineComponent.logName = 'component'
export function buildComponentScope(component) {
  const name = component.getLogName()
  const cid = component.engineInstance.clientId
  if (component.infoHash && component.peerId)
    return `${name}:${cid}:${component.infoHash}:${component.peerId} `
  if (component.infoHash) return `${name}:${cid}:${component.infoHash} `
  return `${name}:${cid} `
}
export function buildInjectedContext(component, userCtx) {
  const ctx = {
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
const LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}
function passesLevel(msgLevel, configLevel) {
  return LEVEL_PRIORITY[msgLevel] >= LEVEL_PRIORITY[configLevel]
}
export function createFilter(cfg) {
  return (level, ctx) => {
    if (!passesLevel(level, cfg.level)) return false
    const comp = ctx.component
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
export function withScopeAndFiltering(component, shouldLog, callbacks) {
  const getLogger = (level) => {
    const ctx = buildInjectedContext(component)
    if (!shouldLog(level, ctx)) return NOOP
    const prefix = formatPrefix(ctx)
    // Return a wrapper that does ALL side effects, then calls console directly.
    // This wrapper is in logger.ts which is in the ignore list, so DevTools
    // will skip it and show the actual caller.
    return (msg, ...args) => {
      if (callbacks?.onLog || callbacks?.onCapture) {
        const entry = { timestamp: Date.now(), level, message: msg, args }
        callbacks.onLog?.(entry)
        callbacks.onCapture?.(entry)
      }
      console[level](prefix, msg, ...args)
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
export function basicLogger() {
  return console
}
function formatPrefix(ctx) {
  const parts = []
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
export class LogStore {
  constructor() {
    this.logs = []
    this.maxLogs = 1000
  }
  add(level, message, args) {
    this.logs.push({
      timestamp: Date.now(),
      level,
      message,
      args,
    })
    if (this.logs.length > this.maxLogs) {
      this.logs.shift()
    }
  }
  get(level, limit = 100) {
    let filtered = this.logs
    if (level) {
      filtered = filtered.filter((l) => LEVEL_PRIORITY[l.level] >= LEVEL_PRIORITY[level])
    }
    return filtered.slice(-limit)
  }
}
export const globalLogStore = new LogStore()
export function capturingLogger(base = basicLogger()) {
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
export function defaultLogger() {
  return capturingLogger(basicLogger())
}
export function randomClientId() {
  return Math.random().toString(36).substring(2, 15)
}
