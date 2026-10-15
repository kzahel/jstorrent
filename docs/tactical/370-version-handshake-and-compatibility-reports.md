# Tactical 370: Version Handshake And Compatibility Reports

Status: Slices 1–3 complete, 2026-10-15 (see **Evidence**). Slice 4's
consent question is settled by maintainer policy (opt-out statistics;
remote access may record operational data); its channels need changes and
deployments outside this repository. Slice 5 moves to its own tactical. Revised after an independent review (see **Review**).
Maintainer-directed: a two-way version handshake, opt-in mismatch
reporting that either end can send, and a graceful path with cleanup for
changes such as a new torrent state.
Topics: `mixed-version-compatibility`, `product-state-and-feedback`.

## Problem

Hosts tell clients what they are (`ApiHello.product`, Tactical 353, and
capabilities, Tactical 354). Clients tell hosts nothing: a host cannot log
which controller or extension version it serves, and nobody can see real
mixed-version combinations or how often they degrade. Tactical 354 dropped
host-side *shaping* of output for old clients; it did not decide against
clients reporting their version.

Reasoning through a hypothetical new torrent state exposed gaps in the
existing machinery:

- **The contract check skipped tolerant clients.** Extension 1.1.5 was
  marked tolerant, so `contract-compatibility.test.ts` skipped the exposure
  check against its contract. 1.1.5 tolerates new fields and unknown row
  field kinds but rejects a new enum value or tagged variant (the reviewer
  confirmed this by running its captured decoder on an unknown state in
  snapshots and in `state` row updates). Lifting the release hold would
  also have cleared exposures 1.1.5 rejects.
- **Nothing ever leaves the window.** `compat/captures.ts` loads every
  non-withdrawn delivery forever, so "after 30 days" has no mechanism, and
  stale exposures, known breaks and the release hold are never flagged.
- **`unreachable` exposures are prose waivers**, not checked facts.
- **No end can report a mismatch.**

## Decisions

1. **Exposure kinds.** An exposure is `field` (a property added to a
   closed object, or a new row field kind) or `value` (an enum value or a
   tagged variant elsewhere, including nested values inside known
   branches). Tolerant clients accept fields and reject values; strict
   clients reject both. Every supported contract is checked, tolerant ones
   for values only.
2. **Supported deliveries are computed.** A delivery is supported while it
   is the newest of its surface or until 30 days after its successor on that
   surface became public. One selector, shared by the ledger script and the
   tests, decides which captures the matrix uses. When a delivery leaves,
   CI fails on what depended on it (exposures no longer produced, known
   breaks with no supported capture, a release hold with no strict client
   left), so cleanup is a reviewed one-line commit, not a memory.
3. **`unreachable` becomes `requestedBy`.** An exposure that a host sends
   only after a client asks names that request (for example
   `ViewSpec.oneOf[type=library_media]`); the test checks no supported
   client's contract contains it.
4. **Clients identify themselves in `Connect`.** An optional
   `client: ApiClientInfo { kind, version, build_id }`. Every captured host
   parses `ApplicationClientFrame` without `deny_unknown_fields`, and every
   host transport (gateway, desktop control, ChromeOS companion, Crostini)
   uses that parser; released remote bridges re-serialize the frame and so
   drop the field, which is harmless. This is a deliberate exception to
   capability-gating client additions: `Connect` precedes the hello, and
   the field is informational. The live matrix, which runs the current
   client against every captured host, is the transport-level evidence.
   Capability `client_identity` means the host parses the field; it is not
   an acknowledgement of a particular identity.
5. **Identity parsing is lenient.** `client` deserializes through a
   function that turns any malformed value into `None`, and fields are
   bounded strings (not enums), so a newer client never breaks a host's
   handshake. A host never rejects a connection because of client identity.
6. **Features are never decided by the peer's version.** Identity is for
   logs, diagnostics and reports only.
