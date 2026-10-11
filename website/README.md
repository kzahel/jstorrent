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
