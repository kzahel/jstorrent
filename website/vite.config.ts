import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        standalone: resolve(__dirname, 'standalone/standalone.html'),
        standalone_full: resolve(__dirname, 'standalone_full/standalone_full.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@jstorrent/engine': resolve(__dirname, '../packages/engine/src'),
      '@jstorrent/client': resolve(__dirname, '../packages/client/src'),
      '@jstorrent/ui': resolve(__dirname, '../packages/ui/src'),
    },
  },
  server: {
    port: 3000,
    host: true, // Allow external access for Android emulator
    allowedHosts: ['local.jstorrent.com'],
  },
})
