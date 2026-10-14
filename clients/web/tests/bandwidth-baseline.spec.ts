import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  BoundedApplicationFrameCapture,
  type ApplicationBandwidthSummary,
} from "../src/test-support/application-frame-bandwidth";

const enabled = process.env.RSTORRENT_LIVE_BANDWIDTH_BASELINE === "1";
const applicationOrigin = process.env.RSTORRENT_PLAYWRIGHT_BASE_URL;
const gatewayToken = process.env.RSTORRENT_LIVE_GATEWAY_TOKEN;
const magnet = process.env.RSTORRENT_LIVE_MAGNET;
const activeName = process.env.RSTORRENT_BANDWIDTH_ACTIVE_NAME;
const libraryRows = parsePositiveInteger(
  process.env.RSTORRENT_BANDWIDTH_LIBRARY_ROWS,
);
const fileCount = parsePositiveInteger(
  process.env.RSTORRENT_LIVE_FILE_COUNT,
);
const windowMillis = parsePositiveInteger(
  process.env.RSTORRENT_BANDWIDTH_WINDOW_MILLIS,
);

interface WindowObservation {
  readonly name: string;
  readonly phase: "transition" | "steady";
  readonly duration_millis: number;
  readonly server_payload_bytes_per_second: number;
  readonly client_payload_bytes_per_second: number;
  readonly bandwidth: ApplicationBandwidthSummary;
}

test("production WebSocket UI bandwidth baseline", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(
    !enabled ||
      applicationOrigin === undefined ||
      gatewayToken === undefined ||
      magnet === undefined ||
      activeName === undefined ||
      libraryRows === null ||
      fileCount === null ||
      windowMillis === null,
    "production WebSocket bandwidth baseline is opt-in",
  );

  const capture = new BoundedApplicationFrameCapture();
  const windows: WindowObservation[] = [];
  const expectedSocket = `${applicationOrigin!.replace(/^http/, "ws")}/api/v1/connect`;
  const semanticHttpRequests: string[] = [];
  let applicationUpgrades = 0;
  let captureFailure: Error | null = null;

  page.on("websocket", (socket) => {
    if (socket.url() !== expectedSocket) return;
    applicationUpgrades += 1;
    socket.on("framesent", (frame) => {
      try {
        capture.add({ direction: "client_to_server", payload: frame.payload });
      } catch (error) {
        captureFailure = asError(error);
      }
    });
    socket.on("framereceived", (frame) => {
      try {
        capture.add({ direction: "server_to_client", payload: frame.payload });
      } catch (error) {
        captureFailure = asError(error);
      }
    });
  });
  page.on("request", (request) => {
    if (!request.url().startsWith(applicationOrigin!)) return;
    const pathname = new URL(request.url()).pathname;
    if (
      pathname === "/api/v1/hello" ||
      pathname === "/api/v1/commands" ||
      pathname.startsWith("/api/v1/view-sets") ||
      pathname === "/api/v1/torrents"
    ) {
      semanticHttpRequests.push(`${request.method()} ${pathname}`);
    }
  });

  const observeTransition = async (
    name: string,
    action: () => Promise<void>,
    ready: () => Promise<void>,
  ) => {
    assertCapture(captureFailure);
    const start = capture.mark();
    const started = performance.now();
    await action();
    await ready();
    await page.waitForTimeout(150);
    assertCapture(captureFailure);
    windows.push(
      observation(
        name,
        "transition",
        performance.now() - started,
        capture.summarize(start),
      ),
    );
    console.log(`bandwidth_baseline_stage ${name}`);
  };
  const observeSteady = async (name: string) => {
    assertCapture(captureFailure);
    const start = capture.mark();
    const started = performance.now();
    await page.waitForTimeout(windowMillis!);
    assertCapture(captureFailure);
    windows.push(
      observation(
        name,
        "steady",
        performance.now() - started,
        capture.summarize(start),
      ),
    );
    console.log(`bandwidth_baseline_stage ${name}`);
  };

  await page.setViewportSize({ width: 1_440, height: 900 });
  await observeTransition(
    "connect_library",
    () => page.goto(liveUrl()),
    async () => {
      await expect(
        page.getByRole("grid", { name: "Torrents" }),
      ).toHaveAttribute("aria-rowcount", String(libraryRows! + 1));
      await expect.poll(() => applicationUpgrades).toBe(1);
    },
  );
  await observeSteady("idle_transfers");

  let activeRow: Locator | null = null;
  await observeTransition(
    "add_active_transfer",
    async () => {
      const input = page
        .getByRole("form", { name: "Add torrent" })
        .getByRole("textbox", { name: "Magnet link or torrent URL" });
      await input.fill(magnet!);
      await input.press("Enter");
      await confirmDefaultAddOptions(page);
      await expect(
        page.getByRole("region", { name: "Torrent collection" }).getByRole("status"),
      ).toHaveText("Added");
    },
    async () => {
      const transfers = page.getByRole("grid", { name: "Torrents" });
      await expect(transfers).toHaveAttribute(
        "aria-rowcount",
        String(libraryRows! + 2),
      );
      activeRow = transfers.getByRole("row").filter({ hasText: activeName! });
      await expect
        .poll(async () => (await progressValueOrNull(activeRow!)) ?? -1, {
          timeout: 20_000,
        })
        .toBeGreaterThan(0);
    },
  );
  if (activeRow === null) throw new Error("active transfer row was not found");
  const progressStart = await progressValue(activeRow);
  await observeSteady("active_transfers");

  const primary = page.getByRole("navigation", { name: "Primary" });
  await observeTransition(
    "workbench_peers",
    async () => {
      await activeRow!.click();
      await primary.getByRole("button", { name: "Torrents" }).click();
      const library = page.getByRole("grid", { name: "Torrents" });
      const libraryRow = library
        .getByRole("row")
        .filter({ hasText: activeName! });
      await expect(libraryRow).toBeVisible();
      await libraryRow.click();
    },
    async () => {
      await expect(
        page.getByRole("grid", { name: "Active peer connections" }),
      ).toBeVisible();
    },
  );
  await observeSteady("peers");

  await selectDetail(
    page,
    windows,
    capture,
    () => captureFailure,
    "General",
    "general",
    () => expect(page.getByText("Current transfer")).toBeVisible(),
    windowMillis!,
  );
  await selectDetail(
    page,
    windows,
    capture,
    () => captureFailure,
    "Files",
    "files",
    () =>
      expect(page.getByRole("grid", { name: "Torrent files" })).toHaveAttribute(
        "aria-rowcount",
        String(fileCount! + 1),
      ),
    windowMillis!,
  );
  await selectDetail(
    page,
    windows,
    capture,
    () => captureFailure,
    "Pieces",
    "pieces",
    () => expect(page.getByLabel("Piece map summary")).toBeVisible(),
    windowMillis!,
  );
  await selectDetail(
    page,
    windows,
    capture,
    () => captureFailure,
    "Logs",
    "logs_normal",
    async () => {
      await expect(
        page.getByRole("log", { name: "Chronological diagnostic events" }),
      ).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Log detail level" }),
      ).toHaveValue("normal");
    },
    windowMillis!,
  );

  const progressEnd = await progressValue(
    page.getByRole("progressbar").first(),
  );
  const retainedText =
    (await page.locator("span").filter({ hasText: /kept$/ }).first().textContent()) ??
    "0 kept";
  const normalLogsRetained = Number(retainedText.replace(/\D/g, ""));
  const total = capture.summarize();

  expect(applicationUpgrades).toBe(1);
  expect(semanticHttpRequests).toEqual([]);
  expect(total.client_to_server.binary_messages).toBe(0);
  expect(total.server_to_client.binary_messages).toBe(0);
  expect(total.semantic.reset_batches).toBe(0);
  expect(progressEnd).toBeGreaterThan(progressStart);
  expect(progressEnd).toBeLessThan(100);
  for (const viewId of [
    "library",
    "torrent-summary",
    "torrent-peers",
    "torrent-files",
    "torrent-pieces",
    "logs",
    "session-rates",
  ]) {
    expect(total.semantic.view_updates[viewId], `missing ${viewId}`).toBeDefined();
  }

  console.log(
    `bandwidth_baseline_result ${JSON.stringify({
      schemaVersion: 1,
      applicationUpgrades,
      semanticHttpRequests,
      progressStart,
      progressEnd,
      normalLogsRetained,
      windowMillis,
      total,
      windows,
    })}`,
  );
});

