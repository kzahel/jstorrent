# Tactical 382: Android Play Publication And Staged Rollout

Status: In progress, 2026-10-25. Phase 1 implemented; the maintainer
authorized agent-performed Google setup and an internal 1.0.33 release.

Topic: `beta-release-readiness`.

## Motivation

Android releases are built and signed by `android-release.yml`, attached to a
GitHub prerelease, then uploaded to Play Console by hand. Recent releases went
straight to production at 100%. There is no recorded link between a tagged
build and what Play serves, no internal-first habit and no staged rollout.

The maintainer wants the same verified bundle to move internal → production
without a rebuild, staged production rollouts (percentage steps over about a
week), and a process that is auditable and tested: a reference for revamping
release practice elsewhere. Sibling projects already publish from CI; this
port adapts their design rather than inventing another.

## Prior art

- `../babytrack`: `.github/workflows/android-publish.yml`,
  `scripts/publish_android_bundle.py`, `scripts/test_android_publishing.py`,
  `scripts/check_android_release_actions.py` and
  `docs/topics/mobile-release-signing.md` (Automated Play publication).
  Manual dispatch with tag, build run, version code, track
  (`internal`/`production`) and status (`check`/`draft`/`completed`).
  Provenance and SHA-256 verification precede Google authentication. Per-track
  main-only environments, GitHub OIDC → Workload Identity Federation, one
  app-scoped service account per track, no JSON key. One transactional edit,
  validated before commit and deleted on failure. An already uploaded version
  code is reused after its Play SHA-256 is compared, so publishing the same
  code to another track promotes the identical bundle.
- `../android-remote-access`: the internal-only predecessor of the same
  script.

Adopted: all of the above. Different here:

1. **Candidate source.** Actions artifacts expire after 14 days. The candidate
   is the tag's GitHub prerelease, which is permanent, plus a build receipt
   attached by the build workflow. Promotion weeks after the build must work.
2. **Staged rollout.** babytrack submits only `draft` or `completed`.
   Production here supports `inProgress` with a user fraction, plus set,
   halt, resume and complete.
3. **Scheduled advancement** along an approved plan, gated on Android vitals.

## Scope

- `android-release.yml` adds `build.json` (source SHA, run ID, tag, version
  code/name, AAB SHA-256) to the release assets and `SHA256SUMS`. The build job
  receives no Play credentials. A tag push never changes Play.
- `scripts/play_publish.py`, ported from babytrack, with subcommands:
  - `publish TAG --track internal|production --status check|draft|completed|inProgress [--fraction F] [--plan NAME]`
  - `rollout set F | halt | resume | complete`
  - `advance`, the scheduled step (phase 4).
- `android-play-publish.yml` (dispatch): verifies provenance, then publishes
  to the chosen track in environment `android-play-<track>`.
- `android-play-rollout.yml` (dispatch): set/resume/complete in
  `android-play-production` (required reviewer). Halt runs in
  `android-play-halt` with no reviewer, because stopping a bad rollout must
  not wait for approval.
- `android-play-advance.yml` (daily schedule plus dispatch) in
  `android-play-rollout` (main only, no reviewer).
- Pinned-action check for the privileged workflows, as in babytrack.
- Runbook (`docs/android-release.md`) and topic updates.

## Non-goals

- No automatic production publication from a tag push or a schedule. A
  scheduled job only advances a rollout a human started, along the plan
  approved at that time, or halts it.
- No tester, store listing, declaration, pricing or country management.
- No rebuild or re-signing at publication.
- No replacement of Play Console: Console actions remain valid, and
  automation defers to them (see reconciliation).
- No change to the build, signing or certificate gates in
  `android-release.yml`, beyond adding the receipt.

## Invariants

- Play receives only bytes whose SHA-256 matches the receipt, `SHA256SUMS`
  and, for an already uploaded code, Play's own bundle SHA-256.
- The receipt's source must be the tag's commit and on `main`. The run must be
  a successful tag-push `android-release.yml` run on that commit. The version
  code/name must match the tag commit's `build.gradle.kts`. All of this is
  checked before Google authentication.
- One edit per action. Validate before commit. Delete the edit on any failure
  before commit. Never retry an ambiguous commit, never fall back silently to
  draft, and never cancel an in-review change (`ERROR_IF_IN_REVIEW`).
- Refuse downgrades and replacing an unrelated draft, in-progress or halted
  release. Fractions only increase, except via halt.
- Play is the source of truth for current rollout state. If Play disagrees
  with the last recorded step (a manual Console change), automation takes no
  action and reports the mismatch.
- No response bodies, tokens or headers in logs. Every run leaves a JSON
  receipt (artifact and job summary).

## Rollout plans and state

Plans live in `clients/android/play-rollout-plans.json`. The initial plan:

```json
{"standard-7d": [
  {"fraction": 0.01, "minHours": 24},
  {"fraction": 0.05, "minHours": 24},
  {"fraction": 0.20, "minHours": 48},
  {"fraction": 0.50, "minHours": 48},
  {"fraction": 1.0}
]}
```

