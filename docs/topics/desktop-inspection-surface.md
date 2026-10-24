# Desktop Inspection Surface

Topic: `desktop-inspection-surface`

Status: Strategic direction and application-view architecture accepted. The
headless view-set, polling client, generated contract, and pure reducer are
implemented by Tactical `033`. Tactical `034` implements the fresh responsive
frontend, virtual torrent and peer tables, and named deterministic demo
application. Tactical `035` completes the first live bounded cross-section:
truthful torrent summaries and active peers flow from one coherent engine
observation through leased semantic views into the responsive React surface,
with headless recovery and controlled libtorrent evidence. Tactical `036`
adds the one-command production browser launcher needed for maintainer visual
confirmation. Tactical `037` makes that live surface independently useful by
adding bounded adjacent magnet input and Add controls through the application
boundary. Tactical `038` adds responsive curated test-torrent shortcuts under
More for the interactive inspection loop. Tactical `041` adds complete live
file geometry and stored/verified progress through the same headless browser
surface. Tactical `043` adds authoritative live tracker lifecycle, response
counts, retry/reannounce timing, and failure context through that surface.
Tacticals `044`--`045` add global receive/write/hash pressure and a bounded
selected-torrent piece overview with controlled live evidence. Tactical `048`
makes this React surface the ordinary Tauri entry through acknowledged
in-process leased-view streaming. Tactical `060` makes one multiplexed
WebSocket the ordinary live-browser seam and retains HTTP polling only as an
explicit loopback diagnostic comparison. Tactical `049` completes a global
Chrome DevTools-like ordered Logs console with structured context, deliberate
capture interest, local filtering, explicit loss, bounded virtualization, and
no persistence.
Tactical `050` extends the shared React Settings surface with browser-local
Auto, Light, and Dark themes, preserving Interface size and applying persisted
appearance before React content.
Tactical `099` adds persistent browser-local Decimal and Binary data units.
Decimal is the fresh and migrated default, while every generic size and rate
across the shared inspection surface switches immediately without changing
raw application data, view leases, sorting, chart geometry, or exact IEC
technical copy.

Tactical `070` makes torrent failures discoverable from both clean Transfers
and dense Workbench tables. An error-bearing status exposes its bounded reason
on hover and through its accessible name, then routes activation to the
selected torrent's focused General error card. Ordinary statuses remain plain
text, and the UI does not parse error prose into state or actions.

Tactical `055` implements the accepted application-interface direction and
preserves this entire dense surface as the first-class Workbench destination
alongside a truthful torrent-backed Library and clean Transfers queue.
Workbench is not hidden behind an advanced setting, and only Workbench leases
selected-torrent detail projections. See
[`application-interface-direction.md`](application-interface-direction.md).

Completed Tactical
[`072`](../tactical/072-derived-media-catalog.md) gives Library its own bounded
content-focused torrent detail without weakening Workbench. The Media tab
leases a derived video/episode catalog and presents exact shared file progress
in numeric episode order; All files leases the existing literal catalog.
Workbench keeps its selected-torrent state and dense Files surface unchanged,
while Library detail navigation, focus, history, and responsive layout remain
owned by the clean product destination.

Tactical `042` makes a magnet's verified metainfo name appear in both the live
library row and General heading as soon as metadata arrives. Completed
Tactical
[`172`](../tactical/172-provisional-magnet-display-name.md) uses a bounded
magnet `dn` as the provisional label while metadata is pending; the
hash-prefix remains the fallback when neither source nor verified name exists,
and verified metadata always supersedes the source label.

Tactical `103` completes the immediately available Peers transfer and recency
columns. The shared React table now displays sortable upload rate, physical
uploaded bytes, connected age, and last-received-payload age from the existing
application contract, with directionally unavailable facts remaining explicit
em dashes.

Completed Tactical
[`104`](../tactical/104-selection-aware-torrent-eta.md) defines one
selection-aware torrent ETA for Transfers and Workbench. Exact non-padding
network work and constant-space smoothing stay in the Rust application view;
the shared React surface only formats and explains typed warming, estimated,
stalled, and unavailable states. No per-file ETA enters the inspection model.

## Purpose

RSTorrent now has a roughly functional downloader, structured diagnostics,
headless interoperability harnesses, and enough live behavior to expose
correctness and performance problems. The current development loop is still
too indirect: bounded runs and terminal reports are useful evidence, but they
do not replace watching a torrent evolve and building a mental model from its
peers, requests, pieces, discovery, storage, and logs in real time.

Detailed torrent-client views are not merely internal tooling. Experienced
users expect peer, tracker, piece, file, and transfer details, and those views
also form the primary debugging surface for maintainers. The desktop product
should embrace that dual role.

