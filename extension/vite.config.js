import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import dns from 'dns'

import fs from 'fs'

// Check if local.jstorrent.com resolves (needed for dev server)
const DEV_HOST = 'local.jstorrent.com'
if (process.env.npm_lifecycle_event !== 'build') {
  dns.lookup(DEV_HOST, (err) => {
    if (err && err.code === 'ENOTFOUND') {
      console.error(`
\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m
\x1b[31m  ERROR: Cannot resolve '${DEV_HOST}'\x1b[0m

  The dev server requires '${DEV_HOST}' to point to localhost.

  \x1b[33mTo fix, add this line to your /etc/hosts file:\x1b[0m

    127.0.0.1 ${DEV_HOST}

  \x1b[36mOn Linux/Mac:\x1b[0m
    echo "127.0.0.1 ${DEV_HOST}" | sudo tee -a /etc/hosts

  \x1b[36mOn Windows (run as Administrator):\x1b[0m
    echo 127.0.0.1 ${DEV_HOST} >> C:\\Windows\\System32\\drivers\\etc\\hosts

\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m
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

function injectPublicKey() {
  return {
    name: 'inject-public-key',
    generateBundle(options, bundle) {
      try {
        const manifestPath = resolve(__dirname, 'public/manifest.json')
        if (fs.existsSync(manifestPath)) {
          const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
          const manifestJson = JSON.parse(manifestContent)

          const pubKeyContent = fs.readFileSync(resolve(__dirname, 'pubkey.txt'), 'utf-8')
          const match = pubKeyContent.match(/"key"\s*:\s*"([^"]+)"/)

          if (match && match[1]) {
            manifestJson.key = match[1]
            console.log('Injected public key into manifest.json')
          } else {
            console.warn('Could not find key in pubkey.txt')
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
  plugins: [react(), injectPublicKey(), sourcemapIgnoreLogger()],
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
