import { forwardRef, useEffect } from 'react'

export interface SystemIndicatorProps {
  label: string
  color: 'green' | 'yellow' | 'red'
  pulse: boolean
  onClick: () => void
}

const colorMap = {
  green: {
    bg: 'var(--accent-success, #22c55e)',
    text: 'white',
  },
  yellow: {
    bg: 'var(--accent-warning, #eab308)',
    text: 'black',
  },
  red: {
    bg: 'var(--accent-error, #ef4444)',
    text: 'white',
  },
}

export const SystemIndicator = forwardRef<HTMLButtonElement, SystemIndicatorProps>(
  function SystemIndicator({ label, color, pulse, onClick }, ref) {
    const colors = colorMap[color]

    // Inject keyframes style once
    useEffect(() => {
      const styleId = 'system-indicator-styles'
      if (document.getElementById(styleId)) return

      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
      @keyframes system-indicator-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.8; transform: scale(1.02); }
      }
    `
      document.head.appendChild(style)
    }, [])

    return (
      <button
        ref={ref}
        onClick={onClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          border: 'none',
          borderRadius: '12px',
          background: colors.bg,
          color: colors.text,
          fontSize: '12px',
          fontWeight: 500,
          cursor: 'pointer',
          animation: pulse ? 'system-indicator-pulse 2s ease-in-out infinite' : undefined,
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: colors.text,
            opacity: 0.8,
          }}
        />
        {label}
        <span style={{ opacity: 0.6 }}>&#x25BE;</span>
      </button>
    )
  },
)
