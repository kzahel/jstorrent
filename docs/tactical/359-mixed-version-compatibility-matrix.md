# Tactical 359: Mixed-Version Compatibility Matrix

Status: Proposed, 2026-10-15. Maintainer-requested plan; awaiting review and
approval before implementation. Replaces Tactical
[354](354-mixed-version-compatibility.md) Slice 4 and generalizes its
single-release checks.
Topics: `mixed-version-compatibility`, `application-view-api`,
`client-surfaces`.

Terms follow the [glossary](../glossary.md): a **host** owns the engine and
serves the application API; a **client** connects to a host.

## Problem

Clients and hosts update independently (hosted remote controller, extension
companions, desktop, Android, headless), so every supported pair of
versions must work in both directions. Today's evidence covers one release
and parts of the matrix:

| Check | Today |
| --- | --- |
| New client receives an old host's data | `desktop-v0.3.1` frames decoded and rendered by the current client (`released-hosts.test.ts`, `App.test.tsx`). |
| Old client receives new host data | Static only: `contract-compatibility.test.ts` lists schema additions released strict clients would reject. No released client code runs. |
| New host receives an old client's requests | Not checked. |
| Old host receives new client requests | Static only: new patch keys and commands must be capability-owned. Nothing checks that gated requests are valid for the old host. |
| Which releases are covered | Whatever someone copied into fixtures; nothing requires the newest release or every release in the window. |

The maintainer wants a scaffold that proves the 2×2 matrix
(old/new host × old/new client) for every release inside the support window
and fails CI when a release is missing from it.

## Decision

For every supported release R and the proposed release P (current `main`),
prove the four cells with artifacts produced by R's own source, not by
hand-written approximations:

|  | Host R | Host P |
| --- | --- | --- |
| **Client R** | matched pair (shipped together) | **cell B**: client R accepts host P's data; host P accepts client R's requests |
| **Client P** | **cell A**: client P accepts host R's data; host R accepts client P's (gated) requests | normal tests |

Each off-diagonal cell has a data direction and a request direction, giving
four checks per release:

1. **Host R → client P (data).** Host R's captured frames decode, reduce and
   render in client P without errors, with every field client P types as
   present filled.
2. **Host P → client R (data).** Host P's frame corpus decodes and reduces in
   client R's own bundled decoder. While R is a strict client, frames may
   fail only because of reviewed exposures: after stripping exactly the
   entries in `release-compatibility.json`, every frame must pass.
