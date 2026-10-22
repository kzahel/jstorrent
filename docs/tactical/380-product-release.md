# Tactical 380: Product Releases

Status: Desktop Stable 0.3.4 and Android 1.0.32 publication authorized,
2026-10-22, requiring extension 1.1.5+. Android 1.0.32 is publicly available
on Google Play; physical ChromeOS companion verification and signed artifact
checks pass. Desktop exact-source signed qualification remains a gate.
Extension 1.1.6 is publicly verified, 2026-10-21. Remote controller 0.3.3
published and publicly verified, 2026-10-21.

Topics: `beta-release-readiness`, `mixed-version-compatibility`.

## Scope and stopping condition

Publish production JSTorrent desktop, extension 1.1.6 and Android
1.0.32/code 32 from qualified source. Desktop Stable is 0.3.1; public
Latest 0.3.3 exists at fe4be51c. Prefer immutable promotion after its
compatibility and installed-evidence requirements pass. Store submission
with automatic publication after review is the store stopping condition;
record pending review separately from public availability.

Preserve existing identities, signing roots, durable data, production
countries and rollout settings. No engine, schema, permissions, listing, marketing copy or
layout changes. Advance the existing verified website download inventory
after Stable publication. Include the bounded security dependency patches
recorded below. The hosted remote controller is added to
scope by subsequent maintainer direction; its independent release does not
authorize the held host releases. No unrelated store drafts.

## Policy checkpoint

Extension 1.1.5 is live since October 15. Strict extension 1.1.4 and older
remain inside the 30-day support window. Existing Latest authorization
covers eight reviewed fields only; it does not authorize Stable or Android.
The original hold below is historical: the October 22 maintainer decision
authorizes the two exact host releases with extension 1.1.5+ required. Other
releases retain their own guards.

## Ownership and validation

Release helpers own version commits and atomic main/tag pushes. Actions owns
exact-source tests, compatibility, signing, notices, packaging and receipts.
Google owns review and distribution. Existing release concurrency serializes
publishers; no runtime tasks or protocol changes are introduced.

Run web typecheck/tests, extension tests and production packaging, release
helper tests, compatibility ledger and database-history checks. Require
hosted signed Android dual-ABI/JVM/lint/artifact validation and independently
verify downloaded artifacts before Play upload. Desktop promotion must retain
native bytes and signatures, verify authenticated database facts, exact
source and current Stable predecessor. Record exact checks and workflow runs.

## Preparation evidence

Web typecheck, 863 web tests (three existing skips), all 69 extension tests,
production packaging, 27 Android release-tool cases, and 17 release-policy,
promotion/train/metadata tests pass. Database metadata and the existing
11-delivery capture ledger pass. The unauthenticated store check confirms
1.1.5 is live. Extension 1.1.6 is tagged at b3792b90; Actions 39479561516
owns construction, live compatibility and submission.

Authenticated Play inspection confirms production 31 is active across 178
countries, no unpublished changes, and managed publishing off. Its dashboard
reports two foreground-service-start timeout crashes affecting two users;
crash/ANR rates are unavailable. The existing disabled-R8 optimization warning
has a February 2027 deadline. These are current-production observations,
not new-release qualification.

Tactical 371's Android prerequisite is still present: released clients send
X-JSTorrent-Installation while hello, folder authentication and CORS accept
only X-RSTorrent-Installation. Repair both names without changing origins,
credentials, pairing ownership or ARC listener scope. A handler regression
checks paired hello, preflight, successful folder completion and rejected
credentials for each spelling. Physical ChromeOS verification remains a
separate pre-publication gate.

## Fresh dependency review

Hosted audit 39479660510 finds zero Cargo, web and website vulnerabilities,
but stops on newly indexed RUSTSEC-2026-0374, basic-toml 0.1.10 maintenance
status. Advisory revision b19b2c83 (October 20) describes its archived
repository and suggests toml; it discloses no vulnerability. The default
all-target Cargo graph contains no basic-toml. The workspace/all-features,
all-target reverse graph retains it only through askama_derive 0.14,
askama and UniFFI 0.31 binding-generation tooling. Record this warning with
that bounded justification; preserve the qualified UniFFI dependency graph
and existing November 12 review expiry. No vulnerability or source-integrity
gate is waived.

The companion handler regression, localization catalog validation, formatting
and workspace Clippy pass. Full Rust tests and dual-ABI Android debug build
continue. The first qualification build rejects an unsupported test identity
before building; retry uses the existing supported setup320 QA identity.

