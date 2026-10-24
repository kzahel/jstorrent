import { PlaysVideoEngine } from "playsvideo";
import { DirectFilePlaybackSource } from "./direct-file-playback-source";
import { HttpRangeReader } from "./http-range-reader";
import type { VideoPlaybackRequest } from "./inspection/video-playback";

/** Starts playsvideo on an element; the caller closes it with `resetVideo`. */
export function startPlaysVideo(
  video: HTMLVideoElement,
  source: DirectFilePlaybackSource,
  options: {
    readonly onReady?: (() => void) | undefined;
    readonly onError: (message: string) => void;
    readonly nativeMp4Url?: string | undefined;
  },
): PlaysVideoEngine {
  const engine = new PlaysVideoEngine(video, {
    embeddedSubtitlePolicy: "off",
    transcodeWorkers: 0,
  });
  engine.addEventListener("error", (event) => {
    options.onError((event as CustomEvent<{ message: string }>).detail.message);
  });
  engine.addEventListener("ready", () => options.onReady?.());
  if (options.nativeMp4Url) {
    // Native MP4 playback can accept codecs (notably MP3) that fMP4/MSE cannot.
    // playsvideo checks the parsed codecs with canPlayType before selecting it.
    engine.loadWithOptions({
      source,
      options: [
        { mode: "direct-url", mimeType: "video/mp4", url: options.nativeMp4Url },
        { mode: "hls" },
      ],
      targetSegmentDuration: 4,
    });
  } else {
    engine.loadSource(source, { targetSegmentDuration: 4 });
  }
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
  const mediaUrl = new URL(url, globalThis.location?.href).href;
  const ranges = new HttpRangeReader(mediaUrl, BigInt(request.lengthBytes));
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
  // Native handoff disposes the parser before playback ends. The dialog's
  // signal/close owns this session; parser disposal only releases range reads.
  const source = new DirectFilePlaybackSource(ranges, () => {});
  signal.addEventListener("abort", abort, { once: true });
  engine = startPlaysVideo(request.video, source, {
    onReady: request.onReady,
    nativeMp4Url: /\.(mp4|m4v)$/i.test(request.fileName) ? mediaUrl : undefined,
    onError: (message) => {
      request.onError?.(message);
      void close();
    },
  });
  return { close };
}
