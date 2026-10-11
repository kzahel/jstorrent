# Legacy migration and cutover

This stream contains the transition from the previous TypeScript JSTorrent
implementation to the current product: legacy-state import, retained update
trust, old/new app combinations, store handoff and cutover evidence.

For running or changing the current engine and clients, start with
[DEVELOPMENT.md](../../DEVELOPMENT.md). For building future updates, use the
[release guide](../development/releasing.md). Read migration records when
changing compatibility behavior or investigating an upgrade-specific report.

## Contracts that still matter

- Preserve existing JSTorrent application IDs, signing roots and updater
  requests. Retained RSTorrent incubation routes have a different trust root;
  they are frozen compatibility, not a second shipping lane.
- Legacy catalog/import state cannot establish verified-content authority.
  Existing bytes must pass the ordinary checker before becoming verified.
- Preserve user-selected payloads, root grants, current destination state and
  lifecycle ownership during import or failure recovery.
- App and extension updates can arrive independently; old/new pairing and
  recovery remain relevant compatibility regressions.

Exact decisions live in the owners below. This index does not duplicate store
status, artifact hashes, candidate gates or per-device receipts.

## Read by concern

| Concern | Owner |
| --- | --- |
| Shipping identity, frozen incubation routes, surface handoff and update compatibility | [Product surfaces and migration](../topics/product-surfaces-and-migration.md) |
| Desktop import, legacy host fencing and installed replacement | [Desktop replacement](../topics/desktop-jstorrent-replacement.md) |
| Android profile/SAF/Play continuity and extension version combinations | [Android replacement](../topics/android-jstorrent-replacement.md) |
| Controlled upgrade regression commands and pinned fixtures | [Migration testing](testing.md) |
| Cutover acceptance and remaining cohort limits | [Cutover checklist](../jstorrent-cutover-checklist.md), [finish-line record](../tactical/259-jstorrent-finish-line-checks.md) |
| Store delivery and staged observation | [Delivery record](../tactical/297-staged-store-delivery-and-soak.md) |
| Qualification backlog and release baseline decisions | [Beta readiness](../topics/beta-release-readiness.md), [baseline proposal](../release-baseline.md) |
| Qualified public shipment and source binding | [Shipment record](../tactical/295-qualified-candidate-shipment.md) |
| Website, remote-origin and repository cutover | Tacticals [299](../tactical/299-production-website-consolidation.md), [303](../tactical/303-canonical-remote-origin.md), [305](../tactical/305-canonical-jstorrent-repository.md) |
| Frozen preview channels and historical package qualification | [Desktop preview runbook](../desktop-release.md), [Crostini runbook](../crostini-release.md) |

Existing topic and tactical paths remain stable for source references and
recorded evidence. Enter them through this map instead of treating their
running checklists as the current engine's setup instructions.

## Maintaining this stream

Keep historical outcomes in their original execution records. Update a
compatibility owner when its accepted behavior changes, and link to the
supporting regression. Routine engine/client changes should update their own
contracts and tests without repeating the cutover history here.
