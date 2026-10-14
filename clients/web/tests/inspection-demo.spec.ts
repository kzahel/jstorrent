import fs from "node:fs/promises";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const screenshotDirectory = process.env.RSTORRENT_SCREENSHOT_DIR;

test("checker progress stays truthful across every shared surface", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?demo=checking-progress&at=18000&autoplay=0");
  const primary = page.getByRole("navigation", { name: "Primary" });
  const checkingBar = page.getByRole("progressbar", {
      name: /Big Buck Bunny 1080p surround checking progress: Checked 40.0%/,
  });
  await expect(checkingBar).toHaveAttribute("aria-valuenow", "40");

  await primary.getByRole("button", { name: "Library" }).click();
  await expect(page.getByText("Checked 40.0%", { exact: true })).toBeVisible();
  await expect(checkingBar).toHaveAttribute("aria-valuenow", "40");
  await page
    .getByRole("button", {
      name: "Open details for Big Buck Bunny 1080p surround",
    })
    .click();
  await page.getByRole("button", { name: "Open in Torrents" }).click();
  await page.getByRole("tab", { name: "General" }).click();
  const details = page.getByLabel("Torrent details", { exact: true });
  await expect(details.getByText("Current check")).toBeVisible();
  await expect(details.getByText("400 / 1,000")).toBeVisible();
  await expect(details.getByText("397", { exact: true })).toBeVisible();
  await expect(details.getByText("2", { exact: true })).toBeVisible();
  await expect(details.getByText("1", { exact: true })).toBeVisible();

  await page.goto("/?demo=checking-progress&at=36000&autoplay=0");
  const fencedBar = page.getByRole("progressbar", {
    name: /checking progress: Updating file selection/,
  });
  await expect(page.getByText("Updating file selection", { exact: true })).toBeVisible();
  await expect(fencedBar).not.toHaveAttribute("aria-valuenow");
  await expect(fencedBar).toHaveAttribute("data-indeterminate", "true");
  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
});

test("primary destinations preserve shared source state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=healthy-download&at=42000&autoplay=0");
  await expect(page.getByText("JSTorrent", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(
    /^JSTorrent - ↓[\d.]+ [kKMGT]?B\/s ↑[\d.]+ [kKMGT]?B\/s$/,
  );

  const primary = page.getByRole("navigation", { name: "Primary" });
  const transfers = primary.getByRole("button", { name: "Torrents" });
  await expect(transfers).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("grid", { name: "Torrents" }),
  ).toHaveAttribute("aria-rowcount", "4");
  await capture(page, "rstorrent-transfers-wide.png");
  const sintelCheck = page.getByRole("checkbox", {
    name: "Select Sintel 4K open movie",
  });
  await expect(sintelCheck).not.toBeChecked();
  const bunnyRow = page.getByRole("row").filter({
    hasText: "Big Buck Bunny 1080p surround",
  });
  const transferRow = page.getByRole("row").filter({ hasText: "Sintel" });
  await bunnyRow.click();
  const normalColumns = await transferRow.getAttribute("style");
  await transferRow.click({ modifiers: ["Shift"] });
  await expect(page.getByText("2 selected")).toBeVisible();
  await expect(transferRow).toHaveAttribute("style", normalColumns ?? "");
  await page
    .getByRole("navigation", { name: "Torrent filters" })
    .getByRole("button", { name: /Paused/ })
    .click();
  await expect(page.getByText(/not shown/)).toHaveCount(0);
  await primary.getByRole("button", { name: "Library" }).click();
  await primary.getByRole("button", { name: "Torrents" }).click();
  await page.getByRole("navigation", { name: "Torrent filters" }).getByRole("button", { name: /All torrents/ }).click();
  await expect(
    page.getByRole("checkbox", { name: /^Deselect / }),
  ).toHaveCount(1);

  await primary.getByRole("button", { name: "Library" }).click();
  await expect(
    page.getByRole("list", { name: "Torrent-backed content" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Play / })).toHaveCount(0);
  await capture(page, "rstorrent-library-wide.png");
  await page
    .getByRole("button", { name: "Open details for Sintel 4K open movie" })
    .click();
  await page.getByRole("button", { name: "Open in Torrents" }).click();
  await expect(
    primary.getByRole("button", { name: "Torrents" }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("tab", { name: "General" }).click();
  await expect(page.getByText("Current transfer")).toBeVisible();
  await expect(page.getByText("Sintel 4K open movie").first()).toBeVisible();

  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await capture(page, "rstorrent-destinations-wide.png");
});

test("Library media detail sorts episodes and adapts to phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=media-library&at=0&autoplay=0");
  const primary = page.getByRole("navigation", { name: "Primary" });
  await primary.getByRole("button", { name: "Library" }).click();
  const card = page.getByRole("button", {
    name: "Open details for North Shore Stories · Seasons 1–2",
  });
  await card.click();

  const back = page.getByRole("button", { name: "Back to Library" });
  await expect(back).toBeFocused();
  const media = page.getByRole("list", { name: "Recognized video files" });
  await expect(media).toBeVisible();
  expect(
    await media.getByRole("listitem").locator("strong[title]").allTextContents(),
  ).toEqual([
    "North.Shore.Stories.S01E01.1080p.WEB-DL.mkv",
    "North.Shore.Stories.S01E02.1080p.WEB-DL.mp4",
    "North.Shore.Stories.S01E07E08.mkv",
    "North.Shore.Stories.S01E10.1080p.WEB-DL.mkv",
    "North.Shore.Stories.S02E01.mkv",
    "Behind the scenes.webm",
  ]);
  await expect(media.getByText("poster.jpg")).toHaveCount(0);
  await expect(media.getByText("README.nfo")).toHaveCount(0);
  await expect(media.getByText("Downloaded", { exact: true })).toHaveCount(2);
  await expect(media.getByText("Not selected", { exact: true })).toBeVisible();
  await expect(media.getByLabel(/download progress$/)).toHaveCount(6);

  await page.getByRole("tab", { name: "All files" }).click();
  const files = page.getByRole("list", { name: "All torrent files" });
  await expect(files.getByText("poster.jpg")).toBeVisible();
  await expect(files.getByText("README.nfo")).toBeVisible();
  await capture(page, "rstorrent-library-detail-wide.png");

  await back.click();
  await expect(card).toBeVisible();
  await expect(card).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await card.click();
  await expect(page.getByRole("list", { name: "Recognized video files" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await capture(page, "rstorrent-library-detail-phone.png");

  await page.keyboard.press("Escape");
  await expect(card).toBeVisible();
  await expect(card).toBeFocused();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=file-progress&at=24000&autoplay=0");
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Library" })
    .click();
  await page
    .getByRole("button", {
      name: "Open details for Open Movies production archive",
    })
    .click();
  const largeMedia = page.getByRole("list", {
    name: "Recognized video files",
  });
  await expect(largeMedia).toBeVisible();
  const largeMediaRows = largeMedia.getByRole("listitem");
  const mountedRows = await largeMediaRows.count();
  const recognizedRows = Number(
    await largeMediaRows.first().getAttribute("aria-setsize"),
  );
  const scaleMetrics = await page.evaluate(() => {
    const measuredPerformance = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    return {
      domElements: document.getElementsByTagName("*").length,
      usedJsHeapBytes: measuredPerformance.memory?.usedJSHeapSize ?? null,
    };
  });
  expect(recognizedRows).toBe(3_003);
  expect(mountedRows).toBeLessThanOrEqual(20);
  expect(scaleMetrics.domElements).toBeLessThan(1_500);
  console.log(
    `media_scale_metrics ${JSON.stringify({ recognizedRows, mountedRows, ...scaleMetrics })}`,
  );
});

test("More copies selected torrents' source-aware magnets", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("/?demo=healthy-download&at=42000&autoplay=0");

  await page
    .getByRole("checkbox", { name: "Select Sintel 4K open movie" })
    .click();

  const more = page.getByRole("button", { name: "More" });
  await more.click();
  const menu = page.getByRole("menu", { name: "More" });
  const copy = menu.getByRole("menuitem", { name: "Copy magnet links" });
  await expect(copy).toBeEnabled();

  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await copy.click();

  await expect(
    page.getByText("2 magnet links copied", { exact: true }),
  ).toBeVisible();
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    [
      "magnet:?xt=urn:btih:a962f460b83861cfb5faa1d7ad7da9c3f3cc2fc4&dn=Big%20Buck%20Bunny%201080p%20surround",
      "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel%204K%20open%20movie",
    ].join("\n"),
  );
});