3. **Client R → host P (requests).** Every request shape client R can send
   (generated from R's schema) parses in host P.
4. **Client P → host R (requests).** Every request shape client P can send,
   after `supportedPatch` filtering with R's advertised capabilities, is
   valid against R's exact client-request schema. Anything else must be
   capability-owned, which the contract test already requires.

## Release Registry And Window

`compat/releases.json` lists supported releases:

```json
{
  "windowDays": 30,
  "releases": [
    { "release": "desktop-v0.3.1", "surface": "desktop", "date": "2026-10-13",
      "commit": "5fa018ff…", "roles": ["host", "client"], "contract": "e3347abdc3be" },
    { "release": "extension-1.1.4", "surface": "extension", "date": "2026-10-13",
      "commit": "5fa018ff…", "roles": ["client"], "contract": "e3347abdc3be" }
  ]
}
```

- `contract` is the SHA-256 prefix of R's generated `v1.schema.json`.
  Captured artifacts live once per contract under
  `compat/contracts/<contract>/`, so releases sharing a contract share them.
- Roles: desktop and Android releases are host and client (their own UI);
  extension releases are clients only; headless and Crostini releases are
  hosts whose own UI is a matched pair.
- **Window rule.** Every production release (`desktop-v*`, `android-v*`,
  `headless-v*`, `crostini-v*`, extension versions) dated within
  `windowDays` of the proposed release, and the newest release of each
  surface regardless of age, must be registered and captured. Older entries
  may be removed in a reviewed commit.
- **Extension releases** have no tags today. Start tagging them
  (`extension-v1.1.5`); register past ones by manifest commit.
- Initial registry (three contracts):

| Contract | Releases |
| --- | --- |
| `4845fe5897a7` | desktop 0.3.0; extension 1.1.3 (manifest commit `bff14e72`, build commit to confirm) |
| `361dc45e157a` | Android 1.0.29 |
| `e3347abdc3be` | desktop 0.3.1, Android 1.0.30 and 1.0.31, extension 1.1.4 (`5fa018ff`) |

## Capture

`scripts/compat-capture.mjs <release>` runs once per new contract and commits
its output:

- Creates a temporary `git worktree` at the release commit and removes it
  afterwards.
- **Host artifacts:** runs that release's `export_types` for its schema,
  declarations and traces; runs a temporary example program written into the
  worktree (never committed there) that prints that release's
  `ApiHello::default()` and default settings runtime view. These calls exist
  in every supported release.
- **Client decoder:** bundles that release's `validation.ts`, generated
  validators and `view-set-reducer.ts` into one self-contained
  `client-decoder.mjs` (esbuild) exporting the decode and reduce functions.
  This is client R's real decoding code, including its hand-written checks.
- **Request corpus:** `client-requests.json`, generated from R's schema by a
  deterministic sampler (below).
- Writes `compat/contracts/<contract>/` with a `provenance.json` recording
  release, commit and capture tool version.

## Corpora

- **Request sampler.** A deterministic schema walker produces, for each
  client-sent type (`ApplicationClientFrame`, `Command`, both settings
  patches): one instance per tagged variant with required fields only, and one
  per optional field set. Strings use pattern-satisfying fixed values where a
  pattern exists. Serde only checks structure, so these prove parse
  compatibility, not semantic validity.
- **Host P frame corpus.** The current traces cover only the library view.
  Add a `compat_corpus` generator next to `export_types` that emits, from
  host P's real types, a hello, a settings runtime view with every optional
  field populated, and at least one snapshot and one patch for every view
  type and row field kind. Releases captured after it lands include it in
  their host artifacts; earlier releases keep their narrower traces, recorded
  as a known gap.

## Checks And Placement

- Web (`clients/web`, vitest): checks 1 and 2, plus check 4 (Ajv compiled
  from each captured exact schema). They replace and generalize
  `released-hosts.test.ts`, `newer-host.test.ts` and the release loop in
  `contract-compatibility.test.ts`.
- Rust (`rstorrent-gateway` tests): check 3, deserializing each captured
  `client-requests.json` into host P's types.
- **Registry check** (`scripts/compat-registry.mjs`): needs git tags, so it
  runs in the release workflows (which already fetch history) and in a weekly
  scheduled workflow; it fails when a release required by the window rule is
  missing from the registry or its contract directory. Ordinary CI runs the
  matrix over whatever is registered.
- The release workflows run the full matrix with P = the release commit
  before publishing, next to `check-release-compatibility.mjs`.

## Non-Goals

- Running real old binaries end to end (Playwright against an old desktop
  build, a real old extension against a current host). A later live smoke can
  add timing and transport evidence; contract breaks are caught here.
- Android Compose and iOS UIs, which run in process with their host.
- Relay authentication message compatibility (Tactical 354 Slice 3).
- Semantic validity of sampled requests beyond parsing.

## Invariants

- Every artifact under `compat/contracts/` is produced by the release's own
  source at its recorded commit; nothing is hand-edited.
- A strict client may fail only on reviewed exposures; any other failure fails
  CI.
- The window rule fails closed: a missing release blocks publishing.

## Slices

1. **Registry and capture.** `releases.json`, `compat-capture.mjs` (worktree,
   `export_types`, temporary example program, decoder bundle), capture the
   three contracts, provenance.
2. **Data checks.** Checks 1 and 2 across all registered contracts; migrate
   the existing released-host and newer-host tests.
3. **Request checks.** Sampler, check 3 in Rust, check 4 in the web suite.
4. **Host corpus.** `compat_corpus` generator and check 2 over it.
5. **Enforcement.** Registry check in release workflows and a weekly job;
   `extension-v*` tagging; topic runbook update.

## Validation

- Each check has a deliberate failing fixture: an old decoder rejecting an
  unreviewed addition; a host P type rejecting an old request; a gated
  request invalid for an old schema; a missing registry entry.
- Capturing the same release twice produces identical artifacts.
- Web and Rust suites, `actionlint`, and a dry run of the registry check
  against the current tags.

## Stopping Condition

Complete when the three current contracts are captured from their own
releases, all four checks run for each in CI with negative controls, the
registry check runs in the release workflows and weekly, and the
`mixed-version-compatibility` topic describes the matrix and its runbook.

## Open Questions

- Should the extension's tags be pushed retroactively for 1.1.3 and 1.1.4,
  once their exact build commits are confirmed?
- Is a weekly scheduled run enough, or should the registry check also run on
  every push to `main` with a tag fetch?
- Should check 2 also render client R's UI (not only decode and reduce)?
  That needs R's whole web bundle and a DOM; decode and reduce catch contract
  breaks, rendering catches UI assumptions.
