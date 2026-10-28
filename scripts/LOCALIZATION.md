# Shared translation workflow

`scripts/localization.py` is the offline command front door for `android`,
`web` (the shared React UI) and `desktop` (native tray/dialog/notification
strings). Android retains its tested native-resource adapter. React keeps
ICU descriptors; native desktop keeps its simple named-placeholder JSON.
Translation JSON is an exchange format, never a second runtime catalog.

The tool uses the Python standard library and the repository's already pinned
FormatJS parser through `localization-icu.mjs`. Install locked web dependencies
before using the React adapter. Nothing fetches catalogs at application runtime.

## Register the next language

`localization/locales.json` is the shared product registry. `localeDefinitions`
provides direction for canonical locale tags; each platform's `supportedLocales`
and `previewLocales` lists decide what is available. Defining a locale does not
by itself enable it. Native desktop shipping locales must also ship in React;
native previews require matching React registration. Current product support
remains English, with German previews only.

For French (or another language), land one complete locale cohort:

1. Add its canonical tag and `direction` (`ltr` or `rtl`) to
   `localeDefinitions`. Regional/script tags such as `fr-CA` are supported;
   negotiation tries the exact tag and then its registered parents.
2. Create `localization/terminology/<tag>.json` with `schemaVersion: 1`, the
   matching `locale`, a nonempty `register` string, and a `terms` object.
   Choose pronouns, formality and wording explicitly for that language; do not
   copy German's du instruction. Populate shared concepts from the English
   glossary with that language's preferred wording and semantic exceptions.
   This existing format is the only locale-specific translation guidance.
3. For Android, add an entry in `localization/android/locales.json` containing
   its debug resource `catalog` path and required `quantities`. Choose plural
   categories for the target language/platform, rather than copying German's
   categories. Android's picker already reads generated native LocaleConfig.
4. Export, translate, independently review and import all desired platforms
   using the commands below with the new tag. Offline authoring works before
   making the locale selectable. Complete reviewed native catalogs and the
   per-message ledgers before the registration/qualification commit.
5. Add the tag to the desired `previewLocales` platform lists and record an
   `agent-reviewed`, MIT first-party translation row per platform in
   `localization/provenance.json`, with `distribution: "debug-preview"` and a
   pointer to its actual model/session review ledger. No native-speaker gate.
6. Generate and check:

   ```bash
   npm run generate:localization --prefix clients/web
   node clients/android/scripts/check-locale-config.mjs --generate
   node scripts/check-localization.mjs
   ```

   React's generated `catalogs.ts` owns typed registration and explicit catalog
   imports. Native Cargo builds validate the same registry and generate their
   catalog table into `OUT_DIR`. Vite watches the registry and registered
   sources. No per-language runtime switch or catalog-loader edits are needed.
   Stale/unregistered generated JSON is excluded from imports. CI checks both
   generated output freshness and catalog/review completeness.
7. Build previews and check real typography, number/date formatting, plural
   cases, System/default behavior, explicit switching, persistence, keyboard
   focus and RTL where relevant. The desktop product smoke accepts
   `--locale <tag>` with the preview and ordinary restore asset snapshots; see
   [client validation](../docs/development/clients.md). Test Android on an
   explicitly owned target. The fixture tests prove registration mechanics;
   they do not qualify a real language's wording or layout.

Existing QA examples default to German; pass the new tag for its actual review.
Unregistered languages fail before the native smoke starts Cargo. Missing
registered catalogs fail generation rather than silently advertising them.

Release promotion is a separate explicit change: update the platform shipping
lists, remove the corresponding preview entries, mark provenance as `release`,
and move Android resources/configuration to release inputs. Validate those
release packages and fallback behavior. Preview provenance cannot silently
qualify a shipping locale; changing the preview build flag does not ship one.

## Source snapshots and shared terminology

Shared locale terminology lives in `localization/terminology/<locale>.json`.
It specifies register, preferred terms, meanings and exceptions. Android's
per-platform configuration now contains only destination/plural information;
the German wording guidance is shared with desktop and React.

Each message records separate source, translation and terminology fingerprints.
Terminology fingerprints cover register and the terms/English glossary entries
matching its source or translator context. Changing an unrelated term leaves
the message alone; changing an applicable definition, preferred term or register
requires review. Term matching determines review impact, not automatic text
replacement: reviewers choose natural inflections and context-specific wording.

