# JSTorrent Resizable Detail Pane

## Overview

Add a draggable resize handle between the torrent table and detail pane. Users can drag to adjust the detail pane height.

**Design:**
- Pill-shaped indicator centered horizontally
- Works with mouse and touch
- Height persisted to sessionStorage (on drag end only)
- Clamped to min/max on render (handles small windows)

---

## Phase 1: Create ResizeHandle Component

### 1.1 Create packages/ui/src/components/ResizeHandle.tsx

```tsx
import React, { useCallback, useRef } from 'react'

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

const pillHoverStyle: React.CSSProperties = {
  ...pillStyle,
  opacity: 0.7,
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

  // Keep ref in sync for use in event handlers
  currentHeightRef.current = currentHeight

  const handleMove = useCallback(
    (clientY: number) => {
      if (!isDraggingRef.current) return

      // Dragging up (negative delta) = larger detail pane
      const delta = startYRef.current - clientY
      const newHeight = clamp(startHeightRef.current + delta, minHeight, maxHeight)
      onResize(newHeight)
      currentHeightRef.current = newHeight
    },
    [onResize, minHeight, maxHeight]
  )

  const handleEnd = useCallback(() => {
    if (!isDraggingRef.current) return

    isDraggingRef.current = false
    onResizeEnd?.(currentHeightRef.current)

    // Reset pill style
    if (pillRef.current) {
      pillRef.current.style.opacity = '0.4'
    }

    // Remove listeners
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    document.removeEventListener('touchmove', handleTouchMove)
    document.removeEventListener('touchend', handleTouchEnd)
    document.removeEventListener('touchcancel', handleTouchEnd)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [onResizeEnd])

  // Mouse handlers
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      e.preventDefault()
      handleMove(e.clientY)
    },
    [handleMove]
  )

  const handleMouseUp = useCallback(() => {
    handleEnd()
  }, [handleEnd])

  // Touch handlers
  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 1) {
        handleMove(e.touches[0].clientY)
      }
    },
    [handleMove]
  )

  const handleTouchEnd = useCallback(() => {
    handleEnd()
  }, [handleEnd])

  // Start drag
  const startDrag = useCallback(
    (clientY: number) => {
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

      // Add listeners to document for drag outside handle
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.addEventListener('touchmove', handleTouchMove, { passive: false })
      document.addEventListener('touchend', handleTouchEnd)
      document.addEventListener('touchcancel', handleTouchEnd)
    },
    [handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startDrag(e.clientY)
    },
    [startDrag]
  )

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        startDrag(e.touches[0].clientY)
      }
    },
    [startDrag]
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
```

---

## Phase 2: Create Height Persistence Hook

### 2.1 Create packages/ui/src/hooks/usePersistedHeight.ts

```tsx
import { useState, useCallback, useLayoutEffect } from 'react'

const STORAGE_KEY = 'jstorrent:detailPaneHeight'
const DEFAULT_HEIGHT = 250

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export interface UsePersistedHeightOptions {
  minHeight?: number
  /** Max height as fraction of window (0-1) */
  maxHeightRatio?: number
  defaultHeight?: number
}

export function usePersistedHeight(options: UsePersistedHeightOptions = {}) {
  const {
    minHeight = 100,
    maxHeightRatio = 0.7,
    defaultHeight = DEFAULT_HEIGHT,
  } = options

  // Calculate max height based on window
  const getMaxHeight = useCallback(() => {
    return Math.floor(window.innerHeight * maxHeightRatio)
  }, [maxHeightRatio])

  // Load initial value from storage, clamped to current window
  const [height, setHeight] = useState(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = parseInt(saved, 10)
        if (!isNaN(parsed)) {
          return clamp(parsed, minHeight, getMaxHeight())
        }
      }
    } catch {
      // Ignore storage errors
    }
    return defaultHeight
  })

  // Re-clamp on window resize
  useLayoutEffect(() => {
    const handleResize = () => {
      const max = getMaxHeight()
      setHeight((h) => clamp(h, minHeight, max))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [minHeight, getMaxHeight])

  // Update height during drag (don't persist yet)
  const updateHeight = useCallback(
    (newHeight: number) => {
      const clamped = clamp(newHeight, minHeight, getMaxHeight())
      setHeight(clamped)
    },
    [minHeight, getMaxHeight]
  )

  // Persist height on drag end
  const persistHeight = useCallback((finalHeight: number) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, String(finalHeight))
    } catch {
      // Ignore storage errors
    }
  }, [])

  return {
    height,
    minHeight,
    maxHeight: getMaxHeight(),
    updateHeight,
    persistHeight,
  }
}
```

---

## Phase 3: Update UI Exports

### 3.1 Update packages/ui/src/index.ts

Add the new exports:

```ts
// Components
export { TorrentItem } from './components/TorrentItem'
export type { TorrentItemProps } from './components/TorrentItem'
export { DetailPane } from './components/DetailPane'
export type { DetailTab, DetailPaneProps } from './components/DetailPane'
export { ContextMenu } from './components/ContextMenu'
export type { ContextMenuItem, ContextMenuProps } from './components/ContextMenu'
export { DropdownMenu } from './components/DropdownMenu'
export type { DropdownMenuProps } from './components/DropdownMenu'
export { ResizeHandle } from './components/ResizeHandle'
export type { ResizeHandleProps } from './components/ResizeHandle'

// Hooks
export { usePersistedHeight } from './hooks/usePersistedHeight'
export type { UsePersistedHeightOptions } from './hooks/usePersistedHeight'

// Tables
export { TorrentTable, torrentColumns } from './tables/TorrentTable'
export { PeerTable } from './tables/PeerTable'
export { PieceTable } from './tables/PieceTable'
export type { PieceInfo } from './tables/PieceTable'
export { TableMount } from './tables/mount'
export type { ColumnDef, ColumnConfig, TableMountProps } from './tables/types'

// Utils
export * from './utils/format'
```

