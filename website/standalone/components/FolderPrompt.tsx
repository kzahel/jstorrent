export function FolderPrompt() {
  const openFolderPicker = () => {
    // Trigger SAF picker via internal intent
    window.location.href = 'jstorrent://add-root'
  }

  return (
    <div className="folder-prompt">
      <p>Select a download folder to get started</p>
      <button onClick={openFolderPicker}>Choose Folder</button>
    </div>
  )
}
