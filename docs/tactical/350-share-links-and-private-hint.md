# Tactical 350: Share Links Across Clients And Private Hint

Status: Complete locally, 2026-10-14. Maintainer-directed follow-up to
Tactical [349](349-general-tab-compact-header-and-links.md). No release or
website deployment is authorized by this tactical.
Topics: `application-view-api`, `web-ui-design`, `android-jstorrent-replacement`,
`localization`.

## Problem

Tactical 349 added share links to the web General tab and left four gaps:
the website `/share/` page could not read the new links, copy feedback sat
next to the button instead of in the Tactical 346 toast, Android had no
share action, and a private torrent's links were offered without saying they
only work for members of its tracker.

## Scope

- **Contract.** `TorrentView.private_torrent`, true only when parsed, stored
  metainfo carries BEP 27 `private=1`. It is omitted when false, so public
  torrents, magnets awaiting metadata and older readers see no change, and
  `TorrentFieldUpdate::PrivateTorrent` updates it when metadata arrives. The
  name avoids `private`, a keyword in Kotlin and Swift. Derived from stored
  metainfo; no schema change.
- **Web.** One `copy_share_link` torrent action beside `copy_magnet` in the
  More and row menus; the General header buttons run those same actions, so
  every copy shares one export path, `clipboard.ts`, and the toast. Info hash
  copy uses the toast. Private torrents show a hint under the General status,
  and their copy toast says the link only works for members of the tracker.
- **Android.** Copy share link beside Copy magnet link in the detail menu and
  the single-selection More sheet; `ShareLink.kt` ports the web builder with
  the same test vectors. Details shows a Private torrent row, and copying a
  private torrent's link shows a snackbar saying so. Public copies keep
  relying on the system clipboard confirmation.
- **Website.** `src/pages/share.astro` replaces the dead Chrome App installer
  at `/share/`. It reads the new fragment and every legacy shape (`hash`/`dn`/
  `magnet_uri`, `magnet_uri` alone, `magnet`), validates the magnet before
  offering it, and offers Open in JSTorrent, Copy magnet link and the site's
  existing desktop, Google Play and Chrome Web Store downloads.
  `public/share.html` forwards the TypeScript rewrite's `share.html#magnet=`
  links. The Google Analytics tag is gone; the site-wide Cloudflare beacon
  stays and strips the fragment before reporting.

## Non-Goals

- Extension detection on the share page. `Downloads.tsx` has an ad hoc
  status probe; it is not a documented mechanism and is not reused.
- Deploying the website.
- iOS presentation. The generated Swift contract and repository mapping carry
  the field; the iOS build was not run because xcodegen is not installed.

## Invariants

- The private flag never comes from a magnet or a guess.
- Clients copy only what the engine exported.
- The share page never inserts fragment text as HTML and sets `href` only to
  a validated `magnet:` URI.

## Evidence

- Rust: `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets
  -- -D warnings`; `cargo test -p rstorrent-session` (426 passed, 2 ignored),
  including `startup_projects_verified_private_flag`, the magnet-to-metadata
  patch and the wire-absence case; `cargo test -p rstorrent-gateway`,
  `-p rstorrent-android`, `-p rstorrent-ios`.
- Web: `npm run typecheck`; `npm run test` (624 passed), including the
  private General hint and toast, the share action in menus and the
  `privateTorrent` reducer update; `check:localization`;
  `tests/inspection-demo.spec.ts` (32 passed, axe included) against a local
  dev server. Renderer check of the private demo torrent (North Shore
  Stories, `media-library` scenario).
- Android: `clients/android/build.sh debug` (177 unit tests, including five
  `ShareLinkTest` cases) and `compileDebugAndroidTestKotlin`. Instrumentation
  tests on a device were not run.
- Website: `npm test` (77 passed, 13 share-link cases including a rejected
  `javascript:` URI), `npm run check`, `npm run build` (emits
  `share/index.html` and `share.html`), and a local Playwright pass over new,
  legacy, redirect and hostile links in light and dark, desktop and mobile.
