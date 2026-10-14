import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const gateway = process.env.RSTORRENT_LIVE_GATEWAY_URL;
const applicationOrigin = process.env.RSTORRENT_PLAYWRIGHT_BASE_URL;
const magnet = process.env.RSTORRENT_LIVE_MAGNET;
const torrentId = process.env.RSTORRENT_LIVE_TORRENT_ID;
const torrentName = process.env.RSTORRENT_LIVE_TORRENT_NAME;
const fileCount = process.env.RSTORRENT_LIVE_FILE_COUNT;
const trackerUrl = process.env.RSTORRENT_LIVE_TRACKER_URL;
const gatewayToken = process.env.RSTORRENT_LIVE_GATEWAY_TOKEN;
const storagePath = process.env.RSTORRENT_LIVE_STORAGE_PATH;
const screenshotDirectory = process.env.RSTORRENT_SCREENSHOT_DIR;
const expectDiskPressure =
  process.env.RSTORRENT_LIVE_EXPECT_DISK_PRESSURE === "1";
const expectPieces = process.env.RSTORRENT_LIVE_EXPECT_PIECES === "1";
const transportBenchmark =
  process.env.RSTORRENT_LIVE_TRANSPORT_BENCHMARK === "1";
const benchmarkTransport = process.env.RSTORRENT_LIVE_TRANSPORT;
const expectFileSelection = process.env.RSTORRENT_LIVE_FILE_SELECTION === "1";
const expectMediaLibrary = process.env.RSTORRENT_LIVE_MEDIA_LIBRARY === "1";
const mediaPaths = process.env.RSTORRENT_LIVE_MEDIA_PATHS;
const mediaPayloadSha1 = process.env.RSTORRENT_LIVE_MEDIA_PAYLOAD_SHA1;
const mediaFileSha1s = process.env.RSTORRENT_LIVE_MEDIA_FILE_SHA1S;
const torrentFile = process.env.RSTORRENT_LIVE_TORRENT_FILE;
const expectTorrentFilePicker =
  process.env.RSTORRENT_LIVE_TORRENT_FILE_PICKER === "1";
const expectTorrentFileCompletion =
  process.env.RSTORRENT_LIVE_TORRENT_FILE_COMPLETE === "1";
const expectTorrentFileRestart =
  process.env.RSTORRENT_LIVE_TORRENT_FILE_RESTART === "1";
const torrentFileSkipName = process.env.RSTORRENT_LIVE_TORRENT_FILE_SKIP_NAME;
const torrentFileWantedName =
  process.env.RSTORRENT_LIVE_TORRENT_FILE_WANTED_NAME;
const v2MagnetPhase = process.env.RSTORRENT_LIVE_V2_MAGNET_PHASE;
const v2MagnetSkipName = process.env.RSTORRENT_LIVE_V2_MAGNET_SKIP_NAME;
const v2MagnetSecond = process.env.RSTORRENT_LIVE_SECOND_MAGNET;
const v2MagnetV1Hash = process.env.RSTORRENT_LIVE_V1_INFO_HASH;
const v2MagnetV2Hash = process.env.RSTORRENT_LIVE_V2_INFO_HASH;
const v2MagnetFileCount = process.env.RSTORRENT_LIVE_V2_MAGNET_FILE_COUNT;
const clientSettingsPhase = process.env.RSTORRENT_LIVE_CLIENT_SETTINGS_PHASE;

