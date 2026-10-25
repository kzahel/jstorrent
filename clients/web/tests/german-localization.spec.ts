import fs from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const screenshotDirectory = process.env.RSTORRENT_SCREENSHOT_DIR;
const KEY = "rstorrent.presentation.language";
const DEMO = "/?demo=healthy-download&at=42000&autoplay=0";

test("German switching updates live UI, retains state, and persists only the explicit choice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(DEMO);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const checkbox = page.getByRole("checkbox", { name: "Select Sintel 4K open movie" });
  await checkbox.check();
  await page.locator('header button[aria-haspopup="dialog"]').click();
  const location = page.url();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Deutsch", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#language-heading")).toHaveText("Sprache");
  await expect(page.locator('input[name="color-theme"][value="light"] + span')).not.toHaveText("Light");
  await expect(dialog.getByRole("radio", { name: "Deutsch", exact: true })).toBeFocused();
  expect(page.url()).toBe(location);
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe("de");
  await page.keyboard.press("Escape");
  // The same selected torrent and table survive a live locale change.
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Sintel 4K open movie" }).getByRole("checkbox")).toBeChecked();
  await expect(page.getByRole("columnheader", { name: "Name", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Progress", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Starten", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pausieren", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entfernen", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.locator('header button[aria-haspopup="dialog"]').click();
  await expect(dialog.getByRole("radio", { name: "Deutsch", exact: true })).toBeChecked();
  await dialog.locator('input[name="language"][value="system"]').check();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("System follows German browser language and allows an English override", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ locale: "de-DE", baseURL });
  try {
    const page = await context.newPage();
    await page.goto(DEMO);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
    await page.locator('header button[aria-haspopup="dialog"]').click();
    await page.getByRole("radio", { name: "English", exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.locator('input[name="language"][value="system"]').check();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
  } finally { await context.close(); }
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`German settings are accessible at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript((key) => localStorage.setItem(key, "de"), KEY);
    await page.goto(DEMO);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await page.locator('header button[aria-haspopup="dialog"]').click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator('input[name="language"][value="de"]')).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(violations).toEqual([]);
    if (screenshotDirectory !== undefined) {
      await fs.mkdir(screenshotDirectory, { recursive: true });
      await page.screenshot({ path: path.join(screenshotDirectory, `jstorrent-german-settings-${viewport.width}.png`), fullPage: false });
    }
  });
}
