import { useCallback, useEffect, useRef, useState } from "react";

import type { MediaFileAvailability } from "../../api";
import { useInspectionCommand, useInspectionStore } from "../context";
import { useToast } from "./Toast";
import { usePlayback } from "./VideoPlayer";

export interface PlayableFile {
  readonly torrentId: string;
  readonly fileIndex: number;
  readonly name: string;
  readonly lengthBytes: string;
  readonly mediaAvailability: MediaFileAvailability;
}

export function isPlaybackEligible(availability: MediaFileAvailability): boolean {
  return availability === "available" || availability === "streamable";
}

/**
 * Plays a file in the in-page player, or opens it outside the app where the
 * player cannot. One file opens at a time; an unmounted owner ignores a late
 * result.
 */
export function useMediaPlayback() {
  const playback = usePlayback();
  const demo = useInspectionStore((state) => state.demo);
  const execute = useInspectionCommand();
  const toast = useToast();
  const request = useRef(0);
  const [pending, setPending] = useState<{
    readonly torrentId: string;
    readonly fileIndex: number;
  } | null>(null);

  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  const reset = useCallback(() => {
    request.current += 1;
    setPending(null);
  }, []);

  const play = async (file: PlayableFile) => {
    if (demo !== null || pending !== null || !isPlaybackEligible(file.mediaAvailability)) {
      return;
    }
    if (playback.canPlay(file.name, file.mediaAvailability)) {
      playback.play({
        torrentId: file.torrentId,
        fileIndex: file.fileIndex,
        fileName: file.name,
        lengthBytes: file.lengthBytes,
      });
      return;
    }
    // Remote sessions have no new-tab Open to fall back to.
    if (playback.remote) return;
    const current = request.current + 1;
    request.current = current;
    setPending({ torrentId: file.torrentId, fileIndex: file.fileIndex });
    try {
      // The player opening is the confirmation; only failures need words.
      await execute({
        type: "open_file",
        torrentId: file.torrentId,
        fileIndex: file.fileIndex,
      });
    } catch (error) {
      if (request.current === current) {
        toast.show({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (request.current === current) setPending(null);
    }
  };

  return { playback, demo: demo !== null, pending, play, reset };
}
