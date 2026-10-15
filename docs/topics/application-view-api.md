# Application View API

Tactical [357](../tactical/357-rich-share-links.md) gives `export_magnet`
optional `options` (`include_size`, `file_indices`, `peer_hint`) and adds
`peer_hints` and `peer_hint_omission` to its result. Without options the
export is unchanged. `TorrentView.source_size_bytes` carries a magnet's `xl`
until metadata is recorded. Hosts older than this contract ignore `options`.

Tactical [353](../tactical/353-host-product-in-hello.md) adds an optional
`ApiHello.product` (`ApiProductInfo`): host kind, version, source build ID,
target, application identifier, profile ID and durable profile location.
Desktop, headless, the gateway (including Crostini) and Android report it
from `ApplicationConfig.product`; the service adds the profile fields. These
facts are fixed for the process lifetime, so they live in the hello rather
than a separate call. Web clients bound each string and read the hello again
after every reconnect. Android's `AndroidApplicationConfig` gains
`application_id`.

Tactical [350](../tactical/350-share-links-and-private-hint.md) adds
`TorrentView.private_torrent` and `TorrentFieldUpdate::PrivateTorrent`. The
flag is true only when parsed, stored metainfo carries BEP 27 `private=1`,
and is omitted when false, so public torrents, magnets before metadata and
older readers are unchanged. Generated TypeScript, Kotlin and Swift carry it
as `privateTorrent`; no schema change.

Tactical [340](../tactical/340-windows-quiet-network-startup.md) keeps the same
contract while qualifying Windows settings and runtime observations. Configured
incoming, socket binding, forwarding result and observed reachability remain
separate from unknown OS permission. Native Cancel leaves settings intent intact;
Off still removes intake without disabling outbound UDP. No generated type or
permission-state field is added.

Tactical [339](../tactical/339-macos-quiet-network-startup.md) keeps the existing generated contract: saved
incoming/UPnP preferences, effective listener/UDP state and DHT state remain
separate. Mac idle discovery demand changes effective DHT participation without
rewriting its saved preference. No OS permission grant is inferred from settings
or a successful bind. Android uses the same incoming-Off semantics and existing
observer boundary; its defaults and presentation are unchanged.

Tactical [335](../tactical/335-removal-pieces-and-disconnect-lifetime.md)
replaces Pieces with an empty snapshot when its torrent disappears and with a
fresh snapshot when piece geometry changes. This discards pending patches for
the old geometry before publishing new bounds. Sparse verified ranges and active
attempts clear together; strict client range validation remains unchanged.

Tactical [314](../tactical/314-android-presentation-shutdown-race.md) makes the
Android presentation adapter terminal after close and retains ownership during
partial subscription setup failures. Acquisition and closure share the existing
mutex; cancellation remains explicit. View semantics and generated contracts
are unchanged. The local repair is separate from delivery to installed clients.

Tactical [308](../tactical/308-android-optional-add-selection.md) adds the
closed `download_all_pending_add` command carrying the opaque torrent ID.
It applies exclusively to a newly pending add and accepts no catalog or file
indices. Tactical [323](../tactical/323-pre-metadata-skip-file-selection.md)
adds a serde-defaulted `disable_future` flag; only when true does it also
turn off future file selection, atomically with the add. Existing snapshots clear pending state
and retain authoritative metadata availability. TypeScript/schema, Kotlin and
Swift boundaries are regenerated; only Android exposes the new action.

Tactical [277](../tactical/277-android-observer-listener-readiness.md) repairs
qualification of269's asynchronous listener startup. Source8c CI and a focused
local reproduction fail the immediate optional snapshot. The unchanged
maintenance owner applies settings asynchronously; the test now observes actual
readiness within five seconds. All15 Android Rust boundary cases, focused
all-target clippy and workspace formatting pass. Protocol, generated boundary
and shipping behavior are unchanged; the original hosted failure remains open
until revised-source CI is authorized and run.

Topic: `application-view-api`

Tactical [269](../tactical/269-android-incoming-peer-diagnostic-evidence.md)
is complete locally at application sourceaeaa72f9:15 Android Rust cases/clippy,
normal original-key dual-ABI packaging,122 JVM cases/lint and actual bounded
physical incoming snapshots pass. Full workspace1575 cases/fmt/clippy and
web typecheck/470 cases also pass, with existing ignores/skips retained.
The original failed probe observes zero then one native registration and two
UnknownTorrent rejections for exactly its owned hash; it started before actual
admission. Tactical270 is complete locally: fresh UID/exact-fixture registry
readiness precedes independent upload. Both current-source original large
fixtures verify/upload all28 MiB with120 empty files, retained diagnostic
history/actual filters, joined shutdown and actual reopened Live/owned row,
unchanged SAF registry/payload and cleanup. Readiness takes107.99/166.16 seconds.
All48 portable cases pass; earlier failed receipts remain scoped and intact.
Normal diagnostic warnings intentionally remain across category filters. No
engine/network/admission/retry policy changes. Both full current-APK default
runs subsequently pass under259/273; managed and broader physical acceptance
remain separate.

Both current-APK physical default runs now pass three cold repetitions, the
3,600-second detached hour, full independent 40-MiB download/upload hashes,
retained Warning/Info filters, joined actual Live/owned-row reopen, unchanged
SAF registry/payload and cleanup. Both also pass all seven current-APK recovery
cases. A retains its older fixed 120-second upload driver; B's fresh repeat loads
source `840f421d`/driver `51883b67` with a 172-second upload and one native display wake
inside the original 120-second reopen budget. B's first whole reopen failure
remains recorded unchanged. No managed Play, physical reboot/provider/network/
sleep or final signed desktop/store/public acceptance is inferred.


Both source0aa physical cohorts independently hash the installed APK and pass
small foreground/background/reopened upload plus joined Live-library restart,
retained SAF registry and cleanup. This closes Tactical260's bounded local
shutdown evidence, not the failed large-metadata/hour or managed delivery gates.
Tactical266's restored native retained history/Live-library component also passes
both cohorts. Whole upload receipts remain failed; severity/category button
changes alone cannot prove asynchronous filtering. Tactical267 now checks actual
visible filtered rows, with26 passing portable driver cases.

Tactical [266](../tactical/266-android-diagnostic-history-resynchronization.md)
repairs Android's diagnostic-only queue after a real 581,079-byte history cannot
resynchronize through 256 KiB. Source `2adf2eb1` requests the existing 4-MiB
subscription bound for retained history (2 MiB / 2,048 events); Kotlin still
retains 512 rows. The real retention regression rejects the old budget, delivers
473,255 bytes and resynchronizes unchanged history. Normal original-signed and
isolated dual-ABI builds, 121 release JVM cases, lint and independent package
checks pass. Full session checks pass 387 cases with two existing ignores.
Bounded physical retained-history/Live return passes; large-fixture upload
and managed delivery remain open under259/267. No store upload occurs.

Tactical [267](../tactical/267-physical-upload-and-reopen-evidence.md) strengthens
actual upload transport/readiness/counter and observed retained-settings
navigation evidence. Both source-376 physical runs pass their full 3,600-second
background transfer and whole 40-MiB hash; their subsequent upload phase fails.
No complete end-to-end pass is inferred. Portable delayed-listener/failure
ownership/refusal tests pass; short current-APK trials run before full retries.
No engine/network/seeding policy changes or inherited app/data cleanup occurs.

Tactical
[253](../tactical/253-chromeos-onboarding-recovery-and-physical-qualification.md)
keeps the native companion wire/API unchanged. The page owns bounded discovery
and a validated 1..120-second approval window; Cancel joins its transport/view
owner and explains the separately owned Android request. Real cohort-A
approval/rejection/declared-window expiry, disconnect/manual retry and
shared-library recovery are bounded candidate-page passes. The Linux page uses
the unchanged product/build/protocol health endpoint before handing off to the
existing product UI. Normal Terminal startup restores missing Linux registration,
and an isolated current browser now connects and verifies file-picker intake.
Runtime-only hour/repetition evidence retains its original limit; store and
signed installed handoff remain open.

Second-cohort Tactical 253 evidence exposed a completion/cleanup ordering bug:
active seed admission could coexist with a downloading operational state.
Completed admission now precedes the old content-task flag, and task-progress
cleanup preserves the admission owner's fact. The strict browser contract is
unchanged. A three-admission regression covers active, inactive-exempt and queued
seeds through cleanup; the rebuilt physical Android candidate stays connected
at completion with independently verified bytes, including a full 3,600-second
controlled observation and stable 40 MiB completed view. Store delivery and the
Linux browser journey retain their separate qualification limits.

Tactical [244](../tactical/244-unavailable-storage-presentation.md) corrects
shared React adaptation of `awaiting_storage`: blocked progress becomes Needs
attention with a Storage unavailable table label; active storage preparation
retains active membership. Existing typed progress and operational state remain
authoritative. Application DTOs, persisted run intent, root health and checker
behavior are unchanged. Adapter/category/component and migration regressions
pass; Android Compose uses operational state and does not share this mapping.

Tactical [`236`](../tactical/236-desktop-compatibility-refusal-and-recovery.md)
reuses existing version/schema and desktop capability checks without changing
DTOs or protocol versions. Incompatible desktop hello/schema failures close the
connection and stop automatic page retries; manual recovery only attaches.
Product-version strings are not used as a compatibility guarantee.

Tactical [`232`](../tactical/232-desktop-extension-control.md) reuses existing
commands, library views and acknowledgements for desktop extension control.
No generated DTO changes are needed. Its hello identifies `desktop`, the sole
`default` profile and a fresh runtime instance with `desktop_control_v1` and
`desktop_root_picker_v1` on qualified Linux, Windows and macOS desktop builds.
Media capability is withheld and media-URL
creation is rejected until that surface has its own acceptance evidence.

Tactical [`234`](../tactical/234-desktop-user-intent-and-background-lifecycle.md)
retires desktop-control view sets when their authenticated connection ends,
after joining calls and attachment pumps and before admitting a same-client
replacement. Desktop pages rebuild views on attachment; retaining abandoned
sets for the five-minute lease exhausted the global limit during rapid reloads.
Cleanup includes unattached sets and affects only the departed owner. Other
transports retain resumable leases, and native-window views remain independent.
The 32-set global/eight-set owner limits and application wire contract do not
change.

Tactical `216`'s local support export consumes only the existing client-side
updater snapshot and emits its own bounded allowlist. It changes no generated
application DTO, selector, leased-view delivery, acknowledgement or Rust/native
ABI. Raw application/log values are not an export authority.

Status: Direct-storage contract replacement completed on 2026-08-29 by
Tactical [`191`](../tactical/191-direct-filesystem-storage.md). It removes
publication-only states, progress, reasons, media availability, and
managed-deletion values from the generated view/command schema without a
compatibility alias. Existing checking, root health, verified-range,
wanted-completion, seeding, and repair facts are the sole authority. Earlier
generated-contract history below remains as an implementation record.

