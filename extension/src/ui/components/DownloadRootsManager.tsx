import React, { useEffect, useState } from 'react'
import { engineManager } from '@jstorrent/client'

interface DownloadRoot {
  token: string
  label: string
  path: string
}

export const DownloadRootsManager: React.FC = () => {
  const [roots, setRoots] = useState<DownloadRoot[]>([])
  const [defaultToken, setDefaultToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const loadRoots = async () => {
      const loadedRoots = engineManager.getRoots()
      const loadedDefaultToken = await engineManager.getDefaultRootToken()
      setRoots(loadedRoots)
      setDefaultToken(loadedDefaultToken)
      setLoading(false)
    }
    void loadRoots()
  }, [])

  const handleAddRoot = async () => {
    setAdding(true)
    const root = await engineManager.pickDownloadFolder()
    setAdding(false)
    if (root) {
      // Reload roots list
      const loadedRoots = engineManager.getRoots()
      const loadedDefaultToken = await engineManager.getDefaultRootToken()
      setRoots(loadedRoots)
      setDefaultToken(loadedDefaultToken)
      // If this is the first root, set it as default
      if (roots.length === 0) {
        await handleSetDefault(root.token)
      }
    }
  }

  const handleSetDefault = async (token: string) => {
    await engineManager.setDefaultRoot(token)
    setDefaultToken(token)
  }

  if (loading) {
    return <div style={{ padding: '20px' }}>Loading...</div>
  }

  return (
    <div style={{ padding: '20px' }}>
      <h3 style={{ marginTop: 0 }}>Download Locations</h3>

      {roots.length === 0 ? (
        <div
          style={{
            padding: '20px',
            background: 'var(--bg-warning)',
            border: '1px solid var(--border-warning)',
            borderRadius: '4px',
            marginBottom: '16px',
          }}
        >
          <strong>No download location configured</strong>
          <p style={{ margin: '8px 0 0 0' }}>
            You need to select a download folder before you can add torrents.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0' }}>
          {roots.map((root) => (
            <li
              key={root.token}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                border: '1px solid var(--border-light)',
                borderRadius: '4px',
                marginBottom: '8px',
                background:
                  root.token === defaultToken ? 'var(--bg-highlight)' : 'var(--bg-secondary)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold' }}>{root.label}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{root.path}</div>
              </div>

              {root.token === defaultToken ? (
                <span
                  style={{
                    padding: '4px 8px',
                    background: 'var(--accent-primary)',
                    color: 'white',
                    borderRadius: '4px',
                    fontSize: '12px',
                  }}
                >
                  Default
                </span>
              ) : (
                <button
                  onClick={() => handleSetDefault(root.token)}
                  style={{
                    padding: '4px 8px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  Set as Default
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={handleAddRoot}
        disabled={adding}
        style={{
          padding: '8px 16px',
          cursor: adding ? 'not-allowed' : 'pointer',
          background: 'var(--accent-success)',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
        }}
      >
        {adding ? 'Selecting...' : '+ Add Download Location'}
      </button>
    </div>
  )
}
