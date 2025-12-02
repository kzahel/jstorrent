import React, { useEffect, useState } from 'react'
import { engineManager } from '../chrome/engine-manager'

interface DownloadRoot {
  key: string
  label: string
  path: string
}

export const DownloadRootsManager: React.FC = () => {
  const [roots, setRoots] = useState<DownloadRoot[]>([])
  const [defaultKey, setDefaultKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const loadRoots = async () => {
      const loadedRoots = engineManager.getRoots()
      const loadedDefaultKey = await engineManager.getDefaultRootKey()
      setRoots(loadedRoots)
      setDefaultKey(loadedDefaultKey)
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
      const loadedDefaultKey = await engineManager.getDefaultRootKey()
      setRoots(loadedRoots)
      setDefaultKey(loadedDefaultKey)
      // If this is the first root, set it as default
      if (roots.length === 0) {
        await handleSetDefault(root.key)
      }
    }
  }

  const handleSetDefault = async (key: string) => {
    await engineManager.setDefaultRoot(key)
    setDefaultKey(key)
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
              key={root.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                border: '1px solid var(--border-light)',
                borderRadius: '4px',
                marginBottom: '8px',
                background: root.key === defaultKey ? 'var(--bg-highlight)' : 'var(--bg-secondary)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold' }}>{root.label}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{root.path}</div>
              </div>

              {root.key === defaultKey ? (
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
                  onClick={() => handleSetDefault(root.key)}
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
