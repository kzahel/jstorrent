# Supervised remaining-language run

The maintainer authorized execution on October 28, 2026. Tactical
[388](../tactical/388-remaining-localization-campaign.md) owns the current run.
The sixteen-locale queue, register profiles, quantity categories and System
probes live in
[`localization/campaigns/legacy-android.json`](../../localization/campaigns/legacy-android.json).
English, German and French are the shipping baseline; the remaining campaign
covers 39,664 resources at the frozen source counts (1,797 React, 20 native
desktop and 662 Android per locale).

## Owner and settings

A supervising agent drives the queue, makes proportionate corrections, runs
platform qualification and commits each finished locale. The scripts automate
frozen export, local translation/review sessions, response checks, exact imports
and resumption. They do not independently prove that a language works in a real
product. Keep at most three local model workers total and run at most one
platform/locale importer at a time. Native product and emulator tests are
serialized. The current local CLI runner supports macOS/Linux.

Use the existing local ChatGPT CLI login with `gpt-6.1-sol`, high reasoning,
normal speed and bypass permissions. The maintained runner ignores ambient CLI
routing settings, forces the ChatGPT/OpenAI route, and verifies actual rollout
evidence. Never substitute Fast, another model, an API-key provider, YA/work
pool or cloud subagent when local quota is unavailable. Keep prompts, outputs,
process ownership and checkpoints under `.local/localization-overnight`.

Do not watch remote CI unless asked again. Do not publish binaries, store
updates or websites, change signing/version identities, modify production
profiles, use arbitrary attached devices, or change global power settings.
Commit completed locales; push coherent completed cohorts using the current
session's push authorization. No force pushes, resets or broad cleans.

## Plan and resume

```bash
source scripts/dev-env.sh
python3 scripts/localization-campaign.py plan --check-env
python3 scripts/localization-campaign.py verify --check-env
python3 scripts/localization-campaign.py status
```

These commands launch no model workers. The plan freezes English source and
context plus the campaign manifest. It stores exact argv arrays for each
platform's export and local worker command. Source/profile/settings drift or
altered command arrays fail verification. An existing different plan is never
silently overwritten. Do not evaluate shell text from a JSON file; execute
reviewed argv arrays using `subprocess.run(..., check=True)`.

Status reports glossary readiness, source/content review and actual
preview/release registration separately. Registration or complete review never
substitutes for recorded platform evidence. Inspect active runner state before
resuming; never start a replacement while its previous process group is alive.
Reuse the same frozen jobs, worker directories and settings for exact resume.
Do not unlink persistent kernel lock files.

## Execution sequence

1. Confirm the three-language shipping baseline and clean ownership of pending
   files. Fix and test the known script/region System-language matching gap for
   `pt-Latn-BR`, Simplified Chinese and Traditional Chinese. Use synthetic
   locale registrations before the real catalogs exist. Preserve ordered
   language preferences, exact-match priority, unknown saved values, script
   distinctions and English fallback; do not change engine/application APIs.
2. Prepare each locale's shared glossary before exporting. Follow its explicit
   register profile; author natural target preferred terms for all nineteen
   common concepts from the existing terminology schema. Review it in a
   separate local session, bind the exact candidate/source hashes and keep
   actual model/session identities. Do not inherit German/French examples or
   pronouns. Keep reviewed future glossaries in ignored state until their
   locale becomes the active cohort.
3. Activate one locale: add its unadvertised definition and reviewed glossary,
   configure its Android debug resource destination and quantity categories,
   then export the three platforms using the plan's argv. Offline authoring
   does not require making the language selectable. Freeze jobs once; do not
   regenerate active batches or overwrite their candidate/review files.
4. Run the plan's `localization-codex.py run` commands one platform at a time.
   Normally use concurrency three, 80 resources per batch and three batches
   per worker. Reduce concurrency if another owned local task is active so
   the total stays at three. Each translator and reviewer must be distinct;
   accept only validated actual Sol/high/normal/bypass session evidence.
