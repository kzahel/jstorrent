# Tactical 250: JSTorrent Production Identity Candidates

Status: **Complete — bounded candidate preparation, 2026-10-01.**

Topics: [product-surfaces-and-migration](../topics/product-surfaces-and-migration.md),
[desktop-jstorrent-replacement](../topics/desktop-jstorrent-replacement.md),
[android-jstorrent-replacement](../topics/android-jstorrent-replacement.md),
[client-surfaces](../topics/client-surfaces.md),
[web-ui-design](../topics/web-ui-design.md),
[application-view-api](../topics/application-view-api.md),
[beta-release-readiness](../topics/beta-release-readiness.md).

## Scope And Stopping Condition

Wire explicit desktop production candidate configuration to JSTorrent's existing
name, identifier, updater public key/route and OS file associations. Preserve the
incubation desktop lane and isolated normal debug builds. Make Android release
and extension production candidates retain their existing package/store identity,
public certificate/key and increasing versions. Keep optional incubation
extension packaging for existing qualification infrastructure.

Fix actual runtime identity assumptions, especially native updater route selection
and desktop admission of the existing production extension origin. Preserve Android
launcher component continuity. Record a full end-to-end cutover checklist with
required signed/store/installed evidence, owners and unresolved gates.

Stop after configuration/package negative tests, native client/gateway checks,
web checks, Android packaging/resource checks and source qualification. This slice
prepares candidates; the full installed signed/store migration is the next slice.
No push, tag, release, store upload, remote signing-secret write, personal profile
migration or physical app replacement is authorized here.

## Source Survey And Invariants

Sibling JSTorrent revision `25e4b701433fd815398ba89526546f5e4f072e3f` supplies:
`desktop/tauri-app/src-tauri/tauri.conf.json` (identifier, updater trust/route,
magnet scheme), `extension/public/manifest.json` plus `extension/fullpubkey.txt`
(store version/key), `android/app/build.gradle.kts` and
`android/app/src/main/AndroidManifest.xml` (package, version, launcher and intents).
The pinned released Android 1.0.24 APK supplies the original public signer
certificate. Store maximum versions and Play app-signing continuity must still
be checked in the authenticated store consoles before shipping.

Private keys remain outside source. A different incarnation's signing secret
must never be accepted silently: verify candidate signatures against the retained
public roots. Android's upload certificate and Play app-signing certificate are
separate evidence. Keep minSdk 28 pending the explicit API 26/27 cutover decision.

The new semantic native host keeps its distinct internal name; old
`com.jstorrent.native` is refusal-only under the production identity. There is no
legacy raw-I/O bridge. Both exact existing extension origins can attach to the
same desktop owner; arbitrary and lookalike origins remain rejected. Android's
existing exact production-origin admission is retained. No engine/schema/DTO,
credential, catalog, payload, grant, consent or restart-owner change is intended.

## Owner And Dependency Map

Tauri config owns package identity/trust; the existing app owns updater selection,
native host registration and singleton lifecycle. Gateway authentication owns
origin admission before application dispatch. Kotlin/manifest owns Android package
and launcher routing; the same existing service and migration bootstrap own the
engine, catalog and SAF. Extension packaging owns the selected public manifest.
No new background task or cancellation path is introduced. This is application
control/release work, not a BitTorrent protocol or engine feature.

## Required Evidence

- Exact source-derived public identities/trust and strictly increasing baseline
  versions; reject swapped beta keys/packages and mismatched manifest IDs.
- Desktop production-origin authenticated handshake and command behavior, beta
  coexistence and hostile-origin rejection; production updater requests never use
  the RSTorrent route and beta requests retain their route.
- Production extension ZIP validated against its selected manifest and file
  allowlist; ordinary beta packaging remains valid.
- Android debug isolation, production package/launcher metadata, unit/resource
  builds and signing guards; no unsigned/debug-key release fallback.
- Existing web typecheck/tests, native fmt/clippy/proportional tests and candidate
  configuration checks. Update the full cutover checklist honestly.

## Evidence And Restart Checkpoint

Source implementation, unsigned package preparation and required validation
are complete. Signed installed/store continuity remains unqualified.

