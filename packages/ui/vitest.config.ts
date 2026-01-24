import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import react from '@vitejs/plugin-react'

export default defineConfig({
  mode: 'development', // Required for React testing-library (act() needs dev build)
  plugins: [
    // React for regular .tsx files
    react({
      include: /\.tsx?$/,
      exclude: /\.solid\.tsx$/,
    }),
    // Solid only for .solid.tsx files
    solid({
      include: /\.solid\.tsx$/,
    }),
  ],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
