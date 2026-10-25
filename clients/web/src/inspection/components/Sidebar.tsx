import { formatNumber, message as localizedMessage  } from "../../localization/runtime";
import { useMemo, type ReactNode } from "react";

import type { LibraryFacetsView } from "../../api";

import { useInspectionStore } from "../context";
import type {
  ApplicationDestination,
  LibraryCategory,
  TorrentCategory,
  TorrentRow,
} from "../model";
import {
  torrentMatchesCategory,
  torrentMatchesLibraryCategory,
  type PresentationState,
} from "../state";
import { DETAIL_TABS } from "../tabs";
import { LIBRARY_PRESETS, type LibraryPreset } from "../library-browse";
import { presetLabel } from "./LibraryMediaView";
import { Icon, type IconName } from "./Icon";
import styles from "./Sidebar.module.css";

const DESTINATIONS: readonly {
  readonly id: ApplicationDestination;
  readonly icon: IconName;
}[] = [
  { id: "library", icon: "library" },
  { id: "workbench", icon: "transfers" },
];

/** Session-wide views; narrow layouts reach them here instead of as tabs. */
const SESSION_TABS = DETAIL_TABS.filter((tab) => tab.scope === "session");

const LIBRARY_CATEGORIES: readonly {
  readonly id: LibraryCategory;
  readonly label: string;
  readonly symbol: string;
}[] = [
  { id: "all", get label() { return localizedMessage("inspection.components.sidebar.all.content"); }, symbol: "▦" },
  { id: "recent", get label() { return localizedMessage("inspection.components.sidebar.recently.added"); }, symbol: "◷" },
  { id: "available", get label() { return localizedMessage("inspection.components.sidebar.available.offline"); }, symbol: "✓" },
  { id: "downloading", get label() { return localizedMessage("inspection.components.sidebar.downloading"); }, symbol: "↓" },
  { id: "archived", get label() { return localizedMessage("inspection.components.sidebar.archived"); }, symbol: "▣" },
];

const PRESET_SYMBOLS: Readonly<Record<LibraryPreset, string>> = {
  all: "▦",
  shows: "▤",
  movies: "▶",
  music: "♪",
  torrents: "≡",
};

/** The files each preset holds within the current search; torrents for By torrent. */
function presetCount(preset: LibraryPreset, facets: LibraryFacetsView): number {
  switch (preset) {
    case "all":
      return facets.items;
    case "shows":
      return facets.episodes;
    case "movies":
      return facets.movies;
    case "music":
      return facets.tracks;
    case "torrents":
      return facets.torrents;
  }
}

const TORRENT_CATEGORIES: readonly {
  readonly id: TorrentCategory;
  readonly label: string;
  readonly symbol: string;
}[] = [
  { id: "all", get label() { return localizedMessage("inspection.components.sidebar.all.torrents"); }, symbol: "≡" },
  { id: "active", get label() { return localizedMessage("inspection.components.sidebar.active"); }, symbol: "↯" },
  { id: "downloading", get label() { return localizedMessage("inspection.components.sidebar.downloading"); }, symbol: "↓" },
  { id: "completed", get label() { return localizedMessage("inspection.components.sidebar.completed"); }, symbol: "✓" },
  { id: "paused", get label() { return localizedMessage("inspection.components.sidebar.paused"); }, symbol: "Ⅱ" },
  { id: "errors", get label() { return localizedMessage("inspection.components.sidebar.needs.attention"); }, symbol: "!" },
  { id: "archived", get label() { return localizedMessage("inspection.components.sidebar.archived"); }, symbol: "□" },
];

/**
 * Navigation for every width: destinations, the current destination's
 * categories and, in the narrow drawer, the session-wide views.
 */
