# Implementation Tactical Docs

- [381 — Dependency cleanup and fresh security findings](381-dependency-cleanup-and-security.md):
  active; finish the dependency PRs and notice checks, remediate fresh
  advisories, and verify the merged source without waiving findings.

- [380 — Product releases](380-product-release.md):
  extension 1.1.6 and remote 0.3.3 published; Stable/Android release resumed.

- [379 — Release security dependency repair](379-release-security-dependencies.md):
  complete; patched rustls/ZIP and retained updater 2.10.1 pass full CI,
  signed native builds and public Latest 0.3.2 qualification.
- [378 — Public Latest and nightly publication](378-public-latest-and-nightly.md):
  complete; public Latest 0.3.2 and live five-target offers verify; daily
  changed-main releases use full CI and a bounded companion exception.
- [377 — Compatible touchless release channels](377-compatible-touchless-release-channels.md):
  qualified signed installed updates, database admission and immutable promotion.
- [376 — Android media Library](376-android-media-library.md): complete;
  Torrents | Library primary navigation (bar, or rail from 600 dp) and a
  Compose Library over `library_media` with presets, search, filters, shows
  and albums in place, pages, and Files-style rows with Play, Open with…,
  Open containing folder and Show in torrent.
- [375 — CI reconciliation and UI regressions](375-ci-reconciliation-and-ui-regressions.md):
  merge concurrent contracts, repair Rust test lints, and scope browser/iOS
  assertions to displayed or scrolled settings controls.
- [372 — CI packaging and presentation regressions](372-ci-packaging-and-presentation-regressions.md):
  npm Git notice provenance, current support-link/Settings browser assertions
  and Android pending-selection request order across service startup.
- [371 — Statistics and compatibility reporting rollout](371-statistics-and-compatibility-rollout.md):
  ready; handoff plan for the update server's opt-out logging and estimate,
  lifting the release hold, the companion header fix, releases, and
  compatibility reports over update checks and the relay.
- [370 — Version handshake and compatibility reports](370-version-handshake-and-compatibility-reports.md):
  slices 1–3 complete; value exposures checked for tolerant clients, a
  computed support window that forces cleanup, client identity in `connect`
  and in-memory mismatch observations. Reports (opt-out, via update checks
  and the relay) are next.
- [369 — Recovery screen when the torrent catalog will not open](369-catalog-recovery-screen.md):
  desktop, Android and headless offer updates, a read-only torrent list export
  and bug-report details instead of crashing or a generic error.
- [368 — Local MP4 native playback](368-local-mp4-native-playback.md): complete;
  prefer codec-checked native MP4/M4V playback so Big Buck Bunny's MP3 audio
  plays without transcoding; parser disposal preserves the player session.
- [367 — Encrypted short links](367-encrypted-short-links.md): proposed; an
  opt-in `link.jstorrent.com` short link whose Cloudflare Worker stores only
  ciphertext, keyed from the fragment, for a readable Share panel QR code.
- [364 — Library review fixes](364-library-review-fixes.md): albums and shows
  named by a torrent's own folder, file counts per preset, kind icons, inline
  audio, shared segmented toggles, a sortable Library table and adding from
  the header on every destination.
- [363 — Library media index](363-library-media-index.md): the host indexes
  video and audio across torrents in memory and serves `library_media` pages
  by query; the web Library browses them with search, filters, presets for
  shows, movies, music and torrents, cards or list, and pages.
- [362 — Local browser inline video playback](362-local-browser-inline-playback.md):
  complete; browser-hosted Files and Library **Play** completed MP4/M4V/MKV in
  the shared playsvideo dialog, with Open in a new tab as the fallback.
- [361 — Extension store publishing setup](361-extension-store-publishing-setup.md):
  done; one-time Google and GitHub setup so `extension-v*` tags submit to the
  Chrome Web Store, and extension 1.1.5 submitted through it.
- [360 — Hosted remote controller on its own subdomain](360-remote-controller-subdomain.md):
  proposed for later; serve the remote controller from `remote.jstorrent.com`,
  deployed only from `remote-v*` tags and isolated from the marketing site.
- [359 — Mixed-version compatibility matrix](359-mixed-version-compatibility-matrix.md):
  proposed; proves old/new host × old/new client for every release in the
  support window from artifacts captured from each release's own source, and
  fails release workflows when a release is missing.
- [358 — One durable store and a migration ledger](358-one-durable-store-and-migration-ledger.md):
  desktop shell switches and the network-defaults marker move into SQLite,
  the extension keeps statistics consent, and every migration is ledgered
  with a retirement condition.
- [357 — Rich share links](357-rich-share-links.md): share exports add size,
  selected files and an opt-in peer hint; web and Android gain file shares,
  a Share panel, QR codes and the system share sheet; the share page shows
  file names and sizes.
- [356 — Precompressed hosted web assets](356-precompressed-hosted-web-assets.md):
  `npm run build:hosted` writes brotli and gzip copies that the gateway's
  static fallback serves by `Accept-Encoding`; a throttled first load drops
  from about 1.9 MB to 0.3 MB.
- [355 — Automatic updates](355-automatic-updates.md): proposed; unattended
  desktop install, opt-in headless apply and Play In-App Updates so old hosts
  age out and 354's horizon can tighten.
- [354 — Mixed-version compatibility and capabilities](354-mixed-version-compatibility.md):
  proposed; a 30-day support horizon, two-way capability advertisement,
  tolerant contract, CI audits and dated capability removal, starting with a
  repair of the hosted controller against released hosts.
- [353 — Host product facts in the API hello](353-host-product-in-hello.md):
  hosts report version, build, target, app ID and profile in the hello;
  About shows them everywhere and the client re-reads them after reconnects.
- [352 — Render-first web startup](352-render-first-web-startup.md): the
  real shell renders before the engine connects, with placeholder rows until
  the first library view; transports, adapters, demo and settings load off
  the critical path; startup timings join support diagnostics.
- [351 — Narrow web lists and flat chrome](351-narrow-web-lists-and-flat-chrome.md):
  navigation moves into the sidebar and narrow drawer, narrow details get an
  app bar, tables render as list items at 760 px and below, and desktop
  content loses its alternating gray bands.
- [350 — Share links across clients and private hint](350-share-links-and-private-hint.md):
  the view projects BEP 27 private; web and Android copy share links through
  one action with a private hint; the website `/share/` page reads new and
  legacy links.
- [349 — General tab compact header and links](349-general-tab-compact-header-and-links.md):
  one header line and one status line replace the summary card and repeated
  state; the tab copies the magnet link, a share link and the info hash.
- [347 — About on every web host](347-about-on-every-web-host.md): Settings
  always has About with connection, version, build, desktop profile and
  support diagnostics; updates appear only where the app updates itself.
- [346 — Action feedback toasts](346-action-feedback-toasts.md): one
  bottom-centre toast replaces inline result rows; visible results show
  nothing, errors persist, archive/restore offer Undo, copy is localized.
- [345 — Never reset shipped catalogs; migrate forward](345-supported-catalog-migrations.md):
  schema 26 is the supported baseline, automatic reset is removed, and later
  schemas migrate through checked steps proven against a released catalog.
- [344 — Seeding stop limits](344-seeding-stop-limits.md): draft; global and
  per-torrent ratio and seeding-time limits that stop a finished torrent,
  separate from the priority-only seed goals.
- [342 — Deliver DHT peers as replies arrive](342-stream-dht-peers-during-lookup.md):
  per-reply DHT peer delivery to the torrent, bounded and non-blocking, with
  the final lookup result still authoritative.
- [341 — Peer sources in the Trackers tab](341-trackers-tab-peer-sources.md):
  an untitled summary of a torrent's peer sources, trackers first, above its
  tracker table, from the existing tracker, swarm and DHT views.
- [340 — Quiet Windows network startup and firewall qualification](340-windows-quiet-network-startup.md):
  Windows fresh/upgrade defaults, preserved opt-in choices, native denial,
  controlled cross-VM transfers and retained-data migration.
- [339 — Quiet Mac network startup and explicit incoming settings](339-macos-quiet-network-startup.md):
  Mac fresh/upgrade defaults, complete TCP/uTP Off, forwarding disclosure,
  idle DHT, shared/Android gates and isolated native transfer/migration evidence.
- [338 — macOS network consent research and plan](338-macos-network-consent-research.md):
  historical Mac/Windows consent research, fresh-port uTP admission controls
  and the Fast availability diagnosis; implementation follows in 339.

- [337 — Lightweight macOS development bundle](337-lightweight-macos-development-bundle.md):
  separate foreground debug `.app` launcher with native registration and
  production-ID extension lifecycle verification.

- [336 — Production desktop extension control](336-production-desktop-extension-control.md):
  exact production/beta bootstrap admission and real unpacked macOS lifecycle
  qualification; signed desktop delivery remains separate.

- [335 — Removal Pieces and disconnect lifetime](335-removal-pieces-and-disconnect-lifetime.md):
  valid empty Pieces snapshots and joined accepted removal through WebSocket close.

- [333 — Web settings plain copy](333-web-settings-plain-copy.md):
  shared React settings, torrent settings and General tab use plain copy,
  speed presets and row-level notes instead of engine runtime state.

- [331 — Android settings plain copy](331-android-settings-plain-copy.md):
  Settings and torrent Details/Status use plain copy with section headers and
  speed presets; engine state, enum names and seeding goals are no longer shown.

- [330 — Android 1.0.31 production release](330-android-1-0-31-production-release.md):
  exact signed artifacts qualified and production review submitted at 100%;
  automatic publication after approval, with quick checks pending.

- [329 — Android remove download folder](329-android-remove-download-folder.md):
  any folder can be removed; its torrents stop safely and wait for repair,
  files are kept unless the Delete data option is chosen.

- [328 — Android add before download folder](328-android-add-before-download-folder.md):
  in-app adds without a folder wait in the intake dialog, which asks for the
  folder and then continues the add as if the folder had been ready.

- [327 — Removal hang with inbound peers](327-removal-hang-with-inbound-peers.md):
  removing a fast download with attached inbound peers no longer freezes the
  Android engine; teardown closes the inbound event queue before joining.

- [326 — Full product release](326-full-product-release.md): desktop 0.3.1
  published, Android 1.0.30 published at 100%, and extension 1.1.4 pending
  review with automatic publication; exact packages, sources, website and updater.

- [325 — Android CI library readiness](325-android-ci-library-readiness.md):
  owned first-use smoke observes the current All tab after statistics opt-out;
  preserves complete SAF lifecycle assertions and bounded cleanup.

- [324 — Release queued adds on skip file selection](324-release-queued-adds-on-skip-file-selection.md):
  `Don’t show file selection again` releases the rest of the add queue with
  its existing selection, and the web dialog no longer freezes on `Saving…`.

- [323 — Pre-metadata skip file selection](323-pre-metadata-skip-file-selection.md):
  Android shows `Don’t show file selection again` while a magnet loads and
  pre-metadata Download all applies it atomically with the add.

- [322 — Android empty filter navigation](322-android-empty-filter-navigation.md):
  actionable return to All from empty filters, with Add guidance for an empty
  library.

- [321 — Android feedback statistics checkbox](321-android-feedback-statistics-checkbox.md):
  verified hosted pages, enabled Android context gate and accessible per-report
  statistics toggle.

