# Application Interface Direction

Topic: `application-interface-direction`

Status: Tactical [`225`](../tactical/225-two-destination-torrent-navigation-first-pass.md)
places a two-destination Library/Torrents navigation in product review. Its
Torrents destination uses the former Workbench table and detail; row
activation opens detail at narrow widths, while the checkbox retains batch
selection in the list. Fresh installs open Torrents, and saved Transfers
destinations migrate to Torrents with their saved filter. The three-destination
direction implemented by Tactical `055` remains below as historical context
until this first pass is reviewed. Library currently presents
truthful torrent-backed content sources. Completed Tactical `072` adds one
responsive media-first detail for an explicitly opened source, backed by a
derived video/episode catalog and authoritative file progress. Thumbnails,
external metadata, playback presentation, persistence, and Library-wide media
aggregation remain absent.
Tactical [`223`](../tactical/223-remove-library-capability-notices.md)
keeps those boundaries in product documentation while removing their
implementation-status notices from the Library sidebar and empty state.
Tactical [`363`](../tactical/363-library-media-index.md) replaces the
torrent-backed cards with a cross-torrent Library of video and audio files on
hosts that offer the `library_media` projection: All media, TV shows, Movies,
Music and By torrent presets, search, availability, sort, archived scope,
cards or list, and pages. Hosts without it keep the torrent cards.
[`media-library`](media-library.md) owns its model and contract.

## Purpose And Scope

RSTorrent's detailed interface is intentionally useful as a debugging and
inspection surface, but that density should not define every product task.
The application also needs a content-oriented experience that can eventually
serve the role explored by the sibling `playsvideo` project, plus a clean place
for ordinary torrent control.

This topic owns the desktop/web product information architecture:

- the top-level Library and Torrents destinations, including the earlier
  three-destination design recorded below;
- the responsibility and vocabulary of each destination;
- the role of contextual sidebars and inspectors;
- continuity of selection and presentation state between destinations; and
- the boundary between accepted presentation direction and media behavior
  that still requires design and implementation evidence.

[`web-ui-design.md`](web-ui-design.md) continues to own React, CSS Modules,
responsive behavior, accessibility, rendering, and browser-local presentation
state. [`desktop-inspection-surface.md`](desktop-inspection-surface.md) owns why
detailed torrent observation is a product and maintainer requirement.
[`client-surfaces.md`](client-surfaces.md) owns the browser and Tauri shells and
their platform lifecycle.

## Previous Three-Destination Shape

The following records the Tactical `055` design. Tactical `225` currently
supersedes its primary navigation and fresh-install default for review.

Use the existing top application bar for primary navigation:

```text
Library   Transfers   Workbench
```

These are destinations, not merely different row sizes or arrangements of one
torrent list.

### Library

Library is content-centric. Its primary objects are recognizable media and
files that a person may want to browse, play, reveal, or organize. Artwork,
title, duration, resolution, watched state, and playback readiness are more
important here than tracker, peer, and piece mechanics.

The Library sidebar filters media concepts such as all media, movies, recently
added, ready to play, watched, and unwatched. It does not relabel torrent
status filters as a media library.

The mockup is directional, not evidence that playback is ready. RSTorrent now
owns a rebuildable derived video/episode catalog for verified torrent files,
but does not own metadata/artwork acquisition, watched history, durable media
organization, or playback presentation. The verified-range HTTP data plane
exists as recorded in
[`http-file-serving-and-streaming.md`](http-file-serving-and-streaming.md), but
its existence alone does not make a Library row a truthful Play action.

Tactical `055` therefore starts with All content, Recently added, Available
offline, and Downloading filters derived only from torrent summary facts. Its
cards use generated gradients and initials, report actual size and transfer
progress, and can open their source torrent in Workbench. They do not display
Play, duration, resolution, media type, watched state, or external artwork.

### Transfers

Transfers is the clean operational queue. It emphasizes torrent name, state,
progress, rate, common commands, and multi-selection without requiring a dense
detail pane. Its sidebar uses torrent lifecycle filters such as all,
downloading, seeding, complete, paused, errors, and archived.

Transfers is not a reduced-capability replacement for Workbench. It is the
ordinary control surface for people who do not currently need protocol,
storage, or diagnostic detail.

### Workbench

Workbench preserves and extends the current detailed React interface. Its
recognizable default is the traditional torrent-client arrangement:

```text
full torrent table
──────────────────────── resizable splitter
selected-torrent detail tabs and global diagnostic views
```

