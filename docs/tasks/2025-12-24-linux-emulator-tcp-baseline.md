# Linux Emulator TCP Baseline Test

**Goal:** Measure raw TCP throughput from Android emulator to host on Linux, for comparison with Mac (32 MB/s measured).

---

## Prerequisites

- Android emulator running with an AVD
- `iperf3` installed on Linux host (`sudo apt install iperf3`)
- `adb` connected to emulator

## Step 1: Verify Emulator Architecture

```bash
adb shell getprop ro.product.cpu.abi
# Expected: x86_64 or arm64-v8a
```

Record the result - this tells us if emulator is native or translated.

## Step 2: Check Host Architecture

```bash
uname -m
# Expected: x86_64 or aarch64
```

## Step 3: Verify Emulator Connectivity

```bash
adb shell ping -c 3 10.0.2.2
# Should show ~1ms latency
```

## Step 4: Run iperf3 Server on Host

```bash
# Terminal 1: Start iperf3 server
iperf3 -s -p 5201
```

Leave this running.

## Step 5: Run iperf3 Client from Emulator

```bash
# Terminal 2: Run download test (server sends to client)
adb shell iperf3 -c 10.0.2.2 -p 5201 -R -t 10
```

The `-R` flag means "reverse" - server sends data to client (simulates downloading).

## Step 6: Record Results

Look for the final summary line, e.g.:
```
[  5]   0.00-10.00  sec   309 MBytes   259 Mbits/sec   receiver
```

Convert: `Mbits/sec ÷ 8 = MB/s`

Example: 259 Mbits/sec = **32.4 MB/s**

## Step 7: Check Emulator Config (Optional)

```bash
cat ~/.android/avd/*.avd/config.ini | grep -E "hw.cpu|hw.ram|image"
```

---

## Results Template

Fill in and report back:

| Metric | Value |
|--------|-------|
| Host arch | |
| Emulator CPU ABI | |
| Emulator RAM | |
| Ping latency | |
| iperf3 throughput (Mbits/sec) | |
| iperf3 throughput (MB/s) | |

---

## Mac Baseline (for comparison)

| Metric | Value |
|--------|-------|
| Host arch | arm64 (M4) |
| Emulator CPU ABI | arm64-v8a |
| Emulator RAM | 2048 MB |
| Ping latency | ~1ms |
| iperf3 throughput | 259 Mbits/sec = **32.4 MB/s** |
