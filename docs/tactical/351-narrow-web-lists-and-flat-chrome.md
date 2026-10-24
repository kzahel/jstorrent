# Tactical 351: Narrow Web Lists And Flat Chrome

Status: Complete locally, 2026-10-14. Maintainer-directed web presentation
slice. No release is authorized by this tactical.
Topics: `web-ui-design`, `table-interaction`, `localization`.

## Problem

Maintainer feedback, 2026-10-14, with phone and desktop screenshots of the
web UI:

- At phone widths the Library/Torrents switch took a full row under the
  header. A torrent detail stacked the header, that switch, a
  "← Torrents" button row, ten tabs, a count/Columns row and column headers
  before any content.
- Phone tables were wide grids scrolled sideways (Tactical 173). They read
  as a squeezed desktop rather than a phone app; Android's card list was
  the suggested model.
- On desktop, gray and white bands alternated down the content area:
  header, action bar, count/Columns row, column headers, rows, splitter,
  tab bar, count/Columns row, column headers.

## Scope

- **One breakpoint.** `layout.ts` owns `NARROW_MAX_WIDTH = 760`; stylesheets
  repeat it as `@media (max-width: 760px)`. The store's `phone` layout now
  starts at 760 px instead of 680 px, so the controller's narrow
  subscriptions, the drawer and the full-screen detail switch together.
- **Navigation in the sidebar.** Library and Torrents leave the header and
  head the sidebar at every width, above the current destination's
  categories. At narrow widths the sidebar is the hamburger drawer, and it
  also lists the session views (Disk, Logs, Speed, DHT). The narrow header
  is one row: menu, logo, the current place (category or destination) and
  Settings.
- **Narrow detail app bar.** An open torrent detail replaces the header with
  a back arrow, the torrent name, Pause or Start, and a ⋮ menu holding the
  remaining torrent actions. Torrent tabs only; a session view opened from
  the drawer stands alone under its own app bar. The Library detail header
  takes the same app-bar form. Opening a torrent at narrow width while a
  session tab is active selects General.
- **Tables become lists.** At narrow widths `VirtualTable` renders each row
  as a stacked list item instead of a grid row. Columns declare a
  `listRole` (`title`, `trailing`, `subtitle`, `wide`, `detail`) and an
  optional `listLabel`; columns without a role stay out of the list. The
  title line carries the trailing value, the subtitle shares its line with
  a wide value such as progress, and details are one labelled line that
  drops absent values. Column headers and Columns give way to a Sort field
  and direction toggle. Checkboxes appear only while several rows are
  selected (long press starts that), and a tap then toggles rather than
  opens. Torrents, Transfers, Peers, Swarm, Trackers, Files and Disk declare
  roles; no table-specific list component exists.
- **Narrow action bar.** One row: the magnet field shrinks, actions show
  icons only, and More becomes ⋮.
- **Flat desktop chrome.** The header and sidebar remain the only tinted
  surfaces. Column headers, the tab bar and the splitter use the content
  surface with soft borders. A table's count, selection status and Columns
  move into the bar above it through `TableToolbarSlot`: the action bar for
  Torrents and Transfers, the tab bar for detail tables, and the Files
  summary bar for Files (which drops its own duplicate count). Session tabs
  follow a divider instead of being pushed to the far end, so the controls
  beside the tabs never move a tab.

## Non-Goals

- Android. The Compose UI already uses cards and an app bar with a back
  arrow; this slice only borrows that shape.
- Changing which commands exist or how selection targets them. The
  current-within-selection contract is unchanged; only its narrow
  presentation changes.
- A list layout for the Logs console, DHT, Speed or Pieces views, which are
  not tables.
- Persisting a per-table list field choice. Roles are fixed per table.

## Invariants

- One breakpoint value drives JavaScript layout, the drawer, the detail app
  bar and list rendering.
- A list keeps `role="grid"`, rows, `aria-selected`, `aria-current`, roving
  focus, keyboard navigation, the context menu, virtualization and the
  order hold. Row height stays fixed per interface size so virtualization
  arithmetic is unchanged.
- Selection, the current row and action targets behave as before; a list
  never exposes a different target set from the table it replaces.
- Tab selection stays paint-only with equal fixed tab footprints.
- A narrow detail resolves actions for its torrent even when the list
  subscription has been dropped and the torrent has no place in the order.

## Deliberate Differences From Tactical 173

Tactical 173 made every configured column reachable at narrow widths by
horizontal scrolling. This slice replaces that at 760 px and below with a
list of each table's primary fields; the complete columns remain available
at wider widths. A narrow viewport no longer scrolls tables sideways.

## Validation

- `npm run typecheck --prefix clients/web`.
- `npm run test --prefix clients/web`: 629 passed, 2 skipped. New cases cover
  list rendering, list sort, list tap-versus-toggle selection, the toolbar
  slot, `layoutForWidth` boundaries, `openSessionView` and the narrow
  General reset.
- `npm run check:localization`.
- Playwright (`RSTORRENT_PLAYWRIGHT_BASE_URL` against a local Vite server):
  `inspection-demo.spec.ts` 32/32; `overlay-primitives`, `localization`
  and `support-diagnostics` pass. Phone assertions now cover the drawer,
  session views, list rendering, the Sort field, the Back app bar and the
  absence of sideways scrolling. Both `dht-observatory.spec.ts` cases fail
  at the same assertions on the unmodified base commit (a pre-existing
  scenario mismatch); the narrow case's navigation now uses the drawer.
- Manual screenshots at 390/400, 800 and 1024 px in demo and live modes.

The live-engine Playwright specs need a gateway and were not run; they use
desktop widths only.
