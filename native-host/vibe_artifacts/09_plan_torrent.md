# Rename Stub Binary Implementation Plan

## Goal Description

Rename `jstorrent-magnet-stub` to a unified name across platforms:

- Windows: `JSTorrent Link Handler.exe`
- macOS: `JSTorrent Link Handler.app` (bundle) or binary name `jstorrent-link-handler`?
  - The user said "macOS: JSTorrent Link Handler.app". This usually implies the app bundle name. The binary inside might still be `jstorrent-link-handler` or `JSTorrent Link Handler`.
  - Rust `Cargo.toml` `[[bin]]` name determines the output filename.
  - `cargo build` on Linux/Mac produces `name`. On Windows `name.exe`.
  - We can't easily have spaces in the binary name in `Cargo.toml` for cross-platform consistency if we want a single entry, but we can have multiple `[[bin]]` targets or just rename it post-build.
  - However, the user specifically asked for "JSTorrent Link Handler.exe" on Windows.
  - Spaces in binary names on Linux are rare/discouraged (`jstorrent-link-handler`).
  - I will set the Cargo bin name to `jstorrent-link-handler`.
  - On Windows, we can rename it to `JSTorrent Link Handler.exe` during packaging/installation or just use `jstorrent-link-handler.exe`.
  - **Wait**, the user explicitly asked for "JSTorrent Link Handler.exe".
  - If I change `Cargo.toml` name to `jstorrent-link-handler`, it produces `jstorrent-link-handler.exe` on Windows.
  - I will stick to `jstorrent-link-handler` in Cargo.toml and handle the specific display names in the installers/packaging if needed, OR I can just use `jstorrent-link-handler` everywhere for the binary and "JSTorrent Link Handler" for the shortcut/App name.
  - **Re-reading request**: "Windows: JSTorrent Link Handler.exe". This implies the binary itself.
  - I'll try to set `name = "jstorrent-link-handler"` in Cargo.toml.
  - On Windows, I might need to rename it in the installer script if the user strictly wants spaces.
  - Actually, for simplicity and best practices, I will use `jstorrent-link-handler` as the binary name in Cargo.
  - Then in `jstorrent.iss` (Inno Setup), I can install it as `JSTorrent Link Handler.exe` if I want, or just keep it kebab-case.
  - **Decision**: I will use `jstorrent-link-handler` in Cargo.toml.
  - I will update the installer scripts to use this new name.
  - For Windows `jstorrent.iss`, I will check if I can rename the output file or if I should just use the kebab-case name. The user request seems specific about the name with spaces.
  - _Correction_: I can't easily make Cargo output "JSTorrent Link Handler.exe" directly without issues on other platforms.
  - I will use `jstorrent-link-handler` in Cargo.toml.
  - In `jstorrent.iss`, I will update the `Source` to `target/release/jstorrent-link-handler.exe` and `DestName` to `JSTorrent Link Handler.exe`.

## Proposed Changes

### Configuration

#### [MODIFY] [Cargo.toml](file:///home/kgraehl/code/jstorrent-host/Cargo.toml)

- Rename `[[bin]]` target `jstorrent-magnet-stub` to `jstorrent-link-handler`.

### Installers

#### [MODIFY] [installers/windows/jstorrent.iss](file:///home/kgraehl/code/jstorrent-host/installers/windows/jstorrent.iss)

- Update `Source` reference from `jstorrent-magnet-stub.exe` to `jstorrent-link-handler.exe`.
- Update `DestName` to `JSTorrent Link Handler.exe`.
- Update registry keys for magnet/torrent association to point to the new executable name.

#### [MODIFY] [installers/linux/install.sh](file:///home/kgraehl/code/jstorrent-host/installers/linux/install.sh)

- Update references to `jstorrent-magnet-stub` to `jstorrent-link-handler`.

#### [MODIFY] [installers/macos/Info.plist](file:///home/kgraehl/code/jstorrent-host/installers/macos/Info.plist)

- Update `CFBundleExecutable` if it points to the stub.

#### [MODIFY] [installers/macos/scripts/postinstall.sh](file:///home/kgraehl/code/jstorrent-host/installers/macos/scripts/postinstall.sh)

- Update references.

### Verification Scripts

#### [MODIFY] [verify_magnet.py](file:///home/kgraehl/code/jstorrent-host/verify_magnet.py)

- Update `STUB_BINARY` constant.

#### [MODIFY] [verify_torrent.py](file:///home/kgraehl/code/jstorrent-host/verify_torrent.py)

- Update `STUB_BINARY` constant.

## Verification Plan

### Automated Tests

- Run `cargo build` to ensure binary is built with new name.
- Run `verify_magnet.py` and `verify_torrent.py` to ensure they work with the new binary name.
