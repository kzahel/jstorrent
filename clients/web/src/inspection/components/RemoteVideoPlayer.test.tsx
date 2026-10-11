// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopRemoteAccess,
  RemoteCompletedFilePlaybackRequest,
} from "../remote-access/types";
import {
  canPlayRemoteFile,
  RemotePlaybackProvider,
  useRemotePlayback,
} from "./RemoteVideoPlayer";

afterEach(cleanup);
const file = {
  torrentId: "torrent",
  fileIndex: 0,
  fileName: "Bunny.mp4",
  lengthBytes: "64657027",
};
function Trigger() {
  const playback = useRemotePlayback();
  return <button onClick={() => playback.play(file)}>Play movie</button>;
}
describe("remote video player", () => {
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
      <RemotePlaybackProvider remoteAccess={remoteAccess}>
        <Trigger />
      </RemotePlaybackProvider>,
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
      <RemotePlaybackProvider remoteAccess={remoteAccess}>
        <Trigger />
      </RemotePlaybackProvider>,
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
      <RemotePlaybackProvider remoteAccess={remoteAccess}>
        <Trigger />
      </RemotePlaybackProvider>,
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
      <RemotePlaybackProvider remoteAccess={remoteAccess}>
        <Trigger />
      </RemotePlaybackProvider>,
    );
    await userEvent.click(screen.getByText("Play movie"));
    expect(screen.getByRole("status").textContent).toContain("does not support");
    expect(playCompletedFile).not.toHaveBeenCalled();
  });
  it("limits remote eligibility to completed MP4/M4V files", () => {
    expect(canPlayRemoteFile("BUNNY.MP4", "available")).toBe(true);
    expect(canPlayRemoteFile("movie.m4v", "available")).toBe(true);
    expect(canPlayRemoteFile("movie.mp4", "streamable")).toBe(false);
    expect(canPlayRemoteFile("movie.mkv", "available")).toBe(false);
  });
});
