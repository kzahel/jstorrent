# Live Web UI Hot Reload

Status: Implementation complete; awaiting product review (2026-09-27).

Topics: `client-surfaces`, `web-ui-design`, `download-root-acquisition`.

## Scope and stopping condition

Add `./scripts/webui --reload` for live React/CSS iteration. Keep the same
browser URL and persistent profile as the ordinary launcher. Vite serves the
page with hot module replacement; a gateway child on a private ephemeral
loopback port owns the application, torrent networking, and native download
folder picker. Proxy API, WebSocket, health, and media routes through Vite so
the browser still uses one visible origin.

The ordinary production-built `./scripts/webui` path remains available.
The reload flag does not rebuild or restart Rust after startup. Engine/API
live recompilation, Tauri, Android, remote hosting, and generic multi-host
proxy support are outside this slice.

## Invariants and validation

- The browser is served only from the selected loopback web port. The gateway
  accepts that exact origin and is bound only to ephemeral loopback.
- Media capabilities resolve through the visible host. Vite's proxy must
  preserve the browser Host and Origin headers for reload mode.
- Both child processes have observable readiness, failure, and bounded joined
  shutdown. A failed start leaves no child behind.
- The existing `.local/webui` profile and native picker stay with the gateway.

Validate shell syntax and an isolated `--reload --no-open` lifecycle with
HTTP API, application and Vite WebSockets, and media-route forwarding. Do
not open the user's primary browser or touch the active 4177 profile.

## Evidence

- `bash -n scripts/webui`, `./scripts/webui --help`, web typecheck, and
  `git diff --check` passed. The existing production launcher path was not
  altered beyond shared child cleanup and readiness checks.
- An isolated `--reload --no-open` launcher on port 44177 used a temporary
  profile. Vite served `/@vite/client`; the gateway health and owner-bearing
  application hello passed through the visible origin; both the application
  and token-authenticated Vite HMR WebSockets upgraded.
- The proxied media route returned the gateway's 404 for a nonexistent
  capability. Source inspection confirms that the reload proxy preserves
  the visible Host header required by media capabilities.
- The launcher and both children stopped, with no listener left on 44177.
  The active 4177 service and profile were not touched. No browser
  screenshots or full UI test suite were run.

## Pre-push validation (2026-09-28)

`bash -n scripts/webui`, `./scripts/webui --help`, web typecheck,
localization, production build/CSP and `git diff --check` pass. The shared
unit suite passes 396 tests with two existing skips; the isolated bundled
Chromium suite passes all 45 active browser cases with 14 opt-in skips.
The prior isolated reload lifecycle evidence above was not repeated; the
pre-push browser run uses its own Vite server and does not exercise the
launcher or touch the active 4177 profile.
