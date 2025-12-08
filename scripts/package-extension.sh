#!/bin/bash
set -e

# Files/directories to exclude from the package (CWS promotional images)
EXCLUDE="images/cws/*"

cd ../extension

# Build without injecting the public key (required for CWS uploads)
SKIP_INJECT_KEY=1 pnpm build

cd dist
zip -r ../package.zip . -x "$EXCLUDE"
