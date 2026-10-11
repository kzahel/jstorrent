# Third-Party Notices

RSTorrent is licensed under the MIT License. This file records bundled
third-party material and release-distribution considerations. It does not
replace the license information supplied by package managers or upstream
projects.

## GLib Rust Binding Backport

`vendor/glib-0.18.5` contains the published gtk-rs GLib Rust binding under its
original MIT license, retained in `vendor/glib-0.18.5/LICENSE`. RSTorrent
modifies only two lines in `src/variant_iter.rs` to repair the mutable C
out-pointer for RUSTSEC-2024-0429. The complete original source inventory,
archive checksum, source revision and patch provenance are recorded in
`distribution/patches/glib-0.18.5-source.json`. Linux binary notices include
the original license and exact modification; other platform graphs omit this
Linux desktop dependency.

Source: <https://static.crates.io/crates/glib/glib-0.18.5.crate>

## Gradle Wrapper

The Android experiments include the official Gradle 8.11.1 wrapper scripts
and wrapper JAR, licensed under Apache License 2.0. The scripts retain their
upstream license headers, and each wrapper JAR contains its upstream license
in `META-INF/LICENSE`.

Source: <https://github.com/gradle/gradle>

## Public Test Torrent Metadata

`tests/live/torrents.json` records magnet links and factual metadata from the
[WebTorrent Free Torrents](https://webtorrent.io/free-torrents) catalog for
opt-in interoperability testing. The repository does not include the torrents'
media payloads. Each work remains subject to its own public-domain or Creative
Commons terms, which must be checked before redistributing a payload.

## MSE Primitive Evidence

`rstorrent-protocol` uses `crypto-bigint` 0.7.5 under its dual Apache-2.0 OR
MIT license for fixed-width, constant-time modular exponentiation over the
legacy MSE DH group. The crate's default features and RNG integration are
disabled.

Source: <https://crates.io/crates/crypto-bigint/0.7.5>

The independently authored RC4 tests transcribe selected output bytes from
IETF RFC 6229. Treat those bytes conservatively as RFC Code Components under
the Simplified BSD terms in the IETF Trust Legal Provisions. The test contains
an adjacent origin citation and does not copy explanatory RFC prose.

Source: <https://www.rfc-editor.org/rfc/rfc6229.html>

## Package Dependencies And Release Artifacts

Rust, npm, Gradle, and Python dependencies remain under their respective
licenses. The manifests and lockfiles identify the resolved dependency sets;
upstream packages and artifacts contain their applicable license texts.

Notable distribution considerations in the current dependency graph include:

- Desktop external links use `tauri-plugin-opener` and its JavaScript bindings
  2.5.3 under MIT OR Apache-2.0. Its resolved `open` 5.4.4 dependency is MIT;
  `is-wsl` 0.4.0 and `is-docker` 0.2.0 are MIT. Release notices must include
  these exact lockfile-resolved components. No upstream implementation source
  is copied into this repository.
- `dontfrag` 1.0.1 is used only on macOS under its dual MIT OR Apache-2.0
  license to access the IPv4 don't-fragment socket policy through a safe API.
- `keepawake` 0.6.1 is used only on macOS and Windows under its MIT license to
  hold and release the native user-idle/system execution assertion while
  download or verification work is active.
- The desktop default-enabled `direct-file-webrtc` feature uses the `rtc` 0.20.4
  crate family under its MIT OR Apache-2.0 terms and Ring 0.17.14 under Apache
  2.0 AND ISC. It is present in ordinary desktop release graphs; non-desktop feature
  defaults must be checked independently.
- `net.java.dev.jna:jna:5.17.0` is used under its Apache-2.0 option.
- Some Rust and npm packages are MPL-2.0 licensed.
- Linux desktop packages may use WebKitGTK and GTK system libraries under
  their respective licenses.

Before distributing an Android or desktop binary, generate a notice and
license bundle from that release's exact resolved dependency graph. Include
the Apache-2.0 text for JNA and other shipped Apache components, the license
texts for shipped MPL-2.0 components, and any notices required by bundled
platform libraries. A source checkout's root license and this notice are not
by themselves a complete binary dependency notice bundle.


Tactical `214` adds `scripts/prepare-release-notices.py` and the pinned
cargo-about 0.9.2 generator. Desktop package/release overlays include its
Rust/npm texts and lockfile-bound manifest in `notices/`; the package inspector
verifies the embedded text checksum. `distribution/licenses/` contains exact
upstream license documents with source revisions and checksums for crates
whose published archives omit them. Those texts retain their upstream terms.
CRC32C's additional Zlib-derived component attribution is included separately.
Reviewed manifest-only grants are explicitly distinguished from original
upstream notices; no copyright owner is invented.

The generator covers the target's default-feature Rust graph (including
build dependencies), web production dependencies and Ajv standalone code
generation. Tactical `217` separately generates Android Maven/AAR and both-ABI Rust notices
in variant assets, including original archive notices, parent-POM grants and
reviewed native supplements. Tactical `214` now embeds original distro notices
and a checked component manifest in native AppImages. Launcher/runtime and
corresponding-source obligations remain separate review items. Distribution review must
reconcile those platform components against the saved package inventories
before a supported release. See `distribution/dependency-review.json` for
currently unresolved advisory blockers and its expiring review date.

