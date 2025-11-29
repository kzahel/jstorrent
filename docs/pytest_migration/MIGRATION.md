# Python Test Migration Plan

## Goal

Migrate from pytest to standalone Python scripts with:
- Context managers for automatic cleanup
- Explicit, readable code
- No magic, no fixtures
- Each test runnable directly: `python test_foo.py`

---

## Core Helpers

### test_helpers.py

```python
#!/usr/bin/env python3
"""
Shared test utilities with context managers for clean resource management.
"""
import sys
import os
import time
import hashlib
import tempfile
from contextlib import contextmanager

from jst import JSTEngine
from libtorrent_utils import LibtorrentSession


# =============================================================================
# Context Managers
# =============================================================================

@contextmanager
def temp_directory(prefix: str = "jst_test_"):
    """Temporary directory that auto-cleans on exit."""
    import shutil
    path = tempfile.mkdtemp(prefix=prefix)
    print(f"Created temp dir: {path}")
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)
        print(f"Cleaned up: {path}")


@contextmanager
def test_engine(download_dir: str, **kwargs):
    """JSTEngine that auto-closes on exit."""
    engine = JSTEngine(download_dir=download_dir, **kwargs)
    print(f"Engine started on port {engine.rpc_port}")
    try:
        yield engine
    finally:
        engine.close()
        print("Engine closed")


@contextmanager
def libtorrent_seeder(directory: str, port: int = 0):
    """Libtorrent session for seeding test files."""
    session = LibtorrentSession(directory, port=port)
    actual_port = session.listen_port()
    print(f"Libtorrent seeder on port {actual_port}")
    try:
        yield session
    finally:
        pass  # LibtorrentSession cleans up on GC


@contextmanager
def test_dirs():
    """Create seeder/leecher directory structure in temp dir."""
    with temp_directory() as base:
        seeder = os.path.join(base, "seeder")
        leecher = os.path.join(base, "leecher")
        os.makedirs(seeder)
        os.makedirs(leecher)
        yield seeder, leecher


# =============================================================================
# Assertions
# =============================================================================

def fail(message: str) -> int:
    """Print failure and return exit code 1."""
    print(f"\n✗ FAIL: {message}", file=sys.stderr)
    return 1


def passed(message: str = "Test passed") -> int:
    """Print success and return exit code 0."""
    print(f"\n✓ PASS: {message}")
    return 0


def assert_true(condition: bool, message: str = "Assertion failed"):
    """Assert condition is true."""
    if not condition:
        raise AssertionError(message)


def assert_eq(actual, expected, message: str = ""):
    """Assert equality with clear diff on failure."""
    if actual != expected:
        msg = message or "Values not equal"
        raise AssertionError(f"{msg}\n  Expected: {expected}\n  Actual:   {actual}")


# =============================================================================
# Wait Helpers
# =============================================================================

def wait_for(
    condition,
    timeout: float = 10.0,
    interval: float = 0.5,
    description: str = "condition"
) -> bool:
    """Wait for condition() to return truthy. Returns True if met, False if timeout."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            if condition():
                return True
        except Exception:
            pass
        time.sleep(interval)
    print(f"  Timeout waiting for {description}")
    return False


def wait_for_seeding(lt_handle, timeout: float = 5.0) -> bool:
    """Wait for libtorrent to enter seeding state."""
    return wait_for(
        lambda: lt_handle.status().is_seeding,
        timeout=timeout,
        interval=0.1,
        description="seeding"
    )


def wait_for_progress(engine, tid: str, target: float, timeout: float = 30.0) -> bool:
    """Wait for download progress to reach target (0.0 - 1.0)."""
    def check():
        status = engine.get_torrent_status(tid)
        progress = status.get("progress", 0)
        print(f"  Progress: {progress * 100:.1f}%")
        return progress >= target
    return wait_for(check, timeout=timeout, description=f"{target*100:.0f}% progress")


def wait_for_complete(engine, tid: str, timeout: float = 30.0) -> bool:
    """Wait for download to complete (100%)."""
    return wait_for_progress(engine, tid, 1.0, timeout=timeout)


# =============================================================================
# File Utilities
# =============================================================================

def sha1_file(path: str) -> str:
    """Calculate SHA1 hash of file."""
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def file_size(path: str) -> int:
    """Get file size, 0 if doesn't exist."""
    try:
        return os.path.getsize(path)
    except OSError:
        return 0
```