test("client settings apply live, persist, and recover bind failure", async ({
  page,
}) => {
  test.setTimeout(90_000);
  test.skip(
    clientSettingsPhase === undefined ||
      gateway === undefined ||
      gatewayToken === undefined ||
      (clientSettingsPhase === "configure" &&
        (magnet === undefined || torrentId === undefined)),
    "controlled live client-settings lifecycle is opt-in",
  );
  await page.setViewportSize({ width: 1_024, height: 800 });
  await page.goto(liveUrl());
  await expect(
    page.getByRole("grid", { name: "Torrents" }),
  ).toBeVisible();

  if (clientSettingsPhase === "configure") {
    const torrentRow = await addAndOpenInWorkbench(page, magnet!);
    await expect(torrentRow).toContainText("complete", { timeout: 60_000 });
  }

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("tab", { name: "Connection & seeding" }).click();
  const incoming = dialog.getByRole("group", { name: "Incoming connections" });
  await expect(dialog).toBeVisible();

  if (clientSettingsPhase === "configure") {
    await dialog
      .getByRole("radio", { name: "Automatic" })
      .check();
    await dialog
      .getByRole("spinbutton", { name: "Max peer connections" })
      .fill("37");
    await dialog
      .getByRole("spinbutton", { name: "Upload slots" })
      .fill("1");
    await dialog.getByRole("button", { name: "Save settings" }).click();
    await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();
    await expect(incoming).toContainText(/Port \d+/);
    await expect(dialog.getByText("Applying…")).toHaveCount(0);
    await expect(dialog.getByText(/Couldn't apply|Limited to/)).toHaveCount(0);
  } else if (clientSettingsPhase === "observe") {
    await expect(
      dialog.getByRole("radio", { name: "Fixed" }),
    ).toBeChecked();
    await expect(
      dialog.getByRole("spinbutton", { name: "Max peer connections" }),
    ).toHaveValue("37");
    await expect(
      dialog.getByRole("spinbutton", { name: "Upload slots" }),
    ).toHaveValue("1");
    await expect(incoming).toContainText(/Port \d+/);
    await expect(dialog.getByText(/Couldn't apply|Limited to/)).toHaveCount(0);
  } else if (clientSettingsPhase === "recover") {
    await expect(
      dialog.getByRole("radio", { name: "Fixed" }),
    ).toBeChecked();
    await expect(incoming).toContainText("Port already in use");
    await dialog
      .getByRole("radio", { name: "Automatic" })
      .check();
    await dialog.getByRole("button", { name: "Save settings" }).click();
    await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();
    await expect(incoming).toContainText(/Port \d+/);
    await expect(incoming).not.toContainText(/already in use|Couldn't apply|Applying…/);
  } else {
    throw new Error(`unknown client settings phase ${clientSettingsPhase}`);
  }

  const violations = (
    await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  const incomingText = (await incoming.textContent()) ?? "";
  const portMatch = /Port (\d+)/.exec(incomingText);
  console.log(
    `client_settings_live_milestone ${JSON.stringify({ phase: clientSettingsPhase, listenerPort: portMatch === null ? null : Number(portMatch[1]), axeViolations: violations.length })}`,
  );
});

test("live torrent file picker uses one WebSocket binary attachment", async ({
  page,
}) => {
  test.setTimeout(60_000);
  test.skip(
    (!expectTorrentFilePicker && !expectTorrentFileRestart) ||
      gateway === undefined ||
      applicationOrigin === undefined ||
      gatewayToken === undefined ||
      (!expectTorrentFileRestart && torrentFile === undefined) ||
      torrentName === undefined,
    "controlled live torrent file picker is opt-in",
  );
  let applicationUpgrades = 0;
  let binaryFrames = 0;
  const semanticHttpRequests: string[] = [];
  const expectedSocket = `${applicationOrigin!.replace(/^http/, "ws")}/api/v1/connect`;
  page.on("websocket", (socket) => {
    if (socket.url() !== expectedSocket) return;
    applicationUpgrades += 1;
    socket.on("framesent", (frame) => {
      if (typeof frame.payload !== "string") binaryFrames += 1;
    });
  });
  page.on("request", (request) => {
    if (!request.url().startsWith(applicationOrigin!)) return;
    const url = new URL(request.url());
    if (
      url.pathname.startsWith("/api/") &&
      url.pathname !== "/api/v1/connect"
    ) {
      semanticHttpRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(liveUrl());
  const transfers = page.getByRole("grid", { name: "Torrents" });
  await expect(transfers).toBeVisible();
  await expect.poll(() => applicationUpgrades).toBe(1);
  if (expectTorrentFileRestart) {
    const row = transfers.getByRole("row").filter({ hasText: torrentName! });
    await expect(row).toContainText(/Complete|Seeding/, { timeout: 20_000 });
    await row.click();
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Torrents" })
      .click();
    const torrentRow = page
      .getByRole("grid", { name: "Torrents" })
      .getByRole("row")
      .filter({ hasText: torrentName! });
    await expect(torrentRow).toContainText("complete");
    await torrentRow.click();
    await page.getByRole("tab", { name: "Files" }).click();
    const files = page.getByRole("grid", { name: "Torrent files" });
    await expect(files).toHaveAttribute("aria-rowcount", "4");
    if (torrentFileSkipName !== undefined) {
      await expect(
        files
          .getByRole("row")
          .filter({ hasText: torrentFileSkipName })
          .getByText("Skip", { exact: true }),
      ).toBeVisible();
    }
    expect(binaryFrames).toBe(0);
    console.log(
      `torrent_file_picker_live_milestones ${JSON.stringify({ applicationUpgrades, binaryFrames, semanticHttpRequests: semanticHttpRequests.length, restart: "complete" })}`,
    );
    return;
  }
  const addForm = page.getByRole("form", { name: "Add torrent" });
  const chooserEvent = page.waitForEvent("filechooser");
  await addForm.getByRole("button", { name: "Add" }).click();
  const chooser = await chooserEvent;
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles(torrentFile!);

  const dialog = page.getByRole("dialog", {
    name: "Add torrent",
  });
  await expect(dialog).toBeVisible();
  const startContent = dialog.getByRole("checkbox", {
    name: /Start downloading files when metadata is available/,
  });
  await startContent.uncheck();
  await dialog.getByRole("button", { name: "Add torrent" }).click();
  await expect(page.getByRole("status")).toHaveText("Added");
  const row = transfers.getByRole("row").filter({ hasText: torrentName! });
  await expect(row).toContainText(torrentName!, { timeout: 10_000 });
  await expect.poll(() => binaryFrames).toBe(1);

  if (expectTorrentFileCompletion) {
    expect(torrentFileSkipName).toBeDefined();
    expect(torrentFileWantedName).toBeDefined();
    await row.click();
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Torrents" })
      .click();
    const torrentRow = page
      .getByRole("grid", { name: "Torrents" })
      .getByRole("row")
      .filter({ hasText: torrentName! });
    await expect(torrentRow).toBeVisible();
    await torrentRow.click();
    await page.getByRole("tab", { name: "Files" }).click();
    const files = page.getByRole("grid", { name: "Torrent files" });
    await expect(files).toHaveAttribute("aria-rowcount", "4", {
      timeout: 20_000,
    });
    const skipped = files
      .getByRole("row")
      .filter({ hasText: torrentFileSkipName! });
    await skipped.click();
    await page.getByRole("button", { name: "More file actions" }).click();
    await page
      .getByRole("menu", { name: "More file actions" })
      .getByRole("menuitem", { name: "Skip", exact: true })
      .click();
    await expect(skipped.getByText("Skip", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(torrentRow).toContainText("complete", { timeout: 60_000 });
    const wantedCells = files
      .getByRole("row")
      .filter({ hasText: torrentFileWantedName! })
      .getByRole("gridcell");
    await expect
      .poll(async () => (await wantedCells.nth(6).textContent())?.trim(), {
        timeout: 20_000,
      })
      .not.toBe("0 B");
    await torrentRow.click({ button: "right" });
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Force recheck", exact: true })
      .click();
    await expect(
      page.getByText(`Started recheck for ${torrentName!}`, { exact: true }),
    ).toBeVisible();
    await expect(torrentRow).toContainText("complete", { timeout: 30_000 });
  }

  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  expect(applicationUpgrades).toBe(1);
  expect(binaryFrames).toBe(1);
  expect(semanticHttpRequests).toEqual([]);
  console.log(
    `torrent_file_picker_live_milestones ${JSON.stringify({ applicationUpgrades, binaryFrames, semanticHttpRequests: semanticHttpRequests.length, axeViolations: violations.length, completion: expectTorrentFileCompletion ? "complete_rechecked" : "paused" })}`,
  );
});

test("live v2 magnet lifecycle uses the production application", async ({
  page,
}) => {
  test.setTimeout(90_000);
  test.skip(
    (v2MagnetPhase !== "add" && v2MagnetPhase !== "restart_remove") ||
      gateway === undefined ||
      applicationOrigin === undefined ||
      gatewayToken === undefined ||
      torrentName === undefined ||
      v2MagnetSkipName === undefined ||
      (v2MagnetPhase === "add" && magnet === undefined),
    "controlled live v2 magnet lifecycle is opt-in",
  );
  let applicationUpgrades = 0;
  let binaryFrames = 0;
  const semanticHttpRequests: string[] = [];
  const expectedSocket = `${applicationOrigin!.replace(/^http/, "ws")}/api/v1/connect`;
  page.on("websocket", (socket) => {
    if (socket.url() !== expectedSocket) return;
    applicationUpgrades += 1;
    socket.on("framesent", (frame) => {
      if (typeof frame.payload !== "string") binaryFrames += 1;
    });
  });
  page.on("request", (request) => {
    if (!request.url().startsWith(applicationOrigin!)) return;
    const url = new URL(request.url());
    if (
      url.pathname.startsWith("/api/") &&
      url.pathname !== "/api/v1/connect"
    ) {
      semanticHttpRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.goto(liveUrl());
  const transfers = page.getByRole("grid", { name: "Torrents" });
  await expect(transfers).toBeVisible();
  await expect.poll(() => applicationUpgrades).toBe(1);
  if (v2MagnetPhase === "add") {
    const input = page
      .getByRole("form", { name: "Add torrent" })
      .getByRole("textbox", { name: "Magnet link or torrent URL" });
    await input.fill(magnet!);
    await input.press("Enter");
    await confirmDefaultAddOptions(page);
    await expect(page.getByRole("status")).toHaveText(/Added|Torrent added/);
    if (v2MagnetSecond !== undefined) {
      await input.fill(v2MagnetSecond);
      await input.press("Enter");
      await confirmDefaultAddOptions(page);
      await expect(page.getByRole("status")).toHaveText(/Added|Torrent added/);
    }
  }

  const transferRow = transfers
    .getByRole("row")
    .filter({ hasText: torrentName! });
  await expect(transferRow).toContainText(/Complete|Seeding/, {
    timeout: 60_000,
  });
  if (v2MagnetSecond !== undefined) {
    await expect(transfers.locator("[data-row-id]")).toHaveCount(1);
  }
  await transferRow.click();
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Torrents" })
    .click();
  const torrentRow = page
    .getByRole("grid", { name: "Torrents" })
    .getByRole("row")
    .filter({ hasText: torrentName! });
  await expect(torrentRow).toContainText("complete");
  await torrentRow.click();
  if (v2MagnetV1Hash !== undefined && v2MagnetV2Hash !== undefined) {
    await page.getByRole("tab", { name: "General" }).click();
    await expect(page.getByText("Info hash (v1)", { exact: true })).toBeVisible();
    await expect(page.getByText(v2MagnetV1Hash, { exact: true })).toBeVisible();
    await expect(page.getByText("Info hash (v2)", { exact: true })).toBeVisible();
    await expect(page.getByText(v2MagnetV2Hash, { exact: true })).toBeVisible();
  }
  await page.getByRole("tab", { name: "Files" }).click();
  const files = page.getByRole("grid", { name: "Torrent files" });
  await expect(files).toHaveAttribute(
    "aria-rowcount",
    v2MagnetFileCount ?? "4",
  );
  await expect(
    files
      .getByRole("row")
      .filter({ hasText: v2MagnetSkipName! })
      .getByText("Skip", { exact: true }),
  ).toBeVisible();

  if (v2MagnetV1Hash !== undefined && v2MagnetV2Hash !== undefined) {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: applicationOrigin!,
    });
  }
  await torrentRow.click({ button: "right" });
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Copy magnet link" })
    .click();
  await expect(page.getByText("Magnet link copied", { exact: true })).toBeVisible();
  if (v2MagnetV1Hash !== undefined && v2MagnetV2Hash !== undefined) {
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(
      new RegExp(
        `^magnet:\\?xt=urn:btih:${v2MagnetV1Hash}&xt=urn:btmh:1220${v2MagnetV2Hash}`,
      ),
    );
  }

  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);

  if (v2MagnetPhase === "restart_remove") {
    await torrentRow.click({ button: "right" });
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Remove", exact: true })
      .click();
    const removal = page.getByRole("dialog", { name: "Remove torrent?" });
    await removal
      .getByRole("checkbox", { name: "Also delete downloaded data" })
      .check();
    await removal
      .getByRole("button", { name: "Remove and delete data" })
      .click();
    await expect(page.getByText(`Removed ${torrentName!}`, { exact: true })).toBeVisible();
  }

  expect(binaryFrames).toBe(0);
  expect(semanticHttpRequests).toEqual([]);
  console.log(
    `v2_magnet_live_milestone ${JSON.stringify({ phase: v2MagnetPhase, applicationUpgrades, binaryFrames, semanticHttpRequests: semanticHttpRequests.length, axeViolations: violations.length, reconciledRows: v2MagnetSecond === undefined ? null : 1, identities: v2MagnetV1Hash === undefined ? 1 : 2 })}`,
  );
});

test("paired application transport throughput", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(
    !transportBenchmark ||
      gateway === undefined ||
      applicationOrigin === undefined ||
      magnet === undefined ||
      torrentId === undefined ||
      (benchmarkTransport !== "http" && benchmarkTransport !== "websocket"),
    "paired transport benchmark is opt-in",
  );
  let applicationUpgrades = 0;
  let semanticHttpRequests = 0;
  const expectedSocket = `${applicationOrigin!.replace(/^http/, "ws")}/api/v1/connect`;
  page.on("websocket", (socket) => {
    if (socket.url() === expectedSocket) applicationUpgrades += 1;
  });
  page.on("request", (request) => {
    if (!request.url().startsWith(applicationOrigin!)) return;
    const pathname = new URL(request.url()).pathname;
    if (
      pathname === "/api/v1/hello" ||
      pathname === "/api/v1/commands" ||
      pathname.startsWith("/api/v1/view-sets")
    ) {
      semanticHttpRequests += 1;
    }
  });
  const query =
    benchmarkTransport === "http"
      ? "/?transport=http&poll_ms=100"
      : "/";
  await page.goto(withGatewayToken(query));
  const transfers = page.getByRole("grid", { name: "Torrents" });
  await expect(transfers).toBeVisible();
  const input = page
    .getByRole("form", { name: "Add torrent" })
    .getByRole("textbox", { name: "Magnet link or torrent URL" });
  const started = performance.now();
  await input.fill(magnet!);
  await input.press("Enter");
  await confirmDefaultAddOptions(page);
  await expect(
    page.getByRole("region", { name: "Torrent collection" }).getByRole("status"),
  ).toHaveText("Added");
  const row = transfers.locator(`[data-row-id="${torrentId!}"]`);
  await expect(row).toContainText(/complete/i, { timeout: 180_000 });
  const transferSeconds = (performance.now() - started) / 1_000;
  if (benchmarkTransport === "websocket") {
    expect(applicationUpgrades).toBe(1);
    expect(semanticHttpRequests).toBe(0);
  } else {
    expect(applicationUpgrades).toBe(0);
    expect(semanticHttpRequests).toBeGreaterThan(0);
  }
  console.log(
    `transport_benchmark_result ${JSON.stringify({ transport: benchmarkTransport, transferSeconds, applicationUpgrades, semanticHttpRequests })}`,
  );
});

test("live disk inspection observes pressure and exact recovery", async ({
  page,
}) => {
  test.setTimeout(90_000);
  test.skip(
    !expectDiskPressure ||
      gateway === undefined ||
      magnet === undefined ||
      torrentId === undefined ||
      torrentName === undefined,
    "controlled slow-storage gateway is opt-in",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(liveUrl());
  const torrentRow = await addAndOpenInWorkbench(page, magnet!);
  await page.getByRole("tab", { name: "Disk" }).click();
  const pieces = page.getByRole("grid", { name: "Active storage pieces" });
  await expect(page.getByLabel("Disk pressure Backpressured")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByText("intake paused now", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => Number(await pieces.getAttribute("aria-rowcount")))
    .toBeGreaterThan(1);
  await capture(page, "live-disk-backpressured-wide.png");

  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);

  await expect(torrentRow).toContainText("complete", { timeout: 60_000 });
  await expect(page.getByLabel("Disk pressure Idle")).toBeVisible({
    timeout: 10_000,
  });
  await expect(pieces).toHaveAttribute("aria-rowcount", "1");
  await expect(page.getByText("intake is open", { exact: true })).toBeVisible();
  await capture(page, "live-disk-recovered-wide.png");
  console.log(
    "disk_live_milestones pressure=backpressured completion=verified recovery=idle",
  );
});

test("live piece inspection follows active work through verification", async ({
  page,
}) => {
  test.setTimeout(90_000);
  test.skip(
    !expectPieces ||
      gateway === undefined ||
      magnet === undefined ||
      torrentId === undefined ||
      torrentName === undefined,
    "controlled piece-map gateway is opt-in",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(liveUrl());
  const startedAt = performance.now();
  const torrentRow = await addAndOpenInWorkbench(page, magnet!);
  await page.getByRole("tab", { name: "Pieces" }).click();
  const pieceMap = page.getByRole("img", { name: /pieces:/ });
  await expect(pieceMap).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => pieceMap.getAttribute("aria-label"), { timeout: 20_000 })
    .toMatch(/pieces: [\d,]+ verified, [1-9][\d,]* active/);
  const firstActiveMs = Math.round(performance.now() - startedAt);
  await capture(page, "live-pieces-active-wide.png");

  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);

  await expect(torrentRow).toContainText("complete", { timeout: 60_000 });
  await expect
    .poll(async () => pieceMap.getAttribute("aria-label"), { timeout: 10_000 })
    .toMatch(/^17 pieces: 17 verified, 0 active$/);
  const completeMs = Math.round(performance.now() - startedAt);
  await capture(page, "live-pieces-complete-wide.png");
  console.log(
    `piece_live_milestones ${JSON.stringify({ firstActiveMs, completeMs, pieces: 17 })}`,
  );
});

test("live peer inspection follows a controlled verified transfer", async ({
  page,
}) => {
  test.setTimeout(60_000);
  test.skip(
    gateway === undefined ||
      applicationOrigin === undefined ||
      magnet === undefined ||
      torrentId === undefined ||
      torrentName === undefined ||
      fileCount === undefined ||
      trackerUrl === undefined,
    "controlled live gateway is opt-in",
  );
  let applicationUpgrades = 0;
  const semanticHttpRequests: string[] = [];
  const semanticPaths = [
    "/api/v1/hello",
    "/api/v1/commands",
    "/api/v1/view-sets",
  ];
  page.on("websocket", (socket) => {
    if (
      socket.url() ===
      `${applicationOrigin!.replace(/^http/, "ws")}/api/v1/connect`
    ) {
      applicationUpgrades += 1;
    }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.url().startsWith(applicationOrigin!) &&
      semanticPaths.some(
        (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
      )
    ) {
      semanticHttpRequests.push(`${request.method()} ${url.pathname}`);
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(liveUrl());
  const primary = page.getByRole("navigation", { name: "Primary" });
  const transferGrid = page.getByRole("grid", { name: "Torrents" });
  await expect(primary).toBeVisible();
  await expect(transferGrid).toBeVisible();
  await expect.poll(() => applicationUpgrades).toBe(1);

  const addForm = page.getByRole("form", { name: "Add torrent" });
  const torrentInput = addForm.getByRole("textbox", {
    name: "Magnet link or torrent URL",
  });
  const transferStartedAt = performance.now();
  await torrentInput.fill(magnet!);
  await torrentInput.press("Enter");
  await confirmDefaultAddOptions(page);
  await expect(
    page.getByRole("region", { name: "Torrent collection" }).getByRole("status"),
  ).toHaveText("Added");
  await expect(torrentInput).toHaveValue("");

  const transferRow = transferGrid.locator(`[data-row-id="${torrentId!}"]`);
  await expect(transferRow).toContainText(torrentName!, { timeout: 20_000 });
  await transferRow.click();
  await primary.getByRole("button", { name: "Torrents" }).click();
  const library = page.getByRole("grid", { name: "Torrents" });
  await expect(library).toBeVisible();
  const torrentRow = library.locator(`[data-row-id="${torrentId!}"]`);
  await expect(torrentRow).toBeVisible();
  await torrentRow.click();
  await page.getByRole("tab", { name: "Files" }).click();
  const files = page.getByRole("grid", { name: "Torrent files" });
  const expectedFileCount = Number(fileCount!);
  await expect(files).toHaveAttribute(
    "aria-rowcount",
    String(expectedFileCount + 1),
    {
      timeout: 20_000,
    },
  );
  await scrollToEnd(files);
  const prefixFile = files.getByRole("row").filter({ hasText: "prefix.bin" });
  const payloadFile = files.getByRole("row").filter({ hasText: "payload.bin" });
  await expect(prefixFile).toBeVisible();
  await expect(payloadFile).toBeVisible();
  const payloadCells = payloadFile.getByRole("gridcell");
  await expect
    .poll(async () => (await payloadCells.nth(5).textContent())?.trim(), {
      timeout: 12_000,
    })
    .not.toBe("0 B");
  const firstDoneMs = Math.round(performance.now() - transferStartedAt);
  await expect
    .poll(async () => (await payloadCells.nth(6).textContent())?.trim(), {
      timeout: 12_000,
    })
    .not.toBe("0 B");
  const firstVerifiedMs = Math.round(performance.now() - transferStartedAt);
  await capture(page, "live-files-progress-wide.png");

  await page.getByRole("tab", { name: "Peers" }).click();

  const peers = page.getByRole("grid", { name: "Active peer connections" });
  await expect(peers).toBeVisible();
  await expect
    .poll(async () => Number(await peers.getAttribute("aria-rowcount")))
    .toBeGreaterThan(1);
  await expect(
    peers.getByText("127.0.0.1", { exact: false }).first(),
  ).toBeVisible();
  await capture(page, "live-peer-wide.png");

  await page.getByRole("tab", { name: "Swarm" }).click();
  const swarm = page.getByRole("grid", { name: "Known swarm peers" });
  await expect(swarm).toHaveAttribute("aria-rowcount", "2", {
    timeout: 20_000,
  });
  await expect(
    swarm.getByText("127.0.0.1", { exact: false }).first(),
  ).toBeVisible();
  await expect(swarm.getByText(/TRACKER · Magnet/).first()).toBeVisible({
    timeout: 20_000,
  });
  await capture(page, "live-swarm-wide.png");

  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);

  await expect(torrentRow).toContainText("complete", { timeout: 30_000 });
  await expect(swarm).toHaveAttribute("aria-rowcount", "1", {
    timeout: 10_000,
  });
  await expect(page.getByText("The peer registry is inactive.")).toBeVisible();
  await page.getByRole("tab", { name: "Peers" }).click();
  await expect
    .poll(async () => Number(await peers.getAttribute("aria-rowcount")))
    .toBe(1);
  await page.getByRole("tab", { name: "Files" }).click();
  await expect(files).toHaveAttribute(
    "aria-rowcount",
    String(expectedFileCount + 1),
    {
      timeout: 10_000,
    },
  );
  await scrollToEnd(files);
  await expect(prefixFile).toContainText("6.9 kB");
  await expect(payloadFile).toContainText("39.9 kB");
  expect(firstVerifiedMs).toBeGreaterThanOrEqual(firstDoneMs);
  expect(applicationUpgrades).toBe(1);
  expect(semanticHttpRequests).toEqual([]);
  console.log(
    `file_live_milestones ${JSON.stringify({ firstDoneMs, firstVerifiedMs, files: expectedFileCount, swarmSourceMerge: true, swarmTerminalCleanup: true, applicationUpgrades, semanticHttpRequests: semanticHttpRequests.length })}`,
  );
});

test("live Library media detail follows metadata through completion", async ({
  page,
}) => {
  test.setTimeout(90_000);
  test.skip(
    !expectMediaLibrary ||
      gateway === undefined ||
      applicationOrigin === undefined ||
      magnet === undefined ||
      torrentId === undefined ||
      torrentName === undefined ||
      fileCount === undefined ||
      storagePath === undefined ||
      mediaPaths === undefined ||
      mediaPayloadSha1 === undefined ||
      mediaFileSha1s === undefined,
    "controlled live media Library is opt-in",
  );
  const detailRequests: string[] = [];
  const semanticHttpRequests: string[] = [];
  let applicationUpgrades = 0;
  let sawMetadataPending = false;
  const expectedSocket = `${applicationOrigin!.replace(/^http/, "ws")}/api/v1/connect`;
  page.on("websocket", (socket) => {
    if (socket.url() !== expectedSocket) return;
    applicationUpgrades += 1;
    socket.on("framesent", (frame) => {
      if (typeof frame.payload !== "string") return;
      const value = JSON.parse(frame.payload) as {
        type?: string;
        operation?: {
          type?: string;
          request?: { views?: readonly { type?: string }[] };
        };
      };
      if (
        value.type !== "call" ||
        value.operation?.type !== "update_view_set"
      ) {
        return;
      }
      const details = (value.operation.request?.views ?? [])
        .flatMap((view) =>
          view.type === "torrent_media"
            ? ["media"]
            : view.type === "torrent_files"
              ? ["files"]
              : [],
        );
      detailRequests.push(details.join("+") || "none");
    });
  });
  page.on("request", (request) => {
    if (!request.url().startsWith(applicationOrigin!)) return;
    const pathname = new URL(request.url()).pathname;
    if (
      pathname === "/api/v1/hello" ||
      pathname === "/api/v1/commands" ||
      pathname.startsWith("/api/v1/view-sets")
    ) {
      semanticHttpRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.goto(liveUrl());
  const primary = page.getByRole("navigation", { name: "Primary" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("tab", { name: "Connection & seeding" }).click();
  await settings
    .getByRole("combobox", { name: "Download" })
    .selectOption({ label: "Custom…" });
  await settings
    .getByRole("spinbutton", {
      name: "Download, custom speed in KB per second",
    })
    .fill("32");
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(settings.getByText("Saved", { exact: true })).toBeVisible();
  await expect(
    settings.getByRole("region", { name: "Speed limits" }),
  ).not.toContainText(/Applying…|Couldn't apply/);
  await settings.getByRole("button", { name: "Close settings" }).click();
  const addForm = page.getByRole("form", { name: "Add torrent" });
  const input = addForm.getByRole("textbox", {
    name: "Magnet link or torrent URL",
  });
  await input.fill(magnet!);
  await input.press("Enter");
  const addDialog = page.getByRole("dialog", {
    name: "Add torrent",
  });
  await addDialog
    .getByRole("checkbox", {
      name: /Start downloading files when metadata is available/,
    })
    .uncheck();
  await addDialog.getByRole("button", { name: "Add torrent" }).click();
  await expect(
    page.getByRole("region", { name: "Torrent collection" }).getByRole("status"),
  ).toHaveText("Added");
  await primary.getByRole("button", { name: "Library" }).click();
  const card = page
    .getByRole("list", { name: "Torrent-backed content" })
    .getByRole("button")
    .first();
  await expect(card).toBeVisible();
  await card.click();
  const pending = page.getByText("Waiting for torrent metadata…");
  await expect(pending).toBeVisible();
  sawMetadataPending = true;

  await expect(
    page.getByRole("heading", { name: torrentName! }),
  ).toBeVisible({ timeout: 20_000 });
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
  await expect.poll(() => detailRequests.at(-1)).toBe("media");

  await page.getByRole("button", { name: "Back to Library" }).click();
  await primary.getByRole("button", { name: "Torrents" }).click();
  const torrentRow = page
    .getByRole("grid", { name: "Torrents" })
    .getByRole("row")
    .filter({ hasText: torrentName! });
  await torrentRow.click();
  await page.getByRole("tab", { name: "Files" }).click();
  const fileGrid = page.getByRole("grid", { name: "Torrent files" });
  const firstDirectFile = fileGrid
    .getByRole("row")
    .filter({ hasText: "North.Shore.Stories.S01E10.1080p.WEB-DL.mkv" });
  await firstDirectFile.click();
  await page.getByRole("button", { name: "More file actions" }).click();
  await page
    .getByRole("menu", { name: "More file actions" })
    .getByRole("menuitem", { name: "High", exact: true })
    .click();
  await expect(firstDirectFile.getByText("High", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await primary.getByRole("button", { name: "Library" }).click();
  await card.click();
  await expect(media).toBeVisible();
  const storage = path.resolve(storagePath!);
  const directRoot = path.join(storage, torrentName!);
  const expectedFileSha1 = JSON.parse(mediaFileSha1s!) as Record<string, string>;
  const prioritizedPath =
    "Season 01/North.Shore.Stories.S01E10.1080p.WEB-DL.mkv";
  await expect
    .poll(async () => fileSha1(path.join(directRoot, prioritizedPath)), {
      timeout: 50_000,
    })
    .toBe(expectedFileSha1[prioritizedPath]);
  const incompletePaths = await Promise.all(
    (JSON.parse(mediaPaths!) as string[])
      .filter((relative) => relative !== prioritizedPath)
      .map(async (relative) =>
        (await fileSha1(path.join(directRoot, relative))) !==
        expectedFileSha1[relative]
          ? relative
          : null,
      ),
  );
  expect(incompletePaths.some((relative) => relative !== null)).toBe(true);
  const availableRow = media
    .getByRole("listitem")
    .filter({ hasText: "North.Shore.Stories.S01E10.1080p.WEB-DL.mkv" });
  const play = availableRow.getByRole("button", { name: /^Play / });
  await expect(play).toBeEnabled();
  const popupPromise = page.context().waitForEvent("page");
  await play.click();
  const popup = await popupPromise;
  await expect.poll(() => popup.url()).toContain("/media/");
  await popup.close();
  await expect(page.getByRole("status")).toContainText("Opening ");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await settings.getByRole("tab", { name: "Connection & seeding" }).click();
  await settings
    .getByRole("combobox", { name: "Download" })
    .selectOption({ label: "Unlimited" });
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(settings.getByText("Saved", { exact: true })).toBeVisible();
  await expect(
    settings.getByRole("region", { name: "Speed limits" }),
  ).not.toContainText(/Applying…|Couldn't apply/);
  await settings.getByRole("button", { name: "Close settings" }).click();

  await page.getByRole("tab", { name: "All files" }).click();
  const files = page.getByRole("list", { name: "All torrent files" });
  await expect(files.getByRole("listitem")).toHaveCount(Number(fileCount!));
  await expect(files.getByText("poster.jpg")).toBeVisible();
  await expect(files.getByText("README.nfo")).toBeVisible();
  await expect.poll(() => detailRequests.at(-1)).toBe("files");

  await page.getByRole("tab", { name: "Media" }).click();
  await expect(media).toBeVisible();
  await expect.poll(() => detailRequests.at(-1)).toBe("media");
  await expect(
    media.getByText("Downloaded", { exact: true }),
  ).toHaveCount(6, { timeout: 45_000 });
  const progress = media.getByLabel(/download progress$/);
  await expect(progress).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) {
    await expect(progress.nth(index)).toHaveText("100% done · 100% verified");
  }

  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  await page.getByRole("button", { name: "Back to Library" }).click();
  await expect(card).toBeFocused();
  await expect.poll(() => detailRequests.at(-1)).toBe("none");
  await card.click();
  await expect(media).toBeVisible();
  await expect(
    media.getByText("Downloaded", { exact: true }),
  ).toHaveCount(6);
  await page.keyboard.press("Escape");
  await expect(card).toBeFocused();

  const payloadHash = createHash("sha1");
  for (const relative of JSON.parse(mediaPaths!) as string[]) {
    payloadHash.update(await fs.readFile(path.join(directRoot, relative)));
  }
  expect(payloadHash.digest("hex")).toBe(mediaPayloadSha1);
  const unrelated = path.join(storage, "unrelated.keep");
  await fs.writeFile(unrelated, "preserve");
  await primary.getByRole("button", { name: "Torrents" }).click();
  const removableTorrentRow = page
    .getByRole("grid", { name: "Torrents" })
    .getByRole("row")
    .filter({ hasText: torrentName! });
  await removableTorrentRow.click({ button: "right" });
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Remove", exact: true })
    .click();
  const removal = page.getByRole("dialog", { name: "Remove torrent?" });
  await expect(removal).not.toContainText(/managed|publish/i);
  await removal
    .getByRole("checkbox", { name: "Also delete downloaded data" })
    .check();
  await removal
    .getByRole("button", { name: "Remove and delete data" })
    .click();
  await expect(page.getByText(`Removed ${torrentName!}`, { exact: true })).toBeVisible();
  await expect.poll(() => pathExists(directRoot)).toBe(false);
  expect(await fs.readFile(unrelated, "utf8")).toBe("preserve");
  expect(applicationUpgrades).toBe(1);
  expect(semanticHttpRequests).toEqual([]);
  console.log(
    `media_library_live_milestones ${JSON.stringify({ sawMetadataPending, earlyDirectOpen: true, mediaRows: 6, fileRows: Number(fileCount!), exactRemoval: true, detailRequests, applicationUpgrades, semanticHttpRequests: semanticHttpRequests.length, axeViolations: violations.length })}`,
  );
});

test("live add-time file selection", async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(
    !expectFileSelection ||
      gateway === undefined ||
      magnet === undefined ||
      torrentName === undefined ||
      fileCount === undefined ||
      storagePath === undefined,
    "controlled live file-selection gateway is opt-in",
  );

  const storage = path.resolve(storagePath!);
  const output = path.join(storage, torrentName!);
  const prefix = path.join(output, "nested", "prefix.bin");
  const payload = path.join(output, "payload.bin");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(liveUrl());
  const addForm = page.getByRole("form", { name: "Add torrent" });
  await addForm
    .getByRole("textbox", { name: "Magnet link or torrent URL" })
    .fill(magnet!);
  await addForm.getByRole("button", { name: "Add" }).click();

  const addDialog = page.getByRole("dialog", {
    name: "Add torrent",
  });
  await expect(addDialog).toBeVisible();
  await expect(
    addDialog.getByRole("checkbox", {
      name: /Start downloading files when metadata is available/,
    }),
  ).toHaveCount(0);
  await addDialog.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("region", { name: "Torrent collection" }).locator("output"),
  ).toHaveText("Added");

  const selection = page.getByRole("dialog").filter({
    has: page.getByText("Choose the files you want to download.", { exact: true }),
  });
  await expect(selection).toBeVisible();
  expect(await fs.readdir(storage)).toEqual([]);
  const selectNone = selection.getByRole("button", { name: "None", exact: true });
  await expect(selectNone).toBeVisible({ timeout: 30_000 });
  await selectNone.click();
  const checklist = selection.getByRole("list", { name: "Torrent files" });
  await scrollToEnd(checklist);
  const payloadChoice = selection.getByRole("checkbox", {
    name: /payload\.bin/,
  });
  await expect(payloadChoice).toBeVisible();
  await payloadChoice.check();
  await expect(
    selection.getByText(`1 of ${Number(fileCount!).toLocaleString()} selected`, {
      exact: false,
    }),
  ).toBeVisible();
  await expect(checklist).toHaveAttribute("data-cached-page-count", /^[1-3]$/);
  const violations = (
    await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
  ).violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  expect(await fs.readdir(storage)).toEqual([]);
  await selection.getByRole("button", { name: "Download" }).click();

  const transfers = page.getByRole("grid", { name: "Torrents" });
  const transferRow = transfers
    .locator("[role=row][data-row-id]")
    .filter({ hasText: torrentName! });
  await expect(transferRow).toBeVisible({ timeout: 10_000 });
  const canonicalTorrentId = await transferRow.getAttribute("data-row-id");
  expect(canonicalTorrentId).not.toBeNull();
  const staging = path.join(
    storage,
    `.${canonicalTorrentId!}.rstorrent-staging`,
  );
  const part = path.join(storage, `.${canonicalTorrentId!}.rstorrent-parts`);
  await transferRow.click();
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Torrents" })
    .click();
  const torrentRow = page
    .getByRole("grid", { name: "Torrents" })
    .locator(`[data-row-id="${canonicalTorrentId!}"]`);
  await expect(torrentRow).toBeVisible();
  await torrentRow.click();
  await page.getByRole("tab", { name: "Files" }).click();
  const files = page.getByRole("grid", { name: "Torrent files" });
  await expect(files).toHaveAttribute(
    "aria-rowcount",
    String(Number(fileCount!) + 1),
    { timeout: 20_000 },
  );
  await scrollToEnd(files);
  const prefixRow = files.getByRole("row").filter({ hasText: "prefix.bin" });
  await expect(prefixRow).toBeVisible();
  await expect(prefixRow.getByText("Skip", { exact: true })).toBeVisible();
  await expect(torrentRow).toContainText("complete", { timeout: 60_000 });
  await expect.poll(() => pathExists(payload)).toBe(true);
  await expect.poll(() => pathExists(part)).toBe(true);
  expect(await pathExists(prefix)).toBe(false);
  expect(await pathExists(staging)).toBe(false);

  await prefixRow.click();
  await page.getByRole("button", { name: "More file actions" }).click();
  await page
    .getByRole("menu", { name: "More file actions" })
    .getByRole("menuitem", { name: "Download now", exact: true })
    .click();
  await expect.poll(() => pathExists(prefix), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => pathExists(part), { timeout: 20_000 }).toBe(false);
  await scrollToEnd(files);
  await expect(
    files
      .getByRole("row")
      .filter({ hasText: "prefix.bin" })
      .getByText("Normal", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(torrentRow).toContainText("complete", { timeout: 20_000 });
  console.log(
    `file_selection_live_milestones add_time=no_artifacts selected=1/${fileCount!} cached_pages<=3 skipped=direct_part download_now=materialized_part_removed axe=${violations.length}`,
  );
});

async function addAndOpenInWorkbench(
  page: Page,
  liveMagnet: string,
): Promise<Locator> {
  const primary = page.getByRole("navigation", { name: "Primary" });
  const transfers = page.getByRole("grid", { name: "Torrents" });
  await expect(primary).toBeVisible();
  await expect(transfers).toBeVisible();
  const existingIds = new Set(
    await transfers.locator("[role=row][data-row-id]").evaluateAll((rows) =>
      rows.flatMap((row) => {
        const id = row.getAttribute("data-row-id");
        return id === null ? [] : [id];
      }),
    ),
  );
  const input = page
    .getByRole("form", { name: "Add torrent" })
    .getByRole("textbox", { name: "Magnet link or torrent URL" });
  await input.fill(liveMagnet);
  await input.press("Enter");
  await confirmDefaultAddOptions(page);
  await expect(
    page.getByRole("region", { name: "Torrent collection" }).getByRole("status"),
  ).toHaveText("Added");
  let canonicalTorrentId: string | null = null;
  await expect
    .poll(
      async () => {
        const ids = await transfers
          .locator("[role=row][data-row-id]")
          .evaluateAll((rows) =>
            rows.flatMap((row) => {
              const id = row.getAttribute("data-row-id");
              return id === null ? [] : [id];
            }),
          );
        canonicalTorrentId = ids.find((id) => !existingIds.has(id)) ?? null;
        return canonicalTorrentId;
      },
      { timeout: 10_000 },
    )
    .not.toBeNull();
  if (canonicalTorrentId === null) {
    throw new Error("added torrent did not expose a canonical row ID");
  }
  const transferRow = transfers.locator(
    `[data-row-id="${canonicalTorrentId}"]`,
  );
  await transferRow.click();
  await primary.getByRole("button", { name: "Torrents" }).click();
  const torrentRow = page
    .getByRole("grid", { name: "Torrents" })
    .locator(`[data-row-id="${canonicalTorrentId}"]`);
  await expect(torrentRow).toBeVisible({ timeout: 10_000 });
  await torrentRow.click();
  return torrentRow;
}

async function scrollToEnd(grid: Locator) {
  await grid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
}

async function confirmDefaultAddOptions(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Add torrent" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Add torrent" }).click();
}

async function capture(page: Page, filename: string) {
  if (screenshotDirectory === undefined) return;
  await fs.mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDirectory, filename),
    fullPage: false,
  });
}

function liveUrl(): string {
  return withGatewayToken("/");
}

function withGatewayToken(url: string): string {
  if (gatewayToken === undefined) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(gatewayToken)}`;
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.stat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function fileSha1(candidate: string): Promise<string | null> {
  try {
    return createHash("sha1")
      .update(await fs.readFile(candidate))
      .digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
