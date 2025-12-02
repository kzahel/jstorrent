# JSTorrent Column Management - RTL Tests

## Overview

RTL tests for VirtualTable column management features. These tests interact with the DOM regardless of whether React or Solid rendered it.

**Scope:**
- Sorting (click to sort, direction toggle, indicator)
- Column visibility (hide/show via settings menu)
- Selection survives sort
- Settings menu interactions

**Out of scope (harder to test reliably):**
- Live sort (timing dependent, needs fake timers + RAF mocking)
- Column resize (drag simulation is finicky)
- Column reorder via drag

---

## Setup

### Install dependencies (if not present)

```bash
cd packages/ui
pnpm add -D vitest @testing-library/react @testing-library/user-event happy-dom
```

### packages/ui/vitest.config.ts

```ts
import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    conditions: ['development', 'browser'],
  },
})
```

### packages/ui/src/test/setup.ts

```ts
import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

expect.extend(matchers)

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

// Mock RAF for consistent timing
let rafId = 0
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  rafId++
  setTimeout(() => cb(performance.now()), 16)
  return rafId
})

vi.stubGlobal('cancelAnimationFrame', (id: number) => {
  // No-op for tests
})
```

### packages/ui/src/test/mocks.ts

```ts
/**
 * Mock torrent for testing
 */
export interface MockTorrent {
  infoHashStr: string
  name: string
  progress: number
  activityState: string
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  contentStorage?: { getTotalSize: () => number }
}

export function createMockTorrent(
  id: number,
  overrides: Partial<MockTorrent> = {},
): MockTorrent {
  const hash = id.toString(16).padStart(40, '0')
  return {
    infoHashStr: hash,
    name: `Torrent ${String.fromCharCode(65 + id)}`, // A, B, C, D, ...
    progress: 0.5,
    activityState: 'downloading',
    downloadSpeed: (10 - id) * 1000, // Descending: 10000, 9000, 8000...
    uploadSpeed: id * 100,
    numPeers: id,
    contentStorage: { getTotalSize: () => 1024 * 1024 * 100 },
    ...overrides,
  }
}

export function createMockTorrents(count: number): MockTorrent[] {
  return Array.from({ length: count }, (_, i) => createMockTorrent(i))
}

export interface MockSource {
  torrents: MockTorrent[]
  getTorrent: (hash: string) => MockTorrent | undefined
}

export function createMockSource(count: number): MockSource {
  const torrents = createMockTorrents(count)
  return {
    torrents,
    getTorrent: (hash: string) => torrents.find((t) => t.infoHashStr === hash),
  }
}
```

---

## Test File

### packages/ui/src/tables/VirtualTable.test.tsx

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TorrentTable } from './TorrentTable'
import { createMockSource } from '../test/mocks'

// Helper to wait for Solid to mount and RAF to tick
async function waitForTable() {
  await waitFor(() => {
    expect(screen.getByTestId('virtual-table')).toBeInTheDocument()
  })
  // Wait for at least one RAF cycle
  await new Promise((r) => setTimeout(r, 50))
}

// Helper to get row keys in display order
function getRowKeys(): string[] {
  const rows = screen.getAllByTestId('table-row')
  return rows.map((r) => r.getAttribute('data-row-key') ?? '')
}

// Helper to get header text content
function getHeaderTexts(): string[] {
  const headers = screen.getAllByRole('columnheader')
  // Fallback: find header cells by structure if no role
  if (headers.length === 0) {
    const headerRow = screen.getByTestId('virtual-table').querySelector('[style*="sticky"]')
    if (headerRow) {
      return Array.from(headerRow.querySelectorAll('div > span')).map(
        (el) => el.textContent ?? '',
      )
    }
  }
  return headers.map((h) => h.textContent ?? '')
}