Completed Tactical
[`202`](../tactical/202-android-progressive-media-playback.md) changes no view
DTO, selector, cursor, reducer, or delivery rule. Android exposes the existing
typed semantic `create_media_url` result through UniFFI and consumes the
complete ephemeral URL internally in Media3. Play eligibility still comes
from authoritative file availability and classifier facts; no payload bytes,
capability token, player state, or Android lifecycle fact enters a view.

Completed Tactical
[`201`](../tactical/201-durable-seeding-goals-and-seed-admission.md) adds
schema-23 seeding truth without changing view ownership. The generated
settings snapshot and sparse patch carry active seeds plus three priority
thresholds; runtime settings carry effective active seeds and active/inactive
counts. Torrent rows carry exact decimal-string lifetime payload/timer values,
derived goal facts, and active/queued seed state. Rust, TypeScript, and Kotlin
reducers plus the generated Swift binding round-trip full snapshots and sparse
updates; clients do not derive rank or infer that goal completion stops a
torrent.

Tactical
[`199`](../tactical/199-android-live-unmetered-network-enforcement.md) adds one
typed `WaitingForUnmeteredNetwork` progress reason plus truthful requested and
effective application prerequisites, temporary session-network suspension,
and DHT suspension state. The generated view remains a projection of
application-owned platform-neutral truth: clients do not parse Android
capabilities, infer eligibility, or receive a portable command that can
override the Android-only preference. Fixed-policy `NetworkDisabled` remains
distinct.

Completed Tactical
[`193`](../tactical/193-stateless-foreground-downloader.md) changes no view
DTO, selector, cursor, delivery, acknowledgement, or generated binding. Its
finite CLI leases one Summary projection, reduces normal snapshot/update/reset
traffic, renders bounded human progress, and requests one ordinary application
snapshot only after the view indicates a terminal candidate. Completion and
failure remain application facts rather than CLI inference.

Completed remote-foundation Tactical
[`190`](../tactical/190-opaque-wasm-relay-foundation.md) changes no view DTO,
cursor, acknowledgement or reducer rule. Its controlled encrypted relay trace
uses the existing application WebSocket client and `ViewController`; direct
and relayed negotiation, initial snapshot, view replacement/update, exact
acknowledgement and benign command reduce identically across three observed
states. Bulk attachment and media breadth remain outside that proof. Completed
Tactical [`192`](../tactical/192-production-owner-relay-access.md) adds a
bounded remote-security control profile for authorized clients, live circuits
and the complete security ledger in a loopback-only validation composition.
It deliberately does not add authority or credential material to generated
torrent view DTOs; those values remain owner semantics rather than properties
inferred from a WebSocket, and no public delivery claim follows.

Completed Tactical
[`143`](../tactical/143-dual-identity-and-persistence-foundation.md) changes
every torrent route and view key to canonical opaque `TorrentId` and adds a
separate optional full v1/v2 identity projection. Regenerated schemas,
TypeScript, reducers, validators, and stale-ID rejection pass without changing
the view protocol version. Completed Tactical
[`151`](../tactical/151-complete-source-pure-v2-runtime-vertical.md) carries
strict complete-source pure-v2 rows through the same torrent, progress, Files,
tracker, command, and event projections. No v2-specific DTO or API version
change was necessary; the optional v2 identity and opaque route remain the
only format-specific client facts. Completed Tactical
[`155`](../tactical/155-v2-magnet-authenticated-hash-exchange.md) carries
pure-v2 magnet metadata, hash waiting/recovery, selected progress, restart,
export, and completed seeding through those same commands and views, again
without a v2-only DTO or protocol-version change. Completed Tactical
[`156`](../tactical/156-hybrid-dual-swarm-runtime-closure.md) carries one
hybrid owner as one torrent row with optional full v1 and v2 identities. Dual
topic reconciliation, selection, progress, Files, Force recheck, export,
restart, upload, seeding, and removal reuse the same commands, snapshots, and
events; discovery-lane diagnostics add typed version/phase fields without a
view protocol-version or hybrid-only DTO change. The bounded leased view-set,
authenticated JSON polling adapter, pure reducer, and lifecycle controller are
implemented by
[`033-headless-view-set-foundation.md`](../tactical/033-headless-view-set-foundation.md).
Completed desktop-notification Tactical
[`164`](../tactical/164-desktop-completion-and-attention-notifications.md)
consumes the existing in-process torrent-list subscription in a native Rust
edge reducer. It adds no view kind, field, generated contract, browser event,
or mobile obligation; initial and reset snapshots establish a non-replaying
baseline while ordinary patches remain authoritative input.
Completed sleep-inhibition Tactical
[`165`](../tactical/165-cross-platform-active-download-sleep-inhibition.md)
consumes the same existing torrent-list subscription as a separate native
level reducer. Authoritative `operational_state` is sufficient, so the slice
adds no view kind, field, generated contract, browser event, or mobile API.
Unlike notification edges, an initial or replacement snapshot may immediately
restore the current inhibitor level.
Completed Tactical
[`072`](../tactical/072-derived-media-catalog.md) adds the separately leased
`torrent_media` projection. One immutable derived catalog per verified
metainfo joins the existing authoritative file-progress model into typed video
and episode rows; classification remains rebuildable and outside persistence.
Generated TypeScript/schema and Kotlin/Swift UniFFI boundaries plus all
first-party reducers consume the new snapshot and complete-row patch without
adding native presentation.
Tactical `034` implements the per-application Zustand store and React
inspection model against a deterministic adapter. Tactical `035` adds stable
Rust torrent and active-peer projections, semantic responsive view selection,
independently reaped leases, and browser-suspension recovery through the live
React adapter. Tactical `041` adds the complete selected-torrent file catalog,
distinct stored and verified progress, and a separately bounded large-snapshot
path. Tactical `043` adds the selected torrent's authoritative tracker
lifecycle as bounded keyed rows. Tacticals `044`--`045` add global storage
pressure and selected-torrent verified/active piece views, including keyed
attempt diffs and fresh-epoch bitmap replacement. Tactical `048` makes pull
and stream interchangeable TypeScript delivery capabilities and implements
acknowledged Tauri Channel delivery against the same leased view sets,
controller, reducer, and Zustand transaction. The existing Tactical `008`
subscriptions remain compatibility adapters. Tactical `060` now implements
one multiplexed WebSocket for every ordinary browser call and view stream,
with HTTP retained only as an explicit loopback diagnostic. Binary encoding
remains deferred, and no stable public remote wire compatibility is claimed.
Tactical `049` completes the diagnostics specialization: hierarchical
categories, structured bounded subjects and fields, capture interest,
separate source/delivery/local loss semantics, and one ordered console over
the existing view-set path.
Completed Tactical
[`180`](../tactical/180-typed-settings-patches-and-draft-convergence.md) keeps
complete rows and fresh reset snapshots as valid authoritative input while
making settings drafts survive unrelated live updates until a command receipt
and sufficiently new view converge. Its owning
[`settings-mutation-and-draft-consistency`](settings-mutation-and-draft-consistency.md)
topic keeps structural sharing, field masks, and snapshot/response payload
reduction as a separate measured follow-up.
Completed Tactical
[`114`](../tactical/114-session-wide-concurrent-torrent-admission.md) extends
the existing torrent and client-settings projections without adding a view
kind. Torrent rows carry authoritative operational state and stable one-based
queue position; settings carry configured/effective active-download limits,
platform clamp reason, active count, and checking count. Generated TypeScript,
schema, validators, React/Tauri consumers, and Android UniFFI/Kotlin bindings
all use those same facts; no adapter derives scheduler state locally.
Tactical `051` adds an optional, defaulted, closed `PeerFlagView` set to active
peer rows. Rust computes semantic connection state while clients retain
presentation-only glyph ownership; old v1 producers that omit the field remain
accepted through a bounded typed-fact fallback.
Tactical `056` completes the existing nullable active-peer `client_name`
projection from the handshake peer ID. The Rust protocol utility owns bounded
fingerprint parsing, the application view owns capability state, and clients
continue to render the generated field without a competing parser or a
contract-version change.
Tactical `057` adds a retained producer-throughput matrix over the exact
production view combinations. It changes no semantic API, but makes observer
cost, serialized update volume, queue high water and reset recovery explicit
hardware-profile evidence.
Tactical `081` extends tracker rows with truthful metainfo source and
HTTP/HTTPS configured-but-unsupported state while keeping credential-bearing
URL components out of the projection. It also replaces the former complete
4,096-file and 32-tracker snapshot assumptions with bounded pages carrying a
total count and stable offset, so accepted libtorrent-scale catalogs do not
require one rendered snapshot or whole-catalog patch. The existing 16-MiB
snapshot ceiling is a page bound. It does not make the view or
diagnostics the tracker configuration authority.
Tactical
[`084`](../tactical/084-persisted-client-connection-and-seeding-settings.md)
adds one small complete-replacement client-settings projection to the existing
always-present torrent-list view. It distinguishes configured intent from
active/effective listener and limit state without adding a named view, lease,
queue, task, or persisted runtime observation.
Completed Tactical
[`086`](../tactical/086-long-lived-torrent-peer-runtime.md) changes no public
view kind: it moves ordinary peer publication into a long-lived per-torrent
owner and now populates the existing Peers/Swarm contract from routed incoming
seed connections. Authenticated gateway interoperability follows pinned
libtorrent and RSTorrent rows through transfer, exact removal, pause, and
joined terminal cleanup.
Tactical [`088`](../tactical/088-upnp-mapped-external-tcp-seeding.md) extends
the same complete client-settings value with typed port-mapping policy and
runtime status. Status changes publish ordinary torrent-list settings patches;
the view owner retains no socket, gateway, mapping, renewal, or task authority.
Tactical [`089`](../tactical/089-coordinated-session-listen-sockets.md) adds
the durable preferred listen port and an observed `session_udp_status` to that
same value. The latter reports actual address, port, and whether its numeric
port is coordinated with the live TCP listener; generated validators reject a
false coordination claim. The view still owns no socket or runtime task.
Completed Tactical
[`097`](../tactical/097-live-client-settings-and-replaceable-session-generations.md)
replaces the monolithic
configured/active/restart-required shape with
configured intent, effective transport/mapping/admission/slot state, and
per-domain applying/applied/degraded status. Runtime owners remain producers;
the existing torrent-list view remains a task-free complete replacement and
gains no command or retry authority. Generated TypeScript, JSON Schema,
validators, fixtures, React presentation, and the Android reducer fixture use
the new shape. Settings-attempt and mapping generations fence late producer
events, and controlled live convergence proves the view cannot restore stale
effective facts after a newer desired save.
Completed Tactical
[`092`](../tactical/092-truthful-tracker-and-dht-peer-advertisement.md) extends
that complete value with selected advertisement source and outbound-only,
local, mapped, renewal-unhealthy, and stopping meanings. The producer remains
authoritative; clients do not infer reachability from configured or UDP ports.
Generated TypeScript/schema and UniFFI/Kotlin compile checks pass. The React
connection/seeding settings section renders every state, while Android carries
the typed value without adding Compose settings UI.
Completed Tactical
[`095`](../tactical/095-bounded-http-https-tracker-transport.md) adds a closed
tracker-security value to the existing paged tracker row. HTTP is
`unencrypted`; HTTPS is `encrypted_unauthenticated` until certificate and
hostname validation lands. Generated TypeScript/schema, React, UniFFI, and
Kotlin consumers carry that distinction without adding a view kind, task,
queue, inferred security rule, or contract-version change.
Completed Tactical
[`096`](../tactical/096-metadata-tracker-activation-and-family-observability.md)
adds the volatile last successful tracker connection family as only `ipv4` or
`ipv6`. The schedule owns this diagnostic fact, and presentation does not
infer it from URL spelling or returned peers. No DNS answer, socket address,
source address, interface, or peer address enters the application contract.
Completed Tactical
[`098`](../tactical/098-authenticated-https-tracker-platform-trust.md) expands
tracker security to `unencrypted`, `encrypted_system_trust`, and
`encrypted_unauthenticated`, and adds one tracker-authentication application
domain to the existing complete client-settings value. The domain separately
reports configured intent, optional effective policy, and
applying/applied/degraded state. A tracker row retains the policy captured by
its current or last operation rather than inferring security from the current
global setting or an HTTP outcome.
Completed Tactical
[`104`](../tactical/104-selection-aware-torrent-eta.md) implements the
torrent-list contract addition: nullable exact required/remaining payload
bytes before metadata, a separate exact smoothed ETA payload rate, and a
tagged warming/estimate/stalled/unavailable ETA. A single joined
application-wide cadence advances constant-space per-torrent scalar state;
generation changes reconstruct from verified have state, and neither the
engine nor clients own the calculation.
Completed Tactical
[`108`](../tactical/108-serialized-torrent-control-and-observable-checking.md)
adds one optional generation-scoped checker summary to the existing
torrent view rather than overload durable verified progress. It distinguishes
queued, preparing, hashing, storage reconciliation, paused, and finalizing;
publishes monotonic processed/matched/absent/mismatched counters; and provides
bounded active-job liveness at no more than one hertz. Runtime owners remain
authoritative and heartbeat state is not persisted. ViewHub generation-fences
completion, preserves queued/paused reconstruction, and carries the optional
summary through the generated Rust, JSON Schema, validator, and TypeScript
contract without changing the established v2 view-contract version.
Tactical
[`111`](../tactical/111-mse-peer-stream-encryption.md)'s implemented slice
extends the same complete client-settings value with configured/effective
encryption policy and independent applying/applied/degraded state. It also
fills `PeerFlagView::Encrypted` from a coherent connection observation for
either MSE payload method. Completed follow-up Tactical
[`115`](../tactical/115-mse-policy-advertisement-and-peer-detail.md) adds an
optional closed `PeerMseMethodView::{PlaintextPayload, Rc4}` value from that
same observation. The flag remains the compact semantic fact; the method is
quiet detail, and typed handshake failures remain diagnostics. No view kind,
contract-version bump, lease, queue, cadence, task, or client-side inference
is added.
Completed Tactical
[`112`](../tactical/112-dual-stack-transport-and-ipv6-dht.md) extends the same
complete client-settings value with configured/effective IPv6 policy and its
independent applying/applied/degraded state. Per-family transport and
advertisement facts remain producer-owned; clients do not infer availability
from configured intent or a port. The existing DHT view keeps its kind and
bounds while each active family supplies an independent node observation. No
view-contract version, lease, queue, cadence, task, or client-side address
policy is added.
Closed evidence-limited Tactical
[`113`](../tactical/113-ipv6-firewall-pinhole-and-incoming-reachability.md)
adds a sibling `ipv6_pinhole_status` to that complete client-settings value
without widening or reinterpreting `port_mapping_status`. The closed status
distinguishes policy-disabled, listener-ineligible, discovery and service/
action availability, gateway-unfiltered, creating, active finite lease,
renewal failure, cleanup failure, generic failure, and stopping. It carries
only the selected IPv6 address, listener port, lease timing, and bounded fault
detail appropriate to the phase; the gateway-assigned pinhole ID and control
URL never cross the application boundary. The view owns no socket, lease,
retry, discovery, or cleanup work.

