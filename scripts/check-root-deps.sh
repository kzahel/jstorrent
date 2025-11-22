#!/usr/bin/env bash
set -e

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed."
    exit 1
fi

count=$(jq '.dependencies // {} | length' package.json)

if [ "$count" -ne 0 ]; then
  echo "ERROR: Root package.json contains runtime dependencies."
  echo "This monorepo requires ALL runtime dependencies to live inside individual packages."
  echo "Only tooling should be installed at the root (eslint, prettier, typescript, turbo, etc.)."
  echo "See: https://github.com/kzahel/jstorrent-monorepo#root-packagejson-policy"
  exit 1
fi

echo "Success: No runtime dependencies found in root package.json."
