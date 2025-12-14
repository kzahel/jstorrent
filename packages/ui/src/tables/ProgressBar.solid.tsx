/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck - Solid JSX is handled by vite-plugin-solid, not tsc
/** @jsxImportSource solid-js */
import type { JSX } from 'solid-js'
import { getProgressBarStyle } from '../hooks/useAppSettings'

export interface ProgressBarProps {
  /** Progress value from 0.0 to 1.0 */
  progress: number
  /** Whether the torrent is actively downloading (unused for now) */
  isActive?: boolean
}

export function ProgressBar(props: ProgressBarProps): JSX.Element {
  const style = getProgressBarStyle()
  const percent = props.progress * 100
  const percentText = percent >= 100 ? '100%' : percent < 0.1 ? '0%' : `${percent.toFixed(1)}%`

  // Text only style
  if (style === 'text') {
    return <span>{percentText}</span>
  }

  // Simple bar with overlaid text
  const barColor = props.progress >= 1 ? 'var(--accent-success)' : 'var(--accent-primary)'

  return (
    <div
      style={{
        width: '100%',
        height: '14px',
        background: 'var(--progress-bg)',
        'border-radius': '2px',
        position: 'relative',
        overflow: 'hidden',
        'pointer-events': 'none',
      }}
    >
      <div
        style={{
          width: `${props.progress * 100}%`,
          height: '100%',
          background: barColor,
          'border-radius': '2px',
          transition: 'width 0.2s ease',
        }}
      />
      <span
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          'font-size': '10px',
          'font-weight': '600',
          color: 'var(--progress-text)',
          'text-shadow': 'var(--progress-text-shadow)',
          'white-space': 'nowrap',
        }}
      >
        {percentText}
      </span>
    </div>
  )
}
