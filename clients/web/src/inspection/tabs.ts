import { message as localizedMessage } from "../localization/runtime";
import type { DetailTab, DesiredInspectionViews } from "./model";

export const DETAIL_TABS: readonly {
  readonly id: DetailTab;
  readonly label: string;
  readonly scope: "torrent" | "session";
  readonly view: DesiredInspectionViews["detail"];
}[] = [
  { id: "general", get label() { return localizedMessage("inspection.tabs.general"); }, scope: "torrent", view: "general" },
  { id: "trackers", get label() { return localizedMessage("inspection.tabs.trackers"); }, scope: "torrent", view: "trackers" },
  { id: "peers", get label() { return localizedMessage("inspection.tabs.peers"); }, scope: "torrent", view: "peers" },
  { id: "swarm", get label() { return localizedMessage("inspection.tabs.swarm"); }, scope: "torrent", view: "swarm" },
  { id: "files", get label() { return localizedMessage("inspection.tabs.files"); }, scope: "torrent", view: "files" },
  { id: "pieces", get label() { return localizedMessage("inspection.tabs.pieces"); }, scope: "torrent", view: "pieces" },
  { id: "disk", get label() { return localizedMessage("inspection.tabs.disk"); }, scope: "session", view: "disk" },
  { id: "logs", get label() { return localizedMessage("inspection.tabs.logs"); }, scope: "session", view: "logs" },
  { id: "speed", get label() { return localizedMessage("inspection.tabs.speed"); }, scope: "session", view: "speed" },
  { id: "dht", get label() { return localizedMessage("inspection.tabs.dht"); }, scope: "session", view: "dht" },
];

export const DETAIL_TAB_IDS: readonly DetailTab[] = DETAIL_TABS.map(
  (tab) => tab.id,
);

export function desiredDetailForTab(
  tab: DetailTab,
  torrentId: string | null,
): DesiredInspectionViews["detail"] {
  const definition = DETAIL_TABS.find((candidate) => candidate.id === tab);
  if (definition === undefined || definition.view === null) return null;
  return definition.scope === "session" || torrentId !== null
    ? definition.view
    : null;
}

export function isSessionTab(tab: DetailTab): boolean {
  return DETAIL_TABS.some(
    (candidate) => candidate.id === tab && candidate.scope === "session",
  );
}
