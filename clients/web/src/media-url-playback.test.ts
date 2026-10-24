// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { Engine, instances } = vi.hoisted(() => {
  const instances: Engine[] = [];
  class Engine extends EventTarget {
    loadSource = vi.fn();
    loadWithOptions = vi.fn();
    destroy = vi.fn();
    constructor() {
      super();
      instances.push(this);
    }
  }
  return { Engine, instances };
});
vi.mock("playsvideo", () => ({ PlaysVideoEngine: Engine, Source: class {} }));

import { DirectFilePlaybackSource } from "./direct-file-playback-source";
import { playMediaUrl, startPlaysVideo } from "./media-url-playback";

function fixture(fileName = "Big Buck Bunny.mp4", signal?: AbortSignal) {
  const video = document.createElement("video");
  const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
  const load = vi.spyOn(video, "load").mockImplementation(() => {});
  const request = {
    torrentId: "fixture", fileIndex: 0, fileName, lengthBytes: "276134947",
    video, ...(signal === undefined ? {} : { signal }),
    onReady: vi.fn(), onError: vi.fn(),
  };
  return { request, video, pause, load };
}

beforeEach(() => { instances.length = 0; });

describe("media URL playback", () => {
  it.each(["Big Buck Bunny.mp4", "movie.M4V"])(
    "offers native MP4 with codec-checked HLS fallback for %s", async (name) => {
      const { request } = fixture(name);
      const session = await playMediaUrl("https://example.test/media/v1/fixture", request);
      const engine = instances[0]!;
      expect(engine.loadSource).not.toHaveBeenCalled();
      expect(engine.loadWithOptions).toHaveBeenCalledWith({
        source: expect.any(DirectFilePlaybackSource),
        options: [
          { mode: "direct-url", mimeType: "video/mp4", url: "https://example.test/media/v1/fixture" },
          { mode: "hls" },
        ],
        targetSegmentDuration: 4,
      });
      await session.close();
    },
  );

  it("releases the parser after native handoff without closing playback", async () => {
    const { request, video, pause, load } = fixture();
    const session = await playMediaUrl("https://example.test/media/v1/fixture", request);
    const engine = instances[0]!;
    const source = engine.loadWithOptions.mock.calls[0]![0].source as DirectFilePlaybackSource;
    source._dispose();
    await Promise.resolve();
    expect(engine.destroy).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    engine.dispatchEvent(new Event("ready"));
    expect(request.onReady).toHaveBeenCalledOnce();
    video.src = "https://example.test/media/v1/fixture";
    await Promise.all([session.close(), session.close()]);
    expect(engine.destroy).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
    expect(video.hasAttribute("src")).toBe(false);
  });

  it("keeps MKV on the bounded remux path", async () => {
    const { request } = fixture("movie.mkv");
    const session = await playMediaUrl("https://example.test/media/v1/fixture", request);
    expect(instances[0]!.loadWithOptions).not.toHaveBeenCalled();
    expect(instances[0]!.loadSource).toHaveBeenCalledWith(expect.any(DirectFilePlaybackSource), { targetSegmentDuration: 4 });
    await session.close();
  });

  it("keeps sources without an HTTP option on the remote remux path", () => {
    const { video } = fixture();
    const source = {} as DirectFilePlaybackSource;
    const engine = startPlaysVideo(video, source, { onError: vi.fn() });
    expect(instances[0]!.loadWithOptions).not.toHaveBeenCalled();
    expect(instances[0]!.loadSource).toHaveBeenCalledWith(source, { targetSegmentDuration: 4 });
    engine.destroy();
  });

  it("aborts native playback even after its parser has been released", async () => {
    const lifetime = new AbortController();
    const { request, video } = fixture("movie.mp4", lifetime.signal);
    const session = await playMediaUrl("https://example.test/media/v1/fixture", request);
    const engine = instances[0]!;
    engine.loadWithOptions.mock.calls[0]![0].source._dispose();
    video.src = "https://example.test/media/v1/fixture";
    lifetime.abort();
    await session.close();
    expect(engine.destroy).toHaveBeenCalledOnce();
    expect(video.hasAttribute("src")).toBe(false);
  });

  it("reports fatal engine errors and tears down the player", async () => {
    const { request } = fixture();
    const session = await playMediaUrl("https://example.test/media/v1/fixture", request);
    instances[0]!.dispatchEvent(new CustomEvent("error", { detail: { message: "Unsupported codec" } }));
    await session.close();
    expect(request.onError).toHaveBeenCalledWith("Unsupported codec");
    expect(instances[0]!.destroy).toHaveBeenCalledOnce();
  });

  it("does not start an already aborted request", async () => {
    const { request } = fixture("movie.mp4", AbortSignal.abort());
    await expect(playMediaUrl("https://example.test/media/v1/fixture", request)).rejects.toThrow();
    expect(instances).toHaveLength(0);
  });
});
