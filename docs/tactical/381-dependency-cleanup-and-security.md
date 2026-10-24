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

Require zero fresh vulnerabilities in both Cargo and both npm reports.
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
the exact lockfile hashes. The backport-versus-migration decision is pending;
PRs 15 and 16 remain unmerged until that blocker and their checks are clear.
