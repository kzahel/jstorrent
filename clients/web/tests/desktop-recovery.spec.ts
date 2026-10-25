import { expect, test } from "@playwright/test";

// Tactical 369: locale selection is established before recovery, and recovery
// is checked before the engine is opened. The Tauri bridge is stubbed with the
// status the real desktop reports for a forced migration failure.
test("desktop shows recovery instead of the app when the catalog did not open", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    let nextCallback = 1;
    (window as unknown as { recoveryCalls: string[] }).recoveryCalls = calls;
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => nextCallback++,
      unregisterCallback: () => undefined,
      invoke: async (command: string) => {
        calls.push(command);
        switch (command) {
          case "load_desktop_locale":
            return { preference: "system", locale: "en", availableLocales: ["en"] };
          case "desktop_recovery_status":
            return {
              reason: "migration_failed",
              catalog_version: 26,
              supported_version: 28,
              export_available: true,
              details:
                "catalog version: 26; supported version: 28; error: invalid durable state: migration from schema 26 failed on purpose (RSTORRENT_TEST_FAIL_MIGRATION)",
            };
          case "desktop_release_info":
            return { version: "0.4.0", buildId: "dry-run", target: "aarch64-apple-darwin", arch: "aarch64" };
          case "desktop_update_channel":
            return "stable";
          case "desktop_update_check_generation":
            return 0;
          case "plugin:app|bundle_type":
            return "app";
          case "plugin:event|listen":
            return 1;
          case "desktop_check_update":
            return { channel: "stable", generation: 1, version: "0.4.1", notes: null, waitingForStable: false };
          case "desktop_recovery_export":
            return true;
          default:
            throw new Error(`unexpected desktop command ${command}`);
        }
      },
    };
  });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "JSTorrent couldn't update your torrent list" }),
  ).toBeVisible();
  await expect(page.getByText("Your torrents, settings and downloaded files are safe and unchanged.")).toBeVisible();
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByRole("button", { name: "Install version 0.4.1" })).toBeVisible();
  await page.getByRole("button", { name: "Export torrent list" }).click();
  await expect(page.getByText("Torrent list saved.")).toBeVisible();
  await page.screenshot({ path: process.env.RECOVERY_SCREENSHOT ?? "test-results/desktop-recovery.png" });
  const calls = await page.evaluate(() => (window as unknown as { recoveryCalls: string[] }).recoveryCalls);
  expect(calls).toContain("load_desktop_locale");
  expect(calls.indexOf("desktop_recovery_status")).toBeGreaterThan(calls.indexOf("load_desktop_locale"));
  expect(calls).not.toContain("application_dispatch");
  expect(calls).toContain("desktop_recovery_export");
  expect(consoleErrors).toEqual([]);
});
