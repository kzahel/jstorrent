import React, { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { BandwidthTracker } from '@jstorrent/engine'
import { formatSpeed } from '../utils/format'

export interface SpeedTabProps {
  bandwidthTracker: BandwidthTracker
}

/** Time window options in milliseconds */
const TIME_WINDOWS = [
  { label: '30s', value: 30_000 },
  { label: '1m', value: 60_000 },
  { label: '5m', value: 300_000 },
  { label: '10m', value: 600_000 },
] as const

const containerStyle: React.CSSProperties = {
  padding: '8px',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginBottom: '4px',
}

const selectStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: '12px',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '3px',
  cursor: 'pointer',
}

const rateContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '24px',
  marginTop: '8px',
  fontSize: '13px',
}

/** Format time as relative seconds ago */
function formatTimeAgo(timestamp: number, now: number): string {
  const secAgo = Math.round((now - timestamp) / 1000)
  if (secAgo <= 0) return 'now'
  return `-${secAgo}s`
}

export function SpeedTab({ bandwidthTracker }: SpeedTabProps) {
  const [windowMs, setWindowMs] = useState<number>(TIME_WINDOWS[0].value)
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!containerRef.current) return

    // Get theme colors from CSS variables
    const style = getComputedStyle(containerRef.current)
    const textColor = style.getPropertyValue('--text-secondary').trim() || '#888'
    const gridColor = style.getPropertyValue('--border-color').trim() || '#333'

    const opts: uPlot.Options = {
      width: containerRef.current.clientWidth,
      height: 200,
      series: [
        {
          // x-axis (time) - format for legend/cursor
          // Return empty when not hovering (rawValue is null/undefined)
          value: (_, rawValue) =>
            rawValue == null ? '--' : formatTimeAgo(rawValue, Date.now()),
        },
        {
          label: 'Download',
          stroke: '#22c55e', // green
          width: 2,
          fill: 'rgba(34, 197, 94, 0.1)',
          value: (_, rawValue) => (rawValue == null ? '--' : formatSpeed(rawValue)),
        },
        {
          label: 'Upload',
          stroke: '#3b82f6', // blue
          width: 2,
          fill: 'rgba(59, 130, 246, 0.1)',
          value: (_, rawValue) => (rawValue == null ? '--' : formatSpeed(rawValue)),
        },
      ],
      axes: [
        {
          // x-axis: time
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor, width: 1 },
          values: (_, ticks) => ticks.map((t) => formatTimeAgo(t, Date.now())),
        },
        {
          // y-axis: bytes/sec
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor, width: 1 },
          values: (_, ticks) => ticks.map((v) => formatSpeed(v)),
          size: 70,
        },
      ],
      scales: {
        x: { time: false }, // We'll handle time labels ourselves
        y: { min: 0 },
      },
      legend: { show: true },
      cursor: { show: true },
    }

    // Initial empty data
    const data: uPlot.AlignedData = [[], [], []]
    plotRef.current = new uPlot(opts, data, containerRef.current)

    // Handle resize
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry && plotRef.current) {
        plotRef.current.setSize({
          width: entry.contentRect.width,
          height: 200,
        })
      }
    })
    resizeObserver.observe(containerRef.current)

    // Animation loop
    const bucketMs = 100
    // Exclude the most recent ~150ms to avoid jitter from incomplete bucket
    const edgeBufferMs = 150

    const update = () => {
      const now = Date.now()
      // End slightly in the past to avoid incomplete bucket jitter
      const toTime = now - edgeBufferMs
      const fromTime = now - windowMs

      const downSamples = bandwidthTracker.getDownloadSamples(fromTime, toTime, 300)
      const upSamples = bandwidthTracker.getUploadSamples(fromTime, toTime, 300)

      // Create maps for lookup
      const downMap = new Map(downSamples.map((s) => [s.time, s.value]))
      const upMap = new Map(upSamples.map((s) => [s.time, s.value]))

      // Generate a complete time series at fixed intervals
      // This ensures the graph maintains consistent size even when no data is flowing
      const times: number[] = []
      const downRates: number[] = []
      const upRates: number[] = []

      // Align start time to bucket boundary
      const alignedStart = Math.floor(fromTime / bucketMs) * bucketMs
      const alignedEnd = Math.floor(toTime / bucketMs) * bucketMs

      for (let t = alignedStart; t <= alignedEnd; t += bucketMs) {
        times.push(t)
        // Look up data, default to 0 if not found
        const downBytes = downMap.get(t) ?? 0
        const upBytes = upMap.get(t) ?? 0
        // Convert bucket bytes to bytes/sec
        downRates.push((downBytes / bucketMs) * 1000)
        upRates.push((upBytes / bucketMs) * 1000)
      }

      if (plotRef.current && times.length > 0) {
        plotRef.current.setData([times, downRates, upRates])
      }

      rafRef.current = requestAnimationFrame(update)
    }

    rafRef.current = requestAnimationFrame(update)

    return () => {
      cancelAnimationFrame(rafRef.current)
      resizeObserver.disconnect()
      plotRef.current?.destroy()
    }
  }, [bandwidthTracker, windowMs])

  return (
    <div style={containerStyle}>
      {/* Override uPlot's default colors for dark theme compatibility */}
      <style>{`
        .uplot .u-legend { color: var(--text-primary); }
        .uplot .u-legend .u-series th { color: var(--text-secondary); }
        .uplot .u-legend .u-value { color: var(--text-primary); }
      `}</style>
      <div style={headerStyle}>
        <select
          style={selectStyle}
          value={windowMs}
          onChange={(e) => setWindowMs(Number(e.target.value))}
        >
          {TIME_WINDOWS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div ref={containerRef} style={{ width: '100%' }} />
      <div style={rateContainerStyle}>
        <div>
          <span style={{ color: '#22c55e' }}>▼</span> Download:{' '}
          {formatSpeed(bandwidthTracker.getDownloadRate())}
        </div>
        <div>
          <span style={{ color: '#3b82f6' }}>▲</span> Upload:{' '}
          {formatSpeed(bandwidthTracker.getUploadRate())}
        </div>
      </div>
    </div>
  )
}
