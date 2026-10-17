# Tactical 377: Compatible Touchless Release Channels

Status: Implementation and installed acceptance complete for the enabled
targets, 2026-10-17. Public publication retains the companion-policy hold.

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
silently waive the guard or publish Stable. Private signed candidates and
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

### Private cohort qualification while publication policy is pending

Use the existing pinned installation-cohort and local asset delivery facilities
from Tactical 252 for owned VM profiles. Public Stable/Latest selectors remain
unchanged. Add private-candidate-only numeric version overrides (0.3.60000+
for this task) and an optional source-overlay qualification mode: append a
synthetic schema-30 probe migration only in the owned CI working copy. The
ordinary service policy controls Stable permission for those owned cohorts. Record the exact overlay and source digests. Never commit the
probe migration to shipping schema history, publish such a package, or run it
against an unowned profile. All private profiles must be removed at cleanup;
they cannot return to lower public application/database versions.

The planned sequence is released Stable schema 26 -> private B schema 29 ->
private C schema 30 through unattended updating; refuse higher-version D whose
actual binary/metadata support only schema 29; verify Stable waiting and a
compatible schema-30 E catch-up. Private B/C/E retain real production identity,
updater root, OS signing/notarization and installer hooks. CI additionally
signs cohort URL-bound metadata for the existing HTTPS asset service, keeping
it outside the public asset inventory. A healthy empty channel reports 204
without masking upstream failure, and native discovery still checks scoped
platform offers. These rehearsals do not waive the public companion policy.

The private populated-store probe pauses ten seconds inside its transaction,
providing a bounded application-process crash window and a long startup gap
for focus testing. Empty/fresh catalogs do not pause. This delay is confined
to the private source overlay; shipping source/schema stay unchanged. The
source-overlay CLI is tested end to end in a temporary tree, including refusal
without explicit qualification authority and preservation of every real prefix.
The collector refuses publication or mixed-platform source receipts for these
artifacts. Private candidate versions are reserved to 0.3.60000–60999 and cannot
be combined with either publication mode. The private probe has a retirement
row in the durable-data ledger.

Channel automatic-install permission is now separate from package identity:
the service sends `X-Automatic-Install`, with false/missing failing closed.
Native code checks it on discovery and again immediately before shutdown;
manual installation and stored opt-outs remain independent. Owned cohorts can
override rollout without changing public offers. This lets an identical
qualified binary move from Latest to Stable without requiring a rebuild just
to change a compile-time channel switch. The per-target compiled gate remains
Latest-only until installed evidence lands; the private probe enables Stable
only for that controlled rehearsal. Server 2c2e767 is deployed with 132 passing
tests; all five Stable response bodies remain identical, Stable permission is
false, and healthy empty Latest discovery now returns 204.

### Installed campaign preparation follow-through

The Linux x86_64 VM also runs the independently digest-verified public Stable
0.3.1 AppImage against the released populated fixture: session 26/product 2/
metrics 1 and all seven torrent identities survive. Preserve the target's
pre-existing production profile offline and restore it after the owned run.
A generic guest helper refuses existing profiles unless explicitly preserved,
and refuses input replacement and over-limit/download-digest mismatches.

Release-history downloads now enforce a streamed 64 KiB limit and require
facts for post-boundary releases. Promotion retains the established 2 GiB
source-carrier limit separately from the 512 MiB native payload limit; the
actual previous source carrier is about 926 MB. Ten focused release/helper
cases pass. An explicit rustfmt check caught formatting in the private probe
before its pending build began; correct it and rebuild that private candidate.

The existing public publisher's final verifier is Stable-specific and does not
yet automate the separately prepared corresponding-source carrier from prior
releases. Reconcile both before any public Latest publication; do not publish
an incomplete source inventory or claim the current pipeline is fully ready.

Private nonpublishing builds now use per-run concurrency; actual publication
and Stable promotion retain the shared publisher lock. This permits the B/C/D/E
matrix to build in parallel without queue replacement, while existing exact
source/run/attempt and nonpublication guards still apply. Seventeen focused
input/collector/publication tests and actionlint pass. The private transfer peer
can stay bounded and deliberately slow through a real idle interval, then
unthrottle for post-restart verification. Reuse the existing scoped Windows
registry preservation in the production rehearsal; all five existing platform
pin tests pass after extracting that owner into a shared test helper.

