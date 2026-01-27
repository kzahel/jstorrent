import { useRef, useEffect, useCallback } from 'react'

/** Interface for bitfield - matches engine's BitField.get() signature */
export interface BitFieldLike {
  get(index: number): boolean
}

/**
 * State of each piece for visualization.
 */
export enum PieceState {
  /** Not yet downloaded */
  Missing = 0,
  /** Partially downloaded - has unrequested blocks */
  Partial = 1,
  /** All blocks requested, waiting for data */
  FullyRequested = 2,
  /** All blocks received, awaiting hash verification */
  FullyResponded = 3,
  /** Verified and complete */
  Completed = 4,
}

/** Information about an active piece for visualization */
export interface ActivePieceInfo {
  index: number
  state: PieceState
}

/** Data needed for visualization, read fresh on each frame */
export interface PieceVisualizationData {
  piecesTotal: number
  bitfield?: BitFieldLike
  piecesCompleted: number
  activePieces: ActivePieceInfo[]
}

export type PieceViewMode = 'summary' | 'bar' | 'grid'

export interface PieceVisualizationProps {
  /** Getter function called on each RAF to get fresh data */
  getData: () => PieceVisualizationData | null
  /** View mode: summary (aggregated), bar (individual pieces in row), grid (individual pieces in grid) */
  mode?: PieceViewMode
  /** Height in pixels (for bar modes) */
  height?: number
  /** Max segments for summary bar mode */
  maxSegments?: number
}

/** Color palette for piece states */
const COLORS = {
  missing: '#3a3a3c', // Dark gray
  partial: '#ff9f0a', // Orange - has work to do
  fullyRequested: '#64d2ff', // Light blue - waiting for data
  fullyResponded: '#30d158', // Green - ready for verification
  completed: '#0a84ff', // Blue - verified
}

/**
 * Get minimum cell size based on piece count.
 * Smaller torrents get larger cells for visibility.
 */
function getMinCellSize(piecesTotal: number): number {
  if (piecesTotal <= 50) return 12
  if (piecesTotal <= 200) return 8
  if (piecesTotal <= 1000) return 5
  if (piecesTotal <= 5000) return 3
  return 2
}

/**
 * Calculate grid layout based on container width.
 * Fills width completely and wraps to multiple rows.
 */
function getResponsiveGridConfig(
  piecesTotal: number,
  containerWidth: number,
): { columns: number; cellSize: number; rows: number } {
  if (piecesTotal === 0 || containerWidth === 0) {
    return { columns: 0, cellSize: 0, rows: 0 }
  }

  const minCellSize = getMinCellSize(piecesTotal)
  const gap = 1

  // Calculate max columns that fit with minimum cell size
  const maxColumns = Math.floor(containerWidth / (minCellSize + gap))

  // Use all pieces in one row if they fit, otherwise wrap
  const columns = Math.min(piecesTotal, Math.max(1, maxColumns))
  const cellSize = containerWidth / columns - gap
  const rows = Math.ceil(piecesTotal / columns)

  return { columns, cellSize: Math.max(minCellSize, cellSize), rows }
}

/**
 * Get color for a piece state.
 */
function getStateColor(state: PieceState): string {
  switch (state) {
    case PieceState.Missing:
      return COLORS.missing
    case PieceState.Partial:
      return COLORS.partial
    case PieceState.FullyRequested:
      return COLORS.fullyRequested
    case PieceState.FullyResponded:
      return COLORS.fullyResponded
    case PieceState.Completed:
      return COLORS.completed
  }
}

/**
 * PieceMap - Grid visualization of pieces with RAF-based updates.
 * Responsive: fills container width and wraps to multiple rows.
 */
