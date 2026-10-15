# Tactical 367: Encrypted Short Links

Status: Complete and deployed, 2026-10-15. Maintainer-directed follow-up to
Tactical [357](357-rich-share-links.md), which left short links out because they need
server storage. Maintainer authorized end-to-end implementation, Cloudflare
deployment, commit and push on 2026-10-15; use the existing account plan without billing
changes. Native application releases remain out of scope.
Topics: `web-ui-design`, `client-persistence`, `localization`,
`mixed-version-compatibility`.

## Problem

A share link carries the whole magnet in its fragment: the info hash, name,
size, selection, peer hint and up to 32 trackers. Real torrents carry many
trackers, so the link runs to several hundred characters. The Share panel's
13rem QR code then has modules close to one CSS pixel, which phone cameras
read poorly. Trackers stay: the maintainer wants them in shared links.

The panel's "Include my address" checkbox also reads like a postal address.

## Maintainer Decisions, 2026-10-15

- Offer an opt-in short link whose server stores only ciphertext. The key
  stays in the link's fragment, so the server cannot read what was shared.
- Host it at `https://link.jstorrent.com`.
- Keep every tracker in the shared magnet. The full link remains available
  and never expires.
- Rename the address checkbox to "Include my IP address".

## Link Shape

```
https://link.jstorrent.com/#<id>.<key>
  id   10 base62 characters, assigned by the server (about 59.5 bits)
  key  22 base64url characters, a random 128-bit AES-GCM key, made by the app
```

About 61 characters: a version 4 QR code (33 modules) at low error
correction, so modules are about six times larger than today's in the same
frame.

The server assigns the id, and each id is written once. A client-derived id
(for example a hash of the key) would let anyone who holds a link compute
its id and overwrite it with a different magnet encrypted under the same
key. AES-GCM authenticates the ciphertext under the key, not the writer.

## Encrypted Record

Plaintext is the share fragment exactly as Tactical 357 builds it (the magnet
query string plus `jst.*` keys), UTF-8, then ISO/IEC 7816-4 padded (`0x80`
and zeros) to a multiple of 1024 bytes so the stored size reveals little.
Plaintext before padding is bounded at 20 KiB: the 16 KiB magnet bound plus
display keys.

```
record = version (0x01) || iv (12 random bytes) || AES-128-GCM ciphertext+tag
AAD    = "jstorrent-link-v1"
```

The record is opaque bytes to the server. One versioned codec has test
vectors shared by the client and the open page.

## Service

A Cloudflare Worker, `jstorrent-link`, in a new `services/link/` directory,
with the Workers Custom Domain `link.jstorrent.com`. It deploys separately
from the website so the website's immutable verified artifact and its CSP
are unchanged.

- `POST /v1/links`, body `application/octet-stream`: reject a body over the
  record bound (413), a wrong version byte or a body shorter than a header
  and tag (400). Generate an id from `crypto.getRandomValues`, retry on the
  vanishingly rare existing key, store with `expirationTtl` of 30 days and
  return `{id, expiresAt}`. CORS allows any origin without credentials: the
  callers are the Tauri app, local gateway origins and the hosted remote,
  and nothing the request carries is a credential.
- `GET /v1/links/<id>`: the record, `Cache-Control: no-store`, or 404. The
  id is validated before any lookup.
- `GET /`: a static open page (Workers Static Assets), CSP `default-src
  'none'; script-src 'self'; connect-src 'self'; style-src 'self'`,
  `Referrer-Policy: no-referrer`. It parses and validates `#<id>.<key>`,
  fetches the record, decrypts with WebCrypto, removes the padding, checks
  that the result contains only fragment-safe characters, and calls
  `location.replace("https://jstorrent.com/share/#" + fragment)`. The
  existing share page already treats that fragment as hostile. A missing or
  expired link says so and links to jstorrent.com; a bare visit redirects to
  jstorrent.com.
- Rate limits use the Workers rate-limiting binding per client IP: creation
  is tight (on the order of 10 a minute), reads looser. Exact values are
  set during implementation and recorded here.
- Storage is Workers KV for its native expiry. KV is eventually consistent
  across locations, but a key never read at a location is a cache miss that
  reaches central storage, and the app shows the link only after the write
  returns. Immediate global consistency is not required (maintainer
  confirmation
  2026-10-15). A lookup can temporarily report unavailable; the open page
  offers a user-initiated retry. No D1 fallback is needed for that case.
- No request logging beyond Cloudflare's defaults. Workers Logs stay off or
  sampled without bodies.

## Client

Web, in the Share panel only:

