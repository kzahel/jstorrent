**Design Document: Component-Prefixed Tagging and Release Workflow**

---

## Overview

JSTorrent uses a monorepo containing multiple independently-versioned components:

* `extension/`
* `native-host/`
* `website/`
* future: `apps/` (mobile)

Releases for each component must be isolated so that publishing one does not affect any others. GitHub Actions should build and publish artifacts only when explicitly requested, and the release process should require minimal overhead.

To achieve this, each component uses **component-prefixed Git tags**, and each component has a dedicated release workflow that triggers only on tags matching its prefix. Release tags can be created through GitHub UI or by running a simple script.

---

## Tagging Strategy

Each component uses its own version namespace:

```
native-v<semver>
extension-v<semver>
website-v<semver>
mobile-v<semver>     # future
```

Examples:

```
native-v0.0.7
extension-v1.2.0
website-v0.3.1
```

### Benefits

* **Complete independence:** releasing one component never triggers workflows for other components.
* **Simple CI filtering:** GitHub Actions selects workflows using tag patterns.
* **No central version file:** version numbers live in tags only, avoiding merge conflicts.
* **Supports GitHub UI releases:** maintainers can cut releases from the “Draft Release” interface by choosing the correct tag name.

---

## GitHub Actions Triggers

Each component’s release workflow includes a tag filter:

```yaml
on:
  push:
    tags:
      - 'native-v*'
```

Similarly:

```
extension-v*
website-v*
mobile-v*
```

This ensures the correct workflow runs only when its component is tagged.

---

## Release Scripts

Each component has a dedicated unparameterized script in `scripts/`. These scripts accept a version number and generate the appropriate tag.

All scripts follow the same pattern.

---

### `scripts/release-native.sh`

```bash
#!/usr/bin/env bash
set -e

VERSION="$1"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

TAG="native-v${VERSION}"

git tag "$TAG"
git push origin "$TAG"

echo "Created and pushed tag $TAG"
```

---

### `scripts/release-extension.sh`

```bash
#!/usr/bin/env bash
set -e

VERSION="$1"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

TAG="extension-v${VERSION}"

git tag "$TAG"
git push origin "$TAG"

echo "Created and pushed tag $TAG"
```

---

### `scripts/release-website.sh`

```bash
#!/usr/bin/env bash
set -e

VERSION="$1"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

TAG="website-v${VERSION}"

git tag "$TAG"
git push origin "$TAG"

echo "Created and pushed tag $TAG"
```

---

### `scripts/release-mobile.sh` (future)

```bash
#!/usr/bin/env bash
set -e

VERSION="$1"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

TAG="mobile-v${VERSION}"

git tag "$TAG"
git push origin "$TAG"

echo "Created and pushed tag $TAG"
```

---

## Release Process

### Option A — From local machine

```
cd jstorrent-monorepo
./scripts/release-native.sh 0.0.7
```

CI builds and uploads the appropriate artifact to a GitHub Release.

### Option B — From GitHub UI

1. Navigate to **Releases → Draft new release**
   `native-v0.0.7`
3. Publish release
4. CI builds and attaches artifacts automatically

Both methods work interchangeably.

---

## Summary

The component-prefixed tagging system provides a simple, reliable method for independent versioning and release automation inside a monorepo. GitHub Actions uses tag pattern matching to ensure each component builds only on relevant releases, and maintainers can publish releases either through lightweight scripts or via GitHub’s UI with minimal complexity.
