# Client View Delivery Policy

Topic: `client-view-delivery-policy`

Status: The semantic application-view contract already accepts a per-view
`min_interval_millis`, and the live client requests only projections implied
by current navigation. Production browser delivery uses one WebSocket and has
no automatic polling fallback. Completed Tacticals
[`183`](../tactical/183-production-websocket-ui-bandwidth-baseline.md),
[`184`](../tactical/184-view-aware-current-state-coalescing.md), and
[`185`](../tactical/185-typed-sparse-hot-view-patches.md) establish the clean
baseline, repair interleaved current-state coalescing, and add closed typed
sparse rows across all first-party reducers. Completed Tactical
[`186`](../tactical/186-current-rates-and-incremental-speed-history.md) then
separates tiny current rates from interest-selected exact graph history. Total
server payload is now 91.37% below the original measured run and idle
Transfers is 0.41 KiB/s. There is still no
user-selectable delivery profile, visibility-driven downshift, global
bandwidth budget, or cadence-specific performance gate. Changing only a
delivery interval also causes an unnecessary fresh snapshot today.

## Purpose And Scope

Application views can support a real-time inspection surface without making
every client, connection and lifecycle state pay that cost continuously. The
client owns which semantic views it currently needs and how fresh each needs
to be. The application service owns bounds, cursor continuity, coalescing and
truthful recovery.

This topic owns:

- client-visible delivery profiles and their mapping to per-view intervals;
- foreground, background and suspended-client delivery behavior;
- the relationship between desired views, delivery cadence and interaction;
- low-bandwidth and low-observer-cost policy;
- persistence and precedence of delivery preferences; and
- the evidence required to claim that a slower policy is less invasive.

[`application-view-api.md`](application-view-api.md) owns `ViewSpec`, view-set
lifecycle, cursor, snapshot, patch, reset and transport-neutral delivery
semantics. [`client-surfaces.md`](client-surfaces.md) owns platform lifecycle
and shell adapters. [`web-ui-design.md`](web-ui-design.md) owns settings
presentation and paint scheduling.
[`performance-and-live-evidence.md`](performance-and-live-evidence.md) owns
hardware-specific throughput and observer-cost measurement.

This topic does not select a binary codec, compression, relay authentication,
or a public remote protocol. Ordinary remote browser control requires
WebSocket; a network that blocks it is unsupported rather than a reason to
add an automatic HTTP fallback or hybrid polling lane. Those mechanisms must
preserve the policy recorded here rather than becoming competing cadence
authorities. Their accepted connection and multiplexing direction is recorded
in [`application-connection-architecture.md`](application-connection-architecture.md).

## Four Separate Controls

Do not collapse these independent controls into one "refresh rate":

1. **View interest** selects which projections the application retains and
   updates for this client. Removing an unneeded view is normally the largest
   resource and bandwidth reduction.
2. **Semantic delivery cadence** bounds how often a changed view may be
   emitted. `min_interval_millis` is minimum spacing between deliveries, not a
   request to manufacture periodic updates.
3. **Transport wait and heartbeat** determine how an idle connection detects
   closure and renews a lease. The current 20-second long-poll/stream wait is
   not the semantic update cadence.
4. **Paint cadence** determines when a client store change is rendered. Frame
   batching or hidden-document paint suppression does not alter cursor or
   delivery semantics.

A 100 ms semantic interval therefore means no more than approximately ten
deliveries per second for that view when it is changing. With no change there
is no substantive update. Multiple ready view changes may share one atomic
`UpdateBatch`.

Queue bytes are a safety bound, not a bandwidth throttle. Requesting a smaller
queue can cause more overflow resets and larger replacement snapshots, so it
must not be presented as a low-bandwidth control.

## Accepted Policy Direction

The client should expose a small named delivery preference rather than raw
milliseconds. Exact labels and calibrated values belong to an implementing
tactical, but the policy must distinguish at least:

- an interactive real-time profile for Workbench inspection;
- a balanced profile for normal observation;
- an explicitly low-bandwidth profile; and
- a background or suspended lifecycle state that can release expensive views
  independently of the user's foreground preference.

