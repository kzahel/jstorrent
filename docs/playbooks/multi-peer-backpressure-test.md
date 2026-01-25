# Multi-Peer Backpressure Test Playbook

Test QuickJS download performance with a realistic swarm (1 fast peer + 9 slow peers) and real file persistence via SAF.

## Quick Reference (after one-time setup)

```bash
# Terminal 1: Start swarm
pnpm seed-for-test-swarm --size 1gb --upload-limits 0,50,50,50,50,50,50,50,50,50 --kill

# Terminal 2: Run test
source android/scripts/android-env.sh
adb shell am force-stop com.jstorrent.app
emu test-native --no-build "magnet:?xt=urn:btih:18a7aacab6d2bc518e336921ccd4b6cc32a9624b&dn=testdata_1gb.bin&x.pe=10.0.2.2:6881&x.pe=10.0.2.2:6882&x.pe=10.0.2.2:6883&x.pe=10.0.2.2:6884&x.pe=10.0.2.2:6885&x.pe=10.0.2.2:6886&x.pe=10.0.2.2:6887&x.pe=10.0.2.2:6888&x.pe=10.0.2.2:6889&x.pe=10.0.2.2:6890"

# Terminal 3: Monitor logs (use -d for dump, not streaming)
adb logcat -d --pid=$(adb shell pidof com.jstorrent.app) | grep -iE "(TcpBindings.*MB/s|FileBindings|Backpressure:|queue depth:.*max)"
```

## One-Time Setup

### 1. Start emulator and set up SAF folder

```bash
source android/scripts/android-env.sh
emu start
emu install   # Build and install debug APK
```

Launch the app and pick a download folder:
```bash
adb shell am start -n com.jstorrent.app/.NativeStandaloneActivity
```

In the app UI:
1. Tap "Choose Download Folder"
2. Navigate to a folder (e.g., Downloads/JSTorrent)
3. Tap "Use this folder" → "Allow"

This SAF permission persists across app restarts. **Don't use `pm clear` or `--clear` in subsequent runs.**

## Test Execution

### Terminal 1: Start swarm seeder

```bash
# 1 fast peer (unlimited) + 9 slow peers (50 KB/s each)
pnpm seed-for-test-swarm --size 1gb --upload-limits 0,50,50,50,50,50,50,50,50,50 --kill
```

Wait for "Press Ctrl+C to stop all seeders" message.

### Terminal 2: Start the download

```bash
source android/scripts/android-env.sh

# Force stop app, rebuild if needed, launch with swarm magnet
adb shell am force-stop com.jstorrent.app
emu test-native --no-build "magnet:?xt=urn:btih:18a7aacab6d2bc518e336921ccd4b6cc32a9624b&dn=testdata_1gb.bin&x.pe=10.0.2.2:6881&x.pe=10.0.2.2:6882&x.pe=10.0.2.2:6883&x.pe=10.0.2.2:6884&x.pe=10.0.2.2:6885&x.pe=10.0.2.2:6886&x.pe=10.0.2.2:6887&x.pe=10.0.2.2:6888&x.pe=10.0.2.2:6889&x.pe=10.0.2.2:6890"
```

Note: Use `--no-build` after first run to skip rebuilding (saves time).

### Terminal 3: Monitor backpressure logs

**Important:** Use `-d` (dump mode) instead of streaming, as PID-filtered streaming can miss logs.

```bash
# Dump recent logs (run periodically during test)
adb logcat -d --pid=$(adb shell pidof com.jstorrent.app) | grep -iE "(TcpBindings.*MB/s|FileBindings|Backpressure:|queue depth:.*max)"

# Or watch all backpressure warnings
adb logcat -d --pid=$(adb shell pidof com.jstorrent.app) | grep "BACKPRESSURE" | tail -20
```

## Quick Repeat Test

After one-time setup, repeat tests with:

```bash
# Terminal 1 (if seeder not running)
pnpm seed-for-test-swarm --size 1gb --upload-limits 0,50,50,50,50,50,50,50,50,50 --kill

# Terminal 2
adb shell am force-stop com.jstorrent.app
# Remove the previous download to start fresh
adb shell rm -rf /storage/emulated/0/Download/JSTorrent/testdata_1gb.bin 2>/dev/null || true
emu test-native --no-build "magnet:?xt=urn:btih:18a7aacab6d2bc518e336921ccd4b6cc32a9624b&dn=testdata_1gb.bin&x.pe=10.0.2.2:6881&x.pe=10.0.2.2:6882&x.pe=10.0.2.2:6883&x.pe=10.0.2.2:6884&x.pe=10.0.2.2:6885&x.pe=10.0.2.2:6886&x.pe=10.0.2.2:6887&x.pe=10.0.2.2:6888&x.pe=10.0.2.2:6889&x.pe=10.0.2.2:6890"

# Terminal 3
adb logcat --pid=$(adb shell pidof com.jstorrent.app) | grep -iE "(TcpBindings|FileBindings|Backpressure:|Dropping)"
```

## Upload Limit Configurations

