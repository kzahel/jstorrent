# 383 — Android translation cohorts

Status: **Implementation in progress.** The maintainer authorized the German
pilot, in-app switching and Pixel 7a review on 2026-10-25, with incremental
commits. Release locale support remains English during the debug pilot.

## Motivation And Recommendation

Start translating the Android product without waiting for final English copy.
The extraction foundation already exists under Tactical 204. The next work is
translation authoring, validation, maintenance and qualification. English edits
must produce small, explicit translation deltas instead of requiring a copy
freeze or a full retranslation.

Keep Android string resources, quantities and platform locale resolution.
Reuse the legacy workflow's ideas: terminology context, per-language batches,
structured agent output, deterministic imports and incremental updates.
Reimplement the small tooling rather than transplant its scripts unchanged.

The maintainer's October 25 direction establishes agent translation and
independent agent review as the review policy, and includes an in-app language
picker defaulting to System language. Native-speaker review is optional
additional feedback; German and French human review is planned. No non-English
locale or picker is enabled by this investigation alone.

## Investigation Evidence — 2026-10-25

Current source:

- `clients/android/app/src/main/res/values/strings.xml`: 639 strings and 28
  plural resources; eight strings are nontranslatable, leaving 659
  translatable resources (631 strings and 28 quantities).
- The catalog checker passes: 667 Android English resources, 1,632 web
  messages, 20 desktop messages, 189 iOS product messages and six Info.plist
  messages. Only `node scripts/check-localization.mjs` was run; no Android
  build, instrumentation or installed-locale qualification was performed.
- `LocalizationInstrumentationTest.kt` and `LocalizationComposeTest.kt`
  already exercise pseudo resources, plural/notification configuration and
  Compose presentation. `clients/android/scripts/run-localization-matrix.py`
  owns fresh API 28 phone and API 35 tablet AVDs.
- `localization/locales.json`, `locales.schema.json` and
  `scripts/check-localization.mjs::checkPolicy` currently require English-only
  support. The Android checker examines the English catalog, not translation
  completeness, staleness or cross-locale placeholder equality.
- The Android manifest supports RTL but has no `android:localeConfig`.

Legacy checkout: `jstorrent-typescript` at
`6d1cf807e2c80a1667f1ad18163f8391e0005d9c`. Paths inspected:

- `android/scripts/translate/{README.md,translate_common.py,translate.py}`;
- `translate-match.py`, `translate-prompt.py`, `translate-llm.sh` and
  `translate-merge.py` in that directory;
- `tier1-languages.txt`, `claude/*.json`, English and translated Android XML;
- `LICENSE.md`; and
- local LibreTorrent `LICENSE.md`, Transmission `COPYING` and qBittorrent
  `COPYING`, as origin-audit leads rather than permission to import strings.

The legacy English catalog has 457 strings and no plural resources. There are
18 translated locale files, each containing 345 strings. Its README's older
353-string baseline is not the current catalog. Locale qualifiers are `cs`,
`da`, `de`, `es`, `fr`, `it`, `ja`, `ko`, `nl`, `pl`, `pt-rBR`, `ro`, `ru`,
`sv`, `tr`, `uk`, `zh-rCN` and `zh-rTW`.

Only three translatable resource IDs overlap with the current catalog.
Comparing trimmed, case-insensitive XML-decoded English text finds 132
current string candidates; 116 have at least one corresponding entry in
each legacy translated file. Thus 543 of the 659 current resources have no
candidate in those files. These are inventory leads, not approved reuse:
the comparison does not establish context, origin, Android escape equivalence
or placeholder compatibility. All 28 current quantities need plural-aware
work. No translation or script source was imported.

## Lessons And Deliberate Differences

1. **Match meaning, not just English.** Legacy `dialog_remove_confirm_button`
   says “Remove” but is manually mapped to LibreTorrent `delete`; its German
   output is “Löschen.” Current `action_remove` preserves data and is distinct
   from `action_delete_data`. Likewise a Done button is not a completed
   torrent status. Exact and fuzzy matches are suggestions requiring review.
