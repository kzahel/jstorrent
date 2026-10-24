# Tactical 310: Concise First Use And Background Setup

Status: Complete locally on 2026-10-11. User authorizes implementation, commit and push.

## Scope and stopping condition

Shorten the shared React and Android first-use statistics disclosure. Keep the
choice and privacy link; retain recipient details only in the feedback preview.
Android Library setup presents the download folder first, then an optional
background-download choice with Enable and Not now. Enable requests usable
notifications and saves background continuation through the existing activity
and service owner. A notification grant alone must not hide a disabled
background preference. Stop after focused permission/presentation regressions,
web checks, Android build/lint and owned-emulator evidence are recorded.

Non-goals: changing statistics defaults, transmission gates, engine behavior,
Android finite-work limits, background seeding defaults, desktop tray policy,
release identity, store publication, or adding a general onboarding framework.

## Invariants, ownership and bounds

Statistics remain optional, pseudonymous and resettable; no anonymous claim or
new transmission. First-use copy names a random identifier and basic counts,
with update/feedback purpose and content exclusions in concise language.
The exact feedback URL and recipient warning remain in the feedback preview.

Android background stays default off. Only an explicit background action sets
pending enable intent; permission denial or blocked notification channels cannot
enable work. Returning from Android notification settings completes that same
explicit action when eligible. Independent completion-notification permission
actions do not change background preference. Not now dismisses the Library
offer for the current presentation; Power Management remains available.

Compose owns the saved dismissal flag; MainActivity owns bounded permission and
system-settings result workflows; ProductEngineService validates eligibility
and persists the setting. Existing interaction leases, cancellation, joined
shutdown and finite-background rules apply. No new tasks, profile schema,
dependencies, engine boundary or unbounded state.

## Reference study

Read sibling JSTorrent NativeStandaloneActivity.kt first-launch flow,
ui/dialogs/NotificationPermissionDialog.kt and English notification strings:
one short Enable Notifications prompt names background downloads and completion
alerts, followed by folder setup. Adopt its concise practical explanation;
improve the successor's separate notification/background wiring rather than
implying that permission alone changes lifetime. Existing Tactical 200 owns
runtime policy and Tactical 208 owns statistics. Protocol/libtorrent study is
inapplicable to this client-only presentation and Android result-routing slice.
No reference source or fixtures are copied.

## Validation and restart checkpoint

Check first-use opt-out and continued full feedback preview on React. Exercise
Android folder-first ordering, granted permission with background still off,
Not now, enabled/blocked state, the actual permission result and system-settings
return, plus unchanged Power Management/seeding choices. Compile/debug-build,
JVM tests, lint and owned API 28/35 instrumentation provide proportional gates.
Record exact results and visual review; physical/store qualification is separate.

## Implementation and evidence

The first-use paragraph is 25 words instead of the former 80-word combined
Android disclosure/recipient warning. The privacy link, default-on editable
choice and acknowledgement remain. Technical settings and full feedback URL
recipient details stay available in their original focused surfaces.

Library folder readiness gates the background offer. Enable routes through
MainActivity.setBackgroundDownloads rather than the permission-only action;
Not now remains a saved presentation dismissal. Notification Settings also
states that continuation is enabled separately in Power Management. Pending
explicit enable intent survives a system-settings detour; the service validates
fresh channel eligibility before saving. A return without permission clears
the request, and an unavailable settings activity clears pending intent.

Passing local gates:

- `npm run typecheck --prefix clients/web`.
- `npm run test --prefix clients/web`: 499 passed, two existing skips; initial
  opt-out and detailed feedback-preview regressions pass.
- `npm run check:localization --prefix clients/web`: all four platform catalogs
  and English-only shipping policy pass; the web catalog was regenerated.
- `clients/android/gradlew -p clients/android assembleDebug testDebugUnitTest
  lintDebug assembleDebugAndroidTest`: APK/instrumentation assembly, 123 JVM
  tests and lint pass using the existing generated boundary/native libraries.
- `python3 clients/android/scripts/run-localization-matrix.py --class
  org.rstorrent.bootstrap.ProductNavigationTest`: 28 cases each pass on owned
  API 28 phone and API 35 tablet AVDs, including three new background-setup
  regressions. Initial fixture failures came from representing settled folder
  state with the default checking flag; corrected fixtures preserve the
  product readiness gate.
- Final `clients/android/gradlew -p clients/android assembleDebug lintDebug`
  passes after the presentation contrast/copy corrections.
- `cargo fmt --all -- --check` and `git diff --check` pass. No Rust or generated
  application contract changes require engine or boundary regeneration.
- `uv run --project tests/interop --locked python -m unittest discover -s
  tests/interop -p test_chromeos_qualification.py`: 54 helper cases pass. The
  initial system-Python invocation lacked libtorrent; the project environment
  supplies it. Both changed capture/interop Python helpers compile.

A temporary renderer fixture, `npm run dev --prefix clients/web -- --host
127.0.0.1 --port 4189`, and Playwright's bundled headless Chromium review the
actual React component at 390/1280 pixels in light/dark themes. All four fit
without scrolling or page overflow, opt-out completes, and axe reports zero
serious/critical violations. Review caught an existing dark-mode white-button
contrast failure; the dialog now uses the existing accent-action token.
Dialog heights are 243.47 pixels at 390 and 225.47 at 1280. Native screenshot
review also gives Not now the card's existing on-secondary-container color.
The renderer/server/browser and temporary fixtures/captures are removed.

A one-off owned API 35 phone runner composes the repository's existing
run_probe.py AVD, SAF-picker and UI snapshot helpers against the debug APK.
The actual user flow selects a folder, denies permission (background remains
off), grants notifications separately (offer remains, background off), taps
Enable (background saved on), disables it in Power Management, then taps Enable
and the actual Android Allow button (background saved on). Force-stop/relaunch
retains the preference, and background seeding stays separate. No inherited
physical installation, profile, provider grant or browser is used.

A second owned API 35 phone run blocks only the Background activity channel,
leaving notification permission granted and continuation off. Library Enable
opens Android settings. Returning without repairing the channel leaves the
preference off and explains the notification requirement; a later Enable,
channel repair and return saves continuation on through the original pending
request. Real Power Management shows the resulting enabled preference. Both
owned AVDs and emulator processes are removed; temporary native captures and
scripts are removed after review. The final settings-copy rebuild/lint and all
catalog checks pass. Store delivery and physical/OEM endurance remain outside
scope, with no new release or public-swarm claim.
