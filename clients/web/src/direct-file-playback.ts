import { PlaysVideoEngine } from "playsvideo";
import { openDirectFileConnection } from "./direct-file-connection";
import { negotiateRangeStream } from "./direct-file-range-stream";
import {
  DirectFilePlaybackSource,
  type PlaybackReadStats,
} from "./direct-file-playback-source";
import type { RemoteApplicationWebSocket } from "./remote-application-websocket";
import type { RemoteCompletedFilePlaybackRequest } from "./inspection/remote-access/types";

export interface DirectFilePlayback {
  readonly stats: PlaybackReadStats;
  close(): Promise<void>;
}
export async function playDirectFile(
  transport: RemoteApplicationWebSocket,
  request: RemoteCompletedFilePlaybackRequest,
): Promise<DirectFilePlayback> {
  const lifetime = new AbortController();
  const signal = request.signal
    ? AbortSignal.any([request.signal, lifetime.signal])
    : lifetime.signal;
  const connection = await openDirectFileConnection(transport, {
    torrentId: request.torrentId,
    fileIndex: request.fileIndex,
    expectedLength: BigInt(request.lengthBytes),
    signal,
  });
  let engine: PlaysVideoEngine | undefined;
  let source: DirectFilePlaybackSource | undefined;
  let closed: Promise<void> | undefined;
  const close = () =>
    (closed ??= Promise.resolve().then(async () => {
      signal.removeEventListener("abort", abort);
      connection.channel.removeEventListener("close", failed);
      lifetime.abort();
      source?._dispose();
      engine?.destroy();
      request.video.pause();
      request.video.removeAttribute("src");
      request.video.load();
      await connection.close();
    }));
  const abort = () => {
    void close();
  };
  const failed = () => {
    request.onError?.(
      "The direct video connection was closed. Close the player and try again.",
    );
    void close();
  };
  const cleanup = async () => {
    signal.removeEventListener("abort", abort);
    connection.channel.removeEventListener("close", failed);
    return close();
  };
  try {
    const ranges = await negotiateRangeStream(
      connection.channel,
      connection.peer,
      connection.fileLength,
      signal,
    );
    if (!ranges)
      throw new Error(
        "This host needs an update to support remote video playback.",
      );
    source = new DirectFilePlaybackSource(ranges, () => {
      ranges.close();
      void close();
    });
    engine = new PlaysVideoEngine(request.video, {
      embeddedSubtitlePolicy: "off",
      transcodeWorkers: 0,
    });
    engine.addEventListener("error", (event) => {
      request.onError?.(
        (event as CustomEvent<{ message: string }>).detail.message,
      );
      void cleanup();
    });
    engine.addEventListener("ready", () => request.onReady?.());
    signal.addEventListener("abort", abort, { once: true });
    connection.channel.addEventListener("close", failed);
    signal.throwIfAborted();
    engine.loadSource(source, { targetSegmentDuration: 4 });
    return { stats: source.stats, close: cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