Completed Tactical
[`140`](../tactical/140-incoming-utp-reachability.md) adds sibling
`udp_port_mapping_status` without widening or reinterpreting the compatible
`port_mapping_status`, which remains TCP. Both use the same closed bounded
status shape and independently report their actual listener target, verified
external port, renewal, failure, and stopping state. The generated TypeScript,
JSON Schema, validators, React settings UI, UniFFI, and generated Kotlin carry
the field; older decoded fixtures default the additive UDP fact conservatively.
Clients own no lease or endpoint inference, and one persisted `Upnp` policy
still controls every eligible concrete product listener transport.

Completed Tactical
[`134`](../tactical/134-hierarchical-transfer-rate-enforcement.md) extends the
same complete settings value with configured/effective upload and download
limits, independent bandwidth application state, and bounded upload/download
allocator observations. Existing torrent rows and snapshots carry their
configured `TorrentTransferLimits` pair. Runtime owners remain producers;
views own no quota, timer, waiter, retry, or effective-policy inference, and
the generated contract version remains unchanged.

Completed Tactical
[`138`](../tactical/138-verified-http-file-serving.md) adds one closed
`MediaFileAvailability` fact to each paged file row. The application producer
derives it from metainfo, lifecycle, durable verified pieces, publication,
and root state; clients do not infer eligibility from progress counters or
selection. The ephemeral URL is returned only by a semantic call and never
stored in a view, patch, request receipt, or durable snapshot. No view kind,
lease, queue, cadence, or contract-version change is added.
Completed Tactical
[`139`](../tactical/139-incomplete-file-streaming-demand.md) adds
`streamable` to that closed fact without making progress percentage or a
sparse file sufficient evidence. The producer requires the exact active
download, Normal selection, live storage route, available root, and admission
state. A stale row can still lose authoritative eligibility before the
semantic call; no demand ID, capability, URL, wait state, or scheduling detail
enters a view.

## Purpose And Scope

The desktop inspection surface needs a recoverable, typed local replica of the
application state currently relevant to one UI. The same semantics must work
through an in-process Tauri adapter, a headless browser gateway, periodic
polling, and low-latency streaming without making transport or encoding
choices part of the application model.

This topic owns:

- named application views and their client-selected identities;
- view-set ownership, lifecycle, cursors, leases, and resource bounds;
- snapshot, keyed-diff, reset, and recovery semantics;
- the separation between semantic API, delivery transport, and wire codec;
- generated TypeScript types and runtime schema validation;
- provisional remote URLs and in-process equivalents; and
- the headless evidence required before the React inspection UI depends on
  the contract.

[`application-control.md`](application-control.md) owns commands, durable
application revisions, and the application-service authority.
[`application-connection-architecture.md`](application-connection-architecture.md)
owns multiplexed WebSocket calls and view attachments, IPC adaptation and
future encrypted relay layering.
[`client-view-delivery-policy.md`](client-view-delivery-policy.md) owns
client-selected cadence, low-bandwidth and background policy, and the evidence
required to calibrate those choices.
[`web-ui-design.md`](web-ui-design.md) owns React, Zustand, presentation state,
and rendering. [`client-surfaces.md`](client-surfaces.md) owns the platform
adapters and their lifecycle.

This topic does not authorize a production remote daemon, LAN listener,
account system, TLS or pairing design, payload transport, or public
compatibility promise. It also does not define archive, deletion, queueing, or
label command semantics merely because future views may present those
concepts.

## Terminology

Use **view set**, not **view session**, for the short-lived server-side state
that supports one UI instance. `Session` is already overloaded by the
BitTorrent engine, application-service lifetime, and remote authentication.

A view set is:

- a set of named projections currently requested by one client;
- the materialized producer state needed to calculate their diffs;
- one bounded pending-update accumulator;
- an epoch and opaque consumption cursor; and
- a leased, explicitly closable application resource.

A view set is not authentication, durable user data, or the engine session.
Its identifier locates a resource but never grants authority to use it.

Tactical `192`'s remote-security snapshot follows the same authority rule but
is not a leased torrent view. An authenticated adapter explicitly fetches one
coherent, bounded snapshot containing client/circuit IDs, labels,
authentication method, timestamps, expiry, route/build observations, a
non-authorizing public-key fingerprint, current/revoked state and the complete
bounded ledger. The encrypted control response is capped at 4 MiB; fixed
registry ceilings keep it below that limit. No returned ID, client-supplied
label or **This browser** field is accepted back as proof of authority; the
verified transport context owns that distinction.

Every live remote circuit is projected even when a shared-browser password
login deliberately created no durable client authorization. That circuit uses
a bounded ephemeral marker and authentication method rather than inventing a
remembered-client record merely to make the table uniform.

## Accepted Architecture

There is one semantic API and several adapters:

```text
Rust application-view owners
          |
    snapshots and typed diffs
          |
       view set
          |
  +-------+------------------+
  |                          |
pull next updates      stream updates
  |                          |
HTTP / Tauri call      WebSocket / Tauri Channel
  |                          |
JSON first             JSON, then optional binary
  +-------------+------------+
                |
        validated UpdateBatch
                |
        pure TypeScript reducer
                |
         local client store
```

Polling and streaming consume identical update batches. JSON and a future
binary codec decode into identical TypeScript data transfer objects. Adding a
delivery mechanism or codec does not create a second application API.

The existing `ViewHub`, named projections, typed patches, per-subscriber
queues, epochs, sequence continuity, coalescing, and reset behavior are useful
foundations. The implemented successor aggregates the views visible to one
client into one view set and adds pull consumption. It evolves those owners
without making the earlier one-subscription-per-projection proof the future
public shape.

## Owner And Task Map

| Owner | Responsibility | Lifetime and termination |
| --- | --- | --- |
| Application view hub | Current projection source state and fan-out into view sets | One application-service instance; closes all view sets during joined service shutdown |
| View-set lease reaper | One timer that removes client-silent view sets independently from later requests | One application-service instance; cancellation and awaited join during service shutdown |
| View set | Desired view specifications, per-view materialization, epoch, cursor, and bounded accumulated updates | Explicit close, idle-lease expiry, idle eviction at a capacity limit, authenticated remote disconnect policy, or application shutdown |
| Transport adapter | Authentication context, framing, request bounds, and delivery of semantic calls | Tauri webview, HTTP request, or WebSocket connection lifetime; never owns application truth |
| TypeScript `ViewController` | Desired view set, current ID/epoch/cursor, one update consumer, reconnect/backoff, validation, and cancellation | One web application instance; closes or abandons its leased Rust view set |
| Pure client reducer | Atomic snapshot and patch application with continuity checks | No I/O or task lifetime |
| Zustand store | Materialized view values and presentation state consumed by React | One web application instance; contains no sockets, promises, or task handles |