## JSTorrent Brand Assets

Original desktop, Android adaptive/launcher/store, iOS app/header, extension,
shared web, gateway and website icon assets are copied unchanged from `kzahel/jstorrent-typescript` revision
`25e4b701433fd815398ba89526546f5e4f072e3f` under its MIT license, copyright
2025 Kyle Graehl. Reuse preserves the established first-party product identity
for in-place succession. `distribution/branding/jstorrent-assets.json` records
each exact source path, destination and SHA-256; the original permission and
copyright text lives in `distribution/branding/JSTorrent-LICENSE.txt`. Desktop
and Android generated binary notices include that text, and the extension
packages it as `LICENSE.jstorrent.txt`. The iOS app bundles
`App/Branding/JSTorrent-LICENSE.txt`; the website serves
`LICENSE.jstorrent.txt`, and the gateway retains the original license beside
its embedded image. No third-party logo is substituted.

## JSTorrent Marketing Website

Astro marketing components, layouts, CSS, historical blog posts, download
presentation, bounded hosted-context helper and compatibility assets are
adapted from `kzahel/jstorrent-typescript` revision
`e0cb8a3c2ff578f8ca65b1ee820321891789e5b7`, copyright 2025 Kyle Graehl,
under its MIT license. The complete original notice is served at
`website/public/LICENSE.jstorrent-website.txt`. The old TypeScript torrent
engine and shared application packages are not included in this website.
Existing brand-asset notices above remain applicable.

## Legacy installed-client search plugin

`search-plugins/internet-archive.js` retains the self-contained Internet Archive
plugin fetched by older TypeScript clients from the canonical repository path.
It is reused from the MIT-licensed previous implementation; its complete Kyle
Graehl copyright and license are retained in the file. No TypeScript engine is
imported. Source and exact revision are recorded in the file header.

## Remote Video Playback

The lazy browser playback integration uses **playsvideo 0.4.7** (MIT,
Copyright (c) 2026 Kyle Graehl), **hls.js 1.7.3** (Apache-2.0), and the
**mediabunny** integration fork at
`cd3cd2beb9c122dfa6fa89edbd7a73f2fa9df7a0` (MPL-2.0). Exact archive integrity
and dependency revisions are retained in `clients/web/package-lock.json`.
The checksum-checked playsvideo adaptation is independently authored in
`clients/web/scripts/patch-playsvideo.mjs`; it bounds playback, restricts this
consumer to MP4 and disables worker/transcoding paths. No FFmpeg code or
WebAssembly is included in this integration's distribution.

Preferred sources and licenses:

- https://github.com/kzahel/playsvideo (npm 0.4.7 sources/source maps and MIT
  license retained by its published package)
- https://github.com/video-dev/hls.js/tree/v1.7.3 and its `LICENSE`
- https://github.com/kzahel/mediabunny/tree/cd3cd2beb9c122dfa6fa89edbd7a73f2fa9df7a0
  and its `LICENSE`; unmodified MPL-covered source is publicly available at
  this exact revision. Local playsvideo changes do not modify mediabunny.

The playsvideo MIT license permits use, copying, modification, distribution,
sublicensing and sale, provided its copyright and permission notice are
retained. Its full license is shipped alongside this source record at
`distribution/licenses/playsvideo-MIT.txt`.

**Big Buck Bunny**, © 2008 Blender Foundation, https://peach.blender.org,
is used only by opt-in disposable browser qualification under Creative Commons
Attribution 3.0 (https://creativecommons.org/licenses/by/3.0/). Media bytes are
not distributed in this repository or product. Tactical 313 records the exact
fixture provenance, checksum and validation.
