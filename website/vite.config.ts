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
      },
    },
  },
  resolve: {
    alias: {
      '@jstorrent/engine': resolve(__dirname, '../packages/engine/src'),
    },
  },
  server: {
    port: 3000,
    host: true, // Allow external access for Android emulator
    allowedHosts: ['local.jstorrent.com'],
  },
})
