import React, { useState, useRef, useEffect } from 'react'
import { ContextMenuItem } from './ContextMenu'

export interface DropdownMenuProps {
  label: string
  items: ContextMenuItem[]
  onSelect: (id: string) => void
  disabled?: boolean
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: '13px',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  background: 'var(--button-bg)',
  color: 'var(--button-text)',
}

const menuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: '4px',
  background: 'var(--bg-primary, #fff)',
  border: '1px solid var(--border-color, #ddd)',
  borderRadius: '6px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  padding: '4px 0',
  minWidth: '160px',
  zIndex: 1000,
  fontSize: '13px',
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px',
  cursor: 'pointer',
  border: 'none',
  background: 'none',
  width: '100%',
  textAlign: 'left',
  color: 'var(--text-primary)',
}

const dangerStyle: React.CSSProperties = {
  ...itemStyle,
  color: 'var(--accent-error, #d32f2f)',
}

const separatorStyle: React.CSSProperties = {
  height: '1px',
  background: 'var(--border-color, #ddd)',
  margin: '4px 0',
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
        <span style={{ fontSize: '10px' }}>▼</span>
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
                {item.icon && <span>{item.icon}</span>}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