The table retains sortable columns, multi-selection, transfer commands, and
high-density status. The lower surface retains General, Trackers, Peers,
Swarm, Files, Pieces, and other torrent-scoped views. Global Disk, Logs, DHT,
Speed, and related diagnostic surfaces also belong in Workbench rather than
requiring Activity to be a separate top-level destination.

Workbench is not a hidden "advanced mode" that transforms the rest of the
application. It is visible in primary navigation, may be a user's persistent
home, and can retain its own density, columns, splitter position, active tab,
and other presentation preferences.

## Sidebar And Inspector Semantics

Primary navigation belongs in the top application bar. The left sidebar is
contextual to the selected destination:

- Library filters media and viewing state;
- Transfers filters torrent lifecycle and organization; and
- Workbench filters the torrent working set while leaving detailed inspection
  in its table and lower pane.

A lightweight contextual inspector may complement Library or Transfers, but it
does not replace Workbench. When present, it is toggled by a normal pressed
toolbar button with `aria-pressed` semantics, visually analogous to a latched
pane button. It is not represented as a checkbox. Its placement and exact
scope remain open.

The Workbench detail pane remains a resizable part of the workbench layout.
Whether it can also be hidden is a local Workbench presentation choice, not the
application-level switch between clean and advanced experiences.

## Shared Selection And Continuity

All three destinations operate on the same application truth. They must not
create separate torrent identities, command meanings, or materialized engine
replicas merely because they present different tasks.

The presentation should preserve useful continuity:

- a selected media item can expose its source torrent and open it in Workbench;
- a selected torrent remains selected when moving between Transfers and
  Workbench when it is still visible;
- multi-selection remains available in Transfers and Workbench;
- destination-specific scroll, filter, columns, density, splitter, and tab
  state may be remembered independently; and
- returning to a destination restores its useful local context rather than
  resetting the whole application.

Fresh installations open Transfers. Best-effort browser-local preferences
restore the last destination and each destination's independent filter, so a
power user can remain in Workbench without repeatedly opting into it. Primary
selection is shared by all three destinations, while multi-selection is shared
by Transfers and Workbench and pruned exactly when torrents disappear.
Tactical `058` makes those separate states: ordinary row activation establishes
the current single-command target, while explicit selection mode owns the
checked batch-command set without changing the current/detail torrent.

The accepted continuing vocabulary and interaction are now owned by
[`table-interaction.md`](table-interaction.md). The singular current/detail
torrent is the **active row**; checked multi-command targets are the **batch
selection**. Keyboard row focus follows the active row, so Arrow navigation
updates Workbench detail immediately rather than moving an independent cursor.
Multiple batch-selected torrents never produce unioned detail data; detail
continues to represent the one active torrent.

## Implemented Initial Cross-Section

Tactical `055` implements the application shell without changing Rust views,
commands, generated contracts, or durable data:

- labeled primary navigation at wide widths and icon-plus-accessible-name
  navigation at phone widths;
- contextual Library, Transfers, and Workbench sidebars;
- a clean virtualized Transfers queue with shared multi-selection;
- sequential Start, Pause, and uniform Archive or Restore over existing
  one-torrent commands, while removal remains deliberately single-torrent;
- a virtualized torrent-backed Library with an explicit Open in Workbench
  handoff; and
- collection-only view leasing in Library and Transfers, with the existing
  responsive detail leases retained only by Workbench.

The initial slice deliberately leaves lightweight clean-view inspectors,
media enrichment, playback, routes, and multi-remove policy open.

Completed Tactical `072` adds the first bounded Library detail without
changing the top-level collection's torrent-backed identity. Activating a card
opens a same-document responsive detail; recognized videos default to typed
numeric episode order and an explicit All files tab retains literal source
inspection. Exact file progress, selection, and availability remain
authoritative. Back, Escape, browser history, focus restoration, filter
changes, and removal repair are presentation-local. The detail leases only
its visible Media or Files projection. Generated initials and gradients remain
placeholders rather than artwork, and no Play claim appears.

Tactical `058` refines that initial selection interaction. Checkboxes and
select-all appear only in a clearly labeled mode entered through Select,
keyboard Space, Command/Control-click, or touch/pen long press. Done and Escape
exit it. Normal row activation and empty-space clearing remain unambiguous
single-selection behavior, and the existing command policies choose either the
current row or checked set from the active mode.

