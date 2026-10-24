# Tactical 243: Windows And Linux Legacy Replacement

Status: **Complete, bounded backend checkpoint, 2026-09-30.**

Owners: `desktop-jstorrent-replacement`, `client-surfaces`, campaign 231.

## Outcome And Stopping Condition

Extend 242's installed generated-state replacement checkpoint to Windows x64
and Linux x64. Stop with installed old/candidate artifacts, refusal and old
process gates, atomic import/rechecking, missing-root preservation, joined
restart and source/payload preservation recorded, or a concrete unavailable
platform boundary recorded. Restore inherited guest state and power and release
claims. Commit the bounded harness and evidence; no publication is authorized.

Dependencies: 241's importer, 242's managed-route fencing, 233's v0.2.1 pins,
and the existing Machine Control platform workflows. A Windows-only snapshot
durability defect discovered by installed execution is in scope for a bounded repair and native regression test; no engine behavior
or application contract changes. The storage/specification/oracle review remains
owned by 241. Inspect the released platform registration/package paths before
choosing restoration scopes.

Non-goals: personal migration, signed production delivery, store browser pairs,
Android migration, complete branding/settings/privacy/support parity, automatic
rollback, VM recreation or generic testbed infrastructure changes.

## Invariants, Bounds And Ownership

Use claimed existing appliances and generated profiles only. Preserve inherited
installations, registration/association state and product/source profiles before
replacement. Refuse inherited running torrent owners. Pin released packages and
host/daemon binaries. Use a local unsigned candidate with production identity
and updater endpoints disabled; incubation source configuration stays unchanged.

The guest driver owns fixture writes, subprocesses, bounded waits, closed-copy
SQLite assertions and restoration. Machine Control owns lifecycle, transfer,
interactive-session launch and semantic UI. Every child has a deadline and a
joined teardown. Reuse the four paused no-peer records from 242: intact,
deliberately corrupt, unavailable-root and pending magnet. Maximum two profiles,
four records, 64 KiB payload and 16 MiB per inspected database/WAL file.

Prove existing released routes become refusal-only; include both Windows
registry views and the Linux AppImage fixed host. A released pre-handshake host
must stop candidate startup before catalog creation. Controlled registration
failure must preserve source and allow retry. Foreign completion claims cannot
hide corrupted bytes. Missing roots must not be recreated. Restart keeps IDs
and the single marker; closed source logical/main/nonempty-WAL data and payload
hashes remain unchanged. Empty WAL/SHM bookkeeping follows 242's explicit oracle.

## Validation And Evidence

Run proportional script checks, installed rehearsals and any focused native
tests/build checks justified by changes. Record artifact identities, exact
commands, platform semantics, observed failures, cleanup and remaining gates.
Do not turn missing platform execution into a passing claim.

Initial read-only doctors: the local macOS-controller Windows/Linux routes have
no exact configured identity. The separately configured Linux controller has
existing exact appliances, both powered off, with stored Windows credentials.
Exclusive ordinary claims were acquired there; initial off state owns eventual
clean shutdown. No local VM was repaired or recreated.

## Linux Installed Evidence

Ubuntu 24.04.5 x86_64, kernel 6.8.0-142-generic. The released AppImage is pinned
to SHA-256 `1c35bb7dd5bdefcd780c19fc09e160dc7b0e6a5a2ada35f07007089d85e180df`
and 95,721,976 bytes from the official `tauri-app-v0.2.1` asset. Its bundled host
is `e7b93708c0c9f9218a2402efae373ce5c56b9d00463ae5c7944bbad15e9dfd63` and
daemon `eaf386835af15b140ff5f9c91680af198554cf9deb9480e571ed60ad2bf8bce1`.
These differ from 233's deb binaries; a first driver attempt correctly rejected
the deb pins before fixture generation. The released desktop is
`d2ab67a4e66be0d4e6bede94184af77e2a6d72359815109171d5ebc154adf5aa`.

The unsigned local candidate is built from `acb42b67` using the temporary
JSTorrent name/identifier/window overlay and disabled updater endpoints.
AppImage SHA-256:
`7814a33ff59306611c41a0a741c075fb5761542bacc6dbcabe19ed5ae9e5c767`,
142,666,232 bytes. Build on a native x64 Linux development controller:

```bash
source ~/.profile
# Select the controller's installed Node toolchain as needed.
cd clients/desktop
../web/node_modules/.bin/tauri build --debug \
  --config src-tauri/tauri.package.conf.json \
  --config /absolute/path/to/local-rehearsal-overlay.json \
  --bundles appimage --no-sign --ci
```

