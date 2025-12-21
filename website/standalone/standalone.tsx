import { createRoot } from 'react-dom/client'
import { StandaloneApp } from './App'
import './styles.css'

function init() {
  const root = createRoot(document.getElementById('root')!)
  root.render(<StandaloneApp />)
}

// Start immediately - App will wait for config internally
init()
