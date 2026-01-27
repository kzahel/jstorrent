#!/usr/bin/env bash
#
# benchmark-tick-emu.sh - Benchmark tick performance on Android emulator (QuickJS)
#
# This script:
#   1. Starts the seeder(s) on the host
#   2. Launches the app on the emulator with a test magnet
#   3. Captures RequestTick logs from logcat
#   4. Parses and reports statistics when download completes
#
# Usage:
#   ./benchmark-tick-emu.sh                    # 100MB test, 1 peer
#   ./benchmark-tick-emu.sh --size 1gb         # 1GB test
#   ./benchmark-tick-emu.sh --peers 5          # 5-peer swarm test
#   ./benchmark-tick-emu.sh --peers 10 --size 1gb  # 10-peer, 1GB
#   ./benchmark-tick-emu.sh --no-build         # Skip build step
#   ./benchmark-tick-emu.sh --quiet            # Machine-parseable output
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MONOREPO_ROOT="$(cd "$PROJECT_DIR/.." && pwd)"

# Parse arguments
SIZE="100mb"
PEERS=1
BASE_PORT=6881
BUILD=true
QUIET=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --size)
            SIZE="$2"
            shift 2
            ;;
        --peers|-n)
            PEERS="$2"
            shift 2
            ;;
        --base-port)
            BASE_PORT="$2"
            shift 2
            ;;
        --no-build)
            BUILD=false
            shift
            ;;
        --quiet|-q)
            QUIET=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--size SIZE] [--peers N] [--no-build] [--quiet]"
            echo ""
            echo "Options:"
            echo "  --size SIZE     Test file size: 100mb or 1gb (default: 100mb)"
            echo "  --peers N       Number of seeders (default: 1)"
            echo "  --base-port P   Starting port for seeders (default: 6881)"
            echo "  --no-build      Skip building the app"
            echo "  --quiet         Machine-parseable output only"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Info hashes and filenames (must match seed_for_test.py)
if [[ "$SIZE" == "1gb" ]]; then
    INFOHASH="18a7aacab6d2bc518e336921ccd4b6cc32a9624b"
    FILENAME="testdata_1gb.bin"
    SIZE_BYTES=$((1024 * 1024 * 1024))
    SIZE_MB=1024
else
    INFOHASH="67d01ece1b99c49c257baada0f760b770a7530b9"
    FILENAME="testdata_100mb.bin"
    SIZE_BYTES=$((100 * 1024 * 1024))
    SIZE_MB=100
fi

# Build magnet link with all peer hints
# Android emulator uses 10.0.2.2 to reach host
build_magnet() {
    local magnet="magnet:?xt=urn:btih:${INFOHASH}&dn=${FILENAME}"
    for ((i=0; i<PEERS; i++)); do
        local port=$((BASE_PORT + i))
        magnet="${magnet}&x.pe=10.0.2.2:${port}"
    done
    echo "$magnet"
}

MAGNET=$(build_magnet)

# Temp file for capturing logs
LOG_FILE=$(mktemp)
TICK_DATA_FILE=$(mktemp)
trap "rm -f $LOG_FILE $TICK_DATA_FILE" EXIT

log() {
    if ! $QUIET; then
        echo "$@"
    fi
}

# Start seeder(s) in background
if [[ $PEERS -eq 1 ]]; then
    log ">>> Starting seeder ($SIZE)..."
    cd "$MONOREPO_ROOT/packages/engine/integration/python"
    uv run python seed_for_test.py --size "$SIZE" --quiet > /dev/null 2>&1 &
    SEEDER_PID=$!
    sleep 3

    # Verify seeder started by checking if port is listening
    if ! lsof -i :${BASE_PORT} >/dev/null 2>&1; then
        echo "ERROR: Seeder failed to start (port ${BASE_PORT} not listening)" >&2
        exit 1
    fi
    log "    Seeder started (PID $SEEDER_PID)"
else
    log ">>> Starting swarm seeder ($SIZE, $PEERS peers)..."
    cd "$MONOREPO_ROOT/packages/engine/integration/python"
    uv run python seed_for_test_swarm.py --size "$SIZE" --count "$PEERS" --port "$BASE_PORT" --kill --quiet > /dev/null 2>&1 &
    SEEDER_PID=$!
    sleep 4

    # Verify at least the first port is listening
    if ! lsof -i :${BASE_PORT} >/dev/null 2>&1; then
        echo "ERROR: Swarm seeder failed to start (port ${BASE_PORT} not listening)" >&2
        exit 1
    fi
    log "    Swarm seeder started with $PEERS peers on ports ${BASE_PORT}-$((BASE_PORT + PEERS - 1))"
fi

cleanup() {
    log ">>> Cleaning up..."
    kill $SEEDER_PID 2>/dev/null || true
    # Also kill any remaining seeders that might be children
    pkill -f "seed_for_test" 2>/dev/null || true
    rm -f $LOG_FILE $TICK_DATA_FILE
}
trap cleanup EXIT

# Launch app on emulator with custom magnet
log ">>> Launching app on emulator..."
if $BUILD; then
    "$SCRIPT_DIR/emu-test-native.sh" --null "$MAGNET"
else
    "$SCRIPT_DIR/emu-test-native.sh" --null --no-build "$MAGNET"
fi

# Get emulator serial
EMU_SERIAL=$(adb devices 2>/dev/null | grep -o 'emulator-[0-9]*' | head -1)
if [[ -z "$EMU_SERIAL" ]]; then
    echo "ERROR: No emulator found" >&2
    exit 1
