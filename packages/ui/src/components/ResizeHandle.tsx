import React, { useRef, useEffect, useCallback } from 'react'

export interface ResizeHandleProps {
  /** Called continuously during drag with new height */
  onResize: (height: number) => void
  /** Called when drag ends (for persistence) */
  onResizeEnd?: (height: number) => void
  /** Current height (needed to calculate delta) */
  currentHeight: number
  /** Minimum allowed height */
  minHeight?: number
  /** Maximum allowed height */
  maxHeight?: number
}

const containerStyle: React.CSSProperties = {
  height: 12,
  cursor: 'ns-resize',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-secondary, #f5f5f5)',
  borderTop: '1px solid var(--border-color, #ddd)',
  borderBottom: '1px solid var(--border-color, #ddd)',
  userSelect: 'none',
  touchAction: 'none', // Prevent scroll on touch drag
  flexShrink: 0,
}

const pillStyle: React.CSSProperties = {
  width: 36,
  height: 4,
  borderRadius: 2,
  background: 'var(--text-secondary, #999)',
  opacity: 0.4,
  transition: 'opacity 0.15s',
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function ResizeHandle({
  onResize,
  onResizeEnd,
  currentHeight,
  minHeight = 100,
  maxHeight = 600,
}: ResizeHandleProps) {
  const isDraggingRef = useRef(false)
  const startYRef = useRef(0)
  const startHeightRef = useRef(0)
  const currentHeightRef = useRef(currentHeight)
  const pillRef = useRef<HTMLDivElement>(null)

  // Store callbacks in refs to avoid stale closures
  const onResizeRef = useRef(onResize)
  const onResizeEndRef = useRef(onResizeEnd)
  const minHeightRef = useRef(minHeight)
  const maxHeightRef = useRef(maxHeight)

  // Keep refs in sync
  useEffect(() => {
    currentHeightRef.current = currentHeight
    onResizeRef.current = onResize
    onResizeEndRef.current = onResizeEnd
    minHeightRef.current = minHeight
    maxHeightRef.current = maxHeight
  })

  const handleMove = useCallback((clientY: number) => {
    if (!isDraggingRef.current) return

    // Dragging up (negative delta) = larger detail pane
    const delta = startYRef.current - clientY
    const newHeight = clamp(
      startHeightRef.current + delta,
      minHeightRef.current,
      maxHeightRef.current,
    )
    onResizeRef.current(newHeight)
    currentHeightRef.current = newHeight
  }, [])

  const cleanupListeners = useCallback(
    (handlers: { mouseMove: (e: MouseEvent) => void; mouseUp: () => void } | null) => {
      if (handlers) {
        document.removeEventListener('mousemove', handlers.mouseMove)
        document.removeEventListener('mouseup', handlers.mouseUp)
      }
    },
    [],
  )

  const cleanupTouchListeners = useCallback(
    (handlers: { touchMove: (e: TouchEvent) => void; touchEnd: () => void } | null) => {
      if (handlers) {
        document.removeEventListener('touchmove', handlers.touchMove)
        document.removeEventListener('touchend', handlers.touchEnd)
        document.removeEventListener('touchcancel', handlers.touchEnd)
      }
    },
    [],
  )

  const handleEnd = useCallback(() => {
    if (!isDraggingRef.current) return

    isDraggingRef.current = false
    onResizeEndRef.current?.(currentHeightRef.current)

    // Reset pill style
    if (pillRef.current) {
      pillRef.current.style.opacity = '0.4'
    }

    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  const startDrag = useCallback(
    (clientY: number, isTouch: boolean) => {
      isDraggingRef.current = true
      startYRef.current = clientY
      startHeightRef.current = currentHeightRef.current

      // Set pill style
      if (pillRef.current) {
        pillRef.current.style.opacity = '0.7'
      }

      // Prevent text selection and set cursor globally during drag
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'

      if (isTouch) {
        // Create handlers with cleanup references
        const touchMove = (e: TouchEvent) => {
          if (e.touches.length === 1) {
            handleMove(e.touches[0].clientY)
          }
        }
        const touchEnd = () => {
          handleEnd()
          cleanupTouchListeners({ touchMove, touchEnd })
        }

        document.addEventListener('touchmove', touchMove, { passive: false })
        document.addEventListener('touchend', touchEnd)
        document.addEventListener('touchcancel', touchEnd)
      } else {
        // Create handlers with cleanup references
        const mouseMove = (e: MouseEvent) => {
          e.preventDefault()
          handleMove(e.clientY)
        }
        const mouseUp = () => {
          handleEnd()
          cleanupListeners({ mouseMove, mouseUp })
        }

        document.addEventListener('mousemove', mouseMove)
        document.addEventListener('mouseup', mouseUp)
      }
    },
    [handleMove, handleEnd, cleanupListeners, cleanupTouchListeners],
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startDrag(e.clientY, false)
    },
    [startDrag],
  )

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        startDrag(e.touches[0].clientY, true)
      }
    },
    [startDrag],
  )

  return (
    <div
      style={containerStyle}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onMouseEnter={() => {
        if (pillRef.current && !isDraggingRef.current) {
          pillRef.current.style.opacity = '0.7'
        }
      }}
      onMouseLeave={() => {
        if (pillRef.current && !isDraggingRef.current) {
          pillRef.current.style.opacity = '0.4'
        }
      }}
    >
      <div ref={pillRef} style={pillStyle} />
    </div>
  )
}
