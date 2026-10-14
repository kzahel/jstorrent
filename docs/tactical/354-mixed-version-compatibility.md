# Tactical 354: Mixed-Version Compatibility And Capabilities

Status: Slices 1 and 2 complete, 2026-10-15 (extension 1.1.5 packaged, not
yet submitted); Slices 3–5 open. Maintainer selected
the flexible capability model and a 30-day starting horizon, then authorized
implementation with commits. The living rules and runbooks moved to
[`mixed-version-compatibility`](../topics/mixed-version-compatibility.md).
Topics: `mixed-version-compatibility`, `application-view-api`, `client-surfaces`,
`remote-access-authentication`, `application-connection-architecture`,
`web-ui-design`.

## Problem

A client and the host it controls can run different versions:

| Client | Host | Who updates whom |
| --- | --- | --- |
| Hosted controller at `jstorrent.com/remote/` | Desktop or headless over the relay; Android later | The site redeploys from every push to `main` that touches `clients/web` or the remote crates (`deploy-website.yml`); hosts update on their own schedule. |
| Extension companion pages | Android over ARC; desktop over native messaging | The Chrome Web Store updates the extension independently of the app. |

Every other surface (desktop webview, headless and Crostini gateway assets,
Android Compose, iOS) ships or serves its own UI and cannot skew.

Today the only negotiation is an exact match on `API_VERSION` and
`VIEW_CONTRACT_VERSION`, and the contract is closed in both directions:

- Ajv validators are generated with `strict: true`; 57 schema objects have
  `additionalProperties: false`, including `ClientSettings`, both settings
  patches, the runtime and seeding views. Enums and tagged variants are
  closed. This contradicts the topic rule that unknown object fields are
  accepted (`application-view-api.md`).
- `Command` has no unknown-variant handling, and both patches use
  `deny_unknown_fields`. A rejected frame is uncorrelated: the gateway sends
  `ConnectionError` and closes after three; the relay host tears down the
  whole circuit (`remote-host/src/runtime.rs` 563-579).
- Relay authentication messages use `hasExactKeys` in the client and
  `deny_unknown_fields` in the host.
- `ApiHello.capabilities` lists view names only. Two command paths are
  gated (`desktop_root_picker_v1`, `direct_file_v1`); nothing else is.

### Live regression

Tactical [344](344-seeding-stop-limits.md) was pushed on 2026-10-14 and the
hosted controller redeployed. Its `ClientSettings.seed_stop_*` fields are
`#[serde(default)]`, so the schema lets a released host omit them, but the
generated TypeScript type marks them present and the UI reads `.type`
unconditionally. A probe rendering Connection & seeding settings with a
settings snapshot lacking the two fields throws `TypeError: Cannot read
properties of undefined (reading 'type')`. The hosted controller therefore
very likely breaks Settings for every released desktop (0.3.1) and headless
host. Saving a stop limit would also send patch keys those hosts reject,
closing the remote circuit. No release tag contains 344, so the extension
companions are not yet affected; the next host release would be, because
extension 1.1.4's validators reject the new closed-object fields.

## Decision

Adopt a capability model, modeled on yepanywhere's
(`packages/shared/src/server-capabilities.ts` and
`docs/topics/server-capabilities.md` there), kept smaller:

1. Clients tolerate what they do not understand from hosts; hosts tolerate
   and answer, per call, what they do not understand from clients.
2. Every behavior a client depends on beyond the frozen baseline is owned by a
   registered capability that the host advertises and the client gates.
3. Released strict clients are handled by release order, not host-side
   shaping: a tolerant extension ships before a host release that adds what
   strict clients reject.
4. CI enforces the rules against released snapshots, and capabilities retire
   only through an audited, dated review.

Rejected: pinning and archiving one UI bundle per host contract. It fails for
extension pages, which cannot load remote code, and leaves old hosts without
UI fixes. It remains a possible safety net below the support horizon.

## Support Policy

- **Full support, 30 days.** The current hosted controller fully supports any
  host whose release is at most 30 days old. A host supports clients whose
  release is at most 30 days old.
- **Degraded support, the v1 baseline.** For any older host on the v1
  contract the controller keeps core control working (library, add, pause,
  resume, remove, files, settings that exist on that host), hides what the
  host lacks, and shows an out-of-date notice. Below the floor in **Removal**
  it shows an update screen instead of a broken UI.
- **Release dates are data.** The web build embeds a generated manifest of
  released host versions and dates per product kind, from release records.
  The client compares it with `ApiHello.product.version` (Tactical
  [353](353-host-product-in-hello.md)). An unknown version (development or
  newer than the manifest) counts as current.
- The horizon may tighten (for example to 14 days) only after Tactical
  [355](355-automatic-updates.md) and observed update uptake justify it. It
  never widens silently.

## Design

### Baseline and registry

- `baseline_v1` names the contract shipped by `desktop-v0.3.1` and
  `android-v1.0.31`. A host that advertises no registry entries is treated as
  exactly the baseline.