- [320 — Android-owned ChromeOS extension setup](320-chromeos-android-owned-extension-setup.md):
  complete locally; direct production launch, notification-gated native setup,
  exact HTTPS UI return and two-device isolated pairing/recovery evidence.

- [319 — Android ongoing notification rates](319-android-ongoing-notification-rates.md):
  background notification shows download and upload rates, reposted at most
  every two seconds by one content owner.

- [318 — Android duplicate add feedback](318-android-duplicate-add-feedback.md):
  in-app adds report torrents already present, archived matches offer
  Restore, and test torrents honor the file selection setting.

- [317 — Android Files tab rows and multiselect](317-android-files-tab-rows-and-multiselect.md):
  compact file rows, an explicit three-way priority sheet and Library-style
  multi-file selection with bounded batch commands; presentation only.

- [315 — Android 1.0.29 production release](315-android-1-0-29-production-release.md):
  signed crash/UX hotfix, production review, automatic publication and100%
  rollout under explicit maintainer direction.

- [314 — Android presentation shutdown race](314-android-presentation-shutdown-race.md):
  terminal subscription ownership, contained setup failures and cancellation
  cleanup following the version28 production crash; store delivery separate.

- [312 — Reliable credit-based range streams](312-reliable-credit-range-streams.md):
  shared receive credit, bounded reliable lanes, arbitrary ranges, consumption
  and release barriers, compatibility and measured RTT/loss behavior.

- [311 — Android notification settings consolidation](311-android-notification-settings-consolidation.md):
  one status/action row opens system controls in granted and denied states;
  independent notification preferences remain.

- [309 — Direct file transport ceiling](309-direct-file-transport-ceiling.md):
  generated ranges, raw reliable RTC and browser control distinguish storage
  cost from transport; production unchanged, RTT/loss diagnosis next.

- [307 — Direct file save throughput](307-direct-file-save-throughput.md):
  production-consumer baseline, bounded window experiments and Chrome/Edge
  large-save scope; Firefox/Safari large saves and playback deferred.

- [306 — Development documentation map](306-development-documentation-map.md):
  focused runtime/testing guides and a separate legacy migration stream.

- [304 — Fast PR feedback and CI benchmarks](304-fast-pr-feedback-and-ci-benchmarks.md):
  free-runner early checks, green-only reviewer triggers and profile benchmarks;
  full platform qualification remains independent.

- [302 — Desktop external links](302-desktop-external-links.md):
  shared browser/native link handling using scoped Tauri opener permissions.

Bounded implementation plans and execution records live here.

- [300 — Monotonic tracker view deadlines](300-monotonic-tracker-view-deadlines.md):
  stable application deadlines, per-batch clock reference and permanent
  deterministic/real-browser countdown regressions; installed delivery separate.

- [301 — Stable remote file save progress](301-remote-save-progress-presentation.md):
  separate Files feedback row, bounded display cadence and stable percentage
  geometry; no remote playback or transfer-protocol change.

Use zero-padded numeric filenames:

```text
000-first-slice.md
001-next-slice.md
```

Keep one coherent implementation slice per tactical. A tactical should be
small enough to have one falsifiable stopping condition while still producing
an end-to-end result. Parent sequencing documents are allowed when a campaign
needs them, but individual implementation work should still have bounded child
tacticals.

Create a tactical before substantial implementation. It should normally state:

- status;
- motivation and desired outcome;
- dependencies and references;
- scope;
- non-goals;
- contracts and invariants;
- implementation direction without unnecessary line-by-line prescription;
- exact validation and interoperability evidence; and
- the stopping condition or next-slice boundary.

Update the tactical as implementation reveals new facts. When complete, record
what landed, what validation actually ran, known gaps, and the recommended next
slice. Completed tacticals remain in place as execution records; living
direction belongs in `../topics/`.

Latest Android delivery record:
[`255-android-play-internal-replacement.md`](255-android-play-internal-replacement.md)
— original-key 1.0.25 replacement available on JSTorrent's Play internal track;
production and installed migration qualification remain separate.

Latest release qualification work:

- [`287-website-appimage-production-handoff.md`](287-website-appimage-production-handoff.md):
  disabled website handoff matches15 assets; both AppImage views pass locally.
- [`286-connected-companion-layout-review.md`](286-connected-companion-layout-review.md):
  settled connected layout/drawer passes; initial clipping was a capture artifact.
- [`285-production-linux-appimage-scope.md`](285-production-linux-appimage-scope.md):
  local production AppImage-only packaging; signed/installed repeats remain259.
- [`284-owned-upgrade-scenario-captures.md`](284-owned-upgrade-scenario-captures.md):
  actual owned four-pair upgrade passes; narrow connected presentation needs286.
- [`283-companion-update-recovery-guidance.md`](283-companion-update-recovery-guidance.md):
  local source/render recovery pass; real installed/store scenarios remain259.
- [`256-swarm-touch-ci-stabilization.md`](256-swarm-touch-ci-stabilization.md):
  complete; repair native-touch and asynchronous-intake CI races with all
  ten exact-source CI jobs and Website passing.
- [`257-play-upgrade-and-fresh-signed-candidates.md`](257-play-upgrade-and-fresh-signed-candidates.md):
  complete bounded Play 1.0.23-to-1.0.25 migration and current-source signed
  desktop five-target/Android candidates; full cutover remains open.

- [`259-jstorrent-finish-line-checks.md`](259-jstorrent-finish-line-checks.md):
  active; owns the maintained release checklist, exact installed evidence and
  ignored report, with explicit external delivery dependencies.
- [`272-proportional-physical-upload-budget.md`](272-proportional-physical-upload-budget.md):
  complete locally; measured proportional upload, independent full hashes and
  bounded refusals, preserving the separate whole-run reopen failure.
- [`273-native-display-wake-before-reopen.md`](273-native-display-wake-before-reopen.md):
  complete locally; targeted and full default native wake/reopen pass inside
  existing deadlines, with independent hashes and final owned cleanup.

- [`274-linux-arm-native-compositor-capture.md`](274-linux-arm-native-compositor-capture.md):
  complete locally; native GNOME recordings and restored migration evidence
  retain the ARM visual gap, with exact-owned cleanup and no graphics override.
- [`275-linux-arm-signed-deb-visual-comparison.md`](275-linux-arm-signed-deb-visual-comparison.md):
  complete locally; original-signed extracted Debian payload passes migration
  and native pixels; AppImage/final-source/installed-package gaps remain.

## Work Selection And Concurrency

Multiple independent tacticals may be **Active** concurrently. **Active**,
**Ready**, and **Later** are descriptive planning states, not locks,
authorization gates, or a required global execution order. User-directed work
may proceed in any bounded tactical whose concrete dependencies are satisfied;
it does not need to displace or pause unrelated active work. Reconcile work
only when tacticals touch the same owner or edits, depend on one another's
outcome, or propose incompatible contracts.

Some completed tacticals retain **Now** language as an execution record from
the former single-`Now` convention. That wording is historical and does not
govern current work selection.

## Decision-Complete Tacticals

A tactical intended for autonomous execution must settle enough direction that
ordinary implementation discoveries do not require repeated approval. In
addition to the fields above, record:

- the stable topic scenarios or observations that define the problem and the
  exact subset the tactical must make pass;
- the normative specifications and pinned reference source/tests that must be
  surveyed before finalizing state transitions;
- the owner, task, cancellation, dependency, and data-flow map, including
  which state must remain runtime independent;
- exact initial resource bounds, or a bounded range plus explicit authority to
  choose and tighten a conservative value from reference and test evidence;
- shape-changing edge cases that must land with the common path rather than be
  deferred into an incompatible architecture;
- the staged implementation order and the intermediate gates that keep a
  large slice diagnosable;
- a validation matrix separating pure state, scripted runtime, controlled
  interoperability, platform build, and opt-in live evidence;
- explicit non-goals and the next-slice boundary; and
- an escalation contract naming what does and does not require human input.

Unless a tactical says otherwise, in-scope implementation authority includes
ordinary refactoring, adding adversarial cases implied by its invariants,
choosing internal names and module layout, tightening declared limits, fixing
newly exposed bugs at the same ownership boundary, updating generated types,
and updating the tactical and owning topics with actual evidence. These are not
reasons to stop merely because the initial plan did not predict the exact code
edit.

Stop for human direction when evidence requires a materially different product
behavior, protocol-support claim, persistence or compatibility contract,
external dependency or license posture, destructive data action, visible or
physical-device interaction not already authorized, or a significant expansion
beyond the tactical's stated owner and non-goals. An ordinary test failure,
internal refactor, conservative bound choice, public-smoke timeout, or a
reference implementation whose architecture differs from RSTorrent is not by
itself an escalation.

Autonomy does not broaden permissions silently. A tactical that needs public
network access, fixture downloads, emulator/device use, schema migration,
generated-contract changes, or another externally visible action must state
that scope and its cleanup or compatibility rules explicitly.

## Current Tacticals

- [`240-signed-desktop-control-qualification.md`](240-signed-desktop-control-qualification.md):
  complete bounded signed Latest 0.2.801 delivery, notarized DMG/helper checks,
  native updates and installed control/transfer/picker/Quit on three platforms.
- [`239-desktop-suspension-browser-recovery.md`](239-desktop-suspension-browser-recovery.md):
  bounded browser restart, supported suspension and controlled-byte recovery.
- [`238-signed-desktop-channel-recovery.md`](238-signed-desktop-channel-recovery.md):
  existing signed channel selection/replacement/recovery without publication.

- [`237-macos-windows-package-recovery.md`](237-macos-windows-package-recovery.md):
  installed beta package replacement, rollback and registration recovery.

- [`236-desktop-compatibility-refusal-and-recovery.md`](236-desktop-compatibility-refusal-and-recovery.md):
  terminal desktop incompatibility and attach-only repair; bounded Linux beta
  old/new package matrix. Signed and broader platform update gates stay open.

- [`235-linux-quit-launch-handoff.md`](235-linux-quit-launch-handoff.md):
  bounded Linux admission retry closes the installed Quit/launch overlap;
  real native/background/magnet/file and concurrent-launch checks pass.

- [`234-desktop-user-intent-and-background-lifecycle.md`](234-desktop-user-intent-and-background-lifecycle.md):
  bounded installed macOS/Windows/Linux lifecycle checkpoint: explicit relaunch,
  persistent tray, native routing, detached transfer, reload/worker/discard
  recovery and prompt retired-client subscription cleanup.
- [`233-legacy-desktop-fixture-cohort.md`](233-legacy-desktop-fixture-cohort.md):
  completed bounded Linux/Windows released-writer cohort, closed snapshot and
  piece oracle, and proposed profile-union conflict outcomes; no importer.
- [`232-desktop-extension-control.md`](232-desktop-extension-control.md):
  installed Linux/Windows protected bootstrap, shared React control, native
  picker, controlled transfer and Quit evidence on all three platforms; broader
  bounded lifecycle qualification is recorded in 234; broader endurance and
  update compatibility remain open.
- [`231-jstorrent-migration-working-campaign.md`](231-jstorrent-migration-working-campaign.md):
  active desktop replacement campaign; control precedes legacy-profile union
  import and production replacement rehearsal.

