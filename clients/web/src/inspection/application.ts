import type {
  TorrentListImportReport,
  TorrentListImportTarget,
} from "../api";
import type {
  CommandResult,
  DemoScenarioSummary,
  InspectionCommand,
  InspectionUpdate,
  DesiredInspectionViews,
} from "./model";

export interface InspectionApplication {
  readonly kind: "demo" | "live";
  readonly scenarios: readonly DemoScenarioSummary[];

  subscribe(listener: (update: InspectionUpdate) => void): () => void;
  setViews(views: DesiredInspectionViews): Promise<void>;
  dispatch(command: InspectionCommand): Promise<CommandResult>;
  /**
   * Tactical 348 bundle export and import, present only where the client
   * supports them. Export resolves false and import null when the user
   * cancels the file dialog.
   */
  readonly exportTorrentList?: (() => Promise<boolean>) | undefined;
  readonly importTorrentBundle?:
    | ((
        target: TorrentListImportTarget,
        chooseFile: () => Promise<ArrayBuffer | null>,
      ) => Promise<TorrentListImportReport | null>)
    | undefined;
  // Skips any wait before the next reconnect attempt.
  reconnectNow(): void;
  close(): Promise<void>;
}
