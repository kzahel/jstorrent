import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const KEY = "rstorrent.presentation.language";
const DEMO = "/?demo=healthy-download&at=42000&autoplay=0";

test("French switching retains selection and restores the explicit language after reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(DEMO);
  const selected = page.getByRole("checkbox", { name: /Sintel 4K open movie/ });
  await selected.check();
  await page.locator('header button[aria-haspopup="dialog"]').click();
  const dialog = page.getByRole("dialog");
  const french = dialog.getByRole("radio", { name: /français/i });
  await french.check();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("#language-heading")).toHaveText("Langue");
  await expect(french).toBeFocused();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe("fr");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Sintel 4K open movie" }).getByRole("checkbox")).toBeChecked();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.locator('header button[aria-haspopup="dialog"]').click();
  await expect(dialog.getByRole("radio", { name: /français/i })).toBeChecked();
  await dialog.locator('input[name="language"][value="system"]').check();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
});

test("System negotiates regional French and permits an English override", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ locale: "fr-CA", baseURL });
  try {
    const page = await context.newPage();
    await page.goto(DEMO);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
    await page.locator('header button[aria-haspopup="dialog"]').click();
    await page.getByRole("radio", { name: "English", exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.locator('input[name="language"][value="system"]').check();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  } finally { await context.close(); }
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`French settings remain accessible at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(key => localStorage.setItem(key, "fr"), KEY);
    await page.goto(DEMO);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await page.locator('header button[aria-haspopup="dialog"]').click();
    await expect(page.locator("#language-heading")).toHaveText("Langue");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(
      violation => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(violations).toEqual([]);
  });

  test(`French removal distinguishes retaining and deleting data at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(key => localStorage.setItem(key, "fr"), KEY);
    await page.goto(DEMO);
    await page.getByRole("checkbox", { name: /Big Buck Bunny 1080p surround/ }).check();
    await page.getByRole("checkbox", { name: /Sintel 4K open movie/ }).check();
    await page.getByRole("button", { name: "Retirer", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /Retirer\s+2\s+torrents\s*\?/ });
    await expect(dialog).toBeVisible();
    await page.setViewportSize(viewport);
    await expect(dialog.getByRole("checkbox")).not.toBeChecked();
    await dialog.getByRole("checkbox").check();
    await expect(dialog.getByRole("alert")).toContainText(/définitiv|irr[eé]versibl/);
    await expect(dialog.getByRole("button", { name: /Retirer.*supprimer.*données/i })).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(
      violation => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
}

test("French peer labels update without replacing internal state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(DEMO);
  await page.getByRole("tab", { name: "Peers", exact: true }).click();
  await expect(page.locator('[data-state="connected"]').first()).toHaveText("Connected");
  await page.locator('header button[aria-haspopup="dialog"]').click();
  await page.getByRole("radio", { name: /français/i }).check();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-state="connected"]').first()).toHaveText(/Connecté/);
});
