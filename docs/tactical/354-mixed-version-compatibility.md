# Tactical 354: Mixed-Version Compatibility And Capabilities

Status: Proposed, 2026-10-14. Maintainer selected the flexible capability
model and a 30-day starting horizon; planning only, implementation not yet
authorized.
Topics: `application-view-api`, `client-surfaces`,
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
3. Both sides advertise. A host shapes its output for a legacy client that
   advertised nothing.
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
- The client advertises its set in `Connect`. A client that sends none is a
  legacy client.

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
- **Legacy-client shaping.** For a legacy client the host omits fields,
  variants and frames owned by capabilities that client did not advertise.
  This is the only way to keep already-released strict clients, such as
  extension 1.1.4, working.
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
  validators accept current host output in legacy-client mode.
- **Lint.** No raw capability strings outside the registry helpers; outgoing
  patches only through the gated builder.

### Removal

- Removing a capability means deleting the client fallback and gate. The host
  keeps advertising it, and its registry entry remains forever with
  `required since <date>`.
- CI produces a report of transitional capabilities whose introducing release
  is older than the horizon. Being listed only makes a capability eligible;
  removal is an explicit, reviewed commit that cites the entry. Overdue
  entries stay visible in the report; their review dates are never pushed
  back silently.
- After removal, a host lacking a required capability is below the floor and
  gets the update screen with whatever core control still works.
- Host-side removal or change of a command follows the same rule in reverse:
  only after every client older than the horizon no longer depends on it.

## Slices

1. **Repair the hosted controller.** Fill absent defaulted fields after
   validation; gate the stop-limit controls, per-torrent overrides and Keep
   seeding on a new `seed_stop_limits` capability that current hosts
   advertise; add the first released-host fixture (`desktop-v0.3.1`) with a
   render test of Settings and torrent detail. Deployable through the hosted
   site alone.
2. **Two-way advertisement and legacy shaping.** Client capabilities in
   `Connect`; host shaping for legacy clients; the registry module and
   generated exports; the gated command and patch builder. Required before
   the next desktop or Android release that contains Tactical 344.
3. **Tolerance.** Open output objects, unknown enum and frame handling,
   per-call `unsupported`, relay authentication leniency.
4. **Audits.** Released contract snapshots and diff, registry audit,
   released-host and released-client fixtures, lint.
5. **Policy surfaces.** Release-date manifest, out-of-date notice and update
   screen, removal report. Presentation lives with Tactical
   [343](343-about-support-and-remote-updates.md)'s remote About work.

## Non-Goals

- Per-host archived UI bundles or a loader shell.
- A public third-party API promise; this covers first-party clients only.
- Automatic update mechanics (Tactical 355).
- Bumping `API_VERSION`. Breaking changes stay out of v1.

## Invariants

- A newer client never sends an older host anything outside that host's
  advertised capabilities and the baseline.
- A host never sends a legacy client anything outside the baseline.
- No unknown input closes a connection or relay circuit; only malformed
  framing or authentication failures do.
- Support is decided from advertised capabilities and recorded release dates,
  never from parsing product version strings for features.

## Validation

- Web unit and render tests over released-host fixtures, including the
  `desktop-v0.3.1` repair case.
- Rust tests: per-call `unsupported`, legacy-client shaping, registry export,
  relay leniency.
- Contract-diff and registry audits in CI, each with a deliberate failing
  fixture.
- A mixed-version run: the current hosted bundle against a `desktop-v0.3.1`
  host through the relay; the released extension against a current host.
- `npm run typecheck` and `test` for `clients/web`; generated Kotlin and Swift
  builds; workspace `fmt`, `clippy` and `test`.

## Stopping Condition

Complete when all five slices land; the hosted controller works against every
released host on the baseline; current hosts keep the released extension
working; the audits run in CI; and `application-view-api`, `client-surfaces`
and `remote-access-authentication` record the policy, mechanism and evidence.
