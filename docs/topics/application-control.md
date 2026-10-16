# Application Control

Tactical [373](../tactical/373-file-selection-bitmaps-and-download-safety.md)
adds capability-owned UpdateFileSafetySettings (one complete bounded settings
domain) and SetFileSafetyOverride (up to 4,096 explicit file indices). Expected
revision and durable receipt replay apply as usual. Ordinary selection and
Download all preserve the captured safety mask; Download now refuses a blocked
file with the existing InvalidRequest code. An explicit allowance selects while
preserving High/paused intent, and queues part-file promotion across restart.
See [download safety](download-safety.md).

Tactical [344](../tactical/344-seeding-stop-limits.md) adds the first
application-initiated durable pause: a reached seeding stop limit commits
paused intent with `seed_limit_stopped`, which only Resume (meaning keep
seeding, with the torrent's own limits set to No limit) or another
running-intent command clears. User Pause never sets it.

Tactical [340](../tactical/340-windows-quiet-network-startup.md) applies the same
one-time hold to Windows. The desktop startup helper keeps catalog mutation,
marker persistence and shutdown-on-failure in one testable path. A persisted
marker is not rewritten on ordinary launches. Running and paused intent are
preserved independently; native Windows retains completed verified bytes and
unrelated v3 shell choices. No command, DTO or Android behavior changes.

Tactical [339](../tactical/339-macos-quiet-network-startup.md) applies the one-time Mac network-default hold
transaction before networking, preserving torrent intent, verified state and
port preference. Desktop persists its defaults-version marker before exposing
control. Subsequent explicit choices survive restart; the marker is not an OS
grant. Common incoming-Off reconciliation cancels inbound work and removes its
advertisement while retaining outgoing UDP/replies and loopback control.

Tactical [335](../tactical/335-removal-pieces-and-disconnect-lifetime.md)
preserves the durable removal contract through WebSocket disconnection: an
executing removal retains its caller until finalization or recorded failure,
while a queued call cancels before service entry. Payload deletion can no longer
leave a pending job solely because its browser response consumer closed.
Process interruption still resumes pending jobs on startup; Android SAF retains
its existing service-owned matching-generation confirmation.

Tactical [308](../tactical/308-android-optional-add-selection.md) adds explicit
`DownloadAllPendingAdd` consent without a catalog. One transaction clears pending
selection and source-derived ranges, installs Normal for all ordinary files,
sets running intent and queue order, then the existing metadata/content owners
reconcile. Non-pending, removal and repair fences remain; no metadata is treated
as verified before validation. This per-add action leaves future selection
preferences unchanged unless its `disable_future` flag
([323](../tactical/323-pre-metadata-skip-file-selection.md)) clears
`show_file_selection` in the same transaction, as confirmation already can.
Tactical [324](../tactical/324-release-queued-adds-on-skip-file-selection.md)
makes that flag also release every other queued add with its existing
selection, in add order, except removing or quarantined torrents; the web
dialog draft is keyed by torrent. Typed rejected mutations now roll back to a command
savepoint before their error receipt is committed, preventing partial intent
or revision changes on a failed write.

Topic: `application-control`

Active Tactical
[`212`](../tactical/212-application-lifecycle-verification-gate.md) repairs the
existing Resume contract: if checking a paused seed discovers missing wanted
data, Resume atomically restores absent download-queue order with running
intent. Complete seeds stay out of that queue, existing positions are stable,
and exact replay/reopen pass. No command or generated type is added.

Status: Direct-storage application-contract replacement completed on
2026-08-29 by Tactical
[`191`](../tactical/191-direct-filesystem-storage.md). It removes
`AwaitingPublication`, publication storage/progress/media facts, and
`DeleteManaged` across generated first-party boundaries. Replacement facts
name checking, incomplete, missing, root-unavailable, repair, wanted
completion, full seeding, and plain exact data deletion. Earlier contract
history below remains as an implementation record. Completed Tactical
[`193`](../tactical/193-stateless-foreground-downloader.md) composes the
existing add, view, completion, and joined-shutdown behavior behind a finite
native CLI. It uses `AddMagnet` or the existing torrent-byte intake, one
Summary subscription, and a final snapshot; it adds no alternate engine
command or generated client contract.

Implementation-complete Tactical
[`208`](../tactical/208-installation-metrics-and-feedback-parity.md) changes no
public torrent command or response. Schema 26 appends one of two closed,
profile-local product milestones in the same transaction as successful
catalog creation or first ordinary downloaded completion. A single joined
application drain applies and acknowledges them idempotently; failure or the
1,024-row bound can degrade only derived product counters, never the
authoritative command outcome, verified state, or torrent lifecycle.

Completed Tactical
[`188`](../tactical/188-existing-payload-adoption-and-recheck.md) makes
existing-payload discovery a transparent consequence of starting a verified
torrent without durable storage ownership. It adds no command, setting, path
authority, or alternate checker. Completed Tactical
[`143`](../tactical/143-dual-identity-and-persistence-foundation.md) makes the
canonical opaque `TorrentId` the command, receipt, queue, runtime, and
cancellation owner while projecting protocol identities separately; legacy
40-hex application IDs fail validation. Tactical `007` implemented the first
transport-neutral semantic control contract and in-process application
service. Tactical `008` added
recoverable reactive views and browser, Tauri, and Android adapters. Tactical
`012` added bounded typed diagnostics, derived progress assessment, and prompt
task-terminal supervision with isolated headless presentation evidence.
Tactical `013` added explicit application network configuration and a blocked
offline prerequisite without changing durable torrent intent. Tactical `033`
implemented the leased application-view owner, generated v1 JSON contract,
authenticated loopback polling adapter, and headless lifecycle client recorded
in [`application-view-api.md`](application-view-api.md). Tactical `040` adds
durable archive/restore and fenced removal with explicit keep-data or
delete-managed policy. Tactical `046` makes a successful pause receipt follow
the joined metadata/content supervisor result and its final empty peer
observation. Tactical `048` adapts the same commands and leased view sets to
the in-process Tauri product without introducing a local server. The live web
adapter now gives each application instance a random request-ID namespace so
durable receipts do not conflict across reloads or tabs. Tactical `060`
carries the same typed calls over one bounded loopback WebSocket without making
connection correlation the owner of durable request identity. No stable public
remote wire format is accepted. Tactical `049` evolves diagnostics into
hierarchical structured records with explicit capture interest and distinct
source, delivery, and local loss while keeping them separate from commands and
product-state authority. Tactical `063` adds metadata-only magnet intent and
durable live `Normal`/`Skip` file selection through the same semantic command
boundary. Completed Tactical
[`176`](../tactical/176-durable-high-file-priority.md) extends that command to
the product-level `High`/`Normal`/`Skip` model. High and Normal are wanted;
Skip is unwanted. High changes durable ordinary scheduling in the active
generation without restarting storage or invalidating verified data, while
`Download now` means Normal plus running and therefore clears High on its
targets. Repeated semantic values remain revision-idempotent.
Tactical `073` adds `force_recheck` as a semantic durable command with the
same expected-revision and request-receipt rules. It joins an active matching
generation, preserves durable run intent, and starts the common managed-
storage check without exposing paths, handles, or engine tasks.
Completed Tactical
[`108`](../tactical/108-serialized-torrent-control-and-observable-checking.md)
supersedes the coarse runtime boundary chosen by Tactical `063` without
rewriting its completed record. One serialized torrent controller reconciles
durable run, selection, and verification intent; one bounded
storage fence owns priority routing; and selection changes during a
selection-independent check coalesce without replacing the complete content
generation. Pause drains and retains an active checker generation and cursor,
while resume releases the same owner. Completed Tactical
[`110`](../tactical/110-atomic-download-now.md) adds exactly that semantic
command: bounded file indices become wanted and durable run intent becomes
running in one transaction and profile revision. The existing controller
reconciles current durable intent after commit or replay, retains a healthy
peer or checker generation where possible, and rejects a different busy
torrent before durable mutation. Clients do not compose priority and Resume
commands or inspect checker phase.
Completed Tactical
[`114`](../tactical/114-session-wide-concurrent-torrent-admission.md) removes
that different-torrent busy boundary. Resume durably enters one automatic
download queue, `Download now` atomically moves the torrent to its head, and
top/bottom commands mutate only durable order. One application-generation
admission owner reconciles an active-generation map under configured/effective
limits; command success remains durable intent, while queued, active,
checking, stopping, seeding, paused, and error are authoritative operational
state rather than client inference.
Tactical `075` keeps that semantic contract and its request receipts intact in
an explicitly selected, private, bounded in-memory application-state mode.
SQLite `FULL` now has the typed `resource_limit` response classification in
both persistence modes. Tactical `081` adds one byte-bearing v1 metainfo
operation beside the JSON command union: source length and SHA-256 join
semantic request identity, while WebSocket, HTTP, and Tauri adapters carry the
bytes without paths or base64. Exact duplicate replay, stale-revision
rejection, rollback and source-conflict behavior share the existing command
semantics. Tactical `083` removes SHA-256 from the caller declaration: Rust
derives it from the received bytes and reconstructs the same legacy receipt
fingerprint, so existing exact replays and different-byte conflicts remain
unchanged while browser intake needs no source hashing or secure context.
Tactical `084` adds one atomic typed `set_client_settings` command through the
same generic HTTP, WebSocket, Tauri, and UniFFI dispatch. Durable configured
intent changes immediately.
Tactical `088` extends that same closed command group with local-network
listener and explicit UPnP mapping intent. The existing torrent-list summary
projects disabled, ineligible, discovering, mapping, mapped,
renewal-failed/failed, and stopping runtime state; gateway work and mapped
addresses do not become commands or durable authority.
Completed Tactical
[`097`](../tactical/097-live-client-settings-and-replaceable-session-generations.md)
keeps the command and persistence waist but replaces restart application with
one asynchronous desired-to-effective reconciliation owner. Successful no-op
and replayed saves can retry degraded runtime convergence without inventing a
second command or settings route. Persistence resolves before submission;
ephemeral profiles retain the same intent in memory. The response and view
carry configured intent, effective values, and independent
applying/applied/degraded domains while stable peers, DHT, discovery, and
accounting survive transport handover.
Tactical `085` adds the minimal projected `force_recheck_available` capability
and composes existing per-torrent commands sequentially in the React action
owner. It does not add a batch command, atomic multi-torrent semantics, or a
new application task owner. Tactical `095` adds no command: the existing
paged tracker view now projects plaintext HTTP versus encrypted-but-
unauthenticated HTTPS, while the application composes the same long-lived
discovery owner for every supported tracker transport.
Completed Tactical
[`098`](../tactical/098-authenticated-https-tracker-platform-trust.md) extends
the same complete `set_client_settings` value with tracker HTTPS server
authentication. It adds no tracker route or mutation task: persistence still
resolves first, Tactical `097`'s one reconciler applies the domain, and typed
responses/views distinguish configured intent, optional effective policy,
degraded construction, and operation-captured tracker security.

Completed Tactical
[`134`](../tactical/134-hierarchical-transfer-rate-enforcement.md) adds
semantic Unlimited-or-bounded upload and download policy at the session and
torrent levels. The existing whole-group `set_client_settings` command owns
the session pair, while one `set_torrent_transfer_limits` command commits the
torrent pair atomically under the same durable revision, request-receipt,
replay, stale-revision, rollback, and convergence rules. Runtime application
updates one stable session bandwidth owner without replacing peer, discovery,
listener, or torrent generations.

Completed Tactical
[`180`](../tactical/180-typed-settings-patches-and-draft-convergence.md)
supersedes and removes those command shapes with typed non-empty resource
patches: each transfer direction or client property may be supplied
independently, while any properties supplied together merge, validate, and
commit atomically. Exact replay and semantic no-op retain their prior receipt
and revision rules, and only affected runtime domains reconcile. The owning
[`settings-mutation-and-draft-consistency`](settings-mutation-and-draft-consistency.md)
topic also defines receipt-to-view convergence and requires clients to retain
dirty/submitted fields under repeated complete view values.

Completed Tactical
[`138`](../tactical/138-verified-http-file-serving.md) adds the read-only
`create_media_url` semantic call for one torrent identity and file index. It
authoritatively rechecks typed eligibility, creates or reuses one volatile
file capability, and returns the complete ephemeral URL with idle and
absolute lifetime metadata. It is not a durable command, request envelope,
receipt, event, lifecycle mutation, or storage-path grant; reading it does not
start, resume, unskip, prioritize, repair, or recheck content.
Completed Tactical
[`139`](../tactical/139-incomplete-file-streaming-demand.md) extends that same
call to a separately typed active `streamable` file. The returned capability
owns transient current/ahead demand only while a body is live and may hand
the same byte position to the exact published representation on ordinary
completion. This remains a read-only semantic operation: eligibility and
generation are rechecked authoritatively, and no durable selection, run,
priority, verification, or lifecycle intent changes.

## Scope

This topic owns the application-facing command, response, snapshot, and event
model above the torrent engine. It also owns the boundary between those
semantics and transports such as an in-process UI adapter, a diagnostic
process stream, or a future authenticated remote connection.

It does not authorize a daemon, listener, relay, account system, remote
authentication design, or payload traffic across the control boundary.

## Direction

Android, desktop, CLI, and application-level integration tests should drive
the same application service through the same typed semantic contract. The
local product still runs that service and the engine in-process. Sharing
semantics does not require local networking or serialization.

The initial contract has:

- a versioned request envelope with a caller-supplied request identity;
- an optional expected revision for rejecting stale mutations;
- typed commands referring to torrent and storage-root identities rather than
  sockets, file descriptors, paths, or platform objects;
- a correlated typed success or structured error response;
- monotonically increasing service revisions and complete bounded snapshots;
  and
- idempotent desired-state operations or persistent request deduplication
  where retrying a command could otherwise duplicate durable intent.

Commands express application intent. The application service translates that
intent into durable state and engine lifecycle operations. Peer messages,
piece buffers, SQL rows, logs, and task handles are not part of the contract.
Structured observability remains separate from command responses and product
state.

A bounded byte attachment may accompany a closed semantic operation when the
intent itself is binary, as for `.torrent` intake. The request still
owns version, request ID, optional expected revision, established storage-root
identity, start intent, selection, and exact source length. Common Rust
preparation derives the exact-source digest before persistence. Durable
receipt replay compares that server-derived digest and normalized options
rather than storing bytes in JSON. Adapters may frame or carry the attachment
differently, but no adapter gains alternate mutation, duplicate, revision, or
storage policy.
Tactical `081` bounds this attachment at 64 MiB, admits one at a time per host,
and replaces per-file index enumeration with canonical
all/none/range intent plus later paged mutations so the command envelope stays
within 64 KiB at the accepted file cardinality.

Application views may expose a derived progress assessment without promoting
it to a second durable state machine. The assessment distinguishes an active
owner, an automatic mechanism or scheduled retry that is still waiting,
external blockage where no installed mechanism can advance, and deliberately
inactive torrents. Failure or exhaustion of one tracker, peer, or discovery
mechanism is not itself a torrent error and is not blockage while another
automatic mechanism can still act.

Application network permission remains separate from each torrent's desired
running or paused state. An offline policy prevents DNS and socket work and
reports `network_disabled` with an `enable_network` action; it does not turn
the torrent into an error or durable pause. Tactical
[`199`](../tactical/199-android-live-unmetered-network-enforcement.md) adds the
first live application prerequisite: Android's default-off unmetered cost
policy combines transient platform facts with one durable user preference,
atomically closes and joins every BitTorrent network generation, and starts
only the latest eligible generation through ordinary admission. Fixed address
policy, durable torrent intent, local application work, and product control
remain separate. Deterministic and API 28/35 installed-product evidence passes;
the supported-phone gate still awaits explicitly authorized physical handoff
evidence. VPN binding and proxy routing remain independent contracts.

Android process lifetime is also not torrent lifecycle intent. Tactical
[`200`](../tactical/200-android-product-background-lifecycle.md) now makes the
one Android service/application owner decide whether visible interaction,
explicitly allowed active background work, optional seeding, a bounded
interaction, or an authenticated companion retains that generation. Idle,
completion, timeout, notification ineligibility, task removal, and companion
disconnect may join and close the generation, but never synthesize Pause,
Pause All, Stop Torrent, or a queue mutation. A later visible launch opens the
same profile and applies its durable desired-running and paused state through
ordinary admission. Android-15 quota exhaustion is a platform-owned durable
fence cleared by that visible launch; an invisible recreation never becomes
a second source of torrent intent or foreground authority. The lifecycle gate
is complete through installed API 28/35 behavior, deterministic companion
count/grace transitions, and Tactical `194`'s physical ChromeOS transport and
shutdown evidence. A later physical ChromeOS 150/API-33 strengthening campaign
also proves default-off and admitted background transitions, sticky recovery,
completion and seed shutdown, an authenticated companion retaining the owner,
60-second disconnect/reconnect cancellation and idle expiry, notification
ineligibility, explicit notification Stop, service relaunch, terminal listener
refusal, and exact cleanup. These platform closures still do not mutate torrent
intent or claim indefinite/OEM-wide background duration.

Completed Tactical
[`201`](../tactical/201-durable-seeding-goals-and-seed-admission.md) extends
ordinary admission with the exact pinned libtorrent seed queue. One combined
application owner applies download-first hard/type limits, inactive exemption,
and descending seed rank while preserving the existing typed settings revision
path. Zero, finite, and Unlimited active-seed patches reconcile live without
replacing unaffected generations. Goal completion changes runtime priority
only; it never synthesizes Pause, Stop Torrent, queue mutation, or another
durable intent.

Typed diagnostics use a separate bounded reactive projection. They may explain
the facts behind a progress assessment, but clients do not parse diagnostic
text to determine torrent state, available actions, or correctness. A view
begins from bounded recent history, filters capture before its transport
queue, detects overflow or sequence loss, and can resynchronize independently
from product-state views. Hierarchical categories and typed subjects/fields
are deliberately projected application semantics rather than arbitrary Rust
debug values.

Detailed clients aggregate their currently relevant named projections into a
leased view set. One view set owns an epoch, opaque cursor, bounded diff
accumulator, and independent recovery state. Periodic pull and later streaming
drain the same semantic update batches; transport authentication and wire
encoding remain adapters. View-set identifiers are resource locators, not
authentication credentials or durable application state.

Storage roots and platform capabilities are installed when an application
service instance is constructed or through a later platform-specific
capability operation. A remotely meaningful command selects an established
root identity; it never supplies an ambient local path or open descriptor. The
accepted first-add, default-root, local picker, and remote-client behavior
is recorded in [`download-roots.md`](download-roots.md).

Tactical [`194`](../tactical/194-chromeos-android-extension-control.md) applies that
split to the same-device ChromeOS Android companion client. The authenticated
platform client may request Android's SAF picker with only an optional opaque
repair-root ID and receives only the resulting root snapshot. The application
service remains authoritative for the single current/default root, retained
root inventory, per-torrent bindings, reference checks, and durable mutation;
Android remains authoritative for URI/grant acquisition, repair, and release.
Root lifecycle therefore needs a joined platform handshake and crash-recovery
journal, but no SAF locator becomes a command or application frame. Physical
two-root binding, repair, restart, Compose/React convergence, and detached
transfer pass. The separate ChromeOS listener now binds only to ARC's fixed
guest address; ChromeOS extension connection and same-LAN refusal pass.

Tactical `062` keeps publication naming behind this boundary. Verified
metainfo and the selected root resolve a durable relative publication
component inside the application/engine layers; no client command gains
a local path, proposed filename, or infohash-layout switch.

Tactical `063` keeps file selection semantic as well. The command carries a
bounds-checked torrent identity, file indices, and `Normal` or `Skip`; it does
not expose numeric engine priorities, storage paths, part slots, or picker
internals. Selection commits before the active immutable engine generation is
cancelled and joined. Metadata acquisition may continue for a paused
start-content intent, but content storage remains unopened until explicit
resume.

An opt-in official Ubuntu smoke on 2026-08-06 exposed a gap in that accepted
policy: a fresh metadata-only magnet started its external metadata owner but
left both session-owned HTTPS tracker rows inactive for 180 seconds because
their registration inherited the false content-running intent. Tactical `096`
repairs the boundary by combining durable content intent with the presence of
the actually owned metadata task only during discovery reconciliation. A
controlled tracker-only case and the repeated Ubuntu smoke prove activation,
terminal stopped announces, paused final state, and no payload artifacts.

Force recheck is likewise semantic. A replayed successful request cannot
start another generation, and a stale request mutates neither runtime nor
durable state. During checking, clients expose no old verified total as
current authority. Valid paused content may return to complete; invalid paused
content retains its exact replacement bitmap without admitting peer repair,
while running intent downloads only the missing or corrupt wanted pieces.
Completed Tactical
[`105`](../tactical/105-fact-based-persistence-and-recheck-containment.md)
corrects an observed Tactical `073` restart defect at this semantic boundary.
Force recheck first fences discovery and incoming activity and joins the
active content generation, then persists one restartable verification
generation. Its checkpoint sink admits only that generation, completion
atomically replaces evidence only for the matching request, and a stale
completion cannot satisfy newer work. Checking remains runtime-derived and
the separately retained user intent decides paused or running re-entry. A
malformed torrent is quarantined rather than preventing profile open.
Android application request IDs now include a process-random namespace before
their monotonic suffix, matching the browser contract and preventing a
restarted process from reusing `android-1` for different durable intent.
The torrent application view now also projects whether current durable managed
content can accept Force recheck. Clients use that semantic value only
to derive exact-selection availability; dispatch and durable request handling
remain authoritative if state races after activation.

Authorization is transport context, not a user-supplied command field. A
future remote transport must authenticate a principal, attach verified
capabilities to dispatch, apply replay and rate limits, and redact sensitive
source data. The application service must not trust an `is_admin`-style value
inside an envelope.

Completed Tactical
[`192`](../tactical/192-production-owner-relay-access.md) makes remote-security
management an application-owned semantic domain above that rule in a
production-shaped loopback validation composition; it adds no public listener
or support claim. A capable local or authenticated-owner adapter may list
bounded authorized-client, resume-expiry, live-circuit and security-ledger views
and may rename or revoke one authorization, revoke all others, require passwords
everywhere, sign out the verified current browser or clear retained
non-authorizing history. Client
and circuit IDs locate records but never grant access; **this browser** and
**other browsers** derive from verified transport context rather than caller
claims. Revocation commits before owned connection generations close, and a
successful receipt means future resume proof is already fenced. These security
operations use their own authority generation and receipts rather than the
torrent/profile revision or the complete client-settings draft.

## Compatibility Posture

The Rust semantic types may evolve while there is only an in-process client
and repository diagnostic. Serialization used by tests is a versioned
diagnostic encoding, not yet a public compatibility promise.

A future remote protocol should adapt to the semantic dispatcher rather than
becoming the owner of torrent state. The initial internal v1 shape, generated
TypeScript and JSON Schema, additive compatibility rules, and polling-to-stream
delivery model are recorded in
[`application-view-api.md`](application-view-api.md). Production
authentication, discovery, wake-up relay, and exposure policy still require a
separate threat model.

Successful commands should evolve toward command-specific results plus the
resulting durable revision rather than returning a complete service snapshot
after every mutation. Views remain the authoritative state-recovery path.
This change is internal while no stable public wire promise exists and must be
made with reducer and retry evidence rather than as an incidental transport
optimization.

Tactical
[`100`](../tactical/100-bep53-select-only-and-duplicate-add-feedback.md) makes
the add paths the first concrete use of that direction. Magnet and metainfo
adds return the affected torrent identity and distinguish `added`,
`already_present`, and BEP 53 `selection_expanded` outcomes with the resulting
revision. A plain duplicate is a successful no-op rather than a generic merge;
only an explicit `so` selection may promote skipped files. Exact request replay
returns the stored result without reapplying the transition, and adapters do
not infer duplicate state from messages or snapshot differences.

Tactical
[`107`](../tactical/107-source-aware-magnet-export.md) adds the first explicit
source export as a semantic non-mutation. `export_magnet` validates one torrent
identity and returns a typed magnet, exact/canonicalized/synthesized provenance,
and an omitted-tracker count at the current revision. It creates no receipt,
revision, task, or diagnostic and does not expose source text through routine
snapshots. Unknown identity uses the existing `unknown_torrent` error.

## Invariants

- Every mutation has one application-service instance and one session
  database as its authority, either its durable profile database or its
  private ephemeral database.
- Request correlation survives asynchronous execution and retry.
- A rejected stale revision cannot partially change durable or engine state.
- Snapshots are coherent at one service revision; events may later optimize
  updates but cannot be the only recovery mechanism.
- Local and diagnostic callers do not gain alternate privileged code paths.
- Shutdown, pause, profile close, and task failure have observable terminal
  states and joined owners.
- A task terminal result is observed without requiring a later client command.
- Blocked progress is asserted only when no installed or scheduled automatic
  mechanism can provide the next prerequisite.
- Temporary application network restriction does not rewrite a torrent's
  desired running or paused state.
- User-controlled magnets, paths, peer hints, and errors are bounded and are
  not emitted unredacted as routine logs.

## Implemented Thread And Gaps

[`../tactical/007-durable-session-control.md`](../tactical/007-durable-session-control.md)
implemented the first envelope and in-process dispatcher alongside durable
magnet resume. The Rust dispatcher and newline-delimited JSON diagnostic use
the same request and response types. Unit and forced-process-death evidence
cover request correlation, persistent duplicate replay, request-ID conflict,
stale revision rejection, coherent snapshots, pause/join, shutdown/join, and
restart through the same commands.

The diagnostic encoding remains repository test infrastructure. Tactical
`008` moved the new Android product path and Tauri shell onto the application
service and adapted the same semantic contract to a bounded loopback WebSocket
gateway. Generated TypeScript and Kotlin values, independent reactive
subscriptions, explicit resynchronization, and controlled real downloads now
provide cross-client executable evidence.

Tactical `037` routes the new React toolbar's bounded magnet intent through
that generated `add_magnet` contract. Input convenience checks improve local
feedback, but the application service remains authoritative for syntax,
resource bounds, durable duplicate handling, storage policy, and busy state.
Remote `.torrent` URL fetching remains absent rather than being represented as
a successful magnet add. Tactical `081` adds the separate file-byte operation;
Tactical `083` exposes it through the shared React empty-Add file chooser for
ordinary browser and Tauri use. The UI retains only the browser `File` while
root/start options are pending, then sends one bounded `ArrayBuffer` with
initial selection `all`.

Tactical `040` makes archive orthogonal to running intent and gives removal a
durable generation. The application service first persists paused removal
intent, joins any active torrent owner, and then either retains payload,
deletes exact path-backed managed artifacts, or waits for a trusted platform
adapter. Failed cleanup stays visible and can be retried with either retention
policy. Android SAF plans and confirmations are in-process operations keyed by
the matching generation; browser commands never carry paths or document URIs.

Tactical [`316`](../tactical/316-archived-torrents-and-android-selection-actions.md)
replaces the orthogonal archive rule: archived means shelved and inactive.
Archive persists paused intent in the same revision and joins active work
through the ordinary pause path; Restore leaves the torrent paused. Resume,
Download now and queue moves reject archived torrents with
`InvalidTorrentState`, and a torrent awaiting add-time file selection cannot
be archived. Opening a profile normalizes older archived rows that are running
or awaiting selection, without a schema version change. Force recheck, file
priorities, magnet export and removal remain available while archived.

Tactical `046` corrects the ordinary pause join beneath that application
contract. The application still persists paused intent first, requests safe
cancellation, and awaits the active task. Engine wrappers no longer race and
drop the metadata/content supervisor; the supervisor publishes disconnecting
and final removal observations after joining child owners. A deterministic
session test proves the pause response follows TCP close, and the same leased
view set receives the peer removal plus zero active-peer and payload-rate
summary fields without another command or a client-side clear. A
terminal owner-cleanup failure is recorded and propagated through pause rather
than being accepted as successful joined cleanup.

The live web adapter gives every application instance a random 128-bit request
namespace followed by a monotonic sequence. This preserves durable retry and
correlation semantics without reusing `web-1` for an unrelated command after a
reload or in another tab.

Tactical `063` historically implemented live path-backed file selection as a
deliberately coarse control fence. Tactical `108` retains its atomic durable
validation but replaces matching active-generation cancellation with one
latest-value selection revision, a drained storage-route epoch transition,
and in-place picker replacement. Existing peer connections and verified
evidence survive when the route preserves bytes; an unavailable promoted part
span clears only its affected pieces before repair admission. All-skipped
content becomes idle without losing running intent, and a later promotion is
runnable without a selection-triggered full-check request. Dynamic fixed-
descriptor selection remains deliberately fail-closed.

Completed Tactical
[`203`](../tactical/203-jstorrent-shaped-add-time-file-selection.md) adds the
pre-content counterpart without moving authority into a client. Schema 24
stores one pending-add state, FIFO projection, and default-on preference.
Pending magnets may own a bounded metadata acquisition generation but cannot
request or write content. React or Compose submits one catalog-fenced compact
Normal/Skip draft; the transaction atomically installs selection, clears the
pending state, and appends running content intent. Cancel is valid only for a
new pending add and joins ordinary keep-payload removal. Duplicate adds confer
no cancel authority. Completed-selection expansion remains download-owned
until verified boundary bytes have been materialized from the part store.

Tactical `085` deliberately keeps multi-target orchestration above this
boundary. The React owner snapshots materialized torrent order and sends one
fresh ordinary request at a time, continues after per-target failure, and
bounds presentation diagnostics. Multi-remove similarly confirms one policy
but dispatches durable removals individually, so it promises neither atomicity
nor rollback of an earlier successful deletion.

Implementation-complete Tactical
[`207`](../tactical/207-android-safe-reset-and-clear-data.md) keeps Android
clear-data orchestration above the same boundary while making it durable and
joined. The Android service journals one bounded target set, excludes non-owner
mutations, serially observes the existing per-torrent removal jobs, and does
not advance to private-profile reset or captured-grant release until those jobs
reach authoritative terminal states. A separate value-free
`ResetClientSettings` command now installs the application configuration's
complete fresh-profile setting set atomically; clients do not reconstruct
defaults. Store/application/workspace and API 28/35 service evidence passes;
the owned API 35 two-root Keep/DeleteData profile also passes exact sentinel
preservation, re-add/recheck, bounded descriptors, and genuine mid-delete
process recovery. Physical qualification remains active.

Tactical `088` extends the existing client-settings command rather than
adding a gateway command surface. Restart applies the local-network listener
and mapping policy, while the current generation publishes mapping progress
through the existing view owner. Mapping failure is recoverable application
state and a structured diagnostic; it neither rewrites durable intent nor
stops the local listener.

Tactical `095` keeps HTTP and HTTPS below this semantic boundary. The
application retains tracker URL, tier, source, lifecycle, redaction, and the
closed `TrackerSecurityView`; reqwest clients, DNS, redirects, TLS, gzip, and
response parsing remain engine-owned infrastructure. Tactical `098` expands
that value to `unencrypted`, `encrypted_system_trust`, and
`encrypted_unauthenticated`, and extends the existing complete settings
command with a default-secure policy plus one advanced compatibility value.
It adds no certificate route, tracker credential command, environment
side-channel, or client-owned success rule.

The application-owned content supervisor also retains a cancellation-owned
external discovery sender from metadata transition through content startup.
That small lifecycle fence prevents a temporarily empty session tracker stream
from terminating content discovery before a late HTTP/HTTPS observation. Hash-
verified HTTP and HTTPS only-`peers6` application transfers, shutdown stopped
events, generated web validation, Android cross-builds, and an owned AVD HTTPS
run cover the boundary. The authenticated follow-up additionally passes exact
controlled pinned-libtorrent application transfer, live policy replacement,
desktop platform trust, and Android product-verifier evidence through those
same owners.

Later work must define stable product error taxonomy, capability installation,
production remote
authentication and relay semantics, and compatibility rules for any
published wire protocol.

[`../tactical/012-bounded-diagnostics-progress.md`](../tactical/012-bounded-diagnostics-progress.md)
records the completed application-control slice. It corrects command-driven
task-completion polling, adds a derived progress assessment, and carries typed
bounded diagnostics through generated browser/Tauri and Android contracts
without treating the diagnostic WebSocket gateway as a product daemon.

[`../tactical/013-explicit-live-network-policy.md`](../tactical/013-explicit-live-network-policy.md)
records explicit offline, loopback-only, and online engine policy selection.
The current application configuration is immutable for the service lifetime.
Completed Tactical
[`094`](../tactical/094-bounded-bep11-peer-exchange.md) reuses that policy for
PEX address admission and dialing, adds no application setting, and keeps PEX
disabled until verified metadata establishes a public torrent. PEX failures
remain typed protocol failures on Android; the slice adds no command, durable
preference, or generated application contract.
Tactical
[`084`](../tactical/084-persisted-client-connection-and-seeding-settings.md)
adds an atomic durable client-settings replacement while deliberately keeping
listener, global peer-limit, and upload-slot enforcement restart-applied in
that slice. Completed Tactical
[`097`](../tactical/097-live-client-settings-and-replaceable-session-generations.md)
settles the live-control boundary with independent
applying/applied/degraded domains, stable peers and discovery, replaceable
transport generations, deterministic peer eviction, and immediate slot
regrant. Android network binding and VPN leak prevention require separate
platform evidence.

The original production browser/gateway proof saves automatic/37/one, joins
and reopens onto those owners, seeds verified content, then saves a held fixed
port and repairs its typed bind failure through this same command path.
Tactical `097` adds controlled in-process live handover and degraded-retry
evidence; no settings route, adapter-specific mutation, or command-owned
background task was added.

[`../tactical/075-ephemeral-application-state.md`](../tactical/075-ephemeral-application-state.md)
adds an immutable persistence-mode choice at the same service-lifetime
boundary. Client and transport detachment do not close or clear an
ephemeral service; joined service shutdown remains the owner of final DHT and
speed-history flushes. Durable open or write failure never falls back to the
ephemeral mode.

[`../tactical/018-inspectable-metadata-acquisition.md`](../tactical/018-inspectable-metadata-acquisition.md)
adds a coherent read-only engine diagnostic snapshot through `DownloadControl`.
It contains the bounded peer registry and active/recent BEP 9 attempts needed
by headless investigations. Completed Tactical
[`187`](../tactical/187-compact-metadata-acquisition-progress.md) deliberately
does not expose that diagnostic structure. Instead, a separate selected-only
application view projects stable current metadata scalars and a bounded packed
block map, plus a coarse v2/hybrid integrity-preparation state. No endpoint,
attempt history, metadata payload, or application command was added.

The implemented subscription and client direction is recorded in
[`client-surfaces.md`](client-surfaces.md) and
[`../tactical/008-reactive-multi-surface-control.md`](../tactical/008-reactive-multi-surface-control.md).
Coherent snapshots remain recovery authority above typed patches and
independent bounded subscriber state. The WebSocket adapter is not the
application authority, and local Tauri control does not use networking.
Tactical `033` aggregates those subscriptions behind one leased view set and
preserves the same recovery invariant through authenticated polling. Tactical
`048` implements streaming as an interchangeable Tauri delivery adapter with
explicit post-application acknowledgements; browser WebSocket streaming
remains deferred.
