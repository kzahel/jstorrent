import { message as localizedMessage } from "../localization/runtime";
import type { DetailTab, DesiredInspectionViews } from "./model";

export const DETAIL_TABS: readonly {
  readonly id: DetailTab;
  readonly label: string;
  readonly scope: "torrent" | "session";
  readonly view: DesiredInspectionViews["detail"];
}[] = [
  { id: "general", label: localizedMessage("inspection.tabs.general"), scope: "torrent", view: "general" },
  { id: "trackers", label: localizedMessage("inspection.tabs.trackers"), scope: "torrent", view: "trackers" },
  { id: "peers", label: localizedMessage("inspection.tabs.peers"), scope: "torrent", view: "peers" },
  { id: "swarm", label: localizedMessage("inspection.tabs.swarm"), scope: "torrent", view: "swarm" },
  { id: "files", label: localizedMessage("inspection.tabs.files"), scope: "torrent", view: "files" },
  { id: "pieces", label: localizedMessage("inspection.tabs.pieces"), scope: "torrent", view: "pieces" },
  { id: "disk", label: localizedMessage("inspection.tabs.disk"), scope: "session", view: "disk" },
  { id: "logs", label: localizedMessage("inspection.tabs.logs"), scope: "session", view: "logs" },
  { id: "speed", label: localizedMessage("inspection.tabs.speed"), scope: "session", view: "speed" },
  { id: "dht", label: localizedMessage("inspection.tabs.dht"), scope: "session", view: "dht" },
];

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
