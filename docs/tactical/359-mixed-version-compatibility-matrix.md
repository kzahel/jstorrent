# Tactical 359: Mixed-Version Compatibility Matrix

Status: In progress, 2026-10-15. Revised after an independent read-only
review (Yep Anywhere session `01a13e5d-2874-7b43-b9ec-617ed6965210`,
GPT-6.1-Sol, high effort); maintainer-approved to implement end to end with
commits. Replaces Tactical
[354](354-mixed-version-compatibility.md) Slice 4.
Topics: `mixed-version-compatibility`, `application-view-api`,
`client-surfaces`.

Terms follow the [glossary](../glossary.md): a **host** owns the engine and
serves the application API; a **client** connects to a host.

## Problem

Clients and hosts update independently (hosted remote controller, extension
companions, desktop, Android, headless), so supported pairs of versions must
work in both directions. Evidence today covers one release and parts of the
matrix: released `desktop-v0.3.1` frames decode in the current client, and a
static schema comparison lists what released strict clients would reject. No
released client code runs, nothing records what the current client actually
sends to an old host, nothing requires every published release to be
covered, and the hosted controller deploys without running the compatibility
tests at all.

## Decision

For each supported release R and the proposed source P, check the
off-diagonal cells of old/new host × old/new client in both directions,
using artifacts produced by R's own source:

| Check | Direction | Evidence |
| --- | --- | --- |
| **D1** | Host R data → client P | R's captured frames decode, reduce and render in client P; every field P types as present is filled. |
| **D2** | Host P data → client R | Host P's corpus runs through client R's own bundled decoder and reducer. Raw results are recorded as they are: a failure is a real incompatibility. Stripping reviewed exposures only *attributes* failures; release permission still comes from the existing hold in `release-compatibility.json` or a per-release accepted break. |
| **R1** | Client P requests → host R | Client P's real dispatch runs against R's captured hello; the requests it actually emits are recorded and must be valid against R's exact request schema. Actions R lacks must be refused locally and emit nothing. This is a schema check, not a run of R's parser; it is labeled so. |
| **R2** | Client R requests → host P | Client R's recorded requests parse in host P's real Rust types and pass the gateway's frame checks. |

What this does **not** prove, and needs separate evidence: relay
authentication and forwarding, binary upload framing, direct-file signaling
and codecs, native-messaging bootstrap, Tauri IPC (a matched pair, covered by
adapter tests), shape-preserving semantic changes, and rendering of historical
UIs.

## Review Findings Adopted

- **Identity is the source commit, not the schema hash.** `fedbea31` and
  `9eeb9e61` share a schema hash but have different validators. Captures are
  keyed by peeled commit and role; identical files may be shared by content
  digest, and each release keeps its own provenance.
- **Requests are recorded from real dispatch**, not sampled from schemas.
  A schema sampler, if added later, supplements recordings and must validate
  each sample against its own implementation first (for example settings
  patches require `minProperties: 1`).
- **Delivery ledger, not tags.** Tags do not prove publication (store review,
  staged rollout, extension builds). `compat/deliveries.json` is an
  append-only ledger of published deliveries: surface, version, source
  commit, package digest where known, channel and first public date, with
  explicit exclusions for frozen lanes (RSTorrent incubation
  `desktop-v0.1.x`, `desktop-latest-v*`, `crostini-v0.1.0`,
  `android-v0.1.0`).
- **Raw failures stay failures** (D2 above).
- **Enforcement covers every publication path, including the hosted
  controller**, bound to the exact source commit, and runs on every push to
  `main`; a weekly run is only a backstop. Android's release checkout is
  shallow, so checks that need history fetch it explicitly.
- **Tactical 354's audits are tightened:** the schema comparison recurses
  into properties, items and branches and compares types and references; an
  absent nullable field is not `null`, so the typing audit no longer exempts
  nullable fields.
- **Capture runs once per release outside ordinary CI**, with pinned
  toolchains, recorded digests, and verification that regenerated contracts
  match the committed ones.

## Layout

```text
compat/
  deliveries.json              append-only published-delivery ledger
  captures/<release>/          one per captured release, by source commit
    provenance.json            release, commit, role, tool versions, digests
    client-decoder.mjs         client R's bundled decode/reduce (client roles)
    v1.schema.json             R's generated schema
    hello.json, settings.json, view-set-trace.json   host R data (host roles)
    client-requests.json       requests client R emitted (later slice)
```

