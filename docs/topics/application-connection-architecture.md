# Application Connection Architecture

Tactical [338](../tactical/338-macos-network-consent-research.md) researches
macOS startup consent without changing application/bootstrap contracts. The
actual incoming-TCP/UPnP/DHT-Off app retains native attach and loopback control
without a local-network alert. Fresh-port follow-up validates incoming uTP
BitTorrent handshakes with TCP Off and silent TCP-only/unused-port controls;
payload probes stall in Off and On. Complete unsolicited uTP rejection and explicit
local-network feature gating remain planned. Distinguish local-network privacy,
incoming peer policy and OS firewall approval. Authorized Windows research now
observes explicit TCP enable prompting and Cancel persisting inbound block
rules across executable restart/retry; loopback control and non-loopback
outgoing TCP/uTP hashes still pass. TCP Off admits verified incoming uTP payloads.
The diagnostic's missing initial Fast Extension availability explains its
stall; corrected independent wire clients pass. Bootstrap/defaults/UI are
unchanged, and signed shipping qualification remains separate.

Tactical [337](../tactical/337-lightweight-macos-development-bundle.md) provides
a lightweight macOS debug `.app` through `scripts/desktop-bundle`, so existing
MacApp native registration and LaunchServices start/open work in development.
The raw `scripts/desktop` executable remains outside a bundle and cannot repair
that registration. The application/bootstrap/authentication contract is
unchanged. Launching the debug bundle selects it on Chrome's shared host route;
opening the installed app later repairs the route back. Foreground and isolated
production-ID extension lifecycle checks pass locally.

Tactical [336](../tactical/336-production-desktop-extension-control.md) repairs
desktop native bootstrap admission for the exact production extension origin.
The helper previously advertised control but accepted start/attach only from
the beta ID, producing misleading version guidance for production 1.1.4.
Both reviewed IDs now reach the existing same-user bootstrap and authenticated
WebSocket; lookalikes remain refused and attach remains passive. A real macOS
candidate with the unpacked production extension passes cold/warm launch,
singleton, native-window, reload/detach and Quit/manual-restart checks through
Machine Control. Signed delivery to installed desktop releases remains open.

Tactical [335](../tactical/335-removal-pieces-and-disconnect-lifetime.md)
keeps executing `RemoveTorrent` and `CancelPendingAdd` calls joined through
browser disconnection. Calls waiting for response reservations or service entry
cancel before applying intent; after entry, the service finishes durable removal
or records failure even without a response consumer. The connection retains its
permit until removal calls finish, preserving existing admission bounds.
Transient calls and native folder requests retain disconnect cancellation.

Tactical [320](../tactical/320-chromeos-android-owned-extension-setup.md) adds
only setup/navigation around the existing same-device connection. An exact
HTTPS, top-frame, closed-message website request can focus/open the packaged
Android UI, but cannot launch the native service, request browser permission,
supply endpoints or credentials, or approve pairing. Android explicitly enables
its existing owner, verifies notification eligibility and renews one bounded
bootstrap grace before browser return. Passive retries cannot renew that grace.
The typed WebSocket and generated application contract are unchanged. Two
isolated physical candidate cohorts pass; public hosted/store acceptance is
still a release gate.


Topic: `application-connection-architecture`

Tactical 253 replaces Crostini's exact `penguin.linux.test` authority with
`jstorrent.localhost` on the existing port 3030. Chromium's loopback resolution
and ChromeOS forwarding replace the failing Linux DNS-registration dependency;
no proxy, new listener or authentication protocol is added. Bare localhost,
other localhost subdomains, the former hostname and wrong Origin/port remain
rejected. Existing fixed local-open product policy and optional paired browser
sessions are unchanged. Host-only HttpOnly cookies do not accompany requests
to bare or unrelated localhost names; they still share authority across ports
of the same dedicated hostname. This does not defend against malicious local
processes impersonating that hostname. Actual Chromium tests cover paired
session persistence and cross-origin refusal, while both hardware cohorts
qualify the packaged product's local-open route. Browser approval/appearance
may need reconfiguration at the new origin; the Linux profile is unchanged.

Tactical [242](../tactical/242-legacy-desktop-handoff-rehearsal.md) adds the
future production desktop's retirement of `com.jstorrent.native`. That name
targets a refusal-only helper accepting bounded released frames and returning
update guidance, without launching a desktop, IO daemon, listener or semantic
capability. Production registration failures and already-running same-user
legacy processes stop startup before import; a second quiescence check precedes
the new engine. Incubation retains its existing name and exact beta control
origin. This is managed-route fencing, not revocation of manually retained old
binaries or a legacy protocol bridge.

Tactical [`236`](../tactical/236-desktop-compatibility-refusal-and-recovery.md)
classifies desktop bootstrap version/operation/response and handshake-schema
failures as terminal. The page hides/unmounts its application, stops retries
and offers attach-only Retry connection; a stopped runtime still offers Start.
Fresh bootstrap and instance identity remain mandatory after replacement.
The selected Linux beta old/new matrix and same-schema rollback pass;
[237](../tactical/237-macos-windows-package-recovery.md) extends that result to
installed macOS/Windows packages. 239 also proves attach-only browser restart
onto the same transferring owner on macOS/Windows/Linux, followed by
independently verified completion and Quit without passive resurrection. Signed
current-source delivery and broader endurance remain separate gates.

