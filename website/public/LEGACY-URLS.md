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
| `/share/` | Alternate protocol handler destination | `magnet/setup.js` registers handler pointing here |
| `/bug/` | Bug report page | Legacy app |
| `/stream/` | Stream page | Legacy app |
| `/uninstall/` | Uninstall feedback page | Legacy app (also `/uninstall.html` for new app) |
| `/data/version.txt` | Legacy app version check (2.4.3) | Legacy app update mechanism |

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