- A "Short link" checkbox, off by default, with the note "Encrypted on your
  device and stored on link.jstorrent.com for 30 days. The decryption key
  stays in the link." When checked, the panel encrypts the share fragment,
  posts it, and
  the link field, Copy, Share… and the QR code all use the short link, with
  its expiry date shown. Each distinct fragment is uploaded at most once per
  panel; toggling the IP address makes a new one only when
  checked.
- On failure the panel says the short link could not be made and keeps the
  full link. No retry loop.
- The choice is remembered as an optional `shortLink` field in the existing
  `rstorrent.presentation.share` record; missing or unreadable reads as off.
  An older client that rewrites the record drops it back to off, which is
  acceptable for an opt-in.
- Menu "Copy share link" and the magnet icon keep copying the full link.
- The web UI calls the service itself; the host is not involved, so no host
  capability or engine command is needed. CSP additions: Tauri
  `tauri.conf.json` and `tauri.dev.conf.json` `connect-src`, the website
  `_headers` `/remote/*` policy and `scripts/verify-remote-deployment.mjs`
  gain `https://link.jstorrent.com`. The locally served UI sets no CSP.

## Invariants

- The service never receives a key or plaintext; the fragment never leaves
  the browser.
- A short link resolves only to the record its creator wrote.
- No upload happens unless the user enabled "Short link", including a
  remembered enabled choice from an earlier panel.
- Decrypted content is treated as hostile and is only ever placed in the
  fragment of the fixed share page URL.
- Request bodies, ids and stored records are bounded before use.

## What The Service Can See

The creator's IP address and time, each reader's IP address and time, the
padded size and expiry. Not the content. A takedown request can only arrive
as a full link; deleting that id is the response. Abuse as a generic
encrypted paste store is bounded by the size cap, rate limits and expiry.

## Validation

- Worker: unit tests for the handler with an in-memory KV (bounds, version,
  id format, write-once, CORS, 404, headers) and a `wrangler dev` smoke.
- Codec: round trip, padding edges (exact multiples, maximum size), wrong
  key, tampered record, wrong version, shared vectors run by both test
  suites.
- Web: typecheck and tests, Share panel cases for off by default, opt-in
  creation, failure fallback, remembered choice and QR content;
  `check:localization`; a Playwright pass over the panel.
- Website: `npm test`, `check` and `build` for the `_headers` change, and
  the remote deployment verifier.
- Live: after deployment, create a link from a dev build, open it in an
  automated browser and land on the share page with
  every tracker present. Physical QR scanning is optional, not a gate
  (maintainer direction 2026-10-15).

## Outside Steps

Need the maintainer or explicit authorization: Cloudflare credentials for
deployment (local `wrangler login` and a CI `Edit Cloudflare Workers`
token), creating the KV namespace and rate-limit binding, attaching the
`link.jstorrent.com` custom domain, choosing the Workers plan (the free tier
allows 1,000 KV writes a day; Workers Paid is $5 a month), and updating
`website/public/privacy.html` before the client ships the checkbox.

## Non-Goals

- Extension companion short links: its deliberate local-only network CSP
  is retained, and its shared panel hides the short-link checkbox.
- Android short links. The Android share panel keeps the full link; a
  follow-up adds the same opt-in using the shared codec vectors.
- Revoking a link before expiry (a delete token kept by the sender).
- Recognizing pasted `link.jstorrent.com` links in the add dialog.
- Changing the share page, the magnet export or which trackers are shared.
- Accounts, analytics or link listing.

## Stopping Condition

Complete when `link.jstorrent.com` serves create, read and the open page
from a reproducible deploy, the web Share panel offers the opt-in short link
with tests, the CSPs and privacy page are updated, the address checkbox is
renamed, and an automated browser opens a generated short link on the full
share page with its content preserved.

## Implementation Decisions And Ownership

- The remembered checkbox starts off for a missing/unreadable choice; a
  saved `true` starts later panels enabled without another consent dialog.
  Current writers preserve the independent peer-hint choice.
- Short links apply only to the existing whole-torrent Share panel. File
  actions and copy menus retain their existing full-link flow.
- `services/link/src/codec.ts` owns the runtime-independent v1 format and
  fragment validation, imported by the web client and bundled open page.
  WebCrypto AES-GCM is the primitive; no cryptographic dependency is added.
- The panel owns a bounded cache of promises/results for its current
  lifetime. Its request owner times out/aborts uploads, ignores stale
  completions and terminates requests when the panel unmounts. Aborting
  cannot retract an already completed server write. No automatic POST retry.
- The Worker owns bounded request reads, per-IP rate checks and KV writes;
  no background tasks. The static page owns one abortable, timed lookup
  and a user-operated retry. Protocol/codec code depends on no UI or Worker
  storage bindings.