test("torrent and file rows expose exact accessible context actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("/?demo=healthy-download&at=42000&autoplay=0");
  const transferGrid = page.getByRole("grid", { name: "Torrents" });
  const sintelRow = transferGrid.getByRole("row").filter({
    hasText: "Sintel 4K open movie",
  });

  await sintelRow.click({ button: "right", position: { x: 300, y: 18 } });
  let menu = page.getByRole("menu", { name: "Torrent actions" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(10);
  await expect(menu.getByRole("menuitem", { name: "Torrent settings" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Move to top" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Move to bottom" })).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Copy magnet link" }),
  ).toBeVisible();
  await expect(menu.getByRole("separator")).toHaveCount(3);
  for (const heading of ["Transfer", "Sharing", "Organization", "Destructive"]) {
    await expect(menu.getByText(heading, { exact: true })).toHaveCount(0);
  }
  await capture(page, "rstorrent-torrent-context-dividers.png");
  await page.keyboard.press("Escape");
  await expect(
    transferGrid.getByRole("checkbox", {
      name: "Deselect Sintel 4K open movie",
    }),
  ).toBeChecked();
  await expect(sintelRow).toBeFocused();

  await transferGrid
    .getByRole("checkbox", { name: "Select Big Buck Bunny 1080p surround" })
    .click();
  await sintelRow.click({ button: "right", position: { x: 1, y: 18 } });
  menu = page.getByRole("menu", { name: "Torrent actions" });
  await expect(
    menu.getByRole("menuitem", { name: "Copy magnet links" }),
  ).toBeVisible();
  const menuBounds = await menu.boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
  expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(1024);
  const menuViolations = (
    await new AxeBuilder({ page }).include('[role="menu"]').analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(menuViolations).toEqual([]);
  await menu.getByRole("menuitem", { name: "Remove" }).click();
  const removal = page.getByRole("dialog", { name: "Remove 2 torrents?" });
  await expect(
    removal.getByRole("checkbox", { name: "Also delete downloaded data" }),
  ).not.toBeChecked();
  await expect(
    removal.getByRole("list", { name: "Torrents to remove" }),
  ).toBeVisible();
  await removal.getByRole("button", { name: "Cancel" }).click();
  await expect(sintelRow).toBeFocused();

  await sintelRow.focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page
      .getByRole("menu", { name: "Torrent actions" })
      .getByRole("menuitem", { name: "Copy magnet links" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Torrents" })
    .click();
  const workbenchGrid = page.getByRole("grid", { name: "Torrents" });
  const workbenchSintel = workbenchGrid.getByRole("row").filter({
    hasText: "Sintel 4K open movie",
  });
  await workbenchSintel.click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Torrent actions" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/?demo=file-progress&at=24000&autoplay=0");
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Torrents" })
    .click();
  await page.getByRole("tab", { name: "Files" }).click();
  const files = page.getByRole("grid", { name: "Torrent files" });
  await expect(files).toHaveAttribute("aria-rowcount", "4096");
  const fileRow = files.getByRole("row").filter({ hasText: "asset-001.mkv" });
  await fileRow.click({ button: "right" });
  const fileMenu = page.getByRole("menu", { name: "File actions" });
  await expect(
    fileMenu.getByRole("menuitem", { name: "Download now" }),
  ).toBeDisabled();
  await expect(
    fileMenu.getByRole("menuitem", { name: "Normal" }),
  ).toBeDisabled();
  await expect(fileMenu.getByRole("menuitem", { name: "Skip" })).toBeDisabled();
  await expect(fileMenu.getByRole("separator")).toHaveCount(1);
  await expect(fileMenu.getByText("Priority", { exact: true })).toHaveCount(0);
  await capture(page, "rstorrent-file-context-dividers.png");
  expect(await files.getByRole("row").count()).toBeLessThanOrEqual(100);
  const fileViolations = (
    await new AxeBuilder({ page }).include('[role="menu"]').analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(fileViolations).toEqual([]);
});

test("phone destinations and contextual filters remain reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?demo=healthy-download&at=42000&autoplay=0");
  const transferGrid = page.getByRole("grid", { name: "Torrents" });
  await expect(transferGrid).toBeVisible();
  const heldRow = transferGrid.getByRole("row").filter({ hasText: "Sintel" });
  await heldRow.dispatchEvent("pointerdown", {
    button: 0,
    clientX: 20,
    clientY: 20,
    pointerId: 41,
    pointerType: "touch",
  });
  await page.waitForTimeout(550);
  await expect(
    page.getByRole("checkbox", { name: "Deselect Sintel 4K open movie" }),
  ).toBeChecked();
  await page
    .getByRole("button", {
      name: "Done selecting rows in Torrents",
    })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Select Sintel 4K open movie" }),
  ).not.toBeChecked();
  const primary = page.getByRole("navigation", { name: "Primary" });
  await primary.getByRole("button", { name: "Library" }).click();
  await expect(
    page.getByRole("list", { name: "Torrent-backed content" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle Library filters" }).click();
  await expect(
    page.getByRole("navigation", { name: "Library filters" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle Library filters" }).click();
  await capture(page, "rstorrent-library-phone.png");

  await primary.getByRole("button", { name: "Torrents" }).click();
  await expect(
    page.getByRole("grid", { name: "Torrents" }),
  ).toBeVisible();
  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
});

test("Workbench empty-space focus keeps Select All on torrents", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=healthy-download&at=42000&autoplay=0");
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Torrents" })
    .click();
  const grid = page.getByRole("grid", { name: "Torrents" });
  const bounds = await grid.boundingBox();
  expect(bounds).not.toBeNull();
  await grid.click({ position: { x: 12, y: bounds!.height - 8 } });
  await expect(grid).toBeFocused();
  await expect(grid.getByRole("checkbox", { checked: true })).toHaveCount(0);

  await page.keyboard.press("Meta+a");
  await expect(grid.getByRole("checkbox", { checked: true })).toHaveCount(4);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
});

test("wide inspection surface is accessible and drivable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, "healthy-download", 42_000);

  await expect(
    page.getByRole("grid", { name: "Torrents" }),
  ).toHaveAttribute("aria-rowcount", "4");
  await expect(
    page.getByRole("grid", { name: "Active peer connections" }),
  ).toBeVisible();
  await expect(
    page.getByText("Big Buck Bunny 1080p surround").first(),
  ).toBeVisible();

  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await capture(page, "rstorrent-demo-wide.png");

  const torrentRows = page
    .getByRole("grid", { name: "Torrents" })
    .getByRole("row");
  const detail = page.getByRole("region", { name: "Torrent details" });
  await page.getByRole("tab", { name: "General" }).click();
  await torrentRows.nth(2).focus();
  await page.keyboard.press("ArrowDown");
  await expect(torrentRows.nth(3)).toHaveAttribute("aria-current", "true");
  await expect(
    detail.getByRole("heading", { name: "Sintel 4K open movie" }),
  ).toBeVisible();

  await page.keyboard.press("Shift+ArrowUp");
  await expect(torrentRows.nth(2)).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("2 selected")).toBeVisible();
  await expect(
    detail.getByRole("heading", {
      name: "Big Buck Bunny 1080p surround",
    }),
  ).toBeVisible();

  await page.keyboard.press("Control+a");
  await expect(page.getByText("3 selected")).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await expect(torrentRows.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("3 selected")).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", {
      name: "Deselect Arch Linux 2026.08.01 x86_64",
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", {
      name: "Select Big Buck Bunny 1080p surround",
    }),
  ).not.toBeChecked();
  await expect(
    detail.getByRole("heading", { name: "Arch Linux 2026.08.01 x86_64" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("3 selected")).toHaveCount(0);
  await expect(torrentRows.nth(1)).toHaveAttribute("aria-current", "true");
});

test("typed torrent ETA stays explicit across responsive surfaces", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=healthy-download&at=42000&autoplay=0");

  let transfers = page.getByRole("grid", { name: "Torrents" });
  let primary = transfers.getByRole("row").filter({
    hasText: "Big Buck Bunny 1080p surround",
  });
  const estimate = primary.getByLabel(/Estimated time remaining:/);
  await expect(estimate).toHaveText("55s");
  await expect(estimate).toHaveAttribute(
    "title",
    "Estimated time remaining: 55s",
  );

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("tab", { name: "Connection & seeding" }).click();
  await expect(
    settings.getByRole("spinbutton", { name: "Max active downloads" }),
  ).toHaveValue("3");
  await settings.getByText("Network details").click();
  await expect(settings.getByText("Active downloads: 0 of 3")).toBeVisible();
  await settings.getByRole("tab", { name: "Appearance" }).click();
  await settings.getByRole("radio", { name: /Compact/ }).check();
  await page.keyboard.press("Escape");
  await expect(primary.getByLabel(/Estimated time remaining:/)).toHaveText(
    "55s",
  );

  await page.goto("/?demo=healthy-download&at=7500&autoplay=0");
  transfers = page.getByRole("grid", { name: "Torrents" });
  primary = transfers.getByRole("row").filter({
    hasText: "Big Buck Bunny 1080p surround",
  });
  await expect(primary.getByLabel("Calculating ETA")).toHaveText("—");

  await page.goto("/?demo=healthy-download&at=0&autoplay=0");
  transfers = page.getByRole("grid", { name: "Torrents" });
  primary = transfers.getByRole("row").filter({
    hasText: "Big Buck Bunny 1080p surround",
  });
  await expect(primary.getByLabel("ETA unavailable")).toHaveText("—");

  await page.goto("/?demo=swarm-lifecycle&at=11000&autoplay=0");
  transfers = page.getByRole("grid", { name: "Torrents" });
  primary = transfers.getByRole("row").filter({
    hasText: "Big Buck Bunny — swarm registry inspection",
  });
  const stalled = primary.getByLabel("Transfer stalled");
  await expect(stalled).toHaveText("∞");
  await expect(stalled).toHaveAttribute("title", "Transfer stalled");

  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    transfers.getByRole("columnheader", { name: "ETA" }),
  ).toHaveCount(1);
  await expect(transfers.getByRole("columnheader", { name: "Name" })).toBeVisible();
  await expect
    .poll(() =>
      transfers.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    )
    .toBe(true);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
});