Tactical `059` supersedes only the checkbox-visibility part of that refinement.
Transfers, Workbench torrents, and Files now keep their checkbox column visible
because they expose row actions; the checked batch remains empty and distinct
from the highlighted current row until a checkbox or another entry path starts
selection mode. Shift-click adds familiar inclusive range selection in the
current sorted and filtered order without changing command policy.

## Adaptive And Platform Direction

Wide desktop space uses the top bar for labeled primary navigation and leaves
the contextual sidebar available. At narrow widths, primary destinations may
collapse to recognizable icons, the sidebar may become a horizontal filter row
or drawer, and Workbench may stack the torrent table above its detail surface.
The destination model remains the same rather than becoming a separate mobile
web application.
Tactical [`224`](../tactical/224-workbench-detail-back-breakpoint.md) keeps
the return-to-list control available at every width where Workbench detail
replaces the torrent list.

This direction applies to the shared desktop/browser presentation. It does not
require the Android Compose client to adopt the same Library cards or
Workbench density. Tactical
[376](../tactical/376-android-media-library.md) adopts the same two primary
destinations on Android, ordered Torrents then Library: a navigation bar at compact
widths and a rail from 600 dp, hidden while torrent selection owns the bottom
bar. Global screens stay in the overflow menu; Android has no drawer.

## Local Mockup Record

Exploratory and selected mockups are retained locally under the gitignored
`mockups/web-ui-direction/` directory. They are intentionally not repository
history and may be absent from another checkout.

The local sequence is:

1. `01-view-modes.html` and `01-*.png`: Finder-like Cards, Transfers, and
   Inspect presentations of one filtered collection.
2. `02-inspector-layouts.html` and `02-*.png`: independent Cards/Table and
   hidden/right/bottom inspector choices, including multi-selection.
3. `03-library-transfers-activity.html` and `03-*.png`: the first genuinely
   distinct Library, Transfers, and Activity destinations plus a pressed
   inspector button.
4. `04-library-transfers-workbench.html` and `04-*.png`: the accepted direction,
   replacing Activity with the first-class traditional Workbench.

The standalone HTML files retain their local interactions. PNG files capture
representative wide, alternate, and phone arrangements. The whole `mockups/`
tree is ignored so screenshots and generated preview wrappers cannot enter a
commit accidentally.

## Invariants

- Library, Transfers, and Workbench are distinct product destinations, not
  names for cosmetic table modes.
- Workbench preserves the current dense inspection capability as a first-class
  product surface.
- A clean default experience must not require removing advanced information or
  making it undiscoverable.
- A media item is never presented as playable unless application and storage
  owners can support that claim with verified content behavior.
- Presentation differences do not create separate command or engine truths.
- The contextual sidebar does not carry application-level navigation and local
  filtering as one ambiguous hierarchy.
- A pane toggle uses pressed-button semantics rather than a checkbox.
- Desktop/web direction does not imply automatic Android presentation parity.

## Non-Goals

- Implement the three destinations without a bounded tactical.
- Adopt `playsvideo` source, persistence, or metadata contracts implicitly.
- Select an external media metadata or artwork provider.
- Claim streaming playback, verified-range serving, or media readiness.
- Turn Workbench into a hidden preference or remove its detailed views.
- Add a remote daemon, playback server, or new transport as a presentation
  shortcut.

## Open Decisions

- User organization of the Library (overrides, saved views, watched state);
  [`media-library`](media-library.md) records where it would live.
- Metadata, artwork, watched-state, privacy, cache, and offline behavior.
- Playback application choice and the eventual verified-range data plane.
- Whether Library includes incomplete but not-yet-playable media, and how that
  state is communicated without a false readiness claim.
- The exact scope and placement of lightweight Library and Transfers
  inspectors.
- Workbench's default splitter position and whether its lower pane can be
  hidden.
- The exact home for global Disk, Logs, DHT, Speed, and future diagnostic
  surfaces inside Workbench.
- URL, history, keyboard shortcut, and accessibility semantics for primary
  destination changes.

## Recommended Next Work

Use the implemented shell and torrent detail for product discussion before
opening another interface tactical. Library-wide aggregation is implemented by
Tactical `363`; the next bounded slice should choose one actual user need:
playback presentation over the existing verified-range data plane,
thumbnail generation/cache ownership, or richer durable content identity. Each remains an independent
source- and edge-case-driven tactical because it introduces storage,
persistence, metadata, privacy, or platform-lifecycle questions beyond this
read-only detail.