export function PieceMap({ getData }: PieceVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const getDataRef = useRef(getData)
  const containerWidthRef = useRef(0)
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Update ref in effect to satisfy React lint rules
  useEffect(() => {
    getDataRef.current = getData
  }, [getData])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const data = getDataRef.current()
    if (!data || data.piecesTotal === 0) return

    const { piecesTotal, bitfield, piecesCompleted, activePieces } = data

    // Get container width (use cached value to avoid layout thrashing)
    const containerWidth = containerWidthRef.current || container.clientWidth
    if (containerWidth === 0) return

    const { columns, cellSize, rows } = getResponsiveGridConfig(piecesTotal, containerWidth)
    if (columns === 0) return

    const gap = cellSize > 4 ? 1 : 0.5

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size based on device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1
    const width = containerWidth
    const height = rows * (cellSize + gap)

    // Only resize if dimensions changed
    const targetWidth = Math.round(width * dpr)
    const targetHeight = Math.round(height * dpr)
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth
      canvas.height = targetHeight
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.scale(dpr, dpr)
    } else {
      // Reset transform for redraw
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // Clear canvas
    ctx.clearRect(0, 0, width, height)

    // Build active piece lookup for O(1) access
    const activeLookup = new Map<number, PieceState>()
    for (const piece of activePieces) {
      activeLookup.set(piece.index, piece.state)
    }

    // Draw pieces
    const effectiveCellWidth = containerWidth / columns
    for (let i = 0; i < piecesTotal; i++) {
      const col = i % columns
      const row = Math.floor(i / columns)

      const x = col * effectiveCellWidth + gap
      const y = row * (cellSize + gap) + gap
      const drawWidth = effectiveCellWidth - gap * 2
      const drawHeight = cellSize - gap

      // Determine state
      let state = PieceState.Missing
      if (bitfield?.get(i)) {
        state = PieceState.Completed
      } else if (i < piecesCompleted && !bitfield) {
        // Fallback when no bitfield
        state = PieceState.Completed
      } else {
        const activeState = activeLookup.get(i)
        if (activeState !== undefined) {
          state = activeState
        }
      }

      ctx.fillStyle = getStateColor(state)
      ctx.fillRect(x, y, drawWidth, drawHeight)
    }
  }, [])

  // Debounced resize handler
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateWidth = () => {
      containerWidthRef.current = container.clientWidth
    }

    const handleResize = () => {
      // Debounce resize events
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      resizeTimeoutRef.current = setTimeout(updateWidth, 100)
    }

    // Initial width
    updateWidth()

    // Observe resize
    const observer = new ResizeObserver(handleResize)
    observer.observe(container)

    return () => {
      observer.disconnect()
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const loop = () => {
      if (!mounted) return
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }

    // Start RAF loop
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      mounted = false
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [draw])

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
        }}
      />
    </div>
  )
}

/**
 * PieceSummaryBar - Aggregated progress bar visualization.
 * Coalesces pieces into segments for a compact overview.
 */
export function PieceSummaryBar({
  getData,
  height = 16,
  maxSegments = 200,
}: PieceVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const getDataRef = useRef(getData)

  // Update ref in effect to satisfy React lint rules
  useEffect(() => {
    getDataRef.current = getData
  }, [getData])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const data = getDataRef.current()
    if (!data || data.piecesTotal === 0) return

    const { piecesTotal, bitfield, piecesCompleted, activePieces } = data

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Get actual container width
    const containerWidth = canvas.parentElement?.clientWidth || 400

    // Set canvas size
    const dpr = window.devicePixelRatio || 1
    const targetWidth = containerWidth * dpr
    const targetHeight = height * dpr

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth
      canvas.height = targetHeight
      canvas.style.width = `${containerWidth}px`
      canvas.style.height = `${height}px`
      ctx.scale(dpr, dpr)
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // Clear canvas
    ctx.clearRect(0, 0, containerWidth, height)

    // Build active piece lookup
    const activeLookup = new Map<number, PieceState>()
    for (const piece of activePieces) {
      activeLookup.set(piece.index, piece.state)
    }

    // Calculate segments
    const displaySegments = Math.min(piecesTotal, maxSegments)
    if (displaySegments === 0) return

    const piecesPerSegment = piecesTotal / displaySegments
    const segmentWidth = containerWidth / displaySegments
    const gap = displaySegments <= 50 ? 1 : 0.5

    for (let seg = 0; seg < displaySegments; seg++) {
      const startPiece = Math.floor(seg * piecesPerSegment)
      const endPiece = Math.min(Math.floor((seg + 1) * piecesPerSegment), piecesTotal)
      const segmentSize = endPiece - startPiece

      if (segmentSize === 0) continue

      // Count states in this segment
      const counts = new Map<PieceState, number>()
      for (let i = startPiece; i < endPiece; i++) {
        let state = PieceState.Missing
        if (bitfield?.get(i)) {
          state = PieceState.Completed
        } else if (i < piecesCompleted && !bitfield) {
          state = PieceState.Completed
        } else {
          const activeState = activeLookup.get(i)
          if (activeState !== undefined) {
            state = activeState
          }
        }
        counts.set(state, (counts.get(state) || 0) + 1)
      }

      // Find dominant state
      let dominant = PieceState.Missing
      const priority = [
        PieceState.Completed,
        PieceState.FullyResponded,
        PieceState.FullyRequested,
        PieceState.Partial,
      ]
      for (const state of priority) {
        if ((counts.get(state) || 0) > 0) {
          dominant = state
          break
        }
      }

      // Calculate completion
      const missingCount = counts.get(PieceState.Missing) || 0
      const completion = (segmentSize - missingCount) / segmentSize

      const x = seg * segmentWidth

      // Draw background (missing)
      ctx.fillStyle = COLORS.missing
      ctx.fillRect(x + gap, 0, segmentWidth - gap * 2, height)

      // Draw colored overlay
      if (completion > 0) {
        ctx.globalAlpha = 0.3 + completion * 0.7
        ctx.fillStyle = getStateColor(dominant)
        ctx.fillRect(x + gap, 0, segmentWidth - gap * 2, height)
        ctx.globalAlpha = 1.0
      }
    }
  }, [height, maxSegments])

  useEffect(() => {
    let mounted = true

    const loop = () => {
      if (!mounted) return
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)

    return () => {
      mounted = false
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [draw])

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: '100%',
      }}
    />
  )
}

