# Tactical 360: Hosted Remote Controller On Its Own Subdomain

Status: Active, 2026-10-16. Maintainer authorized end-to-end implementation,
production cutover and incremental commits. Scope and access investigation
are complete; execution evidence follows as each gate passes.
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
   `main` pushes build and test the controller only; marketing may still deploy.
   The desktop-release website promotion
   keeps updating the marketing site's download inventory.
5. **Docs.** `mixed-version-compatibility` (release runbook: the remote
   controller ships by tag), `remote-access-authentication`, the glossary's
   hosted remote controller entry, and `client-surfaces`.

## Outside steps

Need the maintainer or explicit authorization: create the Cloudflare Pages
project and the `remote.jstorrent.com` custom domain and DNS record, confirm
the CI token can deploy to it, and redeploy the production relay.

## Scoped Implementation, 2026-10-16

Keep the marketing site deploying from `main`. Only the controller becomes
tag-released. Use the existing account, static Pages hosting, relay, Wasm
client and signing/authentication model; this slice needs no new package,
paid service, application permission or host release.

### 1. Build and artifact ownership

- `clients/web/vite.config.ts` and
  `clients/web/scripts/finalize-remote-dist.mjs` currently require
  `/remote/assets/`. Serve the independent build from `/assets/` at `/`.
- Split `scripts/assemble-pages-site.mjs` into independently usable marketing
  and controller assembly. Controller assembly owns its own `_headers`,
  manifest, exact build/relay identity and content-hashed asset checks.
  Preserve the existing strict CSP, no-store HTML/manifest, immutable assets,
  no analytics, no service workers and Wasm content type.
- Update `scripts/verify-remote-deployment.mjs` and
  `scripts/verify-remote-product.mjs` to accept an explicit controller entry
  URL rather than appending `/remote/`. Local product verification must use
  the same root layout as production.
- Give tagged controller builds their release version as well as the exact
  commit in client identity and diagnostics. The web package version alone
  cannot identify independent controller releases. Use existing identity
  fields; no application-contract change is needed.

### 2. Relay origin transition

`ProductRelayOptions`, `ProductRelay` and `validate_origin` in
`crates/rstorrent-remote-relay/src/production.rs` currently model one origin.
The binary additionally requires the old exact origin in trusted-proxy mode.
Both checks must change together.

Use an explicitly bounded allowlist: at most two exact production origins
during transition, then only `https://remote.jstorrent.com`. Do not admit
wildcards, arbitrary subdomains, www aliases or Pages preview origins. Keep
loopback validation separately available for the existing harnesses. CLI,
production construction, unit tests and runtime origin rejection all need
coverage. The relay owns this configuration; no new background task or
persistent state is required.

The private deployer has the old origin in its candidate launch and WSS
probe, and its service unit selects it too. Update those together, preserve
the current relay authority and backups, and leave Caddy/TLS endpoints intact.
The deployer also defaults to the former checkout directory name; use its
existing source-root override or correct that private default deliberately.

### 3. Release and compatibility gates

- Add a controller workflow for `remote-vMAJOR.MINOR.PATCH`; PR and main
  builds test without deploying. A controller tag must be reachable from
  reviewed `main`, and production deploys must serialize without cancelling
  an in-progress deployment.
- Run web typecheck/tests, the released-contract ledger, the live
  compatibility matrix, production remote build, CSP/assembly guards and
  an artifact browser smoke before deployment. The live workflow already
  supports `workflow_call`, so reuse it as a dependency rather than merely
  launching an independent workflow that cannot gate publication.
- Explicitly set the Pages production branch on deployment; a Git tag must
  not accidentally create only a preview deployment.
- Add the controller as a client delivery in `compat/deliveries.json`,
  extend the production-tag matcher in `scripts/compat-ledger.mjs` (which
  currently omits `remote-v*`), and capture its decoder. Record the first
  public date only after public verification. Capture the last combined
  deployment too, so pre-cutover open controllers have an explicit baseline.
  Check rollback versions
  against the same supported hosts.
- Remove remote/Wasm build and remote-source deployment triggers from the
  marketing workflow while retaining their build/test signal elsewhere.
  Keep the existing desktop-release promotion dispatch working for marketing.
  Do not turn this controller-only release into a host release or bypass the
  separate strict-client host-release hold.

### 4. Navigation and retained browser state

- Redirect `/remote`, `/remote/`, and the legacy document entry points to
  the new root. Preserve query and fragment in real-browser tests, including
  www and the former product domain. Redirect only document entry points;
  do not blindly redirect `/remote/*`, which includes old assets.