- [`219-dependency-and-ci-maintenance.md`](219-dependency-and-ci-maintenance.md):
  complete; patched Cargo and website advisories, three-lockfile review,
  bounded Dependabot updates and security alerts, and passing hosted website,
  advisory, storage and ten-job main CI evidence. Routine update PRs remain
  separate review work.

- [`216-local-support-diagnostics-and-release-baseline.md`](216-local-support-diagnostics-and-release-baseline.md):
  complete locally; frozen local support export, privacy/recovery guidance
  and the explicit future baseline proposal; no supported version selected.

- [`214-release-dependency-and-artifact-review.md`](214-release-dependency-and-artifact-review.md):
  locally implemented advisory review, five-target dependency notices and
  package content gates; GLib source maintenance and native notices remain open.

- [`215-windows-incubation-reset-recovery.md`](215-windows-incubation-reset-recovery.md):
  complete locally; Windows reset barrier, isolated native session tests and
  signed desktop qualification evidence. Repaired signed update remains open.

- [`213-owned-android-runtime-ci.md`](213-owned-android-runtime-ci.md):
  locally complete owned API 35 product SAF CI cohort, bounded sanitized
  evidence, resumed picker handoff, and phone confirmation/selection repair;
  hosted x86_64 execution remains open.
- [`212-application-lifecycle-verification-gate.md`](212-application-lifecycle-verification-gate.md):
  active; adds the complete controlled application lifecycle gate and fixes
  paused-recheck Resume queue admission. Local single/multifile integrity,
  restart, seeding, repair, and cleanup pass. Broader oversized-file checking
  and hosted qualification remain in flight.
- [`211-presubmit-signal-and-build-measurements.md`](211-presubmit-signal-and-build-measurements.md):
  complete locally, hosted confirmation pending; repairs companion
  diagnostic-URL validation and the
  pure-v2 test's completed-seed reconciliation, separates extension/release
  checks from web coverage, and captures Rust compilation timings without
  changing optimization or cache policy.
- [`209-asynchronous-local-headless-deploy.md`](209-asynchronous-local-headless-deploy.md):
  complete; replaces the current machine-local synchronous package/redeploy
  `pre-push` hook with an immediate exact-commit scheduler and one observable
  finite worker. The worker confirms remote acceptance, builds from a
  temporary `git archive` snapshot without a persistent worktree, and reuses
  the existing transactional installer and health rollback.
- [`208-installation-metrics-and-feedback-parity.md`](208-installation-metrics-and-feedback-parity.md):
  implementation complete with release qualification pending; preserves
  JSTorrent-shaped resettable installation identity, exact
  coarse counters, previewed feedback context, and the extension uninstall
  survey through one disclosed preference and reset control. It defines the
  native `product.db`, crash-safe semantic milestone bridge, desktop updater-ID
  adoption, extension-local record, strict transmission allowlist, and privacy
  gates without adding a general analytics pipeline. Richer fields remain
  fail-closed pending hosted deployment/public verification, physical
  ChromeOS evidence, and Apple compile qualification.
- [`207-android-safe-reset-and-clear-data.md`](207-android-safe-reset-and-clear-data.md):
  ready; defines one configured-default atomic engine-settings reset and one
  durable Android clear-data workflow with unchecked-by-default Keep versus
  exact registered-payload deletion. Every captured torrent must join before
  root/grant/profile cleanup, unrelated root content remains untouched,
  partial failures remain repairable/retryable, and implicit migration reset
  can never select deletion.
- [`204-cross-product-localization-foundation.md`](204-cross-product-localization-foundation.md):
  complete; shared React/Tauri, Android Compose/platform, and iOS
  SwiftUI/platform presentation use complete checked English catalogs, system
  locale negotiation, locale-aware formatting, strict catalog validation, and
  LTR/RTL pseudo evidence. No production non-English translation was imported
  or claimed.
- [`203-jstorrent-shaped-add-time-file-selection.md`](203-jstorrent-shaped-add-time-file-selection.md):
  complete; adds one durable application-owned pending-add state and a
  JSTorrent-shaped checked-Normal/unchecked-Skip selection stage to shared
  React and Android Compose. Magnets acquire metadata without content,
  confirmation is one atomic selection-plus-start transition, cancellation
  removes only the new pending add, High remains a post-add Files action, and
  controlled browser, API-35, and physical ChromeOS evidence passes.
- [`201-durable-seeding-goals-and-seed-admission.md`](201-durable-seeding-goals-and-seed-admission.md):
  complete; exact pinned-default seed goals, rank, delayed inactivity, schema
  23 accounting, combined download/seed admission, generated clients, and
  React/Compose truth pass. The six-torrent oracle, 500-torrent resources,
  installed API-35, iOS, and full repository gates close the slice. Reaching
  any one ratio/time threshold lowers automatic priority but does not stop a
  torrent or rewrite durable run intent.
- [`200-android-product-background-lifecycle.md`](200-android-product-background-lifecycle.md):
  complete; replaces the always-sticky Android owner with one JSTorrent-shaped
  activity/background lifetime policy. Background downloads remain explicit
  default-off consent, completion closes unattended work by default, seeding
  requires a separate opt-in, notification eligibility is mandatory, and
  finite Android `dataSync` limits stop cleanly without rewriting torrent
  intent. The selected semantic ChromeOS companion retains authenticated work
  through one fixed reconnect grace; reboot startup, low-battery shutdown,
  VPN, proxy, playback, and a second daemon remain separate.
- [`199-android-live-unmetered-network-enforcement.md`](199-android-live-unmetered-network-enforcement.md):
  ready; adds one default-off **Unmetered networks only** preference, an
  ordered Android default-network observer, and a live application/engine
  prerequisite that closes every BitTorrent DNS/socket/discovery owner while
  preserving torrent intent and Compose/ChromeOS control. VPN privacy, proxy,
  background lifecycle, and production migration remain separate.
- [`198-android-completion-and-attention-notifications.md`](198-android-completion-and-attention-notifications.md):
  complete; adds one Android-native edge owner
  for completion and fatal/storage-repair attention, default-on app
  preferences, bounded low/default/high
  channels, exact tap routing, and JSTorrent-like permission transparency.
  Denied or blocked notification visibility permits interactive use but stops
  the application and ChromeOS companion after visible interaction ends. It
  also fails safely on the target-35 `dataSync` timeout without claiming an
  indefinite background lifecycle. Deterministic, dual-ABI, API 34/35
  connected, genuine transfer/repair, timeout, and cleanup gates pass.
  Physical ChromeOS 150/API-33 proves exact completion-to-torrent and
  attention-to-Storage activation, removal, zero replay, restoration, and
  cleanup.
- [`197-android-external-torrent-intake.md`](197-android-external-torrent-intake.md):
  complete; makes the one Compose/product-service owner a bounded Android
  handler for cold and warm `magnet:` plus temporary-grant `content://`
  `.torrent` activation. It preserves root/start confirmation, serializes
  hostile source reads, rejects file/HTTP/octet-stream breadth, and requires
  exact AVD manifest, lifecycle, privacy, resource, and controlled-transfer
  evidence.
- [`196-remote-direct-file-product-integration.md`](196-remote-direct-file-product-integration.md):
  active with implementation complete and qualification open; the retained
  lower-`rtc` endpoint is now a default-compiled but lazy desktop/headless
  product path. It authenticates bounded signaling inside the existing remote
  circuit, adds completed-file **Save file...**, default-on operator control
  and audit, and direct-only ICE through public Cloudflare STUN and strict mDNS
  candidates. The current-host product verifier plus native Windows and Linux
  ARM64 builds pass. An independent-network selected pair and a real streaming
  save picker remain open. OPFS, TURN, relay payload, incomplete files,
  general Open/Play, UPnP, deployment, and release remain excluded.
- [`195-webrtc-direct-file-feasibility-spike.md`](195-webrtc-direct-file-feasibility-spike.md):
  complete with a corrected Proceed recommendation; retains lower `rtc` behind
  a default-off feature after Chromium/Firefox and current Playwright WebKit
  verified-range success, exact current-host link/package measurements, and
  zero-owner cleanup. The apparent WebKit transport failure was an intermittent
  ICE run followed by a reproducible non-persistent OPFS test-sink failure;
  product UI, default enablement, TURN, public reachability, and deployment
  remained excluded from the spike.
- [`194-chromeos-android-extension-control.md`](194-chromeos-android-extension-control.md):
  complete; preserves the JSTorrent ChromeOS companion user journey while
  reversing its ownership. One Android foreground Rust application/engine/
  profile/SAF owner remains authoritative and the beta extension packages the
  shared React UI as an explicitly paired, detachable same-device
  presentation. It also makes the shared root action launch Android's SAF
  picker and retains earlier grants for torrents bound before a new root
  becomes current. Exact ARC permission/LNA, Host/Origin/auth, root-registry
  crash recovery, two-root lifecycle, Compose coexistence, detached transfer,
  reconnect, and same-LAN rejection pass. The listener binds only to ARC's
  fixed guest address and is refused through Chromebook Wi-Fi. Raw IO, legacy
  import, media, store publication, notifications, and network policy are
  excluded.
- [`193-stateless-foreground-downloader.md`](193-stateless-foreground-downloader.md):
  complete; adds one finite native downloader that composes the existing
  ephemeral in-memory-SQLite application service, writes directly to final
  paths, selects all files except an explicit magnet BEP 53 `so` selection,
  cooperatively locks one canonical output root, and keeps selective boundary
  bytes in an invocation-owned transient workspace. Controlled lifecycle and
  native macOS/Linux/Windows gates pass without durable resume, post-exit
  seeding, packaging, or a mobile CLI claim.
- [`192-production-owner-relay-access.md`](192-production-owner-relay-access.md):
  ready; turns the passing ephemeral OPAQUE/Wasm/dumb-relay proof into one
  local production-shaped desktop/configured-headless username/passphrase path
  with durable authority, automatic challenge-bound authorized-browser resume,
  complete authorization/circuit security audit, explicit recovery lifecycle,
  a release-built browser profile and a separate loopback-only relay service.
  Deployment and every supported-public-capability claim remain a later
  separately authorized tactical.
- [`191-direct-filesystem-storage.md`](191-direct-filesystem-storage.md):
  complete; removes hidden staging and publication machinery across storage,
  persistence, platform adapters, generated contracts, and UI, making direct
  libtorrent-shaped final paths the sole ordinary payload model with path,
  API 34 SAF, simulator/archive, and physical-iPhone evidence.
- [`190-opaque-wasm-relay-foundation.md`](190-opaque-wasm-relay-foundation.md):
  complete; proves an account-free username/passphrase OPAQUE flow through one
  native/Wasm Rust core and bounded dumb relay, carries the unchanged React
  application trace, rejects active/password/pin failures, records resource
  high waters, and authorizes no production remote access.
- [`189-library-playback-and-torrent-size.md`](189-library-playback-and-torrent-size.md):
  complete; connects eligible Library Media Play controls to the existing
  ephemeral browser/Tauri media capability and carries exact torrent total
  size through every first-party summary reducer and web size surface.
- [`188-existing-payload-adoption-and-recheck.md`](188-existing-payload-adoption-and-recheck.md):
  complete; replaces fresh-row destination collisions with automatic
  metainfo-exact discovery and the common complete checker, atomically fences
  discovered ownership behind a pending verification generation, and makes
  path/SAF removal preserve unrelated content.
