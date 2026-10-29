# Mixed-Version Compatibility

Tactical [389](../tactical/389-localized-product-release.md) carries forward the
existing Stable 0.3.4/Android 1.0.33 companion requirement for the explicitly
requested localized desktop 0.3.6 and Android 1.0.35 releases. Only the same
eight reviewed fields are accepted for those exact tags; browser control still
requires extension 1.1.5+. Strict-client policy remains enabled, with no new
enum or unsolicited view exposure accepted.

The same tactical now records extension 1.1.8 and remote controller 0.3.5 as
public on October 29, with exact independent client captures and successful
live matrices. Remote 0.3.4 remains an unserved, withdrawn attempt. Android
1.0.34 passed its tagged build, exact-source CI and internal Play upload, but
its production candidacy is withdrawn in favor of 1.0.35's ZIP security repair.
Production delivery remains pending. New client captures must decode all raw
frames unless an explicit legacy failure is recorded; the strictness and
unattributed-exposure checks remain unchanged.

Tactical [386](../tactical/386-browser-handoff-and-report-context.md) submits
extension 1.1.7 at `0f128550` after the hosted 16-pair live matrix passes. Its
exact client capture accepts current host frames with zero raw failures. The
ledger records submitted status, not first-public delivery; 1.1.6 is still
public at the submission checkpoint. No host contract, capability or support
window changes. The independently deployed website accepts both exact
handoff URL spellings, with manual recovery for older installed extensions.

Tactical [377](../tactical/377-compatible-touchless-release-channels.md) adds
release/database compatibility metadata to the updater service, without new
application fields, commands or capability IDs. The existing desktop updater
capability and older-host fallback remain. At its completion public publication
retained the strict-companion guard; private installation cohorts do not waive
the 30-day window or authorize host-side response shaping. Subsequent Latest
authorization and publication are recorded below.
The adoption dashboard required Google reauthentication on October 17, so no
new adoption count or permission to lift the hold is inferred.

Tactical [378](../tactical/378-public-latest-and-nightly.md) records subsequent
maintainer authorization and public Latest 0.3.2 publication, with daily
changed-main releases scheduled at 03:17 UTC.
Latest requires extension 1.1.5 or newer for exactly the eight accepted field
exposures. `acceptedLatestDesktopFields` is limited to numeric
`desktop-latest-v*` releases on desktop; new fields and unrequested variants
still block. Stable, Android and Stable promotion retain the original guard
unless their exact release has a separately accepted exception, recorded below.
This is an accepted Latest exception, not an adoption finding or retirement of
strict clients. The daily selector requires green full push CI for exact main
head and skips source already released to Latest.

Tactical [380](../tactical/380-product-release.md) records explicit October 22
publication authorization for desktop Stable 0.3.4 and Android 1.0.32 with
extension 1.1.5+ required. Per-release exceptions accept the same eight reviewed
field additions; strict-client support/captures remain for other releases.
This is an accepted release exception, not measured adoption or a changed
30-day horizon. Legacy host response shaping is deferred.
Both exact host versions are now public, with their October 22 first-public
records and source captures retained in the delivery ledger. Desktop's public
Stable/Latest payloads, signed database facts and live offers verify; Android
passes physical ChromeOS companion checks and is available on Google Play.
This does not authorize future Stable/Android exceptions or remove a fallback.

Tactical [375](../tactical/375-ci-reconciliation-and-ui-regressions.md)
reconciles the concurrent updater/safety contracts. Safety and bitmap capability
IDs remain 4 and 5; the unpublished desktop updater uses 6. Both generated
contracts and client-first exposure records are retained. No released ID,
command, setting or compatibility horizon changes.

