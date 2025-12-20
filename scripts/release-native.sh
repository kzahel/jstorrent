#!/usr/bin/env bash
set -e

VERSION="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9] ]]; then
  echo "Error: Version must start with a number (e.g., 1.0.0, not v1.0.0)"
  exit 1
fi

TAG="native-v${VERSION}"

# Update Cargo.toml versions
sed -i '' "s/^version = \".*\"/version = \"${VERSION}\"/" "$REPO_ROOT/native-host/Cargo.toml"
sed -i '' "s/^version = \".*\"/version = \"${VERSION}\"/" "$REPO_ROOT/native-host/io-daemon/Cargo.toml"

# Update Cargo.lock
(cd "$REPO_ROOT/native-host" && cargo check --quiet)

# Commit version bump
git add "$REPO_ROOT/native-host/Cargo.toml" "$REPO_ROOT/native-host/io-daemon/Cargo.toml" "$REPO_ROOT/native-host/Cargo.lock"
git commit -m "chore: bump native version to ${VERSION} [skip ci]"

# Create and push tag
git tag "$TAG"
git push origin HEAD "$TAG"

echo "Created and pushed tag $TAG"