- One Rust registry module in `rstorrent-session` defines each capability:
  name, append-only numeric ID never reused, introducing version and date,
  lifecycle (`transitional` or `required`), owned surface (commands, patch
  keys, view fields, enum variants, frame types), and the client fallback.
  It is exported into the generated TypeScript, Kotlin and Swift contracts.
- The host advertises its set in `ApiHello.capabilities` beside the existing
  view names; host configuration may withhold one (as `direct_file_v1` does).
- Clients do not advertise. Host-side shaping for legacy clients was
  considered and dropped: it would only bridge the already-released strict
  extension, which release order handles (Maintainer decision, 2026-10-14).

### Tolerance

- **Host to client.** Output objects are open: `deny_unknown_fields` stays on
  inputs only, and generated output schemas drop `additionalProperties:
  false`. Absent defaulted fields are filled from generated defaults after
  validation, so a TypeScript field typed as present is present. An unknown
  enum value in a view becomes an explicit `unknown` for that field rather
  than failing the view; an unknown server frame type is ignored.
- **Client to host.** An unknown command variant or patch key is answered with
  a correlated per-call `unsupported` error naming what was refused. It never
  counts toward the invalid-message limit and never closes a relay circuit.
- **Released strict clients.** Extension 1.1.4 and older reject new fields
  in closed types and new variants. Until a tolerant extension is published
  and auto-updated, a host release that ships such an addition breaks the
  companion for users who update the host first; the release runbook makes
  that an explicit, recorded choice.
- **Relay authentication.** Both sides accept unknown fields in
  `AuthenticationReady`, `AuthenticationSucceeded` and `AuthorizationChoice`.
  Security-relevant fields stay transcript-bound per
  `remote-access-authentication`.

### Gating in the client

- `hostSupports(capability)` reads the live hello, refreshed after reconnect
  (Tactical 353).
- Components gate before rendering. Commands and patches go through one
  builder that drops anything owned by a capability the host lacks, so a
  forgotten component gate cannot put an unsupported key on the wire.

### Audits

- **Released contract snapshots.** Each host release checks in its generated
  schema and capability set, like the released catalog fixtures of Tactical
  [345](345-supported-catalog-migrations.md). CI diffs the current contract
  against every snapshot inside the horizon and the baseline. It fails on a
  removed, renamed or retyped field; a new required field; or a new command,
  patch key, enum variant or frame type that no capability owns.
- **Registry audit.** IDs are unique and append-only; every owned surface
  exists; no released capability's owned surface grows. New semantics take a
  new capability.
- **Released-host fixtures.** Recorded hello, settings, library and detail
  frames from each released host pass the current validators and render the
  main screens without errors.
- **Released-client fixtures.** The released extension's and hosted bundle's
  validators accept current host output.
- **Lint.** No raw capability strings outside the registry helpers; outgoing
  patches only through the gated builder.

### Removal

- Removing a capability means deleting the client fallback and gate. The host
  keeps advertising it, and its registry entry remains forever with
  `required since <date>`.
- CI produces a report of transitional capabilities whose introducing release
  is older than the horizon. Removal also needs the observed version
  populations (Play Console, Web Store dashboard, desktop update-check
  requests) to show hosts without the capability below about 2% on every
  surface that can host the client. Being listed only makes a capability eligible;
  removal is an explicit, reviewed commit that cites the entry. Overdue
  entries stay visible in the report; their review dates are never pushed
  back silently.
- After removal, a host lacking a required capability is below the floor and
  gets the update screen with whatever core control still works.
- Host-side removal or change of a command follows the same rule in reverse:
  only after every client older than the horizon no longer depends on it.

## Slices

1. **Repair the hosted controller and gate releases.** Complete; see
   **Evidence**. Generated default-filling, the Rust registry with
   `seed_stop_limits` and its TypeScript export, client gating and the
   outgoing patch filter, `desktop-v0.3.1` fixtures with decode and render
   tests, and the contract-compatibility test.
2. **Tolerant clients and extension release.** Complete except Web Store
   submission; see **Evidence**. Open output objects; unknown row field
   kinds dropped; hand-written records ignore extra keys; extension 1.1.5
   packaged. Unknown enum values and frame types were narrowed out: they
   need per-type UI handling and stay strict (topic rules treat them as
   breaking).
3. **Host tolerance.** Per-call `unsupported` for unknown commands and patch
   keys; relay authentication leniency.
4. **Released-client fixtures and lint.** The released extension's
   validators against current host output; no raw capability strings.
5. **Policy surfaces.** Release-date manifest, out-of-date notice and update
   screen, version-population record, removal report. Presentation lives
   with Tactical [343](343-about-support-and-remote-updates.md)'s remote
   About work.

## Non-Goals

- Per-host archived UI bundles or a loader shell.
- A public third-party API promise; this covers first-party clients only.
- Automatic update mechanics (Tactical 355).
- Bumping `API_VERSION`. Breaking changes stay out of v1.

## Invariants

- A newer client never sends an older host anything outside that host's
  advertised capabilities and the baseline.
