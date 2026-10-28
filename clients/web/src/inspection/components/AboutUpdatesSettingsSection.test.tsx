// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render as renderUnwrapped, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopUpdater,
  DesktopUpdaterSnapshot,
} from "../updater/types";
import { withHostProduct } from "../support/about";
import { AboutUpdatesSettingsSection } from "./AboutUpdatesSettingsSection";

import { DesktopUpdaterController } from "../updater/controller";
import { ToastProvider } from "./Toast";
import { setProductLocaleForTest } from "../../localization/runtime";

vi.hoisted(() => { vi.stubEnv("VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES", "1"); });
afterAll(() => { vi.unstubAllEnvs(); });

const render = (ui: Parameters<typeof renderUnwrapped>[0]) =>
  renderUnwrapped(ui, { wrapper: ToastProvider });

describe("About and updates settings", () => {
  afterEach(cleanup);

  it("shows version and support without update controls on a remote session", () => {
    render(
      <AboutUpdatesSettingsSection
        about={{ connection: "remote", pageBuild: "0123456789abcdef0123456789abcdef01234567" }}
      />,
    );
    expect(screen.getByText("Remote access")).toBeVisible();
    expect(screen.getByText("Not reported")).toBeVisible();
    expect(screen.getByText("This page")).toBeVisible();
    expect(screen.getByText("0123456789ab")).toBeVisible();
    expect(screen.queryByText("Updates")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check for updates" })).not.toBeInTheDocument();
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare diagnostics" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Report on GitHub" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Send feedback" })).toBeVisible();
  });

  it("shows what a remote host reports about itself and its profile", () => {
    render(
      <AboutUpdatesSettingsSection
        about={withHostProduct({ connection: "remote", pageBuild: "0123456789abcdef0123456789abcdef01234567" }, {
          kind: "desktop",
          version: "0.3.1",
          build_id: "fedcba9876543210fedcba9876543210fedcba98",
          target: "x86_64-pc-windows-msvc",
          identifier: "com.jstorrent.rstorrent",
          profile_id: "default",
          profile_location: "C:\\Users\\test\\AppData\\Roaming\\com.jstorrent.rstorrent\\profile",
        })}
      />,
    );
    expect(screen.getByText("0.3.1")).toBeVisible();
    expect(screen.getByText("fedcba987654")).toBeVisible();
    expect(screen.getByText("x86_64-pc-windows-msvc")).toBeVisible();
    expect(screen.getByText("Preview")).toBeVisible();
    expect(screen.getByText("Library folder")).toBeVisible();
    expect(screen.getByText(/AppData.+profile$/)).toBeVisible();
    expect(screen.getByText("0123456789ab")).toBeVisible();
    expect(screen.queryByText("Not reported")).not.toBeInTheDocument();
  });

  it("shows the companion host version", () => {
    render(<AboutUpdatesSettingsSection about={{ connection: "android-companion", hostVersion: "1.0.31" }} />);
    expect(screen.getByText("JSTorrent on Android")).toBeVisible();
    expect(screen.getByText("1.0.31")).toBeVisible();
  });

  it("marks a development profile as a separate library", () => {
    render(<AboutUpdatesSettingsSection about={{ connection: "desktop", identifier: "com.jstorrent.check" }} />);
    expect(screen.getByText("Profile")).toBeVisible();
    expect(screen.getByText("Development")).toBeVisible();
    expect(screen.getByText("com.jstorrent.check")).toBeVisible();
    expect(screen.getByText(/keeps its own library/)).toBeVisible();
    cleanup();
    render(<AboutUpdatesSettingsSection about={{ connection: "desktop", identifier: "com.jstorrent.desktop" }} />);
    expect(screen.getByText("Production")).toBeVisible();
    expect(screen.queryByText(/keeps its own library/)).not.toBeInTheDocument();
  });

  it("shows build identity and routes manual check and install", async () => {
    const user = userEvent.setup();
    const updater = fakeUpdater();
    render(
      <AboutUpdatesSettingsSection
        about={{ connection: "desktop" }}
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

  it("formats fractional update download sizes in the selected presentation language", () => {
    const restore = setProductLocaleForTest("de");
    try {
      const updater = fakeUpdater();
      const downloading = (downloadedBytes: number) => (
        <AboutUpdatesSettingsSection
          about={{ connection: "desktop" }}
          updater={updater}
          snapshot={snapshot({ phase: "downloading", version: "0.1.1", downloadedBytes })}
        />
      );
      const view = render(downloading(1536));
      expect(view.container.textContent).toContain("1,5 KiB");
      view.rerender(downloading(1572864));
      expect(view.container.textContent).toContain("1,5 MiB");
      expect(view.container.textContent).not.toContain("1.5");
    } finally { restore(); }
  });

  it("localizes update titles, package labels and progress without translating diagnostics", () => {
    const restore = setProductLocaleForTest("de");
    try {
      const updater = fakeUpdater();
      const element = (state: DesktopUpdaterSnapshot["state"]) => (
        <AboutUpdatesSettingsSection about={{ connection: "desktop" }} updater={updater} snapshot={snapshot(state)} />
      );
      const view = render(element({ phase: "available", version: "2.3.4", reason: "manual" }));
      expect(screen.getByText("JSTorrent 2.3.4 ist verfügbar")).toBeVisible();
      expect(screen.getByText("Die Installation beginnt erst nach deiner Zustimmung.")).toBeVisible();
      view.rerender(element({ phase: "downloading", version: "2.3.4", downloadedBytes: 1536, totalBytes: 3072 }));
      expect(screen.getByText("JSTorrent 2.3.4 wird heruntergeladen")).toBeVisible();
      expect(screen.getByText(/50\s*% · 1,5 KiB heruntergeladen\./)).toBeVisible();
      view.rerender(element({ phase: "installing", version: "2.3.4" }));
      expect(screen.getByText("JSTorrent 2.3.4 wird installiert")).toBeVisible();
      view.rerender(element({ phase: "manual-install", packageLabel: "English host label" }));
      expect(screen.getByText("Für Linux DEB bleibt der Paketkanal unverändert.")).toBeVisible();
      view.rerender(element({ phase: "error", operation: "check", message: "HTTP 503 from update.example" }));
      expect(screen.getByText("Suche nach Updates fehlgeschlagen")).toBeVisible();
      expect(screen.getByText("HTTP 503 from update.example")).toBeVisible();
      view.rerender(element({ phase: "error", operation: "install", message: "signature: mismatch" }));
      expect(screen.getByText("Update-Installation fehlgeschlagen")).toBeVisible();
      expect(screen.getByText("signature: mismatch")).toBeVisible();
    } finally { restore(); }
  });

  it("localizes existing host update statuses and saved outcomes while preserving unknown detail", () => {
    const restore = setProductLocaleForTest("de");
    try {
      const element = (updateMessage: string, lastOutcome?: DesktopUpdaterSnapshot["lastOutcome"]) => (
        <AboutUpdatesSettingsSection about={{ connection: "desktop" }} updater={fakeUpdater()}
          snapshot={{ ...snapshot({ phase: "available", version: "2.3.4", reason: "periodic" }), updateMessage, lastOutcome }} />
      );
      const view = render(element("Downloaded; waiting until you're away"));
      expect(screen.getByText("Heruntergeladen; wartet, bis du nicht mehr aktiv bist")).toBeVisible();
      for (const [source, translated] of [
        ["Downloaded; waiting for playback, unfinished work or connected clients", "Heruntergeladen; wartet auf das Ende der Wiedergabe, den Abschluss offener Vorgänge oder das Trennen verbundener Clients"],
        ["Downloaded; choose Install & restart to finish the update", "Heruntergeladen; wähle „Installieren und neu starten“, um das Update abzuschließen"],
        ["Downloaded; automatic installation is off", "Heruntergeladen; automatische Installation ist ausgeschaltet"],
        ["Restarting shortly to install the update", "JSTorrent startet gleich neu, um das Update zu installieren"],
      ] as const) {
        view.rerender(element(source));
        expect(screen.getByText(translated)).toBeVisible();
      }
      view.rerender(element("Automatic installation is paused for this channel"));
      expect(screen.getByText("Die automatische Installation ist für diesen Kanal ausgesetzt")).toBeVisible();
      view.rerender(element("Updated to 0.1.0", { version: "0.1.0", succeeded: true, message: "Updated to 0.1.0" }));
      expect(screen.getByText("Auf Version 0.1.0 aktualisiert")).toBeVisible();
      expect(screen.getByText(/Letztes Update: Auf Version 0.1.0 aktualisiert/)).toBeVisible();
      view.rerender(element("future host detail: keep this", { version: "0.1.0", succeeded: false, message: "Update installation did not finish" }));
      expect(screen.getByText("future host detail: keep this")).toBeVisible();
      expect(screen.getByText(/Letztes Update: Die Update-Installation wurde nicht abgeschlossen/)).toBeVisible();
    } finally { restore(); }
  });

  it("shows a manual release path for a package-manager install", () => {
    render(
      <AboutUpdatesSettingsSection
        about={{ connection: "desktop" }}
        updater={fakeUpdater()}
        snapshot={snapshot({
          phase: "manual-install",
          packageLabel: "Linux DEB package",
        })}
      />,
    );
    expect(screen.getByText("Linux DEB stays with its package channel.")).toBeVisible();
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
      const view = render(<AboutUpdatesSettingsSection about={{ connection: "desktop" }} updater={controller} snapshot={controller.getSnapshot()} />);
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
    const view = render(<AboutUpdatesSettingsSection about={{ connection: "desktop" }} updater={updater} snapshot={{ ...snapshot({ phase: "waiting-for-stable" }), channel: "stable" }} />);
    expect(within(view.container).getByText("Stable selected · Waiting for a compatible release")).toBeVisible();
    expect(within(view.container).getByText("Update channel")).toBeVisible();
    await user.selectOptions(within(view.container).getByRole("combobox"), "latest");
    expect(updater.selectChannel).toHaveBeenCalledWith("latest");
  });

  it("offers the headless update command without a browser install action", async () => {
    const user = userEvent.setup();
    const updater = fakeUpdater();
    const view = render(
      <AboutUpdatesSettingsSection
        about={{ connection: "server" }}
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