async function selectDetail(
  page: Page,
  windows: WindowObservation[],
  capture: BoundedApplicationFrameCapture,
  captureFailure: () => Error | null,
  tabName: string,
  observationName: string,
  ready: () => Promise<void>,
  durationMillis: number,
): Promise<void> {
  assertCapture(captureFailure());
  const transitionStart = capture.mark();
  const transitionStarted = performance.now();
  await page.getByRole("tab", { name: tabName }).click();
  await ready();
  await page.waitForTimeout(150);
  assertCapture(captureFailure());
  windows.push(
    observation(
      `${observationName}_transition`,
      "transition",
      performance.now() - transitionStarted,
      capture.summarize(transitionStart),
    ),
  );
  console.log(`bandwidth_baseline_stage ${observationName}_transition`);

  const steadyStart = capture.mark();
  const steadyStarted = performance.now();
  await page.waitForTimeout(durationMillis);
  assertCapture(captureFailure());
  windows.push(
    observation(
      observationName,
      "steady",
      performance.now() - steadyStarted,
      capture.summarize(steadyStart),
    ),
  );
  console.log(`bandwidth_baseline_stage ${observationName}`);
}

function observation(
  name: string,
  phase: WindowObservation["phase"],
  durationMillis: number,
  bandwidth: ApplicationBandwidthSummary,
): WindowObservation {
  const seconds = durationMillis / 1_000;
  return {
    name,
    phase,
    duration_millis: durationMillis,
    server_payload_bytes_per_second:
      bandwidth.server_to_client.payload_bytes / seconds,
    client_payload_bytes_per_second:
      bandwidth.client_to_server.payload_bytes / seconds,
    bandwidth,
  };
}

async function progressValue(target: Locator): Promise<number> {
  const actual = await progressValueOrNull(target);
  if (actual === null) {
    throw new Error("active transfer has no determinate progress value");
  }
  return actual;
}

async function progressValueOrNull(target: Locator): Promise<number | null> {
  const progress = target.getByRole("progressbar").first();
  const actual = await (await progress.count() === 0 ? target : progress).getAttribute(
    "aria-valuenow",
  );
  if (actual === null) return null;
  if (!/^\d+$/.test(actual))
    throw new Error(`active transfer has invalid progress value ${actual}`);
  return Number(actual);
}

async function confirmDefaultAddOptions(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Add torrent" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Add torrent" }).click();
}

function liveUrl(): string {
  return `/?token=${encodeURIComponent(gatewayToken!)}`;
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function assertCapture(error: Error | null): void {
  if (error !== null) throw error;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
