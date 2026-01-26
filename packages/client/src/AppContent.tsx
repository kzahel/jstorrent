/**
 * AppContent - Chrome-free UI component for the main torrent interface.
 *
 * This component can be used in both Chrome extension and standalone contexts.
 * All platform-specific operations (file opening, folder reveal, etc.) are
 * handled via optional callback props.
 */
import React from 'react'
import { useState, useRef, useMemo, useCallback } from 'react'
import { Torrent, generateMagnet } from '@jstorrent/engine'
import {
  TorrentTable,
  DetailPane,
  ContextMenu,
  ConfirmDialog,
  DropdownMenu,
  ResizeHandle,
  usePersistedUIState,
  ContextMenuItem,
} from '@jstorrent/ui'
import { useEngineState } from './hooks/useEngineState'
import { copyTextToClipboard } from './utils/clipboard'
import { standaloneAlert } from './utils/dialogs'
import { UBUNTU_SERVER_MAGNET, BIG_BUCK_BUNNY_MAGNET } from './utils/test-magnets'

interface ContextMenuState {
  x: number
  y: number
  torrent: Torrent
}

export interface FileInfo {
  path: string
}

export interface AppContentProps {
  onOpenLoggingSettings?: () => void
  /** Handler for opening files (platform-specific) */
  onOpenFile?: (torrentHash: string, file: FileInfo) => Promise<void>
  /** Handler for reveal in folder (platform-specific) */
  onRevealInFolder?: (torrentHash: string, file: FileInfo) => Promise<void>
  /** Handler for copying file path (platform-specific) */
  onCopyFilePath?: (torrentHash: string, file: FileInfo) => Promise<void>
  /** Handler for opening torrent folder from context menu (platform-specific) */
  onOpenFolder?: (torrentHash: string) => Promise<void>
  /** Handler for duplicate torrent notification (optional) */
  onDuplicateTorrent?: (torrentName: string) => void
  /** URL for share page (defaults to https://jstorrent.com/share.html) */
  shareUrl?: string
}

