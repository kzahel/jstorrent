# Tactical 254: Candidate And Pages CI Validation

Status: **Complete local repair and validation, 2026-10-02.** Hosted CI has
not run on these changes; nothing is pushed or deployed.

## Scope And Stopping Condition

Repair the two current CI failures at `f1a5f027`: candidate validation rejects
the isolated ChromeOS Android qualification override, and Pages assembly rejects
the content-hashed JSTorrent PNG emitted by the remote build. Stop after the
affected validation suites and an actual local remote/website assembly pass.

Non-goals: Android identity/build changes, engine or application behavior,
signing changes, publication, deployment, and unrelated historical CI failures.

## Invariants And Ownership

- The ordinary Android debug fallback remains `org.rstorrent.bootstrap`.
  The existing explicit qualification and legacy-upgrade overrides retain
  their Gradle guards; production identity and trust checks stay enforced.
- Every remote asset still requires a hash-shaped filename, and every file
  keeps its exact SHA-256/length manifest record. Asset type must not exclude
  legitimate Vite image/font output. HTML asset origin, build/relay identity
  and service-worker refusals remain enforced.
- Existing scripts own validation and artifact assembly. Tests own disposable
  fixture directories and remove them. No runtime tasks or dependencies change.

## Evidence And Validation

Latest CI run `36941113343` passes every executed product lane but fails
`validate-jstorrent-candidate.mjs` on its literal old debug assignment.
Website run `36941112964` builds both clients then fails assembly on
`assets/jstorrent-DjmYCpM7.png`. Both failures are reproduced/located before edits.

Required evidence: candidate positive/negative tests; Pages CLI fixtures for
hashed images/fonts and un-hashed assets, foreign HTML origins, service workers
and wrong build/relay identity; these tests run in CI; actual remote Wasm/Vite
and Astro builds with exact manifest verification; workflow lint and diff check.

Owning topics: beta-release-readiness and remote-access-authentication. Local
checks do not claim a new GitHub run or a deployed artifact.

## Completed Evidence

Candidate validation now recognizes the qualification/upgrade override chain
with whitespace tolerance and the exact ordinary debug fallback. Negative
cases still reject production defaults and wrong production identities/trust.
Pages filename validation accepts hash-named assets independently of extension;
manifest hashing, origin/build/relay checks and service-worker refusal remain.
The new Pages CLI fixture tests run in both ordinary CI and the Website workflow;
test-only changes also select the Website workflow.

Before repairs, the regression suite failed candidate acceptance and hashed
image/font assembly. After repairs, these checks pass on Node `22.23.3`, matching
the failed hosted runs:

- `node scripts/validate-desktop-release.mjs` and
  `node scripts/validate-jstorrent-candidate.mjs`.
- The exact CI `node --test` release-tools file list, including the new Pages
  suite: 63 passed, zero skipped/failed (13 candidate, 9 Pages, 41 surrounding
  desktop release/package/signature checks). The same suites also pass Node 26.
- `npm run build:remote --prefix clients/web`, with build identity `f1a5f027`
  (full SHA) and the pinned production relay: Rust Wasm, Vite and CSP gates pass.
- `npm run check --prefix website` and `npm run build --prefix website`.
- `node scripts/assemble-pages-site.mjs` with that same full build identity:
  six records, including exact failed asset `assets/jstorrent-DjmYCpM7.png`.
  Independent local SHA-256/length checks pass for every assembled record.
- `npm run typecheck --prefix clients/web`.
- `actionlint .github/workflows/ci.yml .github/workflows/deploy-website.yml` and
  `git diff --check`.

Disposable CLI fixtures are removed by test cleanup. Existing product runtime
lanes were green in the failing hosted run; no engine/platform implementation
changes require replaying them. A fresh hosted run and deployment verification
remain future evidence after an authorized push/deployment.
