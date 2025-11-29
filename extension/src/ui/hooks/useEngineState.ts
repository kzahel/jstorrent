import { useState, useEffect, useCallback } from 'react'
import type { EngineStateSnapshot } from '@jstorrent/engine'

export function useEngineState(pollInterval: number = 1000) {
  const [state, setState] = useState<EngineStateSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (chrome.runtime.lastError) {
        setError(chrome.runtime.lastError.message || 'Unknown error')
        setLoading(false)
        return
      }

      if (response?.error) {
        setError(response.error)
      } else if (response?.state) {
        setState(response.state)
        setError(null)
      }
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    // Initial fetch
    refresh()

    // Poll for updates
    const interval = setInterval(refresh, pollInterval)

    return () => clearInterval(interval)
  }, [refresh, pollInterval])

  return { state, error, loading, refresh }
}