---

## Example Migrations

### test_handshake.py

```python
#!/usr/bin/env python3
"""Test BitTorrent handshake between JSTEngine and libtorrent."""
import sys
from test_helpers import (
    test_dirs, test_engine, libtorrent_seeder,
    wait_for_seeding, wait_for, fail, passed
)


def main() -> int:
    with test_dirs() as (seeder_dir, leecher_dir):
        with libtorrent_seeder(seeder_dir) as lt:
            torrent_path, _ = lt.create_dummy_torrent("test.bin", size=1024*1024)
            lt_handle = lt.add_torrent(torrent_path, seeder_dir, seed_mode=True)
            
            if not wait_for_seeding(lt_handle):
                return fail("Libtorrent didn't seed")
            
            port = lt.listen_port()
            
            with test_engine(leecher_dir) as engine:
                tid = engine.add_torrent_file(torrent_path)
                engine.add_peer(tid, "127.0.0.1", port)
                
                def both_connected():
                    engine_peers = engine.get_torrent_status(tid).get("peers", 0)
                    lt_peers = lt_handle.status().num_peers
                    print(f"  Engine: {engine_peers}, LT: {lt_peers}")
                    return engine_peers > 0 and lt_peers > 0
                
                if not wait_for(both_connected, timeout=10, description="connection"):
                    return fail("Handshake failed")
    
    return passed("Handshake successful")


if __name__ == "__main__":
    sys.exit(main())
```

### test_download.py

```python
#!/usr/bin/env python3
"""Test download with various piece sizes."""
import sys
from test_helpers import (
    test_dirs, test_engine, libtorrent_seeder,
    wait_for_seeding, wait_for_complete,
    fail, passed, sha1_file
)


def run_download_test(piece_length: int) -> bool:
    """Run download test with specific piece length."""
    print(f"\n{'='*50}")
    print(f"Testing piece_length = {piece_length}")
    print('='*50)
    
    with test_dirs() as (seeder_dir, leecher_dir):
        with libtorrent_seeder(seeder_dir) as lt:
            torrent_path, _ = lt.create_dummy_torrent(
                "test.bin", size=512*1024, piece_length=piece_length
            )
            lt_handle = lt.add_torrent(torrent_path, seeder_dir, seed_mode=True)
            
            if not wait_for_seeding(lt_handle):
                print("FAIL: Libtorrent didn't seed")
                return False
            
            expected = sha1_file(f"{seeder_dir}/test.bin")
            port = lt.listen_port()
            
            with test_engine(leecher_dir) as engine:
                tid = engine.add_torrent_file(torrent_path)
                engine.add_peer(tid, "127.0.0.1", port)
                
                if not wait_for_complete(engine, tid, timeout=15):
                    print("FAIL: Download incomplete")
                    return False
                
                actual = sha1_file(f"{leecher_dir}/test.bin")
                if actual != expected:
                    print(f"FAIL: Hash mismatch")
                    return False
    
    print(f"OK: piece_length={piece_length}")
    return True


def main() -> int:
    piece_lengths = [16384, 32768, 65536]
    
    if len(sys.argv) > 1:
        piece_lengths = [int(sys.argv[1])]
    
    for pl in piece_lengths:
        if not run_download_test(pl):
            return fail(f"Failed with piece_length={pl}")
    
    return passed(f"All piece lengths passed: {piece_lengths}")


if __name__ == "__main__":
    sys.exit(main())
```

### test_resume.py