Every polling loop, long poll, or stream pump belongs to `ViewController` and
has an abort signal plus observable termination. React components do not own
transport loops merely because they display a view.

## View-Set Lifecycle

Opening a view set accepts a bounded list of `ViewSpec` values. The service
allocates an opaque `view_set_id`, creates an epoch and cursor, installs the
per-view accumulators, and returns coherent initial snapshots:

```text
open_views(specs)
  -> view_set_id
  -> epoch
  -> cursor
  -> lease duration
  -> initial snapshot updates
```

For a remote adapter the identifier should contain enough random entropy to
resist guessing. The adapter associates it with the authenticated principal
and checks ownership on every operation; possession of the ID alone is not
authorization. An in-process Tauri adapter uses the same logical identifier
without introducing HTTP authentication.

The TypeScript controller keeps the identifier, epoch, and last applied cursor
in memory. A temporary transport interruption reuses them. A browser reload
opens a new view set; initially the identifier is not persisted in local or
session storage. Separate tabs receive separate view sets so their selections,
filters, and delivery pressure cannot interfere.

View sets live in process memory, not SQLite. Application restart invalidates
them and recovery begins from fresh snapshots. Abandoned sets expire after a
five-minute idle lease. One application-owned reaper must remove a set no
later than one bounded reaper interval after expiry, release its retained
state, and wake waiters without requiring another client operation. Only an
accepted client open, desired-view update, or new update request refreshes
`last_client_activity`; engine publication, coalescing, queue wakeups, replay,
and response generation never keep an abandoned set alive. Tactical `035`
replaced the foundation's opportunistic pruning with this active owner and
made its cancellation and join part of application shutdown.

Updating the requested specifications changes the existing view set. Added or
changed view snapshots enter its single ordered update feed; the configuration
response is only an acknowledgement. It does not create a competing second
state response. Removed views release producer state and produce an explicit
`view_removed` update at the correct cursor boundary.

The desired set follows the UI that is actually visible. A phone torrent
detail can request one selected summary and one active detail without retaining
the torrent list; a library surface can request the list without torrent
details. Removing a view evicts its materialized application data after the
ordered removal. Presentation navigation context is separate and may remain.

Only one update consumer drains a view set. Poll mode permits one in-flight
`next_updates` operation; streaming mode attaches one stream at the retained
cursor. Switching delivery modes detaches the old consumer before attaching
the new one.

Delivery is not destructively acknowledged merely because bytes were written
to a socket. In pull mode, the next request's `after` cursor acknowledges that
the preceding batch was validated and applied. Repeating a request with the
same `after` value returns a safe replay while it remains retained. In stream
mode, the adapter acknowledges the prior yielded cursor only when its consumer
requests the next item, using an explicit transport acknowledgement where
needed. Unacknowledged updates remain bounded; expiry or overflow produces a
reset rather than possible silent loss.

## Semantic Operations

The transport-neutral interface is conceptually:

```ts
interface ApplicationClient {
  hello(): Promise<ApiHello>;
  dispatch(request: CommandRequest): Promise<CommandResponse>;
  openViews(
    specs: ViewSpec[],
    options?: OpenViewsOptions,
  ): Promise<OpenViewsResponse>;
  updateViews(viewSetId: ViewSetId, specs: ViewSpec[]): Promise<void>;
  nextUpdates(
    viewSetId: ViewSetId,
    after: Cursor,
    options?: { maxWaitMs?: number },
  ): Promise<UpdateBatch>;
  streamUpdates?(
    viewSetId: ViewSetId,
    after: Cursor,
  ): AsyncIterable<UpdateBatch>;
  closeViews(viewSetId: ViewSetId): Promise<void>;
  close(): Promise<void>;
}
```

Names and exact Rust representations remain subject to the tactical, but the
operation boundaries and ownership are accepted.

The `AsyncIterable` adapter owns streaming acknowledgements. A normal
`for await` consumer applies one yielded batch before requesting the next, so
the adapter can acknowledge the prior cursor at that boundary without exposing
transport frames to React or the store.

`hello` reports the supported API range, encodings, delivery modes, named view
and command capabilities, and resource limits. API compatibility, delivery
mode, and encoding negotiation are separate dimensions.

Its first shape is conceptually:

```ts
interface ApiHello {
  api: { current: 1; minimum: 1 };
  encodings: Array<"json" | "cbor">;
  deliveries: Array<"poll" | "long_poll" | "stream">;
  capabilities: string[];
  limits: ApiLimits;
}
```

The actual lists report what the running adapter supports; advertising a name
does not imply that its deferred codec or delivery implementation exists.

Views are named projections rather than an arbitrary field-query language:

```ts
type ViewSpec = {
  view_id: ViewId;
  delivery?: { min_interval_ms: number };
} & (
  | { type: "session_summary" }
  | { type: "torrent_list"; category?: CategoryId }
  | { type: "torrent_detail"; torrent_id: TorrentId }
  | { type: "torrent_peers"; torrent_id: TorrentId }
  | { type: "torrent_files"; torrent_id: TorrentId }
  | { type: "torrent_media"; torrent_id: TorrentId }
  | {
      type: "diagnostics";
      torrent_id?: TorrentId;
      filter: DiagnosticFilter;
    }
);

interface OpenViewsOptions {
  requested_queue_bytes?: number;
}
```

The client chooses `view_id` as a stable reducer and store key such as
`library`, `selected-peers`, or `logs`. The service validates uniqueness,
view-specific arguments, authorization, and bounds. Named projections keep
exposure and resource policy reviewable and can evolve independently.

The optional interval controls producer emission and streaming coalescing, not
browser paint scheduling. Queue allowance is a whole-view-set request capped
by server policy; the opening response reports the effective interval and
queue bounds. A client can request a deliberately smaller queue for low-memory
operation or reset testing but cannot raise the advertised server ceiling.

## Update Continuity

One delivered batch has this semantic shape:

```ts
interface UpdateBatch {
  api_version: 1;
  view_set_id: ViewSetId;
  epoch: DecimalU64;
  base_cursor: Cursor;
  cursor: Cursor;
  durable_revision: DecimalU64;
  updates: ViewUpdate[];
}
```

Epoch, cursor, and durable application revision have distinct meanings:

- `epoch` identifies the lifetime of the volatile view-set accumulator;
- `base_cursor` is the last batch on which this batch depends;
- `cursor` is the opaque position after atomically applying the batch; and
- `durable_revision` is the latest coherent application command/persistence
  revision observed while deriving it.

The client applies a batch only when its view-set ID and epoch match and its
`base_cursor` equals the last applied cursor. The complete batch is one atomic
reducer/store transaction. A mismatch, expired cursor, overflow, incompatible
epoch, or invalid patch requires an explicit reset and fresh snapshot. A reset
should affect only the invalid view when producer ownership permits; whole-set
reset is the safe fallback.

Cursors are opaque decimal strings even if the first implementation uses a
monotonic integer. Clients compare equality and return them; they do not add,
sort, or infer retention from them.

Per-view updates use a small closed vocabulary:

```ts
type ViewUpdate =
  | { view_id: ViewId; type: "snapshot"; snapshot: ViewSnapshot }
  | { view_id: ViewId; type: "patch"; patch: ViewPatch }
  | { view_id: ViewId; type: "view_removed" }
  | { view_id: ViewId; type: "reset_required"; reason: ResetReason };
```

`view_removed` retires the materialized client value at an ordered cursor. A
later reuse of the same `view_id` begins with a new snapshot before patches.

## Diff Semantics

Do not use general JSON Patch. Paths couple clients to object layout, make
projection evolution brittle, and provide poor type and resource bounds.
Use named, projection-specific snapshots and patches.

Collection views initially use complete-row keyed upserts and explicit
removals:

```ts
interface PeerListPatch {
  type: "torrent_peers";
  upsert: PeerRow[];
  removed: PeerConnectionId[];
}
```

Full-row upserts are easier to validate, reduce, coalesce, and encode than
field-level patches. Field masks are a later measured optimization. Stable row
identity is mandatory. A peer row uses a connection-lifetime identity rather
than only address and port so reconnects remain distinct.

The `torrent_peers` collection contains every currently active connection
generation, including transport connecting, protocol handshaking, connected,
and disconnecting work. A row is removed after its task and owned engine state
finish cleanup; disconnected history is not retained in this current-state
view. The future `torrent_swarm` collection instead projects all retained peer
records, including idle, backed-off, failed, and banned records.

Projection rules are:

| Data shape | Patch and coalescing rule |
| --- | --- |
| Torrent, peer, file, and tracker collections | Full-row keyed upsert plus removed IDs; repeated upserts retain the newest complete row |
| Selected summary or other singleton | Replace the value |
| Rates, counters, current peer state | Latest value may conflate within the delivery interval |
| Verified pieces and bounded current piece activity | Typed range or bitmap additions, clears, and replacements |
| Diagnostics and ordered events | Ordered append with explicit retained-history and delivery-gap metadata; never silently latest-value conflated |
| Queue or priority order | Explicit sortable fields; array position is not meaning unless the projection states it |

Tactical `049` specializes the diagnostics row without creating a second
delivery system. Records carry monotonic decimal sequence, bounded wall-clock
timestamp, severity, forward-compatible hierarchical category, stable code,
optional torrent identity, human message, bounded subjects, and bounded typed
fields. A diagnostics view's profile, severity, category prefixes, and
optional pinned torrent are producer capture and delivery interest. Display
search and filtering remain client presentation state.

The application history is bounded to 2,048 records and 2 MiB; one record is
at most 4 KiB and one append patch at most 128 records or 128 KiB. Snapshot
retention identifies source eviction, view-set reset identifies delivery loss,
and the client separately reports local eviction. These meanings are not
collapsed into a generic dropped count. The generated validator and pure
reducer preserve this structure identically for polling and Tauri streaming.

Within one accumulated collection diff, a later removal wins over an earlier
upsert; a still-later upsert may represent a genuinely new lifecycle only when
its stable identity permits that interpretation. Producers must distinguish
empty, unavailable, unsupported, disconnected, stale, and reset-required
states rather than presenting all of them as an empty list.

## Polling And Streaming

The first remote delivery is bounded periodic JSON polling. An active visible
UI may begin around 250--500 milliseconds, slow down while hidden, issue an
immediate pull after a command or view change, and keep only one pull in
flight. Exact cadence is client policy and should be measured.

