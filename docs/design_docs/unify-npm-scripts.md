**Design Document: Consolidation of Linting and Formatting Commands in Monorepo Root**

---

## Objective

Unify all linting and formatting commands under the **monorepo root** and remove all per-package lint/format aliases from individual `package.json` files. This ensures consistent behavior, single-source configuration, correct ignore handling, and eliminates maintenance overhead associated with duplicated scripts.

The agent’s goal:
**Remove all lint/format scripts from subpackages and define a single, root-level linting/formatting interface.**

---

## Background

The monorepo contains multiple components (extension, website, native-host, shared packages). Historically each subpackage defined its own lint or format script. This approach causes:

* Divergent commands across packages
* Incorrect `.prettierignore` and `.eslintignore` behavior
* Redundant maintenance
* Inconsistent lint rules if commands are not kept in sync
* Tooling disagreements due to different working directories

Modern pnpm monorepos follow a *centralized* tooling strategy:
**One ESLint config, one Prettier config, one set of commands at the repo root.**

---

## Requirements

1. The root `package.json` must provide the **sole authoritative lint/format commands**.
2. No `package.json` under any subfolder (e.g., `extension/`, `website/`, `packages/shared-ts/`) should contain:

   * `lint`, `lint:fix`, `format`, `format:check`, or similar scripts.
3. The agent should remove these commands wherever they appear.
4. The root-level commands must operate over the *entire repository*.
5. No package-specific lint aliases (e.g., `lint:extension`) are needed.

---

## Root-Level Commands Specification

In the root `package.json`, under `scripts`, define:

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  }
}
```

Notes:

* Running ESLint/Prettier at the root correctly resolves ignore files and config files.
* pnpm will automatically use the correct tool versions from root `devDependencies`.

---

## Tasks for the Agent

### 1. Remove Lint/Format Scripts from Subpackages

In every `package.json` under:

* `extension/`
* `website/`
* `packages/**`
* `apps/**`
* any other nested packages

Remove scripts such as:

* `"lint": "..."`
* `"lint:fix": "..."`
* `"format": "..."`
* `"format:check": "..."`

The only remaining scripts in these packages should be the component’s build/test commands, not lint/format.

### 2. Ensure Root Package Has Correct Scripts

Add or replace the root-level `scripts` block with the consolidated commands from the specification above.

### 3. Ensure Config Files Live at Root

Verify the following files exist in the root directory:

* `eslint.config.js` (or `.eslintrc.js`)
* `.prettierrc`
* `.eslintignore`
* `.prettierignore`
* `tsconfig.base.json` (optional but recommended)

Subpackages may have `tsconfig.json` files that **extend** the root config, but should not include ESLint or Prettier configs.

### 4. Cleanup

Remove any obsolete lint or format tooling from subpackage `devDependencies`.
All ESLint/Prettier tooling must exist *only* in root `devDependencies`.

---

## Expected Result

After completing the consolidation:

* Developers run `pnpm lint` or `pnpm format` from the monorepo root.
* ESLint/Prettier operate consistently across all code in the repo.
* Ignore files correctly apply relative to the root.
* Subpackages no longer contain redundant or incorrect lint/format scripts.
* Maintenance overhead is minimized.
* The tooling aligns with idiomatic pnpm monorepo structure.

---

## Summary

Centralizing linting and formatting commands at the monorepo root:

* Improves consistency
* Eliminates duplicated scripts
* Fixes ignore/config resolution issues
* Reduces maintenance burden
* Matches industry best practices for monorepos

The agent should remove all subpackage lint/format commands and enforce the single root-level set described in this document.
