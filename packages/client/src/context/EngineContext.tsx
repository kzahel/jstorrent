import { createContext, useContext, ReactNode } from 'react'
import { BtEngine } from '@jstorrent/engine'
import { EngineAdapter, DirectEngineAdapter } from '../adapters/types'

interface EngineContextValue {
  adapter: EngineAdapter
}

const EngineContext = createContext<EngineContextValue | null>(null)

export interface EngineProviderProps {
  /** Provide either a BtEngine (will be wrapped) or an EngineAdapter directly */
  engine?: BtEngine
  adapter?: EngineAdapter
  children: ReactNode
}

/**
 * Provides engine adapter to descendant components.
 */
export function EngineProvider({ engine, adapter, children }: EngineProviderProps) {
  const resolvedAdapter = adapter ?? (engine ? new DirectEngineAdapter(engine) : null)

  if (!resolvedAdapter) {
    throw new Error('EngineProvider requires either engine or adapter prop')
  }

  return <EngineContext.Provider value={{ adapter: resolvedAdapter }}>{children}</EngineContext.Provider>
}

/**
 * Access the engine adapter from context.
 * Must be used within an EngineProvider.
 */
export function useAdapter(): EngineAdapter {
  const context = useContext(EngineContext)
  if (!context) {
    throw new Error('useAdapter must be used within an EngineProvider')
  }
  return context.adapter
}

/**
 * Legacy hook for direct engine access.
 * Prefer useAdapter() for new code.
 */
export function useEngine(): BtEngine {
  const adapter = useAdapter()
  // This cast is safe when using DirectEngineAdapter
  // For RPC adapter, this would need different handling
  return (adapter as DirectEngineAdapter)['engine']
}