Tactical [355](../tactical/355-automatic-updates.md) registers capability 6,
`desktop_auto_updates`, for the `product_update` application call and its
status/check/install/channel/preference/activity/snooze requests. Only desktop
hosts with a native updater owner advertise it. Fresh hellos rebind the web
updater and activity reporter; hosts without it retain the existing manual
surface and never receive the new call. Connected clients that cannot report
activity conservatively block unattended restart. This does not change the
30-day horizon or authorize removal of the existing fallback.

Tactical [373](../tactical/373-file-selection-bitmaps-and-download-safety.md)
adds `file_safety` (settings/explicit override commands) and
`file_selection_bitmaps` (larger stored selection sets). Missing capabilities
hide safety controls and retain the older host's changed-file draft limit.
Released priority values remain unchanged. File safety and safety-summary row
fields are optional; strict-client exposure is reviewed under the existing
client-first hold. Legacy full-response decoding uses the gateway's existing
16-MiB ceiling so large metadata-bounded arrays do not retain a hidden 512-KiB
client limit. The normal 30-day compatibility/release rules still apply.

Tactical [367](../tactical/367-encrypted-short-links.md) is client-only:
short links wrap the existing host-exported fragment and add no host command,
field or capability. Menu copies remain full links. Its separately deployed
service keeps the v1 decryptor through the 30-day record lifetime; older web
clients can drop the optional remembered choice safely back to off.

Topic: `mixed-version-compatibility`

Tactical [360](../tactical/360-remote-controller-subdomain.md) publishes the
independent hosted controller at remote.jstorrent.com, starting with 0.3.2 on
2026-10-16. Tagged releases pass the live compatibility gate; marketing no
longer advances the client. Both old/new controller decoders are captured.
The legacy origin and asset bridge have a reviewed retirement window below.

Status: Active, started 2026-10-14 by Tactical
[354](../tactical/354-mixed-version-compatibility.md). Slices 1 and 2 have
landed. The web client fills fields older hosts omit, hides stop limits on
hosts that lack them and never sends their settings there, and accepts the
object fields and row field kinds a newer host adds. CI checks the contract
against the released `desktop-v0.3.1` host. Extension 1.1.5, the first
tolerant extension, was submitted to the Web Store on 2026-10-15 through the
tagged release workflow (Tactical
[361](../tactical/361-extension-store-publishing-setup.md)) and awaits
review. Host tolerance, version observability and automatic updates (Tactical
[355](../tactical/355-automatic-updates.md)) remain.

This topic owns how clients and hosts of different versions work together:
the support horizon, the capability model, the contract rules every feature
follows, the checks that enforce them, and the release and removal runbooks.
Terms such as host, client, matched pair and strict client are defined in
the [glossary](../glossary.md).
[`durable-data-migrations`](durable-data-migrations.md) owns stored data;
[`application-view-api`](application-view-api.md) owns the contract itself.

## Where Versions Differ

| Client | Host | Why they differ |
| --- | --- | --- |
| Hosted controller, `remote.jstorrent.com` | Desktop or headless over the relay; Android later | The controller deploys only from `remote-v*` tags after its compatibility gate. Hosts update on their own schedule. |
| Extension companion pages | Android over ARC; desktop over native messaging | The extension updates through Web Store review and auto-update, independently of Play and the desktop updater. |

The desktop webview, gateway-served UI (headless, Crostini), Android Compose
and iOS ship or serve their own UI and always match their host.

Both directions occur:

