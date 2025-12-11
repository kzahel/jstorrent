import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TorrentTable } from './TorrentTable'
import { createMockSource } from '../test/mocks'

/**
 * TorrentTable Integration Tests
 *
 * These tests verify the column management behavior of TorrentTable which uses:
 * - React (TableMount wrapper)
 * - Solid.js (VirtualTable.solid.tsx)
 * - TanStack Virtual (@tanstack/solid-virtual)
 *
 * KNOWN LIMITATION: Virtualized rows don't render in happy-dom because
 * TanStack Virtual requires accurate element dimensions from getScrollElement()
 * to calculate which virtual items are visible. Happy-dom doesn't compute
 * layout/dimensions, so getVirtualItems() returns an empty array.
 *
 * Tests that require row rendering are skipped with explanation.
 * Header-level features (sorting, settings menu) can be tested.
 */

// Helper to wait for Solid to mount
async function waitForTable() {
  await waitFor(() => {
    expect(screen.getByTestId('virtual-table')).toBeInTheDocument()
  })
  // Wait for at least one RAF cycle
  await new Promise((r) => setTimeout(r, 50))
}

describe('TorrentTable', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('rendering', () => {
    it('renders table structure with headers', async () => {
      const source = createMockSource(5)

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as never} />
        </div>,
      )

      await waitForTable()

      // Verify headers are rendered
      expect(screen.getByText('Name')).toBeInTheDocument()
      expect(screen.getByText('Size')).toBeInTheDocument()
      expect(screen.getByText('Done')).toBeInTheDocument()
      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.getByText('Downloaded')).toBeInTheDocument()
      expect(screen.getByText('Uploaded')).toBeInTheDocument()
      expect(screen.getByText('Down Speed')).toBeInTheDocument()
      expect(screen.getByText('Up Speed')).toBeInTheDocument()
      expect(screen.getByText('Peers')).toBeInTheDocument()
    })

    it('renders settings gear button', async () => {
      const source = createMockSource(3)

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as never} />
        </div>,
      )

      await waitForTable()

      expect(screen.getByTitle('Column settings')).toBeInTheDocument()
    })
  })

  describe('sorting', () => {
    it('shows sort indicator after clicking header', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as never} />
        </div>,
      )

      await waitForTable()

      // Click Name header to sort
      await user.click(screen.getByText('Name'))

      // Should show ascending indicator
      await waitFor(() => {
        expect(screen.getByText('\u25B2')).toBeInTheDocument()
      })
    })

    it('toggles sort direction on second click', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as never} />
        </div>,
      )

      await waitForTable()

      // Click Name header twice
      await user.click(screen.getByText('Name'))
      await user.click(screen.getByText('Name'))

      // Should show descending indicator
      await waitFor(() => {
        expect(screen.getByText('\u25BC')).toBeInTheDocument()
      })
    })

    it('persists sort column to localStorage', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as never} />
        </div>,
      )

      await waitForTable()

      // Click Name header to sort
      await user.click(screen.getByText('Name'))

      // Check localStorage
      await waitFor(() => {
        const stored = localStorage.getItem('jstorrent:columns:torrents')
        expect(stored).toBeTruthy()
        const config = JSON.parse(stored!)
        expect(config.sortColumn).toBe('name')
        expect(config.sortDirection).toBe('asc')
      })
    })

    it('restores sort indicator from localStorage on mount', async () => {
      // Pre-set localStorage with Name descending
      localStorage.setItem(
        'jstorrent:columns:torrents',
        JSON.stringify({
          visible: [
            'name',
            'size',
            'progress',
            'status',
            'downloadSpeed',
            'uploadSpeed',
            'peers',
            'seeds',
          ],
          widths: {},
          sortColumn: 'name',
          sortDirection: 'desc',
          liveSort: false,
        }),
      )

      const source = createMockSource(5)

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as never} />
        </div>,
      )

      await waitForTable()

      // Should show descending indicator
      await waitFor(() => {
        expect(screen.getByText('\u25BC')).toBeInTheDocument()
      })
    })
  })

  describe('settings menu', () => {
    it('opens settings menu on gear button click', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as never} />
        </div>,
      )

      await waitForTable()

      // Click gear button
      const gearButton = screen.getByTitle('Column settings')
      await user.click(gearButton)

      // Menu should appear with Live Sort option
      await waitFor(() => {
        expect(screen.getByText('Live Sort')).toBeInTheDocument()
      })
    })

    it('closes settings menu on outside click', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }} data-testid="outside">
          <TorrentTable source={source as never} />
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

    it('shows column names in settings menu', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as never} />
        </div>,
      )

      await waitForTable()

      // Open settings
      await user.click(screen.getByTitle('Column settings'))

      await waitFor(() => {
        // Should show all column names in the menu
        // Note: 'Name' appears twice - once in header and once in menu
        const nameElements = screen.getAllByText('Name')
        expect(nameElements.length).toBeGreaterThanOrEqual(2)
      })
    })

    it('persists column visibility to localStorage', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as never} />
        </div>,
      )

      await waitForTable()

      // Open settings
      await user.click(screen.getByTitle('Column settings'))

      await waitFor(() => {
        expect(screen.getByText('Live Sort')).toBeInTheDocument()
      })

      // Find the Peers checkbox in the menu and uncheck it
      const checkboxes = screen.getAllByRole('checkbox')
      // Find checkbox associated with Peers - it's in a div containing "Peers" text
      const peersCheckbox = checkboxes.find((cb) => {
        const parent = cb.closest('div')
        return parent?.textContent?.includes('Peers')
      })

      expect(peersCheckbox).toBeDefined()
      await user.click(peersCheckbox!)

      // Check localStorage
      await waitFor(() => {
        const stored = localStorage.getItem('jstorrent:columns:torrents')
        expect(stored).toBeTruthy()
        const config = JSON.parse(stored!)
        expect(config.visible).not.toContain('peers')
      })
    })

    it('restores column visibility from localStorage on mount', async () => {
      // Pre-set localStorage with Peers hidden
      localStorage.setItem(
        'jstorrent:columns:torrents',
        JSON.stringify({
          visible: ['name', 'size', 'progress', 'status', 'downloadSpeed', 'uploadSpeed', 'seeds'],
          widths: {},
          sortColumn: null,
          sortDirection: 'asc',
          liveSort: false,
        }),
      )

      const source = createMockSource(3)

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as never} />
        </div>,
      )

      await waitForTable()

      // Peers header should NOT be visible
      const table = screen.getByTestId('virtual-table')
      const headerArea = table.querySelector('[style*="sticky"]')
      expect(headerArea?.textContent).not.toContain('Peers')
    })

    it('toggles live sort via settings menu', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as never} />
        </div>,
      )

      await waitForTable()

      // Open settings
      await user.click(screen.getByTitle('Column settings'))

      await waitFor(() => {
        expect(screen.getByText('Live Sort')).toBeInTheDocument()
      })

      // Find the Live Sort checkbox - it's in a label element
      const liveSortLabel = screen.getByText('Live Sort').closest('label')
      const liveSortCheckbox = liveSortLabel?.querySelector('input[type="checkbox"]')

      expect(liveSortCheckbox).toBeDefined()
      await user.click(liveSortCheckbox!)

      // Check localStorage
      await waitFor(() => {
        const stored = localStorage.getItem('jstorrent:columns:torrents')
        expect(stored).toBeTruthy()
        const config = JSON.parse(stored!)
        expect(config.liveSort).toBe(true)
      })
    })
  })

  describe('header context menu', () => {
    it('opens context menu on header right-click', async () => {
      const source = createMockSource(3)
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable source={source as never} />
        </div>,
      )

      await waitForTable()

      // Right-click on Down Speed header (not Name since it's not hideable)
      const downHeader = screen.getByText('Down Speed')
      await user.pointer({ keys: '[MouseRight]', target: downHeader })

      // Context menu should appear
      await waitFor(() => {
        expect(screen.getByText('Hide Column')).toBeInTheDocument()
        expect(screen.getByText('Table Settings...')).toBeInTheDocument()
      })
    })
  })

  // The following tests are skipped because TanStack Virtual requires
  // accurate element dimensions to render virtual items, which happy-dom
  // doesn't provide. These should be tested via E2E tests (Playwright).

  describe('selection (skipped - requires row rendering)', () => {
    it.skip('calls onSelectionChange with clicked row key', async () => {
      const source = createMockSource(3)
      const onSelectionChange = vi.fn()
      const user = userEvent.setup()

      render(
        <div style={{ height: 400 }}>
          <TorrentTable
            source={source as never}
            getSelectedHashes={() => new Set()}
            onSelectionChange={onSelectionChange}
          />
        </div>,
      )

      await waitForTable()

      const rows = screen.getAllByTestId('table-row')
      await user.click(rows[0])

      expect(onSelectionChange).toHaveBeenCalledWith(new Set([source.torrents[0].infoHashStr]))
    })

    it.skip('preserves selection after sort', async () => {
      // Would need row rendering to verify selection state
    })
  })

  describe('sort order (skipped - requires row rendering)', () => {
    it.skip('sorts rows ascending on first header click', async () => {
      // Would need row rendering to verify sort order
    })

    it.skip('sorts rows descending on second header click', async () => {
      // Would need row rendering to verify sort order
    })
  })
})