Browser suspension may outlive the Rust lease. An unknown, closed, or expired
set marks retained requested views stale/reconnecting, opens one replacement
set from the latest semantic desired views, and atomically replaces the stale
materialization from its coherent initial snapshots. Patches from the new set
are never applied over the old set or epoch. Visibility, page-show, and online
events may wake polling early, but correctness does not depend on browser
timers running while suspended.

The same operation may later permit a bounded `max_wait_ms` for long polling.
A WebSocket or Tauri Channel attaches to the same view set and cursor and emits
the same `UpdateBatch`. If retained history cannot satisfy the cursor, it emits
or returns a reset rather than silently starting at the tail.

Low-latency delivery does not put `requestAnimationFrame` into the Rust or wire
contract. The server may deliver current-state changes immediately with
bounded latest-value coalescing; the client store and renderer decide when to
paint. Ordered events retain their separate loss and backpressure semantics.

## Provisional Remote Routes And Connection

The remote adapter reserves this shape for the first tactical:

```text
GET    /api/v1/hello
POST   /api/v1/commands
POST   /api/v1/view-sets
PUT    /api/v1/view-sets/{id}/views
GET    /api/v1/view-sets/{id}/updates?after=...&wait_ms=...
DELETE /api/v1/view-sets/{id}
GET    /api/v1/connect
```

`/api/v1/connect` is the preferred provisional versioned WebSocket upgrade. It
authenticates once and carries typed hello, command, view-set creation/update/
close, attachment, batch and exact cursor-acknowledgement frames directly. It
does not require an HTTP-created view set, and one socket multiplexes every
bounded view attachment for that client/host connection. The accepted
framing, ownership, resume and relay-compatible layering live in
[`application-connection-architecture.md`](application-connection-architecture.md).

The exact remote authentication mechanism remains outside this topic. Tactical
`060` deleted RSTorrent's legacy loopback `/control` WebSocket after migrating
its useful origin, authentication, dispatch, bounded-delivery and shutdown
evidence to `/api/v1/connect`. JSTorrent's unrelated I/O-daemon endpoint with
the same path is outside this repository and decision.

The local Tauri product maps these semantic calls to commands and later
Channels. It does not bind a loopback port or serialize through HTTP merely to
share the browser adapter's URLs.

An explicit unauthenticated development mode may be used for initial browser
bring-up when it is impossible to bind beyond loopback, retains exact Origin
and resource checks, assigns opaque owners, and uses a temporary or explicitly
selected profile. The view-set ID remains non-authorizing. This does not alter
the authenticated adapter or establish production remote access.

Browser navigation URLs such as `/library/:category` and
`/torrents/:torrent_id/:tab` are presentation concerns and do not mirror the
API route layout.

## TypeScript Generation And Runtime Validation

Rust records and enums remain the canonical semantic and wire-type source.
Continue using `ts-rs` with Serde compatibility for deterministic TypeScript
declarations. Add `schemars` derivation for deterministic JSON Schema from the
same Rust DTOs.

The web package should expose:

```text
src/api/
  generated/
    v1.ts
    v1.schema.json
  client.ts
  codec.ts
  index.ts
```

Generated artifacts are never hand edited. Components import the stable
handwritten barrel rather than generator output directly. One repository
command regenerates declarations, schema, and cross-language fixtures; CI
fails on drift.

Generated schema validates structural shape at the untrusted JSON boundary.
Small handwritten semantic validators retain limits that schemas cannot
express clearly, such as canonical ranges, safe lengths, cross-field
relationships, and negotiated capabilities. The intended rule is that
unknown object fields are accepted for additive forward compatibility, but
released clients do not yet follow it: 57 generated object schemas are
closed. [`mixed-version-compatibility`](mixed-version-compatibility.md) owns
the rules that hold today, the capability gating of client-sent commands and
patch keys, and the plan to make clients tolerant.

The current handwritten TypeScript validator already demonstrates the drift
risk: its storage-state list omits Rust's `prepared` and `needs_repair`
variants. The first contract tactical should replace that duplicated
structural enumeration rather than repair only this instance.

Portable DTO rules are:

- JSON-safe bounded integers may remain numbers;
- revisions, cursors, timestamps, byte counters, and other `u64` values use
  canonical decimal strings;
- wire values do not expose JavaScript `Date`, `Map`, or `BigInt`;
- byte strings, ranges, and bitmaps have explicit representations;
- Rust implementation enums do not leak accidentally into the public tagged
  shape; and
- unknown additive object fields do not invalidate an otherwise compatible
  message.

## Compatibility And Codecs

The major API version appears in remote URLs and top-level envelopes. Within
v1, fields may be added when optional or safely defaulted, but required fields
cannot be removed, renamed, retyped, or silently change meaning. New closed
control variants require capability negotiation or a major-version boundary.
This compatibility rule begins at the first explicitly supported API baseline.
The current `0.1.x` internal v1 command union is disposable incubation state:
Tactical `180` replaces its old settings variants in place, updates every
first-party producer and consumer together, and retains no compatibility
alias or version bridge.

JSON is the initial codec. Transport implementations hide encoding behind a
codec boundary and pass decoded DTOs to the same reducer:

```ts
interface ApiCodec {
  readonly encoding: "json" | "cbor";
  encodeRequest(value: unknown): string | Uint8Array;
  decodeResponse<T>(value: string | ArrayBuffer): T;
}
```

Binary encoding is a measured v1 optimization, not automatically API v2. CBOR
is the leading candidate because it can preserve the same data model; no
binary dependency or format is selected until payload, CPU, allocation, and
latency measurements justify it.

## Commands And Observable State

Commands and views retain separate responsibilities. A command carries its
request identity and optional expected durable revision. Its eventual success
response should contain a command-specific result, the resulting durable
revision, and affected identities when useful, rather than returning the
entire service snapshot after every mutation. The view feed supplies the
authoritative resulting state, and the controller may request an immediate
pull after a command.

Remote retry safety may later use bounded request-ID deduplication in addition
to explicitly idempotent commands. View cursors are not command receipts.
Diagnostics are not parsed to infer command success or product state.

Tactical
[`100`](../tactical/100-bep53-select-only-and-duplicate-add-feedback.md) uses
this boundary for magnet and metainfo adds: the command result identifies the
torrent and distinguishes a new add, an existing no-op, and an additive BEP 53
selection expansion. The torrent-list view remains authoritative for current
state. Presentation may immediately reveal the result identity, but neither
an adapter nor the React controller may derive duplicate semantics by diffing
that view.

Tactical
[`107`](../tactical/107-source-aware-magnet-export.md) deliberately keeps
magnet source outside the view system. The explicit read-only
`export_magnet` command returns one bounded command result only after user
activation; torrent-list and selected-torrent projections remain compact and
credential-free. This is the result boundary, not a new subscription or a
reason to copy command payloads into client state.

## Initial View Breadth

The first useful contract progression is:

1. application/session summary and advertised capabilities;
2. torrent-list summary;
3. selected-torrent summary;
4. selected-torrent peers; and
5. bounded diagnostics.

Disk activity is implemented as one global `session_disk` view by
[`disk-and-piece-inspection`](disk-and-piece-inspection.md) and Tactical `044`,
including bounded pipeline state, keyed active piece attempts, lease recovery,
and terminal owner cleanup.
The selected-torrent piece activity contract is generalized and rendered by
Tactical `045`. Files is implemented by Tactical `041` and trackers by
Tactical `043`. Tactical
[`064`](../tactical/064-registry-backed-swarm-inspection.md) implements
`torrent_swarm`, and Tactical
[`066`](../tactical/066-smooth-session-speed-history.md) implements
the underlying session-rate history; Tactical
[`065`](../tactical/065-dht-observatory.md) implements `session_dht`. Swarm is
keyed registry state with
active, inactive, and torrent-missing catalogs; DHT is one bounded latest
session observation containing exact 160-bucket occupancy/freshness and at
most 16 lookup-convergence summaries. Tactical `066` established range-
selected bounded history and server-owned coarse retention. Tactical `186`
exposes rates as a tiny complete
`session_current_rates` latest-value view and an independent,
interest-selected `session_speed_history` projection. History sends a bounded
range snapshot and then exact contiguous completed-bucket appends, so a fresh
client receives its requested tier rather than the full database and a
current-rate consumer receives no graph state.
Unsupported views must report unsupported or unavailable explicitly rather
than fabricate empty data.

## Selected Torrent Preparation

Completed Tactical
[`187`](../tactical/187-compact-metadata-acquisition-progress.md) adds
`torrent_preparation` as an interest-selected latest-value projection separate
from Library and selected Summary rows. Its generation-fenced optional value
contains either current BEP 9 acquisition state or coarse BEP 52 integrity
preparation. Metadata uses a canonical padded-base64 two-bit map with exact
block count, size, received-byte, padding, and reserved-state validation. The
existing 30 MiB/16 KiB geometry caps it at 1,920 blocks, 480 raw bytes, and 640
base64 characters. Integrity preparation carries only acquiring/waiting,
needed range count, and active requests; it defines no percent.

General alone requests this view. Existing view-set leases, queue accounting,
cursor acknowledgement, coalescing, reset snapshots, and reconnect recovery
remain the only delivery mechanisms. Metadata verification, terminal task
cleanup, alias removal, or generation replacement clears or fences the value.
Android and iOS reduce the generated optional state without adding native
presentation; React decodes it only after the shared semantic validator has
proved the packed geometry.

## Implemented Foundation

Tactical `033` establishes these concrete v1 choices:

- 32 live view sets per application and 8 per authenticated adapter owner;
  at either limit an open evicts the least recently active set that is not
  being polled and whose client has been silent for at least 60 seconds (three
  maximum waits), and is refused with `resource_limit` only when no set
  qualifies. A reloaded browser page has a new owner and cannot resume its
  previous sets, so without eviction repeated reloads exhausted capacity until
  the abandoned leases expired;
- 16 named views per set and 64-byte conservative ASCII view IDs;
- 16--512 KiB whole-set queues, defaulting to 256 KiB;
- 512 KiB steady-state queues, a separately retained 16 MiB coherent snapshot
  ceiling and HTTP response reader, 64 KiB requests, 20-second waits,
  60-second maximum delivery intervals, and a five-minute idle lease;
- one emitted but unacknowledged batch, exact replay until the next cursor,
  monotonic cursors across epoch reset, and one active consumer;
- whole-set overflow reset followed by coherent snapshots;
- authenticated loopback JSON pull routes plus the retained Tactical `008`
  WebSocket adapter;
- Rust-derived TypeScript declarations and JSON Schema, Ajv structural
  validation, semantic bounds, and a pure keyed reducer; and
- a bounded Fetch client and `ViewController` with abort, retry, lease reopen,
  immediate post-command pulls, joined close, and no task handles in state.

The controlled libtorrent proof observed a real magnet add, list upsert,
selected summary and piece views, 40,000 requested/received/stored bytes,
three verified pieces, complete publication, exact payload SHA-1, explicit
view-set close, joined gateway shutdown, and temporary cleanup. Deterministic
tests additionally cover owner isolation, concurrent-consumer rejection,
lost-response replay, failed-reduction non-acknowledgement, overflow recovery,
delivery intervals, expiry, generated drift, and shutdown wakeup.

