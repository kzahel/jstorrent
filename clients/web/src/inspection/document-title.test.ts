import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionSummary } from "./model";
import {
  DocumentTitleThrottle,
  documentTitleForSession,
} from "./document-title";

const CONNECTED: SessionSummary = {
  connection: "connected",
  downloadRate: 0,
  uploadRate: 0,
  dhtNodes: null,
  knownPeers: null,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("DocumentTitleThrottle", () => {
  it("applies at most once per second and keeps the latest pending title", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const throttle = new DocumentTitleThrottle(apply);

    throttle.update("first");
    vi.advanceTimersByTime(250);
    throttle.update("second");
    vi.advanceTimersByTime(250);
    throttle.update("latest");

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith("first");
    vi.advanceTimersByTime(499);
    expect(apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith("latest");
  });

  it("cancels a pending update and restores the base title on dispose", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const throttle = new DocumentTitleThrottle(apply);

    throttle.update("active");
    throttle.update("pending");
    throttle.dispose();
    vi.advanceTimersByTime(1_000);

    expect(apply.mock.calls).toEqual([["active"], ["JSTorrent"]]);
  });
});

describe("documentTitleForSession", () => {
  it("keeps the application title while idle or disconnected", () => {
    expect(documentTitleForSession(CONNECTED, "decimal")).toBe("JSTorrent");
    expect(
      documentTitleForSession(
        { ...CONNECTED, connection: "reconnecting", downloadRate: 1_500_000 },
        "decimal",
      ),
    ).toBe("JSTorrent");
  });

  it("shows both directions during an active download", () => {
    expect(
      documentTitleForSession(
        { ...CONNECTED, downloadRate: 1_500_000, uploadRate: 24_000 },
        "decimal",
      ),
    ).toBe("JSTorrent - ↓1.5 MB/s ↑24.0 kB/s");
  });

  it("shows upload-only activity and follows binary units", () => {
    expect(
      documentTitleForSession(
        { ...CONNECTED, downloadRate: 0, uploadRate: 1_536 },
        "binary",
      ),
    ).toBe("JSTorrent - ↓0 B/s ↑1.5 KB/s");
  });

  it("does not present an unavailable direction as zero", () => {
    expect(
      documentTitleForSession(
        { ...CONNECTED, downloadRate: 1_000, uploadRate: null },
        "decimal",
      ),
    ).toBe("JSTorrent - ↓1.0 kB/s ↑—");
  });
});
