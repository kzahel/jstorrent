# Locked dependency license sources

These unmodified license and notice texts supplement published Rust crates
that omit their upstream repository's license files. `cargo-sources.json`
records the exact package, published manifest hash, registry VCS revision,
original URL and text checksum. Texts are deduplicated by SHA-256. They are
reproduced solely to preserve the upstream distribution terms and attribution;
their own stated licenses continue to apply. No implementation source is
imported.

Some upstreams publish a manifest grant without a standalone license text.
Those exact reviewed packages are explicitly marked `declaration_only`;
the bundle identifies this provenance and includes the applicable standard
text from pinned cargo-about 0.9.2. It does not fabricate a copyright owner or
assert that a standard text is an original upstream notice. New omissions,
changed manifest declarations or changed supplemental files fail generation.

The source list is a distribution input, not legal advice or a license grant
from RSTorrent. Native platform libraries and Android Maven/AAR dependencies
require their own package inventories; Rust/npm notices do not cover them.


`android-sources.json` adds reviewed Android native supplements and original
artifact hashes. JNA 5.17.0 uses the existing Apache-2.0 selection; its exact
upstream revision `695ae749e7bfd92f88324147c5d96b7129efec3e` supplies the standard
Apache text and bundled libffi's original MIT notice. Graphics-path's pinned
pre-release source history at `794e3806700833665f48f56f7dd3581642a6057f` supplies
only the original Apache-2.0 comment blocks from `Conic.cpp` and its math
headers. Preserve their 2006/2013/2017/2022 Android Open Source Project
attribution. No implementation code is imported. The catalog records exact
source URLs, extraction scope and hashes; these texts are reproduced under
their stated terms to preserve attribution, not to grant new rights.

The Android generator separately records original Maven artifact notices,
POM/parent grants and exact source locators. Rustls's artifact-only Maven
component reuses the existing checksum-bound Cargo license supplement. Missing
or changed native AAR evidence requires review. Final APK/AAB verification
covers embedded text integrity and the exact native-library name inventory;
it does not replace corresponding-source delivery or legal review.

`apprun-source.json` records the exact initial MIT copyright/license comment
from AppImageKit `src/AppRun.c` at the upstream-declared revision5735cc5.
`apprun-5735cc5-MIT.txt` preserves both Simon Peter and RazZziel attribution
and the complete original terms. The AppImage native collector packages it
for the independently matched x64/ARM Tauri mirror launcher hashes; inspection
refuses omitted or altered notice/provenance. No launcher implementation is
imported. Exact upstream/mirror byte equality and a source locator do not
establish a reproducible build or complete native redistribution clearance.

Tactical 377 repairs notice generation for fourteen existing archive omissions
in the default-feature desktop graph (including the older PHF/html parser
family pulled by native dialog dependencies). Their exact registry manifests
and available VCS revisions are recorded in `cargo-sources.json`. These entries
use the existing explicit declaration-only policy: identify the original
package/manifest grant and standard terms, without inventing an upstream
copyright notice. No implementation source or new dependency is imported.

Tactical 381 upgrades the WebRTC graph to 0.21.1. The fifteen supplemental
entries verify each published archive against its lockfile checksum and bind
the exact manifest to registry VCS revision
`2a732df55ca4bcf26b80914fa0f570cfaf74cfcb`. Both upstream license files at that
revision are byte-identical to the existing Apache-2.0 and MIT supplements.
The catalog reuses those original terms and attribution with immutable source
URLs. No implementation source is imported. The newer interceptor no longer
depends on `rtc-interceptor-derive`; its isolated 0.20.5 proposal is superseded
by this graph update.

## October 29 AppImage preferred-source inventory

Tactical 389 completes source records for three dependencies already present in
the committed web lockfile. The preceding unpublished desktop 0.3.5 collector
stopped at the missing `fast-uri@3.1.9` record; this does not add or upgrade a
dependency. `distribution/appimage-source-inputs.json` binds each exact npm
distribution URL/SHA-512 integrity, license and preferred upstream commit/archive
SHA-256. Current-versus-prior lockfile comparison now resolves every changed
web input without an unreviewed fallback.

| Package | License | Preferred source |
| --- | --- | --- |
| fast-uri 3.1.9 | BSD-3-Clause | [Fastify source at 0def7033](https://github.com/fastify/fast-uri/tree/0def70338a0fa2f12a10c83ae8eafc2139ae9a07) |
| undici 7.30.1 | MIT | [Node.js source at 7507102a](https://github.com/nodejs/undici/tree/7507102a675b082a71437f0a00681e537875556c) |
| zustand 5.0.15 | MIT | [pmndrs source at 2115efb9](https://github.com/pmndrs/zustand/tree/2115efb9e270e73ad1d3472dfe0e0c7b8c6abcd4) |

For each package, the npm artifact matches the lockfile's complete integrity
value; upstream and packaged root license texts match, as do package name,
version and declared license. Fast-uri and undici identify their source through
npm `gitHead`. Zustand's npm provenance statement binds the same distribution
SHA-512 to `refs/tags/v5.0.15`/2115efb9, agreeing with the upstream GitHub tag;
this records the source binding without claiming independent Sigstore signature
verification. Downloaded preferred archives are hashed before adding the pins.

MIT permits redistribution with its copyright/permission notice. The reviewed
BSD three-clause text permits source/binary redistribution while preserving its
copyright, conditions and disclaimer and prohibiting contributor endorsement.
Both complete archives retain those unmodified texts and original headers in
the corresponding-source carrier; existing packaged notices remain required.
No third-party source is copied into application source files, and no license
exception or release gate is waived.
