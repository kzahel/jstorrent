# URL navigation and in-place hot reload

Status: complete. Topics: `web-ui-design`, `application-view-api`.

## Scope and stopping condition

The maintainer asked on 2026-10-15 why every small web UI edit under
`./scripts/webui --reload` closed Settings and reset the page, and asked for
basic URL navigation with browser history. Two causes and one gap:

- `vite.config.ts` loads no React plugin, so Vite has no Fast Refresh
  boundary and turns every `.ts`, `.tsx` or `.json` edit into a full page
  reload. Copy edits reload through `localization/generated/en.json`, which
  only plain module code imports.
- Destination and category persist in local storage, but Settings is `App`
  component state and the open torrent and detail tab live only in memory, so
  any reload loses them.
- `LibraryView` keeps a private `history.state` record for its detail without
  changing the URL; nothing else uses history.

This slice:

1. Adds `@vitejs/plugin-react` 6.1.2 (MIT; its one dependency was already in
   the tree) for the dev server only, so component edits keep page and store
   state. Builds keep Vite's own JSX transform.
2. Makes copy edits update in place: a dev-server watcher recompiles
   `messages/en.json`, and the localization runtime accepts the compiled
   catalog and re-renders the root instead of reloading.
3. Puts navigation in the URL fragment with one history owner, replacing the
   Library's private record.

Stop when a reload restores the destination, category, open torrent, detail
tab or Library mode and the open Settings category; Back and Forward move
through those openings; closing a detail or Settings returns through history
rather than adding an entry; and a recorded dev-server run shows a component
edit and a copy edit applied without a page reload.

## Non-goals

- A router dependency, path-based URLs or a gateway SPA fallback.
- Selection sets, sort, filter text, Library search and page, scroll, log
  filters and pane sizes in the URL. Library browse preferences stay in local
  storage as Tactical 363 decided.
- Android, the extension companion's own navigation, or deep links from
  outside the app (notifications, extension, share links).
- Hot replacement of the store, controller or API modules. Editing them still
  reloads; the URL makes that reload land on the same screen.
- Module-level strings computed at import (for example `DETAIL_TABS` labels)
  updating without a reload.

## URL shape

The fragment holds a path for the destination and category and a query for the
rest; defaults are omitted. The page's own `?query` (demo, token, transport,
locale) is never touched.

| Fragment | Screen |
|---|---|
| `#/library`, `#/library/recent` | Library and its category |
| `#/library?torrent=<id>`, `…&view=files` | Library detail, media or all files |
| `#/torrents/downloading` | Torrents and its category |
| `#/torrents?torrent=<id>&tab=peers` | Current torrent and detail tab |
| `…&open=1` | Narrow layout: the full-screen detail is open |
| `…&settings=data-reset` | Settings on that category, over any screen |

The fragment works on every surface without server changes: the gateway serves
only `/` and `/index.html`, startup options already use the query, and the
companion and Tauri load from their own origins.

## Design

`inspection/route.ts` holds pure functions: `routeFromPresentation`,
`formatRoute` and `parseRoute`. Parsing treats the fragment as hostile input:
unknown destinations, categories, tabs, modes and Settings categories fall back
to defaults, and a torrent id longer than 128 characters is dropped.

`inspection/route-history.ts` installs one owner over `window.history` for
the store, from `renderInspection` in the bootstrap:

- **Startup.** A non-empty fragment is held as a pending route. It is applied
  once the first library snapshot is ready, so a torrent id can be checked;
  an unknown torrent is dropped. Until then the store's changes do not write
  the URL. An empty fragment keeps the local-storage navigation.
- **Store to URL.** Each store change computes the route. An opening (another
  destination or category, a Library detail, the narrow detail, or Settings)
  pushes an entry; other changes (current torrent, tab, Library mode, Settings
  category) replace it. Each entry records the fragment it came from; when the
  new fragment equals that, as when a detail or Settings closes, the owner
  goes `back()` instead of writing, so closing never piles up entries.
- **URL to store.** `popstate` and `hashchange` apply the parsed route
  through existing store actions, calling each only when its value differs.
- Settings' open category moves into presentation state with `openSettings`,
  `selectSettingsCategory` and `closeSettings`; `SettingsDialog` becomes
  controlled. While a reset or import keeps Settings busy, `closeSettings`
  does nothing, so Back during an import is undone by the next write.
- Clear app data drops the fragment before its browser reload, so cleared
  data starts on the default screen. Restore defaults does not reload.

### Ownership and cancellation

The route owner is a plain object with one store subscription and two window
listeners. `renderInspection` owns it for the page's life; its `dispose`
removes both and is used by tests. It runs no timers or tasks. The
localization runtime owns a listener set; the bootstrap subscribes once per
root.

Dependency direction: `route.ts` depends on navigation and model types only;
`route-history.ts` depends on the store API and a `Window`-shaped history
port; React components depend on neither.

## Validation

- Unit: parse and format round-trip, defaults omitted, hostile fragments
  rejected.
- Unit: the history owner applies a deep link after the first snapshot,
  drops an unknown torrent, pushes openings, replaces refinements, closes
  through `back()`, follows `popstate`, and keeps a busy Settings open.
- Component: Settings opens on the stored category and changes it through the
  store; existing App and Library tests pass with the private history removed.
- Dev server: Playwright against Vite in demo mode edits a component and a
  message and observes the change without a reload.
- Baseline: web typecheck, localization check and the full vitest suite.

## Implementation notes

The startup dependency scan scanned every HTML entry and failed on
`remote.html`, whose `rstorrent-remote-wasm-client` alias exists only in
remote builds. Vite then discovered dependencies on first load and reloaded
the page ("optimized dependencies changed"); with Fast Refresh the two late
batches split React and the page failed with `react-dom.js does not provide
an export named 't'`. `optimizeDeps.entries` now names `index.html` and
`companion.html`, so the scan succeeds and the first load no longer reloads.
The remote dev page still discovers its dependencies late.

## Evidence

2026-10-15, local:

- `route.test.ts` (3) and `route-history.test.ts` (7) cover round-trips,
  hostile fragments, the deferred deep link, the unknown torrent, push and
  replace, closing through Back, Forward, a busy Settings and the narrow
  detail. An App test keeps the Settings category in the store and shows
  Appearance for a category the client lacks.
- Web typecheck, localization check and the full vitest suite (787) pass.
- Playwright against a separate Vite: `inspection-demo.spec.ts` (34),
  `overlay-primitives.spec.ts` and, with pseudo locales enabled as
  `test:e2e` does, `localization.spec.ts` pass.
- Bundled Playwright Chromium against `vite --force` in demo mode, Settings
  open on Data & reset: editing `messages/en.json` renamed the tab and editing
  `DataResetSettingsSection.tsx` added an attribute, with zero page loads, a
  window marker kept and Settings still open. The Vite log shows only
  `hmr update` lines. A reload returned to
  `#/torrents?torrent=…&settings=data-reset` with Data & reset selected;
  Back closed Settings; Library then Back returned to Torrents.
