# OPAQUE bigint reachability investigation

Date: 2026-10-24. Source: `d789600fdeedd5b92d78f50bc8c58ba2015a5dd4`.
Cargo.lock SHA-256:
`5e8660fa32e45fdd19246698494c193d89248e0ed9f94f314fd1fbb4c42a9298`.

## Finding and boundary

The selected OPAQUE password-registration/login and TripleDh source paths do
not call crypto-bigint 0.5.5 arithmetic. They select curve25519-dalek 4.1.3
for Ristretto points and scalars. The runtime helper borrowed from
elliptic-curve 0.13.8 expands bytes with SHA-512 and does not call bigint.
This is a source-level reachability conclusion for the exact suite and
dependency graph below, not a formal compiled-code constant-time proof.

RUSTSEC-2026-0387 remains a valid package finding. No claim is made that the
entire old bigint version is unaffected. The audit gate, dependencies,
credentials, protocol and application source are unchanged. This bounded
investigation ends with the source trace, feature checks and functional
validation; it does not port dependencies, develop an exploit, assess every
CPU/compiler, or authorize an advisory exception.

## Selected graph and dispatch

Both native remote-crypto and wasm32 remote-wasm resolve:

```text
opaque-ke 4.0.1 ──────────────────────┐
    └── voprf 0.5.0 ─────────────────┼── elliptic-curve 0.13.8
                                     │       └── crypto-bigint 0.5.5
    Ristretto implementations ── curve25519-dalek 4.1.3
```

The native, Wasm and all-target/all-feature workspace feature trees enable
only OPAQUE's `ristretto255` feature. VOPRF enables `ristretto255`,
`ristretto255-ciphersuite` and the OPAQUE-required `danger` interface feature.
OPAQUE's optional ECDSA feature is not enabled, and the suite does not choose
Sigma-I. Its generic elliptic
curve group implementation is compiled as generic support but is not the
selected Ristretto implementation. There is no runtime suite negotiation:
all first-party registration/login entrypoints use the private `Suite` in
`crates/rstorrent-remote-crypto/src/opaque.rs`, whose OPRF is `Ristretto255`
and key exchange is `TripleDh<Ristretto255, Sha512>`.

The reverse dependency tree contains no other route to the old bigint.
P-256 resume now uses elliptic-curve 0.14.1 / crypto-bigint 0.7.6. This
investigation does not independently reassess that newer implementation.

## Source call trace

Paths below are relative to each named published crate's source root.

- **OPAQUE dispatch:** opaque-ke `src/ciphersuite.rs`, `src/opaque.rs`,
  `src/key_exchange/tripledh.rs`, `src/key_exchange/shared.rs` and
  `src/keypair.rs` retain the suite's group parameter through key generation,
  serialization and each `ke_diffie_hellman` call. `PrivateKey<G>` delegates
  to `G::Sk::diffie_hellman`; it does not substitute an elliptic-curve key.
- **OPAQUE key exchange:** opaque-ke
  `src/key_exchange/group/ristretto255.rs` implements `Group` with Dalek
  `RistrettoPoint` and `Scalar` wrappers. Key generation, canonical decoding,
  point compression, identity/zero rejection, public-key multiplication and
  DH multiplication all use Dalek. Scalar derivation delegates to
  `voprf::derive_key::<Self>`; its VOPRF implementation delegates to the
  explicit VOPRF Ristretto group, not the generic RustCrypto curve backend.
- **Password OPRF:** voprf `src/oprf.rs` and `src/common.rs` call the suite's
  group methods for blinding, evaluation, scalar derivation and unblinding.
  `src/group/ristretto.rs` explicitly selects Dalek `RistrettoPoint` and
  `Scalar`; inversion uses Dalek `Scalar::invert`, reduction uses
  `Scalar::from_bytes_mod_order_wide`, and point mapping uses
  `RistrettoPoint::from_uniform_bytes`.
- **Borrowed XMD helper:** that Ristretto implementation calls
  `ExpandMsgXmd::<Sha512>::expand_message(..., 64).fill_bytes(...)`.
  elliptic-curve's `src/hash2curve/hash2field/expand_msg/xmd.rs` and
  `src/hash2curve/hash2field/expand_msg.rs` implement this entire helper
  chain: domain-tag handling, SHA digest updates, fixed byte arrays, XOR,
  copying and length/index arithmetic. Neither imports nor calls bigint.
  The ordinary integer division used to compute output-block count acts on
  the fixed output length and digest size, not secret bigint values.
