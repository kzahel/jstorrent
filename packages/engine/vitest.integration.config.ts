import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/test/integration/daemon-*.spec.ts'],
    testTimeout: 30000, // Daemon tests may be slower
  },
})
