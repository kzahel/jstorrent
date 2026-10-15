// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createRef } from "react";

import type { ClientSettingsRuntimeView, TorrentListImportTarget } from "../../api";
import type {
  HostedAccessMode,
  HostedProduct,
} from "../../headless-updater";
import type {
  DesktopExternalActivation,
  DesktopExternalIntake,
  DesktopExternalIntakeSnapshot,
} from "../../desktop-external-intake";
import { clientSettingsRuntimeFixture } from "../../test-support/client-settings";
import { APPEARANCE_STORAGE_KEY, type AppearanceStorage } from "../appearance";
import {
  LAN_NONE_NOTICE_STORAGE_KEY,
  NETWORK_NONE_NOTICE_STORAGE_KEY,
} from "../lan-none-notice";
import type { InspectionApplication } from "../application";
import { InspectionProvider } from "../context";
import { InspectionController } from "../controller";
import { DemoApplication } from "../demo/DemoApplication";
import { DEFAULT_LIBRARY_BROWSE, libraryMediaRequest } from "../library-browse";
import {
  DEMO_PRIMARY_TORRENT_ID,
  buildScenarioSnapshot,
} from "../demo/catalog";
import type {
  CommandResult,
  DownloadStorageSettings,
  DesiredInspectionViews,
  FileRow,
  InspectionCommand,
  InspectionUpdate,
  MagnetExport,
  TorrentRow,
} from "../model";
import { WEBTORRENT_TEST_TORRENTS } from "../testTorrents";
import type { DesktopUpdater, DesktopUpdaterSnapshot } from "../updater/types";
import type {
  DesktopNotifications,
  DesktopNotificationSettings,
} from "../desktop-notifications/types";
import type {
  DesktopPower,
  DesktopPowerSettings,
} from "../desktop-power/types";
import type { DesktopRemoteAccess, RemoteCompletedFileSaveRequest } from "../remote-access/types";
import type { LocalVideoPlayback } from "../video-playback";
import { HOST_CAPTURES } from "../../compat/captures";
import { decodeOpenViewSetResponse } from "../../validation";
import { App } from "./App";
import { RemoveTorrentDialog } from "./RemoveTorrentDialog";

const storedValues = new Map<string, string>();
const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.requestAnimationFrame = (callback) => {
    return window.setTimeout(() => callback(0), 0);
  };
  globalThis.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        setTransform: vi.fn(),
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
      }) as unknown as CanvasRenderingContext2D,
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      clear: () => storedValues.clear(),
      getItem: (key: string) => storedValues.get(key) ?? null,
      setItem: (key: string, value: string) => storedValues.set(key, value),
    } satisfies Pick<Storage, "clear" | "getItem" | "setItem">,
  });
});

afterAll(() => {
  if (originalLocalStorage === undefined) {
    Reflect.deleteProperty(globalThis, "localStorage");
  } else {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  }
});

const controllers: InspectionController[] = [];

afterEach(async () => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
  document.documentElement.removeAttribute("data-color-theme");
  document.documentElement.removeAttribute("data-interface-size");
  if (typeof globalThis.localStorage?.clear === "function") {
    globalThis.localStorage.clear();
  }
  await Promise.all(
    controllers.splice(0).map((controller) => controller.close()),
  );
});

// desktop 0.3.1 and Android 1.0.30, captured from their release commit.
const released031 = HOST_CAPTURES.find(
  (capture) => capture.commit === "5fa018ff589f8058f6ed3910f5cea5fcd06410ab",
)!;
const released031Hello = released031.hello;
const released031Trace = released031.trace;

