# Tactical 377: Compatible Touchless Release Channels

Status: In implementation, 2026-10-17.

Topics: `beta-release-readiness`, `durable-data-migrations`,
`product-surfaces-and-migration`, `client-surfaces`,
`mixed-version-compatibility`.

## Authorization and stopping condition

Implement and deploy the shared updater extension, commit repository changes,
and publish signed JSTorrent Latest releases for controlled installed tests.
Stable publication is excluded. Stop when the release pipeline, deployed
service, native admission and UI pass deterministic and installed acceptance,
with evidence sufficient for a deliberate Stable touchless release. Report
remaining gaps explicitly; do not infer installed acceptance from CI.

## Scope and accepted policy

- Settings > About & updates exposes Stable (recommended) and Latest (early
  access), separately from automatic idle installation. Stable selection takes
  effect immediately for discovery; the installed application remains until
  a newer compatible Stable is available. Equal-version promotion needs no
  reinstall. Existing selection, candidate invalidation and opt-outs persist.
- One increasing three-component numeric desktop version train spans both
  channels. Publication rejects reuse and lower new build versions. Promotion
  uses the exact already-tested version and signed bytes, without rebuilding.
- Every new release carries bounded, CI-generated compatibility metadata for
  session, product and metrics stores: supported floor, written version and
  immutable migration-prefix fingerprints. A higher app version alone cannot
  establish database compatibility. Native checks run before staging and
  immediately before installation. Store-open checks remain authoritative.
- The server transports validated release metadata and explicitly reports
  incompatible candidates to capable clients. Old requests retain their
  existing fields, implicit Stable and no-update semantics. Other products
  opt in independently. No database paths or contents are sent to the service.
- Enable production touchless installation for Latest first; Stable activation
  follows recorded native acceptance. No signing-root or identity changes.

## Non-goals and invariants

No database downgrades, destructive recovery, migration baseline edits,
incubation publication, new engine behavior or public-swarm tests. Test
schema bumps must use isolated owned profiles and forward migrations, and
must not create a disposable migration in the shipping schema history.
Never install an older application, including when its database support fits.
Unknown, malformed, missing required or mismatched metadata fails closed.
Candidate, channel and opt-out changes invalidate in-flight work. Background
updates preserve non-foreground state; own-app interaction postpones restart.
No task may outlive its existing owner/cancellation/join path.

## Ownership and bounds

The session crate owns database compatibility facts and read-only inspection.
The desktop adapter owns admission, preference and retained signed candidate;
the existing automatic-update owner owns timers, downloads and shutdown.
The release collector owns source-derived metadata and exact asset binding.
The shared server owns bounded metadata validation and compatible transport;
dotfiles owns private deployment and VM receipts. Pure comparison depends
inward on plain data; no new background worker or dependency is planned.
Retain the client's 64 KiB metadata cap and timeout; bound store count and
migration history. Never log credentials, user database paths or torrent data.

## Validation

1. Deterministic: malformed metadata, both stores/floors/lineage, unknown
   fields, missing metadata, all version/channel directions, equal promotion,
   stale responses, cancellation and persisted selection. Released-store
   fixtures, migration rollback and newer-schema refusal remain green.
2. Pipeline/server: shared version allocation, duplicate/racing publication,
   immutable promotion, source/asset metadata agreement, legacy products and
   old clients, cache isolation, real HTTP routes and deployed before/after
   Stable response preservation.
3. Native: production-signed Latest A -> B -> C on owned populated VM
   profiles; database forward migration and deliberate higher-version/older-
   schema rejection; Latest -> Stable waiting and compatible catch-up via
   isolated feed/cohort without changing public Stable. Foreground, hidden,
   minimized and unfocused restarts, transfer intent, opt-out/snooze/input,
   interruption/retry, installer failure and restart recovery. Exercise real
   900/60 timing and shipping architectures where available.
4. Run appropriate Rust/web/release/server checks. Record exact commit,
   package hashes, signing identity, target and assertions. Restore guest
   changes, stop owned processes, release claims and clean temporary assets.

## Initial survey

JSTorrent already has Stable/Latest descriptors and native/UI channel choice.
`checked_manifest` refuses equal/older numeric versions; Stable catch-up is
already presented. Tactical 355's production gate currently permits only
isolated qualification identities. Server `LatestJson` currently transports
only version/platform signatures; no database compatibility field exists.
The old nightly allocator derives a separate next-minor train and its frozen
incubation publication must stay disabled. This tactical replaces that policy
only for JSTorrent. Existing session/product migrations and schema fixtures
are the source of database facts; protocol/engine behavior is unchanged.