The effective policy is derived from all of:

```text
user delivery preference
        +
surface and visible detail
        +
foreground/background lifecycle
        +
projection-specific semantics
        =
desired ViewSpec set and intervals
```

The user's preference is a resource ceiling. Automatic lifecycle policy may
reduce delivery further but must not silently make an explicit low-bandwidth
preference more aggressive. Network cost heuristics such as metered-network
signals may be considered later, but must remain observable and overridable.

Illustrative, uncalibrated bands are:

| Policy | Current-state views | Expensive or ordered views |
| --- | --- | --- |
| Real-time | 100--250 ms | Only while visibly selected |
| Balanced | 250--1,000 ms | Slower and only while selected |
| Low bandwidth | 2--5 seconds | Omitted unless explicitly opened |
| Background | 5--30 seconds or release the view set | Release detail and diagnostics |

These ranges are design inputs, not performance claims or stable API values.
Hardware profiles and controlled transport measurements must calibrate them.

## Interest Before Cadence

The live adapter already maps responsive navigation to semantic desired
views. It may retain the Library, the selected Summary and one selected detail
on a wide Workbench surface; phone and collection-only surfaces retain less.
That behavior remains the first resource-control layer.

That selection is projection-granular, not viewport-row-granular. The Library
still represents every torrent, a changed collection entry still carries one
complete `TorrentView`, Files and Trackers request a catalog page of up to
1,024 rows independently from virtualized DOM rows, and Peers/Swarm may each
represent up to 1,000 records. The always-visible session transfer rates also
retain one one-second speed-history view. Browser virtualization reduces DOM
work but does not itself reduce application bytes.

Diagnostics consume no application-connection bandwidth unless Logs is the
selected detail. Once selected, the default capture is Normal, `info+`, and
all torrents. The capture profile and pinned torrent scope alter server
interest, while the displayed severity, category, search, and current-torrent
scope are local filters. Entering Logs may therefore receive matching retained
history that the current display subsequently hides. Tactical `183` measures
that transition separately from the ongoing Normal feed.

A low-bandwidth policy should not merely send every possible projection more
slowly. It should normally:

- retain only the collection or summary required by the visible surface;
- request Peers, Files, Trackers, Pieces or Disk only while that detail is
  visible;
- disable or narrow Diagnostics unless the user deliberately opens capture;
- preserve presentation navigation locally without retaining evicted engine
  projections; and
- close or substantially reduce a background view set when no fresh state is
  required.

Large initial and reset snapshots remain possible even at a slow cadence.
Files and ordered Diagnostics are particularly important: cadence cannot make
a required catalog snapshot small, and ordered records cannot be silently
latest-value coalesced like current-state counters.

## Interaction And Responsiveness

Commands return bounded receipts independently from application views. The
view feed remains authoritative for the resulting state. At a multi-second
delivery interval, the command receipt may therefore arrive before the next
visible projection update.

The current `requestImmediatePoll` only wakes an HTTP pull; it does not bypass
the server's per-view minimum interval and has no separate meaning for the
Tauri stream. A future interaction acceleration must be an explicit semantic
choice, not an accidental transport behavior. Acceptable directions include:

- honor the selected low-bandwidth interval strictly and show pending command
  state from the receipt;
- allow one bounded targeted flush after an accepted command; or
- permit a short interactive burst only in profiles that authorize it.

Do not implement a burst by repeatedly rewriting delivery policies. In the
current implementation any changed `ViewSpec`, including an interval-only
change, enqueues a fresh snapshot. The service should distinguish projection
identity or selector changes from delivery-policy changes so an interval can
be updated in place without resnapshotting or losing cursor continuity.

## Backpressure And Recovery

Cadence does not replace acknowledgement. One view set retains at most one
emitted, unacknowledged batch while compatible pending current-state changes
may coalesce behind it. A slow client therefore applies backpressure rather
than receiving an unbounded message stream.

Pending state and ordered events remain bounded. If the client is too slow or
the accumulated representation exceeds its queue, the server reports an
explicit reset and sends coherent snapshots under the separate snapshot
ceiling. Low-frequency policy must measure reset rate as well as bytes and
batches: a nominally slow configuration that repeatedly replaces large
snapshots is not low bandwidth.

