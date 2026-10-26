# Tactical 381: Dependency Cleanup And Fresh Security Findings

Status: In progress, 2026-10-24.

Topic: `beta-release-readiness`.

## Scope and stopping condition

Finish Dependabot PRs 15 and 16, retire completed reviewer fixture PR 25,
publish the existing ctutils repair, and add an earlier notice check. Verify
the merged source with full hosted CI, Fast CI and fresh dependency review.
New advisory findings discovered by those checks must remain visible until
remediated. No release publication, advisory waiver, authentication-format
change, durable-data change or broad dependency refresh is authorized here.

The refreshed audit at RustSec revision
`1645308cb4766561b0b274d8c93f7033a766fc96` reports RUSTSEC-2026-0387 in
crypto-bigint 0.7.5 and 0.5.5, plus npm findings in fast-uri, undici and zod.
The previous ctutils repair does not resolve these newer findings.

On October 24 the maintainer selected trying the newer crypto dependency
generation instead of starting with a maintained backport. Evaluate current
released P-256 and WebRTC together, then trace any remaining old arithmetic
through OPAQUE/VOPRF. Preserve persisted credentials, P-256 identities, exact
OPAQUE/resume/record encodings and old/new native/browser interoperability.
No advisory exception, authentication reset or silent protocol migration is
permitted. An upstream version number alone is not evidence of compatibility.

After the bounded reachability investigation, the maintainer authorized an
exception on October 24. This supersedes the earlier no-exception boundary
only for crypto-bigint 0.5.5 / RUSTSEC-2026-0387 in the reviewed Ristretto
configuration. Implement an exact registry-identity exception expiring on
November 12, bound to the investigation, lockfile, workspace manifests,
remote-crypto source and resolved backend features/dependents. Fail closed
on expiry, changed inputs, added findings or a stale exception after removal
of the finding. Preserve raw audit findings and report the exception openly;
do not pass an ignore flag to cargo-audit. All npm/probe, database freshness,
warning/backport and release-blocker checks remain enforced. Validate both
the permitted case and rejection cases, then run fresh strict audit review.

## Source study and implementation direction

