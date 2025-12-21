#!/usr/bin/env python3
"""
Verify io-daemon v2 file API endpoints with base64 path encoding and hash verification.
"""

import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time


IO_DAEMON_BINARY = "./target/debug/jstorrent-io-daemon"


def main():
    token = "test-token-12345"
    install_id = "test-install-id"
    root_token = "test-root-token-xyz"

    with tempfile.TemporaryDirectory() as temp_dir:
        download_root = os.path.join(temp_dir, "downloads")
        os.makedirs(download_root)

        # Create rpc-info.json with download root
        config_dir = os.path.join(temp_dir, "jstorrent-native")
        os.makedirs(config_dir)
        rpc_info = {
            "version": 1,
            "profiles": [
                {
                    "install_id": install_id,
                    "extension_id": None,
                    "salt": "test-salt",
                    "pid": os.getpid(),
                    "port": 0,
                    "token": token,
                    "started": 0,
                    "last_used": 0,
                    "browser": {
                        "name": "test",
                        "binary": "python",
                        "extension_id": None,
                    },
                    "download_roots": [
                        {
                            "token": root_token,
                            "path": download_root,
                            "display_name": "Test Downloads",
                            "removable": False,
                            "last_stat_ok": True,
                            "last_checked": 0,
                        }
                    ],
                }
            ],
        }
        with open(os.path.join(config_dir, "rpc-info.json"), "w") as f:
            json.dump(rpc_info, f)

        env = os.environ.copy()
        env["JSTORRENT_CONFIG_DIR"] = temp_dir

        # Start io-daemon
        proc = subprocess.Popen(
            [IO_DAEMON_BINARY, "--token", token, "--install-id", install_id],
            stdout=subprocess.PIPE,
            stderr=sys.stderr,
            env=env,
        )

        try:
            port_line = proc.stdout.readline().decode().strip()
            port = int(port_line)
            print(f"io-daemon started on port {port}")

            base_url = f"http://127.0.0.1:{port}"
            headers = {"X-JST-Auth": token}

            import requests

            # Test 1: Write file with new endpoint
            print("\nTest 1: Write file with /write/{root_token}...")
            test_data = b"Hello, World!"
            file_path = "test/hello.txt"
            path_b64 = base64.b64encode(file_path.encode()).decode()

            resp = requests.post(
                f"{base_url}/write/{root_token}",
                headers={**headers, "X-Path-Base64": path_b64, "X-Offset": "0"},
                data=test_data,
            )
            assert resp.status_code == 200, f"Write failed: {resp.status_code} {resp.text}"
            print("  OK Write succeeded")

            # Verify file exists on disk
            full_path = os.path.join(download_root, file_path)
            assert os.path.exists(full_path), f"File not created at {full_path}"
            with open(full_path, "rb") as f:
                assert f.read() == test_data
            print("  OK File content verified on disk")

            # Test 2: Read file with new endpoint
            print("\nTest 2: Read file with /read/{root_token}...")
            resp = requests.get(
                f"{base_url}/read/{root_token}",
                headers={**headers, "X-Path-Base64": path_b64},
            )
            assert resp.status_code == 200, f"Read failed: {resp.status_code}"
            assert resp.content == test_data
            print("  OK Read content matches")

            # Test 3: Read with offset and length
            print("\nTest 3: Read with X-Offset and X-Length...")
            resp = requests.get(
                f"{base_url}/read/{root_token}",
                headers={
                    **headers,
                    "X-Path-Base64": path_b64,
                    "X-Offset": "7",
                    "X-Length": "5",
                },
            )
            assert resp.status_code == 200
            assert resp.content == b"World", f"Expected 'World', got {resp.content}"
            print("  OK Partial read succeeded")

            # Test 4: Write with offset
            print("\nTest 4: Write at offset...")
            resp = requests.post(
                f"{base_url}/write/{root_token}",
                headers={**headers, "X-Path-Base64": path_b64, "X-Offset": "7"},
                data=b"Rust!!",  # 6 bytes to overwrite "World!"
            )
            assert resp.status_code == 200
            with open(full_path, "rb") as f:
                content = f.read()
            assert content == b"Hello, Rust!!", f"Expected 'Hello, Rust!!', got {content}"
            print("  OK Write at offset succeeded")

            # Test 5: Write with hash verification (success)
            print("\nTest 5: Write with X-Expected-SHA1 (matching)...")
            test_data = b"verified content"
            sha1_hex = hashlib.sha1(test_data).hexdigest()
            verified_path = "verified.bin"
            verified_b64 = base64.b64encode(verified_path.encode()).decode()

            resp = requests.post(
                f"{base_url}/write/{root_token}",
                headers={
                    **headers,
                    "X-Path-Base64": verified_b64,
                    "X-Expected-SHA1": sha1_hex,
                },
                data=test_data,
            )
            assert resp.status_code == 200, f"Verified write failed: {resp.status_code}"
            print(f"  OK Hash verification passed: {sha1_hex}")

            # Test 6: Write with hash mismatch (409 Conflict)
            print("\nTest 6: Write with X-Expected-SHA1 (mismatch)...")
            wrong_hash = "a" * 40  # Wrong hash
            resp = requests.post(
                f"{base_url}/write/{root_token}",
                headers={
                    **headers,
                    "X-Path-Base64": verified_b64,
                    "X-Expected-SHA1": wrong_hash,
                },
                data=test_data,
            )
            assert resp.status_code == 409, f"Expected 409, got {resp.status_code}"
            assert "Hash mismatch" in resp.text
            print(f"  OK 409 Conflict returned: {resp.text}")

            # Test 7: Path with special characters (# and ?)
            print("\nTest 7: Path with # and ? characters...")
            special_path = "file#1?v2.txt"
            special_b64 = base64.b64encode(special_path.encode()).decode()
            special_data = b"special chars work"

            resp = requests.post(
                f"{base_url}/write/{root_token}",
                headers={**headers, "X-Path-Base64": special_b64},
                data=special_data,
            )
            assert resp.status_code == 200, f"Write special failed: {resp.status_code}"

            # Verify file exists with correct name
            special_full = os.path.join(download_root, special_path)
            assert os.path.exists(special_full), f"File not created: {special_full}"
            with open(special_full, "rb") as f:
                assert f.read() == special_data
            print(f"  OK File with # and ? created: {special_path}")

            # Read it back
            resp = requests.get(
                f"{base_url}/read/{root_token}",
                headers={**headers, "X-Path-Base64": special_b64},
            )
            assert resp.status_code == 200
            assert resp.content == special_data
            print("  OK Read special path succeeded")

            # Test 8: Unicode path
            print("\nTest 8: Unicode path...")
            unicode_path = "ファイル/日本語.txt"
            unicode_b64 = base64.b64encode(unicode_path.encode("utf-8")).decode()
            unicode_data = b"unicode content"

            resp = requests.post(
                f"{base_url}/write/{root_token}",
                headers={**headers, "X-Path-Base64": unicode_b64},
                data=unicode_data,
            )
            assert resp.status_code == 200
            print(f"  OK Unicode path write succeeded: {unicode_path}")

            resp = requests.get(
                f"{base_url}/read/{root_token}",
                headers={**headers, "X-Path-Base64": unicode_b64},
            )
            assert resp.status_code == 200
            assert resp.content == unicode_data
            print("  OK Unicode path read succeeded")

            # Test 9: Missing X-Path-Base64 header
            print("\nTest 9: Missing X-Path-Base64 header...")
            resp = requests.post(
                f"{base_url}/write/{root_token}",
                headers=headers,
                data=b"test",
            )
            assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
            print("  OK 400 Bad Request returned")

            # Test 10: Invalid root token
            print("\nTest 10: Invalid root token...")
            resp = requests.post(
                f"{base_url}/write/invalid-token",
                headers={**headers, "X-Path-Base64": path_b64},
                data=b"test",
            )
            assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"
            print("  OK 403 Forbidden returned")

            # Test 11: Path traversal attempt
            print("\nTest 11: Path traversal attempt...")
            evil_path = "../../../etc/passwd"
            evil_b64 = base64.b64encode(evil_path.encode()).decode()
            resp = requests.post(
                f"{base_url}/write/{root_token}",
                headers={**headers, "X-Path-Base64": evil_b64},
                data=b"evil",
            )
            assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
            print("  OK Path traversal blocked")

            print("\n✓ All v2 file API tests passed!")

        finally:
            proc.terminate()
            proc.wait()


if __name__ == "__main__":
    main()