Transport reconnect preserves the last applied cursor when the view set and
retained batch still exist. Lease expiry, cursor mismatch or process restart
recovers from a new epoch and coherent snapshots. Delivery preference and
semantic desired views may be retained as client presentation policy; view
set identifiers, cursors and materialized engine state remain volatile.

## Adapter Consistency

The ordinary browser WebSocket, explicit loopback diagnostic pull/long-poll,
in-process Tauri stream, and any future relay delivery must consume identical
`UpdateBatch` values and acknowledge the same applied cursor. A transport may
multiplex many view sets and commands on one connection, but it cannot invent
another subscription model, sampling rule or loss behavior. HTTP is not an
automatic fallback for an ordinary or remote browser session.

Semantic cadence should be enforced before transport encoding so JSON, future
binary encoding and relay delivery observe the same policy. Transport
heartbeats and reconnect backoff are negotiated connection concerns and must
not create empty semantic revisions or change per-view delivery intervals.

## Current Implementation

The current live web/Tauri adapter constructs intervals in
`LiveApplication.viewSpecs`:

- 100 ms: torrent list, selected summary, peers, piece activity, session Disk
  and Diagnostics;
- 250 ms: Files and Trackers.

`ViewController` owns one pull or stream consumer, cursor application,
retry/reopen and cancellation. HTTP uses a 20-second long poll that returns as
soon as a batch is ready. Tauri uses an acknowledged Channel stream. Neither
surface exposes the delivery policy to a user, and visibility wake hints do
not currently downshift a hidden client.

The server accepts zero through 60,000 ms per view, retains a 256 KiB default
steady-state queue capped at 512 KiB, and treats coherent snapshots separately
under a 16 MiB ceiling. These are resource limits, not recommended client
profiles.

Tactical `057` supplies the first producer-throughput matrix for production
view combinations and serialized bytes. It proves that observer selection and
consumer behavior are measurable, but it does not yet compare server-enforced
delivery intervals, hidden-client policy or remote transport byte rates.

Tactical `060` supplies one narrow production-browser observation: a
one-torrent General-view transfer carried 20,102 encoded WebSocket view-batch
bytes in 24 batches over 2.815 seconds, approximately 7.1 KiB/s of view-batch
payload. That short high-speed loopback case is transport evidence, not a
representative idle, selected-detail, or cellular baseline.

Completed Tactical
[`183`](../tactical/183-production-websocket-ui-bandwidth-baseline.md) supplies
the representative production-browser baseline. One clean Linux x86_64 run
used 11 stopped torrents plus one 256 KiB/s active torrent and equal
eight-second windows. Idle Transfers received 5.28 KiB/s of application
payload, active Transfers 12.84 KiB/s, General 101.86 KiB/s, Peers 114.05
KiB/s, Files 113.31 KiB/s, Pieces 147.93 KiB/s, and Normal Logs 103.23 KiB/s.
There was exactly one WebSocket, no semantic HTTP, no reset or heartbeat
timeout, and browser-observed totals matched gateway counters exactly.

This validates projection interest but also sharpens its limit. Unselected
details produced no steady updates, and 11 unchanged stopped rows produced no
row updates. Wide Workbench still correctly retained its visible Library,
selected Summary, one detail, and session rates. General nevertheless carried
390 complete Library-row patches and 390 complete Summary replacements in
eight seconds. Current view-set coalescing examines only the immediately prior
pending item; the hub interleaves view IDs, so compatible latest-value patches
for one view remain separate even while waiting for the same cadence gate.
Complete-row encoding then repeats mostly unchanged fields, and Library plus
Summary duplicate nearly the same active-torrent value.

Normal Logs were not the dominant steady source. Its retained-history update
was 19,591 standalone JSON bytes, and eight steady log patches totaled 3,408
bytes; Library and Summary each accounted for about 48 KiB/s during that Logs
window. The always-retained ten-minute session-rate replacement independently
cost about 5 KiB/s, including on otherwise idle Transfers.

