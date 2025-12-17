#!/usr/bin/env python3
"""
Simple test runner - runs each test_*.py as standalone script.

Usage:
    python run_tests.py                  # All tests
    python run_tests.py test_resume.py   # Specific test
    python run_tests.py -k resume        # Pattern match
    python run_tests.py -q               # Quiet mode (suppress test stdout)
"""
import subprocess
import sys
import time
from pathlib import Path

# Tests should complete quickly. If not, they're broken.
# More time won't help ya buddy.
TIMEOUT = 15

# Per-test timeout overrides
TEST_TIMEOUTS = {
    "test_seeding.py": 45,  # Seeding needs more time for handshake/negotiation
    "test_connection_limits.py": 45,  # Two 15s verification loops
}

# =============================================================================
# Skip List - tests to skip (with reasons)
# =============================================================================
SKIP_TESTS = {
}
# =============================================================================


def run_test(path: Path, quiet: bool = False) -> tuple:
    """Run test, return (passed: bool, elapsed: float)."""
    timeout = TEST_TIMEOUTS.get(path.name, TIMEOUT)
    print(f"\n{'='*60}")
    print(f"Running: {path.name}")
    print('='*60 + ("" if quiet else "\n"))

    start = time.time()
    try:
        if quiet:
            result = subprocess.run(
                [sys.executable, str(path)],
                timeout=timeout,
                capture_output=True
            )
        else:
            result = subprocess.run([sys.executable, str(path)], timeout=timeout)
        elapsed = time.time() - start
        return (result.returncode == 0, elapsed)
    except subprocess.TimeoutExpired:
        print(f"\n✗ TIMEOUT after {timeout}s - test is broken, not slow")
        return (False, timeout)


def main():
    test_dir = Path(__file__).parent

    # Parse args
    pattern = None
    specific = []
    quiet = False
    args = sys.argv[1:]

    i = 0
    while i < len(args):
        if args[i] == "-k" and i + 1 < len(args):
            pattern = args[i + 1]
            i += 2
        elif args[i].startswith("-k"):
            pattern = args[i][2:]
            i += 1
        elif args[i] in ("-q", "--quiet"):
            quiet = True
            i += 1
        elif args[i].endswith(".py"):
            specific.append(test_dir / args[i])
            i += 1
        else:
            i += 1

    # Find tests
    if specific:
        tests = specific
    else:
        tests = sorted(test_dir.glob("test_*.py"))
        tests = [t for t in tests if t.name != "test_helpers.py"]
        if pattern:
            tests = [t for t in tests if pattern in t.name]

    if not tests:
        print("No tests found")
        return 1

    # Run
    results = []
    skipped = []
    for test in tests:
        if test.name in SKIP_TESTS:
            reason = SKIP_TESTS[test.name]
            print(f"\n{'='*60}")
            print(f"SKIPPED: {test.name}")
            print(f"  Reason: {reason}")
            print('='*60)
            skipped.append((test.name, reason))
            continue
        ok, elapsed = run_test(test, quiet=quiet)
        results.append((test.name, ok, elapsed))

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print('='*60)

    for name, ok, elapsed in results:
        print(f"  {'✓' if ok else '✗'} {name} ({elapsed:.1f}s)")
    for name, reason in skipped:
        print(f"  ⊘ {name} (skipped: {reason})")

    failed = [r for r in results if not r[1]]
    print()
    if failed:
        print(f"FAILED: {len(failed)}/{len(results)}, SKIPPED: {len(skipped)}")
        return 1
    print(f"PASSED: {len(results)}/{len(results)}, SKIPPED: {len(skipped)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
