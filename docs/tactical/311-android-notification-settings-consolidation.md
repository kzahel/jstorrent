# Tactical 311: Android Notification Settings Consolidation

Status: Complete locally on 2026-10-11. User authorizes commit and push.

## Scope and stopping condition

Replace the duplicate notification-status Manage and system-settings Open
rows with one status/action row. Stop after Android compilation, lint, JVM
tests, catalog validation and focused existing Compose navigation checks pass.

Non-goals: notification delivery, background policy, engine changes, generated
contracts, dependencies, physical-device qualification or store publication.

## Invariants and ownership

Keep exact permission/app/channel status and independent completion/attention
preferences. The status row opens Android's existing app notification settings
in every state: Enable when permission is absent, Manage otherwise. This keeps
system controls reachable even when Android will no longer show a permission
prompt. Library/background permission flows retain their existing owners.
Compose owns presentation; MainActivity owns the existing system-settings
interaction lease and return handling. No new tasks, state or resource bounds.

## References and validation

Tactical 198's original four-row design explains the duplication. Its existing
app/channel status and settings handoff are retained in one row. Protocol and
libtorrent study are inapplicable to this Android-only presentation change.
No reference source or fixtures are imported.

Update the existing notification navigation regression to exercise both granted
and denied permission, a blocked channel, exactly one action, the injected
system-settings callback and unchanged preference updates. Run the owned
API 28/35 navigation matrix, Android debug build/JVM/lint, localization catalog
check and whitespace validation. Record actual outcomes below.

## Implementation and evidence

Removed the duplicate Open row and its two orphaned English resources. The
remaining status row always invokes the existing system-settings handoff,
retaining permission/app/channel presentation and both application preferences.

Passing commands (toolchain commands sourced `~/.profile`):

- `clients/android/gradlew -p clients/android assembleDebug testDebugUnitTest
  lintDebug assembleDebugAndroidTest`: debug and instrumentation packaging,
  123 JVM tests with zero failures/errors/skips, and lint pass. Existing
  generated Kotlin/native libraries were reused; Rust is unchanged.
- `node scripts/check-localization.mjs`: all four catalogs and locale policy
  pass; Android has 470 English resources.
- `python3 clients/android/scripts/run-localization-matrix.py --class
  'org.rstorrent.bootstrap.ProductNavigationTest#notificationSettingsExposePermissionChannelsAndDurableChoices,org.rstorrent.bootstrap.ProductNavigationTest#blockedBackgroundChannelExplainsVisibleOnlyOperation'`:
  two cases each pass on freshly owned API 28 phone and API 35 tablet AVDs.
  The changed case verifies granted/denied status, exactly one Manage/Enable
  action, no Open action, two system-settings callbacks, no permission prompt
  callback, and unchanged completion/attention preference changes. The second
  case preserves blocked-background-channel explanation.
- `git diff --check`: passes.

Both owned AVDs/emulator processes were removed by the runner. No temporary
captures, downloads or investigation scripts were created. These are Compose
callback/presentation checks, not new physical/OEM system-settings evidence.
