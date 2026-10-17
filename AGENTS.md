# Repository Instructions

## What This Is

JSTorrent is a shipped BitTorrent client for desktop (Windows, macOS, Linux),
Android/ChromeOS and a Chrome extension, with iOS in development. Every
product runs a first-party Rust engine in-process:

```text
Desktop (Tauri + web UI) ── in-process ─┐
Android (Compose) ───────── in-process ─┼──> application service ──> Rust engine
iOS ─────────────────────── in-process ─┤
CLI, headless, tests ────── in-process ─┘
Extension, remote controller ── authenticated control of a host
```

The product promise is simple installation without administering a daemon,
first-class desktop and mobile experiences, good browser integration, useful
automation, and understandable diagnostics.

[`README.md`](README.md) is the product entry point and
[`DEVELOPMENT.md`](DEVELOPMENT.md) maps where behavior lives and how to run,
test, debug and ship it. [`docs/glossary.md`](docs/glossary.md) fixes
overloaded terms: a **host** is a running JSTorrent process that owns the
engine and serves the application API; a **client** is a UI or program that
connects to a host; a **peer** is another BitTorrent program. Unqualified
**UI** means the shared React application in `clients/web`; name the Android
UI explicitly as *Android* or *Compose*.

Crate and protocol names still carry the `rstorrent` working name. That is an
implementation detail, not a second product. The history behind the rewrite
is in [`docs/project-history.md`](docs/project-history.md).

## Architecture Guardrails

These hold unless the maintainer explicitly changes them:

- The engine is implemented here, not delegated to libtorrent, librqbit or
  another engine dependency. It owns peer networking, hashing, scheduling,
  session state and hot-path data movement.
- Platform adapters own OS integration: Android activities, lifecycle,
  permissions, notifications and SAF; Apple lifecycle and security scopes;
  Tauri windowing. Peer and piece data never cross a generic process or
  language proxy.
- Do not add a native companion host, socket proxy, separate IO daemon or new
  remote API surface without an explicit architectural decision.
- The extension and the hosted remote controller control a host; they never
  carry peer or file hot paths.
- Android is an engine parity gate: an applicable engine or application
  capability is not done until its Android boundary, build and proportional
  platform evidence land with it. Android *presentation* parity is a separate
  per-feature decision.
- JSTorrent is the only release identity. The RSTorrent release track is
  frozen; do not publish to it or redirect installs across signing roots.
  Release mechanics live in [`docs/development/releasing.md`](docs/development/releasing.md).

## Finding Context

Read on demand, not up front. [`docs/topics/README.md`](docs/topics/README.md)
indexes the topics that own current decisions for each concern; read the ones
covering the area you are changing. Many topics also carry dated execution
history; treat the decisions and invariants as current and the narrative as
background.

- **Engine, protocol, storage, performance:**
  [`docs/development/engine.md`](docs/development/engine.md) and
  [`docs/engineering-principles.md`](docs/engineering-principles.md).
- **Web UI and clients:** [`docs/topics/web-ui-design.md`](docs/topics/web-ui-design.md),
  [`docs/topics/client-surfaces.md`](docs/topics/client-surfaces.md),
  [`docs/topics/application-view-api.md`](docs/topics/application-view-api.md)
  and [`docs/development/clients.md`](docs/development/clients.md).
- **Upgrade, import and cutover:** [`docs/migration/README.md`](docs/migration/README.md).
- **Validation:** [`docs/development/testing.md`](docs/development/testing.md).

`docs/tactical/` is an archive of past implementation slices. Search it when
you need the reasoning behind existing code; do not read it for orientation.

For maintainer-specific cross-project context, see
`~/code/dotfiles/projects/README.md` when that checkout is available.

## Reference Clients

Mature clients are the best evidence for how BitTorrent behavior should work
and what users expect. [`reference/pins.toml`](reference/pins.toml) pins
them; `python3 scripts/references.py sync --only NAME` fetches one, including
the optional ones.

- **Adding or changing core engine behavior** (protocol, discovery, peer
  lifecycle, scheduling, choking, storage, hashing): read the BEP in
  `reference/bittorrent.org`, then the pinned libtorrent implementation
  **and its tests** before designing. libtorrent is the completeness and
  edge-case oracle, not an architecture template. rqbit and librqbit-utp are
  useful Rust/Tokio comparisons.
- **Application policy and UX** (queueing, share and idle limits, per-torrent
  overrides, settings semantics, what a column or status means): check how
  qBittorrent and Transmission behave and why before inventing a policy.
- **Product history and Android/ChromeOS lessons:** the
  `../jstorrent-typescript` sibling holds the previous implementation, its
  integration scenarios and known failures.