2. **Detect changed source.** Legacy `get_diff_strings` checks key presence
   only. Store a fingerprint of English text, resource kind, plural branches,
   formatting signature and translation-relevant context. A changed source
   invalidates approval for that message, even when its key stays the same.
3. **Support real plurals.** The legacy parser/writer handles only strings.
   Export quantity resources and accept the target locale's plural categories;
   do not require every language to copy English `one`/`other`. Define allowed
   arguments, types and meanings per quantity resource; target categories do
   not map one-to-one to English branches. Allow legitimate count omission
   without requiring identical placeholder sets across every branch.
4. **Make corrections effective.** Legacy merge always prefers existing XML,
   even when that XML came from a previous model run. Imports need explicit
   review/override precedence and must reject stale source revisions.
5. **Validate before replacing files.** Legacy generation saves JSON before
   warning about keys/specifiers and compares completeness by count. Reject
   duplicate, unknown, missing, wrong-type and stale entries; validate exact
   requested keys and placeholders before an atomic import. Android resource
   compilation remains necessary beyond generic XML parsing.
6. **Keep origin evidence.** Generated legacy XML discards per-string source
   labels and mixes upstream, manual and model text. The sibling's MIT license
   alone does not resolve the terms of borrowed translations. Audit the exact
   originating files/revisions and obligations before reuse. Independently
   authored translations are a practical alternative when origins are unclear.

## Proposed First Slice

Start with German as the first complete locale, so maintainer spot checks can
exercise the workflow before it scales. The implementation sequence is:

1. Build reusable export/import/check tooling with source fingerprints,
   plural support, terminology context and validated deterministic imports.
   Include a Polish or Russian plural fixture so the importer is not limited
   to German's two categories. Set the German register and terminology before
   bulk translation (proposed informal `du`, `Entfernen` versus `Daten löschen`).
2. Use that tooling for the German catalog, with agent translation and a
   separate agent review. Incorporate human spot-check corrections through
   the same import/metadata workflow.
3. Exercise System language / Deutsch switching, persistence, restart and
   return to the system default in the pilot build.
4. Once the pipeline and German pilot pass, run additional locale jobs using
   the same infrastructure. German is the pilot, not a German-only design.

Scope: Android catalogs, offline repository tooling and an in-app language
picker for locale testing and ordinary use. No engine, application contract,
database migration, hosted translation service, runtime catalog fetching,
translation runtime dependency, web/iOS translation or store publication.

- Keep English and translated Android XML as the platform catalog authority.
  Add sidecar metadata for source/translation fingerprints, origin and review
  state. Agent JSON is an exchange format, not a second runtime catalog.
- Add bounded export, import and check commands. Report missing, stale,
  obsolete, conflicting and invalid entries separately. Derive work from the
  current source; respect `translatable="false"` and retain translator context.
- Export locale jobs with stable IDs, actual English, comments, argument
  meanings, glossary and screen/call-site context. Include legacy candidates
  only with their unresolved provenance/review status clearly identified.
- Import validated responses deterministically and preserve reviewed manual
  corrections. Remove obsolete localized resources through an explicit checked
  cleanup; preserve useful origin/review history in metadata as appropriate.
- Make supported locales platform-specific: Android gaining German must not
  imply that web, desktop or iOS supports German. Separate draft/test locales
  from release-qualified locales in the manifest, schema and checker. Keep
  draft catalogs outside release resource inputs, or in a debug-only source
  set, until promotion. An English-only advertised list does not prevent
  Android from resolving translated resources packaged in `src/main/res`.

Stopping condition: one end-to-end locale pilot can export, receive a draft,
validate/import, detect an English edit under an existing ID, reject stale
results and prune a removed resource. The pilot build can switch between
System language and its test locale in-app, remember the override across
restart and clear it to follow system changes, while release support remains
English.

## Agent Workflow And Cohort Qualification

