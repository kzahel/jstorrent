import { message as localizedMessage } from "../../localization/runtime";

import { useInspectionStore } from "../context";
import type { TorrentCategory, TorrentRow } from "../model";
import { torrentMatchesCategory } from "../state";
import styles from "./TorrentCategoryEmpty.module.css";

// Empty-table copy for a filtered torrent category. The "all" category has
// its own first-run copy in each table.
export function torrentCategoryEmptyMessage(
  category: Exclude<TorrentCategory, "all">,
): string {
  switch (category) {
    case "active":
      return localizedMessage("inspection.components.torrent.category.empty.no.active.torrents");
    case "downloading":
      return localizedMessage("inspection.components.torrent.category.empty.nothing.is.downloading");
    case "completed":
      return localizedMessage("inspection.components.torrent.category.empty.no.completed.torrents");
    case "paused":
      return localizedMessage("inspection.components.torrent.category.empty.no.paused.torrents");
    case "errors":
      return localizedMessage("inspection.components.torrent.category.empty.no.torrents.need.attention");
    case "archived":
      return localizedMessage("inspection.components.torrent.category.empty.no.archived.torrents");
  }
}

/** True when the category filter, not an empty session, hides every torrent. */
export function categoryHidesTorrents(
  category: TorrentCategory,
  torrents: Readonly<Record<string, TorrentRow>>,
): boolean {
  return (
    category !== "all" &&
    Object.values(torrents).some((row) => torrentMatchesCategory(row, "all"))
  );
}

export function ShowAllTorrentsButton() {
  const selectTorrentCategory = useInspectionStore(
    (state) => state.selectTorrentCategory,
  );
  return (
    <button
      className={styles.showAll}
      type="button"
      onClick={(event) => {
        // The empty area clears the selection on click.
        event.stopPropagation();
        selectTorrentCategory("all");
      }}
    >
      {localizedMessage("inspection.components.torrent.category.empty.show.all.torrents")}
    </button>
  );
}
