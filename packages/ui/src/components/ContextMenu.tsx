import React, { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
}

export interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onSelect: (id: string) => void
  onClose: () => void
}

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  background: 'var(--bg-primary, #fff)',
  border: '1px solid var(--border-color, #ddd)',
  borderRadius: '6px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  padding: 'var(--spacing-xs, 4px) 0',
  minWidth: '160px',
  zIndex: 1000,
  fontSize: 'var(--font-base, 13px)',
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-sm, 8px)',
  padding: 'var(--spacing-sm, 8px) var(--spacing-md, 12px)',
  cursor: 'pointer',
  border: 'none',
  background: 'none',
  width: '100%',
  textAlign: 'left',
  color: 'var(--text-primary)',
}

const disabledStyle: React.CSSProperties = {
  ...itemStyle,
  opacity: 0.5,
  cursor: 'default',
}

const dangerStyle: React.CSSProperties = {
  ...itemStyle,
  color: 'var(--accent-error, #d32f2f)',
}

const separatorStyle: React.CSSProperties = {
  height: '1px',
  background: 'var(--border-color, #ddd)',
  margin: 'var(--spacing-xs, 4px) 0',
}

export function ContextMenu({ x, y, items, onSelect, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    // Delay to avoid immediate close from the right-click event
    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }, 0)

    return () => {
      clearTimeout(timeout)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Adjust position to stay in viewport
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const menu = menuRef.current

    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 8}px`
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 8}px`
    }
  }, [x, y])

  return (
    <div ref={menuRef} style={{ ...menuStyle, left: x, top: y }}>
      {items.map((item) => {
        if (item.separator) {
          return <div key={item.id} style={separatorStyle} />
        }

        const style = item.disabled ? disabledStyle : item.danger ? dangerStyle : itemStyle

        return (
          <button
            key={item.id}
            style={style}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                onSelect(item.id)
                onClose()
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
              <span style={{ width: '16px', textAlign: 'center', flexShrink: 0, lineHeight: 1 }}>
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
