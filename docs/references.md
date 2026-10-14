# Reference Implementations And Provenance

RSTorrent is independently implemented, but it uses specifications and other
clients as sources of behavioral evidence.

## Reference Policy

References may be used to:

- understand public protocol behavior and interoperability expectations;
- identify useful failure cases and adversarial scenarios;
- design independently authored tests and deterministic fixtures;
- compare wire output, state transitions, performance, and resource behavior;
  and
- study architectural tradeoffs without inheriting them automatically.

Before copying source, fixtures, or test data:

1. Identify the precise origin and applicable license.
2. Decide whether reuse is necessary instead of writing an independent test.
3. Record the provenance and any attribution obligations near the imported
   material.
4. Keep the imported surface bounded and reviewable.

Do not copy code between implementations merely because both are open source.
Reading an implementation does not make its internal API or architecture an
RSTorrent requirement.

For every engine, protocol, discovery, scheduling, storage, or performance
feature, the tactical must inspect the exact pinned libtorrent source **and its
tests** before the design is finalized. Libtorrent is the required feature-
completeness and edge-case oracle: record the exact paths, functions or test
cases studied, the resulting edge-case checklist, behavior RSTorrent adopts,
and intentional differences. This requirement does not authorize copying
source or silently adopting libtorrent's architecture.

## Local Reference Set

RSTorrent keeps reproducible external source checkouts under the gitignored
`reference/` directory and continues to use JSTorrent as a first-party sibling.
The tracked [`reference/pins.toml`](../reference/pins.toml) records exact
external revisions and the sibling branch; the
[`reference map`](../reference/README.md) records why each source exists,
license expectations, and useful distinctions between source-reading and
executable-oracle roles.

Use:

```bash
python3 scripts/references.py sync
python3 scripts/references.py status
```

The sync command refuses to overwrite local changes or divergent repositories.
External checkouts stay at detached exact revisions. The JSTorrent sibling may
fast-forward only when it is clean, on `main`, and its fetched `origin/main`
descends from the locally checked-out commit.

## Protocol Specifications

