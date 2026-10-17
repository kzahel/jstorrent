# Tactical 375: CI Reconciliation And UI Regressions

Status: Implementation and local validation complete, 2026-10-16.
Hosted qualification awaits explicit push authorization.
Topics: `web-ui-design`, `localization`, `mixed-version-compatibility`.

## Scope and stopping condition

Reconcile local main with origin/main without dropping updater, Android status,
Library icon, controller cutover or download-safety work. Repair failures in
Fast CI 38905842614 and full CI 38905842707. Stop with committed changes,
a clean working tree and proportional checks; hosted green requires submission
of this exact commit under the repository's explicit-push rule.

Non-goals: releases, deployment, protocol/storage behavior changes, new
architecture or dependencies. Existing feature qualification holds remain.
Read Tactical 372 and 373 (download safety), plus client-surfaces,
application-view-api, web-ui-design, localization and download-safety topics.
The engine correction only reorders existing tests; protocol oracle inspection
is inapplicable. No runtime task, cancellation path or resource limit changes.

## Invariants and investigation

Merge both contract additions and regenerate artifacts. Preserve origin/main
capability IDs 4/5 for safety/bitmaps and assign the unpublished desktop updater
ID 6. Keep both independent SQLite schema advancements (session 29, product 4).

Fast CI rejects items after the origin-marking test module and reassignment of
an instance initialized by Default. Move tests after production items and
initialize the disabled safety fixture directly, retaining every assertion.

The browser alignment test reproduces locally. Diagnostics show all displayed
controls at right edge 1167 with width 175; the second edge/width comes from an
invisible select in the mounted Downloads form (zero rectangle). Measure only
visible controls, retaining exact column/custom-split and phone overflow checks.
Use bundled Chromium and an owned server on a free port; do not disturb the
existing development server on 4177.

iOS pseudo-locale tests assume runtime/background settings are immediately
materialized. Download safety pushes these lower in the SwiftUI Form; scroll
to the runtime row for its presence check and the notification switch for its
hittable check, with at most 12 gestures each. Retain localization assertions. Use an owned disposable simulator and delete it.

## Validation

Passing checks: workspace formatting and all-target Clippy; all 1,737
workspace tests (20 ignored); regenerated web typecheck, 863 unit cases (three
skipped), production build/CSP; 72 deterministic browser cases (19 live-only
skipped); 69 extension cases and companion packaging; 20 controller assembly/
compatibility tool cases; localization and branding.

iOS simulator validation runs after archive generation because both use the
same generated bindings. An overlapping first attempt fails before tests run
with a missing generated input and supplies no product evidence.

Android `clients/android/build.sh` passes both native ABIs, generated Kotlin,
all 209 JVM cases and packaged attribution (84 Maven / 206 Rust packages, six
native libraries). `clients/android/gradlew -p clients/android lintDebug
assembleDebugAndroidTest` passes. No device install or runtime claim follows.
The unsigned iOS device archive passes via `clients/ios/scripts/archive.sh`.

The full simulator run passes all 30 unit and five UI tests on an owned iPhone
17 Pro / iOS 26.5 simulator with Xcode 26.6. Both original CI failures pass.
The simulator is shut down and deleted. The native command is `xcodebuild
-project clients/ios/RSTorrent.xcodeproj -scheme RSTorrent -configuration Debug
-destination platform=iOS\ Simulator,id=<owned-simulator> -parallel-testing-enabled
NO test CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO` with a temporary
result bundle. Runtime rows retain presence checks; the interactive switch
requires hittability. Decorative image hittability is not asserted.

`npm run generate --prefix clients/web` followed by `git diff --exit-code` on
the generated contract and traces passes after staging, as do `git diff
--check` and the cached diff check. Temporary logs, result bundles, unsigned
archive, browser traces and attachment exports are removed; the owned Vite
server and Chromium terminate. The existing development server is untouched.
Hosted CI cannot establish green for an unsubmitted commit; no push, tag,
release or deployment is performed by this local qualification.


## Hosted follow-up, October 17

Full run 39024491901 passes the same iOS assertions. Follow-up 39027221207
fails expanded pseudo-locale navigation at the Settings-screen existence check.
Its exported activity tree and failure hierarchy show Add dismissed and the
library still visible after the immediate Settings tap. Synchronize all three
Add-to-Settings tests on Add-sheet disappearance and Settings-button hittability
before tapping. Retain every localization, navigation and scrolling assertion;
no product UI or runtime code changes. This bounded harness correction is
carried with 377's final CI reconciliation and requires hosted validation.

The corrected project-managed run passes all five UI tests on a fresh owned
iPhone 17 Pro / iOS 26.5 simulator with Xcode 26.6. It uses the normal scheme,
Debug, `-parallel-testing-enabled NO`, `-only-testing:RSTorrentUITests` and
unsigned test settings. The simulator is shut down/deleted and independently
absent afterward. An earlier standalone swiftc attempt omitted XCTest's Swift
overlay and provides no validation; the normal project build compiles and runs
the actual tests. No test is skipped, retried automatically or weakened.
