# Legacy URLs

These files were copied verbatim from `jstorrent.github.io` (the old jstorrent.com site)
to keep them working for ~60k legacy Chrome App users. Remove once the legacy app
migration is complete.

## Source repo

the historical `jstorrent.github.io` repository (GitHub Pages, formerly CNAME: jstorrent.com, now new.jstorrent.com)

## Legacy pages

| Path | Purpose | Referenced by |
|------|---------|---------------|
| `/magnet/` | Magnet protocol handler setup & test | Legacy app options.js, help.html (`jstorrent.com/magnet/`) |
| `/add/` | Protocol handler destination (`#magnet_uri=`) | `magnet/index.js` registers handler pointing here |
| `/share/` | Share page; also an alternate protocol handler destination. Rebuilt; see below | `magnet/setup.js` registers handler pointing here; product share links |
| `/bug/` | Bug report page | Legacy app |
| `/stream/` | Stream page | Legacy app |
| `/uninstall/` | Uninstall feedback page | Legacy app (also `/uninstall.html` for new app) |
| `/data/version.txt` | Legacy app version check (2.4.3) | Legacy app update mechanism |

## Share page formats

`/share/` is now the Astro page `src/pages/share.astro`; parsing lives in
`src/lib/share-link.js` with tests in `src/lib/share-link.test.mjs`. The page
reads only the URL fragment, which browsers never send to the server. It
offers the magnet as a link only after checking that it starts with
`magnet:?` and has a well-formed `xt=urn:btih:` (40 hex or 32 base32) or
`xt=urn:btmh:1220<64 hex>`. Otherwise it shows "This share link is incomplete".

| Format | Example fragment | Source |
|--------|------------------|--------|
| Current | `#xt=urn:btih:<hash>&dn=<name>&tr=<tracker>` (also `btmh`, `ws=`, `x.pe=`, ...) | Current JSTorrent clients. The fragment is the magnet's own query string; the magnet is `magnet:?` plus the fragment, passed through verbatim |
| Chrome App share | `#hash=<40 hex>&dn=<name>&magnet_uri=<encoded magnet>`, any key optional | Legacy Chrome App. `magnet_uri` wins; with only `hash`, the page builds `magnet:?xt=urn:btih:<hash>[&dn=<name>]` |
| Protocol handler | `#magnet_uri=<encoded magnet>` | `magnet/setup.js` handler registration |
| TypeScript client | `/share.html#magnet=<encoded magnet>` (or `/share/#magnet=`) | TypeScript JSTorrent clients. `/share.html` forwards to `/share/`, keeping the fragment |

The fragment uses the current format when its first key is `xt`, or when it has
an `xt` key and none of `hash`, `magnet_uri` or `magnet`. Otherwise the legacy
keys apply. The old Chrome Web Store inline-install flow, Google Analytics tag
and the `jstwn`/`testRegistered` special cases were removed with the old page.

## Legacy assets

| Path | Purpose |
|------|---------|
| `/images/` | Logos, icons, magnet link icon, URL bar screenshot |
| `/css/main.css` | Legacy site stylesheet |
| `/js/index.js`, `/js/smooth.pack.js` | Legacy site JS |
| `/favicon.ico` | Legacy favicon |
| `/jstorrent.install.js` | Chrome Web Store inline install script |

## Not copied

- `index.html`, `404.html` — redirect stubs (would cause loops since jstorrent.com now serves the new site)
- `privacy.html` — new site has a newer version
- `passwordmaker/` — unrelated utility, not needed
