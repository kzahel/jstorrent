import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    minify: false,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'src/ui/app.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
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