At production publication the chosen plan's steps are copied into a GitHub
Deployment payload (environment `play-production`, ref = tag), together with
version code and fraction. Each later step adds a deployment status. This
pins the approved plan, gives the advancer the time of the last step, and is
the audit log. Editing the plan file later does not alter a running rollout.

`advance` checks the following, and does nothing when any check fails:

1. Play's production track has exactly one `inProgress` release, at the
   recorded version code and fraction.
2. The current step's `minHours` has elapsed since the last recorded step.
3. Vitals gate (below) passes.

If all pass, it moves to the next step's fraction, or `completed` at 1.0. If
the gate fails it halts. Hold or mismatch outcomes are reported, and the run
exits non-zero only for halt and mismatch, so GitHub notifies.

## Vitals gate

Play Developer Reporting API (`playdeveloperreporting` scope),
`crashRateMetricSet` and `anrRateMetricSet`, daily, by `versionCode`.

- **Halt** if the rollout version's user-perceived crash or ANR rate exceeds
  Play's bad-behavior thresholds (1.09% crash, 0.47% ANR), or exceeds the
  previous production version's rate over the same window by a configured
  factor (initially 1.5×).
- **Hold** (do not advance) when the rollout version has fewer than a minimum
  number of distinct users in the window (initially 200), or when data for the
  window is missing. Reporting data lags about a day.

Thresholds live beside the plans and are recorded in each receipt. Before
enabling, the gate is exercised against recorded API responses only.

## Edge cases

- Google's tracks guide shows staged-rollout updates containing only the new
  release; the previous completed release keeps serving the remaining users.
  Confirm on the first real rollout (a `draft` first, then Console
  inspection) before relying on it.
- Halting a fully completed release is allowed only with an earlier completed
  fallback. The serving fallback cannot be halted. Scope halt to `inProgress`
  releases and refuse otherwise.
- A new production publication while a rollout is `inProgress` or `halted` is
  refused. Complete or halt it in Console first.
- A version code already on internal is reused, not uploaded again. A
  mismatched Play SHA-256 is an error.
- Release notes come from the tag commit's `clients/android/CHANGELOG.md`
  section (Play allows at most 500 characters per language). An optional
  dispatch override follows the same limit.
- Managed publishing, when enabled in Console, delays going live after
  approval. The receipt reports "submitted", never "available".

## Maintainer setup (phase 2, outside this repository)

Concrete identities and commands go in the private operational inventory, as
in babytrack.

1. Google Cloud: reuse the existing project and Workload Identity pool if the
   owner matches. Add a provider (or condition) restricted to this
   repository's immutable owner and repository IDs, `refs/heads/main`, the
   privileged workflow references and the exact environment subjects. Read the
   repository's OIDC subject customization first. Enable the Google Play
   Android Developer API and the Play Developer Reporting API.
2. Two service accounts, no keys:
   - testing: bound to the `android-play-internal` subject;
   - production: bound to the `android-play-production`, `android-play-halt`
     and `android-play-rollout` subjects.
3. Play Console → Users and permissions: invite both, scoped to JSTorrent
   only.
   - Testing: view app information, release to testing tracks.
   - Production: release to production (which includes app-quality viewing).
   - No financial, administration, tester or other-app access.
4. GitHub environments: `android-play-internal` (main only),
   `android-play-production` (main only, maintainer as required reviewer),
   `android-play-halt` and `android-play-rollout` (main only). Each needs
   variables `ANDROID_PLAY_WIF_PROVIDER` and `ANDROID_PLAY_SERVICE_ACCOUNT`.

## Phases and validation

1. Script, workflows, receipt and plan file, with unit tests against a fake
   Play API. The tests cover: provenance rejection, checksum mismatch, reuse of
   an existing bundle, downgrade, unrelated draft or rollout, fraction rules,
   halt/resume/complete transitions, Console-mismatch no-op, plan pinning,
   edit deletion on failure and no commit retry. Also add the pinned-action
   check, Android release script tests and workflow lint. No Google access.
2. Maintainer setup. Then dispatch `check` on both tracks: access verified,
   no change.
3. 1.0.33 (R8 enabled): publish to internal `completed`. Install from Play on
   a physical device as an update. Publish the same code to production as
   `inProgress` 0.01 with plan `standard-7d`. Inspect Console. Exercise set
   and halt/resume by hand.
4. Scheduled advancement and vitals gate, first in report-only mode for one
   rollout, then enabled.

## Progress