export function AppContent({
  onOpenLoggingSettings,
  onOpenFile,
  onRevealInFolder,
  onCopyFilePath,
  onOpenFolder,
  onDuplicateTorrent,
  shareUrl = 'https://jstorrent.com/share.html',
}: AppContentProps) {
  const [magnetInput, setMagnetInput] = useState('')
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set())

  // Selection change handler - refreshKey in detail tables handles immediate updates
  const handleSelectionChange = useCallback((keys: Set<string>) => {
    setSelectedTorrents(keys)
  }, [])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [confirmRemoveAll, setConfirmRemoveAll] = useState<Torrent[] | null>(null)
  const { adapter, torrents, refresh } = useEngineState()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    height: detailHeight,
    minHeight,
    maxHeight,
    updateHeight,
    persistHeight,
    activeTab: detailTab,
    setTab: setDetailTab,
  } = usePersistedUIState({
    minHeight: 100,
    maxHeightRatio: 0.85,
    defaultHeight: 250,
  })

  // Get selected torrent objects
  const selectedTorrentObjects = useMemo(() => {
    return [...selectedTorrents]
      .map((hash) => adapter.getTorrent(hash))
      .filter((t): t is Torrent => t !== undefined)
  }, [selectedTorrents, adapter, torrents])

  // Smart button states - consider error state as "effectively stopped"
  const hasSelection = selectedTorrents.size > 0
  const allEffectivelyStopped =
    hasSelection &&
    selectedTorrentObjects.every((t) => t.userState === 'stopped' || !!t.errorMessage)
  const allActive =
    hasSelection &&
    selectedTorrentObjects.every((t) => t.userState !== 'stopped' && !t.errorMessage)
  const anyChecking =
    hasSelection && selectedTorrentObjects.some((t) => t.activityState === 'checking')

  // --- Action handlers ---

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      const result = await adapter.addTorrent(new Uint8Array(buffer))

      if (result.isDuplicate && result.torrent) {
        onDuplicateTorrent?.(result.torrent.name || 'Torrent')
      }
    } catch (err) {
      console.error('Failed to add torrent file:', err)
    }
    e.target.value = ''
  }

  const handleAddTorrent = async () => {
    if (!magnetInput) {
      fileInputRef.current?.click()
      return
    }
    try {
      const result = await adapter.addTorrent(magnetInput)
      setMagnetInput('')

      if (result.isDuplicate && result.torrent) {
        onDuplicateTorrent?.(result.torrent.name || 'Torrent')
      }
    } catch (e) {
      console.error('Failed to add torrent:', e)
    }
  }

  const handleStartSelected = () => {
    for (const t of selectedTorrentObjects) {
      if (t.userState === 'stopped' || t.activityState === 'error') {
        t.userStart()
      }
    }
    refresh()
  }

  const handleStopSelected = () => {
    for (const t of selectedTorrentObjects) {
      if (t.userState !== 'stopped') {
        t.userStop()
      }
    }
    refresh()
  }

  const handleDeleteSelected = async () => {
    for (const t of selectedTorrentObjects) {
      await adapter.removeTorrent(t)
    }
    setSelectedTorrents(new Set())
  }

  const handleRecheckSelected = async () => {
    for (const t of selectedTorrentObjects) {
      await t.recheckData()
    }
  }

  const handleResetSelected = async () => {
    // Reset torrent state (progress, stats, file priorities) while preserving metadata
    for (const t of selectedTorrentObjects) {
      await adapter.resetTorrent(t)
    }
    setSelectedTorrents(new Set())
  }

  const handleRemoveWithDataRequest = () => {
    if (selectedTorrentObjects.length > 0) {
      setConfirmRemoveAll(selectedTorrentObjects)
    }
  }

  const handleRemoveWithDataConfirm = async () => {
    if (!confirmRemoveAll) return
    const errors: string[] = []
    for (const t of confirmRemoveAll) {
      const result = await adapter.removeTorrentWithData(t)
      errors.push(...result.errors)
    }
    setConfirmRemoveAll(null)
    setSelectedTorrents(new Set())
    if (errors.length > 0) {
      standaloneAlert(
        `Some files could not be deleted:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...and ${errors.length - 5} more` : ''}`,
      )
    }
  }

  const handleCopyMagnet = async () => {
    // Use original magnet URI if available (preserves non-standard query params like x.pe)
    const magnets = selectedTorrentObjects.map(
      (t) =>
        t.magnetLink ??
        generateMagnet({
          infoHash: t.infoHashStr,
          name: t.name,
          announce: t.announce,
        }),
    )
    const text = magnets.join('\n')
    await copyTextToClipboard(text)
  }

  const handleShare = () => {
    if (selectedTorrentObjects.length === 0) return
    // Use original magnet URI if available (preserves non-standard query params like x.pe)
    const t = selectedTorrentObjects[0]
    const magnet =
      t.magnetLink ??
      generateMagnet({
        infoHash: t.infoHashStr,
        name: t.name,
        announce: t.announce,
      })
    window.open(`${shareUrl}#magnet=${encodeURIComponent(magnet)}`, '_blank')
  }

  // --- Menu items ---

  // Using Unicode symbols instead of emoji for consistent baseline alignment
  // In dev mode, selection-based items are disabled when nothing selected,
  // but the menu itself stays enabled for test torrent actions
  const moreMenuItems: ContextMenuItem[] = [
    {
      id: 'recheck',
      label: 'Re-verify Data',
      icon: '⟳',
      disabled: !hasSelection || anyChecking,
    },
    { id: 'reset', label: 'Reset State', icon: '↺', disabled: !hasSelection || anyChecking },
    { id: 'separator1', label: '', separator: true },
    { id: 'copyMagnet', label: 'Copy Magnet Link', icon: '⎘', disabled: !hasSelection },
    { id: 'share', label: 'Share...', icon: '↗', disabled: !hasSelection },
    { id: 'separator2', label: '', separator: true },
    {
      id: 'removeWithData',
      label: 'Remove All Data',
      icon: '⊗',
      danger: true,
      disabled: !hasSelection,
    },
    // Dev-only test torrent actions (always enabled)
    ...(import.meta.env.DEV
      ? [
          { id: 'separatorDev', label: '', separator: true } as ContextMenuItem,
          { id: 'addUbuntu', label: 'Add Ubuntu ISO', icon: '⊕' } as ContextMenuItem,
          { id: 'addBigBuckBunny', label: 'Add Big Buck Bunny', icon: '⊕' } as ContextMenuItem,
        ]
      : []),
  ]

  const contextMenuItems: ContextMenuItem[] = [
    { id: 'start', label: 'Start', icon: '▶', disabled: allActive || anyChecking },
    { id: 'stop', label: 'Stop', icon: '■', disabled: allEffectivelyStopped || anyChecking },
    { id: 'separator1', label: '', separator: true },
    ...(onOpenFolder ? [{ id: 'openFolder', label: 'Open Folder', icon: '📁' }] : []),
    { id: 'recheck', label: 'Re-verify Data', icon: '⟳', disabled: anyChecking },
    { id: 'reset', label: 'Reset State', icon: '↺', disabled: anyChecking },
    { id: 'separator2', label: '', separator: true },
    { id: 'copyMagnet', label: 'Copy Magnet Link', icon: '⎘' },
    { id: 'share', label: 'Share...', icon: '↗' },
    { id: 'separator3', label: '', separator: true },
    { id: 'remove', label: 'Remove', icon: '✕', danger: true },
    { id: 'removeWithData', label: 'Remove All Data', icon: '⊗', danger: true },
  ]

  const handleOpenFolderAction = async () => {
    if (!onOpenFolder) return
    for (const t of selectedTorrentObjects) {
      await onOpenFolder(t.infoHashStr)
    }
  }

  const handleAddTestTorrent = async (magnet: string) => {
    try {
      const result = await adapter.addTorrent(magnet)
      if (result.isDuplicate && result.torrent) {
        onDuplicateTorrent?.(result.torrent.name || 'Torrent')
      }
    } catch (e) {
      console.error('Failed to add test torrent:', e)
    }
  }

  const handleMenuAction = (id: string) => {
    switch (id) {
      case 'start':
        handleStartSelected()
        break
      case 'stop':
        handleStopSelected()
        break
      case 'openFolder':
        handleOpenFolderAction()
        break
      case 'recheck':
        handleRecheckSelected()
        break
      case 'reset':
        handleResetSelected()
        break
      case 'copyMagnet':
        handleCopyMagnet()
        break
      case 'share':
        handleShare()
        break
      case 'remove':
        handleDeleteSelected()
        break
      case 'removeWithData':
        handleRemoveWithDataRequest()
        break
      case 'addUbuntu':
        handleAddTestTorrent(UBUNTU_SERVER_MAGNET)
        break
      case 'addBigBuckBunny':
        handleAddTestTorrent(BIG_BUCK_BUNNY_MAGNET)
        break
    }
  }

  const handleContextMenu = (torrent: Torrent, x: number, y: number) => {
    setContextMenu({ x, y, torrent })
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <>
          {/* Toolbar */}
          <div
            style={{
              padding: 'var(--spacing-xs) var(--spacing-md)',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              gap: 'var(--spacing-xs)',
              alignItems: 'center',
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept=".torrent"
              style={{ display: 'none' }}
            />
            <input
              id="magnet-input"
              type="text"
              value={magnetInput}
              onChange={(e) => setMagnetInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddTorrent()
              }}
              placeholder="Magnet link or URL"
              style={{
                flex: 1,
                padding: '0 var(--spacing-sm)',
                maxWidth: '350px',
                fontSize: 'var(--font-base)',
                height: 'var(--button-height)',
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleAddTorrent}
              style={{
                padding: '0 var(--spacing-sm)',
                cursor: 'pointer',
                fontSize: 'var(--font-base)',
                height: 'var(--button-height)',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              Add
            </button>

            <div
              style={{
                width: '1px',
                height: 'var(--button-height)',
                background: 'var(--border-color)',
              }}
            />

            <button
              onClick={handleStartSelected}
              disabled={!hasSelection || allActive || anyChecking}
              style={{
                padding: '0 var(--spacing-sm)',
                cursor: hasSelection && !allActive && !anyChecking ? 'pointer' : 'default',
                fontSize: 'var(--font-base)',
                height: 'var(--button-height)',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-xs)',
                opacity: !hasSelection || allActive || anyChecking ? 0.5 : 1,
              }}
              title="Start selected"
            >
              <span style={{ lineHeight: 1 }}>▶</span>
              <span>Start</span>
            </button>
            <button
              onClick={handleStopSelected}
              disabled={!hasSelection || allEffectivelyStopped || anyChecking}
              style={{
                padding: '0 var(--spacing-sm)',
                cursor:
                  hasSelection && !allEffectivelyStopped && !anyChecking ? 'pointer' : 'default',
                fontSize: 'var(--font-base)',
                height: 'var(--button-height)',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-xs)',
                opacity: !hasSelection || allEffectivelyStopped || anyChecking ? 0.5 : 1,
              }}
              title="Stop selected"
            >
              <span style={{ lineHeight: 1 }}>■</span>
              <span>Stop</span>
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={!hasSelection}
              style={{
                padding: '0 var(--spacing-sm)',
                cursor: hasSelection ? 'pointer' : 'default',
                fontSize: 'var(--font-base)',
                height: 'var(--button-height)',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-xs)',
                color: 'var(--accent-error)',
                opacity: hasSelection ? 1 : 0.5,
              }}
              title="Remove selected"
            >
              <span style={{ lineHeight: 1 }}>✕</span>
              <span>Remove</span>
            </button>

            <DropdownMenu
              label="More"
              items={moreMenuItems}
              onSelect={handleMenuAction}
              disabled={!hasSelection && !import.meta.env.DEV}
            />
          </div>

          {/* Main content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* Torrent table */}
            <div style={{ flex: 1, minHeight: 100, overflow: 'hidden' }}>
              {torrents.length === 0 ? (
                <div
                  style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}
                >
                  No torrents. Add a magnet link to get started.
                </div>
              ) : (
                <TorrentTable
                  source={adapter}
                  getSelectedHashes={() => selectedTorrents}
                  onSelectionChange={handleSelectionChange}
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
              <DetailPane
                source={adapter}
                selectedHashes={selectedTorrents}
                activeTab={detailTab}
                onTabChange={setDetailTab}
                onOpenFile={
                  onOpenFile
                    ? async (torrentHash, file) => {
                        await onOpenFile(torrentHash, file)
                      }
                    : undefined
                }
                onRevealInFolder={
                  onRevealInFolder
                    ? async (torrentHash, file) => {
                        await onRevealInFolder(torrentHash, file)
                      }
                    : undefined
                }
                onCopyFilePath={
                  onCopyFilePath
                    ? async (torrentHash, file) => {
                        await onCopyFilePath(torrentHash, file)
                      }
                    : undefined
                }
                onSetFilePriority={(torrentHash, fileIndex, priority) => {
                  const torrent = adapter.getTorrent(torrentHash)
                  if (torrent) {
                    torrent.setFilePriority(fileIndex, priority)
                  }
                }}
                onOpenLoggingSettings={onOpenLoggingSettings}
              />
            </div>
          </div>
        </>
      </div>

      {/* Remove All Data confirmation dialog */}
      {confirmRemoveAll && (
        <ConfirmDialog
          title="Remove All Data"
          message={`Permanently delete ${
            confirmRemoveAll.length === 1
              ? `"${confirmRemoveAll[0].name}"`
              : `${confirmRemoveAll.length} torrents`
          } and ALL downloaded files? This cannot be undone.`}
          confirmLabel="Delete Everything"
          danger
          onConfirm={handleRemoveWithDataConfirm}
          onCancel={() => setConfirmRemoveAll(null)}
        />
      )}

      {/* Context menu portal */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onSelect={handleMenuAction}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
