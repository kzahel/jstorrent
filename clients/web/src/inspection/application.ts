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
  // Skips any wait before the next reconnect attempt.
  reconnectNow(): void;
  close(): Promise<void>;
}