- No unknown input closes a connection or relay circuit; only malformed
  framing or authentication failures do.
- Support is decided from advertised capabilities and recorded release dates,
  never from parsing product version strings for features.

## Validation

- Web unit and render tests over released-host fixtures, including the
  `desktop-v0.3.1` repair case.
- Rust tests: per-call `unsupported`, registry export,
  relay leniency.
- Contract-diff and registry audits in CI, each with a deliberate failing
  fixture.
- A mixed-version run: the current hosted bundle against a `desktop-v0.3.1`
  host through the relay; the released extension against a current host.
- `npm run typecheck` and `test` for `clients/web`; generated Kotlin and Swift
  builds; workspace `fmt`, `clippy` and `test`.

## Evidence

Slice 1, 2026-10-14:

- **Reproduction.** Before the change, a render probe giving Connection &
  seeding settings a `desktop-v0.3.1` settings view threw `TypeError: Cannot
  read properties of undefined (reading 'type')`.
- **Defaults.** `generate-validators.mjs` compiles with Ajv `useDefaults`.
  Ajv ignores seven defaults inside `oneOf` branches; all are client-built
  request fields or the hand-filled view `client_settings`, and any new one
  fails generation. `ServiceSnapshot.client_settings` keeps `validation.ts`'s
  fresh-profile default. Generation also fails when a field a host may omit
  is typed as always present (negative control: making
  `TorrentView.private_torrent` required fails generation).
- **Registry.** `host_capabilities.rs` with `seed_stop_limits` (ID 1, owning
  both settings patches' `seed_stop_*` keys), advertised by every
  `ApiHello`, exported as `HOST_CAPABILITY_REGISTRY`. Rust tests: unique
  names and IDs, owned keys exist, every entry advertised.
- **Client.** `session.hostCapabilities` from the hello; Settings, torrent
  settings and torrent detail hide stop limits without the capability;
  `LiveApplication.dispatch` drops unowned keys and refuses a patch left
  empty.
- **Fixtures and tests.** `desktop-v0.3.1` schema, default settings view and
  view-set trace copied from the tag, and a hello built from its source.
  `released-hosts.test.ts` (negative control: without `useDefaults` two tests
  fail), an `App.test.tsx` render (negative control: without gating it
  fails), a `LiveApplication` dispatch test, and
  `contract-compatibility.test.ts`, which records five reviewed strict-client
  exposures: `ClientSettings.seed_stop_*`, `TorrentSeedingView.stop`, and the
  `private_torrent` and `source_size_bytes` row deltas (negative control:
  dropping one fails).
- **Runs.** `npm run typecheck` and `npm run test` (691 passed, 2 skipped)
  for `clients/web`; `cargo fmt --check`; `cargo clippy -p rstorrent-session
  -p rstorrent-gateway --all-targets -D warnings`; `cargo test -p
  rstorrent-session --lib host_capabilities`.
- **Not done here.** The hosted controller is repaired only when this is
  pushed and deployed, which needs maintainer approval.

Slice 2, 2026-10-15:

- **Generator.** Host validators are compiled from a schema with
  `additionalProperties: false` removed and a fallback branch on each row
  field union for unknown string kinds, and export `ROW_FIELD_KINDS`. A
  known kind with an invalid value still fails. `validateCommand` moved to
  `v1.client-validators.js`, compiled from the exact schema without defaults.
- **Validation and reducer.** `validateRowUpdate` bounds raw updates at 256
  fields, rejects repeats, drops unknown kinds and applies the old per-row
  bound to known ones; the reducer accepts an update left empty. Hand-written
  `exactRecord` became `recordWithKeys` (required keys, extras ignored).
  Relay authentication `hasExactKeys` is unchanged and stays with Slice 3's
  security review; only the always-newest hosted controller uses it.
- **Tests.** `newer-host.test.ts` (unknown field on every object of the
  current and `desktop-v0.3.1` traces and the released hello; unknown row
  kinds alone and beside known ones). Two tests that asserted rejection of
  extra fields now assert acceptance. The generated-command tests still
  reject unknown patch keys.
- **Extension.** The companion build had drifted into 32 code-split files
  after on-demand panels landed, failing the extension's reviewed file
  allowlist. Companion mode now sets `codeSplitting: false` and
  `cssCodeSplit: false`, restoring one script and one stylesheet.
  `manifest.jstorrent.json` is 1.1.5; `npm test` (61 passed) and
  `npm run package:jstorrent` pass. `target/extension/jstorrent-1.1.5.zip`
  SHA-256 `0a642038f69be233b03304bf4a1514e67d3ed4022c5c9023d81b6e2938efd0b6`
  contains the fallback-branch validator and the capability gate.
- **Runs.** `npm run typecheck` and `npm run test` for `clients/web` (696
  passed, 2 skipped).

## Stopping Condition

Complete when all five slices land; the hosted controller works against every
released host on the baseline; current hosts keep the released extension
working; the audits run in CI; and `application-view-api`, `client-surfaces`
and `remote-access-authentication` record the policy, mechanism and evidence.
