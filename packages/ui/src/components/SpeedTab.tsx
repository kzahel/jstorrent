import React, { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { BandwidthTracker, TrafficCategory } from '@jstorrent/engine'
import { ALL_TRAFFIC_CATEGORIES } from '@jstorrent/engine'
import { formatSpeed } from '../utils/format'
import { createThrottledRaf } from '../utils/throttledRaf'
import { getMaxFps } from '../hooks/useAppSettings'

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
  overflow: 'auto',
  height: '100%',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: '12px',
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

const categoryButtonStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: '11px',
  borderRadius: '3px',
  border: '1px solid var(--border-color)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
}

const categoryButtonActiveStyle: React.CSSProperties = {
  ...categoryButtonStyle,
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
}

const breakdownStyle: React.CSSProperties = {
  marginTop: '4px',
  fontSize: '11px',
  color: 'var(--text-secondary)',
  display: 'grid',
  gridTemplateColumns: 'auto 70px 70px',
  gap: '4px 8px',
  width: 'fit-content',
}

/** Display names for traffic categories */
const CATEGORY_LABELS: Record<TrafficCategory, string> = {
  'peer:protocol': 'Peer',
  'peer:payload': 'Payload',
  'tracker:http': 'HTTP Tracker',
  'tracker:udp': 'UDP Tracker',
  dht: 'DHT',
  disk: 'Disk Write',
}

/** Categories to show in the filter (exclude peer:payload as it's a subset) */
const FILTER_CATEGORIES = ALL_TRAFFIC_CATEGORIES.filter((c) => c !== 'peer:payload')

/** Format time as relative seconds ago */
function formatTimeAgo(timestamp: number, now: number): string {
  const secAgo = Math.round((now - timestamp) / 1000)
  if (secAgo <= 0) return 'now'
  return `-${secAgo}s`
}