## Execution checkpoint

Design/source survey in progress. Next: implement the compatibility contract
and deterministic negative cases before any live deployment or publication.

## Source and deployment evidence — first slice

- Added shared pure database ranges/prefix admission and read-only SQLite
  inspection, including committed WAL state. Four focused session tests pass.
- Added native authentication tests using an independently generated public
  fixture (the disposable private key was destroyed). Two tests prove product,
  version, platform, URL and payload-signature binding and forged/oversized
  document rejection. The prior focused desktop suite passes 75 tests.
- Web typecheck, all 863 web tests (3 skipped), production build/CSP and
  localization checks pass. The existing channel control now explains early
  access, Stable recommendation and waiting for a compatible release.
- Release train/input/collector/validator tests pass (31 focused cases).
  Actionlint passes the new Latest and modified release/CI workflows.
- Shared server 820e58f passes TypeScript, 129 tests and bundling, and is
  deployed. All five public Stable responses remain byte-identical at 0.3.1.
- Workspace Clippy passes. Full workspace tests are still running.
- Existing main CI had stale source-text checks for the native-owned installer
  and qualification-build Windows GUI attribute, plus missing dependency-notice
  provenance. The checks now follow those accepted behaviors. Reviewed exact
  published manifest declarations for 14 existing archive omissions under the
  existing declaration-only notice policy; no dependency added. Mac ARM notice
  generation now covers 500 Rust and 35 npm entries; distribution-review tests
  pass (29). Other platform package checks remain hosted evidence.

## Independent publication blocker

The existing release-compatibility guard refuses new desktop publication:
strict extension 1.1.4 still belongs to the 30-day support window, while main
emits eight new fields its decoder rejects. Tactical 354 explicitly removed
host response shaping. Maintainer direction has been requested on restoring
compatibility versus explicitly limiting Latest to updated companions. Do not
silently waive the guard or activate Stable. Private signed candidates and
independent updater work may continue while that decision is pending.

## Restart checkpoint

The first source slice is ready for CI/private signed-candidate preparation.
Production touchless admission is enabled for explicit Latest selection only,
with preference/channel changes re-evaluating availability immediately. Stable
remains gated pending native evidence. No public Latest has been published.
Next: finish immutable promotion tooling, complete full checks, obtain signed
candidates, run real installed updates and schema/channel/failure matrices,
and record final Stable activation evidence. VM/deployment operational facts
and claims remain private in dotfiles and the Machine Control usage journal.

### Promotion follow-through

Added explicit dry-run-first Stable promotion tooling: verify every public
Latest asset digest and updater signature, preserve its native packages,
source archive and written database facts, rebind updater URLs, authenticate
Stable metadata and regenerate checksums. The manual promotion workflow
requires an explicit `publish` input and checks the candidate source's own
companion-compatibility policy before any GitHub write. Three deterministic
promotion cases and existing compatibility-policy tests pass; no Stable
promotion has been dispatched. Added a shipping-identity VM observer that uses
only the actual authenticated app API and normal feed/timers, plus an
independent native focus observer parameter for the production identity.

### Portable fingerprint correction before public qualification

The first hosted Windows build correctly failed closed: its CRLF checkout
could not satisfy the original source extraction. Normalize source line endings
and compare parsed generated facts. A regression also changes the second SQL
statement of a multi-statement constant, requiring its migration fingerprint
to change; extraction now covers the entire string. Schema-29 hashing names
migration entry points, SQL and conversion helpers instead of unrelated
readers. No migration or database version changes. Six train/promotion tests
and the focused native/domain tests pass against the corrected facts.
Canceled preliminary private run 39010031773 before package qualification;
future installed acceptance must use a rebuilt candidate. No public metadata
prefix or shipping package has been issued by this task.

The real notarized Stable 0.3.1 ARM bundle is downloaded inside the claimed
macOS VM and independently matches GitHub SHA-256
`6de700144b5a4ea2bd55fd6a110b05d4d2515643efe75823c89814ad04dadba7`.
Strict code-seal verification and Gatekeeper report Notarized Developer ID.
An owned copy of the released populated schema-26/product-2 fixtures, prepared
paused with public discovery disabled and pending/removal flows settled before
launch, opens in that actual Stable app. All seven torrent identities and the
installation identity survive, with schema 26/product 2/metrics 1 recorded.
This establishes the old installed endpoint; upgrade acceptance is still open.
Full local workspace tests passed 1,743 tests (20 ignored) across 73 suites.