## Slices

0. **Quick fixes.** Complete; see **Evidence**. The hosted-site deploy runs
   the web tests before deploying. The contract comparison recurses and
   compares types and constraints. The generator rejects any omittable
   field, nullable or not, that TypeScript types as present unless every
   released host already sends it.
1. **First matrix slice (review's recommendation).** Complete; see
   **Evidence**. Capture extension 1.1.4
   from `5fa018ff` with `scripts/compat-capture.mjs` (temporary worktree,
   rolldown bundle of its `validation.ts` and `view-set-reducer.ts`). D2:
   run its real decoder over the current host's hello, settings and library
   output, record raw results, attribute failures to reviewed exposures, and
   require the release hold to be on while any raw failure exists. R1: drive
   current `LiveApplication.dispatch` against desktop 0.3.1's hello, record
   emitted requests, validate them against 0.3.1's exact schema, and require
   capability-owned actions to emit nothing. Negative controls for each.
2. **Ledger and coverage.** Complete; see **Evidence**. `deliveries.json` for every published delivery
   since the JSTorrent cutover; move the `desktop-v0.3.1` fixtures into
   captures; capture desktop 0.3.0 / extension 1.1.3 and Android 1.0.29–1.0.31;
   the window check on every `main` push and in release workflows (full
   history fetched).
3. **Host corpus.** A `compat_corpus` generator next to `export_types`
   emitting every server frame, view snapshot and patch, row field kind,
   enum value, error variant and omitted-field case, with coverage
   accounting; D2 over it. Keep `newer-host.test.ts`'s synthetic additions.
4. **Old-client requests (R2).** Record client R's emitted requests at
   capture by running R's own dispatch against a recording client, and
   parse them in host P's Rust types.
5. **Stateful and broader checks.** Hello refresh after reconnect, view
   subscription selection by capability, per-release exposure sets, and
   historical capability snapshots.

## Invariants

- Every captured artifact is produced by the release's own source at its
  recorded commit; nothing is hand-edited.
- A raw incompatibility never turns green by stripping; it is either fixed,
  held, or accepted for one named release.
- A delivery missing from the ledger or captures fails closed for
  publication.

## Validation

Each check has a deliberate failing control: an old decoder rejecting an
unreviewed addition, a request invalid for an old schema, a gated action that
emits a request, a missing delivery. Web and Rust suites and `actionlint` run
for each slice.

## Stopping Condition

Complete when every published delivery in the window is in the ledger and
captured from its own source, D1, D2, R1 and R2 run for each in CI with
negative controls, publication and hosted deployment are gated on them, and
the `mixed-version-compatibility` topic describes the matrix, its limits and
the runbook.

## Evidence

Slice 0, 2026-10-15:

- `deploy-website.yml` runs `npm run test` for `clients/web` after the
  typecheck and before building and deploying the remote client
  (`actionlint` passes).
- `contract-compatibility.test.ts` compares recursively through properties,
  array items, map values and tagged branches, and flags changed `type`,
  `format`, `const`, `pattern` and bounds, re-pointed references, removals,
  new requirements and removed enum values or branches. Against
  `desktop-v0.3.1` it finds no breaking change and the same five reviewed
  exposures. Two synthetic tests cover nested breaking changes and nested
  exposures.
- `generate-validators.mjs` no longer exempts nullable fields. A field Ajv
  cannot fill may be typed as present only if every released schema in
  `src/fixtures/released/` either has it or never sends its definition or
  branch. Negative control: a new nullable field in an existing row-update
  branch typed as present fails generation.
- Considered and rejected: filling absent nullable fields with `null` during
  validation. Hand-written validators and consumers distinguish absent from
  `null` (eight tests failed, for example a command `result` absent versus
  null), and Ajv cannot fill inside union branches anyway. The audit covers
  the version-skew case instead.
- Runs: `npm run typecheck` and `npm run test` in `clients/web` (699
  passed); the generated validators are byte-identical.

Slice 1, 2026-10-15:

- **Capture.** `scripts/compat-capture.mjs --release extension-1.1.4
  --commit 5fa018ff… --role client` adds a temporary worktree, links the
  current web package's modules for bundling only, writes a temporary entry
  re-exporting the release's decode and reduce functions, bundles them with
  rolldown 1.1.5 (minified, one chunk), and writes `client-decoder.mjs`, its
  declarations, the release's `v1.schema.json` and `provenance.json` with
  source and artifact digests. Two captures produce identical digests; the
  worktree is removed.
- **D2.** `clients/web/src/compat/old-clients.test.ts` decodes the current
  hello (`DEFAULT_API_HELLO`, now exported), library open response, a
  seeding torrent with stop limits and an update with the new row kinds in
  1.1.4's own decoder. Raw failures today: the library open, the seeding
  torrent and the row update, recorded as such and allowed only while
  `strictClients.supported` is true. With exactly the reviewed exposures
  removed (`src/compat/exposures.ts` walks the current schema to locate
  them), all four decode. Negative control: an unreviewed addition still
  fails after stripping.
- **R1.** `LiveApplication.test.ts` dispatches 26 commands plus a torrent
  upload against desktop 0.3.1's hello and validates every emitted request
  against 0.3.1's schema with all objects closed. It found one real defect:
  `export_magnet` sent the rich-share `options` (Tactical 357), which 0.3.1
  ignores silently. Fixed with capability `magnet_export_options` (ID 2,
  owning `export_magnet.options` through the new `command_fields`),
  `supportedCommand` stripping at dispatch, the Share panel hiding its
  address choice and share actions copying plain links or refusing a
  file-subset share on such a host, and a contract-test rule that new
  fields in existing commands need an owner (negative control: removing the
  ownership fails it). Seed-stop-only patches to 0.3.1 emit nothing. Negative
  control: a request with an unknown field fails validation.
- **Hosted deployment** runs these tests (Slice 0).
- **Runs.** `cargo fmt --check`; `cargo clippy -p rstorrent-session -p
  rstorrent-gateway --all-targets -D warnings`; `cargo test -p
  rstorrent-session --lib` (447 passed); `npm run typecheck` and
  `npm run test` in `clients/web` (705 passed).

Slice 2, 2026-10-15:

- **Ledger.** `compat/deliveries.json`: desktop 0.3.0 and 0.3.1; Android
  1.0.28 (untagged; commit that set versionCode 28), 1.0.29, 1.0.30,
  1.0.31; extension 1.1.3 (manifest commit) and 1.1.4. Exclusions: frozen
  incubation tags and the legacy TypeScript Android app (1.0.23 and
  earlier; 1.0.25–1.0.27 were internal-track only). Package digests are not
  yet recorded.
- **Captures.** `scripts/compat-capture.mjs` now keys captures by commit and
  adds a host role: that commit's `export_types` (schema, traces, with a
  shared `target/compat-capture` build directory) and a temporary
  `examples/compat_capture.rs` printing `ApiHello::default()` and the
  fresh-profile settings runtime view. Five commits captured: `ff632f45`,
  `b2548290`, `8ddf2e8b`, `5fa018ff` (host and client), `70150ec9`, plus
  `bff14e72` (client). Capturing `5fa018ff` reproduces the earlier
  hand-copied `desktop-v0.3.1` fixtures byte for byte; those fixtures are
  removed. A host capture takes about 80 seconds.
