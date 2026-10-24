# 306 — Development documentation map

Status: Complete, 2026-10-11.

## Scope and outcome

Make `DEVELOPMENT.md` a short map of the engine, clients, validation,
debugging and shipping. Give the previous TypeScript implementation's
migration and cutover work a separate documentation entry point. Extract
focused workflow guides and trim repeated execution history as they move.

## Boundaries

- Documentation only; retain commands, tests and runtime behavior.
- Preserve existing topic/tactical paths and externally linked development
  anchors. Do not rewrite concurrently edited release/store records.
- Keep current update, signing, input-safety and payload-preservation contracts.
  Migration regressions remain useful even after the cutover.
- Leave `AGENTS.md`, the product README and broad tracker cleanup for later.
- Prefer links to command help, source and existing owners over copied option
  inventories. Keep prerequisites and explanations of what each check proves.

## Owners and references

`docs/README.md` owns navigation; `docs/topics/README.md` indexes continuing
concerns. Existing engineering principles, reference policy, client READMEs,
CI workflows and the commands in `DEVELOPMENT.md` supply the current contracts.
The accepted JSTorrent-only release policy in
`product-surfaces-and-migration` owns shipping identity and frozen incubation
routes. No new topic or engine campaign is needed for this documentation slice.

## Validation and stopping condition

Check changed Markdown links and retained anchors, documented source paths,
script help where it can be inspected without starting runtime work, and
`git diff --check`. No product launch, device session, public swarm, publication
or full Rust build is needed for moving documentation.

Stop when the development entry point explains the system and routes readers
to focused workflow guides, migration records are separately indexed, and
the checks above pass. Record actual validation and remaining cleanup here.

## Outcome and evidence

`DEVELOPMENT.md` is reduced from 1,725 to 103 lines. Eight focused guides
cover engine/debugging, validation, clients, headless operation, shipping,
controlled scenarios and legacy migration/testing. Together with the entry
point they contain 827 lines; old tactical progress paragraphs were removed
rather than copied into new workflow guides. Topic and tactical paths remain
stable, and migration concerns have a separate navigation group.

Validation: local Markdown targets/anchors across all 13 touched documents
and the three development fragments used by website/release links pass.
All 37 mapped scenario sources were inspected; 24 safe scenario `--help`
calls pass in the offline locked uv environment. Four release Python utility
help calls, the web launcher help and legacy Android runner help also pass.
`git diff --check` passes. No runtime test, app/device launch, build,
deployment or publication was performed.

Thirteen older scenario runners lack help handlers and are explicitly marked
in the map; adding safe help is separate source work. `AGENTS.md`, broad
tracker condensation and existing support/architecture narratives remain
outside this slice. Concurrent store/release status edits were not touched.