- **New client, old host.** The hosted controller may release before a host update. The extension is
  often newer than an Android host still in Play rollout.
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
| New field in an existing command | A released host's command parser ignores it, silently dropping the intent. Own it with a capability's `command_fields` (`command.field`); live dispatch strips it for hosts without the capability, and the UI hides what depends on it. CI fails on an unowned field. |
| New command, settings patch key or torrent settings patch key | Add a capability in `crates/rstorrent-session/src/host_capabilities.rs` that owns it, gate the control with `hostSupports`, and let the live dispatch filter drop it for hosts without it. CI fails on an unowned key. |
| New row field kind a host sends (a `*FieldUpdate` variant) | Tolerant clients drop unknown kinds. Record it in `reviewedClientExposure` as a `field`; it blocks host releases only while strict clients (extension 1.1.4 and older) are supported. |
| New field inside a type released clients validate strictly (`additionalProperties: false`) | Same as a new row field kind. |
| New enum value or other tagged variant a host sends | Every released client rejects it, tolerant ones included, and CI checks every contract in the window for it. Add a new optional field instead, or make clients tolerate that type first. It is a `value` in `reviewedClientExposure` and blocks host releases unless a host sends it only after a request no supported client that rejects the value can make (`requestedBy`, checked in CI). |
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
  lacks, and every command through `supportedCommand`, which drops owned
  command fields. A patch left empty is refused locally with an update
  message instead of being sent.
- **Defaults for omitted fields.** Validators are generated with Ajv
  `useDefaults`, so a field Rust gives a serde default is present after
  validation even when an older host omits it. Ajv cannot fill defaults
  inside `oneOf` branches; `generate-validators.mjs` fails on any such
  default outside its reviewed list, and on any omittable field TypeScript
  types as present. `ServiceSnapshot.client_settings` keeps its hand-written
  fresh-profile default in `validation.ts`.
- **Tolerance for newer hosts.** The generated host validators drop
  `additionalProperties: false` and give each row field union
  (`TorrentFieldUpdate`, `PeerFieldUpdate`, `FileFieldUpdate`,
  `ActivePieceFieldUpdate`) a branch for string kinds this client does not
  know. `validation.ts` then drops those fields, bounding the raw update at
  256 fields first; an update left with only unknown kinds changes nothing.
  Hand-written records require their known keys and ignore extras.
  `validateCommand`, for what the client builds, is generated separately
  from the exact schema (`v1.client-validators.js`) and stays strict, as do
  enum values and other variants.
- **Hosts refuse unknown calls one at a time.** When a frame cannot be
  parsed but carries a well-formed `call_id` (and is not `connect`), the
  gateway answers that call with `call_error` / `invalid_call` and the
  exported `UNSUPPORTED_CALL_MESSAGE`, without counting it toward the
  three-invalid-messages limit. The relay host forwards such a frame to the
  gateway instead of closing the circuit; the gateway parses the same types,
  so nothing it could not accept passes. The web client turns that reply into
  a localized "update JSTorrent there" result. Hosts released before
  2026-10-15 still close the connection, which the client's gating avoids.
- **Two-way identity.** Hosts report `ApiHello.product`; clients report
  `ApiClientInfo { kind, version, build_id }` in `connect` (Tactical
  [370](../tactical/370-version-handshake-and-compatibility-reports.md)):
  `remote`, `extension` or `web`, from `clients/web/src/client-identity.ts`.
  Every captured host ignores unknown `connect` fields (checked per capture,
  and live by the matrix driver, which sends one), so the identity is sent
  before the hello and is the one ungated client addition. A malformed
  identity is dropped, never fatal. Hosts count connections and refused
  calls per `kind version` in their connection metrics (32 identities, then
  `other`), advertise `client_identity`, and never decide features from it.
- **Mismatch observations.** The WebSocket client keeps a bounded
  `CompatibilityObservations` per host version (`unreported` for hosts
  without `product`): decode failures by stage, calls refused with the
  sentinel by operation, and, from `LiveApplication`, command fields and
  settings keys stripped for the host, actions refused or substituted
  locally, and whether the library attached. They stay in memory
  (`LiveApplication.compatibilityObservations()`); nothing is transmitted.
  A late reply to an aborted call is ignored rather than failing the
  connection.
- Android Compose and iOS run the engine in process and need no gates; the
  Kotlin and Swift exports of the registry are deferred until a native client
  controls another host.

## Checks

