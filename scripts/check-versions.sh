#!/usr/bin/env bash
set -e

# Components to check
COMPONENTS=("system-bridge" "extension" "website" "android")

echo "Fetching remote tags..."
# We use git ls-remote to avoid modifying local tags
REMOTE_TAGS=$(git ls-remote --tags origin)

echo "Current highest versions:"
echo "-------------------------"

for COMPONENT in "${COMPONENTS[@]}"; do
  PREFIX="${COMPONENT}-v"
  
  # Filter tags for this component, strip prefix, sort by version, take the last one
  LATEST_VERSION=$(echo "$REMOTE_TAGS" | \
    grep "refs/tags/${PREFIX}" | \
    sed "s|.*refs/tags/${PREFIX}||" | \
    # Remove potential peppa suffix like ^{} which git ls-remote might show for annotated tags
    sed 's|\^{}||' | \
    sort -V | \
    tail -n 1)

  if [ -z "$LATEST_VERSION" ]; then
    echo "${COMPONENT}: No tags found"
  else
    echo "${COMPONENT}: ${LATEST_VERSION}"
  fi
done
