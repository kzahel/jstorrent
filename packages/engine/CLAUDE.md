# Engine Package - Claude Instructions

## Info Hash Convention

Info hashes use a branded type `InfoHashHex` to ensure lowercase normalization at compile time.

- `infoHashFromHex(string)` - Use for ANY external string input (magnets, tracker responses, etc.)
- `infoHashFromBytes(Uint8Array)` - Use when converting from 20-byte binary form
- Never cast `as InfoHashHex` directly - always use the factory functions

The branded type prevents bugs where uppercase hex causes storage key mismatches.

### Example Usage

```typescript
import { infoHashFromHex, infoHashFromBytes, InfoHashHex } from './utils/infohash'

// From external input (magnet link, tracker response, user input)
const hash1: InfoHashHex = infoHashFromHex('ABCD1234...')  // throws if invalid

// From binary (20-byte SHA1 hash)
const hash2: InfoHashHex = infoHashFromBytes(sha1Bytes)

// Direct comparison works (both are lowercase)
if (hash1 === hash2) { ... }

// Can use as Map/Record keys
const torrents = new Map<InfoHashHex, Torrent>()
```
