# Fix MSE Plaintext crypto_select Bug

## Overview

The MSE responder always sends `CRYPTO_SELECT_RC4` regardless of the negotiated encryption method. This breaks plaintext-only negotiation.

## The Bug

In `packages/engine/src/crypto/mse-handshake.ts` line 487-488:

```typescript
const cryptoSelect =
  this.encryptionMethod === CRYPTO_RC4 ? CRYPTO_SELECT_RC4 : CRYPTO_SELECT_RC4
```

Both branches of the ternary return `CRYPTO_SELECT_RC4`. The second branch should return `CRYPTO_SELECT_PLAIN`.

## Fix

### Update `packages/engine/src/crypto/mse-handshake.ts`

Find (around line 487):
```typescript
    const cryptoSelect =
      this.encryptionMethod === CRYPTO_RC4 ? CRYPTO_SELECT_RC4 : CRYPTO_SELECT_RC4
```

Replace with:
```typescript
    const cryptoSelect =
      this.encryptionMethod === CRYPTO_RC4 ? CRYPTO_SELECT_RC4 : CRYPTO_SELECT_PLAIN
```

### Add missing import

The `CRYPTO_SELECT_PLAIN` constant is defined but not imported. Update the imports at the top of the file.

Find:
```typescript
import {
  VC,
  CRYPTO_PROVIDE,
  CRYPTO_SELECT_RC4,
  CRYPTO_RC4,
  CRYPTO_PLAINTEXT,
  BT_PROTOCOL_HEADER,
  MSE_HANDSHAKE_TIMEOUT,
  MSE_SYNC_MAX_BYTES,
} from './constants'
```

Replace with:
```typescript
import {
  VC,
  CRYPTO_PROVIDE,
  CRYPTO_SELECT_RC4,
  CRYPTO_SELECT_PLAIN,
  CRYPTO_RC4,
  CRYPTO_PLAINTEXT,
  BT_PROTOCOL_HEADER,
  MSE_HANDSHAKE_TIMEOUT,
  MSE_SYNC_MAX_BYTES,
} from './constants'
```

## Verification

```bash
cd packages/engine
pnpm test -- --run test/crypto/
pnpm typecheck
```

Existing tests should still pass. The integration test works because libtorrent accepts RC4, so this bug wasn't caught.

## Optional: Add Unit Test

To prevent regression, add a test that verifies plaintext selection works:

```typescript
it('should select plaintext when peer only supports plaintext', async () => {
  // This would require mocking a peer that only advertises CRYPTO_PLAINTEXT
  // in crypto_provide. Low priority since RC4 is the common case.
})
```