Existing Android translations retain their original author/review evidence.
Their new terminology evidence must be explicitly adopted after independent
review; metadata is not silently stamped current during a read or export.

## Export, translate and independently review

```bash
python3 scripts/localization.py export web de --batch-size 80 \
  --out-dir .local/translations/web
python3 scripts/localization.py export desktop de --batch-size 80 \
  --out-dir .local/translations/desktop
python3 scripts/localization.py export android de --batch-size 80 \
  --out-dir .local/translations/android
```

Export normally selects missing, stale, conflicting, invalid, unreviewed or
terminology-affected entries. `--all` includes every current message. Batch size
is 1–100. Jobs carry source comments, argument contracts, shared terminology,
current translation hashes and Android same-English suggestions. Suggestions
are context, not permission to reuse an ambiguous meaning automatically.

Every requested resource must appear exactly once in the response:

```json
{
  "schemaVersion": 1,
  "platform": "web",
  "locale": "de",
  "resources": {
    "message.id": {
      "sourceHash": "copy the exact exported hash",
      "terminologyHash": "copy the exact exported hash",
      "kind": "icu",
      "translation": "German text with {name}"
    }
  }
}
```

Kinds are `icu`, `named`, or Android `string`/`plurals`. Return raw human text,
not XML-escaped text. Preserve ICU argument types, number/date styles, selector
cases, plural offsets/exact-number branches and supplied rich-text tag names.
Use target-language plural categories; German cardinal has one/other and
German ordinal has only other. Native desktop named placeholders keep the
exact source names. Android positional formats and target quantity categories
retain their existing checks.

The YA runner requires an explicit `--locale` and nonempty locale register
guidance in each exported snapshot. Translation and terminology-review prompts
use that snapshot, including pronouns/formality and target plural rules; no
German default is applied to other languages. Changed/mismatched guidance is
rejected before starting workers.

Assign a separate reviewer who checks every translated message against source,
context, arguments, suggestions and shared terminology. Record actual model and
session identities. Human review is optional additional feedback.

## Validate and import

```bash
python3 scripts/localization.py validate-job web de --job JOB.json
python3 scripts/localization.py validate-response web de \
  --job JOB.json --response REVIEWED.json
python3 scripts/localization.py import web de \
  --job JOB.json --response REVIEWED.json \
  --translator model/translation-session --reviewer model/review-session
python3 scripts/localization.py check web de
```

One importer owns catalog writes. The entire response is validated before
either native catalog or metadata is replaced. Each file is atomically replaced;
an interruption between them becomes a detectable hash conflict. Metadata lives
under `localization/<platform>/<locale>.json`. React descriptor descriptions
come from the current English source; IDs remain separate across contexts.

`validate-job` checks current English/context/arguments and terminology but
ignores target translation revisions, allowing a resumable runner to check
already-imported jobs. Normal imports reject changed translations. A runner
may pass `--idempotent` only to recognize an exact previously imported response:
current values, source/term hashes, review state and both session identities
must all match. It cannot conceal a manual correction or glossary/source edit.

## Review terminology for existing translations

```bash
python3 scripts/localization.py terms-snapshot android de \
  --out .local/translations/android-terms.json
# Independently review every snapshot entry, resolving corrections first.
python3 scripts/localization.py adopt-terminology android de \
  --snapshot .local/translations/android-terms.json --reviewer model/session
```

Adoption records a separate terminology reviewer/hash and preserves original
translation author/reviewer fields. It rejects snapshots whose source,
translation or applicable terminology changed, and refuses to substitute for
missing source/content review. When an audit proposes corrections, its unchanged reviewed subset may be
adopted with that reviewer identity after retaining only unchanged snapshot
rows. Each row must still match current source, translation and terms.
Corrected translations go through ordinary export/review/import; never stamp
proposed wording current merely because an audit suggested it.

`prune PLATFORM LOCALE` removes obsolete catalog entries explicitly and keeps
their origin in metadata's retired history. Never rewrite old response hashes
to hide changed English or terminology. Export a fresh job instead.

Run the global localization checker, native catalog compilation and relevant
platform tests after imports. The English-only release manifests and separate
preview gates still determine what is packaged or selectable in each product.

