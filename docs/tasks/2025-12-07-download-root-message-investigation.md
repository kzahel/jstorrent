# Download Root Message Flow Investigation

## Problem

After the io-bridge refactor, selecting a download folder via native file picker doesn't update the extension UI. The native host receives the folder selection and logs success, but the extension never sees the response.

## Symptom

1. User clicks "Add Download Location" in UI
2. Native file picker opens, user selects folder
3. Native host logs show `RootAdded` response sent
4. Extension UI shows no new download root
5. No errors in extension console

## Message Flow (Traced)

```
UI Button Click
    │
    ▼
DownloadRootsManager.tsx
    │ calls engineManager.pickDownloadFolder()
    ▼
engine-manager.ts
    │ calls getBridge().sendMessage({ type: 'PICK_DOWNLOAD_FOLDER' })
    ▼
sw.ts (service worker)
    │ receives message, calls ioBridge.pickDownloadFolder()
    ▼
io-bridge-service.ts
    │ registers one-time message handler via desktopAdapter.onMessage()
    │ calls desktopAdapter.send({ type: 'PickFolder' })
    ▼
desktop-adapter.ts
    │ calls this.connection.send()
    ▼
native-connection.ts
    │ calls chrome.runtime.Port.postMessage()
    ▼
═══════════════════════════════════════════════════
    │ NATIVE HOST BOUNDARY
    ▼
native-host/src/main.rs
    │ receives request, dispatches to folder_picker
    ▼
native-host/src/folder_picker.rs
    │ opens GTK picker, returns ResponsePayload::RootAdded
    ▼
native-host/src/main.rs
    │ builds Response { id, ok: true, type: "RootAdded", payload: { root } }
    │ writes JSON to stdout
    ▼
═══════════════════════════════════════════════════
    │ BACK TO EXTENSION
    ▼
native-connection.ts
    │ chrome.runtime.Port.onMessage fires
    │ iterates this.messageListeners, calls each
    ▼
desktop-adapter.ts
    │ listener registered in probe() or pickDownloadFolder()?
    ▼
io-bridge-service.ts
    │ handler checks response.id === requestId
    │ resolves promise with root
    ▼
sw.ts
    │ returns root to engine-manager
    ▼
engine-manager.ts
    │ calls engine.registerDownloadRoot(root)
    ▼
UI updates
```

## Key Files to Investigate

### 1. `extension/src/lib/io-bridge/io-bridge-service.ts`

Look at `pickDownloadFolder()` method (~line 89-130):

```typescript
async pickDownloadFolder(): Promise<DownloadRoot | null> {
  const desktopAdapter = this.desktopAdapter
  if (!desktopAdapter) return null

  const requestId = crypto.randomUUID()
  
  return new Promise((resolve) => {
    // THIS HANDLER - is it ever called?
    const handler = (response: NativeResponse) => {
      if (response.id === requestId) {
        // Does execution reach here?
        desktopAdapter.offMessage(handler)
        if (response.ok && response.type === 'RootAdded') {
          resolve(response.payload.root)
        } else {
          resolve(null)
        }
      }
    }
    
    desktopAdapter.onMessage(handler)  // Is this registration working?
    desktopAdapter.send({ id: requestId, type: 'PickFolder' })
  })
}
```

**Questions:**
- Is `handler` ever invoked?
- Is `response.id === requestId` evaluating true?
- Is `desktopAdapter.onMessage()` actually registering the listener?

### 2. `extension/src/lib/io-bridge/adapters/desktop-adapter.ts`

Look at how `onMessage` delegates to connection (~line 45-55):

```typescript
onMessage(handler: (msg: NativeResponse) => void): void {
  this.connection?.onMessage(handler)
}
```

**Questions:**
- Is `this.connection` non-null when `pickDownloadFolder` calls `onMessage`?
- The connection is set in `probe()` - is probe completing before pickDownloadFolder runs?

### 3. `extension/src/lib/native-connection.ts`

Look at `onMessage` method (~line 85-95):

