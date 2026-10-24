# Tactical 303: Canonical JSTorrent Remote Origin

Status: Complete, 2026-10-11. Owners: remote-access-authentication and
product-surfaces-and-migration. Private infrastructure acceptance owns DNS,
forwarding, service deployment and provider administration.

## Scope and stopping condition

Serve the existing guarded remote controller at jstorrent.com/remote/ through
Cloudflare alongside marketing. Select the exact canonical browser origin in
the production relay and its deployment configuration. Stop after focused
origin admission tests, build/assembly/header qualification, deployed remote
acceptance and a reconciled private cutover record.

## Invariants and non-goals

- Keep relay.rstorrent.com, host authority, stored reservations, cryptographic
  protocol and desktop/headless packages unchanged.
- Keep exact browser-origin rejection, trusted-loopback proxy, operator
  authentication, bounds and cancellation semantics. No wildcard admission.
- Preserve remote no-store, immutable hashed assets, strict CSP and framing
  protections. No marketing analytics or third-party scripts in the remote app.
- Never copy browser authorization across origins; explain fresh sign-in.
- No engine feature, store update, registration transfer, new email recipient
  or expanded remote support claim. Repository renames are separate.
- Preserve rollback artifacts and DNS/mail continuity; reports remain ignored.

## Ownership and validation

The existing relay owns origin admission and opaque circuits. This slice adds
no tasks, listeners or protocol dependencies. Private deployment selects an
exact source revision, retains protected authority state, validates a candidate
before activation and retains the previous binary for rollback.

Validate production origin selection, former/foreign/malformed origin refusal,
existing proxy/operator controls, relay unit/integration tests and clippy/fmt.
Run website source/security tests and remote assembly/verifier. Use the existing
public canary runner for browser login/reload/revocation and signed route cleanup
when possible; inspect command-driven captures before interactive testing.

## Execution checkpoint

Canonical GitHub Pages currently excludes the remote bundle and cannot enforce
its HTTP header policy. Existing Cloudflare assembly already contains the
guarded controller. The production relay hardcodes rstorrent.com independently
of its CLI validation. Cloudflare consolidation is accepted, with forwarding
migration preceding DNS cutover. Name.com remains registrar.

Local qualification passes the relay crate's unit/binary/integration suites,
including actual production WebSocket acceptance at the canonical origin and
refusal of former/www/wrong-port/lookalike origins. Scoped fmt and all-target
clippy pass. The 54 website tests and nine assembly guards pass. Production
Website is manual-only rollback; Cloudflare Website adds the same public source
receipt to its combined artifact. Private service, candidate and restore inputs
now select the canonical origin. No new tasks or cryptographic code are added.
## Deployed acceptance

Public source bd084f3cb2f90a46d52c0f8270adbc70d5fdeae2 is deployed on
Cloudflare Pages and the production relay. Website CI 38135677840 passes;
the ordinary public canonical origin passes all six manifest digests, strict
remote headers, Wasm MIME and absent service-worker checks. Live TLS WebSocket
admission accepts only the exact canonical origin; former/www/wrong-port and
lookalike origins return 404. Existing relay authority is retained.

A disposable exact-source headless host and bundled Chromium prove private
password login, reload/restart resume, browser revocation, shared login and
shared restart requiring a password. No page errors or third-party remote
requests occur. Signed route release and profile/process cleanup restore the
pre-test existing registration and waiting host. This qualifies the bounded
canonical-origin canary, not new remote-controlled platform support.

Thirty-two canonical marketing browser views and no-JavaScript downloads pass
after DNS cutover. Former remote document entrypoints and www redirect to the
canonical controller with query strings and browser fragments preserved.
Hashed former-origin assets remain available for cached documents. Protected
forwarding configuration and registrar/DNS ownership are recorded privately;
registration remains with the previous registrar. Reports and captures are
ignored, and public documents contain no private infrastructure inventory.

Private deployment recovered a stuck shared-ingress reload by rolling the
relay back with authority intact and restarting ingress. The qualified retry
skips an unchanged ingress configuration/CA and completes HTTPS/WSS, backup
and service checks. Desktop/headless release packages and protocol are unchanged.
