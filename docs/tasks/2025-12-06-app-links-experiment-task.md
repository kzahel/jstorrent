# Android App Links Experiment - Agent Guide

## Overview

Test whether Android App Links (verified https:// links) provide better UX than intent:// URLs on ChromeOS. On stock Android, verified App Links bypass the app chooser dialog entirely. We want to confirm whether this works on ChromeOS or if the chooser still appears.

**Hypothesis:** Based on community reports, ChromeOS may still show a chooser even for verified links. We're testing to confirm and to see if the chooser UX differs from intent:// URLs.

## Background

Android App Links use Digital Asset Links to create a verified association between a domain and an app. When properly configured:
- The app declares it handles URLs from a domain (in AndroidManifest.xml)
- The domain hosts an assetlinks.json file confirming the app is authorized
- Android verifies this at app install time
- Verified links open directly in the app without a chooser (on stock Android)

## Prerequisites

- Access to jstorrent.com web hosting (to deploy assetlinks.json)
- Access to the Android app source code (to modify AndroidManifest.xml)
- The app's signing key SHA256 fingerprint
- A ChromeOS device with the Android app installed
- Ability to rebuild and reinstall the Android app

## Phase 1: Get Signing Key Fingerprint

The assetlinks.json file needs the SHA256 fingerprint of the key used to sign the APK.

### 1.1 For debug builds

```bash
# From the android-io-daemon directory (or wherever the keystore is)
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
```

Look for the `SHA256:` line in the output. It will look like:
```
SHA256: B0:4E:29:05:4E:AB:44:C6:9A:CB:D5:89:A3:A8:1C:FF:09:6B:45:00:C5:FD:D1:3E:3E:12:C5:F3:FB:BD:BA:D3
```

### 1.2 For release builds

If using a release keystore:
```bash
keytool -list -v -keystore /path/to/release.keystore -alias your-alias
```

Or if the app is already on Play Store, get the fingerprint from:
Play Console → Your App → Setup → App Integrity → App signing key certificate

### 1.3 From an existing APK

```bash
keytool -printcert -jarfile /path/to/app.apk
```

**Record the SHA256 fingerprint for the next step.**

## Phase 2: Deploy assetlinks.json

### 2.1 Create the file

Create `assetlinks.json` with the following content:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.jstorrent.app",
    "sha256_cert_fingerprints": ["SHA256_FINGERPRINT_HERE"]
  }
}]
```

Replace `SHA256_FINGERPRINT_HERE` with the actual fingerprint from Phase 1 (include the colons, e.g., `B0:4E:29:...`).

**Important:** 
- Use uppercase hex letters
- Keep the colons between bytes
- The fingerprint must match the key that signed the installed APK

### 2.2 Deploy to jstorrent.com

The file must be accessible at:
```
https://jstorrent.com/.well-known/assetlinks.json
```

Requirements:
- Must be served over HTTPS (no redirects from HTTP)
- Must have `Content-Type: application/json`
- Must be publicly accessible (no authentication)

### 2.3 Verify deployment

```bash
# Check the file is accessible
curl -I https://jstorrent.com/.well-known/assetlinks.json

# Check content
curl https://jstorrent.com/.well-known/assetlinks.json

# Use Google's verification tool
curl "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://jstorrent.com&relation=delegate_permission/common.handle_all_urls"
```

The Google API response should show your app's package name and fingerprint with no errors.

## Phase 3: Update Android App

### 3.1 Locate AndroidManifest.xml

Find the main AndroidManifest.xml in the Android app project. Likely location:
```
android-io-daemon/app/src/main/AndroidManifest.xml
```

### 3.2 Add App Links intent filter

Add this intent filter to the main activity (or create a dedicated activity for handling these links):

```xml
<activity android:name=".MainActivity"
    android:exported="true">
    
    <!-- Existing intent filters... -->
    
    <!-- App Links for jstorrent.com -->
    <intent-filter android:autoVerify="true">
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="https" android:host="jstorrent.com" />
    </intent-filter>
    
    <!-- Also handle http in case of redirects -->
    <intent-filter android:autoVerify="true">
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="http" android:host="jstorrent.com" />
    </intent-filter>
    
</activity>
```

**Critical:** 
- `android:autoVerify="true"` is required
- Keep https and http in separate intent-filters (mixing schemes can break verification)
- Don't mix custom schemes (like `jstorrent://`) in the same intent-filter as https

### 3.3 Handle the incoming intent

In the activity that receives the intent, extract any parameters:

```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    
    intent?.data?.let { uri ->
        // Log for debugging
        Log.d("AppLinks", "Received URI: $uri")
        
        // Extract token if present
        val token = uri.getQueryParameter("token")
        if (token != null) {
            // Handle pairing
            Log.d("AppLinks", "Token: $token")
        }
    }
}
```

### 3.4 Build and install

