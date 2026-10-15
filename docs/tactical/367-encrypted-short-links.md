# Tactical 367: Encrypted Short Links

Status: Proposed, 2026-10-15. Maintainer-directed follow-up to Tactical
[357](357-rich-share-links.md), which left short links out because they need
server storage. No release or production deployment is authorized by this
tactical until its outside steps are confirmed.
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

About 58 characters: a version 4 QR code (33 modules) at low error
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
  returns. D1 (strongly consistent, insert-if-absent, cron cleanup) is the
  fallback if testing shows read-after-write misses.
- No request logging beyond Cloudflare's defaults. Workers Logs stay off or
  sampled without bodies.

## Client

Web, in the Share panel only:

- A "Short link" checkbox, off by default, with the note "Stores an
  encrypted copy on link.jstorrent.com for 30 days. JSTorrent can't read
  it." When checked, the panel encrypts the share fragment, posts it, and
  the link field, Copy, Share… and the QR code all use the short link, with
  its expiry date shown. Each distinct fragment is uploaded at most once per
  panel; toggling the IP address or the selection makes a new one only when
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
- No upload happens without the user checking "Short link".
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
- Live: after deployment, create a link from a dev build, scan its QR code
  with a phone and land on the share page with every tracker present.

## Outside Steps

Need the maintainer or explicit authorization: Cloudflare credentials for
deployment (local `wrangler login` and a CI `Edit Cloudflare Workers`
token), creating the KV namespace and rate-limit binding, attaching the
`link.jstorrent.com` custom domain, choosing the Workers plan (the free tier
allows 1,000 KV writes a day; Workers Paid is $5 a month), and updating
`website/public/privacy.html` before the client ships the checkbox.

## Non-Goals

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
renamed, and a QR code scanned on a phone opens the full share page.