Tactical [`234`](../tactical/234-desktop-user-intent-and-background-lifecycle.md)
owns the accepted desktop lifetime follow-up: retain the tray/status-bar icon
while the runtime runs, including idle/paused states; browser closure only
detaches. Fresh toolbar, Start, or OS torrent-input intent may relaunch after
Quit; page restoration, worker wake and retries only attach. Tray Open and
OS magnet/file delivery always use the native window. No preferred surface,
browser-profile routing, icon-hiding or automatic completion shutdown is added.
Installed macOS/Windows/Linux debug builds pass the bounded lifecycle
checkpoint: browser closure during a verified transfer, 64 reload/worker-stop
cycles, actual tab discard, explicit relaunch and passive no-resurrection.
Desktop disconnect retires only that client's abandoned view sets before
admitting a same-client replacement, after joining calls, uploads and pumps.
Native views remain independent; other transports retain resumable leases.
The 32-global/eight-owner view limits and wire contract are unchanged.
Broader endurance and installer/update compatibility remain open.

Tactical [`232`](../tactical/232-desktop-extension-control.md) adds the desktop
composition of this same semantic connection. The sole native service owns a
loopback-only listener; protected same-user native bootstrap supplies an
in-memory, per-runtime bearer to the exact beta extension. Native Tauri remains
in-process. HTTP admission, application connections, upload and shutdown are
bounded separately. Automatic reconnection is attach-only; explicit toolbar Open or Start
may create the desktop owner. Installed Linux,
Windows and macOS debug-package checkpoints pass. macOS uses same-user
`getpeereid`, a private bounded startup lock to serialize LaunchServices opens,
and a bounded ready-socket lifetime that permits client timeout setup before
peer closure. Broader browser endurance and update compatibility remain open.
The capability-gated `choose_download_root` / `download_root_chosen`
platform frames reuse this authenticated connection only for the desktop
picker. Connection termination cancels the request; an aborted browser picker
call closes its connection owner. Native Cancel preserves the connection.
Other backend compositions refuse the operation; Android's existing platform
route and authority remain unchanged.