Completed Tactical
[`180`](../tactical/180-typed-settings-patches-and-draft-convergence.md)
confirms that unchanged global client settings are already omitted from an
unrelated torrent-list patch. Its representative compact one-row trace is
1,157 bytes per update, including a 915-byte complete changed row and its
unchanged 64-byte transfer-limits value; the comparable full reset is 3,215
bytes. Twenty-four fresh torrent rows, 25 fresh client-settings values, and
reset snapshots each notify/reduce without losing an edit. One controlled
receipt-to-applied-view transition measured 24.1 ms. Broader allocation,
notification, render, and reset-rate measurement remains necessary before
choosing sparse rows or structural sharing.

Completed Tactical `184` makes current-state coalescing view-aware across
interleaved logical view IDs. Its identical clean run cut total server payload
76.48% without changing public DTOs, batch cadence, cursor/reset behavior, or
progress. Completed Tactical `185` then replaces repeated complete Torrent,
File, Peer, and active-piece rows with closed semantic field updates across
Rust, web, desktop, Android, and iOS. That second clean run cut another 36.77%
from server payload. Active Transfers, Peers, General, Files, Pieces, and
Normal Logs now measure 8.22, 15.59, 8.58, 10.12, 16.75, and 9.02 KiB/s,
respectively, with zero resets and exact browser/gateway byte agreement.

Completed Tactical `186` removes that remaining overloaded rate projection.
Every ordinary surface receives only tiny complete current-rate values; exact
fixed-window graph history is selected only while Speed is visible and then
advances by contiguous completed-bucket appends. Slower cadence concatenates
all intervening points without resampling, and the established acknowledged
view-set cursor still owns transport replay and backpressure. The identical
run cuts total server payload another 41.98%. Idle Transfers falls from 5.28
to 0.41 KiB/s; active Transfers, Peers, General, Files, Pieces, and Normal Logs
measure 2.88, 10.81, 3.66, 5.05, 11.97, and 4.09 KiB/s, with zero resets and
exact browser/gateway agreement.

## Required Evidence

An implementing tactical should retain, for at least idle, Library, ordinary
selected-detail and adversarial all-view cases:

- produced application throughput relative to no observer;
- semantic batches and nonempty batches per second;
- encoded payload and framing bytes per second;
- queue and snapshot high-water marks;
- reset count and reset payload bytes;
- command receipt latency and authoritative-view convergence latency;
- client validation/reduction time and visible paint latency where relevant;
- foreground-to-background transition and restoration without stale patches;
  and
- reconnect at the last applied cursor plus lease-expiry snapshot recovery.

Use the production WebSocket for the first remote-bandwidth matrix. HTTP long
polling remains an explicit loopback diagnostic comparison and is not required
for a product baseline or fallback claim. Tauri and native clients require
separate adapter-cost evidence only when their in-process encoding becomes a
measured concern. Named hardware profiles should carry generous calibrated
floors or ratios; noisy hosted CI may use deterministic byte, batch,
continuity and reset gates instead of a narrow wall-clock throughput threshold.

## Recommended Next Work

Use the completed `183`--`186` reports as the causal baseline. Next measure a
named low-bandwidth/background delivery profile rather than exposing raw
intervals. It should combine explicit desired views with server-enforced
cadence, document-visibility or platform lifecycle, and immediate foreground
refresh, and report payload, command convergence, queue pressure, resets, and
paint latency. Removing a view remains preferable to sampling it when the
information is not visible.

Library/selected-Summary overlap removal and viewport/page projections remain
valid later candidates when measurements show enough residual duplication or
large visible collections. Normal Logs are not currently a priority. A binary
codec is deliberately later still: it must reuse the same semantic snapshots,
patches, cursors, and acknowledgements; negotiate a version and codec; define
an explicit stable field-number registry and unknown-field policy; and compare
payload savings against CPU, allocation, implementation complexity, and
mixed-version behavior. Rust enum order, JSON paths, and client-local duplicate
keys are not that registry. Do not bundle these independent changes or add a
polling fallback for networks that block WebSockets.
