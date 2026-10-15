# Tactical 360: Hosted Remote Controller On Its Own Subdomain

Status: Proposed, 2026-10-15. Maintainer direction to do this later; not
started.
Topics: `mixed-version-compatibility`, `remote-access-authentication`,
`client-surfaces`.

## Problem

The hosted remote controller (the web UI build that reaches a host through
the relay) is copied into the marketing site at `jstorrent.com/remote/` and
deployed with it as one Cloudflare Pages site on every push to `main`. That
couples two very different release decisions:

- A marketing tweak redeploys the remote controller, so the maintainer has
  to consider mixed-version compatibility for every site change.
- The remote controller should ship only from a deliberate release, after
  the compatibility tests, not from every `main` push.

The shared origin is also a security weakness: the controller keeps its
remote-access trust (remembered browser authorization and pinned host
identity, `clients/web/src/remote-client-store.ts`, IndexedDB) on
`jstorrent.com`, where any script on the marketing pages or blog could read
it.

A single-site alternative (separate `remote-v*` and `marketing-v*` tags,
each deploy fetching the other half's last released artifact) was
considered. It keeps the origin but needs artifact stitching and leaves the
shared-origin exposure.

## Decision

Serve the remote controller from `https://remote.jstorrent.com/` as its own
Cloudflare Pages project, deployed only from `remote-v*` tags. The marketing
site, including `/share`, deploys separately on its own cadence (from `main`
or `marketing-v*` tags, decided when this starts).

## Plan

1. **Relay origin.** The production relay allows exactly one client origin,
   `https://jstorrent.com` (`crates/rstorrent-remote-relay/src/production.rs`,
   and the binary's origin argument check). Accept
   `https://remote.jstorrent.com` as well, keep the old origin during the
   transition, then retire it.
2. **Remote build at `/`.** Change the remote build's base path from
   `/remote/` to `/`, and update `scripts/assemble-pages-site.mjs` (or a new
   remote-only assembly), `scripts/verify-remote-deployment.mjs` and the
   website security and hosted-context tests.
3. **Old URL.** `jstorrent.com/remote/` redirects to `remote.jstorrent.com/`.
   Browsers carry the `#…` fragment across the redirect, so existing links
   keep working.
4. **Workflows.** A `remote-v*`-triggered workflow builds, runs the web
   typecheck, tests and compatibility matrix, and deploys to the new project.
   The marketing workflow stops bundling the remote controller.
   `main` pushes build and test only. The desktop-release website promotion
   keeps updating the marketing site's download inventory.
5. **Docs.** `mixed-version-compatibility` (release runbook: the remote
   controller ships by tag), `remote-access-authentication`, the glossary's
   hosted remote controller entry, and `client-surfaces`.

## Outside steps

Need the maintainer or explicit authorization: create the Cloudflare Pages
project and the `remote.jstorrent.com` custom domain and DNS record, confirm
the CI token can deploy to it, and redeploy the production relay.

## Costs And Risks

- **One-time re-pairing.** Browser storage does not move between origins.
  Every remote-access user signs in again with the password, re-approves the
  browser and accepts the host identity afresh. Remote access is new, so this
  is the cheapest time to move.
- No released desktop or Android app embeds the `/remote/` URL (checked
  2026-10-15), so released hosts need no change.

## Non-Goals

- Changing the relay protocol, authentication or host-side remote access.
- Moving `/share` or other marketing pages.

## Stopping Condition

Complete when `remote.jstorrent.com` serves the remote controller from a
`remote-v*` release with the compatibility tests gating it, the relay
accepts the new origin, the old path redirects, the marketing site deploys
without it, and the owning topics describe the new release path.
