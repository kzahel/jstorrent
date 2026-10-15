# Product And Engine Direction

Topic: `product-direction`

## JSTorrent-only releases, accepted 2026-10-11

JSTorrent is the sole active product and release identity. The RSTorrent
incubation release track is frozen; no new releases or resumed nightly
publication are planned for that flavor. The switch to JSTorrent's existing
desktop signing key, `com.jstorrent.desktop` identity and updater endpoint has
already occurred, with public desktop 0.3.0 recorded in Tactical
[295](../tactical/295-qualified-candidate-shipment.md). It is not future
provisioning work or a second product to maintain.

Retained incubation descriptors, routes, package identities and artifacts are
historical compatibility or isolated development infrastructure. They do not
authorize new incubation publication, a signing-key rotation, or automatic
conversion of an old RSTorrent installation into JSTorrent. The continuing
[release and updater contract](product-surfaces-and-migration.md#jstorrent-only-release-policy-2026-10-11)
owns the freeze and compatibility boundary. This supersedes earlier references
to independent incubation releases continuing during qualification.

## MIT licensing retained, accepted 2026-10-10

The maintainer explicitly retains MIT for this public, open-source project.
Do not adopt GPL terms for the combined Linux application as a release shortcut.
Remove the GPL-only runtime library dependencies found in the AppImages while
preserving product behavior through a bounded packaging fix. LGPL libraries
remain permissible with their notice, source and modification/relink obligations
satisfied; public first-party source alone does not provide every bundled
third-party library's corresponding source. GPL build tools and unused GPL files
in an upstream archive are distinct from linked runtime code. Tactical
[294](../tactical/294-mit-compatible-linux-packaging.md) owns this work.
Best-effort Linux compatibility scope and the exclusion of iOS remain unchanged.

## Linux release scope accepted 2026-10-09

Linux desktop support is best effort for the first JSTorrent replacement.
The primary desktop download is an ordinary-user AppImage with maintained
bundled libraries and documented minimum system requirements. DEB/RPM are
excluded from the first-release offering. Tactical 285 makes the production
workflow AppImage-only on Ubuntu 24.04; new signed/runtime qualification is
still required. Existing preview package-manager channels are unchanged.
There is no commitment to
older-distribution WebKit backports or an exhaustive distro compatibility
matrix. Older-system failures receive actionable guidance toward the native
CLI/headless composition, subject to that binary's own requirements. Existing
headless implementation evidence does not imply a promoted public download;
its packaging and access instructions must be checked before advertising it.

A truly webview-free tray/browser-controlled package is later work. Deferring
a desktop window does not remove its linked WebKit dependencies. This policy
narrows Linux compatibility qualification; it does not clear the old bundled
WebKit/OpenSSL candidates, source/redistribution obligations or retained-data
checks on the selected representative systems. ChromeOS Android qualification
remains unchanged; older Crostini Linux configurations are best effort.

Status: initial direction and successor vision accepted. Android storage
foundations are proven on an AVD, Chromebook ARCVM, Pixel 7a, and Moto X4
internal and removable exFAT storage; the in-process engine bootstrap is
proven on the AVD, Chromebook, Pixel 7a, and Moto. Desktop and Android
products now select explicit online tracker and peer networking while
controlled tools retain loopback-only policy. Active magnets retain supervised
scheduled UDP tracker discovery with bounded retry and reannounce behavior.
Maintainer direction on 2026-08-09 additionally makes Android a
non-deferrable engine parity gate and accepts iOS as an eventual first-party
in-process product, beginning with the bounded physical-device feasibility in
Tactical [`116`](../tactical/116-platform-storage-coherence-and-ios-feasibility.md).
Completed Tactical
[`123`](../tactical/123-ios-on-device-root-persistence-and-recovery.md)
records the physical evidence behind the former app-owned-only iOS policy.
Explicit maintainer direction on 2026-08-13 superseded that product decision
and completed Tacticals
[`147`](../tactical/147-ios-client-foundation-and-qualified-roots.md) through
[`149`](../tactical/149-ios-lifecycle-recovery-and-distribution-readiness.md)
as the first maintained iOS product campaign. User-selected folders are
implemented, with iCloud and positively identified providers rejected and
every accepted on-device root capability-qualified on physical hardware.

## Scope

This topic owns why the RSTorrent implementation exists, what initially
distinguishes it from the current JSTorrent implementation, the engine
constraints, the first platform posture, and the decisions that remain
deliberately open. The likely long-term product succession is recorded in
[`../vision.md`](../vision.md).

It does not prescribe the internal crate graph, select a UI toolkit, enumerate
the final BitTorrent feature set, or serve as an implementation tactical.

## Motivation

JSTorrent proved that a TypeScript BitTorrent engine can support extension,
desktop, Android, iOS, CLI, and browser-adjacent products. It also accumulated
the cost of making that engine fit environments that cannot directly provide
its required sockets and files.

RSTorrent is a chance to build for current constraints:

- one first-party Rust engine rather than a shared JavaScript engine embedded
  into several native runtimes;
- direct operating-system networking rather than a general socket proxy;
- in-process clients rather than native-host and daemon protocols;
- a deliberately small product before feature breadth;
- Android/ChromeOS behavior designed as a product rather than a companion
  workaround; and
- an implementation campaign whose correctness can be reviewed against a
  familiar domain, public specifications, and mature interoperability oracles.

The reboot is also intended to be fun. It creates a clean place for ambitious
automated implementation runs while keeping each run bounded by reviewable
tacticals and executable acceptance evidence.

## Accepted Initial Decisions

### JSTorrent production successor

Maintainer direction on 2026-09-30 selects a near-term in-place replacement of
JSTorrent using this implementation, with JSTorrent branding and original icons.
This supersedes the 2026-08-22 foreseeable independent RSTorrent product policy.
Desktop retains `com.jstorrent.desktop` and its updater trust root, Android updates
the existing `com.jstorrent.app` Play app, and this repo's extension updates the
existing production Web Store item. Independent delivery and best-effort legacy
migration follow [product-surfaces-and-migration](product-surfaces-and-migration.md).
Separate incubation/test identities remain during qualification. Tactical
[249](../tactical/249-jstorrent-brand-and-extension-refresh.md) starts branding and
a focused extension refresh; production publication remains separate work.

### Disposable incubation line

Explicit maintainer direction on 2026-08-27 declares every `0.1.x` desktop
package and current mobile, ChromeOS Linux, and headless preview disposable.
Public availability alone does not create a supported persistence, generated
application API, identifier, rollback, or update-continuity promise. A future
version must be explicitly declared the first supported beta or release before
such a baseline exists; `0.2.0` is a possible version, not a frozen choice.

Current identifiers, signing keys, and routes may remain in operation because
they are useful and secure, but preserving an older incubation installation is
not an acceptance requirement. Recognized obsolete application-private state
may reset under a bounded documented policy; malformed, ambiguous, busy, or
future state fails closed. No reset may delete user-selected payload roots or
published content, and no old record can establish verified-content
authority. External BitTorrent interoperability, package authenticity, and
these safety boundaries remain mandatory.

### First-party engine and clients

The torrent engine is authored in this repository. libtorrent, librqbit, and
other clients are references and test peers, not the runtime engine.

Product surfaces are also first-party. A platform UI framework or operating
system library is ordinary infrastructure; a generic remote UI controlling a
third-party client would change the product. A future first-party JSTorrent
extension may control this native engine through a deliberately narrow
application boundary.

### Rust owns the hot path

Rust should own peer TCP and UDP, protocol state, hashing, piece scheduling,
session state, and hot-path storage I/O. Platform adapters should provide
capabilities that truly require the host platform.

On Android, Kotlin may own activities, Compose UI, permissions, notifications,
foreground-service lifecycle, and Storage Access Framework document creation.
The preferred storage seam is to give Rust usable file descriptors or another
bulk-I/O capability rather than copying piece payloads through callbacks.

On the maintained iOS product, Swift owns native presentation, directory
selection, bookmarks and security-scope lifetime, File Provider coordination,
background-task integration, and other Apple lifecycle work. Rust still owns
peer networking, hashing, scheduling, persistence, and payload I/O. Tactical
`116` proves the bounded direct-I/O seam, and Tactical `123` proves app-owned
Documents persistence and recovery on a physical device. Its picker controls
reject iCloud as ubiquitous and show that volume flags cannot positively name
the separate local provider. Tactical `147` deliberately permits a provider-
lookup failure only for non-ubiquitous local/internal selections that pass the
complete bounded Rust capability gate; a returned provider identity rejects
the root. Payload callbacks through Swift are not the fallback.

### Generated Kotlin boundary

Use UniFFI as the default Rust/Kotlin binding generator. Expose a narrow typed
control plane of opaque session objects, configuration and snapshot records,
errors, coarse events, and explicit asynchronous lifecycle operations. Peer
payloads, storage buffers, hashing, scheduling, and ordinary socket I/O remain
inside Rust.

Kotlin may extract an integer descriptor from a caller-owned
`ParcelFileDescriptor`; Rust must duplicate it before taking ownership.
Document creation, rename, permission, notification, and lifecycle operations
may cross the boundary at coarse granularity. Batch naturally repeated control
operations and continue to enforce hostile metainfo file-count limits rather
than designing a per-block interface around implausibly large file counts.

Handwritten JNI is a narrow escape hatch for a concrete Android capability
that UniFFI cannot express safely. It is not a parallel application API or a
payload path.

Completed Tactical `147` selects UniFFI-generated Swift over a focused iOS
static library and the existing typed application service. The SwiftUI
presentation is directly reused from the first-party JSTorrent iOS product in
completed Tactical `148`; no second application contract or payload bridge is
introduced.

### In-process by default

Desktop, Android, and the maintained iOS app normally load the engine
into their own process and communicate through a typed application API. A test
driver or later remote-control feature must not force the product itself into
a daemon architecture. A future extension control channel carries commands,
snapshots, and events rather than proxying peer sockets, filesystems, or piece
payloads.

The accepted
[`http-file-serving-and-streaming`](http-file-serving-and-streaming.md)
direction now implements one narrowly scoped in-process HTTP byte-serving
exception: completed Tactical
[`138`](../tactical/138-verified-http-file-serving.md) reuses an existing
gateway or binds an ephemeral loopback-only media listener that serves one
capability-authorized verified logical torrent file. It is not a daemon,
application-control socket, arbitrary filesystem server, or authority to
expose payload on a peer, LAN, mapped, or public listener.

### Initial platforms

Android/ChromeOS and desktop are the initial product surfaces. Desktop is the
fastest bring-up and diagnostic environment. Android/ChromeOS supplies the
primary product pressure and must receive physical-device validation.

iOS is a maintained first-party native surface around the same Rust engine and
typed application service. Tacticals `116` and `123` remain the completed
physical feasibility and negative-classification records. Explicit maintainer
authorization on 2026-08-13 completed the product in Tacticals `147`--`149`:
foundation and qualified roots, direct JSTorrent SwiftUI reuse, then finite
lifecycle/recovery and reproducible local archives. This does not authorize
TestFlight, App Store, or other publication.

### Android engine parity gate

Android/ChromeOS Android must not become a downstream engine port. For every
applicable engine or application capability, the same tactical owns Android
semantic behavior, generated bindings, cross-build, and platform evidence
proportional to the change. Missing Android adaptation blocks completion and
cannot be left as an unspecified follow-up. A behavior may be marked
inapplicable only with an explicit reason tied to the actual Android product
path.

This gate concerns engine and application correctness, lifecycle, restart,
resource bounds, and diagnostics. It does not require Compose to reproduce
desktop inspection density or expose every advanced setting. It also does not
permit a Kotlin payload path, checker, scheduler, cache, or second torrent
runtime to manufacture parity.

### Detailed desktop inspection and platform presentation split

After the first engine-parity campaign produced a roughly functional product
but an indirect interactive debugging loop, desktop/web becomes the detailed
inspection surface as recorded in
[`desktop-inspection-surface.md`](desktop-inspection-surface.md). Its product
reference is the existing JSTorrent torrent-detail interface rather than a
new minimal dashboard. The frontend itself is a fresh implementation: its
responsive information architecture, React and CSS Modules baseline, category
layer, touch posture, and accessibility requirements live in
[`web-ui-design.md`](web-ui-design.md).

Its application boundary groups named projections into short-lived leased
view sets with coherent snapshots, typed keyed diffs, recoverable cursors,
periodic polling, and later interchangeable streaming. Rust remains the
semantic source for generated TypeScript and runtime schema. A TypeScript
controller materializes those views through pure reducers into a Zustand
store. The accepted contract lives in
[`application-view-api.md`](application-view-api.md).

Android remains a first-party product but no longer has a default obligation
to mirror desktop tabs or diagnostic density. Engine and application
semantics remain shared; presentation parity is decided per feature. The
desktop application-view API and initial inspection direction are now
established, and the oracle-driven engine campaign has resumed for the
accepted maximum-throughput storage sequence.

### Bounded implementation tacticals

Substantial implementation begins with a numbered tactical. An automated run
may work deeply within that slice, but it should not silently expand the
feature or platform surface. Multiple independent tacticals may proceed at the
same time. Each tactical records its own outcome and validation honestly;
actual dependencies and overlapping ownership are reconciled before work that
depends on or conflicts with another slice, rather than imposing a global
sequence.

### Pure protocol and domain boundaries

Protocol values, codecs, and deterministic state transitions remain independent
from async runtimes, sockets, filesystems, task handles, and platform adapters.
Tokio is the expected initial execution environment, not a dependency that may
leak into lower-layer contracts. Runtime and platform code depend inward on the
pure layers.

Keep an eye out for module and crate boundaries as implementation provides
evidence, especially runtime leakage, poor test seams, and modules accumulating
unrelated responsibilities. Refactor when the benefit is concrete and
proportionate to the active tactical. Speculative abstraction is not a
substitute for evidence.

### Initial implementation boundary

Tactical `000` established the first workspace boundary as two crates:
`rstorrent-protocol` owns bounded parsing, codecs, and deterministic piece
state, while `rstorrent-engine` owns Tokio, TCP, timeouts, and verified output.
An automated architecture test enforces the inward dependency direction.

Tactical `001` kept that boundary while replacing piece-sized resident payload
with reservation-before-request accounting, block-at-a-time unverified
staging writes, and streamed verification. Its controlled 32 MiB
interoperability fixture reached a 256 KiB engine-owned payload high-water and
used a 16 KiB verification buffer. These are component bounds, not an exact
process-RSS promise.

Tactical `002` kept protocol layout independent from runtime storage while
adding bounded multi-file metainfo, safe relative paths, binary file
selection, cross-file request mapping, and torrent-wide piece state. The
runtime now stages wanted paths, places skipped boundary ranges in a versioned
compact-slot part file, synthesizes padding zeroes during 16 KiB streamed
hashing, publishes the selected tree only after verification, reopens durable
placement metadata, and materializes verified skipped files.

The controlled five-piece fixture requested 97,232 real bytes in seven
requests under a 32 KiB payload allowance. One skipped-only piece and 3,304
padding bytes were not requested. Two boundary-piece slots survived reopen
and remained allocated because a permanently skipped file still overlapped
them. This proves a bounded selective-storage foundation, not unfinished-piece
resume, arbitrary priority changes, or a production filesystem format.

Tactical `003` exercised that provisional sparse part-file geometry through
direct Rust file-descriptor I/O on an API 34 AVD, the physical Chromebook's
API 33 ARCVM, a physical API 37 Pixel 7a, and a physical API 28 Moto X4.
Three fresh runs on each internal destination preserved a 256 MiB sparse hole
with only 36--40 KiB allocated. Three additional runs through the Moto's
removable exFAT SAF descriptor allocated 268,566,528 bytes for the
268,451,840-byte logical probe and spent 8.6--11.0 seconds in truncate, write,
sync, and read. All profiles verified both markers after close and process
death, proved duplicated-descriptor ownership and observable cancellation,
and supported directory and materialization renames.

The probe also established Android-specific seams worth retaining:
restart-critical URI state must be committed before process termination,
borrowed descriptors are duplicated before native ownership, buffer and
cancellation bounds remain independent of logical piece size, provider
capabilities are explicit, and grants target a user-visible child rather than
the protected Downloads root. The Moto evidence makes sparse allocation an
explicit destination observation rather than a portable disk-space promise.
The two physical devices still do not establish general OEM, cloud, removable
filesystem, or Android-version compatibility.

The pinned libtorrent reference uses the same compact piece-slot part-file
shape without selecting a filesystem-specific fallback. Sparse storage is its
recommended default, full allocation is optional, and allocation latency is
isolated behind disk jobs and queued-byte backpressure. RSTorrent should follow
that proven direction unless broader product evidence justifies divergence.

Tactical `004` packaged the real engine for x86_64 and arm64-v8a Android,
generated a locked UniFFI `0.31.0` control plane, and made a foreground service
the explicit owner of one Rust runtime and task. Three selective-download
cycles passed on an API 34 AVD, the Chromebook's API 33 ARCVM, and an API 28
Moto X4. The AVD and Moto also passed slow-storage backpressure, both
cancellation phases, peer failure, duplicate start, activity recreation, and
pre-existing-artifact preservation.

The Android bootstrap retained the 32 KiB payload high-water while separately
reporting requested, received, and stored bytes. Kotlin carried no piece
payload, Rust opened the peer socket directly, and every terminal result
joined the task and returned the controlled peer to zero connections. This
proves in-process engine packaging and lifecycle through app-private
path-backed storage; it does not yet connect the engine to SAF destinations.

Tactical `005` implemented that SAF connection. Rust now derives an exact
bounded document plan, synchronously duplicates caller-owned descriptors for
wanted files, the compact part file, an independent reopen handle, and
materializations, and runs the existing selective placement and verification
logic over those owned handles. Native completion is `PREPARED`, not product
success. Kotlin performs only coarse provider renames; after process death a
fresh process reopens every published document and a fixed 16 KiB Rust loop
checks exact length and a native-produced per-file SHA-1 before cleanup.

Three complete publication/restart cycles passed on the API 34 AVD, the
physical Chromebook's API 33 ARCVM, and the physical API 37 Pixel 7a. AVD
evidence also covers slow storage at the 32 KiB payload high-water, peer
failure after a real request, duplicate start, activity recreation, and
cancellation before and after stored progress. The required Moto internal and
removable rows remained unrun because the previously identified Moto X4 was no
longer attached. Tactical `005` was closed with those rows and remaining
provider-failure profiles explicitly deferred rather than claimed.

Tactical `006` added bounded v1 magnet parsing, direct `x.pe` peer bootstrap,
bidirectional BEP 9 metadata exchange, and same-connection handoff into the
existing bounded content path. Independent libtorrent evidence covers exact
multi-block info dictionaries in both directions.

Tactical `007` introduced `rstorrent-session` above the engine. One
profile-local bundled SQLite authority now stores exact hash-authorized magnet
metadata, source and selection intent, versioned have state, lifecycle, roots,
and bounded command receipts. A transport-neutral command dispatcher,
path-storage reopen, per-piece sync-before-checkpoint ordering, fixed-buffer
restart recheck, pause/shutdown joins, and three forced-death libtorrent runs
establish the first durable application thread. SQLite `3.53.2` cross-compiled
for both established Android Rust targets, but actual Android database and SAF
resume execution remain deferred.

Tactical `008` added bounded recoverable view streams above that application
service, generated matching TypeScript and Kotlin contracts, and exercised the
same semantic command and view model through a remote browser/WebSocket proof,
a Tauri channel, and Android UniFFI/Compose.

Tactical `009` connected the Android product thread to durable SAF session
storage. Stable root identity remains portable, provider capabilities remain
in Kotlin, descriptors cross into Rust at coarse lifecycle boundaries, and
prepared publication is verified before durable completion. Controlled
forced-death recovery completed on the API 34 AVD and physical Pixel 7a.

Tactical `010` replaced diagnostic peer address loops with a
runtime-independent bounded peer registry and explicit observation,
selection, attempt, failure, and connection lifecycles. Manual peers and
magnet hints now share that path; controlled tests prove connect and metadata
capability failover while preserving same-connection metadata/content
handoff.

Tactical `011` added bounded UDP tracker values and BEP 15 codecs, preserved
tracker-only magnets through session persistence, and lazily feeds compact
tracker results into that peer registry. Controlled protocol tests and three
libtorrent runs prove tracker and peer failover through verified metadata and
content while keeping the runtime loopback-only and one-shot.

Tactical `012` added prompt task supervision, a derived progress assessment,
and bounded structured diagnostics with equivalent web/Tauri and Android
presentation. Its headless browser gateway and no-window AVD harnesses provide
routine UI evidence without disturbing the desktop development session.

Tactical `013` replaced the bring-up runtime's implicit loopback restriction
with explicit `Offline`, `LoopbackOnly`, and `Online` destination policies.
Desktop and Android choose `Online`; diagnostic CLIs, the loopback browser
gateway, and controlled harnesses choose `LoopbackOnly`. Offline networking
produces blocked progress without changing torrent intent. Peer connect and
I/O waits are bounded independently, while a torrent no longer has an
artificial whole-download deadline.

Tactical `014` replaced the one-shot tracker cursor with a supervised
per-torrent schedule. Magnet UDP trackers form one shuffled synthetic tier,
fall through on failure, remain eligible under bounded quadratic backoff, and
promote on success. UDP exchanges retransmit once, reuse short-lived
connection IDs, and reannounce on bounded tracker intervals. Headless Chrome
and an owned no-window Android AVD prove that a temporary tracker failure
renders as waiting for automatic discovery rather than externally blocked.

This is an accepted starting shape backed by unit and libtorrent
interoperability evidence, not a promise that two crates are the final engine
layout. Add or split crates only when later ownership, reuse, lifecycle, or
testing evidence justifies it.

## Initial Non-Goals

- Chrome extension or Chrome native-messaging integration.
- Android companion HTTP/WebSocket service.
- A generic socket or filesystem daemon.
- App Store/TestFlight publication or an iOS public-release claim. Completed
  Tacticals `147`--`149` build, archive, development-sign, install, and
  physically validate the product without publishing it.
- Search plugins, streaming playback, or remote administration in the first
  useful product.
- Exact JSTorrent API, engine, persistence, or feature parity. Completed
  Tactical
  [`117`](../tactical/117-jstorrent-shaped-android-product-ui.md)
  deliberately adopts the Android standalone navigation, screens, and feel;
  that bounded presentation decision does not imply whole-product parity.
- A literal all-Rust UI requirement. Rust engine ownership and first-party
  clients are the important constraints.

## Open Decisions

- The evidence, compatibility work, and release process required for that
  graduation.
- The exact minimum useful BitTorrent feature set.
- Which JSTorrent fixtures can be reused directly and which should be
  independently recreated.

## Candidate Bring-Up Sequence

This is recommended direction beyond the accepted first slice:

1. Completed:
   [`000-first-verified-piece.md`](../tactical/000-first-verified-piece.md)
   established independently tested bencode, metainfo, peer-wire, one-piece
   state, and a libtorrent-interoperable vertical thread.
2. Completed:
   [`001-bounded-large-piece.md`](../tactical/001-bounded-large-piece.md)
   established block-granular payload accounting, staging, and streamed
   verification independently of piece length.
3. Completed:
   [`002-selective-multi-file-storage.md`](../tactical/002-selective-multi-file-storage.md)
   established cross-file mapping, skipped-file part storage, verified
   publication, durable reopen, and materialization under the bounded
   block pipeline.
4. Completed:
   [`003-android-storage-feasibility.md`](../tactical/003-android-storage-feasibility.md)
   established fixed-buffer Rust descriptor I/O, sparse-offset behavior,
   persisted SAF access, cancellation, publication capabilities, and cleanup
   on an AVD, Chromebook ARCVM, physical Pixel 7a, and Moto X4 internal and
   removable exFAT storage.
5. Completed:
   [`004-android-engine-bootstrap.md`](../tactical/004-android-engine-bootstrap.md)
   proved actual engine packaging, the UniFFI control plane,
   foreground-service ownership, direct Rust networking, bounded app-private
   storage, cancellation, and failure cleanup on Android.
6. Closed with explicit deferred validation:
   [`005-saf-selective-storage.md`](../tactical/005-saf-selective-storage.md)
   connected the real selective-storage engine to Android SAF capabilities
   without moving payloads through Kotlin. Moto and remaining provider-fault
   evidence is not claimed.
7. Completed:
   [`006-magnet-metadata-peer-hint.md`](../tactical/006-magnet-metadata-peer-hint.md)
   added bounded v1 magnet parsing and bidirectional BEP 9 metadata exchange,
   then handed verified metadata and bounded premetadata peer state to the
   existing content path over the same connection.
8. Completed:
   [`007-durable-session-control.md`](../tactical/007-durable-session-control.md)
   established the profile-local SQLite authority, semantic application
   commands, exact magnet metadata and have persistence,
   sync-before-checkpoint ordering, forced-death resume, and conservative
   fixed-buffer recheck.
9. Completed:
   [`008-reactive-multi-surface-control.md`](../tactical/008-reactive-multi-surface-control.md)
   applied the first real client pressure through recoverable reactive views,
   generated TypeScript and Kotlin values, a shared browser/Tauri web UI, and
   an Android Compose adapter.
10. Completed:
    [`009-android-saf-session-storage.md`](../tactical/009-android-saf-session-storage.md)
    connected the durable application service and Android foreground product
    thread to restartable SAF storage and provider publication.
11. Completed:
    [`010-peer-registry-magnet-failover.md`](../tactical/010-peer-registry-magnet-failover.md)
    established bounded peer records, deterministic selection, guarded dial
    transitions, failure history, and same-connection magnet failover.
12. Completed:
    [`011-one-shot-udp-tracker.md`](../tactical/011-one-shot-udp-tracker.md)
    established bounded UDP tracker connect/announce, tracker observations,
    durable tracker-only magnet retention, and controlled libtorrent
    metadata/content transfer.
13. Completed:
    [`012-bounded-diagnostics-progress.md`](../tactical/012-bounded-diagnostics-progress.md)
    established prompt task supervision, derived progress, bounded structured
    diagnostics, and equivalent headless-tested web and Android presentation.
14. Completed:
    [`013-explicit-live-network-policy.md`](../tactical/013-explicit-live-network-policy.md)
    made outbound policy explicit, enabled routed networking in products,
    retained loopback isolation in harnesses, and bounded individual
    network waits instead of whole torrent lifetime.
15. Completed:
    [`014-scheduled-udp-tracker-lifecycle.md`](../tactical/014-scheduled-udp-tracker-lifecycle.md)
    established supervised UDP tracker records, multi-tracker fallback,
    bounded retry/reannounce, loss recovery and token reuse, and equivalent
    waiting diagnostics on the web and Android surfaces.
16. Grow the resulting thin surfaces only through capabilities the engine and
    application service actually own. Desktop content UI remains web-based;
    native desktop code owns the shell, tray, and operating-system integration.
17. The accepted graduation-level host/client choices, extension
    control posture, handoff requirements, host isolation, and best-effort
    JSTorrent graduation direction are recorded in
    [`product-surfaces-and-migration.md`](product-surfaces-and-migration.md).
    Their implementation still requires separate bounded tacticals.

The platform feasibility probe remains a separate tactical so failure in it
does not distort the protocol vertical slice.

## Recommended Next Work

[`capability-readiness.md`](capability-readiness.md) owns the current prioritized
queue so this durable direction does not become a competing backlog. The
session-owned IPv4 DHT foundation now supplies bounded routing and traversal,
private-torrent policy, controlled interoperability, and useful warm restart.
The paired headless RSTorrent/libtorrent public-smoke comparator remains an
active evidence tactical, not a separate product surface.

Bounded multi-peer request ownership now lets newly discovered and late-
arriving peers improve active transfers. The engine campaign's retained
storage-execution checkpoint remains valid, but implementation is paused while
the view-set application boundary and detailed desktop inspection surface are
established. The first product slice is headless contract infrastructure, not
a visible UI: it proves view-set recovery, generated client/schema drift,
polling, and a pure TypeScript client before React depends on it.

Product growth should continue through the established application service,
generated contracts, and platform capability seams rather than creating
another orchestration surface. Protocol support claims and download
correctness evidence are tracked separately in
[`protocol-support.md`](protocol-support.md) and
[`download-correctness.md`](download-correctness.md). The DHT and live-evidence
campaign contracts live in [`dht-discovery.md`](dht-discovery.md) and
[`performance-and-live-evidence.md`](performance-and-live-evidence.md).