| Scenario | `--upload-limits` | Description |
|----------|-------------------|-------------|
| 1 fast + 9 slow | `0,50,50,50,50,50,50,50,50,50` | Default: one unlimited, nine at 50 KB/s |
| 1 fast + 9 very slow | `0,10,10,10,10,10,10,10,10,10` | More pronounced speed difference |
| Graduated speeds | `0,10,25,50,100,200,500,1000,2000,5000` | Varied speeds |
| All unlimited | (no flag) | Baseline: network limited |

## Interpreting Results

### Healthy (no backpressure)
```
TcpBindings: TCP recv: 15.0 MB/s (raw), queue depth: 5 (max: 20)
FileBindings: Disk write: 14.8 MB/s, 150 writes, avg 8ms, max 25ms
```

### Backpressure problem (verified 2025-01-25)
```
TcpBindings: TCP recv: 12.48 MB/s (raw), queue depth: 2496 (max: 2496)   ← CRITICAL
TcpBindings: JS callback queue depth: 1192 (BACKPRESSURE)                ← WARNING
FileBindings: Disk write: 5.73 MB/s, 31 writes, avg 14ms, max 24ms       ← THROTTLED
```

### Known issue: Download stalls temporarily

With 10 concurrent peers, the download can stall for minutes:
- Queue depth spikes to 10,000+ items (observed peak: 12,995)
- Disk write rate drops from ~15 MB/s to <1 MB/s during stall
- TCP recv continues at ~13 MB/s, overwhelming the JS callback queue
- **Eventually resumes** after queue drains (~2 min stall observed)
- Completes successfully, but with significant delay

Typical progression observed (2025-01-25):
| Time | Queue Depth | Max Queue | TCP Recv | Disk Write |
|------|-------------|-----------|----------|------------|
| +0s | 0 | 187 | 14.82 MB/s | 14.74 MB/s |
| +15s | 50 | 181 | 13.52 MB/s | 13.48 MB/s |
| +30s | 211 | 560 | 12.58 MB/s | 12.48 MB/s |
| +35s | 1289 | 1402 | 11.84 MB/s | 9.89 MB/s |
| +40s | 2496 | 2496 | 12.48 MB/s | 5.73 MB/s |
| +45s | 6418 | 6418 | 12.92 MB/s | 1.78 MB/s |
| +50s | 12989 | 12995 | 13.61 MB/s | 0.46 MB/s |
| +120s | 0 | 143 | 14.61 MB/s | 14.51 MB/s |

This is the backpressure problem - JS can't process incoming data fast enough.

### Key metrics

| Metric | Healthy | Problem | Critical |
|--------|---------|---------|----------|
| TCP queue depth | 0-30 | 50-500 | >1000 |
| Max queue depth | <200 | 500-2000 | >5000 |
| Disk write rate | >10 MB/s | 5-10 MB/s | <1 MB/s |
| Disk avg latency | <15ms | 15-30ms | >50ms |
| Download stall | No | Slows | Complete stop |

## After Code Changes

When testing code changes to fix backpressure:

```bash
# Rebuild engine bundle and APK
pnpm --filter @jstorrent/engine bundle:native
cd android && ./gradlew :app:assembleDebug && cd ..

# Reinstall (keeps SAF permission)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# Run test
adb shell am force-stop com.jstorrent.app
emu test-native --no-build "magnet:?xt=urn:btih:18a7aacab6d2bc518e336921ccd4b6cc32a9624b&dn=testdata_1gb.bin&x.pe=10.0.2.2:6881&x.pe=10.0.2.2:6882&x.pe=10.0.2.2:6883&x.pe=10.0.2.2:6884&x.pe=10.0.2.2:6885&x.pe=10.0.2.2:6886&x.pe=10.0.2.2:6887&x.pe=10.0.2.2:6888&x.pe=10.0.2.2:6889&x.pe=10.0.2.2:6890"
```

## Cleanup

```bash
# Stop seeders
pkill -f seed_for_test_swarm

# Remove test file from device
adb shell rm -rf /storage/emulated/0/Download/JSTorrent/testdata_1gb.bin

# Stop emulator (optional)
emu stop
```

## Troubleshooting

**"SetupRequiredScreen appears"**
- SAF folder wasn't set up or was cleared
- Re-run one-time setup steps

**"Seeder shows 0 peers"**
- App may have crashed or not started
- Check: `adb logcat | grep -i "crash\|fatal\|jstorrent"`
- Restart app: `adb shell am start -n com.jstorrent.app/.NativeStandaloneActivity`

**"Queue depth always 0"**
- Instrumentation may be disabled
- Verify using debug build (not `--release`)

**"Torrent shows as complete immediately"**
- Previous download data still exists
- Delete: `adb shell rm -rf /storage/emulated/0/Download/JSTorrent/testdata_1gb.bin`

## Related Files

- Swarm seeder: `packages/engine/integration/python/seed_for_test_swarm.py`
- Test script: `android/scripts/emu-test-native.sh`
- Performance docs: `docs/quickjs-performance.md`
- TCP instrumentation: `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/bindings/TcpBindings.kt`
- Download optimizer: `packages/engine/src/core/peer-coordinator/download-optimizer.ts`