```typescript
onMessage(handler: (msg: NativeResponse) => void): void {
  this.messageListeners.push(handler)
}
```

And the port setup in `connect()` (~line 50-70):

```typescript
this.port.onMessage.addListener((msg) => {
  for (const listener of this.messageListeners) {
    listener(msg)
  }
})
```

**Questions:**
- Are multiple handlers accumulating in `messageListeners`?
- Is the port's `onMessage` listener set up before `pickDownloadFolder` registers its handler?
- Is there a race where the response arrives before the handler is registered?

### 4. `extension/src/sw.ts`

Look at PICK_DOWNLOAD_FOLDER handler (~line 180-200):

```typescript
case 'PICK_DOWNLOAD_FOLDER': {
  const root = await ioBridge.pickDownloadFolder()
  sendResponse({ root })
  return
}
```

**Questions:**
- Is `ioBridge.pickDownloadFolder()` resolving or hanging?
- What value does `root` have?

## Primary Hypothesis: Listener Registration Timing

The most likely issue is that `desktopAdapter.onMessage(handler)` isn't properly registering the handler.

In `desktop-adapter.ts`, `onMessage` does:
```typescript
this.connection?.onMessage(handler)
```

If `this.connection` is null (because probe hasn't completed or connection was lost), the handler silently doesn't register.

**To verify:** Add logging in `desktop-adapter.ts`:
```typescript
onMessage(handler: (msg: NativeResponse) => void): void {
  if (!this.connection) {
    console.error('[DesktopAdapter] onMessage called but connection is null!')
  }
  this.connection?.onMessage(handler)
}
```

## Secondary Hypothesis: Message Format Mismatch

The native host sends:
```json
{
  "id": "abc-123",
  "ok": true,
  "type": "RootAdded",
  "payload": { "root": { "token": "...", "displayName": "..." } }
}
```

The handler expects `response.type === 'RootAdded'`.

**To verify:** Log the raw message in `native-connection.ts`:
```typescript
this.port.onMessage.addListener((msg) => {
  console.log('[NativeConnection] Raw message:', JSON.stringify(msg))
  for (const listener of this.messageListeners) {
    listener(msg)
  }
})
```

## Tertiary Hypothesis: Request ID Mismatch

The request ID generated in `pickDownloadFolder()` might not match what the native host echoes back.

**To verify:** Log both IDs:
```typescript
const handler = (response: NativeResponse) => {
  console.log(`[pickDownloadFolder] Expected ID: ${requestId}, Got ID: ${response.id}`)
  if (response.id === requestId) {
    // ...
  }
}
```

## Verification Steps

1. **Add minimal logging** to these locations:
   - `native-connection.ts` port.onMessage listener - log every message received
   - `desktop-adapter.ts` onMessage - warn if connection is null
   - `io-bridge-service.ts` pickDownloadFolder handler - log when called

2. **Reproduce the issue:**
   - Load extension
   - Open service worker console (chrome://extensions → Inspect service worker)
   - Click "Add Download Location"
   - Select a folder

3. **Check logs for:**
   - Does NativeConnection receive the RootAdded message? (If no: native host issue)
   - Does DesktopAdapter warn about null connection? (If yes: connection lifecycle issue)
   - Does pickDownloadFolder handler log? (If no: listener not registered)
   - Do request IDs match? (If no: ID generation/echo issue)

4. **Check native host logs:**
   - Location: `~/.local/share/jstorrent-native/jstorrent-native-host.log` (Linux)
   - Look for "Sending response" with RootAdded

## Related Files

- `docs/tasks/2025-12-07-iobridge-integration-gaps.md` - Lists event forwarding as needing verification
- `docs/tasks/2025-12-07-desktop-iobridge-connection-fixes.md` - Recent connection handling changes

## Expected Fix Location

Based on investigation, the fix will likely be in one of:
- `desktop-adapter.ts` - ensure connection is set before message handlers registered
- `io-bridge-service.ts` - ensure adapter is fully initialized before use
- `native-connection.ts` - ensure port listener setup happens at right time