fi

log ">>> Monitoring logcat for tick stats (Ctrl+C to stop early)..."
log ""

# Clear logcat buffer and start capturing
adb -s "$EMU_SERIAL" logcat -c

# Monitor logcat in background, filtering for our app
adb -s "$EMU_SERIAL" logcat -v time JSTorrent-JS:V *:S 2>/dev/null > "$LOG_FILE" &
LOGCAT_PID=$!

# Also show progress to user if not quiet
if ! $QUIET; then
    tail -f "$LOG_FILE" 2>/dev/null | grep --line-buffered -E "(RequestTick:|Download complete|progress)" &
    TAIL_PID=$!
fi

# Wait for download to complete (look for "Download complete!" in logs)
TIMEOUT=600
START_TIME=$(date +%s)
COMPLETE=false

while true; do
    ELAPSED=$(($(date +%s) - START_TIME))
    if [[ $ELAPSED -gt $TIMEOUT ]]; then
        log ""
        log ">>> Timeout after ${TIMEOUT}s"
        break
    fi

    if grep -q "Download complete!" "$LOG_FILE" 2>/dev/null; then
        COMPLETE=true
        sleep 2  # Give a moment for final logs
        break
    fi

    sleep 1
done

# Stop logcat capture
kill $LOGCAT_PID 2>/dev/null || true
if ! $QUIET; then
    kill $TAIL_PID 2>/dev/null || true
fi

log ""
log ">>> Parsing tick statistics..."

# Extract RequestTick lines and parse them
# Format: "RequestTick: 50 ticks, avg 2.3ms, max 15ms, 4 active pieces, 1 peers/tick"
grep "RequestTick:" "$LOG_FILE" | while read -r line; do
    # Extract values using sed
    TICKS=$(echo "$line" | sed -n 's/.*RequestTick: \([0-9]*\) ticks.*/\1/p')
    AVG=$(echo "$line" | sed -n 's/.*avg \([0-9.]*\)ms.*/\1/p')
    MAX=$(echo "$line" | sed -n 's/.*max \([0-9]*\)ms.*/\1/p')

    if [[ -n "$TICKS" && -n "$AVG" && -n "$MAX" ]]; then
        echo "$TICKS $AVG $MAX" >> "$TICK_DATA_FILE"
    fi
done

# Calculate statistics
if [[ ! -s "$TICK_DATA_FILE" ]]; then
    echo "ERROR: No tick data captured" >&2
    exit 1
fi

# Use awk to calculate stats
STATS=$(awk '
BEGIN {
    total_ticks = 0
    total_weighted_avg = 0
    max_tick = 0
    samples = 0
}
{
    ticks = $1
    avg = $2
    max = $3

    total_ticks += ticks
    total_weighted_avg += (avg * ticks)
    if (max > max_tick) max_tick = max
    samples++
}
END {
    if (total_ticks > 0) {
        overall_avg = total_weighted_avg / total_ticks
    } else {
        overall_avg = 0
    }
    printf "TOTAL_TICKS=%d\n", total_ticks
    printf "SAMPLES=%d\n", samples
    printf "AVG_TICK_MS=%.2f\n", overall_avg
    printf "MAX_TICK_MS=%d\n", max_tick
}
' "$TICK_DATA_FILE")

eval "$STATS"

# Calculate download time
DOWNLOAD_TIME=$(($(date +%s) - START_TIME))

if $QUIET; then
    echo "ENGINE=quickjs"
    echo "SIZE=$SIZE"
    echo "NUM_PEERS=$PEERS"
    echo "$STATS"
    echo "DOWNLOAD_TIME_SEC=$DOWNLOAD_TIME"
    echo "COMPLETE=$COMPLETE"
else
    SPEED=$(echo "scale=1; $SIZE_MB / $DOWNLOAD_TIME" | bc 2>/dev/null || echo "N/A")

    PEERS_STR=""
    if [[ $PEERS -gt 1 ]]; then
        PEERS_STR=", $PEERS peers"
    fi

    echo ""
    echo "============================================================"
    echo "TICK BENCHMARK RESULTS (QuickJS on Android Emulator${PEERS_STR})"
    echo "============================================================"
    echo "Download size:     $SIZE_MB MB"
    if [[ $PEERS -gt 1 ]]; then
        echo "Seeders:           $PEERS"
    fi
    echo "Download time:     ${DOWNLOAD_TIME}s"
    echo "Download speed:    ${SPEED} MB/s"
    echo ""
    echo "Tick Performance (100ms interval):"
    echo "  Sample windows:  $SAMPLES (5s each)"
    echo "  Total ticks:     $TOTAL_TICKS"
    echo "  Average:         ${AVG_TICK_MS} ms"
    echo "  Maximum:         ${MAX_TICK_MS} ms"
    echo ""

    # Analysis
    if (( $(echo "$AVG_TICK_MS > 50" | bc -l) )); then
        echo "WARNING: Average tick time exceeds 50ms - performance issues likely"
    elif (( $(echo "$AVG_TICK_MS > 20" | bc -l) )); then
        echo "NOTE: Average tick time is elevated (>20ms)"
    else
        echo "OK: Tick performance is good (<20ms average)"
    fi

    if [[ $MAX_TICK_MS -gt 100 ]]; then
        echo "WARNING: Max tick (${MAX_TICK_MS}ms) exceeds tick interval (100ms)"
    fi

    if ! $COMPLETE; then
        echo ""
        echo "NOTE: Download did not complete (timed out or interrupted)"
    fi

    echo "============================================================"
fi