describe("inspection application", () => {
  it("updates the tab title with live session rates and restores it on unmount", async () => {
    const rendered = renderScenario("healthy-download", 42_000);

    await waitFor(() => {
      expect(document.title).toMatch(
        /^JSTorrent - ↓[\d.]+ [kKMGT]?B\/s ↑[\d.]+ [kKMGT]?B\/s$/,
      );
    });

    rendered.unmount();
    expect(document.title).toBe("JSTorrent");
  });

  it("renders the typed torrent ETA in Torrents", () => {
    renderScenario("healthy-download", 42_000);

    const transfers = screen.getByRole("grid", { name: "Torrents" });
    const transferEta = within(transfers).getByLabelText(
      /Estimated time remaining:/,
    );
    expect(transferEta).toHaveTextContent("55s");
  });

  it("gives a stalled ETA an infinite glyph and accessible explanation", () => {
    renderScenario("swarm-lifecycle", 11_000);
    const transfers = screen.getByRole("grid", { name: "Torrents" });
    expect(
      within(transfers).getByLabelText("Transfer stalled"),
    ).toHaveTextContent("∞");
  });

  it("shows placeholders, not an empty library, until the first library view", async () => {
    const user = userEvent.setup();
    const base = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...base,
        demo: null,
        session: { ...base.session, connection: { type: "connecting" } },
        torrentOrder: [],
        torrents: {},
        viewStatus: { ...base.viewStatus, library: { status: "loading" } },
      },
    });
    const { container } = renderApplication(application);

    expect(container.firstElementChild).toHaveAttribute("data-connection", "connecting");
    const grid = screen.getByRole("grid", { name: "Torrents" });
    expect(grid).toHaveAttribute("aria-busy", "true");
    expect(within(grid).getByTestId("table-placeholders")).toBeInTheDocument();
    expect(within(grid).getByRole("status")).toHaveTextContent("Loading torrent library…");
    expect(within(grid).queryByText(/No torrents yet/)).not.toBeInTheDocument();
    expect(within(grid).queryAllByRole("row", { selected: true })).toHaveLength(0);
    expect(screen.queryByText("0 torrents")).not.toBeInTheDocument();
    const filters = screen.getByRole("navigation", { name: "Torrent filters" });
    expect(within(filters).getByRole("button", { name: /^All torrents$/ })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("tab", { name: "Connection & seeding" }));
    expect(within(dialog).getByText("Loading current settings…")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Save settings" })).toBeDisabled();
    await user.click(within(dialog).getByRole("tab", { name: "Downloads" }));
    expect(within(dialog).getByText("Loading download folders…")).toBeVisible();
    expect(
      within(dialog).queryByText(/No download folder has been chosen yet/),
    ).not.toBeInTheDocument();

    act(() => {
      application.emitUpdate({
        type: "snapshot",
        snapshot: {
          ...base,
          demo: null,
          session: { ...base.session, connection: { type: "connected" } },
          torrentOrder: [],
          torrents: {},
        },
      });
    });
    expect(within(dialog).queryByText("Loading download folders…")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(grid).not.toHaveAttribute("aria-busy");
    expect(within(grid).queryByTestId("table-placeholders")).not.toBeInTheDocument();
    expect(within(grid).getByText(/No torrents yet/)).toBeVisible();
    expect(screen.getByText("0 torrents")).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: /^All torrents\s*0$/ })).toBeVisible();
  });

  it("shows header rates only while something transfers and no connection pill", () => {
    const base = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...base,
        demo: null,
        session: {
          ...base.session,
          connection: { type: "connected" },
          downloadRate: 0,
          uploadRate: null,
        },
      },
    });
    const { container } = renderApplication(application);
    expect(
      screen.queryByLabelText("Session transfer rates"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).queryByText("connected"),
    ).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute(
      "data-connection",
      "connected",
    );

    act(() => {
      application.emitUpdate({
        type: "patch",
        revision: base.revision + 1,
        session: { ...base.session, downloadRate: 2_500_000, uploadRate: 0 },
      });
    });
    expect(screen.getByLabelText("Session transfer rates")).toHaveTextContent(
      "↓ 2.4 MB/s↑ —",
    );
  });

  it("covers the app while the engine connection stays down", async () => {
    const user = userEvent.setup();
    const base = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...base,
        demo: null,
        session: {
          ...base.session,
          connection: {
            type: "reconnecting",
            since: Date.now() - 5_000,
            nextAttemptAt: Date.now() + 12_000,
          },
        },
      },
    });
    const { container } = renderApplication(application);
    const overlay = screen.getByRole("alertdialog", { name: "Connection lost" });
    expect(within(overlay).getByRole("status")).toHaveTextContent(
      "Trying again in 12 seconds",
    );
    expect(container.firstElementChild).toHaveAttribute("inert");
    expect(within(overlay).getByRole("button", { name: "Retry now" })).toHaveFocus();

    await user.click(within(overlay).getByRole("button", { name: "Retry now" }));
    expect(application.reconnectRequests).toBe(1);

    act(() => {
      application.emitUpdate({
        type: "patch",
        revision: base.revision + 1,
        session: { ...base.session, connection: { type: "connected" } },
      });
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(container.firstElementChild).not.toHaveAttribute("inert");
  });

  it("waits out brief connection drops without covering the app", () => {
    const base = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
    renderApplication(
      new RecordingLiveApplication({
        type: "snapshot",
        snapshot: {
          ...base,
          demo: null,
          session: {
            ...base.session,
            connection: {
              type: "reconnecting",
              since: Date.now() - 500,
              nextAttemptAt: null,
            },
          },
        },
      }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks to sign in again once the engine rejects this session", () => {
    const base = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
    renderApplication(
      new RecordingLiveApplication({
        type: "snapshot",
        snapshot: {
          ...base,
          demo: null,
          session: {
            ...base.session,
            connection: { type: "stopped", reason: "signed_out" },
          },
        },
      }),
    );
    const overlay = screen.getByRole("alertdialog", { name: "Signed out" });
    expect(within(overlay).getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(
      within(overlay).queryByRole("button", { name: "Retry now" }),
    ).not.toBeInTheDocument();
  });

  it("shows determinate checker progress across Torrents, Library and details", async () => {
    const user = userEvent.setup();
    const snapshot = checkingSnapshot("hashing");
    renderApplication(
      new RecordingLiveApplication({ type: "snapshot", snapshot }),
    );

    const transfers = screen.getByRole("grid", { name: "Torrents" });
    expect(within(transfers).getByText("Checked 25.0%")).toBeVisible();
    expect(
      within(transfers).getByRole("progressbar", {
        name: /checking progress: Checked 25.0%/,
      }),
    ).toHaveAttribute("aria-valuenow", "25");

    await user.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.getByText("Checked 25.0%")).toBeVisible();
    expect(
      screen.getByRole("progressbar", {
        name: /checking progress: Checked 25.0%/,
      }),
    ).toHaveAttribute("aria-valuenow", "25");

    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "General" }));
    const detail = screen.getByRole("region", { name: "Torrent details" });
    expect(within(detail).getByText("Checking", { exact: true })).toBeVisible();
    expect(within(detail).getByText("25.0%", { exact: true })).toBeVisible();
    expect(within(detail).getByText("2 / 8")).toBeVisible();
    expect(within(detail).getByText("Matched").parentElement).toHaveTextContent(
      "Matched1",
    );
    expect(within(detail).getByText("Absent").parentElement).toHaveTextContent(
      "Absent1",
    );
    expect(within(detail).getByText("1 active · oldest 1.2 s")).toBeVisible();
  });

  it("shows checker fence phases as indeterminate instead of zero percent", () => {
    const snapshot = checkingSnapshot("reconciling_storage");
    renderApplication(
      new RecordingLiveApplication({ type: "snapshot", snapshot }),
    );

    const transfers = screen.getByRole("grid", { name: "Torrents" });
    expect(
      within(transfers).getByText("Updating file selection"),
    ).toBeVisible();
    const progress = within(transfers).getByRole("progressbar", {
      name: /checking progress: Updating file selection/,
    });
    expect(progress).not.toHaveAttribute("aria-valuenow");
    expect(progress).toHaveAttribute("data-indeterminate", "true");
  });

  it("shows truthful queued seed accounting and priority goals", async () => {
    const user = userEvent.setup();
    const source = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
    const torrent = source.torrents[DEMO_PRIMARY_TORRENT_ID]!;
    const snapshot = {
      ...source,
      demo: null,
      torrents: {
        ...source.torrents,
        [DEMO_PRIMARY_TORRENT_ID]: {
          ...torrent,
          status: "complete" as const,
          operationalState: "queued" as const,
          progress: 1,
          lifetimeUploadedBytes: "14",
          lifetimeDownloadedBytes: "7",
          activeSeconds: "1801",
          finishedSeconds: "100",
          seedingSeconds: "90",
          shareRatioHundredths: "200",
          seedAdmission: "queued" as const,
          seedGoal: {
            status: "met" as const,
            share_ratio_met: true,
            finished_download_ratio_met: false,
            finished_time_met: false,
          },
        },
      },
    };
    renderApplication(
      new RecordingLiveApplication({ type: "snapshot", snapshot }),
    );
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "General" }));
    const detail = screen.getByRole("region", { name: "Torrent details" });
    expect(within(detail).getByText("Queued", { exact: true })).toBeVisible();
    expect(
      within(detail).getByText("Uploaded").parentElement,
    ).toHaveTextContent("14 B");
    expect(within(detail).getByText("Share ratio").parentElement).toHaveTextContent(
      "2.00",
    );
    expect(within(detail).getByText("Active time").parentElement).toHaveTextContent(
      "30m 1s",
    );
    expect(within(detail).getByText("Finished time")).toBeVisible();
    expect(
      within(detail).getByText("Seeding goals").parentElement,
    ).toHaveTextContent("Reached: share ratio");
  });

  it("states a seeding torrent once and copies its links from General", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn<(value: string) => Promise<void>>();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const source = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
    const torrent = source.torrents[DEMO_PRIMARY_TORRENT_ID]!;
    const snapshot = {
      ...source,
      demo: null,
      torrents: {
        ...source.torrents,
        [DEMO_PRIMARY_TORRENT_ID]: {
          ...torrent,
          status: "complete" as const,
          operationalState: "seeding" as const,
          progress: 1,
          progressReason: "complete",
          finishedSeconds: "2770",
          seedingSeconds: "2770",
          seedAdmission: "inactive_exempt" as const,
          seedGoal: {
            status: "met" as const,
            share_ratio_met: false,
            finished_download_ratio_met: true,
            finished_time_met: false,
          },
        },
      },
    };
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot,
    });
    const magnet =
      `magnet:?xt=urn:btih:${torrent.infoHash}&dn=Original%20Name` +
      "&tr=udp%3A%2F%2Ftracker.example%3A6969%2Fannounce";
    application.magnetExports.set(torrent.id, {
      magnet,
      source: "verbatim",
      omittedTrackerCount: 0,
    });
    renderApplication(application);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "General" }));
    const detail = screen.getByRole("region", { name: "Torrent details" });

    expect(
      within(detail).getByText("Seeding (idle)", { exact: true }),
    ).toBeVisible();
    expect(within(detail).queryByText(/complete/)).not.toBeInTheDocument();
    expect(within(detail).queryByText("Finished time")).not.toBeInTheDocument();
    expect(within(detail).getByText("46m 10s")).toBeVisible();
    expect(
      within(detail).getByText("Seeding goals").parentElement,
    ).toHaveTextContent("Reached: seeding time vs. download time");

    await user.click(
      within(detail).getByRole("button", { name: "Copy magnet link" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(magnet));
    await findToast("Magnet link copied");

    // The link button opens the Share panel; its Copy copies the link.
    const shareButton = within(detail).getByRole("button", { name: "Share" });
    await user.click(shareButton);
    const panel = await screen.findByRole("dialog", { name: "Share torrent" });
    const link =
      `https://jstorrent.com/share/#xt=urn:btih:${torrent.infoHash}` +
      "&dn=Original%20Name&tr=udp%3A%2F%2Ftracker.example%3A6969%2Fannounce";
    await waitFor(() =>
      expect(within(panel).getByRole("textbox", { name: "Share link" })).toHaveValue(link),
    );
    await user.click(within(panel).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(link));
    await findToast("Share link copied");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Share torrent" })).toBeNull();
    await waitFor(() => expect(shareButton).toHaveFocus());

    await user.click(
      within(detail).getByRole("button", { name: "Copy info hash" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(torrent.infoHash),
    );
    await findToast("Info hash copied");

    application.rejectNextTorrentId = torrent.id;
    await user.click(
      within(detail).getByRole("button", { name: "Copy magnet link" }),
    );
    await findToast("Could not copy magnet links: rejected for test");
    expect(writeText).toHaveBeenCalledTimes(3);
    expect(
      within(detail).queryByText(/Private torrent/),
    ).not.toBeInTheDocument();
  });

  it("warns that a private torrent's links stay inside its tracker", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn<(value: string) => Promise<void>>();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const source = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
    const torrent = source.torrents[DEMO_PRIMARY_TORRENT_ID]!;
    const snapshot = {
      ...source,
      demo: null,
      torrents: {
        ...source.torrents,
        [DEMO_PRIMARY_TORRENT_ID]: { ...torrent, privateTorrent: true },
      },
    };
    renderApplication(
      new RecordingLiveApplication({ type: "snapshot", snapshot }),
    );
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "General" }));
    const detail = screen.getByRole("region", { name: "Torrent details" });
    expect(
      within(detail).getByText(
        "Private torrent: magnet and share links only work for members of its tracker.",
      ),
    ).toBeVisible();

    await user.click(within(detail).getByRole("button", { name: "Share" }));
    const panel = await screen.findByRole("dialog", { name: "Share torrent" });
    // A private torrent never carries the address, so there is no choice.
    expect(
      within(panel).queryByRole("checkbox", { name: "Include my IP address" }),
    ).toBeNull();
    const copy = within(panel).getByRole("button", { name: "Copy" });
    await waitFor(() => expect(copy).toBeEnabled());
    await user.click(copy);
    await findToast(
      "Share link copied. This torrent is private, so the link only works for members of its tracker.",
    );
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringMatching(/^https:\/\/jstorrent\.com\/share\/#xt=urn:btih:/),
    );
  });

  it("saves one atomic per-torrent upload and download limit pair", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...buildScenarioSnapshot("healthy-download", 42_000, false, 1),
      demo: null,
    };
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot,
    });
    renderApplication(application);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "General" }));
    const detail = screen.getByRole("region", { name: "Torrent details" });
    expect(within(detail).queryByRole("combobox", {
      name: "Upload",
    })).not.toBeInTheDocument();
    const grid = screen.getByRole("grid", { name: "Torrents" });
    const torrentRow = within(grid).getByRole("row", { name: /Big Buck Bunny 1080p surround/ });
    fireEvent.contextMenu(torrentRow);
    await user.click(await screen.findByRole("menuitem", { name: "Torrent settings" }));
    const settings = screen.getByRole("dialog", { name: "Torrent settings" });
    expect(within(settings).getByRole("button", { name: "Cancel" })).toHaveFocus();

    expect(
      within(settings).getByRole("combobox", { name: "Upload" }),
    ).toHaveValue("unlimited");
    await user.selectOptions(
      within(settings).getByRole("combobox", { name: "Upload" }),
      "Custom…",
    );
    const upload = within(settings).getByRole("spinbutton", {
      name: "Upload, custom speed in KB per second",
    });
    await user.clear(upload);
    await user.type(upload, "32");
    await user.selectOptions(
      within(settings).getByRole("combobox", { name: "Download" }),
      "500 KB/s",
    );
    expect(
      within(settings).queryByRole("spinbutton", {
        name: "Download, custom speed in KB per second",
      }),
    ).not.toBeInTheDocument();
    await user.click(within(settings).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "update_torrent_settings",
        torrentId: snapshot.torrentOrder[0],
        patch: {
          upload_rate_limit: { type: "limited", bytes_per_second: 32_768 },
          download_rate_limit: { type: "limited", bytes_per_second: 512_000 },
        },
      }),
    );
  });

  it("preserves a download-limit draft through continuous complete row updates", async () => {
    const user = userEvent.setup();
    const base = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
    const torrentId = base.torrentOrder[0] as string;
    const row = base.torrents[torrentId] as TorrentRow;
    const limited = {
      ...row,
      transferLimits: {
        upload: { type: "limited" as const, bytes_per_second: 32_768 },
        download: { type: "limited" as const, bytes_per_second: 98_304 },
      },
    };
    const snapshot = {
      ...base,
      demo: null,
      torrents: { ...base.torrents, [torrentId]: limited },
    };
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot,
    });
    renderApplication(application);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "General" }));
    await user.click(screen.getByRole("button", { name: /^More/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Torrent settings" }));
    const settings = screen.getByRole("dialog", { name: "Torrent settings" });
    const download = within(settings).getByRole("combobox", {
      name: "Download",
    });
    expect(download).toHaveValue("custom");
    expect(
      within(settings).getByRole("spinbutton", {
        name: "Download, custom speed in KB per second",
      }),
    ).toHaveValue(96);

    await user.selectOptions(download, "Unlimited");
    expect(download).toHaveValue("unlimited");
    for (let revision = 2; revision <= 25; revision += 1) {
      application.emitUpdate({
        type: "patch",
        revision,
        durableRevision: "1",
        torrents: {
          upsert: [
            {
              ...limited,
              downloadRate: limited.downloadRate + revision,
            },
          ],
          removed: [],
        },
      });
    }
    expect(download).toHaveValue("unlimited");

    await user.click(within(settings).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "update_torrent_settings",
        torrentId,
        patch: { download_rate_limit: { type: "unlimited" } },
      }),
    );
    expect(download).toHaveValue("unlimited");
  });

  it("saves per-torrent seeding stop limits against the global ones", async () => {
    const user = userEvent.setup();
    const base = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
    const fixture = clientSettingsRuntimeFixture();
    const snapshot = {
      ...base,
      demo: null,
      clientSettings: {
        ...fixture,
        configured: {
          ...fixture.configured,
          seed_stop_ratio_percent: { type: "limited" as const, value: 200 },
        },
      },
    };
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot,
    });
    renderApplication(application);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    const grid = screen.getByRole("grid", { name: "Torrents" });
    fireEvent.contextMenu(
      within(grid).getByRole("row", { name: /Big Buck Bunny 1080p surround/ }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Torrent settings" }));
    const settings = screen.getByRole("dialog", { name: "Torrent settings" });
    expect(
      within(settings).getByRole("heading", { name: "Stop seeding" }),
    ).toBeVisible();
    const ratio = within(settings).getByRole("combobox", { name: "Share ratio" });
    const time = within(settings).getByRole("combobox", { name: "Seeding time" });
    expect(ratio).toHaveValue("use_global");
    expect(
      within(ratio).getByRole("option", { name: "Use global (2.0)" }),
    ).toBeInTheDocument();
    expect(time).toHaveValue("use_global");
    expect(
      within(time).getByRole("option", { name: "Use global (No limit)" }),
    ).toBeInTheDocument();
    const save = within(settings).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await user.selectOptions(ratio, "No limit");
    await user.selectOptions(time, "6 hours");
    await user.click(save);
    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "update_torrent_settings",
        torrentId: snapshot.torrentOrder[0],
        patch: {
          seed_stop_ratio_percent: { type: "off" },
          seed_stop_time_seconds: { type: "limited", value: 21_600 },
        },
      }),
    );

    // Back to the global ratio; the unchanged time limit is not resent.
    await user.selectOptions(ratio, "Use global (2.0)");
    await user.click(save);
    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "update_torrent_settings",
        torrentId: snapshot.torrentOrder[0],
        patch: { seed_stop_ratio_percent: { type: "use_global" } },
      }),
    );
  });

  it("labels a limit-stopped torrent and offers Keep seeding", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...buildScenarioSnapshot("seeding-limits", 0, false, 1),
      demo: null,
    };
    const debian = Object.values(snapshot.torrents).find(
      (torrent) => torrent.name === "Debian 13.1 amd64 netinst",
    )!;
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot,
    });
    renderApplication(application);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    const grid = screen.getByRole("grid", { name: "Torrents" });
    const row = within(grid).getByRole("row", { name: /Debian 13\.1 amd64 netinst/ });
    expect(within(row).getByText("Seeding limit reached")).toBeVisible();
    expect(within(row).queryByText("Paused")).not.toBeInTheDocument();

    await user.click(within(row).getByText("Debian 13.1 amd64 netinst"));
    await user.click(screen.getByRole("tab", { name: "General" }));
    const detail = screen.getByRole("region", { name: "Torrent details" });
    expect(
      within(detail).getByText("Seeding limit reached", { exact: true }),
    ).toBeVisible();
    expect(
      within(detail).getByRole("region", { name: "Stop seeding" }),
    ).toHaveTextContent("Stops at ratio 2.00 · now 2.03");

    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep seeding" }));
    await waitFor(() =>
      expect(application.commands).toContainEqual({
        type: "resume",
        torrentId: debian.id,
      }),
    );

    // The seeding torrent shows its time limit and progress.
    await user.click(
      within(
        within(grid).getByRole("row", { name: /Arch Linux 2026\.08\.01 x86_64/ }),
      ).getByText("Arch Linux 2026.08.01 x86_64"),
    );
    expect(
      within(detail).getByRole("region", { name: "Stop seeding" }),
    ).toHaveTextContent("Stops after 1 day · seeded 18h 0m");
    expect(screen.getByRole("button", { name: "Start" })).toBeVisible();
  });

  it("hides seeding stop limits on a released host that predates them", async () => {
    const user = userEvent.setup();
    const open = decodeOpenViewSetResponse(JSON.stringify(released031Trace.open));
    const update = open.initial.updates[0];
    if (update?.type !== "snapshot" || update.snapshot.type !== "torrent_list") {
      throw new Error("released trace has no library snapshot");
    }
    const scenario = buildScenarioSnapshot("seeding-limits", 0, false, 1);
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...scenario,
        demo: null,
        clientSettings: update.snapshot.client_settings,
        session: {
          ...scenario.session,
          hostCapabilities: released031Hello.capabilities,
        },
      },
    });
    renderApplication(application);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("tab", { name: "Connection & seeding" }));
    expect(
      within(dialog).getByRole("region", { name: "Seeding priority" }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("region", { name: "Stop seeding" }),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close settings" }));

    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    const grid = screen.getByRole("grid", { name: "Torrents" });
    await user.click(within(grid).getAllByRole("row")[1]!);
    await user.click(screen.getByRole("tab", { name: "General" }));
    const detail = screen.getByRole("region", { name: "Torrent details" });
    expect(
      within(detail).queryByRole("region", { name: "Stop seeding" }),
    ).not.toBeInTheDocument();
  });

  it("saves only the changed seeding stop limits in Settings", async () => {
    const user = userEvent.setup();
    const fixture = clientSettingsRuntimeFixture();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...liveSnapshot({ roots: [], defaultRoot: null, showAddOptions: true }),
        clientSettings: {
          ...fixture,
          configured: {
            ...fixture.configured,
            seed_stop_time_seconds: { type: "limited", value: 5_400 },
          },
        },
      },
    });
    renderApplication(application);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("tab", { name: "Connection & seeding" }));
    const stop = within(dialog).getByRole("region", { name: "Stop seeding" });
    expect(
      within(stop).getByText(/Resume a stopped torrent to keep seeding it/),
    ).toBeVisible();
    const ratio = within(stop).getByRole("combobox", { name: "Share ratio" });
    const time = within(stop).getByRole("combobox", { name: "Seeding time" });
    expect(ratio).toHaveValue("off");
    // 90 minutes is not a preset, so it opens as a custom number of minutes.
    expect(time).toHaveValue("custom");
    expect(
      within(stop).getByRole("spinbutton", { name: "Seeding time, custom time" }),
    ).toHaveValue(90);
    expect(
      within(stop).getByRole("combobox", { name: "Seeding time, unit" }),
    ).toHaveValue("minutes");
    const save = within(dialog).getByRole("button", { name: "Save settings" });
    expect(save).toBeDisabled();

    await user.selectOptions(ratio, "Custom…");
    const customRatio = within(stop).getByRole("spinbutton", {
      name: "Share ratio, custom ratio",
    });
    fireEvent.change(customRatio, { target: { value: "2.555" } });
    expect(
      within(stop).getByText(/Enter a ratio from 0 to .* with up to two decimals/),
    ).toBeVisible();
    expect(save).toBeDisabled();
    fireEvent.change(customRatio, { target: { value: "2.5" } });
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "update_client_settings",
        patch: { seed_stop_ratio_percent: { type: "limited", value: 250 } },
      }),
    );
    await waitFor(() => expect(save).toBeDisabled());
    expect(customRatio).toHaveValue(2.5);

    await user.selectOptions(time, "Off");
    const priority = within(dialog).getByRole("region", { name: "Seeding priority" });
    expect(
      within(priority).getByText(/Reaching a goal doesn't stop seeding/),
    ).toBeVisible();
    await user.selectOptions(
      within(priority).getByRole("combobox", { name: "Seeding time" }),
      "No time goal",
    );
    await user.click(save);
    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "update_client_settings",
        patch: {
          finished_time_limit_seconds: 2_147_483_647,
          seed_stop_time_seconds: { type: "off" },
        },
      }),
    );
  });

  it("renders the responsive hierarchy and changes detail tabs", async () => {
    const user = userEvent.setup();
    renderScenario("healthy-download", 42_000);
    const header = screen.getByRole("banner");
    expect(within(header).queryByText("Inspection")).not.toBeInTheDocument();
    expect(within(header).queryByText(/peers/i)).not.toBeInTheDocument();
    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(primary).getByRole("button", { name: "Torrents" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("navigation", { name: "Torrent filters" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Add demo" })).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Magnet link or torrent URL" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("grid", { name: "Torrents" }),
    ).toHaveAttribute("aria-rowcount", "4");
    await user.click(
      within(primary).getByRole("button", { name: "Torrents" }),
    );
    expect(
      screen.getByRole("navigation", { name: "Torrent filters" }),
    ).toBeVisible();
    expect(
      screen.getByRole("grid", { name: "Torrents" }),
    ).toHaveAttribute("aria-rowcount", "4");
    const peerGrid = screen.getByRole("grid", {
      name: "Active peer connections",
    });
    expect(peerGrid).toBeVisible();
    expect(
      within(peerGrid).getByRole("columnheader", { name: "Up" }),
    ).toBeVisible();
    expect(
      within(peerGrid).getByRole("columnheader", { name: "Connected" }),
    ).toBeVisible();
    expect(
      within(peerGrid).getByRole("columnheader", { name: "Last data" }),
    ).toBeVisible();
    await user.click(
      screen.getAllByRole("button", { name: "Columns" }).at(-1)!,
    );
    const peerColumns = screen.getByRole("dialog", {
      name: "Table column settings",
    });
    for (const name of ["Up", "Uploaded", "Connected", "Last data"]) {
      expect(within(peerColumns).getByRole("checkbox", { name })).toBeChecked();
    }
    await user.keyboard("{Escape}");
    const peersTab = screen.getByRole("tab", { name: "Peers" });
    expect(peersTab).toHaveTextContent(/^Peers$/);
    expect(screen.getByRole("tab", { name: "Trackers" })).toHaveTextContent(
      /^Trackers$/,
    );
    await user.click(screen.getByRole("button", { name: "Explain Flags" }));
    const flagLegend = screen.getByRole("dialog", {
      name: "Flags column help",
    });
    expect(within(flagLegend).getByText("Incoming")).toBeVisible();
    expect(
      within(flagLegend).getByText("Encrypted or obfuscated"),
    ).toBeVisible();
    expect(
      within(flagLegend).queryByText(/case-sensitive/),
    ).not.toBeInTheDocument();
    expect(
      within(flagLegend).queryByText(/remote peer initiated/),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(flagLegend).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "General" }));
    expect(
      screen.getByRole("button", { name: "Copy magnet link" }),
    ).toBeVisible();
    expect(peersTab).toHaveTextContent(/^Peers$/);
    await user.click(screen.getByRole("tab", { name: "Logs" }));
    expect(
      await screen.findByRole("log", { name: "Chronological diagnostic events" }),
    ).toBeVisible();
  });

  it("shows unavailable storage in Needs attention without counting it active", async () => {
    const user = userEvent.setup();
    const snapshot = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
    const torrent = snapshot.torrents[DEMO_PRIMARY_TORRENT_ID]!;
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...snapshot,
        demo: null,
        torrentOrder: [torrent.id],
        torrents: {
          [torrent.id]: {
            ...torrent,
            status: "error",
            operationalState: "paused",
            progressReason: "waiting for storage",
            progress: 0,
            error: null,
          },
        },
      },
    });
    renderApplication(application);
    const filters = screen.getByRole("navigation", { name: "Torrent filters" });
    expect(within(filters).getByRole("button", { name: /^Active\s*0$/ })).toBeVisible();
    expect(within(filters).getByRole("button", { name: /^Downloading\s*0$/ })).toBeVisible();
    await user.click(within(filters).getByRole("button", { name: /^Needs attention\s*1$/ }));
    const grid = screen.getByRole("grid", { name: "Torrents" });
    expect(within(grid).getByText("Storage unavailable")).toBeVisible();
    expect(within(grid).queryByText("downloading")).not.toBeInTheDocument();
    expect(application.commands).toHaveLength(0);
  });

  it("explains and opens torrent errors from status", async () => {
    const user = userEvent.setup();
    renderScenario("disk-error", 8_000);

    const transfers = screen.getByRole("grid", { name: "Torrents" });
    const status = within(transfers).getByRole("button", {
      name: "Error: Write failed: destination has no free space. Open General details",
    });
    expect(status).toHaveAttribute(
      "title",
      "Write failed: destination has no free space\nOpen General details.",
    );
    expect(
      within(transfers).getByRole("checkbox", {
        name: "Deselect Big Buck Bunny — storage failure",
      }),
    ).toBeChecked();
    expect(
      within(transfers).queryByRole("button", { name: "Complete" }),
    ).not.toBeInTheDocument();

    status.focus();
    await user.keyboard("{Enter}");

    expect(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    ).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const detail = screen.getByRole("region", { name: "Torrent details" });
    const error = within(detail).getByRole("alert");
    expect(error).toHaveTextContent(
      "Storage needs attentionWrite failed: destination has no free space",
    );
    expect(error).toHaveFocus();
    expect(
      within(screen.getByRole("grid", { name: "Torrents" })).getByRole(
        "button",
        {
          name: "Error: Write failed: destination has no free space. Open General details",
        },
      ),
    ).toBeVisible();
  });

  it("summarizes trackers, DHT, peer exchange and incoming peers above the trackers", async () => {
    const user = userEvent.setup();
    renderScenario("swarm-lifecycle", 30_000);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Trackers" }));

    const sources = await screen.findByRole("table", { name: "Peer sources" });
    expect(
      within(sources).getAllByRole("row").map((row) => row.textContent),
    ).toEqual([
      // The scenario lists no trackers but tags its swarm peers as tracker peers.
      "TrackersNone3 known0 connected",
      "DHTOn3 known0 connected",
      "Peer exchangeOn2 known1 connected",
      "Incoming connectionsOff0 known0 connected",
    ]);
  });

  it("renders the bounded swarm registry independently of active connections", async () => {
    const user = userEvent.setup();
    renderScenario("swarm-lifecycle", 24_000);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Swarm" }));

    const grid = await screen.findByRole("grid", { name: "Known swarm peers" });
    expect(grid).toHaveAttribute("aria-rowcount", "9");
    expect(screen.getByLabelText("Swarm registry summary")).toHaveTextContent(
      "8known",
    );
    expect(within(grid).getAllByText(/backed off/i).length).toBeGreaterThan(0);
    expect(
      within(grid).getAllByText(/TRK|DHT|TRACKER/i).length,
    ).toBeGreaterThan(0);
    expect(
      within(grid).getByRole("columnheader", { name: "Downloaded" }),
    ).toBeVisible();
    expect(
      within(grid).getByRole("columnheader", { name: "Uploaded" }),
    ).toBeVisible();
    expect(within(grid).getByText("488 MB")).toBeVisible();
    expect(within(grid).getByText("30.5 MB")).toBeVisible();

    await user.click(
      within(grid).getByRole("button", { name: "Explain Downloaded" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Downloaded column help" }),
    ).toHaveTextContent(
      "Total useful file data received from this peer since JSTorrent started.",
    );
  });

  it("drives an ordered diagnostic console with separate capture controls", async () => {
    const user = userEvent.setup();
    const rendered = renderScenario("diagnostic-console", 45_000);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Logs" }));

    const feed = screen.getByRole("log", {
      name: "Chronological diagnostic events",
    });
    expect(feed).toBeVisible();
    expect(rendered.container.querySelectorAll("article").length).toBeLessThan(
      60,
    );
    expect(screen.getByText(/kept$/)).toHaveTextContent("2,048 kept");

    const captureScope = screen.getByLabelText("Torrents to log");
    await user.selectOptions(captureScope, DEMO_PRIMARY_TORRENT_ID);
    await user.click(screen.getByRole("row", { name: /Sintel 4K open movie/ }));
    expect(captureScope).toHaveValue(DEMO_PRIMARY_TORRENT_ID);

    await user.selectOptions(
      screen.getByLabelText("Log detail level"),
      "trace",
    );
    expect(screen.getByText("High-volume producer capture")).toBeVisible();
    await user.selectOptions(
      screen.getByLabelText("Minimum displayed severity"),
      "warning",
    );
    await user.selectOptions(
      screen.getByLabelText("Displayed torrent scope"),
      "all",
    );
    expect(screen.getByText(/shown$/)).toHaveTextContent("410 shown");

    await user.type(
      screen.getByRole("searchbox", { name: "Search diagnostics" }),
      "watermark",
    );
    expect(screen.getByText(/shown$/)).toHaveTextContent("59 shown");
  });

  it("changes and restores complete appearance settings", async () => {
    const user = userEvent.setup();
    let storedAppearance: string | null = null;
    const appearanceStorage: AppearanceStorage = {
      getItem: (key) =>
        key === APPEARANCE_STORAGE_KEY ? storedAppearance : null,
      setItem: (key, value) => {
        if (key === APPEARANCE_STORAGE_KEY) storedAppearance = value;
      },
    };
    const first = renderScenario("healthy-download", 42_000, appearanceStorage);
    const app = first.container.firstElementChild;
    expect(app).toHaveAttribute("data-interface-size", "standard");
    expect(document.documentElement).toHaveAttribute(
      "data-color-theme",
      "auto",
    );

    for (const name of ["Start", "Pause", "Remove"]) {
      expect(
        screen.getByRole("button", { name }).querySelector("svg"),
      ).not.toBeNull();
    }
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(
      screen.getByRole("menuitem", { name: "Archive" }).querySelector("svg"),
    ).not.toBeNull();
    await user.keyboard("{Escape}");

    const settings = screen.getByRole("button", {
      name: "Settings",
    });
    await user.click(settings);
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(
      within(dialog).queryByRole("tab", { name: "About & updates" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "About" })).toBeVisible();
    const close = within(dialog).getByRole("button", {
      name: "Close settings",
    });
    expect(close).toHaveFocus();
    const colorThemeGroup = within(dialog).getByRole("group", {
      name: "Color theme",
    });
    expect(
      within(colorThemeGroup).getByRole("radio", { name: /Auto/ }),
    ).toBeChecked();
    const dataUnitsGroup = within(dialog).getByRole("group", {
      name: "Size units",
    });
    expect(
      within(dataUnitsGroup).getByRole("radio", { name: /^KB, MB, GB/ }),
    ).toBeChecked();
    expect(screen.getAllByText(/\d KB(?:\/s)?$/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/\d kB(?:\/s)?$/)).toHaveLength(0);

    await user.tab({ shift: true });
    expect(
      within(dataUnitsGroup).getByRole("radio", { name: /Decimal/ }),
    ).toHaveFocus();
    await user.click(
      within(dataUnitsGroup).getByRole("radio", { name: /Decimal/ }),
    );
    expect(screen.getAllByText(/\d kB(?:\/s)?$/).length).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(/\d KB(?:\/s)?$/, { ignore: "option, script, style" }),
    ).toHaveLength(0);
    await user.click(within(dialog).getByRole("radio", { name: /Dark/ }));
    expect(document.documentElement).toHaveAttribute(
      "data-color-theme",
      "dark",
    );
    await user.click(within(dialog).getByRole("radio", { name: /Spacious/ }));
    expect(app).toHaveAttribute("data-interface-size", "spacious");
    expect(JSON.parse(storedAppearance ?? "null")).toEqual({
      version: 3,
      interfaceSize: "spacious",
      colorTheme: "dark",
      dataUnits: "decimal",
    });

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Settings" }),
    ).not.toBeInTheDocument();
    expect(settings).toHaveFocus();

    first.unmount();
    const restored = renderScenario(
      "healthy-download",
      42_000,
      appearanceStorage,
    );
    expect(restored.container.firstElementChild).toHaveAttribute(
      "data-interface-size",
      "spacious",
    );
    expect(document.documentElement).toHaveAttribute(
      "data-color-theme",
      "dark",
    );
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      within(screen.getByRole("group", { name: "Size units" })).getByRole(
        "radio",
        { name: /Decimal/ },
      ),
    ).toBeChecked();
  });

  it("opens About and updates for a native manual check", async () => {
    const updater = updaterWithSnapshot({
      info: {
        version: "0.1.1",
        buildId: "lifecycle-test",
        target: "x86_64-pc-windows-msvc",
        arch: "x86_64",
        bundleType: "nsis",
      },
      state: { phase: "checking", reason: "manual" },
    });
    renderScenario("empty-library", 0, null, updater);

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(
      within(dialog).getByRole("tab", { name: "About & updates" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByText("Checking for updates")).toBeVisible();
  });

  it("dismisses the LAN notice per browser while retaining compact status", async () => {
    const user = userEvent.setup();
    const first = renderApplication(
      new DemoApplication({
        scenarioId: "empty-library",
        elapsedMs: 0,
        running: false,
      }),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      "lan_none",
    );
    const notice = screen.getByRole("complementary", {
      name: "Network security notice",
    });
    expect(within(notice).getByText("Authentication is off.")).toBeVisible();
    expect(
      within(notice).getByText(
        "Every device on this LAN has full owner control.",
      ),
    ).toBeVisible();
    expect(
      screen.getByLabelText("Network access has no authentication"),
    ).toHaveTextContent("No auth");

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(
      screen.queryByRole("complementary", { name: "Network security notice" }),
    ).not.toBeInTheDocument();
    expect(globalThis.localStorage.getItem(LAN_NONE_NOTICE_STORAGE_KEY)).toBe(
      "true",
    );
    expect(
      screen.getByLabelText("Network access has no authentication"),
    ).toBeVisible();

    first.unmount();
    renderApplication(
      new DemoApplication({
        scenarioId: "empty-library",
        elapsedMs: 0,
        running: false,
      }),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      "lan_none",
    );
    expect(
      screen.queryByRole("complementary", { name: "Network security notice" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Network access has no authentication"),
    ).toBeVisible();
  });

  it("shows generated waiting truth without offering a manual resume action", () => {
    const clientSettings = clientSettingsRuntimeFixture();
    clientSettings.application_network = {
      requested_generation: "2",
      requested_prerequisite: "waiting_for_unmetered_network",
      effective_generation: "2",
      effective_prerequisite: "waiting_for_unmetered_network",
      state: "blocked",
      degraded_detail: null,
    };
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...liveSnapshot({ roots: [], defaultRoot: null, showAddOptions: true }),
        clientSettings,
      },
    });
    renderApplication(application);

    const status = screen.getByRole("status", {
      name: "Network prerequisite status",
    });
    expect(status).toHaveTextContent("Waiting for Wi-Fi.");
    expect(status).toHaveTextContent("resume automatically");
    expect(within(status).queryByRole("button")).not.toBeInTheDocument();
  });

  it("describes trusted-network owner exposure once per browser", async () => {
    const user = userEvent.setup();
    renderApplication(
      new DemoApplication({
        scenarioId: "empty-library",
        elapsedMs: 0,
        running: false,
      }),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      "network_none",
    );
    const notice = screen.getByRole("complementary", {
      name: "Network security notice",
    });
    expect(
      within(notice).getByText(
        "Every device that can reach this service has full owner control.",
      ),
    ).toBeVisible();
    expect(
      screen.getByLabelText("Network access has no authentication"),
    ).toHaveTextContent("No auth");

    await user.click(within(notice).getByRole("button", { name: "Got it" }));
    expect(globalThis.localStorage.getItem(NETWORK_NONE_NOTICE_STORAGE_KEY)).toBe(
      "true",
    );
    expect(globalThis.localStorage.getItem(LAN_NONE_NOTICE_STORAGE_KEY)).toBeNull();
  });

  it("shows notification settings only when the desktop capability is injected", async () => {
    const user = userEvent.setup();
    const first = renderScenario("empty-library", 0);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      screen.queryByRole("tab", { name: "Notifications" }),
    ).not.toBeInTheDocument();
    first.unmount();

    renderScenario(
      "empty-library",
      0,
      null,
      undefined,
      notificationSettingsController(),
    );
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "Notifications" }));
    expect(
      screen.getByRole("checkbox", { name: /Download complete/ }),
    ).toBeChecked();
  });

  it("shows power settings only when the desktop capability is injected", async () => {
    const user = userEvent.setup();
    const first = renderScenario("empty-library", 0);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      screen.queryByRole("tab", { name: "Power" }),
    ).not.toBeInTheDocument();
    first.unmount();

    renderScenario(
      "empty-library",
      0,
      null,
      undefined,
      undefined,
      powerSettingsController(),
    );
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "Power" }));
    expect(
      screen.getByRole("checkbox", {
        name: /Prevent sleep while downloading/,
      }),
    ).toBeChecked();
  });

  it("switches named scenarios and advances the frozen clock", async () => {
    const user = userEvent.setup();
    renderScenario("tracker-recovery", 0);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "General" }));
    expect(screen.getByText(/retry scheduled in 22 seconds/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "+10s" }));
    await user.click(screen.getByRole("button", { name: "+10s" }));
    await user.click(screen.getByRole("button", { name: "+10s" }));
    expect(screen.getByText(/recovered tracker cohort/i)).toBeVisible();
    await user.selectOptions(
      screen.getByLabelText("Demo scenario"),
      "disk-error",
    );
    expect(screen.getAllByText(/storage failure/i)[0]).toBeVisible();
  });

  it("keeps rendered rows and cards bounded for large logical collections", async () => {
    const user = userEvent.setup();
    renderScenario("large-swarm", 0, undefined, undefined, undefined, undefined, false);
    const transferGrid = screen.getByRole("grid", { name: "Torrents" });
    expect(transferGrid).toHaveAttribute("aria-rowcount", "2001");
    expect(within(transferGrid).getAllByRole("row").length).toBeLessThanOrEqual(
      100,
    );

    await user.click(screen.getByRole("button", { name: "Library" }));
    const library = screen.getByRole("list", {
      name: "Torrent-backed content",
    });
    expect(within(library).getAllByRole("listitem").length).toBeLessThan(100);

    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    const torrentGrid = screen.getByRole("grid", { name: "Torrents" });
    const peerGrid = screen.getByRole("grid", {
      name: "Active peer connections",
    });
    expect(torrentGrid).toHaveAttribute("aria-rowcount", "2001");
    expect(peerGrid).toHaveAttribute("aria-rowcount", "10001");
    expect(within(torrentGrid).getAllByRole("row").length).toBeLessThanOrEqual(
      100,
    );
    expect(within(peerGrid).getAllByRole("row").length).toBeLessThanOrEqual(
      100,
    );
  });

  it("materializes a full file catalog only on the Files tab", async () => {
    const user = userEvent.setup();
    renderScenario("file-progress", 24_000);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    expect(
      screen.queryByRole("grid", { name: "Torrent files" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Files" }));
    const files = screen.getByRole("grid", { name: "Torrent files" });
    expect(files).toHaveAttribute("aria-rowcount", "4096");
    expect(within(files).getAllByRole("row").length).toBeLessThanOrEqual(100);
    expect(screen.getByText("1 padding hidden")).toBeVisible();
    expect(within(files).getAllByRole("checkbox").length).toBeGreaterThan(1);
    expect(
      within(files).getByRole("checkbox", { name: "Select asset-001.mkv" }),
    ).not.toBeChecked();
    const firstFile = within(files).getAllByRole("row")[1]!;
    await user.click(firstFile);
    await user.click(screen.getByRole("button", { name: "More file actions" }));
    const fileActions = screen.getByRole("menu", {
      name: "More file actions",
    });
    expect(
      within(fileActions).getByRole("menuitem", { name: "High" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      within(fileActions).getByRole("menuitem", { name: "Normal" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      within(fileActions).getByRole("menuitem", { name: "Skip" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("File actions are unavailable in demo scenarios."),
    ).toBeVisible();
    await user.keyboard("{Escape}");

    firstFile.focus();
    await user.keyboard("{ArrowDown}");
    const secondFile = within(files).getAllByRole("row")[2]!;
    expect(secondFile).toHaveAttribute("aria-current", "true");
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(files).toHaveAttribute("aria-multiselectable", "true");
    expect(screen.getByText("2 selected")).toBeVisible();
    expect(within(files).getAllByRole("row")[3]).toHaveAttribute(
      "aria-current",
      "true",
    );
    await user.keyboard("{Control>}a{/Control}");
    expect(screen.getByText("4,095 selected")).toBeVisible();
    expect(within(files).getAllByRole("row").length).toBeLessThanOrEqual(100);
    await user.keyboard("{Escape}");
    expect(
      within(files).getByRole("checkbox", { name: "Select asset-001.mkv" }),
    ).not.toBeChecked();
    expect(
      within(files).getByRole("checkbox", { name: "Deselect asset-003.mp4" }),
    ).toBeChecked();

    await user.click(
      screen.getAllByRole("button", { name: "Columns" }).at(-1)!,
    );
    await user.click(screen.getByRole("checkbox", { name: "Storage Path" }));
    await user.keyboard("{Escape}");
    expect(
      within(files).getByRole("columnheader", { name: /Storage Path/ }),
    ).toBeVisible();
  });

  it("sends High, Skip, and Normal for the active live torrent files", async () => {
    const user = userEvent.setup();
    const snapshot = buildScenarioSnapshot("file-progress", 24_000, false, 1);
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: { ...snapshot, demo: null },
    });
    const firstFileSet = snapshot.filesByTorrent[DEMO_PRIMARY_TORRENT_ID]!;
    const firstFile = firstFileSet.order
      .map((id) => firstFileSet.rows[id])
      .find((row) => row?.padding === false)!;
    renderApplication(application);

    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Files" }));
    const files = screen.getByRole("grid", { name: "Torrent files" });
    await user.click(within(files).getAllByRole("row")[1]!);
    await user.click(screen.getByRole("button", { name: "More file actions" }));
    const high = screen.getByRole("menuitem", { name: "High" });
    expect(high).not.toHaveAttribute("aria-disabled");
    await user.click(high);

    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "set_file_priority",
        torrentId: DEMO_PRIMARY_TORRENT_ID,
        fileIndices: [firstFile.index],
        priority: "high",
      }),
    );

    await user.click(screen.getByRole("button", { name: "More file actions" }));
    const skip = screen.getByRole("menuitem", { name: "Skip" });
    expect(skip).not.toHaveAttribute("aria-disabled");
    await user.click(skip);

    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "set_file_priority",
        torrentId: DEMO_PRIMARY_TORRENT_ID,
        fileIndices: [firstFile.index],
        priority: "skip",
      }),
    );

    await user.click(screen.getByRole("button", { name: "More file actions" }));
    const normal = screen.getByRole("menuitem", { name: "Normal" });
    expect(normal).not.toHaveAttribute("aria-disabled");
    await user.click(normal);
    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "set_file_priority",
        torrentId: DEMO_PRIMARY_TORRENT_ID,
        fileIndices: [firstFile.index],
        priority: "normal",
      }),
    );
    // The Priority column shows the change; nothing is added above the table.
    expect(screen.queryByRole("region", { name: "Notification" })).not.toBeInTheDocument();
    expect(screen.queryByText(/set to normal/i)).not.toBeInTheDocument();
  });

  it("offers in-app Play before new-tab Open for a completed local video", async () => {
    const user = userEvent.setup();
    const base = buildScenarioSnapshot("file-progress", 24_000, false, 1);
    const fileSet = base.filesByTorrent[DEMO_PRIMARY_TORRENT_ID]!;
    const file = fileSet.order
      .map((id) => fileSet.rows[id])
      .find((candidate) => candidate?.padding === false)!;
    const snapshot = {
      ...base,
      demo: null,
      filesByTorrent: {
        ...base.filesByTorrent,
        [DEMO_PRIMARY_TORRENT_ID]: {
          ...fileSet,
          rows: {
            ...fileSet.rows,
            [file.id]: {
              ...file,
              name: "movie.mkv",
              mediaAvailability: "available" as const,
            },
          },
        },
      },
    };
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot,
    });
    const localPlayback: LocalVideoPlayback = {
      play: vi.fn(async () => ({ close: async () => {} })),
      openExternally: vi.fn(async () => {}),
      mediaUrl: vi.fn(async () => "/media/v1/test"),
    };
    renderApplication(
      application, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, localPlayback,
    );

    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Files" }));
    const files = screen.getByRole("grid", { name: "Torrent files" });
    await user.click(within(files).getByText("movie.mkv"));
    await user.click(screen.getByRole("button", { name: "More file actions" }));
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items.slice(0, 2)).toEqual(["Play", "Open"]);
    const play = screen.getByRole("menuitem", { name: "Play" });
    expect(play.querySelector("svg")).toBeNull();
    await user.click(play);

    await waitFor(() => expect(localPlayback.play).toHaveBeenCalledOnce());
    expect(localPlayback.play).toHaveBeenCalledWith(
      expect.objectContaining({
        torrentId: DEMO_PRIMARY_TORRENT_ID,
        fileIndex: file.index,
        fileName: "movie.mkv",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Play movie.mkv" })).toBeTruthy();
    expect(application.commands.some((command) => command.type === "open_file")).toBe(false);
  });

  it("shows Open only for a single verified available file", async () => {
    const user = userEvent.setup();
    const base = buildScenarioSnapshot("file-progress", 24_000, false, 1);
    const fileSet = base.filesByTorrent[DEMO_PRIMARY_TORRENT_ID]!;
    const file = fileSet.order
      .map((id) => fileSet.rows[id])
      .find((candidate) => candidate?.padding === false)!;
    const snapshot = {
      ...base,
      demo: null,
      filesByTorrent: {
        ...base.filesByTorrent,
        [DEMO_PRIMARY_TORRENT_ID]: {
          ...fileSet,
          rows: {
            ...fileSet.rows,
            [file.id]: { ...file, mediaAvailability: "available" as const },
          },
        },
      },
    };
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot,
    });
    renderApplication(application);

    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Files" }));
    const files = screen.getByRole("grid", { name: "Torrent files" });
    await user.click(within(files).getByText(file.name));
    await user.click(screen.getByRole("button", { name: "More file actions" }));
    const open = screen.getByRole("menuitem", { name: "Open" });
    // The file opens in a new tab or app, so the item says so visually.
    expect(open.querySelector("svg")).not.toBeNull();
    await user.click(open);

    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "open_file",
        torrentId: DEMO_PRIMARY_TORRENT_ID,
        fileIndex: file.index,
      }),
    );
  });

  it("keeps remote save progress bounded and reports completion and cancellation immediately", async () => {
    const user = userEvent.setup();
    const base = buildScenarioSnapshot("file-progress", 24_000, false, 1);
    const fileSet = base.filesByTorrent[DEMO_PRIMARY_TORRENT_ID]!;
    const file = fileSet.order
      .map((id) => fileSet.rows[id])
      .find((candidate) => candidate?.padding === false)!;
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...base,
        demo: null,
        filesByTorrent: {
          ...base.filesByTorrent,
          [DEMO_PRIMARY_TORRENT_ID]: {
            ...fileSet,
            rows: {
              ...fileSet.rows,
              [file.id]: { ...file, mediaAvailability: "available" as const },
            },
          },
        },
      },
    });
    let saveRequest: RemoteCompletedFileSaveRequest;
    let finishSave: () => void;
    const saveCompletedFile = vi.fn((request: RemoteCompletedFileSaveRequest) => {
      saveRequest = request;
      return new Promise<void>((resolve, reject) => {
        finishSave = resolve;
        request.signal?.addEventListener("abort", () => {
          reject(new DOMException("Cancelled", "AbortError"));
        }, { once: true });
      });
    });
    const remoteAccess = directFileRemoteAccess(saveCompletedFile);
    renderApplication(
      application,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      remoteAccess,
    );

    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Files" }));
    await user.click(within(screen.getByRole("grid", { name: "Torrent files" })).getByText(file.name));
    await user.click(screen.getByRole("button", { name: "More file actions" }));
    const save = await screen.findByRole("menuitem", { name: "Save file…" });
    await waitFor(() => expect(save).not.toHaveAttribute("aria-disabled"));
    await user.click(save);

    await waitFor(() =>
      expect(saveCompletedFile).toHaveBeenCalledWith(
        expect.objectContaining({
          torrentId: DEMO_PRIMARY_TORRENT_ID,
          fileIndex: file.index,
          fileName: file.name,
          lengthBytes: file.lengthBytes,
        }),
      ),
    );
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      const report = (state: "transferring" | "complete", bytesWritten: bigint) => {
        saveRequest.onProgress?.({ state, bytesWritten, fileLength: 1000n });
      };
      act(() => report("transferring", 10n));
      const progress = screen.getByRole("progressbar", { name: "Saving directly…" });
      expect(progress).toHaveAttribute("value", "1");
      // Simulate a burst of per-chunk callbacks without advancing the display clock.
      act(() => {
        for (let bytes = 11n; bytes < 700n; bytes++) report("transferring", bytes);
      });
      expect(progress).toHaveAttribute("value", "1");
      clock.mockReturnValue(200);
      act(() => report("transferring", 732n));
      expect(progress).toHaveAttribute("value", "73.2");
      expect(within(toast()).getByText("73.2%")).toBeInTheDocument();
      expect(within(toast()).getByText("Saving directly…")).not.toHaveTextContent("73.2%");
      // Progress lives in the toast, not in a row above the file table.
      expect(screen.getByRole("grid", { name: "Torrent files" })).not.toContainElement(progress);
      clock.mockReturnValue(201);
      await act(async () => {
        report("complete", 1000n);
        finishSave();
      });
      expect(toast()).toHaveTextContent("Remote file saved.");
      expect(screen.queryByRole("progressbar", { name: "Saving directly…" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancel save" })).not.toBeInTheDocument();
    } finally {
      clock.mockRestore();
    }
    await user.click(screen.getByRole("button", { name: "More file actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Save file…" }));
    await user.click(screen.getByRole("button", { name: "Cancel save" }));
    await findToast("Remote file save cancelled.");
    expect(saveRequest!.signal?.aborted).toBe(true);
    expect(screen.queryByRole("progressbar", { name: "Saving directly…" })).not.toBeInTheDocument();
  });

  it("sends one Download now command for a skipped file", async () => {
    const user = userEvent.setup();
    const snapshot = buildScenarioSnapshot("file-progress", 24_000, false, 1);
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: { ...snapshot, demo: null },
    });
    const fileSet = snapshot.filesByTorrent[DEMO_PRIMARY_TORRENT_ID]!;
    const skippedFile = fileSet.order
      .map((id) => fileSet.rows[id])
      .find((row) => row?.padding === false && row.selection === "skipped")!;
    renderApplication(application);

    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Files" }));
    const files = screen.getByRole("grid", { name: "Torrent files" });
    await user.click(within(files).getByText(skippedFile.name));
    await user.click(screen.getByRole("button", { name: "More file actions" }));
    const fileActions = screen.getByRole("menu", { name: "More file actions" });
    // Download, priority and share groups.
    expect(within(fileActions).getAllByRole("separator")).toHaveLength(2);
    expect(
      within(fileActions).getByRole("menuitem", { name: "Share file" }),
    ).toBeEnabled();
    expect(within(fileActions).queryByText("Download", { exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Download now" }));

    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "download_files",
        torrentId: DEMO_PRIMARY_TORRENT_ID,
        fileIndices: [skippedFile.index],
      }),
    );

    const selectedRow = () =>
      within(files)
        .getByText(skippedFile.name)
        .closest<HTMLElement>('[role="row"]')!;
    expect(
      within(selectedRow()).getByText("Skip", { exact: true }),
    ).toBeVisible();

    application.emitUpdate({
      type: "snapshot",
      snapshot: {
        ...snapshot,
        demo: null,
        filesByTorrent: {
          ...snapshot.filesByTorrent,
          [DEMO_PRIMARY_TORRENT_ID]: {
            ...fileSet,
            rows: {
              ...fileSet.rows,
              [skippedFile.id]: { ...skippedFile, selection: "normal" },
            },
          },
        },
      },
    });
    await waitFor(() =>
      expect(
        within(selectedRow()).getByText("Normal", { exact: true }),
      ).toBeVisible(),
    );
  });

  it("shares file priority actions between context and More menus", async () => {
    const user = userEvent.setup();
    const snapshot = buildScenarioSnapshot("file-progress", 24_000, false, 1);
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: { ...snapshot, demo: null },
    });
    const fileSet = snapshot.filesByTorrent[DEMO_PRIMARY_TORRENT_ID]!;
    const ordinaryFiles = fileSet.order
      .map((id) => fileSet.rows[id])
      .filter((row) => row?.padding === false)
      .slice(0, 2);
    renderApplication(application);

    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Files" }));
    const grid = screen.getByRole("grid", { name: "Torrent files" });
    const firstRow = within(grid).getAllByRole("row")[1]!;
    fireEvent.contextMenu(firstRow, { clientX: 120, clientY: 160 });
    const contextMenu = await screen.findByRole("menu");
    expect(within(contextMenu).queryByText("Priority", { exact: true })).not.toBeInTheDocument();
    expect(within(contextMenu).getAllByRole("separator")).toHaveLength(2);
    await user.click(
      within(contextMenu).getByRole("menuitem", { name: "Skip" }),
    );
    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "set_file_priority",
        torrentId: DEMO_PRIMARY_TORRENT_ID,
        fileIndices: [ordinaryFiles[0]!.index],
        priority: "skip",
      }),
    );

    await user.click(
      within(grid).getByRole("checkbox", {
        name: `Select ${ordinaryFiles[1]!.name}`,
      }),
    );
    fireEvent.contextMenu(firstRow, { clientX: 120, clientY: 160 });
    await user.click(screen.getByRole("menuitem", { name: "Normal" }));
    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "set_file_priority",
        torrentId: DEMO_PRIMARY_TORRENT_ID,
        fileIndices: ordinaryFiles.map((file) => file!.index),
        priority: "normal",
      }),
    );
  });

  it("materializes the global disk pipeline only on the Disk tab", async () => {
    const user = userEvent.setup();
    renderScenario("slow-disk-pressure", 20_000);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    expect(
      screen.queryByRole("grid", { name: "Active storage pieces" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Disk" }));
    expect(
      await screen.findByText("Receive → write → verify → checkpoint"),
    ).toBeVisible();
    expect(screen.getByLabelText("Disk pressure Backpressured")).toBeVisible();
    const pieces = screen.getByRole("grid", { name: "Active storage pieces" });
    expect(pieces).toHaveAttribute("aria-rowcount", "65");
    expect(within(pieces).getAllByRole("row").length).toBeLessThanOrEqual(100);
    expect(screen.getByText("intake paused now")).toBeVisible();
  });

  it("renders a bounded accessible canvas for a 250,000-piece torrent", async () => {
    const user = userEvent.setup();
    renderScenario("large-swarm", 0);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );

    await user.click(screen.getByRole("tab", { name: "Pieces" }));

    const canvas = await screen.findByRole("img", {
      name: /250,000 pieces: 135,000 verified, 6 active/i,
    }) as HTMLCanvasElement;
    expect(canvas).toBeVisible();
    expect(canvas.width).toBeLessThanOrEqual(640 * 3);
    expect(canvas.height).toBeLessThanOrEqual(1_024 * 3);
    expect(document.querySelectorAll("*").length).toBeLessThan(1_500);
    expect(screen.getByLabelText("Piece state legend")).toBeVisible();
  });

  it("resizes the detail pane with pointer and keyboard input", async () => {
    const user = userEvent.setup();
    renderScenario("healthy-download", 42_000);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    const splitter = screen.getByRole("separator", {
      name: "Resize torrent details",
    });
    const main = screen.getByRole("main");
    expect(splitter).toHaveAttribute("aria-orientation", "horizontal");
    expect(splitter).toHaveAttribute("aria-valuemin", "25");
    expect(splitter).toHaveAttribute("aria-valuemax", "80");
    expect(splitter).toHaveAttribute("aria-valuenow", "57");

    vi.spyOn(main, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 1_000,
      bottom: 700,
      left: 0,
      width: 1_000,
      height: 700,
      toJSON: () => ({}),
    });
    vi.spyOn(splitter, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 300,
      top: 300,
      right: 1_000,
      bottom: 307,
      left: 0,
      width: 1_000,
      height: 7,
      toJSON: () => ({}),
    });
    Object.defineProperties(splitter, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });

    fireEvent.pointerDown(splitter, {
      button: 0,
      pointerId: 7,
      clientY: 300,
    });
    fireEvent.pointerMove(splitter, { pointerId: 7, clientY: 200 });
    expect(splitter).toHaveAttribute("aria-valuenow", "72");
    expect(main.style.getPropertyValue("--detail-pane-share")).toBe("72fr");
    fireEvent.pointerUp(splitter, { pointerId: 7, clientY: 200 });
    expect(main).toHaveAttribute("data-resizing", "false");

    splitter.focus();
    await user.keyboard("{ArrowDown}");
    expect(splitter).toHaveAttribute("aria-valuenow", "67");
    await user.keyboard("{Home}");
    expect(splitter).toHaveAttribute("aria-valuenow", "25");
    await user.keyboard("{End}");
    expect(splitter).toHaveAttribute("aria-valuenow", "80");
  });

  it("confirms removal with retained data by default and restores focus", async () => {
    const user = userEvent.setup();
    renderScenario("healthy-download", 42_000);
    const trigger = screen.getByRole("button", { name: "Remove" });

    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Remove torrent?" });
    const deleteData = within(dialog).getByRole("checkbox", {
      name: "Also delete downloaded data",
    });
    expect(deleteData).not.toBeChecked();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();
    await user.click(deleteData);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /cannot be undone/i,
    );
    const destructive = within(dialog).getByRole("button", {
      name: "Remove and delete data",
    });
    destructive.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(deleteData).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    const reopened = screen.getByRole("dialog", { name: "Remove torrent?" });
    expect(within(reopened).getByRole("checkbox")).not.toBeChecked();
    await user.click(within(reopened).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(toast()).toHaveTextContent(/Removed Big Buck Bunny/);
  });

  it("keeps a failed removal dialog actionable", async () => {
    const user = userEvent.setup();
    const returnFocus = createRef<HTMLButtonElement>();
    const target = buildScenarioSnapshot("healthy-download", 42_000, false, 1)
      .torrents[DEMO_PRIMARY_TORRENT_ID]!;
    render(
      <>
        <button ref={returnFocus}>Remove trigger</button>
        <RemoveTorrentDialog
          targets={[target]}
          deleteDataSupported={true}
          returnFocus={() => returnFocus.current?.focus()}
          onCancel={() => {}}
          onConfirm={async () => {
            throw new Error("Provider permission was revoked");
          }}
        />
      </>,
    );
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(within(dialog).getAllByRole("alert").at(-1)).toHaveTextContent(
      "Provider permission was revoked",
    );
    expect(
      within(dialog).getByRole("button", { name: "Retry failed" }),
    ).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "Retry failed" }),
    ).toHaveFocus();
  });

  it("renders truthful empty states without fabricating media details", async () => {
    const user = userEvent.setup();
    renderScenario("empty-library", 0, undefined, undefined, undefined, undefined, false);
    expect(screen.getByText(/No torrents yet/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.getByText("No content sources yet")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /^Play / }),
    ).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    expect(screen.getByText(/Select a torrent to see its details/i)).toBeVisible();
  });

  it("preserves multi-selection across Library and drops it for hidden torrents", async () => {
    const user = userEvent.setup();
    renderScenario("healthy-download", 42_000);
    expect(
      screen.getByRole("checkbox", { name: "Select Sintel 4K open movie" }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("row", { name: /Sintel 4K open movie/ }), {
      shiftKey: true,
    });
    expect(screen.getByText("2 selected")).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Library" }));
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    expect(screen.getByText("2 selected")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Paused/ }));
    expect(screen.queryByText(/not shown/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /All torrents/ }));
    expect(
      screen.getAllByRole("checkbox", { name: /^Deselect / }),
    ).toHaveLength(1);
  });

  it("offers all torrents when a category filter hides every torrent", async () => {
    const user = userEvent.setup();
    renderScenario("healthy-download", 42_000);
    await user.click(screen.getByRole("button", { name: /Needs attention/ }));
    expect(screen.getByText("No torrents need attention.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Show all torrents" }));
    expect(
      screen.getByRole("row", { name: /Sintel 4K open movie/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Show all torrents" }),
    ).not.toBeInTheDocument();
  });

  it("uses exact torrent context targets and the shared grouped action set", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...buildScenarioSnapshot("healthy-download", 42_000, false, 1),
      demo: null,
    };
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot,
    });
    renderApplication(application);
    const grid = screen.getByRole("grid", { name: "Torrents" });
    const sintelRow = within(grid).getByRole("row", {
      name: /Sintel 4K open movie/,
    });

    fireEvent.contextMenu(sintelRow, { clientX: 180, clientY: 220 });
    const singletonMenu = await screen.findByRole("menu");
    expect(sintelRow).toHaveAttribute("aria-current", "true");
    expect(
      within(singletonMenu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Start",
      "Pause",
      "Force recheck",
      "Move to top",
      "Move to bottom",
      "Copy magnet link",
      "Copy share link",
      "Torrent settings",
      "Archive",
      "Restore",
      "Remove",
    ]);
    expect(within(singletonMenu).getAllByRole("separator")).toHaveLength(3);
    for (const heading of [
      "Transfer",
      "Sharing",
      "Organization",
      "Destructive",
    ]) {
      expect(
        within(singletonMenu).queryByText(heading, { exact: true }),
      ).not.toBeInTheDocument();
    }
    await user.click(within(singletonMenu).getByRole("menuitem", { name: "Torrent settings" }));
    const settings = screen.getByRole("dialog", { name: "Torrent settings" });
    expect(within(settings).getByText("Sintel 4K open movie")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(settings).not.toBeInTheDocument();
    expect(sintelRow).toHaveFocus();
    expect(
      within(grid).getByRole("checkbox", {
        name: "Deselect Sintel 4K open movie",
      }),
    ).toBeChecked();

    await user.click(
      within(grid).getByRole("checkbox", {
        name: "Select Big Buck Bunny 1080p surround",
      }),
    );
    fireEvent.contextMenu(sintelRow, { clientX: 180, clientY: 220 });
    expect(
      await screen.findByRole("menuitem", { name: "Copy magnet links" }),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Torrent settings" })).toHaveAttribute(
      "aria-disabled", "true",
    );
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    const dialog = screen.getByRole("dialog", { name: "Remove 2 torrents?" });
    expect(
      within(dialog).getByRole("list", { name: "Torrents to remove" }),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(sintelRow).toHaveFocus();
    expect(application.commands).toEqual([]);
  });

  it("opens a torrent context menu from the keyboard for the checked selection", async () => {
    const user = userEvent.setup();
    renderScenario("healthy-download", 42_000);
    const grid = screen.getByRole("grid", { name: "Torrents" });
    await user.click(
      within(grid).getByRole("checkbox", {
        name: "Select Sintel 4K open movie",
      }),
    );
    const currentRow = within(grid).getByRole("row", {
      name: /Big Buck Bunny 1080p surround/,
    });
    currentRow.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(
      await screen.findByRole("menuitem", { name: "Copy magnet links" }),
    ).toBeVisible();
  });

  it("keeps the detail row within the checked selection", async () => {
    const user = userEvent.setup();
    renderScenario("healthy-download", 42_000);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "General" }));

    const grid = screen.getByRole("grid", { name: "Torrents" });
    const detail = screen.getByRole("region", { name: "Torrent details" });
    const bunny = within(grid).getByRole("row", {
      name: /Big Buck Bunny 1080p surround/,
    });
    bunny.focus();
    await user.keyboard("{ArrowDown}");
    const sintel = within(grid).getByRole("row", {
      name: /Sintel 4K open movie/,
    });
    expect(sintel).toHaveAttribute("aria-current", "true");
    expect(
      within(detail).getByRole("heading", { name: "Sintel 4K open movie" }),
    ).toBeVisible();

    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(bunny).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("2 selected")).toBeVisible();
    expect(
      within(detail).getByRole("heading", {
        name: "Big Buck Bunny 1080p surround",
      }),
    ).toBeVisible();

    await user.keyboard("{Control>}a{/Control}");
    expect(screen.getByText("3 selected")).toBeVisible();
    await user.keyboard("{ArrowUp}");
    const arch = within(grid).getByRole("row", {
      name: /Arch Linux 2026\.08\.01 x86_64/,
    });
    expect(arch).toHaveAttribute("aria-current", "true");
    expect(
      screen.queryByText("3 selected"),
    ).not.toBeInTheDocument();
    expect(
      within(grid).getByRole("checkbox", {
        name: "Deselect Arch Linux 2026.08.01 x86_64",
      }),
    ).toBeChecked();
    expect(
      within(grid).getByRole("checkbox", {
        name: "Select Big Buck Bunny 1080p surround",
      }),
    ).not.toBeChecked();
    expect(
      within(detail).getByRole("heading", {
        name: "Arch Linux 2026.08.01 x86_64",
      }),
    ).toBeVisible();

    await user.keyboard("{Escape}");
    expect(
      screen.queryByText("3 selected"),
    ).not.toBeInTheDocument();
    expect(arch).toHaveAttribute("aria-current", "true");
  });

  it("targets an ordinary row action and clears it from table background", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...buildScenarioSnapshot("healthy-download", 42_000, false, 1),
      demo: null,
    };
    const bunny = Object.values(snapshot.torrents).find(
      (torrent) => torrent.name === "Big Buck Bunny 1080p surround",
    )!;
    const sintel = Object.values(snapshot.torrents).find(
      (torrent) => torrent.name === "Sintel 4K open movie",
    )!;
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot,
    });
    renderApplication(application);

    await user.click(screen.getByRole("row", { name: /Sintel 4K open movie/ }));
    await user.click(screen.getByRole("row", { name: /Big Buck Bunny 1080p/ }));
    await user.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() =>
      expect(application.commands).toEqual([
        { type: "pause", torrentId: bunny.id },
      ]),
    );
    expect(application.commands).not.toContainEqual({
      type: "pause",
      torrentId: sintel.id,
    });

    fireEvent.click(screen.getByRole("grid", { name: "Torrents" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  it("runs multi-row commands sequentially and reports partial failure", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...buildScenarioSnapshot("healthy-download", 42_000, false, 1),
      demo: null,
    };
    const sintel = Object.values(snapshot.torrents).find(
      (torrent) => torrent.name === "Sintel 4K open movie",
    )!;
    const application = new RecordingLiveApplication(
      { type: "snapshot", snapshot },
      sintel.id,
    );
    renderApplication(application);
    await user.click(
      screen.getByRole("checkbox", { name: "Select Sintel 4K open movie" }),
    );
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));

    await waitFor(() =>
      expect(application.commands).toEqual([
        { type: "archive", torrentId: DEMO_PRIMARY_TORRENT_ID },
        { type: "archive", torrentId: sintel.id },
      ]),
    );
    expect(within(toast()).getByRole("alert")).toHaveTextContent(
      "1 of 2 torrents failed: Sintel 4K open movie: rejected for test",
    );
    // A partial failure offers no Undo.
    expect(
      within(toast()).queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
  });

  it("offers Undo after archiving and resumes only torrents that were running", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...buildScenarioSnapshot("healthy-download", 42_000, false, 1),
      demo: null,
    };
    const sintel = Object.values(snapshot.torrents).find(
      (torrent) => torrent.name === "Sintel 4K open movie",
    )!;
    const primary = snapshot.torrents[DEMO_PRIMARY_TORRENT_ID]!;
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...snapshot,
        torrents: {
          ...snapshot.torrents,
          [DEMO_PRIMARY_TORRENT_ID]: { ...primary, operationalState: "downloading" },
          [sintel.id]: { ...sintel, operationalState: "paused", status: "paused" },
        },
      },
    });
    renderApplication(application);
    await user.click(
      screen.getByRole("checkbox", { name: "Select Sintel 4K open movie" }),
    );
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));

    await findToast("Archived 2 torrents");
    expect(within(toast()).queryByRole("alert")).not.toBeInTheDocument();
    await user.click(within(toast()).getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(application.commands).toEqual([
        { type: "archive", torrentId: DEMO_PRIMARY_TORRENT_ID },
        { type: "archive", torrentId: sintel.id },
        { type: "unarchive", torrentId: DEMO_PRIMARY_TORRENT_ID },
        { type: "unarchive", torrentId: sintel.id },
        { type: "resume", torrentId: DEMO_PRIMARY_TORRENT_ID },
      ]),
    );
    // Undo itself is not undoable.
    expect(screen.queryByRole("region", { name: "Notification" })).not.toBeInTheDocument();
  });

  it("removes multiple torrents and retries only failed targets", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...buildScenarioSnapshot("healthy-download", 42_000, false, 1),
      demo: null,
    };
    const sintel = Object.values(snapshot.torrents).find(
      (torrent) => torrent.name === "Sintel 4K open movie",
    )!;
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot,
    });
    application.rejectNextTorrentId = sintel.id;
    renderApplication(application);
    await user.click(
      screen.getByRole("checkbox", { name: "Select Sintel 4K open movie" }),
    );
    await user.click(screen.getByRole("button", { name: "Remove" }));
    let dialog = screen.getByRole("dialog", { name: "Remove 2 torrents?" });
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "Also delete downloaded data",
      }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Remove and delete data" }),
    );

    dialog = await screen.findByRole("dialog", { name: "Remove torrent?" });
    expect(within(dialog).getAllByRole("alert").at(-1)).toHaveTextContent(
      "1 of 2 torrents failed: Sintel 4K open movie: rejected for test",
    );
    expect(
      within(dialog).getByRole("button", { name: "Retry failed" }),
    ).toBeEnabled();
    await user.click(
      within(dialog).getByRole("button", { name: "Retry failed" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      application.commands.filter((command) => command.type === "remove"),
    ).toEqual([
      {
        type: "remove",
        torrentId: DEMO_PRIMARY_TORRENT_ID,
        deleteData: true,
      },
      { type: "remove", torrentId: sintel.id, deleteData: true },
      { type: "remove", torrentId: sintel.id, deleteData: true },
    ]);
  });

  it("opens truthful Library details and hands their source to Torrents", async () => {
    const user = userEvent.setup();
    renderScenario("healthy-download", 42_000, undefined, undefined, undefined, undefined, false);
    await user.click(screen.getByRole("button", { name: "Library" }));
    expect(
      screen.queryByRole("button", { name: /^Play / }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Open details for Sintel 4K open movie",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Sintel 4K open movie" }),
    ).toBeVisible();
    expect(screen.getByRole("tab", { name: "Media" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Waiting for torrent metadata…")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open in Torrents" }));
    expect(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    ).toHaveAttribute(
      "aria-current",
      "page",
    );
    await user.click(screen.getByRole("tab", { name: "General" }));
    expect(
      screen.getByRole("button", { name: "Copy magnet link" }),
    ).toBeVisible();
    expect(screen.getAllByText("Sintel 4K open movie").length).toBeGreaterThan(
      0,
    );
  });

  it("orders a TV detail numerically and restores its Library card", async () => {
    const user = userEvent.setup();
    renderScenario("media-library", 0, undefined, undefined, undefined, undefined, false);
    await user.click(screen.getByRole("button", { name: "Library" }));
    const trigger = screen.getByRole("button", {
      name: "Open details for North Shore Stories · Seasons 1–2",
    });
    await user.click(trigger);

    expect(
      screen.getByRole("heading", {
        name: "North Shore Stories · Seasons 1–2",
      }),
    ).toBeVisible();
    const media = await screen.findByRole("list", {
      name: "Recognized video files",
    });
    const names = within(media)
      .getAllByRole("listitem")
      .map((row) => row.querySelector("strong[title]")?.textContent);
    expect(names).toEqual([
      "North.Shore.Stories.S01E01.1080p.WEB-DL.mkv",
      "North.Shore.Stories.S01E02.1080p.WEB-DL.mp4",
      "North.Shore.Stories.S01E07E08.mkv",
      "North.Shore.Stories.S01E10.1080p.WEB-DL.mkv",
      "North.Shore.Stories.S02E01.mkv",
      "Behind the scenes.webm",
    ]);
    expect(within(media).getAllByText("Downloaded")).toHaveLength(2);
    expect(within(media).getByText("Not selected")).toBeVisible();
    const progress = within(media).getAllByLabelText(/download progress$/);
    expect(progress).toHaveLength(6);
    expect(progress.every((row) => /verified$/.test(row.textContent ?? ""))).toBe(
      true,
    );

    await user.click(screen.getByRole("tab", { name: "All files" }));
    const files = await screen.findByRole("list", {
      name: "All torrent files",
    });
    expect(within(files).getByText("poster.jpg")).toBeVisible();
    expect(within(files).getByText("README.nfo")).toBeVisible();

    await user.keyboard("{Escape}");
    const restored = await screen.findByRole("button", {
      name: "Open details for North Shore Stories · Seasons 1–2",
    });
    await waitFor(() => expect(restored).toHaveFocus());
  });

  it("plays an eligible Library video through the existing file action", async () => {
    const user = userEvent.setup();
    const snapshot = buildScenarioSnapshot("media-library", 0, false, 1);
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: { ...snapshot, demo: null },
    });
    renderApplication(application);

    await user.click(screen.getByRole("button", { name: "Library" }));
    await user.click(
      screen.getByRole("button", {
        name: "Open details for North Shore Stories · Seasons 1–2",
      }),
    );
    const playable = await screen.findByRole("button", {
      name: "Play North.Shore.Stories.S01E02.1080p.WEB-DL.mp4",
    });
    expect(playable).toBeEnabled();
    const unavailable = screen.getByRole("button", {
      name: "Play North.Shore.Stories.S01E07E08.mkv",
    });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveAttribute(
      "title",
      "Playback is unavailable: not verified.",
    );

    await user.click(playable);
    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "open_file",
        torrentId: snapshot.torrentOrder[0],
        fileIndex: 2,
      }),
    );
    // The player opening is the confirmation.
    expect(screen.queryByRole("region", { name: "Notification" })).not.toBeInTheDocument();

    application.rejectNextTorrentId = snapshot.torrentOrder[0];
    await user.click(playable);
    expect(within(await findToast("rejected for test")).getByRole("alert")).toBeVisible();
    expect(playable).toBeEnabled();
  });

  it("renders one metadata-backed torrent size across product views", async () => {
    const user = userEvent.setup();
    const snapshot = buildScenarioSnapshot("media-library", 0, false, 1);
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: { ...snapshot, demo: null },
    });
    renderApplication(application);

    await user.click(screen.getByRole("button", { name: "Library" }));
    const card = screen.getByRole("button", {
      name: "Open details for North Shore Stories · Seasons 1–2",
    });
    expect(within(card).getByText("4.1 GB")).toBeVisible();
    await user.click(card);
    expect(screen.queryByText("Size pending")).not.toBeInTheDocument();
    expect(screen.getAllByText("4.1 GB").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Back to Library" }));
    await user.click(screen.getByRole("button", { name: "Torrents" }));
    expect(
      within(screen.getByRole("grid", { name: "Torrents" })).getByText(
        "4.1 GB",
      ),
    ).toBeVisible();

    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "General" }));
    expect(
      screen.getByText("Size", { selector: "dt" }).parentElement,
    ).toHaveTextContent("4.1 GB");
  });

  it("bounds the mounted media rows for a 4,096-file catalog", async () => {
    const user = userEvent.setup();
    renderScenario("file-progress", 24_000, undefined, undefined, undefined, undefined, false);
    await user.click(screen.getByRole("button", { name: "Library" }));
    await user.click(
      screen.getByRole("button", {
        name: "Open details for Open Movies production archive",
      }),
    );

    expect(screen.getByText(/recognized videos$/)).toHaveTextContent(
      /^[2-4],[0-9]{3} recognized videos$/,
    );
    const media = await screen.findByRole("list", {
      name: "Recognized video files",
    });
    const mountedRows = within(media).getAllByRole("listitem").length;
    expect(mountedRows).toBeGreaterThan(0);
    expect(mountedRows).toBeLessThanOrEqual(20);
  });

  it("browses media across torrents by preset, show, search and layout", async () => {
    const user = userEvent.setup();
    renderScenario("media-library", 0);
    await user.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.getByRole("heading", { name: "All media" })).toBeVisible();
    // The skipped double episode is not part of the library.
    const items = () => screen.getByRole("list", { name: "Library items" });
    expect(within(items()).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("5 items")).toBeVisible();
    expect(within(items()).getAllByText(/^S01 · E01 · North Shore Stories$/)).toHaveLength(1);
    expect(within(items()).getAllByText(/^Complete · /)).toHaveLength(2);
    // Art shows the kind of media, not initials.
    expect(within(items()).queryByText("NS")).not.toBeInTheDocument();

    const filters = screen.getByRole("navigation", { name: "Library filters" });
    expect(within(filters).getByRole("button", { name: /^TV shows/ })).toHaveTextContent("4");
    expect(within(filters).getByRole("button", { name: /^Movies/ })).toHaveTextContent("0");
    await user.click(within(filters).getByRole("button", { name: /^TV shows/ }));
    const shows = screen.getByRole("list", { name: "TV shows" });
    const show = within(shows).getByRole("button", { name: /North Shore Stories/ });
    expect(show).toHaveTextContent("4 episodes · 2 seasons");
    expect(show).toHaveTextContent("2 of 4 complete");
    await user.click(show);
    expect(screen.getByRole("heading", { name: "North Shore Stories" })).toBeVisible();
    expect(within(items()).getAllByRole("listitem")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Back to TV shows" }));
    expect(screen.getByRole("list", { name: "TV shows" })).toBeVisible();

    await user.click(within(filters).getByRole("button", { name: /^All media/ }));
    await user.type(
      screen.getByRole("searchbox", { name: "Search the library" }),
      "s02",
    );
    await waitFor(() =>
      expect(within(items()).getAllByRole("listitem")).toHaveLength(1),
    );
    await user.click(screen.getByRole("radio", { name: "List" }));
    const table = screen.getByRole("grid", { name: "Library items" });
    expect(within(table).getByRole("columnheader", { name: /Show or album/ })).toBeVisible();
    expect(within(table).getAllByRole("row")).toHaveLength(2);

    await user.click(
      within(table).getByRole("button", { name: /^Show .* in its torrent$/ }),
    );
    expect(
      screen.getByRole("heading", { name: "North Shore Stories · Seasons 1–2" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back to Library" }));
    // The search and page return with the Library, and focus with the item.
    expect(
      within(screen.getByRole("grid", { name: "Library items" })).getByRole("button", {
        name: /^Show .* in its torrent$/,
      }),
    ).toHaveFocus();
  });

  it("pages the Library through the host query", async () => {
    const user = userEvent.setup();
    const base = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
    const request = libraryMediaRequest(DEFAULT_LIBRARY_BROWSE);
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `t1-000102030405060708090a0b0c0d0e0f:${index}`,
      torrentId: "t1-000102030405060708090a0b0c0d0e0f",
      torrentName: "Lectures",
      fileIndex: index,
      fileName: `${index} Lecture.mp4`,
      title: `Lecture ${index}`,
      kind: "video" as const,
      role: "other" as const,
      seriesTitle: null,
      seriesId: null,
      seasonNumber: null,
      episodeNumber: null,
      endingEpisodeNumber: null,
      albumTitle: null,
      albumId: null,
      discNumber: null,
      trackNumber: null,
      year: null,
      extension: "mp4",
      lengthBytes: "1000",
      verifiedBytes: "1000",
      offline: true,
      archived: false,
      mediaAvailability: "available" as const,
    }));
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...base,
        demo: null,
        libraryMedia: {
          request,
          page: { offset: 0, limit: 100, total: 250, nextOffset: 100 },
          facets: {
            items: 250,
            video: 250,
            audio: 0,
            episodes: 0,
            movies: 0,
            other_videos: 250,
            tracks: 0,
            offline: 250,
            incomplete: 0,
            series: 0,
            albums: 0,
            torrents: 1,
            metadata_pending: 2,
          },
          items: rows,
          groups: [],
        },
        viewStatus: { ...base.viewStatus, libraryMedia: { status: "ready" } },
      },
    });
    renderApplication(application);
    await user.click(screen.getByRole("button", { name: "Library" }));
    const pages = screen.getByRole("navigation", { name: "Library pages" });
    expect(pages).toHaveTextContent("1–100 of 250");
    expect(within(pages).getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(within(pages).getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(application.views.at(-1)?.libraryMedia).toEqual({
        ...request,
        offset: 100,
      }),
    );
    // A new query returns to the first page and keeps the last page shown.
    await user.click(screen.getByRole("radio", { name: "Complete" }));
    await waitFor(() =>
      expect(application.views.at(-1)?.libraryMedia).toMatchObject({
        offset: 0,
        query: { availability: "offline" },
      }),
    );
    expect(screen.getAllByText("Lecture 0").length).toBeGreaterThan(0);
  });

  it("leases detail views only while Torrents needs them", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...buildScenarioSnapshot("healthy-download", 42_000, false, 1),
      demo: null,
    };
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot,
    });
    renderApplication(application);
    await user.click(screen.getByRole("button", { name: "Library" }));
    await waitFor(() =>
      expect(application.views.at(-1)).toEqual({
        library: true,
        libraryMedia: DEFAULT_LIBRARY_REQUEST,
        torrentId: null,
        detail: null,
        logCapture: null,
        speed: null,
      }),
    );

    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await waitFor(() =>
      expect(application.views.at(-1)).toMatchObject({
        library: true,
        torrentId: DEMO_PRIMARY_TORRENT_ID,
        detail: "peers",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Library" }));
    await waitFor(() =>
      expect(application.views.at(-1)).toEqual({
        library: true,
        libraryMedia: DEFAULT_LIBRARY_REQUEST,
        torrentId: null,
        detail: null,
        logCapture: null,
        speed: null,
      }),
    );
  });

  it("offers Restore when an added torrent is already archived", async () => {
    const user = userEvent.setup();
    const base = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
    const archived = { ...base.torrents[DEMO_PRIMARY_TORRENT_ID]!, archived: true };
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...base,
        demo: null,
        storage: {
          roots: [downloadRoot("root_a", "Downloads")],
          defaultRoot: "root_a",
          showAddOptions: false,
        },
        torrents: { ...base.torrents, [archived.id]: archived },
      },
    });
    const dispatch = application.dispatch.bind(application);
    vi.spyOn(application, "dispatch").mockImplementation(async (command) =>
      command.type === "add_magnet"
        ? {
            accepted: true,
            torrentId: archived.id,
            addDisposition: { type: "already_present" },
          }
        : dispatch(command),
    );
    renderApplication(application);
    await user.type(
      screen.getByRole("textbox", { name: "Magnet link or torrent URL" }),
      "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await findToast("Torrent is already in Archived.");
    await user.click(within(toast()).getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "unarchive",
        torrentId: archived.id,
      }),
    );
  });

  it("requires a folder on first add and retains the magnet across cancellation", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication();
    renderApplication(application);
    const draft = screen.getByRole("textbox", {
      name: "Magnet link or torrent URL",
    });
    const magnet =
      "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213";
    await user.type(draft, magnet);
    await user.click(screen.getByRole("button", { name: "Add" }));

    let dialog = screen.getByRole("dialog", {
      name: "Add torrent",
    });
    expect(
      within(dialog).getByText(/download folder is required/i),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Add torrent" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();
    expect(draft).toHaveValue(magnet);

    await user.click(
      within(dialog).getByRole("button", { name: "Choose folder…" }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("radio", { name: /Selected Downloads/ }),
      ).toBeChecked(),
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("dialog", { name: "Add torrent" }),
    ).not.toBeInTheDocument();
    expect(draft).toHaveValue(magnet);
    expect(
      application.commands.filter((command) => command.type === "add_magnet"),
    ).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Add" }));
    dialog = screen.getByRole("dialog", { name: "Add torrent" });
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "Always use this folder",
      }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "Start downloading right away",
      }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add torrent" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add torrent" }),
      ).not.toBeInTheDocument(),
    );
    expect(draft).toHaveValue("");
    expect(application.commands).toEqual([
      { type: "choose_download_root" },
      {
        type: "add_magnet",
        magnet,
        storageRoot: "root_1",
        startContent: false,
      },
      { type: "set_show_add_options", show: false },
    ]);
  });

  it("opens the hidden torrent chooser only for empty pointer or keyboard Add", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [downloadRoot("root_a", "Downloads")],
        defaultRoot: "root_a",
        showAddOptions: false,
      }),
    });
    renderApplication(application);
    const fileInput = torrentFileInput();
    const openChooser = vi.spyOn(fileInput, "click");
    const add = screen.getByRole("button", { name: "Add" });
    const draft = screen.getByRole("textbox", {
      name: "Magnet link or torrent URL",
    });

    expect(fileInput).toHaveAttribute(
      "accept",
      ".torrent,application/x-bittorrent",
    );
    expect(fileInput).toHaveAttribute("multiple");
    await user.click(add);
    expect(openChooser).toHaveBeenCalledOnce();
    draft.focus();
    await user.keyboard("{Enter}");
    expect(openChooser).toHaveBeenCalledTimes(2);
    expect(application.commands).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("");

    await user.type(draft, "not a magnet");
    await user.click(add);
    expect(openChooser).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Enter a magnet link beginning with magnet:?"),
    ).toBeVisible();
    expect(application.commands).toEqual([]);
  });

  it("uploads one selected file immediately through the usable default root", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [downloadRoot("root_a", "Downloads")],
        defaultRoot: "root_a",
        showAddOptions: false,
      }),
    });
    renderApplication(application);
    const bytes = new Uint8Array([100, 52, 58, 105, 110, 102, 111, 101]);
    const source = bytes.buffer.slice(0) as ArrayBuffer;
    const file = new File([bytes], "private-name.torrent", {
      type: "application/octet-stream",
    });
    const read = vi.fn().mockResolvedValue(source);
    Object.defineProperty(file, "arrayBuffer", { value: read });
    const fileInput = torrentFileInput();

    await user.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() =>
      expect(application.commands).toContainEqual({
        type: "add_torrent_bytes",
        source,
        storageRoot: "root_a",
        startContent: true,
      }),
    );
    expect(read).toHaveBeenCalledOnce();
    expect(fileInput).toHaveValue("");
    expect(JSON.stringify(application.commands)).not.toContain("private-name");
    // A new torrent appears in the list; no toast repeats that.
    expect(screen.queryByRole("region", { name: "Notification" })).not.toBeInTheDocument();
  });

  it("adds several selected files in turn with one summary", async () => {
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [downloadRoot("root_a", "Downloads")],
        defaultRoot: "root_a",
        showAddOptions: false,
        showFileSelection: true,
      }),
    });
    const dispatch = application.dispatch.bind(application);
    const first = new Uint8Array([1, 2, 3]).buffer;
    const second = new Uint8Array([4, 5, 6]).buffer;
    vi.spyOn(application, "dispatch").mockImplementation(async (command) => {
      const result = await dispatch(command);
      if (command.type === "add_torrent_bytes" && command.source === second) {
        return {
          accepted: true,
          torrentId: "t1-00000000000000000000000000000002",
          addDisposition: { type: "already_present" },
        };
      }
      return result;
    });
    renderApplication(application);
    const fileA = new File([new Uint8Array(first)], "a.torrent");
    Object.defineProperty(fileA, "arrayBuffer", { value: async () => first });
    const fileB = new File([new Uint8Array(second)], "b.torrent");
    Object.defineProperty(fileB, "arrayBuffer", { value: async () => second });
    const empty = new File([], "empty.torrent");

    fireEvent.change(torrentFileInput(), {
      target: { files: [fileA, fileB, empty] },
    });

    await waitFor(() =>
      expect(within(toast()).getByRole("alert")).toHaveTextContent(
        "Added 1. Already in your list: 1. Couldn't add 1: empty.torrent: Torrent files must contain at least one byte.",
      ),
    );
    // Several files share the default folder and never wait for selection.
    expect(application.commands).toEqual([
      { type: "add_torrent_bytes", source: first, storageRoot: "root_a", startContent: true },
      { type: "add_torrent_bytes", source: second, storageRoot: "root_a", startContent: true },
    ]);
    expect(screen.queryByRole("dialog", { name: "Add torrent" })).not.toBeInTheDocument();
  });

  it("asks once for the folder of several files when add options are shown", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [
          downloadRoot("root_a", "Downloads"),
          downloadRoot("root_b", "Other folder"),
        ],
        defaultRoot: "root_a",
        showAddOptions: true,
      }),
    });
    renderApplication(application);
    const sources = [new Uint8Array([1]).buffer, new Uint8Array([2]).buffer];
    const files = sources.map((source, index) => {
      const file = new File([new Uint8Array(source)], `file-${index}.torrent`);
      Object.defineProperty(file, "arrayBuffer", { value: async () => source });
      return file;
    });

    fireEvent.change(torrentFileInput(), { target: { files } });
    const dialog = screen.getByRole("dialog", { name: "Add torrent" });
    await user.click(within(dialog).getByRole("radio", { name: /Other folder/ }));
    await user.click(within(dialog).getByRole("button", { name: "Add torrent" }));

    await waitFor(() =>
      expect(application.commands).toEqual(
        sources.map((source) => ({
          type: "add_torrent_bytes",
          source,
          storageRoot: "root_b",
          startContent: true,
        })),
      ),
    );
    expect(await findToast("Added 2. Already in your list: 0.")).toBeVisible();
  });

  it("adds from the header on every destination where there is room", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [downloadRoot("root_a", "Downloads")],
        defaultRoot: "root_a",
        showAddOptions: false,
      }),
    });
    renderApplication(application);
    await user.click(screen.getByRole("button", { name: "Library" }));
    const header = screen.getByRole("banner");
    const magnet = `magnet:?xt=urn:btih:${"c".repeat(40)}&dn=Library`;
    await user.type(
      within(header).getByRole("textbox", { name: "Magnet link or torrent URL" }),
      magnet,
    );
    await user.click(within(header).getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(application.commands).toEqual([
        { type: "add_magnet", magnet, storageRoot: "root_a", startContent: true },
      ]),
    );
    expect(screen.getAllByRole("textbox", { name: "Magnet link or torrent URL" })).toHaveLength(1);
  });

  it("adds each pasted magnet link with one summary", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [downloadRoot("root_a", "Downloads")],
        defaultRoot: "root_a",
        showAddOptions: false,
      }),
    });
    renderApplication(application);
    const first = `magnet:?xt=urn:btih:${"a".repeat(40)}&dn=First`;
    const second = `magnet:?xt=urn:btih:${"b".repeat(40)}&dn=Second`;
    const draft = screen.getByRole("textbox", { name: "Magnet link or torrent URL" });

    await user.click(draft);
    await user.paste(`${first}\n\n${second}\nnot-a-link\n`);
    expect(draft).toHaveValue(`${first} ${second} not-a-link`);
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(within(toast()).getByRole("alert")).toHaveTextContent(
        "Added 2. Already in your list: 0. Couldn't add 1: not-a-link: Enter a magnet link beginning with magnet:?",
      ),
    );
    expect(application.commands).toEqual([
      { type: "add_magnet", magnet: first, storageRoot: "root_a", startContent: true },
      { type: "add_magnet", magnet: second, storageRoot: "root_a", startContent: true },
    ]);
    // A failed link stays in the box so it can be fixed.
    expect(draft).not.toHaveValue("");

    fireEvent.change(draft, { target: { value: `${first} ${second}` } });
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(draft).toHaveValue(""));
    expect(await findToast("Added 2. Already in your list: 0.")).toBeVisible();
  });

  it("keeps the open Settings category in the store", async () => {
    const user = userEvent.setup();
    renderApplication(
      new RecordingLiveApplication({
        type: "snapshot",
        snapshot: liveSnapshot({
          roots: [downloadRoot("root_a", "Downloads")],
          defaultRoot: "root_a",
          showAddOptions: false,
        }),
      }),
    );
    const store = controllers.at(-1)!.store;
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(await screen.findByRole("tab", { name: "Downloads" }));
    expect(store.getState().presentation.settingsCategory).toBe("downloads");

    // A link may name a category this client lacks; Appearance shows instead.
    act(() => store.getState().selectSettingsCategory("power"));
    expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    act(() => store.getState().closeSettings());
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("shows torrent list export and import only where the client supports them", async () => {
    const user = userEvent.setup();
    const unsupported = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [downloadRoot("root_a", "Downloads")],
        defaultRoot: "root_a",
        showAddOptions: false,
      }),
    });
    const first = renderApplication(unsupported);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "Data & reset" }));
    expect(screen.getByRole("button", { name: "Restore defaults…" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Export torrent list" })).not.toBeInTheDocument();
    first.unmount();

    const supported = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [downloadRoot("root_a", "Downloads"), downloadRoot("root_b", "Other folder")],
        defaultRoot: "root_b",
        showAddOptions: false,
      }),
    });
    const exportTorrentList = vi.fn(async () => true);
    const importTorrentBundle = vi.fn(
      async (_target: TorrentListImportTarget, chooseFile: () => Promise<ArrayBuffer | null>) => {
        await chooseFile();
        return { added: 1, already_present: 0, failed: [] };
      },
    );
    Object.assign(supported, { exportTorrentList, importTorrentBundle });
    renderApplication(supported);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "Data & reset" }));
    await user.click(screen.getByRole("button", { name: "Export torrent list" }));
    expect(exportTorrentList).toHaveBeenCalledOnce();
    expect(await findToast("Torrent list saved.")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Import into" })).toHaveValue("root_b");
  });

  it("retains only the File while options are chosen and applies them after read", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [
          downloadRoot("root_a", "Default Downloads"),
          downloadRoot("root_b", "External Drive"),
        ],
        defaultRoot: "root_a",
        showAddOptions: true,
      }),
    });
    renderApplication(application);
    const source = new Uint8Array([1, 2, 3, 4]).buffer;
    const file = new File([new Uint8Array(source)], "options.torrent", {
      type: "application/x-bittorrent",
    });
    const read = vi.fn().mockResolvedValue(source);
    Object.defineProperty(file, "arrayBuffer", { value: read });

    await user.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(torrentFileInput(), { target: { files: [file] } });
    const dialog = screen.getByRole("dialog", {
      name: "Add torrent",
    });
    expect(read).not.toHaveBeenCalled();
    expect(application.commands).toEqual([]);

    await user.click(
      within(dialog).getByRole("radio", { name: /External Drive/ }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "Start downloading right away",
      }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "Always use this folder",
      }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add torrent" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add torrent" }),
      ).not.toBeInTheDocument(),
    );
    expect(read).toHaveBeenCalledOnce();
    expect(application.commands).toEqual([
      {
        type: "add_torrent_bytes",
        source,
        storageRoot: "root_b",
        startContent: false,
      },
      { type: "set_default_download_root", rootId: "root_b" },
      { type: "set_show_add_options", show: false },
    ]);
  });

  it("rejects empty files and keeps a dialog file available after a read failure", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [downloadRoot("root_a", "Downloads")],
        defaultRoot: "root_a",
        showAddOptions: true,
      }),
    });
    renderApplication(application);
    const fileInput = torrentFileInput();
    fireEvent.change(fileInput, {
      target: { files: [new File([], "empty.torrent")] },
    });
    expect(
      screen.getByText("Torrent files must contain at least one byte."),
    ).toBeVisible();
    expect(application.commands).toEqual([]);

    const source = new Uint8Array([1, 2, 3]).buffer;
    const file = new File([new Uint8Array(source)], "retry.torrent");
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce(source);
    Object.defineProperty(file, "arrayBuffer", { value: read });
    fireEvent.change(fileInput, { target: { files: [file] } });
    const dialog = screen.getByRole("dialog", {
      name: "Add torrent",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Add torrent" }),
    );
    expect(
      await within(dialog).findByText(
        "Could not read the torrent file: permission denied",
      ),
    ).toBeVisible();
    expect(application.commands).toEqual([]);

    await user.click(
      within(dialog).getByRole("button", { name: "Add torrent" }),
    );
    await waitFor(() =>
      expect(application.commands).toContainEqual({
        type: "add_torrent_bytes",
        source,
        storageRoot: "root_a",
        startContent: true,
      }),
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("resets same-file selection and blocks duplicate submission while reading", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [downloadRoot("root_a", "Downloads")],
        defaultRoot: "root_a",
        showAddOptions: false,
      }),
    });
    renderApplication(application);
    const source = new Uint8Array([1, 2, 3]).buffer;
    let finishRead: ((value: ArrayBuffer) => void) | undefined;
    const read = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishRead = resolve;
        }),
    );
    const file = new File([new Uint8Array(source)], "same.torrent");
    Object.defineProperty(file, "arrayBuffer", { value: read });
    const fileInput = torrentFileInput();
    const openChooser = vi.spyOn(fileInput, "click");
    const add = screen.getByRole("button", { name: "Add" });

    await user.click(add);
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(add).toHaveAttribute("aria-busy", "true"));
    expect(add).toHaveTextContent("Add");
    expect(fileInput).toHaveValue("");
    fireEvent.submit(add.closest("form")!);
    expect(openChooser).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    finishRead?.(source);
    await waitFor(() => expect(application.commands).toHaveLength(1));

    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    finishRead?.(source);
    await waitFor(() => expect(application.commands).toHaveLength(2));
  });

  it("uses an alternate root for one add without changing the default", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [
          downloadRoot("root_a", "Default Downloads"),
          downloadRoot("root_b", "External Drive"),
        ],
        defaultRoot: "root_a",
        showAddOptions: true,
      }),
    });
    renderApplication(application);
    const magnet =
      "magnet:?xt=urn:btih:111102030405060708090a0b0c0d0e0f10111213";
    await user.type(
      screen.getByRole("textbox", { name: "Magnet link or torrent URL" }),
      magnet,
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    const dialog = screen.getByRole("dialog", {
      name: "Add torrent",
    });
    expect(
      within(dialog).getByRole("radio", { name: /Default Downloads/ }),
    ).toBeChecked();
    await user.click(
      within(dialog).getByRole("radio", { name: /External Drive/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add torrent" }),
    );
    await waitFor(() =>
      expect(application.commands).toContainEqual({
        type: "add_magnet",
        magnet,
        storageRoot: "root_b",
        startContent: true,
      }),
    );
    expect(application.commands).not.toContainEqual({
      type: "set_default_download_root",
      rootId: "root_b",
    });
  });

  it("processes external magnet and torrent-file activations in FIFO order", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication();
    const external = new RecordingExternalIntake([
      externalActivation("00010203-0405-4607-8809-0a0b0c0d0e0f", "magnet"),
      externalActivation(
        "11110203-0405-4607-8809-0a0b0c0d0e0f",
        "torrent_file",
      ),
    ]);
    renderApplication(application, undefined, undefined, external);

    let dialog = await screen.findByRole("dialog", {
      name: "Add torrent",
    });
    expect(
      within(dialog).getByText(/external magnet link requested this add/i),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: "Choose folder…" }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("radio", { name: /Selected Downloads/ }),
      ).toBeChecked(),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add torrent" }),
    );

    await waitFor(() =>
      expect(application.commands).toContainEqual({
        type: "add_external_torrent",
        activationId: "00010203-0405-4607-8809-0a0b0c0d0e0f",
        storageRoot: "root_1",
        startContent: true,
      }),
    );
    dialog = await screen.findByRole("dialog", {
      name: "Add torrent",
    });
    expect(
      within(dialog).getByText(/external \.torrent file requested this add/i),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(external.getSnapshot().pending).toEqual([]));
    expect(
      application.commands.filter(
        (command) => command.type === "add_external_torrent",
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(application.commands)).not.toContain("magnet:?");
    expect(JSON.stringify(application.commands)).not.toContain(".torrent");
  });

  it("uses the default root for external intake and advances after a terminal failure", async () => {
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [downloadRoot("root_a", "Downloads")],
        defaultRoot: "root_a",
        showAddOptions: false,
      }),
    });
    application.rejectNextExternal = true;
    const external = new RecordingExternalIntake([
      externalActivation(
        "00010203-0405-4607-8809-0a0b0c0d0e0f",
        "torrent_file",
      ),
      externalActivation("11110203-0405-4607-8809-0a0b0c0d0e0f", "magnet"),
    ]);
    renderApplication(application, undefined, undefined, external);

    await waitFor(() =>
      expect(
        application.commands.filter(
          (command) => command.type === "add_external_torrent",
        ),
      ).toHaveLength(2),
    );
    expect(application.commands).toContainEqual({
      type: "add_external_torrent",
      activationId: "11110203-0405-4607-8809-0a0b0c0d0e0f",
      storageRoot: "root_a",
      startContent: true,
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(external.getSnapshot().pending).toEqual([]);
    });
  });

  it("keeps a retryable external activation available and reports queue notices", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [downloadRoot("root_a", "Downloads")],
        defaultRoot: "root_a",
        showAddOptions: false,
      }),
    });
    application.rejectNextExternal = true;
    const external = new RecordingExternalIntake(
      [externalActivation("00010203-0405-4607-8809-0a0b0c0d0e0f", "magnet")],
      { consumeOnSynchronize: false, rejectedCount: 1, overflowCount: 2 },
    );
    renderApplication(application, undefined, undefined, external);

    const dialog = await screen.findByRole("dialog", {
      name: "Add torrent",
    });
    expect(within(toast()).getByRole("alert")).toHaveTextContent(
      "external add rejected",
    );
    expect(external.getSnapshot()).toMatchObject({
      rejectedCount: 0,
      overflowCount: 0,
    });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(external.getSnapshot().pending).toEqual([]));
  });

  it("manages download roots and the add-options preference in Settings", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [
          downloadRoot("root_a", "Downloads"),
          downloadRoot("root_missing", "Missing Drive", "unavailable"),
        ],
        defaultRoot: "root_a",
        showAddOptions: true,
      }),
    });
    renderApplication(application);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("tab", { name: "Downloads" }));
    expect(within(dialog).getByText("Default download folder")).toBeVisible();
    expect(
      within(dialog).getByRole("checkbox", {
        name: /Show options when adding torrents/,
      }),
    ).toBeChecked();

    await user.click(within(dialog).getByRole("button", { name: "Repair…" }));
    await waitFor(() =>
      expect(application.commands).toContainEqual({
        type: "choose_download_root",
        repairRoot: "root_missing",
      }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Make default" }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: /Show options when adding torrents/,
      }),
    );
    await waitFor(() =>
      expect(application.commands).toContainEqual({
        type: "set_show_add_options",
        show: false,
      }),
    );
    expect(within(dialog).getByText(/Existing torrents stay where they are/i)).toBeVisible();
  });

  it("uses only the current Android root and retains older roots in Settings", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [
          downloadRoot("root_a", "Current Downloads", "available", null),
          downloadRoot("root_b", "Earlier Downloads"),
        ],
        defaultRoot: "root_a",
        showAddOptions: true,
      }),
    });
    renderApplication(
      application,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
    const magnet =
      "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213";

    await user.type(
      screen.getByRole("textbox", { name: "Magnet link or torrent URL" }),
      magnet,
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(application.commands).toContainEqual({
        type: "add_magnet",
        magnet,
        storageRoot: "root_a",
        startContent: true,
      }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Add torrent" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("tab", { name: "Downloads" }));
    expect(within(dialog).getByText("Current download folder")).toBeVisible();
    expect(within(dialog).getByText("Managed by Android")).toBeVisible();
    expect(
      within(dialog).queryByText("Location is unavailable"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("checkbox", {
        name: /Show options when adding torrents/,
      }),
    ).not.toBeInTheDocument();
    const current = within(dialog)
      .getByText("Current Downloads")
      .closest("article");
    const earlier = within(dialog)
      .getByText("Earlier Downloads")
      .closest("article");
    expect(current).not.toBeNull();
    expect(earlier).not.toBeNull();
    expect(within(current!).queryByRole("button", { name: "Remove" })).toBeNull();
    expect(
      within(earlier!).getByRole("button", { name: "Make current" }),
    ).toBeEnabled();
    expect(
      within(earlier!).getByRole("button", { name: "Remove" }),
    ).toBeEnabled();

    await user.click(
      within(earlier!).getByRole("button", { name: "Make current" }),
    );
    await waitFor(() =>
      expect(application.commands).toContainEqual({
        type: "set_default_download_root",
        rootId: "root_b",
      }),
    );
  });

  it("explains Crostini storage performance and ChromeOS sharing in Add and Settings", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [
          downloadRoot(
            "root_linux",
            "Downloads",
            "available",
            "/home/test/Downloads",
          ),
          downloadRoot(
            "root_chromeos",
            "ChromeOS Downloads",
            "available",
            "/mnt/chromeos/MyFiles/Downloads",
          ),
        ],
        defaultRoot: "root_linux",
        showAddOptions: true,
      }),
    });
    renderApplication(
      application,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "crostini",
    );

    await user.click(screen.getByRole("button", { name: "Settings" }));
    let dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("tab", { name: "Downloads" }));
    const settingsHelp = within(dialog).getByLabelText(
      "Chromebook storage guidance",
    );
    expect(settingsHelp).toHaveTextContent(/Linux files.*Downloads/);
    expect(
      within(dialog).getByText("Linux Downloads — faster (recommended)"),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        "ChromeOS shared folder — convenient, but slower",
      ),
    ).toBeVisible();
    await user.click(
      within(settingsHelp).getByText("How to use a folder from My files"),
    );
    expect(within(settingsHelp).getByText("Share with Linux")).toBeVisible();
    expect(
      within(settingsHelp).getByText(/select the folder you just shared/i),
    ).toBeVisible();
    expect(within(settingsHelp).queryByText(/Ctrl\+?L/i)).not.toBeInTheDocument();
    expect(
      within(settingsHelp).queryByText(/\/mnt\/chromeos/i),
    ).not.toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Close settings" }),
    );
    const magnet =
      "magnet:?xt=urn:btih:211102030405060708090a0b0c0d0e0f10111213";
    await user.type(
      screen.getByRole("textbox", { name: "Magnet link or torrent URL" }),
      magnet,
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    dialog = screen.getByRole("dialog", { name: "Add torrent" });
    expect(
      within(dialog).getByLabelText("Chromebook storage guidance"),
    ).toBeVisible();
    expect(
      within(dialog).getByText("Linux Downloads — faster (recommended)"),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        "ChromeOS shared folder — convenient, but slower",
      ),
    ).toBeVisible();
  });

  it("omits Crostini storage guidance from another hosted product", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [
          downloadRoot(
            "root_linux",
            "Downloads",
            "available",
            "/home/test/Downloads",
          ),
        ],
        defaultRoot: "root_linux",
        showAddOptions: true,
      }),
    });
    renderApplication(
      application,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "basic",
      "headless",
    );
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("tab", { name: "Downloads" }));
    expect(
      within(dialog).queryByLabelText("Chromebook storage guidance"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("Linux Downloads — faster (recommended)"),
    ).not.toBeInTheDocument();
  });

  it("does not label incoming Off as failed when IPv6 is unavailable", async () => {
    const user = userEvent.setup();
    const settings = clientSettingsRuntimeFixture();
    const application = new RecordingLiveApplication({ type: "snapshot", snapshot: { ...liveSnapshot({ roots: [], defaultRoot: null, showAddOptions: true }), clientSettings: { ...settings, transport_application: { type: "degraded", reason: "transport_bind_failed", detail: "IPv6 route unavailable" } } } });
    renderApplication(application);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("tab", { name: "Connection & seeding" }));
    const incoming = within(dialog).getByRole("checkbox", { name: /Accept incoming connections/ });
    expect(incoming).not.toBeChecked();
    expect(incoming).not.toHaveAccessibleName(/Couldn't apply/);
  });

  it("keeps incoming off and explains forwarding before saving an enable", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({ type: "snapshot", snapshot: { ...liveSnapshot({ roots: [], defaultRoot: null, showAddOptions: true }), clientSettings: clientSettingsRuntimeFixture() } });
    renderApplication(application);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("tab", { name: "Connection & seeding" }));
    const incoming = within(dialog).getByRole("checkbox", { name: /Accept incoming connections/ });
    const forwarding = within(dialog).getByRole("checkbox", { name: /Automatic port forwarding/ });
    expect(incoming).not.toBeChecked(); expect(forwarding).toBeDisabled();
    expect(within(dialog).queryByRole("radio", { name: "Fixed" })).toBeNull();
    await user.click(incoming); await user.click(forwarding);
    expect(within(dialog).getByText(/Your operating system may ask for network access/)).toBeVisible();
    expect(forwarding).not.toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(forwarding).not.toBeChecked();
    await user.click(forwarding);
    await user.click(within(dialog).getByRole("button", { name: /^Enable$/ }));
    expect(forwarding).toBeChecked();
    expect(application.commands.filter(c => c.type === "update_client_settings")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(application.commands).toContainEqual(expect.objectContaining({ type: "update_client_settings", patch: { listener: { type: "automatic_local_network" }, port_mapping: "upnp" } })));
  });

  it("turns off incoming and forwarding in one settings patch", async () => {
    const user = userEvent.setup();
    const fixture = clientSettingsRuntimeFixture();
    const application = new RecordingLiveApplication({ type: "snapshot", snapshot: { ...liveSnapshot({ roots: [], defaultRoot: null, showAddOptions: true }), clientSettings: { ...fixture, configured: { ...fixture.configured, listener: { type: "automatic_local_network" }, port_mapping: "upnp" } } } });
    renderApplication(application);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("tab", { name: "Connection & seeding" }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Accept incoming connections/ }));
    expect(within(dialog).getByRole("checkbox", { name: /Automatic port forwarding/ })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(application.commands).toContainEqual(expect.objectContaining({ type: "update_client_settings", patch: { listener: { type: "disabled" }, port_mapping: "disabled" } })));
  });

  it("validates and atomically saves connection and seeding settings", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...liveSnapshot({ roots: [], defaultRoot: null, showAddOptions: true }),
        clientSettings: {
          ...clientSettingsRuntimeFixture(),
          configured: {
            ...clientSettingsRuntimeFixture().configured,
            tracker_https_server_authentication: "disabled",
          },
          effective_tracker_https_server_authentication: "disabled",
          effective_peer_connection_limit: 120,
        },
      },
    });
    renderApplication(application);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });

    expect(
      within(dialog).getByRole("tab", { name: "Appearance" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("tab", { name: "Downloads" }),
    ).toBeVisible();
    const connectionTab = within(dialog).getByRole("tab", {
      name: "Connection & seeding",
    });
    expect(connectionTab).toBeVisible();
    await user.click(connectionTab);
    for (const name of [
      "Speed limits",
      "Queue",
      "Stop seeding",
      "Seeding priority",
      "Connections",
      "Network",
    ]) {
      expect(within(dialog).getByRole("heading", { name })).toBeVisible();
    }
    expect(within(dialog).queryByText(/Effective/)).toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: /Accept incoming connections/ })).not.toBeChecked();
    await user.click(within(dialog).getByRole("checkbox", { name: /Accept incoming connections/ }));
    expect(
      within(dialog).getByRole("radio", { name: "Automatic" }),
    ).toBeChecked();
    expect(within(dialog).queryByRole("radio", { name: /Off/ })).toBeNull();
    expect(within(dialog).queryByText(/device-only/i)).toBeNull();
    expect(
      within(dialog).queryByRole("spinbutton", {
        name: "Preferred automatic port",
      }),
    ).toBeNull();
    expect(
      within(dialog).getByText("Limited to 120 on this device"),
    ).toBeVisible();

    await user.click(
      within(dialog).getByRole("radio", { name: "Fixed" }),
    );
    const port = within(dialog).getByRole("spinbutton", { name: "Port number" });
    expect(port).toHaveValue(null);
    const save = within(dialog).getByRole("button", { name: "Save settings" });
    expect(save).toBeDisabled();

    await user.type(port, "1023");
    expect(
      within(dialog).getByText(/whole number from 1024 to 65535/i),
    ).toBeVisible();
    expect(save).toBeDisabled();
    await user.clear(port);
    await user.type(port, "1024");
    const peers = within(dialog).getByRole("spinbutton", {
      name: "Max peer connections",
    });
    await user.clear(peers);
    await user.type(peers, "2000");
    const slots = within(dialog).getByRole("spinbutton", {
      name: "Upload slots",
    });
    await user.clear(slots);
    await user.type(slots, "0");
    const activeDownloads = within(dialog).getByRole("spinbutton", {
      name: "Max active downloads",
    });
    await user.clear(activeDownloads);
    await user.type(activeDownloads, "4");
    expect(
      within(dialog).getByText(/Reaching a goal doesn't stop seeding/i),
    ).toBeVisible();
    const activeSeeds = within(dialog).getByRole("spinbutton", {
      name: "Max active seeds",
    });
    expect(activeSeeds).toHaveValue(5);
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: /No limit on active seeds/,
      }),
    );
    expect(activeSeeds).toBeDisabled();
    const shareRatio = within(dialog).getByRole("spinbutton", {
      name: "Share ratio",
    });
    await user.clear(shareRatio);
    await user.type(shareRatio, "250");
    const finishedDownloadRatio = within(dialog).getByRole("spinbutton", {
      name: "Seeding time vs. download time",
    });
    await user.clear(finishedDownloadRatio);
    await user.type(finishedDownloadRatio, "800");
    const priority = within(dialog).getByRole("region", { name: "Seeding priority" });
    const finishedTime = within(priority).getByRole("combobox", {
      name: "Seeding time",
    });
    expect(finishedTime).toHaveValue("86400");
    await user.selectOptions(finishedTime, "Custom…");
    const finishedTimeValue = within(priority).getByRole("spinbutton", {
      name: "Seeding time, custom time",
    });
    expect(finishedTimeValue).toHaveValue(1);
    await user.selectOptions(
      within(priority).getByRole("combobox", { name: "Seeding time, unit" }),
      "hours",
    );
    await user.clear(finishedTimeValue);
    await user.type(finishedTimeValue, "25");
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Upload" }),
      "Custom…",
    );
    const uploadRate = within(dialog).getByRole("spinbutton", {
      name: "Upload, custom speed in KB per second",
    });
    await user.clear(uploadRate);
    await user.type(uploadRate, "64");
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Download" }),
      "Custom…",
    );
    const downloadRate = within(dialog).getByRole("spinbutton", {
      name: "Download, custom speed in KB per second",
    });
    await user.clear(downloadRate);
    await user.type(downloadRate, "256");
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: /Automatic port forwarding/,
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: /^Enable$/ }));
    await user.click(
      within(dialog).getByRole("checkbox", { name: /^IPv6/ }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: /^DHT/ }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: /^Peer exchange \(PEX\)/ }),
    );
    expect(
      within(dialog).getByText("Peers you upload to at the same time"),
    ).toBeVisible();
    expect(save).toBeEnabled();

    await user.click(within(dialog).getByRole("radio", { name: /^Prefer/ }));

    await user.click(save);
    await waitFor(() =>
      expect(application.commands.at(-1)).toEqual({
        type: "update_client_settings",
        patch: {
          listener: { type: "fixed_local_network", port: 1024 },
          port_mapping: "upnp",
          peer_connection_limit: 2000,
          upload_slots: 0,
          active_downloads: 4,
          active_seeds: { type: "unlimited" },
          share_ratio_limit_percent: 250,
          finished_download_ratio_limit_percent: 800,
          finished_time_limit_seconds: 90_000,
          upload_rate_limit: {
            type: "limited",
            bytes_per_second: 65_536,
          },
          download_rate_limit: {
            type: "limited",
            bytes_per_second: 262_144,
          },
          encryption: "prefer",
          ipv6_enabled: false,
          dht_enabled: false,
          peer_exchange_enabled: false,
        },
      }),
    );
    expect(
      within(dialog).getByRole("checkbox", { name: /Accept incoming connections/ }),
    ).toBeVisible();
    expect(within(dialog).queryByText(/restart/i)).not.toBeInTheDocument();

    await user.clear(peers);
    await user.type(peers, "1999");
    for (let update = 0; update < 25; update += 1) {
      application.emitClientSettings({
        ...clientSettingsRuntimeFixture(),
        configured: {
          ...clientSettingsRuntimeFixture().configured,
          listener: { type: "fixed_local_network", port: 1024 },
          preferred_listen_port: 6881,
          port_mapping: "upnp",
          peer_connection_limit: 2000,
          upload_slots: 0,
          active_downloads: 4,
          active_seeds: { type: "unlimited" },
          share_ratio_limit_percent: 250,
          finished_download_ratio_limit_percent: 800,
          finished_time_limit_seconds: 90_000,
          encryption: "prefer",
          ipv6_enabled: false,
          tracker_https_server_authentication: "system_trust",
        },
        effective_peer_connection_limit: 120 + update,
        effective_encryption: "prefer",
        effective_tracker_https_server_authentication: "system_trust",
      });
    }
    expect(peers).toHaveValue(1999);
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel changes" }),
    );
    expect(peers).toHaveValue(2000);

    application.rejectNextClientSettings = true;
    await user.clear(slots);
    await user.type(slots, "1");
    await user.click(save);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "settings save rejected",
    );
    expect(slots).toHaveValue(1);
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() =>
      expect(
        application.commands.filter(
          (command) => command.type === "update_client_settings",
        ),
      ).toHaveLength(3),
    );
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a recoverable listener bind failure without hiding settings", async () => {
    const user = userEvent.setup();
    const active = {
      listener: { type: "fixed_loopback" as const, port: 51_413 },
      preferred_listen_port: 6_881,
      port_mapping: "disabled" as const,
      peer_connection_limit: 200,
      upload_slots: 8,
      active_downloads: 3,
      active_seeds: { type: "limited" as const, torrents: 5 },
      share_ratio_limit_percent: 200,
      finished_download_ratio_limit_percent: 700,
      finished_time_limit_seconds: 86_400,
      seed_stop_ratio_percent: { type: "off" as const },
      seed_stop_time_seconds: { type: "off" as const },
      upload_rate_limit: { type: "unlimited" as const },
      download_rate_limit: { type: "unlimited" as const },
      encryption: "allow" as const,
      ipv6_enabled: true,
      dht_enabled: true,
      peer_exchange_enabled: true,
      tracker_https_server_authentication: "system_trust" as const,
    };
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...liveSnapshot({ roots: [], defaultRoot: null, showAddOptions: true }),
        clientSettings: {
          configured: {
            ...active,
            listener: { type: "automatic_local_network" },
          },
          application_network: {
            requested_generation: "1",
            requested_prerequisite: "allowed",
            effective_generation: "1",
            effective_prerequisite: "allowed",
            state: "allowed",
            degraded_detail: null,
          },
          effective_listener: null,
          effective_port_mapping: "disabled",
          effective_peer_connection_limit: 200,
          effective_upload_slots: 8,
          effective_active_downloads: 3,
          effective_active_seeds: { type: "limited", torrents: 5 },
          effective_upload_rate_limit: { type: "unlimited" },
          effective_download_rate_limit: { type: "unlimited" },
          active_download_count: 0,
          checking_count: 0,
          active_seed_count: 0,
          inactive_seed_count: 0,
          effective_encryption: "allow",
          effective_ipv6_enabled: true,
          effective_dht_enabled: true,
          effective_peer_exchange_enabled: true,
          effective_tracker_https_server_authentication: "system_trust",
          transport_application: {
            type: "degraded",
            reason: "transport_bind_failed",
            detail: "port 51413 is already in use.",
          },
          port_mapping_application: { type: "applied" },
          peer_connections_application: { type: "applied" },
          upload_slots_application: { type: "applied" },
          bandwidth_application: { type: "applied" },
          bandwidth: {
            upload: {
              registered_torrents: 0,
              active_waiters: 0,
              queued_requested_bytes: "0",
              granted_bytes: "0",
              returned_bytes: "0",
              cancelled_requests: "0",
              throttle_wait_micros: "0",
              throttle_wait_high_water_micros: "0",
              current_burst_credit_bytes: "0",
            },
            download: {
              registered_torrents: 0,
              active_waiters: 0,
              queued_requested_bytes: "0",
              granted_bytes: "0",
              returned_bytes: "0",
              cancelled_requests: "0",
              throttle_wait_micros: "0",
              throttle_wait_high_water_micros: "0",
              current_burst_credit_bytes: "0",
            },
          },
          encryption_application: { type: "applied" },
          ipv6_application: { type: "applied" },
          dht_application: { type: "applied" },
          peer_exchange_application: { type: "applied" },
          tracker_https_authentication_application: { type: "applied" },
          listener_status: {
            type: "bind_failed",
            reason: "address_in_use",
            detail: "port 51413 is already in use.",
          },
          session_udp_status: {
            type: "bound",
            address: "127.0.0.1",
            port: 51_414,
            coordinated_with_tcp: false,
          },
          port_mapping_status: { type: "disabled" },
          udp_port_mapping_status: { type: "disabled" },
          ipv6_pinhole_status: { type: "disabled" },
          advertised_peer_endpoint: {
            type: "outbound_only",
            generation: "1",
            reason: "listener_bind_failed",
          },
          transport_families: [],
        },
      },
    });
    renderApplication(application);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(
      within(dialog).getByRole("tab", { name: "Connection & seeding" }),
    );

    expect(
      within(dialog).getByText("Port already in use"),
    ).toBeVisible();
    expect(within(dialog).queryByText(/51413/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/restart/i)).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", { name: "Automatic" }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("button", { name: "Save settings" }),
    ).toBeDisabled();
  });

  it("shows configured intent and an uncertain effective mapping without restart copy", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...liveSnapshot({ roots: [], defaultRoot: null, showAddOptions: true }),
        clientSettings: {
          ...clientSettingsRuntimeFixture(),
          configured: {
            ...clientSettingsRuntimeFixture().configured,
            listener: { type: "automatic_local_network" },
            port_mapping: "disabled",
          },
          effective_listener: {
            listener: { type: "automatic_local_network" },
            preferred_listen_port: 6_881,
          },
          effective_port_mapping: "upnp",
          port_mapping_application: {
            type: "degraded",
            reason: "port_mapping_cleanup_failed",
            detail: "delete verification failed; the prior lease may remain",
          },
          listener_status: {
            type: "listening",
            address: "192.168.50.12",
            port: 41_234,
          },
          session_udp_status: {
            type: "bound",
            address: "192.168.50.12",
            port: 41_234,
            coordinated_with_tcp: true,
          },
          port_mapping_status: {
            type: "cleanup_failed",
            external_address: "203.0.113.10",
            external_port: 48_001,
            remaining_lease_seconds: 42,
            detail: "delete verification failed",
          },
          ipv6_pinhole_status: {
            type: "pinholed",
            internal_address: "2001:4860:4860::8888",
            internal_port: 41_234,
            lease_seconds: 3_600,
          },
          advertised_peer_endpoint: {
            type: "local",
            generation: "9",
            address: "192.168.50.12",
            port: 41_234,
            scope: "local_network",
            incoming_observed: false,
          },
        },
      },
    });
    renderApplication(application);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(
      within(dialog).getByRole("tab", { name: "Connection & seeding" }),
    );

    const upnp = within(dialog).getByRole("checkbox", {
      name: /Automatic port forwarding/,
    });
    expect(upnp).not.toBeChecked();
    expect(upnp).toHaveAccessibleName(/The router may keep port 48001 open/);
    expect(
      within(dialog).getByText("Accept incoming connections").parentElement,
    ).toHaveTextContent("Port 41234");

    await user.click(within(dialog).getByText("Network details"));
    for (const line of [
      "UDP: port 41234",
      "If you declined firewall access, review your operating system's firewall settings. Downloads still work with incoming connections off.",
      "Router forwarding (TCP): the router may keep port 48001 open for up to 42s",
      "IPv6 router firewall: port 41234 open, renewed automatically",
      "Peers are told to use port 41234. It isn't confirmed reachable from the internet.",
    ]) {
      expect(within(dialog).getByText(line)).toBeVisible();
    }
    expect(within(dialog).queryByText(/delete verification failed/)).toBeNull();
    expect(within(dialog).queryByText(/Effective/)).toBeNull();
    expect(within(dialog).queryByText(/restart/i)).not.toBeInTheDocument();
  });

  it("copies selected torrents' source-aware magnets with truthful feedback", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn<(value: string) => Promise<void>>();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const snapshot = {
      ...buildScenarioSnapshot("healthy-download", 42_000, false, 1),
      demo: null,
    };
    const current = snapshot.torrents[snapshot.torrentOrder[0]!]!;
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot,
    });
    const exactMagnet =
      `magnet:?dn=Original%20Name&xt=urn:btih:${current.infoHash}` +
      "&tr=udp%3A%2F%2Ftracker.example%3A6969%2Fannounce";
    application.magnetExports.set(current.id, {
      magnet: exactMagnet,
      source: "verbatim",
      omittedTrackerCount: 0,
    });
    renderApplication(application);

    const more = screen.getByRole("button", { name: "More" });
    await user.click(more);
    const copy = screen.getByRole("menuitem", { name: "Copy magnet link" });
    expect(copy).not.toHaveAttribute("aria-disabled");
    await user.click(copy);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(exactMagnet));
    expect(toast()).toHaveTextContent("Magnet link copied");
    expect(
      screen.queryByRole("menu", { name: "More" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(more).toHaveFocus());

    application.rejectNextTorrentId = current.id;
    await user.click(more);
    await user.click(
      screen.getByRole("menuitem", { name: "Copy magnet link" }),
    );
    expect(
      within(await findToast("Could not copy magnet links: rejected for test")).getByRole("alert"),
    ).toBeVisible();
    expect(writeText).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(more).toHaveFocus());

    writeText.mockRejectedValueOnce(new Error("permission denied"));
    await user.click(more);
    await user.click(
      screen.getByRole("menuitem", { name: "Copy magnet link" }),
    );
    expect(
      within(await findToast("Could not copy magnet links: permission denied")).getByRole("alert"),
    ).toBeVisible();
    await waitFor(() => expect(more).toHaveFocus());

    await user.click(
      screen.getByRole("checkbox", { name: "Select Sintel 4K open movie" }),
    );
    const sintel = snapshot.torrentOrder
      .map((id) => snapshot.torrents[id]!)
      .find((torrent) => torrent.name === "Sintel 4K open movie")!;
    const synthesizedSintel =
      `magnet:?xt=urn:btih:${sintel.infoHash}` +
      "&dn=Sintel%204K%20open%20movie" +
      "&tr=https%3A%2F%2Fbackup.example%2Fannounce";
    application.magnetExports.set(sintel.id, {
      magnet: synthesizedSintel,
      source: "synthesized",
      omittedTrackerCount: 1,
    });
    await user.click(more);
    const copyMultiple = screen.getByRole("menuitem", {
      name: "Copy magnet links",
    });
    expect(copyMultiple).not.toHaveAttribute("aria-disabled");
    await user.click(copyMultiple);
    const selectedMagnets = [exactMagnet, synthesizedSintel].join("\n");
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(selectedMagnets),
    );
    expect(toast()).toHaveTextContent(
      "2 magnet links copied; 1 tracker omitted to keep them usable",
    );

    fireEvent.click(screen.getByRole("grid", { name: "Torrents" }));
    await user.click(more);
    expect(
      screen.getByRole("menuitem", { name: "Copy magnet links" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("dispatches an exact test magnet through the keyboard submenu", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [downloadRoot("root_a", "Downloads")],
        defaultRoot: "root_a",
        showAddOptions: false,
      }),
    });
    renderApplication(application);
    const draft = screen.getByRole("textbox", {
      name: "Magnet link or torrent URL",
    });
    await user.type(draft, "unfinished draft");

    const more = screen.getByRole("button", { name: "More" });
    more.focus();
    await user.keyboard("{ArrowDown}");
    const addTestTorrent = screen.getByRole("menuitem", {
      name: "Add test torrent",
    });
    expect(
      screen.getByRole("menuitem", { name: "Copy magnet links" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(addTestTorrent).toHaveAttribute("data-focused");

    await user.keyboard("{ArrowRight}");
    const submenu = screen.getByRole("menu", { name: "Add test torrent" });
    const addAll = within(submenu).getByRole("menuitem", {
      name: "Add all sample torrents",
    });
    expect(addAll).toHaveAttribute("data-focused");
    await user.keyboard("{End}");
    const wired = within(submenu).getByRole("menuitem", { name: "WIRED CD" });
    expect(wired).toHaveAttribute("data-focused");
    await user.keyboard("{Enter}");

    const wiredSource = WEBTORRENT_TEST_TORRENTS.at(-1)!;
    await waitFor(() => {
      expect(application.commands).toEqual([
        {
          type: "add_magnet",
          magnet: wiredSource.magnet,
          storageRoot: "root_a",
          startContent: true,
        },
      ]);
    });
    expect(draft).toHaveValue("unfinished draft");
    expect(screen.queryByRole("region", { name: "Notification" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menu", { name: "More" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(more).toHaveFocus());

    await user.click(more);
    await user.click(
      screen.getByRole("menuitem", { name: "Add test torrent" }),
    );
    const clickedSubmenu = screen.getByRole("menu", {
      name: "Add test torrent",
    });
    expect(clickedSubmenu).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: "Add all sample torrents" }),
      ).toHaveFocus(),
    );
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("menu", { name: "Add test torrent" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Add test torrent" }),
    ).toHaveAttribute("data-focused");
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("menu", { name: "More" }),
    ).not.toBeInTheDocument();
    expect(more).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menu", { name: "More" })).toBeVisible();
    await user.tab();
    expect(
      screen.queryByRole("menu", { name: "More" }),
    ).not.toBeInTheDocument();
  });

  it("adds every sample in catalog order and reports duplicates and failures", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [downloadRoot("root_a", "Downloads")],
        defaultRoot: "root_a",
        showAddOptions: false,
      }),
    });
    const dispatch = application.dispatch.bind(application);
    let releaseFirst!: () => void;
    const firstAdd = new Promise<void>((resolve) => { releaseFirst = resolve; });
    vi.spyOn(application, "dispatch").mockImplementation(async (command) => {
      const result = await dispatch(command);
      if (command.type !== "add_magnet") return result;
      if (command.magnet === WEBTORRENT_TEST_TORRENTS[0]!.magnet) {
        await firstAdd;
      }
      if (command.magnet === WEBTORRENT_TEST_TORRENTS[1]!.magnet) {
        return {
          accepted: true,
          message: "Already in your session",
          addDisposition: { type: "already_present" },
        };
      }
      if (command.magnet === WEBTORRENT_TEST_TORRENTS[2]!.magnet) {
        return { accepted: false, message: "tracker unavailable" };
      }
      return result;
    });
    renderApplication(application);
    const draft = screen.getByRole("textbox", {
      name: "Magnet link or torrent URL",
    });
    await user.type(draft, "unfinished draft");
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Add test torrent" }));
    await user.click(screen.getByRole("menuitem", {
      name: "Add all sample torrents",
    }));

    await waitFor(() => expect(application.commands).toHaveLength(1));
    expect(screen.getByRole("button", { name: "More" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(draft).toHaveValue("unfinished draft");
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    expect(screen.getByRole("button", { name: "More" })).toBeDisabled();
    releaseFirst();
    await waitFor(() => expect(application.commands).toHaveLength(5));
    expect(application.commands).toEqual(
      WEBTORRENT_TEST_TORRENTS.map((torrent) => ({
        type: "add_magnet",
        magnet: torrent.magnet,
        storageRoot: "root_a",
        startContent: true,
      })),
    );
    expect(within(toast()).getByRole("alert")).toHaveTextContent(
      "Sample torrents: 3 added, 1 already present, 1 failed. Sintel: tracker unavailable",
    );
  });

  it("applies one options choice to all samples and cancels before submission", async () => {
    const user = userEvent.setup();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: liveSnapshot({
        roots: [
          downloadRoot("root_a", "Downloads"),
          downloadRoot("root_b", "Other folder"),
        ],
        defaultRoot: "root_a",
        showAddOptions: true,
      }),
    });
    renderApplication(application);
    const openBatch = async () => {
      await user.click(screen.getByRole("button", { name: "More" }));
      await user.click(screen.getByRole("menuitem", { name: "Add test torrent" }));
      await user.click(screen.getByRole("menuitem", {
        name: "Add all sample torrents",
      }));
      return screen.getByRole("dialog", { name: "Add torrent" });
    };

    let dialog = await openBatch();
    expect(dialog).not.toHaveTextContent(/sample torrents/i);
    expect(
      within(dialog).getByRole("button", { name: "Choose another folder…" }),
    ).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(application.commands).toEqual([]);

    dialog = await openBatch();
    await user.click(within(dialog).getByRole("radio", { name: /Other folder/ }));
    await user.click(within(dialog).getByRole("checkbox", {
      name: "Start downloading right away",
    }));
    await user.click(within(dialog).getByRole("checkbox", {
      name: "Always use this folder",
    }));
    await user.click(within(dialog).getByRole("button", {
      name: "Add torrent",
    }));
    await waitFor(() => expect(application.commands).toHaveLength(7));
    expect(application.commands).toEqual([
      ...WEBTORRENT_TEST_TORRENTS.map((torrent) => ({
        type: "add_magnet",
        magnet: torrent.magnet,
        storageRoot: "root_b",
        startContent: false,
      })),
      { type: "set_default_download_root", rootId: "root_b" },
      { type: "set_show_add_options", show: false },
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sample torrents: 5 added, 0 already present, 0 failed.",
    );
  });
});