Windows x86_64's inner routes are ready after stored-credential login. The
local Windows ARM login route failed before a confirmed session, and the local
Linux ARM start was refused by Machine Control's documented UTM health guard.
Both initially-off local targets are confirmed off and their claims released;
no credential replay, outer input or provider-guard bypass. Continue installed
acceptance on the ready macOS ARM, Windows x86_64 and Linux x86_64 targets and
retain the architecture gaps explicitly.

### Public Latest source-carrier completion scope

Close the existing publisher gap without changing license policy: prepare the
versioned corresponding-source carrier from the exact selected application
source and ordinary version-stamping script, current locked Cargo vendor inputs,
and the independently hash-bound prior public carrier. Reuse its reviewed
native/runtime/web sources only where exact identities still match. New web
inputs need explicit distribution/preferred-source integrity pins; missing
native source/version pairs or changed outer runtimes must fail closed. Keep
original notices, source terms and rebuild/relink instructions. Validate the
carrier independently and bind it into the final 17-asset private draft before
public publication. Latest and Stable must share this gate; promotion retains
all source/native bytes. No public publication bypasses companion policy.


### Strong migration-crash probe and ordinary rollout gate

Before any C/D/E offer or installation, strengthen the private populated-store
probe: create its table and write an 8 MiB bounded blob inside the transaction,
then pause ten seconds. This makes the application-crash window follow actual
uncommitted writes/cache spill. Empty profiles use a zero-length blob and no
delay. Rebuild the unoffered preliminary C/D/E candidates; none has entered an
installed profile or a public release, and no published migration prefix changes.

The compiled production identity gate now supports both channels; the ordinary
service permission remains mandatory on discovery and before shutdown. Public
Stable permission remains false. This replaces the earlier extra compile-time
Latest switch, so qualified native bytes can be promoted unchanged, while the
server's target allowlist keeps unqualified targets manual. Private probes no
longer need a different availability implementation. The focused 78 native
tests and desktop Clippy pass; source/collector tests and workflow lint pass.
Full source-carrier preparation against actual B AppImages is running.

The first actual source-carrier run passes both empty-Cargo-home metadata
checks and fails closed on a newly updated libxml2 source/version pair. Pin its
exact primary Ubuntu descriptor and every descriptor-checksummed source file,
retaining original package terms/notices. Both new preferred web archives have
their original MIT license files. Full archive verification remains in flight.
B's complete signed workflow 39013645870 passes all platform legs and collection;
all six updater signatures and five cohort payload digests verify independently.
Only its owned installation IDs are offered B; ordinary Stable bodies remain
byte-identical across all five targets.

### Real installed refusal found and corrected before release

B replaces the real Linux AppImage through the normal updater, then its startup
legacy-import preflight wrongly rejects released schema 26 as not equal to 29.
The original populated catalog remains schema 26 with all seven identities;
no migration/reset runs. Withdraw B's owned offer immediately. Mac and Windows
have only checked the offer, so their installed baseline remains 0.3.1.

Both desktop and Android legacy preflights duplicated an equality-only schema
check ahead of the ordinary forward-migration owner. Reuse the canonical pure
catalog-version classifier: supported older catalogs reach ordinary open,
while retired, newer and unversioned nonempty stores remain refused unchanged.
Keep inspection read-only, legacy source validation before destination migration,
and ordinary store backup/transaction ownership. No migration baseline or step
changes. Regressions exercise both actual startup entry points with the frozen
released fixture, unchanged bytes before ordinary open, retained identities
through forward migration and both adapters' negative classifications. This is
shared startup correctness, including Android, rather than a new engine feature.

The completed source carrier against B's exact AppImages independently verifies
39,191 members, 776 Cargo packages and both empty-Cargo-home Linux metadata
graphs. It binds 85 native source/version pairs, including the explicitly pinned
new libxml2 descriptor/files. Archive SHA-256 is
`8b80dbaca08ee7e2e984523d9e99296a9145aa36c70ae413d51611ae66f0f08c`,
1,128,509,255 bytes. This qualifies source preparation for B's exact bytes,
not B startup. Rebuild corrected candidates with new reserved versions before
resuming installed acceptance.