---

## Phase 4: Create hooks directory

### 4.1 Create packages/ui/src/hooks/ directory

```bash
mkdir -p packages/ui/src/hooks
```

Then create the usePersistedHeight.ts file there (from Phase 2).

---

## Phase 5: Update App Layout

### 5.1 Update extension/src/ui/app.tsx

Add the resize handle between the table and detail pane. Find the section that renders the main content area and update it:

**Add import:**
```tsx
import { 
  TorrentTable, 
  DetailPane, 
  ContextMenu, 
  DropdownMenu,
  ResizeHandle,
  usePersistedHeight,
  formatBytes,
  ContextMenuItem 
} from '@jstorrent/ui'
```

**Add hook in AppContent:**
```tsx
function AppContent() {
  // ... existing state ...
  
  const {
    height: detailHeight,
    minHeight,
    maxHeight,
    updateHeight,
    persistHeight,
  } = usePersistedHeight({
    minHeight: 100,
    maxHeightRatio: 0.6,
    defaultHeight: 250,
  })
  
  // ... rest of component
}
```

**Update the main content layout:**

Find this section:
```tsx
{/* Main content */}
<div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
  {/* Torrent table */}
  <div style={{ flex: 1, minHeight: 150, borderBottom: '1px solid var(--border-color)' }}>
    ...
  </div>

  {/* Detail pane */}
  <div style={{ height: 250, minHeight: 100 }}>
    <DetailPane ... />
  </div>
</div>
```

Replace with:
```tsx
{/* Main content */}
<div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
  {/* Torrent table */}
  <div style={{ flex: 1, minHeight: 100, overflow: 'hidden' }}>
    {torrents.length === 0 ? (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        No torrents. Add a magnet link to get started.
      </div>
    ) : (
      <TorrentTable
        source={adapter}
        getSelectedHashes={() => selectedTorrents}
        onSelectionChange={setSelectedTorrents}
        onRowDoubleClick={(torrent: Torrent) => {
          if (torrent.userState === 'stopped') {
            torrent.userStart()
          } else {
            torrent.userStop()
          }
        }}
        onRowContextMenu={handleContextMenu}
      />
    )}
  </div>

  {/* Resize handle */}
  <ResizeHandle
    currentHeight={detailHeight}
    minHeight={minHeight}
    maxHeight={maxHeight}
    onResize={updateHeight}
    onResizeEnd={persistHeight}
  />

  {/* Detail pane */}
  <div style={{ height: detailHeight, flexShrink: 0, overflow: 'hidden' }}>
    <DetailPane source={adapter} selectedHashes={selectedTorrents} />
  </div>
</div>
```

Key changes:
- Removed `borderBottom` from torrent table (handle provides visual separation now)
- Added `overflow: 'hidden'` to both panes
- Added `flexShrink: 0` to detail pane (so it respects the explicit height)
- Inserted `ResizeHandle` between table and detail pane
- Height is now dynamic via `detailHeight`

---

## Phase 6: Verification

```bash
# 1. Start dev server
cd extension && pnpm dev:web

# 2. Manual testing:

# Visual:
# - Pill indicator visible and centered between table and detail pane
# - Cursor changes to ns-resize when hovering handle
# - Pill becomes more visible on hover

# Mouse drag:
# - Click and drag handle up → detail pane gets larger
# - Click and drag handle down → detail pane gets smaller
# - Respects min/max limits
# - Cursor stays ns-resize during drag even if leaving handle
# - Can't select text during drag

# Touch drag:
# - Touch and drag works same as mouse
# - No page scrolling during drag

# Persistence:
# - Resize, refresh page → height restored
# - Resize to 400px on large window
# - Shrink browser window small → height clamps to max
# - Refresh → height still 400px (didn't overwrite preference)
# - Resize browser larger → height goes back to 400px

# Edge cases:
# - Very small window → detail pane shrinks to min
# - Resize window while dragging → still works
```

---

## Checklist

### Phase 1: ResizeHandle
- [ ] Create packages/ui/src/components/ResizeHandle.tsx

### Phase 2: Height Hook
- [ ] Create packages/ui/src/hooks/ directory
- [ ] Create packages/ui/src/hooks/usePersistedHeight.ts

### Phase 3: Exports
- [ ] Update packages/ui/src/index.ts with new exports

### Phase 4: App Integration
- [ ] Add imports for ResizeHandle and usePersistedHeight
- [ ] Add usePersistedHeight hook call
- [ ] Update layout with ResizeHandle between panes
- [ ] Update detail pane to use dynamic height

### Phase 5: Testing
- [ ] Mouse drag works
- [ ] Touch drag works
- [ ] Min/max limits enforced
- [ ] Height persists across refresh
- [ ] Window resize clamps properly
- [ ] Pill hover state works

---

## Future Enhancements

**Double-click to collapse/expand:**
```tsx
onDoubleClick={() => {
  if (height > minHeight) {
    setCollapsedHeight(height)
    updateHeight(minHeight)
  } else if (collapsedHeight) {
    updateHeight(collapsedHeight)
  }
}}
```

**Keyboard accessibility:**
```tsx
tabIndex={0}
onKeyDown={(e) => {
  if (e.key === 'ArrowUp') updateHeight(height + 20)
  if (e.key === 'ArrowDown') updateHeight(height - 20)
}}
```