```python
#!/usr/bin/env python3
"""Test session resume after engine restart."""
import sys
import time
from test_helpers import (
    test_dirs, test_engine, libtorrent_seeder,
    wait_for_seeding, wait_for_progress, wait_for_complete,
    fail, passed, sha1_file
)


def main() -> int:
    with test_dirs() as (seeder_dir, leecher_dir):
        with libtorrent_seeder(seeder_dir) as lt:
            torrent_path, _ = lt.create_dummy_torrent(
                "resume_test.bin", size=10*1024*1024, piece_length=16384
            )
            lt_handle = lt.add_torrent(torrent_path, seeder_dir, seed_mode=True)
            
            if not wait_for_seeding(lt_handle):
                return fail("Libtorrent didn't seed")
            
            expected_hash = sha1_file(f"{seeder_dir}/resume_test.bin")
            port = lt.listen_port()
            
            # Run 1: Download partially
            print("\n--- Run 1: Partial download ---")
            with test_engine(leecher_dir) as engine:
                tid = engine.add_torrent_file(torrent_path)
                engine.add_peer(tid, "127.0.0.1", port)
                
                if not wait_for_progress(engine, tid, 0.1, timeout=30):
                    return fail("Didn't reach 10%")
                
                time.sleep(1)  # Let persistence flush
                print("Stopping engine...")
            
            # Run 2: Resume and complete
            print("\n--- Run 2: Resume ---")
            with test_engine(leecher_dir) as engine:
                tid = engine.add_torrent_file(torrent_path)
                engine.add_peer(tid, "127.0.0.1", port)
                
                if not wait_for_complete(engine, tid, timeout=30):
                    return fail("Didn't complete after resume")
                
                actual = sha1_file(f"{leecher_dir}/resume_test.bin")
                if actual != expected_hash:
                    return fail(f"Hash mismatch")
    
    return passed("Resume test completed")


if __name__ == "__main__":
    sys.exit(main())
```

---

## run_tests.py

```python
#!/usr/bin/env python3
"""
Simple test runner.

Usage:
    python run_tests.py                  # All tests
    python run_tests.py test_resume.py   # Specific test
    python run_tests.py -k resume        # Pattern match
"""
import subprocess
import sys
import time
from pathlib import Path

TIMEOUT = 30  # If not done in 30s, it's broken


def run_test(path: Path) -> tuple[bool, float]:
    print(f"\n{'='*60}")
    print(f"Running: {path.name}")
    print('='*60 + "\n")
    
    start = time.time()
    try:
        result = subprocess.run([sys.executable, str(path)], timeout=TIMEOUT)
        elapsed = time.time() - start
        return (result.returncode == 0, elapsed)
    except subprocess.TimeoutExpired:
        print(f"\n✗ TIMEOUT - test is broken, not slow")
        return (False, TIMEOUT)


def main():
    test_dir = Path(__file__).parent
    
    # Parse args
    pattern = None
    specific = []
    args = sys.argv[1:]
    
    i = 0
    while i < len(args):
        if args[i] == "-k" and i + 1 < len(args):
            pattern = args[i + 1]
            i += 2
        elif args[i].startswith("-k"):
            pattern = args[i][2:]
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
    for test in tests:
        ok, elapsed = run_test(test)
        results.append((test.name, ok, elapsed))
    
    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print('='*60)
    
    for name, ok, elapsed in results:
        print(f"  {'✓' if ok else '✗'} {name} ({elapsed:.1f}s)")
    
    failed = [r for r in results if not r[1]]
    print()
    if failed:
        print(f"FAILED: {len(failed)}/{len(results)}")
        return 1
    print(f"PASSED: {len(results)}/{len(results)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

---

## Migration Checklist

### Create
- [ ] `test_helpers.py` - Context managers and utilities

### Migrate
- [ ] `test_handshake.py`
- [ ] `test_download.py`
- [ ] `test_resume.py`
- [ ] `test_seeding.py`
- [ ] `test_multi_peer.py`
- [ ] `test_multi_file.py`
- [ ] `test_large_download.py`
- [ ] `test_recheck.py`
- [ ] `test_connection_limits.py`
- [ ] `test_download_with_tracker.py`

### Update
- [ ] `run_tests.py`
- [ ] `requirements.txt` (remove pytest)

### Delete
- [ ] `conftest.py`

### Keep
- `jst/` - Engine wrapper
- `libtorrent_utils.py`
- Verification scripts

---

## After Migration

```bash
# Run all
python run_tests.py

# Run one
python test_download.py

# Run with param
python test_download.py 32768

# Run matching pattern
python run_tests.py -k resume
```
