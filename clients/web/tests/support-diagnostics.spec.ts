import fs from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const supportLinks = [
  ["Known issues", "https://github.com/kzahel/jstorrent/issues"],
  ["Report a problem", "https://github.com/kzahel/jstorrent/issues/new"],
  ["Privacy and recovery guidance", "https://github.com/kzahel/jstorrent/blob/main/docs/user-support.md"],
] as const;

test("desktop support and release links use the injected opener and recover from failure", async ({ page }) => {
  const popups: unknown[] = [];
  page.on("popup", (popup) => popups.push(popup));
  await page.goto("/tests/fixtures/support-harness.html?desktop&rejectOpen&package=msi");
  await page.getByRole("link", { name: "Known issues" }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not open the link. Please try again.");
  await page.getByRole("link", { name: "Known issues" }).press("Enter");
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (const [name] of supportLinks.slice(1)) await page.getByRole("link", { name }).click();
  await page.getByRole("link", { name: "Open release downloads" }).click({ modifiers: ["ControlOrMeta"] });
  expect(await page.evaluate(() => (window as unknown as { openedUrls: string[] }).openedUrls)).toEqual([
    supportLinks[0][1], ...supportLinks.map(([, url]) => url),
    "https://github.com/kzahel/jstorrent/releases/latest",
  ]);
  expect(popups).toEqual([]);
  await expect(page).toHaveURL(/support-harness/);
  await page.goto("/tests/fixtures/support-harness.html?desktop&manual");
  await page.getByRole("link", { name: "Review signed release" }).click();
  expect(await page.evaluate(() => (window as unknown as { openedUrls: string[] }).openedUrls)).toEqual([
    "https://github.com/kzahel/jstorrent/releases/tag/headless-v0.1.4",
  ]);
});

test("browser support and release links open isolated tabs at their exact URLs", async ({ page, context }) => {
  await context.route("https://github.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Controlled external destination</h1>" }));
  await page.goto("/tests/fixtures/support-harness.html?package=msi");
  for (const [name, url] of [...supportLinks, ["Open release downloads", "https://github.com/kzahel/jstorrent/releases/latest"]]) {
    const pending = page.waitForEvent("popup");
    await page.getByRole("link", { name }).click();
    const popup = await pending;
    await expect(popup).toHaveURL(url!);
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
  }
  await expect(page).toHaveURL(/support-harness/);
});

for (const width of [320, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`support preview, copy and download at ${width}px ${theme}`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 900 });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.addInitScript(() => {
        const active = new Set<string>();
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (value) => { const url = create(value); active.add(url); return url; };
        URL.revokeObjectURL = (url) => { active.delete(url); revoke(url); };
        Object.defineProperty(window, "supportObjectUrlCount", { get: () => active.size });
      });
      const external: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.protocol.startsWith("http") && url.hostname !== "127.0.0.1") external.push(url.origin);
      });
      await page.goto(`/tests/fixtures/support-harness.html?theme=${theme}`);
      await page.getByRole("button", { name: "Prepare diagnostics" }).click();
      const preview = page.getByRole("textbox", { name: "Exact report to copy or download" });
      const bytes = await preview.inputValue();
      expect(JSON.parse(bytes).version).toBe("0.1.3");
      expect(Buffer.byteLength(bytes)).toBeLessThan(2048);
      await page.getByRole("button", { name: "Copy diagnostics" }).click();
      await expect(page.getByRole("region", { name: "Notification" })).toContainText("Diagnostics copied.");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(bytes);
      const pending = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download diagnostics" }).click();
      const download = await pending;
      expect(download.suggestedFilename()).toBe("jstorrent-diagnostics.json");
      const file = await download.path();
      expect(file).not.toBeNull();
      expect(await fs.readFile(file!, "utf8")).toBe(bytes);
      await download.delete();
      await expect.poll(() => page.evaluate(() =>
        (window as unknown as { supportObjectUrlCount: number }).supportObjectUrlCount,
      )).toBe(0);
      expect(external).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      for (const name of ["Copy diagnostics", "Download diagnostics"]) {
        const bounds = await page.getByRole("button", { name }).boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
      expect((await new AxeBuilder({ page }).analyze()).violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      )).toEqual([]);
      if (process.env.RSTORRENT_SCREENSHOT_DIR) {
        await fs.mkdir(process.env.RSTORRENT_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.RSTORRENT_SCREENSHOT_DIR, `support-${width}-${theme}.png`), fullPage: true });
      }
    });
  }
}

for (const bundleType of ["msi", "deb", "rpm", "unknown"]) {
  for (const width of [320, 1440]) {
    for (const theme of ["light", "dark"]) {
      test(`managed ${bundleType} update guidance at ${width}px ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const external: string[] = [];
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (url.protocol.startsWith("http") && url.hostname !== "127.0.0.1") {
            external.push(url.origin);
            await route.abort();
          } else await route.continue();
        });
        await page.goto(`/tests/fixtures/support-harness.html?package=${bundleType}&theme=${theme}`);
        const updates = page.locator("fieldset").filter({ has: page.locator("legend", { hasText: /^Updates$/ }) });
        await expect(updates.getByText("Manual update required", { exact: true })).toBeVisible();
        await expect(updates.getByText(/stays with its package channel/)).toBeVisible();
        const releases = updates.getByRole("link", { name: "Open release downloads" });
        await expect(releases).toHaveAttribute("href", "https://github.com/kzahel/jstorrent/releases/latest");
        await expect(updates.getByRole("button")).toHaveCount(0);
        await expect(updates.getByRole("combobox")).toHaveCount(0);
        await expect(updates).not.toContainText(/Automatic updates enabled|checks automatically|installation identifier|usage statistics/);
        await page.getByRole("button", { name: "Prepare diagnostics" }).click();
        const report = JSON.parse(await page.getByRole("textbox", { name: "Exact report to copy or download" }).inputValue());
        expect(report.package).toBe(bundleType);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        const bounds = await releases.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect((await new AxeBuilder({ page }).analyze()).violations.filter(
          (violation) => violation.impact === "serious" || violation.impact === "critical",
        )).toEqual([]);
        expect(external).toEqual([]);
        expect(errors).toEqual([]);
        if (process.env.RSTORRENT_SCREENSHOT_DIR) {
          await fs.mkdir(process.env.RSTORRENT_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({ path: path.join(process.env.RSTORRENT_SCREENSHOT_DIR,
            `managed-updates-fixture-${bundleType}-${width}-${theme}.png`), fullPage: true });
        }
      });
    }
  }
}
