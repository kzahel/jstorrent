# Android translation tooling

`localization.py` is an offline Python standard-library tool. English XML and
translated Android XML are the text authorities; per-message sidecars under
`localization/android/` record source/translation fingerprints and review
provenance. JSON jobs are exchange files, not runtime catalogs.

The initial German catalog is a debug-only preview. Its destination and plural
categories are configured in `localization/android/locales.json`. Adding a
language here does not qualify it for release or advertise it in the picker.
Keep that configuration aligned with the repository locale manifest.

## Export and translate

From the repository root:

```bash
python3 clients/android/scripts/localization.py export de \
  --batch-size 60 --out-dir .local/383-localization/jobs
```

Export normally selects missing, stale, conflicting, invalid or unreviewed
resources. `--all` exports the complete current catalog, including existing
translations for context and correction. Source text, translator comments,
argument contracts, locale guidance and the shared glossary accompany each
job. Fingerprints change when source text, kind, quantities, formatting or
resource context changes, even under an existing resource ID.

Give each job to a translating agent, then a separate reviewing agent. Both
receive the current source and UI context. Each response has this exact shape:

```json
{
  "schemaVersion": 1,
  "locale": "de",
  "resources": {
    "action_remove": {
      "sourceHash": "copy the job's exact sourceHash",
      "kind": "string",
      "translation": "Entfernen"
    },
    "file_count": {
      "sourceHash": "copy the job's exact sourceHash",
      "kind": "plurals",
      "translation": {"one": "%1$d Datei", "other": "%1$d Dateien"}
    }
  }
}
```

Return **every requested key and no additional keys**, with the original hash
and kind. Text is raw JSON string content: do not pre-escape Android
apostrophes, ampersands or XML. Ordinary JSON escaping still applies. Preserve
positional formats such as `%1$s`, `%2$d` and `%1$02d`; a literal percent sign
must be `%%`. Quantity resources use exactly the configured target categories,
not a copy of English categories. A count may be omitted in an appropriate
branch, but arguments must retain their meanings/types and appear somewhere
in the resource; shared non-count arguments remain required in each branch.

## Validate and import

Validate drafts and reviewer corrections without modifying a catalog:

```bash
python3 clients/android/scripts/localization.py validate-response de \
  --job .local/383-localization/jobs/de-001.json \
  --response .local/383-localization/reviewed/de-001.json
```

Import only after independent review. Record actual model/session identities
for both jobs so separate reviews using the same model remain distinguishable:

```bash
python3 clients/android/scripts/localization.py import de \
  --job .local/383-localization/jobs/de-001.json \
  --response .local/383-localization/reviewed/de-001.json \
  --translator 'model/translation-session' \
  --reviewer 'model/review-session'
```

The importer rejects duplicate/missing/unknown keys, malformed records,
incorrect quantity sets or positional formats, stale source, and translations
changed since export. It validates the complete response before replacing any
file. XML and metadata are each atomically replaced; an interruption between
those replacements is detected as a hash conflict by the next check/export.
One importer should own writes while agents write isolated responses.

## English edits, corrections and cleanup

```bash
python3 clients/android/scripts/localization.py check de
python3 clients/android/scripts/localization.py prune de
python3 -m unittest discover -s clients/android/scripts -p test_localization.py
```

`check` emits separate missing, stale, obsolete, conflicting, invalid and
unreviewed lists, and fails when any is nonempty. `prune` explicitly removes
obsolete XML entries and keeps their provenance in the sidecar's `retired`
section. It does not silently discard stale or unreviewed translations.

To correct a reviewed translation, export a fresh job with `--all`, correct
and review its response, then import it. Existing XML does not override the
new reviewed correction. Direct XML edits are visible as conflicts until
exported and reviewed again. Do not rewrite old response hashes to conceal
changed English; export a new job and review the new source.

Run `node scripts/check-localization.mjs`, Android resource compilation and
lint after import. Generic XML/format validation does not replace Android
compilation, runtime language/notification tests or review of the rendered UI.
No upstream translation is imported automatically; origin/license evidence
is required before any future borrowed-string importer is added.
