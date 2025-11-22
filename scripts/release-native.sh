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
