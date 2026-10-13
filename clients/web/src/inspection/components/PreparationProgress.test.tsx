// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TorrentPreparation } from "../model";
import {
  MetadataBlockState,
  metadataBlockStateAt,
  PreparationProgress,
} from "./PreparationProgress";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform() {},
    clearRect() {},
    fillRect() {},
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 480,
    height: 100,
    x: 0,
    y: 0,
    top: 0,
    right: 480,
    bottom: 100,
    left: 0,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PreparationProgress", () => {
  it("shows exact metadata progress and a text-equivalent compact block map", () => {
    render(
      <PreparationProgress preparation={metadataPreparation()} dataUnits="binary" />,
    );

    expect(
      screen.getByRole("heading", { name: "Downloading metadata" }),
    ).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "16384");
    expect(screen.getByText("16.0 KB of 32.0 KB")).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: "2 metadata blocks: 1 received, 1 requested, 0 missing",
      }),
    ).toBeVisible();
    expect(screen.getByText("Hash retries").nextSibling).toHaveTextContent("1");
  });

  it("keeps v2 hash preparation coarse and does not invent a percentage", () => {
    const preparation: TorrentPreparation = {
      generation: "8",
      metadata: null,
      integrity: {
        phase: "waiting_for_peer",
        neededHashRanges: 3,
        activeRequests: 0,
      },
    };
    render(<PreparationProgress preparation={preparation} dataUnits="binary" />);

    expect(
      screen.getByRole("heading", { name: "Waiting for a hash-capable peer" }),
    ).toBeVisible();
    expect(screen.getByText("Hash ranges needed").nextSibling).toHaveTextContent(
      "3",
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("decodes four two-bit states from each byte in protocol order", () => {
    const packed = Uint8Array.of(0b00_10_01_00);
    expect(metadataBlockStateAt(packed, 0)).toBe(MetadataBlockState.Missing);
    expect(metadataBlockStateAt(packed, 1)).toBe(MetadataBlockState.Requested);
    expect(metadataBlockStateAt(packed, 2)).toBe(MetadataBlockState.Received);
    expect(metadataBlockStateAt(packed, 3)).toBe(MetadataBlockState.Missing);
  });
});

function metadataPreparation(): TorrentPreparation {
  return {
    generation: "7",
    metadata: {
      phase: "downloading",
      totalSizeBytes: 32_768,
      receivedBytes: 16_384,
      blockCount: 2,
      blockStates: Uint8Array.of(0b0000_0110),
      activePeers: 2,
      requestsInFlight: 1,
      hashRetries: 1,
    },
    integrity: null,
  };
}
