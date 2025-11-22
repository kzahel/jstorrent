import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  retries: 0,
  workers: 1,
  use: {
    trace: 'on-first-retry',
    headless: true, // 'new' headless is default in newer playwright, or just true
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
