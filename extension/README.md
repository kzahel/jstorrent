# JSTorrent Extension

## Packaging for Chrome Web Store

To create a zip package for uploading to the Chrome Web Store:

```bash
cd scripts
./package-extension.sh
```

This will:
1. Build the extension with `SKIP_INJECT_KEY=1` (no public key in manifest)
2. Create `extension/package.zip` with the contents of `dist/`

The script excludes `images/cws/*` (Chrome Web Store promotional images) from the package since those are only needed for the store listing, not the extension itself.

## Environment Variables

- `SKIP_INJECT_KEY=1` - Skip injecting the public key into manifest.json during build (used for CWS uploads)

## Development

```bash
pnpm dev      # Run in development mode
pnpm build    # Build for production
pnpm test:e2e # Run end-to-end tests
```