- **Captures and ledger.** `compat/deliveries.json` lists every submitted
  or published delivery (surface, version, source commit, status, dates,
  roles), with explicit exclusions for frozen incubation lanes and the
  legacy TypeScript Android app. `scripts/compat-capture.mjs --commit <sha>
  --roles host,client` checks the commit out in a temporary worktree and
  records what that source produces into `compat/captures/<commit>/`: for a
  host its schema, view-set trace, hello and default settings; for a client
  its bundled decoder. `scripts/compat-ledger.mjs` fails when a supported
  delivery lacks a capture, or a production tag is neither recorded nor
  excluded; it runs in CI, both release workflows (enforced when
  publishing) and the hosted deploy, and prints when each older delivery
  leaves the window.
- **Support window.** `scripts/compat-window.mjs` decides which deliveries
  are supported: the newest of each surface, and an older one until 30 days
  after a newer delivery of its surface first became public. The ledger
  script and every matrix test use it (`COMPAT_TODAY=YYYY-MM-DD` previews a
  later date). When a delivery leaves, CI fails on what depended on it so
  cleanup is a reviewed commit: a reviewed exposure no supported contract
  produces, a known break naming no supported release, a release hold with
  no strict client left, and the Download all fallback for hosts before
  0.3.1 (`compat/window.test.ts`).
  `clients/web/src/compat/captures.ts` loads them for the tests below.
- `clients/web/src/released-hosts.test.ts` (D1) decodes every captured
  host's hello, views and settings and checks every current field is
  present and every newer capability is gated.
- `App.test.tsx` renders Settings and torrent detail against a released host
  and requires its missing features to be hidden.
- `clients/web/src/api/contract-compatibility.test.ts` diffs the generated
  schema against each released schema: nothing removed or newly required,
  every new client-sent key owned by a capability, and every addition
  released strict clients would reject recorded and reviewed.
- `clients/web/src/newer-host.test.ts` adds an unknown field to every object
  of the current and released traces and of a released hello, and unknown
  row field kinds to a row update, and requires the same result as without
  them.
- Rust tests keep registry names and IDs unique, every owned patch key and
  command field real, and every entry advertised in the hello.
- **Matrix ([Tactical 359](../tactical/359-mixed-version-compatibility-matrix.md)).**
  `clients/web/src/compat/old-clients.test.ts` (D2) runs each captured
  decoder over current host frames; raw failures are allowed only under the
  release hold and must disappear when exactly the reviewed exposures are
  removed. The "requests to released hosts" tests in
  `LiveApplication.test.ts` (R1) record what current dispatch emits against a
  released host's hello and validate it against that host's exact schema with
  every object closed; actions it lacks emit nothing.
- **Live happy path.** `tests/interop/compat_live_matrix.py` runs a real
  host built from each captured commit against the current client, and the
  current host against each captured client's own code: connect, set the
  download folder, download and verify a torrent from a local libtorrent
  seed, and remove it with its data. Run it locally with
  `uv run --project tests/interop --locked python tests/interop/compat_live_matrix.py`
  (or `--host`/`--client` with `current` or a commit); CI runs it manually,
  on release tags and weekly (`Compatibility live matrix`). Run it before a
  host or extension release.
- **Known breaks.** `compat/known-breaks.json` records incompatibilities the
  matrix found in released combinations, each with a fix-or-accept
  decision. The contract and R1 tests accept exactly those items for those
  captures and fail on anything else. Hosts released before capabilities
  existed cannot be told apart by their hello; the one fix that needed to
  (Download all on desktop 0.3.0 and Android 1.0.28) recognizes them by
  their missing `server_now_millis`. Hosts released since report product
  and capabilities, so this is not a pattern for new features.

## Current Release Hold

