import { useState } from 'react'

interface AddTorrentDialogProps {
  onAdd: (magnet: string) => void
  onClose: () => void
}

export function AddTorrentDialog({ onAdd, onClose }: AddTorrentDialogProps) {
  const [magnet, setMagnet] = useState('')

  const handleSubmit = () => {
    const trimmed = magnet.trim()
    if (trimmed.startsWith('magnet:')) {
      onAdd(trimmed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Add Torrent</h2>
        <input
          type="text"
          placeholder="Paste magnet link..."
          value={magnet}
          onChange={(e) => setMagnet(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <div className="dialog-actions">
          <button className="btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={!magnet.trim().startsWith('magnet:')}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