test("detail tabs keep equal stable footprints with narrow scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, "tracker-recovery", 24_000);

  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(10);
  await expect(tabs.locator("span")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Peers" })).toHaveText("Peers");
  await expect(page.getByRole("tab", { name: "Trackers" })).toHaveText(
    "Trackers",
  );
  await expect
    .poll(() =>
      page
        .getByRole("tab", { name: "Disk" })
        .evaluate((element) => getComputedStyle(element).borderLeftWidth),
    )
    .toBe("1px");

  const tabNames = [
    "General",
    "Trackers",
    "Peers",
    "Swarm",
    "Files",
    "Pieces",
    "Disk",
    "Logs",
    "Speed",
    "DHT",
  ];
  for (const width of [1440, 920, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) {
      await page
        .getByRole("grid", { name: "Torrents" })
        .locator("[data-row-id]")
        .first()
        .click();
      await expect(tabs).toHaveCount(10);
    }
    const initialGeometry = await tabGeometry(page);
    expect(new Set(initialGeometry.map((tab) => tab.width)).size).toBe(1);
    if (width === 390) {
      expect(
        await page
          .getByRole("tablist", { name: "Torrent detail views" })
          .evaluate((element) => element.scrollWidth > element.clientWidth),
      ).toBe(true);
    }
    for (const name of tabNames) {
      const tab = page.getByRole("tab", { name });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      expect(await tabGeometry(page)).toEqual(initialGeometry);
    }
  }
});

test("peer flags expose a complete accessible legend without sorting", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await openScenario(page, "healthy-download", 42_000);

  const peers = page.getByRole("grid", { name: "Active peer connections" });
  await expect(peers.getByText("libtorrent 2.0.13").first()).toBeVisible();
  const header = page.getByRole("columnheader", { name: "Flags" });
  const help = page.getByRole("button", { name: "Explain Flags" });
  await expect(page.getByLabel(/^Peer flags:/).first()).toBeVisible();
  await expect(header).not.toHaveAttribute("aria-sort");
  await help.click();
  const legend = page.getByRole("dialog", { name: "Flags column help" });
  await expect(legend).toBeVisible();
  await expect(legend).toBeFocused();
  await expect(legend.locator("dt code")).toHaveCount(16);
  await expect(legend.getByText("Incoming", { exact: true })).toBeVisible();
  await expect(
    legend.getByText("Encrypted or obfuscated", { exact: true }),
  ).toBeVisible();
  await expect(
    legend.getByText("Peer flag legend", { exact: true }),
  ).toHaveCount(0);
  await expect(legend.getByText(/case-sensitive/)).toHaveCount(0);
  await expect(legend.getByText(/remote peer initiated/)).toHaveCount(0);
  const legendType = await legend.evaluate((element) => {
    const content = element.firstElementChild;
    const nodes = [
      content?.querySelector("h3"),
      content?.querySelector("dt code"),
      content?.querySelector("dd"),
    ].filter((node): node is Element => node !== null && node !== undefined);
    return {
      fontSizes: nodes.map((node) =>
        Number.parseFloat(globalThis.getComputedStyle(node).fontSize),
      ),
      fontWeights: nodes.map(
        (node) => globalThis.getComputedStyle(node).fontWeight,
      ),
    };
  });
  expect(Math.max(...legendType.fontSizes)).toBeLessThanOrEqual(11);
  expect(legendType.fontWeights).toEqual(["400", "400", "400"]);
  const compactLegendBounds = await legend.boundingBox();
  expect(compactLegendBounds).not.toBeNull();
  expect(compactLegendBounds!.width).toBeLessThanOrEqual(260);
  expect(compactLegendBounds!.height).toBeLessThanOrEqual(360);
  await expect(header).not.toHaveAttribute("aria-sort");
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  await capture(page, "rstorrent-peer-flags-light.png");

  await page.keyboard.press("Escape");
  await expect(legend).not.toBeVisible();
  await expect(help).toBeFocused();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("radio", { name: /Dark/ }).check();
  await settings.getByRole("radio", { name: /Compact/ }).check();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 920, height: 720 });
  await expect(peers.getByText("libtorrent 2.0.13").first()).toBeVisible();
  await help.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => Math.round((await help.boundingBox())?.width ?? 0))
    .toBeGreaterThanOrEqual(24);
  await help.click();
  await expect(legend).toBeVisible();
  const legendBounds = await legend.boundingBox();
  expect(legendBounds).not.toBeNull();
  expect(legendBounds!.x).toBeGreaterThanOrEqual(0);
  expect(legendBounds!.x + legendBounds!.width).toBeLessThanOrEqual(920);
  expect(legendBounds!.y).toBeGreaterThanOrEqual(0);
  expect(legendBounds!.y + legendBounds!.height).toBeLessThanOrEqual(720);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  await capture(page, "rstorrent-peer-flags-dark.png");
  await page.mouse.click(4, 4);
  await expect(legend).not.toBeVisible();
});

test("interface size settings persist and keep geometry coherent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await openScenario(page, "healthy-download", 42_000);

  const app = page.locator("#app > [data-interface-size]");
  const library = page.getByRole("grid", { name: "Torrents" });
  const firstRow = library.locator("[data-row-id]").first();
  const more = page.getByRole("button", { name: "More", exact: true });
  await expect(app).toHaveAttribute("data-interface-size", "standard");
  await expect.poll(() => elementHeight(firstRow)).toBe(36);
  await expect.poll(() => elementHeight(more)).toBe(36);
  await expect
    .poll(async () =>
      Math.round((await more.locator("svg").boundingBox())?.width ?? 0),
    )
    .toBeGreaterThanOrEqual(17);
  const activeDetailTab = page.getByRole("tab", { name: "DHT" });
  await activeDetailTab.click();
  await expect.poll(() => detailTabIsFullyVisible(page, "DHT")).toBe(true);

  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const close = dialog.getByRole("button", { name: "Close settings" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("radio", { name: /Decimal/ })).toBeFocused();
  await dialog.getByRole("radio", { name: /Standard/ }).check();
  await expect.poll(() => detailTabWidths(page)).toEqual([100]);
  await expect.poll(() => detailTabIsFullyVisible(page, "DHT")).toBe(true);
  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await capture(page, "rstorrent-settings-standard.png");

  await dialog.getByRole("radio", { name: /Compact/ }).check();
  await expect(app).toHaveAttribute("data-interface-size", "compact");
  await expect.poll(() => detailTabWidths(page)).toEqual([88]);
  await expect.poll(() => detailTabIsFullyVisible(page, "DHT")).toBe(true);
  await expect.poll(() => elementHeight(firstRow)).toBe(32);
  await expect.poll(() => elementHeight(more)).toBe(30);
  await expect
    .poll(async () =>
      Math.round((await more.locator("svg").boundingBox())?.width ?? 0),
    )
    .toBeGreaterThanOrEqual(16);
  await capture(page, "rstorrent-settings-compact.png");

  await dialog.getByRole("radio", { name: /Spacious/ }).check();
  await expect(app).toHaveAttribute("data-interface-size", "spacious");
  await expect.poll(() => detailTabWidths(page)).toEqual([112]);
  await expect.poll(() => detailTabIsFullyVisible(page, "DHT")).toBe(true);
  await expect.poll(() => elementHeight(firstRow)).toBe(42);
  await expect.poll(() => elementHeight(more)).toBe(44);
  await capture(page, "rstorrent-settings-spacious.png");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(settings).toBeFocused();

  await page.reload();
  await expect(app).toHaveAttribute("data-interface-size", "spacious");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const phoneDialog = page.getByRole("dialog", { name: "Settings" });
  await expect(phoneDialog).toBeVisible();
  await expect
    .poll(async () => Math.round((await phoneDialog.boundingBox())?.width ?? 0))
    .toBe(390);
  const phoneViolations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(phoneViolations).toEqual([]);
  await capture(page, "rstorrent-settings-phone.png");
});

