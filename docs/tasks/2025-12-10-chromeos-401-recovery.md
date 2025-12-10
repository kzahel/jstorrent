# ChromeOS 401 Token Mismatch Recovery

## Problem

When tokens get out of sync between the extension and Android app, authenticated requests fail with 401. There's no recovery path - the user is stuck.

**Scenarios causing mismatch:**
- Android app data cleared (loses token)
- Extension reinstalled (new token generated)
- User manually unpairs in Android settings

## Current Behavior

```
probe()
  → findDaemonPort()     ✓ finds port
  → isPaired(port)       ✓ returns true (Android HAS a token)
  → fetchRoots()         ✗ 401 (tokens don't MATCH)
  → probe fails with generic error
  → state machine doesn't know it's a token issue
```

## Fix

Detect 401 specifically, clear token, and let state machine handle re-pairing.

### Changes to `chromeos-adapter.ts`

**1. Add 401 detection in fetchRoots():**

Find this block (~line 299-302):
```typescript
if (!response.ok) {
  console.warn('[ChromeOSAdapter] Failed to fetch roots:', response.status)
  return []
}
```

Replace with:
```typescript
if (response.status === 401) {
  console.warn('[ChromeOSAdapter] 401 Unauthorized - token mismatch, clearing token')
  await this.clearToken()
  throw new TokenMismatchError('Token mismatch - re-pair needed')
}

if (!response.ok) {
  console.warn('[ChromeOSAdapter] Failed to fetch roots:', response.status)
  return []
}
```

**2. Add the error class and clearToken method:**

At the top of the file, after imports:
```typescript
export class TokenMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TokenMismatchError'
  }
}
```

Add method after `getOrCreateToken()` (~line 275):
```typescript
private async clearToken(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEY_TOKEN])
  this.token = null
}
```

**3. Handle token mismatch in probe():**

The existing catch block already handles errors generically. The `TokenMismatchError` will propagate up and probe() will return `{ success: false, error: 'Token mismatch - re-pair needed' }`.

But we should also clear the saved port since the daemon is running but we can't auth to it:

Find the catch block in probe() (~line 108-114):
```typescript
} catch (error) {
  console.error('[ChromeOSAdapter] Probe failed:', error)
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  }
}
```

Replace with:
```typescript
} catch (error) {
  console.error('[ChromeOSAdapter] Probe failed:', error)
  
  // On token mismatch, also clear saved port to force fresh discovery on retry
  if (error instanceof TokenMismatchError) {
    await chrome.storage.local.remove([STORAGE_KEY_PORT])
    this.currentPort = null
  }
  
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  }
}
```

## Recovery Flow

After fix:

```
1. probe() → fetchRoots() returns 401
2. TokenMismatchError thrown, token cleared
3. probe() returns { success: false, error: 'Token mismatch - re-pair needed' }
4. State machine → LAUNCH_PROMPT
5. User clicks "Launch Android App"
6. triggerLaunch() generates NEW token, sends pair intent
7. Android receives intent, stores new token
8. Polling detects connection, probe() succeeds
9. State machine → CONNECTED
```

## Verification

1. **Setup:** Get extension and Android app connected and working
2. **Break it:** In Android, go to app settings and clear data (or adb: `adb shell pm clear com.jstorrent.app`)
3. **Observe:** Extension should detect 401, show launch prompt
4. **Recover:** Click launch, Android app opens with pair intent
5. **Verify:** Connection re-establishes, downloads work

## Files Modified

- `extension/src/lib/io-bridge/adapters/chromeos-adapter.ts`