- **Ledger check.** `scripts/compat-ledger.mjs` (three node tests) runs in
  CI's `release-tools` job, the desktop and Android release workflows
  (enforced when publishing, warning otherwise) and the hosted deploy, each
  fetching tags first. It passes against the current tags.
- **Findings.** Running the matrix over the older captures found:
  - 0.3.1 made `UpdateBatch.server_now_millis` required, so current clients
    rejected every view update from desktop 0.3.0 and Android 1.0.28 (the
    hosted controller and extension companions included). Fixed: it is a
    serde default of `"0"`, and the generator now fills `null` for nullable
    fields that some supported host lacks and TypeScript types as present
    (here the three tracker instants), failing generation if Ajv cannot.
    Absent stays absent everywhere else.
  - Tracker age fields were removed in 0.3.1; extension 1.1.3 requires them.
  - Current clients send `download_all_pending_add` to desktop 0.3.0 and
    Android 1.0.28, and its `disable_future` field to Android 1.0.29.
    Released hosts advertise no capabilities, so 0.3.0 cannot be told from
    0.3.1 by capability.
  The last two are recorded in `compat/known-breaks.json` for a decision.
- **Runs.** `npm run typecheck` and `npm run test` in `clients/web` (742
  passed); `cargo test -p rstorrent-session -p rstorrent-gateway`; clippy;
  `node --test scripts/compat-ledger.test.mjs`; `actionlint` on the four
  workflows.