test("seeding priority settings stay truthful across responsive layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openScenario(page, "healthy-download", 42_000);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("tab", { name: "Connection & seeding" }).click();
  const queue = dialog.getByRole("region", { name: "Queue" });
  const priority = dialog.getByRole("region", { name: "Seeding goals" });
  await expect(
    priority.getByText(/Reaching a goal doesn't stop seeding/i),
  ).toBeVisible();
  await expect(
    queue.getByRole("spinbutton", { name: "Max active seeds" }),
  ).toHaveValue("5");
  await expect(
    priority.getByRole("spinbutton", { name: "Share ratio" }),
  ).toHaveValue("200");
  await expect(
    priority.getByRole("spinbutton", {
      name: "Seeding time vs. download time",
    }),
  ).toHaveValue("700");
  await expect(
    priority.getByRole("spinbutton", { name: "Seeding time", exact: true }),
  ).toHaveValue("86400");
  await expect(priority.getByText("seconds (1d 0h)")).toBeVisible();
  await dialog.getByText("Network details").click();
  await expect(dialog.getByText("Active seeds: 0 of 5")).toBeVisible();
  const unlimited = queue.getByRole("checkbox", {
    name: /No limit on active seeds/,
  });
  await unlimited.check();
  await expect(
    queue.getByRole("spinbutton", { name: "Max active seeds" }),
  ).toBeDisabled();
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  await capture(page, "rstorrent-seeding-settings-wide.png");

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const phoneDialog = page.getByRole("dialog", { name: "Settings" });
  await phoneDialog.getByRole("tab", { name: "Connection & seeding" }).click();
  const phonePriority = phoneDialog.getByRole("region", {
    name: "Seeding goals",
  });
  await phonePriority.scrollIntoViewIfNeeded();
  await expect(
    phonePriority.getByText(/Reaching a goal doesn't stop seeding/i),
  ).toBeVisible();
  await expect
    .poll(async () => Math.round((await phoneDialog.boundingBox())?.width ?? 0))
    .toBe(390);
  const horizontalOverflow = await phoneDialog.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(0);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  await capture(page, "rstorrent-seeding-settings-phone.png");
});

test("torrent settings dialog stays operable across responsive layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, "healthy-download", 42_000, true);
  await page.getByRole("tab", { name: "General" }).click();
  const details = page.getByRole("region", { name: "Torrent details" });
  await expect(details.getByRole("combobox", { name: "Upload" })).toHaveCount(0);
  const more = page.getByRole("button", { name: /^More/ });
  await more.click();
  await page.getByRole("menuitem", { name: "Torrent settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Torrent settings" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  const uploadChoice = dialog.getByRole("combobox", { name: "Upload" });
  const upload = dialog.getByRole("spinbutton", {
    name: "Upload, custom speed in KB per second",
  });
  const downloadChoice = dialog.getByRole("combobox", { name: "Download" });

  await expect(uploadChoice).toHaveValue("unlimited");
  await uploadChoice.selectOption({ label: "Custom…" });
  await upload.fill("48");
  await downloadChoice.selectOption({ label: "1 MB/s" });
  await page.waitForTimeout(1_250);
  await expect(downloadChoice).toHaveValue("1024");
  await expect(upload).toHaveValue("48");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Saved")).toBeVisible();

  await page.setViewportSize({ width: 920, height: 720 });
  await expect(dialog).toBeVisible();
  await expect(upload).toHaveValue("48");
  await expect(downloadChoice).toHaveValue("1024");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await uploadChoice.selectOption({ label: "Unlimited" });
  await expect(upload).toHaveCount(0);
  await uploadChoice.selectOption({ label: "Custom…" });
  await expect(upload).toBeEnabled();
  await expect(upload).toHaveValue("48");

  await uploadChoice.focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(more).toBeFocused();
  const torrentRow = page.getByRole("grid", { name: "Torrents" })
    .getByRole("row")
    .filter({ hasText: "Big Buck Bunny" });
  await torrentRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Torrent settings" }).click();
  await expect(dialog).toBeVisible();
  const dialogViolations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(dialogViolations).toEqual([]);
  await capture(page, "rstorrent-torrent-settings-phone.png");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(torrentRow).toBeFocused();

  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
});

test("global settings draft survives complete autoplay publications", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_024, height: 800 });
  await page.goto("/?demo=healthy-download&at=42000&autoplay=1");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("tab", { name: "Connection & seeding" }).click();
  const limit = dialog.getByRole("spinbutton", {
    name: "Max peer connections",
  });
  const save = dialog.getByRole("button", { name: "Save settings" });

  await limit.fill("321");
  await page.waitForTimeout(1_250);
  await expect(limit).toHaveValue("321");
  await save.click();
  await expect(limit).toHaveValue("321");
  await expect(save).toBeDisabled();
});

test("color themes follow or override system appearance and persist", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.emulateMedia({ colorScheme: "dark" });
  await openScenario(page, "healthy-download", 42_000);

  const root = page.locator("html");
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
    "content",
    "light dark",
  );
  await expect(root).toHaveAttribute("data-color-theme", "auto");
  await expect
    .poll(() => themeMetrics(page))
    .toEqual({
      colorScheme: "dark",
      background: "rgb(24, 22, 20)",
    });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(
    dialog
      .getByRole("group", { name: "Color theme" })
      .getByRole("radio", { name: /Auto/ }),
  ).toBeChecked();
  const dataUnits = dialog.getByRole("group", { name: "Size units" });
  await expect(dataUnits.getByRole("radio", { name: /^KB, MB, GB/ })).toBeChecked();
  await dataUnits.getByRole("radio", { name: /Decimal/ }).check();
  await expect(dataUnits.getByRole("radio", { name: /Decimal/ })).toBeChecked();
  await capture(page, "rstorrent-settings-auto-dark.png");

  await dialog.getByRole("radio", { name: /Light/ }).check();
  await expect(root).toHaveAttribute("data-color-theme", "light");
  await expect
    .poll(() => themeMetrics(page))
    .toEqual({
      colorScheme: "light",
      background: "rgb(255, 255, 255)",
    });
  const lightViolations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(lightViolations).toEqual([]);
  await capture(page, "rstorrent-settings-explicit-light.png");

  await dialog.getByRole("radio", { name: /Dark/ }).check();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-color-theme", "dark");
  await expect
    .poll(() => themeMetrics(page))
    .toEqual({
      colorScheme: "dark",
      background: "rgb(24, 22, 20)",
    });
  const darkViolations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(darkViolations).toEqual([]);
  await capture(page, "rstorrent-settings-explicit-dark.png");

  await dialog
    .getByRole("group", { name: "Color theme" })
    .getByRole("radio", { name: /Auto/ })
    .check();
  await expect
    .poll(() => themeMetrics(page))
    .toEqual({
      colorScheme: "light",
      background: "rgb(255, 255, 255)",
    });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() => themeMetrics(page))
    .toEqual({
      colorScheme: "dark",
      background: "rgb(24, 22, 20)",
    });

  await dialog.getByRole("radio", { name: /Dark/ }).check();
  expect(
    await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("rstorrent.presentation.appearance") ?? "null",
      ),
    ),
  ).toEqual({
    version: 3,
    interfaceSize: "standard",
    colorTheme: "dark",
    dataUnits: "decimal",
  });
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (document.querySelector("#app")?.firstElementChild) {
        sessionStorage.setItem(
          "rstorrent.theme-at-first-content",
          document.documentElement.dataset.colorTheme ?? "",
        );
        observer.disconnect();
      }
    });
    document.addEventListener(
      "readystatechange",
      () =>
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        }),
      { once: true },
    );
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.getByText("JSTorrent", { exact: true })).toBeVisible();
  await expect(root).toHaveAttribute("data-color-theme", "dark");
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
    "content",
    "dark",
  );
  await expect
    .poll(() => themeMetrics(page))
    .toEqual({
      colorScheme: "dark",
      background: "rgb(24, 22, 20)",
    });
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("rstorrent.theme-at-first-content"),
    ),
  ).toBe("dark");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "Size units" })
      .getByRole("radio", { name: /Decimal/ }),
  ).toBeChecked();
});

