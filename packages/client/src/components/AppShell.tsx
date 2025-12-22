import type { ReactNode } from 'react'

interface AppShellProps {
  header: ReactNode
  children: ReactNode
}

/**
 * Outer layout shell for the app.
 * Provides a flex column layout with header slot and content slot.
 */
export function AppShell({ header, children }: AppShellProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: 'sans-serif',
      }}
    >
      {header}
      <div style={{ flex: 1, overflow: 'hidden' }}>{children}</div>
    </div>
  )
}
