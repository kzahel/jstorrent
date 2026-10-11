# Running clients and checking platform behavior

Use this guide when presentation or OS integration matters. For torrent logic,
start with [engine diagnostics](engine.md) and [controlled tests](testing.md).
Commands run from the repository root unless a block changes directory.

## Desktop

```bash
source ~/.profile
./scripts/desktop
```

The launcher installs locked web dependencies when needed, builds static React
assets and the native-host sidecar, and runs the debug Tauri app. It remains
attached to the terminal; `Ctrl+C` stops it. Ordinary debug identities are
isolated from the shipping JSTorrent identity. For unsigned/signed production
packages, use [releasing](releasing.md).

## Live web UI

```bash
./scripts/webui --help
./scripts/webui --reload --no-open
```

This starts the shared React UI against the real application service. `--reload`
uses Vite hot reload; Rust changes still require restart. Without it, the
launcher serves a production web build. Omit `--no-open` for manual browser
inspection. `Ctrl+C` joins the gateway and development server.

The stable browser origin defaults to loopback port 4177; the persistent
development profile lives under `.local/webui`. `RSTORRENT_WEBUI_PORT` and
`RSTORRENT_WEBUI_DATA_ROOT` override those defaults. This unauthenticated
loopback development mode uses online torrent networking and is separate from
the desktop profile and persistent product authentication. Public test magnets
are variable observations, not deterministic fixtures.

## Web demo

For presentation without Rust, sockets or torrent networking:

```bash
npm ci --prefix clients/web
npm run dev --prefix clients/web -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/?demo=healthy-download&at=42000&autoplay=0`.
Other scenarios are `stalled-metadata`, `tracker-recovery`, `endgame`,
`large-swarm`, `disk-error` and `empty-library`. Omit `autoplay=0` to advance
the demo clock. [Browser tests](testing.md#browser-interaction-and-layout)
automate the same surface with separate test Chromium.

## Persistent browser authentication

For first-run setup, paired access or hosted assets, use the gateway's product
mode rather than the development launcher:

```bash
VITE_RSTORRENT_DEFAULT_LIVE=same-origin npm run build --prefix clients/web
cargo build -p rstorrent-gateway --bin rstorrent-gateway
target/debug/rstorrent-gateway serve --help
mkdir -p .local/headless-web/downloads
RSTORRENT_STORAGE_ROOT="$PWD/.local/headless-web/downloads" \
  target/debug/rstorrent-gateway serve \
  --profile-root .local/headless-web/profile \
  --listen 127.0.0.1:3030 --origin http://127.0.0.1:3030 \
  --auth auto --web-root "$PWD/clients/web/dist" --build-id local
```

A fresh profile offers a ten-minute setup choice. If a paired profile loses all
authorized browser cookies, stop the gateway and restart with `--pairing-window`
to explicitly approve a new browser. Help documents the remaining auth and
listener options; secrets are supplied through files, not CLI values.

## Platform validation

| Surface | Entry point | Purpose |
| --- | --- | --- |
| Android | [Client README](../../clients/android/README.md) | Both Rust ABIs, generated Kotlin, Compose, foreground lifecycle and SAF storage; select explicit owned targets |
| iOS | [Client README](../../clients/ios/README.md) | Generated Swift/Xcode project, simulator/archive and Apple storage/lifecycle behavior |
| Extension | [Client README](../../clients/extension/README.md) | Manifest permissions, packaging, pairing and browser integration |
| Desktop | [Package validator](../../scripts/validate-desktop-package.mjs), [native-host smoke](../../scripts/smoke-native-host.mjs) | OS activation, installed associations and host registration |
| ChromeOS | [Qualification record](../tactical/253-chromeos-onboarding-recovery-and-physical-qualification.md), [scenario map](../../tests/interop/README.md#platform-integration) | Android or Linux backend, root repair, connection recovery and physical lifecycle |
| Storage feasibility | [Probe](../../experiments/android-storage-probe/run_probe.py) | Provider/descriptor behavior, sparse allocation and process-death reopen; specialized investigation |

For VM or physical-device work, use the sibling Machine Control common CLI and
platform guide. ChromeOS sessions begin with its platform skill and read-only
`target doctor`. Preserve inherited applications, payloads, grants and OS state;
release target claims and stop owned machines/processes after each session.
Generic transport and cleanup instructions belong in Machine Control.

Legacy-state import and released old/new app pairs are isolated under
[migration testing](../migration/testing.md). A debug platform pass does not
establish production signing, store installation or update continuity.
