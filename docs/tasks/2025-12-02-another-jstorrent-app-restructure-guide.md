# JSTorrent App Restructuring

## Overview

Move the main App shell from `extension/src/ui/` to `packages/client/` so it can be shared between the Chrome extension and jstorrent.com/app.

**Current structure:**
```
packages/client/src/
  ├── adapters/
  ├── chrome/
  ├── context/
  ├── hooks/
  └── index.ts

extension/src/ui/
  ├── app.tsx          ← Main app (500 lines, needs to move)
  ├── app.html
  ├── components/
  │   └── DownloadRootsManager.tsx  ← Settings component (needs to move)
  ├── styles.css       ← Duplicate of packages/ui/src/styles.css
  ├── share.tsx
  └── share.html
```

**Target structure:**
```
packages/client/src/
  ├── adapters/
  ├── chrome/
  ├── context/
  ├── hooks/
  ├── components/
  │   └── DownloadRootsManager.tsx  ← Moved here
  ├── App.tsx           ← Moved here (exports App and AppContent)
  └── index.ts          ← Exports App

extension/src/ui/
  ├── app.tsx           ← Thin entry: imports App, calls ReactDOM.render
  ├── app.html          ← Imports styles from @jstorrent/ui
  ├── share.tsx
  └── share.html

packages/ui/src/
  └── styles.css        ← Single source of truth for theme
```

---

## Phase 1: Move DownloadRootsManager

### 1.1 Create packages/client/src/components/ directory

```bash
mkdir -p packages/client/src/components
```

### 1.2 Move DownloadRootsManager.tsx

Move `extension/src/ui/components/DownloadRootsManager.tsx` to `packages/client/src/components/DownloadRootsManager.tsx`.

The file should work as-is since it uses `engineManager` which is already in packages/client.

**Verify imports in the file are correct:**
```tsx
import { engineManager, DownloadRoot } from '../chrome/engine-manager'
```

---

## Phase 2: Move App.tsx

### 2.1 Copy extension/src/ui/app.tsx to packages/client/src/App.tsx

### 2.2 Update imports in the new packages/client/src/App.tsx

Change:
```tsx
import { DownloadRootsManager } from './components/DownloadRootsManager'
```

To:
```tsx
import { DownloadRootsManager } from './components/DownloadRootsManager'
```
(This should already be correct after the move)

### 2.3 Remove ReactDOM.render from App.tsx

Remove the last few lines that do the rendering:
```tsx
// REMOVE THESE LINES:
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

Also remove the `ReactDOM` import:
```tsx
// REMOVE:
import ReactDOM from 'react-dom/client'
```

### 2.4 Export App and AppContent

At the end of the file, ensure both are exported:
```tsx
export { App, AppContent }
```

The final structure of App.tsx should be:

```tsx
import React from 'react'
import { useState, useRef, useMemo } from 'react'
import { Torrent, generateMagnet } from '@jstorrent/engine'
import {
  TorrentTable,
  DetailPane,
  ContextMenu,
  DropdownMenu,
  ResizeHandle,
  usePersistedHeight,
  formatBytes,
  ContextMenuItem,
} from '@jstorrent/ui'
import { EngineProvider, useEngineState, engineManager } from './index'
import { DownloadRootsManager } from './components/DownloadRootsManager'

// ... rest of the file (ContextMenuState, AppContent, App) ...

export { App, AppContent }
```

**Note:** The import from `'./index'` may cause circular dependency issues. If so, import directly:
```tsx
import { EngineProvider } from './context/EngineContext'
import { useEngineState } from './hooks/useEngineState'
import { engineManager } from './chrome/engine-manager'
```

---

## Phase 3: Update packages/client exports

### 3.1 Update packages/client/src/index.ts

Add the App export:

```ts
// Adapters
export { DirectEngineAdapter } from './adapters/types'
export type { EngineAdapter } from './adapters/types'

// Chrome extension specific
export { engineManager } from './chrome/engine-manager'
export type { DaemonInfo, DownloadRoot } from './chrome/engine-manager'
export { getBridge } from './chrome/extension-bridge'
export { notificationBridge } from './chrome/notification-bridge'
export type { ProgressStats } from './chrome/notification-bridge'

// React integration
export { EngineProvider, useAdapter, useEngine } from './context/EngineContext'
export type { EngineProviderProps } from './context/EngineContext'
export { useEngineState, useTorrentState } from './hooks/useEngineState'

// App
export { App, AppContent } from './App'

// Components
export { DownloadRootsManager } from './components/DownloadRootsManager'
```

---

## Phase 4: Update extension entry point

### 4.1 Replace extension/src/ui/app.tsx

Replace the entire file with a thin entry point:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from '@jstorrent/client'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

### 4.2 Update extension/src/ui/app.html

Update the CSS import to use the package:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>JSTorrent</title>
    <link rel="stylesheet" href="../../../packages/ui/src/styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./app.tsx"></script>
  </body>
</html>
```

