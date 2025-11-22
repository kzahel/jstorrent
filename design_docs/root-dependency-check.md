**Plan: Root Dependency Guardrail**

**Goal:** Prevent adding runtime `dependencies` to the monorepo’s root `package.json`.
Only `devDependencies` for tooling (eslint, prettier, typescript, turbo, pnpm, etc.) are allowed.

---

## 1. Script: `scripts/check-root-deps.sh`

**Purpose:** Fail if the root `package.json` contains any runtime dependencies.

**Behavior:**

- Use `jq` to count objects in `.dependencies`
- If non-zero, print a clear message with a link to the repo’s README section.

**Script Outline:**

```bash
#!/usr/bin/env bash
set -e

count=$(jq '.dependencies // {} | length' package.json)

if [ "$count" -ne 0 ]; then
  echo "ERROR: Root package.json contains runtime dependencies."
  echo "This monorepo requires ALL runtime dependencies to live inside individual packages."
  echo "Only tooling should be installed at the root (eslint, prettier, typescript, turbo, etc.)."
  echo "See: https://github.com/kzahel/jstorrent-monorepo#root-packagejson-policy"
  exit 1
fi
```

---

## 2. GitHub Action: `.github/workflows/check-root-deps.yml`

**Purpose:** Run the guardrail on every push + pull request.

**Outline:**

```yaml
name: Enforce Root Dependency Policy

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check-root-dependencies:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run root dependency check
        run: scripts/check-root-deps.sh
```

---

## Result

- Any runtime dependencies added to the root will fail CI instantly.
- PR authors receive a clear explanation and a link to the policy.
- No chance of accidental pollution of the root workspace.