This is a local application boundary and automation seam, not a production
remote-control security or compatibility claim. Per-view retained histories,
per-view overflow reset, browser WebSocket delivery, a binary codec, and
stable public compatibility remain later layers. Tactical `048` implements
stream delivery for Tauri with one explicit post-application acknowledgement
and exact-generation resource cleanup. The
transport-independent Zustand/React presentation foundation and demo adapter
are complete in Tactical `034`; stable peer rows and the Rust-to-React polling
adapter are complete in Tactical `035`; live Files is complete in Tactical
`041`; and live Trackers is complete in Tactical `043`.

## Live Swarm Extension

Tactical `064` implements `torrent_swarm` as the selected torrent's complete
bounded `PeerRegistry` projection, independently of `torrent_peers`. The
generated contract carries closed catalog/source/eligibility/failure
vocabularies, monotonic ages and retry duration, dial/failure history, and
integrity posture. `peer_record_id` is the stable row and patch key. A summary
and its row set always share one capture; Rust and browser validation reject
more than 1,000 records or inconsistent category totals.

Registry mutations and retry-deadline transitions publish through the existing
task-free engine activity boundary. Terminal inactive publication clears rows
only after joined tracker and torrent-peer cleanup. View-set interest affects
only delivery: lease expiry/reopen reconstructs the complete current registry,
and an empty active-connections patch cannot erase retained Swarm rows. The
shared reducer handles keyed updates and terminal removals without joining the
two projections in the browser.

Completed Tactical
[`175`](../tactical/175-retained-swarm-peer-transfer-totals.md) adds required
`payload_downloaded_bytes` and `payload_uploaded_bytes` decimal strings to
every Swarm row. They are exact payload-only totals for the retained record's
current-process lifetime: live captures add every matching active generation
to the closed-generation base, disconnect preserves the final values, and
reconnect accumulates without double counting. Rust, JSON Schema, generated
TypeScript/validators, and UniFFI carry the additive fields. Browser semantic
validation requires canonical nonnegative decimals and sorting remains exact
beyond JavaScript's safe-integer range. The counters reset on record eviction
or engine restart and do not claim durable peer history.

Completed Tactical
[`177`](../tactical/177-bounded-dry-swarm-recovery.md) deliberately leaves
that generated Swarm contract unchanged: idle records retain their truthful
ordinary `failure_limited` classification until an admitted probe moves the
existing row to dialing. The exceptional admission emits one structured
`dry_swarm_probe_started` diagnostic carrying only volatile record ID, failure
count, probe ordinal, and next delay. It exposes no endpoint or peer ID and
creates no client command, view kind, schema, reducer, or presentation policy.

## Live Peer Extension

Tactical `035` implements `torrent_peers` as complete keyed rows for all and
only active connection generations. The generated Rust/TypeScript/schema
contract carries direction, transport, lifecycle, endpoint, source,
capability, request-window, transfer, availability, and cleanup facts without
placing payloads or peer history on the boundary. The application mapper
publishes targeted torrent and peer changes without cloning the complete
torrent collection.

Tactical `051` replaces the web-only opaque flag string with the generated
`peer_flags` semantic set. The application projection currently derives only
incoming direction, uTP transport, negotiated extension facts, and transfer
choke relationships whose nullable inputs are known. Encryption, parole,
snubbed, seed, upload-only, hole-punch, optimistic-unchoke, and connection
endgame values are reserved vocabulary rather than fabricated observations.
The additive field defaults empty and is omitted when empty, preserving the
accepted v1 compatibility shape.

Tactical `056` makes the previously reserved `client_name` field operational.
Once a handshake peer ID is known, the application projection identifies
registered BEP 20 Azureus, Shadow, Mainline, and a bounded set of precisely
specified legacy fingerprints. A recognized value is `available`; missing or
unrecognized evidence is `unavailable`, not `unsupported`. The peer-controlled
fingerprint is a display hint only and cannot affect peer identity, trust, or
scheduling. The existing nullable field and consumer shape do not change.

Completed Tactical
[`086`](../tactical/086-long-lived-torrent-peer-runtime.md) uses this existing
contract as the proof of a corrected engine/session lifetime. A routed
incoming connection is now one ordinary keyed active generation. Its current
endpoints, peer identity/client hint, extension/metadata negotiation,
interest/choke, upload queue, exact payload total/rate, and optimistic grant
populate already-defined nullable fields and flags. Its accepted remote
ephemeral endpoint also appears as a bounded non-connectable `incoming` Swarm
record. Unknown pre-routing sockets remain session diagnostics rather than
torrent rows, and disconnect removes the Peers row only after joined
connection cleanup. Application and leased-view tests cover the full row,
Swarm retention, disconnecting upsert, and exact removal; the unchanged
generated contract passes through the live TypeScript adapter. Authenticated
gateway evidence follows simultaneous pinned libtorrent and RSTorrent rows
through nonzero upload, exact removal, inactive pause, and joined shutdown.

Completed Tactical
[`090`](../tactical/090-peer-id-duplicate-connection-resolution.md) extends the
closed disconnect-reason vocabulary with `self_connection` and
`duplicate_peer_id`. Generated TypeScript, JSON Schema, validators, and
UniFFI-facing types carry those bounded diagnostics. Only the admitted
generation remains in the live Peers set; the reason describes loser closure
without exposing peer IDs as authenticated identity or joining Swarm records.

`InspectionApplication` now accepts semantic desired views. The live adapter
maps them to Rust specifications while responsive navigation can retain only a
phone detail, a library, or a wide list-plus-detail set. Removed projections
are evicted rather than becoming an accidental complete engine mirror. Each
materialization retains the distinct not-requested, loading, ready,
unavailable, unsupported, and stale states.

One application reaper checks all sets at a bounded interval. Only accepted
client operations renew `last_client_activity`; engine publications never do.
The advertised hello lease reflects the configured application lease. A
headless controlled run held browser operations past a 500 ms test lease,
observed server expiry and visible stale state, then proved recovery through a
second view-set identity and fresh epoch. The production default remains five
minutes with a reaper interval no greater than five seconds.

The development browser gateway can opt into unauthenticated control only on
an OS-assigned loopback listener with one exact loopback Origin. Opaque owner
identities still isolate view sets. This mode is an automation and local
bring-up boundary, not a production remote-access posture; bearer mode remains
the ordinary gateway configuration.

## Live Files Extension

Tactical `041` implements `torrent_files` as a complete ordered catalog for
the selected torrent. Stable file IDs are metainfo indices. Each row carries
validated relative path components, exact decimal length and offset, inclusive
piece span, High/Normal/Skipped selection for ordinary files, independent padding
identity, and exact Done and Verified byte counts. The snapshot also carries
one filesystem content base; the TypeScript adapter derives optional absolute
storage paths without repeating the base in every wire row. Capability-backed
storage reports no fabricated filesystem path.

Tactical [`176`](../tactical/176-durable-high-file-priority.md) replaces the
former binary wanted label with the truthful three-value projection and adds
the bounded sparse High indices to torrent snapshots. Padding still has no
selection value, and clients do not infer High from progress or streaming.

The runtime-independent file-progress owner shares immutable catalog geometry
and updates only rows intersected by stored, verified, or hash-failed piece
ranges. Stored-block overlap is deduplicated, verification is idempotent, hash
failure removes only unverified bytes, and durable restart reconstructs
Verified from the checkpoint while conservatively dropping transient Done.
Metadata arrival and catalog replacement use coherent snapshots; steady
progress uses coalesced complete-row keyed patches at a client-requested
250 ms minimum interval.

A legal 4,096-row long-path fixture encodes to 1,481,877 bytes, above the
ordinary 256 KiB default queue but below the advertised 16 MiB snapshot bound.
The view set retains that coherent initial snapshot separately while later
small patches remain governed by the 512 KiB steady-state ceiling. Gateway and
browser readers enforce the same 16 MiB maximum; an oversized response fails
explicitly rather than truncating.

Tactical `081` replaces that whole-catalog contract with offset pages of at
most 1,024 rows. Every snapshot carries the requested offset and limit, the
full total count, and an optional next offset. Steady patches include only
rows in the requested page; changing pages is an ordinary view-spec update
that yields a coherent snapshot. Clients do not infer total accepted file or
tracker count from page length.

Completed Tactical
[`203`](../tactical/203-jstorrent-shaped-add-time-file-selection.md) reuses
those pages for add-time selection. The torrent projection carries durable
pending/FIFO state, immutable catalog identity, and exact selectable/selected
count and byte totals. Clients retain only a compact base-plus-range draft and
at most three 1,024-row pages; All/None applies to the logical catalog rather
than mounted rows. One catalog-fenced command commits the whole draft, so
neither React nor Compose sends a per-file mutation loop or owns a second
pending queue.

Responsive interest requests Files only while that tab is visible and evicts
the materialization after the ordered view removal. A phone detail does not
retain the library. Browser suspension follows the existing stale/reopen
contract: the controlled 500 ms lease proof replaced the expired set and
restored all 122 rows from a fresh epoch while the engine continued.

## Derived Media Extension

Completed Tactical `072` implements `torrent_media` as a complete recognized-
video catalog for one explicitly opened Library source. Stable media IDs remain
the metainfo file indices. Each row carries the exact relative path, normalized
recognized extension, decimal length, High/Normal/Skip selection, Done and
Verified bytes, existing media availability, and either a conservative typed
episode hint or `unclassified_video`. The snapshot distinguishes metadata
pending, available-empty, and torrent missing; it also carries the total
non-padding file count so the client can explain the filtered result without
leasing Files.

`ViewHub` retains one immutable classification beside the file-progress model
and rebuilds it only with verified metainfo creation or replacement. Progress,
availability, and selection remain owned by Files and are joined when a Media
snapshot or changed row is projected. Steady changes use keyed complete-row
upserts and removals, preserving the existing coalescing, reset, lease-expiry,
and generation-fencing rules. A classification or join inconsistency cannot
change torrent lifecycle or fabricate an empty catalog.

Library Media requests this view only while the detail and Media tab are
visible; All files replaces it with the existing paged `torrent_files` lease.
Android and iOS consume the generated additive contract in exhaustive reducers
without adding a Compose or SwiftUI screen. A synthetic 4,096-item Media
snapshot encodes to 1,901,592 bytes and occupies 1,901,762 bytes in the retained
view-set envelope, below the existing 16 MiB snapshot ceiling. No classifier
state is persisted and no payload bytes cross this interface.