Status: The direct loopback application connection is implemented by Tactical
`060`. Ordinary browser use sends typed calls, commands, view-set mutations,
streamed `UpdateBatch` values and exact cursor acknowledgements through one
bounded `/api/v1/connect` WebSocket. HTTP long polling remains an explicit
loopback diagnostic adapter, and acknowledged per-view-set Tauri Channel
delivery shares the extracted Rust acknowledgement core without opening a
socket. The legacy `/control` route, frames, direct-DOM frontend and superseded
tests are deleted. Completed Tactical
[`190`](../tactical/190-opaque-wasm-relay-foundation.md) proves that local relay
delivery wraps these exact application frames in an OPAQUE-authenticated
encrypted circuit rather than creating another application API. Completed
Tactical [`192`](../tactical/192-production-owner-relay-access.md) replaces
the proof infrastructure with durable host/browser authority, automatic
challenge-bound reconnect and a complete authorization/circuit audit in a
separate loopback-only production-shaped composition. Public deployment and
support remain later work. Tactical `076` adds one
deliberately limited maintainer-operated private host: bounded Basic
authentication covers static, health, HTTP, and WebSocket routes; the gateway
still enforces the exact public HTTPS Origin; and the production React build
selects the same origin explicitly. This is neither Tactical `190`'s controlled
relay proof nor a production relay, device-authentication, encryption, or
stable-public-compatibility campaign; those capabilities remain unimplemented.
Tactical `081`
extends the same connection with one declared, one-frame binary `.torrent`
attachment bounded at 64 MiB while retaining the 64-KiB text bound; HTTP
remains an explicit automation adapter and Tauri uses raw in-process IPC.
Tactical `083` keeps that admission/framing sequence but removes the caller
digest: the declaration carries exact length and semantic options, while
common Rust preparation derives SHA-256 from the received bytes. The shared
React picker uses the existing active adapter and does not open an HTTP side
lane for ordinary browser intake. Tactical `101` adds the ordinary headless
product trust boundary: a fresh loopback profile chooses local-open or bounded
remembered-browser sessions, exact Host/Origin checks protect cookie mode, and
revocation closes an admitted WebSocket with a typed authentication failure.
Its four-digit local handoff and restart recovery are not remote owner
authentication or a new semantic application protocol. Tactical `109` makes
browser application authority strictly same-origin: hosted builds connect to
their own page origin, caller input cannot redirect the API or WebSocket, and
the manual launcher serves assets and application routes from one stable
loopback listener. Completed Tactical
[`138`](../tactical/138-verified-http-file-serving.md) carries the ephemeral
`create_media_url` semantic call through authenticated HTTP, the existing
WebSocket, and in-process Tauri IPC. Actual file bytes use only the separate
capability route: the gateway mounts it on its existing listener, while Tauri
owns a media-only exact-loopback listener that exposes no application API.
Completed Tactical
[`139`](../tactical/139-incomplete-file-streaming-demand.md) preserves that
transport split for active files. Only the semantic capability call crosses
the application connection; progressive verified bytes, range waits, body
cancellation, and the active-to-complete handoff remain entirely on the
separate capability-authorized media route. Completed Tactical
[`167`](../tactical/167-chromeos-crostini-bundled-web-launcher.md) adds one
explicit ChromeOS Linux local mode without broadening the other adapters: the
gateway binds the fixed package port, admits only exact
`http://penguin.linux.test:3030` Host and Origin values, retains same-origin
session authentication, and exposes a bounded protocol-1 handoff only to the
pinned beta extension. The physical x86_64 Chromebook proves the same semantic
WebSocket application remains usable across detachable browser views and
stopped-VM relaunch.
Completed Tactical
[`170`](../tactical/170-configured-linux-headless-service.md) reuses that same
semantic WebSocket and HTTP adapter in one configured Linux service. A
prepared-listener boundary now completes package/auth/origin validation and
the exact socket bind before constructing the application owner. Hosted Basic
mode requires the configured external HTTPS authority in `Host` before static,
health, HTTP, media, or WebSocket routing. Isolated TLS/WSS and real x86_64
Linux evidence prove detachable views, fresh-view recovery, joined restart,
and one service/application/profile owner; the inner protocol gains no stable
public-compatibility promise. Completed Tactical
[`171`](../tactical/171-signed-headless-release-and-lan-service.md) adds one
exact RFC 1918 `lan-none` admission matrix around the same adapter. Static,
health, media, HTTP, and WebSocket routes require the configured Host; unsafe
HTTP methods and WebSocket upgrade require the exactly matching Origin; no
credential is issued or accepted. The installed current-host service proves
exact HTTP/WebSocket success and wrong-Host/Origin `403` behavior. This is a
truthfully warned trusted-LAN operator mode, not authenticated application
authority or a stable remote protocol.
Completed Tactical
[`194`](../tactical/194-chromeos-android-extension-control.md) implements a
separate first-party same-device adapter: the packaged extension React page
attaches to the one Android-owned application service across ChromeOS's fixed
ARC host. Exact extension Origin, Host, explicit Android-approved bearer
pairing, backend/profile identity, optional host permission, current Local
Network Access behavior, revocation, and physical non-LAN reachability surround
the unchanged typed application WebSocket. Android serves no
application assets, raw IO, filesystem, piece, or media endpoint in that
slice, and no general LAN/remote compatibility claim follows from it. The
existing `chooseDownloadRoot` platform seam is deliberately adjacent to the
semantic connection: an authenticated extension request may cause the Android
owner to launch its SAF picker and return a root snapshot, but the URI and
grant remain outside application frames. Retained root IDs let one Android
current/default root govern new adds while older torrents continue through
their original grants. Physical identity, pairing, Compose convergence,
retained-root lifecycle, detached transfer, and reconnect pass. The listener is
fixed to ARC's guest address rather than wildcard: the exact extension connects
from ChromeOS, while the Chromebook Wi-Fi address refuses raw TCP and the
formerly successful caller-controlled Host/Origin request from another LAN
device. This remains a same-device transport, not a general remote-control or
trusted-LAN surface.

## Purpose And Scope

The application API needs a low-overhead real-time transport without making
HTTP polling, Tauri IPC, WebSocket framing or relay encryption the owner of
application semantics. It must also retain the simplicity and diagnostic
value of the current long-poll adapter.

This topic owns:

- the logical application-connection boundary above individual transports;
- typed request/response and server-push frame families;
- multiplexing of calls and multiple view attachments on one connection;
- view-set attachment, acknowledgement, reconnect and takeover semantics;
- connection-level fairness, backpressure, heartbeat and resource bounds;
- the relationship between HTTP, WebSocket and in-process Tauri adapters;
- the layering required by future end-to-end encrypted relay control; and
- the reference lessons that implementation must recheck before it proceeds.

[`application-control.md`](application-control.md) owns command meaning,
request identity and durable application revisions.
[`application-view-api.md`](application-view-api.md) owns named projections,
view-set resources, snapshots, patches, epochs, cursors, resets and leases.
[`client-view-delivery-policy.md`](client-view-delivery-policy.md) owns which
views the client requests and how frequently semantic changes may be emitted.
[`client-surfaces.md`](client-surfaces.md) owns platform hosting and lifecycle.
[`remote-access-authentication.md`](remote-access-authentication.md) owns the
future owner password, host identity, device identity, resume and
hardware-key threat model around a relay circuit.
[`http-file-serving-and-streaming.md`](http-file-serving-and-streaming.md)
owns the separate capability-authorized media-byte listener and its rule that
HTTP file reads never become another application-control API.
[`direct-remote-file-streaming.md`](direct-remote-file-streaming.md) owns the
proposed optional direct remote byte transport and preserves this topic's rule
that bulk content stays outside the application control connection.

