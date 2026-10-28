# 387 — French localization with local Codex

Status: **In progress.**

## Scope and stopping condition

Complete French (`fr`) for the shared React UI, native desktop shell and
Android. The maintainer requested local Codex `gpt-6.1-sol`, high reasoning,
normal speed (no fast tier), and bypass permissions for translation and
independent review. Use the existing ChatGPT-authenticated local CLI; do not
route this campaign through Claude or a work-account pool.

Add a maintained local CLI runner reusing the existing export, worker prompts,
validation and importer. Every batch receives a fresh translating session and
a separate reviewing session. Verify launch evidence before accepting results,
retain exact session identities in per-message provenance, and resume completed
work without starting replacement sessions. Catalog writes remain owned by one
importer per platform. No third-party translation source is copied.

Set shared French register (concise neutral French, vous when direct address is
needed), terminology and native plural categories before freezing source jobs.
Register complete reviewed catalogs for preview qualification, then complete
release registration and package checks within this task. Publishing binaries,
store submissions, iOS and website/store/support translation are out of scope.
Existing German translations, locale preferences, engine/application contracts,
durable stores and installed production profiles must be preserved.

Stopping condition: all three French catalogs are complete, independently
reviewed, current and selectable in qualified release inputs; source/catalog,
tooling, web/browser, native desktop and Android checks pass; evidence and
remaining platform limitations are recorded; owned workers and temporary
artifacts are cleaned; completed work is committed. No publication occurs.

## Ownership and resource limits

The runner owns its process groups, bounded output logs, timeout, signal
cancellation and joined termination. Workers write only their exact ignored
response paths and may validate, but never import or edit product sources.
Work state binds the frozen jobs, requested settings and validated output
hashes. Unconfirmed process ownership or changed jobs/results must fail closed.
Resume revalidates imports idempotently rather than trusting task state alone.

Use at most three active local workers across all platform runners; batches
contain at most 100 resources and workers at most four batches. Start with an
80-resource batch size and at most three batches per worker. Bound each worker
to 30 minutes and its output files to the existing 16 MiB JSON limit. Keep
machine paths, CLI configuration and authentication outside tracked files.

## Validation

- Runner regressions: exact model/effort/tier/permission arguments, provenance,
  separate review, rejection of corrupt/stale/mutated output, safe resumption,
  cancellation and process termination.
- Existing shared, YA and Android workflow tests; registry/generator checks;
  global localization and branding checks; deterministic generation.
- Web typecheck and full unit suite; French live switching, formatting,
  plurals, focus/persistence and responsive accessibility browser checks.
- Preview and release assets, CSP and language availability; native catalog,
  menu and isolated desktop-product locale smoke; proportional desktop compile.
- Android resource compilation, lint, native locale configuration and owned
  API 28/35 actual-locale layout/lifecycle evidence. Do not target arbitrary
  attached devices or change the maintainer's installed production app.

## Execution evidence

Implementation and qualification evidence will be appended as work lands.
