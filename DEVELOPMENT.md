# JSTorrent Development

This is the map for maintaining the current product: where behavior lives,
how to run it, how to test changes, and how to investigate a failure.
Load the focused guide for the task instead of reading every workflow.

Legacy TypeScript import, cutover qualification and old release receipts have
a separate [migration stream](docs/migration/README.md).

## System map

| Area | Responsibility | Entry point |
| --- | --- | --- |
| Torrent engine | Protocol, discovery, peer transfer, scheduling, verification and storage | [Engine guide](docs/development/engine.md) |
| Application service | Durable torrent intent, roots, resume, commands and views | [Session source](crates/rstorrent-session/src), [application contract](docs/topics/application-control.md) |
| Clients and platform adapters | Presentation, permissions, file access and OS lifecycle | [Client guide](docs/development/clients.md) |
| Validation | Pure logic, controlled failures/transfers, browser behavior and native integration | [Testing map](docs/development/testing.md) |
| Debugging | Reproduce a report, identify the failing owner and retain a regression | [Investigation workflow](docs/development/engine.md#investigating-a-report) |
| Shipping | Package, review, sign and distribute future updates | [Release guide](docs/development/releasing.md) |

Runtime/platform code depends inward on deterministic protocol and state.
[Engineering principles](docs/engineering-principles.md) own the durable
boundaries. Read the relevant [topic](docs/topics/README.md) when changing an
accepted contract; agent working instructions remain in [AGENTS.md](AGENTS.md).

## Toolchain

Commands below run from the repository root. Source the environment script
before running toolchain commands directly; it locates Rust, JDK 17 and the
Android SDK, and the Android and iOS build scripts source it themselves:

```bash
source scripts/dev-env.sh
```

Rust is pinned by [rust-toolchain.toml](rust-toolchain.toml). Web clients need
Node/npm; controlled interoperability uses uv and the locked Python 3.12
environment in [tests/interop](tests/interop/README.md). Native apps add
their platform toolchains; the [client guide](docs/development/clients.md)
links the Android and iOS setup/build instructions. CI versions and platform
dependencies live in the [workflows](.github/workflows).

## Run the engine

For one finite foreground download without a product window:

```bash
cargo run --locked -p rstorrent-session --bin rstorrent-download -- --help
```

The [engine guide](docs/development/engine.md#one-foreground-download) explains
selection, direct output, verification and stateless recheck. Use the
[controlled scenario map](tests/interop/README.md) for persistence, failure
injection and independent-peer validation.

## Run the app

```bash
./scripts/desktop
./scripts/webui --help
```

The desktop command launches the app. For browser development, use
`./scripts/webui --reload --no-open`; for UI-only fixtures use
[demo mode](docs/development/clients.md#web-demo). These development profiles
are separate from the installed shipping product. The
[client guide](docs/development/clients.md) owns launch and platform details.

## Test a change

[Choosing validation](docs/development/testing.md) explains the common Rust/web
checks, contract regeneration, controlled application smoke, Playwright and
native-platform gates. [CI](.github/workflows/ci.yml) is the executable command
inventory; [weekly verification](.github/workflows/verification-matrix.yml)
covers broader storage/recovery cases.
[Fast CI and review feedback](docs/development/testing.md#ci-as-the-executable-inventory)
run independently of full qualification.

Use the layer changed plus the integration that can fail. Public-swarm,
off-LAN and physical-device runs are separate opt-in evidence. Record actual
checks in the owning tactical rather than appending progress to this guide.
Documentation changes should check links and run `git diff --check`.

## Packaging And Running The Linux Headless Service

See the [headless guide](docs/development/headless.md) for local source builds,
persistent configuration, service diagnostics and operator-controlled updates.
The [runtime topic](docs/topics/runtime-configurations-and-headless-deployment.md)
owns listener, authentication and exposure contracts.

## Building JSTorrent Production Candidates

See [candidate builds](docs/development/releasing.md#local-production-candidates).
JSTorrent is the sole active shipping identity; retained RSTorrent incubation
routes are frozen compatibility, not another publication lane.

### Explicit production desktop publication

See [publication](docs/development/releasing.md#explicit-desktop-publication).
Building a candidate and publishing it are separate operations.

## Documentation ownership

Keep workflow intent here and runnable details in focused guides, script help
or source. Topics own current contracts; tacticals own implementation decisions
and results. Migration status and exact cutover receipts stay in the
[migration stream](docs/migration/README.md).