/**
 * PieceBar - Full bar visualization showing each piece individually.
 */
export function PieceBar({ getData, height = 16 }: PieceVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const getDataRef = useRef(getData)

  // Update ref in effect to satisfy React lint rules
  useEffect(() => {
    getDataRef.current = getData
  }, [getData])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const data = getDataRef.current()
    if (!data || data.piecesTotal === 0) return

    const { piecesTotal, bitfield, piecesCompleted, activePieces } = data

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Get actual container width
    const containerWidth = canvas.parentElement?.clientWidth || 400

    // Set canvas size
    const dpr = window.devicePixelRatio || 1
    const targetWidth = containerWidth * dpr
    const targetHeight = height * dpr

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth
      canvas.height = targetHeight
      canvas.style.width = `${containerWidth}px`
      canvas.style.height = `${height}px`
      ctx.scale(dpr, dpr)
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // Clear canvas
    ctx.clearRect(0, 0, containerWidth, height)

    // Build active piece lookup
    const activeLookup = new Map<number, PieceState>()
    for (const piece of activePieces) {
      activeLookup.set(piece.index, piece.state)
    }

    // Calculate piece width - show each piece individually
    const pieceWidth = containerWidth / piecesTotal
    // Only show gap if pieces are wide enough
    const gap = pieceWidth > 2 ? 0.5 : 0

    for (let i = 0; i < piecesTotal; i++) {
      // Determine state
      let state = PieceState.Missing
      if (bitfield?.get(i)) {
        state = PieceState.Completed
      } else if (i < piecesCompleted && !bitfield) {
        state = PieceState.Completed
      } else {
        const activeState = activeLookup.get(i)
        if (activeState !== undefined) {
          state = activeState
        }
      }

      const x = i * pieceWidth

      ctx.fillStyle = getStateColor(state)
      ctx.fillRect(x + gap, 0, pieceWidth - gap * 2, height)
    }
  }, [height])

  useEffect(() => {
    let mounted = true

    const loop = () => {
      if (!mounted) return
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)

    return () => {
      mounted = false
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [draw])

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: '100%',
      }}
    />
  )
}

/**
 * Legend showing what each color means.
 */
export function PieceLegend() {
  const items = [
    { color: COLORS.completed, label: 'Verified' },
    { color: COLORS.fullyResponded, label: 'Verifying' },
    { color: COLORS.fullyRequested, label: 'Receiving' },
    { color: COLORS.partial, label: 'Requesting' },
    { color: COLORS.missing, label: 'Missing' },
  ]

  return (
    <div
      style={{
        display: 'flex',
        gap: '12px',
        fontSize: '11px',
        color: 'var(--text-secondary)',
      }}
    >
      {items.map(({ color, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div
            style={{
              width: '10px',
              height: '10px',
              backgroundColor: color,
              borderRadius: '2px',
            }}
          />
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Combined visualization component with mode toggle.
 */
export function PieceVisualization(props: PieceVisualizationProps) {
  const { mode = 'summary' } = props

  const renderVisualization = () => {
    switch (mode) {
      case 'grid':
        return <PieceMap {...props} />
      case 'bar':
        return <PieceBar {...props} />
      case 'summary':
      default:
        return <PieceSummaryBar {...props} />
    }
  }

  return (
    <div style={{ padding: '8px', borderBottom: '1px solid var(--border-color)' }}>
      <div style={{ marginBottom: '8px' }}>{renderVisualization()}</div>
      <PieceLegend />
    </div>
  )
}