This topic records a future remote-compatibility requirement. It does not by
itself authorize a production listener, relay service, pairing flow, account
system, cryptographic dependency or stable public protocol. Accepted Tactical
`060` separately authorizes retirement of the inventoried RSTorrent gateway
`/control` graph after replacement evidence is green; other adapter retirement
still requires its own bounded tactical and migration decision.

## Terminology

The [glossary](../glossary.md) owns the shared terms; *backend* below means
a **host** there.

- An **application connection** is one client-side controller and its
  authenticated relationship with one RSTorrent backend. It may survive more
  than one physical connection generation through bounded reconnect.
- A **connection generation** is one concrete WebSocket, Tauri window
  generation or comparable attachment lifetime.
- A **call** is a correlated request/response operation such as command
  dispatch or opening a view set.
- A **view set** is the leased semantic resource defined by the application
  view API. It can outlive a failed physical connection until its lease
  expires.
- A **view attachment** is the connection-local route and pump that delivers
  one view set from an applied cursor.
- A **relay circuit** is an opaque end-to-end path for one authenticated client
  to one backend through a relay. It may share a physical relay WebSocket with
  other independently encrypted circuits.

Do not use `session` as the general name for this boundary. It is already
overloaded by the BitTorrent engine, application service, remote
authentication and user-facing torrent state.

## Accepted Architecture

One semantic application API has several delivery adapters:

```text
React / ViewController / other first-party client
                    |
          ApplicationViewClient
                    |
       typed application operations
                    |
       Rust application connection core
          /            |             \
         /             |              \
HTTP request/pull   WebSocket mux   Tauri invoke/Channel
         \             |              /
          \            |             /
       ApplicationService + leased ViewHub
```

The WebSocket adapter is the preferred real-time browser and future remote
transport. One authenticated socket carries:

```text
application connection
  +-- correlated calls and results
  +-- command requests and receipts
  +-- view attachment A: batches and acknowledgements
  +-- view attachment B: batches and acknowledgements
  +-- connection health and negotiated capabilities
```

There is never one WebSocket per view, projection or view set. A normal UI
currently needs one view set containing several projections, but the
connection supports a bounded number of independent sets without changing its
physical transport.

One browser tab or Tauri window is normally one logical client. Separate tabs
may use separate connections and view sets so their selection, backpressure
and lifecycle remain independent. Cross-tab `SharedWorker` socket sharing is
not implied by the one-connection rule.

## Semantic Operations On Every Adapter

Every capable adapter exposes the same operations:

- negotiate application version, delivery modes, codec and limits;
- dispatch a semantic command;
- open a view set and receive coherent initial snapshots;
- replace a view set's desired `ViewSpec` values;
- attach streamed delivery at an applied cursor where streaming exists;
- acknowledge an exactly applied batch cursor;
- detach delivery without necessarily destroying the view set;
- close a view set; and
- close the client connection.

Tactical `081` adds one bounded byte-bearing semantic operation. The
ordinary browser declares its metadata in a text frame, waits for admission,
then sends exactly one correlated binary message up to the calibrated
64-MiB attachment limit. One buffered import is admitted per application host.
HTTP carries a raw `application/x-bittorrent` body for automation, while Tauri
supplies a raw IPC body in process. The attachment is not an arbitrary data
channel, does not carry payload pieces, and does not raise ordinary JSON/text
limits. The caller declares exact source length but no digest; source SHA-256
is derived only after Rust owns the complete attachment.

WebSocket creation does not depend on an HTTP request. The socket can open,
update and close view sets directly. HTTP remains a complete alternative, not
a mandatory control plane for streaming.

The application protocol uses a closed typed operation union. Do not make an
arbitrary HTTP method and path string the canonical WebSocket request. The
HTTP adapter maps routes into the typed operations, while the WebSocket and
Tauri adapters invoke those operations directly.

## Conceptual Connection Frames

Exact generated names and encoding belong to the implementing tactical. The
protocol nevertheless has these stable frame families:

```text
client -> backend
  client_hello
  call(call_id, typed operation)
  attach(stream_id, view_set_id, after_cursor)
  detach(stream_id)
  ack(stream_id, exact_applied_cursor)
  semantic lease acknowledgement
  connection ping/pong where the platform requires it

backend -> client
  server_hello(capabilities, limits, selected codec)
  result(call_id, typed result)
  call_error(call_id, structured error)
  attached(stream_id)
  view_batch(stream_id, UpdateBatch)
  stream_error(stream_id, structured error)
  semantic lease probe
  connection ping/pong where the platform requires it
```

The client may pipeline a bounded number of calls. `call_id` correlates a
transport response and is distinct from a command's semantic `request_id`,
whose idempotency and retry contract is owned separately by application
control. Reusing a call identifier while it is pending is invalid.

Responses may be correlated independently, but operations that mutate one
view set must be observed in accepted receive order. The implementation must
not accidentally define global causal semantics merely because an early
version awaits every incoming call in one serial socket loop.

