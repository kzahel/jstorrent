import type { LiveApplication } from "./inspection/live/LiveApplication";
import type { LocalVideoPlayback } from "./inspection/video-playback";

/** Plays files from the gateway serving this page; playsvideo loads on first use. */
export function createBrowserVideoPlayback(
  application: LiveApplication,
): LocalVideoPlayback {
  return {
    play: async (request) => {
      const [url, { playMediaUrl }] = await Promise.all([
        application.createMediaUrl(request.torrentId, request.fileIndex, request.signal),
        import("./media-url-playback"),
      ]);
      return playMediaUrl(url, request);
    },
    openExternally: async (file) => {
      const result = await application.dispatch({
        type: "open_file",
        torrentId: file.torrentId,
        fileIndex: file.fileIndex,
      });
      if (!result.accepted) throw new Error(result.message);
    },
  };
}
