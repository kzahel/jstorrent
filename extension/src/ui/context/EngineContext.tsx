import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { BtEngine } from '@jstorrent/engine'
import { engineManager } from '../lib/engine-manager'

interface EngineContextValue {
  engine: BtEngine | null
  loading: boolean
  error: string | null
}

const EngineContext = createContext<EngineContextValue>({
  engine: null,
  loading: true,
  error: null,
})

export function EngineProvider({ children }: { children: ReactNode }) {
  const [engine, setEngine] = useState<BtEngine | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    engineManager
      .init()
      .then((eng) => {
        setEngine(eng)
        setLoading(false)
      })
      .catch((e) => {
        console.error('Failed to initialize engine:', e)
        setError(String(e))
        setLoading(false)
      })
  }, [])

  return (
    <EngineContext.Provider value={{ engine, loading, error }}>{children}</EngineContext.Provider>
  )
}

export function useEngine(): EngineContextValue {
  return useContext(EngineContext)
}