describe('VirtualTable', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  describe('rendering', () => {
    it('renders rows for each item', async () => {
      const source = createMockSource(5)

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      const rows = screen.getAllByTestId('table-row')
      expect(rows.length).toBe(5)
    })

    it('renders column headers', async () => {
      const source = createMockSource(3)

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Check for expected headers
      expect(screen.getByText('Name')).toBeInTheDocument()
      expect(screen.getByText('Size')).toBeInTheDocument()
      expect(screen.getByText('Done')).toBeInTheDocument()
    })
  })

  describe('sorting', () => {
    it('sorts ascending on first header click', async () => {
      const source = createMockSource(5)
      // Names are: Torrent A, B, C, D, E (already sorted by name)
      // Download speeds are: 10000, 9000, 8000, 7000, 6000 (descending)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Initial order (unsorted, source order)
      const initialKeys = getRowKeys()
      expect(initialKeys).toEqual(source.torrents.map((t) => t.infoHashStr))

      // Click Name header to sort ascending
      await user.click(screen.getByText('Name'))
      await waitFor(() => {
        const keys = getRowKeys()
        // Should be sorted A, B, C, D, E (which is same as initial for these mocks)
        expect(keys[0]).toBe(source.torrents[0].infoHashStr)
      })
    })

    it('sorts descending on second header click', async () => {
      const source = createMockSource(5)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Click Name header twice
      await user.click(screen.getByText('Name'))
      await user.click(screen.getByText('Name'))

      await waitFor(() => {
        const keys = getRowKeys()
        // Should be sorted E, D, C, B, A (reverse)
        expect(keys[0]).toBe(source.torrents[4].infoHashStr)
        expect(keys[4]).toBe(source.torrents[0].infoHashStr)
      })
    })

    it('shows sort indicator on sorted column', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Click Name header
      await user.click(screen.getByText('Name'))

      // Should show ascending indicator
      await waitFor(() => {
        expect(screen.getByText('▲')).toBeInTheDocument()
      })

      // Click again for descending
      await user.click(screen.getByText('Name'))

      await waitFor(() => {
        expect(screen.getByText('▼')).toBeInTheDocument()
      })
    })

    it('sorts by different column when clicking new header', async () => {
      const source = createMockSource(5)
      // Download speeds: 10000, 9000, 8000, 7000, 6000
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Click Down header to sort by download speed
      await user.click(screen.getByText('Down'))

      await waitFor(() => {
        const keys = getRowKeys()
        // Ascending by speed: 6000 (E), 7000 (D), 8000 (C), 9000 (B), 10000 (A)
        expect(keys[0]).toBe(source.torrents[4].infoHashStr) // Torrent E (lowest speed)
        expect(keys[4]).toBe(source.torrents[0].infoHashStr) // Torrent A (highest speed)
      })
    })
  })

  describe('selection', () => {
    it('preserves selection after sort', async () => {
      const source = createMockSource(5)
      const onSelectionChange = vi.fn()
      const selectedSet = new Set([source.torrents[2].infoHashStr]) // Select Torrent C
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable
            source={source as any}
            getSelectedHashes={() => selectedSet}
            onSelectionChange={onSelectionChange}
          />
        </div>,
      )

      await waitForTable()

      // Verify initial selection
      await waitFor(() => {
        const rows = screen.getAllByTestId('table-row')
        const selectedRow = rows.find(
          (r) => r.getAttribute('data-row-key') === source.torrents[2].infoHashStr,
        )
        expect(selectedRow?.getAttribute('data-selected')).toBe('true')
      })

      // Sort by a different column
      await user.click(screen.getByText('Down'))

      // Selection should still be on Torrent C (same key)
      await waitFor(() => {
        const rows = screen.getAllByTestId('table-row')
        const selectedRow = rows.find(
          (r) => r.getAttribute('data-row-key') === source.torrents[2].infoHashStr,
        )
        expect(selectedRow?.getAttribute('data-selected')).toBe('true')
      })
    })
  })

  describe('settings menu', () => {
    it('opens settings menu on gear button click', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Click gear button
      const gearButton = screen.getByTitle('Column settings')
      await user.click(gearButton)

      // Menu should appear with column names
      await waitFor(() => {
        expect(screen.getByText('Live Sort')).toBeInTheDocument()
      })
    })

    it('closes settings menu on outside click', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }} data-testid="outside">
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Open menu
      const gearButton = screen.getByTitle('Column settings')
      await user.click(gearButton)

      await waitFor(() => {
        expect(screen.getByText('Live Sort')).toBeInTheDocument()
      })

      // Click outside
      await user.click(screen.getByTestId('outside'))

      // Menu should close
      await waitFor(() => {
        expect(screen.queryByText('Live Sort')).not.toBeInTheDocument()
      })
    })

    it('hides column when unchecked in settings', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Verify Peers column is visible
      expect(screen.getByText('Peers')).toBeInTheDocument()

      // Open settings
      await user.click(screen.getByTitle('Column settings'))

      await waitFor(() => {
        expect(screen.getByText('Live Sort')).toBeInTheDocument()
      })

      // Find the Peers checkbox in the menu and uncheck it
      // The menu contains column names as clickable spans and checkboxes
      const peersCheckbox = screen.getAllByRole('checkbox').find((cb) => {
        const parent = cb.closest('div')
        return parent?.textContent?.includes('Peers')
      })

      expect(peersCheckbox).toBeDefined()
      await user.click(peersCheckbox!)

      // Close menu by clicking outside
      await user.click(document.body)

      // Peers header should be gone
      await waitFor(() => {
        // There should still be a "Peers" in the settings menu items data,
        // but not as a visible column header. Check the header row specifically.
        const table = screen.getByTestId('virtual-table')
        const headerArea = table.querySelector('[style*="sticky"]')
        expect(headerArea?.textContent).not.toContain('Peers')
      })
    })

    it('shows hidden column when checked in settings', async () => {
      // Pre-set sessionStorage to have Peers hidden
      sessionStorage.setItem(
        'jstorrent:columns:torrents',
        JSON.stringify({
          visible: ['name', 'size', 'progress', 'status', 'downloadSpeed', 'uploadSpeed'],
          widths: {},
          sortColumn: null,
          sortDirection: 'asc',
          liveSort: false,
        }),
      )

      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Verify Peers column is NOT visible initially
      const table = screen.getByTestId('virtual-table')
      const headerArea = table.querySelector('[style*="sticky"]')
      expect(headerArea?.textContent).not.toContain('Peers')

      // Open settings and check Peers
      await user.click(screen.getByTitle('Column settings'))

      await waitFor(() => {
        expect(screen.getByText('Live Sort')).toBeInTheDocument()
      })

      const peersCheckbox = screen.getAllByRole('checkbox').find((cb) => {
        const parent = cb.closest('div')
        return parent?.textContent?.includes('Peers')
      })

      await user.click(peersCheckbox!)

      // Close menu
      await user.click(document.body)

      // Peers header should now be visible
      await waitFor(() => {
        expect(screen.getByText('Peers')).toBeInTheDocument()
      })
    })
  })

  describe('header context menu', () => {
    it('opens context menu on header right-click', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Right-click on Name header
      const nameHeader = screen.getByText('Name')
      await user.pointer({ keys: '[MouseRight]', target: nameHeader })

      // Context menu should appear
      await waitFor(() => {
        expect(screen.getByText('Hide Column')).toBeInTheDocument()
        expect(screen.getByText('Column Settings...')).toBeInTheDocument()
      })
    })

    it('hides column via context menu', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Right-click on Peers header
      const peersHeader = screen.getByText('Peers')
      await user.pointer({ keys: '[MouseRight]', target: peersHeader })

      await waitFor(() => {
        expect(screen.getByText('Hide Column')).toBeInTheDocument()
      })

      // Click Hide Column
      await user.click(screen.getByText('Hide Column'))

      // Peers header should be gone
      await waitFor(() => {
        const table = screen.getByTestId('virtual-table')
        const headerArea = table.querySelector('[style*="sticky"]')
        expect(headerArea?.textContent).not.toContain('Peers')
      })
    })
  })

  describe('persistence', () => {
    it('persists sort column to sessionStorage', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Click Name header to sort
      await user.click(screen.getByText('Name'))

      // Check sessionStorage
      await waitFor(() => {
        const stored = sessionStorage.getItem('jstorrent:columns:torrents')
        expect(stored).toBeTruthy()
        const config = JSON.parse(stored!)
        expect(config.sortColumn).toBe('name')
        expect(config.sortDirection).toBe('asc')
      })
    })

    it('persists column visibility to sessionStorage', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Open settings and hide Peers
      await user.click(screen.getByTitle('Column settings'))

      await waitFor(() => {
        expect(screen.getByText('Live Sort')).toBeInTheDocument()
      })

      const peersCheckbox = screen.getAllByRole('checkbox').find((cb) => {
        const parent = cb.closest('div')
        return parent?.textContent?.includes('Peers')
      })

      await user.click(peersCheckbox!)

      // Check sessionStorage
      await waitFor(() => {
        const stored = sessionStorage.getItem('jstorrent:columns:torrents')
        expect(stored).toBeTruthy()
        const config = JSON.parse(stored!)
        expect(config.visible).not.toContain('peers')
      })
    })

    it('restores sort from sessionStorage on mount', async () => {
      // Pre-set sessionStorage with Name descending
      sessionStorage.setItem(
        'jstorrent:columns:torrents',
        JSON.stringify({
          visible: ['name', 'size', 'progress', 'status', 'downloadSpeed', 'uploadSpeed', 'peers'],
          widths: {},
          sortColumn: 'name',
          sortDirection: 'desc',
          liveSort: false,
        }),
      )

      const source = createMockSource(5)

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as any} />
        </div>,
      )

      await waitForTable()

      // Should show descending indicator
      await waitFor(() => {
        expect(screen.getByText('▼')).toBeInTheDocument()
      })

      // Rows should be in descending order by name
      await waitFor(() => {
        const keys = getRowKeys()
        expect(keys[0]).toBe(source.torrents[4].infoHashStr) // Torrent E
        expect(keys[4]).toBe(source.torrents[0].infoHashStr) // Torrent A
      })
    })
  })
})
```

---

## Running Tests

```bash
cd packages/ui

