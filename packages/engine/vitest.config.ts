import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/test/integration/daemon-*.spec.ts', // Requires io-daemon binary
    ],
  },
})