Record the paths consulted, the edge cases extracted, what was adopted and
any deliberate difference in the tactical or topic. Use references to
understand behavior and build tests; do not copy source. Before importing
source, fixtures or test data, identify origin and license and record why
reuse is permitted. [`docs/references.md`](docs/references.md) owns the full
policy.

## Engineering Character

[`docs/engineering-principles.md`](docs/engineering-principles.md) holds the
engine invariants. Everywhere:

- Prefer plain structs, enums, functions and explicit state transitions.
  Introduce traits, generics or layers only for a concrete ownership,
  dependency, testing, reuse or measured performance need.
- Keep protocol values, codecs and deterministic state independent from async
  runtimes, sockets, filesystems, clocks and platform adapters. Dependencies
  point inward.
- Give mutable state and background tasks identifiable owners with
  cancellation and observable termination.
- Treat metainfo and network input as hostile; bound peer-controlled
  allocation and work. Never present unverified data as verified content.
- Keep logs and diagnostics separate from application commands, snapshots and
  events.
- Claim protocol or platform support from recorded evidence, not from the
  existence of code paths.

Refactor when you notice a concrete problem (a type in the wrong layer, a
module accumulating unrelated responsibilities, duplicated policy) and the
fix is proportionate to the task. Do not reshape speculatively.

## Durable User Data

Shipped user data is never wiped, reset, or replaced on upgrade. Only an
explicit user action such as Clear app data may discard it.

- Durable application state lives in SQLite (`session.db`, `product.db`)
  with a frozen baseline and hand-written, append-only forward migration
  steps that pass released-store fixture tests; each release that ships a new
  schema version adds its fixture. Never edit a baseline or a shipped step.
- Platform preference stores (browser local storage, Android
  SharedPreferences, `chrome.storage`) hold only UI preferences that tolerate
  per-field defaults, and never overwrite or wipe themselves. Consent is not
  a UI preference.
- Every migration step, legacy reader and one-time import is listed in
  [`docs/topics/durable-data-migrations.md`](docs/topics/durable-data-migrations.md)
  with its retirement condition, added in the same commit and removed only
  through that ledger.

See also [`docs/topics/client-persistence.md`](docs/topics/client-persistence.md).

## Mixed-Version Compatibility

The hosted remote controller, the extension companions and the hosts they
control update independently, so every feature must work across versions in
both directions for at least 30 days. A host may omit any field a newer
client knows: give new fields a serde default or make them optional. Anything
new a client sends (a command or settings patch key) is owned by a host
capability in `crates/rstorrent-session/src/host_capabilities.rs` and gated
in the client. Nothing released is removed, renamed or made required. The
web contract-compatibility and released-host tests enforce this; follow the
release and fallback-removal runbooks in
[`docs/topics/mixed-version-compatibility.md`](docs/topics/mixed-version-compatibility.md).

## Planning Work

Size the process to the change.

- **Routine product, UX, bug-fix and cleanup work:** read the owning topic,
  make the change, test it and commit. No tactical is needed.
- **Substantial or risky work** (new or changed engine, protocol, discovery,
  scheduling or storage behavior; a durable-data or cross-version contract;
  a multi-commit feature): write a numbered tactical in `docs/tactical/`
  first, named like `377-short-name.md`, and add it to the tactical index.
  State scope, non-goals, invariants, resource limits, validation and the
  stopping condition. For engine behavior, include the reference-client study
  above, the owner/task/cancellation map, and edge cases that change state
  shape, integrity, restart behavior, interoperability or resource bounds.
  Optional extensions and UI policy may be deferred explicitly. Update its
  status and evidence as work lands.

When work changes a topic's decisions, status or gaps, update that topic in
the same commit. Do not create a topic for every standalone change.

Proceed through implementation choices without asking. Stop for direction
when a choice materially expands scope, changes an accepted architecture or
product policy, adds a dependency with meaningful tradeoffs, or requires
destructive or external action such as publishing a release.

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
[`docs/topics/performance-and-live-evidence.md`](docs/topics/performance-and-live-evidence.md).
Engine-only work defaults to headless CLI or application-service validation;
do not launch visible apps merely to exercise engine behavior.

## ChromeOS Hardware Testing

Use the sibling Machine Control checkout for physical ChromeOS work. Before a
hardware session, read
`~/code/machine-control/platforms/chromeos/skills/SKILL.md` and start with the
common read-only doctor:

```bash
~/code/machine-control/bin/machine-control --target chromeos target doctor
```

Keep JSTorrent-specific build, deployment, and assertions in this repository.
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