describe("rich share links", () => {
  const LAN_HINT = "192.168.1.20:6881";

  function clipboard() {
    const writeText = vi.fn<(value: string) => Promise<void>>();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    return writeText;
  }

  function rememberPeerHint(choice: "ask" | "include" | "omit") {
    globalThis.localStorage.setItem(
      "rstorrent.presentation.share",
      JSON.stringify({ version: 1, peerHint: choice }),
    );
  }

  function rememberedPeerHint(): unknown {
    const stored = globalThis.localStorage.getItem("rstorrent.presentation.share");
    return stored === null ? null : (JSON.parse(stored) as { peerHint: unknown }).peerHint;
  }

  /** Answers exports like the engine: `xl`, `so` and a LAN hint on request. */
  function shareExports(
    application: RecordingLiveApplication,
    torrents: Readonly<Record<string, TorrentRow>>,
  ) {
    application.exportHandler = (command) => {
      const torrent = torrents[command.torrentId]!;
      let magnet = `magnet:?xt=urn:btih:${torrent.infoHash}&dn=Name`;
      const options = command.options;
      if (options?.includeSize === true && torrent.sizeBytes !== null) {
        magnet += `&xl=${torrent.sizeBytes}`;
      }
      if (options?.fileIndices !== undefined) {
        magnet += `&so=${options.fileIndices.join(",")}`;
      }
      const hinted = options?.peerHint === true && torrent.privateTorrent !== true;
      if (hinted) magnet += `&x.pe=${LAN_HINT}`;
      return {
        accepted: true,
        magnetExport: {
          magnet,
          source: "verbatim",
          omittedTrackerCount: 0,
          ...(hinted
            ? { peerHints: [{ endpoint: LAN_HINT, scope: "local_network" as const }] }
            : {}),
        },
      };
    };
  }

  function exports(application: RecordingLiveApplication) {
    return application.commands.filter(
      (command) => command.type === "export_magnet",
    );
  }

  function seedingSnapshot(overrides: Partial<TorrentRow> = {}) {
    const snapshot = {
      ...buildScenarioSnapshot("healthy-download", 42_000, false, 1),
      demo: null,
    };
    const current = snapshot.torrents[snapshot.torrentOrder[0]!]!;
    return {
      snapshot: {
        ...snapshot,
        torrents: { ...snapshot.torrents, [current.id]: { ...current, ...overrides } },
      },
      current: { ...current, ...overrides },
    };
  }

  it("asks about the address on the first share-link copy and remembers it", async () => {
    const user = userEvent.setup();
    const writeText = clipboard();
    const { snapshot, current } = seedingSnapshot();
    const application = new RecordingLiveApplication({ type: "snapshot", snapshot });
    shareExports(application, snapshot.torrents);
    renderApplication(application);

    const more = screen.getByRole("button", { name: "More" });
    await user.click(more);
    await user.click(screen.getByRole("menuitem", { name: "Copy share link" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Let them connect to you directly?",
    });
    expect(dialog).toHaveAccessibleDescription(
      "Adding your address to the link lets the people you share it with reach you sooner. Anyone who has the link can see your IP address.",
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Don't include" })).toHaveFocus();
    await user.click(within(dialog).getByRole("checkbox", { name: "Remember my choice" }));
    await user.click(within(dialog).getByRole("button", { name: "Include my address" }));

    const link =
      `https://jstorrent.com/share/#xt=urn:btih:${current.infoHash}&dn=Name` +
      `&xl=${current.sizeBytes}&x.pe=${LAN_HINT}`;
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    expect(exports(application).at(-1)).toEqual({
      type: "export_magnet",
      torrentId: current.id,
      options: { includeSize: true, peerHint: true },
    });
    await findToast(
      "Share link copied with your local network address. Only people on your network can use it to reach you.",
    );
    expect(rememberedPeerHint()).toBe("include");
    await waitFor(() => expect(more).toHaveFocus());

    // The remembered choice copies at once.
    await user.click(more);
    await user.click(screen.getByRole("menuitem", { name: "Copy share link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writeText).toHaveBeenLastCalledWith(link);
  });

  it("leaves the address out once and asks again next time", async () => {
    const user = userEvent.setup();
    const writeText = clipboard();
    const { snapshot, current } = seedingSnapshot();
    const application = new RecordingLiveApplication({ type: "snapshot", snapshot });
    shareExports(application, snapshot.torrents);
    renderApplication(application);

    const more = screen.getByRole("button", { name: "More" });
    await user.click(more);
    await user.click(screen.getByRole("menuitem", { name: "Copy share link" }));
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "Let them connect to you directly?" }),
      ).getByRole("button", { name: "Don't include" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `https://jstorrent.com/share/#xt=urn:btih:${current.infoHash}&dn=Name&xl=${current.sizeBytes}`,
      ),
    );
    expect(exports(application).at(-1)).toEqual({
      type: "export_magnet",
      torrentId: current.id,
      options: { includeSize: true },
    });
    await findToast("Share link copied");
    expect(rememberedPeerHint()).toBeNull();

    await user.click(more);
    await user.click(screen.getByRole("menuitem", { name: "Copy share link" }));
    await screen.findByRole("dialog", { name: "Let them connect to you directly?" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writeText).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(more).toHaveFocus());
  });

  it("never asks or hints for a private torrent", async () => {
    const user = userEvent.setup();
    const writeText = clipboard();
    const { snapshot, current } = seedingSnapshot({ privateTorrent: true });
    const application = new RecordingLiveApplication({ type: "snapshot", snapshot });
    shareExports(application, snapshot.torrents);
    rememberPeerHint("include");
    renderApplication(application);

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Copy share link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(exports(application).at(-1)).toEqual({
      type: "export_magnet",
      torrentId: current.id,
      options: { includeSize: true },
    });
    await findToast(
      "Share link copied. This torrent is private, so the link only works for members of its tracker.",
    );
  });

  it("copies a plain share link from a host that rejects export options", async () => {
    const user = userEvent.setup();
    const writeText = clipboard();
    const { snapshot, current } = seedingSnapshot();
    const application = new RecordingLiveApplication({ type: "snapshot", snapshot });
    application.exportHandler = (command) =>
      command.options === undefined
        ? {
            accepted: true,
            magnetExport: {
              magnet: `magnet:?xt=urn:btih:${current.infoHash}`,
              source: "verbatim",
              omittedTrackerCount: 0,
            },
          }
        : { accepted: false, message: "unknown field options", code: "invalid_request" };
    rememberPeerHint("include");
    renderApplication(application);

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Copy share link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `https://jstorrent.com/share/#xt=urn:btih:${current.infoHash}`,
      ),
    );
    expect(exports(application)).toHaveLength(2);
    await findToast("Share link copied");
  });

  it("shares one file with its name and size, or several by index", async () => {
    const user = userEvent.setup();
    const writeText = clipboard();
    const snapshot = {
      ...buildScenarioSnapshot("file-progress", 24_000, false, 1),
      demo: null,
    };
    const application = new RecordingLiveApplication({ type: "snapshot", snapshot });
    shareExports(application, snapshot.torrents);
    rememberPeerHint("omit");
    const fileSet = snapshot.filesByTorrent[DEMO_PRIMARY_TORRENT_ID]!;
    const [first, second] = fileSet.order
      .map((id) => fileSet.rows[id])
      .filter((row) => row?.padding === false)
      .slice(0, 2) as [FileRow, FileRow];
    const torrent = snapshot.torrents[DEMO_PRIMARY_TORRENT_ID]!;
    renderApplication(application);

    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Files" }));
    const files = screen.getByRole("grid", { name: "Torrent files" });
    await user.click(within(files).getByText(first.name));
    await user.click(screen.getByRole("button", { name: "More file actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Share file" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `https://jstorrent.com/share/#xt=urn:btih:${torrent.infoHash}&dn=Name` +
          `&xl=${torrent.sizeBytes}&so=${first.index}` +
          `&jst.file=${encodeURIComponent(first.name)}&jst.size=${first.lengthBytes}`,
      ),
    );
    expect(exports(application).at(-1)).toEqual({
      type: "export_magnet",
      torrentId: DEMO_PRIMARY_TORRENT_ID,
      options: { includeSize: true, fileIndices: [first.index] },
    });
    await findToast("Share link copied");

    await user.click(
      within(files).getByRole("checkbox", { name: `Select ${second.name}` }),
    );
    await user.click(screen.getByRole("button", { name: "More file actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Share files" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    const indices = [first.index, second.index].sort((left, right) => left - right);
    expect(exports(application).at(-1)).toEqual({
      type: "export_magnet",
      torrentId: DEMO_PRIMARY_TORRENT_ID,
      options: { includeSize: true, fileIndices: indices },
    });
    expect(writeText.mock.lastCall?.[0]).not.toContain("jst.");
  });

  it("offers no address choice on a released host that cannot add one", async () => {
    const user = userEvent.setup();
    clipboard();
    const { snapshot } = seedingSnapshot();
    const application = new RecordingLiveApplication({
      type: "snapshot",
      snapshot: {
        ...snapshot,
        session: { ...snapshot.session, hostCapabilities: released031Hello.capabilities },
      },
    });
    shareExports(application, snapshot.torrents);
    rememberPeerHint("include");
    renderApplication(application);
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "General" }));
    await user.click(screen.getByRole("button", { name: "Share" }));
    const panel = await screen.findByRole("dialog", { name: "Share torrent" });
    await within(panel).findByRole("textbox", { name: "Share link" });
    expect(
      within(panel).queryByRole("checkbox", { name: "Include my IP address" }),
    ).not.toBeInTheDocument();
  });

  it("shows the Share panel's link, QR code and address choice", async () => {
    const user = userEvent.setup();
    const writeText = clipboard();
    const share = vi.fn<(data: ShareData) => Promise<void>>();
    share.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    try {
      const { snapshot, current } = seedingSnapshot();
      const application = new RecordingLiveApplication({ type: "snapshot", snapshot });
      shareExports(application, snapshot.torrents);
      rememberPeerHint("include");
      renderApplication(application);
      await user.click(
        within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
          "button", { name: "Torrents" },
        ),
      );
      await user.click(screen.getByRole("tab", { name: "General" }));
      await user.click(screen.getByRole("button", { name: "Share" }));
      const panel = await screen.findByRole("dialog", { name: "Share torrent" });
      const address = within(panel).getByRole("checkbox", { name: "Include my IP address" });
      expect(address).toBeChecked();
      const hinted =
        `https://jstorrent.com/share/#xt=urn:btih:${current.infoHash}&dn=Name` +
        `&xl=${current.sizeBytes}&x.pe=${LAN_HINT}`;
      const field = within(panel).getByRole("textbox", { name: "Share link" });
      await waitFor(() => expect(field).toHaveValue(hinted));
      expect(within(panel).getByRole("status")).toHaveTextContent(
        `Includes your local network address ${LAN_HINT}. Only people on your network can use it.`,
      );
      const qr = within(panel).getByRole("img", { name: "QR code for the share link" });
      expect(qr.querySelectorAll("rect").length).toBeGreaterThan(20);

      await user.click(within(panel).getByRole("button", { name: "Share…" }));
      expect(share).toHaveBeenCalledWith({ title: current.name, url: hinted });

      // Unchecking re-exports without the hint and keeps the remembered choice.
      await user.click(address);
      const plainLink =
        `https://jstorrent.com/share/#xt=urn:btih:${current.infoHash}&dn=Name&xl=${current.sizeBytes}`;
      await waitFor(() => expect(field).toHaveValue(plainLink));
      expect(exports(application).at(-1)).toEqual({
        type: "export_magnet",
        torrentId: current.id,
        options: { includeSize: true },
      });
      expect(within(panel).getByRole("status")).toHaveTextContent("");
      expect(rememberedPeerHint()).toBe("include");
      await user.click(within(panel).getByRole("button", { name: "Copy" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(plainLink));
      await user.click(within(panel).getByRole("button", { name: "Close" }));

      Reflect.deleteProperty(navigator, "share");
      await user.click(screen.getByRole("button", { name: "Share" }));
      const reopened = await screen.findByRole("dialog", { name: "Share torrent" });
      await waitFor(() =>
        expect(within(reopened).getByRole("button", { name: "Copy" })).toBeEnabled(),
      );
      expect(within(reopened).queryByRole("button", { name: "Share…" })).toBeNull();
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  it("labels a size from the link before metadata arrives", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...buildScenarioSnapshot("stalled-metadata", 4_000, false, 1),
      demo: null,
    };
    renderApplication(new RecordingLiveApplication({ type: "snapshot", snapshot }));
    expect(
      within(screen.getByRole("grid", { name: "Torrents" })).getByText("264 MB (link)"),
    ).toHaveAttribute(
      "title",
      "Size from the link. It's confirmed once the torrent's details arrive.",
    );
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "button", { name: "Torrents" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "General" }));
    expect(
      screen.getByText("Size", { selector: "dt" }).parentElement,
    ).toHaveTextContent("264 MB (from the link)");
  });
});

/** The visible toast; its text is also mirrored in a hidden live region. */
function toast(): HTMLElement {
  return screen.getByRole("region", { name: "Notification" });
}

async function findToast(text: string | RegExp): Promise<HTMLElement> {
  return waitFor(() => {
    const region = toast();
    expect(region).toHaveTextContent(text);
    return region;
  });
}

const DEFAULT_LIBRARY_REQUEST = libraryMediaRequest(DEFAULT_LIBRARY_BROWSE);

function renderScenario(
  scenarioId: ConstructorParameters<typeof DemoApplication>[0]["scenarioId"],
  elapsedMs: number,
  appearanceStorage?: AppearanceStorage | null,
  updater?: DesktopUpdater,
  notifications?: DesktopNotifications,
  power?: DesktopPower,
  mediaLibrary?: boolean,
) {
  return renderApplication(
    new DemoApplication({ scenarioId, elapsedMs, running: false, mediaLibrary: mediaLibrary ?? true }),
    appearanceStorage,
    updater,
    undefined,
    notifications,
    power,
  );
}

function renderApplication(
  application: InspectionApplication,
  appearanceStorage?: AppearanceStorage | null,
  updater?: DesktopUpdater,
  externalIntake?: DesktopExternalIntake,
  notifications?: DesktopNotifications,
  power?: DesktopPower,
  accessMode?: HostedAccessMode,
  hostedProduct?: HostedProduct,
  oneCurrentRoot?: boolean,
  remoteAccess?: DesktopRemoteAccess,
  localPlayback?: LocalVideoPlayback,
) {
  const controller = new InspectionController(application, appearanceStorage);
  controllers.push(controller);
  controller.start();
  return render(
    <InspectionProvider controller={controller}>
      <App
        updater={updater}
        externalIntake={externalIntake}
        notifications={notifications}
        power={power}
        accessMode={accessMode}
        hostedProduct={hostedProduct}
        oneCurrentRoot={oneCurrentRoot}
        remoteAccess={remoteAccess}
        localPlayback={localPlayback}
      />
    </InspectionProvider>,
  );
}

function directFileRemoteAccess(
  saveCompletedFile: DesktopRemoteAccess["saveCompletedFile"],
): DesktopRemoteAccess {
  const security = {
    enabled: true,
    username: "alice",
    route: "alice",
    relay_id: "relay",
    host_pin: "pin",
    authority: null,
    retained_history: null,
    live_circuits: [],
    direct_file: {
      compiled: true,
      enabled: true,
      state: "idle",
      active_circuit_id: null,
      bytes_sent: 0,
      candidate_class: null,
      active_tasks: 0,
      open_sockets: 0,
      active_requests: 0,
      queued_bytes: 0,
    },
  } as const;
  return {
    scope: "remote",
    state: async () => ({ configured: true, security }),
    enable: async () => security,
    rename: async () => undefined,
    revoke: async () => undefined,
    revokeAllOther: async () => 0,
    closeCircuit: async () => undefined,
    requirePasswordEverywhere: async () => 0,
    changePassphrase: async () => 0,
    disable: async () => ({ authority_file_removed: false, route_released: false }),
    recover: async () => security,
    clearHistory: async () => false,
    setDirectFileTransfersEnabled: async () => security,
    stopDirectFileTransfers: async () => security,
    directFileSupported: () => true,
    ...(saveCompletedFile === undefined ? {} : { saveCompletedFile }),
  };
}

function notificationSettingsController(): DesktopNotifications {
  let settings: DesktopNotificationSettings = {
    notify_download_complete: true,
    notify_needs_attention: true,
    notify_while_focused: true,
  };
  return {
    getSnapshot: () => settings,
    save: vi.fn(async (next) => {
      settings = next;
      return settings;
    }),
  };
}

function powerSettingsController(): DesktopPower {
  let settings: DesktopPowerSettings = {
    prevent_sleep_during_active_downloads: true,
  };
  return {
    getSnapshot: () => settings,
    save: vi.fn(async (next) => {
      settings = next;
      return settings;
    }),
  };
}

function updaterWithSnapshot(snapshot: DesktopUpdaterSnapshot): DesktopUpdater {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    check: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    dismiss: vi.fn(),
    close: vi.fn(),
  };
}

function torrentFileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    'input[type="file"][accept=".torrent,application/x-bittorrent"]',
  );
  if (input === null) throw new Error("torrent file input is missing");
  return input;
}

class RecordingLiveApplication implements InspectionApplication {
  readonly kind = "live" as const;
  readonly scenarios = [];
  readonly commands: InspectionCommand[] = [];
  readonly views: DesiredInspectionViews[] = [];
  readonly magnetExports = new Map<string, MagnetExport>();
  exportHandler:
    | ((
        command: Extract<InspectionCommand, { readonly type: "export_magnet" }>,
      ) => CommandResult)
    | undefined;
  rejectNextClientSettings = false;
  rejectNextExternal = false;
  rejectNextTorrentId: string | undefined;
  reconnectRequests = 0;
  private listener: ((update: InspectionUpdate) => void) | null = null;
  private storage: DownloadStorageSettings;
  private clientSettings: ClientSettingsRuntimeView;
  private torrents: Record<string, TorrentRow>;
  private durableRevision: bigint;
  private viewRevision: number;

  constructor(
    private readonly initialSnapshot?: InspectionUpdate & {
      readonly type: "snapshot";
    },
    private readonly rejectTorrentId?: string,
  ) {
    this.storage = initialSnapshot?.snapshot.storage ?? {
      roots: [],
      defaultRoot: null,
      showAddOptions: true,
    };
    this.clientSettings =
      initialSnapshot?.snapshot.clientSettings ??
      clientSettingsRuntimeFixture();
    this.torrents = { ...(initialSnapshot?.snapshot.torrents ?? {}) };
    this.durableRevision = BigInt(
      initialSnapshot?.snapshot.durableRevision ?? "0",
    );
    this.viewRevision = initialSnapshot?.snapshot.revision ?? 0;
  }

