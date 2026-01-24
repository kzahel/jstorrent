#!/bin/bash
# Auto-fix formatting and safe lint issues, then run all CI checks
# Usage: ./scripts/check.sh [--no-fix] [--android] [--full]
#
# Options:
#   --no-fix   Skip auto-fixing formatting/lint issues
#   --android  Include Android compile/unit tests/lint
#   --full     Run ALL tests including E2E (requires emulator, starts seeder)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
NO_FIX=false
ANDROID=false
FULL=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --no-fix) NO_FIX=true ;;
        --android) ANDROID=true ;;
        --full) FULL=true; ANDROID=true ;;
    esac
done

# Only use colors if stdout is a terminal
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    NC=''
fi

# Run command quietly, show output on failure
run_quiet() {
    local name="$1"
    local dir="$2"
    shift 2
    local cmd="$*"

    local output
    if output=$(cd "$dir" && eval "$cmd" 2>&1); then
        echo -e "${GREEN}✓${NC} $name"
    else
        echo -e "${RED}✗ $name${NC}"
        echo "  Rerun: cd $dir && $cmd"
        echo ""
        echo "$output"
        exit 1
    fi
}

# Run command quietly, ignore failures (for auto-fix)
run_fix() {
    local name="$1"
    local dir="$2"
    shift 2
    local cmd="$*"

    (cd "$dir" && eval "$cmd") > /dev/null 2>&1 || true
    echo -e "${GREEN}✓${NC} $name"
}

if [ "$NO_FIX" = false ]; then
    echo "Auto-fixing..."
    run_fix "eslint --fix" "$ROOT_DIR" "pnpm lint:fix"
    run_fix "prettier" "$ROOT_DIR" "pnpm format:fix"
    echo ""
fi

echo "Checking TypeScript..."
run_quiet "typecheck" "$ROOT_DIR" "pnpm typecheck"
run_quiet "eslint" "$ROOT_DIR" "pnpm lint"
run_quiet "prettier" "$ROOT_DIR" "pnpm format"
run_quiet "vitest" "$ROOT_DIR" "pnpm test"

echo ""
echo "Checking Python..."
run_quiet "pytest" "$ROOT_DIR" "pnpm test:python"

if [ "$ANDROID" = true ]; then
    echo ""
    echo "Checking Android..."
    run_quiet "kotlin compile" "$ROOT_DIR/android" "./gradlew :app:compileDebugKotlin"
    run_quiet "unit tests" "$ROOT_DIR/android" "./gradlew testDebugUnitTest"
    run_quiet "lint" "$ROOT_DIR/android" "./gradlew lint"
fi

if [ "$FULL" = true ]; then
    echo ""
    echo "Running full E2E tests..."

    # Check for Android device/emulator
    if ! adb devices 2>/dev/null | grep -q "device$"; then
        echo -e "${RED}✗ No Android device/emulator found${NC}"
        echo "  Start an emulator with: source android/scripts/android-env.sh && emu start"
        exit 1
    fi
    echo -e "${GREEN}✓${NC} Android device/emulator detected"

    # Start seeder in background (auto-kills any existing seeder on port 6881)
    SEEDER_PID=""
    cleanup_seeder() {
        if [ -n "$SEEDER_PID" ] && kill -0 "$SEEDER_PID" 2>/dev/null; then
            kill "$SEEDER_PID" 2>/dev/null || true
            wait "$SEEDER_PID" 2>/dev/null || true
        fi
    }
    trap cleanup_seeder EXIT

    echo "Starting seeder..."
    (cd "$ROOT_DIR" && pnpm seed-for-test) &
    SEEDER_PID=$!

    # Wait for seeder to be ready (check port 6881)
    SEEDER_READY=false
    for i in {1..30}; do
        if nc -z 127.0.0.1 6881 2>/dev/null; then
            SEEDER_READY=true
            break
        fi
        sleep 0.5
    done

    if [ "$SEEDER_READY" = false ]; then
        echo -e "${RED}✗ Seeder failed to start on port 6881${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓${NC} Seeder running on port 6881"

    # Extension E2E tests
    echo ""
    echo "Extension E2E tests..."
    run_quiet "playwright e2e" "$ROOT_DIR/extension" "pnpm test:e2e"

    # Android instrumented tests (excludes E2E which needs seeder separately)
    echo ""
    echo "Android instrumented tests..."
    run_quiet "instrumented tests" "$ROOT_DIR/android" \
        "./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.notClass=com.jstorrent.app.e2e.DownloadE2ETest"

    # Android E2E tests (requires seeder)
    echo ""
    echo "Android E2E tests..."
    run_quiet "android e2e" "$ROOT_DIR/android" \
        "./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.e2e.DownloadE2ETest"

    # Seeder will be cleaned up by trap
fi

echo ""
echo -e "${GREEN}All checks passed!${NC}"
