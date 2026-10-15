// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopRemoteAccess,
  RemoteCompletedFilePlaybackRequest,
} from "../remote-access/types";
import {
  canPlayLocalFile,
  canPlayRemoteFile,
  type LocalVideoPlayback,
  type VideoPlaybackRequest,
} from "../video-playback";
import { PlaybackProvider, usePlayback } from "./VideoPlayer";

afterEach(cleanup);
const file = {
  torrentId: "torrent",
  fileIndex: 0,
  fileName: "Bunny.mp4",
  lengthBytes: "64657027",
};
function Trigger() {
  const playback = usePlayback();
  return <button onClick={() => playback.play(file)}>Play movie</button>;
}
describe("video player", () => {
  it("closes and aborts a pending connection, then disposes its late result", async () => {
    let request!: RemoteCompletedFilePlaybackRequest;
    let connected!: (result: { close(): Promise<void> }) => void;
    const playCompletedFile = vi.fn(
      (value: RemoteCompletedFilePlaybackRequest) => {
        request = value;
        return new Promise<{ close(): Promise<void> }>((resolve) => {
          connected = resolve;
        });
      },
    );
    const remoteAccess = {
      scope: "remote",
      directFileSupported: () => true,
      playCompletedFile,
    } as unknown as DesktopRemoteAccess;
    render(
      <PlaybackProvider remoteAccess={remoteAccess}>
        <Trigger />
      </PlaybackProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("Play movie"));
    await waitFor(() => expect(playCompletedFile).toHaveBeenCalledOnce());
    expect(request.video).toBeInstanceOf(HTMLVideoElement);
    expect(screen.getByRole("dialog", { name: "Play Bunny.mp4" })).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Close video player" }),
    );
    expect(request.signal!.aborted).toBe(true);
    const close = vi.fn(async () => {});
    await act(async () => {
      connected({ close });
    });
    expect(close).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows initialization failures and closes an established session on unmount", async () => {
    const close = vi.fn(async () => {});
    const remoteAccess = {
      scope: "remote",
      directFileSupported: () => true,
      playCompletedFile: async (
        request: RemoteCompletedFilePlaybackRequest,
      ) => {
        request.onError?.("Video metadata exceeds the playback limit.");
        return { close };
      },
    } as unknown as DesktopRemoteAccess;
    const view = render(
      <PlaybackProvider remoteAccess={remoteAccess}>
        <Trigger />
      </PlaybackProvider>,
    );
    await userEvent.click(screen.getByText("Play movie"));
    expect(
      await screen.findByText("Video metadata exceeds the playback limit."),
    ).toBeTruthy();
    view.unmount();
    expect(close).toHaveBeenCalledOnce();
  });
  it("aborts and closes the transfer on a fatal browser media error", async () => {
    let request!: RemoteCompletedFilePlaybackRequest;
    const close = vi.fn(async () => {});
    const remoteAccess = {
      scope: "remote",
      directFileSupported: () => true,
      playCompletedFile: async (value: RemoteCompletedFilePlaybackRequest) => {
        request = value;
        return { close };
      },
    } as unknown as DesktopRemoteAccess;
    render(
      <PlaybackProvider remoteAccess={remoteAccess}>
        <Trigger />
      </PlaybackProvider>,
    );
    await userEvent.click(screen.getByText("Play movie"));
    await act(async () => { request.video.dispatchEvent(new Event("error")); });
    expect(request.signal!.aborted).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("could not play");
  });
  it("does not create a connection when direct transfers are unavailable", async () => {
    const playCompletedFile = vi.fn();
    const remoteAccess = {
      scope: "remote",
      directFileSupported: () => false,
      playCompletedFile,
    } as unknown as DesktopRemoteAccess;
    render(
      <PlaybackProvider remoteAccess={remoteAccess}>
        <Trigger />
      </PlaybackProvider>,
    );
    await userEvent.click(screen.getByText("Play movie"));
    expect(screen.getByRole("status").textContent).toContain("does not support");
    expect(playCompletedFile).not.toHaveBeenCalled();
  });
  it("plays local files in the dialog and offers Open in a new tab", async () => {
    let request!: VideoPlaybackRequest;
    const close = vi.fn(async () => {});
    const localPlayback: LocalVideoPlayback = {
      play: vi.fn(async (value: VideoPlaybackRequest) => {
        request = value;
        return { close };
      }),
      openExternally: vi.fn(async () => {}),
    };
    render(
      <PlaybackProvider localPlayback={localPlayback}>
        <Trigger />
      </PlaybackProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("Play movie"));
    await waitFor(() => expect(localPlayback.play).toHaveBeenCalledOnce());
    expect(request).toMatchObject(file);
    expect(request.video).toBeInstanceOf(HTMLVideoElement);
    expect(screen.getByRole("status").textContent).toBe("Loading video…");
    await user.click(screen.getByRole("button", { name: "Open in new tab" }));
    expect(localPlayback.openExternally).toHaveBeenCalledWith(file);
    await user.click(
      screen.getByRole("button", { name: "Close video player" }),
    );
    expect(request.signal!.aborted).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
  it("shows a failed new-tab Open inside the dialog", async () => {
    const localPlayback: LocalVideoPlayback = {
      play: async () => ({ close: async () => {} }),
      openExternally: async () => {
        throw new Error("Allow pop-ups to open this file in a new tab");
      },
    };
    render(
      <PlaybackProvider localPlayback={localPlayback}>
        <Trigger />
      </PlaybackProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("Play movie"));
    await user.click(screen.getByRole("button", { name: "Open in new tab" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Allow pop-ups",
    );
  });
  it("prefers the remote player and has no new-tab Open remotely", async () => {
    const play = vi.fn();
    const remoteAccess = {
      scope: "remote",
      directFileSupported: () => true,
      playCompletedFile: async () => ({ close: async () => {} }),
    } as unknown as DesktopRemoteAccess;
    render(
      <PlaybackProvider
        remoteAccess={remoteAccess}
        localPlayback={{ play, openExternally: vi.fn() }}
      >
        <Trigger />
      </PlaybackProvider>,
    );
    await userEvent.click(screen.getByText("Play movie"));
    expect(screen.queryByRole("button", { name: "Open in new tab" })).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });
  it("opens no dialog without a playback source", async () => {
    render(
      <PlaybackProvider>
        <Trigger />
      </PlaybackProvider>,
    );
    await userEvent.click(screen.getByText("Play movie"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("limits local eligibility to completed MP4/M4V/MKV files", () => {
    expect(canPlayLocalFile("movie.MKV", "available")).toBe(true);
    expect(canPlayLocalFile("movie.mp4", "available")).toBe(true);
    expect(canPlayLocalFile("movie.mkv", "streamable")).toBe(false);
    expect(canPlayLocalFile("movie.avi", "available")).toBe(false);
  });
  it("limits remote eligibility to completed MP4/M4V files", () => {
    expect(canPlayRemoteFile("BUNNY.MP4", "available")).toBe(true);
    expect(canPlayRemoteFile("movie.m4v", "available")).toBe(true);
    expect(canPlayRemoteFile("movie.mp4", "streamable")).toBe(false);
    expect(canPlayRemoteFile("movie.mkv", "available")).toBe(false);
  });
});
