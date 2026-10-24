# JSTorrent Windows installer artwork

The production overlay uses the existing original JSTorrent `icons/icon.ico`
for installer/uninstaller windows and the box icon unchanged inside these
simple SVG compositions. The icon has the same reference provenance and
attribution as the existing desktop icon (see the repository’s `docs/references.md`).

The pinned Tauri CLI schema recommends a 164 × 314 welcome/finish sidebar and
150 × 57 page header. NSIS consumes opaque 24-bit BMP files; SVGs are maintained
sources. From the repository root, using librsvg and ImageMagick:

```bash
node scripts/prepare-windows-installer-artwork.mjs
```

The production installer flow, hooks and trust configuration stay independent
from this presentation configuration. Changing these assets requires fresh
production Windows packaging/signing; historical signed installers retain
their original artwork.