export function SpeedTab({ bandwidthTracker }: SpeedTabProps) {
  const [windowMs, setWindowMs] = useState<number>(TIME_WINDOWS[0].value)
  const [selectedCategories, setSelectedCategories] = useState<TrafficCategory[] | 'all'>('all')
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)

  const toggleCategory = (cat: TrafficCategory) => {
    if (selectedCategories === 'all') {
      // Switch to showing only the clicked category
      setSelectedCategories([cat])
    } else if (selectedCategories.length === 0) {
      // From empty, select just the clicked category
      setSelectedCategories([cat])
    } else {
      const idx = selectedCategories.indexOf(cat)
      if (idx >= 0) {
        // Remove the category (allow empty selection)
        setSelectedCategories(selectedCategories.filter((c) => c !== cat))
      } else {
        setSelectedCategories([...selectedCategories, cat])
      }
    }
  }

  const isCategoryActive = (cat: TrafficCategory) => {
    return selectedCategories === 'all' || selectedCategories.includes(cat)
  }

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
          value: (_, rawValue) => (rawValue == null ? '--' : formatTimeAgo(rawValue, Date.now())),
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
        {
          label: 'Disk',
          stroke: '#f59e0b', // amber (matches Android)
          width: 2,
          fill: 'rgba(245, 158, 11, 0.1)',
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

    // Initial empty data (time, download, upload, disk)
    const data: uPlot.AlignedData = [[], [], [], []]
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

    // Animation loop (throttled by maxFps setting)
    const update = () => {
      const now = Date.now()
      const fromTime = now - windowMs

      // Get samples with metadata about which tier/bucket size was used
      const downResult = bandwidthTracker.getSamplesWithMeta(
        'down',
        selectedCategories,
        fromTime,
        now,
        300,
      )
      const upResult = bandwidthTracker.getSamplesWithMeta(
        'up',
        selectedCategories,
        fromTime,
        now,
        300,
      )
      // Disk write is always the 'disk' category (not filtered by selected categories)
      const diskResult = bandwidthTracker.getSamplesWithMeta('down', ['disk'], fromTime, now, 300)

      // Use the actual bucket size from the RRD tier that was selected
      const bucketMs = downResult.bucketMs

      // Calculate aligned end time
      const latestBucketTime = downResult.latestBucketTime
      const currentBucketStart = Math.floor(now / bucketMs) * bucketMs
      const gapBuckets = (currentBucketStart - latestBucketTime) / bucketMs

      // Always hide current bucket to prevent flicker from incomplete data
      let alignedEnd: number
      if (gapBuckets <= 1) {
        // Data is flowing - wall clock is 0-1 buckets ahead of RRD
        // Hide the RRD's current (incomplete) bucket to prevent flicker
        alignedEnd = latestBucketTime - bucketMs
      } else {
        // Data stopped flowing - wall clock is way ahead
        // Extend to current time (showing zeros) but hide the current bucket
        alignedEnd = currentBucketStart - bucketMs
      }

      // Create maps for lookup
      const downMap = new Map<number, number>(
        downResult.samples.map((s: { time: number; value: number }) => [s.time, s.value]),
      )
      const upMap = new Map<number, number>(
        upResult.samples.map((s: { time: number; value: number }) => [s.time, s.value]),
      )
      const diskMap = new Map<number, number>(
        diskResult.samples.map((s: { time: number; value: number }) => [s.time, s.value]),
      )

      // Generate a complete time series at fixed intervals
      // This ensures the graph maintains consistent size even when no data is flowing
      const times: number[] = []
      const downRates: number[] = []
      const upRates: number[] = []
      const diskRates: number[] = []

      // Align start time to bucket boundary, skip the first bucket (often incomplete/zero)
      const alignedStart = Math.floor(fromTime / bucketMs) * bucketMs + bucketMs

      for (let t = alignedStart; t <= alignedEnd; t += bucketMs) {
        times.push(t)
        // Look up data, default to 0 if not found
        const downBytes = downMap.get(t) ?? 0
        const upBytes = upMap.get(t) ?? 0
        const diskBytes = diskMap.get(t) ?? 0
        // Convert bucket bytes to bytes/sec
        downRates.push((downBytes / bucketMs) * 1000)
        upRates.push((upBytes / bucketMs) * 1000)
        diskRates.push((diskBytes / bucketMs) * 1000)
      }

      if (plotRef.current && times.length > 0) {
        plotRef.current.setData([times, downRates, upRates, diskRates])
      }
    }

    const throttledRaf = createThrottledRaf(update, getMaxFps)
    throttledRaf.start()

    return () => {
      throttledRaf.stop()
      resizeObserver.disconnect()
      plotRef.current?.destroy()
    }
  }, [bandwidthTracker, windowMs, selectedCategories])

  return (
    <div style={containerStyle}>
      {/* Override uPlot's default colors for dark theme compatibility */}
      <style>{`
        .uplot .u-legend { color: var(--text-primary); }
        .uplot .u-legend .u-series th { color: var(--text-secondary); }
        .uplot .u-legend .u-value { color: var(--text-primary); }
      `}</style>
      <div style={headerStyle}>
        {/* Category filter buttons */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <button
            style={selectedCategories === 'all' ? categoryButtonActiveStyle : categoryButtonStyle}
            onClick={() => setSelectedCategories(selectedCategories === 'all' ? [] : 'all')}
          >
            <span style={{ visibility: selectedCategories === 'all' ? 'visible' : 'hidden' }}>
              ✓
            </span>{' '}
            All
          </button>
          {FILTER_CATEGORIES.map((cat) => (
            <button
              key={cat}
              style={isCategoryActive(cat) ? categoryButtonActiveStyle : categoryButtonStyle}
              onClick={() => toggleCategory(cat)}
            >
              <span style={{ visibility: isCategoryActive(cat) ? 'visible' : 'hidden' }}>✓</span>{' '}
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
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
          {formatSpeed(bandwidthTracker.getRate('down', selectedCategories))}
        </div>
        <div>
          <span style={{ color: '#3b82f6' }}>▲</span> Upload:{' '}
          {formatSpeed(bandwidthTracker.getRate('up', selectedCategories))}
        </div>
        <div>
          <span style={{ color: '#f59e0b' }}>●</span> Disk:{' '}
          {formatSpeed(bandwidthTracker.getCategoryRate('down', 'disk'))}
        </div>
      </div>

      {/* Traffic breakdown - current instantaneous rates */}
      <div
        style={{
          marginTop: '12px',
          fontSize: '11px',
          fontWeight: 500,
          color: 'var(--text-secondary)',
        }}
      >
        Current Rates
      </div>
      <div style={breakdownStyle}>
        <div style={{ fontWeight: 500 }}>Category</div>
        <div style={{ fontWeight: 500 }}>Down</div>
        <div style={{ fontWeight: 500 }}>Up</div>

        <div>Peer data</div>
        <div>{formatSpeed(bandwidthTracker.getCategoryRate('down', 'peer:payload'))}</div>
        <div>{formatSpeed(bandwidthTracker.getCategoryRate('up', 'peer:payload'))}</div>

        <div>Peer overhead</div>
        <div>
          {formatSpeed(
            bandwidthTracker.getCategoryRate('down', 'peer:protocol') -
              bandwidthTracker.getCategoryRate('down', 'peer:payload'),
          )}
        </div>
        <div>
          {formatSpeed(
            bandwidthTracker.getCategoryRate('up', 'peer:protocol') -
              bandwidthTracker.getCategoryRate('up', 'peer:payload'),
          )}
        </div>

        <div>HTTP Tracker</div>
        <div>{formatSpeed(bandwidthTracker.getCategoryRate('down', 'tracker:http'))}</div>
        <div>{formatSpeed(bandwidthTracker.getCategoryRate('up', 'tracker:http'))}</div>

        <div>UDP Tracker</div>
        <div>{formatSpeed(bandwidthTracker.getCategoryRate('down', 'tracker:udp'))}</div>
        <div>{formatSpeed(bandwidthTracker.getCategoryRate('up', 'tracker:udp'))}</div>

        <div>DHT</div>
        <div>{formatSpeed(bandwidthTracker.getCategoryRate('down', 'dht'))}</div>
        <div>{formatSpeed(bandwidthTracker.getCategoryRate('up', 'dht'))}</div>

        <div>Disk Write</div>
        <div>{formatSpeed(bandwidthTracker.getCategoryRate('down', 'disk'))}</div>
        <div>—</div>
      </div>
    </div>
  )
}