  subscribe(listener: (update: InspectionUpdate) => void): () => void {
    this.listener = listener;
    if (this.initialSnapshot !== undefined) listener(this.initialSnapshot);
    return () => {
      this.listener = null;
    };
  }

  async setViews(views: DesiredInspectionViews): Promise<void> {
    this.views.push(views);
  }

  emitClientSettings(settings: ClientSettingsRuntimeView): void {
    this.clientSettings = settings;
    this.listener?.({
      type: "patch",
      revision: ++this.viewRevision,
      durableRevision: this.durableRevision.toString(),
      clientSettings: settings,
    });
  }

  emitUpdate(update: InspectionUpdate): void {
    this.listener?.(update);
  }

  async dispatch(command: InspectionCommand): Promise<CommandResult> {
    this.commands.push(command);
    if (command.type === "add_external_torrent" && this.rejectNextExternal) {
      this.rejectNextExternal = false;
      return { accepted: false, message: "external add rejected" };
    }
    if (
      "torrentId" in command &&
      command.torrentId === this.rejectNextTorrentId
    ) {
      this.rejectNextTorrentId = undefined;
      throw new Error("rejected for test");
    }
    if ("torrentId" in command && command.torrentId === this.rejectTorrentId) {
      throw new Error("rejected for test");
    }
    if (command.type === "choose_download_root") {
      const root = downloadRoot(
        command.repairRoot ?? `root_${this.storage.roots.length + 1}`,
        command.repairRoot === undefined
          ? "Selected Downloads"
          : "Repaired Downloads",
      );
      this.storage = {
        ...this.storage,
        roots: [
          ...this.storage.roots.filter((candidate) => candidate.id !== root.id),
          root,
        ],
        defaultRoot: this.storage.defaultRoot ?? root.id,
      };
      this.emitStorage();
      return {
        accepted: true,
        message: "Download folder ready",
        storageRoot: root,
      };
    }
    if (command.type === "export_magnet") {
      if (this.exportHandler !== undefined) return this.exportHandler(command);
      const configured = this.magnetExports.get(command.torrentId);
      if (configured !== undefined) {
        return {
          accepted: true,
          message: "Magnet link ready",
          magnetExport: configured,
        };
      }
      const torrent =
        this.initialSnapshot?.snapshot.torrents[command.torrentId];
      if (torrent === undefined) {
        return { accepted: false, message: "Torrent is not present" };
      }
      return {
        accepted: true,
        message: "Magnet link ready",
        magnetExport: {
          magnet:
            `magnet:?xt=urn:btih:${torrent.infoHash}` +
            `&dn=${encodeURIComponent(torrent.name)}`,
          source: "synthesized",
          omittedTrackerCount: 0,
        },
      };
    }
    if (command.type === "set_default_download_root") {
      this.storage = { ...this.storage, defaultRoot: command.rootId };
      this.emitStorage();
      return { accepted: true, message: "Default changed" };
    }
    if (command.type === "set_show_add_options") {
      this.storage = { ...this.storage, showAddOptions: command.show };
      this.emitStorage();
      return { accepted: true, message: "Preference changed" };
    }
    if (command.type === "remove_download_root") {
      this.storage = {
        ...this.storage,
        roots: this.storage.roots.filter((root) => root.id !== command.rootId),
        defaultRoot:
          this.storage.defaultRoot === command.rootId
            ? null
            : this.storage.defaultRoot,
      };
      this.emitStorage();
      return { accepted: true, message: "Folder removed" };
    }
    if (command.type === "update_client_settings") {
      if (this.rejectNextClientSettings) {
        this.rejectNextClientSettings = false;
        return { accepted: false, message: "settings save rejected" };
      }
      const revision = this.nextDurableRevision();
      this.clientSettings = {
        ...this.clientSettings,
        configured: {
          ...this.clientSettings.configured,
          ...command.patch,
        },
        transport_application: { type: "applying" },
        port_mapping_application: { type: "applying" },
        peer_connections_application: { type: "applying" },
        upload_slots_application: { type: "applying" },
        tracker_https_authentication_application: { type: "applying" },
      };
      this.listener?.({
        type: "patch",
        revision: ++this.viewRevision,
        durableRevision: revision,
        clientSettings: this.clientSettings,
      });
      return {
        accepted: true,
        message: "Settings saved",
        requestId: `test-client-${revision}`,
        resultingRevision: revision,
      };
    }
    if (command.type === "update_torrent_settings") {
      const torrent = this.torrents[command.torrentId];
      if (torrent === undefined) {
        return { accepted: false, message: "Torrent is not present" };
      }
      const revision = this.nextDurableRevision();
      const stop = torrent.seedStop ?? {
        limits: {
          ratio_percent: { type: "use_global" as const },
          time_seconds: { type: "use_global" as const },
        },
        stopped: false,
      };
      const updated = {
        ...torrent,
        transferLimits: {
          upload:
            command.patch.upload_rate_limit ?? torrent.transferLimits.upload,
          download:
            command.patch.download_rate_limit ?? torrent.transferLimits.download,
        },
        seedStop: {
          ...stop,
          limits: {
            ratio_percent:
              command.patch.seed_stop_ratio_percent ?? stop.limits.ratio_percent,
            time_seconds:
              command.patch.seed_stop_time_seconds ?? stop.limits.time_seconds,
          },
        },
      };
      this.torrents = { ...this.torrents, [command.torrentId]: updated };
      this.listener?.({
        type: "patch",
        revision: ++this.viewRevision,
        durableRevision: revision,
        torrents: { upsert: [updated], removed: [] },
      });
      return {
        accepted: true,
        message: "Torrent settings saved",
        requestId: `test-torrent-${revision}`,
        resultingRevision: revision,
      };
    }
    return { accepted: true, message: "Torrent added" };
  }

