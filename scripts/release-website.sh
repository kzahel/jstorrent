#!/usr/bin/env bash
set -e

VERSION="$1"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9] ]]; then
  echo "Error: Version must start with a number (e.g., 1.0.0, not v1.0.0)"
  exit 1
fi

TAG="website-v${VERSION}"

git tag "$TAG"
git push origin "$TAG"

echo "Created and pushed tag $TAG"
