// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render as renderUnwrapped, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  DesktopUpdater,
  DesktopUpdaterSnapshot,
} from "../updater/types";
import { AboutUpdatesSettingsSection } from "./AboutUpdatesSettingsSection";
import { DesktopUpdaterController } from "../updater/controller";
import { ToastProvider } from "./Toast";

const render = (ui: Parameters<typeof renderUnwrapped>[0]) =>
  renderUnwrapped(ui, { wrapper: ToastProvider });

describe("About and updates settings", () => {
  it("shows build identity and routes manual check and install", async () => {
    const user = userEvent.setup();
    const updater = fakeUpdater();
    render(
      <AboutUpdatesSettingsSection
        updater={updater}
        snapshot={snapshot({
          phase: "available",
          version: "0.1.1",
          notes: "Updater is ready.",
          reason: "startup",
        })}
      />,
    );

    expect(screen.getByText("0.1.0")).toBeVisible();
    expect(screen.getByText("abcdef123456")).toBeVisible();
    expect(screen.getByText("aarch64-apple-darwin")).toBeVisible();
    expect(screen.getByText("Updater is ready.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    await user.click(screen.getByRole("button", { name: "Install and restart" }));
    expect(updater.check).toHaveBeenCalledWith("manual");
    expect(updater.install).toHaveBeenCalledOnce();
  });

  it("shows a manual release path for a package-manager install", () => {
    render(
      <AboutUpdatesSettingsSection
        updater={fakeUpdater()}
        snapshot={snapshot({
          phase: "manual-install",
          packageLabel: "Linux DEB package",
        })}
      />,
    );
    expect(screen.getByText(/Linux DEB package stays/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open release downloads" }),
    ).toHaveAttribute("href", "https://github.com/kzahel/jstorrent/releases/latest");
  });

  it.each(["msi", "deb", "rpm", "unknown"] as const)("%s renders its initial real controller state without automatic controls", (bundleType) => {
    const backend = { check: vi.fn(async () => null), relaunch: vi.fn(async () => undefined) };
    const controller = new DesktopUpdaterController(backend, {
      ...snapshot({ phase: "idle" }).info, bundleType,
    });
    try {
      const view = render(<AboutUpdatesSettingsSection updater={controller} snapshot={controller.getSnapshot()} />);
      expect(within(view.container).getByText("Manual update required")).toBeVisible();
      expect(within(view.container).getByRole("link", { name: "Open release downloads" })).toBeVisible();
      expect(within(view.container).queryByRole("button", { name: "Check for updates" })).not.toBeInTheDocument();
      expect(within(view.container).queryByRole("button", { name: "Install and restart" })).not.toBeInTheDocument();
      const updates = within(view.container).getByText("Updates").closest("fieldset")!;
      expect(within(updates).queryByText(/automatic updates enabled|checks automatically|installation identifier/i)).not.toBeInTheDocument();
      expect(within(view.container).getByRole("button", { name: "Prepare diagnostics" })).toBeVisible();
      expect(backend.check).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      controller.close();
    }
  });

  it("lets desktop users select Latest and explains the Stable catch-up state", async () => {
    const user = userEvent.setup();
    const updater = fakeUpdater();
    const view = render(<AboutUpdatesSettingsSection updater={updater} snapshot={{ ...snapshot({ phase: "waiting-for-stable" }), channel: "stable" }} />);
    expect(within(view.container).getByText("Waiting for Stable to catch up")).toBeVisible();
    expect(within(view.container).getByText("Update channel")).toBeVisible();
    await user.selectOptions(within(view.container).getByRole("combobox"), "latest");
    expect(updater.selectChannel).toHaveBeenCalledWith("latest");
  });

  it("offers the headless update command without a browser install action", async () => {
    const user = userEvent.setup();
    const updater = fakeUpdater();
    const view = render(
      <AboutUpdatesSettingsSection
        updater={updater}
        snapshot={{
          info: {
            version: "0.1.0",
            buildId: "0.1.0",
            target: "linux-gnu",
            arch: "x86_64",
            bundleType: "headless",
            checkPrivacy: "anonymous",
          },
          state: {
            phase: "available",
            version: "0.1.1",
            reason: "startup",
            manualApply: {
              command: "$HOME/.local/bin/rstorrent-headless update --apply",
              releaseUrl:
                "https://github.com/kzahel/jstorrent/releases/tag/headless-v0.1.1",
            },
          },
        }}
      />,
    );
    expect(within(view.container).getByRole("button", { name: "Copy update command" })).toBeVisible();
    expect(view.container.textContent).not.toContain("rstorrent-headless");
    await user.click(within(view.container).getByRole("button", { name: "Copy update command" }));
    expect(await navigator.clipboard.readText()).toBe("$HOME/.local/bin/rstorrent-headless update --apply");
    expect(within(view.container).getByRole("status").textContent).toContain("Update command copied");
    expect(
      within(view.container).getByText(/no installation identifier/i),
    ).toBeVisible();
    expect(
      within(view.container).queryByRole("button", {
        name: "Install and restart",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(view.container).getByRole("link", { name: "Review signed release" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/kzahel/jstorrent/releases/tag/headless-v0.1.1",
    );
  });
});

function snapshot(
  state: DesktopUpdaterSnapshot["state"],
): DesktopUpdaterSnapshot {
  return {
    info: {
      version: "0.1.0",
      buildId: "abcdef1234567890",
      target: "aarch64-apple-darwin",
      arch: "aarch64",
      bundleType: state.phase === "manual-install" ? "deb" : "app",
    },
    state,
  };
}

function fakeUpdater(): DesktopUpdater {
  return {
    getSnapshot: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    check: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    dismiss: vi.fn(),
    selectChannel: vi.fn(async () => undefined),
    close: vi.fn(),
  };
}
