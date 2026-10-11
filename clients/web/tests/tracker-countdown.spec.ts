import fs from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator } from "@playwright/test";
import type { ApplicationServerFrame, UpdateBatch } from "../src/api";

const magnet = process.env.RSTORRENT_TRACKER_COUNTDOWN_MAGNET;
const trackerUrl = process.env.RSTORRENT_TRACKER_COUNTDOWN_URL;

function seconds(text: string): number {
  const match = /^Announce in (?:(\d+)h )?(?:(\d+)m(?: )?)?(?:(\d+)s)?$/.exec(text.trim());
  if (match === null) throw new Error(`unexpected countdown: ${text}`);
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

async function remaining(row: Locator): Promise<number> {
  return seconds(await row.getByRole("gridcell").nth(6).innerText());
}

test("real tracker countdown survives unrelated updates, tab reopen and reload", async ({ page }) => {
  test.skip(magnet === undefined || trackerUrl === undefined, "controlled tracker/gateway runner is required");
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const batches: UpdateBatch[] = [];
  page.on("websocket", socket => {
    socket.on("framereceived", frame => {
      if (typeof frame.payload !== "string") return;
      const value = JSON.parse(frame.payload) as ApplicationServerFrame;
      if (value.type === "view_batch") batches.push(value.batch);
      if (value.type === "result" && value.result.type === "view_set_opened") {
        batches.push(value.result.response.initial);
      }
    });
  });
  // Prepare only this runner's empty profile; metadata-only intake is a
  // separate flow and would keep its modal open with this no-peer fixture.
  const setup = await page.request.post("/api/v1/commands", { headers: {
    Origin: process.env.RSTORRENT_PLAYWRIGHT_BASE_URL!,
    "x-rstorrent-owner": "0123456789abcdef0123456789abcdef",
  }, data: {
    version: 1, request_id: "tracker-clock-setup",
    command: { type: "set_show_file_selection", show: false },
  } });
  expect(setup.ok(), await setup.text()).toBe(true);
  expect((await setup.json()).status).toBe("success");
  await page.goto("/");
  const form = page.getByRole("form", { name: "Add torrent" });
  await form.getByRole("textbox", { name: "Magnet link or torrent URL" }).fill(magnet!);
  await form.getByRole("textbox", { name: "Magnet link or torrent URL" }).press("Enter");
  const options = page.getByRole("dialog", { name: "Choose download options" });
  await expect(options).toBeVisible();
  await options.getByRole("button", { name: "Add torrent" }).click();
  const torrent = page.getByRole("grid", { name: "Torrents" }).getByRole("row").filter({ hasText: "Tracker clock fixture" });
  await expect(torrent).toBeVisible();
  await torrent.click();
  await page.getByRole("tab", { name: "Trackers" }).click();
  const grid = page.getByRole("grid", { name: "Torrent trackers" });
  const row = grid.getByRole("row").filter({ hasText: trackerUrl! });
  await expect(row).toContainText("reannounce wait");
  const startedAt = performance.now();
  const batchStart = batches.length;
  const samples: number[] = [];
  while (performance.now() - startedAt < 6000) {
    samples.push(await remaining(row));
    await page.waitForTimeout(150);
  }
  expect(samples.length).toBeGreaterThan(20);
  for (let i = 1; i < samples.length; i++) expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]!);
  expect(samples[0]! - samples.at(-1)!).toBeGreaterThanOrEqual(5);
  const unrelated = batches.slice(batchStart).filter(batch => batch.updates.some(update =>
    (update.type === "snapshot" && update.snapshot.type === "session_current_rates") ||
    (update.type === "patch" && update.patch.type === "session_current_rates"),
  ));
  expect(unrelated.length).toBeGreaterThanOrEqual(3);
  expect(unrelated.every(batch => /^\d+$/.test(batch.server_now_millis))).toBe(true);

  const beforeReopen = await remaining(row);
  await page.getByRole("tab", { name: "General" }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("tab", { name: "Trackers" }).click();
  await expect(row).toContainText("reannounce wait");
  const afterReopen = await remaining(row);
  expect(afterReopen).toBeLessThanOrEqual(beforeReopen - 2);

  await page.reload();
  await expect(torrent).toBeVisible();
  await torrent.click();
  await page.getByRole("tab", { name: "Trackers" }).click();
  await expect(row).toContainText("reannounce wait");
  const afterReload = await remaining(row);
  expect(afterReload).toBeLessThanOrEqual(afterReopen);
  const snapshots = batches.flatMap(batch => batch.updates.flatMap(update =>
    update.type === "snapshot" && update.snapshot.type === "trackers" ? [update.snapshot] : [],
  ));
  expect(snapshots.length).toBeGreaterThanOrEqual(3);
  const deadlines = snapshots.flatMap(snapshot => snapshot.trackers.map(tracker => tracker.next_action_at_millis));
  expect(new Set(deadlines).size).toBe(1);
  if (process.env.RSTORRENT_SCREENSHOT_DIR !== undefined) {
    await fs.mkdir(process.env.RSTORRENT_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.RSTORRENT_SCREENSHOT_DIR, "tracker-countdown.png") });
  }
  console.log(`tracker_clock_evidence ${JSON.stringify({ samples: samples.length, first: samples[0], last: samples.at(-1), unrelatedBatches: unrelated.length, beforeReopen, afterReopen, afterReload, stableDeadline: true })}`);
});
