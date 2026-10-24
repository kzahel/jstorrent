# Desktop updater configuration

[`jstorrent.json`](jstorrent.json) is the sole active desktop release product.
It serves `updates.jstorrent.com`, with Stable as the default and an explicit
Latest channel. JSTorrent desktop already uses its original updater signing
key and `com.jstorrent.desktop` identity; these are not pending cutover steps.
The service implementation lives in the sibling `simple-app-update-server`
repository. GitHub hosts the release assets.

[`rstorrent.json`](rstorrent.json) retains the frozen incubation product's
legacy route. Maintainer direction on 2026-10-11 ends that release track.
Its last recorded offers are Stable 0.1.4 and Latest 0.2.801. Do not publish
new RSTorrent packages, advance those offers or re-enable incubation nightly
publication. Old incubation clients trust a different signing key; retaining
their endpoint does not imply automatic conversion to JSTorrent.

## Installed-client compatibility

Installed JSTorrent apps request
`/tauri/{target}/{arch}/{current_version}` on their existing hostname, optionally
with a channel. Preserve implicit Stable for older clients, the expected Tauri
JSON fields (`version`, `url`, `signature`, `notes`, `pub_date`), HTTP 204 for
no update and the existing signing trust root. Release discovery and server
configuration can change behind this contract. Platform downloads and
signatures come from the selected release's `latest.json` platform entries.

## Current selection guard and cleanup

Both descriptors currently use `requiredAsset` to distinguish historical
package families sharing tag prefixes. `JSTorrent_x64.app.tar.gz` identifies a
JSTorrent release; it is not the download selected for every platform. However,
its absence excludes the entire release, including other architectures.

Keep the guard until a bounded server cleanup provides platform-independent
JSTorrent release selection, excludes historical incubation packages, isolates
cached candidates/notes and verifies existing client requests. The freeze does
not justify removing the guard without a replacement exclusion rule. This
documentation records policy; it does not change deployed routes or selectors.

The [product and migration topic](../docs/topics/product-surfaces-and-migration.md#jstorrent-only-release-policy-2026-10-11)
owns this policy. Tactical
[296](../docs/tactical/296-production-preview-feed-separation.md) records why
the historical package-family guard was introduced.

JSTorrent releases at or above 0.3.2 require the signed `compatibility` envelope
introduced by Tactical 377. The shared service preserves it in each platform
response. The native host authenticates it and checks local database ranges
and migration prefixes; it never sends database paths or contents to the
server. Older Stable releases and old clients retain their existing contract.
