Below is a clear, implementation-ready plan for merging your legacy repositories into **jstorrent-monorepo**, reorganizing them into a clean monorepo structure, and consolidating all CI under a unified `.github` directory. The plan focuses on correctness, simplicity, and future-proofing for additional platforms (web, server, Android, iOS).

---

# 1. Target Monorepo Structure

Final structure (after migration):

```
jstorrent-monorepo/
  extension/                # migrated from old-jstorrent-extension
  native-host/             # migrated from old-jstorrent-native-host
  website/                 # later: GitHub Pages frontend
  apps/
    mobile/                # shared RN code
    android/
    ios/
  packages/
    shared-ts/             # shared TypeScript (RPC defs, utils)
    proto/                 # optional schema/protobuf/msgpack sources
  infra/
    api/                   # future api.jstorrent.com backend
  scripts/
  .github/
    workflows/
      extension-ci.yml
      native-ci.yml
      website-ci.yml
      mobile-ci.yml
      release.yml
    CODEOWNERS
  docs/                    # built website for GitHub Pages
  old-repositories/        # archival, will eventually delete or move to another branch
  pnpm-workspace.yaml
  README.md
```

This separates concerns, isolates CI triggers cleanly, and leaves room for future expansion.

---

# 2. Migration Plan: Step-by-Step

## Step 1 — Prepare the monorepo

Inside `jstorrent-monorepo/`:

```
mkdir extension native-host website apps packages scripts infra
```

And create empty scaffolds:

```
apps/mobile/
apps/android/
apps/ios/
packages/shared-ts/
packages/proto/
infra/api/
scripts/
```

Add your `pnpm-workspace.yaml` (optional but recommended for JS ecosystem later).

---

## Step 2 — Move the old repositories into place

Take the existing directories:

```
old-repositories/
  old-jstorrent-extension/
  old-jstorrent-native-host/
```

Move as follows:

### A. Chrome extension → `extension/`

```
mv old-repositories/old-jstorrent-extension/* extension/
```

Clean up unnecessary files:

* old README
* old `.github/`
* old build artifacts
* old node_modules

### B. Native host → `native-host/`

```
mv old-repositories/old-jstorrent-native-host/* native-host/
```

Same cleanup.

Keep the old directories in `old-repositories/` as an archive or delete after validation.

---

## Step 3 — Rewrite paths, imports, and tooling

Inside the extension:

* Update references to native host paths if hardcoded
* Normalize tooling so it expects local paths consistent with the monorepo

Inside the native host:

* Adjust installer scripts so they no longer assume repo root is the native host repo
* Move platform-specific installers to `native-host/installers/{windows,mac,linux}`

---

# 3. Combining `.github` CI Files

The most important rule:

> A monorepo has exactly one `.github` folder at the root.

### Process:

1. Copy each workflow from the legacy repos into:

   ```
   jstorrent-monorepo/.github/workflows/
   ```

2. Rename workflows to reflect components:

   * `extension-ci.yml`
   * `native-host-ci.yml`
   * `website-ci.yml` (future)
   * `mobile-ci.yml` (future RN)
   * `release.yml`
   * `deploy-pages.yml`

3. Strip obsolete steps (paths that no longer exist, or repo-specific actions).

4. Add `paths:` filters so they run only when corresponding directories change.

### Example: extension CI

```yaml
# .github/workflows/extension-ci.yml
name: Extension CI

on:
  push:
    branches: [ main ]
    paths:
      - 'extension/**'
      - 'packages/shared-ts/**'
  pull_request:
    paths:
      - 'extension/**'
      - 'packages/shared-ts/**'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install
      - working-directory: extension
        run: pnpm build
```

### Example: native host CI

```yaml
# .github/workflows/native-ci.yml
name: Native Host CI

on:
  push:
    branches: [ main ]
    paths:
      - 'native-host/**'
      - 'packages/proto/**'
  pull_request:
    paths:
      - 'native-host/**'
      - 'packages/proto/**'

jobs:
  build-rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo build --release
        working-directory: native-host
```

### Future: website deploy (GitHub Pages)

```yaml
on:
  push:
    branches: [ main ]
    paths:
      - 'website/**'
      - 'packages/shared-ts/**'
```

This separation preserves behavior of separate repos but inside a single monorepo.

---

# 4. Reusable CI Modules (optional but future-proof)

You can factor shared logic into reusable workflows:

```
.github/workflows/node-common.yml
.github/workflows/rust-common.yml
.github/workflows/release-common.yml
```

Then each component uses:

```yaml
jobs:
  build:
    uses: ./.github/workflows/node-common.yml
    with:
      cwd: extension
```

This avoids repeated boilerplate.

---

# 5. Codeowners (recommended)

Define clear ownership boundaries:

```
# .github/CODEOWNERS

/extension/      @kyle
/native-host/    @kyle
/website/        @kyle
/apps/           @kyle
/packages/       @kyle
```

---

# 6. Versioning and Release Tags

### Option A — Prefix tags per component

* `extension-v1.2.0`
* `native-v0.4.0`
* `mobile-v0.1.0`

Workflows trigger by tag pattern:

```yaml
on:
  push:
    tags:
      - "extension-v*"
```

### Option B — Use a changeset or monorepo versioning tool

Later, if needed.

---

# 7. Migration Checklist

### A. Repo structure

* [ ] Create target folder layout
* [ ] Move legacy code into appropriate folders
* [ ] Remove redundant configs and node_modules
* [ ] Add `pnpm` workspace configuration

### B. CI

* [ ] Extract old `.github/workflows` from both legacy repos
* [ ] Rewrite them into one `.github/workflows` directory
* [ ] Add `paths:` filters
* [ ] Add shared workflows if useful
* [ ] Validate CI on a test PR

### C. Build + install scripts

* [ ] Update installer scripts in `native-host/installers/`
* [ ] Update extension build commands to new folder structure

### D. Documentation

* [ ] Rewrite root `README.md` with monorepo explanation
* [ ] Add `extension/README.md`
* [ ] Add `native-host/README.md`
* [ ] Add `packages/shared-ts/README.md`

### E. Future expansion support

* [ ] Add placeholders for `apps/mobile`, `apps/android`, `apps/ios`
* [ ] Add placeholder shared TypeScript library in `packages/shared-ts`
* [ ] Add placeholder API folder in `infra/api`

---

# 8. Summary

The plan covers:

* Moving old repos into a clean monorepo layout
* Consolidating all CI into a single `.github`
* Using `paths:` to emulate per-repo workflows
* Preparing for future platforms (website, server, RN apps)
* Ensuring component isolation but shared code where expected
* Allowing later growth without structural changes
