import React, { useEffect, useRef } from 'react'

export interface ConfirmDialogProps {
  title: string
  message: string | React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}

const dialogStyle: React.CSSProperties = {
  background: 'var(--bg-primary, #fff)',
  borderRadius: '8px',
  boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
  padding: '20px',
  minWidth: '320px',
  maxWidth: '480px',
}

const titleStyle: React.CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--text-primary)',
}

const messageStyle: React.CSSProperties = {
  margin: '0 0 20px 0',
  fontSize: '14px',
  color: 'var(--text-secondary, #666)',
  lineHeight: 1.5,
}

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  justifyContent: 'flex-end',
}

const baseButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
  border: 'none',
}

const cancelButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  background: 'var(--bg-secondary, #f0f0f0)',
  color: 'var(--text-primary)',
}

const confirmButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  background: 'var(--accent-primary, #1976d2)',
  color: '#fff',
}

const dangerButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  background: 'var(--accent-error, #d32f2f)',
  color: '#fff',
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  // Click outside to cancel
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onCancel()
  }

  return (
    <div ref={overlayRef} style={overlayStyle} onClick={handleOverlayClick}>
      <div style={dialogStyle}>
        <h3 style={titleStyle}>{title}</h3>
        <div style={messageStyle}>{message}</div>
        <div style={buttonRowStyle}>
          <button style={cancelButtonStyle} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button style={danger ? dangerButtonStyle : confirmButtonStyle} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