- [`187-compact-metadata-acquisition-progress.md`](187-compact-metadata-acquisition-progress.md):
  complete; adds one selected-torrent packed BEP 9 block map for v1/v2/hybrid
  metadata plus a separate coarse BEP 52 integrity-preparation phase,
  generated first-party reducers, and accessible React General presentation.
- [`072-derived-media-catalog.md`](072-derived-media-catalog.md): complete; adds
  a pure deterministic video/episode classifier, one
  rebuildable application catalog, a separately leased media projection, and
  a responsive Library torrent detail with an explicit All files fallback.
  Thumbnails, artwork, playback presentation, persistence, and Library-wide
  media aggregation remain deferred.
- [`186-current-rates-and-incremental-speed-history.md`](186-current-rates-and-incremental-speed-history.md):
  complete; separates tiny latest-value current rates from interest-selected
  graph history, makes completed graph buckets exact cursor-validated
  coalescible appends, and cuts the preceding server-payload residual 41.98%
  without choosing a binary codec.
- [`176-durable-high-file-priority.md`](176-durable-high-file-priority.md):
  complete; carries durable High/Normal/Skip file priority through
  persistence, weighted ordinary scheduling, and all first-party clients,
  with final Xcode simulator and unsigned device-archive evidence.
- [`185-typed-sparse-hot-view-patches.md`](185-typed-sparse-hot-view-patches.md):
  complete; replaces measured repeated Torrent, File, Peer, and active-piece
  rows with closed typed field deltas across every first-party reducer and
  cuts another 36.77% from post-coalescing server payload while keeping
  semantics independent from a much later binary codec.
- [`184-view-aware-current-state-coalescing.md`](184-view-aware-current-state-coalescing.md):
  complete; coalesces compatible pending patches across interleaved logical
  view IDs and reduces active detail traffic by 70--86% without a public
  contract change, reset, or lost state.
- [`183-production-websocket-ui-bandwidth-baseline.md`](183-production-websocket-ui-bandwidth-baseline.md):
  complete; adds bounded exact production React/WebSocket measurement and
  shows that interleaved same-view current-state updates defeat the intended
  coalescing before any delivery, row-shape, paging, or codec optimization.
- [`182-bounded-outbound-attempt-and-metadata-turnover.md`](182-bounded-outbound-attempt-and-metadata-turnover.md):
  complete; bounds preferred-uTP/TCP/MSE/plain handshake work to one 15-second
  outbound attempt and adds proven conservative one-at-a-time replacement of
  a zero-contribution worker only while the 30-peer metadata cohort is full.
- [`181-paced-metadata-connection-cohort.md`](181-paced-metadata-connection-cohort.md):
  completed expansion of the combined metadata dial/worker cohort to 30 with a
  configurable no-burst default of ten new connection attempts per second,
  beneath unchanged fair and session-global admission, including Android
  dual-ABI and pinned-libtorrent loopback evidence.
- [`179-disposable-incubation-state-epoch.md`](179-disposable-incubation-state-epoch.md):
  completed fresh schema-21 catalog epoch and removal of compatibility-only
  DHT, desktop-shell, and browser-appearance readers while preserving the
  bounded reset and external payload.
- [`180-typed-settings-patches-and-draft-convergence.md`](180-typed-settings-patches-and-draft-convergence.md):
  completed replacement of whole/pair-specific settings mutation with typed
  partial patches and revision-aware web/Android draft convergence under
  complete live updates.
- [`178-crostini-storage-guidance.md`](178-crostini-storage-guidance.md):
  Crostini-only Add and Downloads guidance for the fast Linux default and the
  explicit, slower ChromeOS **Share with Linux** alternative.
- [`161-packaged-desktop-folder-picker.md`](161-packaged-desktop-folder-picker.md):
  completed parented native Tauri picker for Windows and packaged Linux,
  preserving the path-authority boundary and proving installed Windows
  cancel/select/repair/restart behavior.
- [`160-windows-local-network-address-selection.md`](160-windows-local-network-address-selection.md):
  completed dependency-free repair for concrete Windows local-network
  listener selection and its native presubmit regression.

- [`000-first-verified-piece.md`](000-first-verified-piece.md): completed
  download and verification of one multi-block piece from a controlled
  libtorrent peer, establishing the pure protocol/runtime boundary.
- [`001-bounded-large-piece.md`](001-bounded-large-piece.md): completed
  block-granular staging and streamed verification of a 32 MiB piece under a
  256 KiB engine-owned payload allowance.
- [`002-selective-multi-file-storage.md`](002-selective-multi-file-storage.md):
  completed cross-file mapping, skipped-file part storage, mixed-source
  verification, durable reopen, and materialization through an edge-rich
  libtorrent fixture.
- [`003-android-storage-feasibility.md`](003-android-storage-feasibility.md):
  completed native descriptor, SAF, sparse-offset, reopen, cancellation,
  publication, filesystem, and allocation evidence in three runs each on an
  AVD, Chromebook ARCVM, physical Pixel 7a, and Moto X4 internal and removable
  exFAT storage.
- [`004-android-engine-bootstrap.md`](004-android-engine-bootstrap.md):
  completed in-process engine packaging behind UniFFI, foreground-service
  ownership, direct Rust networking, bounded app-private storage, cancellation,
  peer-failure, activity-recreation, and exact cleanup evidence on an AVD,
  Chromebook ARCVM, and Moto X4.
- [`005-saf-selective-storage.md`](005-saf-selective-storage.md): closed after
  proving descriptor-backed selective download, provider publication, forced
  restart verification, and exact cleanup on an AVD, Chromebook ARCVM, and
  Pixel 7a. Unavailable Moto rows and remaining provider-failure profiles are
  recorded as deferred rather than claimed.
- [`006-magnet-metadata-peer-hint.md`](006-magnet-metadata-peer-hint.md):
  completed bounded v1 magnet parsing, direct `x.pe` bootstrap, bidirectional
  BEP 9 metadata exchange, same-connection content download, and independent
  libtorrent evidence in both directions.
- [`007-durable-session-control.md`](007-durable-session-control.md):
  completed one transport-neutral application contract,
  profile-local SQLite authority, exact magnet metadata retention, durable
  verified-piece checkpoints, and conservative process-death resume.
- [`008-reactive-multi-surface-control.md`](008-reactive-multi-surface-control.md):
  completed recoverable bounded reactive views, generated TypeScript and
  Kotlin contracts, and controlled browser/WebSocket, Tauri/channel, and
  Android/UniFFI product threads.
- [`009-android-saf-session-storage.md`](009-android-saf-session-storage.md):
  completed durable Android SAF root identity, descriptor-backed restart,
  provider publication recovery, and controlled AVD and Pixel evidence.
- [`010-peer-registry-magnet-failover.md`](010-peer-registry-magnet-failover.md):
  completed bounded peer observations, records, deterministic selection,
  guarded dial lifecycle, connection and protocol failover, and
  same-connection magnet handoff.
- [`011-one-shot-udp-tracker.md`](011-one-shot-udp-tracker.md): completed
  bounded BEP 15 connect/announce exchange, tracker observations, session
  source retention, and tracker-only magnet metadata/content transfer from a
  controlled libtorrent seed.
- [`012-bounded-diagnostics-progress.md`](012-bounded-diagnostics-progress.md):
  completed prompt task-terminal supervision, active/waiting/blocked progress
  assessment, a bounded filtered typed diagnostic stream, equivalent
  web/Tauri and Android presentation, and isolated headless Chrome and
  no-window AVD evidence.
- [`013-explicit-live-network-policy.md`](013-explicit-live-network-policy.md):
  completed explicit offline, loopback-only, and online outbound policy,
  online desktop and Android product networking, loopback-isolated harnesses,
  offline progress, and bounded network-operation deadlines without a
  whole-download timeout.
- [`014-scheduled-udp-tracker-lifecycle.md`](014-scheduled-udp-tracker-lifecycle.md):
  completed supervised UDP tracker records, multi-tracker fallback, bounded
  retry and reannounce scheduling, loss recovery, token reuse, and equivalent
  waiting diagnostics on the web and Android surfaces.
- [`015-headless-live-comparison.md`](015-headless-live-comparison.md):
  complete; added the catalog-backed alternating comparator, controlled
  publication validation, deterministic result tests, and first paired
  metadata and full-download baselines.
- [`016-dht-discovery-foundation.md`](016-dht-discovery-foundation.md):
  complete; added the session-owned bounded IPv4 DHT participant, private
  gating, warm restart, peer integration, controlled libtorrent completion,
  and an honest public trackerless attempt.
- [`017-adversarial-multi-peer-liveness.md`](017-adversarial-multi-peer-liveness.md):
  complete; replaced the one-live-peer content boundary with a bounded
  torrent-owned connection set and request scheduler driven by adversarial
  liveness scenarios.
- [`018-inspectable-metadata-acquisition.md`](018-inspectable-metadata-acquisition.md):
  complete; added bounded peer-registry and BEP 9 acquisition snapshots,
  closed metadata-slot starvation, and classified tracker-only failure versus
  repeated public DHT metadata completion.
- [`019-torrent-owned-metadata-acquisition.md`](019-torrent-owned-metadata-acquisition.md):
  complete; replaced independent per-peer BEP 9 transfers with one bounded
  cross-peer block owner, added source-derived request pacing, and met the
  tracker, DHT functional, and catalog metadata gates.
- [`020-sustained-transfer-parity.md`](020-sustained-transfer-parity.md):
  complete; replaced the static four-request/four-piece transfer ceiling with
  a bounded source-derived per-connection feedback window and classified
  initial peer-source breadth as the remaining 50% boundary.
- [`021-initial-peer-working-set.md`](021-initial-peer-working-set.md): complete;
  adds bounded initial tracker-operation breadth, separates half-open and live
  peer capacity, adds per-peer diagnostics, and classifies a duplex peer-task
  deadlock as the next boundary.
- [`022-duplex-peer-task-liveness.md`](022-duplex-peer-task-liveness.md): complete;
  breaks command/event backpressure cycles without dropping or unbounding
  peer messages and passes 3/3 owner-only plus 3/3 paired 50% screens.
- [`023-strict-endgame-ownership.md`](023-strict-endgame-ownership.md): complete;
  adds strict bounded duplicate requests, first-response cancellation, harmless
  late payload, and exact public verified-publication evidence.
- [`024-piece-hash-failure-recovery.md`](024-piece-hash-failure-recovery.md):
  complete; resets a failed v1 piece, retains bounded contributor generations,
  and distinguishes known-bad from ambiguous peer evidence.
- [`025-bounded-async-content-storage.md`](025-bounded-async-content-storage.md):
  complete; separates bounded storage execution from peer-event progress with
  exact payload, hash, resume, and shutdown ownership, and records a negative
  localhost speed result.
- [`026-paired-peer-utility-timeline.md`](026-paired-peer-utility-timeline.md):
  complete; adds bounded endpoint-free time-series evidence for both
  comparator owners and classifies candidate supply plus half-open admission.
- [`027-expanded-half-open-working-set.md`](027-expanded-half-open-working-set.md):
  complete; expands the source-rich startup dial cohort from eight to 30 while
  preserving the separate 30-live-peer and fixed payload bounds.
- [`028-fair-content-supervisor-intake.md`](028-fair-content-supervisor-intake.md):
  complete; prevents continuous accepted-block storage from starving bounded
  discovery admission, dial refill, and safe peer-event service.