- KV does not offer atomic create-if-absent. IDs are server-generated,
  unselectable by callers, checked for collisions and never intentionally
  reused. Random collision protection is probabilistic, not a transactional
  write-once guarantee; a recipient cannot request an overwrite.
- Use precise disclosure: encrypted on the device, stored for 30 days, key
  stays in the link. The storage API receives neither plaintext nor key;
  the hosted decrypting page remains trusted code, as with other web crypto.
- Sources: Cloudflare KV `concepts/how-kv-works`, Worker `bindings/rate-limit`,
  static-assets `routing/worker-script`, and W3C WebCrypto AES-GCM. No external
  code or fixtures are copied. Shared deterministic vectors are authored here.

## Evidence, 2026-10-15

- `services/link`: `npm ci`/locked tooling, `npm run typecheck`, `npm test`
  (11 passed), `npm run build`; `npm audit` reports zero vulnerabilities.
  Wrangler 4.151.0 is pinned rather than the older sibling's 4.125.0, whose
  development dependencies had advisory findings. No runtime dependency.
- `wrangler dev --port 4199`: real local create/read/decrypt round trip,
  HTML/JS/CSS, CSP/referrer headers and invalid-ID checks pass. Maximum
  plaintext is 20,480 bytes, maximum record 21,533 bytes. Unit tests cover
  streamed oversize cancellation, malformed framing, rate limits, collision
  exhaustion, storage failures and authenticated hostile plaintext.
- Independently authored Node/OpenSSL v1 vector matches WebCrypto bytes in
  both suites. Padding boundaries, exact-block input, maximum input, wrong
  key, IV/ciphertext/tag/version tampering and malformed keys all pass.
- `clients/web`: `npm run typecheck`; `npm run test` (832 passed, 3 skipped);
  `npm run check:localization` (1,596 English web messages, all platform
  catalogs pass). Existing address-choice tests retain their independent
  behavior. Panel-lifetime cache: at most 16 distinct exports; each upload
  and recipient lookup has a 15-second timeout, no automatic retry.
- Playwright `tests/short-links.spec.ts` and the existing Share-panel test
  (5 passed with the live opt-in enabled):
  off by default, opt-in ciphertext upload, Copy/Web Share/QR consistency,
  cache reuse, remembered on/off, independence from IP choice, failure
  fallback, no POST retry and late completion handling pass. Axe reports no
  serious/critical panel violations. Desktop/light layout was inspected.
- Live browser (`JSTORRENT_LINK_LIVE=1`): the actual panel uploads to
  `https://link.jstorrent.com`, which decrypts and redirects to the exact
  original share URL. A second record preserves all 32 trackers, selection
  and display keys byte-for-byte. Invalid, missing and bare links, explicit
  retry and same-document fragment changes pass. A regression protects
  hash-change cancellation and prevents stale lookups from redirecting.
- `website`: `npm test` (93 passed), `npm run check` (zero diagnostics),
  `npm run build`. `clients/web` production `build:remote` succeeds with
  `VITE_RSTORRENT_REMOTE_BUILD_ID=tactical-367-validation`; CSP-safe output
  passes. `assemble-pages-site.mjs` and `verify-remote-deployment.mjs` pass
  over the exact local 42-file artifact and its `_headers` policy.
- Local OAuth account owns the active full `jstorrent.com` zone; Worker
  deployment, persistent KV namespace and custom-domain/certificate attachment
  succeed. Limits are 10 creates and 120 reads per IP/minute (Cloudflare's
  per-location approximate counters). Workers Logs disabled. Existing plan
  retained; subscription details are not readable by this OAuth token.
- Initial browser preflight during first custom-domain propagation failed;
  after provisioning settled, actual CORS and end-to-end operations passed.
  KV's eventual consistency is accepted; no immediate global guarantee.
- `.github/workflows/deploy-link.yml` validates the service and deploys main
  using existing Cloudflare secrets. Shared codec changes also trigger the
  existing website/remote deployment. Privacy disclosure is included in that
  same website artifact before the new hosted checkbox is published.
- No Rust/engine code or generated host contract changes; Rust and native
  platform builds were not run. Android opt-in remains explicitly deferred.
  No desktop/Android release, paid-plan change or phone scan was performed.

Worker version after recipient-page qualification:
`4958000c-3198-4d9d-8aea-3ca81bd4dbcf`.

Final surface audit: companion builds gate uploads and hide Short link,
including when the local profile has a saved true choice. Its ARC/native
network allowlist remains unchanged. `build:companion`, 69 extension tests
and the extension validator pass; the companion JavaScript contains no
short-link service URL. Web typecheck and all 832 web tests pass again.
