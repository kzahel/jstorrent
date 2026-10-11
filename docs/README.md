# JSTorrent documentation

Start with the [product README](../README.md) for what JSTorrent does and
[DEVELOPMENT.md](../DEVELOPMENT.md) for the maintenance map. Open the focused
guide for the behavior being changed or investigated.

## Current engine and applications

| Task | Guide |
| --- | --- |
| Run a download or debug torrent behavior | [Engine](development/engine.md) |
| Choose validation and understand what a pass proves | [Testing](development/testing.md) |
| Find a controlled failure, restart or interoperability scenario | [Scenario map](../tests/interop/README.md) |
| Run desktop/web or validate Android, iOS and ChromeOS behavior | [Clients](development/clients.md) |
| Configure and inspect a persistent Linux service | [Headless](development/headless.md) |
| Build and ship future updates | [Releasing](development/releasing.md) |
| Report a problem and handle diagnostics privately | [Support](user-support.md) |

## Legacy migration and cutover

The [migration stream](migration/README.md) maps TypeScript-era import,
update/signing continuity, old/new app pairs, store handoff and qualification
records. Its [test guide](migration/testing.md) covers upgrade regressions.

Read these for compatibility or upgrade work. Ordinary engine/client workflows
do not repeat shipment checkpoints or migration rehearsal results.

## Contracts and evidence

- [Engineering principles](engineering-principles.md) own invariant and
  dependency rules; [vision](vision.md) records product direction.
- [Topics](topics/README.md) own current decisions and feature contracts.
  Read the relevant concern rather than the complete directory.
- [Tacticals](tactical/README.md) retain bounded implementation decisions and
  actual validation outcomes.
- [Reference policy](references.md) and the [reference map](../reference/README.md)
  own external source provenance and pinned independent peers.
- [Public test torrents](test-torrents.md) are opt-in live inputs, not
  deterministic success fixtures.

Maps explain purpose and point to owners. Script help and workflows own
command options; execution records own dated results. Avoid copying status or
test receipts into the navigation pages.