  private nextDurableRevision(): string {
    this.durableRevision += 1n;
    return this.durableRevision.toString();
  }

  private emitStorage(): void {
    this.listener?.({
      type: "patch",
      revision: ++this.viewRevision,
      durableRevision: this.durableRevision.toString(),
      storage: this.storage,
    });
  }

  reconnectNow(): void {
    this.reconnectRequests += 1;
  }

  async close(): Promise<void> {}
}

class RecordingExternalIntake implements DesktopExternalIntake {
  private readonly listeners = new Set<() => void>();
  private generation = 1;
  private pending: DesktopExternalActivation[];
  private rejectedCount: number;
  private overflowCount: number;
  private snapshot: DesktopExternalIntakeSnapshot;
  private readonly consumeOnSynchronize: boolean;
  readonly close = vi.fn();

  constructor(
    pending: readonly DesktopExternalActivation[],
    options: {
      readonly consumeOnSynchronize?: boolean;
      readonly rejectedCount?: number;
      readonly overflowCount?: number;
    } = {},
  ) {
    this.pending = [...pending];
    this.consumeOnSynchronize = options.consumeOnSynchronize ?? true;
    this.rejectedCount = options.rejectedCount ?? 0;
    this.overflowCount = options.overflowCount ?? 0;
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot = (): DesktopExternalIntakeSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async synchronize(): Promise<void> {
    if (this.consumeOnSynchronize && this.pending.length > 0) {
      this.pending = this.pending.slice(1);
      this.generation += 1;
      this.snapshot = this.buildSnapshot();
      this.emit();
    }
  }

  async cancel(activationId: string): Promise<void> {
    if (this.pending[0]?.id !== activationId) {
      throw new Error("activation is no longer pending");
    }
    this.pending = this.pending.slice(1);
    this.generation += 1;
    this.snapshot = this.buildSnapshot();
    this.emit();
  }

  consumeNotices(): void {
    this.rejectedCount = 0;
    this.overflowCount = 0;
    this.snapshot = this.buildSnapshot();
    this.emit();
  }

  private buildSnapshot(): DesktopExternalIntakeSnapshot {
    return {
      generation: String(this.generation),
      pending: this.pending,
      rejectedCount: this.rejectedCount,
      overflowCount: this.overflowCount,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function externalActivation(
  id: string,
  kind: DesktopExternalActivation["kind"],
): DesktopExternalActivation {
  return { id, kind };
}

function downloadRoot(
  id: string,
  label: string,
  availability: "available" | "unavailable" = "available",
  path: string | null = `/Users/test/${label}`,
) {
  return {
    id,
    label,
    path,
    availability,
  } as const;
}

function liveSnapshot(storage: DownloadStorageSettings) {
  return {
    ...buildScenarioSnapshot("empty-library", 0, false, 1),
    demo: null,
    storage,
  };
}

function checkingSnapshot(phase: "hashing" | "reconciling_storage") {
  const snapshot = buildScenarioSnapshot("healthy-download", 42_000, false, 1);
  const torrent = snapshot.torrents[DEMO_PRIMARY_TORRENT_ID]!;
  return {
    ...snapshot,
    demo: null,
    torrents: {
      ...snapshot.torrents,
      [DEMO_PRIMARY_TORRENT_ID]: {
        ...torrent,
        status: "checking" as const,
        checking: {
          generation: "7",
          phase,
          piecesTotal: 8,
          piecesProcessed: 2,
          piecesMatched: 1,
          piecesAbsent: 1,
          piecesMismatched: 0,
          bytesHashed: "16384",
          activeHashJobs: phase === "hashing" ? 1 : 0,
          queuedHashJobs: phase === "hashing" ? 5 : 6,
          elapsedMs: 4_200,
          lastAdvanceAgeMs: 900,
          oldestActiveJobAgeMs: phase === "hashing" ? 1_200 : null,
        },
      },
    },
  };
}
