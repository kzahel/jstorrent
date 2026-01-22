#!/bin/bash
# Auto-fix formatting and safe lint issues, then run all CI checks
# Usage: ./scripts/check.sh [--no-fix] [--android]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
NO_FIX=false
ANDROID=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --no-fix) NO_FIX=true ;;
        --android) ANDROID=true ;;
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

echo ""
echo -e "${GREEN}All checks passed!${NC}"
