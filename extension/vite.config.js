import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import solid from 'vite-plugin-solid'
import { resolve } from 'path'
import dns from 'dns'
import { createRequire } from 'module'

import fs from 'fs'

// Read engine version from package.json
const require = createRequire(import.meta.url)
const enginePkg = require('../packages/engine/package.json')
const JSTORRENT_VERSION = enginePkg.version

// Ensure GeoIP data file exists (copy stub if not)
// This allows builds to succeed without running pnpm update-geoip
const geoipDataPath = resolve(__dirname, '../packages/engine/src/geo/ipv4-country-data.ts')
const geoipStubPath = resolve(__dirname, '../packages/engine/src/geo/ipv4-country-data.stub.ts')
if (!fs.existsSync(geoipDataPath) && fs.existsSync(geoipStubPath)) {
  fs.copyFileSync(geoipStubPath, geoipDataPath)
  console.log('Copied GeoIP stub to ipv4-country-data.ts (run pnpm update-geoip for real data)')
}

// Check if local.jstorrent.com resolves (needed for dev server)
const DEV_HOST = 'local.jstorrent.com'
// Default extension ID from pubkey.txt - can be overridden via VITE_EXTENSION_ID env var
const DEFAULT_EXTENSION_ID = 'dbokmlpefliilbjldladbimlcfgbolhk'
if (process.env.npm_lifecycle_event !== 'build') {
  dns.lookup(DEV_HOST, (err) => {
    if (err && err.code === 'ENOTFOUND') {
      console.log(`
ERROR: Cannot resolve '${DEV_HOST}'

The dev server requires '${DEV_HOST}' to point to localhost.
Add this line to your /etc/hosts file:

  127.0.0.1 ${DEV_HOST}

On Linux/Mac:
  echo "127.0.0.1 ${DEV_HOST}" | sudo tee -a /etc/hosts

On Windows (run as Administrator):
  echo 127.0.0.1 ${DEV_HOST} >> C:\\Windows\\System32\\drivers\\etc\\hosts
`)
      process.exit(1)
    }
  })
}

function sourcemapIgnoreLogger() {
  return {
    name: 'sourcemap-ignore-logger',
    writeBundle(options, bundle) {
      const outDir = options.dir || 'dist'
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && fileName.endsWith('.js')) {
          const mapPath = resolve(outDir, fileName + '.map')
          try {
            const mapContent = fs.readFileSync(mapPath, 'utf-8')
            const map = JSON.parse(mapContent)
            const sources = map.sources || []
            const ignoreList = []
            sources.forEach((source, index) => {
              if (source.includes('node_modules') || source.includes('/logging/')) {
                ignoreList.push(index)
              }
            })
            map.x_google_ignoreList = ignoreList
            fs.writeFileSync(mapPath, JSON.stringify(map))
          } catch (e) {
            // Map file might not exist for some chunks
          }
        }
      }
    },
  }
}

function printDevUrls() {
  return {
    name: 'print-dev-urls',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const extensionId = process.env.DEV_EXTENSION_ID || DEFAULT_EXTENSION_ID
        console.log(`
Development URLs:

  HMR Dev Server (standalone):
    http://${DEV_HOST}:3001/src/ui/app.html

  Chrome Extension UI:
    chrome-extension://${extensionId}/src/ui/app.html

  Website:
    http://${DEV_HOST}:3000/
`)
      })
    },
  }
}

function injectPublicKey() {
  return {
    name: 'inject-public-key',
    generateBundle(options, bundle) {
      try {
        const manifestPath = resolve(__dirname, 'public/manifest.json')
        if (fs.existsSync(manifestPath)) {
          const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
          const manifestJson = JSON.parse(manifestContent)

          // Read PEM public key and extract base64 content (strip headers and whitespace)
          const pemContent = fs.readFileSync(resolve(__dirname, 'fullpubkey.txt'), 'utf-8')
          const base64Key = pemContent
            .replace(/-----BEGIN PUBLIC KEY-----/, '')
            .replace(/-----END PUBLIC KEY-----/, '')
            .replace(/\s/g, '')

          if (base64Key) {
            manifestJson.key = base64Key
            console.log('Injected public key into manifest.json')
          } else {
            console.warn('Could not extract key from fullpubkey.txt')
          }

          this.emitFile({
            type: 'asset',
            fileName: 'manifest.json',
            source: JSON.stringify(manifestJson, null, 2),
          })
        } else {
          console.warn('public/manifest.json not found')
        }
      } catch (e) {
        console.warn('Failed to inject public key:', e.message)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    // Solid plugin MUST come first, only for .solid.tsx files
    solid({
      include: ['**/*.solid.tsx'],
      solid: {
        generate: 'dom',
      },
    }),
    // React plugin for all other .tsx files
    react({
      exclude: ['**/*.solid.tsx'],
    }),
    printDevUrls(),
    // Skip public key injection for CWS builds (set SKIP_INJECT_KEY=1)
    !process.env.SKIP_INJECT_KEY && injectPublicKey(),
    sourcemapIgnoreLogger(),
  ].filter(Boolean),
  define: {
    // Provide default extension ID if not set via env var
    'import.meta.env.DEV_EXTENSION_ID': JSON.stringify(
      process.env.DEV_EXTENSION_ID || DEFAULT_EXTENSION_ID,
    ),
    // Share URL for generating shareable torrent links
    'import.meta.env.SHARE_URL': JSON.stringify(
      process.env.SHARE_URL || `http://${DEV_HOST}:3001/src/ui/share.html`,
    ),
    // JSTorrent version from engine package.json
    'import.meta.env.JSTORRENT_VERSION': JSON.stringify(JSTORRENT_VERSION),
  },
  server: {
    // Dev mode: serve on local.jstorrent.com:3001
    // Requires: 127.0.0.1 local.jstorrent.com in /etc/hosts
    // Port 3001 to avoid conflict with website on 3000
    host: 'local.jstorrent.com',
    port: 3001,
    sourcemapIgnoreList: (relativeSourcePath) => {
      return relativeSourcePath.includes('node_modules') || relativeSourcePath.includes('/logging/')
    },
  },
  resolve: {
    alias: {
      '@jstorrent/engine': resolve(__dirname, '../packages/engine/src/index.ts'),
      '@jstorrent/client': resolve(__dirname, '../packages/client/src/index.ts'),
      '@jstorrent/ui/styles.css': resolve(__dirname, '../packages/ui/src/styles.css'),
      '@jstorrent/ui': resolve(__dirname, '../packages/ui/src/index.ts'),
    },
  },
  build: {
    sourcemap: true,
    minify: false,
    // Note: sourcemapIgnoreList doesn't work in Vite 7, using plugin instead
    sourcemapIgnoreList: false,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'src/ui/app.html'),
        share: resolve(__dirname, 'src/ui/share.html'),
        magnet: resolve(__dirname, 'src/magnet/magnet-handler.html'),
        sw: resolve(__dirname, 'src/sw.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'sw') {
            return 'sw.js'
          }
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
})