5. Check all three catalogs and review ledgers. Resolve every missing, stale,
   invalid, conflicting, unreviewed or terminology-affected entry through fresh
   checked jobs. Never stamp hashes current or manually bypass the importer.
   Register complete catalogs temporarily for preview qualification if needed;
   preview is an intermediate state, not the goal.
6. Regenerate React and Android LocaleConfig. Build ordinary production assets
   after promoting the candidate to release inputs, preserving all previously
   shipping languages. Move its Android catalog into `src/main`, set matching
   distribution provenance and remove its preview entry. Use the release
   browser harness below; a failed release check must remove the candidate
   from advertised shipping inputs until corrected.
7. Run real native desktop menu/product smokes and owned API 28/35 Android
   language/lifecycle/layout checks for the target. Run proportional client
   unit, catalog, formatting, lint and package checks. Verify signed release
   APK/AAB inputs with the existing signing environment and available pinned
   bundletool; never print or copy credentials into task output. Every shipping
   language must remain available offline in the base APK. Verify final
   ordinary/companion/remote output registration and CSP at cohort checkpoints.
8. Record exact evidence and limitations, commit the completed locale with
   `Topic: localization`, update the campaign table in Tactical 388, and move
   to the next locale. Do not leave a successfully qualified locale parked in
   preview. Preserve its translator/reviewer identities and all prior languages.

For a failed locale, preserve jobs, responses and evidence in ignored state.
Quarantine only that locale's owned draft files/configuration and restore the
last coherent shipping registry before continuing another independent locale.
Never reset unrelated files or discard completed worker outputs. Source-copy
changes require a deliberate plan/job reconciliation, including existing
shipping translations affected by the change.

If local quota or authentication is unavailable, stop and join owned model
workers, record the exact recoverable state and continue useful non-model QA.
Do not reroute accounts. Maintain at least 4 GiB free during the run; remove
only owned temporary artifacts, never unrelated caches/user files. Preserve
active/resumable task state until completion or an explicit handoff.

## Reusable production-browser evidence

After generating catalogs and building an ordinary frontend with preview and
pseudo flags disabled:

```bash
node clients/web/scripts/qualify-localization.mjs \
  --locale es --frontend-dir .local/localization-overnight/assets-release \
  --report .local/localization-overnight/qualification/es/browser.json
```

The harness uses bundled Playwright Chromium and its own ephemeral server,
checks the manifest's actual System-language probes, rejects preview/source
targets, confirms that only shipping languages are in the picker, excludes
pseudo-locales, and exercises switching, persistence, focus, retained selection,
plural/removal meanings and 1440px/390px Axe/layout checks. Reports bind source,
target catalog and built index hashes; browsers/servers are closed on exit.
An optional repeatable `--system-locale TAG` overrides the profile probes for
focused investigation. Never weaken the expected probes to conceal a mismatch.

Use `scripts/desktop-locale-smoke.py --locale TAG` with frozen frontend and
ordinary restore snapshots. Android's existing matrix accepts `--locale TAG`;
pass the language-selection, recreation, Compose and localization classes.
The [client guide](clients.md), [shared runbook](../../scripts/LOCALIZATION.md)
and [Android workflow](../../clients/android/scripts/LOCALIZATION.md) own full
command details. Claim Windows/Linux runtime only from corresponding evidence.

## Kickoff/resume instruction

> Supervise the remaining localization campaign in Tactical 388 to completion,
> following docs/development/localization-overnight.md and the frozen local
> campaign plan. Finish all sixteen locales across web, native desktop and
> Android, including independent review, real platform qualification, release
> registration, evidence and per-locale commits. Use only local ChatGPT Codex
> Sol 6.1/high/normal/bypass workers, at most three total. Resume existing valid
> outputs and processes before creating replacements. Keep advancing other
> independent locales around a recoverable locale failure. Preserve English,
> German and French. Push coherent completed cohorts; do not watch CI, publish
> releases, change production installations or substitute another account/model.