This topic owns that strategic direction. The API and client-state owners are
linked above; this topic does not duplicate their schema, sampling policy,
table definition, or implementation tactical.

## Direction

Pause the engine completeness and libtorrent-parity campaign after completed
Tactical `032`. Preserve its evidence and restart point, but do not open its
next engine tactical while the desktop inspection surface is being discussed
and established.

Use the existing JSTorrent desktop interface as the primary product and
interaction reference. The fresh React presentation described in
[`web-ui-design.md`](web-ui-design.md) preserves its recognizable information
hierarchy and detailed views while adding category navigation, adaptive
master/detail presentation, touch usability, and an accessibility baseline.
Views may initially contain truthful unavailable states while their RSTorrent
data feeds do not exist.

The detailed surface graduates into Workbench rather than being displaced by
cleaner product views. Library and Transfers may simplify their own tasks, but
they do not need to absorb every diagnostic column or tab, and Workbench does
not need to conceal its density. Primary navigation belongs in the existing top
application bar; the left sidebar becomes contextual to the selected
destination.

The existing categorized logger naturally belongs in the logging view. The
peer view is the first new live inspection priority because it gives a direct
picture of connection utility, request ownership, choke state, throughput,
and churn during ordinary interactive testing. Other detailed views should be
connected according to observed debugging and product value rather than a
precommitted completeness order.

Desktop and browser-hosted web builds continue to share one web presentation.
The Tauri application remains the ordinary interactive desktop product, while
the authenticated loopback gateway remains the headless automation seam for
the same components. This direction does not make a local socket service or
remote daemon part of the desktop architecture.

For eventual JSTorrent graduation, the browser extension is also an accepted
first-class desktop client preference. It should attach to the same
desktop host and profile as a Tauri webview rather than take over a
second engine. The future lifecycle, native-messaging, handoff, and security
work is owned by
[`product-surfaces-and-migration.md`](product-surfaces-and-migration.md); it
does not replace the current in-process Tauri implementation path.

`./scripts/webui` remains the explicit manual browser host and headless
automation seam. `./scripts/desktop` now hosts the same React inspection
surface through Tauri's in-process commands and acknowledged Channel view
delivery rather than making the gateway a desktop dependency. Tactical `049`
completes the categorized Logs experience without inheriting JSTorrent's
mixed frontend or arbitrary logger arguments. The feed is global, strictly
chronological, and virtualized; capture interest and local display filters are
intentionally separate.

The embedded desktop keeps Tauri's strict script policy and does not enable
`unsafe-eval`. Ajv remains the generated-contract validator, but its seven
application entry-point validators are compiled into deterministic standalone
ES modules during generation and before every frontend build. The shipped
webview therefore retains runtime structural validation without carrying or
invoking Ajv's runtime compiler. The production build also rejects JavaScript
bundles containing direct `eval` or the `Function` constructor, which guards
the CSP compatibility required by `./scripts/desktop`.

## Platform Split

Desktop/web and Android presentation are allowed to diverge from this point.
The desktop/web product is the dense, detailed inspection surface. Android
continues as a platform-appropriate Compose product and is not required to
mirror desktop tabs, tables, or diagnostic density.

The shared Rust engine, application semantics, integrity rules, and durable
session state remain common. A desktop inspection capability does not imply an
Android screen, and an Android lifecycle or platform feature does not imply a
desktop interaction. Cross-platform presentation parity is now an explicit
choice for each product feature rather than a default requirement.

The initial desktop inspection work should not modify the Android UI. Android
remains supported; it is intentionally behind the desktop inspection surface
while that surface becomes useful for engine development.

## JSTorrent Reference Use

JSTorrent is a first-party product-history and interface reference. Reuse its
overall information architecture, layout lessons, interaction patterns,
visual language, and terminology through a fresh implementation. Do not
transplant its mixed React/Solid component tree or silently import the old
engine state model, controller topology, transport assumptions, or stringly
typed runtime coupling.

Any source or assets copied into this repository must still record the exact
origin and revision, preserve applicable license and attribution coverage, and
identify intentional adaptation. The reference supplies a proven product
surface, not the RSTorrent application-view architecture.

## Principles

- The inspection surface is a real product surface, not a hidden developer
  console that may ignore lifecycle, bounds, accessibility, or correctness.
- A view must distinguish genuinely empty state from unavailable,
  unsupported, disconnected, stale, or overflowed data.
- Structured state, commands, events, and logs retain separate meanings. UI
  code must not scrape log strings to infer engine state or control behavior.
- High-detail observation must remain bounded and must not put peer payloads,
  piece payloads, or storage buffers on the application boundary.