export function Sidebar() {
  const destination = useInspectionStore(
    (state) => state.presentation.destination,
  );
  const selectDestination = useInspectionStore(
    (state) => state.selectDestination,
  );
  const sessionTab = useInspectionStore((state) =>
    state.presentation.destination === "workbench" &&
    state.presentation.detailOpen
      ? state.presentation.activeTab
      : null,
  );
  const openSessionView = useInspectionStore((state) => state.openSessionView);
  // Wide layouts show the session views as detail tabs.
  const narrow = useInspectionStore(
    (state) => state.presentation.layout === "phone",
  );
  return (
    <div className={styles.sidebar}>
      {/* A view switch drawn as segments, so it reads apart from the categories it controls. */}
      <nav
        className={styles.destinations}
        aria-label={localizedMessage("inspection.components.app.primary")}
      >
        {DESTINATIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={destination === item.id ? "page" : undefined}
            onClick={() => selectDestination(item.id)}
          >
            <Icon name={item.icon} />
            <span>{destinationLabel(item.id)}</span>
          </button>
        ))}
      </nav>
      <Categories />
      {!narrow ? null : (
        <nav
          aria-label={localizedMessage("inspection.components.sidebar.session.views")}
        >
          <p className={styles.heading}>
            {localizedMessage("inspection.components.sidebar.session")}
          </p>
          <ul>
            {SESSION_TABS.map((tab) => (
              <NavigationButton
                key={tab.id}
                active={sessionTab === tab.id}
                label={tab.label}
                onSelect={() => openSessionView(tab.id)}
              />
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

function Categories() {
  const order = useInspectionStore((state) => state.torrentOrder);
  const torrents = useInspectionStore((state) => state.torrents);
  const destination = useInspectionStore(
    (state) => state.presentation.destination,
  );
  const libraryCategory = useInspectionStore(
    (state) => state.presentation.libraryCategory,
  );
  const transfersCategory = useInspectionStore(
    (state) => state.presentation.transfersCategory,
  );
  const workbenchCategory = useInspectionStore(
    (state) => state.presentation.workbenchCategory,
  );
  const selectLibraryCategory = useInspectionStore(
    (state) => state.selectLibraryCategory,
  );
  const selectTorrentCategory = useInspectionStore(
    (state) => state.selectTorrentCategory,
  );
  // Counts appear with the first library view rather than as zeros.
  const countsLoading = useInspectionStore(
    (state) => state.viewStatus.library.status === "loading",
  );
  const mediaLibrary = useInspectionStore(
    (state) => state.viewStatus.libraryMedia.status !== "unsupported",
  );
  const libraryBrowse = useInspectionStore(
    (state) => state.presentation.libraryBrowse,
  );
  const facets = useInspectionStore((state) => state.libraryMedia?.facets ?? null);
  const updateLibraryBrowse = useInspectionStore(
    (state) => state.updateLibraryBrowse,
  );
  const closeSidebar = useInspectionStore((state) => state.closeSidebar);
  const rows = useMemo(
    () =>
      order
        .map((id) => torrents[id])
        .filter((row): row is TorrentRow => row !== undefined),
    [order, torrents],
  );
  const newestAddedAtMs = useMemo(
    () =>
      rows.reduce<number | null>(
        (latest, row) =>
          row.addedAtMs !== null && (latest === null || row.addedAtMs > latest)
            ? row.addedAtMs
            : latest,
        null,
      ),
    [rows],
  );

  if (destination === "library" && mediaLibrary) {
    return (
      <nav aria-label={localizedMessage("inspection.components.sidebar.library.filters")}>
        <ul>
          {LIBRARY_PRESETS.map((preset) => (
            <NavigationButton
              key={preset}
              active={libraryBrowse.preset === preset}
              count={facets === null ? undefined : presetCount(preset, facets)}
              label={presetLabel(preset)}
              symbol={PRESET_SYMBOLS[preset]}
              onSelect={() => {
                updateLibraryBrowse({ preset, group: null });
                closeSidebar();
              }}
            />
          ))}
        </ul>
      </nav>
    );
  }

  if (destination === "library") {
    return (
      <nav aria-label={localizedMessage("inspection.components.sidebar.library.filters")}>
        <ul>
          {LIBRARY_CATEGORIES.map((category) => (
            <NavigationButton
              key={category.id}
              active={libraryCategory === category.id}
              count={
                countsLoading
                  ? undefined
                  : rows.filter((row) =>
                      torrentMatchesLibraryCategory(
                        row,
                        category.id,
                        newestAddedAtMs,
                      ),
                    ).length
              }
              label={category.label}
              symbol={category.symbol}
              onSelect={() => selectLibraryCategory(category.id)}
            />
          ))}
        </ul>
      </nav>
    );
  }

  const activeCategory =
    destination === "transfers" ? transfersCategory : workbenchCategory;
  return (
    <nav
      aria-label={
        destination === "transfers"
          ? localizedMessage("inspection.components.sidebar.transfer.filters")
          : localizedMessage("inspection.components.sidebar.workbench.torrent.filters")
      }
    >
      <ul>
        {TORRENT_CATEGORIES.map((category) => (
          <NavigationButton
            key={category.id}
            active={activeCategory === category.id}
            count={
              countsLoading
                ? undefined
                : rows.filter((row) => torrentMatchesCategory(row, category.id))
                    .length
            }
            label={category.label}
            symbol={category.symbol}
            onSelect={() => selectTorrentCategory(category.id)}
          />
        ))}
      </ul>
    </nav>
  );
}

function NavigationButton({
  active,
  count,
  label,
  symbol,
  onSelect,
}: {
  readonly active: boolean;
  readonly count?: number | undefined;
  readonly label: string;
  readonly symbol?: ReactNode;
  readonly onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
      >
        <span className={styles.symbol} aria-hidden="true">
          {symbol}
        </span>
        <span>{label}</span>
        {count === undefined ? null : (
          <span className={styles.count}>{formatNumber(count)}</span>
        )}
      </button>
    </li>
  );
}

/** The narrow app bar's title: the category, or the destination for All. */
export function navigationTitle(presentation: PresentationState): string {
  if (presentation.destination === "library") {
    return presentation.libraryCategory === "all"
      ? destinationLabel("library")
      : categoryLabel(LIBRARY_CATEGORIES, presentation.libraryCategory);
  }
  const category =
    presentation.destination === "transfers"
      ? presentation.transfersCategory
      : presentation.workbenchCategory;
  return category === "all"
    ? destinationLabel(presentation.destination)
    : categoryLabel(TORRENT_CATEGORIES, category);
}

function categoryLabel<Id extends string>(
  categories: readonly { readonly id: Id; readonly label: string }[],
  id: Id,
): string {
  return categories.find((category) => category.id === id)?.label ?? id;
}

function destinationLabel(destination: ApplicationDestination): string {
  switch (destination) {
    case "library":
      return localizedMessage("inspection.components.sidebar.library");
    case "transfers":
      return localizedMessage("inspection.components.sidebar.transfers");
    case "workbench":
      return localizedMessage("inspection.components.sidebar.torrents");
  }
}