## Run reviewed jobs through YA

For the maintainer's local ChatGPT Codex allowance, use the direct local runner
instead. It starts separate translation and review CLI sessions, with an explicit
model, high reasoning by default and normal speed only:

```bash
python3 scripts/localization-codex.py run --platform web --locale fr \
  --jobs .local/translations/fr/web --work-dir .local/translations/fr/web-run \
  --model gpt-6.1-sol --effort high --service-tier normal \
  --concurrency 2 --jobs-per-worker 3 --import-reviewed
python3 scripts/localization-codex.py status \
  --work-dir .local/translations/fr/web-run
```

The direct runner currently supports macOS/Linux process ownership. It requires
an existing local ChatGPT CLI login and never selects a YA pool or
API-key provider. Personal configuration is ignored for these workers; the
model, reasoning, standard service tier and permission settings are explicit.
Actual rollout metadata must match before accepting any response. Configuration
keys follow the [official Codex reference](https://learn.chatgpt.com/docs/config-file/config-reference).
Add `--permission-mode bypassPermissions` only when explicitly authorized;
otherwise workers use a workspace-write sandbox with no approval prompts.
No persistent user configuration is changed.

`Ctrl+C`/SIGTERM stops and joins owned worker process groups. Resume the same
command to reuse completed, hash-bound work and revalidate exact imports.
Another runner for the same platform/locale is refused; if a prior owner was
killed without cleanup and a recorded worker is still alive, stop that owner
before resuming. Invalid results fail the run for inspection rather than
starting an unbounded retry loop. Keep aggregate concurrency at most three
when running multiple platforms. Session logs and routing paths stay ignored
under `.local/`; only reviewed catalog provenance is committed.

The YA runner remains available for explicitly selected Claude pools:

Start the local YA service separately. Select a pool by its visible name;
account IDs and routing decisions are discovered at runtime and are never
committed. This runner currently supports Claude-provider pools. For example:

```bash
python3 scripts/localization-ya.py run --platform web --locale de \
  --jobs .local/translations/web --work-dir .local/translations/web-run \
  --pool WORK_POOL_NAME --policy weekly-pace --model opus --effort high \
  --concurrency 2 --jobs-per-worker 3 --import-reviewed
python3 scripts/localization-ya.py status --work-dir .local/translations/web-run
python3 scripts/localization-ya.py cancel --work-dir .local/translations/web-run
```

The default endpoint is `http://localhost:3400`. Pass `--endpoint` for another
local service and `--permission-mode bypassPermissions` only when that mode
is explicitly authorized. The default is `acceptEdits`. Model aliases must
resolve unambiguously to a concrete model available in the selected pool.
Actual model, effort and session evidence is checked before accepting files.

Each worker handles at most four batches of at most 100 messages. Translation
and independent review use different sessions and output directories. Workers
validate files without importing; the runner stops owned processes and imports
only after all reviews pass. Resume the same command after interruption:
validated outputs are reused, changed source/terms/exported jobs or reviewed
files are rejected, and exact completed imports are recognized. Use a new work
directory for a new snapshot. Work state and outputs must live in ignored
`.local/`; retain them until checks and imports finish, then clean up owned
workers and temporary artifacts. Do not run two owners over the same work dir.

Terminology-only review is also repeatable:

```bash
python3 scripts/localization.py terms-snapshot android de \
  --out .local/translations/android-terms.json
python3 scripts/localization-ya.py terms-review --platform android --locale de \
  --snapshot .local/translations/android-terms.json \
  --work-dir .local/translations/android-terms-run \
  --pool WORK_POOL_NAME --policy weekly-pace --model opus --effort high \
  --adopt-terminology
```

Automatic adoption requires approval with no corrections. Proposed changes must complete ordinary translation/review/import. An operator
may separately adopt only the audit's unchanged reviewed subset as described
above. A terminology attestation cannot replace source/content review.

## Continuous checks

Full and fast web CI run the global catalog checker and the shared/runner plus
Android adapter tests. Catalog, terminology and offline workflow edits select
the web lane without forcing Rust engine or unrelated product builds. Native
source and platform packaging retain their existing broader checks. German
browser/pseudo cases run through the normal deterministic browser suite.