- **Other backends:** voprf `src/ciphersuite.rs` and
  `src/group/elliptic_curve.rs`, and opaque-ke
  `src/key_exchange/group/elliptic_curve.rs`, provide separate generic
  RustCrypto curve implementations. The explicit Ristretto implementations
  above determine this suite's dispatch. The unconditional elliptic-curve
  dependencies in both Cargo manifests keep the old bigint in the package
  inventory even though this suite does not select their curve arithmetic.
  Dalek's manifest/source have no elliptic-curve or crypto-bigint dependency.

These paths contain no call into the advisory's old-bigint subtraction,
zero-counting, division, Montgomery multiplication, equality or inversion
operations. This conclusion comes from following selected types and helper
bodies, not from absence of a name in a binary or from a passing login test.

## Integrity and verification

The 17 named crate files above (including the two OPAQUE/VOPRF manifests
and Dalek manifest) were compared byte-for-byte with their cached registry
archives. Each archive's SHA-256 matches its Cargo.lock checksum. No upstream
implementation, test fixture or archive was copied into this repository.

Commands ran after sourcing `scripts/dev-env.sh`:

- `cargo tree --locked -p rstorrent-remote-crypto -i crypto-bigint@0.5.5`
- `cargo tree --locked -p rstorrent-remote-wasm --target wasm32-unknown-unknown -i crypto-bigint@0.5.5`
- The corresponding `-e features -i opaque-ke` trees for both packages,
  and native `-e features -i voprf`.
- `cargo tree --locked --workspace --all-features --target all -e normal,build -i crypto-bigint@0.5.5`
- `cargo tree --locked --workspace --all-features --target all -e features -i opaque-ke`
- `cargo test --locked -p rstorrent-remote-crypto`: 26 unit tests plus one
  architecture test passed; no failures or ignored tests. Covers exact
  persisted authority/password records, registration/login, wrong-password
  rejection, pinning, resume, authenticated records and deterministic messages.
- `cargo check --locked -p rstorrent-remote-wasm --target wasm32-unknown-unknown`:
  passed. This is a Wasm compile check, not a new browser execution test.
- `cargo audit --no-fetch --json`: exit 1, exactly one vulnerability,
  crypto-bigint 0.5.5 / RUSTSEC-2026-0387, using the existing local database.

Functional tests corroborate that the selected configuration still works;
they do not establish absence of timing leaks. No binary call-graph analysis,
BINSEC/checkct run or independent side-channel audit was performed. Revisit
this conclusion if the suite, backend features, source or lockfile changes.
The [upstream security fixes](https://github.com/RustCrypto/crypto-bigint/pull/1365)
and local RustSec advisory remain the basis for the package-level gate.

The next remediation should target removal of this unused old arithmetic
dependency upstream, or a separately scoped and reviewed dependency patch.
A whole password-protocol migration is not justified by this reachability
finding. Until actual remediation or an explicitly approved exception, strict
dependency review remains blocked.

## October 26 patch re-review

The workspace's separate crypto-bigint 0.7 line moves from yanked 0.7.6
to 0.7.10, with ctutils 0.4.5 to its required 0.4.6. The manifest pin and
lockfile are the only implementation inputs changed by this repair.
Comparing all-target/all-feature Cargo metadata before and after the update
shows identical package identities, enabled features, dependencies and
dependents for all five reviewed backends: crypto-bigint 0.5.5,
elliptic-curve 0.13.8, opaque-ke 4.0.1, voprf 0.5.0 and
curve25519-dalek 4.1.3. The remote-crypto source and selected Suite remain
unchanged. The prior source trace therefore still applies to the old bigint
finding; P-256 and MSE use the independent updated 0.7 line.

Rebind the existing exception to these reviewed inputs without changing its
advisory, package identity, scope or November 12 expiry. This is continued
source-level reachability evidence, not a new timing proof or an additional
exception. The tactical records functional and platform validation separately.

## October 29 ZIP patch re-review

The torrent-list dependency moves from ZIP 9.0.4 to the upstream-designated
patched 9.0.5 for GHSA-m665-v7pm-7grj. Its existing `deflate-flate2` feature
selection and dependency list are unchanged. The host also explicitly validates
local/central-header consistency before reading bundle contents, after the
existing archive/entry bounds; no ZIP filesystem extraction is introduced.

Comparing fresh all-target/all-feature audit contexts before and after this
patch shows identical identities, features, dependencies and dependents for
all five reviewed bigint/OPAQUE/Dalek backends. Every remote-crypto source
hash and the selected Suite are unchanged. Before this evidence update, only
Cargo.lock and the session manifest hashes differ from the prior verified
context. This preserves the earlier selected-source reachability conclusion;
it adds no compiled-code timing proof or new accepted finding.

Rebind the existing exception to the explicitly reviewed lockfile, manifest
and this evidence update. Preserve its original authorization date and
November 12 expiry. Tactical 389 owns ZIP regression and host/platform checks.
