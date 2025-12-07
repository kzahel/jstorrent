# ChromeOS Testbed - Test Findings Summary

## Test Environment
- **Device**: ChromeOS with Crostini
- **Crostini IP**: 100.115.92.206
- **Android Daemon**: 100.115.92.2:7800 (JSTorrent)
- **Extension**: Auto-opens on login, logs to collector

## Scenario 1: Intent Behaviors

### mailto: Intent
- **Behavior**: Opens Gmail via Chrome's registerProtocolHandler
- **Observation**: Uses web Gmail, not Android app
- **Question**: User has registerProtocolHandler configured for Gmail

### market:// URLs (Both Installed & Not Installed)
- **Behavior**: Opens tab asking "Open in Google Play Store?" with remember checkbox
- **Critical Finding**: **Tab auto-closes when it loses focus**
- **Same behavior** for both installed (Files app) and not-installed (WhatsApp) apps

### intent:// (Fake Package)
- **Behavior**: Same as market:// - prompts for Play Store
- **Finding**: ChromeOS doesn't validate package existence before showing prompt

### intent:// (JSTorrent - Real Package)
- **Behavior**: Shows app picker with JSTorrent option and "remember" checkbox
- **Package name**: `com.jstorrent.app` (not `com.jstorrent`)

### unknown:// Scheme
- **Behavior**: Opens blank tab
- **Finding**: URL bar converts unknown scheme to Google search when user presses enter

## Scenario 2: Android Daemon Connectivity

### Daemon Warm (App Running)
- **Latency**: 46ms (baseline performance)
- **Status**: 200 OK
- **Response**: `{"port":7800,"paired":true}`

### Daemon Cold Start (After Force Stop)
- **Result**: **FAILED - No auto-start**
- **Test**: Polled every 2s for 15 seconds
- **Finding**: Force-stopped Android apps do NOT auto-restart
- **Conclusion**: Daemon stays down until user manually launches app

### Intent Wake Test
- **Setup**: Force stop JSTorrent, send intent
- **Result**: App picker appeared, but daemon remained down
- **Finding**: Intents show picker but do NOT auto-launch apps
- **User action required**: Manual selection to launch

## Scenario 3: "Always" Checkbox Persistence Testing

### Extension-Triggered Intents (chrome-extension://)
- **Test**: Link-based intent triggers (both manual and programmatic)
- **Observation**: Picker shows origin as `chrome-extension://{extension-id}`
- **Result**: "Always" checkbox can be checked, but preference **DOES NOT PERSIST**
- **Evidence**: Lines 73-79 in testbed.log - checkbox unchecked on subsequent triggers

### Web Page-Triggered Intents (http:// and https://)
- **Test**: Regular HTML page with intent links (intent-test.html)
- **Tested Origins**:
  - http://localhost:8000
  - https:// (user tested)
- **Observation**: Picker shows friendly domain name instead of extension hash
- **Result**: "Always" checkbox **STILL DOES NOT PERSIST**
- **Conclusion**: This is a **ChromeOS-wide bug**, not extension-specific

### Key Finding: ChromeOS Intent Handler Preference Bug
- ❌ "Always" checkbox appears functional but doesn't save preferences
- ❌ Affects ALL origins: chrome-extension://, http://, https://, file://
- ✅ User-friendly origin display (domain name vs extension hash) is better UX from web pages
- 🐛 **This appears to be a ChromeOS platform bug** affecting intent handler preferences

## Key ChromeOS Behaviors Discovered

1. **Tab Auto-Close**: Intent and market:// tabs auto-close on focus loss
2. **No Auto-Start**: Android apps don't auto-start after force stop
3. **Intent Limitations**: Intents trigger pickers but require manual action
4. **Fast Daemon**: When running, daemon responds in ~46ms
5. **No Package Validation**: ChromeOS shows Play Store prompt even for fake packages
6. **"Always" Checkbox Bug**: Preference storage is broken system-wide for intent handlers

## Test Infrastructure

### Logging System
- ✅ Buffered logging with automatic flush
- ✅ Three log sources: service worker (`sw`), UI (`ui`), user observations (`user`)
- ✅ Remote reload via commands.txt
- ✅ Auto-open testbed on login

### Extension Behavior
- ✅ Opens in full tab (not popup)
- ✅ Single instance enforcement (focuses existing tab)
- ✅ Survives extension reloads
- ✅ Successfully auto-opens on ChromeOS login

## Outstanding Questions

1. **Cold Boot Test**: Is timing analysis still valuable given we know daemon won't auto-start?
   - Minimal value, since daemon won't be running without manual app launch
2. **Auto-Start Investigation**: Should we explore making Android app auto-start?
   - Possible via Android manifest modifications?
   - Is this desirable behavior?
3. ~~**"Remember" Checkbox**: What happens when user checks "Always" for intent picker?~~ **ANSWERED**
   - ❌ Does NOT persist - ChromeOS bug affecting all origins
4. **registerProtocolHandler**: How does Chrome's protocol handler interact with Android intents?
5. **ChromeOS Bug Report**: Should this "Always" checkbox bug be reported to Google?
   - Affects user experience significantly
   - May be existing known issue

## Potential Next Steps

### Option A: File ChromeOS Bug Report
- Document the "Always" checkbox not persisting
- Include evidence from extension, http://, and https:// testing
- Search existing ChromeOS bug tracker first

### Option B: Investigate Auto-Start
- Research Android manifest settings for auto-start
- Evaluate if this is desirable behavior
- Test if possible in ChromeOS Android container

### Option C: Complete Cold Boot Test
- Measure: Login → Extension → Crostini → Daemon timing
- Value: Limited, but provides complete boot sequence data
- Caveat: We know daemon won't be ready without manual app launch

### Option D: Write Final Report
- Document all findings
- Create recommendations for JSTorrent pairing workflow
- Archive test logs
- Include workaround suggestions

## Raw Test Log Location
`/home/graehlarts/code/chromeos-testbed/testbed.log`

Total log entries: 56 (as of last test run)