# Run all tests
pnpm test

# Run with watch mode
pnpm test:watch

# Run specific test file
pnpm test VirtualTable.test.tsx

# Run with verbose output
pnpm test -- --reporter=verbose
```

---

## Checklist

### Setup
- [ ] Install vitest, @testing-library/react, @testing-library/user-event, happy-dom
- [ ] Create vitest.config.ts with solid plugin
- [ ] Create src/test/setup.ts with matchers and RAF mock
- [ ] Create src/test/mocks.ts with mock data utilities

### Tests
- [ ] Rendering: rows and headers appear
- [ ] Sort ascending on first click
- [ ] Sort descending on second click
- [ ] Sort indicator shows correctly
- [ ] Sort by different column
- [ ] Selection preserved after sort
- [ ] Settings menu opens on gear click
- [ ] Settings menu closes on outside click
- [ ] Hide column via settings checkbox
- [ ] Show hidden column via settings
- [ ] Header context menu opens on right-click
- [ ] Hide column via context menu
- [ ] Sort persists to sessionStorage
- [ ] Column visibility persists to sessionStorage
- [ ] Sort restored from sessionStorage on mount

---

## Troubleshooting

**Tests fail with "Cannot find module 'solid-js'":**
Make sure vitest.config.ts includes the solid plugin and resolve conditions:
```ts
plugins: [solid()],
resolve: {
  conditions: ['development', 'browser'],
},
```

**RAF-dependent tests are flaky:**
Increase the wait time after `waitForTable()` or use `vi.useFakeTimers()` with manual advancing.

**sessionStorage tests interfere with each other:**
The `afterEach` hook should clear sessionStorage. If not, add `sessionStorage.clear()` to `beforeEach` in your test file.

**Right-click doesn't trigger context menu:**
Use `userEvent.pointer({ keys: '[MouseRight]', target: element })` instead of `fireEvent.contextMenu()`.
