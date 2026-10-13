# Repository Instructions

`AGENTS.md` owns shared repository instructions; `CLAUDE.md` imports this file.

## Project Entry Points

Start with [`README.md`](README.md) and
[`DEVELOPMENT.md`](DEVELOPMENT.md), then read:

- [`docs/vision.md`](docs/vision.md) and
  [`docs/engineering-principles.md`](docs/engineering-principles.md);
- [`docs/topics/product-direction.md`](docs/topics/product-direction.md) and
  [`docs/topics/product-surfaces-and-migration.md`](docs/topics/product-surfaces-and-migration.md);
- [`docs/topics/capability-readiness.md`](docs/topics/capability-readiness.md),
  which owns the capability scoreboard and non-exclusive active/ready work
  sets; and
- [`docs/references.md`](docs/references.md).

[`docs/topics/README.md`](docs/topics/README.md) indexes every living topic;
read the ones that own the area you are about to change rather than the whole
directory. Engine, protocol, and performance work also reads
[`docs/topics/oracle-driven-engine-campaign.md`](docs/topics/oracle-driven-engine-campaign.md)
for the source-first runbook and restart checkpoint. Client work also reads
[`docs/topics/web-ui-design.md`](docs/topics/web-ui-design.md),
[`docs/topics/client-surfaces.md`](docs/topics/client-surfaces.md), and
[`docs/topics/application-view-api.md`](docs/topics/application-view-api.md).
Once an implementation tactical exists, read it and every focused topic it
names before changing code in its scope.

For maintainer-specific cross-project context, see
`~/code/dotfiles/projects/README.md` when that checkout is available.

## Current Product Direction

RSTorrent is a new implementation with a first-party Rust BitTorrent engine
and is the selected implementation for a near-term in-place JSTorrent
replacement. It is not a line-by-line port and does not inherit JSTorrent feature
parity as an initial requirement.

Preserve these starting constraints unless the user explicitly changes them or
a living topic records an accepted replacement:

- The torrent engine is implemented in this repository rather than delegated
  to libtorrent, librqbit, or another engine dependency.
- The engine owns ordinary peer networking, hashing, scheduling, session
  state, and hot-path data movement.
- Product clients are first-party and normally run the engine in-process.
- Platform adapters may own operating-system integration such as Android
  activities, lifecycle, permissions, notifications, and SAF document access,
  or eventual Apple UI lifecycle, security scopes, and file coordination.
- Do not introduce a native host, companion server, REST/WebSocket socket
  proxy, or separate IO daemon without an explicit architectural decision.
- Android/ChromeOS and desktop are the initial product surfaces. iOS is an
  accepted eventual first-party in-process product; bounded physical-device
  feasibility work may be explicitly authorized before the complete client.
  An extension, complete iOS port, remote daemon, and additional platforms are
  not implied work outside their owning tactical.
- Android/ChromeOS Android is a first-party engine parity gate. An applicable
  engine or application capability is not complete until its Android semantics,
  generated boundary/build, and proportional platform evidence land in the
  same tactical, or the tactical proves why the behavior is inapplicable.
  Android presentation parity remains a separate per-feature decision.
- Unqualified `UI` and `web UI` mean the shared mature React product
  application in `clients/web`, whether browser-hosted or embedded by Tauri.
  The retired direct-DOM proof is not a current surface. Refer to the Android
  Compose UI explicitly as `Android`, `Compose`, or `Android UI`; `website/`
  is the project website, not the product web UI.
- A future JSTorrent extension is expected to control and integrate with the
  native engine rather than carry peer or file hot paths. This vision does not
  authorize extension or IPC work in an unrelated tactical.
- Production succession is selected: ship as a normal JSTorrent desktop update
  retaining `com.jstorrent.desktop`, JSTorrent branding/icons and its existing
  updater trust root; update the existing `com.jstorrent.app` Play app and the
  existing production extension item. Their updates may arrive independently
  under `docs/topics/product-surfaces-and-migration.md`. Best-effort migration
  and branding have bounded implementation slices. JSTorrent is the sole active
  release identity and uses its existing signing key and updater endpoint.
  Maintainer direction on 2026-10-11 freezes the RSTorrent release track: do not
  publish new incubation releases or re-enable its nightly publication. Retained
  RSTorrent routes, descriptors, keys and historical artifacts are legacy
  compatibility, not a second shipping lane. Isolated debug/test identities may
  remain; do not redirect old incubation clients across signing roots.
- Engine and product-client work both proceed, each under its own numbered
  tactical. Neither is globally paused in favor of the other, and neither is
  standing authorization to start implementing without one.