test("data units reformat mounted product surfaces without changing raw state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openScenario(page, "healthy-download", 42_000);

  const transfers = page.getByRole("grid", { name: "Torrents" });
  const transferOrder = await transfers
    .locator("[data-row-id]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row-id")));
  await expectVisibleUnits(page, "binary");
  const binarySize = await transfers.getByText(/\d (?:KB|MB|GB)$/).first().textContent();
  await setDataUnits(page, "Decimal");
  await expectVisibleUnits(page, "decimal");
  expect(
    await transfers.getByText(/\d (?:kB|MB|GB)$/).first().textContent(),
  ).not.toBe(binarySize);
  expect(
    await transfers
      .locator("[data-row-id]")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-row-id")),
      ),
  ).toEqual(transferOrder);

  const primary = page.getByRole("navigation", { name: "Primary" });
  await primary.getByRole("button", { name: "Library" }).click();
  await expectVisibleUnits(page, "decimal");
  await page
    .getByRole("button", { name: "Open details for Sintel 4K open movie" })
    .click();
  await page.getByRole("button", { name: "Open in Torrents" }).click();
  await page.getByRole("tab", { name: "General" }).click();
  await expectVisibleUnits(page, "decimal");
  await page.getByRole("tab", { name: "Files" }).click();
  await expectVisibleUnits(page, "decimal");
  await setDataUnits(page, "Binary");
  await expectVisibleUnits(page, "binary");

  await openScenario(page, "slow-disk-pressure", 20_000);
  await page.getByRole("tab", { name: "Disk" }).click();
  await expectVisibleUnits(page, "binary");
  await expect(page.getByRole("heading", { name: "Active storage pieces" })).toBeVisible();
  await setDataUnits(page, "Decimal");
  await expectVisibleUnits(page, "decimal");
  await expect(page.getByRole("heading", { name: "Active storage pieces" })).toBeVisible();

  await openScenario(page, "dht-observatory", 42_000);
  await page.getByRole("tab", { name: "DHT" }).click();
  await expectVisibleUnits(page, "decimal");

  await openScenario(page, "speed-bursty", 42_000);
  await page.getByRole("tab", { name: "Speed" }).click();
  await expectVisibleUnits(page, "decimal");
  const canvas = page.getByRole("img", { name: /Speed history chart/ });
  const canvasSize = await canvas.boundingBox();
  await setDataUnits(page, "Binary");
  await expectVisibleUnits(page, "binary");
  expect(await canvas.boundingBox()).toEqual(canvasSize);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const phoneSettings = page.getByRole("dialog", { name: "Settings" });
  await expect(
    phoneSettings.getByRole("group", { name: "Size units" }),
  ).toBeVisible();
  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(phoneSettings).not.toBeVisible();
});

test("compact tracker recovery remains legible", async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 720 });
  await openScenario(page, "tracker-recovery", 24_000);
  await expect(
    page.getByRole("grid", { name: "Active peer connections" }),
  ).toHaveAttribute("aria-rowcount", "15");
  await page.getByRole("tab", { name: "Trackers" }).click();
  const trackers = page.getByRole("grid", { name: "Torrent trackers" });
  await expect(trackers).toHaveAttribute("aria-rowcount", "3");
  await expect(
    trackers.getByRole("row").filter({ hasText: "42" }),
  ).toContainText("Announce in");
  await expect(trackers.getByText("reannounce wait").first()).toBeVisible();
  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await capture(page, "rstorrent-trackers-compact.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("grid", { name: "Torrents" })
    .getByRole("row")
    .filter({ hasText: "Big Buck Bunny" })
    .click();
  await expect(trackers).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Torrent details" }).getByRole("button", { name: "Torrents", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page
        .getByRole("navigation", { name: "Torrent filters" })
        .evaluate((element) =>
          Math.round(element.getBoundingClientRect().right),
        ),
    )
    .toBeLessThanOrEqual(0);
  await capture(page, "rstorrent-trackers-phone.png");
});

test("swarm lifecycle remains readable and accessible across layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await openScenario(page, "swarm-lifecycle", 24_000);
  await page.getByRole("tab", { name: "Swarm" }).click();
  const swarm = page.getByRole("grid", { name: "Known swarm peers" });
  await expect(swarm).toHaveAttribute("aria-rowcount", "9");
  await expect(page.getByLabel("Swarm registry summary")).toContainText(
    /8.*known/,
  );
  await expect(swarm.getByText("backed off").first()).toBeVisible();
  await expect(swarm.getByText(/TRACKER · DHT/).first()).toBeVisible();
  let violations = (await new AxeBuilder({ page }).analyze()).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await capture(page, "rstorrent-swarm-wide.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("grid", { name: "Torrents" })
    .getByRole("row")
    .filter({ hasText: "Big Buck Bunny" })
    .click();
  await expect(swarm).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Torrent details" }).getByRole("button", { name: "Torrents", exact: true }),
  ).toBeVisible();
  const expectedColumns = [
    "State",
    "Address",
    "Sources",
    "Last seen",
    "Retry",
    "Downloaded",
    "Uploaded",
    "Dials",
    "Fails",
    "Trust",
    "Parole",
  ];
  const columns = page.getByRole("button", { name: "Columns" }).last();
  await columns.click();
  const columnDialog = page.getByRole("dialog", {
    name: "Table column settings",
  });
  for (const name of expectedColumns) {
    await expect(
      columnDialog.getByRole("checkbox", { name }),
    ).toBeChecked();
  }
  await page.keyboard.press("Escape");
  await expect(columnDialog).not.toBeVisible();

  for (const width of [390, 456]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    await expect(swarm).toBeVisible();
    await expect
      .poll(() =>
        swarm.getByRole("columnheader").evaluateAll((headers) =>
          headers.map((header) => header.getAttribute("aria-label")),
        ),
      )
      .toEqual(expectedColumns);
    await swarm.evaluate((element) => {
      element.scrollLeft = 0;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect
      .poll(() =>
        swarm.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })),
      )
      .toMatchObject({ clientWidth: width });
    expect(
      await swarm.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    const tableContainer = swarm.locator("..");
    await expect(tableContainer).toHaveAttribute("data-overflow-left", "false");
    await expect(tableContainer).toHaveAttribute("data-overflow-right", "true");

    await swipeTableLeft(page, swarm);
    await expect
      .poll(() => swarm.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await expect(tableContainer).toHaveAttribute("data-overflow-left", "true");

    await swarm.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect(tableContainer).toHaveAttribute("data-overflow-right", "false");
    const finalColumnBounds = await swarm
      .getByRole("columnheader", { name: "Parole" })
      .boundingBox();
    expect(finalColumnBounds).not.toBeNull();
    expect(finalColumnBounds!.x).toBeGreaterThanOrEqual(0);
    expect(finalColumnBounds!.x + finalColumnBounds!.width).toBeLessThanOrEqual(
      width,
    );
  }
  violations = (await new AxeBuilder({ page }).analyze()).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await capture(page, "rstorrent-swarm-phone.png");
});

test("global disk pipeline shows pressure and responsive piece work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, "slow-disk-pressure", 20_000);
  await page.getByRole("tab", { name: "Disk" }).click();
  await expect(page.getByText("Receive → write → verify")).toBeVisible();
  await expect(page.getByLabel("Disk pressure Backpressured")).toBeVisible();
  await expect(page.getByText("intake paused now")).toBeVisible();
  const pieces = page.getByRole("grid", { name: "Active storage pieces" });
  await expect(pieces).toHaveAttribute("aria-rowcount", "65");
  expect(await pieces.getByRole("row").count()).toBeLessThanOrEqual(100);
  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await capture(page, "rstorrent-disk-wide.png");

  await page.setViewportSize({ width: 920, height: 720 });
  await expect(pieces).toBeVisible();
  await capture(page, "rstorrent-disk-compact.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("grid", { name: "Torrents" })
    .getByRole("row")
    .filter({ hasText: "Big Buck Bunny" })
    .click();
  await expect(
    page.getByRole("region", { name: "Torrent details" }).getByRole("button", { name: "Torrents", exact: true }),
  ).toBeVisible();
  await expect(pieces).toBeVisible();
  await expect
    .poll(async () =>
      page
        .getByRole("navigation", { name: "Torrent filters" })
        .evaluate((element) =>
          Math.round(element.getBoundingClientRect().right),
        ),
    )
    .toBeLessThanOrEqual(0);
  await capture(page, "rstorrent-disk-phone.png");
});

