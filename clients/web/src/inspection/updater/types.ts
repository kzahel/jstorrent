export type CheckReason = "startup" | "periodic" | "manual";
export type UpdateChannel = "stable" | "latest";

export type DesktopBundleType =
  | "app"
  | "nsis"
  | "appimage"
  | "msi"
  | "deb"
  | "rpm"
  | "headless"
  | "unknown";

export interface DesktopReleaseInfo {
  readonly version: string;
  readonly buildId: string;
  readonly target: string;
  readonly arch: string;
  readonly bundleType: DesktopBundleType;
  readonly checkPrivacy?:
    | "installation-id"
    | "preference-controlled"
    | "anonymous";
}

export interface ManualUpdateAction {
  readonly command: string;
  readonly releaseUrl: string;
}

export type UpdaterState =
  | { readonly phase: "idle"; readonly lastReason?: CheckReason }
  | { readonly phase: "checking"; readonly reason: CheckReason }
  | { readonly phase: "up-to-date"; readonly reason: "manual" }
  | { readonly phase: "waiting-for-stable" }
  | {
      readonly phase: "available";
      readonly version: string;
      readonly notes?: string;
      readonly reason: CheckReason;
      readonly manualApply?: ManualUpdateAction;
    }
  | { readonly phase: "manual-install"; readonly packageLabel: string }
  | {
      readonly phase: "downloading";
      readonly version: string;
      readonly downloadedBytes: number;
      readonly totalBytes?: number;
    }
  | { readonly phase: "installing"; readonly version: string }
  | {
      readonly phase: "error";
      readonly operation: "check" | "install";
      readonly message: string;
      readonly version?: string;
    };

export interface DesktopUpdaterSnapshot {
  readonly automaticUpdates?: boolean | undefined;
  readonly automaticAvailable?: boolean | undefined;
  readonly updateMessage?: string | undefined;
  readonly lastOutcome?: import("../../api").DesktopUpdateAttempt | undefined;
  readonly restartInSeconds?: number | undefined;
  readonly info: DesktopReleaseInfo;
  readonly state: UpdaterState;
  readonly channel?: UpdateChannel;
  readonly selectingChannel?: boolean;
}

export interface DesktopUpdater {
  readonly getSnapshot: () => DesktopUpdaterSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  check(reason?: CheckReason): Promise<void>;
  install(): Promise<void>;
  dismiss(): void;
  setAutomaticUpdates?(enabled: boolean): Promise<void>;
  selectChannel?(channel: UpdateChannel): Promise<void>;
  close(): void;
}

export type UpdateDownloadEvent =
  | { readonly type: "started"; readonly contentLength?: number }
  | { readonly type: "progress"; readonly chunkLength: number }
  | { readonly type: "finished" };

export interface UpdateCandidate {
  readonly version: string;
  readonly notes?: string;
  readonly manualApply?: ManualUpdateAction;
  downloadAndInstall(
    onEvent: (event: UpdateDownloadEvent) => void,
  ): Promise<void>;
  close(): Promise<void>;
}

export interface DesktopUpdateBackend {
  check(reason: CheckReason, timeoutMs: number): Promise<UpdateCandidate | null | { waitingForStable: true }>;
  selectChannel?(channel: UpdateChannel): Promise<void>;
  relaunch(): Promise<void>;
}