- [`029-coalesced-selective-piece-hashing.md`](029-coalesced-selective-piece-hashing.md):
  complete; removes redundant per-chunk async seeks from bounded multi-file
  piece verification and records a neutral controlled timing result.
- [`030-single-boundary-selective-hash-job.md`](030-single-boundary-selective-hash-job.md):
  complete; moves each common all-wanted piece hash behind one bounded blocking
  positional-I/O boundary and records neutral controlled/public results.
- [`031-storage-command-duration-evidence.md`](031-storage-command-duration-evidence.md):
  complete; separates bounded storage queue wait from per-kind write and hash
  service duration and attributes the live bottleneck to serialized writes.
- [`032-bounded-coalesced-write-batches.md`](032-bounded-coalesced-write-batches.md):
  complete; batches at most 16 already-admitted blocks and coalesces adjacent
  piece ranges while retaining per-block integrity and cancellation ownership.
  Physical writes fell by about 91%, but controlled wall time stayed neutral
  and public serialized storage service remained above 93%.
- [`033-headless-view-set-foundation.md`](033-headless-view-set-foundation.md):
  complete; establishes leased multi-view sets, recoverable authenticated
  polling, generated TypeScript and JSON Schema, a pure reducer and headless
  lifecycle client, and controlled libtorrent-seeded view evidence before
  React or peer-table work.
- [`034-responsive-demo-inspection-ui.md`](034-responsive-demo-inspection-ui.md):
  complete; establishes the fresh React, Zustand, CSS Modules, responsive
  inspection shell, virtual tables, deterministic named demo scenarios, and
  headless visual/accessibility/scale evidence before connecting new Rust
  peer projections.
- [`035-live-peer-inspection-projection.md`](035-live-peer-inspection-projection.md):
  complete; unifies active connection observation, exposes truthful bounded
  torrent/peer views, independently reaps silent view sets, connects semantic
  responsive views to the live React surface, and proves suspended-client
  recovery plus a verified libtorrent transfer entirely headlessly.
- [`036-manual-live-webui-launcher.md`](036-manual-live-webui-launcher.md):
  complete; adds one production-built live browser launcher with persistent
  isolated state, an exact loopback boundary, normal-browser opening, and
  joined `Ctrl+C` shutdown. Tauri migration awaits maintainer confirmation.
- [`037-live-magnet-toolbar-intake.md`](037-live-magnet-toolbar-intake.md):
  complete; adds JSTorrent-style adjacent magnet input and Add controls to the
  live React toolbar and moves the controlled transfer proof through that
  visible command path while reserving later `.torrent` file selection.
- [`038-curated-test-torrent-menu.md`](038-curated-test-torrent-menu.md):
  complete; adds an accessible More > Add test torrent submenu backed by the
  five recorded WebTorrent magnets and the ordinary guarded add path.
- [`039-generous-download-resource-pipelines.md`](039-generous-download-resource-pipelines.md):
  complete; replaces the prototype two-block payload ceiling with explicit,
  generous desktop and bounded Android request, buffering, and active-piece
  budgets.
- [`040-torrent-lifecycle-retention-actions.md`](040-torrent-lifecycle-retention-actions.md):
  complete; adds durable archive/restore and fenced keep-data or
  delete-managed removal through the semantic contract and web UI.
- [`041-live-file-inspection.md`](041-live-file-inspection.md): complete; adds a
  bounded complete live file projection with distinct Done and Verified
  progress, correct configurable virtual-table behavior, and controlled
  headless multi-file proof.
- [`042-metadata-display-name.md`](042-metadata-display-name.md): complete;
  replaces the live info-hash label with the verified durable metainfo name in
  library and General summaries while preserving the pre-metadata fallback.
- [`043-live-tracker-inspection.md`](043-live-tracker-inspection.md): complete;
  establishes one bounded authoritative tracker runtime projection, connects
  it to the leased API and responsive Trackers table, and proves the path with
  an isolated tracker-only browser transfer.
- [`044-global-disk-inspection.md`](044-global-disk-inspection.md): complete;
  establishes a session-scoped storage pipeline contract, pressure behavior,
  piece-level active work, and the global responsive Disk inspection surface.
- [`045-piece-map-visualization.md`](045-piece-map-visualization.md): complete;
  generalizes bounded active-piece diffs and implements a
  high-DPI, RAF-coalesced, read-only Canvas piece overview.
- [`046-joined-pause-peer-cleanup.md`](046-joined-pause-peer-cleanup.md): complete;
  makes pause await metadata/content owner cleanup and the final empty peer
  observation before its successful receipt.
- [`047-interface-size-settings.md`](047-interface-size-settings.md): complete;
  adds the global Settings surface, a readable Standard default, coordinated
  Compact/Standard/Spacious metrics, and legible first-party action icons.
- [`048-unified-view-delivery-and-tauri-migration.md`](048-unified-view-delivery-and-tauri-migration.md):
  complete; unifies leased view-set delivery across HTTP polling and
  acknowledged in-process Tauri streaming, then makes the React inspection
  surface the desktop default before categorized Logs work.
- [`049-structured-log-console.md`](049-structured-log-console.md): complete;
  replaces the sortable Logs scaffold with a global ordered diagnostic
  console, structured expandable context, producer capture interest, honest
  gap semantics, and bounded pull/stream delivery with headless live evidence.
- [`050-color-theme-settings.md`](050-color-theme-settings.md): complete; adds
  Auto/Light/Dark selection to the shared Settings surface with safe appearance
  migration, pre-React application, and system-responsive Auto behavior.
- [`051-typed-peer-flags-and-legend.md`](051-typed-peer-flags-and-legend.md):
  complete; replaces ambiguous peer flag strings with a typed Rust semantic
  set, one shared frontend vocabulary, and an accessible column-header legend.
- [`052-batched-durability-checkpoints.md`](052-batched-durability-checkpoints.md):
  complete; separates hash verification from bounded payload/SQLite durability
  epochs, moves checkpoint work off the content supervisor, and establishes a
  steady controlled storage profile for the throughput campaign.
- [`053-immutable-positional-storage-plans.md`](053-immutable-positional-storage-plans.md):
  complete; replaces mutable cursor I/O with retained, generation-checked
  positional write and hash plans across wanted and part-file storage.
- [`054-bounded-independent-storage-execution.md`](054-bounded-independent-storage-execution.md):
  complete; runs immutable write and hash jobs through separate bounded
  capacity, joins out-of-order results by exact piece generation, and retains
  a repeated 1/10 GiB libtorrent comparison as the first throughput gate.
- [`055-application-destinations.md`](055-application-destinations.md):
  complete; establishes Library, Transfers, and Workbench as responsive
  top-level destinations, adds truthful bounded clean views and shared
  multi-selection, and preserves the existing dense surface as Workbench.
- [`056-peer-client-identification.md`](056-peer-client-identification.md):
  complete; identifies common clients and versions from bounded handshake
  peer IDs and completes the existing active-peer Client projection.
- [`057-hardware-performance-baselines.md`](057-hardware-performance-baselines.md):
  complete; retains hardware-matched 1/10 GiB engine gates and paired
  per-view/adversarial application throughput evidence in local and CI tiers.
- [`058-contextual-table-selection.md`](058-contextual-table-selection.md):
  complete; replaces persistent torrent checkboxes with an explicit selection
  mode and applies the same UI-only interaction plus deferred actions to Files.
- [`059-actionable-table-range-selection.md`](059-actionable-table-range-selection.md):
  complete; keeps checkbox columns visible on actionable tables and adds
  sorted Shift-range selection across torrent and Files surfaces.
- [`060-multiplexed-application-websocket.md`](060-multiplexed-application-websocket.md):
  complete; makes one bounded multiplexed WebSocket the ordinary live-browser
  connection, retains HTTP only as an explicit loopback diagnostic, shares
  exact acknowledgement with Tauri, and retires the superseded `/control`
  protocol and direct-DOM frontend after migrating their useful evidence.
- [`061-user-selected-download-roots.md`](061-user-selected-download-roots.md):
  authorized for macOS; replaces implicit app-data payload storage with
  persisted user-selected roots, default/add-option policy, trusted local
  folder pickers, and shared add/Settings UX while deferring staged magnet file
  selection plus Linux and Windows native evidence.
- [`062-user-visible-publication-layout.md`](062-user-visible-publication-layout.md):
  complete; publishes completed downloads in a user-visible torrent-named
  layout while retaining private staging and exact restart behavior.
- [`063-live-file-selection.md`](063-live-file-selection.md): complete; adds
  durable live Normal/Skip file selection, metadata-only add intent, exact
  boundary-piece storage behavior, and safe joined generation replacement.
- [`064-registry-backed-swarm-inspection.md`](064-registry-backed-swarm-inspection.md):
  planned; turns the bounded peer registry into the torrent-scoped Swarm view
  while preserving Peers as active connection generations.
- [`065-dht-observatory.md`](065-dht-observatory.md): complete; adds the
  session-scoped DHT observatory with exact 160-bucket occupancy and freshness,
  bounded lookup convergence, and normalized/literal diagnostic encodings.
- [`066-smooth-session-speed-history.md`](066-smooth-session-speed-history.md):
  complete; retains bounded exact session byte history in live and durable
  tiers and renders a smooth hand-rolled high-DPI Canvas chart without a
  general chart dependency.
- [`067-dynamic-platform-file-acquisition.md`](067-dynamic-platform-file-acquisition.md):
  proposed; replaces Android's eager SAF descriptor manifest with bounded
  dynamic acquisition and one session-wide Rust file pool shared with path
  storage.
- [`068-active-and-batch-table-interaction.md`](068-active-and-batch-table-interaction.md):
  superseded; established synchronized active-row and batch-selection
  mechanics before product trial exposed ambiguous shared action scope.
- [`069-current-within-table-selection.md`](069-current-within-table-selection.md):
  complete; constrains current row to checked selection and makes every table
  action target that one explicit selection set.
- [`070-actionable-torrent-error-status.md`](070-actionable-torrent-error-status.md):
  complete; makes torrent error status explanatory on hover and focus, then
  routes activation to the focused General error detail.
- [`071-copy-magnet-link.md`](071-copy-magnet-link.md): complete; adds a
  singleton-selection More action that copies a canonical v1 magnet from the
  projected info hash with truthful clipboard feedback and accessible focus.
- [`072-derived-media-catalog.md`](072-derived-media-catalog.md): listed above
  as complete.
- [`073-unified-storage-and-complete-recheck.md`](073-unified-storage-and-complete-recheck.md):
  complete; removes the single-file storage fork, gives every v1 torrent one
  durable resume/publication path, and adds bounded full managed-storage and
  force recheck with controlled libtorrent fault evidence.
- [`074-context-specific-metainfo-limits.md`](074-context-specific-metainfo-limits.md):
  complete; separates generic bencode, BEP 9, durable-session, structural,
  and explicit-import parser limits, raises only the schema-owned durable
  piece/have checks, and records bounded allocation and unchanged controlled
  interoperability without adding `.torrent` product intake.
- [`075-ephemeral-application-state.md`](075-ephemeral-application-state.md):
  complete; adds explicit private bounded in-memory session and metrics state,
  typed page-cap exhaustion, a no-profile-path headless mode, and controlled
  no-file lifecycle evidence while leaving external payload storage and
  persistent source policy unchanged.
