import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const screenshotDirectory = process.env.RSTORRENT_SCREENSHOT_DIR;

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 456, height: 1_024 },
  { width: 920, height: 720 },
  { width: 1_440, height: 900 },
] as const;

const CORNERS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;

test("press menus shift and flip inside every supported viewport edge", async ({
  page,
}) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const corner of CORNERS) {
      await openHarness(page, { corner });
      await page.getByRole("button", { name: "Harness actions" }).click();
      const menu = page.getByRole("menu", { name: "Harness actions" });
      await expect(menu).toBeVisible();
      await expect(
        menu.getByRole("menuitem", { name: "Copy address" }),
      ).toBeVisible();
      await expect(
        menu.getByRole("menuitem", { name: "Archive completed torrent" }),
      ).toBeAttached();
      await expectInsideViewport(menu.locator("..").locator(".."), viewport);
      await expectInsideViewport(
        menu.getByRole("menuitem", { name: "Copy address" }),
        viewport,
      );
      if (viewport.width === 1_440 && corner === "bottom-right") {
        await capture(page, "rstorrent-overlay-menu-wide-light.png");
      }
      if (viewport.width === 320 && corner === "top-left") {
        await page.keyboard.press("End");
        await expect(
          menu.getByRole("menuitem", { name: "Archive completed torrent" }),
        ).toHaveAttribute("data-focused");
        await page.keyboard.press("Home");
        await expect(
          menu.getByRole("menuitem", { name: "Copy address" }),
        ).toHaveAttribute("data-focused");
        await page.keyboard.type("skip");
        await expect(
          menu.getByRole("menuitem", { name: "Skip this file" }),
        ).toHaveAttribute("data-focused");
      }
      await page.keyboard.press("Escape");
    }
  }
});

test("nested menus stay inside phone edges and Escape unwinds one level", async ({
  page,
}) => {
  const viewport = { width: 320, height: 568 };
  await page.setViewportSize(viewport);
  await openHarness(page, { corner: "bottom-right" });
  const trigger = page.getByRole("button", { name: "Harness actions" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const root = page.getByRole("menu", { name: "Harness actions" });
  const submenuTrigger = root.getByRole("menuitem", {
    name: "Add test torrent",
  });
  await page.keyboard.press("ArrowDown");
  await expect(submenuTrigger).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const submenu = page.getByRole("menu", { name: "Add test torrent" });
  await expect(submenu.getByRole("menuitem", { name: "Add all sample torrents" })).toBeFocused();
  await expect(submenu.getByText("Big Buck Bunny", { exact: true })).toBeVisible();
  await expect
    .poll(() => root.locator("..").locator("..").evaluate(layerIndex))
    .toBe(80);
  await expect.poll(() => submenu.locator("..").evaluate(layerIndex)).toBe(81);
  await expectInsideViewport(submenu.locator(".."), viewport);
  await capture(page, "rstorrent-overlay-submenu-phone-light.png");
  await page.keyboard.press("Escape");
  await expect(submenu).toHaveCount(0);
  await expect(root).toBeVisible();
  await expect(submenuTrigger).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(root).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("pointer submenu selection closes the complete menu tree", async ({ page }) => {
  const viewport = { width: 920, height: 720 };
  await page.setViewportSize(viewport);
  await openHarness(page, { corner: "top-left" });
  await page.getByRole("button", { name: "Harness actions" }).click();
  await page.getByRole("menuitem", { name: "Add test torrent" }).hover();
  const submenu = page.getByRole("menu", { name: "Add test torrent" });
  await expect(submenu).toBeVisible();
  await expectInsideViewport(submenu.locator(".."), viewport);
  await submenu.getByRole("menuitem", { name: "Sintel" }).click();
  await expect(page.getByRole("menu", { name: "Harness actions" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Harness actions" }),
  ).toBeFocused();
});

test("touch tap opens a phone menu with visible actions", async (
  { browser },
  testInfo,
) => {
  const baseURL = testInfo.project.use.baseURL;
  const viewport = { width: 456, height: 1_024 };
  const context = await browser.newContext({
    ...(typeof baseURL === "string" ? { baseURL } : {}),
    hasTouch: true,
    viewport,
  });
  const page = await context.newPage();
  try {
    await openHarness(page, { corner: "bottom-right" });
    await page.getByRole("button", { name: "Harness actions" }).tap();
    const menu = page.getByRole("menu", { name: "Harness actions" });
    await expect(menu.getByRole("menuitem", { name: "Copy address" })).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Skip this file" }),
    ).toBeVisible();
    await expectInsideViewport(menu.locator("..").locator(".."), viewport);
  } finally {
    await context.close();
  }
});

test("an open menu repositions when the viewport changes", async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 720 });
  await openHarness(page, { corner: "bottom-right" });
  await page.getByRole("button", { name: "Harness actions" }).click();
  const menu = page.getByRole("menu", { name: "Harness actions" });
  await expect(menu).toBeVisible();

  const phoneViewport = { width: 320, height: 568 };
  await page.setViewportSize(phoneViewport);
  await expectInsideViewport(menu.locator("..").locator(".."), phoneViewport);
  await expect(
    menu.getByRole("menuitem", { name: "Copy address" }),
  ).toBeVisible();
});

test("context pointer and keyboard invocations clamp and dismiss cleanly", async ({
  page,
}) => {
  const viewport = { width: 320, height: 568 };
  await page.setViewportSize(viewport);
  await openHarness(page, { corner: "bottom-right", mode: "context" });
  const target = page.getByRole("button", { name: "Harness actions" });
  await target.click({ button: "right", position: { x: 2, y: 2 } });
  let menu = page.getByRole("menu", { name: "Harness actions" });
  await expectInsideViewport(menu.locator("..").locator(".."), viewport);
  await page.keyboard.press("Escape");

  await target.focus();
  const keyboardContextShortcut = await page.evaluate(() =>
    /Mac/.test(navigator.platform) ? "Control+Enter" : "Shift+F10",
  );
  await page.keyboard.press(keyboardContextShortcut);
  menu = page.getByRole("menu", { name: "Harness actions" });
  await expect(menu).toBeVisible();
  await expectInsideViewport(menu.locator("..").locator(".."), viewport);
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await expect(menu).toHaveCount(0);
  await expect(page.getByLabel("Outside action count")).toHaveText("0");
  await page.getByTestId("outside-action").click();
  await expect(page.getByLabel("Outside action count")).toHaveText("1");
});

test("portal appearance follows every density and color theme", async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 720 });
  for (const size of ["compact", "standard", "spacious"] as const) {
    for (const theme of ["auto", "light", "dark"] as const) {
      await openHarness(page, { size, theme });
      await page.getByRole("button", { name: "Harness actions" }).click();
      const item = page.getByRole("menuitem", { name: "Copy address" });
      const metrics = await item.evaluate((element) => {
        const itemStyle = getComputedStyle(element);
        const overlayStyle = getComputedStyle(
          element.closest("[role='dialog']")!,
        );
        return {
          interfaceSize: document.documentElement.dataset.interfaceSize,
          colorTheme: document.documentElement.dataset.colorTheme,
          itemMinHeight: itemStyle.minHeight,
          overlayBackground: overlayStyle.backgroundColor,
          raisedBackground: resolvedBackground("var(--surface-raised)"),
        };
        function resolvedBackground(value: string): string {
          const probe = document.createElement("div");
          probe.style.background = value;
          document.body.append(probe);
          const color = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return color;
        }
      });
      expect(metrics.interfaceSize).toBe(size);
      expect(metrics.colorTheme).toBe(theme);
      expect(metrics.itemMinHeight).toBe(
        size === "compact" ? "30px" : size === "standard" ? "36px" : "44px",
      );
      expect(metrics.overlayBackground).toBe(metrics.raisedBackground);
      if (size === "standard" && theme === "light") {
        const violations = (
          await new AxeBuilder({ page }).analyze()
        ).violations.filter(
          (violation) =>
            violation.impact === "serious" || violation.impact === "critical",
        );
        expect(violations).toEqual([]);
      }
      if (size === "standard" && theme === "dark") {
        await capture(page, "rstorrent-overlay-menu-wide-dark.png");
      }
      await page.keyboard.press("Escape");
    }
  }
});

