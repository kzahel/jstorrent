# 388 — Remaining localization campaign

Status: **Active.** Preparation passed; the maintainer authorized supervised
overnight execution on October 28. Local glossary and platform work follows.

## Scope and stopping condition

Run a supervised overnight campaign for the sixteen remaining locales in
the previous TypeScript Android client: `es`, `it`, `pt-BR`, `nl`, `sv`, `da`,
`cs`, `pl`, `ro`, `ru`, `uk`, `tr`, `ja`, `ko`, `zh-CN` and `zh-TW`. English,
German and French are the completed baseline. Each locale covers the shared
React UI, native desktop shell and Android; iOS, website/store/support copy,
release publication and changes to installed production applications are out
of scope.

Carry forward the maintainer's local subscription settings: `gpt-6.1-sol`, high
reasoning, normal speed and bypass permissions. Do not use a YA/work account,
API-key provider, cloud delegation or Fast tier. Reuse the maintained local
worker runner and checked importer rather than introducing another executor.

Preparation produces a reviewed locale inventory and register/plural profiles,
a source-bound campaign plan/status command, a reusable production-browser
qualification harness and a self-contained kickoff/resume runbook. No new
locale becomes selectable and no translation is launched by preparing or
inspecting a plan. The supervisor remains responsible for glossary preparation,
platform qualification, corrections and per-locale commits. Do not describe
translation completion as full product qualification.

Campaign completion means each locale's three current catalogs are complete
and independently reviewed, real locale checks pass, release registration and
Android resource packaging are verified, evidence is recorded and the locale
is committed. A failed locale remains pending while other independent locales
continue; never label preview-only work finished. Do not wait on remote CI
unless the maintainer asks again.

## Invariants and resource bounds

- Freeze English source/context hashes in the local plan. Changing those
  inputs invalidates the plan; never rewrite worker output hashes to conceal
  drift. Existing export/import checks own per-message freshness.
- At most three local model workers total. Run one platform/locale runner at a
  time with at most three workers, 80 resources per batch and three batches per
  worker. Translation and independent review always use different sessions.
- One importer per platform/locale, one native product smoke and one owned
  Android emulator session at a time. Reuse process ownership, cancellation,
  bounded logs and exact resumption from Tactical 387.
- Keep account routing, signing material, task logs, plans and response paths
  in ignored local state. Commit only source, catalogs, review provenance,
  tools and useful evidence summaries. Preserve existing user preferences and
  shipping translation/review records.
- Prepare language-specific register and terminology before exporting jobs.
  Android quantity profiles are checked against the runtime's CLDR categories
  and must additionally pass Android resource lint and API 28/35 execution.
  Never copy German examples or plural branches to another language.

## Known qualification work

Chinese needs explicit region/script System probes. Existing RFC 4647 parent
lookup does not equate `zh-Hans-CN` with `zh-CN`, or `zh-Hant-TW` with `zh-TW`.
The campaign must resolve and test that presentation-only matching gap before
claiming Chinese System-language qualification. Keep Simplified and Traditional
separate, and do not solve it by silently selecting the wrong script.

Brazilian Portuguese must retain its regional identity, including a maximized
`pt-Latn-BR` System request. Slavic/Romanian/Czech
quantity categories and Chinese/Japanese/Korean single-category quantities
need real native-resource checks. A large language picker must keep its actions
reachable; do not rely solely on the earlier three-language layout evidence.

## Validation

Test stale-plan detection, exact legacy inventory, locale/path/quantity
validation, immutable model settings and status that cannot confuse reviewed
catalogs with qualified release inputs. Exercise the generic browser harness
against current German and French production assets, including actual System
selection, switching, persistence, focus, destructive copy and narrow layout.
Run existing catalog/registry/workflow checks and proportional client checks.
Record exact commands, preparation gaps and the final kickoff instructions.

## Execution checkpoints

German release qualification is committed as `582a0baf`; all 2,479 German
resources retain their exact translation and review records. The release
registry now exposes English, German and French across React, desktop and
Android. The earlier source count and first-party provenance remain unchanged.

The campaign plan matches all eighteen old translated Android locale files
and excludes the English/German/French baseline from new authoring. It binds
the three English source catalogs, native comments, English glossary and
sixteen-locale manifest, and reports 39,664 resources. Read-only environment
preflight found the local ChatGPT CLI login, Node, Rust, Java, ADB, emulator and
over 100 GiB free without starting a model session.

Preparation tests: six campaign regressions, all 61 shared workflow cases,
three browser-harness argument cases, thirteen registry/fast-CI routing checks,
web typecheck and all 928 web unit cases pass (three existing skips). The reusable browser
harness passes seven cases each for German and French against actual ordinary
production assets with regional System probes, pseudo exclusion, exact shipping
picker membership, switching/persistence/focus and narrow destructive dialogs.
It closes its bundled Chromium and ephemeral server and writes hashed evidence.

On authorization, one owned local supervisor started at most three auxiliary
workers: regional-matching implementation plus terminology authors/reviewers.
Glossary jobs freeze all nineteen semantic concepts and each locale's register;
independent reviews bind the exact candidate and source hashes. Actual CLI
rollout settings are checked before acceptance. Completed future glossaries
remain ignored until that locale's active cohort, avoiding incomplete shipping
registration. No remote CI watching or release publication is part of the run.

| Locale | Terminology | React / desktop / Android | Qualification / release |
| --- | --- | --- | --- |
| es | Reviewed | Pending | Pending |
| it | Reviewed | Pending | Pending |
| pt-BR | Authoring | Pending | Pending |
| nl | Authoring | Pending | Pending |
| sv | Queued | Pending | Pending |
| da | Queued | Pending | Pending |
| cs | Queued | Pending | Pending |
| pl | Queued | Pending | Pending |
| ro | Queued | Pending | Pending |
| ru | Queued | Pending | Pending |
| uk | Queued | Pending | Pending |
| tr | Queued | Pending | Pending |
| ja | Queued | Pending | Pending |
| ko | Queued | Pending | Pending |
| zh-CN | Queued | Pending | Pending |
| zh-TW | Queued | Pending | Pending |