- [`076-authenticated-private-web-host.md`](076-authenticated-private-web-host.md):
  complete; adds bounded Basic-auth static, health, and application hosting,
  explicit same-origin production bootstrap, joined terminate handling, and
  externally owned exact-push deployment evidence without recording host
  identity or credentials in this repository.
- [`077-shared-overlay-menu-system.md`](077-shared-overlay-menu-system.md):
  planned; replaces component-local menu and popover mechanics with one
  portalled, collision-aware, accessible React Aria layer while reserving new
  product context-menu bindings for a later policy decision.
- [`078-local-single-peer-tcp-seeding.md`](078-local-single-peer-tcp-seeding.md):
  complete; adds one session-owned loopback TCP listener, generation-fenced
  torrent routing, verified metadata and payload upload, restartable seeding
  ownership, per-application peer identity, and controlled
  RSTorrent/libtorrent evidence for one peer.
- [`079-engine-driver-source-shape.md`](079-engine-driver-source-shape.md):
  complete; extracts download-control observation and bounded content-storage
  execution from the engine driver and divides its private test suite by owner
  without changing behavior, crate boundaries, or public API.
- [`080-session-view-subsystem-boundaries.md`](080-session-view-subsystem-boundaries.md):
  planned; separates portable view contracts, current projection models,
  legacy subscriptions, leased view-set delivery, diffs, and ranges behind
  one-way private dependencies without changing API or behavior.
- [`081-v1-torrent-byte-intake.md`](081-v1-torrent-byte-intake.md): planned;
  separates exact source provenance from operational metadata, adds bounded
  v1 outer-metainfo and tracker-tier persistence, adopts libtorrent-aligned
  large-v1 parser/geometry limits with scalable storage and paged catalog
  owners, and carries one semantic byte-intake operation through WebSocket,
  HTTP automation, and raw Tauri IPC without adding visible picker UX or
  chunking.
- [`082-bounded-multi-peer-upload-ownership.md`](082-bounded-multi-peer-upload-ownership.md):
  completed; replaces the one-peer upload proof with shared connection
  budgets, eight fair seed upload slots, adaptive bounded reads/writes, and
  exact physical payload accounting. Simultaneous two-RSTorrent/two-libtorrent
  clients independently verified four complete copies while all declared
  limits and joined cleanup held.
- [`083-shared-torrent-file-picker.md`](083-shared-torrent-file-picker.md):
  complete; adds one shared browser/Tauri torrent-file chooser, bounded binary
  intake through the active adapter, server-derived source identity, initial
  all-file selection, and headless WebSocket product evidence.
- [`084-persisted-client-connection-and-seeding-settings.md`](084-persisted-client-connection-and-seeding-settings.md):
  planned; defines a typed settings subsystem and one atomic persisted group
  for loopback listener policy, the global peer ceiling, and payload upload
  slots through startup enforcement, existing application transports and
  views, and the shared browser/Tauri Settings surface.
- [`085-unified-contextual-selection-actions.md`](085-unified-contextual-selection-actions.md):
  planned; unifies torrent and file action policy across visible toolbars,
  More, and row context menus, including whole-selection magnet copy, recheck,
  archive/restore, and confirmed sequential multi-torrent removal.
- [`086-long-lived-torrent-peer-runtime.md`](086-long-lived-torrent-peer-runtime.md):
  planned; extracts one application-generation per-torrent runtime and one
  shared engine peer-state owner, then proves the boundary by attaching
  incoming seed connections to the ordinary bounded Peers/Swarm lifecycle.
- [`087-uniform-detail-tab-footprints.md`](087-uniform-detail-tab-footprints.md):
  complete; removes redundant detail-tab count badges, gives every tab one
  interface-size-specific footprint, and retains the torrent/session divider
  plus horizontal overflow on constrained widths.
- [`088-upnp-mapped-external-tcp-seeding.md`](088-upnp-mapped-external-tcp-seeding.md):
  complete; adds bounded IPv4 UPnP IGD v2 mapping ownership and proves exact
  payload seeding from an independently controlled off-LAN peer followed by
  verified mapping deletion and failed reconnect.
- [`089-coordinated-session-listen-sockets.md`](089-coordinated-session-listen-sockets.md):
  complete; coordinates application-generation TCP and UDP bind policy,
  migrates DHT to one bounded session UDP owner, and reports actual transport
  endpoints separately before truthful peer advertisement.
- [`090-peer-id-duplicate-connection-resolution.md`](090-peer-id-duplicate-connection-resolution.md):
  planned; resolves simultaneous live connections by handshake peer ID with a
  deterministic cross-direction winner and generation-fenced exact cleanup,
  without treating peer ID as durable identity or merging endpoint records.
- [`091-availability-ranked-piece-activation.md`](091-availability-ranked-piece-activation.md):
  complete; retains partial-first work and unique-piece protection, adds exact
  live availability accounting and an independent active-piece count ceiling,
  and graduates an incrementally indexed rarest-first default through naive
  differential, maximum-geometry CPU/memory, and controlled libtorrent gates.
- [`092-truthful-tracker-and-dht-peer-advertisement.md`](092-truthful-tracker-and-dht-peer-advertisement.md):
  complete; replaces provisional tracker/DHT peer-port claims with one
  generation-fenced advertised endpoint and retains discovery plus
  advertisement across the long-lived torrent runtime.
- [`093-bep6-fast-request-lifecycle.md`](093-bep6-fast-request-lifecycle.md):
  planned; implements the complete negotiated Fast request lifecycle,
  including explicit rejection, exactly-one terminal responses, initial
  availability forms, and bounded suggestions and allowed-fast state.
- [`094-bounded-bep11-peer-exchange.md`](094-bounded-bep11-peer-exchange.md):
  planned; adds a bounded general BEP 10 negotiation map and bidirectional PEX
  with exact live add/drop events, private gating, source diversity, hostile
  input limits, and controlled two-hop evidence.
- [`095-bounded-http-https-tracker-transport.md`](095-bounded-http-https-tracker-transport.md):
  complete; adds bounded HTTP and encrypted-but-unauthenticated HTTPS tracker
  transport, compact/noncompact IPv4/IPv6 peer intake, family-correct
  advertisement, and controlled libtorrent plus Android product evidence.
- [`096-metadata-tracker-activation-and-family-observability.md`](096-metadata-tracker-activation-and-family-observability.md):
  complete; activates session-owned discovery only while a paused metadata
  task is actually live, projects the last successful tracker connection
  family without addresses, and passes controlled plus Ubuntu evidence.
- [`097-live-client-settings-and-replaceable-session-generations.md`](097-live-client-settings-and-replaceable-session-generations.md):
  complete; applies every existing client setting without restart through one
  stable session-network owner and replaceable TCP/UDP/reachability
  generations while preserving peers, DHT, discovery, accounting, exact
  transfer, and bounded terminal ownership.
- [`098-authenticated-https-tracker-platform-trust.md`](098-authenticated-https-tracker-platform-trust.md):
  complete; defaults HTTPS trackers to desktop and Android platform trust,
  retains one hidden live compatibility policy, atomically replaces only the
  bounded family-specific HTTP client pair, and passes controlled
  authenticated pinned-libtorrent interoperability plus desktop/AVD runtime
  evidence.
- [`099-decimal-and-binary-display-units.md`](099-decimal-and-binary-display-units.md):
  complete; makes Decimal `kB/MB/GB` the fresh and migrated browser default,
  retains persistent Binary `KiB/MiB/GiB` as an explicit choice, and updates
  every shared React byte/rate display without changing raw application data,
  sorting, chart geometry, or exact technical IEC copy.
- [`100-bep53-select-only-and-duplicate-add-feedback.md`](100-bep53-select-only-and-duplicate-add-feedback.md):
  complete; adds bounded BEP 53 select-only magnets and their monotonic
  duplicate-selection rule, makes ordinary duplicate adds successful no-ops,
  and consistently reveals the typed add target with accessible feedback.
- [`101-first-run-web-authentication.md`](101-first-run-web-authentication.md):
  complete; adds a communicated ten-minute loopback onboarding window,
  local-open or remembered-browser policy, four-digit authorization for new
  browser profiles, persistent bounded cookie sessions, explicit restart
  recovery, adaptive Web access session management, and retention of Basic,
  bearer, development, and in-process modes.
- [`102-ordinary-incoming-listener-settings.md`](102-ordinary-incoming-listener-settings.md):
  complete; makes ordinary automatic and fixed incoming modes bind all IPv4
  interfaces while retaining disabled, loopback, and preferred-candidate
  policies for controlled internal use.
- [`103-peer-transfer-and-recency-columns.md`](103-peer-transfer-and-recency-columns.md):
  complete; exposes already-owned peer upload rate, physical upload total,
  connected age, and last-received-payload age through sortable responsive
  columns without changing the generated application contract.
- [`104-selection-aware-torrent-eta.md`](104-selection-aware-torrent-eta.md):
  accepted; adds exact non-padding network-work geometry, constant-space
  torrent rate smoothing, and a typed selection-aware ETA owned by the Rust
  application view rather than the engine or React.
- [`105-fact-based-persistence-and-recheck-containment.md`](105-fact-based-persistence-and-recheck-containment.md):
  complete; replaces overlapping durable runtime/storage state with fact-based
  payload and verification authority, makes force recheck exclusive and
  restartable, migrates the observed published-content contradiction without
  payload mutation, and contains torrent-local recovery failures during
  profile open.
- [`106-live-transfer-rate-tab-title.md`](106-live-transfer-rate-tab-title.md):
  complete; keeps the shared browser/Tauri tab title current with exact
  session download and upload rates at a bounded one-second cadence while
  retaining the plain application title when idle or disconnected.
- [`107-source-aware-magnet-export.md`](107-source-aware-magnet-export.md):
  complete; preserves exact verified magnet sources and otherwise synthesizes
  bounded magnets from verified identity, name, and ordered tracker evidence
  through one explicit read-only application operation.
- [`108-serialized-torrent-control-and-observable-checking.md`](108-serialized-torrent-control-and-observable-checking.md):
  complete; replaces whole-generation file-selection restart with serialized
  torrent reconciliation and a bounded storage fence, makes checking
  selection-independent, and exposes exact checker progress while retaining
  conservative validation and reserving a later trusting fast-resume option.
- [`109-stable-same-origin-web-launch.md`](109-stable-same-origin-web-launch.md):
  complete; gives the manual browser launcher one stable same-origin hosted
  gateway, removes caller-selected live destinations, and proves reconnect
  through a process restart without changing the visible URL.
- [`110-atomic-download-now.md`](110-atomic-download-now.md):
  complete; adds one atomic wanted-plus-running application command, reconciles
  only current durable intent through the serialized torrent controller, and
  exposes it for skipped targets in the shared Files action menus.
- [`111-mse-peer-stream-encryption.md`](111-mse-peer-stream-encryption.md):
  complete; adds MSE/PE for TCP peer connections in both directions through a
  sans-IO protocol state machine and one four-value live client policy, while
  claiming compatibility rather than security. Controlled interop/performance,
  Android cross-build, API 34 AVD, and API 37 physical Pixel 7a product
  evidence pass with exact publication, bounded resources, full owner drain,
  and cleanup.
