import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

import fs from 'fs'

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
  plugins: [react(), injectPublicKey()],
  build: {
    sourcemap: true,
    minify: false,
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
