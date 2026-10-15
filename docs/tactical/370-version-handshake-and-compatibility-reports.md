# Tactical 370: Version Handshake And Compatibility Reports

Status: Proposed, 2026-10-15. Maintainer-directed: a two-way version
handshake, and opt-in mismatch reporting that either end can send.
Topics: `mixed-version-compatibility`, `product-state-and-feedback`.

## Problem

Hosts tell clients what they are (`ApiHello.product`, Tactical 353, and
capabilities, Tactical 354). Clients tell hosts nothing: the host cannot log
which controller or extension version it serves, and nobody can see real
mixed-version combinations or how often they degrade. Tactical 354 dropped
host-side *shaping* of output for old clients; it did not decide against
clients reporting their version, and this tactical adds that.

Two further gaps found while reasoning about a new torrent state:

- **The contract check skips tolerant clients entirely.** Extension 1.1.5 is
  marked tolerant, so `contract-compatibility.test.ts` skips the exposure
  check against its contract. 1.1.5 tolerates new *fields* and unknown row
  field kinds, but still rejects a new enum value or tagged variant. Once
  1.1.3 and 1.1.4 leave the window (about 2026-11-12), a new value would
  pass CI and break 1.1.5. Lifting the release hold
  (`strictClients.supported: false`) would likewise clear exposures that
  1.1.5 rejects.
- **No end can report a mismatch.** Refused calls, locally gated actions and
  decode failures are visible only in one user's console.

## Decisions

1. Clients identify themselves in the existing first frame. `Connect` gains
   an optional `client: ApiClientInfo { kind, version, build_id }`. Released
   hosts ignore it: `ApplicationClientFrame` has no `deny_unknown_fields`
   (checked by a test against every captured host schema). This is the one
   deliberate exception to "anything new a client sends is capability-gated":
   `Connect` precedes the hello, the field is informational, and released
   hosts drop it. A capability `client_identity` still records that the host
   reads it, so the client can tell whether the host saw its version.
2. Identity strings stay open: `kind` is a bounded string, not an enum, so a
   newer client kind never breaks an older host's parser.
3. Each end keeps a small in-memory **compatibility observation** per peer
   identity: connections, refused calls, locally gated actions (by
   capability), decode failures. Hosts log one structured line per connection
   with both identities.
4. Each end may send an opt-in **compatibility report**, a new closed
   transmission surface added to `product-state-and-feedback`'s allowlist by
   maintainer direction. It carries no installation ID, profile, torrent,
   path, endpoint or error text: reporter role, kind and version, peer kind
   and version, the day, and the observation counts. At most one report per
   (reporter, peer, day).
5. Consent is the reporter's own durable statistics consent: host
   `product.db` (`transmission_allowed`), extension `productMetricsV1`
   (`statisticsEnabled` with a current disclosure). The hosted remote page
   has no consent store and does not report in this tactical.
6. Transmission is fail-closed behind `COMPATIBILITY_REPORTS_READY = false`
   until an endpoint exists and the disclosure text names the report. This
   tactical builds payloads, consent checks and the gate; deploying an
   endpoint and enabling the gate are separate, maintainer-authorized steps.

## Design

### Exposure kinds (slice 1)

`compareSchemas` classifies each exposure:

- `field`: a property added to a closed object, or a new row field kind
  (`ROW_FIELD_KINDS` unions). Tolerant clients accept it.
- `value`: an enum value or tagged variant elsewhere. Every released client
  rejects it.

`release-compatibility.json` replaces `reviewedStrictClientExposure` with
`reviewedClientExposure`, each entry `{ kind, reason, unreachable? }`. The
test requires the recorded kind to match, every exposure of every contract
(strict or tolerant) to be recorded, and every entry to be produced by some
contract in the window. A `value` entry blocks host releases unless it is
`unreachable` (for example a view variant sent only to clients that lease
it); a `field` entry blocks only while strict clients are supported. The
release gate script reads the same rule.

### Handshake (slice 2)

- Rust: `ApiClientInfo` in `rstorrent-session` contract; `Connect.client`
  optional with serde default; validation bounds (kind and version up to 32
  bytes, build up to 64, printable ASCII). Invalid identity is dropped, not
  fatal. The gateway keeps it in per-connection state, logs
  `application_client_connected` with client and host identity, and counts
  it in connection metrics.
- Remote host bridge re-serializes `Connect`; it must keep `client`.
- Web: each entry point names its kind (`remote`, `extension`, `web`) and
  build. Version comes from the extension manifest or the web package
  version; build from `VITE_CLIENT_BUILD_ID` (deploy and package set the
  commit; otherwise `development`). Tauri is a matched pair and sends nothing.
- `client_identity` capability in the registry, advertised by current hosts.

### Observations (slice 3)

- Client: `LiveApplication` counts per connected host identity: calls refused
  with `UNSUPPORTED_CALL_MESSAGE`, actions refused locally by capability
  gates (capability name), and `ContractError` decode failures. Exposed on
  the snapshot for diagnostics and the report builder.
- Host: gateway counts per client identity: connections and per-call
  `invalid_call` refusals. Bounded to 32 identities; overflow is counted in
  one `other` bucket.

### Reports (slice 4)

- One closed `CompatibilityReport` type in Rust (exported to TypeScript):
  `{ schema: 1, day, reporter: { role, kind, version }, peer: { kind,
  version }, connections, refused_calls, gated_capabilities[], decode_failures }`,
  bounded lengths and counts.
- Builders on both ends, a consent check, and a sender that does nothing
  while `COMPATIBILITY_REPORTS_READY` is false. Unit tests prove the payload
  shape, bounds, consent suppression and once-per-day dedupe.

### Open value lists (slice 5, later)

Clients map unknown values of a short list of display enums (torrent state,
progress reason, error codes) to an explicit unknown, and ignore unknown
server frame types. The generator and the contract check read the same
list, so a `value` exposure in an open list becomes a `field`-like exposure
for clients that tolerate it. Ships in extension 1.1.6. Until then the rule
stays: add a new optional field rather than a new value.

## Slices

1. Exposure kinds, ledger and gate.
2. Two-way handshake and host logging.
3. Observations on both ends.
4. Report type, builders, consent and the disabled sender.
5. Open value lists and unknown frames (separate tactical if it grows).

## Non-Goals

- Host-side shaping of output by client version.
- Deciding features from client version strings.
- An endpoint, server-side storage, dashboards or enabling transmission.
- Reporting from the hosted remote page, Tauri or Android Compose (matched
  pairs or no consent store).
- Installation IDs or any stable identifier in compatibility reports.

## Invariants

- A host never rejects or closes a connection because of client identity.
- Features are decided by capabilities, never by the peer's version.
- Nothing is transmitted without the reporter's own durable consent and the
  ready gate; reports contain only the closed fields above.
- Every exposure of every contract in the window is recorded and classified.

## Validation

- Contract test with negative controls: an enum value added after 1.1.5's
  contract is reported for 1.1.5; a field addition is not.
- Gate script tests for `field` / `value` / `unreachable`.
- Rust: `Connect` with and without `client`, invalid identity dropped,
  relay keeps `client`, metrics count identities with the overflow bucket.
- Web: each entry point's identity; observation counters; report builder.
- Captured-host test: no captured `ApplicationClientFrame.connect` is closed.

## Stopping Condition

Slices 1–4 landed with tests, topics updated, and the remaining decisions
(endpoint, disclosure text, enabling the gate, slice 5) recorded as open.