- RustSec `crates/crypto-bigint/RUSTSEC-2026-0387.md` and
  [upstream release PR 1365](https://github.com/RustCrypto/crypto-bigint/pull/1365)
  identify constant-time arithmetic fixes in 0.7.6 and upstream BINSEC/checkct
  coverage. Update the direct 0.7.5 pin used by
  `crates/rstorrent-protocol/src/mse.rs` in both workspace and probe graphs.
  Retain the existing DH modulus, byte encoding, peer validation and handshake
  behavior; use the existing MSE vectors and interoperability checks.
- Reference study: `reference/bittorrent.org/beps/bep_0008.html` links
  encrypted-peer discovery to MSE; `reference/libtorrent/src/pe_crypto.cpp`
  (`dh_key_exchange::compute_secret`, fixed-width key export) and
  `reference/libtorrent/test/test_pe_crypto.cpp` (`diffie_hellman`,
  `diffie_hellman_degenerate_key`) require equal shared secrets, rejection of
  0/1/p-1/p and acceptance of boundary keys 2/p-2. Preserve the existing
  independently authored JSTorrent tests for those cases and 96-byte leading
  zero preservation. No encryption policy or reference source is imported.
- The all-target reverse tree retains crypto-bigint 0.5.5 through
  elliptic-curve 0.13.8, P-256/P-384, OPAQUE and the pinned WebRTC stack.
  There is no published crypto-bigint 0.5.6 or elliptic-curve 0.13.9. The
  advisory lists only >=0.7.6 as patched. A maintained backport or a coordinated
  crypto-stack migration needs its own explicit direction; do not suppress
  this finding or silently replace authentication primitives to get green.
  Direction has now been given for the upgrade experiment above. The original
  P-256 0.13.2 pin was deliberate: Tactical 192 reused OPAQUE's already-resolved
  elliptic-curve 0.13 graph to avoid a parallel 0.14 generation. P-256 0.14.0
  had already been published on July 3, before the August 29 pin. The old
  crypto-bigint 0.5.5 was indirect, not a separately selected arithmetic API.
- npm advisory reports identify fast-uri >=3.1.9, undici >=7.30.1 or
  >=8.12.2 on their existing major lines, and zod >=4.6.6 as patched.
  Update only affected dependency resolutions and inspect the resulting diff.
  Primary advisory locators include fast-uri
  [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg),
  [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h),
  [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr),
  [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp);
  undici [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685),
  [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472),
  [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c);
  and zod [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
- The fresh warning inventory also reports RUSTSEC-2026-0386 for Tokio
  1.53.1. Its upstream-compatible 1.53.3 patch repairs the AsyncFd I/O-safety
  constructors. Update both lockfiles instead of adding a warning exception.
  See [upstream PR 8587](https://github.com/tokio-rs/tokio/pull/8587).
- The RTC macro archive comparison and unchanged MIT/Apache texts are
  recorded in `distribution/licenses/README.md` on PR 15. No implementation
  source is copied. Zustand's patch is limited to the manifest and lockfile.

## Invariants, owners and resource limits

Existing application, peer, crypto and transport owners remain unchanged; no
runtime task, cancellation path, protocol value or platform boundary is added.
Keep authentication identities, stored records, wire encodings and the
30-day client/host compatibility contract. Preserve the verified GLib backport,
exact warning inventory and November 12 warning-review expiry.

The new selected Fast CI notice job calls the existing generator over all
five desktop targets and web dependencies. Existing source/manifest hashes,
512-KiB per-text and 100-file limits remain. The 20-minute CI job writes no
package bundle; exact-target package generation and inspection remain required.

## Validation and evidence

Require zero unreviewed vulnerabilities in Cargo and zero vulnerabilities in
both npm reports and the standalone iOS probe. Only the later authorized,
exact, evidence-bound bigint exception below may pass with a finding.
Run targeted MSE and remote crypto tests, Rust formatting/Clippy/workspace tests,
web type/unit/build/E2E checks, website tests/build, all-target notice checking
and the existing distribution/backport guards. Full hosted CI supplies Android
dual-ABI build/lint/tests, iOS checks and all desktop builds.

Completed before the new advisory findings: reviewer PR 25 closed with linked
review/inline evidence retained in its topic; the all-target notice check
covers 653 Rust and 35 npm packages; 13 workflow/review, 36 distribution and
10 Android-notice tests pass. The responsive chart test retains its exact
geometry invariant after waiting for initial ResizeObserver sizing; five
focused browser repetitions, web typecheck and 887 unit tests pass.

Stop only with verified green merged-source checks, or a concrete unresolved
cryptographic dependency decision. Never represent a known vulnerable graph
as release-ready.

## Compatible repair checkpoint

The compatible updates pass workspace formatting, warning-denying Clippy,
all 1,749 workspace tests (20 existing ignores), 887 web unit tests (three
existing skips), web typecheck/build/CSP, all 72 deterministic browser checks
(19 existing live-scenario skips), 93 website tests and website build/route
policies. The all-target notice check covers 653 Rust and 35 npm packages.
Both Android release ABIs compile. The iOS storage probe compiles for the
simulator and passes all four host tests. The controlled libtorrent MSE
matrix passes after prebuilding its binaries; the first attempt exhausted
its compilation timeout while concurrent Cargo builds held the build cache.
No interoperability timeout or assertion was relaxed.

Tokio's update also re-resolves some existing Windows-only dependency edges
to already-locked windows-sys versions; no additional Windows crate versions
are introduced. Full hosted Windows qualification remains required.

Fresh strict release review now fails on exactly one workspace finding:
crypto-bigint 0.5.5 / RUSTSEC-2026-0387. The probe and both npm reports have
zero findings; warning inventory and expiry are unchanged. The
[bounded receipt](evidence/381-dependency-cleanup.json) binds these results to
the exact lockfile hashes. This checkpoint preceded the maintainer's choice
to try upgrading the crypto generation. The upgrade checkpoint below
supersedes its dependency-path diagnosis; the strict gate remains enforced.

## Released dependency upgrade

The maintainer selected the upgrade attempt. P-256 0.14.0 and RTC 0.21.1 now
replace the older direct pins. The latter's ring feature is named
`crypto-ring`; its public APIs now take explicit monotonic instants and use
tagged inbound/STUN messages. Preserve query-only mDNS and its timeout, the
512-KiB SCTP receive budget, direct-only ICE, no TURN, existing transfer
budgets and cancellation ownership. Unknown future candidate classes remain
unreported rather than being misclassified as host/reflexive candidates.
No first-party protocol format or serialized field changes.

P-256's new rand_core API is bridged to the existing ChaCha/OS entropy
sources. The small adapter delegates bytes/words, preserves failure behavior,
and grants the new cryptographic marker only to sources with the old marker.
OPAQUE retains its existing entropy API. Tests compare mixed RNG requests and
the exact old library's public key and deterministic signature for a synthetic
scalar/message. The fixture is first-party data generated with published
p256 0.13.2/ECDSA 0.16.9; no upstream implementation or vector is copied.

The newer RTC graph removes P-256/P-384 0.13 and the interceptor derive crate.
Fifteen omitted archive license files have exact manifest/VCS/registry-checksum
proof at `2a732df55ca4bcf26b80914fa0f570cfaf74cfcb`, using byte-identical
existing MIT/Apache texts. The all-target notice check now covers 659 Rust
and 35 npm packages.

The old bigint reverse tree is now only elliptic-curve 0.13.8 through
opaque-ke 4.0.1 and voprf 0.5.0. Checked crates.io releases and current upstream
Cargo manifests: opaque-ke 4.1.0-pre.2 and voprf 0.6.0-pre.1 still use the
0.13 graph. Switching to those prereleases does not remove the finding.
No local dependency fork, alternate password protocol, credential reset or
advisory waiver has been introduced.

Targeted warning-denying Clippy and 100 remote/direct-file tests pass (one
existing ignore); the additional old-key/signature fixture passes separately.
The real-browser remote-product verifier passes password login, private
resume, restart, revocation, exact 1-MiB file saving and its existing cleanup,
authority and resource assertions. A temporary mixed-core harness built the
pre-upgrade core at 36fccff9 (whose source is byte-identical to Stable 0.3.4 at
ecd65fe4) alongside the candidate. Old-client/new-host and new-client/old-host
OPAQUE logins import old authority/password records; both P-256 resume
directions verify mutual proofs and exchange encrypted application records.
All four cases pass. This is source-core interoperability, not an installed
old/new release-artifact matrix.

Workspace formatting, warning-denying Clippy and all 1,751 tests pass (20
existing ignores). The upgraded P-256/RTC crates remain absent from Android's
default dependency tree. The exact graph, historical pin reason, compatibility
results and unresolved upstream dependency are recorded in the
[upgrade receipt](evidence/381-crypto-upgrade.json). Full hosted qualification
of the committed source remains separate from these local checks.

## Bounded OPAQUE reachability investigation

The maintainer authorized a read-only source/feature investigation of the
remaining advisory. The [reachability report](evidence/381-opaque-bigint-reachability.md)
records the exact source/lockfile, inspected published crate paths, archive
integrity and limits. Native, Wasm and all-target/all-feature workspace graphs
select the same Ristretto suite. Both the password OPRF and TripleDh use
Dalek arithmetic; the borrowed elliptic-curve XMD helper performs SHA-512
byte expansion without bigint calls. No source call path to crypto-bigint
0.5.5's affected operations was found in that selected flow.

All 27 remote-crypto tests and the wasm32 remote-wasm compile check pass.
An audit using the existing local database still reports exactly the one old
bigint finding. This is bounded source-level evidence, not a compiled-target
constant-time proof or advisory exemption. No dependency, authentication,
release or audit-policy change follows from it. Stop this investigation here;
dependency removal/patching or an explicit policy decision is separate work.

## Authorized temporary vulnerability exception

The maintainer then authorized finding an exception. The policy now records
the exact advisory, package/version, registry source and checksum, reason,
investigation and November 12 expiry. Its SHA-256 context binds 29 files:
the Rust lockfile, root/workspace manifests, all remote-crypto Rust source
and the investigation. It also binds the five backend packages' resolved
all-target/all-feature features, dependencies and dependents. Portable
package identities exclude machine paths. Review independently checks current
file bytes against the collected context; added crypto source also fails.

Raw cargo-audit collection is unchanged: no ignored advisory, removed
finding or altered registry identity. Successful review receipts retain
`cargo_vulnerabilities: 1`, `unexcepted_cargo_vulnerabilities: 0` and the full
exception. Reject missing/changed/extra findings, duplicate/stale exceptions,
missing evidence or rationale, changed context, future/expired or over-30-day
review windows, and exceptions beyond the existing warning-review expiry.
Other warning/backport, freshness, release-blocker, npm and probe gates remain
in force. Removing the upstream dependency or a reviewed patch remains the
remediation; do not automatically renew the approval fingerprint.

All 47 distribution-review tests (including eleven new exception guard tests),
ten GLib backport tests, workflow actionlint and diff whitespace checks pass.
Fresh Cargo/probe and both npm audit collection at RustSec revision
`21d909e4c8bd4e14c7aea58bf980c881a0053ab1` passes strict
`--require-release-ready` review with exactly one reviewed vulnerability
exception, zero unexcepted findings, zero probe/npm findings, and unchanged
warning/backport reviews. The [local receipt](evidence/381-opaque-exception.json)
records the working-tree qualification; hosted qualification is separate.

Release source checks collect/review the committed inputs before the existing
generated package-identity step. That step rewrites manifests/lockfile and
would otherwise invalidate the source fingerprint even for a pure version
stamp. A workflow-order regression keeps this boundary explicit; no release
is published to validate it.

GitHub then surfaced Undici alert 23 in the separately deployed link service's
tooling lockfile. Its pinned Miniflare requires exactly Undici 7.29.1; even
the latest published Miniflare 5.20261019.2-beta still has that pin. Keep the
qualified Wrangler version and override only Miniflare's Undici to 7.30.1,
the same patched major line already qualified for the web tooling. The lock
diff changes only that package's version, URL and integrity. No npm exception
or service protocol change is needed. Link typechecks, all 11 tests, build
and fresh npm audit pass with zero vulnerabilities.
Wrangler's actual deployment dry run also passes without uploading anything.

## October 26 yanked bigint repair

Desktop Latest run 40296807949 and daily advisory run 40314673688 both stop
on the standalone iOS probe's yanked crypto-bigint 0.7.6 warning. The main
workspace contains the same yanked version. Upstream's
[changelog](https://github.com/RustCrypto/crypto-bigint/blob/v0.7.10/CHANGELOG.md)
and [PR 1373](https://github.com/RustCrypto/crypto-bigint/pull/1373) explain
the yank: the blanket NonZero multiplication implementation incorrectly
accepted modular values, whose nonzero product can be zero. Version 0.7.9
restricts that implementation; 0.7.10 additionally repairs Montgomery carry
propagation and uses internal constant-time primitives. Pin 0.7.10 in the
workspace and update both lockfiles, including its required ctutils 0.4.6.
No first-party protocol, authentication format, task owner or resource bound
changes. The probe resolver also moves existing Windows-only dependency edges
from already-locked windows-sys 0.52 to 0.61; it adds no package versions.

Reference paths rechecked: `reference/bittorrent.org/beps/bep_0008.html`,
libtorrent `src/pe_crypto.cpp` (`compute_secret`) and
`test/test_pe_crypto.cpp` (`diffie_hellman`,
`diffie_hellman_degenerate_key`). Preserve equal shared secrets, rejection of
0/1/p-1/p, acceptance of 2/p-2 and exact 96-byte exports. Existing JSTorrent
MSE vectors and controlled libtorrent tests exercise these cases; no source
or fixtures are imported and no deliberate behavior difference is introduced.

The existing OPAQUE exception is re-reviewed against unchanged old-backend
metadata and source, then rebound to the changed manifest, lockfile and
investigation. Its identity, reason and November 12 expiry remain unchanged.
The audit gate is not relaxed. Failed receipts now retain at most 20 sanitized
warning identities for each Cargo graph, including yanked warnings whose
advisory is null. A regression verifies truncation, sanitization and exclusion
of raw report text, so future warnings identify their package in CI artifacts.

Validation commands for this repair (toolchain commands source
`scripts/dev-env.sh` first; `audit_dir` names the temporary report directory):

```bash
python3 -m unittest discover -s scripts -p test_distribution_review.py
python3 -m unittest discover -s scripts -p test_glib_backport.py
cargo fmt --all -- --check
cargo fmt --manifest-path experiments/ios-storage-probe/Cargo.toml -- --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
cargo check --locked --manifest-path experiments/ios-storage-probe/Cargo.toml \
  --target aarch64-apple-ios-sim
cargo test --locked --manifest-path experiments/ios-storage-probe/Cargo.toml
cargo ndk -t x86_64 -t arm64-v8a -P 28 build --locked --release \
  -p rstorrent-android --lib
cargo check --locked -p rstorrent-remote-wasm --target wasm32-unknown-unknown
npm ci --prefix clients/web
python3 scripts/prepare-release-notices.py --check
cargo build --locked -p rstorrent-engine --bin rstorrent-download-piece \
  -p rstorrent-session --bin rstorrent-incoming-seed
uv run --project tests/interop --locked python tests/interop/mse_peer_encryption.py
python3 scripts/audit-cargo-dependencies.py --output "$audit_dir/cargo-audit.json"
npm audit --prefix clients/web --json > "$audit_dir/npm-audit.json"
npm audit --prefix website --json > "$audit_dir/website-npm-audit.json"
python3 scripts/review-dependency-audit.py --cargo "$audit_dir/cargo-audit.json" \
  --npm "$audit_dir/npm-audit.json" --website-npm "$audit_dir/website-npm-audit.json" \
  --output "$audit_dir/review.json" --require-release-ready
```

The distribution review suite passes 48 tests and the backport suite passes
ten. Both formatting checks, workspace Clippy, the locked iOS simulator
compile and all four probe host tests pass. Android release libraries compile
for both ABIs. Notice validation passes for 659 Rust and 35 npm dependencies
across five desktop targets after refreshing the stale local npm installation.
Fresh strict dependency review passes at RustSec
`115e418ee9a2ff542fee41db641128fa84483383`: zero probe vulnerabilities or
warnings, zero npm vulnerabilities, and exactly the existing reviewed workspace
exception with no unexcepted vulnerabilities. Its expiry is unchanged.
All 1,764 workspace tests in 73 suites pass, with 20 existing ignores. The
Wasm authentication compile check and all 29 controlled libtorrent MSE cases
pass. An early matrix invocation was cancelled while waiting for the Cargo
build lock, before scenarios ran; the completed run followed the explicit
binary prebuild. Full hosted CI has not been rerun. No release is published
by this repair.