**Note:** The relative path `../../../packages/ui/src/styles.css` works for development. For production builds, Vite will bundle this correctly.

Alternatively, import the CSS in the app.tsx entry point:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from '@jstorrent/client'
import '@jstorrent/ui/styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

For this to work, update `packages/ui/package.json` to export the CSS:
```json
{
  "exports": {
    ".": "./src/index.ts",
    "./styles.css": "./src/styles.css"
  }
}
```

---

## Phase 5: Clean up duplicates

### 5.1 Delete extension/src/ui/styles.css

```bash
rm extension/src/ui/styles.css
```

### 5.2 Delete extension/src/ui/components/ directory

```bash
rm -rf extension/src/ui/components
```

---

## Phase 6: Update packages/ui to export styles

### 6.1 Update packages/ui/package.json

Ensure the CSS is exported:

```json
{
  "name": "@jstorrent/ui",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./styles.css": "./src/styles.css"
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  ...
}
```

---

## Phase 7: Fix any import issues in App.tsx

After moving, the imports in App.tsx need to reference the correct paths.

### 7.1 Final packages/client/src/App.tsx imports

```tsx
import React from 'react'
import { useState, useRef, useMemo } from 'react'
import { Torrent, generateMagnet } from '@jstorrent/engine'
import {
  TorrentTable,
  DetailPane,
  ContextMenu,
  DropdownMenu,
  ResizeHandle,
  usePersistedHeight,
  formatBytes,
  ContextMenuItem,
} from '@jstorrent/ui'
import { EngineProvider } from './context/EngineContext'
import { useEngineState } from './hooks/useEngineState'
import { engineManager } from './chrome/engine-manager'
import { DownloadRootsManager } from './components/DownloadRootsManager'
```

---

## Phase 8: Verification

```bash
# 1. Install dependencies
pnpm install

# 2. Typecheck all packages
pnpm -r typecheck

# 3. Check for circular dependencies
# If you see errors about circular imports, adjust the imports in App.tsx
# to use direct paths instead of re-exporting through index.ts

# 4. Start dev server
cd extension && pnpm dev:web

# 5. Verify app loads at http://local.jstorrent.com:3001/src/ui/app.html

# 6. Verify all functionality:
#    - Add torrent
#    - Start/stop
#    - Selection
#    - Context menu
#    - Detail pane
#    - Settings tab (DownloadRootsManager)
#    - Resize handle
#    - Light/dark mode
```

---

## Checklist

### Phase 1: Move DownloadRootsManager
- [ ] Create packages/client/src/components/ directory
- [ ] Move DownloadRootsManager.tsx to packages/client/src/components/
- [ ] Verify imports are correct

### Phase 2: Move App.tsx
- [ ] Copy app.tsx to packages/client/src/App.tsx
- [ ] Remove ReactDOM.render and ReactDOM import
- [ ] Update imports to use local paths
- [ ] Export App and AppContent

### Phase 3: Update exports
- [ ] Add App, AppContent, DownloadRootsManager to packages/client/src/index.ts

### Phase 4: Update entry point
- [ ] Replace extension/src/ui/app.tsx with thin entry
- [ ] Update app.html or import CSS in entry

### Phase 5: Clean up
- [ ] Delete extension/src/ui/styles.css
- [ ] Delete extension/src/ui/components/

### Phase 6: Export styles
- [ ] Update packages/ui/package.json exports

### Phase 7: Fix imports
- [ ] Ensure all imports in App.tsx resolve correctly

### Phase 8: Verification
- [ ] pnpm install succeeds
- [ ] pnpm -r typecheck passes
- [ ] Dev server starts
- [ ] All features work
- [ ] Both light and dark mode work

---

## File Summary

**Files to create:**
- `packages/client/src/components/DownloadRootsManager.tsx` (moved from extension)
- `packages/client/src/App.tsx` (moved from extension, modified)

**Files to modify:**
- `packages/client/src/index.ts` (add exports)
- `packages/ui/package.json` (add styles.css export)
- `extension/src/ui/app.tsx` (replace with thin entry)
- `extension/src/ui/app.html` (update CSS import)

**Files to delete:**
- `extension/src/ui/styles.css`
- `extension/src/ui/components/DownloadRootsManager.tsx`
- `extension/src/ui/components/` (directory)

---

## Future: Website Integration

Once this restructuring is complete, jstorrent.com/app can use the same pattern:

```tsx
// website/src/app/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from '@jstorrent/client'
import '@jstorrent/ui/styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

The website landing page (`website/src/App.tsx`) remains separate for the marketing/install page.