Unknown closed frame or operation variants fail according to negotiated API
version and capabilities. All lengths, counts and identifiers are validated
before allocation or application-service mutation.

## View-Set Identity And Attachment

The protocol intentionally retains two identities:

- `view_set_id` locates the leased, resumable server-side semantic resource;
- `stream_id` is a disposable connection-local multiplexing key for one
  attachment.

Neither value is a bearer credential. A remote caller must already have the
authenticated principal and client-instance authority that owns the view set.
Possession of an opaque ID alone grants nothing.

Opening a view set returns its coherent initial `UpdateBatch`. The client
validates and applies that batch before attaching at its resulting cursor. A
client library may present an `openAndAttach` convenience, but creation and
attachment remain separate semantic transitions because reconnect and
delivery-mode switching require attachment independently from creation.

Only one active consumer may drain a view set. A second attachment by an
unrelated owner or client fails. A newly authenticated connection generation
for the same logical client may atomically supersede its older attachment so a
half-open socket cannot block recovery. Generation-checked cleanup from the
old connection must never close or detach the replacement.

## Cursor Acknowledgement And Backpressure

WebSocket delivery preserves the existing view-set cursor contract:

```text
backend next_updates(last applied cursor)
  -> view_batch(base cursor, resulting cursor)
  -> runtime validation
  -> pure continuity reduction
  -> synchronous client-store commit
  -> ack(resulting cursor)
  -> backend may request the next batch
```

Receipt by the socket, transport decoder or JavaScript callback is not an
acknowledgement. A validation, reducer or state-callback failure leaves the
batch unacknowledged and therefore replayable or resettable according to the
existing view-set rules.

Each attachment has at most one emitted, unacknowledged batch. Compatible
current-state changes can continue to coalesce in the bounded view-set
accumulator. Ordered Diagnostics retain their separate ordered and explicit
loss semantics. A slow attachment cannot consume, acknowledge, clear or delay
another view set's semantic accumulator.

Acknowledgements may be consolidated into one small connection frame when
several streams advance together, but each item still names its exact stream
and cursor. A cumulative connection sequence cannot replace the independent
view-set cursors.

## Reconnect And Resume

A physical WebSocket failure detaches its stream pumps but does not
immediately destroy their view sets. The client reconnects, authenticates as
the same logical owner and attempts to attach each retained set at its last
successfully applied cursor.

For each view set, the backend then:

- replays the retained unacknowledged batch when the supplied cursor is its
  base;
- continues after acknowledging that batch when the supplied cursor is its
  result;
- returns an explicit reset when continuity cannot be retained; or
- reports unknown/expired/closed so the controller opens a new set and
  installs coherent snapshots from a fresh epoch.

Reconnect is not global transaction recovery. One view set may resume while
another has expired and reopens. Commands use their own request identity and
must not infer retry success from a view cursor.

A browser reload normally creates a new client instance and fresh view sets.
User delivery preference and desired presentation may persist; view-set IDs,
cursors and materialized engine state remain volatile unless a later tactical
explicitly proves a safe persistence contract.

## Heartbeat And Lease Semantics

Transport health and semantic client progress are different:

- one connection-level WebSocket ping/pong detects a dead path;
- it does not acknowledge a view batch or renew semantic ownership merely
  because the socket stack responded;
- an idle but healthy client periodically proves the exact applied cursor for
  its attached view sets; and
- those semantic lease acknowledgements may be batched across attachments so
  idle connections do not require one heartbeat stream per view set.

The current Tauri pump's empty acknowledged batch supplies this semantic
liveness proof. A multiplexed connection may use an explicit consolidated
lease probe/ack instead, but an unresponsive reducer must eventually stop
renewing its view set. Engine publication and outgoing queue wakeups never
renew a client lease.

## Connection Concurrency And Fairness

One socket must not become one serialized application bottleneck. The target
owner shape is:

```text
WebSocket reader
       |
bounded validation and routing
  +----+--------------------+
  |                         |
call/control owner      per-view attachment pumps
  |                         |
  +------------+------------+
               |
       fair bounded outbound scheduler
               |
         WebSocket writer
```

The reader validates and hands off work without waiting for an unrelated slow
call to complete. Application commands retain their application-service
ordering and idempotency rules. Operations targeting the same view set retain
causal order. Independent stream pumps do not run inside the call handler.

The outbound scheduler must:

- bound total connection bytes and items;
- preserve order within one stream;
- schedule ready attachments fairly rather than draining one indefinitely;
- prioritize bounded control results, errors and liveness over bulk snapshot
  continuations;
- stop reading new work or close the offending stream when declared bounds
  are exceeded; and
- expose queue high water, per-stream bytes, resets and delivery latency.

TCP still has transport-level head-of-line blocking. The application avoids
adding another preventable layer. Once a large WebSocket frame is handed to
the socket it cannot be preempted, so a remote-capable implementation must
either prove its maximum snapshot frame preserves required control latency or
split large encoded snapshots into bounded transport records. Reassembly and
validation finish before the semantic `UpdateBatch` is atomically reduced.

