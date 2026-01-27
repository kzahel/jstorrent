import { useState, useCallback, useRef, useEffect } from 'react'
import { Torrent, ActivePiece } from '@jstorrent/engine'
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'
import {
  PieceVisualization,
  PieceState,
  PieceVisualizationData,
  PieceViewMode,
} from '../components/PieceVisualization'

function formatElapsed(timestamp: number): string {
  const elapsed = Date.now() - timestamp
  if (elapsed < 1000) return `${elapsed}ms`
  const tenths = Math.floor(elapsed / 100) / 10
  return `${tenths.toFixed(1)}s`
}

/**
 * Format exclusive peer ID for display.
 * Shows shortened peer ID or empty if no exclusive owner.
 */
function formatExclusivePeer(peer: string | null): string {
  if (!peer) return ''
  // Show first 8 chars of peer ID (or IP:port format)
  if (peer.length > 12) {
    return peer.slice(0, 8) + '...'
  }
  return peer
}

/**
 * Determine piece state from ActivePiece properties.
 */
function getPieceState(piece: ActivePiece): PieceState {
  if (piece.haveAllBlocks) {
    // All blocks received, awaiting verification
    return PieceState.FullyResponded
  }
  if (piece.hasUnrequestedBlocks) {
    // Has blocks that haven't been requested yet
    return PieceState.Partial
  }
  // All blocks requested but not all received
  return PieceState.FullyRequested
}

/**
 * Column definitions for active piece table.
 */
const activePieceColumns: ColumnDef<ActivePiece>[] = [
  {
    id: 'index',
    header: '#',
    getValue: (p) => p.index,
    width: 60,
    align: 'right',
  },
  {
    id: 'size',
    header: 'Size',
    getValue: (p) => formatBytes(p.length),
    width: 80,
    align: 'right',
  },
  {
    id: 'blocksNeeded',
    header: 'Blocks',
    getValue: (p) => p.blocksNeeded,
    width: 60,
    align: 'right',
  },
  {
    id: 'blocksReceived',
    header: 'Recv',
    getValue: (p) => p.blocksReceived,
    width: 60,
    align: 'right',
  },
  {
    id: 'requests',
    header: 'Reqs',
    getValue: (p) => p.outstandingRequests,
    width: 50,
    align: 'right',
  },
  {
    id: 'buffered',
    header: 'Buffered',
    getValue: (p) => formatBytes(p.bufferedBytes),
    width: 80,
    align: 'right',
  },
  {
    id: 'exclusivePeer',
    header: 'Owner',
    getValue: (p) => formatExclusivePeer(p.exclusivePeer),
    getCellTitle: (p) => p.exclusivePeer ?? undefined,
    width: 90,
  },
  {
    id: 'age',
    header: 'Age',
    getValue: (p) => formatElapsed(p.activatedAt),
    width: 60,
    align: 'right',
  },
  {
    id: 'activity',
    header: 'Activity',
    getValue: (p) => formatElapsed(p.lastActivity),
    width: 70,
    align: 'right',
  },
]

/** Source interface for reading torrent data */
interface TorrentSource {
  getTorrent(hash: string): Torrent | undefined
}

export interface PieceTableProps {
  /** Source to read torrent from */
  source: TorrentSource
  /** Hash of the selected torrent */
  torrentHash: string
  /** Get selected row keys (for Solid bridge) */
  getSelectedKeys?: () => Set<string>
  /** Called when selection changes */
  onSelectionChange?: (keys: Set<string>) => void
}

/**
 * Virtualized table showing active pieces being downloaded.
 * Includes a visual piece map showing overall progress and active piece states.
 * Pieces disappear when persisted (hash verified, written to disk).
 */
export function PieceTable(props: PieceTableProps) {
  const [viewMode, setViewMode] = useState<PieceViewMode>('summary')
  const [showVisualization, setShowVisualization] = useState(true)

  // Use refs to always get current values in getters
  const sourceRef = useRef(props.source)
  const hashRef = useRef(props.torrentHash)

  // Update refs in effect to satisfy React lint rules
  useEffect(() => {
    sourceRef.current = props.source
    hashRef.current = props.torrentHash
  }, [props.source, props.torrentHash])

  const getRows = useCallback((): ActivePiece[] => {
    const torrent = sourceRef.current.getTorrent(hashRef.current)
    if (!torrent) return []
    return torrent.getActivePieces()
  }, [])

  // Getter for visualization data - called on each RAF frame
  const getVisualizationData = useCallback((): PieceVisualizationData | null => {
    const torrent = sourceRef.current.getTorrent(hashRef.current)
    if (!torrent || !torrent.hasMetadata) {
      return null
    }

    const activePieces = torrent.getActivePieces()
    return {
      piecesTotal: torrent.piecesCount,
      bitfield: torrent.bitfield,
      piecesCompleted: torrent.completedPiecesCount,
      activePieces: activePieces.map((piece) => ({
        index: piece.index,
        state: getPieceState(piece),
      })),
    }
  }, [])

  // State for header info (updated periodically, not on every RAF)
  const [headerInfo, setHeaderInfo] = useState<{ completed: number; total: number } | null>(null)

  // Update header info periodically (not on every frame)
  useEffect(() => {
    const update = () => {
      const torrent = sourceRef.current.getTorrent(hashRef.current)
      if (torrent && torrent.hasMetadata) {
        setHeaderInfo({
          completed: torrent.completedPiecesCount,
          total: torrent.piecesCount,
        })
      } else {
        setHeaderInfo(null)
      }
    }

    update()
    const interval = setInterval(update, 500) // Update every 500ms
    return () => clearInterval(interval)
  }, [props.torrentHash])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Piece visualization header */}
      {headerInfo && headerInfo.total > 0 && (
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '4px 8px',
              borderBottom: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
            }}
          >
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              {headerInfo.completed} / {headerInfo.total} pieces
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => setShowVisualization(!showVisualization)}
                style={{
                  padding: '2px 8px',
                  fontSize: '11px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '3px',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {showVisualization ? 'Hide' : 'Show'}
              </button>
              {showVisualization && (
                <>
                  <button
                    onClick={() => setViewMode('summary')}
                    style={{
                      padding: '2px 8px',
                      fontSize: '11px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '3px',
                      background: viewMode === 'summary' ? 'var(--accent-primary)' : 'transparent',
                      color: viewMode === 'summary' ? 'white' : 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    Summary
                  </button>
                  <button
                    onClick={() => setViewMode('bar')}
                    style={{
                      padding: '2px 8px',
                      fontSize: '11px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '3px',
                      background: viewMode === 'bar' ? 'var(--accent-primary)' : 'transparent',
                      color: viewMode === 'bar' ? 'white' : 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    Bar
                  </button>
                  <button
                    onClick={() => setViewMode('grid')}
                    style={{
                      padding: '2px 8px',
                      fontSize: '11px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '3px',
                      background: viewMode === 'grid' ? 'var(--accent-primary)' : 'transparent',
                      color: viewMode === 'grid' ? 'white' : 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    Grid
                  </button>
                </>
              )}
            </div>
          </div>
          {showVisualization && (
            <PieceVisualization getData={getVisualizationData} mode={viewMode} />
          )}
        </div>
      )}

      {/* Active pieces table */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TableMount<ActivePiece>
          getRows={getRows}
          getRowKey={(p) => String(p.index)}
          columns={activePieceColumns}
          storageKey="pieces"
          getSelectedKeys={props.getSelectedKeys}
          onSelectionChange={props.onSelectionChange}
          refreshKey={props.torrentHash}
        />
      </div>
    </div>
  )
}