7. **Reporting follows the maintainer's opt-out policy** (2026-10-15,
   recorded in `product-state-and-feedback`). The existing usage-statistics
   preference, chosen on first run, governs compatibility reports; no new
   disclosure version or assent record. Remote access is a hosted service
   and may record operational version data regardless of that preference.
   The privacy policy says both.

## Design

### Slice 1: exposure accounting and the window

- `contract-compatibility.test.ts` classifies exposures; the ledger is
  `reviewedClientExposure` in `release-compatibility.json`, each entry
  `{ kind, reason, requestedBy? }`.
- Gate (`scripts/check-release-compatibility.mjs`): a `field` blocks host
  releases while strict clients are supported; a `value` blocks unless it
  has `requestedBy`; an accepted break overrides for one release.
- `scripts/compat-window.mjs` exports the supported-delivery selector;
  `compat-ledger.mjs` uses it and prints deliveries that left the window;
  `compat/captures.ts` loads only supported captures.
- Enforced cleanup: each reviewed exposure must be produced by a supported
  contract; each known break must name a supported capture; with no
  supported strict client, `strictClients.supported` must be false.

### Slice 2: handshake

- Rust: `ApiClientInfo` in the session contract; `Connect.client` with a
  lenient deserializer. Kind and version up to 32 bytes, build up to 64,
  printable ASCII; anything else is dropped.
- The gateway keeps identity per connection and counts connections and
  sentinel refusals per `kind version` in `ApplicationConnectionMetrics`,
  which the gateway logs as `gateway_connection_metrics` and Android and
  the companion server already observe. The remote bridge keeps `client`
  when it re-serializes.
- Web: entry points name their kind (`remote`, `extension`, `web`).
  Version is the extension manifest version or the web package version;
  build is the existing `VITE_RSTORRENT_REMOTE_BUILD_ID` for the hosted page
  and `development` elsewhere until packaging sets one. Tauri is a matched
  pair and sends nothing.
- Hosts that report no `product` are bucketed as `released-before-identity`.

### Slice 3: observations

- Client, at the transport: handshake outcome, decode failures by stage
  (hello, open, batch, response) before wrappers transform them, calls
  refused with `UNSUPPORTED_CALL_MESSAGE` by operation family, command
  fields and patch keys stripped for the host, and whether the library
  attached. Late replies to aborted calls are recognized and discarded
  (a bounded set of recently aborted call IDs) rather than failing the
  connection, and are not counted as mismatches.
- Host: per client identity, connections and refusals carrying the
  compatibility sentinel. Bounded to 32 identities plus an `other` bucket;
  counters saturate.
- Both are in memory and exposed for diagnostics; nothing is transmitted.

### Slice 4: reports

Two channels, both stored like update-server request logs, both carrying
only versions and counts:

- **Desktop host, on its update check.** With statistics on, the check
  adds one bounded header summarizing client identities and refusals seen
  since the previous check (from the gateway's connection metrics), plus
  the host's own mismatch counts. Needs a matching change to
  `kzahel/simple-app-update-server`, which logs a fixed field list, and its
  deployment. Android has no update check; its reports wait for a channel.
- **Remote access, at the relay.** The browser client and the remote host
  send their product and version in the relay's plaintext handshake frames
  (bounded, optional, ignored by older relays), and the relay counts
  circuits by version pair in its operator status. Client observations
  from the hosted controller go the same way. Needs a relay deployment.

Extension observations against an old host have no channel yet; the
extension companion can forward them to a current host later.

### Slice 5: open value lists (own tactical)

Before a host may send a new torrent state: inject the value into snapshot,
upsert and delta fixtures; require every supported captured decoder that
predates the fallback to reject it (keeping the value blocked), a capture
with the fallback to accept it, and the current UI to render it with
conservative actions, filtering and sorting (`mapTorrentState` has no
fallback today). Test nested enums and malformed known values separately.
The value stays blocked until rejecting clients leave the window. Until
then, add a new optional field instead of a new value.

## Non-Goals

- Host-side shaping of output by client version.
- Deploying the update server or relay changes slice 4 needs.
- Reporting from Tauri or Android Compose (matched pairs).

## Invariants

- A host never rejects or closes a connection because of client identity.
- Features are decided by capabilities, never by the peer's version.
- In-app reports honor the usage-statistics preference; remote-access
  operational data is limited to versions, counts and outcomes.
- Every exposure of every supported contract is recorded and classified,
  and every record is still needed.

## Validation

- Contract test: unit cases for field, value and row-kind classification;
  a scratch negative control (a new enum value in the current schema is
  reported for every contract, 1.1.5 included).
- Gate script tests for field, value and `requestedBy`.
- Window selector tests: successor-based retirement, newest-per-surface,
  unpublished successors.
- Rust: `Connect` with no, valid and malformed `client`; the bridge keeps
  it; identity bucket bounds.
- Web: each entry point's identity; observation counters; late replies.
- Live matrix: current client (sending identity) against every captured
  host.

## Review

Independent review, 2026-10-15 (Codex, `gpt-6.1-sol`, high reasoning, via
Yep Anywhere), of the first draft (`f62d3e37`). Adopted: fresh consent for
reports (blocking); slice 5's evidence list (blocking); a computed support
window with enforced cleanup (blocking); tested `requestedBy` instead of
prose `unreachable`; transport-level evidence and lenient parsing for the
handshake; identity buckets for hosts without `product`; reuse of
`VITE_RSTORRENT_REMOTE_BUILD_ID`; transport-level observation categories;
report budget and retention requirements; the late-reply bug in
`websocket-view-client.ts`. Noted, not adopted: comparing definitions per
client reachability (over-reporting an unreachable definition costs one
reviewed entry). The reviewer also confirmed the classification against
1.1.5's generated validators.

## Evidence

- **Slice 1** (`93f41741`). Exposures are classified; a scratch negative
  control (an enum value added to the current schema) was reported for all
  four supported contracts including extension 1.1.5, and a `requestedBy`
  naming a request released clients can make was reported for 1.1.3 and
  1.1.4. `COMPAT_TODAY=2026-11-20` fails naming the known breaks and the
  Download all fallback to remove. Retirement dates today: desktop 0.3.0,
  Android 1.0.28 and 1.0.29 on 2026-11-12, extension 1.1.3 on 2026-11-14;
  extension 1.1.4 stays until 1.1.5 is public.
- **Slice 2** (`cf3d05dc`). Rust tests cover no, valid, extra-field and
  seven malformed identities, the bridge round trip and the 32-identity
  bound; the desktop control test connects two identified, one
  malformed-identity and one anonymous extension client and checks the
  per-identity connection and sentinel-refusal counts. The contract test
  checks every supported host capture parses `connect` openly.
- **Slice 3.** Observation unit tests (attribution, bounds, operation
  names); WebSocket tests for a late refusal of an aborted call (fails
  without the fix), sentinel refusals by operation and decode failures;
  the released-host request test checks stripped fields, the Download all
  substitution and library attachment for every captured host.
- **Live.** `compat_live_matrix.py --host <each captured host> --client
  current`, with the driver sending a client identity: current, desktop
  0.3.0 (`ff632f45`), Android 1.0.28 (`b2548290`), Android 1.0.29
  (`8ddf2e8b`), desktop 0.3.1 / Android 1.0.30 (`5fa018ff`) and Android
  1.0.31 (`70150ec9`) each completed connect, set download folder, add,
  download, verify, remove and data removed (4–5 s each). Released hosts
  ignore the identity over a real WebSocket, as the schema check predicts.

## Stopping Condition

Slices 1–4 land with tests and topic updates, the privacy policy describes
what is sent, and slice 5 has its own tactical when work starts.
