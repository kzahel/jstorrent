# Tactical 261: Linux Native Application Brand

Status: Active, 2026-10-07. Bounded finish-line follow-up to 259.

Topics: `desktop-jstorrent-replacement`, `web-ui-design`.

## Scope, invariants and stopping condition

The signed Linux ARM rehearsal exposes `rstorrent-desktop` as GNOME's tray
accessible name, despite branded menu items and the JSTorrent window title.
Set the toolkit's human-readable application name before native initialization,
including the folder-picker helper. Preserve executable names, process identity,
package IDs, updater trust, paths, migration and every engine owner.

Use the same pinned GLib binding already selected by GTK and the Linux integrity
test. No new dependency version, task, state owner or protocol behavior.
Complete when native Linux compilation and an actual GNOME tray-name check pass;
rebuild/reverify final signed Linux artifacts before delivery. Existing signed
migration evidence retains its original source hash. Black native capture
surfaces are a separate diagnosis; do not call accessible DOM a pixel pass or
change graphics policy merely to satisfy a screenshot.

## Source review and validation

GLib's [application-name contract](https://docs.gtk.org/glib/func.set_application_name.html)
owns the user-facing name and requires one initialization. GTK initializes the
technical program name independently. Ayatana AppIndicator's
[`bus_get_prop` Title fallback](https://github.com/AyatanaIndicators/libayatana-appindicator/blob/master/src/app-indicator.c)
uses `g_get_application_name`; without explicit initialization it falls back to
the executable. The pinned tray-icon GTK adapter does not set an explicit title.
No reference source or fixture is imported.

Call the existing pinned binding once at the Linux desktop entry point before
any GTK helper or Tauri construction. Run format, affected desktop checks and
native Linux build; observe the current toolkit/tray result through Machine
Control, restore owned fixture state, and stop the VM between sessions.

Restart checkpoint: the toolkit name is set before either desktop or picker
initialization. Format, macOS desktop clippy and 61 desktop tests pass. Native
Linux x64 compilation, 70 desktop tests and three GLib integrity regressions
pass; the linked executable builds. The actual x64 GNOME tray now reports `JSTorrent` through native AT-SPI,
with `Show JSTorrent` and `Quit JSTorrent` menu entries. The current native
window and first-use disclosure render correctly. The probe uses the exact
linked fixed source with an isolated home/config/data root; it is an unsigned
native display-name check, not signed package/migration delivery evidence.
Normal native Quit and owned-fixture cleanup are recorded. Final signed Linux
artifact requalification remains pending before delivery.