test("speed controls remain wheel-scrollable in a short desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 631 });
  await openScenario(page, "speed-bursty", 42_000);
  await page.getByRole("tab", { name: "Speed" }).click();
  const panel = page.getByLabel("Session speed history");
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(631);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height - 20);
  await page.mouse.wheel(0, 900);
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(panel.getByRole("button", { name: "DHT in" })).toBeInViewport();
  await panel.getByRole("button", { name: "DHT in" }).click();
  await expect(panel.getByText("3 of 8")).toBeVisible();
});

test("speed history stays exact, selectable, and accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openScenario(page, "speed-bursty", 42_000);
  await page.getByRole("tab", { name: "Speed" }).click();

  const panel = page.getByLabel("Session speed history");
  const chart = page.getByRole("img", { name: /Speed history chart/ });
  await expect(panel).toContainText("All torrents");
  await expect(chart).toBeVisible();
  await expect(
    page.getByLabel("Selected speed window summaries"),
  ).toContainText("Download");

  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(panel.getByRole("status")).toContainText(/Download.*\/s/);

  await panel.getByRole("button", { name: "DHT in" }).click();
  await expect(panel.getByText("3 of 8")).toBeVisible();
  const historyRange = panel.getByRole("combobox", { name: "History" });
  await historyRange.selectOption("hours24");
  await expect(historyRange).toHaveValue("hours24");

  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await capture(page, "rstorrent-speed-wide.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("grid", { name: "Torrents" })
    .getByRole("row")
    .filter({ hasText: "Big Buck Bunny" })
    .click();
  await expect(chart).toBeVisible();
  await capture(page, "rstorrent-speed-phone.png");

  await page.setViewportSize({ width: 1280, height: 820 });
  await openScenario(page, "speed-stale", 42_000);
  await page.getByRole("tab", { name: "Speed" }).click();
  await expect(page.getByText("Frozen · stale")).toBeVisible();
});