As of 2026-10-17, `main` carries thirteen reviewed client exposures (see
`reviewedClientExposure` in `clients/web/src/api/release-compatibility.json`). Extensions 1.1.3 and 1.1.4
(built from `5fa018ff`, published) validate strictly. A torrent list
snapshot from a host built from current `main` includes the new
`ClientSettings.seed_stop_*` fields, so the companion fails on its first
library view and asks for a reload. **Stable desktop and Android publication
remain held** until extension 1.1.5 (tolerant; `extension-v1.1.5`,
published 2026-10-15) has had a few days to auto-update, or the maintainer accepts the companion break for that
release. Eight are fields 1.1.5 tolerates, including the three download-safety
fields added by 373. The other five are the `library_media` view/snapshot/patch
variants (363) and `product_update` call/result variants (355); each is sent
only after a request no released client makes. The publishing guard currently
refuses all eight field additions; none of the five request-gated variants
requires a break exception.

The maintainer subsequently authorized public Latest on October 17. Its
explicit eight-field exception and extension requirement are recorded above;
the same check receives the actual Latest tag, never a fabricated Stable tag.
The exception does not authorize Stable promotion of those bytes.

The desktop and Android release workflows enforce this hold:
`scripts/check-release-compatibility.mjs` fails a publishing run while a
blocking exposure exists and `acceptedBreaks` has no entry for that release
tag. A `field` blocks while `strictClients.supported` is true; a `value`
blocks unless it has `requestedBy`. Candidate and other
non-publishing runs only warn. Lift the hold by setting
`strictClients.supported` to false once 1.1.5 has had time to replace older
extensions (Web Store dashboard version counts), or record an accepted break
for one release.

## Release Runbook

Before any host release (desktop, headless, Android):

1. `npm run test --prefix clients/web` passes, including the compatibility
   tests above.
2. The release workflow's compatibility check passes, or fails with the
   exposures to resolve. Each entry in `reviewedClientExposure` is
   something some released clients reject. Until the oldest extension still
   in use is tolerant (1.1.5 or later), a host release that ships a `field`
   entry breaks the extension companion for users who update the host
   first. Either wait for the tolerant extension, or accept and record that
   break for the release. A `value` (enum value or non-row variant) breaks
   tolerant clients too; do not ship one unless no released client can
   receive it.
3. When a delivery is submitted (desktop, Android, headless, extension, remote),
   add it to `compat/deliveries.json` and run `scripts/compat-capture.mjs`
   for its commit with the roles it plays, then commit both. The ledger
   check fails CI until this is done for a pushed production tag, including
   `extension-v*` and `remote-v*`. A client release whose own decoder is tolerant lies at or
   above `strictClients.tolerantSince` in `release-compatibility.json`.

Before deploying the hosted controller:

1. Commit the candidate source on main and run web/compatibility validation.
2. Capture that exact commit with role `client`. In a following metadata
   commit, record the delivery as submitted with no first-public date and its
   explicit raw-decoder outcomes. The source commit remains the release input.
3. Create `remote-vMAJOR.MINOR.PATCH` at the candidate commit. Push the metadata
   main update and candidate tag together with `git push --atomic` so ordinary
   main CI never sees an unrecorded tag. The tag must be reachable from main.
4. Remote Controller gates deployment on the live old/new matrix, tested root
   artifact/browser smoke and Pages header/digest verification. It deploys the
   exact retained artifact, not a new build made in the deploy job.
5. Run the explicit public canary with signed route cleanup, then mark the
   delivery published with its verified first-public date. Retain the immutable
   rollback artifact. Main and marketing deployment do not advance the client.

