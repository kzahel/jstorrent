# Tactical 361: Extension Store Publishing Setup

Status: Ready, 2026-10-15. Maintainer-authorized one-time setup, to be done
from the machine that holds the maintainer's personal Google login. The
repository side is committed (`e37d4146`); nothing in Google Cloud, the
Chrome Web Store or this repository's GitHub settings has been changed yet.
Topics: `mixed-version-compatibility`, `product-surfaces-and-migration`.

## Goal

Let an `extension-v<version>` tag test, package and submit the production
JSTorrent extension to its existing Chrome Web Store item through
[`extension-release.yml`](../../.github/workflows/extension-release.yml),
with no stored private key, exactly as Yep Anywhere does. Then release
1.1.5 through it. Workflow and scripts: see "Automated Store Releases" in
[`clients/extension/README.md`](../../clients/extension/README.md).

## Facts Already Known (non-secret)

Yep Anywhere's working setup, read 2026-10-15 from its `chrome-web-store`
GitHub environment (`kzahel/yepanywhere`):

| Variable | Value |
| --- | --- |
| `CWS_WIF_PROVIDER` | `projects/327008138211/locations/global/workloadIdentityPools/ya-chrome-store/providers/github-extension` |
| `CWS_SERVICE_ACCOUNT` | `yep-chrome-store@yep-dev-3fd5a.iam.gserviceaccount.com` |
| `CWS_PUBLISHER_ID` | `9c2ac068-8b89-4d40-93e6-d646c896c9dd` |

Its environment allows deployments only from branch `main` and tags
`extension-v*`. The Google project is `yep-dev-3fd5a` (number
`327008138211`). The provider's attribute condition pins Yep Anywhere's
immutable repository and owner IDs, the `chrome-web-store` environment
subject, its workflow's `workflow_ref`, and `main` or `extension-v*`.

JSTorrent's production item is `dbokmlpefliilbjldladbimlcfgbolhk`; its public
key is the `key` in `clients/extension/manifest.jstorrent.json`, which
`publish-store.mjs` pins. Version 1.1.5 is prepared but untagged; 1.1.4 was
submitted for review on 2026-10-13 and may still be pending.

On the machine used so far, `gcloud` has only work accounts and the active
`gh` account is `kylefit`; `kzahel` is also logged in to `gh`. Use the
`kzahel` account (for example `GH_TOKEN=$(gh auth token -u kzahel)`) and the
personal Google account. Do not change the work `gcloud` configuration.

## Steps

1. **Find the JSTorrent item's publisher.** In the Chrome Web Store developer
   dashboard (personal account), open the JSTorrent item and note which
   developer account (publisher) owns it and its publisher ID. If it is the
   same publisher as Yep Anywhere (`9c2ac068-…`), reuse everything below.
   If it is a different publisher, link the service account's email under
   that publisher's **API access** settings too, and use that publisher ID.
2. **Allow this repository in the workload identity provider.** In project
   `yep-dev-3fd5a`, either extend provider `github-extension`'s attribute
   condition or, preferably, add a sibling provider in pool
   `ya-chrome-store` for this repository. The condition should pin
   `kzahel/jstorrent`'s immutable repository and owner IDs
   (`gh api repos/kzahel/jstorrent --jq '.id, .owner.id'`), environment
   subject `repo:kzahel/jstorrent:environment:chrome-web-store`,
   `workflow_ref` `kzahel/jstorrent/.github/workflows/extension-release.yml@…`,
   and ref `refs/heads/main` or `refs/tags/extension-v*`, mirroring Yep
   Anywhere's condition. Read the existing provider first
   (`gcloud iam workload-identity-pools providers describe github-extension
   --project yep-dev-3fd5a --location global --workload-identity-pool
   ya-chrome-store --account <personal>`).
3. **Grant the identity.** Add `roles/iam.workloadIdentityUser` on
   `yep-chrome-store@yep-dev-3fd5a.iam.gserviceaccount.com` for the
   principal of this repository's environment subject only, matching Yep
   Anywhere's binding. Grant no project roles.
4. **Create the GitHub environment** `chrome-web-store` on
   `kzahel/jstorrent`: deployment policy with custom rules, branch `main`
   and tag `extension-v*`; variables `CWS_WIF_PROVIDER` (the provider used
   in step 2), `CWS_SERVICE_ACCOUNT`, `CWS_PUBLISHER_ID` (from step 1).
   Variables, not secrets: none is a credential.
5. **Verify read-only.** `gh workflow run extension-release.yml --ref main -f
   mode=check -R kzahel/jstorrent`, then read the `chrome-web-store-status`
   artifact: it should report the pinned item, its published and submitted
   versions, and a matching public key. Nothing is uploaded.
6. **Release 1.1.5.** From a clean, current `main`:
   `scripts/release-extension.sh 1.1.5`. Watch the workflow: package, live
   compatibility matrix, then publish. If 1.1.4 is still pending review, the
   publisher cancels it once and submits 1.1.5. Expected local package
   SHA-256 for this source: `5d1357431da2f737df044a337cd38a0048122a4159178589aa88b72dc89fac6f`
   (built from `8616e59a`; a later commit may change it).
7. **Record the delivery.** Add extension 1.1.5 (tag `extension-v1.1.5`,
   its commit, status `submitted`, today's date, role `client`) to
   `compat/deliveries.json`, run `node scripts/compat-capture.mjs --commit
   <sha> --roles client`, and run the live matrix for the current host
   with that client (`--host current --client <sha>`); it should pass all
   steps. Commit.
8. **Record the evidence** below and in `clients/extension/README.md`
   ("One-time setup" is then done), and in the
   `mixed-version-compatibility` topic's gaps.

## Rules

- Personal Google and `kzahel` GitHub accounts only; never the work ones.
- Use machine-control for browser steps (`machine-control agent
  instructions`); request only the scopes needed and release the claim.
- No private keys, refresh tokens or other credentials in GitHub or this
  repository.
- Stop and ask before anything not listed here, such as changing the
  extension listing, permissions or Yep Anywhere's own provider condition
  in a way that could affect its releases.

## After This

Watch 1.1.5 adoption in the dashboard's users-by-version. When most users
have it, set `strictClients.supported` to `false` in
`clients/web/src/api/release-compatibility.json`; desktop and Android
releases are then unblocked (Tactical 354's release hold).

## Evidence

None yet.
