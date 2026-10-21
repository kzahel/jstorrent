# Tactical 380: Product Releases

Status: Extension 1.1.6 submitted, 2026-10-20. Desktop Stable and Android
await explicit companion-policy and testbed-access decisions. Remote controller
0.3.3 is authorized for independent publication, 2026-10-21.

Topics: `beta-release-readiness`, `mixed-version-compatibility`.

## Scope and stopping condition

Publish production JSTorrent desktop, extension 1.1.6 and Android
1.0.32/code 32 from qualified source. Desktop Stable is 0.3.1; public
Latest 0.3.3 exists at fe4be51c. Prefer immutable promotion after its
compatibility and installed-evidence requirements pass. Store submission
with automatic publication after review is the store stopping condition;
record pending review separately from public availability.

Preserve existing identities, signing roots, durable data, production
countries and rollout settings. No engine, schema, permissions, dependency,
listing or marketing-site changes. The hosted remote controller is added to
scope by subsequent maintainer direction; its independent release does not
authorize the held host releases. No unrelated store drafts.

## Policy checkpoint

Extension 1.1.5 is live since October 15. Strict extension 1.1.4 and older
remain inside the 30-day support window. Existing Latest authorization
covers eight reviewed fields only; it does not authorize Stable or Android.
An explicit maintainer decision is pending before either host publication.
Extension preparation and validation can proceed independently.

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
