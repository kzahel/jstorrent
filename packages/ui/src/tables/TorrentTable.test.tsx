import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TorrentTable } from './TorrentTable'
import { createMockSource } from '../test/mocks'

/**
 * TorrentTable Integration Tests
 *
 * These tests verify the selection behavior of TorrentTable which uses:
 * - React (TableMount wrapper)
 * - Solid.js (VirtualTable.solid.tsx)
 * - TanStack Virtual (@tanstack/solid-virtual)
 *
 * KNOWN LIMITATION: Virtualized rows don't render in happy-dom because
 * TanStack Virtual requires accurate element dimensions from getScrollElement()
 * to calculate which virtual items are visible. Happy-dom doesn't compute
 * layout/dimensions, so getVirtualItems() returns an empty array.
 *
 * TODO: Options to fix this:
 * 1. Use Playwright for E2E testing (recommended for UI interaction tests)
 * 2. Mock TanStack Virtual's getVirtualItems to return all items
 * 3. Use a test environment that supports layout (e.g., Playwright component testing)
 *
 * For now, these tests verify that the table structure renders correctly.
 * Selection behavior should be tested manually or via E2E tests.
 */
describe('TorrentTable', () => {
  it('renders table structure with headers', async () => {
    const source = createMockSource(5)

    render(
      <div style={{ height: 400 }}>
        <TorrentTable source={source as never} />
      </div>,
    )

    // Wait for Solid to mount
    await waitFor(() => {
      expect(screen.getByTestId('virtual-table')).toBeInTheDocument()
    })

    // Verify headers are rendered
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Size')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
  })

  // The following tests are skipped because TanStack Virtual requires
  // accurate element dimensions to render virtual items, which happy-dom
  // doesn't provide. These should be tested via E2E tests (Playwright).

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

    await waitFor(() => {
      expect(screen.getAllByTestId('table-row').length).toBeGreaterThan(0)
    })

    const rows = screen.getAllByTestId('table-row')
    await user.click(rows[0])

    expect(onSelectionChange).toHaveBeenCalledWith(new Set([source.torrents[0].infoHashStr]))
  })

  it.skip('toggles selection with Ctrl+click', async () => {
    const source = createMockSource(3)
    const selected = new Set([source.torrents[0].infoHashStr])
    const onSelectionChange = vi.fn()
    const user = userEvent.setup()

    render(
      <div style={{ height: 400 }}>
        <TorrentTable
          source={source as never}
          getSelectedHashes={() => selected}
          onSelectionChange={onSelectionChange}
        />
      </div>,
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('table-row').length).toBeGreaterThan(0)
    })

    const rows = screen.getAllByTestId('table-row')

    // Ctrl+click second row - should add to selection
    await user.keyboard('[ControlLeft>]')
    await user.click(rows[1])
    await user.keyboard('[/ControlLeft]')

    expect(onSelectionChange).toHaveBeenCalledWith(
      new Set([source.torrents[0].infoHashStr, source.torrents[1].infoHashStr]),
    )
  })

  it.skip('deselects with Ctrl+click on selected row', async () => {
    const source = createMockSource(3)
    const selected = new Set([source.torrents[0].infoHashStr, source.torrents[1].infoHashStr])
    const onSelectionChange = vi.fn()
    const user = userEvent.setup()

    render(
      <div style={{ height: 400 }}>
        <TorrentTable
          source={source as never}
          getSelectedHashes={() => selected}
          onSelectionChange={onSelectionChange}
        />
      </div>,
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('table-row').length).toBeGreaterThan(0)
    })

    const rows = screen.getAllByTestId('table-row')

    // Ctrl+click first row - should remove from selection
    await user.keyboard('[ControlLeft>]')
    await user.click(rows[0])
    await user.keyboard('[/ControlLeft]')

    expect(onSelectionChange).toHaveBeenCalledWith(new Set([source.torrents[1].infoHashStr]))
  })

  it.skip('range selects with Shift+click', async () => {
    const source = createMockSource(5)
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

    await waitFor(() => {
      expect(screen.getAllByTestId('table-row').length).toBeGreaterThan(0)
    })

    const rows = screen.getAllByTestId('table-row')

    // Click first row (sets anchor)
    await user.click(rows[0])
    onSelectionChange.mockClear()

    // Shift+click third row (selects range 0-2)
    await user.keyboard('[ShiftLeft>]')
    await user.click(rows[2])
    await user.keyboard('[/ShiftLeft]')

    expect(onSelectionChange).toHaveBeenCalledWith(
      new Set([
        source.torrents[0].infoHashStr,
        source.torrents[1].infoHashStr,
        source.torrents[2].infoHashStr,
      ]),
    )
  })

  it.skip('shows selected state visually', async () => {
    const source = createMockSource(3)
    const selected = new Set([source.torrents[1].infoHashStr])

    render(
      <div style={{ height: 400 }}>
        <TorrentTable
          source={source as never}
          getSelectedHashes={() => selected}
          onSelectionChange={() => {}}
        />
      </div>,
    )

    await waitFor(() => {
      const rows = screen.getAllByTestId('table-row')
      expect(rows[1]).toHaveAttribute('data-selected', 'true')
      expect(rows[0]).toHaveAttribute('data-selected', 'false')
      expect(rows[2]).toHaveAttribute('data-selected', 'false')
    })
  })
})
