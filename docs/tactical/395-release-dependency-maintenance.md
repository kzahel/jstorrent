# 395 — Release dependency maintenance

Status: local implementation and validation complete; hosted CI pending.
Maintainer authorized 2026-11-16.

## Scope and decisions

Repair the blocked advisory and compatibility lanes. Upgrade quinn-proto to
its patched 0.11 line and rusqlite to 0.41 with patched bundled SQLite.
Retain durable database schemas, released fixtures, authentication protocol,
Android behavior and the 30-day client/host support window.

Separate maintenance-warning reviews (maximum 90 days) from vulnerability
exceptions (maximum 30 days). Keep the single, exact OPAQUE bigint exception;
do not add a SQLite exception. Bind its approval to the crypto sources,
evidence, selected backend features and dependency identities/checksums,
rather than unrelated lockfile bytes. Collect fresh audits for every check;
new findings, changed backend reachability and stale evidence still fail.

Retire unsupported known breaks and the obsolete Download all fallback.
Retry transient HTTP failures at most three times with bounded backoff;
retain pinned length/hash verification and delete partial downloads.

## Evidence and invariants

RustSec RUSTSEC-2026-0459 describes crafted database/WAL pairs leaking
uninitialized memory; libsqlite3-sys >=0.39 is patched. Upstream rusqlite
v0.41.0 changes statement column accessors to iterators and some callback
bounds. Study those changes against first-party uses; no upstream source or
fixtures are imported. RustSec RUSTSEC-2026-0523 and -0524 identify the
patched Quinn version. This work changes dependency selection, not engine
protocol/policy or storage schema, so no new engine owner/task is added.
The existing source trace in evidence/381-opaque-bigint-reachability.md owns
the OPAQUE exception; reassess its graph after updates before approval.

## Validation and stopping condition

Run review-guard and retry fault tests, exact-lock fresh Cargo/npm audits,
notice validation, Rust formatting/Clippy/workspace tests, released-store
fixtures, web typecheck/unit tests and compatibility checks. Build the Android
boundary; hosted CI supplies platform builds and remaining qualification.
Stop with committed changes and green exact-source checks, or report a
specific unresolved blocker. Publishing a release is outside this pass.

## Implemented and verified locally

- Workspace selects rusqlite 0.41.1 / libsqlite3-sys 0.39.1 (SQLite 3.54.1),
  quinn-proto 0.11.19, quinn-udp 0.5.16 and rustix 1.1.6. The standalone
  iOS probe receives the applicable Quinn/rustix fixes too. Preserve unrelated
  lock resolutions; updated crates may select existing Windows bindings.
- Source advisories: [SQLite](https://rustsec.org/advisories/RUSTSEC-2026-0459),
  [Quinn Retry](https://rustsec.org/advisories/RUSTSEC-2026-0524.html),
  [Quinn stream limits](https://rustsec.org/advisories/RUSTSEC-2026-0523.html),
  [Quinn UDP](https://rustsec.org/advisories/RUSTSEC-2026-0538.html) and
  [rustix](https://rustsec.org/advisories/RUSTSEC-2026-0486.html).
  No second vulnerability exception is introduced.
- Website Astro 7.4.12 and fast-xml-parser 5.12.0 remove the remaining npm
  findings. Reviewed primary advisories GHSA-mh32-jxcr-mh9f,
  GHSA-r3h5-4585-7x3w and GHSA-474x-hrwr-fgx4. No website is deployed.
- The [strict review receipt](evidence/395-dependency-review.json) records one
  exact, reviewed crypto-bigint finding and zero unexcepted vulnerabilities;
  the web, website and iOS probe audits are clean. Warning inventory is
  unchanged. The source/graph reassessment is appended to the original
  [reachability evidence](evidence/381-opaque-bigint-reachability.md).
- Formatting and warning-denying workspace Clippy pass. All 1,791 workspace
  tests pass (20 existing ignores), including populated released-store
  fixtures and migration/backup behavior. Both Android release library ABIs
  build. The iOS probe's four host tests and simulator compile check pass.
- Web typecheck/unit/build and website tests/check/build pass; website check
  reports zero errors/warnings. Five-target notices cover 659 Rust and 35 npm
  packages. Review-guard, native-download and compatibility-ledger tests pass.
  Real downloads verify all seven pinned source files and remove temporary
  data. Full native packaging and hosted exact-source CI remain separate.

Retirement checks now distinguish host and client roles for a shared source
commit; a surviving desktop-host capture cannot keep a retired extension
client's known break alive. No historical capture or delivery record is
removed. Download-all and strict-client cleanup follow the unchanged window.

## Delivery checkpoint

The original checkout contains unrelated Tactical 394 edits and an unpushed
remote browser-recovery commit. Keep those changes out of this maintenance
delivery. A detached integration checkout based on current upstream main
preserves its website/probe security fixes; the reviewed Astro 7.4.12 update
supersedes upstream 7.4.7. Validate this exact integrated source before push.
Publishing Latest or Stable is outside the authorized maintenance pass.

The first hosted run exposed a backport-test policy fixture missing its review
start date and an orphaned Download all waiting message after fallback removal.
The follow-up updates the fixture and removes that retired message from all
source catalogs, translation-review ledgers and generated catalogs. Localization
validation and the full backport guard suite join the recorded local checks.
