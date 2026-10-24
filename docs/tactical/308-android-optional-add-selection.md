# Tactical 308: Optional Android Add-Time Selection

Status: Complete on 2026-10-11. Implementation, commit and push authorized by the user.

## Scope and stopping condition

Android magnet intake offers Download all immediately and Choose files as an
explicit alternative, in one concise Add torrent confirmation. Manual magnet
intake offers the same actions; local file intake and restored pending adds
offer Download all without waiting for the catalog. Selection remains optional
per add, independent of the future-selection preference. Stop after durable
transition, generated boundaries, Android presentation and focused regression
evidence plus proportional repository gates are recorded.

Non-goals: changing peer protocols, storage integrity, queue limits, background
policy, web/iOS presentation, release identities, public swarms or store delivery.

## Contract, ownership and bounds

Add a narrow DownloadAllPendingAdd command. The existing profile transaction
checks pending ownership, removal and root repair, clears selection exceptions
and source-derived select-only intent, sets Normal default and running intent,
clears pending and appends queue order atomically. It does not need metadata.
Explicit Download all overrides source selection; ordinary add/Choose files
continues to preserve BEP 53. Replays retain existing receipt semantics;
non-pending/duplicate torrents cannot be changed by this command. The future
selection preference is unchanged.

The store owns durable intent; ApplicationService reconciles through existing
metadata/content supervisors after commit. No new task or cancellation owner.
Compose owns only the choice/checklist draft; the bounded external intake owner
retains the per-item choice across root detours and retry. Protocol modules
remain independent of storage, runtime and platform code. Existing 500-torrent,
8-intake, 1,024-row page, 3-page cache and 4,096-exception bounds remain.

## Source-first study

Pinned libtorrent: 7d7fc38fac61177fa5e02148f791b2f65250b09d.
Inspected src/magnet_uri.cpp select-only parser (default_dont_download and
file_priorities); test/test_magnet.cpp select_only and
save_resume_data_magnet_v1/hybrid/v2; test/test_resume.cpp
file_priorities_in_resume_deprecated and file_priorities_in_resume_and_params_deprecated.
Pinned BEP 53: reference/bittorrent.org/beps/bep_0053.rst at
7b7b41f46d57ff1d1cb1e24ed6e9bacfbf958c06. Selection may precede metadata and
must survive restart; explicit user priorities take precedence over resume
defaults. No reference source is reused. Existing integrity/admission owners
are reused rather than libtorrent architecture.

Read sibling JSTorrent Android FileSelectionDialog.kt metadata wait and
Download button behavior and Tactical 203's exact source-study record.
The current successor reproduces the blocking metadata gate and adds a second
external confirmation with technical text; this slice deliberately removes
that friction while retaining explicit consent before networking for external
sources. Edge checklist: pending magnet with no peers, pre/post metadata,
BEP 53 override, restart/replay, stale/non-pending/cancelled owner, failed
commit, unavailable root, root/retry detour, selection FIFO and cancellation.

Failure injection exposed an existing control-store boundary: typed mutation
errors were receipted and committed without rolling back earlier command writes.
The receipt-owning transaction now uses one command savepoint, rolling back
all mutation writes on a typed rejection while retaining its error receipt.
StoreError paths still drop the whole transaction. This proportionate shared
boundary repair supplies atomic failure behavior for the new command and the
existing selection commands; no new persistence schema or task is needed.

## Validation

Store tests: pre-metadata all intent, reopen, metadata arrival, receipt replay,
selection/preference preservation and non-pending rejection. Application test:
real existing metadata owner reconciles into content after explicit all;
zero content before decision. Android JVM tests cover retained intake choice;
Compose tests cover immediate action, optional selection and concise copy.
Regenerate TypeScript/schema, Kotlin and Swift as required by command change.
Run fmt, clippy, workspace tests, web typecheck/tests and Android dual-ABI build,
lint/instrumentation assembly and an owned emulator connected focused suite.
Record exact outcomes and qualification limits below. No physical device is
required for this presentation/application transition.

