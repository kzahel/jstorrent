# Tactical 380: Desktop, Extension and Android Release

Status: Preparing, 2026-10-20. Publication requested by the maintainer.

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
listing, remote-controller or website changes. No unrelated store drafts.

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
host/JNI generation, JVM tests, lint, APK packaging and notice inspection,
using the existing isolated org.jstorrent.setup320 QA identity. No production
app or durable library is installed over or modified by this build.

Fresh local pinned Cargo and web/website npm reports pass
`review-dependency-audit.py --require-release-ready`; all 30 distribution
review unit tests pass. Hosted audit's initial warning-inventory failure is
retained above rather than represented as a successful hosted run.
