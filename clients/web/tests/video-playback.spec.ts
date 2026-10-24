import { open, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Use an existing, licensed local MP4; never download or commit media here.
const fixture = process.env.RSTORRENT_PLAYBACK_FILE;

test("local MP4 plays its native audio, seeks, and survives parser disposal", async ({ page }) => {
  test.skip(!fixture, "RSTORRENT_PLAYBACK_FILE selects an existing local MP4");
  test.setTimeout(60_000);
  const { size } = await stat(fixture!);
  const file = await open(fixture!, "r");
  try {
    await page.route("**/media/v1/playback-fixture", async (route) => {
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
      if (!range) return route.fulfill({ status: 416 });
      const start = Number(range[1]);
      // Native media loaders ask for open-ended ranges. Serve bounded chunks.
      const end = Math.min(size - 1, range[2] ? Number(range[2]) : start + 1024 * 1024 - 1);
      if (start > end || end - start + 1 > 8 * 1024 * 1024) {
        return route.fulfill({ status: 416 });
      }
      const bytes = Buffer.alloc(end - start + 1);
      await file.read(bytes, 0, bytes.length, start);
      await route.fulfill({
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "accept-ranges": "bytes",
          "content-range": `bytes ${start}-${end}/${size}`,
        },
        body: bytes,
      });
    });
    await page.route("**/playback-test", route => route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Playback regression</title><body></body>",
    }));
    await page.goto("/playback-test");
    const start = () => page.evaluate(async ({ size, name }) => {
      const modulePath = "/src/media-url-playback.ts";
      const { playMediaUrl } = await import(/* @vite-ignore */ modulePath);
      const video = document.createElement("video");
      video.controls = true;
      // Headless audio output is unavailable; decoded audio is asserted below.
      video.muted = true;
      document.body.append(video);
      const state = window as typeof window & {
        playback?: { close(): Promise<void> };
        playbackErrors?: string[];
      };
      state.playbackErrors = [];
      state.playback = await playMediaUrl("/media/v1/playback-fixture", {
        torrentId: "fixture", fileIndex: 0, fileName: name,
        lengthBytes: String(size), video,
        onError: (message: string) => state.playbackErrors!.push(message),
      });
    }, { size, name: path.basename(fixture!) });
    const close = () => page.evaluate(async () => {
      const state = window as typeof window & { playback?: { close(): Promise<void> } };
      await state.playback!.close();
      const video = document.querySelector("video")!;
      if (video.hasAttribute("src")) throw new Error("Player retained its source");
      video.remove();
    });

    await start();
    await expect.poll(() => page.evaluate(() => ({
      ready: document.querySelector("video")!.readyState >= 2,
      errors: (window as typeof window & { playbackErrors: string[] }).playbackErrors,
    }))).toEqual({ ready: true, errors: [] });
    expect(await page.locator("video").getAttribute("src")).toBe(new URL("/media/v1/playback-fixture", page.url()).href);
    await page.locator("video").evaluate(video => video.play());
    await page.waitForFunction(() => {
      const video = document.querySelector("video")!;
      return video.getVideoPlaybackQuality().totalVideoFrames > 5 &&
        (video as HTMLVideoElement & { webkitAudioDecodedByteCount: number }).webkitAudioDecodedByteCount > 0;
    });
    for (const fraction of [0.75, 0.1]) {
      await page.locator("video").evaluate((video, fraction) => {
        video.currentTime = video.duration * fraction;
      }, fraction);
      await page.waitForFunction((fraction) => {
        const video = document.querySelector("video")!;
        return !video.seeking && video.readyState >= 2 &&
          Math.abs(video.currentTime - video.duration * fraction) < 2;
      }, fraction);
      const frameTime = await page.locator("video").evaluate(video =>
        new Promise<number>(resolve => video.requestVideoFrameCallback((_now, frame) => resolve(frame.mediaTime))));
      const target = await page.locator("video").evaluate((video, fraction) => video.duration * fraction, fraction);
      expect(Math.abs(frameTime - target)).toBeLessThan(2);
    }
    await close();
    await start();
    await page.waitForFunction(() => document.querySelector("video")!.readyState >= 2);
    await close();
    expect(await page.evaluate(() =>
      (window as typeof window & { playbackErrors: string[] }).playbackErrors)).toEqual([]);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await file.close();
  }
});