Use one translator per locale, with coherent screen batches if needed, and a
separate reviewer. A useful starting bound is two or three concurrent jobs and
40–80 messages per batch; measure overhead and adjust. Agents write isolated
job outputs. One importer owns the XML and metadata, preventing shared-file
races. Give every job a source revision/fingerprint and record its actual
provider/model, not merely a requested alias. Cancel or reject obsolete jobs;
completed invalid output never changes the catalog.

Review terminology across the locale before integration. Give destructive
actions, permissions, address/privacy disclosure, background behavior and
repair/reset flows focused review. An independent agent reviews every
translated message; record its actual model, source fingerprint and review
outcome. Agent review satisfies the translation-review requirement without
claiming native-speaker approval. Incorporate optional human feedback when
available, with German and French review planned. Neither English copy polish
nor native-review availability blocks translation or locale qualification.

The old 18-language list is a useful draft backlog, not audience evidence or a
promise to release 18 locales together. Start with one complete pilot, then
prioritize qualified cohorts using actual audience and review capacity. Budget
roughly 11,862 source-resource/locale pairs for all 18 before approved reuse;
quantity branches and independent review add work beyond this simple count.

## In-App Language Selection

Include **Settings → Language**, defaulting to **System language**. Offer
English and the build's available translations, using native language names
so the picker remains usable after switching. Remember an explicit selection
across launches. System language clears the override instead of saving the
currently resolved language, so later OS language changes are followed.

Android 13+ in-app selection and system per-app language settings must use the
same platform locale owner, without a conflicting shadow preference. Support
the picker on API 28–32 too, with local UI preference storage and no engine or
synced setting. Apply locale changes through configuration-aware resources
across Compose, activities, services and notifications. Activity recreation
must preserve navigation and in-progress UI state without restarting the
engine or interrupting transfers.

The current app uses `ComponentActivity` and has no AppCompat dependency;
legacy `SettingsViewModel.setAppLocale` uses `AppCompatDelegate` with
`AppCompatActivity`. Do not copy that setter alone. Settle the compatibility
owner and any required activity/theme/dependency changes as part of the picker
implementation, using the platform language guidance below.

Release pickers expose only release-qualified packaged locales. Debug builds
may additionally offer clearly identified draft/test locales and generated
pseudo-locales for testing; release resources and language lists exclude them.
Test explicit override, restart, return to System language, subsequent OS
language changes, and Android 13+ changes from system app-language settings.

Android's native quantity and language guidance:

- <https://developer.android.com/guide/topics/resources/string-resource>
- <https://developer.android.com/guide/topics/resources/app-languages>
- <https://developer.android.com/guide/topics/resources/pseudolocales>

Before enabling a locale for release, run catalog/placeholder/plural/staleness
checks, Android resource compilation, lint, relevant JVM/instrumentation tests,
the API 28/35 layout matrix and actual-locale lifecycle/notification checks.
Include language change, Activity recreation, restart/reconnect, long copy,
accessibility, and RTL when applicable. Confirm release packaging/advertised
languages agree and update Android disclosure only for packaged support.

## Agent Investigation Outcome

A separate read-only agent audited the legacy scripts and confirmed the
semantic collision, missing changed-source detection, plural omissions,
merge precedence and provenance gaps above.

The local YepAnywhere API can launch the requested Opus pilot. Earlier pool
launch attempts sent the UI alias `opus` directly; router admission expects
the concrete catalog ID `claude-opus-5-5`. Comparing admission decisions
confirmed that the alias was unavailable while the concrete ID was eligible.
A corrected read-only pilot launched successfully, with session metadata and
actual assistant messages confirming Opus 5.5, high effort, bypass-permissions
mode and weekly-pace routing through the requested pool. The job completed
with German action, disclosure and plural samples plus a sequencing review;
the samples were not independently reviewed or imported. Its process was
stopped after completion, retaining the session transcript. No account or pool
configuration change was needed. No credentials or private router inventory
belongs in this repository.
