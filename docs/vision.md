# Product Vision: JSTorrent Rebuilt Around A Native Engine

Status: JSTorrent succession selected on 2026-09-30; desktop 0.3.0 is public.
RSTorrent releases are frozen by maintainer direction on 2026-10-11. Remaining
platform qualification and store delivery follow their owning topics.

## Thesis

RSTorrent is the independent Rust implementation behind the selected next
generation of JSTorrent. The successor will ship under the JSTorrent name with
its existing icons, preserving familiar workflows while refreshing presentation.
This supersedes the earlier foreseeable independent RSTorrent release direction.

The intended desktop result is a normal JSTorrent update retaining
`com.jstorrent.desktop` and its existing updater trust root. Android updates the
existing `com.jstorrent.app` Play app with package/signing continuity. The
extension updates the existing production Web Store item using this repository's
implementation. Their updates may arrive independently. JSTorrent is the sole
active release identity and already uses its established desktop signing key.
Historical RSTorrent packages/routes are frozen compatibility infrastructure;
isolated debug identities, crate and protocol names are implementation details.

The `JS` in JSTorrent describes the project's origin, not necessarily a
permanent implementation constraint or a promise users depend on. The durable
meaning of the brand is closer to "just torrent": an approachable client and
engine with unusually good platform, browser, and application integration.

## Product Promise

The successor should preserve and improve the qualities that made JSTorrent
valuable:

- simple installation and operation for people who do not want to administer a
  torrent daemon;
- first-class desktop, Android, ChromeOS, and eventual iOS experiences;
- excellent browser and web integration;
- useful automation and integration surfaces;
- understandable diagnostics and support behavior; and
- one coherent product rather than several loosely conforming engines.

This is not a Rust rewrite for its own sake. Rust is the means to make one
first-party engine own networking, protocol state, hashing, scheduling,
persistence, and hot-path data movement across supported native products.

## Intended Product Shape

Native clients should normally run the engine in-process:

```text
Desktop UI ─────────── in-process adapter ─┐
Android UI ─────────── in-process adapter ─┼──> typed application service
iOS UI ─────────────── in-process adapter ─┤              │
CLI and automation ─── in-process adapter ─┤              │
Browser extension ── authenticated control ┘              ▼
                                                  Rust torrent engine
```

The extension is ultimately a first-party control and integration surface, not
a second torrent engine. It may add torrents, present state, initiate actions,
integrate browser workflows, and surface results. Peer sockets, piece payloads,
hashing, scheduling, and ordinary file I/O remain in the native engine.

The exact extension transport is deliberately undecided. Native messaging,
local authenticated IPC, or another narrow control mechanism requires an
explicit architecture and security decision. The vision does not authorize a
generic socket proxy, filesystem proxy, public daemon API, or REST/WebSocket
service during engine bring-up.

The accepted graduation-level separation between native backends and
detachable presentations, including desktop extension use, the two isolated
ChromeOS backends, their three UI configurations, launch handoff, and later
JSTorrent graduation, is recorded in
[`topics/product-surfaces-and-migration.md`](topics/product-surfaces-and-migration.md).
That direction does not make extension or migration work part of the current
engine tactical.

## Incubation And Graduation

The separate RSTorrent name and repository originally created room to build
deeply without destabilizing JSTorrent or treating its internals as compatibility
constraints. The Rust implementation now occupies the canonical JSTorrent
repository and the independent RSTorrent release track is frozen.

The original progression was:

1. Build and validate the engine under the RSTorrent working name.
2. Ship an explicitly experimental native client to learn from real use.
3. Establish reliable desktop and Android/ChromeOS products around the same
   engine, while front-loading physical iOS storage and lifecycle constraints
   that could otherwise fracture that engine.
4. Scope a best-effort legacy-state transition and browser-extension control
   boundary from proven application contracts.
5. Graduate the implementation into the JSTorrent product and brand when it is
   safer and more useful than the engine it replaces.
6. Retire legacy engine paths deliberately rather than maintaining two product
   architectures indefinitely.

This is product succession, not a line-by-line port. Early RSTorrent tacticals
do not inherit JSTorrent feature parity, API compatibility, persistence
compatibility, or UI reproduction as acceptance criteria. Compatibility work
is added only when it serves an actual graduation path.

## Graduation Evidence

The name or default engine should not change merely because a demonstration
works. Graduation should be supported by evidence that includes:

- reliable downloading, seeding, verification, resume, and recovery for the
  deliberately supported protocol surface;
- interoperability against mature clients and real swarms;
- bounded resource use and measured hot-path performance;
- actionable diagnostics and support tooling;
- physical Android/ChromeOS lifecycle and storage validation;
- physical iOS storage, direct-networking, and lifecycle feasibility before a
  complete iOS product is planned;
- stable application contracts used by more than one first-party client;
- a reviewed, best-effort transition for the legacy state judged valuable at
  graduation time;
- a secured and lifecycle-aware extension control channel, if the extension is
  part of that release; and
- evidence that the replacement travels through JSTorrent's established
  application and updater identity without corrupting retained user state.

Native performance and a single shared engine are strong architectural
advantages, but performance and reliability claims should be measured rather
than assumed.

## What This Vision Does Not Require

- Renaming the repository or internal crate and protocol names.
- Concealing an experimental engine behind the stable JSTorrent release.
- Reproducing the current TypeScript module graph or process topology.
- Removing TypeScript, Kotlin, or other appropriate UI and integration code.
- Building the browser extension before native application contracts exist.
- Turning the native engine into a general-purpose remote daemon.
- Preserving every historical feature before the new client is useful.
- Exhaustive migration of every historical setting, profile, or runtime
  detail.
- Ending maintenance of the current JSTorrent product before a responsible
  transition is available.

## Open Product Questions

- The qualified production cutover date and rollout/stop criteria.
- Which legacy settings and torrent state are valuable and practical enough to
  migrate on a best-effort basis.
- How an existing extension discovers, authenticates, and coordinates with the
  native product.
- Which web integrations belong in the extension, local application API, or
  product UI.
- How long the current and successor implementations should coexist.

These questions should be answered from working engine and client evidence.
They are not prerequisites for the first protocol bring-up tactical.
