# Summary - CI/CD & Release Management

Following the initial installer implementation, several iterations were made to fix CI/CD issues and implement release management.

## CI/CD Fixes

1.  **Workflow Location**: Moved `.github/workflows/build-and-package.yml` from `ci/github-actions/` to `.github/workflows/`.
2.  **Action Versions**: Upgraded `actions/upload-artifact` and `actions/checkout` to `v4` to resolve deprecation warnings.
3.  **Rust Toolchain**: Switched from `actions-rs/toolchain` to `dtolnay/rust-toolchain` to avoid `set-output` deprecation warnings.
4.  **Linux Dependencies**: Added `libgtk-3-dev` installation for the Linux runner.
5.  **Windows Build**: Fixed PowerShell command syntax for `ISCC.exe` by adding the `&` operator.
6.  **Binary Naming**: Corrected mismatch between package name (`jstorrent-host`) and installer expectation (`jstorrent-native-host`).
7.  **Inno Setup Script**: Fixed type mismatch in `jstorrent.iss` by using `AnsiString` for file I/O.

## Release Management

1.  **Documentation**: Created `release-management.md`.
2.  **Automation**: Updated CI to trigger on tags (`v*`) and use `softprops/action-gh-release` to upload artifacts.
3.  **Permissions**: Added `contents: write` permission to the workflow to allow release creation.

## One-Line Installer

1.  **Script**: Created `docs/install.sh` for easy Linux installation via `curl | bash`.
2.  **GitHub Pages**: Created `docs/index.html` and `deploy-pages.yml` to host the install script at `kyle.graehl.org/jstorrent-native-host/`.