Completed Tactical
[`189`](../tactical/189-library-playback-and-torrent-size.md) adds one
`total_size_bytes` fact to the complete `TorrentView` summary rather than
duplicating file-page or Media aggregation in clients. It is null before
verified content geometry exists and otherwise equals the immutable content
layout's exact total length as a decimal `u64` string, including padding. A
metadata transition uses the closed typed `TotalSizeBytes` sparse field;
TypeScript, Android, and Swift reducers apply it exhaustively. Playback itself
reuses the existing semantic media call and adds no view field or payload byte.

## Library Media Extension

Tactical [`363`](../tactical/363-library-media-index.md) adds
`library_media`, the first cross-torrent projection. The view hub derives one
in-memory index from every torrent's resident file catalog and evaluates a
`LibraryMediaQuery` (words, kinds, roles, availability, archived scope,
torrent, group, grouping, sort, direction) against current file progress. A
view carries the query and a catalog page of 1 to 128 rows (default 100); the
legacy subscription boundary expresses the same view as
`ViewSelector::Library` with the `library_media` projection and a required
page, which is how Android consumes it.

The snapshot holds the page, facets over the text, archived and torrent scope,
and either item rows or group rows. The only patch is an `upsert` of items
already on the delivered page. The hub keeps the last result of each live
`(query, page)`: progress that leaves every item's offline state unchanged
patches memoized rows without re-evaluating, and any change to the page,
order, totals, facets or groups replaces the view with a snapshot. Clients use
one view ID per request, so a page answering an earlier query is never taken
for the current one. Companion connections do not advertise the projection,
as with `torrent_media`. [`media-library`](media-library.md) owns the item
model and its rules.

## Live Trackers Extension

Tactical `043` implements `torrent_trackers` as complete keyed rows derived
from the deterministic engine schedule. The projection carries configured
identity, source and transport, active/inactive lifecycle, current and next
action, attempt and failure counts, accepted response statistics and interval,
monotonic outcome instants and deadline, and bounded failure context. It does not
derive state from diagnostics or retain a second tracker state machine.

Tactical `081` makes this a paged projection and adds metainfo versus magnet
source, original tier, and configured transport/capability state. At that
checkpoint UDP rows could be active while retained HTTP and HTTPS rows remained
visible as unsupported; credentials were redacted. Tactical `095` now admits
operational UDP/HTTP/HTTPS rows to one shared eight-operation ceiling and
projects their ordinary lifecycle. The row's new security field separates
plaintext HTTP from encrypted-but-unauthenticated HTTPS; it does not infer
certificate verification from scheme, announce success, or transport status.
Tactical `096` additionally projects the optional family of the most recent
successful physical connection. A failed operation retains that last-success
fact, while a new or replaced row begins unset. The web keeps `Family` hidden
by default and renders only `IPv4`, `IPv6`, or an em dash.
Tactical `098` makes the HTTPS security value operation-captured. A row begun
under `disabled` remains `encrypted_unauthenticated` if it completes after a
secure live replacement; a failed `system_trust` attempt remains
`encrypted_system_trust` without claiming the handshake succeeded. A row
that has never run uses the effective policy, or configured secure
requirement when no HTTPS-capable pair exists. The generated contract carries
coarse redacted TLS categories rather than native exception text.

Same-catalog durable updates preserve live tracker state. Restart reconstructs
configured inactive rows from the magnet without pretending volatile response
history survived. The selected Trackers tab alone requests the view at a
250 ms minimum delivery interval; leaving the tab evicts it. Completed Tactical
[`300`](../tactical/300-monotonic-tracker-view-deadlines.md) replaces relative
row durations with `next_action_at_millis`, `last_success_at_millis`, and
`last_failure_at_millis` on ViewHub's application monotonic clock. Every
`UpdateBatch` carries current `server_now_millis`, refreshed on retained replay
without changing its cursor or payload. These decimal instants are not Unix
timestamps and cannot be persisted across application restart. The adapter
anchors this clock to `performance.now()` once per view-set epoch; retained
rows, partial patches, tab reopen and unrelated updates preserve deadlines.
The React table ticks locally without host timer patches. Transport delay
can produce a small display offset; the engine remains scheduling authority.

The torrent summary also carries an additive optional configured-tracker
count derived from the same bounded tracker model. Navigation can therefore
show a stable count while the detailed tracker projection is not requested;
it does not retain evicted tracker rows or create another tracker authority.
Older v1 producers may omit the field, which remains distinct from a known
zero configured trackers.

The controlled browser proof observed an intentionally delayed announce in
flight, accepted exact peer/seeder/leecher counts and a reannounce deadline,
completed verified content, removed the active peer row, and joined the
gateway, tracker, and libtorrent seed. Generated Kotlin and UniFFI consumers
compile while Android explicitly ignores this desktop-only presentation view.

## Validation And Evidence

The completed foundation evidence proves:

- deterministic opening, specification changes, per-view snapshots, keyed
  upserts, row removals, view removal and re-add, atomic batches, and close;
- independent view sets with different desired projections and consumption
  speeds;
- one-consumer enforcement and polling cursor continuity;
- lost-response replay and acknowledgement only after client reduction;
- queue coalescing, exact high-water accounting, whole-set overflow reset, and
  fresh-snapshot convergence;
- cursor mismatch, monotonic epoch reset, lease expiry and client reopen,
  application shutdown, and prompt joined task termination;
- authenticated ownership, request/frame bounds, and a view-set ID that is not
  treated as a credential in the loopback gateway;
- generated TypeScript plus JSON Schema drift checks and independently tested
  semantic limits;
- a pure TypeScript reducer and headless client that can materialize the same
  snapshots and diffs through polling; and
- one controlled libtorrent-seeded download observed through that client from
  add through verified publication and clean shutdown.

Tactical `203` additionally passes exhaustive generated reducers and
validators, a 122-file controlled browser flow with at most three cached pages
and zero serious/critical Axe findings, API-35 installed selection and process
recovery, and physical ChromeOS API-33 partial-selection evidence. The same
projection survives service/process replacement and stale confirmation fails
against the immutable catalog identity.

Tactical `084` additionally proves immediate settings replacement after an
atomic mutation, no substitution of configured intent for active state, and
fresh initial active/effective/listener observation after durable reopen. Four
production-browser generations converge through the existing torrent-list
view across disabled mismatch, automatic listening, fixed bind failure, and
repaired automatic listening without another view owner or transport path.
Tactical `088` preserves that replacement contract for local-network and
mapping states. Its off-LAN gate consumes the same summary plus ordinary
Peers/Swarm snapshots and observes mapped readiness, incoming TCP activity,
exact transfer, stopping, and terminal resource closure without a diagnostic-
only state path.
Tactical `089` preserves the complete-value replacement contract while
separating configured preferred, active preferred, actual TCP, actual UDP, and
mapped external TCP facts. Web validation, fixtures, settings presentation,
generated schema/TypeScript, and regenerated UniFFI Kotlin consumers pass.

Tactical `095` preserves the existing paged keyed tracker projection while
adding the closed security field and activating HTTP/HTTPS lifecycle rows.
Generated-contract drift, semantic TypeScript validation, 178 web tests, the
production React build, Android cross-builds, and the API 34 arm64 AVD HTTPS
profile pass. The AVD observed `encrypted_unauthenticated` for a wrong-host
self-signed tracker that returned only `peers6`; this is evidence of the
declared temporary policy, not authenticated HTTPS.

Tactical `098` preserves the same view kind, page, lease, and reducer path
while extending both closed enums and the complete settings replacement.
Generated TypeScript/schema/validators, React fixtures and tests, UniFFI, and
Kotlin compile checks pass. A controlled in-flight policy change retained the
old row's unauthenticated truth while the settings value reported the new
secure effective policy. The API 34 arm64 product run rendered secure-policy
success/failure rows through its ordinary tracker view; explicit disabled mode
remained visibly unauthenticated.

Tactical `111` preserves the complete-replacement settings and active-peer
paths while adding the independent encryption convergence domain. Generated
TypeScript/schema/validators, React fixtures and control tests, UniFFI, and
Kotlin consumers pass. A live `allow -> required` change publishes effective
policy without restarting the listener or established peers; later incoming
plaintext is rejected and later RC4 succeeds. Both MSE methods project `E`,
ordinary plain does not, and the legend says "Encrypted or obfuscated."

Tactical `115` preserves those view and convergence paths while adding the
optional exact method. Rust projection tests cover plaintext-payload and RC4;
generated TypeScript/schema/validators and UniFFI lowering pass. Older
producers may omit the field, in which case clients retain the generic flag
meaning.

Tactical `112` preserves complete-replacement settings and the existing DHT
view path while adding one closed family dimension. Generated TypeScript,
JSON Schema, semantic validators, React fixtures, and UniFFI/Kotlin lowering
pass. Live enable-disable-enable proves the settings view cannot report
`Applied` before IPv6 sockets, DHT work, candidates, and plaintext or MSE peer
generations have terminated; IPv4 observations survive the same transition.
The API 34 AVD reports configured enabled plus effective disabled as a typed
degradation when no eligible global-unicast address exists. The named API 37
Pixel 7a subsequently repeated the same default, disable, forced-restart,
degraded re-enable, and cleanup assertions on its current network.

Tactical `205` adds independent DHT and peer-exchange configured/effective/
application fields to that same complete settings replacement. The DHT
observatory gains one closed `Disabled` lifecycle; no endpoint or routing
contact is exposed. Generated TypeScript/schema/validators and UniFFI Kotlin/
Swift consumers pass, React and Compose mutate sparse Boolean patches, and
older serialized complete settings default both new fields to enabled.

Tactical `113` preserves complete replacement while projecting the two gateway
mechanisms independently. Rust projection tests, generated TypeScript/schema/
validators, and React fixtures cover simultaneous success/failure and the
distinction between a gateway-accepted pinhole and an observed incoming peer.
The doc-hidden physical diagnostic reports only a packet count or bounded
fault for the currently in-memory active/deleted pinhole; production does not
call it, and it exposes neither pinhole ID nor gateway identity. The live
gateway reaches the generated `Failed { stage: Add }` state with typed SOAP
fault `606`; no positive off-LAN evidence or packet diagnostic follows.

Tactical `040` now supplies actual torrent lifecycle evidence in addition to
the earlier synthetic `removed` diffs. Archive, removal stage, and managed-data
deletion availability are complete torrent-summary fields. Final catalog
deletion produces the ordinary keyed removed ID; an intermediate or failed
cleanup remains an upsert, so reducers do not infer deletion from command
success or diagnostics.

Tactical `041` adds a controlled libtorrent 2.0.13.0 multi-file proof. The
production web build received 26,731 bytes of multi-block metadata, exposed
all 122 files, and made piece zero cross a 7,000-byte nested prefix into the
40,000-byte payload. It observed first Done and Verified bytes at 20,406 and
20,413 ms from Files selection, recovered after deliberate lease expiry, and
displayed 39.0 KiB Done and Verified for the payload at completion. The
harness independently compared both nonempty files, joined the gateway and
seed, and removed its temporary profile and download tree.