```bash
# Build the APK
./gradlew assembleDebug

# Install on connected device/emulator
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Phase 4: Verify App Links Registration

After installing the updated app, verify that Android has registered the App Links.

### 4.1 Check verification status

```bash
# List all App Links for the package
adb shell pm get-app-links com.jstorrent.app
```

Look for output like:
```
com.jstorrent.app:
    ID: ...
    Signatures: [...]
    User 0:
        Verification link handling allowed: true
        Selection state:
            Enabled:
                jstorrent.com
```

### 4.2 Force re-verification (if needed)

```bash
# Trigger verification
adb shell pm verify-app-links --re-verify com.jstorrent.app

# Wait a few seconds, then check status again
adb shell pm get-app-links com.jstorrent.app
```

### 4.3 Check verification state

```bash
adb shell dumpsys package d | grep -A 5 "jstorrent"
```

Look for verification state: `verified`, `always`, or error states like `legacy_failure`.

## Phase 5: Create Test Page

### 5.1 Create a test page on jstorrent.com

Create a simple HTML page at `https://jstorrent.com/applinks-test.html`:

```html
<!DOCTYPE html>
<html>
<head>
    <title>JSTorrent App Links Test</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: system-ui; padding: 20px; max-width: 600px; margin: 0 auto; }
        a { display: block; padding: 15px; margin: 10px 0; background: #0066cc; color: white; 
            text-decoration: none; border-radius: 8px; text-align: center; }
        a:hover { background: #0055aa; }
        .info { background: #f0f0f0; padding: 15px; border-radius: 8px; margin: 20px 0; }
        code { background: #e0e0e0; padding: 2px 6px; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>App Links Test</h1>
    
    <div class="info">
        <p>Click these links to test App Links behavior on ChromeOS.</p>
        <p>Expected on stock Android: App opens directly (no chooser)</p>
        <p>Question: What happens on ChromeOS?</p>
    </div>
    
    <h2>App Links (https://)</h2>
    <a href="https://jstorrent.com/launch">Basic App Link</a>
    <a href="https://jstorrent.com/launch?token=test123">App Link with token</a>
    <a href="https://jstorrent.com/pair?token=test456">Pairing App Link</a>
    
    <h2>For Comparison: intent:// URL</h2>
    <a href="intent://pair?token=test789#Intent;scheme=jstorrent;package=com.jstorrent.app;end">
        Intent URL (existing method)
    </a>
    
    <div class="info">
        <h3>What to observe:</h3>
        <ul>
            <li>Does a chooser/picker dialog appear?</li>
            <li>If yes, what does it look like? (Screenshot if possible)</li>
            <li>Is there an "Always" or "Remember" checkbox?</li>
            <li>Does the app actually launch?</li>
            <li>Does checking "Always" persist across multiple clicks?</li>
        </ul>
    </div>
</body>
</html>
```

### 5.2 Deploy the test page

Upload to jstorrent.com so it's accessible at:
```
https://jstorrent.com/applinks-test.html
```

## Phase 6: Test on ChromeOS

### 6.1 Preparation

1. Ensure the updated Android app is installed on the ChromeOS device
2. Ensure assetlinks.json is deployed and verified (Phase 2.3)
3. Open Chrome browser on ChromeOS

### 6.2 Run tests

Navigate to `https://jstorrent.com/applinks-test.html` and test each link.

**For each link, record:**

| Link Type | Chooser Appeared? | Chooser Style | "Always" Checkbox? | App Launched? | Notes |
|-----------|-------------------|---------------|-------------------|---------------|-------|
| Basic App Link | | | | | |
| App Link with token | | | | | |
| Pairing App Link | | | | | |
| Intent URL | | | | | |

### 6.3 Test "Always" persistence

If any links show an "Always" checkbox:
1. Check the box and select the app
2. Click the same link again
3. Record: Did it skip the chooser?
4. Close Chrome, reopen, click link again
5. Record: Still skipping chooser?
6. Restart ChromeOS, click link again
7. Record: Still skipping chooser?

### 6.4 Compare to stock Android (optional)

If you have a regular Android phone/tablet available, run the same tests to confirm the expected behavior difference.

## Expected Outcomes

Based on community reports, we expect:

1. **App Links on ChromeOS** will still show a chooser (unlike stock Android)
2. The chooser may look different from the intent:// chooser
3. The "Always" checkbox likely won't persist (known ChromeOS bug)
4. App Links won't provide the auto-launch benefit we hoped for

**However**, we're testing to confirm this and gather specific details about:
- Exact chooser UX differences
- Whether App Links have any advantages over intent://
- Whether the web-based flow (jstorrent.com → app) feels better than extension → app

## Cleanup (Optional)

If App Links don't provide value, you may want to remove them:

1. Remove the intent-filter from AndroidManifest.xml
2. Keep assetlinks.json (harmless, might be useful later)
3. Remove or archive the test page

## Reporting Results

After testing, document:

1. Screenshots of any chooser dialogs
2. The comparison table from Phase 6.2
3. "Always" persistence test results
4. Any unexpected behaviors
5. Recommendation: Keep App Links, remove them, or defer decision

This data will inform whether we should incorporate App Links into the production pairing flow or stick with intent:// URLs.
