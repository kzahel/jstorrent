# JSTorrent website

The standalone Astro marketing site retains the established JSTorrent design,
blog, privacy/feedback/uninstall and installed-client compatibility URLs.
The Downloads React island has server-rendered links and a no-JavaScript
platform fallback. The old `/app` prototype is retired; no TypeScript torrent
engine or shared client workspace is imported.

## Build and validation

```bash
npm ci --prefix website
npm run check --prefix website
npm test --prefix website
npm run build --prefix website
node --test scripts/assemble-pages-site.test.mjs
node scripts/website-capture.mjs /absolute/ignored/evidence/path
```

Node 24 or later is required. The capture runner uses bundled Playwright
Chromium, applies the built Cloudflare headers and always closes its browser
and server. It blocks analytics collection and substitutes embedded forms;
it never submits a response. Keep its report and images in an ignored path.

`src/data/production-release.json` selects verified production downloads.
Its closed inventory includes signatures and AppImage corresponding sources.
No legacy release discovery, preview fallback or guessed asset URLs exist.
`src/data/product-releases.json` contains published product announcements;
store approval alone must not be described as full delivery.

## Routes and security

`public/LEGACY-URLS.md` records installed-client routes. Keep legacy magnet,
add/share, stream, uninstall and version-check endpoints while clients use
those URLs. `_redirects` retires obsolete waitlist prototypes. The active
support issue links select the Rust implementation; the existing discussion
community and feedback/analytics recipients remain unchanged.

`public/_headers` owns the baseline and independently guarded `/remote/`
policy. After Astro build, `scripts/website-security.mjs` generates exact
inline-script hashes per marketing/compatibility route. It does not permit
inline script attributes or eval and never changes remote route authority.
Retained static styles need inline-style support; embedded Google Forms and
existing analytics have explicit destinations. The old uninstall page's
nonfunctional placeholder analytics configuration is removed.

The deployment workflow builds the website and guarded remote bundle as one
artifact. Moving the production hostname and retaining the existing remote
origin are operator tasks; canonical metadata alone does not change hosting.

## Provenance

Marketing source, historical posts and compatibility assets are adapted from
the MIT-licensed JSTorrent TypeScript repository at
`e0cb8a3c2ff578f8ca65b1ee820321891789e5b7`. Preserve
`public/LICENSE.jstorrent-website.txt` and existing brand asset notices.

## Automatic release promotion

`Promote Production Website` handles published production desktop releases,
successful Desktop Release runs that actually published that capsule, and an
explicit production-tag dispatch. Incubation/candidate-only runs do not promote.
For a new version it hashes all 17 public assets, checks the exact checksum
inventory and source commit, verifies all six original-root payload signatures,
and binds updater URLs/signatures. It refuses downgrades and mutated versions.
The currently qualified identical inventory is an idempotent no-op.

Promotion creates one atomic main commit for downloads and published release
announcements through GitHub's Git API. Stale inventory or a concurrent branch
advance refuses the write. After persistence it explicitly dispatches Website,
because a GITHUB_TOKEN commit alone does not trigger the normal push workflow.
Subsequent website builds therefore retain the promoted version. Signed packages
and corresponding sources must already be publicly available; the workflow
cannot manufacture or qualify a missing source archive.

## Canonical Cloudflare hosting

`Website` builds marketing and the guarded remote React/Wasm controller as one
immutable Cloudflare Pages artifact. Production release promotion dispatches
that workflow after verifying and persisting inventory. The selected canonical
controller is `https://jstorrent.com/remote/`; the relay remains
`wss://relay.rstorrent.com/client`. Infrastructure cutover acceptance lives in
the private runbook and Tactical 303, separately from successful source builds.

The artifact records source SHA and desktop version under
`/.well-known/jstorrent-website.json`. Verify the remote manifest, every file,
strict HTTP CSP, framing protections and cache policy with the deployment
verifier after a hostname change. Changing browser origin requires fresh login;
existing host credentials and relay authority are retained.

`Production Website` is retained as a manual GitHub Pages marketing rollback
workflow. It no longer follows production builds automatically and cannot serve
the controller with its required HTTP headers. Built marketing documents retain
exact-script HTML CSP and bounded waitlist fallbacks there; Cloudflare applies
stronger HTTP policy and actual redirects. DNS, forwarding and registration
configuration remain private infrastructure concerns.

Use `WEBSITE_CAPTURE_BASE=https://your-hosted-origin` with the capture runner to
repeat browser acceptance after deployment. Keep its output in an ignored path.

## Canonical repository

Tactical 305 consolidates this implementation at `kzahel/jstorrent`; the previous
implementation is `kzahel/jstorrent-typescript`. Published package/signature
bytes remain immutable. Promotion recognizes only the exact former/current
Rust names as aliases; rendered production downloads always use the canonical
name. Existing version-1 signed headless/Crostini manifest identity remains
`kzahel/rstorrent`, independently of the canonical installer transport URL.

The root legacy Linux installer now prints current AppImage/headless guidance
and installs nothing. The hosted AltStore source points to the previous
TypeScript release; the discussion community stays in that repository. One
MIT-attributed static search plugin preserves the path used by installed older
TypeScript clients; no legacy application rebuild is required.
