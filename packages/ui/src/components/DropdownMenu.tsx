import React, { useState, useRef, useEffect } from 'react'
import { ContextMenuItem } from './ContextMenu'

export interface DropdownMenuProps {
  label: string
  items: ContextMenuItem[]
  onSelect: (id: string) => void
  disabled?: boolean
}

const buttonStyle: React.CSSProperties = {
  padding: '0 var(--spacing-sm)',
  cursor: 'pointer',
  fontSize: 'var(--font-base)',
  height: 'var(--button-height)',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-xs)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  background: 'var(--button-bg)',
  color: 'var(--button-text)',
}

const menuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 'var(--spacing-xs)',
  background: 'var(--bg-primary, #fff)',
  border: '1px solid var(--border-color, #ddd)',
  borderRadius: '6px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  padding: 'var(--spacing-xs) 0',
  minWidth: '160px',
  zIndex: 1000,
  fontSize: 'var(--font-base)',
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-sm)',
  padding: 'var(--spacing-sm) var(--spacing-md)',
  cursor: 'pointer',
  border: 'none',
  background: 'none',
  width: '100%',
  textAlign: 'left',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-base)',
}

const dangerStyle: React.CSSProperties = {
  ...itemStyle,
  color: 'var(--accent-error, #d32f2f)',
}

const separatorStyle: React.CSSProperties = {
  height: '1px',
  background: 'var(--border-color, #ddd)',
  margin: 'var(--spacing-xs) 0',
}

export function DropdownMenu({ label, items, onSelect, disabled }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        style={{
          ...buttonStyle,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'default' : 'pointer',
        }}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {label}
        <span style={{ fontSize: 'var(--font-xs)' }}>▼</span>
      </button>

      {open && (
        <div style={menuStyle}>
          {items.map((item) => {
            if (item.separator) {
              return <div key={item.id} style={separatorStyle} />
            }

            const style = item.danger ? dangerStyle : itemStyle

            return (
              <button
                key={item.id}
                style={{
                  ...style,
                  opacity: item.disabled ? 0.5 : 1,
                  cursor: item.disabled ? 'default' : 'pointer',
                }}
                disabled={item.disabled}
                onClick={() => {
                  if (!item.disabled) {
                    onSelect(item.id)
                    setOpen(false)
                  }
                }}
                onMouseEnter={(e) => {
                  if (!item.disabled) {
                    e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'none'
                }}
              >
                {item.icon && (
                  <span
                    style={{
                      width: 'var(--icon-size)',
                      textAlign: 'center',
                      flexShrink: 0,
                      lineHeight: 1,
                    }}
                  >
                    {item.icon}
                  </span>
                )}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