The startup correction is committed as 954bca0a. All 32 legacy-import tests,
11 startup-filtered tests, workspace Clippy and full workspace tests pass.
Corrected nonpublishing candidates B2/C2/D2/E2 reserve 0.3.60004–60007 at
that exact source (29/30/29/30). Add installed API transfer preparation and
a bounded Linux migration-crash observer: it matches the owned profile,
new process, exact AppImage path/hash, old visible schema and a WAL spill
before killing only that process. Recovery remains an explicit driver relaunch.
CI also caught a folded YAML test command; split the two invocations into
a literal script. Both source/distribution suites (33 cases) and actionlint
pass with that correction.

Promotion now rechecks the exact Stable predecessor identity and metadata
digest, Latest source commit and all 17 source asset digests before draft
creation and immediately before publication. An intervening Stable, replaced
release, changed metadata/source or changed Latest package refuses the prepared
promotion. The shared publisher lock still serializes cooperating workflows;
GitHub release editing by an outside owner is not a transactional CAS. Eight
train/promotion tests and workflow lint pass.

Independent owned keyboard editors receive untargeted control input on macOS,
Windows and Linux before offers. Windows setup requires a native click; its
temporary topmost flag is removed and independently verified. The new macOS
AppKit editor and native focus observer compile on the actual guest.

Corrected Linux B2's source/run/attempt, payload hash and original updater-key
signature verify independently from its completed native leg. Manual recovery
replaces only the stopped failed B AppImage with higher B2 (no downgrade or
profile replacement). Its real production API reports 0.3.60004, session 29,
product 4 and metrics 1; all seven released fixture identities and the owned
installation identity are retained. This verifies the startup correction and
normal forward migration. Installed unattended acceptance remains in progress.

### Installed timing, refusal and crash evidence

The Linux production app refuses a forged compatibility envelope before
staging; a valid offer with service permission off stays manual despite user
preference on. Turning the preference off during an active download cancels
it and retains no payload. A full ordinary 900/60 run stages a valid signed
candidate, then revokes its service permission during the notice. The final
pre-install refresh cancels restart: the original host and schema 29 remain,
with the verified payload retained for an explicit manual action.

The actual macOS ARM installed B2 -> C2 run passes ordinary idle/notice timers,
closed-window preservation, no observed native activation/visibility and 105
untargeted typing tokens (1,272 characters) into an independent editor. A
readonly file receipt at 24 seconds remaining confirms the download was still
partial. C2 writes schema 30 and retains all ten controlled torrent identities
and the installation identity. Download completion/paused-file hashes and
saved intents pass after restart; an independent pinned peer receives and
verifies 2 MiB uploaded from the restarted app.