- Keep the exact old `/remote/assets/` hashed files available for at least
  the 30-day compatibility window after cutover. Open tabs can load player
  chunks later. Recommended implementation: pin a verified manifest and
  frozen assets from the last combined deployment, and include only
  that compatibility asset set in marketing assembly until its recorded
  retirement date. Never rebuild the controller there or fetch its latest
  release on each marketing deploy. Bound files and total bytes from the
  captured manifest, verify every digest, and fail closed on source drift.
- Browser authorization and host pins are origin-scoped. Explain the one-time
  password sign-in and browser approval; do not copy credentials or pins
  across origins. Host registrations, passwords and local torrent data remain
  owned by their existing hosts.
- Keep both exact relay origins for at least the same window so already-open
  old clients can reconnect. Remove the old origin and compatibility assets
  only after the recorded window and a reviewed retirement change. List this
  temporary asset bridge and its retirement condition in the mixed-version
  topic and release runbook; no durable format is being migrated.

### 5. Deployment sequence and rollback

1. Finish local implementation, tests, immutable candidate artifacts and
   private deployment changes before any production action.
2. Create the separate Pages project and bind the new custom domain. Attach
   it through the Pages domain API before installing/verifying its CNAME;
   DNS alone is insufficient. Wait for domain and certificate activation.
3. Deploy and verify the exact dual-origin relay, retaining a compatible
   rollback binary/unit and preserving forward authority state.
4. Publish the first tagged controller artifact, verify every manifest digest
   and security header at its deployment URL and custom domain, and run an
   isolated browser/host canary with owned cleanup.
5. Only then deploy marketing without the controller document/build and with
   the verified redirects plus frozen legacy asset bridge. Prove a marketing
   deploy does not advance the controller build ID.
6. Rehearse rollback: restore the prior combined marketing artifact and
   redirects while the relay still admits the old origin. Keep new-origin
   admission if any new client has been served; never roll back authority
   state. Independently roll back the new controller to a compatible artifact.
7. Record both deployment identities, release/capture dates and the earliest
   legacy-origin/asset retirement date in the owning topics and private
   runbook. Any canary route must be signed-released before its host profile
   is deleted.

## Access Investigation, 2026-10-16

Read-only checks found no missing account login, signing key or credential
provisioning prerequisite. Concrete account identifiers, machine targets and
credential locations remain in the private infrastructure runbook.

| Requirement | Evidence | Remaining proof |
| --- | --- | --- |
| Repository/Actions access | Authenticated GitHub account has repository admin/push access; existing Pages token and account-ID secret names are present. | Push/tag/publication are separate actions, not performed during scoping. |
| Pages provisioning | Existing local Wrangler OAuth login refreshes successfully, has `pages:write`, and reads the existing Pages project/account. | Create the new project and domain only during cutover. |
| CI deployment | Existing Pages-only credential deployed the combined site successfully on October 16. | Its first deployment to the new project has not been exercised; reuse is expected, not yet demonstrated. |
| DNS | Existing token is active, reads the active product zone, and the zone response grants DNS-record edit/read. The new hostname has no existing record. | Create/bind the exact new record during cutover. |
| Relay operations | SSH and noninteractive sudo work; system relay is active, user relay absent, operator status and protected-file metadata are readable; current backups exist. | Build and qualify the changed relay/deployer; no restart occurred. |

Live WSS preflight returns `101` for the current origin and `404` for the new
and unrelated origins, confirming the deployed admission boundary. The current
marketing and 42-file controller manifest both report source
`bdc58e4ac7f7811eb07101b92a6385d11ea80e1a`. The private deployer's
`--local-check` passes. A generic Python HTTP request received `403` from the
public site; Node fetch subsequently reads both HTML and manifest with `200`.
Treat that client-specific failure as a verifier input to investigate if it
recurs, not as evidence of a site outage.

No project, domain, DNS record, CI secret, relay service, tag or public release
was changed during investigation. The remaining access uncertainty is the
first CI deploy to the newly created project, not a known missing credential.

### Required validation

- Relay allowlist/CLI and hostile-origin tests, including old/new exact
  origins, duplicates/bounds, lookalike hosts and denied preview origins.
- Web typecheck/tests, website tests/check/build, assembly/redirect/security
  tests, workflow lint, compatibility ledger and live matrix.