These are direction guardrails, not permission to invent a complete
architecture before the relevant tactical.

## Engineering Character

Follow [`docs/engineering-principles.md`](docs/engineering-principles.md).
In particular:

- Prefer plain structs, enums, functions, and explicit state transitions.
  Introduce traits, generics, or framework layers when they solve a concrete
  ownership, dependency, testing, reuse, or measured performance problem.
- Give mutable state and background tasks identifiable owners. Every task needs
  a cancellation and observable termination path as concurrency grows.
- Treat all metainfo and network input as hostile. Bound peer-controlled
  allocation, queues, and work before changing state.
- Prefer depth before breadth for every new protocol or storage capability.
  Study specifications and mature references first, then front-load edge cases
  that change state, ownership, persistence, integrity, resource bounds, or
  interoperability into the initial tactical and tests. Do not let a
  happy-path implementation establish an architecture already known to fail
  those cases; keep unrelated breadth and policy-only cases bounded or
  explicitly deferred.
- Never present unverified data as verified content.
- Make structured observability part of engine behavior while keeping logs
  separate from application commands, snapshots, and events.
- Claim protocol support from recorded test and interoperability evidence, not
  from the existence of code paths.

These defaults favor local reasoning and debuggability. They do not prohibit an
abstraction or optimization supported by current evidence.

## Architecture And Module Boundaries

Treat code placement and dependency direction as part of correctness. Keep
protocol values, codecs, and deterministic state transitions independent from
async runtimes, sockets, filesystems, task handles, channels, and platform
adapters. Runtime and platform layers may depend inward on those components;
the dependency must not point back outward.

While working, keep an eye out for concrete refactoring opportunities:

- Does each type and operation live with the layer that owns its invariant?
- Did an infrastructure type leak into protocol or domain state?
- Is a module accumulating unrelated responsibilities or becoming a difficult
  to understand "god module"?
- Would a smaller boundary make important behavior testable without networking,
  storage, a clock, or a platform runtime?
- Is duplicated policy revealing a missing shared concept?

Refactor when the benefit is concrete and the work remains proportionate to the
current tactical. Do not interrupt bounded progress for speculative reshaping.
Extract a module or crate when ownership, dependencies, lifecycle, reuse, or
testing justify it; do not create speculative abstractions or
one-file-per-type layouts merely in anticipation of future features. Record a
deferral only when a material known problem is deliberately left in place.

## Feature Campaign Execution

[`docs/topics/capability-readiness.md`](docs/topics/capability-readiness.md)
owns the capability scoreboard and active/ready work sets. Multiple bounded
tacticals may be active at the same time. `Active`, `Ready`, and `Later` are
planning metadata, not repository locks, authorization gates, or a mandatory
global sequence. A user-directed tactical does not need to displace or pause
unrelated active work, and an agent must not redirect requested work merely
because another tactical is active. Stop or sequence work only for a concrete
dependency, overlapping ownership or edits, an incompatible accepted
contract, or an escalation boundary stated below. References to **Now** in
completed tacticals or historical topic narrative describe the retired
single-`Now` convention and have no current force.

Whenever engine work is in flight,
[`docs/topics/oracle-driven-engine-campaign.md`](docs/topics/oracle-driven-engine-campaign.md)
owns the source-first runbook, graduation rules, and per-tactical restart
checkpoints and next executable actions; keep each applicable checkpoint
reconciled with repository state rather than with transcript memory. For each
engine, protocol, discovery, scheduling, storage, or performance feature:

1. Create or update one bounded tactical before implementation. State its
   stopping condition, non-goals, invariants, resource limits, and required
   evidence.
2. Read the normative specifications and inspect the exact pinned libtorrent
   implementation **and tests** before finalizing the design. Record the paths,
   relevant functions or cases, edge-case checklist, behavior adopted, and
   intentional differences. Libtorrent is the required completeness and
   edge-case oracle, not an architecture template or source donor.
3. Inspect JSTorrent behavior and known failures when the feature has relevant
   product or platform history. Record what was learned rather than assuming
   parity.
4. Write the owner/task/cancellation map and module-dependency direction before
   adding runtime work. Identify the concrete boundary improvement if the
   slice includes a refactor.
5. Implement the common path together with edge cases that change ownership or
   state shape, integrity or security, cancellation/retry/restart behavior,
   common interoperability, resource bounds, or stall diagnosis. Optional
   extensions, UI policy, unmeasured micro-optimization, and speculative
   abstraction may be explicitly deferred.
6. Validate in layers: deterministic transitions, scripted runtime failures,
   controlled interoperability, and representative live evidence where useful.
   Record resource high-water marks for work that changes hot paths or
   long-lived state.
