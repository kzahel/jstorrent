# Implementation Plan - JSTorrent Native Host Installers

This plan outlines the creation of installers and CI/CD pipelines for the JSTorrent Native Messaging Host, based on `installer-design.md`.

## User Review Required

> [!IMPORTANT]
> This plan assumes the existence of `iscc` (Inno Setup Compiler) in the CI environment (windows-latest runner usually has it).
> It also assumes `pkgbuild` and `productbuild` are available on macOS runners.

## Proposed Changes

### Directory Structure

I will create the following directory structure:

```
installers/
  windows/
    jstorrent.iss
    assets/
      icon.ico
  macos/
    scripts/
      preinstall.sh
      postinstall.sh
      uninstall.sh
  linux/
    install.sh
    uninstall.sh
manifests/
  com.jstorrent.native.json.template
ci/
  github-actions/
    build-and-package.yml
```

### Component Details

#### [NEW] [manifests/com.jstorrent.native.json.template](file:///home/kgraehl/code/jstorrent-host/manifests/com.jstorrent.native.json.template)
- Template for the Chrome Native Messaging manifest.
- Placeholders: `PATH` (to be replaced by installer), `ALLOWED_ORIGINS`.

#### [NEW] [installers/windows/jstorrent.iss](file:///home/kgraehl/code/jstorrent-host/installers/windows/jstorrent.iss)
- Inno Setup script.
- Installs to `%LOCALAPPDATA%\JSTorrent`.
- Writes registry keys.
- Generates manifest from template (or writes it directly).

#### [NEW] [installers/macos/scripts/*.sh](file:///home/kgraehl/code/jstorrent-host/installers/macos/scripts/)
- `postinstall.sh`: Creates directories, copies binary, substitutes manifest template, sets permissions.
- `uninstall.sh`: Removes binary and manifest.

#### [NEW] [installers/linux/*.sh](file:///home/kgraehl/code/jstorrent-host/installers/linux/)
- `install.sh`: Installs to `~/.local/lib/jstorrent-native`, creates manifest in `~/.config/...`.
- `uninstall.sh`: Removes installed files.

#### [NEW] [ci/github-actions/build-and-package.yml](file:///home/kgraehl/code/jstorrent-host/ci/github-actions/build-and-package.yml)
- Matrix build: Windows, macOS, Ubuntu.
- Windows: Build release, run `iscc`, upload artifacts.
- macOS: Build release, run `pkgbuild`/`productbuild`, upload artifacts.
- Linux: Build release, create tarball with scripts, upload artifacts.

## Verification Plan

### Automated Verification
- **CI Pipeline**: The GitHub Actions workflow itself is the primary verification. It will fail if scripts are missing or build commands fail.
- **Syntax Check**: I will visually verify the scripts.

### Manual Verification
- The user will need to run the generated installers on their respective platforms to fully verify functionality (registry keys, permissions, etc.).