The actual Linux B2 -> C2 run reaches its migration with an incomplete
download. The observer requires more than 2 MiB of checksum-valid uncommitted
WAL pages, using SQLite's documented salts, rolling checksums and commit
markers (https://sqlite.org/fileformat2.html#wal_format), rather than counting
old WAL file length. It kills only the new owned app. Read-only inspection
then verifies schema 29, no probe table, the same ten identities and
`quick_check=ok`. An explicit driver relaunch of the installed C2 completes
schema 30 with the same identities. This is application-crash recovery with
a driver relaunch, not an OS automatic-restart claim. The independently
authored observer tests exercise actual spill, commit, checkpoint reuse with
a retained stale tail, checksum corruption and truncated frames.

Test transport setup matters: Linux-controller firewall initially blocked its
private peers. Narrow temporary rules repair the claimed sources/ports; only
the two controlled stalled transfer records are recreated after repair,
keeping content and all seven original fixture torrents. Request IDs are
unique across helper processes. The Windows long-lived observer must launch
through Machine Control's persistent desktop route; an SSH descendant did
not survive session completion, and that unstarted timed run is superseded.
Windows qualification and Stable catch-up remain in progress.

Main CI at e6c6f12f passes every platform, Android owned runtime, web, extension,
iOS and release-tools job. Its Rust job hits the 45-minute cold-build budget:
workspace tests start after roughly 40 minutes, and the 500-seed runtime case
is still running when the job is canceled. No assertion failure is reported.
Raise that bounded job to 75 minutes and include the fast WAL observer case
in release-tools CI; local 1,747-test workspace evidence remains separate.

Windows B2 -> C2 also passes the ordinary 900/60 cycle, preserving its minimized
window without activation or a presenting window. An independent editor
receives all 18 untargeted tokens (324 characters) through replacement and
relaunch. Session 30, product 4, metrics 1, ten torrent identities and the
installation identity remain. The active download is still partial at 185/256
verified pieces after restart. Startup acknowledgement subsequently records
success. The observer now requires that acknowledgement as well as the new
version, avoiding an early reconnect's transient unfinished-attempt snapshot.

Earlier Windows typing attempts are superseded because their file oracle
froze: an ordinary concurrent reader can deny atomic replacement, leaving
Tk's modified flag set. A native screenshot independently shows the additional
input in the widget. Tick-based snapshot publication retries sharing errors;
shared readers and actual Windows sharing-collision/recovery tests pass.
No application focus-loss finding is inferred from the superseded snapshots.

On all three installed C2/schema-30 apps, selecting private Stable D2
(0.3.60006/schema 29) persists Stable and reports waiting for compatible
migration history. No payload is staged or replaced, no schema changes and
explicit Install also refuses. Compatible private Stable E2 (0.3.60007/schema
30) is now undergoing real 900/60 acceptance: foreground macOS, visible Linux
behind the editor, and minimized Windows, with continuous independent typing
on Linux and Windows. Ordinary public Stable remains 0.3.1 and untouched.

Fast CI at 694ce531 also exhausted its separate 15-minute job budget: compile
finished at 10:34:14 after a 10:20:31 start, leaving about 90 seconds for unit
tests. All reported assertions pass; the 500-seed scheduling case is still
running at cancellation. Give this bounded affected-crate job 30 minutes;
retain its unchanged checks and no-cache-write policy. Seven fast-planner
regressions and workflow lint pass. This is timeout evidence, not a claim that
the canceled run passed; the full workspace CI remains independently pending.

### Compatible Stable acceptance

All three owned production-identity C2 -> E2 installations pass the ordinary
quiet/notice cycle: first notice after 900.359 seconds on macOS ARM, 900.518
seconds on Linux x64 and 900.496 seconds on Windows x64. Each records a full
60-second notice, successful startup acknowledgement, saved Stable choice,
unchanged ten torrent identities and installation identity, and session 30 /
product 4 / metrics 1. macOS foreground is restored; Linux stays behind the
independent editor (218 tokens, 2,628 characters); Windows stays minimized
(222 tokens, 2,988 characters), without native product activation or a normal
presenting window. Linux's virtual-keyboard focus toggles match its previously
recorded no-update control; top-level product activation and exact input remain
the assertions. Maximum observed sampling gaps are 379 ms and 63 ms respectively.

Windows is still at 216/256 verified download pieces with a differing content
hash at 14 seconds remaining. Its controlled 2 KiB/s global limit survives both
updates, then is explicitly restored to unlimited for completion. All download
and paused-file hashes and saved intents pass. Fresh independent pinned receivers
verify 2 MiB uploaded after E2 on Windows and Linux. macOS's post-C2 hashes,
intent and independent 2 MiB upload already pass. Installed E2 additionally
matches Linux's exact signed AppImage digest, macOS's exact signed executable
and code seal, and Windows's valid Authenticode signature/version.

[Sanitized machine-readable evidence](evidence/377-compatible-updates.json)
records all four corrected candidate runs and every platform payload digest,
the corrected B2 source carrier and the installed results. B2's carrier is
1,128,526,081 bytes, SHA-256
`fa37e33a108b5e543ba5e3cd92d4bf7571a44dd678bd5c24513baf214908d591`,
with 39,191 members, 776 Cargo packages, 85 native source/version pairs and
both empty-Cargo-home offline Linux graphs passing. This supersedes the old B
carrier for a candidate that actually starts and migrates correctly.

Full CI at 694ce531 / run 39024491901 passes every required job, including
Rust/loopback, both Linux targets, macOS, Windows, Android dual ABI and owned
runtime, iOS, web/extension and release tools. The previously budget-limited
500-seed test also passes locally in 41.26 seconds. Follow-up harness/CI budget
changes remain independently under validation.

Linux and Windows are restored, independently powered off and released.
Linux's preserved original configuration bytes match; only the owned handler
and its MIME references are removed, retaining the original handlers. Windows
restores and verifies 50 registry scopes, restores original shortcuts and
removes only the two owned program firewall rules. Owned profiles, roots,
processes and matching capture payloads are removed. Windows's first normal
shutdown exceeded provider waiting; no power action was replayed. Independent
Off and planned shutdown/event-log/OS events confirm completion. Both private
controller firewall rules and the temporary SSH include are removed exactly.
The macOS Intel/Rosetta acceptance and final service cleanup remain running.

The scoped cohort leaves the ordinary `/version` summary at public Stable
0.3.1. A later equal-version private cohort check can therefore still show
waiting-for-Stable; this is not evidence for clearing that copy after a public
promotion. Public equal-version promotion/no-reinstall and downgrade transitions
are covered deterministically. Released 0.3.1 also parses an empty Latest 204
as EOF during discovery, before its scoped platform request. The new discovery
path handles healthy empty channels; the Rosetta baseline bootstraps through
private Stable B2 before selecting Latest with the new owner.

Observed staged native-process RSS is 123 MiB on macOS ARM (current sample),
321 MiB Linux peak and 77 MiB Windows peak. These are native-process samples,
excluding UI child processes, rather than whole-application resource bounds.
Existing payload/archive caps and the new bounded metadata/history/store-read
checks remain the enforced limits.

The current publication policy has thirteen reviewed exposures: eight fields
rejected by strict companions and five request-gated variants no released
client requests. The explicit desktop-latest-v0.3.2 publishing check still
refuses the eight fields, with no accepted break. The Google adoption page
requires reauthentication; no new count or policy exception is inferred.
Arming service permission for a qualified target does not publish a release or
waive that guard. Ordinary Stable remains the same 0.3.1 payload.


### Final installed scope and deployed permission

A separate fresh Intel macOS profile runs the actual notarized x86_64 0.3.1
bundle under Rosetta on macOS 26.6.2. Its ordinary manual B2 upgrade preserves
all seven frozen fixture identities through schema 26 -> 29. B2 -> C2 then
uses the full 901.572-second quiet interval and 60-second notice. After the
old process exits, an independent observer verifies the new signed executable,
visible schema 29 and 4,542,464 bytes of checksum-valid uncommitted WAL, then
opens the owned editor. Untargeted input reaches it before startup finishes.
C2 opens its window without taking focus back, commits schema 30 and retains
all identities; the complete 120-character editor text verifies. Native events
confirm the original foreground handoff, editor activation and no subsequent
product activation. There is no physical Intel hardware claim.

Rosetta also refuses higher Stable D2 before staging. Changing channels safely
evicts the old cache; no incompatible payload or database change occurs.
Compatible Stable E2 passes ordinary signed admission and an **explicit**
install while the editor stays foreground, preserving seven identities and
Stable selection. Its 235-character final text includes 115 new characters.
This is a manual Stable catch-up check, not a second real-idle claim. On the
other targets, reported final text also includes prior control text; the JSON
receipt records the separate new-character counts.

Production service permission is now armed on both channels for exactly
`darwin-aarch64`, `darwin-x86_64`, `windows-x86_64` and `linux-x86_64`.
Production Linux ARM remains manual: its native signed build passes, but the
available installed target was refused by Machine Control's health guard.
Older ARM synthetic qualification is not substituted for that missing live run.
All five ordinary Stable body hashes still match the original 0.3.1 snapshots;
public Latest is healthy and empty. No public Stable or Latest release was
published. The private cohort environment/drop-in, installation IDs and all
private service assets have been removed; the ordinary service is healthy.

Every claimed VM returns to its original Off state and is released. macOS
normal Quit finishes before removing both owned profiles, app paths,
registrations, five matching captures and only the two WebKit/cache directories
created during this task. Unowned OS settings, applications and caches remain.
Private controller peers/firewall/SSH state and downloaded source investigation
scratch are removed. The synthetic schema-30 profiles are discarded, satisfying
their data-ledger retirement condition for this execution.

### Remaining boundaries

Public publication still needs the existing companion compatibility policy to
clear or a maintainer's explicit per-release accepted break; this tactical
changes neither. Physical Intel coverage is absent; Rosetta is identified
explicitly. Production Linux ARM auto-install is not enabled. The broader 355
power-loss, packaged failure/repetition and long-soak cases not executed here
remain unclaimed. The qualified rollout can be paused per channel/target by
service configuration, and the pre-shutdown permission recheck is live-tested.

Current source has passed full core CI at 694ce531 and follow-up Fast CI at
cc521452 / 39027221148. Follow-up full CI 39027221207 exposes a separate iOS
Add-to-Settings UI navigation timing failure: the captured hierarchy remains
on the library after an immediate tap following sheet dismissal. Synchronize
on dismissal and next-button hittability without dropping assertions; 375 and
`localization` own that bounded harness correction. Final exact-source CI is
required before publication, independently of the companion hold.