- Public roots are pinned in `distribution/jstorrent-production.json` with exact
  source/artifact provenance. Original 1.0.24 APK checksum and SDK `apksigner`
  verification match its extracted public certificate. The former canary public
  certificate is retained; private material is not read, copied or committed.
- Desktop candidate overlay/wrapper produces JSTorrent 0.3.0 with
  `com.jstorrent.desktop`. Missing original signing input refuses the default
  signed build. `--unsigned --debug --bundles app` builds an arm64 macOS app;
  Info.plist confirms identifier/name/version, magnet/torrent associations,
  the executable helper is present and bundled notices contain original MIT
  branding attribution. The app is not launched; no local migration is run.
- Native updater routes select by exact identity; 6 updater tests pass.
  3 real desktop-control tests cover production authenticated commands, beta
  attachment/lifecycle and hostile/lookalike origin rejection. Android companion
  admission already uses the same exact two origins; the changed branch applies
  only to desktop Bearer control. Generic gateway origins are unchanged.
- Android `assembleDebug` and 113 debug JVM tests pass. SDK metadata confirms
  normal debug remains `org.rstorrent.bootstrap`. `processReleaseMainManifest`
  uses a disposable task-only keystore solely to satisfy its metadata-task guard;
  it confirms `com.jstorrent.app`, 1.0.25/code 25 and exactly one legacy launcher
  alias targeting the unchanged Kotlin activity. No production APK/AAB is signed
  with that key. Missing signing environment fails before release preparation.
- Web `typecheck` and tests pass (438, 2 skipped). Both production and beta
  extension packages build/CSP/allowlist/selected-manifest checks pass; 43 extension
  tests include swapped-archive identity refusal. Production ZIP SHA-256:
  `52008037d092d938c762d10fc31062a2aac8262de3fba4438c864135f33113cc`.
  Beta ZIP SHA-256:
  `8d3ba05413128570c73c581833efde8a9bbf2e32cec5b6f57c720fca3bbfd963`.
  11 candidate source tests reject
  beta IDs/keys/certificates, stale versions and lost debug isolation. CI now runs
  the candidate guards alongside retained incubation guards.
- 19 desktop package/release-tool and 23 Android Python tests pass.
  `release-android.sh --check --tag android-v1.0.25` passes without tagging.
  `actionlint` passes both changed workflows; `git diff --check` passes.
- `cargo fmt --all -- --check` and `cargo clippy --workspace -- -D warnings` pass.
  First `cargo test --workspace` passed unit/integration tests then hit desktop
  doctest E0463 while Tauri packaging concurrently rebuilt shared dependencies.
  Serialized `cargo test --workspace` after packaging passes: 1,571 tests,
  18 ignored, including desktop doctests. The transient dependency mismatch
  does not recur; keep Tauri packaging and workspace Rust validation sequential.

Next executable slice: original signing-input/Play certificate and track-max
review, then exact signed installed updating and
same-ID extension replacement under the full checklist. Also qualify historical
launch/deep-link routes and current store artwork/copy. No publishing, physical
ARC replacement, update-server descriptor or remote secrets are changed.

## Follow-Up Decisions, 2026-10-01

The maintainer selects existing minSdk 28 (Android 9) for replacement. API 26/27
are outside the supported cutover cohort; no lowering of the Rust/Android
minimum is required. Their installed legacy app remains until OS compatibility
permits replacement. Unsupported-device/store/extension guidance still needs
qualification; the decision alone does not satisfy installed delivery.

The maintainer confirms one shipping-product cutover, not ongoing parallel
JSTorrent and RSTorrent releases. Temporary source/incubation separation is a
qualification safeguard. Switch the existing desktop CI candidate config,
public trust and validation to JSTorrent, keeping publication gated, then reuse
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` with the
original JSTorrent inputs. Do not overwrite them before that pipeline switch.
Ordinary debug identities remain isolated independently of shipping identity.

The public roots differ: the published Latest 0.2.801 updater manifest declares
key ID `788A785131367096`, versus production `415D3DF4B3D0CFB8`. CI secret
metadata has not changed since that release. No secret is uploaded or workflow
switched by this documentation update. Next desktop slice owns the one-lane CI
transition and retained-public-root signature qualification before publication.
