#!/usr/bin/env python3
"""
Verify io-daemon hash endpoints.
"""

import subprocess
import requests
import hashlib
import os
import sys
import time

IO_DAEMON_BINARY = "./target/debug/jstorrent-io-daemon"


def main():
    # Generate a random token
    token = "test-token-12345"
    install_id = "test-install-id"

    # Start io-daemon
    proc = subprocess.Popen(
        [IO_DAEMON_BINARY, "--token", token, "--install-id", install_id],
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
    )

    try:
        # Read port from stdout
        port_line = proc.stdout.readline().decode().strip()
        port = int(port_line)
        print(f"io-daemon started on port {port}")

        base_url = f"http://127.0.0.1:{port}"
        headers = {"X-JST-Auth": token}

        # Test 1: Hash empty bytes
        print("Test 1: Hash empty bytes...")
        resp = requests.post(f"{base_url}/hash/sha1", headers=headers, data=b"")
        assert resp.status_code == 200
        assert len(resp.content) == 20, f"Expected 20 bytes, got {len(resp.content)}"
        expected = hashlib.sha1(b"").digest()
        assert resp.content == expected, f"Hash mismatch"
        print(f"  OK Empty hash: {resp.content.hex()}")

        # Test 2: Hash known string
        print("Test 2: Hash 'hello world'...")
        test_data = b"hello world"
        resp = requests.post(f"{base_url}/hash/sha1", headers=headers, data=test_data)
        assert resp.status_code == 200
        assert len(resp.content) == 20
        expected = hashlib.sha1(test_data).digest()
        assert resp.content == expected
        print(f"  OK Hash: {resp.content.hex()}")

        # Test 3: Hash binary data
        print("Test 3: Hash binary data (256 bytes)...")
        test_data = bytes(range(256))
        resp = requests.post(f"{base_url}/hash/sha1", headers=headers, data=test_data)
        assert resp.status_code == 200
        expected = hashlib.sha1(test_data).digest()
        assert resp.content == expected
        print(f"  OK Hash: {resp.content.hex()}")

        # Test 4: Hash larger data (1MB)
        print("Test 4: Hash 1MB of random data...")
        test_data = os.urandom(1024 * 1024)
        resp = requests.post(f"{base_url}/hash/sha1", headers=headers, data=test_data)
        assert resp.status_code == 200
        expected = hashlib.sha1(test_data).digest()
        assert resp.content == expected
        print(f"  OK Hash: {resp.content.hex()}")

        # Test 5: Auth required
        print("Test 5: Verify auth is required...")
        resp = requests.post(f"{base_url}/hash/sha1", data=b"test")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("  OK Unauthorized without token")

        # Test 6: SHA256 endpoint (32 bytes)
        print("Test 6: SHA256 endpoint...")
        test_data = b"hello sha256"
        resp = requests.post(f"{base_url}/hash/sha256", headers=headers, data=test_data)
        assert resp.status_code == 200
        assert len(resp.content) == 32
        expected = hashlib.sha256(test_data).digest()
        assert resp.content == expected
        print(f"  OK SHA256: {resp.content.hex()}")

        print("\nAll hash tests passed!")

    finally:
        proc.terminate()
        proc.wait()


if __name__ == "__main__":
    main()
