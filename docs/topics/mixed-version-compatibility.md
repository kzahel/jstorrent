# Mixed-Version Compatibility

Topic: `mixed-version-compatibility`

Status: Active, started 2026-10-14 by Tactical
[354](../tactical/354-mixed-version-compatibility.md). Slice 1 has landed: the
web client fills fields older hosts omit, hides stop limits on hosts that
lack them and never sends their settings there, and CI checks the contract
against the released `desktop-v0.3.1` host. Tolerant clients, version
observability and automatic updates (Tactical
[355](../tactical/355-automatic-updates.md)) remain.

This topic owns how clients and hosts of different versions work together:
the support horizon, the capability model, the contract rules every feature
follows, the checks that enforce them, and the release and removal runbooks.
[`durable-data-migrations`](durable-data-migrations.md) owns stored data;
[`application-view-api`](application-view-api.md) owns the contract itself.

## Where Versions Differ

| Client | Host | Why they differ |
| --- | --- | --- |
| Hosted controller, `jstorrent.com/remote/` | Desktop or headless over the relay; Android later | The site redeploys from every push to `main` that touches `clients/web` or the remote crates. Hosts update on their own schedule. |
| Extension companion pages | Android over ARC; desktop over native messaging | The extension updates through Web Store review and auto-update, independently of Play and the desktop updater. |

The desktop webview, gateway-served UI (headless, Crostini), Android Compose
and iOS ship or serve their own UI and always match their host.

Both directions occur:

- **New client, old host.** The hosted controller is always newest. The
  extension is often newer than an Android host still in Play rollout.
- **Old client, new host.** An extension waiting on Web Store review is older
  than a freshly released host.

## Support Policy

- **Full support, 30 days.** A client supports every host released in the
  last 30 days, and a host every client released in the last 30 days.
- **Degraded support, v1 baseline.** For older hosts on the v1 contract the
  hosted controller keeps core control working (library, add, pause, resume,
  remove, files, the settings that host has), hides what the host lacks and
  will show an out-of-date notice. Below the floor set by removed fallbacks
  it shows an update screen, never a broken UI.
- The horizon tightens only on evidence: automatic updates (Tactical 355) and
  observed version populations. It never widens silently.

## Rules For Every Feature

Ask one question: **does this add something the client sends?**

| Change | What to do |
| --- | --- |
| New field a host sends | Give it a serde default or make it `Option`. Generation fails if a field a host may omit is typed as always present. |
| New command, settings patch key or torrent settings patch key | Add a capability in `crates/rstorrent-session/src/host_capabilities.rs` that owns it, gate the control with `hostSupports`, and let the live dispatch filter drop it for hosts without it. CI fails on an unowned key. |
| New enum value, tagged variant or row delta a host sends | Record it in `REVIEWED_STRICT_CLIENT_EXPOSURE` with how it is made safe; until tolerant clients are out, follow the release order below. |
| New field inside a type released clients validate strictly (`additionalProperties: false`) | Same as a new variant. |
| Remove, rename, retype or newly require anything released | Not allowed in v1. Add a new field or capability instead. |
| Change the meaning of a released field or capability | Not allowed. New semantics take a new name. |

Capabilities are facts about installed code, not switches. A capability is
never widened after release, its numeric ID is never reused, and its entry is
never deleted.

## Mechanism

- **Host advertisement.** `ApiHello.capabilities` carries the view names and
  every registry entry. The registry exports to TypeScript as
  `HOST_CAPABILITY_REGISTRY`. Hosts built before the registry advertise none
  and are treated as the v1 baseline.
- **Client state.** `LiveApplication` puts the hello's list in
  `session.hostCapabilities`, refreshed after every reconnect (Tactical
  [353](../tactical/353-host-product-in-hello.md)). `hostSupports` treats an
  application without a list (the demo) as current.
- **Outgoing filter.** `LiveApplication.dispatch` passes settings patches
  through `supportedPatch`, which drops keys owned by capabilities the host
  lacks. A patch left empty is refused locally with an update message instead
  of being sent.