Torrent payload, file download, media playback and upload bulk data do not use
this control connection. A future verified-range content plane remains a
separate bounded service so large data transfer cannot starve pause, resume,
inspection or diagnostics control.

## Adapter Responsibilities

### HTTP long polling

HTTP retains the current v1 calls and `next_updates(after, wait_ms)` behavior.
The next pull supplies the applied cursor and therefore acknowledges the prior
batch. It remains the simplest headless, automation, debugging and
low-frequency adapter.

Automation may submit exact v1 metainfo bytes with a raw POST. This loopback
example uses the configured bearer token and exact allowed Origin:

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $RSTORRENT_TOKEN" \
  --header "Origin: http://127.0.0.1:5173" \
  --header "X-RSTorrent-Owner: 00000000000000000000000000000001" \
  --header "Content-Type: application/x-bittorrent" \
  --data-binary @example.torrent \
  "http://127.0.0.1:3030/api/v1/torrents?request_id=add-001&storage_root=downloads&start_content=true&selection=all"
```

The owner header is exactly 32 lowercase hexadecimal characters. `request_id`
is the durable retry identity; repeating it with different bytes or normalized
options is a conflict. `expected_revision` is optional. `selection` is `all`,
`none`, or `ranges`; range mode also supplies canonical half-open
`wanted_ranges=0-4,7-9`. The configured private host uses its Basic credential
and exact HTTPS Origin instead of the loopback bearer example. The endpoint
returns the ordinary typed response envelope and never fetches a URL or accepts
a filesystem path.

Long polling is not required to use WebSocket streaming. The first-party web
UI may select it explicitly on loopback for diagnostics and controlled A/B
evidence, but does not expose transport in Settings, persist the selection or
fall back automatically. One browser session selects one coherent adapter
instead of opening calls through HTTP and streaming through a socket. A future
measured handoff would require an explicit design rather than exploiting the
fact that both adapters share semantic ownership.

### Browser WebSocket

The modern browser endpoint was introduced as a new versioned application
connection rather than extending legacy `/control`. It authenticates once,
negotiates capabilities and carries every typed operation plus all attached
view streams on one socket. Its provisional route is `/api/v1/connect`;
changing that route requires updating this topic and the application-view
route record together.

This is the ordinary browser product path. An explicitly selected loopback
HTTP diagnostic session uses no WebSocket, and a normal WebSocket session uses
no semantic HTTP calls. There is no automatic fallback or hybrid HTTP-call/
WebSocket-update mode. Tactical `060` deleted the legacy route and direct-DOM
client after proving equivalent useful origin, authentication, command,
delivery and shutdown behavior.

Tactical `183` adds the first representative selected-view byte baseline on
this path. One production React page used exactly one `/api/v1/connect`
upgrade and zero semantic HTTP calls while a controlled active transfer
crossed Transfers and five Workbench details. Browser-observed payload totals
matched the gateway's independent frame-family counters exactly, with no
binary frame, reset, heartbeat timeout, or leaked connection. The measured
cost is semantic update volume rather than physical socket proliferation:
current wide Workbench keeps Library, Summary, one selected detail, and
session rates on the same connection. Networks that block WebSocket remain
unsupported; the result does not motivate fallback polling.

JSON text frames are the first diagnostic codec. A future binary codec is a
connection negotiation that produces the same generated DTOs and reducer
inputs; it is not another semantic API version by itself.

### Tauri IPC

Tauri does not bind a loopback socket or pretend IPC is HTTP. Native invokes
may remain the natural request/response lane. The target streaming owner is
one multiplexed outbound Channel per window generation, keyed by stream ID,
with bounded acknowledgement invokes back to Rust.

Tauri and WebSocket share typed operations, the attachment registry, cursor
checks, pump behavior, fairness, errors and joined cancellation. They need not
share byte serialization or force native calls through a fake socket message
bus. The current one-Channel-per-view-stream implementation remains correct
until a bounded unification tactical replaces it.

## Relay-Compatible Layering

Future relay-mediated remote control uses the same inner application frames:

```text
physical client <-> relay WebSocket
  +-- relay circuit A
  |     +-- authenticated end-to-end encrypted records
  |           +-- RSTorrent application connection frames
  |                 +-- calls and commands
  |                 +-- view attachment 1
  |                 +-- view attachment 2
  |
  +-- optional relay circuit B for another backend
        +-- separately authenticated and encrypted records
              +-- independent RSTorrent application connection
```

For one backend there is one circuit; every view set for that backend is
multiplexed inside it. If a future client controls several backends through
one relay, an outer circuit identifier may share one client-to-relay socket
while each circuit retains independent authentication, keys, resume state,
queues and failure lifecycle.

The relay is an opaque bounded router. It may observe routing identity,
connection timing, circuit IDs and ciphertext sizes. It does not parse or
authorize application calls, torrent identities, commands, view
specifications, cursors, diagnostics or content.

The layer order is:

```text
typed application frame
  -> negotiated encoding
  -> optional bounded compression
  -> authenticated end-to-end record with replay protection
  -> optional outer relay-circuit framing
  -> WebSocket/TLS transport