- 2026-10-25, phase 1: `scripts/android-play.py` (receipt, verify,
  verify-candidate, publish, rollout, advance), the three workflows,
  `clients/android/play-rollout.json` and 36 fake-API regressions in
  `scripts/test_android_play.py`. Implementation decisions:
  - Production refuses a version code Play does not already hold, so the
    promotion invariant is enforced, not just documented.
  - The ledger task is `play-release`, in environments `play-internal` and
    `play-production`. These are unprotected ledger environments, separate
    from the credential environments, so API-created deployments never wait
    on reviewers.
  - The vitals rate unit (fraction or percent) is unconfirmed. Relative
    checks hold either way; the absolute limits assume fractions. Confirm
    from the first report-only run.
  - `rollout set` at the current fraction re-records an unchanged Play state,
    which is how a Console change is acknowledged.

- 2026-10-25, phase 2: Google Cloud (`gcloud`): pool `jstorrent-play`,
  provider `github` conditioned on this repository's IDs, `main` and the exact
  workflow/environment pairs; keyless testing and production service accounts
  bound only to their environment subjects; Reporting API enabled. GitHub
  environments `android-play-internal`, `-production` (required reviewer),
  `-halt` and `-rollout` (`ANDROID_PLAY_ADVANCE_MODE=report`). Play Console
  (Machine Control browser): both accounts invited for JSTorrent only; testing
  may release to testing tracks, production to production (Google adds policy
  declaration and deep-link permissions). Identities are in the private
  inventory.
- 2026-10-25, phase 3 (internal): 1.0.33 (`f2c93a45`, R8 plus security
  updates) built by Android Release run 40185214797 with its receipt. CI on
  the bare tag commit failed the ledger check until capture commit `d940d8d5`
  recorded the tag. Because the ledger must follow the tag, exact-commit CI can
  never pass, so the verifier now also accepts main CI on a descendant changing
  only `compat/` (`b51aa0f2`). Run 40191596615 (`check`) verified keyless
  access. Run 40191672262 uploaded the bundle (SHA-256
  `d7916d95…c903e`) and released it to internal (28 → 33), recorded as
  deployment 7312851887 in `play-internal`. A second `check` read back
  internal = 33 and the bundle as held.
- 2026-10-25, physical internal check: on a Pixel 7a (Android 17) with
  Play-installed 1.0.32 and an internal-tester account, Play offered the
  update (9.7 MB download) and installed 1.0.33 with installer
  `com.android.vending`. The installed APK carries the Play app-signing
  certificate `b2b42178…d5acd5` and the single 4.9 MB minified DEX. The
  device had no prior JSTorrent state, so this is not migration evidence. The
  five WebTorrent samples (debug-menu set) were added through implicit
  magnet VIEW intents into a new SAF folder. All completed, verified and
  seeded (about 1.2 GB, 48 files), and a repeated add reported
  `already_present`. Library listed the videos and WIRED CD tracks, Sintel
  played in PlayerActivity, and a force-stop restart restored all five.
  Logcat showed no crash or reflection errors.
- 2026-10-25, phase 3 (production): on the maintainer's direction, run
  40194717239 promoted the same version code to production as `inProgress`
  0.5 with plan `standard-7d`. The maintainer-directed approval went through
  the `android-play-production` gate. The publisher reused Play's bundle
  (`uploaded: false`, same SHA-256); the previous version was 32; ledger
  deployment 7313309465 is in `play-production`. Play Console shows 1.0.33
  "In review, staged rollout at 50%" while 32 stays "Available on Google
  Play, full rollout". This confirms the edge case: a staged-rollout update
  naming only the new release keeps the earlier completed release serving
  everyone else. A report-mode advance run read the track through the
  production account: `waiting`, next 1.0 due 2026-10-27T12:48Z. Play
  approved the release about 14 minutes after submission; Console shows it
  "Available on Google Play, staged rollout at 50%".
- 2026-10-25, phase 4: the maintainer enabled `ANDROID_PLAY_ADVANCE_MODE=act`.
  Snapshot runs found the vitals gate unusable as designed. The Reporting API
  returned no crash or ANR rate rows for any JSTorrent version over 21 days,
  because the app is below Play's publication threshold (Console shows 0-1
  crash events a day). Daily rate freshness also lagged eight days (ending
  2026-10-17). The rate gate would therefore hold forever. Offered time-only
  advancement, report counts or manual completion, the maintainer chose
  report counts. When Play has no rates even for the previous version, the
  gate now reads `errorCountMetricSet` (DAILY, `versionCode` x `reportType`)
  and compares summed affected users for CRASH and APPLICATION_NOT_RESPONDING
  against the previous version scaled to the rollout share. It halts above
  max(3, 2x). Rates stay authoritative when published. The first real
  snapshot passed: 147 rows, with 1.0.32 at 3 crash user-days and 1.0.33 at
  none. The fraction-or-percent rate unit question is moot while JSTorrent
  has no published rates; confirm it if rates ever appear.

## Stopping condition

1.0.33 reaches 100% production through the workflows, from the same bundle
first served on internal. Each step has a deployment record and a receipt.
The advancer has run in report-only mode against a real rollout. The runbook
describes the routine, and the manual-upload instructions are retired.