- **Defaults for omitted fields.** Validators are generated with Ajv
  `useDefaults`, so a field Rust gives a serde default is present after
  validation even when an older host omits it. Ajv cannot fill defaults
  inside `oneOf` branches; `generate-validators.mjs` fails on any such
  default outside its reviewed list, and on any omittable field TypeScript
  types as present. `ServiceSnapshot.client_settings` keeps its hand-written
  fresh-profile default in `validation.ts`.
- Android Compose and iOS run the engine in process and need no gates; the
  Kotlin and Swift exports of the registry are deferred until a native client
  controls another host.

## Checks

- `clients/web/src/released-hosts.test.ts` decodes the hello, views and
  settings each released host produced (fixtures copied unchanged from the
  release tag into `clients/web/src/fixtures/released/<tag>/`) and checks
  every current field is present and every newer capability is gated.
- `App.test.tsx` renders Settings and torrent detail against a released host
  and requires its missing features to be hidden.
- `clients/web/src/api/contract-compatibility.test.ts` diffs the generated
  schema against each released schema: nothing removed or newly required,
  every new client-sent key owned by a capability, and every addition
  released strict clients would reject recorded and reviewed.
- Rust tests keep registry names and IDs unique, every owned patch key real,
  and every entry advertised in the hello.

## Current Release Hold

As of 2026-10-14, `main` carries five reviewed strict-client exposures (see
`REVIEWED_STRICT_CLIENT_EXPOSURE`). Extensions 1.1.3 (published) and 1.1.4
(in review, built from `5fa018ff`) validate strictly. A torrent list
snapshot from a host built from current `main` includes the new
`ClientSettings.seed_stop_*` fields, so the companion fails on its first
library view and asks for a reload. **Do not release desktop, headless or
Android from `main`** until a tolerant extension is published and has had a
few days to auto-update, or the maintainer accepts the companion break for
that release.

## Release Runbook

Before any host release (desktop, headless, Android):

1. `npm run test --prefix clients/web` passes, including the compatibility
   tests above.
2. Check `REVIEWED_STRICT_CLIENT_EXPOSURE`. Each entry is something released
   strict clients reject. Until a tolerant extension (Tactical 354 Slice 3)
   is published and has had time to auto-update, a host release that ships
   any entry breaks the extension companion for users who update the host
   first. Either ship the tolerant extension first, or accept and record that
   break for the release.
3. After the release, add its fixtures: copy `v1.schema.json`, an API hello
   built from that release's source and the generated
   `view-set-trace.json` and default settings view from the release tag into
   `clients/web/src/fixtures/released/<tag>/`, add the tag to both test
   files, and move reviewed exposures the release shipped into history.

Before deploying the hosted controller: the same web tests pass. It deploys
from `main`, so a contract change is live for every connected host as soon
as it is pushed.

## Removing A Fallback

1. A transitional capability becomes eligible once its introducing release
   is older than the horizon **and** the version populations below show hosts
   without it below about 2% on every surface that can host the client.
2. Removal is an explicit, reviewed commit: delete the client gate and
   fallback, mark the registry entry `required`, and cite the evidence. The
   host keeps advertising it.
3. A host lacking a required capability is below the floor and gets the
   update screen.
4. Host-side removal of something clients send follows the same rule for
   client versions.

## Version Observability

Removals and horizon changes need version populations. Available without new
telemetry:

| Surface | Source | State |
| --- | --- | --- |
| Desktop | Update checks request `updates.jstorrent.com/tauri/{target}/{arch}/{current_version}` | Unconfirmed whether that endpoint keeps request logs |
| Android | Play Console installs by version | Available |
| Extension | Web Store dashboard users by version | Available |
| Headless, Crostini | None | Gap |

A periodic version-population record belongs here once these are read.

## Gaps And Next Work

- **Tolerant clients (354 Slice 3).** Released strict clients reject new
  fields in closed types, new enum values and new variants. Make output
  objects open, map unknown enum values and row deltas to an explicit
  unknown, ignore unknown frames, and publish a tolerant extension.
- **Per-call `unsupported`.** A released host closes the connection on an
  unknown key; current hosts should answer per call instead.
- **Relay authentication leniency** for unknown fields.
- **Out-of-date notice and update screen**, with Tactical 343's About work.
- **Version-population record** from the sources above.
- **Automatic updates**, Tactical 355.
- **Store automation.** Extension upload and submission are manual through
  the dashboard; Google review still takes days.
