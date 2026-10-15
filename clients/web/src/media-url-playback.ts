import { PlaysVideoEngine } from "playsvideo";
import { DirectFilePlaybackSource } from "./direct-file-playback-source";
import { HttpRangeReader } from "./http-range-reader";
import type { VideoPlaybackRequest } from "./inspection/video-playback";

/** Starts playsvideo on an element; the caller closes it with `resetVideo`. */
export function startPlaysVideo(
  video: HTMLVideoElement,
  source: DirectFilePlaybackSource,
  callbacks: {
    readonly onReady?: (() => void) | undefined;
    readonly onError: (message: string) => void;
  },
): PlaysVideoEngine {
  const engine = new PlaysVideoEngine(video, {
    embeddedSubtitlePolicy: "off",
    transcodeWorkers: 0,
  });
  engine.addEventListener("error", (event) => {
    callbacks.onError((event as CustomEvent<{ message: string }>).detail.message);
  });
  engine.addEventListener("ready", () => callbacks.onReady?.());
  engine.loadSource(source, { targetSegmentDuration: 4 });
  return engine;
}

export function resetVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

/** Plays one completed file through its file-scoped media URL. */
export async function playMediaUrl(
  url: string,
  request: VideoPlaybackRequest,
): Promise<{ close(): Promise<void> }> {
  const lifetime = new AbortController();
  const signal = request.signal
    ? AbortSignal.any([request.signal, lifetime.signal])
    : lifetime.signal;
  signal.throwIfAborted();
  const ranges = new HttpRangeReader(new URL(url, globalThis.location?.href).href, BigInt(request.lengthBytes));
  let engine: PlaysVideoEngine | undefined;
  let closed: Promise<void> | undefined;
  const close = () =>
    (closed ??= Promise.resolve().then(async () => {
      signal.removeEventListener("abort", abort);
      lifetime.abort();
      source._dispose();
      engine?.destroy();
      resetVideo(request.video);
      await ranges.waitForIdle();
    }));
  const abort = () => {
    void close();
  };
  const source = new DirectFilePlaybackSource(ranges, abort);
  signal.addEventListener("abort", abort, { once: true });
  engine = startPlaysVideo(request.video, source, {
    onReady: request.onReady,
    onError: (message) => {
      request.onError?.(message);
      void close();
    },
  });
  return { close };
}