test("disable and owner removal clear their portals", async ({ page }) => {
  await page.setViewportSize({ width: 456, height: 1_024 });
  await openHarness(page, { corner: "top-left" });
  await page.getByRole("button", { name: "Harness actions" }).click();
  await expect(page.getByRole("menu", { name: "Harness actions" })).toBeVisible();
  await page
    .getByTestId("disable-trigger")
    .evaluate((element: HTMLButtonElement) => element.click());
  await expect(
    page.getByRole("menu", { name: "Harness actions" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Harness actions" }),
  ).toBeDisabled();

  await openHarness(page, { corner: "top-left" });
  await page.getByRole("button", { name: "Harness actions" }).click();
  await page
    .getByTestId("unmount-owner")
    .evaluate((element: HTMLButtonElement) => element.click());
  await expect(page.getByRole("menu", { name: "Harness actions" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Harness actions" })).toHaveCount(0);
});

async function openHarness(
  page: Page,
  options: {
    readonly corner?: (typeof CORNERS)[number];
    readonly mode?: "context";
    readonly size?: "compact" | "standard" | "spacious";
    readonly theme?: "auto" | "light" | "dark";
  },
) {
  const parameters = new URLSearchParams();
  parameters.set("corner", options.corner ?? "top-left");
  parameters.set("size", options.size ?? "standard");
  parameters.set("theme", options.theme ?? "light");
  if (options.mode !== undefined) parameters.set("mode", options.mode);
  await page.goto(`/tests/fixtures/overlay-harness.html?${parameters}`);
}

async function expectInsideViewport(
  locator: Locator,
  viewport: { readonly width: number; readonly height: number },
) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(7);
  expect(box!.y).toBeGreaterThanOrEqual(7);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 7);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 7);
}

function layerIndex(element: Element) {
  return Number.parseInt(getComputedStyle(element).zIndex, 10);
}

async function capture(page: Page, filename: string) {
  if (screenshotDirectory === undefined) return;
  await fs.mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDirectory, filename),
    fullPage: false,
  });
}
