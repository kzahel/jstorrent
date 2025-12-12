import React, { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { BandwidthTracker } from '@jstorrent/engine'
import { formatSpeed } from '../utils/format'

export interface SpeedTabProps {
  bandwidthTracker: BandwidthTracker
  /** Visible time window in milliseconds */
  windowMs?: number
}

const containerStyle: React.CSSProperties = {
  padding: '8px',
}

const rateContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '24px',
  marginTop: '8px',
  fontSize: '13px',
}

export function SpeedTab({ bandwidthTracker, windowMs = 30_000 }: SpeedTabProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!containerRef.current) return

    const opts: uPlot.Options = {
      width: containerRef.current.clientWidth,
      height: 200,
      series: [
        {}, // x-axis (time)
        {
          label: 'Download',
          stroke: '#22c55e', // green
          width: 2,
          fill: 'rgba(34, 197, 94, 0.1)',
        },
        {
          label: 'Upload',
          stroke: '#3b82f6', // blue
          width: 2,
          fill: 'rgba(59, 130, 246, 0.1)',
        },
      ],
      axes: [
        {
          // x-axis: time
          values: (_, ticks) =>
            ticks.map((t) => {
              const secAgo = Math.round((Date.now() - t) / 1000)
              return secAgo === 0 ? 'now' : `-${secAgo}s`
            }),
        },
        {
          // y-axis: bytes/sec
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
