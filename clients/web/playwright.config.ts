import { defineConfig } from "@playwright/test";

const externalBaseUrl = process.env.RSTORRENT_PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: externalBaseUrl ?? "http://127.0.0.1:4177",
    colorScheme: "light",
    headless: true,
    launchOptions: {
      args: ["--enable-precise-memory-info"],
    },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer:
    externalBaseUrl === undefined
      ? {
          command: "npm run dev -- --host 127.0.0.1 --port 4177",
          url: "http://127.0.0.1:4177",
          reuseExistingServer: false,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
          timeout: 30_000,
        }
      : undefined,
});
