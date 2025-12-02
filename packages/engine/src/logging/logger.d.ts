import { EventEmitter } from '../utils/event-emitter'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}
export interface EngineLoggingConfig {
  level: LogLevel
  includeComponents?: string[]
  excludeComponents?: string[]
  includeInstanceValues?: string[]
  excludeInstanceValues?: string[]
  includePeerIds?: string[]
  excludePeerIds?: string[]
}
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
}
export declare class EngineComponent extends EventEmitter implements ILoggableComponent {
  protected engine: ILoggingEngine
  get engineInstance(): ILoggingEngine
  static logName: string
  protected instanceLogName?: string
  private _logger?
  infoHash?: string | Uint8Array
  peerId?: string | Uint8Array
  constructor(engine: ILoggingEngine)
  protected get logger(): Logger
  getLogName(): string
  getStaticLogName(): string
}
export declare function buildComponentScope(component: ILoggableComponent): string
export declare function buildInjectedContext(
  component: ILoggableComponent,
  userCtx?: object,
): LogContext
export declare function createFilter(cfg: EngineLoggingConfig): ShouldLogFn
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
export declare function withScopeAndFiltering(
  component: ILoggableComponent,
  shouldLog: ShouldLogFn,
  callbacks?: LogCallbacks,
): Logger
export declare function basicLogger(): Logger
export interface LogEntry {
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
export declare class LogStore {
  private logs
  private maxLogs
  add(level: LogLevel, message: string, args: unknown[]): void
  get(level?: LogLevel, limit?: number): LogEntry[]
}
export declare const globalLogStore: LogStore
export declare function capturingLogger(base?: Logger): Logger
export declare function defaultLogger(): Logger
export declare function randomClientId(): string
//# sourceMappingURL=logger.d.ts.map