- [`112-dual-stack-transport-and-ipv6-dht.md`](112-dual-stack-transport-and-ipv6-dht.md):
  complete and graduated; gives the session one
  coordinated TCP/UDP socket pair per address family, runs a BEP 32 IPv6 DHT
  node with its own BEP 42 identity and routing table beside the IPv4 node,
  makes the reachable peer port a per-family fact for BEP 7 announcing, and
  gates every IPv6 path behind one persisted `ipv6_enabled` setting defaulting
  to enabled. Claims no IPv6 incoming reachability.
- [`113-ipv6-firewall-pinhole-and-incoming-reachability.md`](113-ipv6-firewall-pinhole-and-incoming-reachability.md):
  closed, evidence-limited; bounded UPnP IGD v2
  `WANIPv6FirewallControl:1` pinhole control beside the existing IPv4 mapping
  under one reachability coordinator,
  distinguishes listener, unfiltered-gateway, installed-pinhole, and observed
  incoming evidence, and stages an off-LAN IPv6 peer hash-verifying proof.
  Protocol, coordinator/product, and physical-harness commits pass their
  deterministic, scripted, generated-contract, web, and Android gates. The live
  negative control passes, but the observed gateway returns typed `606` to
  `AddPinhole`. Positive physical capability is recorded as unknown on the
  current hardware; the tactical remains ungraduated and no control-transport
  expansion is implied. The pinned oracle implements no pinhole support, so
  every deterministic test is independently authored.
- [`114-session-wide-concurrent-torrent-admission.md`](114-session-wide-concurrent-torrent-admission.md):
  complete session-wide concurrent download admission; schema 17 persists
  queue order and the default-three setting, one application owner admits exact
  generations, shared resources prevent per-torrent multiplication, controlled
  performance and 100/500-catalog scale gates pass, and a physical Pixel 7a
  proves the effective-two Android cap, promotion, exact payload, and cleanup.
- [`115-mse-policy-advertisement-and-peer-detail.md`](115-mse-policy-advertisement-and-peer-detail.md):
  complete bounded post-graduation follow-up; matches libtorrent's default
  plaintext-payload selection under compatibility-only `allow`, derives the
  HTTP tracker MSE capability announcement from live policy, and exposes the
  exact peer method through the existing quiet `E` presentation.
- [`116-platform-storage-coherence-and-ios-feasibility.md`](116-platform-storage-coherence-and-ios-feasibility.md):
  complete prerequisite storage shoring; path and supported Android SAF now
  share observations, root health, published reads, explicit namespace
  transitions, and one dynamic product architecture. Full AVD/physical
  Android matrices and a bounded physical-iPhone storage, networking, and
  lifecycle feasibility harness pass without adding fast resume or an iOS
  product claim.
- [`117-jstorrent-shaped-android-product-ui.md`](117-jstorrent-shaped-android-product-ui.md):
  complete Android product-presentation slice; replaces the bootstrap page
  with a fully connected JSTorrent-shaped Compose library, six-tab detail,
  global inspection, settings, and lifecycle experience while keeping
  unsupported engine and platform policy visibly unavailable.
- [`118-utp-implementation-decision-spike.md`](118-utp-implementation-decision-spike.md):
  complete non-implementing source, license, platform, ownership, and
  forced-uTP oracle decision spike; human review accepted the independently
  authored Rust sans-IO recommendation.
- [`119-deterministic-utp-transport-core.md`](119-deterministic-utp-transport-core.md):
  complete pure-Rust uTP v1 codec, wrapping arithmetic, bounded connection,
  receive/reorder/SACK, send/ACK/loss, RTT, and timer-intent tactical without
  sockets, tasks, congestion control, or a support claim.
- [`121-deterministic-utp-loss-congestion-and-mtu.md`](121-deterministic-utp-loss-congestion-and-mtu.md):
  complete runtime-free uTP receive-credit, packetization, recovery, RFC 6817
  congestion/pacing, path-MTU, and deterministic impaired-link tactical;
  its required review accepted Stage 3 recommendation A.
- [`125-shared-udp-utp-runtime-and-loopback-interop.md`](125-shared-udp-utp-runtime-and-loopback-interop.md):
  complete bounded shared-UDP classification, supervised uTP runtime, ordered
  peer-stream, generation replacement, and forced-uTP pinned-libtorrent
  loopback interoperability tactical in both roles.
- [`126-controlled-outbound-utp-wan-evidence.md`](126-controlled-outbound-utp-wan-evidence.md):
  closed evidence-limited after its authorized read-only `pimom` preflight
  found only LAN and Tailscale/shared-range IPv4 addresses and no installed
  libtorrent oracle. No fixture, listener, uTP packet, package, network change,
  or WAN interoperability claim followed.
- [`127-mapped-utp-wan-interoperability.md`](127-mapped-utp-wan-interoperability.md):
  complete mapped-WAN uTP slice; establishes the pinned oracle on `pimom` and
  proves one exact RSTorrent-leecher transfer through a finite remote UDP UPnP
  lease over the direct public path rather than Tailscale. Exact deletion and
  independent post-run audits prove zero mapping, process, and artifact
  residue. The local-mapping fallback was not needed, and product uTP stays
  disabled at the required human-review checkpoint.
- [`128-controlled-tcp-performance-diagnosis.md`](128-controlled-tcp-performance-diagnosis.md):
  complete deterministic TCP-only comparison of focused RSTorrent, resumable
  RSTorrent, and pinned libtorrent paths on byte-identical loopback fixtures;
  identifies sustained large-transfer storage admission/backlog as the first
  optimization owner without resuming uTP or public-swarm work.
- [`129-bounded-storage-intake-watermark.md`](129-bounded-storage-intake-watermark.md):
  superseded before implementation by Tactical `135`; its independent
  watermark remains the first stage of the broader near-parity scope.
- [`130-utp-transport-solidification.md`](130-utp-transport-solidification.md):
  closed bounded uTP solidification campaign; proves the complementary
  local-mapped WAN sender direction, runs a small bidirectional cohort, adds
  real-socket impairment and hostile lifecycle gates, and integrates
  diagnostic-only MTU search before the pre-product review.
- [`131-bounded-product-utp-composition.md`](131-bounded-product-utp-composition.md):
  complete default-off application composition with exact incoming/outgoing
  uTP and TCP-fallback product evidence under one logical dial owner.
- [`132-utp-default-readiness-evidence.md`](132-utp-default-readiness-evidence.md):
  complete bounded endpoint capability memory, retry/recovery policy, mixed
  controlled cohort, and one metadata-only ordinary-swarm observation before
  the product-default review.
- [`133-utp-product-default-enablement.md`](133-utp-product-default-enablement.md):
  complete bounded enablement of the existing fixed-548 IPv4/plaintext uTP
  path as the common application construction default, with desktop/Android,
  fallback, lifecycle, and **Partial** protocol-claim evidence.
- [`134-hierarchical-transfer-rate-enforcement.md`](134-hierarchical-transfer-rate-enforcement.md):
  complete live durable All torrents and per-torrent upload/download limits,
  torrent-first fair TCP/uTP duplex enforcement, schema-18 persistence,
  generated web/Android controls, controlled cap/full-duplex/fairness evidence,
  API 34 AVD evidence, and complete repository gates.
- [`135-controlled-tcp-storage-near-parity.md`](135-controlled-tcp-storage-near-parity.md):
  complete; separates the 1 MiB storage-intake watermark from resident safety
  ceilings and amortizes hash reads to reach controlled plaintext/RC4 and
  smaller-piece near parity with exact integrity and bounded resources.
- [`136-shared-tracker-operation-executor.md`](136-shared-tracker-operation-executor.md):
  complete; extracts one task-free UDP/HTTP/HTTPS announce executor shared by
  the application and focused direct owners, composes authenticated HTTP(S)
  and full tracker lifecycle into the standalone resumable path, and proves
  controlled pinned-libtorrent trust plus bounded public dispatch.
- [`137-product-utp-path-mtu-discovery.md`](137-product-utp-path-mtu-discovery.md):
  complete; implements fragmentation-protected dynamic IPv4 product-uTP MTU,
  conservative fixed-548 fallback, path revalidation, protected-send repair,
  and controlled desktop/Android platform evidence.
- [`138-verified-http-file-serving.md`](138-verified-http-file-serving.md):
  complete; implements verified logical-file reads, bounded volatile
  capabilities, shared gateway/Tauri HTTP serving, React/Tauri Open, and
  proportional Android compatibility evidence.
- [`139-incomplete-file-streaming-demand.md`](139-incomplete-file-streaming-demand.md):
  complete; implements compact current/ahead demand, verified active-storage
  reads, time-critical peer scheduling, progressive HTTP fulfillment,
  publication handoff, bounded browser/Tauri integration, controlled pinned-
  libtorrent evidence, and proportional Android parity.
- [`140-incoming-utp-reachability.md`](140-incoming-utp-reachability.md):
  complete; independently maps the concrete TCP and UDP/uTP listeners, keeps
  tracker and DHT advertisement transport-truthful, proves controlled DHT-only
  incoming uTP plus Android lifecycle parity, and completes one exact product-
  owned public incoming-uTP transfer with zero-residue cleanup.
- [`141-product-wan-tcp-utp-comparison.md`](141-product-wan-tcp-utp-comparison.md):
  closed evidence-limited; the reporter-fixed physical budget retained one
  exact 8 MiB uTP case at 0.096759 MiB/s active, but duplicate remote TCP peer
  entries and one premature completion-milestone check left zero complete
  pairs. Every attempt cleaned exactly; the repaired single-connection oracle
  has no further WAN authorization in this tactical.
- [`142-wan-transport-performance-matrix.md`](142-wan-transport-performance-matrix.md):
  complete through child Tacticals `145` and `150`; its reusable cross-engine,
  cross-role, cross-host TCP/uTP WAN lab selected and verified causal
  reliability, packetization, receive, and sender-startup repairs.
- [`144-long-rtt-utp-sender-window-utilization.md`](144-long-rtt-utp-sender-window-utilization.md):
  complete; repairs long-RTT sender underfill plus the upload-writer and
  per-connection ingress bounds exposed by a full window, without changing
  the accepted no-slow-start RFC 6817 controller.
- [`145-sustained-utp-reliability-and-throughput-near-parity.md`](145-sustained-utp-reliability-and-throughput-near-parity.md):
  complete through Tactical `150`; sustained transfers remain on one
  connection and the stable remote-seed 256 MiB cohort reaches
  94.85%--100.74% of matched pinned-libtorrent uTP without regressing
  delay/fairness behavior.
- [`146-runtime-free-bep52-metainfo-geometry-merkle.md`](146-runtime-free-bep52-metainfo-geometry-merkle.md):
  complete after the iOS campaign; provides exact v2/hybrid
  metainfo, format-aware aligned geometry, strict complete piece layers, and
  bounded runtime-free Merkle primitives while product support remains v1-only.
- [`147-ios-client-foundation-and-qualified-roots.md`](147-ios-client-foundation-and-qualified-roots.md):
  complete first iOS product slice; establishes the maintained iOS 16+ target,
  generated Swift boundary, durable in-process application, coordinated
  descriptor-release seam, and physically qualified selected on-device roots
  while rejecting iCloud and positively identified providers.
