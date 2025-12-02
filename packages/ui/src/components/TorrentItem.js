import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime'
import { useState, useRef, useEffect } from 'react'
import { formatBytes } from '../utils/format'
const iconButtonStyle = {
  width: '28px',
  height: '28px',
  padding: 0,
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  background: 'var(--button-bg)',
  color: 'var(--button-text)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '14px',
}
const dropdownMenuStyle = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: '4px',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  zIndex: 100,
  minWidth: '150px',
}
const dropdownItemStyle = {
  display: 'block',
  width: '100%',
  padding: '8px 12px',
  border: 'none',
  background: 'none',
  color: 'var(--text-primary)',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: '13px',
}
export const TorrentItem = ({
  torrent,
  onStart,
  onStop,
  onDelete,
  onRecheck,
  onReset,
  onShare,
}) => {
  const isStopped = torrent.userState === 'stopped'
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])
  const handleMenuAction = (action) => {
    setMenuOpen(false)
    action()
  }
  return _jsxs('li', {
    style: {
      border: '1px solid var(--border-color)',
      borderRadius: '4px',
      padding: '12px',
      marginBottom: '8px',
      cursor: 'pointer',
    },
    onClick: () => console.log(torrent),
    children: [
      _jsxs('div', {
        style: { display: 'flex', alignItems: 'flex-start', gap: '12px' },
        children: [
          _jsxs('div', {
            style: { flex: 1 },
            children: [
              _jsx('div', {
                style: { fontWeight: 'bold' },
                children: torrent.name || 'Loading metadata...',
              }),
              _jsxs('div', {
                style: { fontSize: '12px', color: 'var(--text-secondary)' },
                children: [
                  torrent.activityState,
                  ' | ',
                  (torrent.progress * 100).toFixed(1),
                  '% | ',
                  torrent.numPeers,
                  ' ',
                  'peers | ',
                  torrent.files.length,
                  ' files |',
                  ' ',
                  formatBytes(torrent.contentStorage?.getTotalSize() || 0),
                ],
              }),
              _jsxs('div', {
                style: { fontSize: '12px', color: 'var(--text-secondary)' },
                children: [
                  formatBytes(torrent.downloadSpeed),
                  '/s | ',
                  formatBytes(torrent.uploadSpeed),
                  '/s',
                ],
              }),
            ],
          }),
          _jsxs('div', {
            style: { display: 'flex', gap: '4px' },
            children: [
              isStopped
                ? _jsx('button', {
                    style: iconButtonStyle,
                    onClick: (e) => {
                      e.stopPropagation()
                      onStart?.(torrent)
                    },
                    title: 'Start',
                    children: '\u25B6',
                  })
                : _jsx('button', {
                    style: iconButtonStyle,
                    onClick: (e) => {
                      e.stopPropagation()
                      onStop?.(torrent)
                    },
                    title: 'Stop',
                    children: '\u23F8',
                  }),
              _jsx('button', {
                style: { ...iconButtonStyle, color: 'var(--accent-error)' },
                onClick: (e) => {
                  e.stopPropagation()
                  onDelete?.(torrent)
                },
                title: 'Delete',
                children: '\u2715',
              }),
              _jsxs('div', {
                style: { position: 'relative' },
                ref: menuRef,
                children: [
                  _jsx('button', {
                    style: iconButtonStyle,
                    onClick: (e) => {
                      e.stopPropagation()
                      setMenuOpen(!menuOpen)
                    },
                    title: 'More actions',
                    children: '\u2630',
                  }),
                  menuOpen &&
                    _jsxs('div', {
                      style: dropdownMenuStyle,
                      children: [
                        _jsx('button', {
                          style: dropdownItemStyle,
                          onClick: (e) => {
                            e.stopPropagation()
                            handleMenuAction(() => onRecheck?.(torrent))
                          },
                          onMouseEnter: (e) =>
                            (e.currentTarget.style.background = 'var(--bg-secondary)'),
                          onMouseLeave: (e) => (e.currentTarget.style.background = 'none'),
                          children: 'Re-verify Data',
                        }),
                        _jsx('button', {
                          style: dropdownItemStyle,
                          onClick: (e) => {
                            e.stopPropagation()
                            handleMenuAction(() => onReset?.(torrent))
                          },
                          onMouseEnter: (e) =>
                            (e.currentTarget.style.background = 'var(--bg-secondary)'),
                          onMouseLeave: (e) => (e.currentTarget.style.background = 'none'),
                          children: 'Reset State',
                        }),
                        _jsx('button', {
                          style: dropdownItemStyle,
                          onClick: (e) => {
                            e.stopPropagation()
                            handleMenuAction(() => onShare?.(torrent))
                          },
                          onMouseEnter: (e) =>
                            (e.currentTarget.style.background = 'var(--bg-secondary)'),
                          onMouseLeave: (e) => (e.currentTarget.style.background = 'none'),
                          children: 'Share Link',
                        }),
                      ],
                    }),
                ],
              }),
            ],
          }),
        ],
      }),
      _jsx('div', {
        style: {
          height: '4px',
          background: 'var(--progress-bg)',
          borderRadius: '2px',
          marginTop: '8px',
        },
        children: _jsx('div', {
          style: {
            height: '100%',
            width: `${torrent.progress * 100}%`,
            background:
              torrent.activityState === 'seeding'
                ? 'var(--accent-success)'
                : 'var(--accent-primary)',
            borderRadius: '2px',
          },
        }),
      }),
    ],
  })
}