Install both packages successively at the same user AppImage path and use
`--appimage-extract-and-run`. This exercises the actual AppImage launch and
`APPIMAGE` registration behavior without installing FUSE. It does not qualify
deb/RPM installer replacement or a FUSE-mounted launch.

The checked-in driver `tests/interop/legacy_desktop_platform_rehearsal.py`
reuses 242's bounded framing/closed-copy/bencode helpers and 233's released-host
driver. It requires the three drivers, checksum-pinned input packages and a new
absolute root. Launch through Machine Control's interactive-session route:

```bash
python3 legacy_desktop_platform_rehearsal.py --isolated-guest \
  --root /absolute/new/controlled/root --legacy /absolute/legacy.AppImage \
  --candidate /absolute/candidate.AppImage --candidate-sha256 <sha256>
```

At `legacy-ui`, `migrated` and `restarted`, inspect the native view then invoke
the freshly discovered exported tray menu's Quit item. Discover the status
notifier's Menu property and `com.canonical.dbusmenu.GetLayout` before `Event`;
do not reuse IDs across menus. At the two blocked phases, inspect the native
dialog and press its discovered OK button through AT-SPI. A first UI-discovery
attempt exceeded the original three-minute phase allowance and restored state;
the bounded final driver allows ten minutes for operator phases.

Final installed run: **passed**. The actual old GUI/native host joins, the
pre-handshake old host prevents catalog creation, and a controlled helper
directory failure stops startup before import. Retry repairs registration.
Four records import with zero skipped/already-present, all persisted intent is
paused, and ordinary checking persists `80` only for the intact piece. Corrupt
and missing content persist zero verified pieces; the pending magnet has no
trusted metadata. Missing paths stay absent. All five browser-family manifests
and the old AppImage fixed helper return the exact released refusal envelope:
**six executable route probes**. Closed restart keeps four IDs and one marker;
source discovery/logical KV/main/nonempty-WAL data and payload hashes match.

Native semantic views show four rows, intact 100%, corrupt/missing 0%, and the
fresh privacy disclosure on both launches. The disclosure is not acknowledged;
complete product branding and privacy continuity remain unqualified. The old
webview's rendered library workflow is not claimed from its native frame.

Restoration backups are empty, generated profiles/packages/payload/roots and
owned processes are absent, and the guest is cleanly off with its claim
released. The development checkout stays unchanged, with ordinary incubation
`cargo build -p rstorrent-desktop` restoring its executable after packaging.

## Windows Installed Evidence

Windows 11 x64, OS version 10.0.26200. The released NSIS package remains
233's pin: SHA-256
`55ce6c119e3ada6b66da3f706e4659aa50f0550fea84d56757ba7180f51047c3`,
10,662,592 bytes. Actual installed binary names are unsuffixed
`jstorrent-desktop.exe`, `jstorrent-host.exe` and `jstorrent-io-daemon.exe`.
The host/daemon match 233's executable pins. The initial candidate built
successfully but failed migration; the repaired installed run passes. The guest has an existing Rust/Node/Python build
cache. Restore pinned `cargo-about 0.9.2 --features cli` in a task-only PATH;
PowerShell script execution uses process-only Bypass, not a durable policy
change. A temporary comparison UI relay was unnecessary because the native
Windows resident supports windows/snapshot/launch; the newly installed relay
and WinApp package were removed again. Generic control implementation remains
unchanged.

## Windows Snapshot Repair Scope

The original Windows installed candidate skipped both valid profiles and
imported zero records. Investigate private snapshot syncing and require a
native regression plus installed rerun. Microsoft
[FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)
requires `GENERIC_WRITE`; the private snapshot currently uses `File::open`
(read-only). Source databases must remain read-only; open only the newly
created private target for write when syncing, without truncation/creation.
Pinned libtorrent `src/file.cpp::file_access` and
`test/test_file.cpp::to_file_open_mode` distinguish read/write access. Existing
241's backup/transaction/BEP/oracle decisions are unchanged. Android does not
run this desktop-only migration entry point; no generated boundary changes.

Failed Windows runs exposed a harness teardown race: WebView2
briefly retains its owned profile handles after native Quit. Add a bounded
30-second retry for deletion of preserved test scopes and persist task-only
path/registry restoration receipts before mutation. These receipts are test
recovery evidence, unrelated to the product's single atomic import marker.

## Regression And Repository Checks

The Windows released-cohort test first failed with zero imports. The new direct
read-only-source snapshot regression failed with Windows error 5 at
`sync source snapshot`. After opening the private target with write access,
all **18** migration tests pass on native Windows, Linux and macOS, including
WAL preservation, duplicates, rollback/process exit, offline rechecking and
missing-root behavior. Existing Windows platform warnings remain outside this
bounded repair; no warning-free Windows clippy claim is made.