7. Update the owning topics, readiness matrix, protocol claims, and tactical
   evidence before committing the completed slice.

Within an approved campaign, continue through these steps without requesting
routine implementation choices from the user. Stop for direction when a
choice materially expands scope, changes an accepted architecture or product
policy, adds a dependency with meaningful tradeoffs, requires destructive or
external action, or otherwise needs authority not already granted.

## Documentation Ownership

Active documentation has these roles:

- `README.md` and `DEVELOPMENT.md` are product and maintainer entry points.
- Durable architecture documents own accepted long-lived system shape.
- `docs/topics/` owns current truth for focused continuing concerns.
- `docs/tactical/` owns numbered, bounded implementation slices and execution
  records.
- `docs/references.md` owns reference provenance and usage policy.

Before changing a continuing concern, read its topic. Update the topic when the
work changes its status, decisions, evidence, validation, gaps, or recommended
direction. Do not create a topic for every standalone change.

New tactical documents use zero-padded numeric names such as
`000-first-download.md`. Keep one bounded implementation slice per tactical.
State scope, non-goals, dependencies, invariants, validation, and the stopping
condition before implementation. Update its status and evidence as work lands;
completed tacticals remain as execution records.

## Reference Discipline

Use protocol specifications and reference implementations to understand
behavior, construct interoperability tests, and compare outcomes. Do not copy
source mechanically or let a reference implementation silently dictate the
architecture.

For every engine feature, inspect the version pinned in
[`reference/pins.toml`](reference/pins.toml), including its tests, as required
by the feature-campaign contract. A tactical records exact paths and the edge
cases extracted from them so a future pin change can be audited. If a local
reference checkout is unavailable, use the pinned upstream source or add
bounded checkout tooling rather than silently substituting memory or an
unversioned implementation.

Before importing source, fixtures, or test data, identify its origin and
license, record why reuse is permitted, and preserve required attribution.
Prefer independently authored tests against public protocol behavior.

The normal local JSTorrent reference is `~/code/jstorrent`. Its most valuable
inputs are product behavior, integration scenarios, deterministic fixture
patterns, Android/ChromeOS lessons, and known failure cases.

## Toolchain And Validation

Source the repository environment script before commands that require Rust,
Java, Android, or other locally installed tools. It locates toolchains such as
JDK 17 and the Android SDK without overriding settings already present; the
Android and iOS build scripts source it themselves:

```bash
source scripts/dev-env.sh
```

Use this default Rust baseline in proportion to the change:

```bash
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
```

Changes that touch `clients/web` or the generated application contract also
run:

```bash
npm run typecheck --prefix clients/web
npm run test --prefix clients/web
```

Regenerate the TypeScript contract with `npm run generate --prefix clients/web`
whenever a Rust type crossing the application boundary changes.
[`DEVELOPMENT.md`](DEVELOPMENT.md) owns the full command inventory, including
the Playwright end-to-end suite and the `tests/interop` scenarios. Report
exactly what ran. Remove temporary logs, captures, downloads, and
investigation artifacts before finishing.

Live public-swarm and comparative performance smokes are opt-in and follow
[`docs/topics/performance-and-live-evidence.md`](docs/topics/performance-and-live-evidence.md)
and the active campaign runbook.
Engine-only work defaults to headless CLI or application-service validation;
do not launch visible product clients merely to exercise engine behavior.

## ChromeOS Hardware Testing

Use the sibling Machine Control checkout for physical ChromeOS work. Before a
hardware session, read
`~/code/machine-control/platforms/chromeos/skills/SKILL.md` and start with the
common read-only doctor:

```bash
~/code/machine-control/bin/machine-control --target chromeos target doctor
```

Keep RSTorrent-specific build, deployment, and assertions in this repository.
Keep generic device transport, screenshots, UI automation, DevTools, ARCVM
ADB, Crostini, and recovery in Machine Control's ChromeOS platform controller.

## Commit Messages

Aim for a subject of 65 characters or fewer and strictly wrap commit bodies at
72 columns. Keep the subject as a scannable result. For nontrivial commits,
preserve the originating motivation, important constraints and non-goals,
implementation direction, validation, and deliberate deferrals when useful.

Prune secrets, transcript detail, and low-signal commentary. Do not mention
Claude, AI, or an AI assistant. Do not add AI co-author or generation trailers.

When a commit materially advances a living topic, append the exact
`Topic: <slug>` trailer.

## Git And Releases

Do not add a remote, push, publish, tag, or release unless the user explicitly
requests it. Before any future push, verify `git config user.name` and
`git config user.email`; stop if they are automation placeholders.
