import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['integration/daemon/**/*.test.ts'],
    testTimeout: 30000, // Daemon tests may be slower
  },
})
