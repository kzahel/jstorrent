// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogRecoveryStatus } from "../../api";
import type { DesktopUpdater, DesktopUpdaterSnapshot } from "../updater/types";
import { RecoveryScreen } from "./RecoveryScreen";

afterEach(cleanup);

function status(overrides: Partial<CatalogRecoveryStatus> = {}): CatalogRecoveryStatus {
  return {
    reason: "migration_failed",
    catalog_version: 26,
    supported_version: 28,
    export_available: true,
    details: "catalog version: 26; supported version: 28; error: injected",
    ...overrides,
  };
}

function updater(snapshot: DesktopUpdaterSnapshot): DesktopUpdater & { check: ReturnType<typeof vi.fn> } {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    check: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    dismiss: () => undefined,
    close: () => undefined,
  };
}

describe("RecoveryScreen", () => {
  it("explains a failed upgrade and exports the torrent list", async () => {
    const exportTorrentList = vi.fn(async () => true);
    const quit = vi.fn(async () => undefined);
    const fakeUpdater = updater({
      info: { version: "0.4.0", buildId: "b", target: "t", arch: "a", bundleType: "app", checkPrivacy: "preference-controlled" },
      state: { phase: "idle" },
    });
    render(
      <RecoveryScreen
        recovery={{ status: status(), exportTorrentList, quit }}
        updater={fakeUpdater}
        openExternalUrl={vi.fn(async () => undefined)}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "JSTorrent couldn't update your torrent list" }),
    ).toBeVisible();
    expect(screen.getByText(/safe and unchanged/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(fakeUpdater.check).toHaveBeenCalledWith("manual");
    fireEvent.click(screen.getByRole("button", { name: "Export torrent list" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Torrent list saved."));
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    expect(quit).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Start fresh|Reset|Clear/ })).toBeNull();
  });

  it("offers the available update and reports export failures", async () => {
    const fakeUpdater = updater({
      info: { version: "0.4.0", buildId: "b", target: "t", arch: "a", bundleType: "app", checkPrivacy: "preference-controlled" },
      state: { phase: "available", version: "0.4.1", reason: "manual" },
    });
    render(
      <RecoveryScreen
        recovery={{
          status: status({ reason: "newer_version", catalog_version: 31 }),
          exportTorrentList: async () => {
            throw new Error("disk full");
          },
          quit: async () => undefined,
        }}
        updater={fakeUpdater}
      />,
    );
    expect(screen.getByRole("button", { name: "Install version 0.4.1" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Export torrent list" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("disk full"));
  });

  it("only asks to close the other window when the list is locked", () => {
    render(
      <RecoveryScreen
        recovery={{
          status: status({ reason: "locked", export_available: false }),
          exportTorrentList: async () => true,
          quit: async () => undefined,
        }}
        updater={updater({
          info: { version: "0.4.0", buildId: "b", target: "t", arch: "a", bundleType: "app", checkPrivacy: "preference-controlled" },
          state: { phase: "idle" },
        })}
        openExternalUrl={async () => undefined}
      />,
    );
    expect(screen.getByRole("heading", { name: "JSTorrent is already open" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Check for updates" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export torrent list" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Report a problem" })).toBeNull();
  });
});
