# Android Standalone Options

**Status:** Out of scope for initial launch. Notes for future consideration.

---

## The Problem

On pure Android (no ChromeOS), there's no Chrome extension to host the engine. Users would need to use jstorrent.com, but HTTPS sites can't talk to `http://localhost` (mixed content restriction).

---

## Options

### 1. Cloud Relay

jstorrent.com → wss://relay.jstorrent.com → Android app

**Pros:**
- Works with existing website
- No app changes beyond adding relay client

**Cons:**
- Requires relay infrastructure (hosting, maintenance)
- Adds latency to all operations
- Privacy concern: torrent metadata flows through server
- Ongoing operational cost

### 2. Localhost Shell + Remote Assets

Kotlin daemon serves a minimal HTML page at `http://localhost:7800/` that loads the engine from jstorrent.com:

```html
<!DOCTYPE html>
<html>
<head><title>JSTorrent</title></head>
<body>
  <div id="root"></div>
  <script src="https://jstorrent.com/engine.js"></script>
</body>
</html>
```

User opens `http://localhost:7800` in any browser. Mixed content isn't an issue because the page is HTTP — loading HTTPS scripts is fine (it's the reverse that's blocked).

**Pros:**
- Zero bundled assets
- Update UI/engine anytime without Play Store review
- Works in any browser on the device (Chrome, Firefox, etc.)
- Same daemon code for ChromeOS and Android standalone
- Smallest possible APK

**Cons:**
- Foreground only — downloads stop when browser tab closes
- Requires internet to load initial assets (no offline support)
- User has to understand "open this URL" (or app launches it)

**Implementation:** 
- Daemon adds `GET /` route that returns the HTML shell
- App has "Open JSTorrent" button that launches `http://localhost:7800` in default browser
- Or: auto-launch browser on app start

### 3. WebView with Bundled Assets

Android app bundles the JS engine and UI assets. A WebView activity loads them from local files. WebView talks to localhost daemon normally.

**Pros:**
- No mixed content issues (not HTTPS)
- Reuses 100% of existing engine/UI code
- Works offline once installed
- More "app-like" experience

**Cons:**
- Foreground only — downloads stop when app is backgrounded
- Extra APK size (~2-5MB for bundled assets)
- Need to update app to ship new UI versions

**Implementation:** Add a `WebViewActivity` that loads `file:///android_asset/index.html`. Assets built from same packages as extension.

### 4. React Native / Hermes (Full Native)

Run the TypeScript engine in Hermes JS runtime. Full background support via Android services.

**Pros:**
- True background downloads
- Native app experience
- No WebView quirks

**Cons:**
- Significant additional work
- Separate code path to maintain
- React Native / Hermes setup complexity
- Debugging across JS/native boundary

---

## Recommendation

**For initial launch:** Android standalone is out of scope. If someone installs the app on an Android phone (not ChromeOS), show messaging:

> "JSTorrent is designed for ChromeOS. For Android, we recommend [LibreTorrent](https://play.google.com/store/apps/details?id=org.proninyaroslav.libretorrent) or similar apps."

**Future (lowest effort):** Option 2 — Localhost shell + remote assets. Just add one `GET /` route to the daemon. No bundled assets, instant UI updates, works in any browser. App can auto-launch the URL or show an "Open JSTorrent" button.

**Future (offline support):** Option 3 — WebView with bundled assets. More "app-like" but requires app updates for UI changes.

**Future (if demand):** Option 4 — React Native. Only if there's significant user demand for background downloads on Android phones.

---

## Messaging

For the Play Store listing and in-app:

> "JSTorrent is optimized for ChromeOS. On Android phones/tablets, the app runs in experimental mode — downloads only work while the app is open."

This sets expectations without completely blocking Android users.
