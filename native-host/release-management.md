# Release Management Guide

This document outlines how to manage releases for the JSTorrent Native Host using GitHub Actions.

## 1. Release Strategy

We support two types of releases:
1.  **Stable Releases**: Triggered by pushing a tag (e.g., `v0.1.0`). These are permanent releases with attached binaries.
2.  **Bleeding Edge (Nightly)**: The latest build from the `main` branch. These artifacts are available in the "Actions" tab but expire after a retention period (default 90 days).

## 2. Creating a Stable Release

To create a stable release, you simply need to push a tag. The CI pipeline will automatically build the binaries and attach them to a GitHub Release.

### Steps:

1.  **Tag the commit**:
    ```bash
    git tag v0.1.0
    git push origin v0.1.0
    ```

2.  **GitHub Action**:
    - The `build-and-package.yml` workflow will trigger.
    - It will build for Windows, macOS, and Linux.
    - It will create a "Draft" release (or publish immediately, depending on config) and upload the artifacts:
        - `windows-installer.zip` (or `.exe`)
        - `macos-installer.pkg`
        - `linux-installer.tar.gz`

3.  **Publish**:
    - Go to the "Releases" tab on GitHub.
    - You will see the new release (possibly as a Draft).
    - Edit the release notes to describe changes.
    - Click "Publish release".

## 3. Bleeding Edge (Main Branch)

Every push to `main` triggers a build. You can access these builds:

1.  Go to the **Actions** tab on GitHub.
2.  Click on the latest **Build and Package** workflow run.
3.  Scroll down to **Artifacts**.
4.  Download the artifacts (note: they are zipped by GitHub).

## 4. CI Configuration

The GitHub Actions workflow (`.github/workflows/build-and-package.yml`) needs to be updated to handle the `release` event or `push: tags`.

### Recommended Configuration

We will update the workflow to:
1.  Trigger on `push` to `main` (for testing/bleeding edge).
2.  Trigger on `push` of tags starting with `v*` (for releases).
3.  Use `softprops/action-gh-release` to upload artifacts when a tag is pushed.