## Completed local validation

`cargo fmt --all -- --check`, `cargo clippy --workspace -- -D warnings` and
`cargo test --workspace` pass: 1,749 tests, 20 existing ignores, zero failures
across 73 suites. `node scripts/check-localization.mjs` passes all catalogs.
The normal full Android debug builder passes both locked native ABIs,
host/JNI generation, 218 JVM tests, APK packaging and notice inspection,
using the existing isolated org.jstorrent.setup320 QA identity. No production
app or durable library is installed over or modified by this build.

Fresh local pinned Cargo and web/website npm reports pass
`review-dependency-audit.py --require-release-ready`; all 30 distribution
review unit tests pass. Hosted audit's initial warning-inventory failure is
retained above rather than represented as a successful hosted run.

## Extension submission

Actions [39479561516](https://github.com/kzahel/jstorrent/actions/runs/39479561516)
passes exact tagged construction, web checks, extension tests and the live
old/new host-client matrix. The existing production store item accepts
1.1.6 from b3792b9064c24bcdf0344c7c4c30390cb2744543 and returns
PENDING_REVIEW, with automatic publication after approval. Its exact ZIP
SHA-256 is aeb7abe31a4e8b41d643e53828f00ee3fc284da04733e77021ef1346a76ceae6.
The receipt still reports 1.1.5 as the published version. Record 1.1.6 as
submitted and retain its exact-source client capture; do not infer delivery.

The ChromeOS common doctor passes. Its ARC ADB connection requires a new
host-key approval; no APK is installed and no debug-trust approval is given.
The candidate is ready, but explicit maintainer permission for this debugging
access and the Stable/Android companion-policy exception remain pending.

`clients/android/gradlew -p clients/android
-PchromeosQualificationTestPackage=org.jstorrent.setup320 lintDebug` passes
separately (the debug build helper itself does not run lint). Extension
Actions completes successfully, and the public GitHub receipt/ZIP/build record
match the submitted source and hash. The 12-delivery ledger check passes.

Adding the submitted 1.1.6 delivery exercises its own captured decoder in the
local matrix. Its observed failure list is empty; record that explicit
expectation alongside 1.1.5. The first check fails only because the new
delivery lacks that required expectation, not because its decoder rejects a
host frame. Re-run web typecheck and the full suite after adding the record.
The Android 1.0.32/code 32 release-helper dry run passes from a clean tree.
Both enforced Stable 0.3.4 and Android 1.0.32 guards reject the exact eight
reviewed fields, confirming that no host publication is authorized by an
unrecorded exception.

The final web typecheck and full suite pass: 868 tests, three existing skips.
The new decoder expectation records zero observed failures and does not waive
any incompatibility. Source changes and receipts are pushed to main; full
hosted source CI continues. Fresh hosted dependency review 39482229102 is
running against the reviewed lockfiles/policy; the earlier failed audit and
passing local strict review remain recorded separately.


## Independent remote controller 0.3.3

The maintainer requests the hosted remote website release while retaining the
Stable/Android decisions. Follow the existing independent controller lane:
commit candidate source, capture its exact client decoder, record submission
and explicit decoder outcomes in a following metadata commit, then atomically
push main and remote-v0.3.3 at the candidate. No new host capability, schema,
relay configuration, origin, credential or trust policy is introduced.

Current source 4271e57c passes hosted full CI 39482545761, Fast CI
39482545932 and Remote Controller build 39482545745. Dependency review
39482229102 also passes against the unchanged reviewed dependency inputs.
Production still reports remote 0.3.2/859f00de before this release.

Tagged Actions must pass the old/new live matrix, web suite, retained
root-artifact browser smoke, deployment headers and every manifested digest.
Then run scripts/verify-hosted-remote.mjs against the public origin using
a disposable host and separate Playwright Chromium. Require private login,
reload/browser restart, revocation, shared-session behavior and signed route
release before removing the temporary authority. Retain the immutable
controller rollback artifact and mark first-public only after verification.

Candidate source is 5cb10f298943f1f18b9481ee68492b3840842a66. Its exact
client capture accepts all current host frames (zero raw failures); the
initial expectation-only failure confirms that observed result before adding
its explicit record. Web typecheck, the full web suite and all 12 remote
assembly/ledger cases pass. The 13-delivery ledger validates. The tag points
to the candidate; this following metadata commit retains its capture and
submission without a first-public claim.


### Remote publication evidence

[Actions 39543233167](https://github.com/kzahel/jstorrent/actions/runs/39543233167)
passes tagged web checks, root-artifact browser smoke, the live compatibility
matrix, exact-artifact Pages deployment and both deployment/custom-domain
header and digest verification. Production reports 0.3.3/5cb10f29. Independently
downloaded build files match all 42 manifested digests; the public manifest
is byte-identical to that retained artifact. The immutable rollback archive
and its SHA-256 are retained in the GitHub prerelease and
[evidence receipt](evidence/380-remote-release-receipt.json). Desktop's Latest
release pointer is preserved.

The exact-source debug headless/gateway build passes. Public
`node scripts/verify-hosted-remote.mjs` passes private login, reload and
browser restart resume, exact revocation, shared login and password after
shared-browser restart. No third-party requests or page errors are observed.
Signed route release succeeds before temporary host/browser cleanup.
`node scripts/verify-remote-deployment.mjs https://remote.jstorrent.com/
5cb10f298943f1f18b9481ee68492b3840842a66` passes independently. Local web
validation is 870 passed/three existing skips, plus typecheck and 12 remote
assembly/ledger cases. The delivery is now published with verified date.

The separate main Fast CI 39543233158 initially times out in existing
`storage_pressure_cannot_starve_dht_intake_or_dial_refill` (613 other engine
cases pass). The exact focused local test passes; a failed-job hosted rerun
is requested without code or threshold changes. Full main CI 39543233157
also continues. This does not replace the successful tagged client release
gates or authorize either held host release.


### Extension public availability

Public store inspection on 2026-10-21 confirms version 1.1.6, with listing
update date October 20. The submission receipt remains historical evidence
of PENDING_REVIEW at submission; it is not the current delivery status.
Retain a separate [public receipt](evidence/380-extension-public-receipt.json)
and mark the ledger published. Use the observation date as a conservative
latest-possible first-public date; the listing's update date alone does not
establish the exact publication time. This does not change the existing
30-day support window for strict extension clients or the host release holds.


## Resumed host publication, October 22

The maintainer elects to publish after a short extension rollout buffer,
accepting extension 1.1.5+ for desktop Stable 0.3.4 and Android 1.0.32. Record
per-release exceptions for the eight existing reviewed field additions; retain
strict-client captures, the normal 30-day horizon and all other guards.
No measured extension adoption is claimed. Legacy response shaping is deferred.
Release notes disclose the minimum extension.

The existing local dependency patch 43ef065c repairs the advisories which
stopped Latest 0.3.4 before packaging. Include that reviewed source without
reverting or weakening fresh dependency review. Build a fresh candidate whose
own policy permits Stable; the older public Latest 0.3.3 cannot inherit a
policy change. Prefer unchanged-byte promotion after signed qualification.
Android's existing dual-spelling companion header fix still requires physical
ChromeOS pairing/folder evidence before Play submission. Existing identities,
production countries, signing roots and durable user data remain invariant.


Android source 071ada49/code 32 is committed with its per-release exception
and exact host capture. Following metadata records the delivery before a
production tag is visible. Web typecheck and 870 tests (three existing skips)
pass; all 22 focused release-policy/promotion/train/selector cases pass.
The ChromeOS common target remains healthy; its ADB debugging key is
unauthorized. Dedicated-testbed approval is requested while independent build
qualification proceeds. The QA APK uses only org.jstorrent.setup320.


### Fresh source gate corrections

Full main CI 39776594324 exposes two stale assertions in the released-host
request matrix: the newly captured Android 1.0.32 correctly advertises
seeding limits and magnet export options. Assert stripping/refusal only when
that exact captured hello lacks the capability, and validate emitted requests
against the exact schema when supported. No runtime compatibility behavior
changes. Web typecheck and all 878 tests pass (three existing skips).

Fresh hosted dependency review 39776594315 rejects two newly indexed Vitest
mocker advisories (GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp). Upgrade the
test-only Vitest family to 4.1.12; npm audit reports zero vulnerabilities.
Keep the existing review expiry and all warning/source-integrity gates.
Android's tagged native/Compose source is unchanged by these web-test fixes.


### Android submission and physical ChromeOS evidence

The maintainer explicitly approves dedicated-testbed ADB debugging trust and
the isolated QA installation. A fresh setup320 build passes both native ABIs,
JVM tests and packaged notices. On ChromeOS 150 / Android API 33, the released
1.1.6 extension runtime pairs with Android 1.0.32, receives authenticated hello,
opens the real Android DocumentsUI picker, receives a granted folder and
reconnects after reload without another approval. The retained Android root
registry and extension settings both contain the owned folder. The extension
uses only the existing beta key and QA display name to isolate its storage;
runtime bytes are unchanged. Production pairing and Android 1.0.31 are preserved.
The QA app, extension, empty folder, deployed files and owned tabs are removed;
common Machine Control doctor passes afterward. The sanitized
[physical receipt](evidence/380-chromeos-release-receipt.json) records the bound
source, artifacts, checks and cleanup. This is bounded companion evidence,
not a Play-signed update rehearsal.

Tagged [Android Actions 39776657995](https://github.com/kzahel/jstorrent/actions/runs/39776657995)
and [live compatibility 39776657979](https://github.com/kzahel/jstorrent/actions/runs/39776657979)
pass. Independently downloaded APK/AAB hashes equal the public GitHub assets.
`python3 scripts/validate-android-release.py --bundletool <pinned 1.18.3 jar>`
passes original signing identity, version/code, JSTorrent manifest, both ABIs
and 16-KiB ELF/ZIP alignment. Exact hashes, signing roots and workflow links
are in the [submission receipt](evidence/380-android-submission-receipt.json).

Play accepts the exact signed AAB as 32 (1.0.32), API 28+, target 36 and two
ABIs, with zero lost supported devices. Production remains targeted at the
existing 178 countries and 100%; previous 31 is not retained. The only release
warning is the missing deobfuscation file with R8 still disabled. One production
change is sent for review; automated quick checks finish successfully and
Publishing overview confirms the changes are now in review, with managed
publishing off. Approval will
publish automatically. Public Play availability is not yet claimed. Existing
foreground-service-start timeout reports are not claimed fixed by this release.


### Desktop source qualification and promotion disclosure

Full push CI [39778029885](https://github.com/kzahel/jstorrent/actions/runs/39778029885),
Fast CI 39778029778, remote build-only 39778029901 and strict hosted dependency
review 39778029500 all pass at cc334489. Full CI includes both Android ABIs,
JVM/lint and the API 35 product SAF lifecycle; web unit/E2E checks; iOS simulator
tests/archive; Rust workspace, deterministic libtorrent and application
lifecycle/corruption checks; and all four native desktop CI targets.

Latest selector [39786199224](https://github.com/kzahel/jstorrent/actions/runs/39786199224)
selects 0.3.4 at that exact source and proves the retained updater signing
identity. Attempt 1 is cancelled before native construction after repeated
Ubuntu mirror download retries; attempt 2 reruns the same source and gates.
No package is published by the cancelled attempt.

Promotion preparation previously replaced the candidate notes with generic
provenance. Preserve the original Latest body in the initial Stable draft so
its minimum extension disclosure survives promotion. The updater's append-only
notes cache can retain its first observation, making a post-publication edit
insufficient. This changes release prose only. Script syntax and all 22
existing promotion/train/selector/compatibility cases pass.


Attempt 2 repeats Azure archive download retries on a fresh runner, before
any source check or native build. CI, desktop construction/collection and
promotion now configure Ubuntu's official HTTPS archive instead of the
Azure archive alias, with 30-second HTTP/HTTPS download timeouts and two
retries. Ubuntu index/package signature verification and all release gates
remain unchanged; ports and other repositories retain their existing URLs.
Bash syntax, workflow actionlint and diff whitespace checks pass. Fresh
main CI qualifies this infrastructure correction before another selection.


### Android public availability

After successful automated checks and review, Play production shows 32
(1.0.32) Active and Available on Google Play in all 178 countries, released
October 22 at 15:54 Europe/Berlin. Publishing overview has no unpublished
changes and managed publishing remains off. Record the verified first-public
date in the ledger and retain a separate
[public receipt](evidence/380-android-public-receipt.json); the submission
receipt above remains historical evidence. No Play-installed update or
production stability result is inferred from console availability.


The d631ee5f desktop candidate includes the bounded CI download
configuration and preserved promotion disclosure. Its exact host capture and
pending Stable delivery pass the 15-delivery ledger and database-history
checks. Local web typecheck and all 886 tests pass, with three existing skips.
These metadata changes remain local through exact-main qualification so they
do not replace the selected source or cancel its CI.

Full push CI [39790212157](https://github.com/kzahel/jstorrent/actions/runs/39790212157)
and Fast CI 39790211631 pass at d631ee5f. Latest attempts
[39800228964](https://github.com/kzahel/jstorrent/actions/runs/39800228964) and
[39801262253](https://github.com/kzahel/jstorrent/actions/runs/39801262253)
both select already-public 0.3.2 from the release list. The first stops at the
immutable-publication guard; the second stops at the increasing-version
guard. Neither reaches native construction or changes a public release.
Independent authenticated and public inventory reads identify 0.3.4 as next.
The SHA-filtered CI list also returns no run while unfiltered main-push reads
and the exact run record confirm successful full CI at the same source.

The selector now refreshes known numeric desktop tags through exact release
lookups, including tags missing from the list, and refuses incomplete public
production inventories. It fetches main-push CI without the inconsistent
server SHA filter, makes at most three list reads, and refreshes the first
exact matching run directly. That record must retain its run ID, main branch,
push event, full-CI workflow path and exact source. A newer failed run never
falls back to an older success. Original identity, version ordering, ancestry,
companion and full-CI gates remain. All 29 selector/train/promotion/policy tests
pass, including missing inventories, malformed lookups and CI negative
controls. A live read-only dry run selects 0.3.4 and verifies 39790212157.
The changed selector receives fresh exact-main CI before publication.

Repair source ecd65fe4 is pushed for full CI 39803878465 and Fast CI
39803878513. Its new exact host capture is byte-identical to Android
071ada49's schema. The pending Stable entry, 15-delivery ledger,
database-history check, web typecheck and 886 web tests (three existing skips)
pass locally. Independent exact-tag downloads of Latest 0.3.2 and 0.3.3
verify both manifest hashes, original-key signed database facts and every
released migration prefix against this source. Product Rust and application
runtime source is unchanged from the qualified Android tag; subsequent
changes are release infrastructure, test-only Vitest dependencies, test
assertions and evidence. Publication still requires green exact-source CI,
fresh dependency review and all signed native package gates.

Full CI [39803878465](https://github.com/kzahel/jstorrent/actions/runs/39803878465)
and Fast CI 39803878513 pass at ecd65fe4. The repaired selector's live dry run
checks exact published records, directly confirms this successful main-push
run and selects 0.3.4. Signed Latest construction is dispatched as
[39811129985](https://github.com/kzahel/jstorrent/actions/runs/39811129985).
Before publication, all five Stable 0.3.1 response bodies still match the
original probes from current version 0.3.0; four automatic targets and manual
Linux ARM remain unchanged. The website provenance still reports 0.3.1.

### Exact native packages and source-only collector recovery

Run 39811129985 passes fresh strict dependency review, source tests and all
five signed native legs at ecd65fe4, including both macOS notarizations,
Windows Authenticode/activation registry and Linux package checks. The collector
stops with a private 16-asset draft because changed Vitest inputs lack reviewed
source pins. It has published nothing. Follow 378's source-only recovery:
reassemble the same-run artifacts, compare all fourteen native/signature assets
against the private draft, and retain the original CI-signed metadata unchanged.
All six payload signatures and signed database/platform facts verify locally.

Add immutable preferred-source pins for the eleven newly changed Vitest, Vite,
Chai and tinyrainbow distributions, retaining package-lock SHA-512 integrity
and original MIT terms. Source verification also catches the October 19 official
AppImage runtime update and two Ubuntu source revisions. Both normalized runtime
prefixes exactly match the upstream release digests; their embedded commit is
fedfad51. Its sole source diff from 8f39b89 maps temporary build paths out of
debug information, with no runtime-code or dependency-version changes. Supply
the new MIT source archive, retaining all original component sources/terms and
relink instructions. Additional runtime bindings require exact source/binary
pins and still exclude only the named 16-byte payload digest. Negative controls
reject unrelated byte changes and mismatched source, size or digest bindings.

Supply exact Ubuntu GLib 2.80.0-6ubuntu3.10 and xz-utils
5.6.1+really5.4.5-1ubuntu0.4 descriptors, every referenced source archive and
their original patches/terms. Primary HTTPS, descriptor identity, SHA-256 and
byte counts verify; retained OpenPGP signatures are not independently verified.
The complete source carrier has 39,249 verified members, 775 locked Cargo
packages and empty-Cargo-home offline metadata checks for both Linux targets.
Its SHA-256 is 2a68d389b8fd7b09452cb379df12263d392d491618cba2a5b119d7ba5675f6f0.
All thirteen source-helper cases pass. Both exact Mac app bundles pass deep
strict code-signature verification and packaged native-host hello; Intel runs
under Rosetta, without launching the product app or touching its profile.
No physical Intel or new installed-update cohort is claimed. Publication still
requires the ordinary complete-draft/hash checks and final public verification.