test("piece canvas shows retry truth and bounds a large torrent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, "piece-retry", 10_000);
  await page.getByRole("tab", { name: "Pieces" }).click();
  const retryMap = page.getByRole("img", {
    name: /1,055 pieces: 450 verified, 1 active/i,
  });
  await expect(retryMap).toBeVisible();
  await expect(page.getByLabel("Piece state legend")).toBeVisible();
  const retryCanvas = await retryMap.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return {
      width: canvas.width,
      height: canvas.height,
      cssHeight: Math.round(canvas.getBoundingClientRect().height),
    };
  });
  expect(retryCanvas.height).toBeGreaterThan(0);
  expect(retryCanvas.cssHeight).toBeLessThanOrEqual(1_024);
  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await capture(page, "rstorrent-pieces-retry-wide.png");

  await page.setViewportSize({ width: 920, height: 720 });
  await expect(retryMap).toBeVisible();
  await capture(page, "rstorrent-pieces-retry-compact.png");

  await openScenario(page, "large-swarm", 0);
  await page.getByRole("tab", { name: "Pieces" }).click();
  const largeMap = page.getByRole("img", {
    name: /250,000 pieces: 135,000 verified, 6 active/i,
  });
  await expect(largeMap).toBeVisible();
  const largeMetrics = await page.evaluate(() => ({
    domElements: document.getElementsByTagName("*").length,
    canvas: [...document.querySelectorAll("canvas")].map((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      cssHeight: Math.round(canvas.getBoundingClientRect().height),
    })),
  }));
  expect(largeMetrics.domElements).toBeLessThan(1_500);
  expect(largeMetrics.canvas).toHaveLength(1);
  expect(largeMetrics.canvas[0]?.cssHeight).toBeLessThanOrEqual(1_024);
  expect(largeMetrics.canvas[0]?.width).toBeLessThanOrEqual(920 * 3);
  await capture(page, "rstorrent-pieces-large.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("grid", { name: "Torrents" })
    .getByRole("row")
    .nth(1)
    .click();
  await expect(
    page.getByRole("region", { name: "Torrent details" }).getByRole("button", { name: "Torrents", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page
        .getByRole("navigation", { name: "Torrent filters" })
        .evaluate((element) =>
          Math.round(element.getBoundingClientRect().right),
        ),
    )
    .toBeLessThanOrEqual(0);
  await expect(page.getByRole("tab", { name: "Pieces" })).toBeInViewport();
  await expect(largeMap).toBeVisible();
  await capture(page, "rstorrent-pieces-phone.png");
  console.log(`piece_scale_metrics ${JSON.stringify(largeMetrics)}`);
});

test("metadata preparation stays compact and accessible across widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_180, height: 760 });
  await openScenario(page, "stalled-metadata", 45_000);
  await page.getByRole("tab", { name: "General" }).click();

  const progress = page.getByRole("progressbar", {
    name: "Torrent info received",
  });
  await expect(progress).toHaveAttribute("max", "8388608");
  await expect(progress).toHaveAttribute("value", "2097152");
  const map = page.getByRole("img", {
    name: "Torrent info: 128 received, 0 requested, 384 missing",
  });
  await expect(map).toBeVisible();
  const wideMetrics = await page.evaluate(() => ({
    domElements: document.getElementsByTagName("*").length,
    canvases: document.querySelectorAll("canvas").length,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(wideMetrics.canvases).toBe(1);
  expect(wideMetrics.domElements).toBeLessThan(1_500);
  expect(wideMetrics.scrollWidth).toBeLessThanOrEqual(wideMetrics.clientWidth);
  await capture(page, "rstorrent-metadata-progress-wide.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("grid", { name: "Torrents" })
    .getByRole("row")
    .nth(1)
    .click();
  await expect(map).toBeVisible();
  const phoneOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(phoneOverflow).toBeLessThanOrEqual(0);
  await capture(page, "rstorrent-metadata-progress-phone.png");
});

test("removal keeps data by default and exposes destructive intent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 920, height: 720 });
  await openScenario(page, "healthy-download", 42_000);
  const trigger = page.getByRole("button", { name: "Remove", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Remove torrent?" });
  const deleteData = dialog.getByRole("checkbox", {
    name: "Also delete downloaded data",
  });
  await expect(deleteData).not.toBeChecked();
  await deleteData.check();
  await expect(dialog.getByRole("alert")).toContainText("cannot be undone");
  const destructive = dialog.getByRole("button", {
    name: "Remove and delete data",
  });
  await destructive.focus();
  await page.keyboard.press("Tab");
  await expect(deleteData).toBeFocused();
  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await capture(page, "rstorrent-remove-dialog.png");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();

  await trigger.click();
  const retained = page.getByRole("dialog", { name: "Remove torrent?" });
  await expect(retained.getByRole("checkbox")).not.toBeChecked();
  await retained.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(retained).not.toBeVisible();
  await expect(
    page.getByText("Removed Big Buck Bunny 1080p surround", { exact: true }),
  ).toBeVisible();
});

test("diagnostic console stays ordered, filtered, and virtualized", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, "diagnostic-console", 45_000);
  await page.getByRole("tab", { name: "Logs" }).click();
  const feed = page.getByRole("log", {
    name: "Chronological diagnostic events",
  });
  await expect(feed).toBeVisible();
  await expect(page.getByText("2,048 kept", { exact: true })).toBeVisible();
  expect(await feed.locator("article").count()).toBeLessThan(60);

  await page.getByLabel("Log detail level").selectOption("trace");
  await expect(page.getByText("High-volume producer capture")).toBeVisible();
  await page.getByLabel("Minimum displayed severity").selectOption("warning");
  await page.getByLabel("Displayed torrent scope").selectOption("all");
  await expect(page.getByText("410 shown", { exact: true })).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search diagnostics" })
    .fill("watermark");
  await expect(page.getByText("59 shown", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: /^Expand/ })
    .first()
    .click();
  await expect(page.getByText("event index").first()).toBeVisible();

  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  const metrics = await page.evaluate(() => {
    const measuredPerformance = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    return {
      domElements: document.querySelectorAll("*").length,
      renderedRecords: document.querySelectorAll('[role="log"] article').length,
      usedJsHeapBytes: measuredPerformance.memory?.usedJSHeapSize ?? null,
    };
  });
  expect(metrics.domElements).toBeLessThan(1_500);
  expect(metrics.renderedRecords).toBeLessThan(60);
  if (metrics.usedJsHeapBytes !== null) {
    expect(metrics.usedJsHeapBytes).toBeLessThan(256 * 1024 * 1024);
  }
  await capture(page, "rstorrent-diagnostic-console-wide.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("row", { name: /Big Buck Bunny/ }).click();
  await page.getByRole("tab", { name: "Logs" }).click();
  const phoneFeed = page.getByRole("log", {
    name: "Chronological diagnostic events",
  });
  await expect(phoneFeed).toBeVisible();
  expect(await phoneFeed.locator("article").count()).toBeLessThan(60);
  await capture(page, "rstorrent-diagnostic-console-phone.png");
  console.log(`diagnostic_scale_metrics ${JSON.stringify(metrics)}`);
});

test("phone navigation opens a full detail surface", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openScenario(page, "healthy-download", 42_000);
  const library = page.getByRole("grid", { name: "Torrents" });
  await expect(library).toBeVisible();
  await library.getByRole("row").filter({ hasText: "Big Buck Bunny" }).click();
  const backButton = page.getByRole("region", { name: "Torrent details" }).getByRole("button", {
    name: "Torrents",
    exact: true,
  });
  await expect(backButton).toBeVisible();
  await expect(
    page.getByRole("grid", { name: "Active peer connections" }),
  ).toBeVisible();
  await capture(page, "rstorrent-demo-phone.png");
  await backButton.click();
  await expect(library).toBeVisible();
});

test("Workbench detail has a return path at the layout breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 844 });
  await openScenario(page, "healthy-download", 42_000);
  const library = page.getByRole("grid", { name: "Torrents" });
  const backButton = page.getByRole("region", { name: "Torrent details" }).getByRole("button", { name: "Torrents", exact: true });

  for (const width of [700, 701, 730, 760]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(library).toBeVisible();
    await library.getByRole("row").filter({ hasText: "Big Buck Bunny" }).click();
    await expect(library).toBeHidden();
    await expect(backButton).toBeVisible();

    if (width === 760) {
      await page.setViewportSize({ width: 761, height: 844 });
      await expect(library).toBeVisible();
      await expect(backButton).toBeHidden();
      await page.setViewportSize({ width: 760, height: 844 });
      await expect(library).toBeHidden();
      await expect(backButton).toBeVisible();
    }

    await backButton.click();
    await expect(library).toBeVisible();
  }
});

test("torrent scrolling survives running updates and retains keyboard navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?demo=large-swarm&at=0");
  const torrents = page.getByRole("grid", { name: "Torrents", exact: true });
  await expect(torrents).toHaveAttribute("aria-rowcount", "2001");
  await expect(torrents.locator('[data-row-index="0"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  const clock = page.getByLabel(/^Demo clock /);
  const clockSeconds = async () => {
    const label = (await clock.getAttribute("aria-label"))!;
    const [, minutes, seconds] = /^Demo clock (\d+):(\d+)$/.exec(label)!;
    return Number(minutes) * 60 + Number(seconds);
  };
  const bounds = (await torrents.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
  await page.mouse.wheel(0, 1800);
  await expect
    .poll(() => torrents.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(800);
  const scrolledTop = await torrents.evaluate((element) => element.scrollTop);
  const initialClockSeconds = await clockSeconds();
  const positions: number[] = [];
  for (let sample = 0; sample < 65; sample += 1) {
    await page.waitForTimeout(50);
    positions.push(await torrents.evaluate((element) => element.scrollTop));
  }
  expect((await clockSeconds()) - initialClockSeconds).toBeGreaterThanOrEqual(3);
  expect(Math.min(...positions)).toBe(scrolledTop);
  expect(Math.max(...positions)).toBe(scrolledTop);
  expect(await torrents.getByRole("row").count()).toBeLessThan(100);

  await torrents.press("End");
  await expect(torrents.locator('[data-row-index="1999"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect
    .poll(() => torrents.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(scrolledTop);
  await torrents.press("Home");
  await expect.poll(() => torrents.evaluate((element) => element.scrollTop)).toBe(0);
  await page.mouse.wheel(0, 1800);
  await expect
    .poll(() => torrents.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(800);
  await torrents.press("Home");
  await expect.poll(() => torrents.evaluate((element) => element.scrollTop)).toBe(0);
  await torrents.press("ArrowDown");
  await expect(torrents.locator('[data-row-index="1"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("large collections retain a bounded virtual DOM", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const target = window as Window & { __rstorrentLongTasks?: number[] };
    target.__rstorrentLongTasks = [];
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        target.__rstorrentLongTasks?.push(entry.duration);
      }
    }).observe({ type: "longtask", buffered: true });
  });
  const openedAt = performance.now();
  await openScenario(page, "large-swarm", 0);
  const initialRenderMs = performance.now() - openedAt;
  const torrents = page.getByRole("grid", { name: "Torrents" });
  const peers = page.getByRole("grid", { name: "Active peer connections" });
  await expect(torrents).toHaveAttribute("aria-rowcount", "2001");
  await expect(peers).toHaveAttribute("aria-rowcount", "10001");
  expect(await torrents.getByRole("row").count()).toBeLessThanOrEqual(100);
  expect(await peers.getByRole("row").count()).toBeLessThanOrEqual(100);

  const updateStartedAt = performance.now();
  await page.getByRole("button", { name: "+10s" }).click();
  await expect(page.getByLabel("Demo clock 00:10")).toBeVisible();
  const updateRenderMs = performance.now() - updateStartedAt;
  await torrents.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await peers.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  const browserMetrics = await page.evaluate(() => {
    const measuredPerformance = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    const measuredWindow = window as Window & {
      __rstorrentLongTasks?: number[];
    };
    const longTasks = measuredWindow.__rstorrentLongTasks ?? [];
    return {
      domElements: document.getElementsByTagName("*").length,
      usedJsHeapBytes: measuredPerformance.memory?.usedJSHeapSize ?? null,
      longTaskCount: longTasks.length,
      longestTaskMs: longTasks.length === 0 ? 0 : Math.max(...longTasks),
      longTaskTotalMs: longTasks.reduce((sum, value) => sum + value, 0),
    };
  });
  expect(browserMetrics.domElements).toBeLessThan(2_000);
  if (browserMetrics.usedJsHeapBytes !== null) {
    expect(browserMetrics.usedJsHeapBytes).toBeLessThan(256 * 1024 * 1024);
  }
  expect(initialRenderMs).toBeLessThan(5_000);
  expect(updateRenderMs).toBeLessThan(5_000);
  await page.getByRole("tab", { name: "Swarm" }).click();
  const swarm = page.getByRole("grid", { name: "Known swarm peers" });
  await expect(swarm).toHaveAttribute("aria-rowcount", "1001");
  expect(await swarm.getByRole("row").count()).toBeLessThanOrEqual(100);
  expect(await page.locator("*").count()).toBeLessThan(2_000);
  const primary = page.getByRole("navigation", { name: "Primary" });
  await primary.getByRole("button", { name: "Torrents" }).click();
  const transferQueue = page.getByRole("grid", { name: "Torrents" });
  await expect(transferQueue).toHaveAttribute("aria-rowcount", "2001");
  expect(await transferQueue.getByRole("row").count()).toBeLessThanOrEqual(100);
  await primary.getByRole("button", { name: "Library" }).click();
  const content = page.getByRole("list", { name: "Torrent-backed content" });
  const contentCards = content.getByRole("listitem");
  expect(await contentCards.count()).toBeLessThanOrEqual(100);
  await expect(contentCards.first()).toHaveAttribute("aria-setsize", "2000");
  expect(await page.locator("*").count()).toBeLessThan(2_000);
  console.log(
    `scale_metrics ${JSON.stringify({ initialRenderMs: Math.round(initialRenderMs), updateRenderMs: Math.round(updateRenderMs), ...browserMetrics })}`,
  );
});

test("full file catalog stays virtualized across wide compact and phone layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const openedAt = performance.now();
  await openScenario(page, "file-progress", 24_000);
  await page.getByRole("tab", { name: "Files" }).click();
  const files = page.getByRole("grid", { name: "Torrent files" });
  await expect(files).toHaveAttribute("aria-rowcount", "4096");
  await expect(page.getByText("1 padding hidden")).toBeVisible();
  expect(await files.getByRole("row").count()).toBeLessThanOrEqual(100);
  await expect(files.getByRole("checkbox").first()).toBeVisible();
  const initialRenderMs = Math.round(performance.now() - openedAt);
  await files.getByRole("row").nth(1).click();
  await page.getByRole("button", { name: "More file actions" }).click();
  const fileActions = page.getByRole("menu", { name: "More file actions" });
  await expect(
    fileActions.getByRole("menuitem", { name: "Normal", exact: true }),
  ).toBeDisabled();
  await expect(
    fileActions.getByRole("menuitem", { name: "Download now", exact: true }),
  ).toBeDisabled();
  await expect(
    fileActions.getByRole("menuitem", { name: "Skip", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("File actions are unavailable in demo scenarios."),
  ).toBeVisible();
  await capture(page, "rstorrent-file-actions-wide.png");
  await page.keyboard.press("Escape");
  await files.getByRole("row").nth(1).focus();
  await page.keyboard.press("ArrowDown");
  await expect(files.getByRole("row").nth(2)).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.keyboard.press("Shift+ArrowDown");
  await expect(files).toHaveAttribute("aria-multiselectable", "true");
  await expect(page.getByText("2 selected")).toBeVisible();
  await expect(files.getByRole("row").nth(3)).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.keyboard.press("Control+a");
  await expect(page.getByText("4,095 selected")).toBeVisible();
  expect(await files.getByRole("row").count()).toBeLessThanOrEqual(100);
  await page.keyboard.press("Escape");
  await expect(
    files.getByRole("checkbox", { name: "Select asset-001.mkv" }),
  ).not.toBeChecked();
  await expect(
    files.getByRole("checkbox", { name: "Deselect asset-003.mp4" }),
  ).toBeChecked();

  const columns = page.getByRole("button", { name: "Columns" }).last();
  await columns.click();
  await page.getByRole("checkbox", { name: "Storage Path" }).check();
  await capture(page, "rstorrent-columns-wide.png");
  await page.keyboard.press("Escape");
  await expect(
    files.getByRole("columnheader", { name: "Storage Path" }),
  ).toBeVisible();
  const nameResize = files.getByRole("separator", {
    name: "Resize Name column",
  });
  const initialWidth = Number(await nameResize.getAttribute("aria-valuenow"));
  await nameResize.focus();
  await page.keyboard.press("ArrowRight");
  await expect(nameResize).toHaveAttribute(
    "aria-valuenow",
    String(initialWidth + 12),
  );
  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  const metrics = await page.evaluate(() => {
    const measuredPerformance = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    return {
      domElements: document.getElementsByTagName("*").length,
      usedJsHeapBytes: measuredPerformance.memory?.usedJSHeapSize ?? null,
    };
  });
  const updateStartedAt = performance.now();
  await page.getByRole("button", { name: "+10s" }).click();
  await expect(page.getByLabel("Demo clock 00:34")).toBeVisible();
  const updateRenderMs = Math.round(performance.now() - updateStartedAt);
  expect(metrics.domElements).toBeLessThan(1_500);
  if (metrics.usedJsHeapBytes !== null) {
    expect(metrics.usedJsHeapBytes).toBeLessThan(256 * 1024 * 1024);
  }
  expect(initialRenderMs).toBeLessThan(5_000);
  expect(updateRenderMs).toBeLessThan(5_000);
  await capture(page, "rstorrent-files-wide.png");

  await page.setViewportSize({ width: 920, height: 720 });
  await expect(files).toBeVisible();
  await capture(page, "rstorrent-files-compact.png");

  await page
    .getByRole("grid", { name: "Torrents" })
    .getByRole("row")
    .filter({ hasText: "Open Movies production archive" })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("region", { name: "Torrent details" }).getByRole("button", { name: "Torrents", exact: true }),
  ).toBeVisible();
  await expect(files).toBeVisible();
  await expect
    .poll(async () =>
      page
        .getByRole("navigation", { name: "Torrent filters" })
        .evaluate((element) =>
          Math.round(element.getBoundingClientRect().right),
        ),
    )
    .toBeLessThanOrEqual(0);
  await columns.click();
  await expect(
    page.getByRole("dialog", { name: "Table column settings" }),
  ).toBeVisible();
  await capture(page, "rstorrent-columns-phone.png");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More file actions" }).click();
  const phoneFileActions = page.getByRole("menu", {
    name: "More file actions",
  });
  await expect(
    phoneFileActions.getByRole("menuitem", { name: "Normal", exact: true }),
  ).toBeVisible();
  await expect(
    phoneFileActions.getByRole("menuitem", { name: "Skip", exact: true }),
  ).toBeVisible();
  const phoneMenuBounds = await phoneFileActions
    .locator("..")
    .locator("..")
    .boundingBox();
  expect(phoneMenuBounds).not.toBeNull();
  expect(phoneMenuBounds!.x).toBeGreaterThanOrEqual(7);
  expect(phoneMenuBounds!.y).toBeGreaterThanOrEqual(7);
  expect(phoneMenuBounds!.x + phoneMenuBounds!.width).toBeLessThanOrEqual(383);
  expect(phoneMenuBounds!.y + phoneMenuBounds!.height).toBeLessThanOrEqual(837);
  await capture(page, "rstorrent-file-actions-phone.png");
  await page.keyboard.press("Escape");
  await capture(page, "rstorrent-files-phone.png");
  console.log(
    `file_scale_metrics ${JSON.stringify({ ...metrics, updateRenderMs })}`,
  );
});

async function openScenario(
  page: Page,
  scenario: string,
  at: number,
  autoplay = false,
) {
  await page.goto(`/?demo=${scenario}&at=${at}&autoplay=${autoplay ? 1 : 0}`);
  await expect(page.getByText("JSTorrent", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Torrents" })
    .click();
}

async function swipeTableLeft(page: Page, table: Locator) {
  const bounds = await table.boundingBox();
  expect(bounds).not.toBeNull();
  const startX = Math.round(bounds!.x + bounds!.width - 36);
  const endX = Math.round(bounds!.x + 36);
  const y = Math.round(
    Math.min(bounds!.y + 100, bounds!.y + bounds!.height - 24),
  );
  const session = await page.context().newCDPSession(page);
  try {
    const completion = await table.evaluateHandle((element) => {
      const state = { released: false, finished: false };
      const onScrollEnd = () => {
        if (state.released && element.scrollLeft > 0) state.finished = true;
      };
      element.addEventListener("scrollend", onScrollEnd);
      return {
        state,
        dispose: () => element.removeEventListener("scrollend", onScrollEnd),
      };
    });
    try {
      // Native event timestamps model a drag followed by a stationary hold.
      // Releasing with zero velocity avoids a fling crossing later resets.
      const startedAt = Date.now() / 1000 - 0.6;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: startX, y }],
        timestamp: startedAt,
      });
      for (let step = 1; step <= 6; step += 1) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            { x: Math.round(startX + ((endX - startX) * step) / 6), y },
          ],
          timestamp: startedAt + step * 0.05,
        });
      }
      await completion.evaluate(({ state }) => {
        state.released = true;
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
        timestamp: Date.now() / 1000,
      });
      await expect
        .poll(() => completion.evaluate(({ state }) => state.finished))
        .toBe(true);
    } finally {
      try {
        await completion.evaluate(({ dispose }) => dispose());
      } finally {
        await completion.dispose();
      }
    }
  } finally {
    await session.detach();
  }
}

