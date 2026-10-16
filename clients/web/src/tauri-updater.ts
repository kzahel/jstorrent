import { HostOwnedUpdater, reportUpdateActivity } from "./inspection/updater/host-owned";
import type { HostUpdateSnapshot } from "./api";
import { getBundleType } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { DesktopUpdaterController } from "./inspection/updater/controller";
import { createNativeUpdateCheckHandler } from "./inspection/updater/native-check";
import type {
  CheckReason,
  DesktopBundleType,
  DesktopReleaseInfo,
  DesktopUpdateBackend,
  DesktopUpdater,
  UpdateCandidate,
  UpdateChannel,
  UpdateDownloadEvent,
} from "./inspection/updater/types";

interface NativeDesktopReleaseInfo {
  readonly version: string;
  readonly buildId: string;
  readonly target: string;
  readonly arch: string;
}

const UPDATE_CHECK_EVENT = "rstorrent://check-for-updates";

interface NativeCheckResult {
  readonly channel: UpdateChannel;
  readonly generation: number;
  readonly version: string | null;
  readonly notes: string | null;
  readonly waitingForStable: boolean;
}

interface NativeProgress {
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
  readonly installing: boolean;
}

export async function createTauriDesktopUpdater(): Promise<DesktopUpdater> {
  try {
    await invoke<HostUpdateSnapshot>("desktop_update_request", { request: { action: "status" } });
  } catch {
    // The catalog recovery screen has no running host, and uses its existing
    // explicit update path. It must not start unattended updates.
    return createLegacyTauriDesktopUpdater();
  }
  const [info, bundle] = await Promise.all([
    invoke<NativeDesktopReleaseInfo>("desktop_release_info"), getBundleType().catch(() => null),
  ]);
  let unlisten: (() => void) | undefined;
  const stopActivity = reportUpdateActivity(request => invoke("desktop_update_request", { request }));
  const updater = new HostOwnedUpdater(request => invoke("desktop_update_request", { request }), {
    ...info, bundleType: normalizeBundleType(bundle), checkPrivacy: "preference-controlled",
  }, () => { unlisten?.(); stopActivity(); });
  const handleCheck = createNativeUpdateCheckHandler(() => void updater.check("manual"));
  try {
    unlisten = await listen<unknown>(UPDATE_CHECK_EVENT, event => handleCheck(event.payload));
    handleCheck(await invoke<unknown>("desktop_update_check_generation"));
  } catch (error) { updater.close(); throw error; }
  return updater;
}

async function createLegacyTauriDesktopUpdater(): Promise<DesktopUpdater> {
  const [nativeInfo, bundleType, channel] = await Promise.all([
    invoke<NativeDesktopReleaseInfo>("desktop_release_info"),
    getBundleType().catch(() => null),
    invoke<UpdateChannel>("desktop_update_channel"),
  ]);
  const info: DesktopReleaseInfo = {
    ...nativeInfo,
    bundleType: normalizeBundleType(bundleType),
    checkPrivacy: "preference-controlled",
  };
  const backend: DesktopUpdateBackend = {
    async check(reason, _timeoutMs) {
      const result = await invoke<NativeCheckResult>("desktop_check_update", {
        reason,
      });
      if (result.waitingForStable) return { waitingForStable: true };
      return result.version === null
        ? null
        : new TauriUpdateCandidate(result.generation, result.version, result.notes);
    },
    selectChannel: (selected) => invoke("desktop_select_update_channel", { channel: selected }),
    // The native apply path owns the one-shot relaunch after installation.
    // A second renderer restart could launch the old executable or duplicate B.
    relaunch: async () => {},
  };
  const controller = new DesktopUpdaterController(backend, info, globalThis, channel);
  const handleUpdateCheck = createNativeUpdateCheckHandler(() => {
    void controller.check("manual");
  });
  const unlisten = await listen<unknown>(UPDATE_CHECK_EVENT, (event) => {
    handleUpdateCheck(event.payload);
  });
  try {
    handleUpdateCheck(await invoke<unknown>("desktop_update_check_generation"));
  } catch (error) {
    unlisten();
    controller.close();
    throw error;
  }
  return new TauriDesktopUpdater(controller, unlisten);
}

class TauriDesktopUpdater implements DesktopUpdater {
  readonly getSnapshot = () => this.controller.getSnapshot();
  readonly subscribe = (listener: () => void) =>
    this.controller.subscribe(listener);

  constructor(
    private readonly controller: DesktopUpdaterController,
    private readonly unlisten: () => void,
  ) {}

  private closed = false;

  check(reason: CheckReason = "manual"): Promise<void> {
    return this.controller.check(reason);
  }

  install(): Promise<void> {
    return this.controller.install();
  }

  dismiss(): void {
    this.controller.dismiss();
  }

  selectChannel(channel: UpdateChannel): Promise<void> {
    return this.controller.selectChannel(channel);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unlisten();
    this.controller.close();
  }
}

class TauriUpdateCandidate implements UpdateCandidate {
  readonly version: string;
  readonly notes?: string;

  constructor(private readonly generation: number, version: string, notes: string | null) {
    this.version = version;
    if (notes !== null) this.notes = notes;
  }

  async downloadAndInstall(
    onEvent: (event: UpdateDownloadEvent) => void,
  ): Promise<void> {
    let downloadedBytes = 0;
    let started = false;
    const progress = new Channel<NativeProgress>();
    progress.onmessage = (event) => {
      if (event.installing) {
        onEvent({ type: "finished" });
      } else {
        if (!started) {
          started = true;
          onEvent({ type: "started", ...(event.totalBytes === null ? {} : { contentLength: event.totalBytes }) });
        }
        const chunkLength = Math.max(0, event.downloadedBytes - downloadedBytes);
        downloadedBytes = event.downloadedBytes;
        onEvent({ type: "progress", chunkLength });
      }
    };
    await invoke("desktop_install_update", { generation: this.generation, progress });
  }

  async close(): Promise<void> {
    await invoke("desktop_clear_update_candidate", { generation: this.generation });
  }
}

function normalizeBundleType(value: string | null): DesktopBundleType {
  switch (value) {
    case "app":
    case "nsis":
    case "appimage":
    case "msi":
    case "deb":
    case "rpm":
      return value;
    default:
      return "unknown";
  }
}

export type { CheckReason };
