#!/usr/bin/env python3
"""
Shared test utilities with context managers for clean resource management.

Usage:
    from test_helpers import test_dirs, test_engine, libtorrent_seeder
    
    with test_dirs() as (seeder_dir, leecher_dir):
        with libtorrent_seeder(seeder_dir) as lt:
            with test_engine(leecher_dir) as engine:
                # ... test code ...
    # Everything auto-cleaned
"""
import sys
import os
import time
import hashlib
import tempfile
import shutil
from contextlib import contextmanager

from jst import JSTEngine
from libtorrent_utils import LibtorrentSession


# =============================================================================
# Context Managers
# =============================================================================

@contextmanager
def temp_directory(prefix: str = "jst_test_"):
    """Temporary directory that auto-cleans on exit."""
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