```

Completed Tactical `190` selects and proves account-free OPAQUE, one
native/Wasm Rust core, a portable-profile host key, a full password login per
connection, directional ChaCha20-Poly1305 records and no compression. Its
direct and relayed React traces produce the same negotiation, three normalized
reducer states, view update/acknowledgement and benign command result. The
relay records routing/message metrics but has no OPAQUE or application
dependency. Tactical `192` now owns a bounded named-client registry, fresh
mutual resume beneath the same application connection, exact expiry/revocation
and the security ledger needed to inspect every authorization and live circuit
through a production-shaped loopback-only service composition. Deployment, key
rotation beyond that fixed lifecycle, padding, relay discovery, multi-host
identity and delegated roles remain later decisions.
The investigation background and evidence gates live in
[`remote-access-authentication.md`](remote-access-authentication.md). The
application connection must not need to know whether an encrypted record
traveled directly or through a relay.

## Ownership, Tasks And Cancellation

| Owner | State and work | Termination |
| --- | --- | --- |
| Application service | Commands, durable revision, ViewHub and leased view sets | Joined product shutdown closes all sets and wakes waiters |
| Remote authorization registry | Bounded client proofs, resume generations, expiry/revocation and security ledger | Disable/reset removes authority; expiry or revocation fences proofs and closes every owned connection generation |
| Logical client owner | Authenticated principal plus verified bounded client identity and authentication method | Explicit client close, authorization revocation or application shutdown |
| Connection generation | Negotiation, call registry, attachment map, fresh record keys and global bounds | Socket/channel close, replacement generation, authorization revocation or application shutdown |
| Call owner | Unique call ID, validated operation, result/error completion and timeout | Result, cancellation, disconnect or bounded timeout; executing torrent removals join through disconnect |
| View attachment | Stream ID, view-set handle, applied cursor, pump, expected acknowledgement and queue accounting | Detach, takeover, view-set close, disconnect or shutdown |
| Outbound scheduler | Fair per-stream queues, control lane and writer backpressure | Connection-generation cancellation and awaited writer join |
| TypeScript connection adapter | Pending calls, attachments, validation, ack and reconnect | Client close aborts and joins all consumption before transport close |

Every task has one named cancellation owner. Detaching or replacing a
connection generation cancels and awaits its pumps. Late completion from an
old generation cannot mutate, acknowledge or close a newer attachment.

## Bounds And Hostile Input

The implementation tactical must select and advertise at least:

- maximum physical connections per owner and service;
- maximum attached view sets per connection;
- maximum pending calls and call-request bytes;
- maximum control-frame and encoded-data-record bytes;
- maximum aggregate and per-stream outbound queued bytes;
- maximum invalid frames before connection closure;
- call and handshake timeouts;
- connection idle and semantic lease intervals; and
- snapshot fragmentation/reassembly bytes and timeout if fragmentation is
  implemented.

Existing view-set count, queue, snapshot and lease limits remain authoritative
semantic bounds. Connection bounds are additional containment, not a way to
silently enlarge or bypass them. One stream exceeding a local bound should be
failed or reset without destroying healthy peers when safe; malformed framing,
authentication failure or connection-wide overflow may close the connection.

## YepAnywhere Reference Dossier

The local YepAnywhere sibling was inspected at commit
`b47f945700413fe414542ea51a79f826dd76eae9` on 2026-08-03. It is an
architectural and failure reference, not an RSTorrent dependency or wire
contract. No source, fixtures or protocol values are imported.

Future implementation must re-read the then-current sibling and compare it
with this observed revision, focusing on:

- `packages/shared/src/relay.ts`: one inner typed union carries correlated
  request/response, subscription, event, upload and ping/pong traffic;
- `packages/client/src/lib/connection/RelayProtocol.ts`, especially
  `RelayProtocol`, `routeMessage`, its pending request/upload maps and
  subscription map: one protocol router is composed below more than one
  transport;
- `packages/client/src/lib/connection/WebSocketConnection.ts`, especially
  `WebSocketConnection` and `ensureConnected`: a plain socket composes the
  shared inner router;
- `packages/client/src/lib/connection/SecureConnection.ts`, especially
  `SecureConnection`, authenticated resume, encrypted send/receive and its
  composition of `RelayProtocol`: encryption wraps the same inner operations;
- `topics/relay-client-mux.md`: one physical browser-to-relay socket carries
  bounded independent circuits while preserving legacy per-host fallback;
- `packages/relay/src/mux-handler.ts`, especially `RelayMuxCoordinator`,
  `RelayMuxSession`, `queueServerFrame` and the round-robin drain: per-circuit
  accounting, limits and fair delivery contain one circuit's pressure; and
- `docs/project/relay-head-of-line-blocking.md`: awaiting unrelated request
  work in one inbound message chain can create application-level head-of-line
  blocking even when the physical transport is healthy.

RSTorrent adopts these lessons:

- keep the inner application protocol independent from plain or encrypted
  transport;
- correlate concurrent calls and route multiple streams explicitly;
- keep relay routing opaque to end-to-end application contents;
- isolate circuit/stream failure and queue accounting where possible;
- schedule multiplexed streams fairly; and
- treat reconnect, bounds and malformed input as protocol behavior rather
  than incidental socket errors.

RSTorrent intentionally differs:

- it uses a closed typed application operation union rather than making HTTP
  method/path tunneling its canonical inner protocol;
- its primary stream resource is a resumable view set with exact applied
  cursor acknowledgement, not an event subscription alone;
- a view set may outlive one physical connection generation under a bounded
  lease;
- commands retain application request identity independently from connection
  call correlation;
- torrent payload and other bulk content are excluded from the control
  connection; and
- this architecture does not adopt YepAnywhere's SRP, NaCl, framing constants,
  relay discovery, limits or release-compatibility policy without a separate
  security and dependency decision.

## Implementation And Future Migration

The direct-browser slice completed these bounded steps:

1. Record a tactical with the exact generated frame contract, owner map,
   bounds, threat model, cancellation map and updated YepAnywhere audit.
2. Extract or establish a Rust connection/attachment core that delegates to
   existing application-service and view-set operations without duplicating
   semantic state.
3. Implement a new loopback-only versioned WebSocket adapter and generated
   TypeScript client alongside HTTP long polling. Select WebSocket for ordinary
   browser use while retaining HTTP only as an explicit loopback diagnostic
   mode.
4. Prove WebSocket creation, update, attachment, exact post-reducer ack,
   multi-view-set fairness, reconnect and bounded failure through the same
   reducer traces as HTTP and Tauri.
5. Measure request count, bytes, CPU, allocation, queue high water, resets and
   producer throughput against current HTTP and Tauri baselines.
6. Migrate useful legacy `/control` evidence, move shared test helpers and
   delete the old gateway frames, route, direct-DOM client and generated types.

Steps one through six are complete in Tactical `060`. Future bounded work may:

7. Further unify the Tauri attachment owner and, when justified, replace
   per-stream Channels with one window-level multiplexed Channel without
   routing native calls through HTTP or JSON unnecessarily.
8. Tacticals `190` and `192` complete the controlled relay-authentication
   proof and durable production-shaped local composition using the
   already-proven direct application frames. Authorize external deployment and
   its evidence only through a later tactical.

Browser WebSocket work must not silently introduce a production remote
listener. Relay work must not be combined into the initial local transport
slice merely because the inner frames were designed for it.

## Required Evidence

Before WebSocket delivery is called implemented, prove:

- semantic state equivalence for the same snapshot/patch trace through HTTP,
  WebSocket and Tauri;
- view-set creation and commands entirely over one WebSocket;
- two or more independent view sets sharing one socket without identity,
  acknowledgement or cleanup interference;
- acknowledgement only after successful validation, reduction and store
  commit;
- exact retained replay, connection-generation takeover, cursor reset, lease
  expiry and fresh-snapshot recovery;
- command and control progress while another view set is slow or delivering a
  large snapshot;
- fair scheduling and declared per-stream/connection high-water bounds;
- malformed, oversized, duplicate, stale and unauthorized frame behavior;
- prompt joined shutdown with calls, waits, pumps and acknowledgements active;
- lower framing/request overhead than real-time long polling without worse
  application producer throughput or reset storms; and
- current long polling remains green as an explicitly selected loopback
  diagnostic adapter;
- the useful legacy origin, authentication, dispatch, delivery and shutdown
  cases remain green against the replacement; and
- `/control`, its generated wire types and the direct-DOM client are absent
  after that evidence migrates.

Future relay claims additionally require opaque-relay inspection evidence,
end-to-end authentication and encryption tests, replay/tamper rejection,
automatic private-browser reconnect/resume, shared-browser non-persistence,
expiry and live revocation, complete authorization/circuit inspection,
audit-retention pressure, per-circuit isolation, ciphertext and queue bounds
and a controlled direct-versus-relay semantic trace comparison.

## Durable Drift Guards

Implementation may refine names, frame grouping and measured limits, but must
update this topic before changing any of these accepted decisions:

- one semantic API across HTTP, WebSocket, Tauri and future relay delivery;
- WebSocket directly supports calls and view-set creation;
- one WebSocket multiplexes all view sets for one frontend/backend connection;
- an ordinary browser session uses that WebSocket for every semantic call and
  view update, with no automatic fallback or hybrid transport;
- browser HTTP selection is explicit, loopback-only and diagnostic rather
  than a visible or persisted product preference;
- the superseded RSTorrent `/control` protocol is deleted after its useful
  evidence migrates to the new connection; it is not a compatibility surface;
- view-set identity is separate from connection-local stream identity;
- neither identifier is an authorization token;
- exact per-view-set cursor acknowledgement occurs only after application;
- view sets can resume across physical connection generations;
- connection heartbeat is separate from semantic lease progress;
- per-stream fairness and bounded backpressure are explicit owners;
- relay encryption wraps the same inner application frames; and
- torrent payload and other bulk content stay off the control connection.
