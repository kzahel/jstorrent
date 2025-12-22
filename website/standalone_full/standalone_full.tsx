import { createRoot } from 'react-dom/client'
import { StandaloneFullApp } from './StandaloneFullApp'
import '@jstorrent/ui/styles.css'

function init() {
  const root = createRoot(document.getElementById('root')!)
  root.render(<StandaloneFullApp />)
}

// Start immediately - App will wait for config internally
init()
