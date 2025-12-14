/* eslint-disable @typescript-eslint/ban-ts-comment, react/jsx-key */
// @ts-nocheck - Solid JSX is handled by vite-plugin-solid, not tsc
/** @jsxImportSource solid-js */
import type { JSX } from 'solid-js'
import { getProgressBarStyle } from '../hooks/useAppSettings'

export interface ProgressBarProps {
  /** Progress value from 0.0 to 1.0 */
  progress: number
  /** Whether the torrent is actively downloading (for stripe animation) */
  isActive?: boolean
}

const BASE_BAR_STYLE: JSX.CSSProperties = {
  height: '100%',
  'border-radius': '2px',
  transition: 'width 0.2s ease',
}

const CONTAINER_STYLE: JSX.CSSProperties = {
  width: '100%',
  height: '14px',
  background: 'var(--progress-bg)',
  'border-radius': '2px',
  position: 'relative',
  overflow: 'hidden',
}

const TEXT_OVERLAY_STYLE: JSX.CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  'font-size': '10px',
  'font-weight': '500',
  color: 'var(--text-primary)',
  'text-shadow': '0 0 2px var(--bg-primary)',
  'white-space': 'nowrap',
}

export function ProgressBar(props: ProgressBarProps): JSX.Element {
  const style = getProgressBarStyle()
  const percent = Math.round(props.progress * 100)
  const percentText =
    percent >= 100
      ? '100%'
      : `${props.progress >= 0.001 ? (props.progress * 100).toFixed(1) : '0'}%`
  const widthPct = `${props.progress * 100}%`

  // Text only style
  if (style === 'text') {
    return <span>{percentText}</span>
  }

  const barColor = props.progress >= 1 ? 'var(--accent-success)' : 'var(--accent-primary)'

  // Simple bar
  if (style === 'bar') {
    return (
      <div style={CONTAINER_STYLE}>
        <div
          style={{
            ...BASE_BAR_STYLE,
            width: widthPct,
            background: barColor,
          }}
        />
        <span style={TEXT_OVERLAY_STYLE}>{percentText}</span>
      </div>
    )
  }

  // Gradient bar
  if (style === 'bar-gradient') {
    return (
      <div style={CONTAINER_STYLE}>
        <div
          style={{
            ...BASE_BAR_STYLE,
            width: widthPct,
            background: `linear-gradient(90deg, ${barColor} 0%, color-mix(in srgb, ${barColor} 70%, white) 100%)`,
          }}
        />
        <span style={TEXT_OVERLAY_STYLE}>{percentText}</span>
      </div>
    )
  }

  // Striped bar
  if (style === 'bar-striped') {
    const stripeGradient = `linear-gradient(
      45deg,
      rgba(255,255,255,0.15) 25%,
      transparent 25%,
      transparent 50%,
      rgba(255,255,255,0.15) 50%,
      rgba(255,255,255,0.15) 75%,
      transparent 75%,
      transparent
    )`

    return (
      <div style={CONTAINER_STYLE}>
        <div
          style={{
            ...BASE_BAR_STYLE,
            width: widthPct,
            background: barColor,
            'background-image': stripeGradient,
            'background-size': '16px 16px',
            animation: props.isActive ? 'progress-stripe 1s linear infinite' : 'none',
          }}
        />
        <span style={TEXT_OVERLAY_STYLE}>{percentText}</span>
      </div>
    )
  }

  // Segmented bar
  if (style === 'bar-segmented') {
    const segments = 10
    const filledSegments = Math.floor(props.progress * segments)

    return (
      <div style={CONTAINER_STYLE}>
        <div style={{ display: 'flex', height: '100%', gap: '2px', padding: '2px' }}>
          {Array.from({ length: segments }, (_, i) => (
            <div
              style={{
                flex: 1,
                height: '100%',
                background: i < filledSegments ? barColor : 'transparent',
                'border-radius': '1px',
              }}
            />
          ))}
        </div>
        <span style={TEXT_OVERLAY_STYLE}>{percentText}</span>
      </div>
    )
  }

  // Fallback to text
  return <span>{percentText}</span>
}