- Real separately identified test-browser checks of root asset loading,
  fragment/query redirects, lazy chunks from an old open tab, login/resume,
  revoke, and cleanup. No primary-browser temporary profile is needed.
- Exact deployed header/digest verification, CI credential acceptance,
  domain/certificate activation, controller rollback and a marketing-only
  deployment that leaves the controller build unchanged.
- Browser-only presentation and relay admission change: Android/iOS in-process
  networking, storage and generated application boundaries are unchanged.
  No Android/iOS host support or native release is added by this slice.

### Sources checked

- [Cloudflare Pages project creation](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/create/)
  and [custom-domain attachment](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/methods/create/)
  both accept Pages Write.
- [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
  requires domain association as well as DNS; a CNAME alone is insufficient.

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

## Execution Evidence

### Relay transition

- Added an explicit production allowlist of one or two exact origins, retaining
  the old-origin constructor for existing callers. Repeated CLI origin options
  are bounded and duplicates rejected. Browser upgrades reject duplicate Origin
  headers before admission.
- `cargo test -p rstorrent-remote-relay`: 27 tests pass, including real old/new
  origin upgrades, hostile origins, duplicate headers and joined shutdown.
  `cargo clippy -p rstorrent-remote-relay --all-targets -- -D warnings` passes;
  `cargo fmt --all` applied. Private deployer local syntax checks pass.
- Automatic combined Website deployment is temporarily disabled while the
  release lanes are split; the existing public artifact keeps serving.

### Independent artifact and workflow implementation

- Controller assembly now owns the root document, complete security policy,
  no-store manifest, hashed assets and explicit 404 (no implicit SPA/service
  worker fallback). The local product verifier uses the same root layout.
- Marketing deploys independently from main, with no Rust/Wasm/client build.
  A pinned manifest retrieves only the last combined deployment's 41 exact
  hashed assets (about 3.5 MB) with four bounded workers and per-file digest/
  length verification. This replaces the proposed archive with independently
  verifiable files from the immutable deployment; no new source is imported.
  These are retained first-party build outputs with the same bundled dependency
  provenance/notices as the original release. Retirement is reviewed no earlier
  than 2026-11-16; files are not silently dropped on that date.
- Captured the last combined controller's actual decoder/schema at bdc58e4a
  and added it as the legacy remote client delivery. Remote tags now participate
  in the compatibility ledger. Tagged builds report their independent version.
- The new controller workflow builds on main/PR, deploys only remote-v tags,
  verifies tag ancestry, gates deployment on the reusable live compatibility
  workflow, retains the exact tested artifact, explicitly selects the Pages
  production branch, and verifies its immutable URL plus custom domain.
- Local web typecheck and all 843 unit cases pass (three opt-in tests skipped).
  Fourteen assembly/legacy integrity/ledger tests pass; workflow lint passes.
  Production remote build, root Chromium/React/Wasm smoke, website tests,
  website check/build and complete frozen-asset assembly pass.
- The exact transition relay at 4dd1890c is deployed using the private
  candidate/rollback runner; TLS/operator smoke, authority-preserving switch,
  public health/WSS and backup pass. The separate Pages project and its custom
  domain are provisioned; public controller cutover remains pending.

- After adding the actually deployed remote client to the ledger, the matrix
  caught an overly broad requestedBy assertion. It now forbids reachable
  output only for clients that reject it, with a negative control for a client
  that can request a feature but cannot decode the response. All 849 web cases
  pass; the legacy controller's raw failures are explicitly empty. The host
  release hold and rejected enum policy remain intact.
- The root-layout local product verifier passes private/shared login, reload,
  browser and relay restart, phone viewport, package rollback, rendered audit,
  1-MiB exact direct save, revoke, changed-host rejection, 256 invalid circuits,
  zero service workers and joined cleanup.

- Follow-up workflow validation caught an unused retry counter in shell lint;
  the propagation retry now reports its attempt. Tagged rollback archives are
  deterministic, and rerunning deployment refuses to overwrite changed release
  bytes. The controller manifest also records its independent release version.

- Complete local Rust baseline passes: `cargo fmt --all -- --check`,
  `cargo clippy --workspace -- -D warnings`, and `cargo test --workspace`
  (1,720 passed, 20 ignored). The first remote tag is 0.3.2 at 859f00de.
  Its exact decoder is captured and delivery recorded as submitted while the
  live compatibility/publication gate runs; first-public date remains unset.
  A concurrent main build correctly refused the newly pushed tag until this
  delivery entry landed. This is not an ignored compatibility failure.
