import React from 'react'
import ReactDOM from 'react-dom/client'

export const App = () => {
  return (
    <div>
      <h1>JSTorrent Extension</h1>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