async function setDataUnits(page: Page, label: "Decimal" | "Binary") {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog
    .getByRole("group", { name: "Size units" })
    .getByRole("radio", { name: label === "Binary" ? /^KB, MB, GB/ : /^Decimal/ })
    .check();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
}

async function expectVisibleUnits(page: Page, dataUnits: "decimal" | "binary") {
  const pattern =
    dataUnits === "decimal"
      ? /\d+(?:\.\d)? (?:kB|MB|GB|TB|PB)(?:\/s)?/
      : /\d+(?:\.\d)? (?:KB|MB|GB|TB|PB)(?:\/s)?/;
  await expect(page.getByText(pattern).first()).toBeVisible();
}

async function tabGeometry(page: Page) {
  return page
    .getByRole("tablist", { name: "Torrent detail views" })
    .getByRole("tab")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        left: (element as HTMLElement).offsetLeft,
        width: (element as HTMLElement).offsetWidth,
      })),
    );
}

async function detailTabWidths(page: Page) {
  const geometry = await tabGeometry(page);
  return [...new Set(geometry.map((tab) => tab.width))];
}

async function detailTabIsFullyVisible(page: Page, name: string) {
  return page.getByRole("tab", { name }).evaluate((element) => {
    const tabList = element.parentElement;
    if (tabList === null) return false;
    const tabBounds = element.getBoundingClientRect();
    const listBounds = tabList.getBoundingClientRect();
    return (
      tabBounds.left >= listBounds.left && tabBounds.right <= listBounds.right
    );
  });
}

async function elementHeight(locator: ReturnType<Page["locator"]>) {
  return Math.round((await locator.boundingBox())?.height ?? 0);
}

async function themeMetrics(page: Page) {
  return page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      colorScheme: rootStyle.colorScheme,
      background: getComputedStyle(document.body).backgroundColor,
    };
  });
}

async function capture(page: Page, filename: string) {
  if (screenshotDirectory === undefined) return;
  await fs.mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDirectory, filename),
    fullPage: false,
  });
}