Exact validation:

- `cargo fmt --all -- --check`;
- `cargo clippy --workspace -- -D warnings` on macOS;
- `cargo test --workspace` on macOS: **1,559 passed, 18 ignored**;
- `cargo test -p rstorrent-session store::legacy_desktop` on macOS/Linux;
- the same Windows command with `--target x86_64-pc-windows-msvc`;
- `cargo test -p rstorrent-native-host --target x86_64-pc-windows-msvc`:
  **16 unit and three process tests passed**;
- Python `py_compile`, driver `--help` and `git diff --check`.

No web/application boundary changes require regeneration. Both installed
package builds run the ordinary web bundle/CSP/notices gates. No browser,
public-swarm transfer or Android migration is claimed.

## Windows Final Installed Result

The repaired local candidate is built from `acb42b67` plus this tactical's
private snapshot repair, with JSTorrent product/identifier/window overlay,
version `0.2.1001` (newer than the legacy installer), and updater endpoints
empty. Native Windows build uses the Linux command's config inputs but
`tauri.cmd`, `--target x86_64-pc-windows-msvc` and `--bundles nsis`.
Repaired NSIS SHA-256:
`143e660856597ff5447442a9678f5946b2d869fc17b6909e646b41a7f94fe0a4`,
14,508,163 bytes; packaged desktop:
`0090dbb0104e28edbe31d68aa7bec0efdba6978c3617c6a1251b30bce9cdb63c`.

Run the same driver with the two `.exe` installer paths through the common
interactive-session application launch. Preserve both HKCU registry views,
NSIS vendor/uninstaller keys, actual `torrent` file class, associations and
browser host registrations. Before installing the old version, isolate inherited
uninstaller metadata so NSIS cannot follow an unrelated installation path.
Save private registry/path receipts and a firewall-rule baseline before mutation.

Final installed run: **passed**, including restoration. Inspect and dismiss
both native migration dialogs, inspect the real old stopped library, cancel the
old IO/new desktop firewall prompts, and invoke freshly discovered native tray
Quit items. No network allowance or privacy acknowledgement is made. Native
windows/snapshot/launch work through the common CLI; a registered-application
inventory is not required. No outer VM UI is used.

Two released-host profiles import four records, zero skipped/already-present
and zero skipped profiles. Both startup gates precede catalog creation. Every
one of the four browser-family paths in both registry views resolves to the
refusal helper: **eight registry route probes**. Intact content persists `80`,
corrupt/missing content zero, and ordinary checking epochs complete for the
available files. Pending metadata stays untrusted. All four stored intents are
paused. Joined Quit/restart preserves IDs, the single marker, source
KV/discovery/main/nonempty-WAL data and payload hashes; the missing root stays
absent. File/registration restoration completes and matches the saved registry
state; test-generated firewall rules are removed by exact application scope and
comparison to the pre-launch baseline.

The native shared React view after restart shows intact content at 100%,
corrupt content at 0% and a pending magnet paused. It also exposes a concrete
presentation gap: the unavailable-root row says **Downloading**, counts as
Active, and does not appear in Needs attention, despite its stored paused intent,
zero verified pieces, absent path and zero peers. This is deliberately deferred
to a focused application/view follow-up; the bounded backend migration result
is not a complete UI or graduation claim. The fresh privacy dialog and RSTorrent
in-app branding also remain visible and unqualified.

Linux installed evidence uses the pre-repair candidate recorded above; the
shared private-snapshot repair is subsequently covered by all 18 native Linux
migration tests. No deb/RPM, Windows ARM64 or signed production replacement is
claimed by this checkpoint.

## Final Cleanup And Restart Checkpoint

Both guests returned to their inherited off state and their exclusive claims
were released. Windows's saved registry scopes and initially absent parents
match exactly by values/keys; inherited restoration backups are empty. Owned
profiles, installations, source fixtures, payloads, staged build sources, input
packages, logs and captures are removed. The common controller repositories
remain clean. Ordinary incubation builds restore the cached executables; the
Windows resource product name/file description is RSTorrent again. Local
production package outputs are removed; no public artifact or source checkout
is changed on the build controller.

Stop here with the bounded Windows/Linux checkpoint complete. Next executable
work is the unavailable-root application/view presentation gap, then the
separately scoped production branding, settings/privacy/support and store/update
qualification in campaign 231. Rehearsal B remains partial, and there is no
personal migration, signed production or rollout-ready claim.

## Presentation Follow-Up

Tactical [244](244-unavailable-storage-presentation.md) corrects the shared
React unavailable-root label and filter membership using deterministic
adapter/component and migration regressions. The installed observations above
remain evidence of the original defect; no corrected guest rerun is claimed.