The [BitTorrent Enhancement Proposal index](https://www.bittorrent.org/beps/bep_0000.html)
is the normative starting point for protocol capabilities. Each implemented
extension should identify its BEP, accepted behavior, deliberate limitations,
and interoperability evidence.

The authoritative sources are available offline after reference sync at:

```text
reference/bittorrent.org/beps/
```

This managed checkout is pinned to the exact upstream revision in
`reference/pins.toml`. Prefer it to JSTorrent's Markdown conversion, which was
generated from a May 2020 snapshot. The original reStructuredText retains
document metadata, history, and each BEP's copyright section.

Where deployed clients disagree with a specification, record the observed
compatibility behavior rather than silently replacing the documented contract.

## Direct Remote Transport References

The
[`direct remote file streaming topic`](topics/direct-remote-file-streaming.md)
uses the following primary protocol and browser sources:

- [RFC 8831](https://www.rfc-editor.org/rfc/rfc8831.html) defines WebRTC
  DataChannels as SCTP over DTLS over ICE/UDP, including reliable and partially
  reliable delivery, congestion control, multiplexing, and file transfer;
- [RFC 8445](https://www.rfc-editor.org/rfc/rfc8445.html) defines ICE host,
  server-reflexive, peer-reflexive, and relayed candidates plus connectivity
  checks and candidate lifecycle;
- [RFC 8489](https://www.rfc-editor.org/rfc/rfc8489.html) defines STUN binding,
  transaction, retransmission, response-validation, and security behavior;
- the [W3C WebRTC Recommendation](https://www.w3.org/TR/webrtc/) defines the
  browser `RTCPeerConnection` and `RTCDataChannel` APIs;
- the [W3C WebTransport specification](https://www.w3.org/TR/webtransport/)
  defines the alternative browser stream/datagram and certificate-hash API;
  and
- the [W3C Service Workers specification](https://www.w3.org/TR/service-workers/)
  defines intercepted fetch and synthetic response behavior relevant to a
  possible browser range adapter.

The 2026-08-30 dependency survey compared the official pure-Rust
[`webrtc-rs/webrtc`](https://github.com/webrtc-rs/webrtc),
[`webrtc-rs/rtc`](https://github.com/webrtc-rs/rtc), and
[`str0m`](https://github.com/algesten/str0m) projects in a measured bake-off.
Completed Tactical
[`195`](tactical/195-webrtc-direct-file-feasibility-spike.md) retains crates.io
`rtc` 0.20.4, corresponding to reviewed package revision
`bbc18664cf2dcb690e023c6a1a436eb15253ca7f`, behind a default-off feature. Its
execution record owns the exact source/test, transitive license/unsafe,
Chromium/Firefox/WebKit, lifecycle, binary and package evidence. Post-completion
WebKit reruns correct the earlier timeout conclusion: transport and exact ranges
pass, while OPFS fails only in Playwright's non-persistent context and succeeds
in a persistent-context primitive probe. Ready Tactical
[`196`](tactical/196-remote-direct-file-product-integration.md) selects only
Cloudflare's documented free public
[`stun.cloudflare.com`](https://developers.cloudflare.com/realtime/turn/faq/)
STUN endpoint for the first direct-only product slice; it selects no TURN
service or credential. No upstream source, fixture, test vector, or asset was
copied.

Tactical
[`113`](tactical/113-ipv6-firewall-pinhole-and-incoming-reachability.md) uses
the UPnP Forum's
[`WANIPv6FirewallControl:1 Service — Standardized DCP, version 1.00, December
10, 2010`](https://upnp.org/specs/gw/UPnP-gw-WANIPv6FirewallControl-v1-Service.pdf)
as its normative pinhole source, especially sections 2.4.2--2.4.10,
2.6.1--2.6.9, 3.4, and the section 4 service description. Shared SSDP, device
description, URL, HTTP, SOAP, and Boolean behavior continues to follow the Open
Connectivity Foundation's
[`UPnP Device Architecture 2.0`, April
17, 2020](https://openconnectivity.org/upnp-specs/UPnP-arch-DeviceArchitecture-v2.0-20200417.pdf).
Neither document is vendored. The implementation and independently authored
tests use the public wire behavior; no specification source or fixture was
copied.

## uTP References

Tactical
[`118`](tactical/118-utp-implementation-decision-spike.md) pins the uTP source
set used for the implementation decision:

- BEP 29 comes from managed `reference/bittorrent.org` commit
  `7b7b41f46d57ff1d1cb1e24ed6e9bacfbf958c06`. RFC 6817 sections 1--5 are the
  LEDBAT reference. Both are summarized independently; no specification text
  or fixture is imported.
- [RFC 8899](https://www.rfc-editor.org/rfc/rfc8899.html) is the Datagram
  Packetization Layer PMTU reference for completed Tactical `137`, especially
  its base, protected-probe, confirmation, search-completion, revalidation,
  and black-hole requirements. RSTorrent records an intentional compatibility
  difference for uTP's packet-sequenced fragmentable retry and does not claim
  complete RFC 8899 conformance.
- Rasterbar libtorrent `2.0.13` at
  `7d7fc38fac61177fa5e02148f791b2f65250b09d` is the primary completeness and
  executable interoperability oracle. The inspected uTP library files are
  BSD-3-Clause. Its GPL-3.0 simulator submodule was neither initialized nor
  run.
- BitTorrent libutp at
  `2b364cbb0650bdab64a5de2abb4518f9f228ec44` is an MIT-licensed standalone
  C++ implementation with a C callback API. It is a build and behavior
  reference only, not an accepted dependency or source donor.
- Apache-2.0 `librqbit-utp` `0.7.0` is pinned at
  `c26f57b2debbe35ed0ace1ad419de529f7a5bf95`; the matching crates.io checksum
  is `4f3bfdc73944bc76cab24d5690a98816770040a654c449edf5ff2b9ba22626aa`.
  The VCS and package source are test and design references only, not an
  accepted dependency or fork base.

The retained
[`utp_reference_oracle.py`](../tests/interop/utp_reference_oracle.py) is
independently authored. It generates temporary content and uses the locked
libtorrent Python package as a separate executable loopback oracle; it copies
no reference source, fixture, or test data. Completed Tactical `125` adds the
independently authored
[`utp_rstorrent_interop.py`](../tests/interop/utp_rstorrent_interop.py), which
generates the same temporary fixture and runs RSTorrent as leecher and seed
against that locked external oracle without linking or distributing
libtorrent. Any future copy, translation, vendoring, FFI link, dependency, or
fork remains a human review gate with the applicable BSD-3-Clause, MIT, or
Apache-2.0 notices and modification record.

## License Posture

This inventory was checked against the managed revisions on 2026-07-29. It
describes the reference set; it is not a substitute for checking the precise
file before importing material.

- rqbit and its librqbit crates are Apache-2.0.
- Standalone BitTorrent libutp is MIT.
- Rasterbar libtorrent's main library is BSD-3-Clause. Its root `LICENSE`
  identifies separately licensed files; notably, its Python binding source is
  Boost Software License 1.0, while its optional `simulation/libsimulator`
  submodule is GPL-3.0.
- JSTorrent is MIT.
- qBittorrent source is GPL-2.0-or-later with GPL-3.0-or-later binary assets,
  and Transmission is GPL-2.0 or GPL-3.0 (checked 2026-10-14). They are
  behavior and test references only; no source, fixture, test data or asset
  from either may enter RSTorrent.
- The official BitTorrent BEP repository does not currently state a
  repository-wide license, and individual document statements vary. Cite and
  independently summarize protocol behavior rather than copying BEP prose or
  bundled material without checking the exact document.

Reading these sources and running a reference implementation as a separate
test peer does not make it an RSTorrent product dependency. If source, fixtures,
test data, or a reference binary will be copied, linked, vendored, or
distributed, stop and record the exact origin, revision, file-level license,
required notices, modification status, and reason for inclusion first.

The GPL-3.0 libsimulator submodule is not part of the planned oracle harness and
must not be linked into or distributed with RSTorrent without a separate
license and architecture decision. The similarly named
[libTorrent used by rTorrent](https://github.com/rakshasa/libtorrent) is
GPL-2.0 and is not the managed Rasterbar libtorrent reference.

RSTorrent is licensed under the MIT License. Bundled third-party material and
release-distribution considerations are recorded in the repository root
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). The initial Rust and
Python lockfiles were audited during tactical `000`; the exact inventory at
that point is recorded in
[`tactical/000-first-verified-piece.md`](tactical/000-first-verified-piece.md).

The current dependency graphs include mostly permissive licenses plus some
MPL-2.0 components. These do not change the license of RSTorrent's original
source, but binary distributions must preserve their applicable notices and
license/source-availability obligations. Repeat the audit whenever dependency
graphs change and generate notices from each release's exact resolved Android,
desktop, web, Rust, and Python dependency sets.

## Platform Power References

Tactical
[`165`](tactical/165-cross-platform-active-download-sleep-inhibition.md) uses
platform contracts rather than a torrent-engine reference:

- exact MIT-licensed [`keepawake` 0.6.1 source](https://docs.rs/crate/keepawake/0.6.1/source/)
  is the macOS and Windows dependency and was inspected through its platform
  modules and owned-guard drop path;
- the [XDG Desktop Portal Inhibit interface](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Inhibit.html)
  defines the Linux fallback request handle, Suspend flag, response, and Close
  lifecycle; GNOME SessionManager's installed interface and runtime are the
  direct GNOME-session authority;
- Android's
  [`PowerManager.WakeLock`](https://developer.android.com/reference/android/os/PowerManager.WakeLock)
  and [wake-lock guidance](https://developer.android.com/develop/background-work/background-tasks/awake/wakelock)
  define the partial CPU lock, ownership, permission, and prompt-release
  contract; and
- Apple's
  [`isIdleTimerDisabled`](https://developer.apple.com/documentation/uikit/uiapplication/isidletimerdisabled)
  and [background-execution guidance](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time)
  distinguish a foreground display assertion from finite background work and
  support the explicit iOS inapplicability decision.

No source, fixture, sample, or test data was copied from these references.
The maintained JSTorrent power-management source named in Tactical `165` was
read as product/platform history at its recorded revision; RSTorrent retains
its own state, ownership, and implementation.

## Chrome Extension And Native-Messaging References

Tactical 253's dedicated-localhost route uses [RFC 6761 section 6.3](https://www.rfc-editor.org/rfc/rfc6761.html#section-6.3),
Chromium's [localhost resolution change](https://codereview.chromium.org/938093003/),
and the [ChromeOS forwarding contract](https://www.chromium.org/chromium-os/developer-library/reference/security/port-forwarding/).
[RFC 6265 section 8.5](https://www.rfc-editor.org/rfc/rfc6265.html#section-8.5)
explains why cookies do not isolate ports. A dedicated hostname with host-only
cookies avoids bare-localhost sharing; it does not provide per-port isolation.
Tests are independently authored; no source or fixtures are imported.

Tactical
[`166`](tactical/166-desktop-native-bootstrap-and-extension-scaffold.md) uses
Chrome's official platform contracts:

- [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
  defines the host manifest, exact `allowed_origins`, platform registration
  locations, caller-origin argument, native-endian length-prefixed JSON,
  stdout discipline, process lifecycle, and message ceilings; and
- the manifest [`key`](https://developer.chrome.com/docs/extensions/reference/manifest/key)
  procedure defines draft ZIP upload, public-key recovery, and stable unpacked
  development identity. Manifest V3's development guidance requires executable
  extension code to be bundled locally.

The maintained JSTorrent checkout at revision
`9598770baecb1164a00ba5d41f7e7c11bfb78828` was inspected for product history
at the exact manifest, host/registration, host-test, and extension-connection
paths recorded in Tactical `166`. The sibling `web-server-chrome` checkout at
revision `66a8c0ee95494f5b8632f7a2424a36e2da7495dd` informed only repeatable
target-triple Tauri sidecar construction. RSTorrent imports no reference
source, fixture, test data, protocol claim, Crostini topology, or asset.

Ready Tactical
[`208`](tactical/208-installation-metrics-and-feedback-parity.md) additionally
uses Chrome's official
[`runtime.setUninstallURL`](https://developer.chrome.com/docs/extensions/reference/api/runtime),
[`storage.local`](https://developer.chrome.com/docs/extensions/reference/api/storage),
[disclosure requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements),
and [user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
as the uninstall-URL, local-record, prominent-disclosure, privacy-policy, and
consent authorities. The tactical records the 1,023-character URL maximum and
treats store-policy compliance as a release gate. No Chrome sample, fixture,
or source is imported.

## JSTorrent

Tactical [245](tactical/245-android-legacy-inventory-and-import-contract.md)
selects Android release `android-v1.0.24`, source
`7b454be4410385f9c4f7f135cb6b16194a2b0409`, for the Android migration
inventory. Its exact KV/native-store/root/preferences/manifest code and tests,
public APK digest/certificate inspection, and independently authored fixture
provenance are recorded in the tactical and
[Android replacement topic](topics/android-jstorrent-replacement.md). No
reference source, fixture or APK is imported into this repository.

Repository: [kzahel/jstorrent-typescript](https://github.com/kzahel/jstorrent-typescript)

Managed reference entry: `../jstorrent-typescript`, first-party `main`

JSTorrent is the closest product reference because it captures the maintainer's
existing torrent behavior and platform lessons. High-value areas include:

- `packages/engine/integration/python/`: libtorrent-backed download, seeding,
  resume, recheck, multi-file, multi-peer, disconnect, encryption, and
  connection-limit scenarios;
- `packages/engine/test/`: peer, piece, scheduler, DHT, tracker, persistence,
  streaming, and protocol edge cases;
- `android/io-core/`: SAF random-access storage, file-descriptor lifetime, and
  Android socket lessons;
- `android/app/`: foreground service, notification, Doze, lifecycle, storage
  root, and Chromebook UX lessons;
- `extension/src/lib/{telemetry-id,metrics}.ts` and
  `website/public/{feedback,uninstall,privacy}.html`: resettable product
  identity, coarse local counters, uninstall/feedback behavior, recipients,
  and privacy-language lessons for Tactical `208`;
- `ios/`: the native SwiftUI/JavaScriptCore product's directory bookmarks,
  direct TCP/UDP, positioned file I/O, and foreground/background lifecycle;
  its documented Android/iOS runtime gaps are failure history rather than an
  architecture to reproduce; and
- `docs/topics/` and `docs/contracts/`: current evidence and explicitly
  documented platform failures.

JSTorrent is a behavior and evidence source. Its QuickJS embeddings,
native-host protocol, IO daemon, extension companion topology, TypeScript APIs,
and persistence formats are not migration requirements.

The accepted download-root and add-options behavior is mapped to exact sibling
starting points in [`topics/download-roots.md`](topics/download-roots.md).
That map is a product cheat sheet for future implementation, not permission to
copy JSTorrent's storage manager, host topology, or persistence format.

Tactical `008` adapted the grid sizing, state layering, and color semantics
from JSTorrent's
`android/app/src/main/java/com/jstorrent/app/ui/components/PieceMap.kt` at
commit `0cad4dacf540f5be42ee53c4f1e1da27aa1b3685`. The RSTorrent file and
JSTorrent source have the same author and copyright holder, so no separate
third-party license notice is required. No other JSTorrent source was imported
by that tactical.

## Client Binding References

The initial desktop adapter follows Tauri v2's official
[Rust command](https://v2.tauri.app/develop/calling-rust/) and
[Channel](https://v2.tauri.app/develop/calling-frontend/) APIs. The Android
adapter follows UniFFI's documented
[external and remote type](https://mozilla.github.io/uniffi-rs/latest/types/remote_ext_types.html)
model so application-contract types originate in `rstorrent-session` while
the exported client object remains in `rstorrent-android`. These are SDK/API
references; no documentation sample source was imported.

## Apple iOS Platform References

Completed Tacticals
[`116`](tactical/116-platform-storage-coherence-and-ios-feasibility.md) and
[`123`](tactical/123-ios-on-device-root-persistence-and-recovery.md) use
Apple's official platform documentation and the active SDK headers as the
normative platform boundary:

- [Providing access to directories](https://developer.apple.com/documentation/uikit/providing-access-to-directories)
  defines user-selected recursive directory access, security-scoped URLs,
  bookmark restoration, permission revocation, and coordinated access;
- [`UIDocumentPickerViewController`](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller)
  defines external-document selection and its security-scope/file-coordination
  obligations;
- [`NSFileCoordinator`](https://developer.apple.com/documentation/foundation/nsfilecoordinator)
  is the coordination primitive whose correct relationship to bounded direct
  Rust descriptor I/O must be established on-device;
- [`URLResourceValues`](https://developer.apple.com/documentation/foundation/urlresourcevalues)
  exposes optional directory, symlink, ubiquitous-item, and volume facts;
  missing values remain unknown rather than false;
- [`NSFileProviderManager`](https://developer.apple.com/documentation/fileprovider/nsfileprovidermanager)
  can identify a user-visible File Provider item/domain but does not establish
  a generic local-versus-remote payload classification;
- [Extending your app's background execution time](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time)
  defines the brief, expiring completion window around ordinary background
  transition; and
- [Performing long-running tasks on iOS and iPadOS](https://developer.apple.com/documentation/backgroundtasks/performing-long-running-tasks-on-ios-and-ipados)
  defines iOS 26 user-initiated continued processing, progress, expiration,
  cancellation, and force-close limits.

These references establish obligations and candidate APIs, not RSTorrent iOS
product support. The physical probes import no Apple sample source, fixture,
asset, entitlement, or project file. Tactical `123` retains only app-owned
Documents as a supported root result and keeps system-picked roots
classification-only.

## TLS Platform Trust References

Tactical
[`098`](tactical/098-authenticated-https-tracker-platform-trust.md) audits the
locked reqwest/rustls platform-trust path rather than introducing a separate
TLS implementation. The exact resolved components are reqwest `0.13.4`,
rustls `0.23.43`, `rustls-platform-verifier` `0.7.0`, and
`rustls-platform-verifier-android` `0.1.1`. The tactical records the inspected
reqwest client builder, verifier platform backends and tests, Android
initialization API, version-matched Maven artifact, and pinned libtorrent and
JSTorrent comparison paths.

Reqwest, rcgen, and both platform-verifier crates are MIT OR Apache-2.0;
rustls is Apache-2.0 OR ISC OR MIT. The Android AAR is the support artifact
published by the already locked verifier dependency and is resolved from its
Cargo-provided on-disk Maven repository at build time; it is not copied into
this repository. Rcgen creates independently authored in-process certificate
fixtures. The external Python interoperability harness invokes the local
OpenSSL executable only to generate temporary certificates; OpenSSL is not an
RSTorrent runtime dependency.

No reference source, certificate, private key, CA store, test fixture, or
tracker credential was copied. Controlled roots exist only inside temporary
test directories or a feature-gated test process and never enter production
construction or a platform trust store.

## Owner Remote Access References

Accepted Tactical
[`190`](tactical/190-opaque-wasm-relay-foundation.md) selects an account-free
OPAQUE native-host/browser-Wasm proof through a controlled dumb relay. The
normative sources are [RFC 9807](https://www.rfc-editor.org/rfc/rfc9807.html)
for OPAQUE, [RFC 9497](https://www.rfc-editor.org/rfc/rfc9497.html) for its
VOPRF, and [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html) for
Argon2id. [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869.html) and
[RFC 8439](https://www.rfc-editor.org/rfc/rfc8439.html) are candidate record
KDF/AEAD references; the tactical must record the exact construction before
implementation. [Web Cryptography Level 2](https://www.w3.org/TR/webcrypto/)
owns the browser randomness and future non-extractable-key platform boundary,
not OPAQUE itself.

The initial exact Rust candidate is
[`opaque-ke` `4.0.1`](https://crates.io/crates/opaque-ke/4.0.1), crates.io SHA-256
`ded22991b43cd15561b62b2e1cf9ace1344a8534eebec96202d5c96a77a6616a`,
tag `v4.0.1` commit `75fe4cdddb7946440054da0c8e7cdd73828af3f9`, licensed
`MIT OR Apache-2.0`, with Rust 1.85 minimum. The source survey covered:

- `src/opaque.rs`, `src/messages.rs`, `src/envelope.rs`,
  `src/serialization/`, and `src/ksf.rs` for protocol state, codecs, identity
  handling, hostile decoding and the password-stretching seam;
- `src/key_exchange/tripledh.rs` and
  `src/key_exchange/group/ristretto255.rs` for the selected AKE/group;
- `src/tests/rfc9807_vectors.rs`, `src/tests/test_opaque_vectors.rs`,
  `src/tests/full_test.rs`, and `src/tests/full_test_vectors.rs` for standards,
  deterministic and malformed-input behavior; and
- `src/serialization/tests.rs` and `tests/remote_key.rs` for invalid encodings
  and the external-private-key seam.

The project's
[NCC Group review](https://www.nccgroup.com/research/public-report-whatsapp-opaque-ke-cryptographic-implementation-review/)
covered `0.5.0` against draft 03 with a focused `1.2.0` fix retest, not `4.0.1`
or RSTorrent's complete composition. The closed Tactical `190` pre-code review
records the identity-element, reflection, I2OSP and constant-time MAC findings;
the final-RFC change history; no published project or RustSec advisory; the
exact selected feature/dependency/license graph; and passing upstream RFC and
hostile-input tests. The repository lockfile remains the exact resolved graph.
[`@serenity-kit/opaque` `1.1.0`](https://www.npmjs.com/package/@serenity-kit/opaque)
is only a browser/Wasm feasibility and Argon2 performance reference, not an
accepted dependency.

The local YepAnywhere sibling's relay-relevant paths were refreshed at commit
`dcf0449d5336c866d37c50cb1f2e1df66ed50663`, including
`docs/project/relay-design.md`, `topics/relay-client-mux.md`,
`docs/project/relay-head-of-line-blocking.md`,
`packages/client/src/lib/connection/SecureConnection.ts`,
`packages/shared/src/relay.ts`, and `packages/relay/src/mux-handler.ts`. They
inform username routing, one inner protocol, opaque forwarding, fairness,
generation ownership and cleanup. RSTorrent does not adopt YepAnywhere's SRP,
NaCl, resume, HTTP-like messages, limits or hosted deployment.

Tactical `192` refreshed the clean sibling at commit
`506ce0528ffe3ef44c5e4ee90780b44eb80d4a15`, especially
`topics/mobile-server-pairing.md`, `topics/security-client-audit.md`,
`topics/client-source-runtime-topology.md`,
`topics/trusted-client-packaging.md`,
`docs/project/mobile-companion-app.md`,
`docs/project/ws-auth-state-model.md`,
`packages/server/src/routes/ws-srp-handlers.ts`, and
`packages/server/src/remote-access/RemoteSessionService.ts`. These paths inform
the accepted separation among server identity, client continuity, expiring
resume authority, live connections, route selection, revocation and operator
audit. RSTorrent adopts the product and failure lessons, not YepAnywhere's SRP,
symmetric resume construction, exact P-256 proof transcript, storage format,
identifiers or wire contract. The active tactical re-audited current sibling
commit
`b8b6987b1466a35ff818483002eea31472bed8c9`; the listed paths are unchanged
since the clean checkpoint, and an unrelated dirty `README.md` was excluded.

Tactical `192` independently selects P-256 ECDSA/SHA-256 continuity proof and
ephemeral P-256 ECDH. The normative inputs are
[FIPS 186-5](https://csrc.nist.gov/pubs/fips/186-5/final),
[NIST SP 800-186](https://csrc.nist.gov/pubs/sp/800/186/final),
[NIST SP 800-56A revision 3](https://csrc.nist.gov/pubs/sp/800/56/a/r3/final),
[RFC 5869](https://www.rfc-editor.org/rfc/rfc5869.html), and
[Web Cryptography Level 2](https://www.w3.org/TR/webcrypto/). The exact native
candidate is `p256` `0.13.2`, crates.io SHA-256
`c9863ad85fa8f4460f9c48cb909d38a0d689dba1f6f6988a5e3e0d31071bcd4b`, tag
`p256/v0.13.2` commit `6e6886563bb066cbaea4f59f89459341af6879af`, licensed
`MIT OR Apache-2.0`, with Rust 1.65 minimum. `src/ecdh.rs`, `src/ecdsa.rs`,
`src/arithmetic.rs`, `tests/ecdsa.rs`, `tests/affine.rs`, and the Wycheproof-
backed `src/test_vectors/ecdsa.rs` cover ephemeral agreement, fixed signature
encoding, strict SEC1 point handling, deterministic signatures and hostile
signature vectors. Only `ecdsa` and `ecdh` features are selected; this reuses
the `elliptic-curve` `0.13` generation already resolved by OPAQUE instead of
adding the parallel `p256` `0.14` dependency generation.

The RFC Editor showed one RFC `9807` erratum on 2026-08-29: technical erratum
`8675` is rejected, with no verified erratum changing the selected OPAQUE
construction. The current `opaque-ke` repository still describes `4.0.1` as
the final-RFC release and offers only the separately rejected `4.1.0-pre.2`
prerelease; no new source or fixture was imported.

No external source, fixture, test vector, dependency or generated asset was
imported by the tactical design or this reference record.

## Application View And Web Client References

The accepted application-view direction in
[`topics/application-view-api.md`](topics/application-view-api.md) uses these
official references as design evidence:

- [qBittorrent WebUI API](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29):
  its `sync/maindata` resource demonstrates a practical cursor, full reset,
  keyed upsert, and removed-ID polling model. RSTorrent does not adopt its
  complete endpoint or payload shape.
- [Transmission RPC specification](https://github.com/transmission/transmission/blob/main/docs/rpc-spec.md):
  requested fields, object results, and explicit recently removed IDs inform
  projection and collection-diff choices. RSTorrent does not adopt its
  positional table encoding or arbitrary field query as the initial contract.
- [`ts-rs` documentation](https://docs.rs/ts-rs/latest/ts_rs/): Serde-compatible
  TypeScript generation remains the initial declaration mechanism.
- [`schemars` documentation](https://docs.rs/schemars/latest/schemars/): JSON
  Schema generation from the same Rust DTOs removes duplicated handwritten
  structural type lists while separate validators retain semantic bounds.
- [Ajv JSON Schema documentation](https://ajv.js.org/): the pinned `8.20.0`
  client validator compiles the generated draft 2020-12 definitions while
  small handwritten checks retain canonical decimals, ranges, and negotiated
  resource invariants.
- [Zustand documentation](https://github.com/pmndrs/zustand): its vanilla
  store, React selector, shallow-selection, and direct subscription APIs fit a
  per-application materialized view store without making React own transport
  tasks.

These are API and architectural references. No source, fixtures, or assets are
imported by the design documentation. Binary WebSocket frames and Tauri raw
responses or Channels remain codec and delivery capabilities, not a reason to
make a second semantic API.

Tactical
[`101`](tactical/101-first-run-web-authentication.md) also uses the official
[IETF cookie draft 6265bis-22](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis/),
[WHATWG Fetch Living Standard](https://fetch.spec.whatwg.org/), and
[WHATWG WebSockets Living Standard](https://websockets.spec.whatwg.org/) for
host-only/HttpOnly/SameSite/Secure cookie behavior, credentialed CORS, Origin,
and browser WebSocket cookie mechanics. It inspected the exact locally locked
Axum `0.8.9`, axum-core `0.5.6`, and tower-http `0.6.11` body-limit, CORS, and
static-service sources. These constrain mechanics but do not supply product
policy, source, fixtures, or wire compatibility.

The accepted multiplexed connection and future relay direction in
[`application-connection-architecture.md`](topics/application-connection-architecture.md)
also uses the maintainer's local `~/code/yepanywhere` sibling as an
architectural and failure reference. The topic records the exact observed
commit and paths for its inner request/subscription router, plain and encrypted
connection composition, opaque outer relay circuits, per-circuit fair queues
and head-of-line-blocking analysis. RSTorrent adopts those lessons without
copying source or adopting YepAnywhere's wire contract, HTTP-like operations,
cryptography, framing constants or relay limits.

## libtorrent

Project: [libtorrent](https://libtorrent.org/)

Source: [arvidn/libtorrent](https://github.com/arvidn/libtorrent)

Managed source checkout: `reference/libtorrent`, pinned to `v2.0.13`

Rasterbar libtorrent is the primary external interoperability oracle. It can
seed to RSTorrent, leech from it, create fixtures, enforce encryption modes,
and expose peer/session state for black-box assertions.

It is also the mandatory completeness and edge-case reference for feature
work. Review both implementation and tests at the pinned revision; a successful
black-box exchange alone does not establish that the relevant failure,
lifecycle, persistence, and resource cases were considered.

Use libtorrent as an independent peer rather than an RSTorrent runtime
dependency. Interoperability tests should verify payload hashes and observable
protocol results, not only that both processes remained alive.

This is distinct from the similarly named libTorrent used by rTorrent.

Tactical `051` used the pinned libtorrent peer-info projection, terminal
legend, and peer-list/fast-extension tests together with JSTorrent's active
Peer table formatter and typed incoming direction to define an independently
authored semantic flag vocabulary. Exact revisions, paths, functions, adopted
lessons, and deliberate differences are recorded in
[`peer-flag-vocabulary.md`](topics/peer-flag-vocabulary.md). No reference code,
fixture, test data, or asset was copied.

## rqbit And librqbit

Project: [rqbit](https://github.com/ikatson/rqbit)

Library documentation: [librqbit](https://docs.rs/librqbit/)

Managed source checkout: `reference/rqbit`, pinned to release `v9.0.1`
(`a499d2f243d124e144aef137afe7cb304a6e3f36`). Tacticals before 2026-10-14 cite
the earlier 9.0 development revision `4e5f94cbcf1d57ec500885c77cf1e24d70232d89`.

rqbit is a BitTorrent client written natively in Rust. `librqbit` is its
reusable engine crate and exposes torrent sessions, torrent and magnet inputs,
statistics, persistence options, storage support, and an
application-oriented API. It is not a Rust wrapper around a C++ engine, and it
is not inherently a REST service; rqbit's server and web API are clients of the
library.

RSTorrent does not adopt librqbit as its engine. It remains useful for:

- Rust and Tokio implementation comparisons;
- behavior and performance comparison;
- identifying mature engine concerns that an early plan omitted;
- cross-client fixture and swarm testing; and
- comparing the shape of application-facing state without copying its API.

If RSTorrent ever imports rqbit source or fixtures, review and record the exact
license and provenance at that time.

## qBittorrent And Transmission

Sources: [qbittorrent/qBittorrent](https://github.com/qbittorrent/qBittorrent)
and [transmission/transmission](https://github.com/transmission/transmission)

Managed source checkouts: `reference/qbittorrent`, pinned to `release-5.2.4`,
and `reference/transmission`, pinned to `4.1.3`. Both are optional entries in
`reference/pins.toml`.

These mature clients are application-policy references, not protocol oracles.
libtorrent's seed goals only rank the seed queue, so product behavior such as
stopping a torrent at a share ratio or seeding time, per-torrent overrides,
queue interaction and how a stopped-by-limit torrent is presented must come
from clients. qBittorrent shows that policy layered over libtorrent;
Transmission shows an independent engine's choices. Record exact paths,
functions and tests in the owning tactical, as for libtorrent.

Both are GPL. Read them for behavior and tests only and write RSTorrent's
implementation and tests independently.

## MSE/PE References

MSE/PE has no BEP. Tactical
[`111`](tactical/111-mse-peer-stream-encryption.md) pins the Internet Archive
capture from 2022-03-08 15:52:49 UTC of the Vuze/Azureus
`Message_Stream_Encryption` wiki page, rendered from wiki revision
`oldid=16077`, as the de facto normative wire description:

<https://web.archive.org/web/20220308155249id_/http://wiki.vuze.com/w/Message_Stream_Encryption>

The original wiki URL returned 404 during review, so only that immutable
capture owns the specification provenance for this slice. It was used to
independently describe the DH-768, padding, request-hash, method-negotiation,
and RC4-drop1024 contract; no prose or fixture was copied.

Pinned libtorrent commit `7d7fc38fac61177fa5e02148f791b2f65250b09d`
is the implementation and interoperability oracle. Tactical `111` records the
exact `pe_crypto.cpp`, `bt_peer_connection.cpp`, settings, torrent-index,
unit-test, and simulation-test paths inspected and every adopted or
intentionally different edge case. The simulator sources were inspected but
not imported, linked, or executed through their GPL `libsimulator`
dependency. Pinned rqbit contains no MSE implementation.

[IETF RFC 6229](https://www.rfc-editor.org/rfc/rfc6229) supplies only selected
RC4 keystream vectors. The adjacent independently transcribed test fixture
cites its exact section, and `THIRD_PARTY_NOTICES.md` preserves the RFC Code
Components' Simplified BSD notice. Those vectors validate RC4; they are not
treated as MSE handshake evidence.

`crypto-bigint` `0.7.5` is pinned with default features disabled for
stack-allocated `U768` constant-modulus Montgomery arithmetic. It is licensed
`Apache-2.0 OR MIT`; the dependency and notice audit is recorded in
`THIRD_PARTY_NOTICES.md`. RSTorrent authors RC4, key derivation, and the
sans-IO handshake state machine independently.

No MSE specification prose, libtorrent/JSTorrent/rqbit source, fixture, or
test data was copied into RSTorrent.

## uTP Reference Candidates

The living
[`uTP transport campaign`](topics/utp-transport-campaign.md) records the
initial BEP 29 source survey and the review gates that precede any
implementation choice.

The managed BEP and libtorrent checkouts are the current reproducible uTP
specification and primary implementation/test oracle. The pinned rqbit tree
resolves `librqbit-utp` `0.7.0`, but that package source is not captured by the
rqbit checkout and must be pinned separately before source-level reliance.
[BitTorrent's standalone libutp](https://github.com/bittorrent/libutp) is an
MIT-licensed C++ library with a C callback API, but it is not a managed
reference or accepted dependency.

No uTP source, fixture, or test data has been copied into RSTorrent. Before
executing either prospective reference as an oracle, pin its exact source and
record the build recipe. Before copying, linking, vendoring, or distributing
it, repeat the exact file-level license, notice, modification, dependency, and
platform review required by the reference policy above.

## Final AppImage Runtime Provenance

Tactical259's final source8c AppImages embed
[`type2-runtime` revision8f39b89](https://github.com/AppImage/type2-runtime/tree/8f39b89e2ac31e1640b3d3f7e9a5108e6ce805fa).
Independent ELF-boundary and complete runtime-byte comparison binds both
architectures to the upstream assets from
[build36463736478](https://github.com/AppImage/type2-runtime/actions/runs/36463736478),
allowing only the named16-byte `.digest_md5` payload-digest field.
The pinned [license](https://github.com/AppImage/type2-runtime/blob/8f39b89e2ac31e1640b3d3f7e9a5108e6ce805fa/LICENSE),
`BUILD.md`, `.github/workflows/build.yaml`, `src/runtime/Makefile`,
`scripts/common/install-dependencies.sh` and `patches/libfuse/mount.c.diff`
are inspected for provenance and static dependency/build inputs. The license
lists separate static-library terms; dependency builds pin and patch libfuse
3.15.0 and pin squashfuse0.5.2. Inspection does not establish complete
corresponding-source/relink availability or per-package redistribution
acceptance. R-05 retains those requirements. No upstream source or fixture is
imported into the public repository by this inspection.

Tactical282 independently matches both final8c `AppRun.wrapped` hashes with
[Tauri's apprun-old mirror](https://github.com/tauri-apps/binary-releases/releases/tag/apprun-old)
and the original [AppImageKit release](https://github.com/AppImage/AppImageKit/releases/tag/continuous).
The upstream-declared source revision is
`5735cc5bed206497cddfbd2a75e1982c2606c35d`;
[`src/AppRun.c`](https://github.com/AppImage/AppImageKit/blob/5735cc5bed206497cddfbd2a75e1982c2606c35d/src/AppRun.c)
and `src/CMakeLists.txt` are inspected for the original MIT notice and target.
`distribution/licenses/apprun-source.json` binds the exact original1271-byte
initial copyright/license comment, source/archive hashes and origin. Only that
notice is imported, under its MIT terms, to preserve Simon Peter/RazZziel
attribution. No implementation source is copied. The legacy upstream release
is marked obsolete; archived build metadata returns404. Exact asset equality
and source provenance do not establish a reproducible build, security support
or complete native redistribution/source/relink acceptance; R-05 remains open.

Tactical259 also inspects the original seven runtime/dependency source archives
and ten root license/copyright files. Exact libfuse3.15.0/squashfuse0.5.2 archive
hashes match the pinned dependency script. The official Alpine GitHub mirror
recipes at the upstream build date bind musl1.2.5-r11
(`8999cf56154b9bd09c995f293d8dfd3aa8001e3a`), zlib1.3.2-r0
(`2b38f55109add14f4f99a974c2fdf421b6b9e9e9`), zstd1.5.6-r2
(`5c2ddf18f193dafdd25ae7391d96c7e30766eecd`) and mimalloc2.1.7-r0
(`5a1a5dc3216a69e3cd66a57ee07cb5ef01b8be39`). All original archive SHA-512s
and16 auxiliary input hashes verify; twelve patches apply cleanly in temporary
owned sources. The upstream runtime notice list omits mimalloc despite both
logged static link commands. No implementation source is imported into Git.

Alpine's subsequent zlib1.3.2-r1
[backport](https://github.com/alpinelinux/aports/commit/c973d294927355eac1d2a6e97d86e41fbab8ffda)
and the [upstream fix](https://github.com/madler/zlib/commit/df84af25dc1942490e1d1c899a07619152a46148)
address CVE-2026-85091 in nonblocking gzip writes. The exact signed runtime
prefixes' matching upstream debug assets verify official release SHA-256,
GNU debuglink CRC and build-id bytes. No affected gzip-write symbols/object file
appear among their2,056/1,881 defined functions; the selected109 C/header files
also have no gzip-write calls. Treat this as a scoped absence inference, not
full native vulnerability or source/build/reproducibility clearance. A separate
owned x64 runtime build and object/archive relink prototype uses fixed1.3.2-r1,
passes independently hashed exports/version/help and complete cleanup/off/claim
release, but does not replace the original signed runtime or deliver a source
or relink offer. R-05 and independent WebKit/OpenSSL/ABI holds remain open.