- Existing torrent add, control, persistence, and lifecycle behavior must
  remain usable while the detailed shell is introduced.
- The shared web application remains headlessly exercisable without launching
  or focusing the Tauri window. Interactive desktop testing and automated
  validation run the same web UI in different shells.
- Empty scaffolding is acceptable when it is honest. Controls that cannot act
  must not appear to succeed.

## Deliberately Open Design

The view-set, snapshot/diff, polling-to-streaming, generated-type, and Zustand
architecture is accepted. Tactical `035` now implements the first live torrent
and active-peer field set, Peers-versus-Swarm membership, and local endpoint
privacy posture. Tactical
[`064`](../tactical/064-registry-backed-swarm-inspection.md) now projects the
retained peer registry as the bounded, live Swarm detail. Completed Tactical
[`065`](../tactical/065-dht-observatory.md) gives DHT a static shared-
prefix-depth distribution, routing freshness, and lookup convergence rather
than a raw node table or required chart interaction; a presentation-only mode
can expose the literal 160-slot engine array for teaching and screenshot
diagnosis. Completed Tactical
[`066`](../tactical/066-smooth-session-speed-history.md) gives Speed bounded
live plus durable coarse session history, range-selected delivery, and a hand-
rolled RAF-smooth Canvas renderer. The remaining inspection design includes:

- the division between later protocol-message and deeper history views;
- sorting, filtering, selection, and row-detail semantics beyond the first
  active-peer and Swarm tables;
- which endpoint, peer-client, protocol, and failure details are appropriate
  for local display or exported diagnostics;
- visual adaptations outside the accepted Swarm, DHT, and Speed contracts; or
- whether a future remote-control product consumes the same detailed views.

Those choices should follow inspection of the current JSTorrent UI, the
existing RSTorrent application and diagnostic contracts, and concrete
interactive debugging needs. They should not be inferred from the public
comparator schema or prematurely fixed by this strategy document.

The file and tracker divisions are implemented by Tacticals `041` and `043`.
The accepted global Disk and selected-torrent Canvas Pieces direction is owned
by [`disk-and-piece-inspection`](disk-and-piece-inspection.md) and Tacticals
`044`--`045`.

## Relationship To Engine Work

The oracle-driven campaign resumed on 2026-08-02 for the accepted
maximum-throughput storage sequence. Its comparator, source discipline,
correctness ledger and retained bottleneck remain valid, while the implemented
Disk and Pieces views provide the typed inspection surface needed to split
hash, checkpoint-sync and commit stages as that architecture lands.

Tactical `033` completed the bounded view-set contract and headless client
foundation described in
[`application-view-api.md`](application-view-api.md). Tactical `034` built
the responsive presentation and permanent named scenario adapter first, so
the stable peer projection and its adversarial fixtures can connect to a
tested frontend model rather than defining component architecture indirectly.
Tactical `035` now completes that connection. The production React build is
driven headlessly against a controlled peer, displays active request state,
recovers after its old server view expires, verifies the downloaded payload,
and removes the connection row after joined cleanup without launching Tauri or
a visible browser. Tactical `037` drives the same proof from the toolbar rather
than a raw HTTP command, including responsive and accessible intake behavior.

Tactical `043` makes the Trackers tab a live product and debugging surface
without scraping tracker log messages. A delayed controlled announce proves
that an in-flight operation is visible before its response, then shows the
accepted swarm counts and next deadline while the torrent completes. Table
columns and widths share the existing versioned preferences and exact sorting.
Shared tables re-sort on live updates, holding the current row order for two
seconds after pointer, scroll, or keyboard activity in the table, until a
mouse leaves it, or while a row menu is open; the sort arrow dims while the
held order differs from the live sort. This replaced the earlier opt-in
re-sort checkbox. The phone detail keeps the URL and
status useful while fully hiding the inactive library pane.

The surface is therefore useful for live peer, retained-swarm, file, tracker,
piece, global disk, DHT, and structured diagnostic observation. A controlled
libtorrent transfer proved real tracker context and merged tracker-plus-magnet
Swarm provenance through the same console and shared pull/stream reducer
without launching a visible client. The session-scoped Speed view is
implemented by Tactical `066`, the DHT observatory is implemented by Tactical
`065`, and the existing oracle campaign remains the source for the next
engine-correctness slice.

Tactical `104` additionally makes torrent ETA truthful on this same shared
surface. A production-preview headless Chrome run traverses estimated,
warming, unavailable, and stalled rows at wide and Compact presentation sizes,
then verifies the phone-width ETA column rule and empty serious/critical axe
results. The proof launches neither a visible Tauri window nor a second ETA
owner; the same generated state drives browser and embedded desktop shells.
