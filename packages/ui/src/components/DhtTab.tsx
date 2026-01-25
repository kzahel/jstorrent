import React, { useState } from 'react'
import { DHTStats, DHTNodeInfo } from '@jstorrent/engine'
import { formatBytes } from '../utils/format'
import { TableMount } from '../tables/mount'
import { ColumnDef } from '../tables/types'

export interface DhtTabProps {
  stats: DHTStats | null
  nodes: DHTNodeInfo[]
}

const containerStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: '12px',
  lineHeight: '1.5',
}

const statsContainerStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid var(--border-color)',
  flex: 1,
  overflow: 'auto',
  minHeight: 0,
}

const groupStyle: React.CSSProperties = {
  marginBottom: '12px',
}

const groupTitleStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  marginBottom: '4px',
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '1px 0',
  gap: '12px',
}

const labelStyle: React.CSSProperties = {
  width: '120px',
  flexShrink: 0,
  color: 'var(--text-secondary)',
}

const valueStyle: React.CSSProperties = {
  flex: 1,
  color: 'var(--text-primary)',
}

const copyButtonStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: '10px',
  marginLeft: '8px',
  cursor: 'pointer',
  background: 'var(--button-bg)',
  border: '1px solid var(--border-color)',
  borderRadius: '3px',
  color: 'var(--text-secondary)',
  flexShrink: 0,
}

const nodeListHeaderStyle: React.CSSProperties = {
  padding: '8px 16px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  borderBottom: '1px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  flexShrink: 0,
}

const toggleButtonStyle: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: '11px',
  cursor: 'pointer',
  background: 'var(--button-bg)',
  border: '1px solid var(--border-color)',
  borderRadius: '3px',
  color: 'var(--text-primary)',
}

const nodeTableContainerStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <button style={copyButtonStyle} onClick={handleCopy} title="Copy to clipboard">
      {copied ? '✓' : 'copy'}
    </button>
  )
}

function formatNodeId(id: Uint8Array): string {
  const hex = Array.from(id)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex.slice(0, 8) + '...' + hex.slice(-8)
}

function formatTime(timestamp: number | undefined): string {
  if (!timestamp) return '-'
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

interface DisplayNode {
  key: string
  id: string
  host: string
  port: number
  lastSeen: number | undefined
}

const nodeColumns: ColumnDef<DisplayNode>[] = [
  {
    id: 'id',
    header: 'Node ID',
    getValue: (n) => n.id,
    width: 180,
  },
  {
    id: 'host',
    header: 'Host',
    getValue: (n) => n.host,
    width: 140,
  },
  {
    id: 'port',
    header: 'Port',
    getValue: (n) => String(n.port),
    width: 60,
  },
  {
    id: 'lastSeen',
    header: 'Last Seen',
    getValue: (n) => formatTime(n.lastSeen),
    width: 100,
  },
]

export function DhtTab({ stats, nodes }: DhtTabProps) {
  const [showNodes, setShowNodes] = useState(false)

  if (!stats) {
    return (
      <div style={{ ...containerStyle, padding: '24px', textAlign: 'center' }}>
        <div style={{ color: 'var(--text-secondary)' }}>DHT is disabled</div>
      </div>
    )
  }

  const displayNodes: DisplayNode[] = nodes.map((n) => ({
    key: `${n.host}:${n.port}`,
    id: formatNodeId(n.id),
    host: n.host,
    port: n.port,
    lastSeen: n.lastSeen,
  }))

  return (
    <div style={containerStyle}>
      <div style={statsContainerStyle}>
        {/* Basic Info */}
        <div style={groupStyle}>
          <div style={groupTitleStyle}>── Status ──</div>
          <div style={rowStyle}>
            <span style={labelStyle}>Status</span>
            <span style={valueStyle}>
              {stats.ready ? (
                <span style={{ color: 'var(--success-color, #4caf50)' }}>Ready</span>
              ) : (
                <span style={{ color: 'var(--warning-color, #ff9800)' }}>Starting</span>
              )}
            </span>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Node ID</span>
            <span style={valueStyle}>
              {stats.nodeId.slice(0, 16)}...
              <CopyButton text={stats.nodeId} />
            </span>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Routing Table</span>
            <span style={valueStyle}>
              {stats.nodeCount} nodes in {stats.bucketCount} buckets
            </span>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Peers Discovered</span>
            <span style={valueStyle}>{stats.peersDiscovered}</span>
          </div>
        </div>

        {/* Traffic */}
        <div style={groupStyle}>
          <div style={groupTitleStyle}>── Traffic ──</div>
          <div style={rowStyle}>
            <span style={labelStyle}>Bytes Sent</span>
            <span style={valueStyle}>{formatBytes(stats.bytesSent)}</span>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Bytes Received</span>
            <span style={valueStyle}>{formatBytes(stats.bytesReceived)}</span>
          </div>
        </div>

        {/* Activity - Sent (success/attempts) */}
        <div style={groupStyle}>
          <div style={groupTitleStyle}>── Queries Sent (ok/total) ──</div>
          <div style={rowStyle}>
            <span style={labelStyle}>ping</span>
            <span style={valueStyle}>
              {stats.pingsSucceeded}/{stats.pingsSent}
            </span>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>find_node</span>
            <span style={valueStyle}>
              {stats.findNodesSucceeded}/{stats.findNodesSent}
            </span>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>get_peers</span>
            <span style={valueStyle}>
              {stats.getPeersSucceeded}/{stats.getPeersSent}
            </span>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>announce_peer</span>
            <span style={valueStyle}>
              {stats.announcesSucceeded}/{stats.announcesSent}
            </span>
          </div>
        </div>

        {/* Activity - Received */}
        <div style={groupStyle}>
          <div style={groupTitleStyle}>── Queries Received ──</div>
          <div style={rowStyle}>
            <span style={labelStyle}>ping</span>
            <span style={valueStyle}>{stats.pingsReceived}</span>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>find_node</span>
            <span style={valueStyle}>{stats.findNodesReceived}</span>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>get_peers</span>
            <span style={valueStyle}>{stats.getPeersReceived}</span>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>announce_peer</span>
            <span style={valueStyle}>{stats.announcesReceived}</span>
          </div>
        </div>
      </div>

      {/* Node List */}
      <div style={nodeListHeaderStyle}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
          NODE LIST ({stats.nodeCount})
        </span>
        <button style={toggleButtonStyle} onClick={() => setShowNodes(!showNodes)}>
          {showNodes ? 'Hide' : 'Show'}
        </button>
      </div>

      {showNodes && (
        <div style={nodeTableContainerStyle}>
          <TableMount<DisplayNode>
            getRows={() => displayNodes}
            getRowKey={(n) => n.key}
            columns={nodeColumns}
            storageKey="dht-nodes"
            rowHeight={24}
          />
        </div>
      )}
    </div>
  )
}