- [`148-jstorrent-swiftui-product-surface.md`](148-jstorrent-swiftui-product-surface.md):
  complete second iOS slice; directly reuses the first-party
  JSTorrent SwiftUI views, assets, and localizations over typed RSTorrent
  models while deferring Search and unsupported High priority.
- [`149-ios-lifecycle-recovery-and-distribution-readiness.md`](149-ios-lifecycle-recovery-and-distribution-readiness.md):
  complete third iOS slice; owns finite background work, process-death
  recovery, cold/warm input, privacy metadata, physical lifecycle evidence,
  and reproducible development/archive packaging without publication.
- [`150-bounded-utp-sender-startup.md`](150-bounded-utp-sender-startup.md):
  complete child of Tactical `145`; promotes the approved 10 ms queue-signal/
  30% retained-window startup policy and closes deterministic, controlled,
  VM-built WAN, platform, and near-parity evidence without changing steady-
  state LEDBAT.
- [`151-complete-source-pure-v2-runtime-vertical.md`](151-complete-source-pure-v2-runtime-vertical.md):
  complete strict complete-source pure-v2 runtime and product vertical.
- [`152-ios-multifile-selected-root-coordination.md`](152-ios-multifile-selected-root-coordination.md):
  complete selected-root correctness repair; exact-file coordination,
  controlled multifile hardware evidence, Big Buck Bunny public-swarm
  completion, Apple Files playback, and exact cleanup pass.
- [`153-wired-lan-utp-data-plane-scalability.md`](153-wired-lan-utp-data-plane-scalability.md):
  decision-complete and Later; measures RSTorrent TCP/uTP and pinned-
  libtorrent throughput over a wired gigabit-effective Mac-to-Linux/Windows
  LAN, attributes packet-rate ceilings, and records native Windows separately
  without claiming 2.5 GbE through the Mac's 1 GbE adapter.
- [`154-ios-truthful-progress-and-system-preview.md`](154-ios-truthful-progress-and-system-preview.md):
  complete; reserves iOS 100%/Finished for canonical complete-and-published
  state and opens available files directly in Apple's Quick Look/video
  presentation under the existing scoped lease, with real-swarm playback and
  exact cleanup proven on physical hardware.
- [`155-v2-magnet-authenticated-hash-exchange.md`](155-v2-magnet-authenticated-hash-exchange.md):
  complete; adds strict `btmh` intake/export, SHA-256 BEP 9 metadata, volatile
  authenticated sparse hash knowledge, messages 21--23, hash-first payload,
  conservative restart, leaf corruption repair, hash upload, controlled
  two-role pinned-libtorrent interoperability, and proportional web, Tauri,
  Android, and iOS evidence while hybrid and creation remain deferred.
- [`156-hybrid-dual-swarm-runtime-closure.md`](156-hybrid-dual-swarm-runtime-closure.md):
  complete; implements strict hybrid source/magnet intake, first-owner
  provisional reconciliation, one owner across v1/v2 discovery and peer lanes,
  mandatory dual integrity, BEP 47 padding, restart/seeding, both-swarm/both-
  role pinned-libtorrent evidence, and first-party platforms while creation and
  single-format fallback remain deferred.
- [`157-beta-release-foundation.md`](157-beta-release-foundation.md): complete;
  establishes the beta-readiness ledger, graduates the complete
  Android client to its durable module path, adds provisional packaging
  art/metadata, and reconciles status before signed updater and cross-platform
  CI slices.
- [`158-desktop-signed-packaging-and-updater.md`](158-desktop-signed-packaging-and-updater.md):
  active release work; its Tauri-only
  `desktop-update-v1` UI/state boundary, per-app identity/key/route, hosted
  signed five-target package rehearsal, public `desktop-v0.1.0` through
  `desktop-v0.1.3` finalization, one installed macOS arm64 launch smoke, and
  exact macOS arm64 plus Linux arm64 `0.1.0`-to-`0.1.1` replacement/relaunch
  pass. Windows x86_64 replacement also passes under an automatic-loopback
  profile. Native Linux x86_64 passes the public `0.1.1`-to-`0.1.3` AppImage
  update, picker, relaunch, and payload-preserving removal. Windows signed
  replacement reaches `0.1.3` but old-catalog reset fails; Tactical `215`
  repairs source and a newer signed candidate remains necessary. Installed
  Intel macOS testing is a deliberate omission.
- [`159-cross-platform-presubmit-ci.md`](159-cross-platform-presubmit-ci.md):
  complete; installs credential-free Rust, web, deterministic browser E2E,
  native desktop, Android, iOS, and short controlled-interoperability checks
  proven across the hosted matrix.
- [`162-desktop-single-instance-and-tray-lifecycle.md`](162-desktop-single-instance-and-tray-lifecycle.md):
  complete; adds one packaged desktop lifetime, default-on close-to-tray
  behavior, persisted background policy, visible tray updater action, joined
  Quit/restart shutdown, native Linux arm64 packaging, release-only Windows
  GUI launch, and installed Windows x86_64/Linux arm64 lifecycle evidence.
- [`163-desktop-external-torrent-intake.md`](163-desktop-external-torrent-intake.md):
  complete; registers `magnet:` and local `.torrent` activation, routes cold
  and warm input through the existing single owner and Add-options flow, and
  passes installed Linux arm64, Windows x86_64-application, macOS arm64, and
  exact hosted eight-job acceptance.
- [`164-desktop-completion-and-attention-notifications.md`](164-desktop-completion-and-attention-notifications.md):
  complete; adds edge-triggered, non-replaying native desktop completion and
  fatal/repair notifications, typed Tauri-only preferences, Linux click
  restoration, joined cleanup, and installed macOS/Windows/Linux evidence.
- [`165-cross-platform-active-download-sleep-inhibition.md`](165-cross-platform-active-download-sleep-inhibition.md):
  complete; adds default-on desktop/Android active-work sleep inhibition,
  removes Android's Wi-Fi lock, records iOS inapplicability, and passes
  guest-native macOS/Windows/Linux plus physical Android/iOS evidence with
  exact inhibitor and artifact cleanup.
- [`166-desktop-native-bootstrap-and-extension-scaffold.md`](166-desktop-native-bootstrap-and-extension-scaffold.md):
  complete; adds the bounded RSTorrent
  desktop native compatibility/launch host, per-user registration and sidecar
  packaging, and a self-contained Manifest V3 JSTorrent Beta seed ZIP. Its
  draft identity, public key, and exact origin are pinned; real Chrome 151 on
  an installed unsigned macOS arm64 app proves native `hello` from a stopped
  state and cold desktop launch.
- [`167-chromeos-crostini-bundled-web-launcher.md`](167-chromeos-crostini-bundled-web-launcher.md):
  complete; packages the Rust gateway and mature React UI together in ChromeOS
  Linux, adds one static on-demand user service and mapped Launcher handoff
  through the exact beta extension, and passes the available physical
  Chromebook lifecycle, transfer-detachment, preservation, and purge matrix.
  Full reboot remains conditional because the testbed has no approved profile
  login credential.
- [`168-platform-aware-extension-launcher.md`](168-platform-aware-extension-launcher.md):
  complete; makes the beta popup platform-relevant, with desktop native
  bootstrap only on desktop and the exact published JSTorrent Android listing
  plus ChromeOS Linux controls on ChromeOS. The reviewed `0.3.0` package and
  physical chooser/link/handoff spot check pass without claiming Play or app
  availability.
- [`169-hosted-crostini-bootstrap-and-release.md`](169-hosted-crostini-bootstrap-and-release.md):
  complete; adds a pinned-key signed-manifest one-command Crostini installer,
  separate native x86_64/ARM64 release workflow, and physical signed-fixture
  evidence. A later explicitly authorized operation published non-latest
  `crostini-v0.1.0`, deployed the website bootstrap, and passed exact public
  x86_64 install/Launcher/relaunch acceptance.
- [`170-configured-linux-headless-service.md`](170-configured-linux-headless-service.md):
  complete; packages one ordinary-user Linux application owner and exact React
  assets, adds strict durable root/listener/origin/Basic secret-file
  configuration and explicit systemd user enablement, and proves private
  HTTPS/WSS-proxy control plus zero-view transfer/re-seeding, idle availability,
  joined restart, rollback-safe repair, uninstall preservation, and exact real
  x86_64 Linux cleanup. x86_64/ARM64 construction passes without claiming
  native ARM64 systemd, built-in TLS, relay, or a public release.
- [`171-signed-headless-release-and-lan-service.md`](171-signed-headless-release-and-lan-service.md):
  complete; adds a strict signed two-architecture headless
  release/update lane, operator-approved CLI and browser update discovery,
  one exact RFC 1918 unauthenticated full-owner mode with truthful UI, and an
  enabled healthy current-host x86_64 service at its exact LAN authority.
  Public publication, unattended replacement, system-wide ownership, firewall
  changes, and Raspberry Pi mutation remain explicitly absent; Tactical `158`
  remains independently active.
- [`172-provisional-magnet-display-name.md`](172-provisional-magnet-display-name.md):
  complete; carries bounded magnet `dn` as a distinct provisional source
  label through current-schema restart and first-party torrent-list
  presentation, with verified metainfo retaining authority.
- [`173-mobile-web-table-horizontal-scrolling.md`](173-mobile-web-table-horizontal-scrolling.md):
  complete; makes configured-visible columns authoritative at every width,
  restores trusted two-axis touch scrolling with directional continuation
  affordances, and proves the complete Swarm defaults at 390- and 456-pixel
  phone widths without changing virtual row bounds or table interaction.
- [`174-exact-tailnet-headless-access.md`](174-exact-tailnet-headless-access.md):
  complete; adds bounded explicit multi-endpoint hosting for the existing
  direct LAN authority plus one exact loopback Tailscale Serve HTTPS authority,
  retains one application owner and endpoint-correct media URLs, and proves
  the installed LAN/tailnet service without wildcard, Funnel, or ACL changes.
- [`175-retained-swarm-peer-transfer-totals.md`](175-retained-swarm-peer-transfer-totals.md):
  complete; adds exact useful payload download/upload contribution to every
  retained Swarm record across active connections, backoff, disconnect, and
  reconnect, carries canonical decimal strings through generated web/UniFFI
  boundaries, and proves the installed LAN/tailnet service without changing
  peer policy or adding durable history. Tactical `158` remains independently
  active.

Tactical `015` completed the oracle campaign's headless measurement
foundation. Current prioritization and the compaction-safe restart
checkpoint live in [`../topics/capability-readiness.md`](../topics/capability-readiness.md)
and [`../topics/oracle-driven-engine-campaign.md`](../topics/oracle-driven-engine-campaign.md).

- [305 — Canonical JSTorrent repository](305-canonical-jstorrent-repository.md):
  canonical Rust/legacy TypeScript names, update continuity and exact release
  alias validation; no bulk release copying or legacy app rebuild.

- [308 — Optional Android add-time selection](308-android-optional-add-selection.md):
  immediate Download all, optional checklist, concise intake and durable intent.

- [310 — Concise first use and background setup](310-concise-first-use-and-background-setup.md):
  short statistics choice, folder-first Android setup and notification-gated
  explicit background continuation; independent seeding and transmission policy.

- [377 — Compatible touchless release channels](377-compatible-touchless-release-channels.md):
  active; shared version ordering, database admission, deployed Latest and
  production-signed unattended-update acceptance before Stable promotion.