## Evidence and restart checkpoint

The explicit all path first creates a pending add, then confirms that exact new
owner. Duplicate sources cannot acquire selection ownership or restart a paused
torrent. Existing service scope owns this work; a scalar quick-add counter and
the authoritative summary fence suppress the intermediate checklist. No new
background task is introduced. A process exit between receipts safely restores
a pending add rather than assuming consent.

Passing local gates on 2026-10-11:

- `cargo fmt --all -- --check`.
- `cargo clippy --workspace -- -D warnings`.
- `cargo test --workspace`: 1,583 passed, 18 ignored. New store and application
  cases prove all consent before metadata, BEP 53 override, reopen, receipt
  replay, injected write rollback and metadata-to-content reconciliation.
- `npm run generate --prefix clients/web`,
  `npm run typecheck --prefix clients/web`, and
  `npm run test --prefix clients/web`: 499 passed, two existing skips.
- `clients/ios/scripts/generate-project.sh` and
  `xcodebuild -project clients/ios/RSTorrent.xcodeproj -target
  RSTorrentSessionBindings -configuration Debug -sdk iphonesimulator
  CODE_SIGNING_ALLOWED=NO build`: generated Swift boundary compiles.
- `clients/android/build.sh`: both native ABIs, Kotlin bindings, debug APK,
  license notices and 123 JVM tests pass.
- `clients/android/gradlew -p clients/android lintDebug assembleDebugAndroidTest`.
- `python3 clients/android/scripts/run-localization-matrix.py --api35 --class
  org.rstorrent.bootstrap.ProductNavigationTest` and the equivalent `--api28`:
  25 connected cases each pass on an owned tablet and phone emulator.
- `python3 -m unittest discover -s scripts -p test_android_runtime_smoke.py`:
  five report-validation cases pass; changed Python sources compile and
  `git diff --check` passes.

An initial out-of-order Gradle invocation preceded generated Kotlin bindings;
the final proper native/generation/build sequence passes. Failure injection
caught and fixed the shared partial-mutation commit defect described above.
Owned runtime runners were updated to acknowledge first-use disclosure with
statistics disabled, use current accessible labels, and capture duplicate-log
baselines before launching a repeated source. These failed harness attempts
supply no positive runtime claim.

`uv run --project tests/interop --locked python scripts/android-runtime-smoke.py
--output <owned temporary report>` passes the installed API 35 SAF cohort.
The existing partial selection survives process restart, verifies selected
hashes, leaves skipped files absent, rechecks and removes exactly. No payload
is exchanged before consent. The new all path pauses the controlled pinned
libtorrent seed, taps the real pre-metadata Download all button with `so=0`,
observes pending cleared while metadata is absent, then resumes the seed and
independently verifies every ordinary file hash. Padding files remain absent;
removal is exact. SAF handle high-water is 3 for partial selection and 6 for
all selection against limit 40. The owned AVD and process group are removed.

The existing `clients/android/run_bootstrap.py --target avd --avd <owned AVD>
--avd-api 35 --storage saf-internal --runs 1 --no-build --profile
product-external-intake` cohort also passes under the bounded owned runner.
It covers optional selection/paused add, duplicate without restart, immediate
all and independently verified hashes, cancellation, hostile/oversized provider
input, permission/provider errors, timeout/retry and temporary-grant cleanup.
SAF handle high-water is 6/40, pending requests 4; process descriptors are
163 baseline, 190 peak, 162 settled and zero after force-stop. Java/native/
process RSS high-water is 94,984/14,508/291,212 KiB. Source strings stay out of
diagnostics/private persisted state. Owned AVD and process cleanup pass.

Stopping condition is met. Next executable action: none in this slice; broader
installed production qualification remains with its owning tactical. No
physical device, public swarm, release publication or Play delivery is claimed.