The first independent release is remote-v0.3.2 at 859f00de (2026-10-16).
Remote-v0.3.3 at 5cb10f29 is public from 2026-10-21; Tactical
[380](../tactical/380-product-release.md) records exact-source capture, the
passing tagged matrix/deployment and disposable public canary with signed
cleanup. Host Stable/Android companion-policy holds remain.
The legacy remote 0.3.1/bdc58e4a delivery leaves its window on November 15;
old-origin admission and frozen lazy assets remain until reviewed retirement
no earlier than November 16. Old document redirects remain afterwards.

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
| Desktop | Update checks request `updates.jstorrent.com/tauri/{target}/{arch}/{current_version}` | Available: the update server keeps request stats (`projects/jstorrent/update-stats.sh` in the maintainer's dotfiles) |
| Android | Play Console installs by version | Available |
| Extension | Web Store dashboard users by version | Available |
| Headless, Crostini | None | Gap |

A periodic version-population record belongs here once these are read.

Tactical [371](../tactical/371-statistics-and-compatibility-rollout.md)
steps 1–3 deployed statistics-choice logging on 2026-10-15 and added
on/off/unreviewed/missing counts and an installation estimate to the
maintainer's update-stats script. The estimate uses unique explicitly-on
IDs and the on/off check ratio within each window, assuming equal check
frequency. Missing and unreviewed checks are excluded. Existing production
checks lack the new header, so the estimate remains unavailable until a
desktop release supplies an identified on sample. This changes neither
the release hold nor the missing hosted-controller usage signal below.

**Hosted remote controller usage is unknown.** Nothing records whether
anyone uses `remote.jstorrent.com` or which host versions it connects to.
The relay could count authenticated circuits by host build (it sees
`host_build` only inside the encrypted channel today, so this needs a
privacy-reviewed, coarse signal), and the site could count page loads. Until
then, decisions about the remote controller rest on the maintainer's belief
that it has very few users.

## Gaps And Next Work

- **Legacy controller retirement.** Tactical
  [360](../tactical/360-remote-controller-subdomain.md) deploys the independent
  controller lane. Remove the old exact origin and frozen asset bridge only
  after its recorded window and a reviewed retirement change; the old document
  URLs keep redirecting. Initial new-project CI credential acceptance, canary
  and query/fragment/cached-tab checks pass.
- **Extension 1.1.5 adoption.** Published 2026-10-15. Lift the release
  hold (`strictClients.supported: false`) once the Web Store dashboard shows
  most users on it; CI forces it when 1.1.4 leaves the window on
  2026-11-14.
- **Unknown enum values and frame types.** Still rejected by every client.
  Mapping them to an explicit unknown needs per-type handling in the UI.
- **Relay authentication leniency** for unknown fields, after a security
  review against `remote-access-authentication`.
- **Out-of-date notice and update screen**, with Tactical 343's About work.
- **Version-population record** from the sources above, and a usage signal
  for the hosted remote controller (see Version Observability). The desktop
  update server already reports desktop version counts
  (`runbooks/update-server-analytics.md` in the maintainer's dotfiles).
- **Compatibility reports** (Tactical 370 slice 4): the observations above
  sent with the desktop update check (when usage statistics are on) and
  through the relay's handshake for remote access, under the maintainer's
  opt-out policy in `product-state-and-feedback`. Needs changes to the
  update server and relay and their deployment.
- **Automatic updates**, Tactical 355.

### Controller release lane (Tactical 360)

The controller has a separate `remote-vMAJOR.MINOR.PATCH` release lane. Main
and PR builds test the root-hosted artifact without publishing it. A tagged
release must be reachable from main and passes the live old/new compatibility
workflow before the tested Pages artifact is deployed. Add its exact source
capture and public delivery date after verification; preserve the last combined
controller (remote 0.3.1 at bdc58e4a) as the pre-cutover baseline. Its decoder
already has field tolerance; this does not lift the extension host-release hold.

For `requestedBy` exemptions, a supported client may ask for a feature whose
response it already understands. The prohibited case is a client that both
can ask for the feature and rejects its output. A synthetic negative control
covers that case, alongside each actual supported capture.


October 22 release qualification adds Android 1.0.32 as a captured host with
seeding-limit and magnet-export capabilities. The real-dispatch request
matrix now derives stripping/refusal expectations from each captured hello,
while validating supported requests against that host's exact schema. Earlier
hosts retain their existing refusal and fallback expectations. Tactical 380
records the source-gate correction.