Tactical `042` completes the torrent identity row with an optional
`display_name` derived only from successfully parsed, verified durable
metainfo. Metadata arrival and profile reopen use the same derivation. Since
list and selected-summary views already carry complete `TorrentView` rows,
name arrival is an ordinary keyed upsert in both surfaces rather than a new
view or event. The client validates the metainfo component's 255-byte bound
and retains its info-hash fallback when the field is absent.

Completed Tactical
[`172`](../tactical/172-provisional-magnet-display-name.md) adds the separate
optional `source_display_name` field for bounded, unauthenticated magnet `dn`
text. It can label a metadata-less row immediately, but it never substitutes
for `display_name` in filesystem, publication, or integrity decisions.
Complete-row replacement preserves the source field when verified metadata
arrives; clients render verified name, then source name, then their existing
opaque fallback. The additive optional field leaves the v1 contract version
unchanged.

Tactical `043` adds deterministic tracker snapshot, keyed-patch, catalog
replacement, removal, reset, and lease-recovery coverage. Its controlled
tracker-only browser run observed `announcing` before a delayed response, then
one accepted peer, 37 seeds, 11 leeches, and a 30-minute reannounce deadline
while the same run completed and verified the seeded payload.

Tactical `081` adds deterministic 1,024-row file and tracker page traversal,
page-scoped patches, total/next-offset validation in Rust and TypeScript, and
generated Kotlin/UniFFI high-cardinality coverage. A 374,998-file Android
fixture is represented by one compact wanted range and one 1,024-row page.

Tactical `046` proves Peers removal on pause rather than only completion or
synthetic replacement. A deterministic application run begins from verified
multi-file metadata, holds one real content TCP generation connected, then
pauses through the ordinary command path. The pause receipt follows socket
EOF; the already-open leased view set receives the exact connection ID in a
Peers `removed` patch and a complete torrent-summary row with zero active peer
connections and zero payload rate. No React filter or durable-state refresh
manufactures the removal.

Tactical `057` measured three rotating 1 GiB cohorts on the local Apple M4 Pro
profile. The idle SQLite application median was 177.9 MiB/s and Library alone
was 166.4 MiB/s with zero resets. The ordinary Library-plus-Summary shape was
160.2 MiB/s but recovered from about 900 queue overflows per transfer. The
worst individual specialization was trace Diagnostics at 98.4 MiB/s and
1.081 GB of serialized update batches; Pieces followed at 123.6 MiB/s. Every
view together fell to 74.0 MiB/s and serialized 1.742 GB while incurring up to
1,737 resets. A deliberately one-second consumer completed at 122.3 MiB/s
with nine reset snapshots and a 16.78 MB queue high water.

Tactical `183` measures the ordinary production React navigation at a
deliberately slow 256 KiB/s transfer rate rather than maximizing engine
throughput. Its clean 12-row Linux run observes 5.28 KiB/s server application
payload for idle Transfers, 12.84 KiB/s for active Transfers, 101.86 KiB/s for
General, 114.05 KiB/s for Peers, 113.31 KiB/s for Files, 147.93 KiB/s for
Pieces, and 103.23 KiB/s for Normal Logs. One WebSocket, no semantic HTTP, exact
gateway/browser byte agreement, zero resets, and joined cleanup pass.

The navigation contract already omits unselected details and unchanged
Library rows. The dominant residual is an accumulator mismatch with the
documented coalescing rule: `ViewSetInner::enqueue_update` only attempts to
coalesce the pending tail. Hub publication interleaves Library, Summary, and
selected-detail IDs, so later compatible patches for one view do not reach an
earlier same-view patch. General consequently delivered 390 complete active
Library rows and 390 complete Summary replacements during one eight-second
window even though both views requested a 100 ms minimum interval. Full-row
upserts also repeat unchanged fields and Library plus Summary repeat nearly
the same selected torrent, but those are second-order wire-shape choices after
the intended latest-value coalescing works across interleaved view IDs.

Tactical `104` adds required/remaining payload decimal strings, the distinct
smoothed ETA payload rate, and the closed tagged ETA to every torrent row.
Generated schema/TypeScript/validator drift, Rust serialization, UniFFI/Kotlin
compilation, view-hub generation fencing, real HTTP/HTTPS completion, and
production-browser consumption pass. The cadence retains one 184-byte scalar
model per torrent, publishes at most once per changed tick, and uses targeted
torrent-row changes rather than cloning file, peer, swarm, or piece state.

Tactical `184` now makes pending current-state coalescing view-aware across
interleaved IDs while preserving ordered Diagnostics, exact queue accounting,
cursor, reset, and fresh-snapshot recovery semantics. Its identical clean run
reduces total server bytes by 76.48% and active detail rates by 70--86%, with
zero duplicate-view batches and no public-contract change. Batch cadence stays
nearly constant, proving semantic collapse caused the reduction.

The residual measurement selects Torrent, File, Peer, and active-piece rows
for Tactical `185`'s closed typed field deltas. New rows and snapshots remain
complete; existing rows carry only changed fields; nullable changes distinguish
unchanged from explicit clear; all reducers reconstruct full state. These
semantics are defined before serialization, so JSON remains an interchangeable
codec rather than the source of patch meaning. A future binary codec must use
an explicit versioned field-number registry rather than Rust enum order.
At that point, complete session-rate history replacement, projection overlap
removal, and browser decode/reducer/paint cost remained separately measured
follow-ups; Tactical `186` closes the first item below.

Tactical `185` is complete. `TorrentFieldUpdate`, `FileFieldUpdate`,
`PeerFieldUpdate`, and `ActivePieceFieldUpdate` are closed tagged semantic
variants carried by keyed update records alongside full insertion upserts and
explicit removals. Selected Summary uses an explicit replace-or-update change.
Nullable values clear through a present null-valued variant; omitted variants
remain unchanged. Pure helpers and every first-party reducer reject empty or
duplicate fields, identity drift, contradictory row operations, and updates
without an existing row. Pending coalescing merges by row and field, including
applying a sparse change into a queued complete upsert. Snapshots and resets
remain complete.

The identical clean production run reduces post-coalescing server payload
from 1,239,166 to 783,539 bytes (-36.77%), with zero reset, duplicate-view
batch, or lost progress. This validates the semantic boundary independently of
the current JSON codec. Rust enum order, generated union layout, and client
duplicate-detection keys are explicitly not binary field numbers; a future
codec still requires negotiated versioning, a stable numeric registry,
unknown-field rules, golden vectors, and payload/CPU measurements.

Tactical `186` removes the overloaded `SessionSpeed` projection. Current
values are complete latest-state `SessionCurrentRates` replacements. Graph
state is an independent `SessionSpeedHistory` fixed-window snapshot followed
by exact nullable contiguous appends. History epoch, base/new completed-bucket
positions, resulting start geometry, selected metrics, and equal value counts
are validated before mutation. Compatible pending appends concatenate within
the selected window; any gap or incompatible shape establishes a fresh
snapshot. These semantic anchors do not duplicate transport reliability: the
existing view-set cursor and post-reduction acknowledgement still own replay,
queue release, and backpressure.

React always requests only received/uploaded current rates and requests graph
history only while Speed is visible. Android composes the two independent
subscriptions for its Speed route. iOS does not yet present or subscribe to
Speed, but its maintained repository reduces both contract shapes exactly.
The clean production run reduces Tactical `185`'s server payload from 783,539
to 454,581 bytes (-41.98%) and idle Transfers from 5.28 to 0.41 KiB/s, with
zero resets, exact browser/gateway agreement, and progress from 1% to 20%.

Public swarms and visible Tauri launch are unnecessary for this foundation.
The browser gateway, temporary profiles, controlled libtorrent peer, and pure
fixtures provide higher-signal headless evidence without disturbing the
interactive machine.

## Recommended Implementation Sequence

1. The bounded view-set domain owner, generated TypeScript/schema contract,
   polling adapter, pure reducer, and headless TypeScript evidence are complete
   in Tactical `033`.
2. The Zustand store, React shell, frontend inspection model, named demo
   adapter, and virtualized scale fixtures are complete in Tactical `034`.
3. Tactical `035` added stable torrent-list and active-peer projections with
   hostile and scale fixtures, mapped them through the controller into the
   inspection model, and closes lease/suspension lifecycle gaps. This step is
   complete.
4. Tactical `048` adds streaming as an interchangeable delivery adapter after
   polling behavior and reducer recovery are stable, and implements it for the
   in-process Tauri product. This step is complete.
5. Tactical `060` implements one multiplexed WebSocket as the ordinary browser
   application connection while retaining HTTP only as an explicit loopback
   diagnostic comparison. This step is complete.
6. Tactical `065` adds the bounded latest-value DHT view, exact generated
   contract validation, coherent replacement reduction, and joined terminal
   forwarding. This step is complete.
7. Tacticals `183`--`186` measure and repair interleaved coalescing, repeated
   complete hot rows, and overloaded session-rate history. Continue measuring
   decode/reduce cost, rendering, and memory before selecting binary encoding.
8. Tactical `190` proves the same generated contract and reducer over an
   OPAQUE-authenticated encrypted relay record without adding a remote view
   variant. Tactical `192` completes production-shaped local delivery,
   resumable authorized-client context and its bounded security snapshot.
   Public delivery remains later work.

Tacticals `033`, `034`, `035`, `048`, `060`, and `065` completed the first six
steps. Further views should follow observed inspection value. Binary encoding
remains a measurement-driven change rather than a prerequisite.

## References And Deliberate Differences

qBittorrent's `sync/maindata` cursor, full-update flag, keyed torrent changes,
and removed IDs demonstrate a useful recoverable polling shape. RSTorrent adds
named projections, per-view status, explicit epochs, bounded view-set
ownership, and transport-independent batches rather than copying that API.

Transmission RPC demonstrates explicit requested fields, object-shaped
results, and removed IDs for recently active torrents. RSTorrent initially
prefers named bounded projections over arbitrary fields and does not adopt
Transmission's positional table encoding.

The exact reference links and dependency roles are recorded in
[`../references.md`](../references.md). No source or fixture is imported by
this design.

## Remaining Open Decisions

- whether measured use justifies raising the implemented resource limits or
  retaining more than one unacknowledged cursor batch;
- whether category filtering is producer-side for the first list view or
  initially client-side within a bounded complete torrent list;
- exact reset granularity when one view snapshot itself exceeds its bound;
- remote authentication, pairing, TLS, exposure, and deployment posture;
- deep links into the browser UI from outside it (notifications, the
  extension, share links); Tactical
  [`365`](../tactical/365-url-navigation-and-hot-reload.md) settles in-app
  navigation URLs as a client-only fragment with no host contract;
- the measured threshold for specialized field patches or binary encoding;
  and
- durable label and queue semantics; archive and bounded removal/deletion are
  implemented by Tactical `040`.
