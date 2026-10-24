# Encrypted short links

`jstorrent-link` serves `https://link.jstorrent.com`. The web Share panel
uploads a bounded encrypted record; its random AES-128-GCM key stays in the
URL fragment. The open page decrypts in the recipient's browser and replaces
its location with the existing fixed JSTorrent share-page URL.

The shared `src/codec.ts` is imported by the web client and bundled into the
open page. `test-vectors.json` is independently authored using Node/OpenSSL;
both the service and client test suites check it. No external fixtures or
cryptographic library are used. The service's tooling dependencies are MIT or
Apache-2.0 (Wrangler); none ships in the client or open-page runtime.

The Miniflare-only Undici override selects 7.30.1 for its October 2026
security fixes. Wrangler's current Miniflare generation still pins 7.29.1,
including the latest published beta checked on October 24. Remove the override
when a qualified Wrangler/Miniflare upgrade selects a patched version itself.

## Development and deployment

Use Node 24 or newer:

```sh
cd services/link
npm ci
npm run typecheck
npm test
npm run dev
```

Wrangler's build command bundles the open page into `dist/`. Local development
uses local KV; it does not upload records to production. The checked-in namespace
ID is the production resource, provisioned once with `wrangler kv namespace
create LINKS` and retained across deployments. Never recreate or clear it on
upgrade. New records expire after 30 days; deployments preserve existing ones.

```sh
npm run deploy
```

Deployment needs Wrangler OAuth access to the account owning `jstorrent.com`,
or `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Workers Custom Domains
manages the subdomain and certificate. `.github/workflows/deploy-link.yml`
validates pull requests and deploys changes on main using
`CLOUDFLARE_LINK_API_TOKEN` and the existing `CLOUDFLARE_ACCOUNT_ID` secret.
The link token has Individual Workers Editor on `jstorrent-link`, plus Zone
Read and Workers Routes Write on `jstorrent.com`; it has no Pages or direct
KV access. The separate Pages deployment token is unchanged.
The Worker deploys separately from the immutable website/remote artifact.

## Limits and operational behavior

- POST `/v1/links`: `application/octet-stream`, valid v1 framing, maximum
  21,533 bytes. Returns `{id, expiresAt}` only after KV accepts the write.
- GET `/v1/links/<id>`: ten base62 characters, opaque bytes or 404.
- Per-IP rate-limit bindings: 10 creates/minute, 120 reads/minute. Cloudflare
  counters are local to each location and approximate, not global hard caps.
- API CORS is `*` without credentials. Responses and open-page assets use
  `no-store`; the open page has a restrictive CSP and no-referrer policy.
- KV is eventually consistent. A new link can briefly be unavailable at a
  recipient's location. The page offers a manual retry and never re-uploads.
- Server-generated IDs cannot be chosen or updated through the API. KV has no
  atomic insert-if-absent; collision prevention is probabilistic with a bounded
  collision check. AES-GCM detects wrong-key substitution/corruption.
- Workers Logs/observability are disabled. The Worker logs no bodies, keys,
  plaintext or IDs. No analytics or third-party code runs on the open page.
- This uses the account's existing plan. No billing upgrade is performed.
  Free quotas are account-wide; exhaustion returns a controlled failure and
  the creator retains the full link. Paid usage can incur overages.

To take down a reported link, extract only its ID and delete that KV key using
Wrangler or the dashboard; never paste the full link/key into a command log.
KV deletion propagates eventually. There is no public deletion/listing API.
Existing v1 records and the decryption codec must remain readable for at least
30 days after the last v1 creation; retain old format decoders across upgrades.
