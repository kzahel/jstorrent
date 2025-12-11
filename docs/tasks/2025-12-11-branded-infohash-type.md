# Branded InfoHashHex Type Migration

## Overview

Info hashes are 40-character hex strings that **must** be lowercase for consistent storage keys and comparisons. We've had bugs where uppercase hex from magnet links caused key mismatches. This task introduces a branded type so the compiler enforces normalization.

## Phase 1: Create the Branded Type

### 1.1 Create `packages/engine/src/utils/infohash.ts`

```typescript
/**
 * Branded type for normalized (lowercase) info hash hex strings.
 * Use the factory functions to create instances - never cast directly.
 */
declare const InfoHashBrand: unique symbol
export type InfoHashHex = string & { readonly [InfoHashBrand]: true }

/**
 * Convert a hex string to InfoHashHex, normalizing to lowercase.
 * Use for ANY external input: magnet links, tracker responses, user input.
 * @throws Error if not a valid 40-char hex string
 */
export function infoHashFromHex(hex: string): InfoHashHex {
  const normalized = hex.toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`Invalid info hash hex: ${hex}`)
  }
  return normalized as InfoHashHex
}

/**
 * Convert raw bytes to InfoHashHex. Always produces lowercase.
 * Use when you have the 20-byte binary form.
 */
export function infoHashFromBytes(bytes: Uint8Array): InfoHashHex {
  if (bytes.length !== 20) {
    throw new Error(`Invalid info hash bytes: expected 20, got ${bytes.length}`)
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('') as InfoHashHex
}

/**
 * Parse info hash from bytes, returning both binary and hex forms.
 * Convenience for places that need both.
 */
export function parseInfoHash(bytes: Uint8Array): { bytes: Uint8Array; hex: InfoHashHex } {
  return {
    bytes,
    hex: infoHashFromBytes(bytes),
  }
}
```

### 1.2 Update `packages/engine/src/utils/index.ts`

Add export:

```typescript
export * from './infohash.js'
```

## Phase 2: Migrate Existing Utils

### 2.1 Update `packages/engine/src/utils/hex.ts`

Find `toInfoHashString` (or similar) and either:
- Remove it (replaced by `infoHashFromBytes`)
- Or have it call `infoHashFromBytes` internally

Search for: `toInfoHashString`, `normalizeInfoHash`, `areInfoHashesEqual`

These should either be removed or updated to use/return `InfoHashHex`.

### 2.2 Update `packages/engine/src/utils/magnet.ts`

This is where the original bug was. Find where info hash is extracted and ensure it goes through `infoHashFromHex()`.

Search for: `xt=urn:btih:`, `infoHash`, `toLowerCase`

## Phase 3: Update Type Signatures

Search the codebase for functions/methods that accept or return info hash strings. Update signatures to use `InfoHashHex`.

**Search patterns:**
- `infoHash: string`
- `infoHash?: string`
- `: string` near "hash" or "infohash" in variable names
- `Map<string,` where the key is an info hash
- `Record<string,` where the key is an info hash

**Key places to check:**
- `Torrent` class - likely has `infoHash` property
- `BtEngine` - likely has maps keyed by info hash
- `ISessionStore` interface and implementations
- Tracker-related code
- Peer connection code

**Migration pattern:**

```typescript
// Before
class Torrent {
  infoHash: string
}

// After
class Torrent {
  infoHash: InfoHashHex
}
```

```typescript
// Before
getTorrent(infoHash: string): Torrent | undefined

// After
getTorrent(infoHash: InfoHashHex): Torrent | undefined
```

## Phase 4: Fix Call Sites

After changing signatures, `pnpm typecheck` will show all places that need updating.

**Common patterns:**

```typescript
// External input - use infoHashFromHex
const hash = infoHashFromHex(magnetLink.infoHash)

// From bytes - use infoHashFromBytes  
const hash = infoHashFromBytes(rawBytes)

// Already have InfoHashHex - no change needed
engine.getTorrent(torrent.infoHash)  // torrent.infoHash is already InfoHashHex
```

## Phase 5: Update CLAUDE.md

Add to `packages/engine/CLAUDE.md` (or create if it doesn't exist):

```markdown
## Info Hash Convention

Info hashes use a branded type `InfoHashHex` to ensure lowercase normalization at compile time.

- `infoHashFromHex(string)` - Use for ANY external string input (magnets, tracker responses, etc.)
- `infoHashFromBytes(Uint8Array)` - Use when converting from 20-byte binary form
- Never cast `as InfoHashHex` directly - always use the factory functions

The branded type prevents bugs where uppercase hex causes storage key mismatches.
```

## Verification

```bash
cd packages/engine
pnpm typecheck  # Should pass with no errors
pnpm test       # All tests should pass
pnpm lint

# From monorepo root
pnpm typecheck  # Full project
pnpm test       # All packages
```

## Notes

- The branded type is structurally a string, so `===` comparison works
- JSON serialization works normally (brand is compile-time only)
- If you find places that legitimately need raw strings (e.g., display), you can use `as string` or just use the value directly since it IS a string
